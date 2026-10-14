/**
 * The one DBS sender module (unit 3c creates it; README "DBS emails").
 *
 * 3c: VER-004-DBS (manual review submitted), VER-010 (barred, to her) and VER-011 (barred, to admin) — moved out of
 * the deleted regulator webhook with the same email types and recipients. Later units add their senders to this file:
 * 3d `sendDbsRejectedEmail`, 3g `sendDbsRecheckFailedEmail`, 3i `sendDbsRecheckAdminAlert`.
 *
 * Copy (3g, BB-LDN-3g-141026): every NANNY email's subject and body come from the builders in
 * `lib/email/templates/dbs-nanny-emails.ts` (copy deck §6.4–§6.6, README P-3/P-4). The admin-facing VER-011 (and 3i's
 * admin re-check alert) keep their plain bodies here — admin copy is not 3g's.
 *
 * Barred (3d, README P-14 — BAI 2026-10-14): VER-010 and VER-011 are separate senders so a bar alerts admin exactly once
 * whatever path barred her. `sendBarredNannyEmail` (VER-010, to her) — caller: the admin Bar action (`adminBarDbs`).
 * `sendBarredAdminAlert` (VER-011, to admin) — caller: the sync's barred branch (`onNannyBarred`,
 * lib/connections/silent-hold.ts), once per bar; it lists every family whose connection was dropped (parent name, email,
 * phone, position, stage) so the team contacts them personally, or says no families were affected. Parents themselves
 * get nothing (P-9). `sendDbsRejectedEmail` — 3d (README P-4): the admin's Reject tells her the reason and how to get
 * approved. `sendDbsRecheckFailedEmail` — 3g writes it, **3i calls it** after a daily re-check fails (00-RULINGS #12,
 * README P-3): `NEW_INFO` → the 23 email, `NO_MATCH` → the 26 email. `sendDbsRecheckAdminAlert` — 3i (00-RULINGS #35,
 * brief change 6): one admin email per failed re-check (daily cron, or the admin's P-8 run on a level-4 nanny) with the
 * result, the time and the link to list C; plain admin body, connection COUNTS only (P-9: families are not contacted
 * by the system, and a re-check fail keeps her hired families — P-3 — so no family list, unlike VER-011).
 * `sendDbsRecheckPausedAlert` — 3i, README P-15: ONE admin email when a run's failure share trips the safety cut-off
 * and none of the failures were applied ("re-check paused: N of M failed — check the DBS service"); counts only.
 *
 * Contract
 * - Input: a user id (+ the affected families for VER-011); her name and address come from `getUserEmailInfo`.
 * - Output: Resend sends. Her emails: nothing when she has no profile. VER-011 is sent even then (the families matter).
 * - Never: writes to the database, decides who may be barred, or interpolates user text unescaped (`esc` here; the
 *   builders escape their own) — family fields are user data and are escaped one by one. `placeholder()` (VER-011
 *   only) takes trusted strings only.
 */
import { sendEmail } from "./resend";
import { getUserEmailInfo } from "./helpers";
import { emailFooter } from "./brand";
import { SENDERS, SITE_URL } from "@/lib/constants";
import {
  buildDbsManualReviewEmail,
  buildDbsBarredEmail,
  buildDbsRejectedEmail,
  buildDbsRecheckNewInfoEmail,
  buildDbsRecheckNoMatchEmail,
} from "./templates/dbs-nanny-emails";
import { CONNECTION_STAGE_LABELS, type ConnectionStage } from "@/lib/position/constants";
import type { AffectedFamily } from "@/lib/connections/silent-hold";

/** HTML-escapes user-supplied text (names, address). */
function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);
}

/** One-paragraph placeholder layout. Heading/paragraph/cta are TRUSTED strings — escape user text before passing it. */
function placeholder(heading: string, paragraph: string, cta?: { label: string; href: string }, extraHtml = ""): string {
  const button = cta
    ? `<div style="text-align:center;margin-top:24px;"><a href="${cta.href}" style="display:inline-block;background:#8b5cf6;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;font-size:15px;">${cta.label}</a></div>`
    : "";
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1e293b;background:#f8fafc;">
<div style="max-width:600px;margin:0 auto;padding:32px 16px;">
  <div style="background:#fff;border-radius:16px;border:1px solid #e2e8f0;padding:32px;">
    <h1 style="font-size:22px;font-weight:700;margin:0 0 16px;">${heading}</h1>
    <p style="font-size:15px;color:#475569;line-height:1.6;margin:0 0 12px;">${paragraph}</p>
    ${extraHtml}
    ${button}
    ${emailFooter()}
  </div>
</div>
</body></html>`;
}

/** VER-004-DBS — she asked for a manual review of her certificate (deck §6.4; turnaround string kept as it is, #18). */
export async function sendDbsManualReviewEmail(userId: string): Promise<void> {
  const info = await getUserEmailInfo(userId);
  if (!info) return;
  await sendEmail({
    to: info.email,
    ...buildDbsManualReviewEmail({ firstName: info.firstName, appUrl: SITE_URL }),
    emailType: "verification_pending",
    recipientUserId: userId,
  });
}

/** VER-010 to her (replies go to hello@). Caller: 3d's Bar. Deck §6.5 copy; `[LEGAL]` wording pending. */
export async function sendBarredNannyEmail(userId: string): Promise<void> {
  const info = await getUserEmailInfo(userId);
  if (!info) return;
  await sendEmail({
    to: info.email,
    ...buildDbsBarredEmail({ firstName: info.firstName, appUrl: SITE_URL }),
    emailType: "verification_rejected",
    recipientUserId: userId,
    replyTo: SENDERS.hello,
  });
}

/** "Active (40)" — the stage label + the code, so the team knows how far the connection had gone. */
function stageText(stage: number): string {
  const label = CONNECTION_STAGE_LABELS[stage as ConnectionStage] ?? "Stage";
  return `${label} (${stage})`;
}

/** One escaped list item per family. */
function familyItem(f: AffectedFamily): string {
  const position = f.positionTitle || f.positionId
    ? `${esc(f.positionTitle ?? "Untitled position")}${f.positionId ? ` (${esc(f.positionId)})` : ""}`
    : "no position";
  return `<li style="margin:0 0 10px;"><strong>${esc(f.parentName)}</strong> — ${esc(f.email ?? "no email")} · ` +
    `${esc(f.phone ?? "no phone")}<br>Position: ${position} · Stage: ${esc(stageText(f.stage))}</li>`;
}

/** The "could NOT be dropped" block (empty when every row moved). */
function notDroppedHtml(notDropped: AffectedFamily[]): string {
  if (notDropped.length === 0) return "";
  return `<p style="font-size:15px;color:#b91c1c;margin:0 0 8px;"><strong>${notDropped.length} connection(s) could NOT be dropped</strong> — check them in the database and close them by hand:</p>` +
    `<ol style="font-size:14px;color:#334155;line-height:1.5;padding-left:20px;margin:0 0 12px;">${notDropped.map(familyItem).join("")}</ol>`;
}

/** The family block of VER-011 (all user text escaped). */
function familiesHtml(families: AffectedFamily[], removedUnseen: number, notDropped: AffectedFamily[]): string {
  const unseen = removedUnseen > 0
    ? `<p style="font-size:13px;color:#64748b;margin:0 0 12px;">Also removed: ${removedUnseen} held request(s) the families never saw — no one to contact.</p>`
    : "";
  if (families.length === 0) {
    const none = notDropped.length === 0
      ? `<p style="font-size:15px;color:#475569;margin:0 0 12px;">No families were affected — she had no live connections.</p>`
      : "";
    return `${notDroppedHtml(notDropped)}${none}${unseen}`;
  }
  return `<p style="font-size:15px;color:#475569;margin:0 0 8px;">Families to contact personally (the system has told them nothing; their connection now shows as expired):</p>` +
    `<ol style="font-size:14px;color:#334155;line-height:1.5;padding-left:20px;margin:0 0 12px;">${families.map(familyItem).join("")}</ol>` +
    `${notDroppedHtml(notDropped)}${unseen}`;
}

/**
 * VER-011 to the admin inbox (P-14) — one per bar, from the sync's barred branch. Lists each family whose connection
 * was dropped so the team can contact them. Throws on a send failure so the caller can log it.
 */
export async function sendBarredAdminAlert(
  userId: string,
  families: AffectedFamily[],
  removedUnseen: number,
  notDropped: AffectedFamily[] = [],
): Promise<void> {
  const info = await getUserEmailInfo(userId);
  const who = (info ? `${info.firstName} ${info.lastName}`.trim() : `user ${userId}`).replace(/[\r\n]+/g, " ").slice(0, 120);
  const whoHtml = info ? `${esc(who)} (${esc(info.email)})` : `user ${esc(userId)}`;
  const count = families.length === 1 ? "1 family" : `${families.length} families`;
  const result = await sendEmail({
    to: process.env.ADMIN_EMAIL || SENDERS.admin,
    subject: `BARRED nanny account suspended: ${who} — ${count} to contact`,
    html: placeholder(
      "Barred account — suspended",
      `Nanny ${whoHtml} has been barred after a DBS review; her account is suspended, her profile is hidden from families and every connection she had has been dropped.`,
      { label: "View in Admin", href: `${SITE_URL}/admin/users` },
      familiesHtml(families, removedUnseen, notDropped),
    ),
    emailType: "admin_notification",
  });
  if (!result.success) throw new Error(`barred admin alert not sent: ${result.error ?? "unknown"}`);
}

/**
 * P-4 — the admin rejected her certificate (status 22). From the default sender with replies to hello@,
 * `emailType: 'verification_rejected'`. Caller: the admin Reject action (lib/actions/admin.ts), once, after its write succeeded.
 * Copy from `buildDbsRejectedEmail` (the reason + upload page 1 again; no manual review — 22 is Edit & Resubmit only).
 * `reason` is admin-typed text — the builder escapes it. Throws on a send failure so the caller can report it.
 */
export async function sendDbsRejectedEmail(userId: string, reason: string): Promise<void> {
  const info = await getUserEmailInfo(userId);
  if (!info) return;
  const result = await sendEmail({
    to: info.email,
    ...buildDbsRejectedEmail({ firstName: info.firstName, appUrl: SITE_URL, reason }),
    emailType: "verification_rejected",
    recipientUserId: userId,
    replyTo: SENDERS.hello,
  });
  if (!result.success) throw new Error(`reject email not sent: ${result.error ?? "unknown"}`);
}

/** The two Update Service results a daily re-check can fail with (00-RULINGS #12). */
export type DbsRecheckFailure = "NEW_INFO" | "NO_MATCH";

const RECHECK_BUILDERS = {
  NEW_INFO: buildDbsRecheckNewInfoEmail,
  NO_MATCH: buildDbsRecheckNoMatchEmail,
} as const;

/**
 * Re-check failed — her email (00-RULINGS #12, README P-3). **Caller: 3i's daily re-check** (and any path P-8 treats as
 * a failed re-check), once, after its guarded write succeeded and her other connections were dropped.
 * `NEW_INFO` → "you'll need a new DBS certificate" (23); `NO_MATCH` → "we couldn't confirm your DBS certificate" (26).
 * From the default sender with replies to hello@ (the close invites a reply), `emailType: 'verification_rejected'`.
 * Sends nothing when she has no profile. Throws on an unknown `result` (nothing sent) and on a send failure, so the
 * caller can log it; it never writes anything.
 */
export async function sendDbsRecheckFailedEmail(userId: string, result: DbsRecheckFailure): Promise<void> {
  const build = Object.hasOwn(RECHECK_BUILDERS, result) ? RECHECK_BUILDERS[result] : undefined;
  if (!build) throw new Error(`re-check email: unknown result ${String(result)}`);
  const info = await getUserEmailInfo(userId);
  if (!info) return;
  const sent = await sendEmail({
    to: info.email,
    ...build({ firstName: info.firstName, appUrl: SITE_URL }),
    emailType: "verification_rejected",
    recipientUserId: userId,
    replyTo: SENDERS.hello,
  });
  if (!sent.success) throw new Error(`re-check email not sent: ${sent.error ?? "unknown"}`);
}

/** Admin wording per failed result (3i, change 6). */
const RECHECK_ADMIN_LABEL: Record<DbsRecheckFailure, string> = {
  NEW_INFO: "New information",
  NO_MATCH: "No Update Service match",
};

/** What the re-check did to her connections (counts only) and when it ran. */
export interface DbsRecheckAlertDetails {
  checkedAt: string;
  kept: number;
  dropped: number;
  notDropped: number;
}

/**
 * The admin alert for a failed re-check (00-RULINGS #35, as the VER-011 admin alert does): to `ADMIN_EMAIL` (fallback
 * `SENDERS.admin`), `emailType: 'admin_notification'`, one per failed nanny. Her row also appears in list C on the DBS
 * tab by itself (3d's query) — no queue item. Throws on an unknown result (nothing sent) or a failed send, so the
 * caller can log it. Her name is escaped in the body and stripped of line breaks in the subject.
 */
export async function sendDbsRecheckAdminAlert(
  userId: string,
  result: DbsRecheckFailure,
  details: DbsRecheckAlertDetails,
): Promise<void> {
  const label = Object.hasOwn(RECHECK_ADMIN_LABEL, result) ? RECHECK_ADMIN_LABEL[result] : undefined;
  if (!label) throw new Error(`re-check admin alert: unknown result ${String(result)}`);
  const info = await getUserEmailInfo(userId);
  const who = (info ? `${info.firstName} ${info.lastName}`.trim() : `user ${userId}`).replace(/[\r\n]+/g, " ").slice(0, 120);
  const whoHtml = info ? `${esc(who)} (${esc(info.email)})` : `user ${esc(userId)}`;
  const notClosed = details.notDropped > 0
    ? `<p style="font-size:15px;color:#b91c1c;margin:0 0 12px;"><strong>${details.notDropped} connection(s) could NOT be closed</strong> — check them in the database and close them by hand.</p>`
    : "";
  const counts =
    `<p style="font-size:15px;color:#475569;line-height:1.6;margin:0 0 12px;">Hired placements kept: ${details.kept} · ` +
    `Other connections closed: ${details.dropped} (families were told nothing; they see the request as expired).</p>` +
    notClosed +
    `<p style="font-size:13px;color:#64748b;margin:0 0 12px;">She is in Admin ▸ Users ▸ Verification ▸ DBS ▸ list C (re-check alerts).</p>`;
  const sent = await sendEmail({
    to: process.env.ADMIN_EMAIL || SENDERS.admin,
    subject: `DBS re-check failed: ${who} — ${label}`,
    html: placeholder(
      "DBS re-check failed",
      `The DBS Update Service check for nanny ${whoHtml} returned <strong>${label}</strong> (checked ${esc(details.checkedAt)}). ` +
        "She is now at level 2: out of matching, unable to accept, no Verified badge. She has been emailed what to do.",
      { label: "View in Admin", href: `${SITE_URL}/admin/users` },
      counts,
    ),
    emailType: "admin_notification",
  });
  if (!sent.success) throw new Error(`re-check admin alert not sent: ${sent.error ?? "unknown"}`);
}

/** What a paused run saw (README P-15). Counts only. */
export interface DbsRecheckPausedDetails {
  failed: number;
  answered: number;
  newInfo: number;
  noMatch: number;
  thresholdRatio: number;
  minFailures: number;
}

/**
 * README P-15 — the daily re-check paused itself: the share of NEW_INFO / NO_MATCH among the answered checks was above
 * the cut-off, so NONE of those failures was applied. One admin email per paused run, counts only (no names). Throws on
 * a failed send so the caller can log it. Every value is a number the run computed — nothing user-typed.
 */
export async function sendDbsRecheckPausedAlert(d: DbsRecheckPausedDetails): Promise<void> {
  const pct = `${Math.round(d.thresholdRatio * 100)}%`;
  const sent = await sendEmail({
    to: process.env.ADMIN_EMAIL || SENDERS.admin,
    subject: `DBS re-check paused: ${d.failed} of ${d.answered} failed — check the DBS service`,
    html: placeholder(
      "DBS re-check paused",
      `Today's DBS Update Service re-check got <strong>${d.failed} of ${d.answered}</strong> answers back as failures — ` +
        `above the ${pct} safety cut-off (at least ${d.minFailures} failures). That usually means a problem with the DBS ` +
        "service or our checker set-up, not with the nannies, so <strong>none of these failures was applied</strong>: " +
        "nobody's level, connections or emails changed. They are checked again tomorrow.",
      { label: "View in Admin", href: `${SITE_URL}/admin/users` },
      `<p style="font-size:15px;color:#475569;line-height:1.6;margin:0 0 12px;">New information: ${d.newInfo} · ` +
        `No Update Service match: ${d.noMatch}</p>` +
        `<p style="font-size:13px;color:#64748b;margin:0 0 12px;">Check the DBS service status and the checker details. ` +
        `To act on one nanny now, open her in Admin ▸ Users and use "Run DBS check now".</p>`,
    ),
    emailType: "admin_notification",
  });
  if (!sent.success) throw new Error(`re-check paused alert not sent: ${sent.error ?? "unknown"}`);
}
