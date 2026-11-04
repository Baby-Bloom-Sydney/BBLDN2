/**
 * The nanny invoice generator's limits (brief 06; plan `BUILD/plans/06-plan.md` step 2). Every limit and step lives
 * here, inside `config/`, so the `money-literal` spec holds for `src/lib/invoices`. The database repeats the hour
 * rules as backstops (amendment 21's `nanny_invoices_hours_check`).
 *
 * Frozen at every level: `as const` for the types, `Object.freeze` so nothing changes a limit at runtime.
 *
 * BB-wave1-041126/06a-build, 2026-11-04.
 */

export const INVOICE_RULES = Object.freeze({
  hourStep: 0.5, // brief §11 Q6 — 2026-11-04
  maxHours: 168, // brief §11 Q6: the existing placement cap
  dailySendCap: 10, // brief §11 Q11: invoices one nanny can send in a London day (anti-spam)
  ratePence: Object.freeze({ min: 1_500, max: 3_000 } as const), // brief §11 Q5: HOURLY_RATE_BOUNDS × 100
  pdfLinkSeconds: 60, // plan §9 surface 6: a signed PDF link lives this long
  numberPrefix: "INV-", // brief §11 Q4
  numberPad: 4, // brief §11 Q4: INV-0001
  staleSendingMinutes: 10, // plan R1: a row still sending after this long shows as failed
  text: Object.freeze({ accountNameMax: 70, tradingNameMax: 70, addressMax: 200 } as const), // plan §4, §9 surface 5
} as const);

/** The zero every sum of pence starts from (plan R10: no `…Pence: 0` literal outside config). */
export const NO_PENCE = 0;
