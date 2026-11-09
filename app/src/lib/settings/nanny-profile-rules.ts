/**
 * The nanny's Profile and Contact rules (ledger B06 §9.1 R2, R4; brief 06 §0b 2, 4): what may never be saved empty —
 * her name (unless identity verification has locked it), her date of birth, her address and her mobile — with one
 * fixed, plain message each. The Settings pages check with these before Save calls the server, and
 * `updateNannyAccountSettings` checks again with the same functions, so both refuse the same things.
 *
 * - **One address** (R2): her home address's street line, town and postcode (her own row — security H1) — what verification's residence step stores
 *   and her invoices print. A picked address keeps verification's shape (`formatAddressLine`: line 1 and line 2 on one
 *   street line, no second line stored). On file = a street line and a postcode.
 * - Client-safe and zod-free on purpose: this runs in the Settings page's own bundle (`/nanny/settings` first load
 *   stays near 166 kB; the Business section's zod loads lazily).
 *
 * BB-wave1-041126/06b3-rework, 2026-11-09.
 */

import { formatAddressLine, isUkMobile, UK_POSTCODE_REGEX, type ParsedAddress } from "@/lib/uk-contact";

export const PROFILE_MESSAGES = Object.freeze({
  firstName: "Enter your first name",
  lastName: "Enter your last name",
  dateOfBirth: "Enter your date of birth",
  address: "Choose your address",
  mobileRequired: "Mobile number is required.",
  mobile: "Enter a valid UK mobile number.",
  tooLong: "That's too long — please shorten it",
  plain: "Use plain text, without special characters",
  locked: "Your name and date of birth can't be changed after identity verification.",
} as const);
const M = PROFILE_MESSAGES;

/** Her address as Settings shows and edits it (her home address row; with none, her area). Blank parts are "". */
export interface HomeAddress {
  readonly line1: string;
  readonly line2: string;
  readonly town: string;
  readonly postcode: string;
}

const NAME_MAX = 100;
const ADDRESS_PART_MAX = 200;
/** The issuer prints an address of at most 300 characters (amendment 21); a longer one could never be on an invoice. */
const PRINTED_ADDRESS_MAX = 300;
/**
 * Control, format (zero-width, bidi overrides), private-use and unassigned characters, line/paragraph separators,
 * default-ignorables and the braille blank — the class her invoices' text rule refuses (`validation.ts` ONE_LINE_BAD,
 * amendment 21's `nanny_invoice_text_ok`), so what she saves here can print (review round 1: security L1/L2).
 */
const NOT_PLAIN = /[\p{C}\p{Zl}\p{Zp}\p{Default_Ignorable_Code_Point}\u2800]/u;
/** In a name, a joiner (ZWNJ / ZWJ), which some scripts need, is allowed; the invoice drops it when printing. */
const NAME_NOT_PLAIN = /(?![\u200c\u200d])[\p{C}\p{Zl}\p{Zp}\p{Default_Ignorable_Code_Point}\u2800]/u;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** A picked address, stored as verification stores it: the street line (line 1 and line 2), no second line. */
export function homeFromParsed(parsed: ParsedAddress): HomeAddress {
  return { line1: formatAddressLine(parsed), line2: "", town: parsed.town, postcode: parsed.postcode };
}

/** Her address in full, one part per line, blank parts left out. */
export function homeLines(home: HomeAddress | null): string[] {
  if (home === null) return [];
  return [home.line1, home.line2, home.town, home.postcode].map((part) => part.trim()).filter((part) => part !== "");
}

/** What an invoice needs: a street line and a postcode. */
export function hasStreetAndPostcode(home: HomeAddress | null): boolean {
  return home !== null && home.line1.trim() !== "" && home.postcode.trim() !== "";
}

export function sameHome(a: HomeAddress | null, b: HomeAddress | null): boolean {
  if (a === null || b === null) return a === b;
  return homeLines(a).join("\n") === homeLines(b).join("\n");
}

const isText = (value: unknown): value is string => typeof value === "string";

/** Its length as an invoice prints it: the street line (a second line folded in with ", "), the town and the postcode
 * (stored with one space) on their own lines. */
function printedLength(home: HomeAddress): number {
  const street = [home.line1.trim(), home.line2.trim()].filter((part) => part !== "").join(", ");
  const compact = home.postcode.replace(/\s+/g, "");
  const lengths = [street.length, home.town.trim().length, compact.length + (compact.length > 3 ? 1 : 0)].filter((n) => n > 0);
  return lengths.reduce((sum, n) => sum + n, 0) + Math.max(lengths.length - 1, 0);
}

/** An address she saves: four text parts, a street line, a UK postcode, plain text. Null when it's fine. */
export function checkHomeAddress(value: unknown): string | null {
  if (typeof value !== "object" || value === null) return M.address;
  const { line1, line2, town, postcode } = value as Record<string, unknown>;
  const parts = [line1, line2, town, postcode];
  if (!parts.every(isText)) return M.address;
  const texts = parts as string[];
  if (texts.some((part) => part.length > ADDRESS_PART_MAX)) return M.tooLong;
  if (texts.some((part) => NOT_PLAIN.test(part))) return M.address;
  const home = { line1: texts[0] ?? "", line2: texts[1] ?? "", town: texts[2] ?? "", postcode: texts[3] ?? "" };
  if (printedLength(home) > PRINTED_ADDRESS_MAX) return M.tooLong;
  if (!hasStreetAndPostcode(home) || home.town.trim() === "" || !UK_POSTCODE_REGEX.test(home.postcode.trim())) return M.address;
  return null;
}

/** A name she must give: plain text (it prints on her invoices), at most 100 characters. */
export function checkName(value: unknown, missing: string): string | null {
  const text = isText(value) ? value.trim() : "";
  if (text === "") return missing;
  if (text.length > NAME_MAX) return M.tooLong;
  return NAME_NOT_PLAIN.test(text) ? M.plain : null;
}

/** Today's rule: required, and a real calendar date (the date input's `YYYY-MM-DD`). */
export function checkDateOfBirth(value: unknown): string | null {
  const match = isText(value) ? ISO_DATE.exec(value) : null;
  if (!match) return M.dateOfBirth;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  const real = date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
  return real ? null : M.dateOfBirth;
}

/** Today's rule: required, and a UK mobile (`07…` or `+44…`). */
export function checkMobile(value: unknown): string | null {
  const text = isText(value) ? value.trim() : "";
  if (text === "") return M.mobileRequired;
  return isUkMobile(text) ? null : M.mobile;
}

/** What Profile and Contact details save (the action's input; snake_case as the profile row). */
export interface ProfileInput {
  readonly first_name?: string;
  readonly last_name?: string;
  readonly date_of_birth?: string | null;
  readonly mobile_number?: string | null;
  readonly address?: HomeAddress | null;
}

/** Each field sent, checked: field → message ({} when all is well). The page and the action run this same check. */
export function checkProfileInput(input: ProfileInput): Readonly<Record<string, string>> {
  const checks: ReadonlyArray<readonly [string, boolean, () => string | null]> = [
    ["firstName", "first_name" in input, () => checkName(input.first_name, M.firstName)],
    ["lastName", "last_name" in input, () => checkName(input.last_name, M.lastName)],
    ["dateOfBirth", "date_of_birth" in input, () => checkDateOfBirth(input.date_of_birth)],
    ["mobile", "mobile_number" in input, () => checkMobile(input.mobile_number)],
    ["address", "address" in input, () => checkHomeAddress(input.address)],
  ];
  return checks.reduce<Readonly<Record<string, string>>>((found, [field, sent, check]) => {
    const message = sent ? check() : null;
    return message === null ? found : { ...found, [field]: message };
  }, {});
}
