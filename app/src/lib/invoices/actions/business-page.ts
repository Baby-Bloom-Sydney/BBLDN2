/**
 * The Business page's one Save (ledger B06 §9.1 R1–R5): what the page sends and the check that runs before anything
 * is written — the same function in the browser (before Save calls the server) and in `saveBusinessSettings`.
 *
 * - **What is sent:** only the records she changed — her business details, her address (her home address), her bank
 *   details — each with the version she loaded (null = she had none). Text only; anything else is dropped.
 * - **The check:** the business schema (`validation-business.ts`; the VAT rate is never asked: always 20%); her
 *   address, required unless a limited company (its registered office is its address) — picked now, or on file; her
 *   bank details, all three once added (`validation.ts`). Every refusal is by field, with the schemas' plain messages.
 * - **Her own name** as a trading name is saved as none (trimmed, spaces collapsed, any case), so a later name change
 *   still reaches her invoices.
 * - Client-safe (no I/O), and only types and pure functions: the page's lazily loaded chunk imports it.
 *
 * BB-wave1-041126/06b3-rework, 2026-11-09.
 */

import { z } from "zod";
import { checkHomeAddress, PROFILE_MESSAGES, type HomeAddress } from "@/lib/settings/nanny-profile-rules";
import { paymentDetailsSchema } from "../validation";
import { businessDetailsSchema } from "../validation-business";

/** Far above any field's own limit: only a guard against a huge body. */
const TEXT_MAX = 2000;
const text = z.string().max(TEXT_MAX);
const versionIn = z.string().max(64).nullable();

const businessPart = z.object({
  businessType: text, tradingName: text, companyName: text, companyNumber: text, registeredOffice: text,
  partnershipName: text, vatMode: text, vatNumber: text, expectedUpdatedAt: versionIn,
});
const addressPart = z.object({ line1: text, line2: text, town: text, postcode: text, expectedUpdatedAt: versionIn });
const bankPart = z.object({ accountName: text, sortCode: text, accountNumber: text, expectedUpdatedAt: versionIn });

export const businessPageInput = z.object({
  business: businessPart.optional(),
  address: addressPart.optional(),
  bank: bankPart.optional(),
});

export type BusinessPart = z.infer<typeof businessPart>;
export type AddressPart = z.infer<typeof addressPart>;
export type BankPart = z.infer<typeof bankPart>;
export type BusinessPageInput = z.infer<typeof businessPageInput>;

/** The first message for each field a schema refused (`form` when it names none). Messages are fixed text. */
export function fieldIssues(error: z.ZodError): Readonly<Record<string, string>> {
  return error.issues.reduce<Readonly<Record<string, string>>>((found, issue) => {
    const field = typeof issue.path[0] === "string" ? issue.path[0] : "form";
    return Object.hasOwn(found, field) ? found : { ...found, [field]: issue.message };
  }, {});
}

/** Her business details as the schema takes them: the rate left blank (always the default, 20%). */
export function businessFields(part: BusinessPart): Record<string, string> {
  const { expectedUpdatedAt: _version, ...fields } = part;
  return { ...fields, vatRate: "" };
}

export function bankFields(part: BankPart): Record<string, string> {
  const { expectedUpdatedAt: _version, ...fields } = part;
  return fields;
}

export function homeOf(part: AddressPart): HomeAddress {
  return { line1: part.line1, line2: part.line2, town: part.town, postcode: part.postcode };
}

function issuesOf<T>(result: { success: true; data: T } | { success: false; error: z.ZodError }): Readonly<Record<string, string>> {
  return result.success ? {} : fieldIssues(result.error);
}

/** Everything wrong with what she is saving, by field ({} = nothing). `addressOnFile`: her home address has one now.
 * `typeOnFile`: her business type on file, for when no business details are sent (R4 whatever the payload holds). */
export function checkBusinessPage(input: BusinessPageInput, addressOnFile: boolean, typeOnFile?: string): Readonly<Record<string, string>> {
  const { business, address, bank } = input;
  const addressIssue = address ? checkHomeAddress(homeOf(address)) : null;
  // R4 whatever the payload holds (round 2 #5): the type sent, else the type on file
  const type = business?.businessType ?? typeOnFile;
  const needsAddress = type !== undefined && type !== "limited_company" && !address && !addressOnFile;
  return {
    ...(business ? issuesOf(businessDetailsSchema.safeParse(businessFields(business))) : {}),
    ...(addressIssue ? { address: addressIssue } : needsAddress ? { address: PROFILE_MESSAGES.address } : {}),
    ...(bank ? issuesOf(paymentDetailsSchema.safeParse(bankFields(bank))) : {}),
  };
}

const folded = (value: string): string => value.trim().replace(/\s+/g, " ").toLowerCase();

/** Her own full name typed as her trading name (R5): saved as none. */
export function sameAsOwnName(tradingName: string, firstName: string, lastName: string): boolean {
  const own = folded(`${firstName} ${lastName}`);
  return folded(tradingName) !== "" && folded(tradingName) === own;
}
