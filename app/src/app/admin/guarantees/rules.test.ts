/**
 * /admin/guarantees pure rules (4e brief step 2; ADR-088, offer §4). BB-LDN-4e-151026.
 */
import { describe, expect, it } from "vitest";
import { G1, G2, G4 } from "@/config/offer";
import {
  PROMISES,
  g2WindowState,
  g4DisabledReason,
  g4Enabled,
  poundsToPence,
  promiseLabel,
  validateGuaranteeInput,
} from "./rules";

const PARENT = "11111111-1111-4111-8111-111111111111";
const ok = { parentUserId: PARENT, promise: "G1", conditionMet: true, outcome: "found a new nanny", paidOutPounds: "0", notes: "" };

describe("poundsToPence", () => {
  it("converts whole pounds and pence without float error", () => {
    expect(poundsToPence("0")).toBe(0);
    expect(poundsToPence("12")).toBe(1200);
    expect(poundsToPence("12.5")).toBe(1250);
    expect(poundsToPence("0.29")).toBe(29);
    expect(poundsToPence("1234.56")).toBe(123456);
    expect(poundsToPence(" 7.07 ")).toBe(707);
  });
  it("refuses empty, negative, three decimals, symbols and huge values", () => {
    for (const bad of ["", "-1", "1.234", "£5", "1e3", "abc", "1,000", "10000000"]) {
      expect(poundsToPence(bad)).toBeNull();
    }
  });
});

describe("G4 gate (config, not a literal)", () => {
  it("is off below G4.enabledAfterPlacements and on at it", () => {
    expect(g4Enabled(0)).toBe(false);
    expect(g4Enabled(G4.enabledAfterPlacements - 1)).toBe(false);
    expect(g4Enabled(G4.enabledAfterPlacements)).toBe(true);
  });
  it("names the threshold in the reason", () => {
    expect(g4DisabledReason()).toContain(`after ${G4.enabledAfterPlacements} placements`);
  });
});

describe("labels carry the configured windows", () => {
  it("G1 and G2 labels show their window days", () => {
    expect(promiseLabel("G1")).toContain(String(G1.windowDays));
    expect(promiseLabel("G2")).toContain(String(G2.windowDays));
    expect(PROMISES).toEqual(["G1", "G2", "G3", "G4", "G5"]);
  });
});

describe("g2WindowState — information only", () => {
  const now = Date.parse("2026-10-15T00:00:00Z");
  it("open before the end, closed after, unknown without a date", () => {
    expect(g2WindowState("2026-11-18T00:00:00Z", now)).toBe("open");
    expect(g2WindowState("2026-10-01T00:00:00Z", now)).toBe("closed");
    expect(g2WindowState(null, now)).toBe("unknown");
    expect(g2WindowState("not a date", now)).toBe("unknown");
  });
});

describe("validateGuaranteeInput", () => {
  it("accepts a well-formed G1 with £0 and turns pounds into pence", () => {
    const r = validateGuaranteeInput(ok);
    expect(r).toEqual({
      ok: true,
      value: { parentUserId: PARENT, promise: "G1", conditionMet: true, outcome: "found a new nanny", paidOutPence: 0, notes: null },
    });
  });
  it("trims notes and keeps them", () => {
    const r = validateGuaranteeInput({ ...ok, notes: "  called Tue  ", paidOutPounds: "300" });
    expect(r.ok && r.value.notes).toBe("called Tue");
    expect(r.ok && r.value.paidOutPence).toBe(30000);
  });
  it.each([
    [{ ...ok, parentUserId: "nope" }, "invalid_family"],
    [{ ...ok, promise: "G6" }, "invalid_promise"],
    [{ ...ok, conditionMet: "yes" }, "invalid_condition"],
    [{ ...ok, outcome: "   " }, "outcome_required"],
    [{ ...ok, outcome: "x".repeat(501) }, "outcome_too_long"],
    [{ ...ok, paidOutPounds: "-5" }, "invalid_amount"],
    [{ ...ok, notes: "x".repeat(2001) }, "notes_too_long"],
  ])("refuses %# with %s", (input, code) => {
    expect(validateGuaranteeInput(input)).toEqual({ ok: false, error: code });
  });
  it("refuses a non-object", () => {
    expect(validateGuaranteeInput(null)).toEqual({ ok: false, error: "invalid_input" });
  });
});
