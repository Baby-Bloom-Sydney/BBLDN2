/**
 * The feature's boundaries (plan 06 step 9, §5, §7; brief §8; the 02 security review L5 pattern). Static checks
 * over `src/`:
 * - No module that reads or writes with the service role is a `"use server"` file (every async export of one is
 *   callable from a browser) — the readers and the entry point included.
 * - No `"use client"` file imports one of them (they would ship to the browser and fail, or worse).
 * - Only the feature's own folders import the invoice code, so with the switch off the rest of the app is exactly
 *   as before; other features (07, 08) will come through `@/lib/invoices` (index) only.
 *
 * BB-wave1-041126/06a-build, 2026-11-04.
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SRC = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const SERVER_MODULES = ["store", "families", "nanny-proof", "db", "readers", "index", "pdf/render", "pdf/font"];
const SERVER_IMPORT = /from\s+["']@\/lib\/invoices(?:\/(?:store|families|nanny-proof|db|readers|index|pdf\/render|pdf\/font))?["']/;
const ANY_INVOICE_IMPORT = /from\s+["']@\/(?:lib\/invoices(?:\/[^"']*)?|config\/invoices)["']/;
const FEATURE_FOLDERS = ["lib/invoices/", "app/nanny/invoices/", "app/admin/invoices/"];

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === "node_modules" ? [] : files(full);
    return /\.(ts|tsx)$/.test(e.name) ? [full] : [];
  });
}
const rel = (f: string): string => path.relative(SRC, f).split(path.sep).join("/");

describe("src/lib/invoices boundaries", () => {
  it("no server module is a \"use server\" file", () => {
    for (const name of SERVER_MODULES) {
      const file = path.join(SRC, "lib/invoices", `${name}.ts`);
      expect(readFileSync(file, "utf8")).not.toMatch(/^\s*["']use server["']/m);
    }
  });

  it("no \"use client\" file imports a server module", () => {
    const offenders = files(SRC).filter((f) => {
      const text = readFileSync(f, "utf8");
      return /^\s*["']use client["']/.test(text) && SERVER_IMPORT.test(text);
    });
    expect(offenders.map(rel)).toEqual([]);
  });

  it("only the feature's own folders import the invoice code (the rest of the app is unchanged)", () => {
    const importers = files(SRC)
      .filter((f) => ANY_INVOICE_IMPORT.test(readFileSync(f, "utf8")))
      .map(rel)
      .filter((f) => f !== "config/invoices.test.ts" && !FEATURE_FOLDERS.some((folder) => f.startsWith(folder)));
    expect(importers).toEqual([]);
  });

  it("the entry point exports no bank-detail, store, PDF or family function", () => {
    const code = readFileSync(path.join(SRC, "lib/invoices/index.ts"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    expect(code).toMatch(/getPlacementWeekHours/);
    expect(code).not.toMatch(/store|families|nanny-proof|pdf\/|Details|createInvoice|renderInvoicePdf/);
  });
});
