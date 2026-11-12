/**
 * The invoice's PDF in the private bucket (plan 06 §4 "Bucket", R1; 06a handoff "create → render → upload → both
 * emails → finish"): uploaded once, to the path the created row fixed (`<nanny>/<invoice>.pdf`), never over an
 * existing object (`upsert: false`), as a PDF. Her own path only; the switch first; failures logged by code only.
 *
 * BB-wave1-041126/06b4, 2026-11-12.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { getNannyId, createAdminClient } = vi.hoisted(() => ({ getNannyId: vi.fn(), createAdminClient: vi.fn() }));
vi.mock("@/lib/actions/connection", () => ({ getNannyId }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient }));

import { fakeAdmin, type FakeAdmin } from "@/lib/payments/fake-admin.test-util";
import { INVOICE, NANNY_ID, NANNY_USER, SECRETS } from "./invoice-rows.test-util";
import { proveNanny, type NannyProof } from "./nanny-proof";
import { INVOICE_BUCKET, uploadInvoicePdf } from "./store-delivery";

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
