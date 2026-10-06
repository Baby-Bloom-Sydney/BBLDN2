/**
 * The one DBS sender module (unit 3c creates it; README "DBS emails").
 *
 * 3c: VER-004-DBS (manual review submitted), VER-010 (barred, to her) and VER-011 (barred, to admin) — moved out of
 * the deleted regulator webhook with the same email types and recipients. Bodies are PLACEHOLDERS (one plain
 * paragraph); 3g writes the final copy as builders in `lib/email/templates/dbs-nanny-emails.ts` and rewires the nanny
 * senders here. Later units add their senders to this file: 3d `sendDbsRejectedEmail`, 3i `sendDbsRecheckAdminAlert`.
 *
 * `sendBarredEmails` — caller: 3d's Bar (`adminBarDbs`). `sendDbsRejectedEmail` — 3d (README P-4): the admin's Reject
 * tells her the reason and how to get approved; there was no such email before. Placeholder body; 3g writes the copy.
 *
 * Contract
 * - Input: a user id; name and address come from `getUserEmailInfo`. Output: Resend sends; nothing when no profile.
 * - Never: writes to the database, decides who may be barred (the caller must be an admin action), or interpolates
 *   user text unescaped (`esc`). `placeholder()` takes trusted constant strings only.
 */
import { sendEmail } from "./resend";
import { getUserEmailInfo } from "./helpers";
import { emailFooter } from "./brand";
import { SENDERS, SITE_URL } from "@/lib/constants";

/** HTML-escapes user-supplied text (names, address). */
function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);
}

/** One-paragraph placeholder layout. Heading/paragraph/cta are TRUSTED strings — escape user text before passing it. */
function placeholder(heading: string, paragraph: string, cta?: { label: string; href: string }): string {
  const button = cta
    ? `<div style="text-align:center;margin-top:24px;"><a href="${cta.href}" style="display:inline-block;background:#8b5cf6;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;font-size:15px;">${cta.label}</a></div>`
    : "";
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1e293b;background:#f8fafc;">
<div style="max-width:600px;margin:0 auto;padding:32px 16px;">
  <div style="background:#fff;border-radius:16px;border:1px solid #e2e8f0;padding:32px;">
    <h1 style="font-size:22px;font-weight:700;margin:0 0 16px;">${heading}</h1>
    <p style="font-size:15px;color:#475569;line-height:1.6;margin:0 0 12px;">${paragraph}</p>
    ${button}
    ${emailFooter()}
  </div>
</div>
</body></html>`;
}

/** VER-004-DBS — she asked for a manual review of her certificate. Turnaround string kept as it is today (#18). */
export async function sendDbsManualReviewEmail(userId: string): Promise<void> {
  const info = await getUserEmailInfo(userId);
  if (!info) return;
  await sendEmail({
    to: info.email,
    subject: "We're reviewing your DBS certificate",
    html: placeholder(
      "We've received your certificate",
      `Hi ${esc(info.firstName)}, your DBS certificate has been sent to our team for a manual review. We'll get back to you within 24–48 hours.`,
      { label: "View Status", href: `${SITE_URL}/nanny/verification` },
    ),
    emailType: "verification_pending",
    recipientUserId: userId,
  });
}

/** VER-010 to her (replies go to hello@) + VER-011 to the admin inbox. Caller: 3d's Bar. `[LEGAL]` wording pending. */
export async function sendBarredEmails(userId: string): Promise<void> {
  const info = await getUserEmailInfo(userId);
  if (!info) return;
  const name = `${esc(info.firstName)} ${esc(info.lastName)}`.trim();

  await sendEmail({
    to: info.email,
    subject: "Important: Your Baby Bloom account has been restricted",
    html: placeholder(
      "Your account has been restricted",
      `Hi ${esc(info.firstName)}, following a review of your DBS certificate, we've suspended your account and your profile is no longer visible to families. If you have questions, reply to this email and our team will get back to you.`,
    ),
    emailType: "verification_rejected",
    recipientUserId: userId,
    replyTo: SENDERS.hello,
  });

  await sendEmail({
    to: process.env.ADMIN_EMAIL || SENDERS.admin,
    subject: `BARRED nanny account suspended: ${info.firstName} ${info.lastName}`.trim(),
    html: placeholder(
      "Barred account — suspended",
      `Nanny ${name} (${esc(info.email)}) has been barred after a DBS review; her account is suspended and her profile is hidden from families.`,
      { label: "View in Admin", href: `${SITE_URL}/admin/users` },
    ),
    emailType: "admin_notification",
  });
}

/**
 * P-4 — the admin rejected her certificate (status 22). From the default sender with replies to hello@,
 * `emailType: 'verification_rejected'`. Caller: the admin Reject action (lib/actions/admin.ts), once, after its write succeeded.
 * PLACEHOLDER body (one paragraph: the reason + the two next steps); 3g replaces it with its builder (W4).
 * `reason` is admin-typed text — escaped here. Throws on a send failure so the caller can report it.
 */
export async function sendDbsRejectedEmail(userId: string, reason: string): Promise<void> {
  const info = await getUserEmailInfo(userId);
  if (!info) return;
  const result = await sendEmail({
    to: info.email,
    subject: "Your DBS certificate needs another look",
    html: placeholder(
      "Your DBS certificate needs another look",
      `Hi ${esc(info.firstName)}, we reviewed your DBS certificate and couldn't approve it yet. The reason: ${esc(reason)}. ` +
        "To be approved, upload page 1 of your certificate again (Edit & Resubmit), or ask us for a manual review.",
      { label: "Go to verification", href: `${SITE_URL}/nanny/verification` },
    ),
    emailType: "verification_rejected",
    recipientUserId: userId,
    replyTo: SENDERS.hello,
  });
  if (!result.success) throw new Error(`reject email not sent: ${result.error ?? "unknown"}`);
}
