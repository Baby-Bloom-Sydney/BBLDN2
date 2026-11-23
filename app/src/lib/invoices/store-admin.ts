/**
 * BAI's read-only `/admin/invoices` list, the store's half (plan 06 step 17, §14.6 c.1; brief §0.11, §3 admin; R1):
 * every invoice that went out — sent or cancelled, with its PDF, the readers' rule — newest sent first, at most
 * `INVOICE_RULES.adminListLimit` (500, the `/admin/guarantees` precedent). With `store.ts`, `store-business.ts`,
 * `store-delivery.ts`, `store-pdf-link.ts` and `store-reminders.ts`, one of the modules that touch amendment 21's
 * invoices table. Server-only, and deliberately NOT a `"use server"` file (every async export of one becomes a
 * browser-callable action).
 *
 * - The switch first (`invoices_disabled`, before a client is made), then an `AdminProof` (`proveAdmin()`); anything
 *   else is `invalid` before a read.
 * - The family readers' columns plus the family's name, the VAT mode and the four email deliveries: no email, bank,
 *   issuer or link column (`pdf_path` is read only to re-check R1, and never leaves).
 * - Rows the query returned that never went out are dropped again here; a row that doesn't fit fails the read.
 *   Failures are logged by code only (`db.ts`).
 *
 * BB-wave1-041126/06c, 2026-11-23.
 */

import { z } from "zod";
import { INVOICE_RULES } from "@/config/invoices";
import type { AdminProof } from "@/lib/calls/admin-proof";
import { DB_FAILED, dbOk, logFailure, parseRows, serviceClient, type AdminClient, type DbResult } from "./db";
import { adminGate } from "./gate";
import { countsAsIssued } from "./status";
import { FAMILY_COLUMNS, familyRow, toFamilyRow, type FamilyRow } from "./store-map";
import { FAILED, invoiceOk, VAT_MODES, type EmailDelivery, type InvoiceResult, type VatMode } from "./types";

/** The family readers' columns, the family's name, the VAT mode and the deliveries (no email address among them). */
export const ADMIN_COLUMNS =
  `${FAMILY_COLUMNS}, parent_user_id, family_name, vat_mode, ` +
  "family_email_status, nanny_email_status, cancel_family_email_status, cancel_nanny_email_status";

/** Each email's delivery as recorded (null = no record: a sent invoice's cancellation emails, before any cancel). */
export interface InvoiceDeliveries {
  readonly family: EmailDelivery | null;
  readonly nanny: EmailDelivery | null;
  readonly cancelFamily: EmailDelivery | null;
  readonly cancelNanny: EmailDelivery | null;
}

/** A family reader's row, with whom it went to (the family's id and name), its VAT mode and its deliveries. */
export interface AdminRow extends FamilyRow {
  readonly parentUserId: string;
  readonly familyName: string;
  readonly vatMode: VatMode;
  readonly delivery: InvoiceDeliveries;
}

const delivery = z.enum(["sent", "failed"]).nullable();
const adminRow = z.intersection(
  familyRow,
  z.object({
    parent_user_id: z.string().min(1),
    family_name: z.string(),
    vat_mode: z.enum(VAT_MODES),
    family_email_status: delivery,
    nanny_email_status: delivery,
    cancel_family_email_status: delivery,
    cancel_nanny_email_status: delivery,
  }),
);
type AdminRowIn = z.output<typeof adminRow>;

const toAdminRow = (r: AdminRowIn, status: "sent" | "cancelled", sentAt: string): AdminRow => ({
  ...toFamilyRow(r, status, sentAt),
  parentUserId: r.parent_user_id,
  familyName: r.family_name,
  vatMode: r.vat_mode,
  delivery: {
    family: r.family_email_status,
    nanny: r.nanny_email_status,
    cancelFamily: r.cancel_family_email_status,
    cancelNanny: r.cancel_nanny_email_status,
  },
});

/** The newest issued rows, one request (the limit is the page). Never throws. */
async function newestIssued(admin: AdminClient): Promise<DbResult<readonly unknown[]>> {
  try {
    const { data, error } = await admin.from("nanny_invoices").select(ADMIN_COLUMNS).in("status", ["sent", "cancelled"])
      .not("pdf_path", "is", null).order("sent_at", { ascending: false }).order("id", { ascending: false })
      .limit(INVOICE_RULES.adminListLimit);
    if (error || !Array.isArray(data)) {
      logFailure("readAdminInvoiceRows", error ?? { code: "unexpected_rows" });
      return DB_FAILED;
    }
    return dbOk(data);
  } catch (thrown) {
    logFailure("readAdminInvoiceRows", thrown);
    return DB_FAILED;
  }
}

/** Every invoice that went out, to any family, newest sent first (the newest `adminListLimit`), re-checked here. */
export async function readAdminInvoiceRows(proof: AdminProof): Promise<InvoiceResult<readonly AdminRow[]>> {
  const gate = adminGate(proof);
  if (gate) return gate;
  const admin = serviceClient();
  if (!admin) return FAILED;
  const parsed = parseRows("readAdminInvoiceRows", await newestIssued(admin), adminRow);
  if (!parsed.ok) return parsed;
  return invoiceOk(parsed.value.flatMap((r) =>
    countsAsIssued({ status: r.status, pdfPath: r.pdf_path }) && (r.status === "sent" || r.status === "cancelled") && r.sent_at !== null
      ? [toAdminRow(r, r.status, r.sent_at)]
      : []));
}
