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
 * - 06b-3 (plan 14.6 b3.5): the **one named seam** — `app/nanny/settings/page.tsx` imports
 *   `@/app/nanny/invoices/business/BusinessSettingsLeaf`, and nothing else outside the feature imports its pages'
 *   folders. The Settings actions are `"use server"` files whose only exports are their gated async actions.
 * - 06b-3 rework (ledger B06 §9.1 R5): one action for the Business page, `saveBusinessSettings`, replaces the two
 *   dialog actions.
 * - 06b-4 (plan 14.6 b4.2–b4.3): the invoice actions (preview, send, cancel, resend) join the list, each a `"use
 *   server"` file exporting only its gated async action; the review, the PDF store and the invoice emails' sender are
 *   server modules.
 *
 * BB-wave1-041126/06a-build, 2026-11-04; 06b2-build, 2026-11-06 (store-business; pdf/model, which logs through db);
 * 06b3-build, 2026-11-07 (the Settings seam, the actions, the details-changed sender); 06b3-rework, 2026-11-09;
 * 06b4, 2026-11-12 (the invoice actions; review, store-delivery, the invoice emails' sender).
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SRC = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const SERVER_MODULES = [
  "store", "store-business", "families", "nanny-proof", "db", "gate", "readers", "index", "pdf/render", "pdf/font", "pdf/model",
  "emails/send-payment-details-changed", "review", "store-delivery", "emails/send-invoice-emails",
];
const SERVER_MODULE =
  "(?:/(?:store|store-business|families|nanny-proof|db|gate|readers|index|pdf/render|pdf/font|pdf/model|emails/send-payment-details-changed|review|store-delivery|emails/send-invoice-emails))?";
/** The actions (06b-3 Settings; 06b-4 invoices): `"use server"` on purpose, each exporting only its gated async action. */
const ACTIONS: Readonly<Record<string, readonly [string, string]>> = {
  "actions/cancel-invoice": ["cancelInvoice", "CancelInvoiceResult"],
  "actions/preview-invoice": ["previewInvoice", "PreviewInvoiceResult"],
  "actions/resend-invoice-email": ["resendInvoiceEmail", "ResendInvoiceEmailResult"],
  "actions/save-business-settings": ["saveBusinessSettings", "BusinessSettingsResult"],
  "actions/send-invoice": ["sendInvoice", "SendInvoiceResult"],
};
/** The one import of the feature's page folders from outside them (plan 14.6 b3.4–b3.5). */
const SEAM = { file: "app/nanny/settings/page.tsx", from: "@/app/nanny/invoices/business/BusinessSettingsLeaf" } as const;
const SPECIFIER = /(?:from\s+|import\s*\(\s*|import\s+)["']([^"']+)["']/g;

/** The imports in `text` (a file at `fileRel` under src/) that land in the feature's page folders, alias or relative. */
function pageImports(fileRel: string, text: string): string[] {
  return [...text.matchAll(SPECIFIER)].map((m) => m[1] ?? "").filter((spec) => {
    const target = spec.startsWith("@/") ? spec.slice(2) : spec.startsWith(".") ? path.posix.join(path.posix.dirname(fileRel), spec) : null;
    return target !== null && /^app\/(?:nanny|admin)\/invoices(?:\/|$)/.test(target);
  });
}
/** An import of a server module: by alias, or by any relative path ending in `invoices` (a sibling in src/lib too). */
const SERVER_IMPORT = new RegExp(`(?:from|import)\\s+["'](?:@/lib/invoices|(?:\\.\\.?/)+(?:lib/)?invoices)${SERVER_MODULE}["']`);
/** A deep import of the invoice code or its config, or any relative import of them — allowed only inside the feature. */
const DEEP_IMPORT = /(?:from|import)\s+["'](?:@\/(?:lib\/invoices\/[^"']+|config\/invoices)|(?:\.\.?\/)+(?:[\w-]+\/)*invoices(?:\/[^"']+)?)["']/;
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
    // a sibling inside src/lib, or a file beside the config (code review verification 1)
    expect(DEEP_IMPORT.test('import { saveDetails } from "../invoices/store";')).toBe(true);
    expect(DEEP_IMPORT.test('import { INVOICE_RULES } from "./invoices";')).toBe(true);
    const sibling = '"use client";\nimport { saveDetails } from "../invoices/store";';
    expect(USE_CLIENT.test(sibling) && SERVER_IMPORT.test(sibling)).toBe(true);
    // 06b-3 verification L5: a side-effect import counts as an import
    const sideEffect = '"use client";\nimport "@/lib/invoices/store";';
    expect(USE_CLIENT.test(sideEffect) && SERVER_IMPORT.test(sideEffect)).toBe(true);
    expect(DEEP_IMPORT.test('import "@/lib/invoices/store";')).toBe(true);
    expect(DEEP_IMPORT.test('import "@/lib/invoices";')).toBe(false);
    // 06b-2: her business details' store is a server module too
    expect(SERVER_IMPORT.test('import { saveBusiness } from "@/lib/invoices/store-business";')).toBe(true);
  });

  it("every module that reaches the service role is a listed server module (06b-2 verification L6)", () => {
    const dir = path.join(SRC, "lib/invoices");
    const reaching = files(dir)
      .filter((f) => !/\.test(?:-util)?\.tsx?$/.test(f))
      .filter((f) => /from\s+["'](?:(?:\.\.?\/)+db|@\/lib\/invoices\/db|@\/lib\/supabase\/admin)["']/.test(readFileSync(f, "utf8")))
      .map((f) => path.relative(dir, f).split(path.sep).join("/").replace(/\.tsx?$/, ""));
    expect(reaching.filter((m) => !SERVER_MODULES.includes(m))).toEqual([]);
  });

  it("outside the feature, nothing deep-imports the invoice code or its config", () => {
    const offenders = files(SRC).filter((f) => outsideFeature(f) && DEEP_IMPORT.test(readFileSync(f, "utf8")));
    expect(offenders.map(rel)).toEqual([]);
  });

  it("each action is a \"use server\" file exporting only its one async action (06b-3; the invoice actions, 06b-4)", () => {
    const actionFiles = readdirSync(path.join(SRC, "lib/invoices/actions"))
      .filter((f) => !/\.test\.tsx?$/.test(f))
      .filter((f) => /^["']use server["'];/m.test(readFileSync(path.join(SRC, "lib/invoices/actions", f), "utf8")));
    expect(actionFiles.map((f) => `actions/${f.replace(/\.ts$/, "")}`).sort()).toEqual(Object.keys(ACTIONS).sort());
    for (const [name, [fn, result]] of Object.entries(ACTIONS)) {
      const text = readFileSync(path.join(SRC, "lib/invoices", `${name}.ts`), "utf8");
      expect(text).toMatch(/^["']use server["'];/);
      // every export line, whatever its form (TS review L: `export default`, `export *`, `export function*` …)
      const exports = [...text.matchAll(/^export\b.*$/gm)].map((m) => m[0]);
      expect(exports).toEqual([`export async function ${fn}(input: unknown): Promise<${result}> {`]);
    }
  });

  it("outside the feature, only the Settings page imports its page folders — the leaf, nothing else (06b-3 b3.5)", () => {
    // shipped code only: the page's own test imports the leaf to check the slot it passes
    const found = files(SRC)
      .filter((f) => outsideFeature(f) && !/\.test\.tsx?$/.test(f))
      .flatMap((f) => pageImports(rel(f), readFileSync(f, "utf8")).map((from) => ({ file: rel(f), from })));
    expect(found).toEqual([SEAM]);
  });

  it("no \"use client\" file imports the server leaf (it reads her details with the service role)", () => {
    const offenders = files(SRC).filter((f) => {
      const text = readFileSync(f, "utf8");
      return USE_CLIENT.test(text) && [...text.matchAll(SPECIFIER)].some((m) => /BusinessSettingsLeaf$/.test(m[1] ?? ""));
    });
    expect(offenders.map(rel)).toEqual([]);
    expect([...'import "./BusinessSettingsLeaf";'.matchAll(SPECIFIER)].map((m) => m[1])).toEqual(["./BusinessSettingsLeaf"]);
  });

  it("the seam pattern catches every other import of the page folders", () => {
    const settings = (line: string) => pageImports("app/nanny/settings/NannySettingsClient.tsx", line);
    expect(settings('import { BusinessSettingsForm } from "@/app/nanny/invoices/business/BusinessSettingsForm";')).toHaveLength(1);
    expect(settings('import X from "@/app/nanny/invoices/business/PaymentDetailsFields";')).toHaveLength(1);
    expect(settings('import Page from "@/app/admin/invoices/page";')).toHaveLength(1);
    expect(settings('import { x } from "../invoices/business/business-view";')).toHaveLength(1);
    expect(settings('const m = await import("../invoices/business/BusinessSettingsLeaf");')).toHaveLength(1);
    expect(pageImports("components/layout/DashboardNav.tsx", 'import { x } from "../../app/nanny/invoices";')).toHaveLength(1);
    expect(settings('import { getPlacementWeekHours } from "@/lib/invoices";')).toHaveLength(0);
    expect(settings('import { x } from "../positions/NannyPositionsClient";')).toHaveLength(0);
    expect(pageImports("lib/foo/bar.ts", 'import { x } from "../invoices/store";')).toHaveLength(0); // lib/invoices: DEEP_IMPORT's
  });

  it("the entry point exports no bank-detail, store, PDF or family function", () => {
    const code = readFileSync(path.join(SRC, "lib/invoices/index.ts"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    expect(code).toMatch(/getPlacementWeekHours/);
    expect(code).not.toMatch(/store|families|nanny-proof|gate|pdf\/|Details|createInvoice|renderInvoicePdf/);
  });
});
