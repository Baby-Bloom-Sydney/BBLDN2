/**
 * The Settings Business page's model (plan 06 §14.6 b3.3; ledger B06 §9.1 R2, R3, R5; brief 06 §0b). Pure and
 * client-safe: the server leaf maps her issuer, her bank details and her profile address into the page's props; the
 * page turns them into rows, into its edit form, and back into the one Save.
 *
 * - **What the browser gets:** her business details, her bank details in full (her own Settings page only; brief §0b 1)
 *   and her address — never an id, a proof or a family (the leaf's RSC-props test pins the keys).
 * - **Defaults stay defaults:** `tradingName` is what she entered (null = none), so saving VAT never stores her name.
 * - **The Save** sends only the records she changed, each with the version she loaded; the check runs on the whole
 *   page (`checkBusinessPage`, the same as the server's).
 * - Name on account, with none saved, starts as the company's or partnership's name, else hers, until she types her
 *   own (R3); sort code and account number blank = no bank details.
 *
 * BB-wave1-041126/06b3-build, 2026-11-07; rewritten for edit mode by BB-wave1-041126/06b3-rework, 2026-11-09.
 */

import { BUSINESS_TYPES } from "@/config/invoices";
import type { BankPart, BusinessPageInput, BusinessPart } from "@/lib/invoices/actions/business-page";
import { formatSortCode } from "@/lib/invoices/masking";
import type { Issuer } from "@/lib/invoices/store-map-lines";
import type { BusinessType, VatMode } from "@/lib/invoices/types";
import { formatVatNumber } from "@/lib/invoices/vat-number";
import { sameHome, type HomeAddress } from "@/lib/settings/nanny-profile-rules";

/** Who she is on her invoices, as the page shows it. */
export interface BusinessView {
  readonly businessType: BusinessType;
  /** Her full name from her profile; null when it can't print on an invoice. */
  readonly name: string | null;
  /** The trading name she entered; null = none. */
  readonly tradingName: string | null;
  readonly companyName: string | null;
  readonly companyNumber: string | null;
  readonly registeredOffice: string | null;
  readonly partnershipName: string | null;
  readonly vatMode: VatMode;
  readonly vatNumber: string | null;
}

/** Her bank details in full: her own Settings page only (R3). */
export interface BankView {
  readonly accountName: string;
  readonly sortCode: string;
  readonly accountNumber: string;
}

/** The version of each record as loaded (null = none saved); a Save sends them back. */
export interface Versions {
  readonly business: string | null;
  readonly bank: string | null;
  readonly home: string | null;
}

export type VatCharged = Exclude<VatMode, "none">;

export function toBusinessView(issuer: Issuer): BusinessView {
  return {
    businessType: issuer.businessType,
    name: issuer.name,
    tradingName: issuer.tradingNameSource === "business" ? issuer.tradingName : null,
    companyName: issuer.companyName,
    companyNumber: issuer.companyNumber,
    registeredOffice: issuer.registeredOffice,
    partnershipName: issuer.partnershipName,
    vatMode: issuer.vat.mode,
    vatNumber: issuer.vat.number,
  };
}

/** Copies the three bank fields only, whatever else the read carried. */
export function toBankView(details: BankView | null): BankView | null {
  return details === null ? null : { accountName: details.accountName, sortCode: details.sortCode, accountNumber: details.accountNumber };
}

export const businessTypeLabel = (type: BusinessType): string => BUSINESS_TYPES[type];

const VAT_CHARGED: Readonly<Record<VatCharged, string>> = { included: "Included in rates", added: "Added to rates" };
export const vatChargedLabel = (mode: VatCharged): string => VAT_CHARGED[mode];

/** "11-22-33" when it is six digits; otherwise as stored. */
const sortCodeText = (sixDigits: string): string => (/^\d{6}$/.test(sixDigits) ? formatSortCode(sixDigits) : sixDigits);

export function bankRows(bank: BankView): ReadonlyArray<{ readonly label: string; readonly value: string }> {
  return [
    { label: "Name on account", value: bank.accountName },
    { label: "Sort code", value: sortCodeText(bank.sortCode) },
    { label: "Account number", value: bank.accountNumber },
  ];
}

/** The page in edit mode. */
export interface BusinessForm {
  readonly businessType: BusinessType;
  readonly tradingName: string;
  readonly companyName: string;
  readonly companyNumber: string;
  readonly registeredOffice: string;
  readonly partnershipName: string;
  readonly vatRegistered: boolean;
  readonly vatCharged: VatCharged;
  readonly vatNumber: string;
  readonly home: HomeAddress | null;
  readonly accountName: string;
  /** She typed in Name on account (until then, with none saved, it follows the business's name). */
  readonly accountNameTouched: boolean;
  readonly sortCode: string;
  readonly accountNumber: string;
}

export function formFrom(view: BusinessView, bank: BankView | null, home: HomeAddress | null): BusinessForm {
  return {
    businessType: view.businessType,
    tradingName: view.tradingName ?? "",
    companyName: view.companyName ?? "",
    companyNumber: view.companyNumber ?? "",
    registeredOffice: view.registeredOffice ?? "",
    partnershipName: view.partnershipName ?? "",
    vatRegistered: view.vatMode !== "none",
    vatCharged: view.vatMode === "added" ? "added" : "included",
    vatNumber: view.vatNumber === null ? "" : formatVatNumber(view.vatNumber),
    home,
    accountName: bank?.accountName ?? "",
    accountNameTouched: bank !== null,
    sortCode: bank === null ? "" : sortCodeText(bank.sortCode),
    accountNumber: bank?.accountNumber ?? "",
  };
}

/** Name on account as shown: hers once saved or typed; else the company's, the partnership's, or her own name. */
export function accountNameShown(form: BusinessForm, view: BusinessView): string {
  if (form.accountNameTouched) return form.accountName;
  if (form.businessType === "limited_company") return form.companyName;
  if (form.businessType === "partnership") return form.partnershipName;
  return view.name ?? "";
}

/** Her business details as the Save sends them: fields of another type, and a VAT number when not registered, blank. */
function businessPart(form: BusinessForm, version: string | null): BusinessPart {
  const ltd = form.businessType === "limited_company";
  return {
    businessType: form.businessType,
    tradingName: form.tradingName,
    companyName: ltd ? form.companyName : "",
    companyNumber: ltd ? form.companyNumber : "",
    registeredOffice: ltd ? form.registeredOffice : "",
    partnershipName: form.businessType === "partnership" ? form.partnershipName : "",
    vatMode: form.vatRegistered ? form.vatCharged : "none",
    vatNumber: form.vatRegistered ? form.vatNumber : "",
    expectedUpdatedAt: version,
  };
}

const digits = (value: string): string => value.replace(/[\s-]/g, "");
const typedBank = (form: BusinessForm): boolean => digits(form.sortCode) !== "" || digits(form.accountNumber) !== "";

function bankPart(form: BusinessForm, view: BusinessView, version: string | null): BankPart {
  return { accountName: accountNameShown(form, view), sortCode: form.sortCode, accountNumber: form.accountNumber, expectedUpdatedAt: version };
}

const sameBank = (a: BankPart, b: BankPart): boolean =>
  a.accountName.trim() === b.accountName.trim() && digits(a.sortCode) === digits(b.sortCode) && digits(a.accountNumber) === digits(b.accountNumber);

const sameBusiness = (a: BusinessPart, b: BusinessPart): boolean =>
  JSON.stringify({ ...a, tradingName: a.tradingName.trim(), vatNumber: digits(a.vatNumber).toUpperCase() }) ===
  JSON.stringify({ ...b, tradingName: b.tradingName.trim(), vatNumber: digits(b.vatNumber).toUpperCase() });

/** The whole page, for the check: her business always, her bank details once saved or typed, an address she picked. */
export function wholePage(form: BusinessForm, initial: BusinessForm, view: BusinessView, bank: BankView | null, versions: Versions): BusinessPageInput {
  const picked = !sameHome(form.home, initial.home) && form.home !== null;
  return {
    business: businessPart(form, versions.business),
    ...(picked && form.home ? { address: { ...form.home, expectedUpdatedAt: versions.home } } : {}),
    ...(bank !== null || typedBank(form) ? { bank: bankPart(form, view, versions.bank) } : {}),
  };
}

/** What the Save sends: the records she changed only ({} = nothing to save). */
export function changedParts(form: BusinessForm, initial: BusinessForm, view: BusinessView, bank: BankView | null, versions: Versions): BusinessPageInput {
  const page = wholePage(form, initial, view, bank, versions);
  const businessChanged = page.business !== undefined && !sameBusiness(page.business, businessPart(initial, versions.business));
  const bankChanged = page.bank !== undefined && (bank === null || !sameBank(page.bank, bankPart(initial, view, versions.bank)));
  return {
    ...(businessChanged ? { business: page.business } : {}),
    ...(page.address ? { address: page.address } : {}),
    ...(bankChanged ? { bank: page.bank } : {}),
  };
}
