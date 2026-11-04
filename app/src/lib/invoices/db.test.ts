/**
 * Bounded reads (04a review 7, applied to 06 as 02 did): 500 rows a page with `.range()`, at most 100 ids an `.in()`, fail
 * closed past the cap or on a page longer than asked; failures logged by code only — a CHECK failure's
 * "Failing row contains (…)" carries bank digits, so a message or details never reaches a log (plan 06 step 6).
 * BB-wave1-041126/06a-build, 2026-11-04.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { allPages, allPagesByIds, callRpc, logFailure, MAX_PAGES, PAGE_ROWS } from "./db";
import { fakeAdmin } from "@/lib/payments/fake-admin.test-util";

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ i }));

describe("allPages", () => {
  it("asks page by page until a short page", async () => {
    const asked: Array<[number, number]> = [];
    const r = await allPages("t", async (from, to) => {
      asked.push([from, to]);
      return { data: from === 0 ? rows(PAGE_ROWS) : rows(3), error: null };
    });
    expect(asked).toEqual([[0, 499], [500, 999]]);
    expect(r.ok && r.value.length).toBe(503);
  });

  it("fails closed on a page longer than asked, on an error, on a non-list, and past the cap", async () => {
    expect(await allPages("t", async () => ({ data: rows(PAGE_ROWS + 1), error: null }))).toEqual({ ok: false });
    expect(await allPages("t", async () => ({ data: null, error: { message: "secret detail", code: "XX000" } }))).toEqual({ ok: false });
    expect(console.error).toHaveBeenLastCalledWith("[invoices] t failed", { code: "XX000" });
    expect(await allPages("t", async () => ({ data: { not: "a list" }, error: null }))).toEqual({ ok: false });
    let pages = 0;
    expect(await allPages("t", async () => { pages += 1; return { data: rows(PAGE_ROWS), error: null }; })).toEqual({ ok: false });
    expect(pages).toBe(MAX_PAGES);
    expect(console.error).toHaveBeenLastCalledWith("[invoices] t failed", { code: "row_cap" });
    expect(await allPages("t", async () => { throw new RangeError("x"); })).toEqual({ ok: false });
  });
});

describe("allPagesByIds", () => {
  it("at most 100 ids a request", async () => {
    const chunks: number[] = [];
    const ids = Array.from({ length: 250 }, (_, i) => `id-${i}`);
    const r = await allPagesByIds("t", ids, (chunk) => async () => {
      chunks.push(chunk.length);
      return { data: chunk.map((id) => ({ id })), error: null };
    });
    expect(chunks).toEqual([100, 100, 50]);
    expect(r.ok && r.value.length).toBe(250);
  });
  it("one failed chunk fails the read; no ids, no request", async () => {
    expect(await allPagesByIds("t", ["a", "b"], () => async () => ({ data: null, error: { message: "x" } }))).toEqual({ ok: false });
    let asked = 0;
    expect(await allPagesByIds("t", [], () => async () => { asked += 1; return { data: [], error: null }; })).toEqual({ ok: true, value: [] });
    expect(asked).toBe(0);
  });
});

describe("callRpc and logFailure", () => {
  it("passes data through; an error or a throw is ok:false", async () => {
    const f = fakeAdmin();
    f.rpcResults.fn = { data: { status: "x" }, error: null };
    expect(await callRpc(f.client, "fn", { a: 1 })).toEqual({ ok: true, value: { status: "x" } });
    f.rpcResults.fn = { data: null, error: { message: "m", code: "42501" } };
    expect(await callRpc(f.client, "fn", {})).toEqual({ ok: false, code: "42501" });
    f.rpcResults.fn = { data: null, error: { message: "m" } };
    expect(await callRpc(f.client, "fn", {})).toEqual({ ok: false });
    const throwing = { rpc: () => { throw new TypeError("network"); } } as unknown as typeof f.client;
    expect(await callRpc(throwing, "fn", {})).toEqual({ ok: false });
    expect(console.error).toHaveBeenLastCalledWith("[invoices] fn failed", { code: "TypeError" });
  });
  it("logs a code, an error name, or 'unknown' — never a message", () => {
    logFailure("a", { code: "23505", message: "Key (parent_user_id)=(…) already exists" });
    expect(console.error).toHaveBeenLastCalledWith("[invoices] a failed", { code: "23505" });
    logFailure("a", new TypeError("fetch failed for someone@example.test"));
    expect(console.error).toHaveBeenLastCalledWith("[invoices] a failed", { code: "TypeError" });
    logFailure("a", { code: "23514", message: "new row violates check constraint", details: "Failing row contains (112233, 87654321)" });
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toMatch(/87654321|112233|someone@/);
    logFailure("a", "a string");
    expect(console.error).toHaveBeenLastCalledWith("[invoices] a failed", { code: "unknown" });
  });
});
