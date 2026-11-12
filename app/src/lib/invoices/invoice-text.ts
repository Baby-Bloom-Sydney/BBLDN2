/**
 * The invoice's words that both the PDF and her review screen print (plan 06 §14.8; brief §0a D; BAI 2026-11-07's
 * three columns). Pure and client-safe — no I/O, no PDF renderer — so the review (06b-4) shows exactly what the PDF
 * will. Moved unchanged from `pdf/sections/issuer.tsx` and `pdf/sections/totals.tsx`, which import and re-export them
 * (the `vat-number.ts` precedent), so the PDF and its tests are unchanged.
 *
 * - **From:** her name; a limited company's registered office, otherwise her address ("it doesnt need to have both").
 * - **Business:** one name — her trading name when she has entered one (it isn't her own name), otherwise a company's
 *   or partnership's — then "Company no. …" for a limited company and "VAT no. GB 123 4567 89" when registered.
 * - **Totals:** "Childcare", then "VAT at 20%" (added), or "Childcare (including VAT)" and "of which VAT at 20%"
 *   (included); "Expenses" when she has any. The caller prints the total. With no shift (0 hours: an invoice of
 *   expenses only, 06b-4 rework reading 6) there is no Childcare or VAT line, whatever her VAT setting.
 *
 * BB-wave1-041126/06b2-build, 2026-11-06; BB-wave1-041126 (BAI's three-column layout), 2026-11-07; moved by
 * BB-wave1-041126/06b4, 2026-11-12; BB-wave1-041126/06b4-server, 2026-11-12 (expenses only).
 */

import { BASIS_POINTS_PER_PERCENT } from "@/config/invoices";
import type { BusinessType, VatMode } from "./types";
import { formatVatNumber } from "./vat-number";

/** Who she is on an invoice, as these lines need it (the PDF's issuer, or her review's). */
export interface IssuerText {
  readonly businessType: BusinessType;
  readonly name: string;
  /** Her trading name, or her own name when she has entered none. */
  readonly tradingName: string;
  /** Her address ("" = none yet). */
  readonly address: string;
  readonly companyName: string | null;
  readonly companyNumber: string | null;
  readonly registeredOffice: string | null;
  readonly partnershipName: string | null;
  readonly vatNumber: string | null;
}

const present = (lines: readonly (string | null)[]): string[] => lines.filter((l): l is string => l !== null && l !== "");

/** The From column: her name, then one address — a limited company's registered office replaces the business address. */
export function fromLines(issuer: IssuerText): string[] {
  const office = issuer.businessType === "limited_company" ? issuer.registeredOffice : null;
  return present([issuer.name, office || issuer.address]);
}

/** The business's one name: her trading name when she has entered one (it isn't her own name), else its registered name. */
export function businessName(issuer: IssuerText): string | null {
  if (issuer.tradingName && issuer.tradingName !== issuer.name) return issuer.tradingName;
  if (issuer.businessType === "limited_company") return issuer.companyName || null;
  if (issuer.businessType === "partnership") return issuer.partnershipName || null;
  return null;
}

/** The Business column's lines under its name: a limited company's number, then the VAT number. */
export function businessLines(issuer: IssuerText): string[] {
  return present([
    issuer.businessType === "limited_company" && issuer.companyNumber ? `Company no. ${issuer.companyNumber}` : null,
    issuer.vatNumber && `VAT no. ${formatVatNumber(issuer.vatNumber)}`,
  ]);
}

const PERCENT = BASIS_POINTS_PER_PERCENT;

/** 2000 → "20%", 1750 → "17.5%", 1 → "0.01%" (basis points to a percent, no trailing zeros). */
export function vatRateLabel(rateBp: number): string {
  const whole = Math.floor(rateBp / PERCENT);
  const hundredths = String(rateBp % PERCENT).padStart(2, "0").replace(/0+$/, "");
  return `${whole}${hundredths === "" ? "" : `.${hundredths}`}%`;
}

export interface TotalsText {
  /** The shifts' hours: 0 means no shift, so no Childcare or VAT line. */
  readonly hours: number;
  readonly shiftsPence: number;
  readonly expensesPence: number;
  readonly vat: { readonly mode: VatMode; readonly rateBp: number | null; readonly pence: number };
}

type TotalsLine = { readonly label: string; readonly pence: number };

/** Childcare and VAT per her mode (14.8); none when there is no shift. */
function childcareLines(totals: TotalsText): readonly TotalsLine[] {
  const { hours, shiftsPence, vat } = totals;
  if (hours === 0) return [];
  const rate = vat.rateBp === null ? "" : vatRateLabel(vat.rateBp);
  return vat.mode === "included"
    ? [{ label: "Childcare (including VAT)", pence: shiftsPence }, { label: `of which VAT at ${rate}`, pence: vat.pence }]
    : [{ label: "Childcare", pence: shiftsPence }, ...(vat.mode === "added" ? [{ label: `VAT at ${rate}`, pence: vat.pence }] : [])];
}

/** The totals' lines above the total (14.8): childcare and VAT per her mode, then expenses when she has any. */
export function totalsLines(totals: TotalsText): readonly TotalsLine[] {
  return [...childcareLines(totals), ...(totals.expensesPence > 0 ? [{ label: "Expenses", pence: totals.expensesPence }] : [])];
}
