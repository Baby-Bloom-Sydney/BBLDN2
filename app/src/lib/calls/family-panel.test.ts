/**
 * The row drawer's read for one family, `/admin/calls?openCall=<parentUserId>` (plan C4; brief §3 admin 2–4, §0.10,
 * §0.11; BB-wave1-041126/04c1-build): contact, position, nannies contacted and replies, the deposit (read-only),
 * her booked call, every past attempt and note (with who recorded it), the four links, and her picker grid for
 * booking on her behalf. Admin proof first, after the switch; the id must be a user id with a parents row.
 *
 * The clock: Thursday 4 February 2027, 10:00 London (GMT).
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const { requireAdmin } = vi.hoisted(() => ({ requireAdmin: vi.fn() }));
vi.mock("@/lib/admin/require-admin", () => ({ requireAdmin }));

import { proveAdmin, type AdminProof } from "./admin-proof";
import type { DashboardDeps } from "./dashboard";
import type { DashboardReads } from "./dashboard-reads";
import { bookingRow, entryRow, fakeCallsRepo, type FakeCallsState } from "./fake-calls-repo.test-util";
import { loadFamilyPanel } from "./family-panel";
import { CALL_SETTINGS_DEFAULTS } from "./settings";

const NOW = new Date("2027-02-04T10:00:00.000Z");
const ADMIN = "a0400000-0000-4000-8000-000000000001";
const JANE = "b0400000-0000-4000-8000-000000000001";
const POS = "d0400000-0000-4000-8000-000000000001";
const FORGED = { kind: "admin_proof", userId: ADMIN } as unknown as AdminProof;
let PROOF: AdminProof;

const BOOKED = bookingRow({ parentUserId: JANE, startsAt: "2027-02-05T14:00:00.000Z", positionId: POS });
const CONTACTS = [
  { userId: JANE, firstName: "Jane", lastName: "Smith", email: "jane@example.test", mobile: "+447700900123", isTestUser: true },
  { userId: ADMIN, firstName: "Bai", lastName: "Admin", email: "bai@example.test", mobile: null, isTestUser: false },
];
const ENTRIES = [
  entryRow({ parentUserId: JANE, occurredAt: "2027-02-03T15:00:00.000Z", result: "no_answer", recordedBy: ADMIN, note: "Rang twice" }),
  entryRow({ parentUserId: JANE, occurredAt: "2027-02-03T17:00:00.000Z", result: "answered", outcome: "call_back_later", callBackAt: "2027-02-05T17:00:00.000Z", recordedBy: null }),
];

function setup(seed: Partial<FakeCallsState> = {}, readsOver: Partial<DashboardReads> = {}) {
  const fake = fakeCallsRepo({
    settings: { ...CALL_SETTINGS_DEFAULTS, enabledSince: "2027-02-01T09:00:00.000Z" },
    bookings: [BOOKED],
    contacts: CONTACTS,
    entries: ENTRIES,
    ...seed,
  });
  const detailCalls: Array<{ ids: readonly string[]; preferred?: ReadonlyMap<string, string> }> = [];
  const reads: DashboardReads = {
    readFamilyDetails: async (ids, preferred) => {
      detailCalls.push({ ids, preferred });
      return {
        ok: true,
        value: {
          families: new Map([[JANE, { userId: JANE, signupSource: "advanced_match", signedUpAt: "2027-02-01T10:00:00.000Z" }]]),
          positions: new Map([
            [
              JANE,
              {
                id: POS,
                parentUserId: JANE,
                area: "Islington",
                hoursPerWeek: 30,
                daysRequired: ["Monday"],
                startDate: "2027-03-01",
                createdAt: "2027-02-01T10:00:00.000Z",
                childAgesMonths: [8],
                nanniesContacted: 6,
                nanniesReplied: 2,
              },
            ],
          ]),
        },
      };
    },
    readDeposit: async () => ({ ok: true, value: { status: "deposit_paid", depositPaidAt: "2027-02-03T10:00:00.000Z", depositRefundedAt: null } }),
    ...readsOver,
  };
  const deps: DashboardDeps = { repo: fake.repo, now: () => NOW, notify: async () => {}, prebookRequests: async () => new Map(), reads, cohortLine: async () => null };
  return { fake, deps, detailCalls };
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

describe("the gates", () => {
  it("switch off → call_booking_disabled, before any read", async () => {
    vi.stubEnv("CALL_BOOKING_ENABLED", "");
    const { fake, deps, detailCalls } = setup();
    expect(await loadFamilyPanel(PROOF, JANE, deps)).toEqual({ ok: false, error: "call_booking_disabled" });
    expect(fake.calls).toEqual([]);
    expect(detailCalls).toEqual([]);
  });

  it("a forged proof, or an id that isn't a user id → invalid, before any read", async () => {
    const { fake, deps, detailCalls } = setup();
    expect(await loadFamilyPanel(FORGED, JANE, deps)).toEqual({ ok: false, error: "invalid" });
    expect(await loadFamilyPanel(PROOF, "not-a-uuid", deps)).toEqual({ ok: false, error: "invalid" });
    expect(fake.calls).toEqual([]);
    expect(detailCalls).toEqual([]);
  });

  it("a sign-up source of '__proto__' or 'constructor' reads Direct, never an object the page can't send (H1)", async () => {
    for (const source of ["__proto__", "constructor"]) {
      const families = new Map([[JANE, { userId: JANE, signupSource: source, signedUpAt: "2027-02-01T10:00:00.000Z" }]]);
      const { deps } = setup({}, { readFamilyDetails: async () => ({ ok: true, value: { families, positions: new Map() } }) });
      const got = await loadFamilyPanel(PROOF, JANE, deps);
      expect(got.ok && got.value.signupType).toBe("Direct");
    }
  });

  it("someone with no parents row (not a parent) → not_found", async () => {
    const { deps } = setup({}, { readFamilyDetails: async () => ({ ok: true, value: { families: new Map(), positions: new Map() } }) });
    expect(await loadFamilyPanel(PROOF, JANE, deps)).toEqual({ ok: false, error: "not_found" });
  });
});

describe("the drawer's facts (brief §3 admin 2)", () => {
  it("contact, sign-up, position with the nannies line, deposit read-only, the four links, the tags", async () => {
    const { deps, detailCalls } = setup();
    const got = await loadFamilyPanel(PROOF, JANE, deps);
    expect(got.ok).toBe(true);
    if (!got.ok) return;
    expect(got.value).toMatchObject({
      parentUserId: JANE,
      contact: { name: "Jane Smith", email: "jane@example.test", mobile: { href: "tel:+447700900123", text: "+44 (0) 7700 900 123" } },
      signupType: "Advanced",
      signedUp: "Signed up Mon 1 Feb, 10:00 (London time)",
      position: { positionId: POS, area: "Islington", nannies: "6 nannies contacted · 2 replied" },
      deposit: "Deposit paid 3 February 2027",
      links: { position: `/admin/positions?openPosition=${POS}`, money: `/admin/users/${JANE}/subscription` },
      tags: ["test"],
    });
    expect(detailCalls).toEqual([{ ids: [JANE], preferred: new Map([[JANE, POS]]) }]);
  });

  it("her booked call, in London words, changeable before its start", async () => {
    const got = await loadFamilyPanel(PROOF, JANE, setup().deps);
    expect(got.ok && got.value.booking).toEqual({ bookingId: BOOKED.id, startsAt: BOOKED.startsAt, when: "Fri 5 Feb, 14:00 (London time)", changeable: true, purpose: "first_call" });
  });

  it("a booked call that has started is no longer changeable (outcome only)", async () => {
    const started = bookingRow({ parentUserId: JANE, startsAt: "2027-02-04T09:45:00.000Z" });
    const got = await loadFamilyPanel(PROOF, JANE, setup({ bookings: [started] }).deps);
    expect(got.ok && got.value.booking?.changeable).toBe(false);
  });

  it("a booked cohort pre-book (brief 03's) is her booked call too, with its purpose, tagged Cohort pre-book", async () => {
    const prebook = bookingRow({ parentUserId: JANE, startsAt: "2027-02-08T10:00:00.000Z", purpose: "cohort_prebook" });
    const got = await loadFamilyPanel(PROOF, JANE, setup({ bookings: [prebook] }).deps);
    expect(got.ok && got.value.booking).toMatchObject({ bookingId: prebook.id, purpose: "cohort_prebook" });
    expect(got.ok && got.value.tags).toEqual(["cohort_prebook", "test"]);
  });

  it("her first call wins over a pre-book when she has both", async () => {
    const prebook = bookingRow({ parentUserId: JANE, startsAt: "2027-02-08T10:00:00.000Z", purpose: "cohort_prebook" });
    const got = await loadFamilyPanel(PROOF, JANE, setup({ bookings: [prebook, BOOKED] }).deps);
    expect(got.ok && got.value.booking).toMatchObject({ bookingId: BOOKED.id, purpose: "first_call" });
  });

  it("a booked call 15 minutes past its start is tagged Overdue here too, as on her row (code review)", async () => {
    const late = bookingRow({ parentUserId: JANE, startsAt: "2027-02-04T09:30:00.000Z" });
    const got = await loadFamilyPanel(PROOF, JANE, setup({ bookings: [late] }).deps);
    expect(got.ok && got.value.tags).toEqual(["overdue", "test"]);
    const justStarted = bookingRow({ parentUserId: JANE, startsAt: "2027-02-04T09:50:00.000Z" });
    const fresh = await loadFamilyPanel(PROOF, JANE, setup({ bookings: [justStarted] }).deps);
    expect(fresh.ok && fresh.value.tags).toEqual(["test"]);
  });

  it("not booked → booking null", async () => {
    const got = await loadFamilyPanel(PROOF, JANE, setup({ bookings: [] }).deps);
    expect(got.ok && got.value.booking).toBeNull();
  });

  it("a booked call under a block is tagged Blocked over", async () => {
    const blocks = [{ id: "blk", startsAt: "2027-02-05T13:00:00.000Z", endsAt: "2027-02-05T16:00:00.000Z", reason: "dentist" }];
    const got = await loadFamilyPanel(PROOF, JANE, setup({ blocks }).deps);
    expect(got.ok && got.value.tags).toEqual(["blocked_over", "test"]);
  });

  it("every attempt, newest first: when (London), what, the note, who recorded it, any call-back", async () => {
    const got = await loadFamilyPanel(PROOF, JANE, setup().deps);
    expect(got.ok && got.value.attempts).toEqual([
      { key: ENTRIES[1].id, when: "Wed 3 Feb, 17:00 (London time)", what: "Answered · Call back later", note: null, by: null, callBack: "Call back Fri 5 Feb, 17:00 (London time)" },
      { key: ENTRIES[0].id, when: "Wed 3 Feb, 15:00 (London time)", what: "No answer", note: "Rang twice", by: "Bai Admin", callBack: null },
    ]);
  });

  it("her picker grid, by day: her booked time is greyed, the next one free", async () => {
    const got = await loadFamilyPanel(PROOF, JANE, setup().deps);
    expect(got.ok && got.value.days?.[0].londonDate).toBe("2027-02-04");
    // Her booked Fri 14:00 is occupied (greyed); the Fri 14:30 next to it is free.
    const friday = got.ok ? got.value.days?.find((d) => d.londonDate === "2027-02-05") : undefined;
    expect(friday?.slots.find((s) => s.startsAt === "2027-02-05T14:00:00.000Z")?.free).toBe(false);
    expect(friday?.slots.find((s) => s.startsAt === "2027-02-05T14:30:00.000Z")?.free).toBe(true);
  });
});

describe("failures", () => {
  it("the grid can't be read → days null (the picker shows load-failed); the rest stands", async () => {
    const got = await loadFamilyPanel(PROOF, JANE, setup({ failing: ["readWeeklyHours"] }).deps);
    expect(got.ok).toBe(true);
    expect(got.ok && got.value.days).toBeNull();
  });

  it("the deposit can't be read → 'could not be read', never a guess", async () => {
    const got = await loadFamilyPanel(PROOF, JANE, setup({}, { readDeposit: async () => ({ ok: false, error: "error" }) }).deps);
    expect(got.ok && got.value.deposit).toBe("Could not be read");
  });

  it.each(["readBookingsForParents", "readLogEntriesForParents", "readContacts", "readBlocks", "readSettings"] as const)("%s fails → error", async (method) => {
    expect(await loadFamilyPanel(PROOF, JANE, setup({ failing: [method] }).deps)).toEqual({ ok: false, error: "error" });
  });

  it("the row data fails → error", async () => {
    const { deps } = setup({}, { readFamilyDetails: async () => ({ ok: false, error: "error" }) });
    expect(await loadFamilyPanel(PROOF, JANE, deps)).toEqual({ ok: false, error: "error" });
  });
});
