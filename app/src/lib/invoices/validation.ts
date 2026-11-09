/**
 * The shared text rules and her bank details' zod schema (plan 06 step 5, §14.4 b2.3; brief §0.1, §0a B).
 * Client-safe (no I/O): 06b's forms and actions parse with the same schemas, and the store parses again. An invoice
 * draft's schema is `validation-lines.ts`; her business details' is `validation-business.ts` — both build on the
 * text rules here.
 *
 * - Plain messages, and **no message ever echoes what was typed** (a rejected sort code must not come back in a
 *   reply or a log): every message below is a fixed string.
 * - BabyBloom is never the party paid or the issuer (plan R8, brief D7): every name built here refuses it.
 * - Every limit comes from `src/config/invoices.ts`.
 * - Bank details are 3 fields (14.4): the trading name and address are business details now.
 *
 * BB-wave1-041126/06a-build, 2026-11-04; BB-wave1-041126/06b2-build, 2026-11-06.
 */

import { z } from "zod";
import { INVOICE_RULES } from "@/config/invoices";
import { SITE_NAME } from "@/lib/constants";

const { text } = INVOICE_RULES;

export const VALIDATION_MESSAGES = Object.freeze({
  accountName: "Enter the name on the account",
  sortCode: "Enter a 6-digit sort code",
  accountNumber: "Enter an 8-digit account number",
  tooLong: "That's too long — please shorten it",
  oneLine: "Use plain text, without special characters",
  ownName: "Enter your own name or business name.",
  tooManyLines: `Use at most ${text.addressMaxLines} lines`,
  invalid: "Something's missing — please start again",
} as const);
const M = VALIDATION_MESSAGES;

/**
 * Control, format (zero-width, bidi overrides and isolates, soft hyphen, tags), private-use and unassigned characters,
 * the line/paragraph separators, every default-ignorable character (Hangul fillers, variation selectors, the grapheme
 * joiner) and the braille blank — `\p{C}`, `\p{Zl}`, `\p{Zp}`, `\p{Default_Ignorable_Code_Point}`, U+2800: none in a
 * one-line field; an address keeps only its line breaks (\n). These print on a BabyBloom-sent PDF (security review
 * L8, N1; 06b-2 review L2). Known limit: ZWNJ / ZWJ, which some scripts use in names, are refused too in what she
 * types (the database refuses the same: amendment 21's `nanny_invoice_text_ok`; names it reads from profiles drop them).
 */
export const ONE_LINE_BAD = /[\p{C}\p{Zl}\p{Zp}\p{Default_Ignorable_Code_Point}\u2800]/u;
export const ADDRESS_BAD = /(?!\n)[\p{C}\p{Zl}\p{Zp}\p{Default_Ignorable_Code_Point}\u2800]/u;

/**
 * The same classes for text read back from the database (the store's re-check before printing): without the
 * unassigned code points, which the database's rule can't name, so a row it accepted and committed is never refused
 * afterwards (06b-2 verification L1: that stranded the row and used its number).
 */
export const PRINTED_BAD = /[\p{Cc}\p{Cf}\p{Co}\p{Zl}\p{Zp}\p{Default_Ignorable_Code_Point}\u2800]/u;
export const PRINTED_ADDRESS_BAD = /(?!\n)[\p{Cc}\p{Cf}\p{Co}\p{Zl}\p{Zp}\p{Default_Ignorable_Code_Point}\u2800]/u;

/**
 * Cyrillic and Greek letters that look like Latin ones, Latin small capitals and stroked or hooked letters, and digits
 * and symbols typed for letters (R8's skeleton; the lower-case half of amendment 21's map — `toLowerCase` folds
 * capitals here whatever the locale, where the database maps them itself).
 */
const LOOK_ALIKES: Readonly<Record<string, string>> = Object.freeze({
  "\u0430": "a", "\u0432": "b", "\u0435": "e", "\u043a": "k", "\u043c": "m", "\u043d": "h", "\u043e": "o", "\u0440": "p",
  "\u0441": "c", "\u0442": "t", "\u0443": "y", "\u0445": "x", "\u044c": "b", "\u0455": "s", "\u0456": "i", "\u0458": "j",
  "\u0501": "d", "\u04af": "y", "\u04cf": "l", "\u03b1": "a", "\u03b2": "b", "\u03b3": "y", "\u03b5": "e", "\u03b9": "i",
  "\u03ba": "k", "\u03bd": "v", "\u03bf": "o", "\u03c1": "p", "\u03c3": "o", "\u03c4": "t", "\u03c5": "y", "\u03c7": "x",
  "\u03bc": "m", "\u00f8": "o", "\u0142": "l", "\u026b": "l", "\u0253": "b", "\u01b4": "y", "\u0131": "i", "\u0299": "b",
  "\u1d00": "a", "\u028f": "y", "\u029f": "l", "\u1d0f": "o", "\u1d0d": "m",
  "0": "o", "1": "l", "3": "e", "4": "a", "5": "s", "6": "b", "8": "b", "@": "a", "|": "l", "!": "l", "$": "s",
});
/** BabyBloom as it reads, with a capital I typed for an l and "rn" for an m (06b-2 verification). */
const BABY_BLOOM = /babyb[il]oo(?:m|rn)/;

/**
 * What a reader sees: compatibility forms folded (full-width), marks dropped, lower case, look-alikes mapped, and
 * everything that isn't a Latin letter or digit removed — the same steps as amendment 21's `nanny_invoice_text_ok`.
 */
export function readsAs(value: string): string {
  return [...value.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase()]
    .map((c) => LOOK_ALIKES[c] ?? c)
    .join("")
    .replace(/[^a-z0-9]/g, "");
}

/** BabyBloom is never a party on her invoice, in any of its common look-alikes (plan R8; security review M1). */
export const isNotBabyBloom = (value: string): boolean => {
  const seen = readsAs(value);
  return !BABY_BLOOM.test(seen) && !seen.includes(readsAs(SITE_NAME));
};

/** UK bank digits: spaces and hyphens stripped, then exactly `count` digits. */
const bankDigits = (count: number, message: string) =>
  z
    .string({ error: message })
    .transform((value) => value.replace(/[\s-]/g, ""))
    .pipe(z.string().regex(new RegExp(`^\\d{${count}}$`), message));

/** Windows line ends normalised, each line trimmed, blank lines dropped (security review L3). */
export const normaliseAddress = (value: string): string =>
  value
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "")
    .join("\n");

const fewLines = (value: string): boolean => value.split("\n").length <= text.addressMaxLines;
const addressOk = (value: string): boolean => !ADDRESS_BAD.test(value);

const blankToEmpty = (value: string | null | undefined): string => (value ?? "").trim();
const oneLine = (value: string): boolean => !ONE_LINE_BAD.test(value);

/** A one-line name she must give (06b-2 b2.3: shared by the bank and business fields): trimmed, 1–max, never BabyBloom. */
export function requiredName(max: number, missing: string) {
  return z
    .string({ error: missing })
    .nullish()
    .transform(blankToEmpty)
    .pipe(z.string().min(1, missing).max(max, M.tooLong).refine(oneLine, M.oneLine).refine(isNotBabyBloom, M.ownName));
}

/** A one-line name she may leave blank (null): trimmed, at most `max`, never BabyBloom. */
export function optionalName(max: number) {
  return z
    .string({ error: M.oneLine })
    .nullish()
    .transform((value) => blankToEmpty(value) || null)
    .pipe(z.string().max(max, M.tooLong).refine(oneLine, M.oneLine).refine(isNotBabyBloom, M.ownName).nullable());
}

/** One line of plain text she may leave blank (null), e.g. a line's description: trimmed, at most `max`, and — as
 * everything on her PDF — never naming BabyBloom (security review M2). */
export function optionalText(max: number) {
  return z
    .string({ error: M.oneLine })
    .nullish()
    .transform((value) => blankToEmpty(value) || null)
    .pipe(z.string().max(max, M.tooLong).refine(oneLine, M.oneLine).refine(isNotBabyBloom, M.ownName).nullable());
}

/** An address she may leave blank (null): lines trimmed, blank lines dropped, at most `max` and 6 lines. */
export function optionalAddress(max: number) {
  return z
    .string({ error: M.oneLine })
    .nullish()
    .transform((value) => normaliseAddress(value ?? "") || null)
    .pipe(z.string().max(max, M.tooLong).refine(fewLines, M.tooManyLines).refine(addressOk, M.oneLine)
      .refine(isNotBabyBloom, M.ownName).nullable());
}

/** An address she must give. */
export function requiredAddress(max: number, missing: string) {
  return z
    .string({ error: missing })
    .nullish()
    .transform((value) => normaliseAddress(value ?? ""))
    .pipe(z.string().min(1, missing).max(max, M.tooLong).refine(fewLines, M.tooManyLines).refine(addressOk, M.oneLine)
      .refine(isNotBabyBloom, M.ownName));
}

const accountName = requiredName(text.accountNameMax, M.accountName);

/** Her bank details as she types them (brief §0.1; 3 fields, 14.4). Output is what the database stores. */
export const paymentDetailsSchema = z.object({
  accountName,
  sortCode: bankDigits(6, M.sortCode),
  accountNumber: bankDigits(8, M.accountNumber),
});
export type PaymentDetailsInput = z.input<typeof paymentDetailsSchema>;
export type PaymentDetails = z.output<typeof paymentDetailsSchema>;
