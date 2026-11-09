/**
 * Her business details for invoices (plan 06 §14.3–14.4, b2.3; brief §0a B): the shared zod schema the Settings
 * Business section (06b-3), its action and the store parse with. Client-safe (no I/O). The output is exactly what
 * `nanny_business_details_save` stores, and the database refuses the same things (amendment 21, harness 17).
 *
 * - **A union by type:** a sole trader (the default); a limited company with its name, Companies House number
 *   (8 digits, or 2 letters and 6 digits, e.g. SC123456) and registered office, all required; a partnership with its
 *   name. Fields that don't apply to her type are set to null, whatever was typed.
 * - **Names** (trading, company, partnership) are one line and never BabyBloom (plan R8: they print on a PDF that
 *   BabyBloom sends). A blank trading name means "my own name".
 * - **No address** (06b-3 rework R2): hers is her home address, and a limited company's is its registered office.
 * - **VAT:** not registered (any number or rate is dropped), or registered with a UK VAT number (spaces and hyphens
 *   stripped, upper-cased, "GB" added: GB + 9 or 12 digits) and a rate typed as a percent with up to 2 decimals,
 *   stored in basis points — 20% unless she changes it.
 * - Plain messages that never echo what was typed.
 *
 * BB-wave1-041126/06b2-build, 2026-11-06; BB-wave1-041126/06b3-rework, 2026-11-09 (no address; R6 wording).
 */

import { z } from "zod";
import { BASIS_POINTS_PER_PERCENT, INVOICE_RULES } from "@/config/invoices";
import { VAT_MODES, type BusinessType, type VatMode } from "./types";
import { optionalName, requiredAddress, requiredName } from "./validation";

const { text, vatRateBp } = INVOICE_RULES;

export const BUSINESS_MESSAGES = Object.freeze({
  businessType: "Choose sole trader, limited company or partnership",
  companyName: "Enter the company's registered name",
  companyNumber: "Enter the company number — 8 characters, like 12345678 or SC123456",
  registeredOffice: "Enter the registered office address",
  partnershipName: "Enter the partnership's name",
  vatMode: "Choose whether VAT is included in your rates or added to them",
  vatNumber: "Enter a UK VAT number, like GB 123 4567 89",
  vatRate: `Enter a VAT rate above 0% and up to ${vatRateBp.max / BASIS_POINTS_PER_PERCENT}%, with at most 2 decimal places`,
} as const);
const B = BUSINESS_MESSAGES;

/** The database's stored shape (amendment 21's `nanny_business_details`). */
export interface BusinessDetails {
  readonly businessType: BusinessType;
  readonly tradingName: string | null;
  readonly companyName: string | null;
  readonly companyNumber: string | null;
  readonly registeredOffice: string | null;
  readonly partnershipName: string | null;
  readonly vatMode: VatMode;
  readonly vatNumber: string | null;
  readonly vatRateBp: number | null;
}

const COMPANY_NUMBER = /^(?:\d{8}|[A-Z]{2}\d{6})$/;
const VAT_NUMBER = /^GB(?:\d{9}|\d{12})$/;
const PERCENT = /^(\d{1,2})(?:\.(\d{1,2}))?$/;

const companyNumber = z
  .string({ error: B.companyNumber })
  .nullish()
  .transform((value) => (value ?? "").replace(/\s+/g, "").toUpperCase())
  .pipe(z.string().regex(COMPANY_NUMBER, B.companyNumber));

/** "gb 123 4567 89" or "123456789" → "GB123456789"; null when blank (checked against the VAT mode below). */
const vatNumber = z
  .string({ error: B.vatNumber })
  .nullish()
  .transform((value) => {
    const compact = (value ?? "").replace(/[\s-]/g, "").toUpperCase();
    if (compact === "") return null;
    return /^\d/.test(compact) ? `GB${compact}` : compact;
  });

/** "20", "17.5", 5 → basis points; null when blank; NaN (refused below) when it isn't a percent with ≤ 2 decimals. */
const vatRate = z
  .union([z.string(), z.number()], { error: B.vatRate })
  .nullish()
  .transform((value): number | null => {
    const typed = value === null || value === undefined ? "" : String(value).trim();
    if (typed === "") return null;
    const m = PERCENT.exec(typed);
    if (!m) return Number.NaN;
    return Number(m[1]) * BASIS_POINTS_PER_PERCENT + Number((m[2] ?? "").padEnd(2, "0"));
  });

const shared = {
  tradingName: optionalName(text.tradingNameMax),
  vatMode: z.enum(VAT_MODES, { error: B.vatMode }),
  vatNumber,
  vatRate,
};

const soleTrader = z.object({ businessType: z.literal("sole_trader"), ...shared });
const limitedCompany = z.object({
  businessType: z.literal("limited_company"),
  ...shared,
  companyName: requiredName(text.companyNameMax, B.companyName),
  companyNumber,
  registeredOffice: requiredAddress(text.addressMax, B.registeredOffice),
});
const partnership = z.object({
  businessType: z.literal("partnership"),
  ...shared,
  partnershipName: requiredName(text.partnershipNameMax, B.partnershipName),
});

type Parsed = z.output<typeof soleTrader> | z.output<typeof limitedCompany> | z.output<typeof partnership>;

/** Registered: a valid number and a rate of 1–2,000 bp (20% when left blank). Not registered: neither is kept. */
function checkVat(value: Parsed, ctx: z.RefinementCtx): void {
  if (value.vatMode === "none") return;
  if (value.vatNumber === null || !VAT_NUMBER.test(value.vatNumber)) {
    ctx.addIssue({ code: "custom", path: ["vatNumber"], message: B.vatNumber });
  }
  const bp = value.vatRate;
  if (bp !== null && (!Number.isInteger(bp) || bp < vatRateBp.min || bp > vatRateBp.max)) {
    ctx.addIssue({ code: "custom", path: ["vatRate"], message: B.vatRate });
  }
}

function toStored(value: Parsed): BusinessDetails {
  const registered = value.vatMode !== "none";
  return {
    businessType: value.businessType,
    tradingName: value.tradingName,
    companyName: value.businessType === "limited_company" ? value.companyName : null,
    companyNumber: value.businessType === "limited_company" ? value.companyNumber : null,
    registeredOffice: value.businessType === "limited_company" ? value.registeredOffice : null,
    partnershipName: value.businessType === "partnership" ? value.partnershipName : null,
    vatMode: value.vatMode,
    vatNumber: registered ? value.vatNumber : null,
    vatRateBp: registered ? value.vatRate ?? vatRateBp.default : null,
  };
}

/** Her business details as she types them; the output is what the database stores. */
export const businessDetailsSchema = z
  .discriminatedUnion("businessType", [soleTrader, limitedCompany, partnership], { error: B.businessType })
  .superRefine(checkVat)
  .transform(toStored);
export type BusinessDetailsInput = z.input<typeof businessDetailsSchema>;
