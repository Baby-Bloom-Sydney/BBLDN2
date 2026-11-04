/**
 * Booking the Complimentary matchmaker call (plan A7; names per §12 R15; brief §0.3, §0.6, §0.11, §8 contracts).
 *
 * Server-only, and deliberately NOT a `"use server"` file (rule at `src/lib/invite/mint.ts:1-9`): these take a
 * parent id and act with the service role, so only server code that has already proved who the parent is may call
 * them — 04b's actions (the id from the session), 04c's admin actions (`requireAdmin`), 03 (its `/deposit` token).
 *
 * Every operation, in order:
 *   1. the switch — off → `call_booking_disabled`, before any read;
 *   2. zod on the whole request — anything malformed → `invalid`;
 *   3. a client-supplied time is recomputed against the live grid (never trusted): off the grid or past the
 *      window → `invalid`, inside the notice → `too_soon`, blocked or occupied → `taken`;
 *   4. the repository (amendment 19's functions, which check again under their lock);
 *   5. a notice for the emails — logged if it fails, never thrown, never undoing the booking.
 *
 * BB-wave1-041126/04a-core, 2026-11-04.
 */

import { z } from "zod";
import { callBookingEnabled } from "@/lib/features/flags";
import { londonDateOf } from "@/lib/timezone";
import { CALL_BOOKING_DISABLED, defaultCallsDeps, type CallsDeps } from "./deps";
import { candidateSlots, slotBounds, spanOf, withoutTaken } from "./free-slots";
import { generateSlots } from "./generate-slots";
import { notifyCall, type CallNotice } from "./notify";
import { checkOutcome } from "./outcomes";
import type {
  ActorKind,
  CallActor,
  CallBooking,
  CallMethod,
  CallOutcomeCode,
  CallPurpose,
  CallResultCode,
  CallSource,
  CallsResult,
  CancelInput,
  CancelledBooking,
  ConfirmInput,
  ConfirmedBooking,
  RecordedOutcome,
  Slot,
} from "./types";
import { isoInstantInput, londonDate, uuid } from "./zod-parts";

export interface FreeSlotsRequest {
  /** Only this London date. With `purpose: "cohort_prebook"` the 7-day window doesn't apply (brief §11 Q9). */
  readonly londonDate?: string;
  readonly purpose?: CallPurpose;
}

export interface HoldRequest {
  readonly parentUserId: string;
  /** A UTC instant with an offset; must be one of the current free slots. */
  readonly startsAt: string;
  readonly purpose?: CallPurpose;
  /** Omitted → her latest position, if any; null → none. */
  readonly positionId?: string | null;
  readonly actor: CallActor;
}

export interface BookRequest extends HoldRequest {
  readonly idempotencyKey: string;
}

export interface OutcomeRequest {
  readonly parentUserId: string;
  readonly bookingId?: string | null;
  readonly result?: CallResultCode | null;
  readonly outcome?: CallOutcomeCode | null;
  readonly note?: string | null;
  readonly callBackAt?: string | null;
  readonly method?: CallMethod;
  readonly source?: CallSource;
  readonly actor: Pick<CallActor, "userId">;
  /** Brief 05's JustCall id; a repeat returns the first entry (plan R22). */
  readonly justcallCallId?: string | null;
}

export interface HeldTime extends Slot {
  readonly bookingId: string;
  readonly holdExpiresAt: string;
}

const purpose = z.enum(["first_call", "cohort_prebook"]);
const actor = z.strictObject({ userId: uuid.nullable(), kind: z.enum(["parent", "admin"]) });
const idempotencyKey = z.string().min(1).max(200);

const freeSlotsSchema = z.strictObject({ londonDate: londonDate.optional(), purpose: purpose.default("first_call") });
const holdSchema = z.strictObject({
  parentUserId: uuid,
  startsAt: isoInstantInput,
  purpose: purpose.default("first_call"),
  positionId: uuid.nullable().optional(),
  actor,
});
const bookSchema = holdSchema.extend({ idempotencyKey });
const confirmSchema = z.strictObject({ parentUserId: uuid, holdId: uuid, idempotencyKey, actor });
const cancelSchema = z.strictObject({ parentUserId: uuid, bookingId: uuid, actor });
const outcomeSchema = z
  .strictObject({
    parentUserId: uuid,
    bookingId: uuid.nullable().default(null),
    result: z.enum(["answered", "no_answer", "voicemail", "wrong_number"]).nullable().default(null),
    outcome: z
      .enum(["deposit_taken", "link_sent", "call_back_later", "not_going_ahead", "prebooked_next_cohort", "other", "stop_calling"])
      .nullable()
      .default(null),
    note: z.string().max(2000).nullable().default(null),
    callBackAt: isoInstantInput.nullable().default(null),
    method: z.enum(["phone", "justcall", "other"]).default("phone"),
    source: z.enum(["manual", "justcall"]).default("manual"),
    actor: z.strictObject({ userId: uuid.nullable() }),
    justcallCallId: z.string().min(1).max(200).nullable().default(null),
  })
  .refine(checkOutcome);

const INVALID = Object.freeze({ ok: false, error: "invalid" } as const);
const ok = <T>(value: T): CallsResult<T> => ({ ok: true, value });

function parse<T>(schema: z.ZodType<T>, input: unknown): T | null {
  const parsed = schema.safeParse(input);
  return parsed.success ? parsed.data : null;
}

/** The free slots for a request (window mode, or one London date). */
async function loadFreeSlots(
  request: { readonly londonDate?: string; readonly purpose: CallPurpose },
  deps: CallsDeps,
): Promise<CallsResult<readonly Slot[]>> {
  const [settings, hours] = await Promise.all([deps.repo.readSettings(), deps.repo.readWeeklyHours()]);
  if (!settings.ok) return settings;
  if (!hours.ok) return hours;
  const now = deps.now();
  const ignoreWindow = request.purpose === "cohort_prebook" && request.londonDate !== undefined;
  const candidates = candidateSlots({ hours: hours.value, settings: settings.value, now, londonDate: request.londonDate, ignoreWindow });
  const span = spanOf(candidates);
  if (span === null) return ok([]);
  const [blocks, bookings] = await Promise.all([deps.repo.readBlocks(span), deps.repo.readOccupyingBookings(span)]);
  if (!blocks.ok) return blocks;
  if (!bookings.ok) return bookings;
  return ok(withoutTaken(candidates, { blocks: blocks.value, bookings: bookings.value, now }));
}

/** Her own live hold for this purpose: `call_hold_slot` replaces it first, so it never blocks her own pick. */
const isOwnReplaceableHold = (b: CallBooking, parentUserId: string, slotPurpose: CallPurpose): boolean =>
  b.parentUserId === parentUserId && b.status === "held" && b.purpose === slotPurpose;

/** Is `startsAt` a current free slot for her, for this purpose? The slot (with the grid's end), or why not. */
async function currentFreeSlot(
  startsAt: string,
  slotPurpose: CallPurpose,
  parentUserId: string,
  deps: CallsDeps,
): Promise<CallsResult<Slot>> {
  const [settings, hours] = await Promise.all([deps.repo.readSettings(), deps.repo.readWeeklyHours()]);
  if (!settings.ok) return settings;
  if (!hours.ok) return hours;
  const date = londonDateOf(startsAt);
  const slot = generateSlots({ hours: hours.value, fromDate: date, toDate: date, slotMinutes: settings.value.slotMinutes }).find(
    (s) => s.startsAt === startsAt,
  );
  if (slot === undefined) return INVALID;
  const now = deps.now();
  const { earliest, latest } = slotBounds({ settings: settings.value, now, londonDate: date, ignoreWindow: slotPurpose === "cohort_prebook" });
  if (slot.startsAt < earliest) return { ok: false, error: "too_soon" };
  if (latest !== null && slot.startsAt > latest) return INVALID;
  const [blocks, bookings] = await Promise.all([deps.repo.readBlocks(slot), deps.repo.readOccupyingBookings(slot)]);
  if (!blocks.ok) return blocks;
  if (!bookings.ok) return bookings;
  const others = bookings.value.filter((b) => !isOwnReplaceableHold(b, parentUserId, slotPurpose));
  return withoutTaken([slot], { blocks: blocks.value, bookings: others, now }).length === 1 ? ok(slot) : { ok: false, error: "taken" };
}

async function positionFor(parentUserId: string, given: string | null | undefined, deps: CallsDeps): Promise<string | null> {
  if (given !== undefined) return given;
  const latest = await deps.repo.readLatestPositionId(parentUserId);
  return latest.ok ? latest.value : null; // a failed lookup is logged by the repo; the call is booked without it
}

function confirmedNotice(confirmed: ConfirmedBooking, parentUserId: string, actorKind: ActorKind): CallNotice | null {
  const base = { parentUserId, bookingId: confirmed.bookingId, startsAt: confirmed.startsAt, actorKind };
  if (confirmed.kind === "moved") return { ...base, kind: "moved", fromStartsAt: confirmed.fromStartsAt };
  return confirmed.replay ? null : { ...base, kind: "booked" };
}

async function afterConfirm(
  result: CallsResult<ConfirmedBooking>,
  parentUserId: string,
  actorKind: ActorKind,
  deps: CallsDeps,
): Promise<CallsResult<ConfirmedBooking>> {
  if (!result.ok) return result;
  const notice = confirmedNotice(result.value, parentUserId, actorKind);
  if (notice !== null) await notifyCall(notice, deps.notify);
  return result;
}

/** Free call times: the next 7 days from now + notice, or one London date (brief §8 contract 3). */
export async function getFreeSlots(request: FreeSlotsRequest = {}, deps: CallsDeps = defaultCallsDeps()): Promise<CallsResult<readonly Slot[]>> {
  if (!callBookingEnabled()) return CALL_BOOKING_DISABLED;
  const parsed = parse(freeSlotsSchema, request);
  if (parsed === null) return INVALID;
  return loadFreeSlots(parsed, deps);
}

/** Hold a free slot for her for `hold_minutes` (the picker's "Choose this time", plan R17). */
export async function holdSlotForParent(request: HoldRequest, deps: CallsDeps = defaultCallsDeps()): Promise<CallsResult<HeldTime>> {
  if (!callBookingEnabled()) return CALL_BOOKING_DISABLED;
  const parsed = parse(holdSchema, request);
  if (parsed === null) return INVALID;
  const slot = await currentFreeSlot(parsed.startsAt, parsed.purpose, parsed.parentUserId, deps);
  if (!slot.ok) return slot;
  const positionId = await positionFor(parsed.parentUserId, parsed.positionId, deps);
  const held = await deps.repo.holdSlot({ ...slot.value, parentUserId: parsed.parentUserId, purpose: parsed.purpose, positionId, actor: parsed.actor });
  return held.ok ? ok({ ...held.value, startsAt: slot.value.startsAt, endsAt: slot.value.endsAt }) : held;
}

/** Confirm her hold: a new booking, or her existing one moved there (the same row). Brief 10 hooks 04b's caller. */
export async function confirmHoldForParent(request: ConfirmInput, deps: CallsDeps = defaultCallsDeps()): Promise<CallsResult<ConfirmedBooking>> {
  if (!callBookingEnabled()) return CALL_BOOKING_DISABLED;
  const parsed = parse(confirmSchema, request);
  if (parsed === null) return INVALID;
  return afterConfirm(await deps.repo.confirmHold(parsed), parsed.parentUserId, parsed.actor.kind, deps);
}

/** Hold and confirm in one (admin on a family's behalf; brief 03's pre-book, after its own parent check). */
export async function bookSlotForParent(request: BookRequest, deps: CallsDeps = defaultCallsDeps()): Promise<CallsResult<ConfirmedBooking>> {
  if (!callBookingEnabled()) return CALL_BOOKING_DISABLED;
  const parsed = parse(bookSchema, request);
  if (parsed === null) return INVALID;
  const slot = await currentFreeSlot(parsed.startsAt, parsed.purpose, parsed.parentUserId, deps);
  if (!slot.ok) return slot;
  const positionId = await positionFor(parsed.parentUserId, parsed.positionId, deps);
  const booked = await deps.repo.bookSlot({
    ...slot.value,
    parentUserId: parsed.parentUserId,
    purpose: parsed.purpose,
    positionId,
    idempotencyKey: parsed.idempotencyKey,
    actor: parsed.actor,
  });
  return afterConfirm(booked, parsed.parentUserId, parsed.actor.kind, deps);
}

/** Cancel a booked call before it starts; she returns to Not booked. */
export async function cancelBooking(request: CancelInput, deps: CallsDeps = defaultCallsDeps()): Promise<CallsResult<CancelledBooking>> {
  if (!callBookingEnabled()) return CALL_BOOKING_DISABLED;
  const parsed = parse(cancelSchema, request);
  if (parsed === null) return INVALID;
  const cancelled = await deps.repo.cancelBooking(parsed);
  if (!cancelled.ok) return cancelled;
  await notifyCall({ kind: "cancelled", parentUserId: parsed.parentUserId, ...cancelled.value, actorKind: parsed.actor.kind }, deps.notify);
  return cancelled;
}

/** Record a call attempt (BAI's form; brief 05's JustCall log). Sends no email. */
export async function recordCallOutcome(request: OutcomeRequest, deps: CallsDeps = defaultCallsDeps()): Promise<CallsResult<RecordedOutcome>> {
  if (!callBookingEnabled()) return CALL_BOOKING_DISABLED;
  const parsed = parse(outcomeSchema, request);
  if (parsed === null) return INVALID;
  return deps.repo.recordOutcome(parsed);
}
