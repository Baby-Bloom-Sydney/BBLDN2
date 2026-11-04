/**
 * The shared zod schemas for her payment details and an invoice draft (plan 06 step 5; brief §0.1, §3 nanny 4–5).
 * Client-safe (no I/O): 06b's form and actions parse with the same schemas, and the store parses again.
 *
 * - Plain messages, and **no message ever echoes what was typed** (a rejected sort code must not come back in a
 *   reply or a log): every message below is a fixed string.
 * - BabyBloom is never the party paid or the issuer (plan R8, brief D7): account and trading names refuse it.
 * - Every limit comes from `src/config/invoices.ts`; the rate message prints the bounds through `formatPence`.
 *
 * BB-wave1-041126/06a-build, 2026-11-04.
 */

import { z } from "zod";
import { INVOICE_RULES } from "@/config/invoices";
import { SITE_NAME } from "@/lib/constants";
import { formatInvoiceMoney } from "./money";
import { INVOICE_KINDS } from "./types";
import { isFutureLondonDate, isLondonDate, isLondonMonday } from "./week";

const { text, ratePence, maxHours, hourStep } = INVOICE_RULES;

export const VALIDATION_MESSAGES = Object.freeze({
  accountName: "Enter the name on the account",
  sortCode: "Enter a 6-digit sort code",
  accountNumber: "Enter an 8-digit account number",
  tooLong: "That's too long — please shorten it",
  oneLine: "Use plain text, without special characters",
  ownName: `Use your own name or business name — ${SITE_NAME} can't be the one paid`,
  hours: "Enter the hours worked",
  hourStep: "Enter the hours in half-hour steps",
  hoursMax: `Enter at most ${maxHours} hours`,
  rate: `Enter a rate between ${formatInvoiceMoney(ratePence.min)} and ${formatInvoiceMoney(ratePence.max)} an hour`,
  kind: "Choose Regular week or Trial Shift",
  family: "Choose a family",
  date: "Choose a date",
  monday: "Choose the Monday the week starts on",
  future: "You can't invoice a week or date that hasn't happened yet",
  invalid: "Something's missing — please start again",
} as const);
const M = VALIDATION_MESSAGES;

/**
 * Control, format (zero-width, bidi overrides and isolates, soft hyphen), private-use and unassigned characters and
 * the line/paragraph separators — `\p{C}`, `\p{Zl}`, `\p{Zp}`: none in a one-line field; an address keeps only its
 * line breaks (\n). These print on a BabyBloom-sent PDF (security review L8, N1). Known limit: ZWNJ / ZWJ, which
 * some scripts use in names, are refused too (the database refuses the same).
 */
const ONE_LINE_BAD = /[\p{C}\p{Zl}\p{Zp}]/u;
const ADDRESS_BAD = /(?!\n)[\p{C}\p{Zl}\p{Zp}]/u;
const BABY_BLOOM = /baby\s*bloom/i;

/** Tested after NFKC, which folds full-width and other look-alike letters to plain ones. */
const isNotBabyBloom = (value: string): boolean => {
  const folded = value.normalize("NFKC");
  return !BABY_BLOOM.test(folded) && !folded.toLowerCase().includes(SITE_NAME.toLowerCase());
};

/** UK bank digits: spaces and hyphens stripped, then exactly `count` digits. */
const bankDigits = (count: number, message: string) =>
  z
    .string({ error: message })
    .transform((value) => value.replace(/[\s-]/g, ""))
    .pipe(z.string().regex(new RegExp(`^\\d{${count}}$`), message));

const normaliseAddress = (value: string): string =>
  value
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .trim();

const accountName = z
  .string({ error: M.accountName })
  .transform((value) => value.trim())
  .pipe(
    z
      .string()
      .min(1, M.accountName)
      .max(text.accountNameMax, M.tooLong)
      .refine((value) => !ONE_LINE_BAD.test(value), M.oneLine)
      .refine(isNotBabyBloom, M.ownName),
  );

const tradingName = z
  .string({ error: M.oneLine })
  .nullish()
  .transform((value) => (value ?? "").trim() || null)
  .pipe(
    z
      .string()
      .max(text.tradingNameMax, M.tooLong)
      .refine((value) => !ONE_LINE_BAD.test(value), M.oneLine)
      .refine(isNotBabyBloom, M.ownName)
      .nullable(),
  );

const invoiceAddress = z
  .string({ error: M.oneLine })
  .nullish()
  .transform((value) => normaliseAddress(value ?? "") || null)
  .pipe(
    z
      .string()
      .max(text.addressMax, M.tooLong)
      .refine((value) => !ADDRESS_BAD.test(value), M.oneLine)
      .nullable(),
  );

/** Her payment details as she types them (brief §0.1). Output is what the database stores. */
export const paymentDetailsSchema = z.object({
  accountName,
  sortCode: bankDigits(6, M.sortCode),
  accountNumber: bankDigits(8, M.accountNumber),
  tradingName,
  invoiceAddress,
});
export type PaymentDetailsInput = z.input<typeof paymentDetailsSchema>;
export type PaymentDetails = z.output<typeof paymentDetailsSchema>;

/** An invoice draft (brief §3 nanny 3–5). `now` decides what is "future" (London's today). */
export function invoiceDraftSchema(now: Date) {
  return z
    .object({
      invoiceId: z.guid({ error: M.invalid }),
      kind: z.enum(INVOICE_KINDS, { error: M.kind }),
      targetId: z.guid({ error: M.family }),
      periodStart: z.string({ error: M.date }).refine(isLondonDate, M.date),
      hours: z
        .number({ error: M.hours })
        .positive(M.hours)
        .max(maxHours, M.hoursMax)
        .refine((hours) => Number.isInteger(hours / hourStep), M.hourStep),
      ratePence: z.number({ error: M.rate }).int(M.rate).min(ratePence.min, M.rate).max(ratePence.max, M.rate),
      replacesInvoiceId: z.guid({ error: M.invalid }).nullable(),
    })
    .superRefine((draft, ctx) => {
      if (draft.kind === "regular_week" && !isLondonMonday(draft.periodStart)) {
        ctx.addIssue({ code: "custom", path: ["periodStart"], message: M.monday });
      }
      if (isFutureLondonDate(draft.periodStart, now)) {
        ctx.addIssue({ code: "custom", path: ["periodStart"], message: M.future });
      }
    });
}
export type InvoiceDraft = z.output<ReturnType<typeof invoiceDraftSchema>>;
