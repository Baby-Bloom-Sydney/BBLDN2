/**
 * Which rows count, and what a list shows (plan R1). Readers, the admin summary and the daily cap count only a sent
 * row with its PDF; a `sending` row older than `staleSendingMinutes` shows as failed (the send stopped part-way).
 *
 * BB-wave1-041126/06a-build, 2026-11-04.
 */

import { INVOICE_RULES } from "@/config/invoices";
import type { InvoiceStatus } from "./types";

const MINUTE_MS = 60_000;

export interface CountedRow {
  readonly status: InvoiceStatus;
  readonly pdfPath: string | null;
}

/** A live invoice: sent, with its PDF. */
export function countsAsSent(row: CountedRow): boolean {
  return row.status === "sent" && row.pdfPath !== null;
}

/** An invoice that went out (cancelled ones too): what a family's history lists. */
export function countsAsIssued(row: CountedRow): boolean {
  return (row.status === "sent" || row.status === "cancelled") && row.pdfPath !== null;
}

export function shownStatus(row: { readonly status: InvoiceStatus; readonly createdAt: string }, now: Date): InvoiceStatus {
  if (row.status !== "sending") return row.status;
  const created = Date.parse(row.createdAt);
  if (!Number.isFinite(created)) return "failed";
  return now.getTime() - created >= INVOICE_RULES.staleSendingMinutes * MINUTE_MS ? "failed" : "sending";
}
