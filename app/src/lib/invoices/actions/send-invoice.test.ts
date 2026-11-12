/**
 * `sendInvoice` — Send (plan 06 §14.6 b4.2; old step 12; R1, R16, R20; 06a handoff "create → render → upload → both
 * emails → finish"). Through the real store, review, PDF model and email templates, a fake service client with a
 * fake bucket, and stubbed `sendEmail` and renderer (the real render is `pdf/render.test.ts` and the b4.5 proof).
 * - Switch off → `invoices_disabled` before the session or any read; no nanny session → `signed_out`.
 * - The nanny is the session's; the recipients are the created row's snapshot, never the input's; the figures are
 *   the server's: a total or review key that isn't the server's → `changed`, nothing created.
 * - In order: create → render → upload → the family's email (PDF, reply-to her) → her copy (after the family's
 *   result) → finish as sent with both deliveries; the list path is revalidated.
 * - A PDF that can't be made or stored → the row is finished as failed, no email is sent (R1: never deleted).
 * - The database's refusals (`changed`, `bad_lines`, `no_address`, `in_progress` …) come back as plain messages.
 * - No email carries a bank detail; nothing personal in a log.
 *
 * BB-wave1-041126/06b4, 2026-11-12.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  getNannyId: vi.fn(),
  createAdminClient: vi.fn(),
  sendEmail: vi.fn(),
  renderInvoicePdf: vi.fn(),
  resolveInvoiceTarget: vi.fn(),
  revalidated: [] as string[],
}));
vi.mock("@/lib/actions/connection", () => ({ getNannyId: h.getNannyId }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: h.createAdminClient }));
vi.mock("@/lib/email/resend", () => ({ sendEmail: h.sendEmail }));
vi.mock("../pdf/render", () => ({ renderInvoicePdf: h.renderInvoicePdf }));
vi.mock("../families", () => ({ resolveInvoiceTarget: h.resolveInvoiceTarget }));
vi.mock("next/cache", () => ({ revalidatePath: (p: string) => h.revalidated.push(p) }));

import { SUPPORT_INBOX } from "@/lib/constants";
import { fakeAdmin, type FakeAdmin, type Op } from "@/lib/payments/fake-admin.test-util";
import {
  BANK_ROW,
  CREATED,
  DRAFT_IN,
  FAMILY_EMAIL,
  INVOICE,
  ISSUER,
  NANNY_EMAIL,
  NANNY_ID,
  NANNY_USER,
  NOW,
  NUMBER,
  PARENT_USER,
  SECRETS,
  TARGET,
} from "../invoice-rows.test-util";
import { previewInvoice } from "./preview-invoice";
import { sendInvoice } from "./send-invoice";

const PDF = Buffer.from("%PDF-1.4 rendered");
const PATH = `${NANNY_ID}/${INVOICE}.pdf`;
let f: FakeAdmin;
let steps: string[];
let uploadError: { message: string } | null;
const spies: Array<ReturnType<typeof vi.spyOn>> = [];

function instrument() {
  const svc = f.client as unknown as { rpc: (fn: string, a: unknown) => unknown };
  const rpc = svc.rpc;
  svc.rpc = (fn: string, args: unknown) => (fn !== "nanny_invoice_issuer" && steps.push(fn), rpc(fn, args));
  Object.assign(f.client, {
    storage: {
      from: (bucket: string) => ({
        upload: async (path: string) => {
          steps.push(`upload ${bucket} ${path}`);
          return uploadError ? { data: null, error: uploadError } : { data: { path }, error: null };
        },
      }),
    },
  });
  h.renderInvoicePdf.mockReset().mockImplementation(async () => (steps.push("render"), { ok: true, value: PDF }));
  h.sendEmail.mockReset().mockImplementation(async (e: { emailType: string }) => (steps.push(e.emailType), { success: true, messageId: "m" }));
}

/** What the review step hands the page: the draft plus the minted id, the server's total and the review key. */
async function reviewed(over: Readonly<Record<string, unknown>> = {}) {
  const r = await previewInvoice(DRAFT_IN);
  if (!r.ok) throw new Error(r.error);
  return { ...DRAFT_IN, invoiceId: INVOICE, expectedTotalPence: r.preview.expectedTotalPence, reviewKey: r.preview.reviewKey, ...over };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  vi.stubEnv("NANNY_INVOICES_ENABLED", "true");
  steps = [];
  uploadError = null;
  h.revalidated.splice(0);
  f = fakeAdmin({ nanny_payment_details: BANK_ROW, nanny_invoices: (op: Op) => (op.filters.some(([fn]) => fn === "limit") ? [] : []) });
  f.rpcResults.nanny_invoice_issuer = { data: ISSUER, error: null };
  f.rpcResults.nanny_invoice_create = { data: CREATED, error: null };
  f.rpcResults.nanny_invoice_finish = { data: { status: "sent", invoice_id: INVOICE }, error: null };
  h.createAdminClient.mockReset().mockReturnValue(f.client);
  h.getNannyId.mockReset().mockResolvedValue({ nannyId: NANNY_ID, userId: NANNY_USER });
  h.resolveInvoiceTarget.mockReset().mockResolvedValue({ ok: true, value: TARGET });
  instrument();
  spies.splice(0);
  for (const level of ["error", "warn", "log", "info"] as const) spies.push(vi.spyOn(console, level).mockImplementation(() => {}));
});

afterEach(() => {
  expect(JSON.stringify(spies.flatMap((s) => s.mock.calls))).not.toMatch(SECRETS);
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const rpcArgs = (fn: string) => f.rpcCalls.filter((c) => c.fn === fn).map((c) => c.args);

describe("gates", () => {
  it.each(["", "false", "TRUE", "1"])("switch %j → invoices_disabled before the session or any read", async (value) => {
    const input = await reviewed();
    h.getNannyId.mockClear();
    h.createAdminClient.mockClear();
    vi.stubEnv("NANNY_INVOICES_ENABLED", value);
    expect(await sendInvoice(input)).toEqual({ ok: false, error: "invoices_disabled", message: "This isn't available right now." });
    expect(h.getNannyId).not.toHaveBeenCalled();
    expect(h.createAdminClient).not.toHaveBeenCalled();
  });

  it("no nanny session → signed_out, nothing created or sent", async () => {
    const input = await reviewed();
    h.getNannyId.mockResolvedValueOnce(null);
    expect(await sendInvoice(input)).toMatchObject({ ok: false, error: "signed_out" });
    expect(steps).toEqual([]);
  });

  it("an envelope without the review's id, total or key → invalid, nothing created", async () => {
    const input = await reviewed();
    for (const bad of [
      { ...input, invoiceId: "x" }, { ...input, expectedTotalPence: 596.5 }, { ...input, expectedTotalPence: undefined },
      { ...input, reviewKey: "short" }, { ...input, reviewKey: undefined }, null,
    ]) {
      expect(await sendInvoice(bad)).toMatchObject({ ok: false, error: "invalid" });
    }
    expect(steps).toEqual([]);
  });
});

describe("a send", () => {
  it("in order: create → render → upload → the family's email → her copy → finish; revalidated", async () => {
    const r = await sendInvoice(await reviewed());
    expect(r).toEqual({ ok: true, invoiceId: INVOICE, number: NUMBER, delivery: { family: "sent", nanny: "sent" } });
    expect(steps).toEqual([
      "nanny_invoice_create", "render", `upload nanny-invoices ${PATH}`, "invoice_to_family", "invoice_copy_to_nanny", "nanny_invoice_finish",
    ]);
    expect(h.revalidated).toEqual(["/nanny/invoices"]);
  });

  it("create gets the session's nanny, the draft's lines, the server's total and the account she reviewed", async () => {
    await sendInvoice(await reviewed());
    expect(rpcArgs("nanny_invoice_create")).toEqual([expect.objectContaining({
      p_id: INVOICE, p_nanny: NANNY_ID, p_kind: "regular_week", p_period_start: "2027-02-08", p_expected_total_pence: 59_650,
      p_account_last4: "4321", p_replaces: null, p_daily_cap: 10,
    })]);
    expect(rpcArgs("nanny_invoice_finish")).toEqual([{
      p_id: INVOICE, p_nanny: NANNY_ID, p_outcome: "sent", p_family_email_status: "sent", p_nanny_email_status: "sent",
    }]);
  });

  it("the recipients are the created row's: the family (PDF, reply-to her), then her copy — never an input address", async () => {
    await sendInvoice(await reviewed({ familyEmail: "x@evil.test", to: "x@evil.test", replyTo: "x@evil.test", nannyId: "b0600000-0000-4000-8000-000000000102" }));
    const [family, nanny] = h.sendEmail.mock.calls.map((c) => c[0]);
    expect(family).toMatchObject({ to: FAMILY_EMAIL, replyTo: NANNY_EMAIL, recipientUserId: PARENT_USER, attachments: [{ filename: `${NUMBER}.pdf`, content: PDF }] });
    expect(nanny).toMatchObject({ to: NANNY_EMAIL, replyTo: SUPPORT_INBOX, recipientUserId: NANNY_USER, attachments: [{ filename: `${NUMBER}.pdf`, content: PDF }] });
    expect(JSON.stringify(h.sendEmail.mock.calls)).not.toContain("evil.test");
  });

  it("the PDF is made from the created row and her full details (the one place they appear)", async () => {
    await sendInvoice(await reviewed());
    const data = h.renderInvoicePdf.mock.calls[0]?.[0];
    expect(data).toMatchObject({ number: NUMBER, billTo: { name: "Olivia Hartley", email: FAMILY_EMAIL }, payTo: { sortCode: "112233", accountNumber: "87654321" } });
  });

  it("no email carries a bank detail", async () => {
    await sendInvoice(await reviewed());
    for (const [email] of h.sendEmail.mock.calls) {
      for (const secret of ["112233", "11-22-33", "87654321", "4321"]) expect(`${email.subject}${email.html}${email.text}`).not.toContain(secret);
    }
  });

  it("the family's email failed: still sent (Resend later), recorded as failed; her copy says so", async () => {
    h.sendEmail.mockImplementationOnce(async () => (steps.push("invoice_to_family"), { success: false, error: "bounce" }));
    expect(await sendInvoice(await reviewed())).toEqual({ ok: true, invoiceId: INVOICE, number: NUMBER, delivery: { family: "failed", nanny: "sent" } });
    expect(rpcArgs("nanny_invoice_finish")[0]).toMatchObject({ p_outcome: "sent", p_family_email_status: "failed", p_nanny_email_status: "sent" });
    expect(h.sendEmail.mock.calls[1]?.[0].text).toContain("We couldn't deliver it to Olivia Hartley");
  });
});

describe("the PDF fails: finished as failed, no email (R1)", () => {
  it("the render fails", async () => {
    h.renderInvoicePdf.mockResolvedValueOnce({ ok: false, error: "error" });
    expect(await sendInvoice(await reviewed())).toMatchObject({ ok: false, error: "error" });
    expect(steps).toEqual(["nanny_invoice_create", "nanny_invoice_finish"]);
    expect(rpcArgs("nanny_invoice_finish")).toEqual([{ p_id: INVOICE, p_nanny: NANNY_ID, p_outcome: "failed", p_family_email_status: null, p_nanny_email_status: null }]);
    expect(h.sendEmail).not.toHaveBeenCalled();
    expect(h.revalidated).toEqual(["/nanny/invoices"]);
  });

  it("the upload fails", async () => {
    uploadError = { message: `exists ${PATH}` };
    f.rpcResults.nanny_invoice_finish = { data: { status: "failed", invoice_id: INVOICE }, error: null };
    expect(await sendInvoice(await reviewed())).toMatchObject({ ok: false, error: "error" });
    expect(steps).toEqual(["nanny_invoice_create", "render", `upload nanny-invoices ${PATH}`, "nanny_invoice_finish"]);
    expect(rpcArgs("nanny_invoice_finish")[0]).toMatchObject({ p_outcome: "failed" });
    expect(h.sendEmail).not.toHaveBeenCalled();
  });

  it("the created figures don't add up: never printed", async () => {
    f.rpcResults.nanny_invoice_create = { data: { ...CREATED, total_pence: CREATED.total_pence + 1 }, error: null };
    expect(await sendInvoice(await reviewed())).toMatchObject({ ok: false, error: "error" });
    expect(steps).toEqual(["nanny_invoice_create", "nanny_invoice_finish"]);
  });
});

describe("finish", () => {
  it("a failed finish is tried once more", async () => {
    let calls = 0;
    f.rpcResults.nanny_invoice_finish = undefined;
    const svc = f.client as unknown as { rpc: (fn: string, a: unknown) => Promise<unknown> };
    const rpc = svc.rpc;
    svc.rpc = (fn: string, args: unknown) => {
      if (fn !== "nanny_invoice_finish") return rpc(fn, args);
      calls += 1;
      steps.push(fn);
      return Promise.resolve(calls === 1 ? { data: null, error: { message: "down", code: "08006" } } : { data: { status: "sent" }, error: null });
    };
    expect(await sendInvoice(await reviewed())).toMatchObject({ ok: true, delivery: { family: "sent", nanny: "sent" } });
    expect(calls).toBe(2);
  });

  it("a retry that finds it no longer sending: the first attempt landed", async () => {
    let calls = 0;
    const svc = f.client as unknown as { rpc: (fn: string, a: unknown) => Promise<unknown> };
    const rpc = svc.rpc;
    svc.rpc = (fn: string, args: unknown) => {
      if (fn !== "nanny_invoice_finish") return rpc(fn, args);
      calls += 1;
      return Promise.resolve(calls === 1 ? { data: null, error: { message: "timeout" } } : { data: { status: "not_sending" }, error: null });
    };
    expect(await sendInvoice(await reviewed())).toMatchObject({ ok: true });
  });

  it("still failing after the emails went: not_recorded, saying the emails went", async () => {
    f.rpcResults.nanny_invoice_finish = { data: null, error: { message: "down", code: "08006" } };
    const r = await sendInvoice(await reviewed());
    expect(r).toEqual({
      ok: false, error: "not_recorded",
      message: "Your invoice was emailed, but your list couldn't be updated. Check your invoices before sending it again.",
    });
    expect(h.sendEmail).toHaveBeenCalledTimes(2);
  });
});

describe("refusals", () => {
  it("a total or review key that isn't the server's → changed, nothing created", async () => {
    expect(await sendInvoice(await reviewed({ expectedTotalPence: 59_651 }))).toEqual({
      ok: false, error: "changed", message: "Your business settings changed — check the invoice again",
    });
    expect(await sendInvoice(await reviewed({ reviewKey: "a".repeat(64) }))).toMatchObject({ ok: false, error: "changed" });
    expect(steps).toEqual([]);
  });

  it("her settings changed between review and send → changed, nothing created", async () => {
    const input = await reviewed();
    f.rpcResults.nanny_invoice_issuer = { data: { ...ISSUER, trading_name: "Taylor Childcare", trading_name_source: "business" }, error: null };
    expect(await sendInvoice(input)).toMatchObject({ ok: false, error: "changed" });
    expect(steps).toEqual([]);
  });

  it("no bank details → no_details; no address → no_address (the page returns to the setup)", async () => {
    const input = await reviewed();
    f.reads.nanny_payment_details = null;
    expect(await sendInvoice(input)).toEqual({ ok: false, error: "no_details", message: "Add your bank details to send this invoice." });
    f.reads.nanny_payment_details = BANK_ROW;
    f.rpcResults.nanny_invoice_issuer = { data: { ...ISSUER, address: null }, error: null };
    expect(await sendInvoice(input)).toEqual({ ok: false, error: "no_address", message: "Add your address to send this invoice." });
    expect(steps).toEqual([]);
  });

  it.each([
    "changed", "bad_lines", "no_address", "no_details", "in_progress", "already_done", "already_failed", "cap", "not_hers",
    "wrong_date", "nanny_inactive", "bad_replaces", "already_replaced", "no_contact", "future", "invalid",
  ] as const)("the database answers %s: a plain message, nothing rendered or sent", async (status) => {
    f.rpcResults.nanny_invoice_create = { data: { status }, error: null };
    const r = await sendInvoice(await reviewed());
    expect(r).toMatchObject({ ok: false, error: status });
    expect(r.ok === false && r.message.length).toBeGreaterThan(0);
    expect(steps).toEqual(["nanny_invoice_create"]);
  });

  it("her lock is held → busy", async () => {
    f.rpcResults.nanny_invoice_create = { data: null, error: { message: "lock", code: "55P03" } };
    expect(await sendInvoice(await reviewed())).toMatchObject({ ok: false, error: "busy" });
  });
});
