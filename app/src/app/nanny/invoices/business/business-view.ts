/**
 * The Settings Business section's view of who she is on her invoices (plan 06 §14.6 b3.3; brief §0a B, C). Pure and
 * client-safe: the server leaf maps her effective issuer (`readIssuer`, the defaults included) and her masked bank
 * details into these props, and the dialogs build their saves from them.
 *
 * - **What the browser gets:** her business details and her masks — never a full bank number, a family, an id or a
 *   proof (the RSC-payload test pins the keys).
 * - **Defaults stay defaults:** `tradingName` and her business address are what she entered (null = her own name /
 *   her verification address), so re-saving another field never stores her name or verification address as her own.
 * - Every message comes from the shared schemas (`validation*.ts`): fixed text that never echoes what she typed.
 *
 * BB-wave1-041126/06b3-build, 2026-11-07.
 */

import type { z } from "zod";
import { BASIS_POINTS_PER_PERCENT, BUSINESS_TYPES } from "@/config/invoices";
import { maskedDetailsLine } from "@/lib/invoices/masking";
import type { MaskedPaymentDetails } from "@/lib/invoices/store-map";
import type { Issuer } from "@/lib/invoices/store-map-lines";
import type { BusinessType, VatMode } from "@/lib/invoices/types";
import { formatVatNumber } from "@/lib/invoices/vat-number";

/** Who she is on her invoices, as the section shows and saves it. */
export interface BusinessView {
  readonly businessType: BusinessType;
  /** Her full name from her profile; null when it can't print on an invoice. */
  readonly name: string | null;
  /** The trading name she entered; null = her own name. */
  readonly tradingName: string | null;
  /** The address her invoices print (a limited company prints its registered office instead); null = none on file. */
  readonly address: string | null;
  /** Where `address` came from: what she entered here, or her verification. */
  readonly addressSource: "business" | "verification" | null;
  readonly companyName: string | null;
  readonly companyNumber: string | null;
  readonly registeredOffice: string | null;
  readonly partnershipName: string | null;
  readonly vatMode: VatMode;
  readonly vatNumber: string | null;
  readonly vatRateBp: number | null;
}

/** Her bank details as the screen shows them: masks only (brief §0.2). */
export interface BankView {
  readonly accountName: string;
  readonly sortCodeLast2: string;
  readonly accountLast4: string;
}

export function toBusinessView(issuer: Issuer): BusinessView {
  return {
    businessType: issuer.businessType,
    name: issuer.name,
    tradingName: issuer.tradingNameSource === "business" ? issuer.tradingName : null,
    address: issuer.address,
    addressSource: issuer.addressSource,
    companyName: issuer.companyName,
    companyNumber: issuer.companyNumber,
    registeredOffice: issuer.registeredOffice,
    partnershipName: issuer.partnershipName,
    vatMode: issuer.vat.mode,
    vatNumber: issuer.vat.number,
    vatRateBp: issuer.vat.rateBp,
  };
}

/** Copies the three mask fields only, whatever else the read carried. */
export function toBankView(masked: MaskedPaymentDetails | null): BankView | null {
  if (masked === null) return null;
  return { accountName: masked.accountName, sortCodeLast2: masked.sortCodeLast2, accountLast4: masked.accountLast4 };
}

export const NOT_ADDED = "Not added yet";

/** "Sophie Taylor · sort code ••-••-33, account ending 4321", or "Not added yet". */
export function bankSummary(bank: BankView | null): string {
  return bank === null ? NOT_ADDED : `${bank.accountName} · ${maskedDetailsLine(bank)}`;
}

export const businessTypeLabel = (type: BusinessType): string => BUSINESS_TYPES[type];

/** Basis points as she types a percent: 2000 → "20", 1750 → "17.5", 505 → "5.05". */
export function percentText(bp: number): string {
  const whole = Math.trunc(bp / BASIS_POINTS_PER_PERCENT);
  const rest = bp % BASIS_POINTS_PER_PERCENT;
  if (rest === 0) return String(whole);
  return `${whole}.${String(rest).padStart(2, "0").replace(/0$/, "")}`;
}

const VAT_HOW: Readonly<Record<Exclude<VatMode, "none">, string>> = {
  included: "VAT included in my rates",
  added: "VAT added on top",
};

/** The VAT row: "Not VAT registered", or how she charges it and the rate, with her number beneath. */
export function vatSummary(view: BusinessView): { readonly value: string; readonly caption: string | null } {
  if (view.vatMode === "none") return { value: "Not VAT registered", caption: null };
  const rate = view.vatRateBp === null ? "" : ` · ${percentText(view.vatRateBp)}%`;
  return {
    value: `${VAT_HOW[view.vatMode]}${rate}`,
    caption: view.vatNumber === null ? null : `VAT no. ${formatVatNumber(view.vatNumber)}`,
  };
}

/** What `saveBusinessDetails` takes, as she would type it (`businessDetailsSchema`'s input). */
export interface BusinessFormInput {
  readonly businessType: BusinessType;
  readonly tradingName: string;
  readonly businessAddress: string;
  readonly companyName: string;
  readonly companyNumber: string;
  readonly registeredOffice: string;
  readonly partnershipName: string;
  readonly vatMode: VatMode;
  readonly vatNumber: string;
  readonly vatRate: string;
}

/** Her details as they are, as form input, with a dialog's changes on top. Blank = the default. */
export function saveInput(view: BusinessView, patch: Partial<BusinessFormInput> = {}): BusinessFormInput {
  return {
    businessType: view.businessType,
    tradingName: view.tradingName ?? "",
    businessAddress: view.addressSource === "business" ? (view.address ?? "") : "",
    companyName: view.companyName ?? "",
    companyNumber: view.companyNumber ?? "",
    registeredOffice: view.registeredOffice ?? "",
    partnershipName: view.partnershipName ?? "",
    vatMode: view.vatMode,
    vatNumber: view.vatNumber ?? "",
    vatRate: view.vatRateBp === null ? "" : percentText(view.vatRateBp),
    ...patch,
  };
}

/** The first message for each field a schema refused (`form` when it names none). Messages are fixed text. */
export function fieldIssues(error: z.ZodError): Readonly<Record<string, string>> {
  return error.issues.reduce<Readonly<Record<string, string>>>((found, issue) => {
    const field = typeof issue.path[0] === "string" ? issue.path[0] : "form";
    return field in found ? found : { ...found, [field]: issue.message };
  }, {});
}
