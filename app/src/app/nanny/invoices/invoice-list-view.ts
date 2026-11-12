/**
 * Her invoice list as the page shows it (plan 06 old step 14, §14.6 b4.4; brief §0.6–0.9, §3 nanny 7–11; R1, R15).
 * Pure: the server page maps her invoices (`readMyInvoices`, newest first) into rows of strings, so the browser gets
 * what it shows and the invoice id its buttons need — never the family's, her own or a placement's id.
 *
 * - **Status** is the shown one (`status.ts`): a send stuck past the stale time is `failed` (R1).
 * - **"Emailed ✓"** once the family's email went. **Undelivered** — what can be resent, a recorded failure (the resend
 *   action's rule): on a sent invoice, the invoice email to whoever didn't get it; on a cancelled one, the
 *   cancellation (R15).
 * - **Actions:** "View PDF" on an invoice that went out; "Cancel invoice" on a sent one; "Send a corrected invoice" on
 *   a cancelled one no live invoice has corrected yet (the review's R4 rule; a failed correction doesn't count).
 * - `noticeFor`: the three send answers that land on the list (`in_progress`, `already_done`, `not_recorded`), as
 *   their plain messages; anything else in `?notice=` is ignored.
 *
 * BB-wave1-041126/06b4, 2026-11-12.
 */

import { INVOICE_ACTION_MESSAGES, type ResendRecipient, type ResendWhat } from "@/lib/invoices/actions/invoice-messages";
import { CANCEL_REASON_LABELS, periodForSubject } from "@/lib/invoices/emails/invoice-wording";
import { formatHours, formatInvoiceMoney } from "@/lib/invoices/money";
import { shownStatus } from "@/lib/invoices/status";
import type { MyInvoice } from "@/lib/invoices/store-map-lines";
import type { EmailDelivery, InvoiceStatus } from "@/lib/invoices/types";

export interface Undelivered {
  readonly what: ResendWhat;
  readonly recipient: ResendRecipient;
}

export interface InvoiceRowView {
  readonly invoiceId: string;
  readonly number: string;
  readonly familyName: string;
  /** "week of 8 Feb 2027" or "Trial Shift, Wed 3 Feb 2027". */
  readonly period: string;
  /** "30 h". */
  readonly hours: string;
  /** The total, in the one money format (`formatInvoiceMoney`). */
  readonly total: string;
  readonly status: InvoiceStatus;
  /** The reason's label, when cancelled. */
  readonly cancelReason: string | null;
  /** The family's invoice email went. */
  readonly emailed: boolean;
  readonly undelivered: readonly Undelivered[];
  readonly replacesNumber: string | null;
  readonly replacedByNumber: string | null;
  readonly hasPdf: boolean;
  readonly canCancel: boolean;
  readonly canCorrect: boolean;
}

/** The resend action's rule: only a recorded failure can be resent (null = no record; a sent row always has one). */
const notSent = (delivery: EmailDelivery | null): boolean => delivery === "failed";

function undeliveredOf(invoice: MyInvoice, status: InvoiceStatus): readonly Undelivered[] {
  const d = invoice.delivery;
  if (status === "sent") {
    return [
      ...(notSent(d.family) ? [{ what: "invoice", recipient: "family" } as const] : []),
      ...(notSent(d.nanny) ? [{ what: "invoice", recipient: "nanny" } as const] : []),
    ];
  }
  if (status !== "cancelled") return [];
  return [
    ...(notSent(d.cancelFamily) ? [{ what: "cancellation", recipient: "family" } as const] : []),
    ...(notSent(d.cancelNanny) ? [{ what: "cancellation", recipient: "nanny" } as const] : []),
  ];
}

/** The live invoice that corrects this one (a failed correction doesn't count). */
function correctionOf(mine: readonly MyInvoice[], invoice: MyInvoice, now: Date): MyInvoice | undefined {
  return mine.find((i) => i.replacesInvoiceId === invoice.invoiceId && shownStatus(i, now) !== "failed");
}

function rowOf(invoice: MyInvoice, mine: readonly MyInvoice[], now: Date): InvoiceRowView {
  const status = shownStatus(invoice, now);
  const correction = status === "cancelled" ? correctionOf(mine, invoice, now) : undefined;
  return {
    invoiceId: invoice.invoiceId,
    number: invoice.number,
    familyName: invoice.familyName,
    period: periodForSubject(invoice.kind, invoice.periodStart),
    hours: `${formatHours(invoice.hours)} h`,
    total: formatInvoiceMoney(invoice.totalPence),
    status,
    cancelReason: status === "cancelled" && invoice.cancelReason !== null ? CANCEL_REASON_LABELS[invoice.cancelReason] : null,
    emailed: status === "sent" && invoice.delivery.family === "sent",
    undelivered: undeliveredOf(invoice, status),
    replacesNumber: invoice.replacesInvoiceId === null ? null : mine.find((i) => i.invoiceId === invoice.replacesInvoiceId)?.number ?? null,
    replacedByNumber: correction?.number ?? null,
    // a sent row has its PDF stored (the database refuses `sent` before it, R1); a cancel keeps it
    hasPdf: status === "sent" || status === "cancelled",
    canCancel: status === "sent",
    canCorrect: status === "cancelled" && correction === undefined,
  };
}

/** Her invoices as rows, in the order read (newest first). */
export function toInvoiceRows(mine: readonly MyInvoice[], now: Date): readonly InvoiceRowView[] {
  return mine.map((invoice) => rowOf(invoice, mine, now));
}

/** Each family once, by name (the list's filter, R14a). */
export function familyNames(rows: readonly InvoiceRowView[]): readonly string[] {
  return [...new Set(rows.map((r) => r.familyName))].sort((a, b) => a.localeCompare(b, "en-GB"));
}

const NOTICES = ["in_progress", "already_done", "not_recorded"] as const;
type Notice = (typeof NOTICES)[number];
const isNotice = (value: unknown): value is Notice => typeof value === "string" && (NOTICES as readonly string[]).includes(value);

/** A send answer the list shows (`?notice=`), as its plain message; anything else → null. */
export function noticeFor(value: unknown): string | null {
  return isNotice(value) ? INVOICE_ACTION_MESSAGES[value] : null;
}
