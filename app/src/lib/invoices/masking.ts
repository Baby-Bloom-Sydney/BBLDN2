/**
 * Her bank details as screens may show them (brief §0.2: "sort code ••-••-56, account ending 4321") and as only the
 * PDF prints them. The masks take the database's generated `sort_code_last2` / `account_last4`, so a screen never
 * needs the full numbers; given anything else they print nothing of it.
 *
 * BB-wave1-041126/06a-build, 2026-11-04.
 */

export interface DetailMasks {
  readonly sortCodeLast2: string;
  readonly accountLast4: string;
}

export function maskSortCode(last2: string): string {
  return /^\d{2}$/.test(last2) ? `••-••-${last2}` : "••-••-••";
}

export function maskAccountNumber(last4: string): string {
  return /^\d{4}$/.test(last4) ? `ending ${last4}` : "ending ••••";
}

export function maskedDetailsLine(masks: DetailMasks): string {
  return `sort code ${maskSortCode(masks.sortCodeLast2)}, account ${maskAccountNumber(masks.accountLast4)}`;
}

/** "11-22-33" — the PDF's full sort code (brief D12: the PDF is the one place full details appear). */
export function formatSortCode(sixDigits: string): string {
  if (!/^\d{6}$/.test(sixDigits)) throw new RangeError("not a sort code");
  return `${sixDigits.slice(0, 2)}-${sixDigits.slice(2, 4)}-${sixDigits.slice(4)}`;
}
