/**
 * The PDF's data from what the store returns (plan 06 step 8): the created invoice's snapshots and her full
 * details. Pure. BB-wave1-041126/06a-build, 2026-11-04.
 */
import { describe, expect, it } from "vitest";
import type { CreatedInvoice, StoredPaymentDetails } from "../store-map";
import { invoicePdfData } from "./model";

const created: CreatedInvoice = {
  invoiceId: "b0600000-0000-4000-8000-000000009003", seq: 3, number: "BB-SophieTaylor-270215-0003", status: "sending",
  kind: "regular_week", placementId: "b0600000-0000-4000-8000-000000000411", connectionRequestId: null,
  periodStart: "2027-02-08", hours: 28, ratePence: 1800, totalPence: 50400, parentUserId: "b0600000-0000-4000-8000-000000000011",
  familyName: "Olivia Hartley", familyEmail: "admin+b06-11@babybloomnannies.co.uk", nannyName: "Sophie Taylor",
  nannyEmail: "admin+b06-1@babybloomnannies.co.uk", accountLast4: "4321", pdfPath: "n/i.pdf",
  replacesInvoiceId: "b0600000-0000-4000-8000-000000009001", replacesNumber: "BB-SophieTaylor-270212-0001", createdAt: "2027-02-15T09:30:00.000Z",
};
const details: StoredPaymentDetails = {
  accountName: "Sophie Taylor", sortCode: "112233", accountNumber: "87654321", accountLast4: "4321",
  tradingName: "Taylor Childcare", invoiceAddress: "1 Upper Street",
};

describe("invoicePdfData", () => {
  it("takes the snapshots from the invoice and the bank details from her saved details", () => {
    expect(invoicePdfData(created, details)).toEqual({ ok: true, value: {
      number: "BB-SophieTaylor-270215-0003",
      issuedAt: "2027-02-15T09:30:00.000Z",
      issuer: { name: "Sophie Taylor", tradingName: "Taylor Childcare", address: "1 Upper Street" },
      billTo: { name: "Olivia Hartley", email: "admin+b06-11@babybloomnannies.co.uk" },
      line: { kind: "regular_week", periodStart: "2027-02-08", hours: 28, ratePence: 1800, totalPence: 50400 },
      payTo: { accountName: "Sophie Taylor", sortCode: "112233", accountNumber: "87654321" },
      replacesNumber: "BB-SophieTaylor-270212-0001",
    } });
  });

  it("refuses details for a different account than the invoice names (they changed in between) — a result, not a throw", () => {
    expect(invoicePdfData(created, { ...details, accountNumber: "87650000", accountLast4: "0000" })).toEqual({ ok: false, error: "no_details" });
  });
});
