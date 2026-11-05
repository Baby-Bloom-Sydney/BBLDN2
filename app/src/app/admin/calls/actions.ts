"use server";

/**
 * /admin/calls server actions (plan C4; brief §3 admin 3–4, §0.10, §0.11, §9.15). BB-wave1-041126/04c1-build.
 *
 * Contract, for each: `callBookingEnabled()` first (off → `call_booking_disabled`, before any read), then
 * `proveAdmin()` (not an admin → `not_authorized`, before any read or client), then zod on the whole input
 * (`invalid`), then one call operation acting as the proven admin (`admin-calls.ts` / `booking.ts`, which recompute
 * every time against the live grid, and amendment 19's functions, which check again under their lock and write the
 * audit rows), then `/admin/calls` is revalidated after a write. The parent id comes from validated input — only an
 * admin gets that far. Refusals are closed codes (`AdminCallError`), never detail.
 *
 * Booking, moving and cancelling on a family's behalf email her as her own would (`booking.ts` → `notify.ts`); an
 * outcome sends nothing. Only these five async functions are exported — every async export of a "use server" file
 * is callable.
 */

import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  adminRefusalOf,
  cancelBookingOnBehalf,
  confirmHoldOnBehalf,
  familySlotGrid,
  holdSlotOnBehalf,
  type AdminCallError,
  type AdminCallResult,
} from "@/lib/calls/admin-calls";
import { proveAdmin, type AdminProof } from "@/lib/calls/admin-proof";
import { recordCallOutcome } from "@/lib/calls/booking";
import { adminHeldLine } from "@/lib/calls/copy";
import { groupSlotGridByDay, type SlotDay } from "@/lib/calls/group-slots-by-day";
import { CALL_OUTCOMES, CALL_RESULTS, checkOutcome } from "@/lib/calls/outcomes";
import type { CallOutcomeCode, CallResultCode, CallsResult } from "@/lib/calls/types";
import type { PickerHold } from "@/components/calls/use-slot-picker";
import { callBookingEnabled } from "@/lib/features/flags";
import { localToUTC, wallClockExists } from "@/lib/timezone";

const PAGE = "/admin/calls";
const CLOCK = /^([01]\d|2[0-3]):([0-5]\d)$/;

const parentUserId = z.uuid();
const isResult = (v: unknown): v is CallResultCode => typeof v === "string" && (CALL_RESULTS as readonly string[]).includes(v);
const isOutcome = (v: unknown): v is CallOutcomeCode => typeof v === "string" && (CALL_OUTCOMES as readonly string[]).includes(v);
const outcomeInput = z
  .strictObject({
    parentUserId,
    bookingId: z.uuid().nullable(),
    result: z.custom<CallResultCode>(isResult).nullable(),
    outcome: z.custom<CallOutcomeCode>(isOutcome).nullable(),
    note: z
      .string()
      .max(2000)
      .nullable()
      .transform((n) => (n === null || n.trim() === "" ? null : n.trim())),
    callBackDate: z.iso.date().nullable().optional(),
    callBackTime: z.string().regex(CLOCK).nullable().optional(),
  })
  .refine((i) => (i.callBackDate ?? null) === null === ((i.callBackTime ?? null) === null))
  // A call-back time belongs to "Call back later" only (security review L2).
  .refine((i) => (i.callBackDate ?? null) === null || i.outcome === "call_back_later")
  .refine(checkOutcome);
const holdInput = z.strictObject({ parentUserId, startsAt: z.iso.datetime({ offset: true }) });
const confirmInput = z.strictObject({ parentUserId, holdId: z.uuid(), idempotencyKey: z.string().min(1).max(200) });
const cancelInput = z.strictObject({ parentUserId, bookingId: z.uuid() });
const familyInput = z.strictObject({ parentUserId });

type Gate<T> = { readonly ok: true; readonly proof: AdminProof; readonly input: T } | { readonly ok: false; readonly error: AdminCallError };

/** The switch, then the admin, then the input — each only after the one before passed. */
async function gate<T>(schema: z.ZodType<T>, input: unknown): Promise<Gate<T>> {
  if (!callBookingEnabled()) return { ok: false, error: "call_booking_disabled" };
  const proof = await proveAdmin();
  if (!proof) return { ok: false, error: "not_authorized" };
  const parsed = schema.safeParse(input);
  return parsed.success ? { ok: true, proof, input: parsed.data } : { ok: false, error: "invalid" };
}

/** A call operation's result as staff may see it; revalidate the page after a write that landed. */
function answer<T, R>(result: CallsResult<T>, value: (v: T) => R, wrote = true): AdminCallResult<R> {
  if (!result.ok) return { ok: false, error: adminRefusalOf(result.error) };
  if (wrote) revalidatePath(PAGE);
  return { ok: true, value: value(result.value) };
}

/**
 * The call-back time typed on the Calls tab, read as London clock time here — never in the browser's zone. Null when
 * none was given; undefined when that London time doesn't exist (the spring-forward hour) or has passed — refused.
 */
function callBackAt(date: string | null | undefined, time: string | null | undefined): string | null | undefined {
  if (!date || !time) return null;
  const [hour, minute] = time.split(":").map(Number);
  if (!wallClockExists(date, hour, minute)) return undefined;
  const at = localToUTC(date, hour, minute);
  return Date.parse(at) > Date.now() ? at : undefined;
}

/** Record a call attempt: result, the outcome when answered (or Stop calling), a note, a call-back time. */
export async function recordCallOutcomeAction(input: unknown): Promise<AdminCallResult<{ readonly entryId: string }>> {
  const g = await gate(outcomeInput, input);
  if (!g.ok) return g;
  const at = callBackAt(g.input.callBackDate, g.input.callBackTime);
  if (at === undefined) return { ok: false, error: "invalid" };
  const recorded = await recordCallOutcome(g.proof, {
    parentUserId: g.input.parentUserId,
    bookingId: g.input.bookingId,
    result: g.input.result,
    outcome: g.input.outcome,
    note: g.input.note,
    callBackAt: at,
    method: "phone",
    source: "manual",
  });
  return answer(recorded, (r) => ({ entryId: r.entryId }));
}

/** The on-behalf picker's tap: hold that time for her ("Held for 5 minutes"). */
export async function holdCallForFamily(input: unknown): Promise<AdminCallResult<PickerHold>> {
  const g = await gate(holdInput, input);
  if (!g.ok) return g;
  const held = await holdSlotOnBehalf(g.proof, g.input);
  return answer(held, (h) => ({ holdId: h.bookingId, startsAt: h.startsAt, line: adminHeldLine(h.holdMinutes) }), false);
}

/** "Book this time" / "Move to this time": her booking, or her booked call moved there. She is emailed. */
export async function confirmCallForFamily(input: unknown): Promise<AdminCallResult<{ readonly bookingId: string; readonly moved: boolean }>> {
  const g = await gate(confirmInput, input);
  if (!g.ok) return g;
  const confirmed = await confirmHoldOnBehalf(g.proof, g.input);
  return answer(confirmed, (c) => ({ bookingId: c.bookingId, moved: c.kind === "moved" }));
}

/** Cancel her booked call before it starts; she is emailed and is back under Not booked. */
export async function cancelCallForFamily(input: unknown): Promise<AdminCallResult<{ readonly bookingId: string }>> {
  const g = await gate(cancelInput, input);
  if (!g.ok) return g;
  const cancelled = await cancelBookingOnBehalf(g.proof, g.input);
  return answer(cancelled, (c) => ({ bookingId: c.bookingId }));
}

/** Her picker's days again (after a taken time, or Retry). */
export async function reloadFamilySlots(input: unknown): Promise<AdminCallResult<readonly SlotDay[]>> {
  const g = await gate(familyInput, input);
  if (!g.ok) return g;
  const grid = await familySlotGrid(g.proof, g.input.parentUserId);
  return answer(grid, groupSlotGridByDay, false);
}
