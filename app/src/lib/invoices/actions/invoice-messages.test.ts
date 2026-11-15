/**
 * What the invoice actions answer (plan 06 §14.6 b4.2–b4.3): one fixed, plain message per refusal code — never the
 * database's words, never what she typed — and a draft the schema refused, by field.
 *
 * 06b-4 rework: no week and no kind, so no `no_trial` or `wrong_date`; a date before the family's earliest allowed date
 * answers `too_early`, by field, as `future` does.
 *
 * BB-wave1-041126/06b4, 2026-11-12; BB-wave1-041126/06b4-server, 2026-11-12.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { invoiceDraftSchema, LINE_MESSAGES } from "../validation-lines";
import { draftRefusal, FIELDS_SHOWN, INVOICE_ACTION_MESSAGES, invoiceRefusal, tooEarlyRefusal } from "./invoice-messages";

const NOW = new Date("2027-02-15T10:00:00Z");
const DRAFT = {
  invoiceId: "b0600000-0000-4000-8000-000000009001",
  targetId: "b0600000-0000-4000-8000-000000000411",
  lines: [{ kind: "shift", date: "2027-02-08", hours: 6, ratePence: 1800, description: null }],
  replacesInvoiceId: null,
};
const refusalOf = (draft: unknown) => {
  const parsed = invoiceDraftSchema(NOW).safeParse(draft);
  if (parsed.success) throw new Error("expected a refusal");
  return draftRefusal(parsed.error);
};

describe("invoiceRefusal", () => {
  it("plan 14.6's wording for a changed review", () => {
    expect(invoiceRefusal("changed")).toEqual({ ok: false, error: "changed", message: "Your business settings changed — check the invoice again" });
  });

  it("every code has a fixed, non-empty message, and none echoes input or the database", () => {
    for (const [code, message] of Object.entries(INVOICE_ACTION_MESSAGES)) {
      expect(message.length, code).toBeGreaterThan(0);
      expect(message).not.toMatch(/violates|constraint|Failing row|\{|\}/);
    }
  });

  it("the cap message names the configured cap", () => {
    expect(invoiceRefusal("cap").message).toBe("You can send up to 10 invoices a day. Please try again tomorrow.");
  });

  it("the codes the setup handles say what's missing", () => {
    expect(invoiceRefusal("no_details").message).toBe("Add your bank details to send this invoice.");
    expect(invoiceRefusal("no_address").message).toBe("Add your address to send this invoice.");
  });

  it("refusals are frozen", () => {
    expect(Object.isFrozen(invoiceRefusal("error"))).toBe(true);
  });

  it("no code is left for a week or a Trial Shift (no kind, no week)", () => {
    expect(Object.keys(INVOICE_ACTION_MESSAGES)).not.toEqual(expect.arrayContaining(["no_trial"]));
    expect(Object.keys(INVOICE_ACTION_MESSAGES)).not.toEqual(expect.arrayContaining(["wrong_date"]));
    expect(Object.values(INVOICE_ACTION_MESSAGES).join(" ")).not.toMatch(/Trial Shift|week or date/);
  });
});

describe("tooEarlyRefusal (a date before the family's earliest allowed date)", () => {
  it("answers `too_early` with the plain message on each date's path", () => {
    const r = tooEarlyRefusal([0, 3]);
    expect(r).toEqual({
      ok: false,
      error: "too_early",
      message: LINE_MESSAGES.tooEarly,
      fields: { "lines.0.date": LINE_MESSAGES.tooEarly, "lines.3.date": LINE_MESSAGES.tooEarly },
    });
    expect(INVOICE_ACTION_MESSAGES.too_early).toBe(LINE_MESSAGES.tooEarly);
    expect(Object.isFrozen(r)).toBe(true);
  });
});

describe("draftRefusal", () => {
  it("fields by path, each with the schema's own plain message", () => {
    const r = refusalOf({ ...DRAFT, lines: [{ kind: "shift", date: "2027-02-08", hours: 6.1, ratePence: 0, description: null }] });
    expect(r).toMatchObject({ ok: false, error: "invalid", message: "Please check the details marked below." });
    expect(r.fields).toEqual({ "lines.0.hours": LINE_MESSAGES.hourStep, "lines.0.ratePence": LINE_MESSAGES.rate });
  });

  it("the first message per field wins; a whole-draft issue sits on its own key", () => {
    const r = refusalOf({ ...DRAFT, lines: [] });
    expect(r.fields).toEqual({ lines: LINE_MESSAGES.noLine });
  });

  it("a day that hasn't happened yet answers `future`, on that shift's date", () => {
    const r = refusalOf({ ...DRAFT, lines: [{ kind: "shift", date: "2027-02-22", hours: 6, ratePence: 1800, description: null }] });
    expect(r.error).toBe("future");
    expect(r.message).toBe(LINE_MESSAGES.future);
    expect(r.fields).toEqual({ "lines.0.date": LINE_MESSAGES.future });
  });

  it("never echoes what was typed", () => {
    const r = refusalOf({ ...DRAFT, lines: [{ kind: "shift", date: "2027-02-08", hours: 6, ratePence: 1800, description: "a\u0000b SECRET-112233" }] });
    expect(JSON.stringify(r)).not.toContain("SECRET");
  });

  it("names at most 50 fields, the first ones, however many the schema refused (security review M)", () => {
    expect(FIELDS_SHOWN).toBe(50);
    const bad = { kind: "shift", date: "2027-02-08", hours: 6.1, ratePence: 1800, description: null };
    const r = refusalOf({ ...DRAFT, lines: Array.from({ length: 140 }, () => bad) });
    const keys = Object.keys(r.fields ?? {});
    expect(keys).toHaveLength(FIELDS_SHOWN);
    expect([keys[0], keys.at(-1)]).toEqual(["lines.0.hours", "lines.49.hours"]);
  });

  it("10,000 issues: still 50 fields, and the same first message per field", () => {
    const issues = Array.from({ length: 10_000 }, (_, i) => ({ code: "custom" as const, path: ["lines", i % 7, "hours"], message: `m${i}`, input: null }));
    const r = draftRefusal(new z.ZodError(issues));
    expect(r.fields).toEqual(Object.fromEntries(Array.from({ length: 7 }, (_, i) => [`lines.${i}.hours`, `m${i}`])));
    const many = draftRefusal(new z.ZodError(issues.map((issue, i) => ({ ...issue, path: ["lines", i, "date"] }))));
    expect(Object.keys(many.fields ?? {})).toHaveLength(FIELDS_SHOWN);
  });
});
