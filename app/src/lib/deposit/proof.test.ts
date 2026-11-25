/**
 * The deposit parent proof (plan 03 D5, D15; row A4). The parent comes only from the link row her code finds —
 * nothing ties the page to a login. `proveDepositCode` checks the code's format before any read (a bad one makes
 * zero database calls), reads one link by code, and issues a proof only for an open or paid link. Only a proof it
 * issued passes `isDepositParentProof`: a look-alike, a frozen copy or a cast does not. Failures are logged by error
 * code only — never the code, never a message.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeAdmin, type FakeAdmin } from "@/lib/payments/fake-admin.test-util";
import { isDepositParentProof, proveDepositCode, type DepositParentProof } from "./proof";

const CODE = "Ab0_-".repeat(8) + "xyz";
const LINK = "d0300000-0000-4000-8000-000000000001";
const PARENT = "b0300000-0000-4000-8000-000000000001";

const row = (over: Record<string, unknown> = {}) => ({
  id: LINK,
  parent_user_id: PARENT,
  state: "open",
  target: "current",
  goodwill_cohort_start_date: null,
  last_opened_at: null,
  ...over,
});

let fake: FakeAdmin;
let log: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  fake = fakeAdmin({ deposit_links: row() });
  log = vi.spyOn(console, "error").mockImplementation(() => {});
});

const failure = async (status: "invalid" | "error", code: unknown = CODE) =>
  expect(await proveDepositCode(fake.client, code)).toEqual({ ok: false, status });

describe("proveDepositCode — the format check comes first", () => {
  it.each([
    ["42 characters", CODE.slice(1)],
    ["44 characters", `${CODE}A`],
    ["a plus", `+${CODE.slice(1)}`],
    ["a space", ` ${CODE.slice(1)}`],
    ["empty", ""],
    ["a number", 43],
    ["null", null],
    ["an object", { code: CODE }],
  ])("%s → invalid with zero database calls", async (_label, code) => {
    await failure("invalid", code);
    expect(fake.ops).toHaveLength(0);
    expect(fake.rpcCalls).toHaveLength(0);
  });
});

describe("proveDepositCode — one read by code", () => {
  it("an open link → a frozen proof for the row's parent and a typed read-only link", async () => {
    const r = await proveDepositCode(fake.client, CODE);
    expect(fake.ops).toHaveLength(1);
    expect(fake.ops[0]).toMatchObject({ table: "deposit_links", kind: "select", filters: [["eq", "code", CODE]] });
    if (!r.ok) throw new Error("expected a proof");
    expect(r.proof).toEqual({ kind: "deposit_parent_proof", parentUserId: PARENT, linkId: LINK });
    expect(isDepositParentProof(r.proof)).toBe(true);
    expect(r.link).toEqual({ id: LINK, parentUserId: PARENT, state: "open", target: "current", goodwillStartDate: null, lastOpenedAt: null });
    expect(Object.isFrozen(r)).toBe(true);
    expect(Object.isFrozen(r.proof)).toBe(true);
    expect(Object.isFrozen(r.link)).toBe(true);
  });

  it("a paid link still proves her (the page shows paid)", async () => {
    fake.reads.deposit_links = row({ state: "paid", last_opened_at: "2027-02-02T10:00:00+00:00" });
    const r = await proveDepositCode(fake.client, CODE);
    expect(r).toMatchObject({ ok: true, link: { state: "paid", lastOpenedAt: "2027-02-02T10:00:00+00:00" } });
  });

  it("a goodwill link carries its pinned date", async () => {
    fake.reads.deposit_links = row({ target: "goodwill", goodwill_cohort_start_date: "2027-02-08" });
    expect(await proveDepositCode(fake.client, CODE)).toMatchObject({ ok: true, link: { target: "goodwill", goodwillStartDate: "2027-02-08" } });
  });

  it("no row → invalid", async () => {
    fake.reads.deposit_links = null;
    await failure("invalid");
    expect(log).not.toHaveBeenCalled();
  });

  it("a cancelled link → invalid, the same answer as no link", async () => {
    fake.reads.deposit_links = row({ state: "cancelled" });
    await failure("invalid");
  });

  it("a database error → error, logged by its code only (never the code value or the message)", async () => {
    fake.readErrors.deposit_links = { message: `row for Sarah Jones code ${CODE}`, code: "XX000" };
    await failure("error");
    expect(log).toHaveBeenCalledWith("[deposit] proveDepositCode failed", { code: "XX000" });
    expect(JSON.stringify(log.mock.calls)).not.toContain(CODE);
    expect(JSON.stringify(log.mock.calls)).not.toContain("Sarah");
  });

  it("a throw → error, logged by the error's name only", async () => {
    fake.client.from = (() => {
      throw new TypeError(`network ${CODE}`);
    }) as never;
    await failure("error");
    expect(log).toHaveBeenCalledWith("[deposit] proveDepositCode failed", { code: "TypeError" });
    expect(JSON.stringify(log.mock.calls)).not.toContain(CODE);
  });

  it.each([
    ["an unknown state", { state: "expired" }],
    ["an unknown target", { target: "later" }],
    ["a goodwill target with no date", { target: "goodwill" }],
    ["a date on a current link", { goodwill_cohort_start_date: "2027-02-08" }],
    ["a date that isn't one", { target: "goodwill", goodwill_cohort_start_date: "2027-02-30" }],
    ["a parent that isn't a uuid", { parent_user_id: "sarah" }],
    ["a link id that isn't a uuid", { id: "" }],
  ])("an unexpected row (%s) → error, logged", async (_label, over) => {
    fake.reads.deposit_links = row(over);
    await failure("error");
    expect(log).toHaveBeenCalledWith("[deposit] proveDepositCode failed", { code: "unexpected_row" });
  });
});

describe("isDepositParentProof", () => {
  it("accepts only a proof proveDepositCode issued", async () => {
    const r = await proveDepositCode(fake.client, CODE);
    if (!r.ok) throw new Error("expected a proof");
    const lookAlike = { kind: "deposit_parent_proof", parentUserId: PARENT, linkId: LINK };
    expect(isDepositParentProof(lookAlike)).toBe(false);
    expect(isDepositParentProof(Object.freeze({ ...r.proof }))).toBe(false);
    expect(isDepositParentProof(lookAlike as unknown as DepositParentProof)).toBe(false);
    expect(isDepositParentProof(JSON.parse(JSON.stringify(r.proof)))).toBe(false);
    expect(isDepositParentProof(null)).toBe(false);
    expect(isDepositParentProof("deposit_parent_proof")).toBe(false);
    expect(isDepositParentProof(r.proof)).toBe(true);
  });

  it("each proof is its own object, bound to its link's parent", async () => {
    const a = await proveDepositCode(fake.client, CODE);
    fake.reads.deposit_links = row({ id: "d0300000-0000-4000-8000-000000000002", parent_user_id: "b0300000-0000-4000-8000-000000000002" });
    const b = await proveDepositCode(fake.client, CODE);
    if (!a.ok || !b.ok) throw new Error("expected proofs");
    expect(a.proof).not.toBe(b.proof);
    expect(a.proof.parentUserId).toBe(PARENT);
    expect(b.proof.parentUserId).toBe("b0300000-0000-4000-8000-000000000002");
  });
});

describe("src/lib/deposit's boundary (D15; mint.ts:1-9)", () => {
  const DIR = path.dirname(new URL(import.meta.url).pathname);
  const sources = readdirSync(DIR)
    .filter((f) => /\.ts$/.test(f) && !/\.test\.ts$/.test(f))
    .map((f) => [f, readFileSync(path.join(DIR, f), "utf8")] as const);

  it("no file is \"use server\" (every async export would become a public action)", () => {
    for (const [, text] of sources) expect(text).not.toMatch(/^\s*["']use server["']/m);
  });

  it("no file reads a login: the family comes from the code, never the session", () => {
    const SESSION = /from\s+["'](?:@\/lib\/supabase\/server|next\/headers)["']|\.auth\.(?:getUser|getSession)\s*\(/;
    for (const [name, text] of sources) expect([name, SESSION.test(text)]).toEqual([name, false]);
  });

  it("the client-safe half imports nothing server-only", () => {
    const SERVER = /from\s+["'](?:node:[^"']+|@\/lib\/supabase\/[^"']+|@\/lib\/stripe\/[^"']+|\.\/proof|@\/lib\/deposit\/proof|@\/lib\/cohorts\/(?:places|read|db|board|links|refund-hook))["']/;
    for (const [name, text] of sources.filter(([f]) => ["constants.ts", "code.ts", "page-state.ts", "copy.ts", "types.ts"].includes(f))) {
      expect([name, SERVER.test(text)]).toEqual([name, false]);
    }
  });
});
