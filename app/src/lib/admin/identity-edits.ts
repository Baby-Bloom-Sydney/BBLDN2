/**
 * The admin's corrections to the AI-extracted passport details in Check ID (W6-D3, unit 3w6fix, BB-LDN-3w6fix-141026).
 *
 * Why: the DBS cross-check (00-RULINGS #21) compares the passport's surname + date of birth with the certificate's.
 * When the AI could not read the passport date of birth, the admin types it in Check ID — and until now that edit was
 * kept in component state only, so the cross-check always failed "Missing data: passport date of birth" (→ 21).
 * `adminVerifyIdentity` now saves the edited fields in the same write as the approval.
 *
 * Contract
 * - Input: `parseIdentityEdits(unknown)` — the raw value from the client. Output: `{ ok: true, data }` holding only
 *   whitelisted `extracted_*` fields (trimmed; an empty field → null), or `{ ok: false, error }`.
 * - Dates are real `YYYY-MM-DD` calendar dates (the form `lib/dbs/match.ts` compares); a date of birth is not in the
 *   future and not before 1900.
 * - `changedIdentityFields(before, after)` — the client sends only what the admin changed.
 * - Never: accepts a key outside `IDENTITY_EDIT_FIELDS` (no status, level or verified flag can ride along), or writes
 *   anything itself. Pure, so client components may import it.
 */
import { z } from "zod";
import { isCalendarDate } from "@/lib/dbs/match";

/** The six fields Check ID shows under "AI Extracted Details" — the only ones an admin may correct. */
export const IDENTITY_EDIT_FIELDS = [
  "extracted_surname",
  "extracted_given_names",
  "extracted_dob",
  "extracted_nationality",
  "extracted_passport_number",
  "extracted_passport_expiry",
] as const;

export type IdentityEditField = (typeof IDENTITY_EDIT_FIELDS)[number];
export type IdentityEdits = Partial<Record<IdentityEditField, string | null>>;

const MAX_TEXT = 100;
const EARLIEST_DOB = "1900-01-01";

/** Trimmed text; blank → null (the admin cleared the field). */
const text = (max: number) =>
  z.string().max(max).transform((s) => (s.trim() === "" ? null : s.trim()));

const isoDate = z
  .string()
  .transform((s) => s.trim())
  .refine((s) => s === "" || (/^\d{4}-\d{2}-\d{2}$/.test(s) && isCalendarDate(s)), "Use a real date (YYYY-MM-DD)")
  .transform((s) => (s === "" ? null : s));

const today = () => new Date().toISOString().slice(0, 10);

const schema = z
  .object({
    extracted_surname: text(MAX_TEXT),
    extracted_given_names: text(MAX_TEXT),
    extracted_dob: isoDate.refine(
      (d) => d === null || (d >= EARLIEST_DOB && d <= today()),
      "Date of birth must be between 1900 and today",
    ),
    extracted_nationality: text(MAX_TEXT),
    extracted_passport_number: text(20).refine(
      (s) => s === null || /^[A-Za-z0-9]+$/.test(s),
      "Passport number: letters and digits only",
    ),
    extracted_passport_expiry: isoDate,
  })
  .partial()
  .strict();

/** Validate the client's edits; anything unexpected fails closed (see the module contract). */
export function parseIdentityEdits(
  input: unknown,
): { ok: true; data: IdentityEdits } | { ok: false; error: string } {
  if (input === undefined || input === null) return { ok: true, data: {} };
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: `Invalid passport details: ${parsed.error.issues[0]?.message ?? "invalid"}` };
  }
  return { ok: true, data: parsed.data };
}

/** The whitelisted fields whose value differs between the snapshot taken when Edit opened and the current form. */
export function changedIdentityFields(
  before: Readonly<Record<string, string>>,
  after: Readonly<Record<string, string>>,
): Partial<Record<IdentityEditField, string>> {
  return Object.fromEntries(
    IDENTITY_EDIT_FIELDS.filter((k) => (after[k] ?? "") !== (before[k] ?? "")).map((k) => [k, after[k] ?? ""]),
  );
}
