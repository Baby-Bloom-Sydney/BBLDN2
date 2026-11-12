/**
 * Her list's "View PDF" (plan 06 old step 14, §9 surface 6; brief §0.6, §9.9): a short-lived signed link to her own
 * invoice's stored PDF. With `store.ts`, `store-business.ts` and `store-delivery.ts`, one of the modules that touch
 * amendment 21's invoices table and its bucket. Server-only, and deliberately NOT a `"use server"` file (every async
 * export of one becomes a browser-callable action).
 *
 * - The switch first (`invoices_disabled`, before a client is made), then her proof; the nanny is always the proof's.
 * - **Made per click, after the owner read:** her own invoice that went out (sent or cancelled, R1's rule for what
 *   counts), at the one path it may have (`<nanny>/<invoice>.pdf`); anything else is `not_found` and no link is made.
 *   No list page carries a pre-signed link (plan §9 surface 6).
 * - The link lives `INVOICE_RULES.pdfLinkSeconds` (60 s). The bucket is private, with no object policy.
 * - Failures are logged by code only (`db.ts`): a storage error can name the path.
 *
 * BB-wave1-041126/06b4, 2026-11-12.
 */

import { z } from "zod";
import { INVOICE_RULES } from "@/config/invoices";
import { logFailure, readOne, serviceClient, type AdminClient } from "./db";
import { nannyGate } from "./gate";
import type { NannyProof } from "./nanny-proof";
import { countsAsIssued } from "./status";
import { FAILED, INVALID, INVOICE_STATUSES, invoiceOk, refused, type InvoiceResult } from "./types";

/** Amendment 21's private bucket (as `store-delivery.ts` names it). */
const BUCKET = "nanny-invoices";
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LINK_COLUMNS = "id, nanny_id, status, pdf_path";
const id = z.string().min(1);
const linkRow = z.object({ id, nanny_id: id, status: z.enum(INVOICE_STATUSES), pdf_path: z.string().min(1).nullable() });
type LinkRow = z.output<typeof linkRow>;

/** Hers, out (sent or cancelled), and at the one path it may have. */
function isHersToShow(proof: NannyProof, invoiceId: string, row: LinkRow | null): row is LinkRow & { pdf_path: string } {
  return (
    row !== null &&
    row.id === invoiceId &&
    row.nanny_id === proof.nannyId &&
    row.pdf_path === `${proof.nannyId}/${invoiceId}.pdf` &&
    countsAsIssued({ status: row.status, pdfPath: row.pdf_path })
  );
}

async function signedLink(admin: AdminClient, path: string): Promise<InvoiceResult<string>> {
  try {
    const { data, error } = await admin.storage.from(BUCKET).createSignedUrl(path, INVOICE_RULES.pdfLinkSeconds);
    if (error || typeof data?.signedUrl !== "string" || data.signedUrl === "") {
      logFailure("invoicePdfLink.sign", error ?? { code: "no_link" });
      return FAILED;
    }
    return invoiceOk(data.signedUrl);
  } catch (thrown) {
    logFailure("invoicePdfLink.sign", thrown);
    return FAILED;
  }
}

/** A 60-second signed link to her own invoice's stored PDF: `not_found` when there's none of hers that went out. */
export async function invoicePdfLink(proof: NannyProof, invoiceId: string): Promise<InvoiceResult<string>> {
  const gate = nannyGate(proof);
  if (gate) return gate;
  if (!GUID.test(invoiceId)) return INVALID;
  const admin = serviceClient();
  if (!admin) return FAILED;
  const row = await readOne("invoicePdfLink", () =>
    admin.from("nanny_invoices").select(LINK_COLUMNS).eq("id", invoiceId).eq("nanny_id", proof.nannyId).maybeSingle(), linkRow);
  if (!row.ok) return row;
  if (!isHersToShow(proof, invoiceId, row.value)) return refused("not_found");
  return signedLink(admin, row.value.pdf_path);
}
