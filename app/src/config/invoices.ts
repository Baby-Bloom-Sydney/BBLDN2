/**
 * The nanny invoice generator's limits (brief 06; plan `BUILD/plans/06-plan.md` step 2, as reworked by §14.3). Every
 * limit and step lives here, inside `config/`, so the `money-literal` spec holds for `src/lib/invoices`. The ceilings
 * are typo guards only — any rate and any amount is hers (brief §0a A, replacing §11 Q5) — and amendment 21 repeats
 * each as a CHECK at the same value (its harness header lists them).
 *
 * Frozen at every level: `as const` for the types, `Object.freeze` so nothing changes a limit at runtime.
 *
 * BB-wave1-041126/06a-build, 2026-11-04; BB-wave1-041126/06b2-build, 2026-11-06.
 */

export const INVOICE_RULES = Object.freeze({
  hourStep: 0.25, // 14.3: shifts end on quarter hours (8:45–17:30 is 8.75 h); replaces Q6's 0.5
  maxShiftHours: 24, // 14.3: one shift, and all of a date's shifts together, fit in a day ("75" typed for "7.5")
  maxHours: 168, // brief §11 Q6: 7 × 24, the backstop per invoice
  dailySendCap: 10, // brief §11 Q11: invoices one nanny can send in a London day (anti-spam)
  ratePence: Object.freeze({ min: 1, max: 25_000 } as const), // 14.3: catches pence typed as pounds ("1800" → £1,800 an hour)
  expensePence: Object.freeze({ min: 1, max: 100_000 } as const), // 14.3: catches pence typed as pounds on a receipt
  maxShiftLines: 28, // 14.3: four shifts a day for seven days; keeps the PDF to two pages
  maxExpenseLines: 20, // 14.3: a week's receipts; keeps the PDF to two pages
  vatRateBp: Object.freeze({ default: 2_000, min: 1, max: 2_000 } as const), // §0a B: 20% unless she changes it; none is above 20%
  pdfLinkSeconds: 60, // plan §9 surface 6: a signed PDF link lives this long
  numberPrefix: "BB", // BAI 2026-11-04: BB-<NannyName>-<YYMMDD>-<Number>, e.g. BB-SophieTaylor-270215-0001
  numberPad: 4, // brief §11 Q4: her own running count, 0001 up
  numberNameMax: 30, // BAI 2026-11-04: letters of her name in the number
  numberNameFallback: "Nanny", // BAI 2026-11-04: when no letter is left
  numberMaxLength: 52, // amendment 21's CHECK on nanny_invoices.invoice_number
  staleSendingMinutes: 10, // plan R1: a row still sending after this long shows as failed
  // plan §4, §9 surface 5, 14.3: a description fits one PDF row; Companies House names run to 160 characters
  text: Object.freeze({
    accountNameMax: 70,
    tradingNameMax: 70,
    addressMax: 200,
    descriptionMax: 120,
    companyNameMax: 160,
    partnershipNameMax: 160,
  } as const),
} as const);

/** The zero every sum of pence starts from (plan R10: no `…Pence: 0` literal outside config). */
export const NO_PENCE = 0;

/** 100% in basis points (14.3): a VAT rate is stored and computed in basis points, 2000 = 20%. */
export const BASIS_POINTS = 10_000;

/** The expense types an invoice line can carry, in the form's order, with their labels (brief §0a A). */
export const EXPENSE_TYPES = Object.freeze({
  food: "Food",
  activities: "Activities",
  travel: "Travel",
  supplies: "Supplies",
  other: "Other",
} as const);

/** Her business types, the default first (brief §0a B: "sole trader (default), limited company, etc."). */
export const BUSINESS_TYPES = Object.freeze({
  sole_trader: "Sole trader",
  limited_company: "Limited company",
  partnership: "Partnership",
} as const);
