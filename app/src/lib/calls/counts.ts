/**
 * The call counts (plan A8, §7; brief §0.8, §8 contracts 1–2, §9.8).
 *
 * - `getCallsToMake(range)` — 02's "12 more families to call this week (8 booked · 4 not booked)":
 *   `booked` = booked calls starting in the range (overdue included: still to make); `notBooked` = the to-call
 *   list. Test users and taken-out families (Stop calling …) are left out of both.
 * - `getPrebookedCallCount(londonDate)` — cohort pre-book calls, booked or done, on that London date (04's own
 *   tag; 02's "N pre-booked calls" counts 03's records and is 03's to wire, plan §12 R1).
 *
 * Both answer null while the switch is off — and when the numbers can't be read (the repository logs why), so a
 * caller never shows a wrong number.
 *
 * BB-wave1-041126/04a-core, 2026-11-04.
 */

import { z } from "zod";
import { callBookingEnabled } from "@/lib/features/flags";
import { addLondonDays, localToUTC, type UtcRange } from "@/lib/timezone";
import { defaultCallsDeps, type CallsDeps } from "./deps";
import { isTakenOut, loadFamilyFacts, loadToCall } from "./to-call";
import type { CallBooking, CallsResult, ParentContact, TimeSpan } from "./types";
import { isoInstantInput, londonDate } from "./zod-parts";

export interface CallsToMake {
  readonly booked: number;
  readonly notBooked: number;
}

const rangeSchema = z
  .strictObject({ fromUtc: isoInstantInput, toUtc: isoInstantInput })
  .refine((r) => r.fromUtc < r.toUtc)
  .transform((r): TimeSpan => ({ startsAt: r.fromUtc, endsAt: r.toUtc }));

const ok = <T>(value: T): CallsResult<T> => ({ ok: true, value });
const unique = (ids: readonly string[]): readonly string[] => [...new Set(ids)];
const isTest = (contacts: readonly ParentContact[], userId: string): boolean =>
  contacts.find((c) => c.userId === userId)?.isTestUser === true;

async function bookedToMake(span: TimeSpan, deps: CallsDeps): Promise<CallsResult<number>> {
  const bookings = await deps.repo.readBookingsStartingIn(span, { statuses: ["booked"] });
  if (!bookings.ok) return bookings;
  const facts = await loadFamilyFacts(unique(bookings.value.map((b) => b.parentUserId)), deps);
  if (!facts.ok) return facts;
  const counted = bookings.value.filter(
    (b) =>
      !isTest(facts.value.contacts, b.parentUserId) &&
      !isTakenOut({
        bookings: facts.value.bookings.filter((x) => x.parentUserId === b.parentUserId),
        entries: facts.value.entries.filter((e) => e.parentUserId === b.parentUserId),
        prebookRequest: facts.value.prebookRequests.get(b.parentUserId) ?? null,
      }),
  );
  return ok(counted.length);
}

async function countCallsToMake(span: TimeSpan, deps: CallsDeps): Promise<CallsResult<CallsToMake>> {
  const settings = await deps.repo.readSettings();
  if (!settings.ok) return settings;
  const [booked, toCall] = await Promise.all([bookedToMake(span, deps), loadToCall(deps, settings.value.enabledSince)]);
  if (!booked.ok) return booked;
  if (!toCall.ok) return toCall;
  return ok({ booked: booked.value, notBooked: toCall.value.filter((f) => f.contact?.isTestUser !== true).length });
}

/** Calls still to make in a half-open UTC range (02 passes `londonWeekRange(now)`). Null while off. */
export async function getCallsToMake(range: UtcRange, deps: CallsDeps = defaultCallsDeps()): Promise<CallsToMake | null> {
  if (!callBookingEnabled()) return null;
  const span = rangeSchema.safeParse(range);
  if (!span.success) return null;
  const counted = await countCallsToMake(span.data, deps);
  return counted.ok ? counted.value : null;
}

async function countPrebooked(day: TimeSpan, deps: CallsDeps): Promise<CallsResult<number>> {
  const bookings = await deps.repo.readBookingsStartingIn(day, { statuses: ["booked", "done"], purpose: "cohort_prebook" });
  if (!bookings.ok) return bookings;
  const contacts = await deps.repo.readContacts(unique(bookings.value.map((b: CallBooking) => b.parentUserId)));
  if (!contacts.ok) return contacts;
  return ok(bookings.value.filter((b) => !isTest(contacts.value, b.parentUserId)).length);
}

/** Cohort pre-book calls (booked or done) on one London date ("YYYY-MM-DD"). Null while off. */
export async function getPrebookedCallCount(date: string, deps: CallsDeps = defaultCallsDeps()): Promise<number | null> {
  if (!callBookingEnabled()) return null;
  const parsed = londonDate.safeParse(date);
  if (!parsed.success) return null;
  const day = { startsAt: localToUTC(parsed.data, 0, 0), endsAt: localToUTC(addLondonDays(parsed.data, 1), 0, 0) };
  const counted = await countPrebooked(day, deps);
  return counted.ok ? counted.value : null;
}
