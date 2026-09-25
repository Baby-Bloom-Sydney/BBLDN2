/**
 * The one brand header and the one brand footer every outbound email uses.
 *
 * Before LDN2 Stage 2 the same `<h1>` was copied into 38 places — byte for
 * byte, style attribute included — and the same footer into 17, with the
 * product name, the origin and both legal links written out as literals in
 * every one of them. This pair is the single extraction unit 2f is permitted
 * (`DECISIONS.md` P-9): it *removes* 55 duplicates rather than adding shape,
 * and every value it emits comes from `@/lib/constants`.
 *
 * Nothing here does I/O. Both functions are pure `string`s so a caller can
 * interpolate them straight into the template literal it already has.
 *
 * BB-LDN-2f-250926 — 12.07, ADR-033, ADR-171, P-9.
 */
import { SITE_NAME, SITE_URL } from "@/lib/constants";

/** The `<h1>` lockup at the top of every transactional email. */
export function emailHeader(): string {
  return `<h1 style="color: #8B5CF6; font-size: 24px; margin-bottom: 16px;">${SITE_NAME}</h1>`;
}

export interface EmailFooterOptions {
  /**
   * Which terms page the recipient signed. `"professional"` for nannies
   * (the default — 11 of the 17 collapsed sites), `"client"` for parents.
   */
  terms?: "professional" | "client";
  /** The link text. The collapsed copies said either "Terms" or "Terms of Service". */
  termsLabel?: string;
  /** Two of the collapsed sites centred the block. */
  align?: "left" | "center";
  /** An extra line between the attribution and the links ("why you got this"). */
  notice?: string;
  /** When set, appends the email-preferences sentence pointing at this path. */
  preferencesPath?: string;
  /**
   * Link colour. The parent-verification emails are themed pink end to end;
   * every other collapsed site used the violet default.
   */
  linkColor?: string;
}

/**
 * The attribution + legal-link block that closes every transactional email.
 *
 * The wrapper's `padding-top` was `20px` at 11 of the collapsed sites and
 * `24px` at 6; one value is emitted here. That 4px was drift, not design.
 */
export function emailFooter(options: EmailFooterOptions = {}): string {
  const {
    terms = "professional",
    termsLabel = "Terms",
    align = "left",
    notice,
    preferencesPath,
    linkColor = "#7c3aed",
  } = options;

  const alignment = align === "center" ? "text-align:center;" : "";
  const noticeLine = notice ? `\n        ${notice}<br/>` : "";
  const preferencesLine = preferencesPath
    ? `<br/>\n        To unsubscribe from non-essential emails, update your <a href="${SITE_URL}${preferencesPath}" style="color:${linkColor};">email preferences</a>.`
    : "";

  return `<div style="margin-top:32px;padding-top:24px;border-top:1px solid #e2e8f0;">
      <p style="font-size:12px;color:#94a3b8;line-height:1.6;${alignment}margin:0;">
        ${SITE_NAME}<br/>${noticeLine}
        <a href="${SITE_URL}/legal/privacy-policy" style="color:${linkColor};">Privacy Policy</a> |
        <a href="${SITE_URL}/legal/${terms}-terms" style="color:${linkColor};">${termsLabel}</a>${preferencesLine}
      </p>
    </div>`;
}
