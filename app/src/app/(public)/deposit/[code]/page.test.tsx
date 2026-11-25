/**
 * `/deposit/<code>`, the parent's page (plan 03 row C1, §3 "Page state", "Back", D15; brief 03 §3 parent 1–9; ledger
 * B03 § PR 03c "Carried" 1–3, 6). The switch first (off → 404 before any read); then the code, proven on every
 * request: a malformed, unknown or cancelled code → the ONE invalid page with zero writes; a failed proof → a plain
 * try-again line. A valid view stamps "opened" (its only write; a failure is logged and the page goes on); Back from
 * Stripe (`?cancelled=1`) runs 03a's `returnFromCheckout` first; then the state from the page read. No login is read.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FakeAdmin } from "@/lib/payments/fake-admin.test-util";

const h = vi.hoisted(() => ({
  fake: null as FakeAdmin | null,
  clients: 0,
  clientThrows: false,
  seq: [] as string[],
  notFound: vi.fn(),
  stampLinkOpened: vi.fn(),
  returnFromCheckout: vi.fn(),
  readDepositPage: vi.fn(),
  readOpenPrebooking: vi.fn(),
  clientProps: [] as Array<Record<string, unknown>>,
}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    h.notFound();
    throw new Error("NEXT_NOT_FOUND");
  },
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => {
    h.clients += 1;
    if (h.clientThrows) throw new Error("no credentials for sarah@gmail.com");
    return h.fake!.client;
  },
}));
vi.mock("@/lib/deposit/links", () => ({
  stampLinkOpened: (...args: unknown[]) => {
    h.seq.push("stamp");
    return h.stampLinkOpened(...args);
  },
}));
vi.mock("@/lib/deposit/session", () => ({
  returnFromCheckout: (...args: unknown[]) => {
    h.seq.push("back");
    return h.returnFromCheckout(...args);
  },
  readDepositPage: (...args: unknown[]) => {
    h.seq.push("read");
    return h.readDepositPage(...args);
  },
}));
vi.mock("@/lib/deposit/prebook", () => ({ readOpenPrebooking: h.readOpenPrebooking }));
vi.mock("./DepositClient", () => ({
  DepositClient: (props: Record<string, unknown>) => {
    h.clientProps.push(props);
    return <div data-testid="deposit-client" />;
  },
}));

import { PAGE_COPY } from "@/lib/deposit/copy";
import { isDepositParentProof, type DepositParentProof } from "@/lib/deposit/proof";
import { fakeAdmin } from "@/lib/payments/fake-admin.test-util";
import DepositCodePage, { dynamic } from "./page";

const PARENT = "b0300000-0000-4000-8000-000000000081";
const LINK = "d0300000-0000-4000-8000-000000000081";
const CODE = "Pa0_-".repeat(8) + "xyz";
const BOOKABLE = { kind: "bookable", start: "2027-02-01", goodwill: false };

const linkRow = (over: Record<string, unknown> = {}) => ({
  id: LINK, parent_user_id: PARENT, state: "open", target: "current", goodwill_cohort_start_date: null, last_opened_at: null, ...over,
});

type Search = Record<string, string | string[] | undefined>;
async function show(code: string = CODE, searchParams: Search = {}) {
  render(await DepositCodePage({ params: { code }, searchParams }));
}
const lastClient = () => h.clientProps[h.clientProps.length - 1];
const writes = () => h.fake!.ops.filter((o) => o.kind !== "select");

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.stubEnv("DEPOSIT_LINK_ENABLED", "true");
  vi.stubEnv("COHORTS_ENABLED", "true");
  h.fake = fakeAdmin({ deposit_links: linkRow() });
  h.clients = 0;
  h.clientThrows = false;
  h.seq = [];
  h.clientProps = [];
  for (const fn of [h.notFound, h.stampLinkOpened, h.returnFromCheckout, h.readDepositPage, h.readOpenPrebooking]) fn.mockReset();
  h.stampLinkOpened.mockResolvedValue({ status: "stamped" });
  h.returnFromCheckout.mockResolvedValue({ kind: "released" });
  h.readDepositPage.mockResolvedValue({ kind: "ok", state: BOOKABLE, firstName: "Sarah" });
  h.readOpenPrebooking.mockResolvedValue({ ok: true, value: null });
});
afterEach(() => vi.unstubAllEnvs());

describe("/deposit/<code> — the switch", () => {
  it("is rendered per request", () => {
    expect(dynamic).toBe("force-dynamic");
  });

  it.each([
    ["DEPOSIT_LINK_ENABLED unset", "DEPOSIT_LINK_ENABLED", ""],
    ["COHORTS_ENABLED off", "COHORTS_ENABLED", "false"],
  ])("%s → 404 before the admin client, the proof or any read", async (_label, name, value) => {
    vi.stubEnv(name, value);
    await expect(DepositCodePage({ params: { code: CODE }, searchParams: {} })).rejects.toThrow("NEXT_NOT_FOUND");
    expect([h.clients, h.fake!.ops.length, h.seq]).toEqual([0, 0, []]);
  });
});

describe("/deposit/<code> — a bad code is the one invalid page, with zero writes", () => {
  it.each([
    ["malformed", CODE.slice(2)],
    ["malformed (a + in it)", CODE.replace("_", "+")],
  ])("%s → the invalid page, no read at all", async (_label, code) => {
    await show(code);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(PAGE_COPY.invalid);
    expect([h.fake!.ops.length, h.seq]).toEqual([0, []]);
  });

  it.each([
    ["unknown", null],
    ["cancelled", linkRow({ state: "cancelled" })],
  ])("%s → the same invalid page; nothing stamped, nothing else read", async (_label, row) => {
    h.fake!.reads.deposit_links = row;
    await show();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(PAGE_COPY.invalid);
    expect([writes(), h.seq]).toEqual([[], []]);
    expect(screen.queryByTestId("deposit-client")).toBeNull();
  });

  it("a failed proof read → a plain try-again line, nothing else", async () => {
    h.fake!.readErrors.deposit_links = { message: "boom", code: "XX000" };
    await show();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(PAGE_COPY.tryAgain);
    expect([writes(), h.seq]).toEqual([[], []]);
  });
});

describe("/deposit/<code> — a valid view", () => {
  it("stamps opened with the proof, then reads the state with it; the client gets the code, state and name", async () => {
    await show();
    expect(h.seq).toEqual(["stamp", "read"]);
    const [admin, proof] = h.stampLinkOpened.mock.calls[0];
    expect(admin).toBe(h.fake!.client);
    expect(isDepositParentProof(proof)).toBe(true);
    expect((proof as DepositParentProof).parentUserId).toBe(PARENT);
    expect(h.readDepositPage.mock.calls[0][1]).toBe(proof);
    expect(h.readDepositPage.mock.calls[0][2]).toBeInstanceOf(Date);
    expect(lastClient()).toEqual({ code: CODE, initialState: BOOKABLE, firstName: "Sarah", prebooked: false });
    expect(h.returnFromCheckout).not.toHaveBeenCalled();
  });

  it("the code is proven on every request — never a cached proof", async () => {
    await show();
    await show();
    expect(h.fake!.ops.filter((o) => o.table === "deposit_links").length).toBe(2);
    expect(h.stampLinkOpened.mock.calls[0][1]).not.toBe(h.stampLinkOpened.mock.calls[1][1]);
  });

  it("a failed or throwing stamp is logged and the page goes on", async () => {
    h.stampLinkOpened.mockResolvedValue({ status: "error" });
    await show();
    expect(screen.getByTestId("deposit-client")).toBeInTheDocument();
    h.stampLinkOpened.mockRejectedValue(new Error("stamp failed for sarah@gmail.com"));
    await show();
    expect(h.clientProps).toHaveLength(2);
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain("sarah@gmail.com");
  });

  it("the page read says invalid → the invalid page; error → try again", async () => {
    h.readDepositPage.mockResolvedValue({ kind: "invalid" });
    await show();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(PAGE_COPY.invalid);
    cleanup();
    h.readDepositPage.mockResolvedValue({ kind: "error" });
    await show();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(PAGE_COPY.tryAgain);
  });

  it.each([
    [{ kind: "full", nextAvailable: "2027-02-08" }],
    [{ kind: "being_paid", nextAvailable: null }],
  ])("%o → asks whether she has pre-booked already (her open pre-booking, by the proof's parent)", async (state) => {
    h.readDepositPage.mockResolvedValue({ kind: "ok", state, firstName: null });
    h.readOpenPrebooking.mockResolvedValue({ ok: true, value: { id: "p" } });
    await show();
    expect(h.readOpenPrebooking).toHaveBeenCalledWith(h.fake!.client, PARENT);
    expect(lastClient()).toMatchObject({ initialState: state, prebooked: true });
  });

  it("a failed pre-booking read → not pre-booked; bookable and paid never ask", async () => {
    h.readDepositPage.mockResolvedValue({ kind: "ok", state: { kind: "full", nextAvailable: null }, firstName: null });
    h.readOpenPrebooking.mockResolvedValue({ ok: false });
    await show();
    expect(lastClient()).toMatchObject({ prebooked: false });
    h.readOpenPrebooking.mockClear();
    h.readDepositPage.mockResolvedValue({ kind: "ok", state: { kind: "paid" }, firstName: null });
    await show();
    expect(h.readOpenPrebooking).not.toHaveBeenCalled();
  });
});

describe("/deposit/<code> — a throw is the try-again line, never an error page (03c review L)", () => {
  it.each([
    ["the admin client", () => { h.clientThrows = true; }],
    ["the pre-booking read", () => {
      h.readDepositPage.mockResolvedValue({ kind: "ok", state: { kind: "full", nextAvailable: null }, firstName: null });
      h.readOpenPrebooking.mockRejectedValue(new Error("read failed for sarah@gmail.com"));
    }],
    ["the page read", () => { h.readDepositPage.mockRejectedValue(new TypeError("boom")); }],
    ["Back", () => { h.returnFromCheckout.mockRejectedValue(new Error("stripe down")); }],
  ])("%s throws → try again, logged by name only", async (_label, arrange) => {
    arrange();
    await show(CODE, { cancelled: "1" });
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(PAGE_COPY.tryAgain);
    expect(screen.queryByTestId("deposit-client")).toBeNull();
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain("sarah@gmail.com");
  });
});

describe("/deposit/<code>?cancelled=1 — back from Stripe", () => {
  it("runs 03a's Back (expire, then release) before the state is read", async () => {
    await show(CODE, { cancelled: "1" });
    expect(h.seq).toEqual(["stamp", "back", "read"]);
    expect(isDepositParentProof(h.returnFromCheckout.mock.calls[0][1])).toBe(true);
    expect(lastClient()).toMatchObject({ initialState: BOOKABLE });
  });

  it("Stripe says that session is complete → paid, with no further read", async () => {
    h.returnFromCheckout.mockResolvedValue({ kind: "paid" });
    await show(CODE, { cancelled: "1" });
    expect(h.seq).toEqual(["stamp", "back"]);
    expect(lastClient()).toEqual({ code: CODE, initialState: { kind: "paid" }, firstName: null, prebooked: false });
  });

  it("anything but cancelled=1 is not Back", async () => {
    await show(CODE, { cancelled: "true" });
    await show(CODE, { cancelled: ["1", "1"] });
    expect(h.returnFromCheckout).not.toHaveBeenCalled();
  });
});

describe("/deposit/<code> — no login is read (D15)", () => {
  it("the page's source imports no session helper", async () => {
    const { readFileSync } = await import("node:fs");
    const path = await import("node:path");
    const source = readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname), "page.tsx"), "utf8");
    expect(source).not.toMatch(/from\s+["'](?:@\/lib\/supabase\/server|next\/headers|@\/lib\/calls\/parent-session)["']|\.auth\./);
  });
});
