/**
 * The invoice email to the family (plan 06 §3a, §14.8; brief §0.5, §3 parent 1; R20): the subject, the totals
 * sentence, "pay her directly", reply to reach her. **No bank details** (the fixture's sort code and account number
 * never appear, nor any mask), **no link into the app** (attachment only), names escaped, CR/LF stripped from the
 * subject, the brand header and the client footer.
 *
 * BB-wave1-041126/06b4, 2026-11-12.
 */
import { describe, expect, it } from "vitest";
import { emailFooter, emailHeader } from "@/lib/email/brand";
import { INVOICE_TO_FAMILY_EMAIL_TYPE, invoiceToFamilyEmail, type InvoiceToFamilyParams } from "./invoice-to-family";

const NUMBER = "BB-SophieTaylor-270215-0001";
const BASE: InvoiceToFamilyParams = {
  number: NUMBER,
  kind: "regular_week",
  periodStart: "2027-02-08",
  nannyName: "Sophie Taylor",
  familyName: "Olivia Hartley",
  figures: { hours: 32, expensesPence: 1250, totalPence: 59_650, vatMode: "none" },
  replacesNumber: null,
};
const all = (e: { subject: string; html: string; text: string }) => `${e.subject}\n${e.html}\n${e.text}`;

describe("invoiceToFamilyEmail", () => {
  it("its email type", () => {
    expect(INVOICE_TO_FAMILY_EMAIL_TYPE).toBe("invoice_to_family");
  });

  it("subject: the number, her name and the week", () => {
    expect(invoiceToFamilyEmail(BASE).subject).toBe(`Invoice ${NUMBER} from Sophie Taylor — week of 8 Feb 2027`);
  });

  it("a Trial Shift's subject names its date", () => {
    const e = invoiceToFamilyEmail({ ...BASE, kind: "trial_shift", periodStart: "2027-02-03" });
    expect(e.subject).toBe(`Invoice ${NUMBER} from Sophie Taylor — Trial Shift, Wed 3 Feb 2027`);
    expect(e.text).toContain("Sophie Taylor has sent you an invoice for the Trial Shift on Wed 3 Feb 2027:");
  });

  it("the body is plan 14.8's wording, in the html and the text", () => {
    const e = invoiceToFamilyEmail(BASE);
    const sentences = [
      "Sophie Taylor has sent you an invoice for the week of 8 Feb 2027: 32 hours of childcare and £12.50 of expenses, £596.50 in total.",
      "Please pay Sophie directly, using the bank details on the attached invoice.",
      "Reply to this email to reach Sophie.",
    ];
    for (const s of sentences) {
      expect(e.text).toContain(s);
      expect(e.html).toContain(s);
    }
    expect(e.text).toBe(`${sentences.join("\n\n")}\n\nBabyBloom`);
  });

  it("with VAT: \"…in total, including VAT.\"; with no expenses the clause is left out", () => {
    const vat = invoiceToFamilyEmail({ ...BASE, figures: { hours: 32, expensesPence: 1250, totalPence: 71_330, vatMode: "added" } });
    expect(vat.text).toContain("32 hours of childcare and £12.50 of expenses, £713.30 in total, including VAT.");
    const plain = invoiceToFamilyEmail({ ...BASE, figures: { hours: 32, expensesPence: 0, totalPence: 58_400, vatMode: "none" } });
    expect(plain.text).toContain("for the week of 8 Feb 2027: 32 hours of childcare, £584.00 in total.");
    expect(plain.text).not.toMatch(/expenses|VAT/);
  });

  it("a correction says which invoice it replaces", () => {
    const e = invoiceToFamilyEmail({ ...BASE, replacesNumber: "BB-SophieTaylor-270212-0001" });
    expect(e.text).toContain("It replaces invoice BB-SophieTaylor-270212-0001, which was cancelled.");
    expect(invoiceToFamilyEmail(BASE).text).not.toMatch(/replaces/);
  });

  it("carries no bank detail: not the fixture numbers, not a mask, not \"sort code\"", () => {
    const text = all(invoiceToFamilyEmail(BASE));
    for (const secret of ["112233", "11-22-33", "87654321", "4321", "••", "sort code", "account number"]) {
      expect(text).not.toContain(secret);
    }
    expect(Object.keys(BASE).sort()).toEqual(["familyName", "figures", "kind", "nannyName", "number", "periodStart", "replacesNumber"]);
  });

  it("no link into the app: the only links are the footer's legal pages (R20)", () => {
    const { html } = invoiceToFamilyEmail(BASE);
    const hrefs = [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1] ?? "");
    expect(hrefs.length).toBeGreaterThan(0);
    for (const href of hrefs) expect(href).toMatch(/\/legal\//);
    expect(html).not.toMatch(/\/nanny\/|\/parent\/|\/invoices/);
  });

  it("the brand header and the client terms footer", () => {
    const { html } = invoiceToFamilyEmail(BASE);
    expect(html).toContain(emailHeader());
    expect(html).toContain(emailFooter({ terms: "client" }));
  });

  it("escapes the names in the html; the subject is one line", () => {
    const e = invoiceToFamilyEmail({ ...BASE, nannyName: "<b>Zoë</b> \"Ó\"\r\nBcc: x@evil.test", familyName: "A & B" });
    expect(e.html).not.toContain("<b>Zoë</b>");
    expect(e.html).toContain("&lt;b&gt;Zoë&lt;/b&gt;");
    expect(e.subject).not.toMatch(/[\r\n]/);
    expect(e.subject).toContain("Bcc: x@evil.test");
  });
});
