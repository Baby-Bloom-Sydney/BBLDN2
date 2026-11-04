/**
 * The to-call list — "Not booked — to call" (plan A8 + §12 R10, R13; brief §3 "who appears").
 * Scope: a parent, not from an invite (NULL source included), signed up at or after enabled_since.
 * Out while she has a booked call. Out when her latest attempt took her out (Deposit taken / Not going ahead /
 * Pre-booked next cohort / Stop calling) — unless 03 has a pending pre-book request for her, or she has booked
 * since that attempt (R10). Oldest sign-up first; a call-back waits until its time (R13).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CallsDeps } from "./deps";
import { bookingRow, callsTo, entryRow, fakeCallsRepo, type FakeCallsState } from "./fake-calls-repo.test-util";
import { CALL_SETTINGS_DEFAULTS } from "./settings";
import { getToCallList } from "./to-call";
import type { ParentContact, ScopeParent } from "./types";

const ENABLED_SINCE = "2027-02-01T09:00:00.000Z";
const NOW = new Date("2027-02-04T10:00:00.000Z");
const id = (n: number) => `b0400000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const parent = (n: number, signedUpAt: string, signupSource: string | null = "direct"): ScopeParent => ({
  userId: id(n),
  signupSource,
  signedUpAt,
});
const contact = (n: number, isTestUser = false): ParentContact => ({
  userId: id(n),
  firstName: `Parent${n}`,
  lastName: "Smith",
  email: `parent${n}@example.com`,
  mobile: "+447700900123",
  isTestUser,
});

function setup(seed: Partial<FakeCallsState>, prebook: ReadonlyMap<string, { londonDate: string }> = new Map()) {
  const fake = fakeCallsRepo({ settings: { ...CALL_SETTINGS_DEFAULTS, enabledSince: ENABLED_SINCE }, ...seed });
  const deps: CallsDeps = { repo: fake.repo, now: () => NOW, notify: async () => {}, prebookRequests: async () => prebook };
  return { fake, deps };
}

const listed = async (deps: CallsDeps) => {
  const list = await getToCallList(deps);
  if (!list.ok) throw new Error(list.error);
  return list.value.map((f) => f.parentUserId);
};

beforeEach(() => {
  vi.stubEnv("CALL_BOOKING_ENABLED", "true");
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("who is in scope", () => {
  it("parents not from an invite (NULL included), signed up since switch-on, oldest first", async () => {
    const { deps } = setup({
      scope: [
        parent(1, "2027-02-02T10:00:00.000Z", null),
        parent(2, "2027-02-01T12:00:00.000Z", "standard_match"),
        parent(3, "2027-02-02T09:00:00.000Z", "nanny_invite"),
        parent(4, "2027-02-02T09:30:00.000Z", "parent_invite"),
        parent(5, "2027-01-31T10:00:00.000Z", "direct"),
        parent(6, ENABLED_SINCE, "advanced_match"),
      ],
    });
    expect(await listed(deps)).toEqual([id(6), id(2), id(1)]);
  });

  it("before Start call booking (enabled_since unset) no one is listed and nothing else is read", async () => {
    const { fake, deps } = setup({ settings: CALL_SETTINGS_DEFAULTS, scope: [parent(1, "2027-02-02T10:00:00.000Z")] });
    expect(await getToCallList(deps)).toEqual({ ok: true, value: [] });
    expect(callsTo(fake, "readScopeParents")).toEqual([]);
  });

  it("carries the contact facts, the Test tag and her sign-up time", async () => {
    const { deps } = setup({ scope: [parent(1, "2027-02-02T10:00:00.000Z")], contacts: [contact(1, true)] });
    const list = await getToCallList(deps);
    expect(list.ok && list.value[0]).toMatchObject({
      parentUserId: id(1),
      contact: { firstName: "Parent1", isTestUser: true },
      signedUpAt: "2027-02-02T10:00:00.000Z",
      lastAttemptAt: null,
      callBackAt: null,
      prebookRequest: null,
    });
  });
});

describe("what takes her out, and what keeps her in", () => {
  const SIGNED = "2027-02-02T10:00:00.000Z";
  const one = (seed: Partial<FakeCallsState>, prebook?: ReadonlyMap<string, { londonDate: string }>) =>
    setup({ scope: [parent(1, SIGNED)], ...seed }, prebook);

  it("a booked call takes her out", async () => {
    expect(await listed(one({ bookings: [bookingRow({ parentUserId: id(1), startsAt: "2027-02-09T14:00:00.000Z" })] }).deps)).toEqual([]);
  });

  it.each([
    ["a live hold only", { status: "held", bookedAt: null, holdExpiresAt: "2027-02-04T10:04:00.000Z" }],
    ["a cancelled booking", { status: "cancelled", cancelReason: "parent" }],
    ["a no-answer booking", { status: "no_answer", closedAt: "2027-02-03T10:05:00.000Z" }],
  ] as const)("%s keeps her in", async (_label, over) => {
    const deps = one({ bookings: [bookingRow({ parentUserId: id(1), startsAt: "2027-02-03T10:00:00.000Z", ...over })] }).deps;
    expect(await listed(deps)).toEqual([id(1)]);
  });

  it.each(["deposit_taken", "not_going_ahead", "prebooked_next_cohort", "stop_calling"] as const)("%s takes her out (R13)", async (outcome) => {
    const entry = entryRow({ parentUserId: id(1), occurredAt: "2027-02-03T10:05:00.000Z", result: outcome === "stop_calling" ? null : "answered", outcome });
    expect(await listed(one({ entries: [entry] }).deps)).toEqual([]);
  });

  it.each([
    ["Call back later", "answered", "call_back_later"],
    ["Link sent", "answered", "link_sent"],
    ["Other", "answered", "other"],
    ["Answered, outcome still needed", "answered", null],
    ["No answer", "no_answer", null],
    ["Voicemail left", "voicemail", null],
    ["Wrong number", "wrong_number", null],
  ] as const)("%s keeps her in (R13)", async (_label, result, outcome) => {
    const entry = entryRow({ parentUserId: id(1), occurredAt: "2027-02-03T10:05:00.000Z", result, outcome });
    expect(await listed(one({ entries: [entry] }).deps)).toEqual([id(1)]);
  });

  it("her latest attempt decides (a later No answer after Deposit taken keeps her in)", async () => {
    const entries = [
      entryRow({ parentUserId: id(1), occurredAt: "2027-02-03T10:05:00.000Z", result: "answered", outcome: "deposit_taken" }),
      entryRow({ parentUserId: id(1), occurredAt: "2027-02-03T15:00:00.000Z", result: "no_answer" }),
    ];
    expect(await listed(one({ entries }).deps)).toEqual([id(1)]);
  });

  it("R10: answered first call, then a full-day pre-book → back under Not booked, tagged with the date", async () => {
    const entries = [
      entryRow({ parentUserId: id(1), occurredAt: "2027-02-03T10:05:00.000Z", result: "answered", outcome: "prebooked_next_cohort" }),
    ];
    const { deps } = one({ entries }, new Map([[id(1), { londonDate: "2027-02-08" }]]));
    const list = await getToCallList(deps);
    expect(list.ok && list.value.map((f) => [f.parentUserId, f.prebookRequest])).toEqual([[id(1), { londonDate: "2027-02-08" }]]);
  });

  it("R10: she booked again after that attempt, then cancelled → back under Not booked", async () => {
    const entries = [entryRow({ parentUserId: id(1), occurredAt: "2027-02-03T10:05:00.000Z", result: "answered", outcome: "deposit_taken" })];
    const bookings = [
      bookingRow({ parentUserId: id(1), startsAt: "2027-02-08T10:00:00.000Z", bookedAt: "2027-02-03T18:00:00.000Z", status: "cancelled", cancelReason: "parent" }),
    ];
    expect(await listed(one({ entries, bookings }).deps)).toEqual([id(1)]);
  });

  it("R10: a booking older than the attempt doesn't bring her back", async () => {
    const entries = [entryRow({ parentUserId: id(1), occurredAt: "2027-02-03T10:05:00.000Z", result: "answered", outcome: "deposit_taken" })];
    const bookings = [
      bookingRow({ parentUserId: id(1), startsAt: "2027-02-03T10:00:00.000Z", bookedAt: "2027-02-02T11:00:00.000Z", status: "done", closedAt: "2027-02-03T10:05:00.000Z" }),
    ];
    expect(await listed(one({ entries, bookings }).deps)).toEqual([]);
  });

  it("a hold that never confirmed is not a booking (R2) and doesn't bring her back", async () => {
    const entries = [entryRow({ parentUserId: id(1), occurredAt: "2027-02-03T10:05:00.000Z", outcome: "stop_calling", result: null })];
    const bookings = [
      bookingRow({ parentUserId: id(1), startsAt: "2027-02-08T10:00:00.000Z", status: "cancelled", cancelReason: "hold_expired", bookedAt: null, createdAt: "2027-02-03T18:00:00.000Z" }),
    ];
    expect(await listed(one({ entries, bookings }).deps)).toEqual([]);
  });
});

describe("order and the facts 05 needs (R13, R22)", () => {
  it("oldest sign-up first; a call-back waits until its time", async () => {
    const { deps } = setup({
      scope: [parent(1, "2027-02-01T10:00:00.000Z"), parent(2, "2027-02-02T10:00:00.000Z"), parent(3, "2027-02-03T10:00:00.000Z")],
      entries: [
        entryRow({
          parentUserId: id(1),
          occurredAt: "2027-02-03T11:00:00.000Z",
          result: "answered",
          outcome: "call_back_later",
          callBackAt: "2027-02-05T16:00:00.000Z",
        }),
      ],
    });
    const list = await getToCallList(deps);
    expect(list.ok && list.value.map((f) => f.parentUserId)).toEqual([id(2), id(3), id(1)]);
    expect(list.ok && list.value[2]).toMatchObject({
      lastAttemptAt: "2027-02-03T11:00:00.000Z",
      callBackAt: "2027-02-05T16:00:00.000Z",
      dueAt: "2027-02-05T16:00:00.000Z",
    });
  });
});

describe("failures and the switch", () => {
  it("off → call_booking_disabled with zero reads", async () => {
    vi.stubEnv("CALL_BOOKING_ENABLED", "");
    const { fake, deps } = setup({});
    expect(await getToCallList(deps)).toEqual({ ok: false, error: "call_booking_disabled" });
    expect(fake.calls).toEqual([]);
  });

  it.each(["readSettings", "readScopeParents", "readBookingsForParents", "readLogEntriesForParents", "readContacts"] as const)(
    "a failed %s → error",
    async (method) => {
      const { deps } = setup({ scope: [parent(1, "2027-02-02T10:00:00.000Z")], failing: [method] });
      expect(await getToCallList(deps)).toEqual({ ok: false, error: "error" });
    },
  );

  it("a pre-book source that throws → error, logged", async () => {
    const { deps } = setup({ scope: [parent(1, "2027-02-02T10:00:00.000Z")] });
    const throwing = {
      ...deps,
      prebookRequests: async () => {
        throw new Error("03 down");
      },
    };
    expect(await getToCallList(throwing)).toEqual({ ok: false, error: "error" });
    expect(console.error).toHaveBeenCalled();
  });
});
