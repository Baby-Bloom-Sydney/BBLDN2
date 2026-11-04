/**
 * Invoice numbers (BAI 2026-11-04): BB-<NannyName>-<YYMMDD>-<Number>, e.g. BB-SophieTaylor-270215-0001.
 *
 * The database makes the number when it creates the invoice and stores it on the row, so it never changes (amendment
 * 21's `nanny_invoice_number`, under her lock). This is its mirror, for a screen that shows the number an invoice
 * will get; the same cases are tested on both sides.
 * - NannyName: her first and last name, accents folded to plain letters (marks stripped after NFD; the letters that
 *   don't decompose mapped), every run of anything else a break, each word's first letter capitalised, joined, at
 *   most 30 letters, "Nanny" when nothing is left.
 * - YYMMDD: the London issue date. Number: her own sequence, at least 4 digits.
 *
 * BB-wave1-041126/06a-build, 2026-11-04.
 */

import { INVOICE_RULES } from "@/config/invoices";
import { isLondonDate } from "./week";

const { numberPrefix, numberPad, numberNameMax, numberNameFallback, numberMaxLength } = INVOICE_RULES;

/** The combining-mark blocks the database strips (the same ranges, so both sides fold alike). */
const MARKS = /[̀-ͯ᪰-᫿᷀-᷿⃐-⃿︠-︯]/g;
const UNDECOMPOSED: Readonly<Record<string, string>> = Object.freeze({
  Ł: "L", ł: "l", Ø: "O", ø: "o", Đ: "D", đ: "d", Ħ: "H", ħ: "h", ı: "i", Ŧ: "T", ŧ: "t",
  ß: "ss", ẞ: "SS", Æ: "Ae", æ: "ae", Œ: "Oe", œ: "oe", Þ: "Th", þ: "th",
});
const UNDECOMPOSED_RE = new RegExp(`[${Object.keys(UNDECOMPOSED).join("")}]`, "g");
const NUMBER_RE = new RegExp(`^${numberPrefix}-[A-Za-z]{1,${numberNameMax}}-\\d{6}-\\d{${numberPad},}$`);

/** The name part of her invoice numbers. */
export function invoiceNumberName(first: string | null, last: string | null): string {
  const folded = `${first ?? ""} ${last ?? ""}`
    .normalize("NFD")
    .replace(MARKS, "")
    .replace(UNDECOMPOSED_RE, (c) => UNDECOMPOSED[c] ?? "");
  const name = folded
    .split(/[^A-Za-z]+/)
    .filter((word) => word !== "")
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join("")
    .slice(0, numberNameMax);
  return name === "" ? numberNameFallback : name;
}

/** "BB-SophieTaylor-270215-0001" from the name part, the London issue date ("2027-02-15") and her sequence. */
export function formatInvoiceNumber(name: string, issuedOn: string, seq: number): string {
  if (!new RegExp(`^[A-Za-z]{1,${numberNameMax}}$`).test(name) || !isLondonDate(issuedOn) || !Number.isInteger(seq) || seq < 1) {
    throw new RangeError("not an invoice number's parts");
  }
  const yymmdd = issuedOn.slice(2).replaceAll("-", "");
  return `${numberPrefix}-${name}-${yymmdd}-${String(seq).padStart(numberPad, "0")}`;
}

/** The shape of a number the database stores. */
export function isInvoiceNumber(value: string): boolean {
  return value.length <= numberMaxLength && NUMBER_RE.test(value);
}
