/**
 * The invoice's PDF in the private bucket (plan 06 §4 "Bucket", R1; 06a handoff "create → render → upload → both
 * emails → finish"): uploaded once, to the path the created row fixed (`<nanny>/<invoice>.pdf`), never over an
 * existing object (`upsert: false`), as a PDF. Her own path only; the switch first; failures logged by code only.
 *
 * After send (old step 13; R15; 06b-2 handoff "cancel and resend must not be bare PostgREST UPDATEs" — database L8):
 * her own invoice read for its emails (the snapshot addresses); a cancel only from `sent`, with a reason; the
 * cancellation's deliveries and a resend recorded once, each a conditional update whose values are checked first,
 * so no write can fail a CHECK (which would log the row). The stored PDF read back for a resend.
 * Security review (2026-11-12): a resend of an invoice email first claims it (M1); a cancellation's resend only from
 * `failed`; her account's status (L1) and whether the family still has an account (L2).
 *
 * BB-wave1-041126/06b4, 2026-11-12.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { getNannyId, createAdminClient } = vi.hoisted(() => ({ getNannyId: vi.fn(), createAdminClient: vi.fn() }));
vi.mock("@/lib/actions/connection", () => ({ getNannyId }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient }));

import { Blob } from "node:buffer";
import { fakeAdmin, writesTo, type FakeAdmin, type Op } from "@/lib/payments/fake-admin.test-util";
import { FAMILY_EMAIL, INVOICE, invoiceRow, NANNY_EMAIL, NANNY_ID, NANNY_USER, NOW, PARENT_USER, SECRETS } from "./invoice-rows.test-util";
import { proveNanny, type NannyProof } from "./nanny-proof";
import {
  cancelSentInvoice,
  claimInvoiceResend,
  downloadInvoicePdf,
  familyHasAccount,
  INVOICE_BUCKET,
  readNannyActive,
  readSentInvoice,
  recordCancelDelivery,
  recordResend,
  RESEND_LEASE_SECONDS,
  uploadInvoicePdf,
} from "./store-delivery";

const PDF = Buffer.from("%PDF-1.4 fixture");
const PATH = `${NANNY_ID}/${INVOICE}.pdf`;

let f: FakeAdmin;
let proof: NannyProof;
let uploads: Array<{ bucket: string; path: string; body: unknown; options: unknown }>;
let uploadError: { message: string; name?: string } | null;
const spies: Array<ReturnType<typeof vi.spyOn>> = [];

beforeEach(async () => {
  vi.stubEnv("NANNY_INVOICES_ENABLED", "true");
  f = fakeAdmin();
  uploads = [];
  uploadError = null;
  Object.assign(f.client, {
    storage: {
      from: (bucket: string) => ({
        upload: async (path: string, body: unknown, options: unknown) => {
          uploads.push({ bucket, path, body, options });
          return uploadError ? { data: null, error: uploadError } : { data: { path }, error: null };
        },
      }),
    },
  });
  createAdminClient.mockReset().mockReturnValue(f.client);
  getNannyId.mockReset().mockResolvedValue({ nannyId: NANNY_ID, userId: NANNY_USER });
  const p = await proveNanny();
  if (!p) throw new Error("fixture proof");
  proof = p;
  spies.splice(0);
  for (const level of ["error", "warn", "log", "info"] as const) spies.push(vi.spyOn(console, level).mockImplementation(() => {}));
});

afterEach(() => {
  expect(JSON.stringify(spies.flatMap((s) => s.mock.calls))).not.toMatch(SECRETS);
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("uploadInvoicePdf", () => {
  it("to the private bucket, at the row's own path, as a PDF, never over an existing object", async () => {
    expect(await uploadInvoicePdf(proof, { invoiceId: INVOICE, pdfPath: PATH }, PDF)).toEqual({ ok: true, value: true });
    expect(INVOICE_BUCKET).toBe("nanny-invoices");
    expect(uploads).toEqual([{ bucket: "nanny-invoices", path: PATH, body: PDF, options: { contentType: "application/pdf", upsert: false } }]);
  });

  it("a path that isn't hers for that invoice → invalid, nothing uploaded", async () => {
    for (const pdfPath of [`b0600000-0000-4000-8000-000000000102/${INVOICE}.pdf`, `${NANNY_ID}/b0600000-0000-4000-8000-000000009002.pdf`, `${NANNY_ID}/../x.pdf`]) {
      expect(await uploadInvoicePdf(proof, { invoiceId: INVOICE, pdfPath }, PDF)).toEqual({ ok: false, error: "invalid" });
    }
    expect(uploads).toEqual([]);
  });

  it("bytes that aren't a PDF, or over the bucket's 2 MB → invalid, nothing uploaded", async () => {
    expect(await uploadInvoicePdf(proof, { invoiceId: INVOICE, pdfPath: PATH }, Buffer.from("<html>"))).toEqual({ ok: false, error: "invalid" });
    const big = Buffer.concat([PDF, Buffer.alloc(2 * 1024 * 1024)]);
    expect(await uploadInvoicePdf(proof, { invoiceId: INVOICE, pdfPath: PATH }, big)).toEqual({ ok: false, error: "invalid" });
    expect(uploads).toEqual([]);
  });

  it("a storage failure → error, logged by code only", async () => {
    uploadError = { message: `The resource already exists ${PATH} Sophie`, name: "StorageApiError" };
    expect(await uploadInvoicePdf(proof, { invoiceId: INVOICE, pdfPath: PATH }, PDF)).toEqual({ ok: false, error: "error" });
    expect(JSON.stringify(spies.flatMap((s) => s.mock.calls))).not.toContain(PATH);
  });

  it("a throw → error", async () => {
    Object.assign(f.client, { storage: { from: () => ({ upload: async () => { throw new Error(PATH); } }) } });
    expect(await uploadInvoicePdf(proof, { invoiceId: INVOICE, pdfPath: PATH }, PDF)).toEqual({ ok: false, error: "error" });
  });

  it("switch off → invoices_disabled before a client; not a proof → invalid", async () => {
    vi.stubEnv("NANNY_INVOICES_ENABLED", "false");
    expect(await uploadInvoicePdf(proof, { invoiceId: INVOICE, pdfPath: PATH }, PDF)).toEqual({ ok: false, error: "invoices_disabled" });
    expect(createAdminClient).not.toHaveBeenCalled();
    vi.stubEnv("NANNY_INVOICES_ENABLED", "true");
    expect(await uploadInvoicePdf({ nannyId: NANNY_ID } as unknown as NannyProof, { invoiceId: INVOICE, pdfPath: PATH }, PDF)).toEqual({ ok: false, error: "invalid" });
  });
});

/** Her invoice as the delivery read sees it: the list's row plus the snapshot addresses and the PDF path. */
const sentRow = (over: Readonly<Record<string, unknown>> = {}) =>
  invoiceRow({ id: INVOICE, invoice_number: "BB-SophieTaylor-270215-0001", family_email: FAMILY_EMAIL, nanny_name: "Sophie Taylor", nanny_email: NANNY_EMAIL, pdf_path: PATH, ...over });

describe("readSentInvoice", () => {
  it("her own invoice: the snapshot, the figures, the deliveries", async () => {
    f.reads.nanny_invoices = sentRow();
    const r = await readSentInvoice(proof, INVOICE);
    expect(r).toEqual({
      ok: true,
      value: {
        invoiceId: INVOICE, number: "BB-SophieTaylor-270215-0001", kind: "regular_week", periodStart: "2027-02-08", status: "sent",
        pdfPath: PATH, parentUserId: PARENT_USER, familyName: "Olivia Hartley", familyEmail: FAMILY_EMAIL, nannyName: "Sophie Taylor",
        nannyEmail: NANNY_EMAIL, figures: { hours: 30, expensesPence: 0, totalPence: 54_000, vatMode: "none" }, replacesNumber: null,
        cancelReason: null, delivery: { family: "sent", nanny: "sent", cancelFamily: null, cancelNanny: null },
      },
    });
    const read = f.ops.find((o) => o.table === "nanny_invoices");
    expect(read?.filters).toEqual(expect.arrayContaining([["eq", "id", INVOICE], ["eq", "nanny_id", NANNY_ID]]));
  });

  it("a correction names the invoice it replaced (her own)", async () => {
    const OLD = "b0600000-0000-4000-8000-000000009000";
    f.reads.nanny_invoices = (op: Op) =>
      op.filters.some(([, col, v]) => col === "id" && v === OLD) ? { invoice_number: "BB-SophieTaylor-270212-0001" } : sentRow({ replaces_invoice_id: OLD });
    const r = await readSentInvoice(proof, INVOICE);
    expect(r.ok && r.value.replacesNumber).toBe("BB-SophieTaylor-270212-0001");
    const second = f.ops.filter((o) => o.table === "nanny_invoices")[1];
    expect(second?.filters).toEqual(expect.arrayContaining([["eq", "id", OLD], ["eq", "nanny_id", NANNY_ID]]));
  });

  it("none, or not hers → not_found; not an id → invalid; a failed read → error", async () => {
    f.reads.nanny_invoices = null;
    expect(await readSentInvoice(proof, INVOICE)).toEqual({ ok: false, error: "not_found" });
    f.reads.nanny_invoices = sentRow({ nanny_id: "b0600000-0000-4000-8000-000000000102" });
    expect(await readSentInvoice(proof, INVOICE)).toEqual({ ok: false, error: "not_found" });
    expect(await readSentInvoice(proof, "x")).toEqual({ ok: false, error: "invalid" });
    f.readErrors.nanny_invoices = { message: "down", code: "08006" };
    expect(await readSentInvoice(proof, INVOICE)).toEqual({ ok: false, error: "error" });
  });
});

describe("cancelSentInvoice", () => {
  it("only from sent, hers, with the reason and the time; nothing else written", async () => {
    f.writeResults.nanny_invoices = [{ id: INVOICE }];
    expect(await cancelSentInvoice(proof, INVOICE, "wrong_hours", NOW)).toEqual({ ok: true, value: "cancelled" });
    const [w] = writesTo(f, "nanny_invoices");
    expect(w?.kind).toBe("update");
    expect(w?.payload).toEqual({ status: "cancelled", cancelled_at: NOW.toISOString(), cancel_reason: "wrong_hours" });
    expect(w?.filters).toEqual([["eq", "id", INVOICE], ["eq", "nanny_id", NANNY_ID], ["eq", "status", "sent"]]);
  });

  it("no row moved (not sent any more, or not hers) → not_cancellable", async () => {
    f.writeResults.nanny_invoices = [];
    expect(await cancelSentInvoice(proof, INVOICE, "other", NOW)).toEqual({ ok: false, error: "not_cancellable" });
  });

  it("a reason or id that isn't one → invalid, nothing written (no CHECK can fail)", async () => {
    expect(await cancelSentInvoice(proof, INVOICE, "because" as never, NOW)).toEqual({ ok: false, error: "invalid" });
    expect(await cancelSentInvoice(proof, "x", "other", NOW)).toEqual({ ok: false, error: "invalid" });
    expect(writesTo(f, "nanny_invoices")).toEqual([]);
  });

  it("a database error → error, logged by code only (never the row)", async () => {
    f.writeErrors.nanny_invoices = { message: "Failing row contains (Sophie, 112233)", code: "23514", details: "Olivia" };
    expect(await cancelSentInvoice(proof, INVOICE, "other", NOW)).toEqual({ ok: false, error: "error" });
  });
});

describe("recordCancelDelivery", () => {
  it("both deliveries once, on her cancelled invoice, only while none is recorded", async () => {
    f.writeResults.nanny_invoices = [{ id: INVOICE }];
    expect(await recordCancelDelivery(proof, INVOICE, { family: "failed", nanny: "sent" })).toEqual({ ok: true, value: true });
    const [w] = writesTo(f, "nanny_invoices");
    expect(w?.payload).toEqual({ cancel_family_email_status: "failed", cancel_nanny_email_status: "sent" });
    expect(w?.filters).toEqual([
      ["eq", "id", INVOICE], ["eq", "nanny_id", NANNY_ID], ["eq", "status", "cancelled"],
      ["is", "cancel_family_email_status", null], ["is", "cancel_nanny_email_status", null],
    ]);
  });

  it("no row moved, or an error → error (the cancel stands)", async () => {
    f.writeResults.nanny_invoices = [];
    expect(await recordCancelDelivery(proof, INVOICE, { family: "sent", nanny: "sent" })).toEqual({ ok: false, error: "error" });
    f.writeErrors.nanny_invoices = { message: "x", code: "23514" };
    expect(await recordCancelDelivery(proof, INVOICE, { family: "sent", nanny: "sent" })).toEqual({ ok: false, error: "error" });
  });

  it("a delivery that isn't sent or failed → invalid, nothing written", async () => {
    expect(await recordCancelDelivery(proof, INVOICE, { family: "maybe" as never, nanny: "sent" })).toEqual({ ok: false, error: "invalid" });
    expect(writesTo(f, "nanny_invoices")).toEqual([]);
  });
});

describe("claimInvoiceResend (security M1: one resend at a time)", () => {
  const CLAIM = NOW.toISOString();
  const CUTOFF = new Date(NOW.getTime() - RESEND_LEASE_SECONDS * 1000).toISOString();

  it("stamps the attempt before any email, only on a sent invoice whose email failed over a minute ago", async () => {
    f.writeResults.nanny_invoices = [{ id: INVOICE }];
    expect(await claimInvoiceResend(proof, INVOICE, "family", NOW)).toEqual({ ok: true, value: CLAIM });
    const [w] = writesTo(f, "nanny_invoices");
    expect(w?.payload).toEqual({ family_emailed_at: CLAIM });
    expect(w?.filters).toEqual([
      ["eq", "id", INVOICE], ["eq", "nanny_id", NANNY_ID], ["eq", "status", "sent"],
      ["eq", "family_email_status", "failed"], ["lt", "family_emailed_at", CUTOFF],
    ]);
    expect(RESEND_LEASE_SECONDS).toBe(60);
  });

  it("her copy on its own columns", async () => {
    f.writeResults.nanny_invoices = [{ id: INVOICE }];
    await claimInvoiceResend(proof, INVOICE, "nanny", NOW);
    expect(writesTo(f, "nanny_invoices")[0]?.payload).toEqual({ nanny_emailed_at: CLAIM });
  });

  it("another resend holds it, it was tried in the last minute, or it's delivered → too_soon (the loser sends nothing)", async () => {
    f.writeResults.nanny_invoices = [];
    expect(await claimInvoiceResend(proof, INVOICE, "family", NOW)).toEqual({ ok: false, error: "too_soon" });
  });

  it("an error → error; a recipient that isn't one → invalid", async () => {
    expect(await claimInvoiceResend(proof, INVOICE, "admin" as never, NOW)).toEqual({ ok: false, error: "invalid" });
    f.writeErrors.nanny_invoices = { message: "x" };
    expect(await claimInvoiceResend(proof, INVOICE, "family", NOW)).toEqual({ ok: false, error: "error" });
  });
});

describe("recordResend", () => {
  const CLAIM = "2027-02-15T09:59:58.000Z";

  it("an invoice email: its outcome, only on the claim this resend made", async () => {
    f.writeResults.nanny_invoices = [{ id: INVOICE }];
    expect(await recordResend(proof, INVOICE, { what: "invoice", recipient: "family" }, "sent", NOW, CLAIM)).toEqual({ ok: true, value: true });
    const [w] = writesTo(f, "nanny_invoices");
    expect(w?.payload).toEqual({ family_email_status: "sent", family_emailed_at: NOW.toISOString() });
    expect(w?.filters).toEqual([
      ["eq", "id", INVOICE], ["eq", "nanny_id", NANNY_ID], ["eq", "status", "sent"],
      ["eq", "family_email_status", "failed"], ["eq", "family_emailed_at", CLAIM],
    ]);
  });

  it("an invoice email without a claim → invalid, nothing written", async () => {
    expect(await recordResend(proof, INVOICE, { what: "invoice", recipient: "family" }, "sent", NOW, null)).toEqual({ ok: false, error: "invalid" });
    expect(writesTo(f, "nanny_invoices")).toEqual([]);
  });

  it("her copy, and the cancellations (only from failed — never from a delivery not yet recorded)", async () => {
    f.writeResults.nanny_invoices = [{ id: INVOICE }];
    await recordResend(proof, INVOICE, { what: "invoice", recipient: "nanny" }, "failed", NOW, CLAIM);
    await recordResend(proof, INVOICE, { what: "cancellation", recipient: "family" }, "sent", NOW, null);
    await recordResend(proof, INVOICE, { what: "cancellation", recipient: "nanny" }, "sent", NOW, null);
    const writes = writesTo(f, "nanny_invoices");
    expect(writes.map((w) => w.payload)).toEqual([
      { nanny_email_status: "failed", nanny_emailed_at: NOW.toISOString() },
      { cancel_family_email_status: "sent" },
      { cancel_nanny_email_status: "sent" },
    ]);
    expect(writes[1]?.filters).toEqual([
      ["eq", "id", INVOICE], ["eq", "nanny_id", NANNY_ID], ["eq", "status", "cancelled"], ["eq", "cancel_family_email_status", "failed"],
    ]);
  });

  it("no row moved → not_resendable; an error → error; a bad kind → invalid", async () => {
    f.writeResults.nanny_invoices = [];
    expect(await recordResend(proof, INVOICE, { what: "invoice", recipient: "family" }, "sent", NOW, CLAIM)).toEqual({ ok: false, error: "not_resendable" });
    f.writeErrors.nanny_invoices = { message: "x" };
    expect(await recordResend(proof, INVOICE, { what: "invoice", recipient: "family" }, "sent", NOW, CLAIM)).toEqual({ ok: false, error: "error" });
    expect(await recordResend(proof, INVOICE, { what: "invoice", recipient: "admin" as never }, "sent", NOW, CLAIM)).toEqual({ ok: false, error: "invalid" });
  });
});

describe("readNannyActive (security L1)", () => {
  it.each([
    ["active", true], ["pending_verification", true], ["inactive", true], [null, true], ["suspended", false], ["deactivated", false],
  ])("status %j → %j, read for the proof's nanny", async (status, active) => {
    f.reads.nannies = { id: NANNY_ID, status };
    expect(await readNannyActive(proof)).toEqual({ ok: true, value: active });
    expect(f.ops.find((o) => o.table === "nannies")?.filters).toEqual([["eq", "id", NANNY_ID]]);
  });

  it("no nanny row → invalid; a failed read → error", async () => {
    f.reads.nannies = null;
    expect(await readNannyActive(proof)).toEqual({ ok: false, error: "invalid" });
    f.readErrors.nannies = { message: "down", code: "08006" };
    expect(await readNannyActive(proof)).toEqual({ ok: false, error: "error" });
  });
});

describe("familyHasAccount (security L2)", () => {
  it("the family's profile row is still there → true; gone → false", async () => {
    f.reads.user_profiles = { user_id: PARENT_USER };
    expect(await familyHasAccount(proof, PARENT_USER)).toEqual({ ok: true, value: true });
    expect(f.ops.find((o) => o.table === "user_profiles")?.filters).toEqual([["eq", "user_id", PARENT_USER]]);
    f.reads.user_profiles = null;
    expect(await familyHasAccount(proof, PARENT_USER)).toEqual({ ok: true, value: false });
  });

  it("not an id → invalid; a failed read → error", async () => {
    expect(await familyHasAccount(proof, "x")).toEqual({ ok: false, error: "invalid" });
    f.readErrors.user_profiles = { message: "down" };
    expect(await familyHasAccount(proof, PARENT_USER)).toEqual({ ok: false, error: "error" });
  });
});

describe("downloadInvoicePdf", () => {
  const withDownload = (result: { data: unknown; error: unknown }, seen: string[] = []) =>
    Object.assign(f.client, { storage: { from: (bucket: string) => ({ download: async (path: string) => (seen.push(`${bucket} ${path}`), result) }) } });

  it("her stored PDF, from the private bucket at the row's path", async () => {
    const seen: string[] = [];
    withDownload({ data: new Blob([PDF]), error: null }, seen);
    const r = await downloadInvoicePdf(proof, { invoiceId: INVOICE, pdfPath: PATH });
    expect(r.ok && r.value.equals(PDF)).toBe(true);
    expect(seen).toEqual([`nanny-invoices ${PATH}`]);
  });

  it("not her path → invalid, nothing read; not a PDF, missing or a failure → error", async () => {
    withDownload({ data: new Blob([PDF]), error: null });
    expect(await downloadInvoicePdf(proof, { invoiceId: INVOICE, pdfPath: `x/${INVOICE}.pdf` })).toEqual({ ok: false, error: "invalid" });
    withDownload({ data: new Blob([Buffer.from("<html>")]), error: null });
    expect(await downloadInvoicePdf(proof, { invoiceId: INVOICE, pdfPath: PATH })).toEqual({ ok: false, error: "error" });
    withDownload({ data: null, error: { message: `not found ${PATH}` } });
    expect(await downloadInvoicePdf(proof, { invoiceId: INVOICE, pdfPath: PATH })).toEqual({ ok: false, error: "error" });
    Object.assign(f.client, { storage: { from: () => ({ download: async () => { throw new Error(PATH); } }) } });
    expect(await downloadInvoicePdf(proof, { invoiceId: INVOICE, pdfPath: PATH })).toEqual({ ok: false, error: "error" });
  });
});

describe("switch off: every operation refuses before a client", () => {
  it("invoices_disabled", async () => {
    vi.stubEnv("NANNY_INVOICES_ENABLED", "");
    createAdminClient.mockClear();
    expect(await readSentInvoice(proof, INVOICE)).toEqual({ ok: false, error: "invoices_disabled" });
    expect(await cancelSentInvoice(proof, INVOICE, "other", NOW)).toEqual({ ok: false, error: "invoices_disabled" });
    expect(await recordCancelDelivery(proof, INVOICE, { family: "sent", nanny: "sent" })).toEqual({ ok: false, error: "invoices_disabled" });
    expect(await recordResend(proof, INVOICE, { what: "invoice", recipient: "family" }, "sent", NOW, NOW.toISOString())).toEqual({ ok: false, error: "invoices_disabled" });
    expect(await claimInvoiceResend(proof, INVOICE, "family", NOW)).toEqual({ ok: false, error: "invoices_disabled" });
    expect(await readNannyActive(proof)).toEqual({ ok: false, error: "invoices_disabled" });
    expect(await familyHasAccount(proof, PARENT_USER)).toEqual({ ok: false, error: "invoices_disabled" });
    expect(await downloadInvoicePdf(proof, { invoiceId: INVOICE, pdfPath: PATH })).toEqual({ ok: false, error: "invoices_disabled" });
    expect(createAdminClient).not.toHaveBeenCalled();
  });
});
