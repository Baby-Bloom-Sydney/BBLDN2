/**
 * The invoice's parties (plan 06 §14.8; brief §0a D), three columns (BAI 2026-11-07): **From** — her name and one
 * address; **Business** — her business details, smaller and slate, from the created row's snapshot; **Bill to** — the
 * family's name and email only (brief §11 Q10). BabyBloom is never in this block (plan R8: the business names refuse
 * it at every layer). Called as a function, never mounted, so the tests can walk every string.
 *
 * From: her name; a limited company's registered office, otherwise the business address ("it doesnt need to have
 * both"). Business: the trading name when it differs from her name; a limited company's name and "Company no. …"; a
 * partnership's name; "VAT no. GB 123 4567 89" when registered. Kept as an empty column when there is nothing to show,
 * so Bill to never moves.
 *
 * BB-wave1-041126/06b2-build, 2026-11-06; BB-wave1-041126 (BAI's three-column layout), 2026-11-07.
 */

import { Text, View } from "@react-pdf/renderer";
import type { ReactElement } from "react";
import type { InvoicePdfData, InvoicePdfIssuer } from "../InvoicePdf";
import { keepWhole, styles, wholeUnlessLong } from "../theme";

const VAT_GROUPS = /^GB(\d{3})(\d{4})(\d{2})(\d{3})?$/;

/** "GB123456789" → "GB 123 4567 89"; a 12-digit (branch) number gains its last 3; anything else prints as stored. */
export function formatVatNumber(vatNumber: string): string {
  const m = VAT_GROUPS.exec(vatNumber);
  if (!m) return vatNumber;
  return ["GB", m[1], m[2], m[3], m[4]].filter((part): part is string => Boolean(part)).join(" ");
}

const present = (lines: readonly (string | null)[]): string[] => lines.filter((l): l is string => l !== null && l !== "");

/** The From column: her name, then one address — a limited company's registered office replaces the business address. */
export function fromLines(issuer: InvoicePdfIssuer): string[] {
  const office = issuer.businessType === "limited_company" ? issuer.registeredOffice : null;
  return present([issuer.name, office || issuer.address]);
}

/** The Business column's lines, in order; none for a sole trader trading under her own name without VAT. */
export function businessLines(issuer: InvoicePdfIssuer): string[] {
  const company = issuer.businessType === "limited_company"
    ? [issuer.companyName, issuer.companyNumber && `Company no. ${issuer.companyNumber}`]
    : [];
  return present([
    issuer.tradingName === issuer.name ? null : issuer.tradingName,
    ...company,
    issuer.businessType === "partnership" ? issuer.partnershipName : null,
    issuer.vatNumber && `VAT no. ${formatVatNumber(issuer.vatNumber)}`,
  ]);
}

/** A party's lines: the first is the name; names keep words whole unless too long for the column; an email whole. */
function party(label: string, lines: readonly string[], email: string | null = null, last = false): ReactElement {
  return (
    <View style={last ? [styles.party, styles.billTo] : styles.party}>
      <Text style={styles.label}>{label}</Text>
      {lines.map((line, i) => (
        <Text key={i} style={i === 0 ? styles.partyName : styles.partyLine} hyphenationCallback={wholeUnlessLong}>{line}</Text>
      ))}
      {email === null ? null : <Text style={styles.partyLine} hyphenationCallback={keepWhole}>{email}</Text>}
    </View>
  );
}

/** Her business details, smaller and slate; the column stays (empty) when there are none. */
function business(lines: readonly string[]): ReactElement {
  return (
    <View style={styles.party}>
      {lines.length === 0 ? null : <Text style={styles.label}>Business</Text>}
      {lines.map((line, i) => (
        <Text key={i} style={styles.businessLine} hyphenationCallback={wholeUnlessLong}>{line}</Text>
      ))}
    </View>
  );
}

/** From (her), Business (hers, when she has any) and Bill to (the family). */
export function parties(data: InvoicePdfData): ReactElement {
  return (
    <View style={styles.parties}>
      {party("From", fromLines(data.issuer))}
      {business(businessLines(data.issuer))}
      {party("Bill to", [data.billTo.name], data.billTo.email, true)}
    </View>
  );
}
