/**
 * A UK VAT number as it prints: "GB123456789" → "GB 123 4567 89". One formatter for the invoice PDF
 * (`pdf/sections/issuer.tsx` re-exports it) and the Settings Business section. Client-safe: no I/O, no renderer.
 *
 * Moved unchanged from `pdf/sections/issuer.tsx` (BB-wave1-041126/06b2-build, 2026-11-06) by
 * BB-wave1-041126/06b3-build, 2026-11-07.
 */

const VAT_GROUPS = /^GB(\d{3})(\d{4})(\d{2})(\d{3})?$/;

/** "GB123456789" → "GB 123 4567 89"; a 12-digit (branch) number gains its last 3; anything else prints as stored. */
export function formatVatNumber(vatNumber: string): string {
  const m = VAT_GROUPS.exec(vatNumber);
  if (!m) return vatNumber;
  return ["GB", m[1], m[2], m[3], m[4]].filter((part): part is string => Boolean(part)).join(" ");
}
