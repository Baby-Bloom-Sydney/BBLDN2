/**
 * The invoice's parties (plan 06 §14.8; brief §0a D), three columns formatted alike (BAI 2026-11-07): **From** — her
 * name and one address; **Business** — her business, from the created row's snapshot; **Bill to** — the family's name
 * and email only (brief §11 Q10). BabyBloom is never in this block (plan R8: the business names refuse it at every
 * layer). Called as a function, never mounted, so the tests can walk every string.
 *
 * From: her name; a limited company's registered office, otherwise the business address ("it doesnt need to have
 * both"). Business, three lines at most: one name — her trading name when she has entered one ("The trade name …
 * replaces the business name"), otherwise a company's or partnership's name; "Company no. …"; "VAT no. GB 123 4567 89"
 * when registered. Kept as an empty column when there is nothing to show, so Bill to never moves. Bill to is the
 * widest: an email up to 36 characters stays on one line.
 *
 * BB-wave1-041126/06b2-build, 2026-11-06; BB-wave1-041126 (BAI's three-column layout), 2026-11-07.
 */

import { Text, View } from "@react-pdf/renderer";
import type { ComponentProps, ReactElement } from "react";
import { formatVatNumber } from "../../vat-number";
import type { InvoicePdfData, InvoicePdfIssuer } from "../InvoicePdf";
import { keepWhole, styles, wholeUnlessLong } from "../theme";

/** "GB 123 4567 89": one formatter for the PDF and Settings (moved unchanged to `vat-number.ts` by 06b-3). */
export { formatVatNumber };

/** The longest email Bill to prints on one line; a longer one breaks before its "@" (textkit hyphenates any other break). */
const EMAIL_ONE_LINE = 36;

const present = (lines: readonly (string | null)[]): string[] => lines.filter((l): l is string => l !== null && l !== "");

/** The From column: her name, then one address — a limited company's registered office replaces the business address. */
export function fromLines(issuer: InvoicePdfIssuer): string[] {
  const office = issuer.businessType === "limited_company" ? issuer.registeredOffice : null;
  return present([issuer.name, office || issuer.address]);
}

/** The business's one name: her trading name when she has entered one (it isn't her own name), else its registered name. */
export function businessName(issuer: InvoicePdfIssuer): string | null {
  if (issuer.tradingName && issuer.tradingName !== issuer.name) return issuer.tradingName;
  if (issuer.businessType === "limited_company") return issuer.companyName || null;
  if (issuer.businessType === "partnership") return issuer.partnershipName || null;
  return null;
}

/** The Business column's lines under its name: a limited company's number, then the VAT number. */
export function businessLines(issuer: InvoicePdfIssuer): string[] {
  return present([
    issuer.businessType === "limited_company" && issuer.companyNumber ? `Company no. ${issuer.companyNumber}` : null,
    issuer.vatNumber && `VAT no. ${formatVatNumber(issuer.vatNumber)}`,
  ]);
}

/** An email for Bill to: whole on one line up to 36 characters; a longer one on two, the second starting at its "@". */
export function emailText(email: string): string {
  const at = email.lastIndexOf("@");
  return email.length <= EMAIL_ONE_LINE || at <= 0 ? email : `${email.slice(0, at)}\n${email.slice(at)}`;
}

/** A party's lines: the first is the name; names keep words whole unless too long for the column; an email whole. */
function party(label: string, lines: readonly string[], email: string | null = null, style: ComponentProps<typeof View>["style"] = styles.party): ReactElement {
  return (
    <View style={style}>
      <Text style={styles.label}>{label}</Text>
      {lines.map((line, i) => (
        <Text key={i} style={i === 0 ? styles.partyName : styles.partyLine} hyphenationCallback={wholeUnlessLong}>{line}</Text>
      ))}
      {email === null ? null : <Text style={styles.partyLine} hyphenationCallback={keepWhole}>{emailText(email)}</Text>}
    </View>
  );
}

/** Her business, formatted as the other columns (its name as a party's name); the column stays, empty, when she has none. */
function business(name: string | null, lines: readonly string[]): ReactElement {
  const empty = name === null && lines.length === 0;
  return (
    <View style={styles.party}>
      {empty ? null : <Text style={styles.label}>Business</Text>}
      {name === null ? null : <Text style={styles.partyName} hyphenationCallback={wholeUnlessLong}>{name}</Text>}
      {lines.map((line, i) => (
        <Text key={i} style={styles.partyLine} hyphenationCallback={wholeUnlessLong}>{line}</Text>
      ))}
    </View>
  );
}

/** From (her), Business (hers, when she has any) and Bill to (the family). */
export function parties(data: InvoicePdfData): ReactElement {
  return (
    <View style={styles.parties}>
      {party("From", fromLines(data.issuer))}
      {business(businessName(data.issuer), businessLines(data.issuer))}
      {party("Bill to", [data.billTo.name], data.billTo.email, [styles.party, styles.billTo])}
    </View>
  );
}
