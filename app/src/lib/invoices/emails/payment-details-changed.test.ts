/**
 * The "payment details changed" security email (plan 06 §3a, 14.8; brief §3 nanny 10, §11 Q12; b3.2): sent to the
 * nanny when she replaces her saved bank details (never on the first save). It carries **no digit of her details**
 * — not the full numbers, not the masks — because `sendEmail` stores the body in `email_logs` (brief §5). Her name
 * is escaped; it uses the brand header and footer.
 *
 * BB-wave1-041126/06b3-build, 2026-11-07.
 */
import { describe, expect, it } from "vitest";
import { emailFooter, emailHeader } from "@/lib/email/brand";
import { PAYMENT_DETAILS_CHANGED_EMAIL_TYPE, paymentDetailsChangedEmail } from "./payment-details-changed";

const BASE = { firstName: "Sophie", changedAt: "2027-02-15T14:05:00.000Z" };

describe("paymentDetailsChangedEmail", () => {
  it("subject and email type", () => {
    expect(paymentDetailsChangedEmail(BASE).subject).toBe("Your BabyBloom payment details were changed");
    expect(PAYMENT_DETAILS_CHANGED_EMAIL_TYPE).toBe("invoice_payment_details_changed");
  });

  it("says when (London time), what it affects, and what to do if it wasn't her — in the html and the text", () => {
    const { html, text } = paymentDetailsChangedEmail(BASE);
    for (const body of [html, text]) {
      expect(body).toContain("Hi Sophie,");
      expect(body).toContain("The bank details on your invoices were changed on 15 February 2027 at 14:05.");
      expect(body).toContain("Invoices you send from now on will show the new details. Invoices you've already sent stay as they were.");
      expect(body).toContain("If this wasn't you, reply to this email straight away.");
    }
  });

  it("in summer the time is London's (BST), not UTC", () => {
    expect(paymentDetailsChangedEmail({ ...BASE, changedAt: "2027-07-01T09:30:00.000Z" }).text).toContain("1 July 2027 at 10:30");
  });

  it("uses the brand header and the nanny footer", () => {
    const { html } = paymentDetailsChangedEmail(BASE);
    expect(html).toContain(emailHeader());
    expect(html).toContain(emailFooter());
  });

  it("escapes her name in the html and keeps the subject to one line", () => {
    const { html, subject } = paymentDetailsChangedEmail({ ...BASE, firstName: '<b>Zoë</b> "O\'Brien"' });
    expect(html).toContain("Hi &lt;b&gt;Zoë&lt;/b&gt; \"O'Brien\",");
    expect(html).not.toContain("<b>Zoë</b>");
    expect(subject).not.toMatch(/[\r\n]/);
  });

  it("a missing first name reads 'Hi there,'", () => {
    expect(paymentDetailsChangedEmail({ ...BASE, firstName: "  " }).text).toContain("Hi there,");
  });

  it("an unreadable time is left out rather than printed wrong", () => {
    const { text } = paymentDetailsChangedEmail({ ...BASE, changedAt: "not a time" });
    expect(text).toContain("The bank details on your invoices were changed.");
    expect(text).not.toMatch(/Invalid|NaN/);
  });

  it("carries no digits of her bank details: its inputs have none, and no digit run but the date and time appears", () => {
    const { subject, html, text } = paymentDetailsChangedEmail(BASE);
    const all = `${subject}\n${html}\n${text}`;
    for (const secret of ["112233", "11-22-33", "87654321", "4321", "••"]) expect(all).not.toContain(secret);
    // the only digit runs in the text are the date and time
    expect(text.match(/\d+/g)).toEqual(["15", "2027", "14", "05"]);
    expect(Object.keys(BASE).sort()).toEqual(["changedAt", "firstName"]);
  });
});
