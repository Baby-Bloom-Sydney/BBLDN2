/**
 * `/deposit/<code>/done?session=…` (plan 03 §3 "Done"; brief 03 §0.3, §3 parent 4). The switch first (off → 404
 * before any read), then the code proven; then 03a's done check: paid → "Payment received. Your place in the cohort
 * starting … is confirmed."; not paid → "We haven't received your payment yet. Try again." with the way back to
 * `/deposit/<code>`; someone else's session, or a malformed one → the one invalid page. It writes nothing.
 */
import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FakeAdmin } from "@/lib/payments/fake-admin.test-util";

const h = vi.hoisted(() => ({ fake: null as FakeAdmin | null, clients: 0, notFound: vi.fn(), readDepositDone: vi.fn() }));
vi.mock("next/navigation", () => ({
  notFound: () => {
    h.notFound();
    throw new Error("NEXT_NOT_FOUND");
  },
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => {
    h.clients += 1;
    return h.fake!.client;
  },
}));
vi.mock("@/lib/deposit/session", () => ({ readDepositDone: h.readDepositDone }));

import { donePaid, PAGE_COPY, PAGE_MORE_COPY } from "@/lib/deposit/copy";
import { isDepositParentProof } from "@/lib/deposit/proof";
import { fakeAdmin } from "@/lib/payments/fake-admin.test-util";
import DepositDonePage, { dynamic } from "./page";

const PARENT = "b0300000-0000-4000-8000-000000000091";
const LINK = "d0300000-0000-4000-8000-000000000091";
const CODE = "Dn0_-".repeat(8) + "xyz";
const SESSION = "cs_test_done91";

const linkRow = (over: Record<string, unknown> = {}) => ({
  id: LINK, parent_user_id: PARENT, state: "open", target: "current", goodwill_cohort_start_date: null, last_opened_at: null, ...over,
});
type Search = Record<string, string | string[] | undefined>;
async function show(searchParams: Search = { session: SESSION }, code: string = CODE) {
  render(await DepositDonePage({ params: { code }, searchParams }));
}
const heading = () => screen.getByRole("heading", { level: 1 });

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.stubEnv("DEPOSIT_LINK_ENABLED", "true");
  vi.stubEnv("COHORTS_ENABLED", "true");
  h.fake = fakeAdmin({ deposit_links: linkRow() });
  h.clients = 0;
  h.notFound.mockReset();
  h.readDepositDone.mockReset();
  h.readDepositDone.mockResolvedValue({ result: "paid", cohortStartDate: "2027-02-01" });
});
afterEach(() => {
  vi.unstubAllEnvs();
  expect(h.fake!.ops.filter((o) => o.kind !== "select")).toEqual([]);
  expect(h.fake!.rpcCalls).toEqual([]);
});

describe("/deposit/<code>/done — the switch and the code", () => {
  it("is rendered per request", () => {
    expect(dynamic).toBe("force-dynamic");
  });

  it.each([
    ["DEPOSIT_LINK_ENABLED unset", "DEPOSIT_LINK_ENABLED", ""],
    ["COHORTS_ENABLED off", "COHORTS_ENABLED", "false"],
  ])("%s → 404 before any read or Stripe call", async (_label, name, value) => {
    vi.stubEnv(name, value);
    await expect(DepositDonePage({ params: { code: CODE }, searchParams: { session: SESSION } })).rejects.toThrow("NEXT_NOT_FOUND");
    expect([h.clients, h.fake!.ops.length, h.readDepositDone.mock.calls.length]).toEqual([0, 0, 0]);
  });

  it("a malformed, unknown or cancelled code → the invalid page; no Stripe call", async () => {
    await show({ session: SESSION }, CODE.slice(1));
    expect(heading()).toHaveTextContent(PAGE_COPY.invalid);
    expect(h.fake!.ops).toEqual([]);
    h.fake!.reads.deposit_links = linkRow({ state: "cancelled" });
    render(await DepositDonePage({ params: { code: CODE }, searchParams: { session: SESSION } }));
    h.fake!.reads.deposit_links = null;
    render(await DepositDonePage({ params: { code: CODE }, searchParams: { session: SESSION } }));
    const headings = screen.getAllByRole("heading", { level: 1 });
    expect(headings).toHaveLength(3);
    expect(headings.every((e) => e.textContent === PAGE_COPY.invalid)).toBe(true);
    expect(h.readDepositDone).not.toHaveBeenCalled();
  });

  it("a failed proof read → try again", async () => {
    h.fake!.readErrors.deposit_links = { message: "boom", code: "XX000" };
    await show();
    expect(heading()).toHaveTextContent(PAGE_COPY.tryAgain);
    expect(h.readDepositDone).not.toHaveBeenCalled();
  });
});

describe("/deposit/<code>/done — the three outcomes", () => {
  it("paid → \"Payment received. Your place in the cohort starting Monday 1 February is confirmed.\"", async () => {
    await show();
    expect(heading()).toHaveTextContent(donePaid("2027-02-01"));
    expect(heading()).toHaveTextContent("Monday 1 February");
    const [admin, proof, session] = h.readDepositDone.mock.calls[0];
    expect([admin, isDepositParentProof(proof), session]).toEqual([h.fake!.client, true, SESSION]);
  });

  it("paid with no place found → \"Payment received. Thank you.\"", async () => {
    h.readDepositDone.mockResolvedValue({ result: "paid", cohortStartDate: null });
    await show();
    expect(heading()).toHaveTextContent(donePaid(null));
  });

  it("not paid → the not-received line and the way back to this link's page", async () => {
    h.readDepositDone.mockResolvedValue({ result: "not_paid", cohortStartDate: null });
    await show();
    expect(heading()).toHaveTextContent(PAGE_COPY.doneNotPaid);
    expect(screen.getByRole("link", { name: PAGE_MORE_COPY.doneBackLink })).toHaveAttribute("href", `/deposit/${CODE}`);
  });

  it.each(["foreign", "invalid"] as const)("%s → the invalid page", async (result) => {
    h.readDepositDone.mockResolvedValue({ result, cohortStartDate: null });
    await show();
    expect(heading()).toHaveTextContent(PAGE_COPY.invalid);
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("the session parameter goes to the check as it came (03a refuses anything but one session id)", async () => {
    h.readDepositDone.mockResolvedValue({ result: "invalid", cohortStartDate: null });
    await show({ session: ["cs_test_a", "cs_test_b"] });
    expect(h.readDepositDone.mock.calls[0][2]).toEqual(["cs_test_a", "cs_test_b"]);
    await show({});
    expect(h.readDepositDone.mock.calls[1][2]).toBeUndefined();
  });
});
