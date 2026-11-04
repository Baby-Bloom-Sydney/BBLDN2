/**
 * The PDF's data from what the store returns (plan 06 step 8): the created invoice's snapshots (number, family,
 * her name, the figures) and her saved details (trading name, address, bank details). Pure.
 *
 * BB-wave1-041126/06a-build, 2026-11-04.
 */

import type { CreatedInvoice, StoredPaymentDetails } from "../store-map";
import type { InvoicePdfData } from "./InvoicePdf";

/** Throws a RangeError if her details now name a different account than the invoice recorded (changed in between). */
export function invoicePdfData(created: CreatedInvoice, details: StoredPaymentDetails): InvoicePdfData {
  if (details.accountLast4 !== created.accountLast4) throw new RangeError("payment details changed since the invoice was created");
  return {
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
  };
}
