/**
 * The parent's public deposit actions (plan 03 row C1, D15, §10; brief 03 §3 parent 2, 5–6; ledger B03 § PR 03c
 * "Carried" 1–3, 6). Every export is a public endpoint and takes the CODE, never a parent id:
 *  1. the switch (`depositLinkEnabled()`, so `COHORTS_ENABLED` too) → `deposit_disabled`, before the admin client,
 *     the proof or anything else;
 *  2. `proveDepositCode` on EVERY call (never cached) → a malformed, unknown or cancelled code, or a failed proof
 *     read, is `invalid` with zero writes;
 *  3. only then 03a's domain calls with the proof, and 04's call contracts with the proof's parent as actor.
 * Pre-book is accepted only in the full and being-paid states. No login is read anywhere.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FakeAdmin } from "@/lib/payments/fake-admin.test-util";

const h = vi.hoisted(() => ({
  fake: null as FakeAdmin | null,
  clients: 0,
  clientThrows: false,
  startDepositCheckout: vi.fn(),
  readDepositPage: vi.fn(),
  recordPrebooking: vi.fn(),
  readOpenPrebooking: vi.fn(),
  attachPrebookingCall: vi.fn(),
  getFreeSlots: vi.fn(),
  holdSlotForParent: vi.fn(),
  confirmHoldForParent: vi.fn(),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => {
    h.clients += 1;
    if (h.clientThrows) throw new Error("no credentials for sarah@gmail.com");
    return h.fake!.client;
  },
}));
vi.mock("@/lib/deposit/session", () => ({ startDepositCheckout: h.startDepositCheckout, readDepositPage: h.readDepositPage }));
vi.mock("@/lib/deposit/prebook", () => ({
  recordPrebooking: h.recordPrebooking,
  readOpenPrebooking: h.readOpenPrebooking,
  attachPrebookingCall: h.attachPrebookingCall,
}));
vi.mock("@/lib/calls/contracts", () => ({
  getFreeSlots: h.getFreeSlots,
  holdSlotForParent: h.holdSlotForParent,
  confirmHoldForParent: h.confirmHoldForParent,
}));

import { groupSlotGridByDay } from "@/lib/calls/group-slots-by-day";
import { heldLine } from "@/lib/calls/copy";
import { prebookBookedLine } from "@/lib/deposit/copy";
import { isDepositParentProof, type DepositParentProof } from "@/lib/deposit/proof";
import { fakeAdmin } from "@/lib/payments/fake-admin.test-util";
import * as actions from "./actions";
import { confirmPrebookTime, holdPrebookTime, payDeposit, prebookNext, reloadPrebookTimes } from "./actions";

const PARENT = "b0300000-0000-4000-8000-000000000071";
const OTHER_PARENT = "b0300000-0000-4000-8000-000000000072";
const LINK = "d0300000-0000-4000-8000-000000000071";
const PREBOOKING = "e0300000-0000-4000-8000-000000000071";
const HOLD = "f0300000-0000-4000-8000-000000000071";
const BOOKING = "f0300000-0000-4000-8000-000000000072";
const CODE = "Ac0_-".repeat(8) + "xyz";
const NEXT = "2027-02-08";
const AT_10 = "2027-02-08T10:00:00.000Z";
const AT_1030 = "2027-02-08T10:30:00.000Z";
const OTHER_DAY = "2027-02-09T10:00:00.000Z";
const SESSION_URL = "https://checkout.stripe.com/c/pay/cs_test_dep71";

const linkRow = (over: Record<string, unknown> = {}) => ({
  id: LINK, parent_user_id: PARENT, state: "open", target: "current", goodwill_cohort_start_date: null, last_opened_at: null, ...over,
});
const prebooking = (over: Record<string, unknown> = {}) => ({
  id: PREBOOKING, parentUserId: PARENT, cohortStartDate: NEXT, callBookingId: null, createdAt: "2027-02-02T10:00:00+00:00", ...over,
});
const SLOTS = [{ startsAt: AT_10, endsAt: AT_1030 }];
const DAYS = groupSlotGridByDay({ dates: [NEXT], slots: SLOTS.map((s) => ({ ...s, free: true })) });
const page = (state: Record<string, unknown>) => ({ kind: "ok", state, firstName: "Sarah" });

const proofReads = () => h.fake!.ops.filter((o) => o.table === "deposit_links" && o.kind === "select").length;
const writes = () => h.fake!.ops.filter((o) => o.kind !== "select");
const domainCalls = () =>
  [h.startDepositCheckout, h.readDepositPage, h.recordPrebooking, h.readOpenPrebooking, h.attachPrebookingCall, h.getFreeSlots, h.holdSlotForParent, h.confirmHoldForParent]
    .reduce((n, fn) => n + fn.mock.calls.length, 0);

/** The proof a domain call was handed (its second argument, or the actor's). */
const proofIn = (fn: typeof h.startDepositCheckout): DepositParentProof => fn.mock.calls[0][1] as DepositParentProof;

/** Each action called with the code, so every gate test runs over all five. */
const ALL: ReadonlyArray<readonly [string, (code: unknown) => Promise<unknown>]> = [
  ["payDeposit", (code) => payDeposit(code)],
  ["prebookNext", (code) => prebookNext(code)],
  ["holdPrebookTime", (code) => holdPrebookTime(code, AT_10)],
  ["confirmPrebookTime", (code) => confirmPrebookTime(code, HOLD)],
  ["reloadPrebookTimes", (code) => reloadPrebookTimes(code)],
];

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.stubEnv("DEPOSIT_LINK_ENABLED", "true");
  vi.stubEnv("COHORTS_ENABLED", "true");
  vi.stubEnv("CALL_BOOKING_ENABLED", "true");
  h.fake = fakeAdmin({ deposit_links: linkRow() });
  h.clients = 0;
  h.clientThrows = false;
  for (const fn of [h.startDepositCheckout, h.readDepositPage, h.recordPrebooking, h.readOpenPrebooking, h.attachPrebookingCall, h.getFreeSlots, h.holdSlotForParent, h.confirmHoldForParent]) fn.mockReset();
  h.startDepositCheckout.mockResolvedValue({ kind: "redirect", url: SESSION_URL });
  h.readDepositPage.mockResolvedValue(page({ kind: "full", nextAvailable: NEXT }));
  h.recordPrebooking.mockResolvedValue({ ok: true, prebooking: prebooking(), created: true });
  h.readOpenPrebooking.mockResolvedValue({ ok: true, value: prebooking() });
  h.attachPrebookingCall.mockResolvedValue({ ok: true });
  h.getFreeSlots.mockResolvedValue({ ok: true, value: SLOTS });
  h.holdSlotForParent.mockResolvedValue({ ok: true, value: { bookingId: HOLD, holdExpiresAt: "2027-02-02T10:05:00Z", holdMinutes: 5, startsAt: AT_10, endsAt: AT_1030 } });
  h.confirmHoldForParent.mockResolvedValue({ ok: true, value: { kind: "booked", bookingId: BOOKING, startsAt: AT_10, replay: false } });
});
afterEach(() => vi.unstubAllEnvs());

describe("every action — the switch, then the code, before anything else", () => {
  it.each(ALL)("%s: DEPOSIT_LINK_ENABLED unset → deposit_disabled, no admin client, no proof, no domain call", async (_name, run) => {
    vi.stubEnv("DEPOSIT_LINK_ENABLED", "");
    expect(await run(CODE)).toEqual({ ok: false, error: "deposit_disabled" });
    expect([h.clients, h.fake!.ops.length, domainCalls()]).toEqual([0, 0, 0]);
  });

  it.each(ALL)("%s: COHORTS_ENABLED off → deposit_disabled the same way", async (_name, run) => {
    vi.stubEnv("COHORTS_ENABLED", "false");
    expect(await run(CODE)).toEqual({ ok: false, error: "deposit_disabled" });
    expect([h.clients, h.fake!.ops.length, domainCalls()]).toEqual([0, 0, 0]);
  });

  it.each(ALL)("%s: a malformed code → invalid with no read at all", async (_name, run) => {
    for (const bad of [CODE.slice(1), `${CODE}A`, CODE.replace("_", "+"), "", null, 43, { code: CODE }]) {
      expect(await run(bad)).toEqual({ ok: false, error: "invalid" });
    }
    expect([h.fake!.ops.length, domainCalls()]).toEqual([0, 0]);
  });

  it.each(ALL)("%s: an unknown or a cancelled code, or a failed proof read → invalid, zero writes", async (_name, run) => {
    h.fake!.reads.deposit_links = null;
    expect(await run(CODE)).toEqual({ ok: false, error: "invalid" });
    h.fake!.reads.deposit_links = linkRow({ state: "cancelled" });
    expect(await run(CODE)).toEqual({ ok: false, error: "invalid" });
    h.fake!.readErrors.deposit_links = { message: "boom", code: "XX000" };
    expect(await run(CODE)).toEqual({ ok: false, error: "invalid" });
    expect([writes(), domainCalls()]).toEqual([[], 0]);
  });

  it.each(ALL)("%s: the code is proven on every call — a proof is never cached", async (_name, run) => {
    await run(CODE);
    await run(CODE);
    expect(proofReads()).toBe(2);
  });

  it("a throw anywhere (here, the admin client) is a closed code, never its text", async () => {
    h.clientThrows = true;
    expect(await payDeposit(CODE)).toEqual({ ok: false, error: "try_again" });
    expect(await prebookNext(CODE)).toEqual({ ok: false, error: "error" });
    expect(await holdPrebookTime(CODE, AT_10)).toEqual({ ok: false, error: "error" });
    expect(await confirmPrebookTime(CODE, HOLD)).toEqual({ ok: false, error: "error" });
    expect(await reloadPrebookTimes(CODE)).toEqual({ ok: false, error: "error" });
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain("sarah@gmail.com");
  });
});

describe("payDeposit — 03a's Pay with the proof", () => {
  it("a session → redirect to its URL; 03a got the proof for the code's parent and the time now", async () => {
    expect(await payDeposit(CODE)).toEqual({ ok: true, kind: "redirect", url: SESSION_URL });
    const [admin, proof, now] = h.startDepositCheckout.mock.calls[0];
    expect(admin).toBe(h.fake!.client);
    expect(isDepositParentProof(proof)).toBe(true);
    expect((proof as DepositParentProof).parentUserId).toBe(PARENT);
    expect(now).toBeInstanceOf(Date);
  });

  it.each([
    [{ kind: "paid" }],
    [{ kind: "full", nextAvailable: NEXT }],
    [{ kind: "being_paid", nextAvailable: null }],
  ])("a state to show (%o) → that state", async (state) => {
    h.startDepositCheckout.mockResolvedValue({ kind: "state", state });
    expect(await payDeposit(CODE)).toEqual({ ok: true, kind: "state", state });
  });

  it.each(["try_again", "try_again_soon", "invalid"] as const)("03a's %s → that code", async (kind) => {
    h.startDepositCheckout.mockResolvedValue({ kind });
    expect(await payDeposit(CODE)).toEqual({ ok: false, error: kind });
  });

  it("takes only the code: an extra argument from the browser changes nothing", async () => {
    await (payDeposit as unknown as (...args: unknown[]) => Promise<unknown>)(CODE, OTHER_PARENT, { parentUserId: OTHER_PARENT });
    expect(proofIn(h.startDepositCheckout).parentUserId).toBe(PARENT);
  });
});

describe("prebookNext — only in the full and being-paid states (03a LOW-2)", () => {
  it.each([
    [{ kind: "bookable", start: "2027-02-01", goodwill: false }],
    [{ kind: "paid" }],
  ])("%o → not_offered, nothing recorded", async (state) => {
    h.readDepositPage.mockResolvedValue(page(state));
    expect(await prebookNext(CODE)).toEqual({ ok: false, error: "not_offered" });
    expect(h.recordPrebooking).not.toHaveBeenCalled();
  });

  it("the page read says invalid → invalid; error → error; nothing recorded", async () => {
    h.readDepositPage.mockResolvedValue({ kind: "invalid" });
    expect(await prebookNext(CODE)).toEqual({ ok: false, error: "invalid" });
    h.readDepositPage.mockResolvedValue({ kind: "error" });
    expect(await prebookNext(CODE)).toEqual({ ok: false, error: "error" });
    expect(h.recordPrebooking).not.toHaveBeenCalled();
  });

  it("full, 04 on, free time on the opening day → records the next cohort, then that day's picker (one row)", async () => {
    expect(await prebookNext(CODE)).toEqual({ ok: true, value: { kind: "picker", londonDate: NEXT, days: DAYS } });
    const [admin, proof, start] = h.recordPrebooking.mock.calls[0];
    expect([admin, (proof as DepositParentProof).parentUserId, start]).toEqual([h.fake!.client, PARENT, NEXT]);
    expect(h.getFreeSlots).toHaveBeenCalledWith({ londonDate: NEXT, purpose: "cohort_prebook" });
    expect(DAYS).toHaveLength(1);
  });

  it("being paid is offered too", async () => {
    h.readDepositPage.mockResolvedValue(page({ kind: "being_paid", nextAvailable: NEXT }));
    expect(await prebookNext(CODE)).toMatchObject({ ok: true, value: { kind: "picker" } });
  });

  it("the view follows the pre-booking she already has (its day), not today's next cohort", async () => {
    h.recordPrebooking.mockResolvedValue({ ok: true, prebooking: prebooking({ cohortStartDate: "2027-02-15" }), created: false });
    await prebookNext(CODE);
    expect(h.getFreeSlots).toHaveBeenCalledWith({ londonDate: "2027-02-15", purpose: "cohort_prebook" });
  });

  it("no free time that day, or the times can't be read → \"We'll call you on …\"", async () => {
    h.getFreeSlots.mockResolvedValue({ ok: true, value: [] });
    expect(await prebookNext(CODE)).toEqual({ ok: true, value: { kind: "call_on", date: NEXT } });
    h.getFreeSlots.mockResolvedValue({ ok: false, error: "error" });
    expect(await prebookNext(CODE)).toEqual({ ok: true, value: { kind: "call_on", date: NEXT } });
  });

  it("04 off → \"We'll call you on …\" without asking 04", async () => {
    vi.stubEnv("CALL_BOOKING_ENABLED", "");
    expect(await prebookNext(CODE)).toEqual({ ok: true, value: { kind: "call_on", date: NEXT } });
    expect(h.getFreeSlots).not.toHaveBeenCalled();
  });

  it("no next cohort → records with none, then \"We'll be in touch\"", async () => {
    h.readDepositPage.mockResolvedValue(page({ kind: "full", nextAvailable: null }));
    h.recordPrebooking.mockResolvedValue({ ok: true, prebooking: prebooking({ cohortStartDate: null }), created: true });
    expect(await prebookNext(CODE)).toEqual({ ok: true, value: { kind: "in_touch" } });
    expect(h.recordPrebooking.mock.calls[0][2]).toBeNull();
    expect(h.getFreeSlots).not.toHaveBeenCalled();
  });

  it("the record refused or failed → invalid / error", async () => {
    h.recordPrebooking.mockResolvedValue({ ok: false, status: "invalid" });
    expect(await prebookNext(CODE)).toEqual({ ok: false, error: "invalid" });
    h.recordPrebooking.mockResolvedValue({ ok: false, status: "error" });
    expect(await prebookNext(CODE)).toEqual({ ok: false, error: "error" });
  });
});

describe("holdPrebookTime — 04's hold, for the proof's parent, on the pre-booking's day only", () => {
  it("holds with the proof's parent as parent and actor, purpose cohort_prebook → the held time and its line", async () => {
    expect(await holdPrebookTime(CODE, AT_10)).toEqual({ ok: true, value: { holdId: HOLD, startsAt: AT_10, line: heldLine(5) } });
    expect(h.holdSlotForParent).toHaveBeenCalledWith({
      parentUserId: PARENT, startsAt: AT_10, purpose: "cohort_prebook", actor: { kind: "parent", userId: PARENT },
    });
    expect(h.readOpenPrebooking).toHaveBeenCalledWith(h.fake!.client, PARENT);
  });

  it("never a client value: extra arguments naming another parent are ignored", async () => {
    await (holdPrebookTime as unknown as (...args: unknown[]) => Promise<unknown>)(CODE, AT_10, OTHER_PARENT, { kind: "parent", userId: OTHER_PARENT });
    expect(h.holdSlotForParent.mock.calls[0][0]).toMatchObject({ parentUserId: PARENT, actor: { kind: "parent", userId: PARENT } });
  });

  it("another day, a malformed time, no open pre-booking, or one with no cohort → invalid, nothing held", async () => {
    expect(await holdPrebookTime(CODE, OTHER_DAY)).toEqual({ ok: false, error: "invalid" });
    expect(await holdPrebookTime(CODE, "10am Monday")).toEqual({ ok: false, error: "invalid" });
    expect(await holdPrebookTime(CODE, 1)).toEqual({ ok: false, error: "invalid" });
    h.readOpenPrebooking.mockResolvedValue({ ok: true, value: null });
    expect(await holdPrebookTime(CODE, AT_10)).toEqual({ ok: false, error: "invalid" });
    h.readOpenPrebooking.mockResolvedValue({ ok: true, value: prebooking({ cohortStartDate: null }) });
    expect(await holdPrebookTime(CODE, AT_10)).toEqual({ ok: false, error: "invalid" });
    expect(h.holdSlotForParent).not.toHaveBeenCalled();
  });

  it("the pre-booking can't be read → error", async () => {
    h.readOpenPrebooking.mockResolvedValue({ ok: false });
    expect(await holdPrebookTime(CODE, AT_10)).toEqual({ ok: false, error: "error" });
  });

  it.each([
    ["taken", "taken"],
    ["overlap", "taken"],
    ["not_found", "not_yours"],
    ["rate_limited", "rate_limited"],
    ["booked_call_exists", "error"],
    ["call_booking_disabled", "call_booking_disabled"],
  ] as const)("04's %s → the parent code %s (as 04's own page maps it)", async (error, code) => {
    h.holdSlotForParent.mockResolvedValue({ ok: false, error });
    expect(await holdPrebookTime(CODE, AT_10)).toEqual({ ok: false, error: code });
  });
});

describe("confirmPrebookTime — 04's confirm, then the booking id on her pre-booking", () => {
  it("confirms her hold (its id is the idempotency key) as the proof's parent; attaches the booking", async () => {
    expect(await confirmPrebookTime(CODE, HOLD)).toEqual({
      ok: true, value: { bookingId: BOOKING, startsAt: AT_10, line: prebookBookedLine(AT_10) },
    });
    expect(h.confirmHoldForParent).toHaveBeenCalledWith({
      parentUserId: PARENT, holdId: HOLD, idempotencyKey: HOLD, actor: { kind: "parent", userId: PARENT },
    });
    const [admin, proof, ids] = h.attachPrebookingCall.mock.calls[0];
    expect([admin, (proof as DepositParentProof).parentUserId, ids]).toEqual([h.fake!.client, PARENT, { prebookingId: PREBOOKING, callBookingId: BOOKING }]);
  });

  it("a moved booking keeps its id and is attached again", async () => {
    h.confirmHoldForParent.mockResolvedValue({ ok: true, value: { kind: "moved", bookingId: BOOKING, startsAt: AT_10, fromStartsAt: AT_1030 } });
    expect(await confirmPrebookTime(CODE, HOLD)).toMatchObject({ ok: true, value: { bookingId: BOOKING } });
    expect(h.attachPrebookingCall).toHaveBeenCalledTimes(1);
  });

  it("a booking on another day (not this picker's hold) is never attached to the pre-booking", async () => {
    h.confirmHoldForParent.mockResolvedValue({ ok: true, value: { kind: "booked", bookingId: BOOKING, startsAt: OTHER_DAY, replay: false } });
    expect(await confirmPrebookTime(CODE, HOLD)).toMatchObject({ ok: true });
    expect(h.attachPrebookingCall).not.toHaveBeenCalled();
  });

  it("a failed attach still answers booked (the call stands; 04's to-call list keeps her)", async () => {
    h.attachPrebookingCall.mockResolvedValue({ ok: false, status: "error" });
    expect(await confirmPrebookTime(CODE, HOLD)).toMatchObject({ ok: true, value: { bookingId: BOOKING } });
  });

  it("a malformed hold id → invalid; a refusal → its parent code; nothing attached", async () => {
    expect(await confirmPrebookTime(CODE, "h-1")).toEqual({ ok: false, error: "invalid" });
    h.confirmHoldForParent.mockResolvedValue({ ok: false, error: "hold_expired" });
    expect(await confirmPrebookTime(CODE, HOLD)).toEqual({ ok: false, error: "hold_expired" });
    expect(h.attachPrebookingCall).not.toHaveBeenCalled();
  });

  it("no open pre-booking → invalid, nothing confirmed", async () => {
    h.readOpenPrebooking.mockResolvedValue({ ok: true, value: null });
    expect(await confirmPrebookTime(CODE, HOLD)).toEqual({ ok: false, error: "invalid" });
    expect(h.confirmHoldForParent).not.toHaveBeenCalled();
  });
});

describe("reloadPrebookTimes — that day's free times again", () => {
  it("→ the one-row days for the pre-booking's day", async () => {
    expect(await reloadPrebookTimes(CODE)).toEqual({ ok: true, value: DAYS });
    expect(h.getFreeSlots).toHaveBeenCalledWith({ londonDate: NEXT, purpose: "cohort_prebook" });
  });

  it("an empty day is still one row, with no times", async () => {
    h.getFreeSlots.mockResolvedValue({ ok: true, value: [] });
    const reloaded = await reloadPrebookTimes(CODE);
    expect(reloaded).toMatchObject({ ok: true });
    expect(reloaded.ok && reloaded.value.map((d) => [d.londonDate, d.slots.length])).toEqual([[NEXT, 0]]);
  });

  it("the times can't be read → error; no pre-booking → invalid", async () => {
    h.getFreeSlots.mockResolvedValue({ ok: false, error: "error" });
    expect(await reloadPrebookTimes(CODE)).toEqual({ ok: false, error: "error" });
    h.readOpenPrebooking.mockResolvedValue({ ok: true, value: null });
    expect(await reloadPrebookTimes(CODE)).toEqual({ ok: false, error: "invalid" });
  });
});

describe("the file's boundary", () => {
  const source = readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname), "actions.ts"), "utf8");

  it("is \"use server\" and exports exactly the five actions", () => {
    expect(source.trimStart().startsWith('"use server";')).toBe(true);
    expect(Object.keys(actions).sort()).toEqual(["confirmPrebookTime", "holdPrebookTime", "payDeposit", "prebookNext", "reloadPrebookTimes"]);
  });

  it("never reads a login: the family comes from the code (D15)", () => {
    expect(source).not.toMatch(/from\s+["'](?:@\/lib\/supabase\/server|next\/headers|@\/lib\/calls\/parent-session|@\/lib\/admin\/require-admin)["']|\.auth\.(?:getUser|getSession)\s*\(/);
  });

  it("names no parent id from its inputs: no parameter is a parent or user id", () => {
    expect(source).not.toMatch(/export async function \w+\([^)]*(?:parent|user)Id/i);
  });
});
