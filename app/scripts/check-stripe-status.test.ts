/**
 * Unit 4f (LDN2 Stage 4) — the Stripe status check reports London's GB tax
 * registration (M-1 1c) and never fails on it; the AU registration check is gone.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

import { gbTaxReport } from "./check-stripe-status";

const SCRIPT = readFileSync(resolve(__dirname, "check-stripe-status.ts"), "utf-8");

type ListFn = () => Promise<{ data: Array<{ id: string; country: string; status: string }> }>;
const stripeWith = (list: ListFn) =>
  ({ tax: { registrations: { list: vi.fn(list) } } }) as unknown as Parameters<
    typeof gbTaxReport
  >[0];

describe("gbTaxReport", () => {
  it("reports a GB registration with its status", async () => {
    const r = await gbTaxReport(
      stripeWith(async () => ({
        data: [
          { id: "taxreg_au", country: "AU", status: "active" },
          { id: "taxreg_gb", country: "GB", status: "active" },
        ],
      })),
    );
    expect(r).toEqual({ state: "registered", id: "taxreg_gb", status: "active" });
  });

  it("reports absence without failing when only other countries are registered", async () => {
    const r = await gbTaxReport(
      stripeWith(async () => ({ data: [{ id: "taxreg_au", country: "AU", status: "active" }] })),
    );
    expect(r).toEqual({ state: "absent" });
  });

  it("reports a Stripe error as a fact instead of throwing", async () => {
    const r = await gbTaxReport(
      stripeWith(async () => {
        throw new Error("Stripe Tax is not activated");
      }),
    );
    expect(r).toEqual({ state: "error", detail: "Stripe Tax is not activated" });
  });
});

describe("the check script", () => {
  it("no longer expects an Australian registration", () => {
    expect(SCRIPT).not.toMatch(/country === "AU"/);
    expect(SCRIPT).not.toMatch(/GST/);
  });

  it("has no Connect section (London has no Connect)", () => {
    expect(SCRIPT).not.toMatch(/accounts\.list/);
  });

  it("refuses a non-test key", () => {
    expect(SCRIPT).toMatch(/assertTestKey\(/);
  });
});
