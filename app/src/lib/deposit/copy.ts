/**
 * Every word brief 03 puts on the parent's deposit page (brief 03 §3 parent 1–10, §0.2–§0.9). **Placeholders**: BAI
 * edits the wording before switch-on (brief Q4, default accepted). Pure, client-safe.
 *
 * - The amount is never written: `depositAmount()` formats `PRICES.dfy.depositPence` at run time (the money-literal
 *   gate), so changing the price in brief 01 changes the page.
 * - Dates read as 04's picker legend, "Monday 1 February" (`dayWords(...).legend`); the brand is `SITE_NAME`.
 *
 * BB-wave2-231126/03-build, 2026-11-25.
 */

import { PRICES } from "@/config/prices";
import { dayWords } from "@/lib/calls/slot-words";
import { isLondonDate } from "@/lib/cohorts/dates";
import { APP_LOCALE, SITE_NAME } from "@/lib/constants";
import { EMAIL_MAX, HOLD_MINUTES } from "./constants";

const PENCE_PER_POUND = 100;

/** The deposit as people read it: whole pounds without pence (as the brief writes it), otherwise with pence. */
export function depositAmount(): string {
  const pence = PRICES.dfy.depositPence;
  const isWhole = pence % PENCE_PER_POUND === 0;
  return new Intl.NumberFormat(APP_LOCALE, {
    style: "currency",
    currency: PRICES.currency.toUpperCase(),
    ...(isWhole ? { minimumFractionDigits: 0 } : {}),
  }).format(pence / PENCE_PER_POUND);
}

/** "Monday 1 February". A value that isn't a date shows as itself, so a bad value never breaks the page. */
const dayOf = (start: string): string => (isLondonDate(start) ? dayWords(start).legend : start);

/** The lines with nothing to fill in. */
export const PAGE_COPY = Object.freeze({
  consent:
    "We'll save your card securely with Stripe. We only charge the rest of your bill once you're happy with your nanny, and we'll tell you the amount first.",
  footnote: `Payments are handled by Stripe. ${SITE_NAME} never sees your card number.`,
  paid: "Your deposit is paid. Thank you.",
  doneNotPaid: "We haven't received your payment yet. Try again.",
  full: "This cohort is full.",
  prebookButton: "Pre-book next available cohort",
  beingPaid: `The last place is being paid for right now. Try again in ${HOLD_MINUTES} minutes, or pre-book the next cohort.`,
  prebookNoCohort: "We'll be in touch to arrange your place.",
  invalid: `This link isn't working. Ask ${SITE_NAME} to send it again.`,
  tryAgain: "Try again.",
  tryAgainSoon: "Try again in a moment.",
} as const);

/** "Your place in the cohort starting Monday 1 February" (brief §0.2). */
export const placeHeading = (start: string): string => `Your place in the cohort starting ${dayOf(start)}`;

/** The bookable page's explanation (brief §3 parent 1), greeting her by first name when there is one. */
export function bookableIntro(firstName: string | null, start: string): string {
  const name = firstName?.trim() ?? "";
  const amount = depositAmount();
  return (
    `${name ? `Hi ${name}.` : "Hello."} Your ${amount} deposit confirms your place in the cohort starting ${dayOf(start)}, ` +
    "and we start arranging your Trial Shifts straight away. It's part of your fee, not an extra. You pay your nanny for " +
    `her Trial Shift on the day, and the full ${amount} comes off your final bill. If you choose not to go with any of ` +
    "the nannies we match you with, you get it back."
  );
}

export const payButtonLabel = (): string => `Pay ${depositAmount()}`;

/** The done page once Stripe says the session is paid (brief §0.3). */
export const donePaid = (start: string | null): string =>
  start === null ? "Payment received. Thank you." : `Payment received. Your place in the cohort starting ${dayOf(start)} is confirmed.`;

/** After "Pre-book" when the opening day has no free call time, or call booking is off (brief §0.5). */
export const prebookCallLine = (date: string): string => `We'll call you on ${dayOf(date)} to confirm your place.`;

const MASK = "•••";
const EMAIL_SHAPE = /^([^\s@\p{C}]+)@([^\s@\p{C}]+\.[^\s@\p{C}]+)$/u;

/** "s•••@gmail.com" (brief §0.1). Anything that isn't a plain address shows only the mask, revealing nothing. */
export function maskEmail(email: unknown): string {
  if (typeof email !== "string") return MASK;
  const trimmed = email.trim();
  if (trimmed.length > EMAIL_MAX) return MASK;
  const match = EMAIL_SHAPE.exec(trimmed);
  if (match === null) return MASK;
  return `${Array.from(match[1])[0]}${MASK}@${match[2]}`;
}
