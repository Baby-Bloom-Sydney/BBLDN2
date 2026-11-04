/**
 * The PDF's data from what the store returns (plan 06 step 8): the created invoice's snapshots (number, family,
 * her name, the figures) and her saved details (trading name, address, bank details). Pure.
 *
 * BB-wave1-041126/06a-build, 2026-11-04.
 */

import type { CreatedInvoice, StoredPaymentDetails } from "../store-map";
import { invoiceOk, refused, type InvoiceResult } from "../types";
import type { InvoicePdfData } from "./InvoicePdf";

/**
 * `no_details` when her details now name a different account than the invoice recorded (changed in between): a
 * result, not a throw, so the send path can always finish the row as failed (06a code review 9).
 */
export function invoicePdfData(created: CreatedInvoice, details: StoredPaymentDetails): InvoiceResult<InvoicePdfData> {
  if (details.accountLast4 !== created.accountLast4) return refused("no_details");
  return invoiceOk({
    number: created.number,
    issuedAt: created.createdAt,
    issuer: { name: created.nannyName, tradingName: details.tradingName, address: details.invoiceAddress },
    billTo: { name: created.familyName, email: created.familyEmail },
    line: {
      kind: created.kind,
      periodStart: created.periodStart,
      hours: created.hours,
      ratePence: created.ratePence,
      totalPence: created.totalPence,
    },
    payTo: { accountName: details.accountName, sortCode: details.sortCode, accountNumber: details.accountNumber },
    replacesNumber: created.replacesNumber,
  });
}
