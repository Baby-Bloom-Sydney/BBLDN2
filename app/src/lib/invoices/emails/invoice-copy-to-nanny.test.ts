/**
 * The nanny's copy (plan 06 §3a, §14.8; R16): the same figures, sent after the family's result, saying "sent to
 * <family>" or "we couldn't deliver it to <family>; try Resend". No bank details; names escaped; one-line subject;
 * the nanny footer.
 *
 * BB-wave1-041126/06b4, 2026-11-12.
 */
import { describe, expect, it } from "vitest";
import { emailFooter, emailHeader } from "@/lib/email/brand";
import { INVOICE_COPY_TO_NANNY_EMAIL_TYPE, invoiceCopyToNannyEmail, type InvoiceCopyToNannyParams } from "./invoice-copy-to-nanny";

const NUMBER = "BB-SophieTaylor-270215-0001";
const BASE: InvoiceCopyToNannyParams = {
  number: NUMBER,
  kind: "regular_week",
  periodStart: "2027-02-08",
  nannyName: "Sophie Taylor",
  familyName: "Olivia Hartley",
  figures: { hours: 32, expensesPence: 1250, totalPence: 59_650, vatMode: "none" },
  replacesNumber: null,
  familyDelivery: "sent",
};

describe("invoiceCopyToNannyEmail", () => {
  it("its email type and subject", () => {
    expect(INVOICE_COPY_TO_NANNY_EMAIL_TYPE).toBe("invoice_copy_to_nanny");
    expect(invoiceCopyToNannyEmail(BASE).subject).toBe(`Copy: invoice ${NUMBER} to Olivia Hartley — week of 8 Feb 2027`);
  });

  it("delivered: the same figures, and the family has been sent it", () => {
    const e = invoiceCopyToNannyEmail(BASE);
    const sentences = [
      "Hi Sophie,",
      "Here is a copy of your invoice to Olivia Hartley for the week of 8 Feb 2027: 32 hours of childcare and £12.50 of expenses, £596.50 in total.",
      "Olivia Hartley has been sent the attached invoice.",
    ];
    expect(e.text).toBe(`${sentences.join("\n\n")}\n\nBabyBloom`);
    for (const s of sentences) expect(e.html).toContain(s);
  });

  it("not delivered: says so, and to try Resend (R16)", () => {
    const e = invoiceCopyToNannyEmail({ ...BASE, familyDelivery: "failed" });
    expect(e.text).toContain("We couldn't deliver it to Olivia Hartley; try Resend on your invoices page.");
    expect(e.text).not.toContain("has been sent");
  });

  it("VAT and corrections read as in the family's email", () => {
    const e = invoiceCopyToNannyEmail({
      ...BASE,
      figures: { hours: 32, expensesPence: 1250, totalPence: 71_330, vatMode: "added" },
      replacesNumber: "BB-SophieTaylor-270212-0001",
    });
    expect(e.text).toContain("£713.30 in total, including VAT.");
    expect(e.text).toContain("It replaces invoice BB-SophieTaylor-270212-0001, which you cancelled.");
  });

  it("a Trial Shift's subject names its date", () => {
    expect(invoiceCopyToNannyEmail({ ...BASE, kind: "trial_shift", periodStart: "2027-02-03" }).subject).toBe(
      `Copy: invoice ${NUMBER} to Olivia Hartley — Trial Shift, Wed 3 Feb 2027`,
    );
  });

  it("no bank detail anywhere", () => {
    const e = invoiceCopyToNannyEmail(BASE);
    const text = `${e.subject}\n${e.html}\n${e.text}`;
    for (const secret of ["112233", "11-22-33", "87654321", "4321", "••", "sort code"]) expect(text).not.toContain(secret);
  });

  it("a blank name reads \"Hi there,\"", () => {
    expect(invoiceCopyToNannyEmail({ ...BASE, nannyName: " " }).text.startsWith("Hi there,")).toBe(true);
  });

  it("the brand header and the nanny footer; names escaped; one-line subject", () => {
    const e = invoiceCopyToNannyEmail({ ...BASE, familyName: "<i>A</i>\nB" });
    expect(e.html).toContain(emailHeader());
    expect(e.html).toContain(emailFooter());
    expect(e.html).not.toContain("<i>A</i>");
    expect(e.subject).not.toMatch(/[\r\n]/);
  });
});
