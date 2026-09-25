/**
 * Cron — audit-consent-expiry
 *
 * **Schedule:** daily at `5 7 * * *` UTC (5 min after release-payouts)
 *  = 07:05 London (08:05 during BST — Vercel cron is UTC-only).
 *
 * **Job (v1):** scans `consent_records` for the bundled per-child
 *  agreements (`PARENT-APP-CONSENT` + `NANNY-ATTESTATION`) and emits
 *  counters of consents nearing/past expiry. Writes a single
 *  `activity_logs` row per run so the admin dashboard can show
 *  trend lines.
 *
 * **NOT in v1:** email notifications. The renewal modal pops up
 *  real-time on the next dev-page visit; this cron is observability +
 *  a hook for v2 email reminders. Same gate behavior with or without
 *  the cron running.
 *
 * Bailey 2026-05-14 — T-015 Phase 8.
 */

import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

const TWELVE_MONTHS_MS = 365 * 24 * 60 * 60 * 1000;
const NEARING_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000;

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json(
      { error: "cron_secret_not_configured" },
      { status: 503 },
    );
  }
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const admin = createAdminClient();
    const now = Date.now();

    // Read the latest consent_records rows for the two per-child
    // bundled agreements. Per-child rows are append-only; the most
    // recent created_at per (user_id, related_entity_id) is the
    // effective state. We pull a reasonable window (last 18 months)
    // and dedupe in TS to avoid an expensive DISTINCT ON.
    const eighteenMonthsAgoIso = new Date(
      now - 18 * 30 * 24 * 60 * 60 * 1000,
    ).toISOString();

    const { data: rows, error } = await admin
      .from("consent_records")
      .select(
        "user_id, agreement_id, related_entity_id, consent_given, created_at",
      )
      .in("agreement_id", ["PARENT-APP-CONSENT", "NANNY-ATTESTATION"])
      .gte("created_at", eighteenMonthsAgoIso)
      .order("created_at", { ascending: false })
      .limit(5000)
      .returns<
        Array<{
          user_id: string;
          agreement_id: string;
          related_entity_id: string | null;
          consent_given: boolean;
          created_at: string;
        }>
      >();

    if (error) {
      throw new Error(`consent_records read failed: ${error.message}`);
    }

    // Dedupe to most-recent row per (user_id, agreement_id, child).
    const latest = new Map<
      string,
      { consent_given: boolean; created_at: string }
    >();
    for (const r of rows ?? []) {
      const key = `${r.user_id}|${r.agreement_id}|${r.related_entity_id ?? "-"}`;
      if (!latest.has(key)) {
        latest.set(key, {
          consent_given: r.consent_given,
          created_at: r.created_at,
        });
      }
    }

    let active = 0;
    let nearingExpiry = 0;
    let expired = 0;
    let revoked = 0;
    for (const v of latest.values()) {
      if (!v.consent_given) {
        revoked += 1;
        continue;
      }
      const signedAt = new Date(v.created_at).getTime();
      const expiresAt = signedAt + TWELVE_MONTHS_MS;
      const msRemaining = expiresAt - now;
      if (msRemaining <= 0) expired += 1;
      else if (msRemaining <= NEARING_EXPIRY_MS) nearingExpiry += 1;
      else active += 1;
    }

    const summary = {
      considered: latest.size,
      active,
      nearing_expiry: nearingExpiry,
      expired,
      revoked,
    };

    // Admin audit row so the admin dashboard can chart trend.
    await admin.from("activity_logs").insert({
      action_type: "consent_expiry_audit",
      action_details: summary,
    });

    return NextResponse.json({ ok: true, ...summary });
  } catch (err) {
    console.error("[cron:audit-consent-expiry] run failed", err);
    return NextResponse.json(
      {
        error: "audit_failed",
        details: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }
}
