/**
 * The wording the three invoice emails share (plan 06 §3a, §14.8; R16): the period, the totals sentence, first
 * names, one-line subjects, escaping and the shell. Pure.
 *
 * 06b-4 rework (ledger reading 6, 7): "week of …" and "Trial Shift, …" become the period label; an invoice of
 * expenses only says no hours.
 *
 * BB-wave1-041126/06b4, 2026-11-12; BB-wave1-041126/06b4-server, 2026-11-12.
 */
import { describe, expect, it } from "vitest";
import { emailFooter, emailHeader } from "@/lib/email/brand";
import { CANCEL_REASONS } from "../types";
import * as wording from "./invoice-wording";
import { CANCEL_REASON_LABELS, escapeHtml, firstNameOf, invoicePeriod, oneLine, renderEmail, totalsClause } from "./invoice-wording";

const NONE = { hours: 32, expensesPence: 1250, totalPence: 59_650, vatMode: "none" } as const;

describe("the period (ledger reading 7)", () => {
  it("is the period label, whatever the invoice links to", () => {
    expect(invoicePeriod({ periodStart: "2026-11-02", periodEnd: "2026-11-29" })).toBe("2–29 Nov 2026");
    expect(invoicePeriod({ periodStart: "2026-12-29", periodEnd: "2027-01-02" })).toBe("29 Dec 2026 – 2 Jan 2027");
    expect(invoicePeriod({ periodStart: "2027-02-03", periodEnd: "2027-02-03" })).toBe("3 Feb 2027");
  });

  it("the week and Trial Shift wordings are gone", () => {
    for (const gone of ["periodForSubject", "periodForSentence"]) expect(Object.hasOwn(wording, gone), gone).toBe(false);
  });
});

describe("totalsClause (plan 14.8)", () => {
  it("hours, expenses and the total", () => {
    expect(totalsClause(NONE)).toBe("32 hours of childcare and £12.50 of expenses, £596.50 in total");
  });

  it("no expenses: the expenses clause is left out", () => {
    expect(totalsClause({ ...NONE, expensesPence: 0, totalPence: 58_400 })).toBe("32 hours of childcare, £584.00 in total");
  });

  it("\"including VAT\" only when VAT is on (added or included)", () => {
    expect(totalsClause({ ...NONE, vatMode: "added", totalPence: 71_330 })).toBe(
      "32 hours of childcare and £12.50 of expenses, £713.30 in total, including VAT",
    );
    expect(totalsClause({ ...NONE, vatMode: "included" })).toBe("32 hours of childcare and £12.50 of expenses, £596.50 in total, including VAT");
    expect(totalsClause(NONE)).not.toMatch(/VAT/);
  });

  it("expenses only: no hours and no VAT (expenses are at cost) — \"£12.50 of expenses, £12.50 in total\" (reading 6)", () => {
    expect(totalsClause({ hours: 0, expensesPence: 1250, totalPence: 1250, vatMode: "none" })).toBe("£12.50 of expenses, £12.50 in total");
    expect(totalsClause({ hours: 0, expensesPence: 1250, totalPence: 1250, vatMode: "added" })).toBe("£12.50 of expenses, £12.50 in total");
  });

  it("one hour is \"hour\"; quarter hours print as typed", () => {
    expect(totalsClause({ ...NONE, hours: 1, expensesPence: 0, totalPence: 1800 })).toBe("1 hour of childcare, £18.00 in total");
    expect(totalsClause({ ...NONE, hours: 8.75, expensesPence: 0, totalPence: 15_750 })).toBe("8.75 hours of childcare, £157.50 in total");
  });
});

describe("names and text", () => {
  it("first name: the first word of the full name", () => {
    expect(firstNameOf("Sophie Taylor")).toBe("Sophie");
    expect(firstNameOf("  Zoë Ó Briain ")).toBe("Zoë");
    expect(firstNameOf("Cher")).toBe("Cher");
  });

  it("a blank name falls back to the whole (empty) string, never \"undefined\"", () => {
    expect(firstNameOf("   ")).toBe("");
  });

  it("oneLine strips CR, LF, other controls and line separators, and collapses spaces", () => {
    expect(oneLine("Invoice\r\nBcc: x@y.z and\tmore  ")).toBe("Invoice Bcc: x@y.z and more");
  });

  it("escapeHtml escapes the five characters that matter", () => {
    expect(escapeHtml(`<b>"Zoë" & 'O'</b>`)).toBe("&lt;b&gt;&quot;Zoë&quot; &amp; &#39;O&#39;&lt;/b&gt;");
  });

  it("every cancel reason has a plain label", () => {
    expect(Object.keys(CANCEL_REASON_LABELS).sort()).toEqual([...CANCEL_REASONS].sort());
    expect(CANCEL_REASON_LABELS.wrong_period).toBe("Wrong week or date");
  });
});

describe("renderEmail", () => {
  const out = renderEmail({ heading: "Invoice <1>", paragraphs: ["Hi & bye.", "Second."], footer: emailFooter({ terms: "client" }) });

  it("the brand header, an escaped heading and paragraphs, the given footer", () => {
    expect(out.html).toContain(emailHeader());
    expect(out.html).toContain(">Invoice &lt;1&gt;</h2>");
    expect(out.html).toContain(">Hi &amp; bye.</p>");
    expect(out.html).toContain(emailFooter({ terms: "client" }));
  });

  it("the text: the paragraphs, then the name, a blank line apart", () => {
    expect(out.text).toBe("Hi & bye.\n\nSecond.\n\nBabyBloom");
  });
});
