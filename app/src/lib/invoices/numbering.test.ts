/**
 * Invoice numbers (BAI 2026-11-04): BB-<NannyName>-<YYMMDD>-<Number>, e.g. BB-SophieTaylor-270215-0001. The database
 * makes and stores the number at insert (amendment 21's `nanny_invoice_number`); this mirror lets a screen show the
 * number an invoice will get. The same cases are checked on both sides (PROOF/B06/sql-harness check 16).
 * BB-wave1-041126/06a-build, 2026-11-04.
 */
import { describe, expect, it } from "vitest";
import { formatInvoiceNumber, invoiceNumberName, isInvoiceNumber } from "./numbering";

describe("invoiceNumberName — her first and last name, folded to plain letters", () => {
  it.each([
    ["Sophie", "Taylor", "SophieTaylor"],
    ["Łucja", "Wiśniewska", "LucjaWisniewska"],
    ["Zoë", "Ó Briain", "ZoeOBriain"],
    ["Kateřina", "Dvořák", "KaterinaDvorak"],
    ["mary-jane", "o'neill", "MaryJaneONeill"],
    ["Søren", "Æbelø Straße", "SorenAebeloStrasse"],
    ["Maximiliana", "Featherstonehaugh-Wolfeschlegel", "MaximilianaFeatherstonehaughWo"],
    ["", "", "Nanny"],
    ["Анна", "", "Nanny"],
    [null, null, "Nanny"],
  ])("%s %s → %s", (first, last, name) => {
    expect(invoiceNumberName(first, last)).toBe(name);
  });

  it("caps the name at 30 letters", () => {
    expect(invoiceNumberName("a".repeat(40), "b")).toHaveLength(30);
  });
});

describe("formatInvoiceNumber", () => {
  it.each([
    ["SophieTaylor", "2027-02-15", 1, "BB-SophieTaylor-270215-0001"],
    ["LucjaWisniewska", "2027-02-15", 3, "BB-LucjaWisniewska-270215-0003"],
    ["ZoeOBriain", "2026-12-31", 12, "BB-ZoeOBriain-261231-0012"],
    ["SophieTaylor", "2027-02-15", 10000, "BB-SophieTaylor-270215-10000"],
  ])("%s on %s, number %s → %s", (name, issuedOn, seq, number) => {
    expect(formatInvoiceNumber(name, issuedOn, seq)).toBe(number);
    expect(isInvoiceNumber(number)).toBe(true);
  });

  it("fits the database's 52-character limit at the longest name", () => {
    expect(formatInvoiceNumber("x".repeat(30), "2027-02-15", 9999).length).toBeLessThanOrEqual(52);
  });

  it("refuses what the database couldn't have made", () => {
    expect(() => formatInvoiceNumber("Sophie Taylor", "2027-02-15", 1)).toThrow(RangeError);
    expect(() => formatInvoiceNumber("SophieTaylor", "2027-02-30", 1)).toThrow(RangeError);
    for (const bad of [0, -1, 1.5, Number.NaN]) expect(() => formatInvoiceNumber("SophieTaylor", "2027-02-15", bad)).toThrow(RangeError);
  });

  it("recognises only the new format", () => {
    for (const bad of ["INV-0001", "BB-Sophie Taylor-270215-0001", "BB-SophieTaylor-27021-0001", "BB-SophieTaylor-270215-001", ""]) {
      expect(isInvoiceNumber(bad)).toBe(false);
    }
  });
});
