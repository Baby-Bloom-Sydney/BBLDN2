import { SITE_URL } from "@/lib/constants";
/**
 * Pure URL → token extraction with origin + format validation.
 * See `extract-token.test.ts` for the spec; see `child-invites.ts` for
 * the canonical token shape.
 */

const TOKEN_PATH_REGEX = /^\/invite\/([A-HJKMN-Z2-9]{4}-[A-HJKMN-Z2-9]{4})\/?$/;

const DEFAULT_INVITE_BASE = SITE_URL;

export function extractInviteToken(input: string): string | null {
  if (typeof input !== "string") return null;
  const trimmed = input.trim();
  if (trimmed.length === 0) return null;

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }

  let expected: URL;
  try {
    expected = new URL(
      process.env.NEXT_PUBLIC_INVITE_BASE_URL ?? DEFAULT_INVITE_BASE,
    );
  } catch {
    return null;
  }

  if (url.origin !== expected.origin) return null;

  const match = url.pathname.match(TOKEN_PATH_REGEX);
  return match ? match[1] : null;
}
