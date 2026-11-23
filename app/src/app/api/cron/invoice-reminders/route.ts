import { NextRequest, NextResponse } from "next/server";
import { nannyInvoicesEnabled } from "@/lib/features/flags";
import { proveInvoiceCron, runInvoiceReminders } from "@/lib/invoices";

/**
 * Cron — invoice-reminders (plan 06 §16, brief §0c; BAI 2026-11-09). Fridays at 15:00 and 16:00 UTC (`vercel.json`);
 * the run acts only when London's wall clock reads Friday 16:xx, so exactly one of the two sends in any season
 * (`src/lib/invoices/reminders.ts`). Each nanny with a running hire gets at most one reminder a week, claimed before
 * it's sent. Crons run on production only, so a walk calls this by hand with the secret, in that hour.
 *
 * The call-reminders route's order (plan §16.4): `NANNY_INVOICES_ENABLED` off → 404 before anything else. Then the
 * cron proof (`Authorization: Bearer $CRON_SECRET`, failing closed when the secret is unset or blank) → 401. Then the
 * run: 200 with its counts, or `not_time`; 500 when a read failed or the run refused, so the cron log shows it.
 * Force-dynamic: with the flag off it answers before reading the request, and Next would otherwise prerender that
 * 404 as a static file at build. BB-wave1-041126/06b5-app, 2026-11-23.
 */
export const dynamic = "force-dynamic";
/** Seconds: room for the sends, one nanny at a time. */
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  if (!nannyInvoicesEnabled()) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const proof = proveInvoiceCron(request.headers.get("authorization"));
  if (!proof) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const run = await runInvoiceReminders(proof);
  if (!run.ok) return NextResponse.json({ ok: false, error: run.error }, { status: 500 });
  const readFailed = "readFailed" in run.value && run.value.readFailed;
  return NextResponse.json({ ok: true, ...run.value }, { status: readFailed ? 500 : 200 });
}
