/**
 * `/admin/invoices` (server) — BAI's read-only list of every invoice nannies have sent (plan 06 step 17, §14.6 c.1;
 * brief §0.11, §0.13, §3 admin; A14). A server component.
 *
 * - **Switch off:** `notFound()` before the admin check or any read (the `/admin/payouts` order).
 * - **Admins only** (`proveAdmin`, after `requireAdmin`): anyone else — a parent, a nanny, nobody — is a 404.
 * - Reads, as the admin: every invoice that went out, newest first, the newest 500 (`listAdminInvoices`, through the
 *   entry point). Read-only: nothing on the page writes.
 * - **The props are the RSC payload** (what the browser receives): the rows' strings, the invoice ids, the family
 *   summaries and opaque filter keys (`admin-invoice-view.ts`) — no email, bank field, path or user id.
 * - A failed read (`InvoiceReadError`, already logged by code): the page with one plain message. Anything else is not
 *   swallowed: it reaches the error page.
 *
 * BB-wave1-041126/06c, 2026-11-23.
 */

import { notFound } from "next/navigation";
import { proveAdmin, type AdminProof } from "@/lib/calls/admin-proof";
import { nannyInvoicesEnabled } from "@/lib/features/flags";
import { InvoiceReadError, listAdminInvoices } from "@/lib/invoices";
import { AdminInvoicesClient } from "./AdminInvoicesClient";
import { toAdminInvoicesView } from "./admin-invoice-view";
import type { AdminInvoicesView } from "./types";

export const dynamic = "force-dynamic";

const NOTHING: AdminInvoicesView = Object.freeze({ rows: [], families: [], nannies: [], atLimit: false });

/** The view, or null when the read failed (the readers throw `InvoiceReadError` for that, never a silent []). */
async function readView(proof: AdminProof): Promise<AdminInvoicesView | null> {
  try {
    return toAdminInvoicesView(await listAdminInvoices(proof));
  } catch (thrown) {
    if (thrown instanceof InvoiceReadError) return null;
    throw thrown;
  }
}

export default async function AdminInvoicesPage() {
  if (!nannyInvoicesEnabled()) notFound();
  const proof = await proveAdmin();
  if (!proof) notFound();
  const view = await readView(proof);
  return <AdminInvoicesClient {...(view ?? NOTHING)} loadFailed={view === null} />;
}
