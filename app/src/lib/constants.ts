/**
 * The single source for London's brand and place facts.
 *
 * Until LDN2 Stage 2 this module had **zero importers** — every one of
 * ~374 brand, domain, timezone, locale and currency sites in the tree
 * was a scattered literal or an `env ?? "<AU literal>"` fallback
 * (triage §0 finding 1; P-7, measured 0 of 374). Unit 2-0 amends the
 * dead file into the source; units 2b (time), 2c (locale), 2d
 * (currency), 2e (phone) and 2f (brand) re-point their literals here.
 *
 * Rules for anything added below:
 *   - a jurisdiction fact is configuration, never a literal in a body
 *     (ADR-171);
 *   - a value we are not entitled to invent carries an `@pending:`
 *     sentinel that `constants.test.ts` keeps a sentinel, so filling it
 *     in is a change that has to be noticed;
 *   - no secret, key or credential — this repository is public.
 *
 * BB-LDN-2-0-250926, 2026-09-25.
 */

/** Product name. ADR-033 / glossary §7 — also written "BabyBloom London". */
export const SITE_NAME = "BabyBloom";

/**
 * @pending:copy — no London strapline is ratified. ADR-033 and glossary
 * §7 fix the name and the domain but state no strapline, and nothing in
 * `LDN/` defines one. This is a plain placeholder checked against the
 * glossary §6 banned-words list; BAI rewords it and the flag comes off.
 */
export const SITE_DESCRIPTION =
  "Connecting London families with trusted nannies";

/**
 * The bare host — no scheme, no path. It is what `SENDERS` is built on
 * and what the internal-user email filters match against, so the two
 * can never drift apart. ADR-033; not yet purchased (B-50).
 */
export const SITE_DOMAIN = "babybloomlondon.co.uk";

/** Default origin when `NEXT_PUBLIC_SITE_URL` is unset. ADR-033. */
const DEFAULT_SITE_URL = `https://${SITE_DOMAIN}`;

/** A trailing slash makes every `${SITE_URL}/path` in the tree a `//`. */
const stripTrailingSlash = (url: string): string => url.replace(/\/+$/, "");

/**
 * Canonical origin, never with a trailing slash. The environment keeps
 * precedence so preview and localhost still win.
 */
export const SITE_URL = stripTrailingSlash(
  process.env.NEXT_PUBLIC_SITE_URL || DEFAULT_SITE_URL,
);

/**
 * The place facts. 12.01 / 12.08 — the scattered city fallbacks and the
 * hardcoded country literals are re-pointed here by 2e and 2f.
 */
export const BRAND = {
  name: SITE_NAME,
  city: "London",
  region: "Greater London",
  country: "United Kingdom",
  countryCode: "GB",
} as const;

/** Every outbound address, built from the one domain. 12.07. */
export const SENDERS = {
  noreply: `noreply@${SITE_DOMAIN}`,
  hello: `hello@${SITE_DOMAIN}`,
  support: `support@${SITE_DOMAIN}`,
  admin: `admin@${SITE_DOMAIN}`,
  compliance: `compliance@${SITE_DOMAIN}`,
  privacy: `privacy@${SITE_DOMAIN}`,
} as const;

/** Where a human reply goes. One inbox, one source. */
export const SUPPORT_INBOX = SENDERS.support;

/**
 * The addresses the admin console may send "as". The tree kept this list
 * twice — once server-side in `actions/admin.ts` and once client-side in
 * `ContactUserModal` — and the two had to stay byte-identical for the
 * server's validation to accept the modal's own picker value. It lives
 * here because `actions/admin.ts` is a `'use server'` module and cannot
 * export a constant. 12.07, BB-LDN-2f-250926.
 *
 * The four local parts that are not in `SENDERS` exist only on this
 * console; they are built from the one domain so they cannot drift.
 */
export const ADMIN_FROM_ADDRESSES = [
  SENDERS.noreply,
  `verification@${SITE_DOMAIN}`,
  `nannies@${SITE_DOMAIN}`,
  SENDERS.support,
  `contact@${SITE_DOMAIN}`,
  `parents@${SITE_DOMAIN}`,
] as const;

/**
 * ADR-171 — the trading entity's legal name is not ours to invent. The
 * sentinel ships wherever the old entity and registration lines sat; a test
 * asserts it is *still* a sentinel, so the real name arrives as a
 * deliberate change rather than a plausible string.
 */
export const LEGAL_ENTITY = "@pending:company";

/** IANA zone for every scheduling and display path. 12.02. */
export const APP_TZ = "Europe/London";

/** Locale for every `Intl` / `toLocale*` call. 12.03. */
export const APP_LOCALE = "en-GB";

/** The same locale in Open Graph's underscore form. 12.03. */
export const OG_LOCALE = "en_GB";

/**
 * Nanny hourly rate bounds in pounds. BAI 2026-09-25 (Q-1: £15–£30);
 * Q-7 folded in — one bound, four validation sites read it.
 */
export const HOURLY_RATE_BOUNDS = { min: 15, max: 30 } as const;

// VERIFICATION_TIERS was removed along with the deprecated Tier 1-2-3
// system. Use `verification_level` + `verification_status` from
// @/lib/verification instead. See system/verification/** for the
// canonical docs.

export const MATCHING_WEIGHTS = {
  RATE: 0.3,
  EXPERIENCE: 0.25,
  QUALIFICATIONS: 0.2,
  SKILLS: 0.15,
  OTHER: 0.1,
} as const;

export const BSR_NOTIFICATION_LIMIT = 20;

/**
 * The AWS region the Supabase project is hosted in. A hosting region is
 * configuration, never a literal in a body (ADR-171): it is displayed by
 * the super-admin console and the legal stage writes the same value into
 * the policy documents, which today disagree with each other (Q-6). One
 * value, so they cannot. 12.NEW — BB-LDN-2g-250926.
 *
 * Distinct from `BRAND.region`, which is where families live.
 */
export const SUPABASE_REGION = "eu-west-2";
