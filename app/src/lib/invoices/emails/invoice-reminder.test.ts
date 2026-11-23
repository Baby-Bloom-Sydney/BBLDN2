/**
 * The Friday invoice reminder email (plan 06 §16.7 b5.4; wording §16.9, approved 2026-11-11; the link §16.0, BAI
 * 2026-11-23). One family: the sentence names it, and the button opens the form with it chosen
 * (`/nanny/invoices/new?placement=<id>`). Several: the list, and the plain form. Never a `week` parameter. Names are
 * escaped; the subject is fixed text; "Hi there," for a blank name; the text version holds the link; no amount and no
 * bank detail; the brand header and the nanny footer. Pure.
 *
 * BB-wave1-041126/06b5-app, 2026-11-23.
 */
import { describe, expect, it } from "vitest";
import { SITE_URL } from "@/lib/constants";
import { emailFooter, emailHeader } from "@/lib/email/brand";
import { INVOICE_REMINDER_EMAIL_TYPE, invoiceReminderEmail } from "./invoice-reminder";

const HARTLEY = { placementId: "b0650000-0000-4000-8000-000000000401", familyName: "Olivia Hartley" };
const PATEL = { placementId: "b0650000-0000-4000-8000-000000000402", familyName: "Priya Patel" };
const ONE = { firstName: "Sophie", weekStart: "2027-02-08", families: [PATEL] };
const TWO = { firstName: "Sophie", weekStart: "2027-02-08", families: [HARTLEY, PATEL] };
const FORM = `${SITE_URL}/nanny/invoices/new`;
const PATEL_LINK = `${FORM}?placement=${PATEL.placementId}`;

describe("invoiceReminderEmail — the approved wording (§16.9)", () => {
  it("subject (with its em dash) and email type", () => {
    expect(invoiceReminderEmail(ONE).subject).toBe("Invoice reminder — week of 8 Feb 2027");
    expect(invoiceReminderEmail(TWO).subject).toBe("Invoice reminder — week of 8 Feb 2027");
    expect(INVOICE_REMINDER_EMAIL_TYPE).toBe("invoice_reminder");
  });

  it("one family: names it, and the button opens the form with that family chosen", () => {
    const { html, text } = invoiceReminderEmail(ONE);
    expect(html).toContain(">Invoice reminder</h2>");
    for (const body of [html, text]) {
      expect(body).toContain("Hi Sophie,");
      expect(body).toContain("You haven't sent an invoice to Priya Patel for the week of 8 Feb 2027 yet.");
    }
    expect(html).toContain(`<a href="${PATEL_LINK}"`);
    expect(html).toContain(">Create invoice</a>");
    expect(text).toBe(`Hi Sophie,\n\nYou haven't sent an invoice to Priya Patel for the week of 8 Feb 2027 yet.\n\nCreate invoice: ${PATEL_LINK}\n\nBabyBloom`);
  });

  it("several families: the list, one per line, and the plain form", () => {
    const { html, text } = invoiceReminderEmail(TWO);
    for (const body of [html, text]) {
      expect(body).toContain("Hi Sophie,");
      expect(body).toContain("You haven't sent these families an invoice for the week of 8 Feb 2027 yet:");
    }
    expect(html).toContain("Olivia Hartley<br/>Priya Patel");
    expect(html).toContain(`<a href="${FORM}"`);
    expect(html).not.toContain("placement=");
    expect(text).toBe(
      `Hi Sophie,\n\nYou haven't sent these families an invoice for the week of 8 Feb 2027 yet:\n\nOlivia Hartley\nPriya Patel\n\nCreate invoice: ${FORM}\n\nBabyBloom`,
    );
  });

  it("never a week parameter (§16.0)", () => {
    for (const email of [invoiceReminderEmail(ONE), invoiceReminderEmail(TWO)]) {
      expect(`${email.html}\n${email.text}`).not.toMatch(/[?&]week=/);
    }
  });

  it("a blank first name reads 'Hi there,'", () => {
    expect(invoiceReminderEmail({ ...ONE, firstName: "  " }).text.startsWith("Hi there,\n\n")).toBe(true);
    expect(invoiceReminderEmail({ ...ONE, firstName: "  " }).html).toContain("Hi there,");
  });

  it("the date follows the week: a summer Monday", () => {
    const email = invoiceReminderEmail({ ...ONE, weekStart: "2027-06-28" });
    expect(email.subject).toBe("Invoice reminder — week of 28 Jun 2027");
    expect(email.text).toContain("for the week of 28 Jun 2027 yet.");
  });
});

describe("invoiceReminderEmail — safety", () => {
  it("escapes the names in the html: a tag stays text", () => {
    const odd = { placementId: PATEL.placementId, familyName: '<b>Zoë</b> "O\'Brien" & Co' };
    const one = invoiceReminderEmail({ ...ONE, firstName: "<i>Sophie</i>", families: [odd] }).html;
    expect(one).toContain("Hi &lt;i&gt;Sophie&lt;/i&gt;,");
    expect(one).toContain("You haven't sent an invoice to &lt;b&gt;Zoë&lt;/b&gt; \"O'Brien\" &amp; Co for the week");
    expect(one).not.toContain("<b>Zoë</b>");
    const several = invoiceReminderEmail({ ...TWO, families: [HARTLEY, odd] }).html;
    expect(several).toContain("Olivia Hartley<br/>&lt;b&gt;Zoë&lt;/b&gt;");
    expect(several).not.toContain("<b>Zoë</b>");
  });

  it("the link's id is encoded and its attribute escaped", () => {
    const { html, text } = invoiceReminderEmail({ ...ONE, families: [{ placementId: 'a"b&c', familyName: "Priya Patel" }] });
    expect(html).toContain(`href="${FORM}?placement=a%22b%26c"`);
    expect(text).toContain(`Create invoice: ${FORM}?placement=a%22b%26c`);
  });

  it("the subject is one line, and names never reach it", () => {
    const { subject } = invoiceReminderEmail({ ...ONE, firstName: "Sophie\r\nBcc: x", families: [{ ...PATEL, familyName: "Priya\nPatel" }] });
    expect(subject).not.toMatch(/[\r\n]/);
    expect(subject).not.toMatch(/Sophie|Priya/);
  });

  it("no amount and no bank detail: the only digits outside the link are the date's", () => {
    for (const email of [invoiceReminderEmail(ONE), invoiceReminderEmail(TWO)]) {
      const all = `${email.subject}\n${email.text}`.split(SITE_URL).join("");
      const withoutLink = all.replace(/\/nanny\/invoices\/new(\?placement=[\w-]+)?/g, "");
      expect(withoutLink.match(/\d+/g)).toEqual(["8", "2027", "8", "2027"]);
      expect(`${email.html}\n${email.text}`).not.toMatch(/£|pence|sort code|account|IBAN/i);
    }
  });

  it("the brand header and the nanny footer", () => {
    const { html } = invoiceReminderEmail(ONE);
    expect(html).toContain(emailHeader());
    expect(html).toContain(emailFooter());
  });

  it("no family, or a week that isn't a date → RangeError (the runner never asks)", () => {
    expect(() => invoiceReminderEmail({ ...ONE, families: [] })).toThrow(RangeError);
    expect(() => invoiceReminderEmail({ ...ONE, weekStart: "8 Feb" })).toThrow(RangeError);
  });
});
