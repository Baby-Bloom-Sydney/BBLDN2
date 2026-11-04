/**
 * The feature's boundaries (plan 06 step 9, §5, §7; brief §8; the 02 security review L5 pattern, corrected by the
 * 06a code review). Static checks over `src/`:
 * - No module that reads or writes with the service role is a `"use server"` file (every async export of one is
 *   callable from a browser) — the readers and the entry point included.
 * - No `"use client"` file (the directive may follow a header comment) imports one of them, by alias or by a
 *   relative path.
 * - Outside the feature's own folders, code may import the invoice code only through its entry point
 *   (`@/lib/invoices`): never a deep path, never the config. Today nothing outside imports it at all, so with the
 *   switch off the rest of the app is exactly as before; 07 and 08 will come through the entry point.
 *
 * BB-wave1-041126/06a-build, 2026-11-04.
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SRC = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const SERVER_MODULES = ["store", "families", "nanny-proof", "db", "gate", "readers", "index", "pdf/render", "pdf/font"];
const SERVER_PATH = "lib/invoices(?:/(?:store|families|nanny-proof|db|gate|readers|index|pdf/render|pdf/font))?";
/** An import (alias or relative) of a server module. */
const SERVER_IMPORT = new RegExp(`from\\s+["'](?:@/|(?:\\.\\./)+)${SERVER_PATH}["']`);
/** A deep import of the invoice code, or of its config — allowed only inside the feature. */
const DEEP_IMPORT = /from\s+["'](?:@\/|(?:\.\.\/)+)(?:lib\/invoices\/[^"']+|config\/invoices)["']/;
const USE_CLIENT = /^["']use client["'];?\s*$/m;
const FEATURE_FOLDERS = ["lib/invoices/", "app/nanny/invoices/", "app/admin/invoices/", "config/invoices"];

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === "node_modules" ? [] : files(full);
    return /\.(ts|tsx)$/.test(e.name) ? [full] : [];
  });
}
const rel = (f: string): string => path.relative(SRC, f).split(path.sep).join("/");
const outsideFeature = (f: string): boolean => !FEATURE_FOLDERS.some((folder) => rel(f).startsWith(folder));

describe("src/lib/invoices boundaries", () => {
  it("no server module is a \"use server\" file", () => {
    for (const name of SERVER_MODULES) {
      expect(readFileSync(path.join(SRC, "lib/invoices", `${name}.ts`), "utf8")).not.toMatch(/^["']use server["']/m);
    }
  });

  it("no \"use client\" file imports a server module", () => {
    const offenders = files(SRC).filter((f) => {
      const text = readFileSync(f, "utf8");
      return USE_CLIENT.test(text) && SERVER_IMPORT.test(text);
    });
    expect(offenders.map(rel)).toEqual([]);
  });

  it("the patterns catch what they guard (a header comment before \"use client\"; a relative import)", () => {
    const client = '/** A header. */\n"use client";\nimport { saveDetails } from "../../lib/invoices/store";';
    expect(USE_CLIENT.test(client) && SERVER_IMPORT.test(client)).toBe(true);
    expect(DEEP_IMPORT.test('import { x } from "@/lib/invoices/store";')).toBe(true);
    expect(DEEP_IMPORT.test('import { INVOICE_RULES } from "@/config/invoices";')).toBe(true);
    expect(DEEP_IMPORT.test('import { getPlacementWeekHours } from "@/lib/invoices";')).toBe(false);
  });

  it("outside the feature, nothing deep-imports the invoice code or its config", () => {
    const offenders = files(SRC).filter((f) => outsideFeature(f) && DEEP_IMPORT.test(readFileSync(f, "utf8")));
    expect(offenders.map(rel)).toEqual([]);
  });

  it("the entry point exports no bank-detail, store, PDF or family function", () => {
    const code = readFileSync(path.join(SRC, "lib/invoices/index.ts"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    expect(code).toMatch(/getPlacementWeekHours/);
    expect(code).not.toMatch(/store|families|nanny-proof|gate|pdf\/|Details|createInvoice|renderInvoicePdf/);
  });
});
