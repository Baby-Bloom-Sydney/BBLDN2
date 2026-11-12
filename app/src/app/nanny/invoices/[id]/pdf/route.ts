/**
 * `GET /nanny/invoices/[id]/pdf` — her list's "View PDF" (plan 06 old step 14, §9 surface 6, R13, R20; brief §0.6,
 * §9.9). It changes nothing.
 *
 * - The switch first: off → 404 before any auth or read (the repo's `{ error: "Not found" }` shape, R13).
 * - Her nanny session (`proveNanny`): none — a parent, an admin, nobody — is a 404; the invoices are the nanny's side
 *   only (R20).
 * - Her own invoice that went out (sent or cancelled): a 302 to a signed link made now, after the owner check, that
 *   lives 60 seconds (`invoicePdfLink`), never cached. Not hers, not out, not an id: 404 (nothing says it exists). A
 *   read or storage failure: 500, with nothing of the invoice.
 *
 * BB-wave1-041126/06b4, 2026-11-12.
 */

import { NextResponse } from "next/server";
import { nannyInvoicesEnabled } from "@/lib/features/flags";
import { proveNanny } from "@/lib/invoices/nanny-proof";
import { invoicePdfLink } from "@/lib/invoices/store-pdf-link";

export const dynamic = "force-dynamic";

/** Nothing here is ever cached: a 404 or 500 as much as the redirect (security review L3). */
const NO_STORE = { "Cache-Control": "private, no-store" } as const;
const notFound = () => NextResponse.json({ error: "Not found" }, { status: 404, headers: NO_STORE });

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  if (!nannyInvoicesEnabled()) return notFound();
  const proof = await proveNanny();
  if (!proof) return notFound();
  const link = await invoicePdfLink(proof, params.id);
  if (!link.ok) {
    return link.error === "not_found" || link.error === "invalid" ? notFound() : NextResponse.json({ error: "Unavailable" }, { status: 500, headers: NO_STORE });
  }
  const response = NextResponse.redirect(link.value, 302);
  response.headers.set("Cache-Control", NO_STORE["Cache-Control"]);
  return response;
}
