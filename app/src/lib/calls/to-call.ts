/**
 * The to-call list: "Not booked — to call" (plan A8 + §12 R2, R10, R13; brief §3 "who appears").
 *
 * In scope: every parent sign-up not from an invite (a NULL source counts, plan D7), signed up at or after
 * `enabled_since` (Start call booking; until it's pressed no one is in scope, R11). From the scope, a family is
 * listed unless:
 *   - she has a booked call (either purpose; she's counted under booked instead), or
 *   - her latest attempt took her out — Deposit taken, Not going ahead, Pre-booked next cohort, Stop calling (R13)
 *     — and nothing has brought her back since: a pending pre-book request from brief 03, or a booking made after
 *     that attempt (R10). A hold that never confirmed is not a booking (R2).
 * Test users are listed (tagged); the counts leave them out.
 *
 * Order: when she's due — her call-back time if her latest attempt set one, else her sign-up — oldest first.
 *
 * BB-wave1-041126/04a-core, 2026-11-04.
 */

import { callBookingEnabled } from "@/lib/features/flags";
import { CALL_BOOKING_DISABLED, defaultCallsDeps, type CallsDeps } from "./deps";
import { removesFromList } from "./outcomes";
import type { PrebookRequest } from "./prebook-requests";
import { everBooked } from "./status";
import type { CallBooking, CallLogEntry, CallResultCode, CallsResult, ParentContact, ScopeParent } from "./types";

export interface ToCallFamily {
  readonly parentUserId: string;
  /** Null only if her profile row is missing. */
  readonly contact: ParentContact | null;
  readonly signupSource: string | null;
  readonly signedUpAt: string;
  readonly lastAttemptAt: string | null;
  readonly lastResult: CallResultCode | null;
  readonly callBackAt: string | null;
  readonly dueAt: string;
  /** Brief 03's pending pre-book request: tag "Cohort pre-book" (brief §3 admin 6). */
  readonly prebookRequest: PrebookRequest | null;
}

export interface FamilyFacts {
  readonly bookings: readonly CallBooking[];
  readonly entries: readonly CallLogEntry[];
  readonly contacts: readonly ParentContact[];
  readonly prebookRequests: ReadonlyMap<string, PrebookRequest>;
}

const ok = <T>(value: T): CallsResult<T> => ({ ok: true, value });

export function latestEntryOf(entries: readonly CallLogEntry[]): CallLogEntry | null {
  return entries.reduce<CallLogEntry | null>((latest, e) => (latest === null || e.occurredAt > latest.occurredAt ? e : latest), null);
}

/**
 * When she last booked or moved a real booking; null if she never has. A hold that never confirmed has neither
 * time (R2: it isn't a booking), and only a booked row can be moved.
 */
function latestBookedAt(bookings: readonly CallBooking[]): string | null {
  return bookings
    .filter(everBooked)
    .flatMap((b) => [b.bookedAt, b.movedAt])
    .filter((at): at is string => at !== null)
    .reduce<string | null>((latest, at) => (latest === null || at > latest ? at : latest), null);
}

export const hasBookedCall = (bookings: readonly CallBooking[]): boolean => bookings.some((b) => b.status === "booked");

/** Did her latest attempt take her out of the list, with nothing since to bring her back (R10, R13)? */
export function isTakenOut(facts: {
  readonly bookings: readonly CallBooking[];
  readonly entries: readonly CallLogEntry[];
  readonly prebookRequest: PrebookRequest | null;
}): boolean {
  const last = latestEntryOf(facts.entries);
  if (last === null || !removesFromList(last.outcome)) return false;
  if (facts.prebookRequest !== null) return false;
  const bookedAt = latestBookedAt(facts.bookings);
  return bookedAt === null || bookedAt <= last.occurredAt;
}

const byParent = <T extends { readonly parentUserId: string }>(rows: readonly T[], parentUserId: string): readonly T[] =>
  rows.filter((r) => r.parentUserId === parentUserId);

/** The one "taken out" rule for a family, used by the to-call list, the counts and who's next (review M2). */
export function familyTakenOut(facts: FamilyFacts, parentUserId: string): boolean {
  return isTakenOut({
    bookings: byParent(facts.bookings, parentUserId),
    entries: byParent(facts.entries, parentUserId),
    prebookRequest: facts.prebookRequests.get(parentUserId) ?? null,
  });
}

/** Pure: the scope and her facts → the families to call, in order. */
export function selectToCall(scope: readonly ScopeParent[], facts: FamilyFacts): readonly ToCallFamily[] {
  const families = scope.flatMap((p): ToCallFamily[] => {
    if (hasBookedCall(byParent(facts.bookings, p.userId)) || familyTakenOut(facts, p.userId)) return [];
    const entries = byParent(facts.entries, p.userId);
    const prebookRequest = facts.prebookRequests.get(p.userId) ?? null;
    const last = latestEntryOf(entries);
    const callBackAt = last?.callBackAt ?? null;
    return [
      {
        parentUserId: p.userId,
        contact: facts.contacts.find((c) => c.userId === p.userId) ?? null,
        signupSource: p.signupSource,
        signedUpAt: p.signedUpAt,
        lastAttemptAt: last?.occurredAt ?? null,
        lastResult: last?.result ?? null,
        callBackAt,
        dueAt: callBackAt !== null && callBackAt > p.signedUpAt ? callBackAt : p.signedUpAt,
        prebookRequest,
      },
    ];
  });
  return Object.freeze([...families].sort((a, b) => a.dueAt.localeCompare(b.dueAt) || a.signedUpAt.localeCompare(b.signedUpAt)));
}

async function prebookRequestsFor(ids: readonly string[], deps: CallsDeps): Promise<CallsResult<ReadonlyMap<string, PrebookRequest>>> {
  try {
    return ok(await deps.prebookRequests(ids));
  } catch (thrown) {
    console.error("[calls/to-call] pre-book requests failed", { message: thrown instanceof Error ? thrown.message : String(thrown) });
    return { ok: false, error: "error" };
  }
}

/** Bookings, attempts, contacts and pending pre-book requests for these families. */
export async function loadFamilyFacts(ids: readonly string[], deps: CallsDeps): Promise<CallsResult<FamilyFacts>> {
  const [bookings, entries, contacts, prebookRequests] = await Promise.all([
    deps.repo.readBookingsForParents(ids),
    deps.repo.readLogEntriesForParents(ids),
    deps.repo.readContacts(ids),
    prebookRequestsFor(ids, deps),
  ]);
  if (!bookings.ok) return bookings;
  if (!entries.ok) return entries;
  if (!contacts.ok) return contacts;
  if (!prebookRequests.ok) return prebookRequests;
  return ok({ bookings: bookings.value, entries: entries.value, contacts: contacts.value, prebookRequests: prebookRequests.value });
}

/** Booked calls whose family hasn't been taken out since — the booked calls still to make — and their facts. */
export async function bookedCallsToMake(
  bookings: readonly CallBooking[],
  deps: CallsDeps,
): Promise<CallsResult<{ readonly calls: readonly CallBooking[]; readonly facts: FamilyFacts }>> {
  const facts = await loadFamilyFacts([...new Set(bookings.map((b) => b.parentUserId))], deps);
  if (!facts.ok) return facts;
  return ok({ calls: bookings.filter((b) => !familyTakenOut(facts.value, b.parentUserId)), facts: facts.value });
}

/** The list, given `enabled_since` (already read). Internal: callers have checked the switch. */
export async function loadToCall(deps: CallsDeps, enabledSince: string | null): Promise<CallsResult<readonly ToCallFamily[]>> {
  if (enabledSince === null) return ok([]);
  const scope = await deps.repo.readScopeParents(enabledSince);
  if (!scope.ok) return scope;
  const facts = await loadFamilyFacts(scope.value.map((p) => p.userId), deps);
  return facts.ok ? ok(selectToCall(scope.value, facts.value)) : facts;
}

/** "Not booked — to call", for 04c's dashboard. */
export async function getToCallList(deps: CallsDeps = defaultCallsDeps()): Promise<CallsResult<readonly ToCallFamily[]>> {
  if (!callBookingEnabled()) return CALL_BOOKING_DISABLED;
  const settings = await deps.repo.readSettings();
  if (!settings.ok) return settings;
  return loadToCall(deps, settings.value.enabledSince);
}
