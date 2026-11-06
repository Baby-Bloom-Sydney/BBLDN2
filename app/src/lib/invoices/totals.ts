/**
 * The invoice calculator (plan 06 §14.5): one set of maths for the form (06b-4), the server, the PDF and the
 * database, which repeats it as CHECKs (amendment 21). Pure, no I/O, safe to import on the client.
 *
 * - Every figure is whole pence. **No float maths:** a line is hours × rate with hours counted in quarters (hours × 4
 *   is a whole number, 14.3), and every division is `halfUp(a, b) = ⌊(2a + b) / 2b⌋` on whole numbers — the result
 *   Postgres `round(numeric)` gives, exactly (a float `x × 0.175` can land on 31.4999… where the true value is 31.5).
 * - VAT is worked out once, on the childcare (shifts) subtotal, half up; never line by line. Expenses are at cost and
 *   carry no VAT (brief §0a B). `included`: the VAT is inside the childcare, so the family pays the agreed rate;
 *   `added`: it goes on top.
 * - The largest figure is about 8.4 × 10⁹ (168 h × 25,000 p × 2,000 bp), far under 2⁵³.
 * - A value that can't be a line or a VAT rate throws a RangeError: callers validate first (`validation-lines.ts`).
 *
 * BB-wave1-041126/06b2-build, 2026-11-06.
 */

import { BASIS_POINTS, INVOICE_RULES, NO_PENCE } from "@/config/invoices";
import type { VatMode } from "./types";

/** Hours are counted in quarter hours (14.3): 1 / hourStep. The one copy (validation and the pre-fill use it). */
export const QUARTERS_PER_HOUR = Math.round(1 / INVOICE_RULES.hourStep);
/** How far from a whole number of quarters a typed decimal may sit and still be one (binary drift, never a typo). */
const QUARTER_DRIFT = 1e-9;

export type TotalsLine =
  | { readonly kind: "shift"; readonly hours: number; readonly ratePence: number }
  | { readonly kind: "expense"; readonly amountPence: number };

export interface VatSetting {
  readonly mode: VatMode;
  readonly rateBp: number | null;
}

export interface InvoiceTotals {
  /** The sum of the shifts' hours (07 reads this off the header). */
  readonly hours: number;
  /** The childcare subtotal: the shift lines' amounts (VAT inside it when included). */
  readonly shiftsPence: number;
  readonly expensesPence: number;
  readonly vatPence: number;
  /** The childcare without VAT: `shiftsPence − vatPence` when included, else `shiftsPence`. */
  readonly netShiftsPence: number;
  readonly totalPence: number;
}

/** a / b to the nearest whole, a half up, for a whole a ≥ 0 and a whole b > 0. */
export function halfUp(a: number, b: number): number {
  const n = 2 * a + b;
  if (!Number.isSafeInteger(a) || a < 0 || !Number.isSafeInteger(b) || b <= 0 || !Number.isSafeInteger(n)) {
    throw new RangeError("half-up takes a whole a ≥ 0 over a whole b > 0");
  }
  const d = 2 * b;
  return (n - (n % d)) / d;
}

/** Hours as a whole number of quarter hours (8.75 → 35); a RangeError when they aren't positive quarter hours. */
export function toQuarters(hours: number): number {
  const scaled = hours * QUARTERS_PER_HOUR;
  const quarters = Math.round(scaled);
  if (!Number.isSafeInteger(quarters) || quarters <= 0 || Math.abs(scaled - quarters) > QUARTER_DRIFT) {
    throw new RangeError("hours must be positive and in quarter-hour steps");
  }
  return quarters;
}

function requireWholePence(pence: number, allowZero: boolean): void {
  if (!Number.isSafeInteger(pence) || pence < 0 || (!allowZero && pence === 0)) {
    throw new RangeError("an amount must be whole pence");
  }
}

/** One shift's amount: hours × rate to the nearest penny, half up (amendment 21's `round(hours * rate_pence)`). */
export function lineAmountPence(hours: number, ratePence: number): number {
  requireWholePence(ratePence, false);
  return halfUp(toQuarters(hours) * ratePence, QUARTERS_PER_HOUR);
}

/** VAT on a childcare subtotal (14.5): 0, the VAT inside it (`included`), or on top of it (`added`). */
export function vatPence(shiftsPence: number, mode: VatMode, rateBp: number | null): number {
  requireWholePence(shiftsPence, true);
  if (mode === "none") {
    if (rateBp !== null) throw new RangeError("no VAT rate when not VAT registered");
    return NO_PENCE;
  }
  const { min, max } = INVOICE_RULES.vatRateBp;
  if (rateBp === null || !Number.isInteger(rateBp) || rateBp < min || rateBp > max) {
    throw new RangeError("a VAT rate of 1 to 2,000 basis points");
  }
  if (mode === "included") return halfUp(shiftsPence * rateBp, BASIS_POINTS + rateBp);
  if (mode === "added") return halfUp(shiftsPence * rateBp, BASIS_POINTS);
  throw new RangeError("not a VAT mode");
}

/** Every figure of an invoice from its lines and her VAT setting (14.5). */
export function invoiceTotals(lines: readonly TotalsLine[], vat: VatSetting): InvoiceTotals {
  let quarters = 0;
  let shiftsPence = NO_PENCE;
  let expensesPence = NO_PENCE;
  for (const line of lines) {
    if (line.kind === "shift") {
      quarters += toQuarters(line.hours);
      shiftsPence += lineAmountPence(line.hours, line.ratePence);
    } else {
      requireWholePence(line.amountPence, false);
      expensesPence += line.amountPence;
    }
  }
  const vatOn = vatPence(shiftsPence, vat.mode, vat.rateBp);
  return {
    hours: quarters / QUARTERS_PER_HOUR,
    shiftsPence,
    expensesPence,
    vatPence: vatOn,
    netShiftsPence: vat.mode === "included" ? shiftsPence - vatOn : shiftsPence,
    totalPence: shiftsPence + expensesPence + (vat.mode === "added" ? vatOn : NO_PENCE),
  };
}
