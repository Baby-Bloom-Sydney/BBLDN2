/**
 * `/admin/invoices` (plan 06 step 17, §14.6 c.1; brief §0.11, §3 admin): what the page hands the browser — rows of
 * strings, the per-family summary lines and the filters' choices — and the labels both halves share. Client-safe.
 *
 * - **The kind** is the link the invoice was sent on, never chosen (06b-4 rework): a placement is "Hired" (the admin
 *   pipeline's word for a placement), a trial connection "Trial" (the connect modal's option). 06b-4's screens have no
 *   kind label left, so these are the only ones (ledger B06 § PR 06c §1).
 * - Families and nannies are keyed by opaque keys ("family-1"), so no user id reaches the browser.
 *
 * BB-wave1-041126/06c, 2026-11-23.
 */

import type { InvoiceKind, IssuedStatus } from "@/lib/invoices/types";

/** The kind's label: the link's type, in words the app already uses. */
export const INVOICE_KIND_LABELS: Readonly<Record<InvoiceKind, string>> = Object.freeze({
  regular_week: "Hired",
  trial_shift: "Trial",
});

/** The status's label (the nanny's list says the same). */
export const INVOICE_STATUS_LABELS: Readonly<Record<IssuedStatus, string>> = Object.freeze({
  sent: "Sent",
  cancelled: "Cancelled",
});

/** One email's delivery, as a line: "Emailed to the family", "Cancellation not delivered to the nanny". */
export interface AdminDelivery {
  readonly text: string;
  readonly delivered: boolean;
}

export interface AdminInvoiceRow {
  /** Its "View PDF" goes to `/admin/invoices/<id>/pdf`. */
  readonly invoiceId: string;
  readonly number: string;
  readonly familyKey: string;
  readonly familyName: string;
  readonly nannyKey: string;
  readonly nannyName: string;
  readonly kind: InvoiceKind;
  readonly kindLabel: string;
  /** First to last shift date, as the nanny's list prints it: "8–12 Feb 2027", "3 Feb 2027". */
  readonly period: string;
  /** "30 h". */
  readonly hours: string;
  /** "incl. <expenses> expenses", or null when there are none. */
  readonly expenses: string | null;
  /** "No VAT", "VAT included", "VAT added". */
  readonly vat: string;
  /** The invoice's total: childcare, any VAT on top, and expenses. */
  readonly total: string;
  readonly status: IssuedStatus;
  /** "Sent", "Cancelled · Wrong hours". */
  readonly statusLabel: string;
  readonly replacesNumber: string | null;
  readonly replacedByNumber: string | null;
  readonly deliveries: readonly AdminDelivery[];
}

export interface AdminFamily {
  readonly key: string;
  readonly name: string;
  /** `formatFamilySummary(summarise(…))` "(excluding cancelled)": "2 invoices · 1 cancelled · 28 h · <total> (excluding cancelled)". */
  readonly summary: string;
}

export interface AdminNanny {
  readonly key: string;
  readonly name: string;
}

/** The page's props (the RSC payload), without `loadFailed`. */
export interface AdminInvoicesView {
  /** Newest first. */
  readonly rows: readonly AdminInvoiceRow[];
  /** By name. */
  readonly families: readonly AdminFamily[];
  /** By name. */
  readonly nannies: readonly AdminNanny[];
  /** The read held the admin limit: older invoices aren't shown. */
  readonly atLimit: boolean;
}
