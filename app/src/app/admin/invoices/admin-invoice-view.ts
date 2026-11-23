/**
 * `/admin/invoices` as the page shows it (plan 06 step 17, §14.6 c.1; brief §0.11, §3 admin 2; A14). Pure, and used by
 * the server page only: it maps BAI's list (`listAdminInvoices`, newest first) into rows of strings, so the browser
 * gets what it shows and the invoice id its "View PDF" needs — never a user id, an email, a bank field or a path.
 *
 * - **The period** is the invoice's first to last shift date, formatted exactly as on the nanny's list (`periodLabel`).
 * - **The kind** is the link's label (`INVOICE_KIND_LABELS`: "Hired" / "Trial").
 * - **Money:** the total (childcare, any VAT on top, expenses), "incl. £x expenses" when there are any, the VAT mode.
 * - **Status:** "Sent", or "Cancelled · <reason>" (`CANCEL_REASON_LABELS`, the nanny's words), "Replaces …" /
 *   "Replaced by …", and each recorded delivery, both recipients (a failure reads "not delivered").
 * - **Per family:** the same `summarise()` as 07's reader, printed by `formatFamilySummary`, "(excluding cancelled)"
 *   (brief §0.11). Families and nannies are keyed "family-1", "nanny-1"… by name, so two with one name stay two.
 *
 * Server reads and the summary come through the entry point (`@/lib/invoices`); the pure formatting helpers from their
 * modules inside the feature, as the nanny's `invoice-list-view.ts` does.
 *
 * BB-wave1-041126/06c, 2026-11-23.
 */

import { INVOICE_RULES } from "@/config/invoices";
import { formatFamilySummary, summarise, type AdminInvoice } from "@/lib/invoices";
import { CANCEL_REASON_LABELS } from "@/lib/invoices/emails/invoice-wording";
import { formatHours, formatInvoiceMoney } from "@/lib/invoices/money";
import type { VatMode } from "@/lib/invoices/types";
import { periodLabel } from "@/lib/invoices/week";
import {
  INVOICE_KIND_LABELS,
  INVOICE_STATUS_LABELS,
  type AdminDelivery,
  type AdminFamily,
  type AdminInvoiceRow,
  type AdminInvoicesView,
} from "./types";

const VAT_LABELS: Readonly<Record<VatMode, string>> = Object.freeze({ none: "No VAT", included: "VAT included", added: "VAT added" });

type DeliveryKey = keyof AdminInvoice["delivery"];
/** In this order; a recorded "sent" reads as the first text, "failed" as the second. */
const DELIVERY_TEXT: ReadonlyArray<readonly [DeliveryKey, string, string]> = [
  ["family", "Emailed to the family", "Not delivered to the family"],
  ["nanny", "Copy emailed to the nanny", "Copy not delivered to the nanny"],
  ["cancelFamily", "Cancellation emailed to the family", "Cancellation not delivered to the family"],
  ["cancelNanny", "Cancellation emailed to the nanny", "Cancellation not delivered to the nanny"],
];

function deliveriesOf(invoice: AdminInvoice): readonly AdminDelivery[] {
  return DELIVERY_TEXT.flatMap(([key, sent, failed]): AdminDelivery[] => {
    const recorded = invoice.delivery[key];
    if (recorded === null) return [];
    return [{ text: recorded === "sent" ? sent : failed, delivered: recorded === "sent" }];
  });
}

function statusLabelOf(invoice: AdminInvoice): string {
  const label = INVOICE_STATUS_LABELS[invoice.status];
  return invoice.status === "cancelled" && invoice.cancelReason !== null ? `${label} · ${CANCEL_REASON_LABELS[invoice.cancelReason]}` : label;
}

/** A family or nanny as a filter offers it. */
interface KeyedName {
  readonly key: string;
  readonly name: string;
}

/**
 * Each id once, under its newest name (the list is newest first, and a name is the one sent), sorted by name (then id,
 * so the keys are stable), keyed `<prefix>-1`, `<prefix>-2`…
 */
function keyed(entries: readonly (readonly [string, string])[], prefix: string): ReadonlyMap<string, KeyedName> {
  const unique = [...new Map([...entries].reverse()).entries()].sort(([idA, a], [idB, b]) => a.localeCompare(b, "en-GB") || idA.localeCompare(idB));
  return new Map(unique.map(([id, name], i) => [id, { key: `${prefix}-${i + 1}`, name }]));
}

function rowOf(invoice: AdminInvoice, familyKey: string, nannyKey: string): AdminInvoiceRow {
  return {
    invoiceId: invoice.invoiceId,
    number: invoice.number,
    familyKey,
    familyName: invoice.familyName,
    nannyKey,
    nannyName: invoice.nannyName,
    kind: invoice.kind,
    kindLabel: INVOICE_KIND_LABELS[invoice.kind],
    period: periodLabel(invoice.periodStart, invoice.periodEnd),
    hours: `${formatHours(invoice.hours)} h`,
    expenses: invoice.expensesPence > 0 ? `incl. ${formatInvoiceMoney(invoice.expensesPence)} expenses` : null,
    vat: VAT_LABELS[invoice.vatMode],
    total: formatInvoiceMoney(invoice.totalPence),
    status: invoice.status,
    statusLabel: statusLabelOf(invoice),
    replacesNumber: invoice.replacesNumber,
    replacedByNumber: invoice.replacedByNumber,
    deliveries: deliveriesOf(invoice),
  };
}

/** One family's line: `summarise()` over its invoices here, as 07 reads it. */
function familySummary(invoices: readonly AdminInvoice[], parentUserId: string): string {
  return `${formatFamilySummary(summarise(invoices.filter((i) => i.parentUserId === parentUserId)))} (excluding cancelled)`;
}

/** BAI's list as the page's props (without `loadFailed`). */
export function toAdminInvoicesView(invoices: readonly AdminInvoice[]): AdminInvoicesView {
  const families = keyed(invoices.map((i) => [i.parentUserId, i.familyName] as const), "family");
  const nannies = keyed(invoices.map((i) => [i.nannyId, i.nannyName] as const), "nanny");
  const keyOf = (keys: ReadonlyMap<string, KeyedName>, id: string): string => keys.get(id)?.key ?? "";
  return {
    rows: invoices.map((i) => rowOf(i, keyOf(families, i.parentUserId), keyOf(nannies, i.nannyId))),
    families: [...families.entries()].map(([id, f]): AdminFamily => ({ ...f, summary: familySummary(invoices, id) })),
    nannies: [...nannies.values()],
    atLimit: invoices.length >= INVOICE_RULES.adminListLimit,
  };
}
