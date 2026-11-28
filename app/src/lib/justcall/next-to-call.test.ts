/**
 * Call next (plan 05 §5 PR 05b C6; R11; §9 row 4; brief §0.3, §3.5): 04's order (overdue → due now → next booked → not
 * booked, oldest first), skipping a family tried in the last 2 hours, one not yet due a call-back, then one with no
 * mobile; none left → null. Through 04's own `getWhoIsNext` on a fake repo. BB-wave2-231126/05-build.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const { requireAdmin } = vi.hoisted(() => ({ requireAdmin: vi.fn() }));
vi.mock("@/lib/admin/require-admin", () => ({ requireAdmin }));

import { proveAdmin, type AdminProof } from "@/lib/calls/admin-proof";
import type { CallsDeps } from "@/lib/calls/deps";
import { bookingRow, entryRow, fakeCallsRepo, type FakeCallsState } from "@/lib/calls/fake-calls-repo.test-util";
import { CALL_SETTINGS_DEFAULTS } from "@/lib/calls/settings";
import type { ParentContact } from "@/lib/calls/types";
import type { WhoIsNextRow } from "@/lib/calls/who-next";
import { nextFamilyToCall, pickNextToCall } from "./next-to-call";

const NOW = new Date("2027-02-04T10:00:00.000Z");
const id = (n: number) => `b0500000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const contact = (n: number, mobile: string | null = `0770090012${n}`): ParentContact => ({
  userId: id(n),
  firstName: "Fixture",
  lastName: String(n),
  email: `f${n}@example.test`,
  mobile,
  isTestUser: false,
});

/** The plan's fixture: overdue, due now, next booked, two not booked; a 1-hour-old attempt; a future call-back. */
function fixture(over: Partial<FakeCallsState> = {}) {
  const fake = fakeCallsRepo({
    settings: { ...CALL_SETTINGS_DEFAULTS, enabledSince: "2027-02-01T09:00:00.000Z" },
    bookings: [
      bookingRow({ parentUserId: id(1), startsAt: "2027-02-04T09:00:00.000Z" }), // overdue
      bookingRow({ parentUserId: id(2), startsAt: "2027-02-04T09:55:00.000Z" }), // due now
      bookingRow({ parentUserId: id(3), startsAt: "2027-02-04T13:00:00.000Z" }), // next booked
    ],
    scope: [
      { userId: id(4), signupSource: "direct", signedUpAt: "2027-02-02T10:00:00.000Z" }, // not booked, older
      { userId: id(5), signupSource: "direct", signedUpAt: "2027-02-03T10:00:00.000Z" }, // not booked, newer
    ],
    contacts: [contact(1), contact(2), contact(3), contact(4), contact(5)],
    ...over,
  });
  const deps: CallsDeps = { repo: fake.repo, now: () => NOW, notify: async () => {}, prebookRequests: async () => new Map() };
  return deps;
}

let PROOF: AdminProof;
beforeAll(async () => {
  requireAdmin.mockResolvedValue({ userId: "a0500000-0000-4000-8000-000000000001", error: null });
  const proof = await proveAdmin();
  if (proof === null) throw new Error("no proof");
  PROOF = proof;
});
beforeEach(() => {
  vi.stubEnv("CALL_BOOKING_ENABLED", "true");
  vi.stubEnv("JUSTCALL_ENABLED", "true");
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("nextFamilyToCall — 04's order with the two skips (R11)", () => {
  it("the overdue family first, with her mobile in E.164", async () => {
    expect(await nextFamilyToCall(PROOF, fixture())).toEqual({ ok: true, value: { parentUserId: id(1), mobile: "+447700900121" } });
  });

  it("tried an hour ago → skipped; due now is next", async () => {
    const deps = fixture({ entries: [entryRow({ parentUserId: id(1), occurredAt: "2027-02-04T09:00:00.000Z", result: "answered", outcome: "other" })] });
    expect(await nextFamilyToCall(PROOF, deps)).toEqual({ ok: true, value: { parentUserId: id(2), mobile: "+447700900122" } });
  });

  it("tried more than 2 hours ago → not skipped", async () => {
    const deps = fixture({ entries: [entryRow({ parentUserId: id(1), occurredAt: "2027-02-04T07:59:00.000Z", result: "answered", outcome: "other" })] });
    const next = await nextFamilyToCall(PROOF, deps);
    expect(next.ok && next.value?.parentUserId).toBe(id(1));
  });

  it("a call-back still to come → skipped; one already due → called", async () => {
    const later = fixture({
      bookings: [],
      entries: [entryRow({ parentUserId: id(4), occurredAt: "2027-02-03T07:00:00.000Z", result: "answered", outcome: "call_back_later", callBackAt: "2027-02-04T17:00:00.000Z" })],
    });
    expect(await nextFamilyToCall(PROOF, later)).toEqual({ ok: true, value: { parentUserId: id(5), mobile: "+447700900125" } });
    // 04 lists id(5) (signed up 3 Feb) before id(4) (due at her call-back, 4 Feb 09:30); id(5) was just tried.
    const due = fixture({
      bookings: [],
      entries: [
        entryRow({ parentUserId: id(4), occurredAt: "2027-02-03T07:00:00.000Z", result: "answered", outcome: "call_back_later", callBackAt: "2027-02-04T09:30:00.000Z" }),
        entryRow({ parentUserId: id(5), occurredAt: "2027-02-04T09:40:00.000Z", result: "no_answer" }),
      ],
    });
    const next = await nextFamilyToCall(PROOF, due);
    expect(next.ok && next.value?.parentUserId).toBe(id(4));
  });

  it("no mobile → skipped", async () => {
    const deps = fixture({ contacts: [contact(1, null), contact(2), contact(3), contact(4), contact(5)] });
    const next = await nextFamilyToCall(PROOF, deps);
    expect(next.ok && next.value?.parentUserId).toBe(id(2));
  });

  it("everyone skipped → null (the page says 'No one left to call right now.')", async () => {
    const recent = (n: number) => entryRow({ parentUserId: id(n), occurredAt: "2027-02-04T09:30:00.000Z", result: "no_answer" });
    const deps = fixture({ bookings: [], entries: [recent(4), recent(5)] });
    expect(await nextFamilyToCall(PROOF, deps)).toEqual({ ok: true, value: null });
  });

  it("refuses before any read: dialer off → justcall_disabled; no proof → not_authorized", async () => {
    const deps = fixture();
    const read = vi.spyOn(deps.repo, "readSettings");
    vi.stubEnv("JUSTCALL_ENABLED", "");
    expect(await nextFamilyToCall(PROOF, deps)).toEqual({ ok: false, error: "justcall_disabled" });
    vi.stubEnv("JUSTCALL_ENABLED", "true");
    expect(await nextFamilyToCall({ userId: "forged" } as unknown as AdminProof, deps)).toEqual({ ok: false, error: "not_authorized" });
    expect(read).not.toHaveBeenCalled();
  });

  it("04's read fails → error, logged by code", async () => {
    const deps = fixture();
    vi.spyOn(deps.repo, "readSettings").mockResolvedValue({ ok: false, error: "error" });
    expect(await nextFamilyToCall(PROOF, deps)).toEqual({ ok: false, error: "error" });
    expect(console.error).toHaveBeenCalled();
  });
});

describe("pickNextToCall — the rule on its own", () => {
  const row = (n: number, over: Partial<WhoIsNextRow> = {}): WhoIsNextRow => ({
    group: "not_booked",
    parentUserId: id(n),
    contact: contact(n),
    booking: null,
    signedUpAt: null,
    lastAttemptAt: null,
    callBackAt: null,
    prebookRequest: null,
    ...over,
  });

  it("exactly 2 hours ago is old enough; a call-back due now is due", () => {
    expect(pickNextToCall([row(1, { lastAttemptAt: "2027-02-04T08:00:00.000Z" })], NOW)?.parentUserId).toBe(id(1));
    expect(pickNextToCall([row(1, { callBackAt: "2027-02-04T10:00:00.000Z" })], NOW)?.parentUserId).toBe(id(1));
  });

  it("a mobile given as +44 E.164 stays; one that isn't a phone number is skipped", () => {
    expect(pickNextToCall([row(1, { contact: contact(1, "+447700900121") })], NOW)?.mobile).toBe("+447700900121");
    expect(pickNextToCall([row(1, { contact: contact(1, "not a number") }), row(2)], NOW)?.parentUserId).toBe(id(2));
  });

  it("an empty list → null", () => {
    expect(pickNextToCall([], NOW)).toBeNull();
  });
});
