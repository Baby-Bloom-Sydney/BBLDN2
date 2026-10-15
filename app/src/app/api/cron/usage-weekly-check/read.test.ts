/** usage-weekly-check read helpers (4e review MEDIUM 2–3). BB-LDN-4e-151026. */
import { describe, expect, it } from "vitest";
import { IN_CHUNK, PAGE_SIZE, chunk, readAll, readAllIn } from "./read";

const pager = (rows: number[], seen: Array<[number, number]>) => (from: number, to: number) => {
  seen.push([from, to]);
  return Promise.resolve({ data: rows.slice(from, to + 1), error: null });
};

describe("chunk", () => {
  it("splits into IN_CHUNK pieces by default", () => {
    const ids = Array.from({ length: IN_CHUNK * 2 + 1 }, (_, i) => String(i));
    expect(chunk(ids).map((c) => c.length)).toEqual([IN_CHUNK, IN_CHUNK, 1]);
    expect(chunk([], 3)).toEqual([]);
  });
});

describe("readAll", () => {
  it("one page when short; two when the first page is full", async () => {
    const seen: Array<[number, number]> = [];
    expect(await readAll(pager([1, 2], seen))).toEqual([1, 2]);
    expect(seen).toEqual([[0, PAGE_SIZE - 1]]);
    const full = Array.from({ length: PAGE_SIZE }, (_, i) => i);
    const seen2: Array<[number, number]> = [];
    expect((await readAll(pager(full, seen2))).length).toBe(PAGE_SIZE);
    expect(seen2).toHaveLength(2);
  });
  it("throws on a read error", async () => {
    await expect(readAll(() => Promise.resolve({ data: null, error: { message: "x" } }))).rejects.toThrow("x");
  });
});

describe("readAllIn", () => {
  it("one paged read per chunk, concatenated", async () => {
    const ids = Array.from({ length: IN_CHUNK + 1 }, (_, i) => `id${i}`);
    const calls: string[][] = [];
    const rows = await readAllIn(ids, (part) => {
      calls.push(part);
      return Promise.resolve({ data: part, error: null });
    });
    expect(calls.map((c) => c.length)).toEqual([IN_CHUNK, 1]);
    expect(rows).toEqual(ids);
  });
});
