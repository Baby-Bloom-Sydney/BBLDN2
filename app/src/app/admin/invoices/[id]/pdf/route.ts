/**
 * `GET /admin/invoices/[id]/pdf` — BAI's "View PDF" on the read-only list (plan 06 step 17, §14.6 c.1; brief §3 admin
 * 2, §9 surface 6). It changes nothing. The nanny's route (`/nanny/invoices/[id]/pdf`, 06b-4) with an admin's check:
 *
 * - The switch first: off → 404 before the admin check or any read (the repo's `{ error: "Not found" }` shape).
 * - An admin session (`proveAdmin`, after `requireAdmin`): anyone else — a parent, a nanny, nobody — is a 404.
 * - Any invoice that went out (sent or cancelled) with its PDF: a 302 to a signed link made now, after the read, that
 *   lives 60 seconds (`adminInvoicePdfLink`, which checks the id is a GUID first). Not an id, none, not out: 404
 *   (nothing says it exists). A read or storage failure, or a link that can't be redirected to: 500, with nothing of
 *   the invoice or its path. Every answer is `private, no-store`.
 *
 * BB-wave1-041126/06c, 2026-11-23.
 */

import { NextResponse } from "next/server";
import { proveAdmin } from "@/lib/calls/admin-proof";
import { nannyInvoicesEnabled } from "@/lib/features/flags";
import { adminInvoicePdfLink } from "@/lib/invoices/store-pdf-link";

export const dynamic = "force-dynamic";

/** Nothing here is ever cached: a 404 or 500 as much as the redirect. */
const NO_STORE = { "Cache-Control": "private, no-store" } as const;
const notFound = () => NextResponse.json({ error: "Not found" }, { status: 404, headers: NO_STORE });
const unavailable = () => NextResponse.json({ error: "Unavailable" }, { status: 500, headers: NO_STORE });

/** The 302 to the signed link; a link that isn't a URL is a 500 like any other failure, logged by its kind only. */
function toSignedLink(link: string): NextResponse {
  try {
    const response = NextResponse.redirect(link, 302);
    response.headers.set("Cache-Control", NO_STORE["Cache-Control"]);
    return response;
  } catch (thrown) {
    console.error("[invoices] adminInvoicePdf.redirect failed", { code: thrown instanceof Error ? thrown.name : "unknown" });
    return unavailable();
  }
}

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  if (!nannyInvoicesEnabled()) return notFound();
  const proof = await proveAdmin();
  if (!proof) return notFound();
  const link = await adminInvoicePdfLink(proof, params.id);
  if (!link.ok) {
    return link.error === "not_found" || link.error === "invalid" ? notFound() : unavailable();
  }
  return toSignedLink(link.value);
}
