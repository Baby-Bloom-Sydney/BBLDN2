/**
 * The two limits the Calendar tab's forms show in the browser, with no run-time import at all (BB-wave1-041126/04c2-build):
 * `settings.ts` and `calendar.ts` check with zod, and importing them into a client form put zod into `/admin/calls`'s
 * bundle. Both re-export these, so the server checks and the forms can never disagree.
 */

/** The call lengths the Calendar tab offers and the server accepts (brief §0a.13, BAI 2026-11-06: "the fixed list"). */
export const CALL_LENGTH_CHOICES: readonly number[] = Object.freeze([15, 20, 30, 45, 60]);

/** `call_blocks_reason_check`: a block's reason is 1–200 characters. */
export const BLOCK_REASON_MAX = 200;
