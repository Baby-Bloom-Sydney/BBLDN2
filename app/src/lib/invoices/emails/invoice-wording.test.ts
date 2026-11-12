/**
 * The wording the three invoice emails share (plan 06 §3a, §14.8; R16): the period, the totals sentence, first
 * names, one-line subjects, escaping and the shell. Pure.
 *
 * BB-wave1-041126/06b4, 2026-11-12.
 */
import { describe, expect, it } from "vitest";
import { emailFooter, emailHeader } from "@/lib/email/brand";
import { CANCEL_REASONS } from "../types";
import {
  CANCEL_REASON_LABELS,
  escapeHtml,
  firstNameOf,
  oneLine,
  periodForSentence,
  periodForSubject,
  renderEmail,
  totalsClause,
} from "./invoice-wording";

const NONE = { hours: 32, expensesPence: 1250, totalPence: 59_650, vatMode: "none" } as const;

describe("periods", () => {
  it("a Regular week reads by its Monday; a Trial Shift by its date", () => {
    expect(periodForSubject("regular_week", "2027-02-08")).toBe("week of 8 Feb 2027");
    expect(periodForSentence("regular_week", "2027-02-08")).toBe("the week of 8 Feb 2027");
    expect(periodForSubject("trial_shift", "2027-02-03")).toBe("Trial Shift, Wed 3 Feb 2027");
    expect(periodForSentence("trial_shift", "2027-02-03")).toBe("the Trial Shift on Wed 3 Feb 2027");
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
