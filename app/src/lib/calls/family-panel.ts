/**
 * The row drawer's read for one family, `/admin/calls?openCall=<parentUserId>` (plan C4; brief §3 admin 2–4, §0.10,
 * §0.11): contact, position, nannies contacted and replies, the deposit (read-only), her booked call, every past
 * attempt and note with who recorded it, the four links, the tags, and her picker grid for booking on her behalf.
 *
 * Server-only, not `"use server"`. The switch, then the admin proof, then the id (a user id), before any read; a
 * user with no parents row (not a parent) → `not_found`. Fails closed on her bookings, attempts, contact, blocks or
 * row data; the deposit and the grid are each optional ("Could not be read", and the picker's load-failed state).
 *
 * BB-wave1-041126/04c1-build, 2026-11-05.
 */

import { callBookingEnabled } from "@/lib/features/flags";
import { familySlotGrid } from "./admin-calls";
import { isAdminProof, type AdminProof } from "./admin-proof";
import { ADMIN_COPY, depositLine } from "./copy";
import { defaultDashboardDeps, type DashboardDeps } from "./dashboard";
import type { DepositFacts } from "./dashboard-row";
import {
  attemptWords,
  contactWords,
  depositStateOf,
  londonLabel,
  positionSummaryOf,
  rowLinks,
  signupTypeOf,
  tagsOf,
  type CallTag,
  type ContactWords,
  type PositionSummary,
  type RowLinks,
} from "./dashboard-row";
import { CALL_BOOKING_DISABLED, CALLS_INVALID } from "./deps";
import { groupSlotGridByDay, type SlotDay } from "./group-slots-by-day";
import { myBookedCall } from "./parent-view";
import type { CallBlock, CallBooking, CallLogEntry, CallsResult, ParentContact } from "./types";
import { uuid } from "./zod-parts";

export interface PanelBooking {
  readonly bookingId: string;
  readonly startsAt: string;
  /** "Fri 5 Feb, 14:00 (London time)" */
  readonly when: string;
  /** Move and Cancel only before the start; after it, an outcome. */
  readonly changeable: boolean;
}

export interface AttemptView {
  readonly key: string;
  readonly when: string;
  readonly what: string;
  readonly note: string | null;
  readonly by: string | null;
  readonly callBack: string | null;
}

export interface FamilyPanel {
  readonly parentUserId: string;
  readonly contact: ContactWords;
  readonly signupType: string;
  readonly signedUp: string | null;
  /** Null: no position yet. */
  readonly position: PositionSummary | null;
  readonly deposit: string;
  readonly links: RowLinks;
  readonly tags: readonly CallTag[];
  /** Her booked first call, or null. */
  readonly booking: PanelBooking | null;
  /** Newest first. */
  readonly attempts: readonly AttemptView[];
  /** Her picker grid; null when it couldn't be read. */
  readonly days: readonly SlotDay[] | null;
}

const ok = <T>(value: T): CallsResult<T> => ({ ok: true, value });
const NOT_FOUND = Object.freeze({ ok: false, error: "not_found" } as const);

interface HerCalls {
  readonly contact: ParentContact | null;
  readonly booking: CallBooking | null;
  readonly entries: readonly CallLogEntry[];
  readonly blocks: readonly CallBlock[];
}

/** Her contact, her booked first call (and any block over it), and her attempts. */
async function herCalls(parentUserId: string, deps: DashboardDeps): Promise<CallsResult<HerCalls>> {
  const [contacts, bookings, entries] = await Promise.all([
    deps.repo.readContacts([parentUserId]),
    deps.repo.readBookingsForParents([parentUserId]),
    deps.repo.readLogEntriesForParents([parentUserId]),
  ]);
  if (!contacts.ok) return contacts;
  if (!bookings.ok) return bookings;
  if (!entries.ok) return entries;
  const booking = myBookedCall(bookings.value);
  const blocks = booking === null ? ok<readonly CallBlock[]>([]) : await deps.repo.readBlocks(booking);
  if (!blocks.ok) return blocks;
  const contact = contacts.value.find((c) => c.userId === parentUserId) ?? null;
  return ok({ contact, booking, entries: entries.value, blocks: blocks.value });
}

/** Who recorded each attempt, by name; an unreadable name is just left off. */
async function recorderNames(entries: readonly CallLogEntry[], deps: DashboardDeps): Promise<ReadonlyMap<string, string>> {
  const ids = [...new Set(entries.flatMap((e) => (e.recordedBy === null ? [] : [e.recordedBy])))];
  if (ids.length === 0) return new Map();
  const contacts = await deps.repo.readContacts(ids);
  return contacts.ok ? new Map(contacts.value.map((c) => [c.userId, contactWords(c).name])) : new Map();
}

function attemptView(entry: CallLogEntry, names: ReadonlyMap<string, string>): AttemptView {
  return {
    key: entry.id,
    when: londonLabel(entry.occurredAt),
    what: attemptWords(entry),
    note: entry.note,
    by: entry.recordedBy === null ? null : names.get(entry.recordedBy) ?? null,
    callBack: entry.callBackAt === null ? null : `${ADMIN_COPY.callBack} ${londonLabel(entry.callBackAt)}`,
  };
}

function bookingView(booking: CallBooking | null, now: Date): PanelBooking | null {
  if (booking === null) return null;
  return { bookingId: booking.id, startsAt: booking.startsAt, when: londonLabel(booking.startsAt), changeable: Date.parse(booking.startsAt) > now.getTime() };
}

const depositWords = (read: CallsResult<DepositFacts | null>): string =>
  read.ok ? depositLine(depositStateOf(read.value)) : ADMIN_COPY.depositUnreadable;

/** One family's drawer. Admin only. */
export async function loadFamilyPanel(proof: AdminProof, parentUserId: string, deps: DashboardDeps = defaultDashboardDeps()): Promise<CallsResult<FamilyPanel>> {
  if (!callBookingEnabled()) return CALL_BOOKING_DISABLED;
  if (!isAdminProof(proof) || !uuid.safeParse(parentUserId).success) return CALLS_INVALID;
  const [calls, deposit, grid] = await Promise.all([herCalls(parentUserId, deps), deps.reads.readDeposit(parentUserId), familySlotGrid(proof, parentUserId, deps)]);
  if (!calls.ok) return calls;
  const { contact, booking, entries, blocks } = calls.value;
  const preferred = new Map(booking?.positionId ? [[parentUserId, booking.positionId] as const] : []);
  const details = await deps.reads.readFamilyDetails([parentUserId], preferred);
  if (!details.ok) return details;
  const family = details.value.families.get(parentUserId);
  if (family === undefined) return NOT_FOUND;
  const position = positionSummaryOf(details.value.positions.get(parentUserId) ?? null);
  const names = await recorderNames(entries, deps);
  return ok({
    parentUserId,
    contact: contactWords(contact),
    signupType: signupTypeOf(family.signupSource),
    signedUp: `${ADMIN_COPY.signedUp} ${londonLabel(family.signedUpAt)}`,
    position,
    deposit: depositWords(deposit),
    links: rowLinks(parentUserId, position?.positionId ?? null),
    tags: tagsOf({ blockedOver: blocks.length > 0, overdue: false, cohortPrebook: false, test: contact?.isTestUser === true }),
    booking: bookingView(booking, deps.now()),
    attempts: entries.map((e) => attemptView(e, names)),
    days: grid.ok ? groupSlotGridByDay(grid.value) : null,
  });
}
