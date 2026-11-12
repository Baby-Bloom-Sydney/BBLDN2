/**
 * Her list's "View PDF" (plan 06 old step 14, §9 surface 6; brief §0.6, §9.9): a link to her own invoice's stored PDF,
 * made per click, after the owner read, living `pdfLinkSeconds` (60 s). Only an invoice that went out — sent or
 * cancelled — at its own path; anything else is `not_found`, with no link made. The switch first; failures logged by
 * code only (a storage error can name the path).
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
import { INVOICE_BUCKET } from "./store-delivery";
import { invoicePdfLink } from "./store-pdf-link";

const PATH = `${NANNY_ID}/${INVOICE}.pdf`;
const OTHER_NANNY = "b0600000-0000-4000-8000-000000000102";
const LINK = "https://example.supabase.co/storage/v1/object/sign/nanny-invoices/x.pdf?token=t";
const linkRow = (over: Readonly<Record<string, unknown>> = {}) => ({ id: INVOICE, nanny_id: NANNY_ID, status: "sent", pdf_path: PATH, ...over });

let f: FakeAdmin;
let proof: NannyProof;
let signed: Array<[string, string, unknown]>;
const spies: Array<ReturnType<typeof vi.spyOn>> = [];

function withSign(result: { data: unknown; error: unknown } | "throw"): void {
  Object.assign(f.client, {
    storage: {
      from: (bucket: string) => ({
        createSignedUrl: async (path: string, seconds: unknown) => {
          signed.push([bucket, path, seconds]);
          if (result === "throw") throw new Error(PATH);
          return result;
        },
      }),
    },
  });
}

beforeEach(async () => {
  vi.stubEnv("NANNY_INVOICES_ENABLED", "true");
  f = fakeAdmin({ nanny_invoices: linkRow() });
  signed = [];
  withSign({ data: { signedUrl: LINK }, error: null });
  createAdminClient.mockReset().mockReturnValue(f.client);
  getNannyId.mockReset().mockResolvedValue({ nannyId: NANNY_ID, userId: NANNY_USER });
  const p = await proveNanny();
  if (!p) throw new Error("fixture proof");
  proof = p;
  spies.splice(0);
  for (const level of ["error", "warn", "log", "info"] as const) spies.push(vi.spyOn(console, level).mockImplementation(() => {}));
});

afterEach(() => {
  const logged = JSON.stringify(spies.flatMap((s) => s.mock.calls));
  expect(logged).not.toMatch(SECRETS);
  expect(logged).not.toContain(PATH);
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("invoicePdfLink", () => {
  it.each(["sent", "cancelled"])("her %s invoice: a 60-second signed link to its stored PDF, after the owner read", async (status) => {
    f.reads.nanny_invoices = linkRow({ status });
    expect(await invoicePdfLink(proof, INVOICE)).toEqual({ ok: true, value: LINK });
    expect(signed).toEqual([[INVOICE_BUCKET, PATH, 60]]);
    expect(INVOICE_BUCKET).toBe("nanny-invoices");
    const read = f.ops.find((o) => o.table === "nanny_invoices");
    expect(read?.kind).toBe("select");
    expect(read?.filters).toEqual(expect.arrayContaining([["eq", "id", INVOICE], ["eq", "nanny_id", NANNY_ID]]));
  });

  it("none of hers, not out yet, failed, no PDF, or not her path → not_found, no link made", async () => {
    for (const row of [
      null, linkRow({ status: "sending" }), linkRow({ status: "failed" }), linkRow({ pdf_path: null }),
      linkRow({ nanny_id: OTHER_NANNY }), linkRow({ pdf_path: `${OTHER_NANNY}/${INVOICE}.pdf` }),
    ]) {
      f.reads.nanny_invoices = row;
      expect(await invoicePdfLink(proof, INVOICE)).toEqual({ ok: false, error: "not_found" });
    }
    expect(signed).toEqual([]);
  });

  it("not an id → invalid, nothing read", async () => {
    expect(await invoicePdfLink(proof, "../x")).toEqual({ ok: false, error: "invalid" });
    expect(f.ops).toEqual([]);
  });

  it("a read failure, a row that doesn't fit, or a signing failure → error, logged by code only", async () => {
    f.readErrors.nanny_invoices = { message: `boom ${PATH}`, code: "XX000" };
    expect(await invoicePdfLink(proof, INVOICE)).toEqual({ ok: false, error: "error" });
    f.readErrors.nanny_invoices = undefined;
    f.reads.nanny_invoices = linkRow({ status: "lost" });
    expect(await invoicePdfLink(proof, INVOICE)).toEqual({ ok: false, error: "error" });
    f.reads.nanny_invoices = linkRow();
    withSign({ data: null, error: { message: `not found ${PATH}` } });
    expect(await invoicePdfLink(proof, INVOICE)).toEqual({ ok: false, error: "error" });
    withSign({ data: { signedUrl: "" }, error: null });
    expect(await invoicePdfLink(proof, INVOICE)).toEqual({ ok: false, error: "error" });
    withSign("throw");
    expect(await invoicePdfLink(proof, INVOICE)).toEqual({ ok: false, error: "error" });
  });

  it("switch off → invoices_disabled before a client; not a proof → invalid", async () => {
    vi.stubEnv("NANNY_INVOICES_ENABLED", "false");
    createAdminClient.mockClear();
    expect(await invoicePdfLink(proof, INVOICE)).toEqual({ ok: false, error: "invoices_disabled" });
    expect(createAdminClient).not.toHaveBeenCalled();
    vi.stubEnv("NANNY_INVOICES_ENABLED", "true");
    expect(await invoicePdfLink({ nannyId: NANNY_ID } as unknown as NannyProof, INVOICE)).toEqual({ ok: false, error: "invalid" });
  });
});
