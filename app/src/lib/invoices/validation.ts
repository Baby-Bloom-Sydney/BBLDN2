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
  ownName: `Use your own name or business name — ${SITE_NAME} can't be the one paid`,
  invalid: "Something's missing — please start again",
} as const);
const M = VALIDATION_MESSAGES;

/**
 * Control, format (zero-width, bidi overrides and isolates, soft hyphen), private-use and unassigned characters and
 * the line/paragraph separators — `\p{C}`, `\p{Zl}`, `\p{Zp}`: none in a one-line field; an address keeps only its
 * line breaks (\n). These print on a BabyBloom-sent PDF (security review L8, N1). Known limit: ZWNJ / ZWJ, which
 * some scripts use in names, are refused too (the database refuses the same).
 */
export const ONE_LINE_BAD = /[\p{C}\p{Zl}\p{Zp}]/u;
export const ADDRESS_BAD = /(?!\n)[\p{C}\p{Zl}\p{Zp}]/u;
const BABY_BLOOM = /baby\s*bloom/i;

/** Tested after NFKC, which folds full-width and other look-alike letters to plain ones (plan R8). */
export const isNotBabyBloom = (value: string): boolean => {
  const folded = value.normalize("NFKC");
  return !BABY_BLOOM.test(folded) && !folded.toLowerCase().includes(SITE_NAME.toLowerCase());
};

/** UK bank digits: spaces and hyphens stripped, then exactly `count` digits. */
const bankDigits = (count: number, message: string) =>
  z
    .string({ error: message })
    .transform((value) => value.replace(/[\s-]/g, ""))
    .pipe(z.string().regex(new RegExp(`^\\d{${count}}$`), message));

export const normaliseAddress = (value: string): string =>
  value
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .trim();

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

/** One line of plain text she may leave blank (null), e.g. a line's description: trimmed, at most `max`. */
export function optionalText(max: number) {
  return z
    .string({ error: M.oneLine })
    .nullish()
    .transform((value) => blankToEmpty(value) || null)
    .pipe(z.string().max(max, M.tooLong).refine(oneLine, M.oneLine).nullable());
}

/** An address she may leave blank (null): lines trimmed, Windows line ends normalised, at most `max`. */
export function optionalAddress(max: number) {
  return z
    .string({ error: M.oneLine })
    .nullish()
    .transform((value) => normaliseAddress(value ?? "") || null)
    .pipe(z.string().max(max, M.tooLong).refine((value) => !ADDRESS_BAD.test(value), M.oneLine).nullable());
}

/** An address she must give. */
export function requiredAddress(max: number, missing: string) {
  return z
    .string({ error: missing })
    .nullish()
    .transform((value) => normaliseAddress(value ?? ""))
    .pipe(z.string().min(1, missing).max(max, M.tooLong).refine((value) => !ADDRESS_BAD.test(value), M.oneLine));
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
