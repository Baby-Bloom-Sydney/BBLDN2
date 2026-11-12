/**
 * Sending an invoice's two emails (plan 06 §3 nanny 7; R16, R20; brief §0.5, §9.7–9.8): the family's first, with
 * the PDF attached and reply-to her email; then her copy, with the same PDF, saying whether the family's arrived. To
 * the invoice's snapshot addresses only. Never throws; a failure, a throw or a provider that doesn't answer in time
 * is `failed`, logged by code only.
 * Cancellations (brief §0.8; R15, R16): the family's first (reply-to her), then hers, saying whether the family's
 * arrived; no attachment. A resend sends one of them again (old step 13).
 *
 * BB-wave1-041126/06b4, 2026-11-12.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { sendEmail } = vi.hoisted(() => ({ sendEmail: vi.fn() }));
vi.mock("@/lib/email/resend", () => ({ sendEmail }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));

import { SUPPORT_INBOX } from "@/lib/constants";
import { FAMILY_EMAIL, NANNY_EMAIL, NANNY_USER, NUMBER, PARENT_USER, SECRETS } from "../invoice-rows.test-util";
import {
  familyCancellation,
  familyInvoiceEmail,
  INVOICE_EMAIL_WAIT_MS,
  nannyCancellation,
  nannyInvoiceCopy,
  sendCancellationEmails,
  sendInvoiceEmails,
  type InvoiceAddresses,
} from "./send-invoice-emails";

const FACTS = {
  number: NUMBER,
  kind: "regular_week",
  periodStart: "2027-02-08",
  nannyName: "Sophie Taylor",
  familyName: "Olivia Hartley",
  figures: { hours: 32, expensesPence: 1250, totalPence: 59_650, vatMode: "none" },
  replacesNumber: null,
} as const;
const TO: InvoiceAddresses = { familyEmail: FAMILY_EMAIL, nannyEmail: NANNY_EMAIL, parentUserId: PARENT_USER, nannyUserId: NANNY_USER };
const PDF = { filename: `${NUMBER}.pdf`, content: Buffer.from("%PDF-1.4 fixture") };
const spies: Array<ReturnType<typeof vi.spyOn>> = [];

beforeEach(() => {
  sendEmail.mockReset().mockResolvedValue({ success: true, messageId: "m1" });
  spies.splice(0);
  for (const level of ["error", "warn", "log", "info"] as const) spies.push(vi.spyOn(console, level).mockImplementation(() => {}));
});

afterEach(() => {
  expect(JSON.stringify(spies.flatMap((s) => s.mock.calls))).not.toMatch(SECRETS);
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("sendInvoiceEmails", () => {
  it("the family's first — PDF attached, reply-to her — then her copy with the same PDF", async () => {
    expect(await sendInvoiceEmails(FACTS, TO, PDF)).toEqual({ family: "sent", nanny: "sent" });
    expect(sendEmail).toHaveBeenCalledTimes(2);
    const [family, nanny] = sendEmail.mock.calls.map((c) => c[0]);
    expect(family).toMatchObject({
      to: FAMILY_EMAIL, replyTo: NANNY_EMAIL, emailType: "invoice_to_family", recipientUserId: PARENT_USER,
      subject: `Invoice ${NUMBER} from Sophie Taylor — week of 8 Feb 2027`, attachments: [PDF],
    });
    expect(nanny).toMatchObject({
      to: NANNY_EMAIL, replyTo: SUPPORT_INBOX, emailType: "invoice_copy_to_nanny", recipientUserId: NANNY_USER,
      subject: `Copy: invoice ${NUMBER} to Olivia Hartley — week of 8 Feb 2027`, attachments: [PDF],
    });
    expect(nanny.text).toContain("Olivia Hartley has been sent the attached invoice.");
    expect(family.text).toContain("£596.50 in total.");
  });

  it("the copy waits for the family's result (R16)", async () => {
    let release: (v: { success: boolean }) => void = () => {};
    sendEmail.mockImplementationOnce(() => new Promise((r) => { release = r; }));
    const pending = sendInvoiceEmails(FACTS, TO, PDF);
    await Promise.resolve();
    expect(sendEmail).toHaveBeenCalledTimes(1);
    release({ success: true });
    await pending;
    expect(sendEmail).toHaveBeenCalledTimes(2);
  });

  it("the family's failed: her copy says so; the family is `failed`, logged by code", async () => {
    sendEmail.mockResolvedValueOnce({ success: false, error: `bounced ${FAMILY_EMAIL}` });
    expect(await sendInvoiceEmails(FACTS, TO, PDF)).toEqual({ family: "failed", nanny: "sent" });
    expect(sendEmail.mock.calls[1]?.[0].text).toContain("We couldn't deliver it to Olivia Hartley; try Resend on your invoices page.");
    expect(JSON.stringify(spies.flatMap((s) => s.mock.calls))).toContain("send_failed");
  });

  it("a throw is `failed`, never thrown", async () => {
    sendEmail.mockRejectedValueOnce(new Error(`network ${FAMILY_EMAIL}`)).mockRejectedValueOnce(new Error("again"));
    expect(await sendInvoiceEmails(FACTS, TO, PDF)).toEqual({ family: "failed", nanny: "failed" });
  });

  it("a provider that doesn't answer in time is `failed` (the send stays within the page's 30 s)", async () => {
    vi.useFakeTimers();
    sendEmail.mockImplementationOnce(() => new Promise(() => {}));
    const pending = sendInvoiceEmails(FACTS, TO, PDF);
    await vi.advanceTimersByTimeAsync(INVOICE_EMAIL_WAIT_MS);
    expect(await pending).toEqual({ family: "failed", nanny: "sent" });
    expect(JSON.stringify(spies.flatMap((s) => s.mock.calls))).toContain("timeout");
    expect(INVOICE_EMAIL_WAIT_MS).toBeLessThanOrEqual(10_000);
  });

  it("no email carries a bank detail", async () => {
    await sendInvoiceEmails(FACTS, TO, PDF);
    for (const [email] of sendEmail.mock.calls) {
      const body = `${email.subject}\n${email.html}\n${email.text}`;
      for (const secret of ["112233", "11-22-33", "87654321", "4321"]) expect(body).not.toContain(secret);
    }
  });
});

describe("sendCancellationEmails", () => {
  const CANCELLED = { ...FACTS, reason: "wrong_hours" } as const;

  it("the family's first (reply-to her, no attachment), then hers saying it reached them", async () => {
    expect(await sendCancellationEmails(CANCELLED, TO)).toEqual({ family: "sent", nanny: "sent" });
    const [family, nanny] = sendEmail.mock.calls.map((c) => c[0]);
    expect(family).toMatchObject({
      to: FAMILY_EMAIL, replyTo: NANNY_EMAIL, emailType: "invoice_cancelled_family", recipientUserId: PARENT_USER,
      subject: `Invoice ${NUMBER} has been cancelled — please disregard it`,
    });
    expect(family.attachments).toBeUndefined();
    expect(nanny).toMatchObject({ to: NANNY_EMAIL, replyTo: SUPPORT_INBOX, emailType: "invoice_cancelled_nanny", recipientUserId: NANNY_USER });
    expect(nanny.attachments).toBeUndefined();
    expect(family.text).toContain("Please disregard it. Reason: wrong hours.");
    expect(nanny.text).toContain("We've told Olivia Hartley to disregard it.");
  });

  it("the family's failed: hers says so", async () => {
    sendEmail.mockResolvedValueOnce({ success: false, error: "bounce" });
    expect(await sendCancellationEmails(CANCELLED, TO)).toEqual({ family: "failed", nanny: "sent" });
    expect(sendEmail.mock.calls[1]?.[0].text).toContain("We couldn't deliver the cancellation to Olivia Hartley");
  });

  it("one at a time, for a resend", async () => {
    expect(await familyCancellation(CANCELLED, TO)).toBe("sent");
    expect(await nannyCancellation(CANCELLED, TO, "failed")).toBe("sent");
    expect(await familyInvoiceEmail(FACTS, TO, PDF)).toBe("sent");
    expect(await nannyInvoiceCopy(FACTS, TO, PDF, "sent")).toBe("sent");
    expect(sendEmail.mock.calls.map((c) => c[0].emailType)).toEqual([
      "invoice_cancelled_family", "invoice_cancelled_nanny", "invoice_to_family", "invoice_copy_to_nanny",
    ]);
  });
});
