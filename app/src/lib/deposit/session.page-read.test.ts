/**
 * The parent page's two server reads (plan 03 row C1; 03c's add-only exports from `session.ts`). Both take the
 * `DepositParentProof` the page minted from the code — never a login — and write nothing.
 *
 * - `readDepositPage`: 03a's own resolver (the link by the proof's id, the family row, 02's cohorts, her live hold)
 *   → `depositPageState`, plus her first name for the greeting. A failed name read only drops the name.
 * - `readDepositDone`: 03a's `checkDepositDone`, and for a paid session the cohort of the place that session holds
 *   or took (the unique `stripe_checkout_session_id`), for "Your place in the cohort starting …".
 *
 * BB-wave2-231126/03-build, 2026-11-25.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ retrieve: vi.fn(), findCohorts: vi.fn() }));
vi.mock("@/lib/stripe/client", () => ({
  getStripeClient: () => ({ checkout: { sessions: { retrieve: h.retrieve, create: vi.fn(), expire: vi.fn() } } }),
}));
vi.mock("@/lib/cohorts/read", () => ({ findCohorts: h.findCohorts }));

import type { CohortView } from "@/lib/cohorts/types";
import { fakeAdmin, type FakeAdmin, type Op } from "@/lib/payments/fake-admin.test-util";
import { proveDepositCode, type DepositParentProof } from "./proof";
import { readDepositDone, readDepositPage } from "./session";

const PARENT = "b0300000-0000-4000-8000-000000000061";
const LINK = "d0300000-0000-4000-8000-000000000061";
const CODE = "Pg0_-".repeat(8) + "abc";
const NOW = new Date("2027-02-02T10:00:00.000Z");
const SESSION = "cs_test_page61";

const view = (start: string, places: number, taken: number, beingPaid = 0): CohortView => ({
  start, places, taken, beingPaid, left: Math.max(0, places - taken - beingPaid), overBy: Math.max(0, taken - places),
});
const CURRENT_OPEN = view("2027-02-01", 5, 2);
const CURRENT_FULL = view("2027-02-01", 5, 5);
const NEXT_OPEN = view("2027-02-08", 5, 0);

const linkRow = (over: Record<string, unknown> = {}) => ({
  id: LINK, parent_user_id: PARENT, code: CODE, state: "open", target: "current", goodwill_cohort_start_date: null, ...over,
});

let fake: FakeAdmin;
let proof: DepositParentProof;

const writes = () => fake.ops.filter((o) => o.kind !== "select");
const eqOf = (op: Op, col: string) => op.filters.find(([f, c]) => f === "eq" && c === col)?.[2];

beforeEach(async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  h.retrieve.mockReset();
  h.findCohorts.mockReset();
  h.findCohorts.mockResolvedValue({ ok: true, value: { current: CURRENT_OPEN, next: NEXT_OPEN, nextAvailable: NEXT_OPEN, upcoming: [NEXT_OPEN] } });
  fake = fakeAdmin({
    deposit_links: linkRow(),
    parent_subscriptions: { id: "s1", stripe_customer_id: "cus_test_fam", deposit_paid_at: null },
    cohort_places: null,
    user_profiles: { first_name: "Sarah" },
  });
  const links = fakeAdmin({
    deposit_links: { id: LINK, parent_user_id: PARENT, state: "open", target: "current", goodwill_cohort_start_date: null, last_opened_at: null },
  });
  const proven = await proveDepositCode(links.client, CODE);
  if (!proven.ok) throw new Error("no deposit proof");
  proof = proven.proof;
});

describe("readDepositPage — the page's facts, from the proof only", () => {
  it("anything but a proof → invalid before any read", async () => {
    const forged = { kind: "deposit_parent_proof", parentUserId: PARENT, linkId: LINK } as unknown as DepositParentProof;
    expect(await readDepositPage(fake.client, forged, NOW)).toEqual({ kind: "invalid" });
    expect(fake.ops).toEqual([]);
    expect(h.findCohorts).not.toHaveBeenCalled();
  });

  it("bookable in the current cohort, greeting her by first name; nothing written", async () => {
    expect(await readDepositPage(fake.client, proof, NOW)).toEqual({
      kind: "ok", state: { kind: "bookable", start: "2027-02-01", goodwill: false }, firstName: "Sarah",
    });
    expect(writes()).toEqual([]);
    expect(fake.rpcCalls).toEqual([]);
    const name = fake.ops.find((o) => o.table === "user_profiles");
    expect(name && eqOf(name, "user_id")).toBe(PARENT);
    const link = fake.ops.find((o) => o.table === "deposit_links");
    expect(link && eqOf(link, "id")).toBe(LINK);
    expect(h.findCohorts).toHaveBeenCalledWith(fake.client, NOW);
  });

  it("a goodwill link with the current full names its pinned next cohort", async () => {
    fake.reads.deposit_links = linkRow({ target: "goodwill", goodwill_cohort_start_date: "2027-02-08" });
    h.findCohorts.mockResolvedValue({ ok: true, value: { current: CURRENT_FULL, next: NEXT_OPEN, nextAvailable: NEXT_OPEN, upcoming: [NEXT_OPEN] } });
    expect(await readDepositPage(fake.client, proof, NOW)).toMatchObject({ kind: "ok", state: { kind: "bookable", start: "2027-02-08", goodwill: true } });
  });

  it("full → full with the next available cohort", async () => {
    h.findCohorts.mockResolvedValue({ ok: true, value: { current: CURRENT_FULL, next: NEXT_OPEN, nextAvailable: NEXT_OPEN, upcoming: [NEXT_OPEN] } });
    expect(await readDepositPage(fake.client, proof, NOW)).toMatchObject({ kind: "ok", state: { kind: "full", nextAvailable: "2027-02-08" } });
  });

  it("paid (any way) → paid", async () => {
    fake.reads.parent_subscriptions = { id: "s1", stripe_customer_id: "cus_test_fam", deposit_paid_at: "2027-02-01T09:00:00+00:00" };
    expect(await readDepositPage(fake.client, proof, NOW)).toMatchObject({ kind: "ok", state: { kind: "paid" } });
  });

  it("her own live hold → bookable at the hold's cohort", async () => {
    fake.reads.cohort_places = { id: "c0300000-0000-4000-8000-000000000061", cohort_start_date: "2027-02-08", is_goodwill: true, stripe_checkout_session_id: SESSION, state: "held" };
    expect(await readDepositPage(fake.client, proof, NOW)).toMatchObject({ kind: "ok", state: { kind: "bookable", start: "2027-02-08", goodwill: true } });
  });

  it("no first name, or a failed name read → no name (\"Hello.\"), never an error", async () => {
    fake.reads.user_profiles = { first_name: null };
    expect(await readDepositPage(fake.client, proof, NOW)).toMatchObject({ kind: "ok", firstName: null });
    fake.readErrors.user_profiles = { message: "boom for sarah@gmail.com", code: "XX000" };
    expect(await readDepositPage(fake.client, proof, NOW)).toMatchObject({ kind: "ok", firstName: null });
  });

  it("a link cancelled since the proof → invalid", async () => {
    fake.reads.deposit_links = linkRow({ state: "cancelled" });
    expect(await readDepositPage(fake.client, proof, NOW)).toEqual({ kind: "invalid" });
  });

  it("a failed read → error; a throw → error, logged by code only", async () => {
    fake.readErrors.deposit_links = { message: "boom", code: "XX000" };
    expect(await readDepositPage(fake.client, proof, NOW)).toEqual({ kind: "error" });
    fake.readErrors.deposit_links = undefined;
    h.findCohorts.mockResolvedValue({ ok: false });
    expect(await readDepositPage(fake.client, proof, NOW)).toEqual({ kind: "error" });
    h.findCohorts.mockRejectedValue(new TypeError("Sarah's cohorts"));
    expect(await readDepositPage(fake.client, proof, NOW)).toEqual({ kind: "error" });
    const logged = JSON.stringify(vi.mocked(console.error).mock.calls);
    expect(logged).not.toContain("Sarah");
    expect(logged).not.toContain(CODE);
  });
});

describe("readDepositDone — paid / not paid / foreign, and the paid place's cohort", () => {
  const ourSession = (over: Record<string, unknown> = {}) => ({
    id: SESSION, payment_status: "paid", client_reference_id: PARENT, metadata: { link_kind: "deposit", deposit_link_id: LINK }, ...over,
  });

  it("anything but a proof → invalid, with no Stripe call and no read", async () => {
    const forged = { kind: "deposit_parent_proof", parentUserId: PARENT, linkId: LINK } as unknown as DepositParentProof;
    expect(await readDepositDone(fake.client, forged, SESSION)).toEqual({ result: "invalid", cohortStartDate: null });
    expect(h.retrieve).not.toHaveBeenCalled();
    expect(fake.ops).toEqual([]);
  });

  it("paid → the cohort of the place this session holds or took, read by the session id and her id; nothing written", async () => {
    h.retrieve.mockResolvedValue(ourSession());
    fake.reads.cohort_places = { cohort_start_date: "2027-02-01" };
    expect(await readDepositDone(fake.client, proof, SESSION)).toEqual({ result: "paid", cohortStartDate: "2027-02-01" });
    const read = fake.ops.find((o) => o.table === "cohort_places");
    expect(read && eqOf(read, "stripe_checkout_session_id")).toBe(SESSION);
    expect(read && eqOf(read, "parent_user_id")).toBe(PARENT);
    expect(writes()).toEqual([]);
  });

  it("paid with no place found, a bad row or a failed read → paid with no cohort", async () => {
    h.retrieve.mockResolvedValue(ourSession());
    fake.reads.cohort_places = null;
    expect(await readDepositDone(fake.client, proof, SESSION)).toEqual({ result: "paid", cohortStartDate: null });
    fake.reads.cohort_places = { cohort_start_date: "next monday" };
    expect(await readDepositDone(fake.client, proof, SESSION)).toEqual({ result: "paid", cohortStartDate: null });
    fake.readErrors.cohort_places = { message: "boom", code: "XX000" };
    expect(await readDepositDone(fake.client, proof, SESSION)).toEqual({ result: "paid", cohortStartDate: null });
  });

  it("a throw from the place read → paid with no cohort", async () => {
    h.retrieve.mockResolvedValue(ourSession());
    const throwing = { from: () => { throw new Error("no client"); } } as unknown as FakeAdmin["client"];
    expect(await readDepositDone(throwing, proof, SESSION)).toEqual({ result: "paid", cohortStartDate: null });
  });

  it("not paid → no place read", async () => {
    h.retrieve.mockResolvedValue(ourSession({ payment_status: "unpaid" }));
    expect(await readDepositDone(fake.client, proof, SESSION)).toEqual({ result: "not_paid", cohortStartDate: null });
    expect(fake.ops).toEqual([]);
  });

  it("someone else's session → foreign; a malformed session id → invalid with no Stripe call", async () => {
    h.retrieve.mockResolvedValue(ourSession({ client_reference_id: "b0300000-0000-4000-8000-000000000062" }));
    expect(await readDepositDone(fake.client, proof, SESSION)).toEqual({ result: "foreign", cohortStartDate: null });
    h.retrieve.mockReset();
    expect(await readDepositDone(fake.client, proof, ["cs_test_a", "cs_test_b"])).toEqual({ result: "invalid", cohortStartDate: null });
    expect(await readDepositDone(fake.client, proof, "not-a-session")).toEqual({ result: "invalid", cohortStartDate: null });
    expect(h.retrieve).not.toHaveBeenCalled();
    expect(fake.ops).toEqual([]);
  });
});
