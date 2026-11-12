/**
 * The invoice PDF's font (plan R7): names with accents must print — "Łucja Wiśniewska", "Zoë Ó Briain", "Kateřina
 * Dvořák" — and the built-in Helvetica covers WinAnsi only. The app's own Geist (`src/app/fonts/GeistVF.woff`,
 * brand-consistent, Latin Extended included) renders through react-pdf at its default weight, so no font file is
 * added. It is registered once per process under its own family name, so the hire PDFs (Helvetica) are untouched.
 *
 * Read from disk by `readFileSync(join(process.cwd(), …))` and handed to react-pdf as a data URL, so the renderer
 * itself never resolves a path. `join` is a named import on purpose: Next's output file tracing follows
 * `join(process.cwd(), "…")` (as the Katie manifest's reader does) but not the default-import `path.join` form, which
 * left the font out of the deployed page (06b-4's b4.5 trace check, `PROOF/B06/b4/check-font-trace.sh`).
 * BB-wave1-041126/06a-build, 2026-11-04; 06b4, 2026-11-12.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Font } from "@react-pdf/renderer";

export const INVOICE_FONT_FAMILY = "InvoiceSans";

let registered = false;

export function registerInvoiceFont(): void {
  if (registered) return;
  const bytes = readFileSync(join(process.cwd(), "src/app/fonts/GeistVF.woff"));
  Font.register({ family: INVOICE_FONT_FAMILY, src: `data:font/woff;base64,${bytes.toString("base64")}` });
  registered = true;
}
