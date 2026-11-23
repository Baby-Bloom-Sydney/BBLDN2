"use client";

/**
 * "Create invoice" in a family's popup on `/nanny/positions` (plan 06 old step 16, §14.6 b4.6; brief §3 nanny 1:
 * "inside a family's detail popup, under 'Estimated weekly pay' … This pre-selects that family"). It opens the new
 * invoice for that placement (`?placement=`), where the server checks it's hers.
 *
 * Renders nothing while `NANNY_INVOICES_ENABLED` is off (read at render, inlined at build), so the popup is today's.
 * The one import of this feature's page folders from the positions page (`boundary.test.ts`'s second seam).
 *
 * BB-wave1-041126/06b4, 2026-11-12.
 */

import Link from "next/link";
import { FileText } from "lucide-react";
import { nannyInvoicesEnabled } from "@/lib/features/flags";

export function CreateInvoiceLink({ placementId }: { readonly placementId: string }) {
  if (!nannyInvoicesEnabled()) return null;
  return (
    <Link
      href={`/nanny/invoices/new?placement=${encodeURIComponent(placementId)}`}
      className="mt-1 inline-flex w-full items-center justify-center gap-2 rounded-lg border border-violet-200 bg-white px-3 py-2 text-sm font-medium text-violet-700 transition-colors hover:bg-violet-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500"
    >
      <FileText className="h-4 w-4" aria-hidden="true" />
      Create invoice
    </Link>
  );
}
