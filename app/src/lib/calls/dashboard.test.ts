/**
 * The /admin/calls Calls tab (plan C3, §13; brief §0.8, §0.9, §0.13, §3 admin 1, 6; BB-wave1-041126/04c1-build).
 *
 * Sections, from 04a's who's-next order: Overdue (a booked call `overdue_grace_minutes` past its start, computed at
 * load), Today and upcoming (by time), Not booked — to call (oldest sign-up first), History (the last 50 outcomes).
 * The counts line is 02's contract for the London week; the free-time banner is red at none and amber below
 * `LOW_FREE_SLOTS`; tags Blocked over / Overdue / Cohort pre-book / Test. Row data comes in one batch.
 *
 * The clock: Thursday 4 February 2027, 10:00 London (GMT).
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const { requireAdmin } = vi.hoisted(() => ({ requireAdmin: vi.fn() }));
vi.mock("@/lib/admin/require-admin", () => ({ requireAdmin }));

import { proveAdmin, type AdminProof } from "./admin-proof";
import { LOW_FREE_SLOTS, loadCallsDashboard, type DashboardDeps } from "./dashboard";
import type { DashboardReads, FamilyDetails } from "./dashboard-reads";
import type { PositionFacts } from "./dashboard-row";
import { bookingRow, entryRow, EVERY_DAY_9_TO_7, fakeCallsRepo, type FakeCallsState } from "./fake-calls-repo.test-util";
import { CALL_SETTINGS_DEFAULTS } from "./settings";
import type { ParentContact } from "./types";

const NOW = new Date("2027-02-04T10:00:00.000Z");
const ADMIN = "a0400000-0000-4000-8000-000000000001";
const id = (n: number) => `b0400000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const pos = (n: number) => `d0400000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const FORGED = { kind: "admin_proof", userId: ADMIN } as unknown as AdminProof;
let PROOF: AdminProof;

const contact = (n: number, first: string, last: string, isTestUser = false): ParentContact => ({
  userId: id(n),
  firstName: first,
  lastName: last,
  email: `${first.toLowerCase()}@example.test`,
  mobile: "+447700900123",
  isTestUser,
});

const CONTACTS: readonly ParentContact[] = [
  contact(1, "Ava", "Overdue"),
  contact(2, "Ben", "Duenow"),
  contact(3, "Cat", "Blocked"),
  contact(4, "Dan", "Prebook"),
  contact(5, "Eve", "Older"),
  contact(6, "Fay", "Quick"),
  contact(7, "Gus", "Tester", true),
  contact(8, "Hal", "Past"),
  { userId: ADMIN, firstName: "Bai", lastName: "Admin", email: "bai@example.test", mobile: null, isTestUser: false },
];

const BOOKINGS = [
  bookingRow({ parentUserId: id(1), startsAt: "2027-02-04T09:30:00.000Z", positionId: pos(1) }),
  bookingRow({ parentUserId: id(2), startsAt: "2027-02-04T09:50:00.000Z" }),
  bookingRow({ parentUserId: id(3), startsAt: "2027-02-05T14:00:00.000Z" }),
  bookingRow({ parentUserId: id(4), startsAt: "2027-02-09T14:00:00.000Z", purpose: "cohort_prebook" }),
];

const SCOPE = [
  { userId: id(5), signupSource: "advanced_match", signedUpAt: "2027-02-02T09:00:00.000Z" },
  { userId: id(6), signupSource: "standard_match", signedUpAt: "2027-02-03T09:00:00.000Z" },
  { userId: id(7), signupSource: null, signedUpAt: "2027-02-02T12:00:00.000Z" },
];

const position = (n: number, over: Partial<PositionFacts> = {}): PositionFacts => ({
  id: pos(n),
  parentUserId: id(n),
  area: "Islington",
  hoursPerWeek: 30,
  daysRequired: ["Monday"],
  startDate: "2027-03-01",
  createdAt: "2027-02-01T10:00:00.000Z",
  childAgesMonths: [8],
  nanniesContacted: 6,
  nanniesReplied: 2,
  ...over,
});

function details(): FamilyDetails {
  const signedUp = (n: number, at: string, source: string | null = "advanced_match") => [id(n), { userId: id(n), signupSource: source, signedUpAt: at }] as const;
  return {
    families: new Map([
      signedUp(1, "2027-02-01T10:00:00.000Z"),
      signedUp(2, "2027-02-01T11:00:00.000Z"),
      signedUp(3, "2027-02-01T12:00:00.000Z"),
      signedUp(4, "2027-02-01T13:00:00.000Z"),
      signedUp(5, "2027-02-02T09:00:00.000Z"),
      signedUp(6, "2027-02-03T09:00:00.000Z", "standard_match"),
      signedUp(7, "2027-02-02T12:00:00.000Z", null),
    ]),
    positions: new Map([1, 2, 3, 4, 5, 7].map((n) => [id(n), position(n)] as const)),
  };
}

function setup(seed: Partial<FakeCallsState> = {}, over: Partial<DashboardDeps> = {}) {
  const fake = fakeCallsRepo({
    settings: { ...CALL_SETTINGS_DEFAULTS, enabledSince: "2027-02-01T09:00:00.000Z" },
    bookings: BOOKINGS,
    scope: SCOPE,
    contacts: CONTACTS,
    blocks: [{ id: "blk", startsAt: "2027-02-05T13:00:00.000Z", endsAt: "2027-02-05T16:00:00.000Z", reason: "dentist" }],
    entries: [entryRow({ parentUserId: id(8), occurredAt: "2027-02-03T15:00:00.000Z", result: "no_answer", recordedBy: ADMIN, note: "Rang twice" })],
    ...seed,
  });
  const readCalls: Array<{ ids: readonly string[]; preferred: ReadonlyMap<string, string> | undefined }> = [];
  const reads: DashboardReads = {
    readFamilyDetails: async (ids, preferred) => {
      readCalls.push({ ids, preferred });
      return { ok: true, value: details() };
    },
    readDeposit: async () => ({ ok: true, value: null }),
  };
  const deps: DashboardDeps = {
    repo: fake.repo,
    now: () => NOW,
    notify: async () => {},
    prebookRequests: async () => new Map(),
    reads,
    cohortLine: async () => null,
    ...over,
  };
  return { fake, deps, readCalls };
}

beforeAll(async () => {
  requireAdmin.mockResolvedValue({ userId: ADMIN, error: null });
  const proof = await proveAdmin();
  if (proof === null) throw new Error("no proof");
  PROOF = proof;
});
beforeEach(() => {
  vi.stubEnv("CALL_BOOKING_ENABLED", "true");
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

async function board(seed: Partial<FakeCallsState> = {}, over: Partial<DashboardDeps> = {}) {
  const s = setup(seed, over);
  const got = await loadCallsDashboard(PROOF, s.deps);
  if (!got.ok) throw new Error(`dashboard failed: ${got.error}`);
  return { ...s, board: got.value };
}

const names = (rows: readonly { readonly contact: { readonly name: string } }[]) => rows.map((r) => r.contact.name);

describe("the gates", () => {
  it("switch off → call_booking_disabled, before any read", async () => {
    vi.stubEnv("CALL_BOOKING_ENABLED", "");
    const { fake, deps, readCalls } = setup();
    expect(await loadCallsDashboard(PROOF, deps)).toEqual({ ok: false, error: "call_booking_disabled" });
    expect(fake.calls).toEqual([]);
    expect(readCalls).toEqual([]);
  });

  it("a forged proof → invalid, before any read", async () => {
    const { fake, deps, readCalls } = setup();
    expect(await loadCallsDashboard(FORGED, deps)).toEqual({ ok: false, error: "invalid" });
    expect(fake.calls).toEqual([]);
    expect(readCalls).toEqual([]);
  });
});

describe("the sections (brief §3 admin 1)", () => {
  it("Overdue: a booked call 15 minutes past its start; Today and upcoming by time; Not booked oldest sign-up first", async () => {
    const { board: b } = await board();
    expect(names(b.overdue)).toEqual(["Ava Overdue"]);
    expect(names(b.upcoming)).toEqual(["Ben Duenow", "Cat Blocked", "Dan Prebook"]);
    expect(names(b.notBooked)).toEqual(["Eve Older", "Gus Tester", "Fay Quick"]);
  });

  it("the grace is the setting's: with 45 minutes the 09:30 call is still upcoming at 10:00", async () => {
    const { board: b } = await board({ settings: { ...CALL_SETTINGS_DEFAULTS, enabledSince: "2027-02-01T09:00:00.000Z", overdueGraceMinutes: 45 } });
    expect(b.overdue).toEqual([]);
    expect(names(b.upcoming)[0]).toBe("Ava Overdue");
  });

  it("History: the last outcomes, newest first, with the time, what happened, the note and who recorded it", async () => {
    const { board: b, fake } = await board();
    expect(b.history).toEqual([
      { key: expect.any(String), parentUserId: id(8), when: "Wed 3 Feb, 15:00 (London time)", name: "Hal Past", what: "No answer", note: "Rang twice", by: "Bai Admin", tags: [] },
    ]);
    expect(fake.calls.find((c) => c.method === "readRecentLogEntries")?.args).toEqual([50]);
  });

  it("a failed history read leaves the rest standing (history null)", async () => {
    const { board: b } = await board({ failing: ["readRecentLogEntries"] });
    expect(b.history).toBeNull();
    expect(names(b.overdue)).toEqual(["Ava Overdue"]);
  });

  it("nothing at all → empty sections, no banner trouble", async () => {
    const { board: b } = await board({ bookings: [], scope: [], entries: [] });
    expect([b.overdue, b.upcoming, b.notBooked, b.history]).toEqual([[], [], [], []]);
    expect(b.counts).toBe("Calls still to make this week: 0 (0 booked · 0 not booked)");
  });
});

describe("the counts line and the cohort line (brief §0.8)", () => {
  it("this London week's calls still to make: booked this week + not booked, test families left out", async () => {
    const { board: b } = await board();
    // Booked this week: Ava, Ben, Cat (Dan is Tue 9 Feb, next week). Not booked: Eve, Fay (Gus is a test family).
    expect(b.counts).toBe("Calls still to make this week: 5 (3 booked · 2 not booked)");
  });

  it("counts that can't be read → null (the page says so), never a wrong number", async () => {
    const { board: b } = await board({ failing: ["readBookingsStartingIn"] });
    expect(b.counts).toBeNull();
  });

  it("the cohort line when 02 gives one; none otherwise", async () => {
    expect((await board({}, { cohortLine: async () => ({ places: 5, left: 2 }) })).board.cohort).toBe("Current cohort: 2 of 5 places left");
    expect((await board()).board.cohort).toBeNull();
  });
});

describe("the free-time banner (brief §0.13, §3 admin 1)", () => {
  it("plenty free → no banner", async () => {
    expect((await board()).board.banner).toBeNull();
  });

  it("no hours at all → red: 'No free call times in the next 7 days.'", async () => {
    expect((await board({ hours: [] })).board.banner).toEqual({ tone: "red", line: "No free call times in the next 7 days." });
  });

  it(`fewer than ${LOW_FREE_SLOTS} free → amber`, async () => {
    // One 30-minute window on Saturdays only: 10:00–11:30 → 3 slots in the week.
    const { board: b } = await board({ hours: [{ weekday: 6, startMinute: 600, endMinute: 690 }] });
    expect(b.banner).toEqual({ tone: "amber", line: "Free call times are running low in the next 7 days." });
  });

  it(`exactly ${LOW_FREE_SLOTS} free → no banner`, async () => {
    const { board: b } = await board({ hours: [{ weekday: 6, startMinute: 600, endMinute: 600 + 30 * LOW_FREE_SLOTS }] });
    expect(b.banner).toBeNull();
  });

  it("free times that can't be read → no banner (never a false red)", async () => {
    expect((await board({ failing: ["readWeeklyHours"], hours: EVERY_DAY_9_TO_7 })).board.banner).toBeNull();
  });
});

describe("the tags (brief §3 admin 6)", () => {
  it("Overdue, Blocked over (a booked call under a block), Cohort pre-book, Test", async () => {
    const { board: b } = await board();
    const tags = (rows: typeof b.upcoming) => Object.fromEntries(rows.map((r) => [r.contact.name, r.tags]));
    expect(tags(b.overdue)).toEqual({ "Ava Overdue": ["overdue"] });
    expect(tags(b.upcoming)).toEqual({ "Ben Duenow": [], "Cat Blocked": ["blocked_over"], "Dan Prebook": ["cohort_prebook"] });
    expect(tags(b.notBooked)).toEqual({ "Eve Older": [], "Gus Tester": ["test"], "Fay Quick": [] });
  });

  it("a not-booked family with 03's pending pre-book request is tagged Cohort pre-book", async () => {
    const { board: b } = await board({}, { prebookRequests: async () => new Map([[id(5), { londonDate: "2027-02-08" }]]) });
    expect(b.notBooked.find((r) => r.parentUserId === id(5))?.tags).toEqual(["cohort_prebook"]);
  });

  it("a block touching but not overlapping the call doesn't tag it", async () => {
    const { board: b } = await board({ blocks: [{ id: "blk", startsAt: "2027-02-05T14:30:00.000Z", endsAt: "2027-02-05T16:00:00.000Z", reason: "x" }] });
    expect(b.upcoming.find((r) => r.parentUserId === id(3))?.tags).toEqual([]);
  });
});

describe("a row (brief §0.9)", () => {
  it("the London time, contact, sign-up type, position summary with the nannies line, and the four links", async () => {
    const { board: b } = await board();
    expect(b.overdue[0]).toEqual({
      key: BOOKINGS[0].id,
      section: "overdue",
      parentUserId: id(1),
      bookingId: BOOKINGS[0].id,
      startsAt: "2027-02-04T09:30:00.000Z",
      when: "Thu 4 Feb, 09:30 (London time)",
      signedUp: "Signed up Mon 1 Feb, 10:00 (London time)",
      lastTried: null,
      callBack: null,
      contact: { name: "Ava Overdue", email: "ava@example.test", mobile: { href: "tel:+447700900123", text: "+44 (0) 7700 900 123" } },
      signupType: "Advanced",
      position: {
        positionId: pos(1),
        area: "Islington",
        hours: "30 hours a week",
        days: "Monday",
        children: "8 months",
        starts: "Starts 1 March 2027",
        nannies: "6 nannies contacted · 2 replied",
      },
      links: {
        profile: `/admin/viewer/${id(1)}`,
        account: `/admin/users?openUser=${id(1)}`,
        money: `/admin/users/${id(1)}/subscription`,
        position: `/admin/positions?openPosition=${pos(1)}`,
      },
      tags: ["overdue"],
    });
  });

  it("a quick-match family has no position: position null and no Position link", async () => {
    const fay = (await board()).board.notBooked.find((r) => r.parentUserId === id(6));
    expect(fay).toMatchObject({ signupType: "Quick match", position: null, when: null, bookingId: null, signedUp: "Signed up Wed 3 Feb, 09:00 (London time)" });
    expect(fay?.links.position).toBeNull();
  });

  it("a not-booked family's last attempt and call-back time, in London words", async () => {
    const entries = [entryRow({ parentUserId: id(5), occurredAt: "2027-02-03T11:00:00.000Z", result: "answered", outcome: "call_back_later", callBackAt: "2027-02-05T17:00:00.000Z" })];
    const eve = (await board({ entries })).board.notBooked.find((r) => r.parentUserId === id(5));
    expect(eve).toMatchObject({ lastTried: "Last tried Wed 3 Feb, 11:00 (London time)", callBack: "Call back Fri 5 Feb, 17:00 (London time)" });
  });

  it("row data is read in one batch for every family on screen, with the booking's own position preferred", async () => {
    const { readCalls } = await board();
    expect(readCalls).toHaveLength(1);
    expect([...readCalls[0].ids].sort()).toEqual([1, 2, 3, 4, 5, 6, 7].map(id).sort());
    expect(readCalls[0].preferred).toEqual(new Map([[id(1), pos(1)]]));
  });

  it("the row data can't be read → the tab fails closed (error), never rows with blanks", async () => {
    const { deps } = setup({}, { reads: { readFamilyDetails: async () => ({ ok: false, error: "error" }), readDeposit: async () => ({ ok: true, value: null }) } });
    expect(await loadCallsDashboard(PROOF, deps)).toEqual({ ok: false, error: "error" });
  });

  it("the call list can't be read → error", async () => {
    const { deps } = setup({ failing: ["readBookedCalls"] });
    expect(await loadCallsDashboard(PROOF, deps)).toEqual({ ok: false, error: "error" });
  });

  it("the blocks can't be read → error (a Blocked over tag must not silently vanish)", async () => {
    const { deps } = setup({ failing: ["readBlocks"] });
    expect(await loadCallsDashboard(PROOF, deps)).toEqual({ ok: false, error: "error" });
  });
});
