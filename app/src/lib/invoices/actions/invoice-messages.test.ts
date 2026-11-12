/**
 * What the invoice actions answer (plan 06 §14.6 b4.2–b4.3): one fixed, plain message per refusal code — never the
 * database's words, never what she typed — and a draft the schema refused, by field.
 *
 * BB-wave1-041126/06b4, 2026-11-12.
 */
import { describe, expect, it } from "vitest";
import { invoiceDraftSchema, LINE_MESSAGES } from "../validation-lines";
import { draftRefusal, INVOICE_ACTION_MESSAGES, invoiceRefusal } from "./invoice-messages";

const NOW = new Date("2027-02-15T10:00:00Z");
const DRAFT = {
  invoiceId: "b0600000-0000-4000-8000-000000009001",
  kind: "regular_week",
  targetId: "b0600000-0000-4000-8000-000000000411",
  periodStart: "2027-02-08",
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
});

describe("draftRefusal", () => {
  it("fields by path, each with the schema's own plain message", () => {
    const r = refusalOf({ ...DRAFT, lines: [{ kind: "shift", date: "2027-02-08", hours: 6.1, ratePence: 0, description: null }] });
    expect(r).toMatchObject({ ok: false, error: "invalid", message: "Please check the details marked below." });
    expect(r.fields).toEqual({ "lines.0.hours": LINE_MESSAGES.hourStep, "lines.0.ratePence": LINE_MESSAGES.rate });
  });

  it("the first message per field wins; a whole-draft issue sits on its own key", () => {
    const r = refusalOf({ ...DRAFT, lines: [] });
    expect(r.fields).toEqual({ lines: LINE_MESSAGES.noShift });
  });

  it("a week or day that hasn't happened yet answers `future`", () => {
    const r = refusalOf({ ...DRAFT, periodStart: "2027-02-22", lines: [{ kind: "shift", date: "2027-02-22", hours: 6, ratePence: 1800, description: null }] });
    expect(r.error).toBe("future");
    expect(r.message).toBe(LINE_MESSAGES.future);
    expect(r.fields?.periodStart).toBe(LINE_MESSAGES.future);
  });

  it("never echoes what was typed", () => {
    const r = refusalOf({ ...DRAFT, lines: [{ kind: "shift", date: "2027-02-08", hours: 6, ratePence: 1800, description: "a\u0000b SECRET-112233" }] });
    expect(JSON.stringify(r)).not.toContain("SECRET");
  });
});
