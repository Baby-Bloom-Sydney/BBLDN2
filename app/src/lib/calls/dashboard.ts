/**
 * The /admin/calls Calls tab, as one read (plan C3, §13; brief §0.8, §0.9, §0.13, §3 admin 1, 6).
 *
 *   the counts line   02's contract for this London week (`getCallsToMake`), test families left out
 *   the cohort line   02's current cohort, when Cohorts is on (`readCurrentCohortLine`)
 *   the banner        red with no free time in the window, amber below `LOW_FREE_SLOTS`
 *   Overdue           booked calls `overdue_grace_minutes` past their start — computed now, never by a sweep
 *   Today and upcoming  every other booked call, by time
 *   Not booked        the to-call list, oldest sign-up (or call-back) first
 *   History           the last 50 outcomes
 *
 * The sections are 04a's who's-next order (`getWhoIsNext`), so the dashboard, the counts and 05's "Call next" can
 * never disagree about who is still to call. Row data comes in one batch (`dashboard-reads.ts`); the words are
 * `dashboard-row.ts`. Server-only, not `"use server"`: the page passes the admin proof it made.
 *
 * Fails closed where a missing fact would mislead: the call list, the row data or the blocks (a "Blocked over" tag
 * must not silently vanish) → `error`. The counts, the banner and History are each optional: one that can't be read
 * is null (the page says so, or shows no banner), and the rest still stand.
 *
 * BB-wave1-041126/04c1-build, 2026-11-05.
 */

import { callBookingEnabled } from "@/lib/features/flags";
import { londonWeekRange } from "@/lib/timezone";
import { isAdminProof, type AdminProof } from "./admin-proof";
import { getFreeSlots } from "./booking";
import { readCurrentCohortLine, type CohortLine } from "./cohort-line";
import { ADMIN_COPY, callsToMakeLine, cohortPlacesLine, fewFreeTimesLine, noFreeTimesLine } from "./copy";
import { getCallsToMake, type CallsToMake } from "./counts";
import { createDashboardReads, type DashboardReads, type FamilyDetails } from "./dashboard-reads";
import {
  attemptWords,
  contactWords,
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
import { CALL_BOOKING_DISABLED, CALLS_INVALID, defaultCallsDeps, type CallsDeps } from "./deps";
import type { CallBlock, CallLogEntry, CallsResult, ParentContact, TimeSpan } from "./types";
import { getWhoIsNext, type WhoIsNextRow } from "./who-next";

/** Below this many free call times in the window, the banner turns amber. A placeholder: OPEN §5a.4 leaves it TBD. */
export const LOW_FREE_SLOTS = 5;
export const HISTORY_LIMIT = 50;

export type CallSectionKey = "upcoming" | "overdue" | "not_booked";

export interface CallRowView {
  readonly key: string;
  readonly section: CallSectionKey;
  readonly parentUserId: string;
  readonly bookingId: string | null;
  readonly startsAt: string | null;
  /** "Tue 9 Feb, 14:00 (London time)"; null when not booked. */
  readonly when: string | null;
  readonly signedUp: string | null;
  readonly lastTried: string | null;
  readonly callBack: string | null;
  readonly contact: ContactWords;
  readonly signupType: string;
  /** Null: no position yet (a quick-match sign-up). */
  readonly position: PositionSummary | null;
  readonly links: RowLinks;
  readonly tags: readonly CallTag[];
}

export interface HistoryRowView {
  readonly key: string;
  readonly parentUserId: string;
  readonly when: string;
  readonly name: string;
  readonly what: string;
  readonly note: string | null;
  readonly by: string | null;
  readonly tags: readonly CallTag[];
}

export interface FreeTimeBanner {
  readonly tone: "red" | "amber";
  readonly line: string;
}

export interface CallsDashboard {
  /** Null: the counts couldn't be read. */
  readonly counts: string | null;
  readonly cohort: string | null;
  readonly banner: FreeTimeBanner | null;
  readonly overdue: readonly CallRowView[];
  readonly upcoming: readonly CallRowView[];
  readonly notBooked: readonly CallRowView[];
  /** Null: History couldn't be read. */
  readonly history: readonly HistoryRowView[] | null;
}

export interface DashboardDeps extends CallsDeps {
  readonly reads: DashboardReads;
  readonly cohortLine: (now: Date) => Promise<CohortLine | null>;
}

export function defaultDashboardDeps(): DashboardDeps {
  return { ...defaultCallsDeps(), reads: createDashboardReads(), cohortLine: readCurrentCohortLine };
}

const ok = <T>(value: T): CallsResult<T> => ({ ok: true, value });
const unique = (ids: readonly string[]): readonly string[] => [...new Set(ids)];
const overlaps = (a: TimeSpan, b: TimeSpan): boolean => a.startsAt < b.endsAt && b.startsAt < a.endsAt;
const labelled = (prefix: string, at: string | null): string | null => (at === null ? null : `${prefix} ${londonLabel(at)}`);

/** Red at none, amber below `LOW_FREE_SLOTS`; nothing when the free times couldn't be read (never a false red). */
export function freeTimeBanner(freeCount: number | null, windowDays: number | null): FreeTimeBanner | null {
  if (freeCount === null || windowDays === null) return null;
  if (freeCount === 0) return { tone: "red", line: noFreeTimesLine(windowDays) };
  return freeCount < LOW_FREE_SLOTS ? { tone: "amber", line: fewFreeTimesLine(windowDays) } : null;
}

interface RowFacts {
  readonly blocks: readonly CallBlock[];
  readonly details: FamilyDetails;
}

function sectionOf(row: WhoIsNextRow): CallSectionKey {
  if (row.group === "overdue") return "overdue";
  return row.group === "not_booked" ? "not_booked" : "upcoming";
}

function rowView(row: WhoIsNextRow, facts: RowFacts): CallRowView {
  const section = sectionOf(row);
  const family = facts.details.families.get(row.parentUserId);
  const position = positionSummaryOf(facts.details.positions.get(row.parentUserId) ?? null);
  const booking = row.booking;
  const tags = tagsOf({
    blockedOver: booking !== null && facts.blocks.some((b) => overlaps(b, booking)),
    overdue: section === "overdue",
    cohortPrebook: booking?.purpose === "cohort_prebook" || row.prebookRequest !== null,
    test: row.contact?.isTestUser === true,
  });
  return {
    key: booking?.id ?? row.parentUserId,
    section,
    parentUserId: row.parentUserId,
    bookingId: booking?.id ?? null,
    startsAt: booking?.startsAt ?? null,
    when: booking === null ? null : londonLabel(booking.startsAt),
    signedUp: labelled(ADMIN_COPY.signedUp, family?.signedUpAt ?? row.signedUpAt),
    lastTried: labelled(ADMIN_COPY.lastTried, row.lastAttemptAt),
    callBack: labelled(ADMIN_COPY.callBack, row.callBackAt),
    contact: contactWords(row.contact),
    signupType: signupTypeOf(family?.signupSource ?? null),
    position,
    links: rowLinks(row.parentUserId, position?.positionId ?? null),
    tags,
  };
}

type BookedRow = WhoIsNextRow & { readonly booking: NonNullable<WhoIsNextRow["booking"]> };

/** From the earliest start to the latest end of the booked calls on screen; null with none. */
function spanOfBooked(booked: readonly BookedRow[]): TimeSpan | null {
  if (booked.length === 0) return null;
  const starts = booked.map((r) => r.booking.startsAt);
  const ends = booked.map((r) => r.booking.endsAt);
  return { startsAt: starts.reduce((a, b) => (b < a ? b : a)), endsAt: ends.reduce((a, b) => (b > a ? b : a)) };
}

/** The blocks over any booked call on screen, and the row data for every family, in one batch each. */
async function rowFacts(rows: readonly WhoIsNextRow[], deps: DashboardDeps): Promise<CallsResult<RowFacts>> {
  const booked = rows.filter((r): r is BookedRow => r.booking !== null);
  const span = spanOfBooked(booked);
  // Her booking's own position is the one the row describes (her latest otherwise).
  const preferred = new Map(booked.flatMap((r) => (r.booking.positionId === null ? [] : [[r.parentUserId, r.booking.positionId] as const])));
  const [blocks, details] = await Promise.all([
    span === null ? Promise.resolve(ok<readonly CallBlock[]>([])) : deps.repo.readBlocks(span),
    deps.reads.readFamilyDetails(unique(rows.map((r) => r.parentUserId)), preferred),
  ]);
  if (!blocks.ok) return blocks;
  if (!details.ok) return details;
  return ok({ blocks: blocks.value, details: details.value });
}

function historyRow(entry: CallLogEntry, contacts: readonly ParentContact[]): HistoryRowView {
  const family = contacts.find((c) => c.userId === entry.parentUserId) ?? null;
  const recorder = entry.recordedBy === null ? null : contacts.find((c) => c.userId === entry.recordedBy) ?? null;
  return {
    key: entry.id,
    parentUserId: entry.parentUserId,
    when: londonLabel(entry.occurredAt),
    name: contactWords(family).name,
    what: attemptWords(entry),
    note: entry.note,
    by: recorder === null ? null : contactWords(recorder).name,
    tags: tagsOf({ blockedOver: false, overdue: false, cohortPrebook: false, test: family?.isTestUser === true }),
  };
}

/** The last outcomes with the family's and the recorder's names; null if they can't be read. */
async function historyRows(deps: DashboardDeps): Promise<readonly HistoryRowView[] | null> {
  const recent = await deps.repo.readRecentLogEntries(HISTORY_LIMIT);
  if (!recent.ok) return null;
  const ids = unique(recent.value.flatMap((e) => (e.recordedBy === null ? [e.parentUserId] : [e.parentUserId, e.recordedBy])));
  const contacts = ids.length === 0 ? ok<readonly ParentContact[]>([]) : await deps.repo.readContacts(ids);
  if (!contacts.ok) return null;
  return recent.value.map((e) => historyRow(e, contacts.value));
}

async function freeCount(deps: DashboardDeps): Promise<{ readonly count: number | null; readonly windowDays: number | null }> {
  const [free, settings] = await Promise.all([getFreeSlots({}, deps), deps.repo.readSettings()]);
  return { count: free.ok ? free.value.length : null, windowDays: settings.ok ? settings.value.windowDays : null };
}

function assemble(input: {
  readonly rows: readonly WhoIsNextRow[];
  readonly facts: RowFacts;
  readonly counts: CallsToMake | null;
  readonly free: { readonly count: number | null; readonly windowDays: number | null };
  readonly history: readonly HistoryRowView[] | null;
  readonly cohort: CohortLine | null;
}): CallsDashboard {
  const views = input.rows.map((r) => rowView(r, input.facts));
  const of = (section: CallSectionKey) => Object.freeze(views.filter((v) => v.section === section));
  return Object.freeze({
    counts: input.counts === null ? null : callsToMakeLine(input.counts),
    cohort: input.cohort === null ? null : cohortPlacesLine(input.cohort),
    banner: freeTimeBanner(input.free.count, input.free.windowDays),
    overdue: of("overdue"),
    upcoming: of("upcoming"),
    notBooked: of("not_booked"),
    history: input.history,
  });
}

/** The whole Calls tab. Admin only: the proof first, after the switch. */
export async function loadCallsDashboard(proof: AdminProof, deps: DashboardDeps = defaultDashboardDeps()): Promise<CallsResult<CallsDashboard>> {
  if (!callBookingEnabled()) return CALL_BOOKING_DISABLED;
  if (!isAdminProof(proof)) return CALLS_INVALID;
  const now = deps.now();
  const [who, counts, free, history, cohort] = await Promise.all([
    getWhoIsNext(proof, deps),
    getCallsToMake(londonWeekRange(now), deps),
    freeCount(deps),
    historyRows(deps),
    deps.cohortLine(now),
  ]);
  if (!who.ok) return who;
  const facts = await rowFacts(who.value, deps);
  if (!facts.ok) return facts;
  return ok(assemble({ rows: who.value, facts: facts.value, counts, free, history, cohort }));
}
