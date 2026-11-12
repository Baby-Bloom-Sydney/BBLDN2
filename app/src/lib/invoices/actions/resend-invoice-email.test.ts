/**
 * `resendInvoiceEmail` (plan 06 §14.6 b4.3; old step 13; brief §0.9, §9.12; R15). Through the real store and email
 * templates, a fake service client with a fake bucket and a stubbed `sendEmail`.
 * - Switch off → `invoices_disabled` before the session or any read; no nanny session → `signed_out`.
 * - Her own invoice only; only for a recipient whose email isn't `sent`: the invoice email on a sent invoice (the
 *   **stored** PDF, the same number), or the cancellation on a cancelled one (R15). Anything else → `not_resendable`.
 * - To the invoice's snapshot address; the outcome recorded on the row; a resend that fails again is `failed`, not
 *   a refusal.
 * - Nothing personal in a log.
 *
 * BB-wave1-041126/06b4, 2026-11-12.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  getNannyId: vi.fn(),
  createAdminClient: vi.fn(),
  sendEmail: vi.fn(),
  revalidated: [] as string[],
}));
vi.mock("@/lib/actions/connection", () => ({ getNannyId: h.getNannyId }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: h.createAdminClient }));
vi.mock("@/lib/email/resend", () => ({ sendEmail: h.sendEmail }));
vi.mock("next/cache", () => ({ revalidatePath: (p: string) => h.revalidated.push(p) }));

import { Blob } from "node:buffer";
import { SUPPORT_INBOX } from "@/lib/constants";
import { fakeAdmin, writesTo, type FakeAdmin, type Op } from "@/lib/payments/fake-admin.test-util";
import { FAMILY_EMAIL, INVOICE, invoiceRow, NANNY_EMAIL, NANNY_ID, NANNY_USER, NOW, PARENT_USER, SECRETS } from "../invoice-rows.test-util";
import { resendInvoiceEmail } from "./resend-invoice-email";

const NUMBER = "BB-SophieTaylor-270215-0001";
const PATH = `${NANNY_ID}/${INVOICE}.pdf`;
const STORED = Buffer.from("%PDF-1.4 the stored one");
const CANCELLED = { status: "cancelled", cancelled_at: "2027-02-14T11:00:00+00:00", cancel_reason: "wrong_rate" };
const row = (over: Readonly<Record<string, unknown>> = {}) => invoiceRow({
  id: INVOICE, invoice_number: NUMBER, family_email: FAMILY_EMAIL, nanny_name: "Sophie Taylor", nanny_email: NANNY_EMAIL, pdf_path: PATH, ...over,
});

let f: FakeAdmin;
let steps: string[];
let downloadResult: { data: unknown; error: unknown };
const spies: Array<ReturnType<typeof vi.spyOn>> = [];

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  vi.stubEnv("NANNY_INVOICES_ENABLED", "true");
  steps = [];
  h.revalidated.splice(0);
  downloadResult = { data: new Blob([STORED]), error: null };
  f = fakeAdmin({ nanny_invoices: row({ family_email_status: "failed" }) });
  f.writeResults.nanny_invoices = (op: Op) => (steps.push(`update ${Object.keys(op.payload as object).join(",")}`), [{ id: INVOICE }]);
  Object.assign(f.client, {
    storage: { from: (bucket: string) => ({ download: async (path: string) => (steps.push(`download ${bucket} ${path}`), downloadResult) }) },
  });
  h.createAdminClient.mockReset().mockReturnValue(f.client);
  h.getNannyId.mockReset().mockResolvedValue({ nannyId: NANNY_ID, userId: NANNY_USER });
  h.sendEmail.mockReset().mockImplementation(async (e: { emailType: string }) => (steps.push(e.emailType), { success: true, messageId: "m" }));
  spies.splice(0);
  for (const level of ["error", "warn", "log", "info"] as const) spies.push(vi.spyOn(console, level).mockImplementation(() => {}));
});

afterEach(() => {
  expect(JSON.stringify(spies.flatMap((s) => s.mock.calls))).not.toMatch(SECRETS);
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const TO_FAMILY = { invoiceId: INVOICE, what: "invoice", recipient: "family" } as const;

describe("gates", () => {
  it.each(["", "false", "TRUE", "1"])("switch %j → invoices_disabled before the session or any read", async (value) => {
    vi.stubEnv("NANNY_INVOICES_ENABLED", value);
    expect(await resendInvoiceEmail(TO_FAMILY)).toEqual({ ok: false, error: "invoices_disabled", message: "This isn't available right now." });
    expect(h.getNannyId).not.toHaveBeenCalled();
    expect(h.createAdminClient).not.toHaveBeenCalled();
  });

  it("no nanny session → signed_out", async () => {
    h.getNannyId.mockResolvedValueOnce(null);
    expect(await resendInvoiceEmail(TO_FAMILY)).toMatchObject({ ok: false, error: "signed_out" });
    expect(f.ops).toEqual([]);
  });

  it("an input that isn't one → invalid, nothing read", async () => {
    for (const bad of [null, { ...TO_FAMILY, invoiceId: "x" }, { ...TO_FAMILY, what: "both" }, { ...TO_FAMILY, recipient: "admin" }, { invoiceId: INVOICE }]) {
      expect(await resendInvoiceEmail(bad)).toMatchObject({ ok: false, error: "invalid" });
    }
    expect(f.ops).toEqual([]);
  });
});

describe("the invoice email", () => {
  it("to the family: the stored PDF, the same number, reply-to her; recorded; revalidated", async () => {
    expect(await resendInvoiceEmail(TO_FAMILY)).toEqual({ ok: true, invoiceId: INVOICE, what: "invoice", recipient: "family", delivery: "sent" });
    expect(steps).toEqual([`download nanny-invoices ${PATH}`, "invoice_to_family", "update family_email_status,family_emailed_at"]);
    const [email] = h.sendEmail.mock.calls.map((c) => c[0]);
    expect(email).toMatchObject({
      to: FAMILY_EMAIL, replyTo: NANNY_EMAIL, recipientUserId: PARENT_USER, subject: `Invoice ${NUMBER} from Sophie Taylor — week of 8 Feb 2027`,
    });
    expect(email.attachments).toHaveLength(1);
    expect(email.attachments[0].filename).toBe(`${NUMBER}.pdf`);
    expect(Buffer.from(email.attachments[0].content).equals(STORED)).toBe(true);
    expect(writesTo(f, "nanny_invoices")[0]?.payload).toEqual({ family_email_status: "sent", family_emailed_at: NOW.toISOString() });
    expect(h.revalidated).toEqual(["/nanny/invoices"]);
  });

  it("her copy: says whether the family's has arrived", async () => {
    f.reads.nanny_invoices = row({ nanny_email_status: "failed", family_email_status: "failed" });
    expect(await resendInvoiceEmail({ ...TO_FAMILY, recipient: "nanny" })).toMatchObject({ ok: true, recipient: "nanny", delivery: "sent" });
    const [email] = h.sendEmail.mock.calls.map((c) => c[0]);
    expect(email).toMatchObject({ to: NANNY_EMAIL, replyTo: SUPPORT_INBOX, recipientUserId: NANNY_USER, emailType: "invoice_copy_to_nanny" });
    expect(email.text).toContain("We couldn't deliver it to Olivia Hartley");
    expect(writesTo(f, "nanny_invoices")[0]?.payload).toEqual({ nanny_email_status: "sent", nanny_emailed_at: NOW.toISOString() });
  });

  it("fails again: recorded as failed, answered as failed (not a refusal)", async () => {
    h.sendEmail.mockResolvedValueOnce({ success: false, error: "bounce" });
    expect(await resendInvoiceEmail(TO_FAMILY)).toMatchObject({ ok: true, delivery: "failed" });
    expect(writesTo(f, "nanny_invoices")[0]?.payload).toEqual({ family_email_status: "failed", family_emailed_at: NOW.toISOString() });
  });

  it("the stored PDF can't be read → error, nothing sent or recorded", async () => {
    downloadResult = { data: null, error: { message: `missing ${PATH}` } };
    expect(await resendInvoiceEmail(TO_FAMILY)).toMatchObject({ ok: false, error: "error" });
    expect(h.sendEmail).not.toHaveBeenCalled();
    expect(writesTo(f, "nanny_invoices")).toEqual([]);
  });

  it.each([
    ["already delivered", row({ family_email_status: "sent" }), TO_FAMILY],
    ["a cancelled invoice", row({ ...CANCELLED, family_email_status: "failed" }), TO_FAMILY],
    ["a failed invoice", row({ status: "failed", sent_at: null, family_email_status: null, nanny_email_status: null }), TO_FAMILY],
    ["a cancellation on a sent invoice", row({ family_email_status: "failed" }), { ...TO_FAMILY, what: "cancellation" }],
    ["a cancellation already delivered", row({ ...CANCELLED, cancel_family_email_status: "sent", cancel_nanny_email_status: "sent" }), { ...TO_FAMILY, what: "cancellation" }],
  ])("%s → not_resendable, nothing sent", async (_case, stored, input) => {
    f.reads.nanny_invoices = stored;
    expect(await resendInvoiceEmail(input)).toEqual({ ok: false, error: "not_resendable", message: "There's nothing to resend for this invoice." });
    expect(h.sendEmail).not.toHaveBeenCalled();
    expect(writesTo(f, "nanny_invoices")).toEqual([]);
  });

  it("not hers or none → not_found", async () => {
    f.reads.nanny_invoices = row({ nanny_id: "b0600000-0000-4000-8000-000000000102", family_email_status: "failed" });
    expect(await resendInvoiceEmail(TO_FAMILY)).toMatchObject({ ok: false, error: "not_found" });
    f.reads.nanny_invoices = null;
    expect(await resendInvoiceEmail(TO_FAMILY)).toMatchObject({ ok: false, error: "not_found" });
    expect(h.sendEmail).not.toHaveBeenCalled();
  });

  it("delivered in between (the record moved nothing): still answers what this send did", async () => {
    f.writeResults.nanny_invoices = [];
    expect(await resendInvoiceEmail(TO_FAMILY)).toMatchObject({ ok: true, delivery: "sent" });
  });
});

describe("the cancellation (R15)", () => {
  it("to the family: no attachment, no PDF read, reply-to her; recorded", async () => {
    f.reads.nanny_invoices = row({ ...CANCELLED, cancel_family_email_status: "failed", cancel_nanny_email_status: "sent" });
    expect(await resendInvoiceEmail({ ...TO_FAMILY, what: "cancellation" })).toEqual({
      ok: true, invoiceId: INVOICE, what: "cancellation", recipient: "family", delivery: "sent",
    });
    expect(steps).toEqual(["invoice_cancelled_family", "update cancel_family_email_status"]);
    const [email] = h.sendEmail.mock.calls.map((c) => c[0]);
    expect(email).toMatchObject({ to: FAMILY_EMAIL, replyTo: NANNY_EMAIL, emailType: "invoice_cancelled_family" });
    expect(email.attachments).toBeUndefined();
    expect(email.text).toContain("Reason: wrong rate.");
  });

  it("to her, with no delivery recorded yet (the record failed at cancel): resendable", async () => {
    f.reads.nanny_invoices = row({ ...CANCELLED });
    expect(await resendInvoiceEmail({ ...TO_FAMILY, what: "cancellation", recipient: "nanny" })).toMatchObject({ ok: true, delivery: "sent" });
    expect(h.sendEmail.mock.calls[0]?.[0]).toMatchObject({ to: NANNY_EMAIL, emailType: "invoice_cancelled_nanny" });
    expect(writesTo(f, "nanny_invoices")[0]?.payload).toEqual({ cancel_nanny_email_status: "sent" });
  });
});
