/**
 * The parent sees no invoice anywhere in the app (plan 06 step 19, §14.6 c.3, R20; brief §0.10, §3 parent 3, §9.13;
 * A14). A static guard over every file under `src/app/parent/**` and `src/components/parent/**`:
 * - no import of the invoice feature's code — `@/lib/invoices` at any depth, its config, or the nanny's or admin's
 *   invoice pages — by alias, by a relative path, dynamically or for its side effects;
 * - no link to an invoice screen: `/nanny/invoices` or `/admin/invoices`, or anything under them, in any string.
 * It matches imports and routes, never the word "invoice", so the family's Stripe billing wording (brief 07) can't
 * trip it. The parent only gets the emails.
 *
 * BB-wave1-041126/06c, 2026-11-23.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SRC = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const PARENT_ROOTS = ["app/parent", "components/parent"] as const;

/** Every module specifier: `from "…"`, `import "…"`, `import("…")`, `require("…")`. */
const SPECIFIER = /(?:\bfrom\s+|\bimport\s*\(\s*|\bimport\s+|\brequire\s*\(\s*)["'`]([^"'`]+)["'`]/g;
/** The invoice feature's code, as a path under src/: its logic, its config, the nanny's and the admin's pages. */
const INVOICE_CODE = /^(?:lib\/invoices|config\/invoices|app\/(?:nanny|admin)\/invoices)(?:\/|\.ts$|$)/;
/** A route to an invoice screen, or anything under it — not a longer name that merely starts the same. */
const INVOICE_ROUTE = /\/(?:nanny|admin)\/invoices(?![\w-])/;

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return files(full);
    return /\.(ts|tsx|js|jsx|mjs)$/.test(e.name) ? [full] : [];
  });
}
const rel = (f: string): string => path.relative(SRC, f).split(path.sep).join("/");

/** Where an import lands under src/ (alias or relative); null for a package. */
function target(fileRel: string, spec: string): string | null {
  if (spec.startsWith("@/")) return spec.slice(2);
  return spec.startsWith(".") ? path.posix.join(path.posix.dirname(fileRel), spec) : null;
}

/** What a file at `fileRel` (under src/) does that a parent surface must not. */
function offences(fileRel: string, text: string): string[] {
  const imports = [...text.matchAll(SPECIFIER)]
    .map((m) => m[1] ?? "")
    .filter((spec) => INVOICE_CODE.test(target(fileRel, spec) ?? ""))
    .map((spec) => `${fileRel} imports ${spec}`);
  const routes = text.split("\n").flatMap((line, i) => (INVOICE_ROUTE.test(line) ? [`${fileRel}:${i + 1} links an invoice route`] : []));
  return [...imports, ...routes];
}

const parentFiles = (): string[] => PARENT_ROOTS.flatMap((root) => files(path.join(SRC, root)));

/**
 * The sample statements below are put together at run time, so this file's own text holds no import of the invoice
 * code: the invoice feature's boundary test reads every file outside the feature, this one included.
 */
const FROM = ["fr", "om"].join("");
const IMPORT = ["im", "port"].join("");

describe("no invoice surface on the parent's side", () => {
  it("scans every file under app/parent and components/parent (this file included)", () => {
    const scanned = parentFiles().map(rel);
    expect(scanned.length).toBeGreaterThan(50);
    expect(scanned).toEqual(expect.arrayContaining([
      "app/parent/page.tsx", "app/parent/layout.tsx", "components/parent/PlacementCard.tsx", "app/parent/no-invoice-surface.test.ts",
    ]));
  });

  it("no parent file imports the invoice code or links an invoice screen", () => {
    const self = "app/parent/no-invoice-surface.test.ts";
    const found = parentFiles().filter((f) => rel(f) !== self).flatMap((f) => offences(rel(f), readFileSync(f, "utf8")));
    expect(found).toEqual([]);
  });

  it("the patterns catch every import of the invoice code, by alias or path, static or dynamic", () => {
    const at = "app/parent/settings/ParentSettingsClient.tsx";
    for (const line of [
      `${IMPORT} { listFamilyInvoices } ${FROM} "@/lib/invoices";`,
      `${IMPORT} { readMyInvoices } ${FROM} "@/lib/invoices/store";`,
      `${IMPORT} type { InvoiceKind } ${FROM} "@/lib/invoices/types";`,
      `${IMPORT} "@/lib/invoices";`,
      `const m = await ${IMPORT}("@/lib/invoices");`,
      `${IMPORT} { x } ${FROM} "../../../lib/invoices";`,
      `${IMPORT} { x } ${FROM} "../../../lib/invoices/readers";`,
      `${IMPORT} { INVOICE_RULES } ${FROM} "@/config/invoices";`,
      `${IMPORT} { InvoiceList } ${FROM} "@/app/nanny/invoices/InvoiceList";`,
      `${IMPORT} Page ${FROM} "../../admin/invoices/page";`,
    ]) {
      expect(offences(at, line), line).not.toEqual([]);
    }
  });

  it("the patterns catch every link to an invoice screen", () => {
    for (const line of [
      '<Link href="/nanny/invoices">Invoices</Link>',
      "router.push(`/nanny/invoices/new?connection=${id}`);",
      'const url = "/admin/invoices";',
      "window.open(`/admin/invoices/${id}/pdf`);",
      "{ href: '/nanny/invoices', label: 'x' }",
    ]) {
      expect(offences("components/parent/X.tsx", line), line).not.toEqual([]);
    }
  });

  it("…and never the word 'invoice' (07's Stripe wording) or a route that only starts the same", () => {
    for (const line of [
      "<p>Your next invoice from BabyBloom is on 1 March.</p>",
      'if (event.type === "invoice.paid") return;',
      'const res = await fetch("/api/stripe/invoices");',
      `${IMPORT} { formatInvoiceDate } ${FROM} "@/lib/billing/invoice-format";`,
      `${IMPORT} { x } ${FROM} "@/lib/invoicesque";`,
      '<Link href="/nanny/invoicesque">x</Link>',
      '<Link href="/parent/invoices">x</Link>',
      `${IMPORT} { x } ${FROM} "./invoices";`,
    ]) {
      expect(offences("app/parent/subscription/page.tsx", line), line).toEqual([]);
    }
  });
});
