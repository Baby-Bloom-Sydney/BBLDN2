/**
 * The call operations only an admin may run (04a security review H2e), each taking an `AdminProof` first and
 * acting as that admin. 04c's `"use server"` actions call `proveAdmin()` and pass the proof here.
 *
 * Server-only, not `"use server"` (`src/lib/invite/mint.ts:1-9`). The switch is checked first, then the proof; a
 * missing or forged proof answers `invalid` before anything is read or written.
 *
 * (`recordCallOutcome`, `getToCallList` and `getWhoIsNext` take the proof the same way, in their own modules.)
 *
 * 04c-1 adds the on-behalf picker's steps (plan §13): `holdSlotOnBehalf` (a tap holds the time for her, as the
 * admin), `confirmHoldOnBehalf` (her first booking, or her booked call moved there), and `familySlotGrid` (her
 * picker's grid). Her first call only; the server recomputes every time against the live grid (`booking.ts`).
 *
 * 04c-2 adds the Calendar tab's (plan C5, §13): `updateCallSettings` (call length from the fixed list, brief §0a.13;
 * notice, hold, caller number), `addCallBlock` (the form's London date and time strings read here, on the server),
 * `removeCallBlock`, and `calendarWeek` (the 7-day grid's one read, `calendar.ts`). Each: the switch, then the proof,
 * then the input, as the ones above.
 *
 * BB-wave1-041126/04a-core, 2026-11-04; BB-wave1-041126/04c1-build, 2026-11-05; BB-wave1-041126/04c2-build, 2026-11-06.
 */

import { callBookingEnabled } from "@/lib/features/flags";
import { actingAdmin, isAdminProof, type AdminProof } from "./admin-proof";
import {
  bookSlotForParent,
  cancelBooking,
  confirmHoldForParent,
  holdSlotForParent,
  type BookRequest,
  type CancelRequest,
  type HeldTime,
} from "./booking";
import { addLondonDays, localToUTC, londonToday } from "@/lib/timezone";
import { calendarViewOf, GRID_DAYS, parseBlockForm, type CalendarView } from "./calendar";
import { contactWords } from "./dashboard-row";
import { CALL_BOOKING_DISABLED, CALLS_INVALID, defaultCallsDeps, type CallsDeps } from "./deps";
import { validateWeeklyHours } from "./hours";
import { parseSettingsUpdate } from "./settings";
import { loadSlotGrid, type SlotGrid } from "./slot-grid";
import type {
  CallBlock,
  CallError,
  CallSettings,
  CallsResult,
  CancelledBooking,
  ConfirmedBooking,
  ParentContact,
  StartedCallBooking,
  TimeSpan,
} from "./types";
import { uuid } from "./zod-parts";

const NOT_FOUND = Object.freeze({ ok: false, error: "not_found" } as const);

/** On-behalf writes act only for a parent (review round 2 L11): her parents row, before any write or email. */
async function forAParent(parentUserId: string, deps: CallsDeps): Promise<CallsResult<true>> {
  if (!uuid.safeParse(parentUserId).success) return CALLS_INVALID;
  const row = await deps.repo.readScopeParent(parentUserId);
  if (!row.ok) return row;
  return row.value === null ? NOT_FOUND : { ok: true, value: true };
}

/** Brief 14's "Start call booking": sets `enabled_since` once; later presses keep the first time (plan §12 R11). */
export async function startCallBooking(proof: AdminProof, deps: CallsDeps = defaultCallsDeps()): Promise<CallsResult<StartedCallBooking>> {
  if (!callBookingEnabled()) return CALL_BOOKING_DISABLED;
  if (!isAdminProof(proof)) return CALLS_INVALID;
  return deps.repo.startCallBooking(actingAdmin(proof));
}

/** The whole week of call hours from the Calendar tab: checked here (invalid / overlap), then replaced atomically. */
export async function replaceWeeklyHours(proof: AdminProof, hours: unknown, deps: CallsDeps = defaultCallsDeps()): Promise<CallsResult<true>> {
  if (!callBookingEnabled()) return CALL_BOOKING_DISABLED;
  if (!isAdminProof(proof)) return CALLS_INVALID;
  const week = validateWeeklyHours(hours);
  if (!week.ok) return week;
  return deps.repo.replaceWeeklyHours(week.value, actingAdmin(proof));
}

/** Book (or move) a family's call on her behalf (brief §0.11); she gets the same emails. */
export async function bookSlotOnBehalf(
  proof: AdminProof,
  request: Omit<BookRequest, "actor">,
  deps: CallsDeps = defaultCallsDeps(),
): Promise<CallsResult<ConfirmedBooking>> {
  if (!callBookingEnabled()) return CALL_BOOKING_DISABLED;
  if (!isAdminProof(proof)) return CALLS_INVALID;
  const parent = await forAParent(request.parentUserId, deps);
  if (!parent.ok) return parent;
  return bookSlotForParent({ ...request, actor: { kind: "admin", proof } }, deps);
}

/** Cancel a family's booked call on her behalf. */
export async function cancelBookingOnBehalf(
  proof: AdminProof,
  request: Omit<CancelRequest, "actor">,
  deps: CallsDeps = defaultCallsDeps(),
): Promise<CallsResult<CancelledBooking>> {
  if (!callBookingEnabled()) return CALL_BOOKING_DISABLED;
  if (!isAdminProof(proof)) return CALLS_INVALID;
  const parent = await forAParent(request.parentUserId, deps);
  if (!parent.ok) return parent;
  return cancelBooking({ ...request, actor: { kind: "admin", proof } }, deps);
}

/** The on-behalf picker's tap: hold this time for her first call, as the admin (her latest position, server-side). */
export async function holdSlotOnBehalf(
  proof: AdminProof,
  request: { readonly parentUserId: string; readonly startsAt: string },
  deps: CallsDeps = defaultCallsDeps(),
): Promise<CallsResult<HeldTime>> {
  if (!callBookingEnabled()) return CALL_BOOKING_DISABLED;
  if (!isAdminProof(proof)) return CALLS_INVALID;
  const parent = await forAParent(request.parentUserId, deps);
  if (!parent.ok) return parent;
  return holdSlotForParent({ parentUserId: request.parentUserId, startsAt: request.startsAt, purpose: "first_call", actor: { kind: "admin", proof } }, deps);
}

/** "Book this time" / "Move to this time": confirm the admin's hold for her; she gets the usual email. */
export async function confirmHoldOnBehalf(
  proof: AdminProof,
  request: { readonly parentUserId: string; readonly holdId: string; readonly idempotencyKey: string },
  deps: CallsDeps = defaultCallsDeps(),
): Promise<CallsResult<ConfirmedBooking>> {
  if (!callBookingEnabled()) return CALL_BOOKING_DISABLED;
  if (!isAdminProof(proof)) return CALLS_INVALID;
  const parent = await forAParent(request.parentUserId, deps);
  if (!parent.ok) return parent;
  return confirmHoldForParent({ ...request, actor: { kind: "admin", proof } }, deps);
}

/** Her first call's picker grid (every date and slot in the window, free or greyed); her own live hold stays hers. */
export async function familySlotGrid(proof: AdminProof, parentUserId: string, deps: CallsDeps = defaultCallsDeps()): Promise<CallsResult<SlotGrid>> {
  if (!callBookingEnabled()) return CALL_BOOKING_DISABLED;
  if (!isAdminProof(proof)) return CALLS_INVALID;
  if (!uuid.safeParse(parentUserId).success) return CALLS_INVALID;
  return loadSlotGrid({ purpose: "first_call", parentUserId }, deps);
}

// ── The Calendar tab (04c-2) ──────────────────────────────────────────────────────────────────────────────────

/** The block list reads every block still to come, however far ahead (a holiday booked months out). */
const FAR_FUTURE = "9999-12-31T00:00:00.000Z";

/** The Calendar tab's settings: call length (15/20/30/45/60 only), notice, hold, caller number. Never `enabled_since`. */
export async function updateCallSettings(proof: AdminProof, update: unknown, deps: CallsDeps = defaultCallsDeps()): Promise<CallsResult<CallSettings>> {
  if (!callBookingEnabled()) return CALL_BOOKING_DISABLED;
  if (!isAdminProof(proof)) return CALLS_INVALID;
  const parsed = parseSettingsUpdate(update);
  if (!parsed.ok) return parsed;
  return deps.repo.updateSettings(parsed.value, actingAdmin(proof));
}

/** A block from the form's London date and time strings (read here, by the server's clock); a booking under it stays. */
export async function addCallBlock(proof: AdminProof, form: unknown, deps: CallsDeps = defaultCallsDeps()): Promise<CallsResult<CallBlock>> {
  if (!callBookingEnabled()) return CALL_BOOKING_DISABLED;
  if (!isAdminProof(proof)) return CALLS_INVALID;
  const block = parseBlockForm(form, deps.now());
  if (!block.ok) return block;
  return deps.repo.insertBlock(block.value, actingAdmin(proof));
}

/** Remove a block (LDN1 never built removal, brief §3 admin 5); its times are offered again. */
export async function removeCallBlock(proof: AdminProof, blockId: string, deps: CallsDeps = defaultCallsDeps()): Promise<CallsResult<CallBlock>> {
  if (!callBookingEnabled()) return CALL_BOOKING_DISABLED;
  if (!isAdminProof(proof)) return CALLS_INVALID;
  if (!uuid.safeParse(blockId).success) return CALLS_INVALID;
  return deps.repo.deleteBlock(blockId, actingAdmin(proof));
}

/** The booked families' names; none read when nobody is booked. */
async function bookedNames(parentUserIds: readonly string[], deps: CallsDeps): Promise<CallsResult<ReadonlyMap<string, string>>> {
  const ids = [...new Set(parentUserIds)];
  const contacts: CallsResult<readonly ParentContact[]> = ids.length === 0 ? { ok: true, value: [] } : await deps.repo.readContacts(ids);
  if (!contacts.ok) return contacts;
  return { ok: true, value: new Map(contacts.value.map((c) => [c.userId, contactWords(c).name])) };
}

/**
 * The Calendar tab in one read: the settings, the hours, the blocks from the grid's first day on, the held and booked
 * rows over the grid's seven London days, and the booked families' names. Fails closed: any read failing → `error`.
 */
export async function calendarWeek(proof: AdminProof, deps: CallsDeps = defaultCallsDeps()): Promise<CallsResult<CalendarView>> {
  if (!callBookingEnabled()) return CALL_BOOKING_DISABLED;
  if (!isAdminProof(proof)) return CALLS_INVALID;
  const now = deps.now();
  const today = londonToday(now);
  const grid: TimeSpan = { startsAt: localToUTC(today, 0, 0), endsAt: localToUTC(addLondonDays(today, GRID_DAYS), 0, 0) };
  const [settings, hours, blocks, bookings] = await Promise.all([
    deps.repo.readSettings(),
    deps.repo.readWeeklyHours(),
    deps.repo.readBlocks({ startsAt: grid.startsAt, endsAt: FAR_FUTURE }),
    deps.repo.readOccupyingBookings(grid),
  ]);
  if (!settings.ok) return settings;
  if (!hours.ok) return hours;
  if (!blocks.ok) return blocks;
  if (!bookings.ok) return bookings;
  const names = await bookedNames(bookings.value.filter((b) => b.status === "booked").map((b) => b.parentUserId), deps);
  if (!names.ok) return names;
  return {
    ok: true,
    value: calendarViewOf({ settings: settings.value, hours: hours.value, blocks: blocks.value, bookings: bookings.value, names: names.value, now }),
  };
}

/**
 * What /admin/calls' actions answer when they refuse: closed codes only, never detail (brief §9.15). The gate adds
 * `not_authorized`; the rest are the call operations' own, with an overlap read as taken.
 */
export type AdminCallError =
  | "call_booking_disabled"
  | "not_authorized"
  | "invalid"
  | "taken"
  | "too_soon"
  | "hold_expired"
  | "not_yours"
  | "not_found"
  | "rate_limited"
  | "booked_call_exists"
  | "error";

export type AdminCallResult<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: AdminCallError };

/** Typed as a full `Record` over `CallError`, so a new code fails to compile until it is mapped here. */
const ADMIN_REFUSAL: Readonly<Record<CallError, AdminCallError>> = Object.freeze({
  taken: "taken",
  overlap: "taken",
  too_soon: "too_soon",
  hold_expired: "hold_expired",
  not_yours: "not_yours",
  not_found: "not_found",
  rate_limited: "rate_limited",
  invalid: "invalid",
  booked_call_exists: "booked_call_exists",
  call_booking_disabled: "call_booking_disabled",
  error: "error",
});

export function adminRefusalOf(error: CallError): AdminCallError {
  return ADMIN_REFUSAL[error];
}

/** The Calendar tab's refusals: the Calls tab's, plus overlapping hours, which keep their own words. */
export type CalendarCallError = AdminCallError | "overlap";

export type CalendarCallResult<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: CalendarCallError };

/** Overlapping hours stay `overlap` ("Those hours overlap — change one range"); the rest as `adminRefusalOf`. */
export function calendarRefusalOf(error: CallError): CalendarCallError {
  return error === "overlap" ? "overlap" : adminRefusalOf(error);
}
