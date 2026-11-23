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
 * 06c (plan 06 step 17; brief §3 admin 2): BAI's "View PDF" on `/admin/invoices` — `adminInvoicePdfLink` takes an
 * `AdminProof` and makes the same per-click, 60-second link to any nanny's invoice that went out, at the one path it may
 * have (`<its nanny>/<invoice>.pdf`). Not exported through the entry point (whose readers never return a link): the
 * admin route imports it from here, inside the feature's folders, as the nanny's route does.
 *
 * BB-wave1-041126/06b4, 2026-11-12; BB-wave1-041126/06c, 2026-11-23.
 */

import { z } from "zod";
import { INVOICE_RULES } from "@/config/invoices";
import type { AdminProof } from "@/lib/calls/admin-proof";
import { logFailure, readOne, serviceClient, type AdminClient } from "./db";
import { adminGate, nannyGate } from "./gate";
import { INVOICE_BUCKET } from "./store-delivery";
import type { NannyProof } from "./nanny-proof";
import { countsAsIssued } from "./status";
import { FAILED, INVALID, INVOICE_STATUSES, invoiceOk, refused, type InvoiceResult } from "./types";

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LINK_COLUMNS = "id, nanny_id, status, pdf_path";
const id = z.string().min(1);
const linkRow = z.object({ id, nanny_id: id, status: z.enum(INVOICE_STATUSES), pdf_path: z.string().min(1).nullable() });
type LinkRow = z.output<typeof linkRow>;

type ShownRow = LinkRow & { pdf_path: string };

/** Out (sent or cancelled), and at the one path it may have: `<its nanny>/<invoice>.pdf`. */
function isOutAtItsPath(invoiceId: string, row: LinkRow | null): row is ShownRow {
  return (
    row !== null &&
    row.id === invoiceId &&
    row.pdf_path === `${row.nanny_id}/${invoiceId}.pdf` &&
    countsAsIssued({ status: row.status, pdfPath: row.pdf_path })
  );
}

/** Hers, out (sent or cancelled), and at the one path it may have. */
function isHersToShow(proof: NannyProof, invoiceId: string, row: LinkRow | null): row is ShownRow {
  return isOutAtItsPath(invoiceId, row) && row.nanny_id === proof.nannyId;
}

async function signedLink(admin: AdminClient, path: string): Promise<InvoiceResult<string>> {
  try {
    const { data, error } = await admin.storage.from(INVOICE_BUCKET).createSignedUrl(path, INVOICE_RULES.pdfLinkSeconds);
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

/** BAI's "View PDF" (06c): a 60-second signed link to any invoice that went out; `not_found` when there's none. */
export async function adminInvoicePdfLink(proof: AdminProof, invoiceId: string): Promise<InvoiceResult<string>> {
  const gate = adminGate(proof);
  if (gate) return gate;
  if (!GUID.test(invoiceId)) return INVALID;
  const admin = serviceClient();
  if (!admin) return FAILED;
  const row = await readOne("adminInvoicePdfLink", () =>
    admin.from("nanny_invoices").select(LINK_COLUMNS).eq("id", invoiceId).maybeSingle(), linkRow);
  if (!row.ok) return row;
  if (!isOutAtItsPath(invoiceId, row.value)) return refused("not_found");
  return signedLink(admin, row.value.pdf_path);
}
