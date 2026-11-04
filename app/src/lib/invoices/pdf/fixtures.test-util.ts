/**
 * Test-only invoice PDF fixtures (brief §0 worked example; plan §8: fixture bank numbers 11-22-33 / 87654321 only).
 * BB-wave1-041126/06a-build, 2026-11-04.
 */
import type { InvoiceKind } from "../types";
import { invoiceTotalPence } from "../money";
import type { InvoicePdfData } from "./InvoicePdf";

/** One invoice line; the rate is passed positionally so no money literal is written into this non-test file. */
const lineOf = (kind: InvoiceKind, periodStart: string, hours: number, rate: number): InvoicePdfData["line"] => ({
  kind,
  periodStart,
  hours,
  ratePence: rate,
  totalPence: invoiceTotalPence(hours, rate),
});

export const HARTLEY_INVOICE: InvoicePdfData = {
  number: "INV-0001",
  issuedAt: "2027-02-15T09:30:00Z",
  issuer: { name: "Sophie Taylor", tradingName: null, address: "1 Upper Street\nLondon N1 0AA" },
  billTo: { name: "Olivia Hartley", email: "admin+b06-11@babybloomnannies.co.uk" },
  line: lineOf("regular_week", "2027-02-08", 30, 1800),
  payTo: { accountName: "Sophie Taylor", sortCode: "112233", accountNumber: "87654321" },
  replacesNumber: null,
};

/** The correction (brief §0.8): 28 h, replacing INV-0001, from a nanny trading under a name with accents. */
export const CORRECTION_INVOICE: InvoicePdfData = {
  ...HARTLEY_INVOICE,
  number: "INV-0003",
  issuer: { name: "Łucja Wiśniewska", tradingName: "Zoë Ó Briain Childcare", address: null },
  billTo: { name: "Kateřina Dvořák", email: "admin+b06-14@babybloomnannies.co.uk" },
  line: lineOf("regular_week", "2027-02-08", 28, 1800),
  payTo: { accountName: "Łucja Wiśniewska", sortCode: "112233", accountNumber: "87654321" },
  replacesNumber: "INV-0001",
};

export const TRIAL_INVOICE: InvoicePdfData = {
  ...HARTLEY_INVOICE,
  number: "INV-0002",
  billTo: { name: "Yusuf Ahmed", email: "admin+b06-12@babybloomnannies.co.uk" },
  line: lineOf("trial_shift", "2027-02-03", 4, 1800),
};
