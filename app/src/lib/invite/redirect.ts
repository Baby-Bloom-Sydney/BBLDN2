/**
 * Resolves the post-auth redirect target when a `?invite={token}` query
 * param is present. The validation regex MUST match the canonical token
 * format (Crockford-like, XXXX-XXXX) so an attacker can't paste a
 * scheme-prefixed string or path fragment to hijack the redirect.
 *
 * Kept in sync with `lib/invite/extract-token.ts → TOKEN_PATH_REGEX`
 * and `lib/actions/bapp/child-invites.ts → TOKEN_FORMAT_REGEX` (`lib/invite/signup-stamp.ts` uses this one) —
 * change all three together if the token shape ever evolves.
 */

export const INVITE_TOKEN_REGEX = /^[A-HJKMN-Z2-9]{4}-[A-HJKMN-Z2-9]{4}$/;

export function resolveInviteRedirect(
  rawToken: string | null,
  defaultRedirect: string,
): string {
  if (typeof rawToken !== "string" || !INVITE_TOKEN_REGEX.test(rawToken)) {
    return defaultRedirect;
  }
  // `?auto=1` tells the invite landing client to fire `connect`
  // automatically once mounted — sign-in/sign-up via an invite link is
  // implicit consent to claim it, so the second "Connect" tap was just
  // friction. Switch-ack and other gates still hold the auto path back
  // when present.
  return `/invite/${rawToken}?auto=1`;
}

/**
 * Same-origin redirect guard for any user-supplied `?redirect=` param.
 * Accepts only absolute paths (starting with a single `/`); rejects
 * scheme-relative URLs (`//evil.com`), absolute URLs, and anything
 * non-string. Pair with `resolveInviteRedirect` so an attacker can't
 * bypass the invite check by also setting `?redirect=https://evil.com`.
 */
export function isSafeInternalPath(value: string | null): value is string {
  if (typeof value !== "string") return false;
  if (value.length === 0) return false;
  // Must start with `/` and the second char must NOT be `/` (which
  // would be a scheme-relative URL like `//evil.com/path`).
  if (value[0] !== "/" || value[1] === "/") return false;
  // Disallow backslash variants used to confuse some legacy parsers.
  if (value[1] === "\\") return false;
  return true;
}
