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
import { formatCohortShort, formatDayMonth, isLondonDate } from "@/lib/cohorts/dates";
import { APP_LOCALE, SITE_NAME } from "@/lib/constants";
import { EMAIL_MAX, HOLD_MINUTES } from "./constants";
import type { CohortView } from "@/lib/cohorts/types";
import { formatClockHourMinute, londonWallClockOf } from "@/lib/timezone";
import type { DepositPanel, DepositPayment, DepositWarning, PanelPlace, SavedCard } from "./panel";

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

// ── The admin panel's words (brief 03 §3 Admin 1–7; plan 03 row A5) ──────────────────────────────────────────────
// Pure functions of `readDepositPanel`'s view model (`./panel`, imported for its types only, so this file stays
// client-safe). Amounts are what she paid, formatted at run time (`penceAmount`; never written); dates are 02's
// "3 Feb" / "Mon 1 Feb"; times are on the London clock; emails are masked. Placeholders BAI edits (Q4).

/** Any amount in pence, written as `depositAmount()` writes the deposit: whole pounds without pence, else with. */
export function penceAmount(pence: number): string {
  const isWhole = pence % PENCE_PER_POUND === 0;
  return new Intl.NumberFormat(APP_LOCALE, {
    style: "currency",
    currency: PRICES.currency.toUpperCase(),
    ...(isWhole ? { minimumFractionDigits: 0 } : {}),
  }).format(pence / PENCE_PER_POUND);
}

/** The panel's lines with nothing to fill in, and its buttons and refusals (brief §3 Admin 1–7). */
export const PANEL_COPY = Object.freeze({
  notPaid: "Not paid",
  cardNotRecorded: "Card: not recorded",
  noCardSaved: "no card saved",
  noLink: "No deposit link yet",
  notEmailed: "Link made, not emailed yet",
  duplicateWarning: "Second deposit received. Refund one in Stripe",
  refundedButHeldWarning: "Deposit refunded but place still held",
  emailButton: "Email deposit link",
  copyButton: "Copy link",
  cancelButton: "Cancel link",
  takePaymentButton: "Take payment now",
  markPaidButton: "Mark deposit paid (bank transfer)",
  bankRefundButton: "Record refund (bank transfer)",
  targetCurrent: "Current cohort",
  emailFailed: "Email didn't send. Copy the link instead.",
  cohortFull: "This cohort is full",
  alreadyPaid: "The deposit is already paid.",
  unavailable: "Deposit: could not be read",
} as const);

/** Stripe's lower-case brand ids, as people write them; any other id is capitalised word by word. */
const BRAND_WORDS: ReadonlyMap<string, string> = new Map([
  ["jcb", "JCB"],
  ["unionpay", "UnionPay"],
]);
const brandWords = (brand: string): string =>
  BRAND_WORDS.get(brand) ?? brand.split("_").map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(" ");
const twoDigits = (n: number): string => String(n % 100).padStart(2, "0");

/** "Visa •••• 4242 (12/30)" — never more of the card than the last four. */
export const savedCardWords = (card: SavedCard): string =>
  `${brandWords(card.brand)} •••• ${card.last4} (${twoDigits(card.expMonth)}/${twoDigits(card.expYear)})`;

function paidHead(payment: DepositPayment): string {
  const paid = payment.pence === null ? "Paid" : `Paid ${penceAmount(payment.pence)}`;
  const day = formatDayMonth(payment.paidAt);
  if (payment.method === "card") return `${paid} by card, ${day}`;
  if (payment.method === "bank_transfer") return `${paid} by bank transfer`;
  return `${paid}, ${day} (old payment link)`;
}

function cardPart(payment: DepositPayment, card: SavedCard | null): string {
  if (card !== null) return `Card saved ${savedCardWords(card)}`;
  return payment.method === "card" ? PANEL_COPY.cardNotRecorded : PANEL_COPY.noCardSaved;
}

const cohortPart = (place: PanelPlace | null): string | null =>
  place?.state === "taken" ? `Cohort ${formatCohortShort(place.cohortStartDate)}${place.isGoodwill ? " (goodwill)" : ""}` : null;

/** The state line: "Not paid" · "Paid <amount> by card, 3 Feb · Card saved Visa •••• 4242 (12/30) · Cohort Mon 1 Feb" · … */
export function depositStateLine(panel: DepositPanel): string {
  const { payment } = panel;
  if (payment === null) return PANEL_COPY.notPaid;
  if (payment.refundedAt !== null) return `Refunded ${formatDayMonth(payment.refundedAt)}`;
  return [paidHead(payment), cardPart(payment, panel.card), cohortPart(panel.place)].filter((part): part is string => part !== null).join(" · ");
}

/** "Pre-booked for Mon 8 Feb"; null when she hasn't pre-booked. */
export function prebookedLine(panel: DepositPanel): string | null {
  const { prebooking } = panel;
  if (prebooking === null) return null;
  return prebooking.cohortStartDate === null ? "Pre-booked (no cohort set up yet)" : `Pre-booked for ${formatCohortShort(prebooking.cohortStartDate)}`;
}

/** "14:02" on London's clock when it was today in London, else "1 Feb 18:30". */
function sentAt(at: string, today: string): string {
  const wall = londonWallClockOf(at);
  const time = formatClockHourMinute(wall.hour, wall.minute);
  return wall.date === today ? time : `${formatDayMonth(at)} ${time}`;
}

/** "Sent 14:02 to s•••@gmail.com" (brief §0.1); a goodwill link names its cohort. */
export function linkLine(panel: DepositPanel): string {
  const { link } = panel;
  if (link === null) return PANEL_COPY.noLink;
  const to = link.lastEmailedTo === null ? "" : ` to ${maskEmail(link.lastEmailedTo)}`;
  const sent = link.lastEmailedAt === null ? PANEL_COPY.notEmailed : `Sent ${sentAt(link.lastEmailedAt, panel.today)}${to}`;
  return link.goodwillStartDate === null ? sent : `${sent} · goodwill ${formatCohortShort(link.goodwillStartDate)}`;
}

/** A second press of Email asks first: "Sent at 14:02. Send again?" (brief §3 Admin 3); null when never sent. */
export function sendAgainQuestion(panel: DepositPanel): string | null {
  const at = panel.link?.lastEmailedAt ?? null;
  return at === null ? null : `Sent at ${sentAt(at, panel.today)}. Send again?`;
}

const WARNING_WORDS: Readonly<Record<DepositWarning, string>> = Object.freeze({
  duplicate_payment: PANEL_COPY.duplicateWarning,
  refunded_but_held: PANEL_COPY.refundedButHeldWarning,
});

/** The panel's warnings (brief §3 Admin 7), in the view model's order. */
export const depositWarningLines = (panel: DepositPanel): readonly string[] => panel.warnings.map((w) => WARNING_WORDS[w]);

/** The goodwill choice (brief §3 Admin 2): "Next cohort, goodwill (Mon 8 Feb · 5 left)". */
export const goodwillChoiceLabel = (next: CohortView): string => `Next cohort, goodwill (${formatCohortShort(next.start)} · ${next.left} left)`;
