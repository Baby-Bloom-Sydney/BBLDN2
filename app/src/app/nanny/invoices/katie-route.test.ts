/**
 * Katie and the nanny's invoice pages (plan 06 R20, R24; brief §8 "while off … no entry point renders"):
 * - **Never to a parent:** the invoice pages are the nanny's side only — never on a parent's list of valid URLs.
 * - **With the switch off, Katie offers them to no one:** the build regenerates the manifest (`prebuild`), so the pages
 *   are in it whatever the switch says; the allowlist leaves them out while it's off, so Katie never links a nanny to a
 *   404. On, a nanny may be offered them.
 * The manifest here is the one a build would write, with the invoice pages in it (`node:fs` answers it), so the test
 * doesn't depend on the committed copy's age.
 *
 * BB-wave1-041126/06b4, 2026-11-12.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

const INVOICE_PAGES = [
  { path: "/nanny/invoices", file: "src/app/nanny/invoices/page.tsx" },
  { path: "/nanny/invoices/new", file: "src/app/nanny/invoices/new/page.tsx" },
];
const MANIFEST = {
  pages: [
    { path: "/nanny", file: "src/app/nanny/page.tsx" },
    { path: "/nanny/settings", file: "src/app/nanny/settings/page.tsx" },
    { path: "/nanny/invoicesque", file: "src/app/nanny/invoicesque/page.tsx" },
    { path: "/parent", file: "src/app/parent/page.tsx" },
    ...INVOICE_PAGES,
  ],
};
vi.mock("node:fs", async (original) => {
  const fs = await original<typeof import("node:fs")>();
  const readFileSync = ((file: unknown, ...rest: unknown[]) =>
    String(file).endsWith("katie-manifest.json") ? JSON.stringify(MANIFEST) : (fs.readFileSync as (...a: unknown[]) => unknown)(file, ...rest)) as typeof fs.readFileSync;
  return { ...fs, default: { ...fs, readFileSync }, readFileSync };
});

import { buildRouteAllowlistPrompt, getRouteAllowlist } from "@/lib/chat/route-allowlist";

afterEach(() => vi.unstubAllEnvs());

describe("Katie and /nanny/invoices", () => {
  it.each(["", "false", "TRUE", "1"])("switch %j → offered to no one; every other page as before", (value) => {
    vi.stubEnv("NANNY_INVOICES_ENABLED", value);
    const { nannyPaths, parentPaths, sharedPaths } = getRouteAllowlist();
    expect(nannyPaths).toEqual(["/nanny", "/nanny/invoicesque", "/nanny/settings"]);
    expect([...parentPaths, ...sharedPaths]).toEqual(["/parent"]);
    for (const role of ["nanny", "parent"] as const) expect(buildRouteAllowlistPrompt(role)).not.toContain("/nanny/invoices\n");
  });

  it("on → on a nanny's list, never a parent's (R20)", () => {
    vi.stubEnv("NANNY_INVOICES_ENABLED", "true");
    const { nannyPaths, parentPaths, sharedPaths } = getRouteAllowlist();
    expect(nannyPaths).toEqual(expect.arrayContaining(["/nanny/invoices", "/nanny/invoices/new"]));
    expect([...parentPaths, ...sharedPaths]).not.toEqual(expect.arrayContaining(["/nanny/invoices"]));
    expect(buildRouteAllowlistPrompt("parent")).not.toContain("/nanny/invoices");
    expect(buildRouteAllowlistPrompt("nanny")).toContain("/nanny/invoices/new");
  });
});
