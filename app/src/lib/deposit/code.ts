/**
 * The deposit code (plan 03 §3 "Link"): one per open link, 32 random bytes written as 43 base64url characters.
 *
 * - `isDepositCode` is the format check every page and action runs before any read; anything else gets the one
 *   invalid page (brief 03 §3 parent 8).
 * - `depositCodeFrom` only writes bytes it is given. The randomness is the server's (`randomBytes(32)` in
 *   `links.ts`), so this file stays pure and client-safe: no node crypto and no Node-only byte helpers.
 * - `isUuid` / `UUID_RE` — the one uuid check of `src/lib/deposit` (row and user ids). Any version and variant, as
 *   Postgres's uuid type allows; zod's `z.uuid()` (`@/lib/calls/zod-parts`) is stricter, so it isn't used here.
 *
 * BB-wave2-231126/03-build, 2026-11-25.
 */

import { DEPOSIT_CODE_BYTES, DEPOSIT_CODE_LENGTH } from "./constants";

/** 8-4-4-4-12 hex digits, either case. */
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

const CODE_RE = new RegExp(`^[A-Za-z0-9_-]{${DEPOSIT_CODE_LENGTH}}$`);
const BASE64URL = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
const BITS_PER_CHAR = 6;
const CHAR_MASK = 0b111111;

/** Exactly 43 characters of A–Z, a–z, 0–9, `_` and `-`. */
export function isDepositCode(value: unknown): value is string {
  return typeof value === "string" && CODE_RE.test(value);
}

/** One group of up to 3 bytes as 2–4 characters (no padding). */
function group(bytes: Uint8Array, at: number): string {
  const count = Math.min(3, bytes.length - at);
  const word = (bytes[at] << 16) | ((count > 1 ? bytes[at + 1] : 0) << 8) | (count > 2 ? bytes[at + 2] : 0);
  const chars = Math.ceil((count * 8) / BITS_PER_CHAR);
  return Array.from({ length: chars }, (_, k) => BASE64URL[(word >> (18 - BITS_PER_CHAR * k)) & CHAR_MASK]).join("");
}

/** 32 bytes → their base64url text (43 characters). Any other input throws: a short code is never minted. */
export function depositCodeFrom(bytes: Uint8Array): string {
  if (Object.prototype.toString.call(bytes) !== "[object Uint8Array]" || bytes.length !== DEPOSIT_CODE_BYTES) {
    throw new RangeError(`a deposit code needs exactly ${DEPOSIT_CODE_BYTES} bytes`);
  }
  const groups = Array.from({ length: Math.ceil(bytes.length / 3) }, (_, i) => group(bytes, i * 3));
  return groups.join("");
}
