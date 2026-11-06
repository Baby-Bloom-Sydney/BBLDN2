/**
 * The invoice's parties (plan 06 §14.8; brief §0a D): **From** — who she is on this invoice, from the created row's
 * snapshot, by business type — and **Bill to**, the family's name and email only (brief §11 Q10). BabyBloom is never
 * in this block (plan R8: the business names refuse it at every layer). Called as a function, never mounted, so the
 * tests can walk every string.
 *
 * From: her trading name; her name, when it differs; the address; for a limited company the company name,
 * "Company no. …" and "Registered office: …"; for a partnership its name; "VAT no. GB 123 4567 89" when registered.
 *
 * BB-wave1-041126/06b2-build, 2026-11-06.
 */

import { Text, View } from "@react-pdf/renderer";
import type { ReactElement } from "react";
import type { InvoicePdfData, InvoicePdfIssuer } from "../InvoicePdf";
import { keepWhole, styles } from "../theme";

const VAT_GROUPS = /^GB(\d{3})(\d{4})(\d{2})(\d{3})?$/;

/** "GB123456789" → "GB 123 4567 89"; a 12-digit (branch) number gains its last 3; anything else prints as stored. */
export function formatVatNumber(vatNumber: string): string {
  const m = VAT_GROUPS.exec(vatNumber);
  if (!m) return vatNumber;
  return ["GB", m[1], m[2], m[3], m[4]].filter((part): part is string => Boolean(part)).join(" ");
}

const present = (lines: readonly (string | null)[]): string[] => lines.filter((l): l is string => l !== null && l !== "");

/** The From block's lines, in order (14.8). */
export function fromLines(issuer: InvoicePdfIssuer): string[] {
  const company = issuer.businessType === "limited_company"
    ? [issuer.companyName, issuer.companyNumber && `Company no. ${issuer.companyNumber}`, issuer.registeredOffice && `Registered office: ${issuer.registeredOffice}`]
    : [];
  return present([
    issuer.tradingName,
    issuer.name === issuer.tradingName ? null : issuer.name,
    issuer.address,
    ...company,
    issuer.businessType === "partnership" ? issuer.partnershipName : null,
    issuer.vatNumber && `VAT no. ${formatVatNumber(issuer.vatNumber)}`,
  ]);
}

function party(label: string, lines: readonly string[]): ReactElement {
  return (
    <View style={styles.party}>
      <Text style={styles.label}>{label}</Text>
      {lines.map((line, i) => (
        <Text key={i} style={i === 0 ? styles.partyName : styles.partyLine} hyphenationCallback={keepWhole}>{line}</Text>
      ))}
    </View>
  );
}

/** From (her) and Bill to (the family). */
export function parties(data: InvoicePdfData): ReactElement {
  return (
    <View style={styles.parties}>
      {party("From", fromLines(data.issuer))}
      {party("Bill to", [data.billTo.name, data.billTo.email])}
    </View>
  );
}
