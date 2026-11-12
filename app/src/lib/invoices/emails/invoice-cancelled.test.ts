/**
 * The cancellation emails (plan 06 §3a, §14.8; brief §0.8; old step 13; R15, R16): one subject for both sides, the
 * reason in plain words, the same totals sentence; the family's tells it to disregard the invoice and reply to reach
 * her; the nanny's is sent after the family's result and says whether it reached them. No bank details; names
 * escaped; one-line subject.
 *
 * BB-wave1-041126/06b4, 2026-11-12.
 */
import { describe, expect, it } from "vitest";
import { emailFooter } from "@/lib/email/brand";
import {
  INVOICE_CANCELLED_FAMILY_EMAIL_TYPE,
  INVOICE_CANCELLED_NANNY_EMAIL_TYPE,
  invoiceCancelledEmail,
  type InvoiceCancelledParams,
} from "./invoice-cancelled";

const NUMBER = "BB-SophieTaylor-270215-0001";
const FACTS = {
  number: NUMBER,
  kind: "regular_week",
  periodStart: "2027-02-08",
  nannyName: "Sophie Taylor",
  familyName: "Olivia Hartley",
  figures: { hours: 30, expensesPence: 0, totalPence: 54_000, vatMode: "none" },
  replacesNumber: null,
  reason: "wrong_hours",
} as const;
const FAMILY: InvoiceCancelledParams = { ...FACTS, to: "family" };
const NANNY: InvoiceCancelledParams = { ...FACTS, to: "nanny", familyDelivery: "sent" };

describe("invoiceCancelledEmail", () => {
  it("email types, one per side", () => {
    expect(INVOICE_CANCELLED_FAMILY_EMAIL_TYPE).toBe("invoice_cancelled_family");
    expect(INVOICE_CANCELLED_NANNY_EMAIL_TYPE).toBe("invoice_cancelled_nanny");
  });

  it("the same subject for both sides", () => {
    const subject = `Invoice ${NUMBER} has been cancelled — please disregard it`;
    expect(invoiceCancelledEmail(FAMILY).subject).toBe(subject);
    expect(invoiceCancelledEmail(NANNY).subject).toBe(subject);
  });

  it("to the family: who cancelled it, the figures, disregard it, the reason, reply to reach her", () => {
    const e = invoiceCancelledEmail(FAMILY);
    const sentences = [
      `Sophie Taylor has cancelled invoice ${NUMBER} for the week of 8 Feb 2027: 30 hours of childcare, £540.00 in total.`,
      "Please disregard it. Reason: wrong hours.",
      "Reply to this email to reach Sophie.",
    ];
    expect(e.text).toBe(`${sentences.join("\n\n")}\n\nBabyBloom`);
    for (const s of sentences) expect(e.html).toContain(s);
    expect(e.html).toContain(emailFooter({ terms: "client" }));
  });

  it("to the nanny, after the family's result: reached them, or try Resend", () => {
    const sent = invoiceCancelledEmail(NANNY);
    expect(sent.text).toBe([
      "Hi Sophie,",
      `You cancelled invoice ${NUMBER} to Olivia Hartley for the week of 8 Feb 2027: 30 hours of childcare, £540.00 in total.`,
      "Reason: wrong hours.",
      "We've told Olivia Hartley to disregard it.",
      "BabyBloom",
    ].join("\n\n"));
    expect(sent.html).toContain(emailFooter());
    const failed = invoiceCancelledEmail({ ...NANNY, familyDelivery: "failed" });
    expect(failed.text).toContain("We couldn't deliver the cancellation to Olivia Hartley; try Resend on your invoices page.");
    expect(failed.text).not.toContain("We've told");
  });

  it.each([
    ["wrong_rate", "wrong rate"],
    ["wrong_period", "wrong week or date"],
    ["wrong_family", "wrong family"],
    ["other", "other"],
  ] as const)("reason %s reads \"%s\"", (reason, words) => {
    expect(invoiceCancelledEmail({ ...FAMILY, reason }).text).toContain(`Reason: ${words}.`);
  });

  it("a Trial Shift and VAT read as in the invoice email", () => {
    const e = invoiceCancelledEmail({
      ...FAMILY, kind: "trial_shift", periodStart: "2027-02-03",
      figures: { hours: 4, expensesPence: 0, totalPence: 8640, vatMode: "added" },
    });
    expect(e.text).toContain("for the Trial Shift on Wed 3 Feb 2027: 4 hours of childcare, £86.40 in total, including VAT.");
  });

  it("no bank detail anywhere; names escaped; the subject one line", () => {
    for (const p of [FAMILY, NANNY]) {
      const e = invoiceCancelledEmail({ ...p, nannyName: "<b>S</b>\r\nT", familyName: "O & H" });
      const text = `${e.subject}\n${e.html}\n${e.text}`;
      for (const secret of ["112233", "11-22-33", "87654321", "4321", "••", "sort code"]) expect(text).not.toContain(secret);
      expect(e.html).not.toContain("<b>S</b>");
      expect(e.subject).not.toMatch(/[\r\n]/);
    }
  });
});
