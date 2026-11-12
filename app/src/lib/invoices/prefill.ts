/**
 * The new-invoice form's pre-fill (plan 06 §14.3, b2.5; brief §0a A "the default rate, their rate, is the default
 * option"; 06b-4 rework, BAI 2026-11-12: "This should start off with a short and simple, button … to add shift or add
 * expense"). Pure, no I/O, client-safe: `families.ts` reads the rows and calls these; the form shows the result, and
 * she can change every row.
 *
 * - **The form starts empty:** no week's rows and no Trial Shift row (the week and the kind are gone).
 * - **The rate on every new shift row:** the linked placement's `hourly_rate`, then the position's (the rate the family
 *   agreed), then her profile rate `nannies.hourly_rate_min`, else blank. A family linked through a connection has no
 *   placement rate, so it starts at the position's. Each is pounds, converted with `poundsToPence`; a null, ≤ 0 or
 *   over-the-ceiling value is skipped.
 * - **"Send a corrected invoice":** the cancelled invoice's lines, each with its own date, rate and description.
 *
 * BB-wave1-041126/06b2-build, 2026-11-06; BB-wave1-041126/06b4-server, 2026-11-12.
 */

import { INVOICE_RULES } from "@/config/invoices";
import { poundsToPence } from "./money";
import type { StoredLine } from "./store-map-lines";
import type { ExpenseType } from "./types";

export type RateSource = "placement" | "position" | "profile";

export interface PrefillShift {
  readonly date: string;
  readonly hours: number | null;
  readonly ratePence: number | null;
  readonly description: string | null;
}

export interface PrefillExpense {
  readonly expenseType: ExpenseType;
  readonly amountPence: number;
  readonly description: string | null;
}

const RATE_ORDER: readonly RateSource[] = ["placement", "position", "profile"];

/** The rate for every new shift row, and where it came from (14.3). The inputs are pounds as the rows hold them. */
export function pickRate(rates: {
  readonly placement?: unknown;
  readonly position?: unknown;
  readonly profile?: unknown;
}): { readonly ratePence: number | null; readonly rateSource: RateSource | null } {
  const { min, max } = INVOICE_RULES.ratePence;
  for (const source of RATE_ORDER) {
    const pence = poundsToPence(rates[source]);
    // a rate the form would refuse (under a penny, over the typo ceiling) is skipped like a missing one
    if (pence !== null && pence >= min && pence <= max) return { ratePence: pence, rateSource: source };
  }
  return { ratePence: null, rateSource: null };
}

/** "Send a corrected invoice": the cancelled invoice's lines (from `readMyInvoiceLines`), in her order. */
export function correctionPrefill(lines: readonly StoredLine[]): {
  readonly shifts: readonly PrefillShift[];
  readonly expenses: readonly PrefillExpense[];
} {
  const ordered = [...lines].sort((a, b) => a.lineNo - b.lineNo);
  return {
    shifts: ordered.flatMap((l) => (l.kind === "shift" ? [{ date: l.date, hours: l.hours, ratePence: l.ratePence, description: l.description }] : [])),
    expenses: ordered.flatMap((l) => (l.kind === "expense" ? [{ expenseType: l.expenseType, amountPence: l.amountPence, description: l.description }] : [])),
  };
}
