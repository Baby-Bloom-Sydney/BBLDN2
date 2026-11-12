/**
 * The invoice PDF's font (plan R7): names with accents must print — "Łucja Wiśniewska", "Zoë Ó Briain", "Kateřina
 * Dvořák" — and the built-in Helvetica covers WinAnsi only. The app's own Geist (`src/app/fonts/GeistVF.woff`,
 * brand-consistent, Latin Extended included) renders through react-pdf at its default weight, so no font file is
 * added. It is registered once per process under its own family name, so the hire PDFs (Helvetica) are untouched.
 *
 * Read from disk by `readFileSync(path.join(process.cwd(), …))` — a form Next's output file tracing follows — and
 * handed to react-pdf as a data URL, so the renderer itself never resolves a path. 06b's send-path proof (plan R2)
 * covers it in a production build. BB-wave1-041126/06a-build, 2026-11-04.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { Font } from "@react-pdf/renderer";

export const INVOICE_FONT_FAMILY = "InvoiceSans";

let registered = false;

export function registerInvoiceFont(): void {
  if (registered) return;
  const bytes = readFileSync(path.join(process.cwd(), "src/app/fonts/GeistVF.woff"));
  Font.register({ family: INVOICE_FONT_FAMILY, src: `data:font/woff;base64,${bytes.toString("base64")}` });
  registered = true;
}
