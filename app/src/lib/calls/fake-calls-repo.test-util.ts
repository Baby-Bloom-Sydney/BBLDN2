/**
 * Test-only in-memory `CallsRepo` for booking.ts, to-call.ts, counts.ts and who-next.ts (BB-wave1-041126/04a-core).
 *
 * Reads filter the seeded rows the way the real queries do (overlap, start-in-range, status, purpose, parent ids,
 * the to-call scope). Writers record their input and answer from `results` (or a plain success). Every method
 * call is recorded in `calls`, so a test can prove "zero repo calls" with the switch off.
 * The SQL itself (locks, overlap, ownership) is proven against Postgres by the amendment 19 harness.
 */
import type { CallsRepo } from "./repo";
import { CALL_SETTINGS_DEFAULTS } from "./settings";
import type {
  CallBlock,
  CallBooking,
  CallLogEntry,
  CallSettings,
  CallsResult,
  ParentContact,
  ScopeParent,
  TimeSpan,
  WeeklyHoursRange,
} from "./types";

type Method = keyof CallsRepo;
type Results = { [K in Method]?: Awaited<ReturnType<CallsRepo[K]>> };

export interface FakeCallsState {
  settings: CallSettings;
  hours: readonly WeeklyHoursRange[];
  blocks: readonly CallBlock[];
  bookings: readonly CallBooking[];
  entries: readonly CallLogEntry[];
  scope: readonly ScopeParent[];
  contacts: readonly ParentContact[];
  latestPositionId: string | null;
  results: Results;
  failing: readonly Method[];
}

export interface FakeCallsRepo {
  repo: CallsRepo;
  calls: Array<{ method: Method; args: unknown[] }>;
  state: FakeCallsState;
}

export const EVERY_DAY_9_TO_7: readonly WeeklyHoursRange[] = ([1, 2, 3, 4, 5, 6, 7] as const).map((weekday) => ({
  weekday,
  startMinute: 540,
  endMinute: 1140,
}));

let bookingCounter = 0;

/** A booking row with sensible defaults (booked first call by the parent). */
export function bookingRow(over: Partial<CallBooking> & Pick<CallBooking, "parentUserId" | "startsAt">): CallBooking {
  bookingCounter += 1;
  const endsAt = over.endsAt ?? new Date(Date.parse(over.startsAt) + 30 * 60 * 1000).toISOString();
  return {
    id: `c0400000-0000-4000-8000-${String(bookingCounter).padStart(12, "0")}`,
    positionId: null,
    status: "booked",
    purpose: "first_call",
    bookedByKind: "parent",
    holdExpiresAt: null,
    bookedAt: over.startsAt,
    movedAt: null,
    movedFromStartsAt: null,
    cancelledAt: null,
    cancelReason: null,
    closedAt: null,
    createdAt: over.createdAt ?? over.startsAt,
    ...over,
    endsAt,
  };
}

let entryCounter = 0;

export function entryRow(over: Partial<CallLogEntry> & Pick<CallLogEntry, "parentUserId" | "occurredAt">): CallLogEntry {
  entryCounter += 1;
  return {
    id: `e0400000-0000-4000-8000-${String(entryCounter).padStart(12, "0")}`,
    bookingId: null,
    recordedBy: null,
    method: "phone",
    source: "manual",
    result: "no_answer",
    outcome: null,
    note: null,
    callBackAt: null,
    justcallCallId: null,
    ...over,
  };
}

const overlaps = (a: TimeSpan, b: TimeSpan) => a.startsAt < b.endsAt && b.startsAt < a.endsAt;
const INVITES = new Set(["nanny_invite", "parent_invite"]);

function reads(state: FakeCallsState): Omit<CallsRepo, "holdSlot" | "confirmHold" | "bookSlot" | "cancelBooking" | "recordOutcome" | "replaceWeeklyHours" | "startCallBooking"> {
  const ok = <T>(value: T): CallsResult<T> => ({ ok: true, value });
  return {
    readSettings: async () => ok(state.settings),
    readWeeklyHours: async () => ok(state.hours),
    readBlocks: async (span) => ok(state.blocks.filter((b) => overlaps(b, span))),
    readOccupyingBookings: async (span) =>
      ok(state.bookings.filter((b) => (b.status === "held" || b.status === "booked") && overlaps(b, span))),
    readBookingsStartingIn: async (span, filter) =>
      ok(
        state.bookings.filter(
          (b) =>
            filter.statuses.includes(b.status) &&
            b.startsAt >= span.startsAt &&
            b.startsAt < span.endsAt &&
            (filter.purpose === undefined || b.purpose === filter.purpose),
        ),
      ),
    readBookedCalls: async () =>
      ok([...state.bookings.filter((b) => b.status === "booked")].sort((a, b) => a.startsAt.localeCompare(b.startsAt))),
    readBookingsForParents: async (ids) => ok(state.bookings.filter((b) => ids.includes(b.parentUserId))),
    readLogEntriesForParents: async (ids) =>
      ok([...state.entries.filter((e) => ids.includes(e.parentUserId))].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))),
    readRecentLogEntries: async (limit) =>
      ok([...state.entries].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt)).slice(0, limit)),
    readScopeParents: async (enabledSince) =>
      ok(state.scope.filter((p) => (p.signupSource === null || !INVITES.has(p.signupSource)) && p.signedUpAt >= enabledSince)),
    readContacts: async (ids) => ok(state.contacts.filter((c) => ids.includes(c.userId))),
    readLatestPositionId: async () => ok(state.latestPositionId),
  };
}

function writers(state: FakeCallsState): Pick<CallsRepo, "holdSlot" | "confirmHold" | "bookSlot" | "cancelBooking" | "recordOutcome" | "replaceWeeklyHours" | "startCallBooking"> {
  return {
    holdSlot: async () => state.results.holdSlot ?? { ok: true, value: { bookingId: "hold-1", holdExpiresAt: "2027-02-04T10:05:00.000Z" } },
    confirmHold: async () =>
      state.results.confirmHold ?? { ok: true, value: { kind: "booked", bookingId: "hold-1", startsAt: "2027-02-09T14:00:00.000Z", replay: false } },
    bookSlot: async (input) =>
      state.results.bookSlot ?? { ok: true, value: { kind: "booked", bookingId: "booking-1", startsAt: input.startsAt, replay: false } },
    cancelBooking: async (input) =>
      state.results.cancelBooking ?? { ok: true, value: { bookingId: input.bookingId, startsAt: "2027-02-09T14:00:00.000Z" } },
    recordOutcome: async () => state.results.recordOutcome ?? { ok: true, value: { entryId: "entry-1", replay: false } },
    replaceWeeklyHours: async () => state.results.replaceWeeklyHours ?? { ok: true, value: true },
    startCallBooking: async () =>
      state.results.startCallBooking ?? { ok: true, value: { enabledSince: "2027-02-01T09:00:00.000Z", startedNow: true } },
  };
}

export function fakeCallsRepo(seed: Partial<FakeCallsState> = {}): FakeCallsRepo {
  const state: FakeCallsState = {
    settings: CALL_SETTINGS_DEFAULTS,
    hours: EVERY_DAY_9_TO_7,
    blocks: [],
    bookings: [],
    entries: [],
    scope: [],
    contacts: [],
    latestPositionId: null,
    results: {},
    failing: [],
    ...seed,
  };
  const calls: FakeCallsRepo["calls"] = [];
  const impl: CallsRepo = { ...reads(state), ...writers(state) };
  const repo = new Proxy(impl, {
    get(target, prop: string | symbol) {
      const method = prop as Method;
      const fn = target[method];
      if (typeof fn !== "function") return fn;
      return (...args: unknown[]) => {
        calls.push({ method, args });
        if (state.failing.includes(method)) return Promise.resolve({ ok: false, error: "error" });
        return (fn as (...a: unknown[]) => unknown)(...args);
      };
    },
  });
  return { repo, calls, state };
}

export const callsTo = (fake: FakeCallsRepo, method: Method) => fake.calls.filter((c) => c.method === method);
