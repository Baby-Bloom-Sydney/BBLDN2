"use server";

/**
 * replyToContactMessage — S14 admin support reply.
 *
 * Spec: `system/APP/PAYMENTS/FRONTEND/03-build-spec.md` §S14.
 *
 * Admin opens a message, drafts a reply, submits. This action:
 *   1. Verifies the caller is admin/super_admin
 *   2. Loads the message + the sender's email
 *   3. Sends the reply via existing Resend transport
 *   4. Marks the message replied + records reply body/subject/by/at
 *
 * Activity log entry on success for audit trail.
 */

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendEmail } from "@/lib/email/resend";
import { SITE_NAME } from "@/lib/constants";

export type ReplyToContactMessageResult =
  | { success: true; warning?: string }
  | { success: false; error: string };

export async function replyToContactMessage(input: {
  messageId: string;
  subject: string;
  body: string;
}): Promise<ReplyToContactMessageResult> {
  try {
    const subject = (input.subject ?? "").trim();
    const body = (input.body ?? "").trim();
    if (!input.messageId || subject.length === 0 || body.length === 0) {
      return { success: false, error: "missing_fields" };
    }
    if (subject.length > 200) {
      return { success: false, error: "subject_too_long" };
    }
    if (body.length > 8000) {
      return { success: false, error: "body_too_long" };
    }

    const supabase = createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) {
      return { success: false, error: "not_authenticated" };
    }

    const admin = createAdminClient();
    const { data: callerRole } = await admin
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .maybeSingle<{ role: string }>();
    if (!callerRole || !["admin", "super_admin"].includes(callerRole.role)) {
      return { success: false, error: "forbidden" };
    }

    const { data: msg, error: readErr } = await admin
      .from("contact_messages")
      .select("id, sender_email, sender_name, subject, body, user_id, status")
      .eq("id", input.messageId)
      .maybeSingle<{
        id: string;
        sender_email: string;
        sender_name: string | null;
        subject: string;
        body: string;
        user_id: string | null;
        status: string;
      }>();
    if (readErr || !msg) {
      return { success: false, error: "message_not_found" };
    }

    const replyHtml = renderReplyHtml(body);

    const sendResult = await sendEmail({
      to: msg.sender_email,
      subject,
      html: replyHtml,
      emailType: "support_reply",
      recipientUserId: msg.user_id ?? undefined,
    });
    if (!sendResult.success) {
      return { success: false, error: "send_failed" };
    }

    const nowIso = new Date().toISOString();
    const { error: updateErr } = await admin
      .from("contact_messages")
      .update({
        status: "replied",
        reply_subject: subject,
        reply_body: body,
        replied_at: nowIso,
        replied_by: user.id,
      })
      .eq("id", msg.id);

    const { error: logErr } = await admin.from("activity_logs").insert({
      user_id: msg.user_id,
      action_type: "contact_message_replied",
      action_details: {
        message_id: msg.id,
        replied_by: user.id,
        subject_chars: subject.length,
        body_chars: body.length,
        db_update_succeeded: !updateErr,
      },
    });
    if (logErr) {
      // Audit-log misses are non-fatal but worth surfacing so they
      // get picked up in log aggregation. Pattern matches the
      // best-effort logActivity helper in the Stripe webhook handlers.
      console.warn(
        "[replyToContactMessage] activity_logs insert failed",
        logErr.code,
      );
    }

    // Email IS sent at this point — returning `success:false` would
    // invite the admin to retry, which would send a duplicate. Surface
    // the DB miss via the `warning` channel so the UI can render "sent,
    // but the inbox row may stay 'unread' — refresh to confirm" without
    // implying the customer hasn't been replied to.
    if (updateErr) {
      console.error("[replyToContactMessage] db update failed", updateErr);
      return {
        success: true,
        warning: "Reply sent, but the message status couldn't be updated.",
      };
    }

    return { success: true };
  } catch (err) {
    console.error("[replyToContactMessage] unexpected", err);
    return { success: false, error: "unexpected_error" };
  }
}

/** Minimal HTML wrap for the reply body. Keeps it readable + brand-
 *  consistent without pulling in a heavy email-template engine. */
function renderReplyHtml(body: string): string {
  const escaped = body
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #0f172a; max-width: 560px; margin: 0 auto; padding: 24px;">
  <div style="white-space: pre-wrap; font-size: 15px; line-height: 1.6;">${escaped}</div>
  <p style="margin-top: 32px; color: #94a3b8; font-size: 12px;">${SITE_NAME}</p>
</body></html>`;
}
