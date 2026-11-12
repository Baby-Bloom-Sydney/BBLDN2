/**
 * What happens to an invoice after it is created (plan 06 §4 "Bucket", R1, R15; old steps 12–13; 06a handoff
 * "create → render → upload → both emails → finish"): its PDF in the private bucket. With `store.ts` and
 * `store-business.ts`, the only modules that touch amendment 21's tables and its bucket. Server-only, and
 * deliberately NOT a `"use server"` file (every async export of one becomes a browser-callable action).
 *
 * - **The PDF:** uploaded once, to the path the created row fixed (`<nanny>/<invoice>.pdf`, amendment 21's CHECK),
 *   never over an existing object (`upsert: false`), as a PDF within the bucket's 2 MB. Only her own path: the
 *   nanny in the path is the proof's.
 * - The switch first (`invoices_disabled`, before a client is made), then her proof. Failures are logged by code
 *   only (`db.ts`): a storage error can name the path.
 *
 * BB-wave1-041126/06b4, 2026-11-12.
 */

import { logFailure, serviceClient } from "./db";
import { nannyGate } from "./gate";
import type { NannyProof } from "./nanny-proof";
import { FAILED, INVALID, invoiceOk, type InvoiceResult } from "./types";

/** Amendment 21's private bucket: PDF only, 2 MB, no `storage.objects` policy (service role only). */
export const INVOICE_BUCKET = "nanny-invoices";
const PDF_MAX_BYTES = 2 * 1024 * 1024;
const PDF_MAGIC = "%PDF";
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The one path an invoice of hers may have: `<nanny>/<invoice>.pdf` (amendment 21's `nanny_invoices_pdf_path_check`). */
function isOwnPath(proof: NannyProof, invoiceId: string, pdfPath: string): boolean {
  return GUID.test(invoiceId) && pdfPath === `${proof.nannyId}/${invoiceId}.pdf`;
}

const isPdf = (bytes: Buffer): boolean =>
  bytes.length > PDF_MAGIC.length && bytes.length <= PDF_MAX_BYTES && bytes.subarray(0, PDF_MAGIC.length).toString("latin1") === PDF_MAGIC;

/** Store a created invoice's PDF (before any email: an invoice is "sent" only once its PDF is stored, R1). */
export async function uploadInvoicePdf(
  proof: NannyProof,
  invoice: { readonly invoiceId: string; readonly pdfPath: string },
  pdf: Buffer,
): Promise<InvoiceResult<true>> {
  const gate = nannyGate(proof);
  if (gate) return gate;
  if (!isOwnPath(proof, invoice.invoiceId, invoice.pdfPath) || !isPdf(pdf)) return INVALID;
  const admin = serviceClient();
  if (!admin) return FAILED;
  try {
    const { error } = await admin.storage.from(INVOICE_BUCKET).upload(invoice.pdfPath, pdf, { contentType: "application/pdf", upsert: false });
    if (error) {
      logFailure("uploadInvoicePdf", error);
      return FAILED;
    }
    return invoiceOk(true);
  } catch (thrown) {
    logFailure("uploadInvoicePdf", thrown);
    return FAILED;
  }
}
