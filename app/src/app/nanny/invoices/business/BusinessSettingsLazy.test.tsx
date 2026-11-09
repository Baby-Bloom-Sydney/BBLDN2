/**
 * The lazy client wrapper (b3.3): the Settings page's bundle carries only this wrapper; the section's code (its
 * dialogs and the shared schemas) loads when the wrapper renders — the switch on and `?s=business`. Measured in the
 * gate builds: imported statically, `/nanny/settings` first load went 165 → 201 kB with the switch off.
 *
 * 06b-3 rework: while the code loads, the page still has its title (the leaf draws its own title row).
 *
 * BB-wave1-041126/06b3-build, 2026-11-07; BB-wave1-041126/06b3-rework, 2026-11-09.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock("@/lib/invoices/actions/save-business-settings", () => ({ saveBusinessSettings: vi.fn() }));

import { BusinessSettingsLazy } from "./BusinessSettingsLazy";
import type { BusinessView } from "./business-view";

afterEach(cleanup);

const DEFAULTS: BusinessView = {
  businessType: "sole_trader", name: "Sophie Taylor", tradingName: null, companyName: null, companyNumber: null,
  registeredOffice: null, partnershipName: null, vatMode: "none", vatNumber: null,
};
const HOME = { line1: "1 Upper Street", line2: "", town: "London", postcode: "N1 0AA" };
const VERSIONS = { business: null, bank: null, home: null };
const SOURCE = readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname), "BusinessSettingsLazy.tsx"), "utf8");

describe("BusinessSettingsLazy", () => {
  it("renders the section once its code has loaded", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => [] })));
    render(<BusinessSettingsLazy business={DEFAULTS} bank={null} home={HOME} versions={VERSIONS} />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading…"); // React review L4
    expect(screen.getByRole("heading", { level: 2, name: "Business" })).toBeInTheDocument();
    expect(await screen.findByText("Sole trader")).toBeInTheDocument();
    expect(screen.getByText("Not added")).toBeInTheDocument();
    vi.unstubAllGlobals();
  });

  it("is a client module that never imports the section statically (only by a dynamic import)", () => {
    expect(SOURCE).toMatch(/^["']use client["'];/);
    expect(SOURCE).not.toMatch(/from\s+["']\.\/BusinessSettingsForm["']/);
    expect(SOURCE).toMatch(/import\(\s*["']\.\/BusinessSettingsForm["']\s*\)/);
  });
});
