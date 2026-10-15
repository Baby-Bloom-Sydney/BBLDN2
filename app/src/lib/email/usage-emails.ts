/**
 * The weekly usage check's one admin email (4e brief step 3; offer §7.4, runbook SOP 16, card 7a). BB-LDN-4e-151026.
 *
 * Contract
 * - Input: the low families (name, email, each linked child's active posts in the window) and the window in days.
 * - Output: ONE email to `ADMIN_EMAIL` (fallback `SENDERS.admin`), `emailType: 'admin_notification'`. Throws on a
 *   send failure so the cron stamps nothing and the next run raises the same families again.
 * - Never: emails a parent or a nanny, writes to the database, or interpolates user text unescaped.
 */
import { sendEmail } from "./resend";
import { SENDERS, SITE_URL } from "@/lib/constants";

export interface UsageLowFamily {
  parentUserId: string;
  name: string;
  email: string | null;
  children: Array<{ childId: string; firstName: string | null; posts: number }>;
}

function esc(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string,
  );
}

function familyItem(f: UsageLowFamily): string {
  const kids = f.children.map((c) => `${esc(c.firstName || "(no name)")}: ${c.posts}`).join(", ");
  const link = `${SITE_URL}/admin/users/${encodeURIComponent(f.parentUserId)}`;
  return `<li>${esc(f.name || "(no name)")} — ${esc(f.email ?? "no email")} — posts per child: ${kids} — <a href="${esc(link)}">open family</a></li>`;
}

function buildHtml(families: readonly UsageLowFamily[], windowDays: number): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1e293b;background:#f8fafc;">
<div style="max-width:600px;margin:0 auto;padding:32px 16px;"><div style="background:#fff;border-radius:16px;border:1px solid #e2e8f0;padding:32px;">
<h1 style="font-size:22px;font-weight:700;margin:0 0 16px;">Low app use this week — call these families</h1>
<p style="font-size:15px;color:#475569;line-height:1.6;margin:0 0 12px;">In the last ${windowDays} days at least one child in each family below had fewer posts than the weekly threshold. Call the family or the nanny and note it. The system has told no one.</p>
<ol style="font-size:14px;color:#334155;line-height:1.5;padding-left:20px;margin:0 0 12px;">${families.map(familyItem).join("")}</ol>
</div></div></body></html>`;
}

export async function sendUsageLowAdminAlert(
  families: readonly UsageLowFamily[],
  windowDays: number,
): Promise<void> {
  const count = families.length === 1 ? "1 family" : `${families.length} families`;
  const result = await sendEmail({
    to: process.env.ADMIN_EMAIL || SENDERS.admin,
    subject: `Low app use this week: ${count} to call`,
    html: buildHtml(families, windowDays),
    emailType: "admin_notification",
  });
  if (!result.success) throw new Error(`usage-low admin email not sent: ${result.error ?? "unknown"}`);
}
