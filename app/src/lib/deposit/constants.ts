/**
 * Brief 03's fixed numbers (plan 03 §3; amendment 18's CHECKs). No money here: the amount is `PRICES` (brief 01).
 * Client-safe.
 *
 * BB-wave2-231126/03-build, 2026-11-25.
 */

/** How long Pay holds a place: 02's number, reused (brief 03 §3 parent 2). */
export { HOLD_MINUTES } from "@/lib/cohorts/constants";

/** Random bytes in a deposit code: 256 bits (plan 03 §3 "Link"). */
export const DEPOSIT_CODE_BYTES = 32;
/** Its base64url length, no padding: ceil(32 × 8 / 6). Amendment 18 checks the same shape. */
export const DEPOSIT_CODE_LENGTH = 43;

/** A Pay press's Stripe Checkout session lasts this long — Stripe's minimum, and the hold's length. */
export const CHECKOUT_SESSION_MINUTES = 30;

/** BAI's bank-transfer note, once trimmed (amendment 18, deposit_bank_transfers.note). */
export const NOTE_MIN = 1;
export const NOTE_MAX = 500;
/** BAI's bank-transfer refund reason, once trimmed (amendment 18, deposit_record_bank_refund). */
export const REFUND_REASON_MIN = 3;
export const REFUND_REASON_MAX = 500;

/** A double tap on Pay waits for the first press's session: this many re-reads, this far apart (plan 03 §3). */
export const PAY_REREAD_TRIES = 3;
export const PAY_REREAD_DELAY_MS = 1000;
/**
 * Pay finds her live hold still with no session after those re-reads. Made longer ago than this (its start is
 * `hold_expires_at` − `HOLD_MINUTES`), the press that made it is gone: Pay releases it and holds once more, rather
 * than answer "try again soon" until the hold lapses (code review M1).
 */
export const SESSIONLESS_HOLD_STALE_SECONDS = 60;

/** The longest email address stored or shown (amendment 18, deposit_links.last_emailed_to). */
export const EMAIL_MAX = 320;
