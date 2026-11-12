/**
 * `cancelInvoice` (plan 06 §14.6 b4.3; old step 13; brief §0.8, §3 nanny 8–9; R15, R16). Through the real store and
 * email templates, a fake service client and a stubbed `sendEmail`.
 * - Switch off → `invoices_disabled` before the session or any read; no nanny session → `signed_out`.
 * - Her own invoice only (the session's nanny; `not_found` otherwise); only a sent one (`not_cancellable`); a reason
 *   from the list. The number is kept: the row moves sent → cancelled with its reason and time, nothing else.
 * - Both cancellation emails go to the invoice's snapshot addresses (never an input's): the family's first, then
 *   hers saying whether it reached them; both deliveries are recorded on the row (R15). A failed email or record
 *   never undoes the cancel.
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

import { fakeAdmin, writesTo, type FakeAdmin, type Op } from "@/lib/payments/fake-admin.test-util";
import { FAMILY_EMAIL, INVOICE, invoiceRow, NANNY_EMAIL, NANNY_ID, NANNY_USER, NOW, PARENT_USER, SECRETS } from "../invoice-rows.test-util";
import { cancelInvoice } from "./cancel-invoice";

const NUMBER = "BB-SophieTaylor-270215-0001";
const sentRow = (over: Readonly<Record<string, unknown>> = {}) => invoiceRow({
  id: INVOICE, invoice_number: NUMBER, family_email: FAMILY_EMAIL, nanny_name: "Sophie Taylor", nanny_email: NANNY_EMAIL,
  pdf_path: `${NANNY_ID}/${INVOICE}.pdf`, ...over,
});

let f: FakeAdmin;
let steps: string[];
let moved: boolean[];
const spies: Array<ReturnType<typeof vi.spyOn>> = [];

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  vi.stubEnv("NANNY_INVOICES_ENABLED", "true");
  steps = [];
  moved = [true, true];
  h.revalidated.splice(0);
  f = fakeAdmin({ nanny_invoices: sentRow() });
  f.writeResults.nanny_invoices = (op: Op) => {
    steps.push(`update ${Object.keys(op.payload as object).join(",")}`);
    return moved.shift() === false ? [] : [{ id: INVOICE }];
  };
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

const INPUT = { invoiceId: INVOICE, reason: "wrong_hours" };

describe("gates", () => {
  it.each(["", "false", "TRUE", "1"])("switch %j → invoices_disabled before the session or any read", async (value) => {
    vi.stubEnv("NANNY_INVOICES_ENABLED", value);
    expect(await cancelInvoice(INPUT)).toEqual({ ok: false, error: "invoices_disabled", message: "This isn't available right now." });
    expect(h.getNannyId).not.toHaveBeenCalled();
    expect(h.createAdminClient).not.toHaveBeenCalled();
  });

  it("no nanny session → signed_out, nothing read", async () => {
    h.getNannyId.mockResolvedValueOnce(null);
    expect(await cancelInvoice(INPUT)).toMatchObject({ ok: false, error: "signed_out" });
    expect(f.ops).toEqual([]);
  });

  it("an id or reason that isn't one → invalid, nothing read", async () => {
    for (const bad of [null, {}, { invoiceId: "x", reason: "other" }, { invoiceId: INVOICE }, { invoiceId: INVOICE, reason: "because" }]) {
      expect(await cancelInvoice(bad)).toMatchObject({ ok: false, error: "invalid" });
    }
    expect(f.ops).toEqual([]);
  });
});

describe("a cancel", () => {
  it("in order: sent → cancelled, the family's email, hers, both deliveries recorded; revalidated", async () => {
    expect(await cancelInvoice(INPUT)).toEqual({ ok: true, invoiceId: INVOICE, number: NUMBER, delivery: { family: "sent", nanny: "sent" } });
    expect(steps).toEqual([
      "update status,cancelled_at,cancel_reason", "invoice_cancelled_family", "invoice_cancelled_nanny",
      "update cancel_family_email_status,cancel_nanny_email_status",
    ]);
    const [cancel, record] = writesTo(f, "nanny_invoices");
    expect(cancel?.payload).toEqual({ status: "cancelled", cancelled_at: NOW.toISOString(), cancel_reason: "wrong_hours" });
    expect(cancel?.filters).toContainEqual(["eq", "nanny_id", NANNY_ID]);
    expect(record?.payload).toEqual({ cancel_family_email_status: "sent", cancel_nanny_email_status: "sent" });
    expect(h.revalidated).toEqual(["/nanny/invoices"]);
  });

  it("the emails go to the invoice's snapshot addresses, whatever the input says", async () => {
    await cancelInvoice({ ...INPUT, familyEmail: "x@evil.test", nannyId: "b0600000-0000-4000-8000-000000000102" });
    const [family, nanny] = h.sendEmail.mock.calls.map((c) => c[0]);
    expect(family).toMatchObject({ to: FAMILY_EMAIL, replyTo: NANNY_EMAIL, recipientUserId: PARENT_USER });
    expect(nanny).toMatchObject({ to: NANNY_EMAIL, recipientUserId: NANNY_USER });
    expect(family.text).toContain(`Sophie Taylor has cancelled invoice ${NUMBER} for the week of 8 Feb 2027`);
    expect(JSON.stringify(h.sendEmail.mock.calls)).not.toContain("evil.test");
    expect(f.ops[0]?.filters).toEqual(expect.arrayContaining([["eq", "nanny_id", NANNY_ID]]));
  });

  it("the family's email failed: recorded as failed; hers says so; still cancelled", async () => {
    h.sendEmail.mockImplementationOnce(async () => (steps.push("invoice_cancelled_family"), { success: false, error: "bounce" }));
    expect(await cancelInvoice(INPUT)).toMatchObject({ ok: true, delivery: { family: "failed", nanny: "sent" } });
    expect(writesTo(f, "nanny_invoices")[1]?.payload).toEqual({ cancel_family_email_status: "failed", cancel_nanny_email_status: "sent" });
    expect(h.sendEmail.mock.calls[1]?.[0].text).toContain("We couldn't deliver the cancellation to Olivia Hartley");
  });

  it("the deliveries can't be recorded: still cancelled (logged by code)", async () => {
    moved = [true, false];
    expect(await cancelInvoice(INPUT)).toMatchObject({ ok: true, delivery: { family: "sent", nanny: "sent" } });
  });
});

describe("refusals", () => {
  it.each([
    ["cancelled", { status: "cancelled", cancelled_at: "2027-02-14T11:00:00+00:00", cancel_reason: "other" }],
    ["failed", { status: "failed", sent_at: null, family_email_status: null, nanny_email_status: null }],
    ["sending", { status: "sending", sent_at: null, family_email_status: null, nanny_email_status: null }],
  ])("a %s invoice → not_cancellable, nothing written or sent", async (_status, over) => {
    f.reads.nanny_invoices = sentRow(over);
    expect(await cancelInvoice(INPUT)).toEqual({ ok: false, error: "not_cancellable", message: "Only a sent invoice can be cancelled." });
    expect(writesTo(f, "nanny_invoices")).toEqual([]);
    expect(h.sendEmail).not.toHaveBeenCalled();
  });

  it("cancelled in between (the conditional update moved nothing) → not_cancellable, no email", async () => {
    moved = [false];
    expect(await cancelInvoice(INPUT)).toMatchObject({ ok: false, error: "not_cancellable" });
    expect(h.sendEmail).not.toHaveBeenCalled();
  });

  it("not hers or none → not_found", async () => {
    f.reads.nanny_invoices = null;
    expect(await cancelInvoice(INPUT)).toEqual({ ok: false, error: "not_found", message: "We couldn't find that invoice." });
    f.reads.nanny_invoices = sentRow({ nanny_id: "b0600000-0000-4000-8000-000000000102" });
    expect(await cancelInvoice(INPUT)).toMatchObject({ ok: false, error: "not_found" });
    expect(h.sendEmail).not.toHaveBeenCalled();
  });

  it("a failed read or write → error, no email", async () => {
    f.readErrors.nanny_invoices = { message: "down Sophie", code: "08006" };
    expect(await cancelInvoice(INPUT)).toMatchObject({ ok: false, error: "error" });
    f.readErrors.nanny_invoices = undefined;
    f.writeErrors.nanny_invoices = { message: "Failing row contains (Sophie)", code: "23514" };
    expect(await cancelInvoice(INPUT)).toMatchObject({ ok: false, error: "error" });
    expect(h.sendEmail).not.toHaveBeenCalled();
  });
});
