import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendEmail } from "@/lib/email/resend";
import { SENDERS, SITE_URL } from "@/lib/constants";

/**
 * Cron — payment-due-sweep (4c, brief step 6; inventory N2; offer §3 mechanism).
 *
 * Daily. Rows `status='placed'`, `payment_due_at <= now`, `payment_due_raised_at IS NULL`,
 * `bill_paid_at IS NULL` are due their balance (start + BILL_AFTER_START_DAYS, set by `openDfyAccess`).
 * **Raise only** (M-5; cards 5a, 7a): one email to `ADMIN_EMAIL` listing the families, then each row's
 * `payment_due_raised_at` stamped and a `payment.due` activity row. It mints no link, emails no parent and
 * sends no reminder — the admin sends the `balance-after-week-1` link by hand from the subscription dossier.
 *
 * The email goes first: if it fails nothing is stamped and the next run raises the same families again.
 * Auth: `Authorization: Bearer $CRON_SECRET` — fails closed when the secret is unset. BB-LDN-4c-151026.
 */

interface DueRow {
  id: string;
  parent_user_id: string;
  payment_due_at: string;
}

interface ProfileRow {
  user_id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
}

function esc(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string,
  );
}

function familyItem(row: DueRow, p: ProfileRow | undefined): string {
  const name = [p?.first_name, p?.last_name].filter(Boolean).join(" ") || "(no name)";
  const link = `${SITE_URL}/admin/users/${encodeURIComponent(row.parent_user_id)}/subscription`;
  return `<li>${esc(name)} — ${esc(p?.email ?? "no email")} — due ${esc(row.payment_due_at.slice(0, 10))} — <a href="${esc(link)}">open dossier</a></li>`;
}

function buildHtml(rows: DueRow[], profiles: Map<string, ProfileRow>): string {
  const items = rows.map((r) => familyItem(r, profiles.get(r.parent_user_id))).join("");
  return `<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1e293b;background:#f8fafc;">
<div style="max-width:600px;margin:0 auto;padding:32px 16px;"><div style="background:#fff;border-radius:16px;border:1px solid #e2e8f0;padding:32px;">
<h1 style="font-size:22px;font-weight:700;margin:0 0 16px;">Payment due — send the balance link</h1>
<p style="font-size:15px;color:#475569;line-height:1.6;margin:0 0 12px;">These families' nannies started a week ago. Send each the balance link from their subscription page. The system has sent them nothing.</p>
<ol style="font-size:14px;color:#334155;line-height:1.5;padding-left:20px;margin:0 0 12px;">${items}</ol>
</div></div></body></html>`;
}

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || request.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const nowIso = new Date().toISOString();

  const { data, error: readErr } = await admin
    .from("parent_subscriptions")
    .select("id, parent_user_id, payment_due_at")
    .eq("status", "placed")
    .lte("payment_due_at", nowIso)
    .is("payment_due_raised_at", null)
    .is("bill_paid_at", null)
    .returns<DueRow[]>();
  if (readErr) {
    console.error("[cron:payment-due-sweep] read failed", readErr.message);
    return NextResponse.json({ error: "read_failed" }, { status: 500 });
  }
  const rows = data ?? [];
  if (rows.length === 0) return NextResponse.json({ ok: true, raised: 0 });

  const { data: profileRows } = await admin
    .from("user_profiles")
    .select("user_id, first_name, last_name, email")
    .in("user_id", rows.map((r) => r.parent_user_id))
    .returns<ProfileRow[]>();
  const profiles = new Map((profileRows ?? []).map((p) => [p.user_id, p]));

  const count = rows.length === 1 ? "1 family" : `${rows.length} families`;
  const mail = await sendEmail({
    to: process.env.ADMIN_EMAIL || SENDERS.admin,
    subject: `Payment due: ${count} — send the balance link`,
    html: buildHtml(rows, profiles),
    emailType: "admin_notification",
  });
  if (!mail.success) {
    console.error("[cron:payment-due-sweep] admin email failed", mail.error ?? "unknown");
    return NextResponse.json({ error: "email_failed" }, { status: 500 });
  }

  let raised = 0;
  for (const row of rows) {
    const { error: upErr } = await admin
      .from("parent_subscriptions")
      .update({ payment_due_raised_at: nowIso })
      .eq("id", row.id)
      .is("payment_due_raised_at", null);
    if (upErr) {
      console.error("[cron:payment-due-sweep] stamp failed for", row.id, upErr.message);
      continue;
    }
    const { error: logErr } = await admin.from("activity_logs").insert({
      user_id: row.parent_user_id,
      action_type: "payment.due",
      action_details: { parent_subscription_id: row.id, payment_due_at: row.payment_due_at, raised_at: nowIso },
    });
    if (logErr) console.error("[cron:payment-due-sweep] payment.due row failed", logErr.message);
    raised++;
  }
  return NextResponse.json({ ok: true, raised });
}
