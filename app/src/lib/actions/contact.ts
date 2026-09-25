"use server";

/**
 * Contact-us server action. Sends a transactional email to the
 * Baby Bloom support inbox with the user's message + their
 * profile context (so support can answer without round-tripping
 * for "who are you?"). The user receives no email; success in the
 * UI is the confirmation.
 *
 * Validation:
 *   - subject: 1–120 chars after trim
 *   - message: 10–4000 chars after trim
 *   - reply email: optional override; if absent, falls back to the
 *     authenticated user's profile email
 *
 * Auth: an authenticated session is required. Anonymous contact
 * is intentionally not supported here — that lives at the
 * marketing-site `/contact` route. This action lives behind a
 * logged-in shell so we already know who's writing.
 */

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendEmail } from "@/lib/email/resend";
import { SUPPORT_INBOX } from "@/lib/constants";

const SUBJECT_MAX = 120;
const MESSAGE_MIN = 10;
const MESSAGE_MAX = 4000;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export async function submitContactRequest(input: {
  subject: string;
  message: string;
  replyEmail?: string;
}): Promise<{ success: boolean; error: string | null }> {
  try {
    const supabase = createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) {
      return { success: false, error: "Not authenticated" };
    }

    const subject = (input.subject ?? "").trim();
    const message = (input.message ?? "").trim();
    const replyEmail = (input.replyEmail ?? "").trim();

    if (subject.length === 0) {
      return { success: false, error: "Please add a subject." };
    }
    if (subject.length > SUBJECT_MAX) {
      return {
        success: false,
        error: `Subject must be ${SUBJECT_MAX} characters or fewer.`,
      };
    }
    if (message.length < MESSAGE_MIN) {
      return {
        success: false,
        error: `Please add a bit more detail (at least ${MESSAGE_MIN} characters).`,
      };
    }
    if (message.length > MESSAGE_MAX) {
      return {
        success: false,
        error: `Message must be ${MESSAGE_MAX} characters or fewer.`,
      };
    }
    // Optional override — must be a valid email shape when provided so
    // we don't ship a junk reply-to into Resend (would silently bounce
    // any support reply). Server-side belt-and-braces: the client
    // form should reject this earlier too. Length-cap before regex per
    // RFC 5321 (254 chars) so a multi-KB string doesn't pass the
    // "non-empty" gate and reach Resend as a junk header.
    if (
      replyEmail.length > 0 &&
      (replyEmail.length > 254 || !EMAIL_REGEX.test(replyEmail))
    ) {
      return { success: false, error: "Please add a valid reply email." };
    }

    // Resolve user identity for the support team via admin client
    // so RLS doesn't gate this read against the support audit
    // trail. Reads are bounded — single user_profiles row.
    const admin = createAdminClient();
    const [{ data: profile }, { data: roleRow }] = await Promise.all([
      admin
        .from("user_profiles")
        .select("first_name, last_name, email, mobile_number")
        .eq("user_id", user.id)
        .maybeSingle(),
      admin
        .from("user_roles")
        .select("role")
        .eq("user_id", user.id)
        .maybeSingle(),
    ]);

    const profileEmail = profile?.email ?? user.email ?? "";
    const finalReplyTo = replyEmail.length > 0 ? replyEmail : profileEmail;
    const fullName =
      `${profile?.first_name ?? ""} ${profile?.last_name ?? ""}`.trim() ||
      "Unknown";
    const role = roleRow?.role ?? "unknown";

    const html = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px;">
        <h2 style="color: #0f172a; margin: 0 0 16px;">New contact request</h2>
        <table style="width: 100%; border-collapse: collapse; margin-bottom: 24px;">
          <tr>
            <td style="padding: 6px 0; color: #64748b; font-size: 13px; width: 100px;">From</td>
            <td style="padding: 6px 0; color: #0f172a; font-size: 14px;">${escapeHtml(fullName)}</td>
          </tr>
          <tr>
            <td style="padding: 6px 0; color: #64748b; font-size: 13px;">Role</td>
            <td style="padding: 6px 0; color: #0f172a; font-size: 14px;">${escapeHtml(role)}</td>
          </tr>
          <tr>
            <td style="padding: 6px 0; color: #64748b; font-size: 13px;">Email</td>
            <td style="padding: 6px 0; color: #0f172a; font-size: 14px;"><a href="mailto:${escapeHtml(finalReplyTo)}" style="color: #7c3aed;">${escapeHtml(finalReplyTo)}</a></td>
          </tr>
          ${profile?.mobile_number ? `<tr><td style="padding: 6px 0; color: #64748b; font-size: 13px;">Mobile</td><td style="padding: 6px 0; color: #0f172a; font-size: 14px;">${escapeHtml(profile.mobile_number)}</td></tr>` : ""}
          <tr>
            <td style="padding: 6px 0; color: #64748b; font-size: 13px;">User ID</td>
            <td style="padding: 6px 0; color: #94a3b8; font-size: 12px; font-family: monospace;">${escapeHtml(user.id)}</td>
          </tr>
        </table>
        <h3 style="color: #0f172a; margin: 0 0 8px; font-size: 16px;">${escapeHtml(subject)}</h3>
        <div style="white-space: pre-wrap; color: #0f172a; font-size: 14px; line-height: 1.5; padding: 16px; background: #f8fafc; border-radius: 8px; border: 1px solid #e2e8f0;">${escapeHtml(message)}</div>
      </div>
    `.trim();

    // S14 — persist to contact_messages for the admin support inbox.
    // Best-effort: if the insert fails we still attempt the email
    // send so the user's message reaches Bailey one way or another.
    const { error: insertErr } = await admin.from("contact_messages").insert({
      user_id: user.id,
      sender_email: finalReplyTo,
      sender_name: fullName,
      subject,
      body: message,
      category: classifyContactCategory(subject, message),
      status: "unread",
    });
    if (insertErr) {
      console.error(
        "[submitContactRequest] contact_messages insert failed:",
        insertErr,
      );
    }

    const result = await sendEmail({
      to: SUPPORT_INBOX,
      subject: `[Contact] ${subject}`,
      html,
      text: `From: ${fullName} <${finalReplyTo}>\nRole: ${role}\nUser ID: ${user.id}\n\nSubject: ${subject}\n\n${message}`,
      replyTo: finalReplyTo,
      emailType: "contact_request",
      recipientUserId: undefined,
    });

    if (!result.success) {
      console.error("[submitContactRequest] send failed:", result.error);
      return {
        success: false,
        error: "Couldn't send your message. Please try again in a moment.",
      };
    }

    return { success: true, error: null };
  } catch (err) {
    console.error("submitContactRequest unexpected error:", err);
    return { success: false, error: "Couldn't send your message." };
  }
}

/** Heuristic category classifier for the admin inbox. Subject +
 *  body keyword matching — cheap, no false negatives on the
 *  default "general" bucket. */
function classifyContactCategory(
  subject: string,
  body: string,
): "refund" | "billing" | "technical" | "general" {
  const text = `${subject} ${body}`.toLowerCase();
  if (/\brefund|chargeback|refunded?\b/.test(text)) return "refund";
  if (/\bbilling|invoice|payment|card|charge|subscription\b/.test(text))
    return "billing";
  if (/\bbug|error|crash|broken|not working|doesn't work\b/.test(text))
    return "technical";
  return "general";
}

/**
 * Public (anonymous) variant of the contact form. Powers the
 * marketing-site `/contact` page — no auth required, but the
 * sender must explicitly provide name + email so support has
 * something to reply to.
 *
 * Defence-in-depth: same length validators as the authed
 * variant, plus a basic email-format check on the supplied
 * address. There's no rate-limit here yet; if the form sees
 * spam in production add a simple per-IP throttle in the route
 * handler that wraps this action.
 *
 * Both `submitContactRequest` and `submitPublicContactRequest`
 * use the same `EMAIL_REGEX` — moved up to module scope rather
 * than redeclared next to each user so they stay in sync.
 */
const NAME_MAX = 80;

export async function submitPublicContactRequest(input: {
  name: string;
  email: string;
  subject: string;
  message: string;
}): Promise<{ success: boolean; error: string | null }> {
  try {
    const name = (input.name ?? "").trim();
    const email = (input.email ?? "").trim();
    const subject = (input.subject ?? "").trim();
    const message = (input.message ?? "").trim();

    if (name.length === 0 || name.length > NAME_MAX) {
      return { success: false, error: "Please add your name." };
    }
    if (!EMAIL_REGEX.test(email)) {
      return { success: false, error: "Please add a valid email." };
    }
    if (subject.length === 0) {
      return { success: false, error: "Please add a subject." };
    }
    if (subject.length > SUBJECT_MAX) {
      return {
        success: false,
        error: `Subject must be ${SUBJECT_MAX} characters or fewer.`,
      };
    }
    if (message.length < MESSAGE_MIN) {
      return {
        success: false,
        error: `Please add a bit more detail (at least ${MESSAGE_MIN} characters).`,
      };
    }
    if (message.length > MESSAGE_MAX) {
      return {
        success: false,
        error: `Message must be ${MESSAGE_MAX} characters or fewer.`,
      };
    }

    const html = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px;">
        <h2 style="color: #0f172a; margin: 0 0 16px;">Public contact request</h2>
        <table style="width: 100%; border-collapse: collapse; margin-bottom: 24px;">
          <tr>
            <td style="padding: 6px 0; color: #64748b; font-size: 13px; width: 100px;">From</td>
            <td style="padding: 6px 0; color: #0f172a; font-size: 14px;">${escapeHtml(name)}</td>
          </tr>
          <tr>
            <td style="padding: 6px 0; color: #64748b; font-size: 13px;">Email</td>
            <td style="padding: 6px 0; color: #0f172a; font-size: 14px;"><a href="mailto:${escapeHtml(email)}" style="color: #7c3aed;">${escapeHtml(email)}</a></td>
          </tr>
        </table>
        <h3 style="color: #0f172a; margin: 0 0 8px; font-size: 16px;">${escapeHtml(subject)}</h3>
        <div style="white-space: pre-wrap; color: #0f172a; font-size: 14px; line-height: 1.5; padding: 16px; background: #f8fafc; border-radius: 8px; border: 1px solid #e2e8f0;">${escapeHtml(message)}</div>
      </div>
    `.trim();

    // S14 — persist to contact_messages (anonymous submission;
    // user_id stays null). Same best-effort pattern as authed.
    const adminClient = createAdminClient();
    const { error: insertErr } = await adminClient
      .from("contact_messages")
      .insert({
        user_id: null,
        sender_email: email,
        sender_name: name,
        subject,
        body: message,
        category: classifyContactCategory(subject, message),
        status: "unread",
      });
    if (insertErr) {
      console.error(
        "[submitPublicContactRequest] contact_messages insert failed:",
        insertErr,
      );
    }

    const result = await sendEmail({
      to: SUPPORT_INBOX,
      subject: `[Public Contact] ${subject}`,
      html,
      text: `From: ${name} <${email}>\n\nSubject: ${subject}\n\n${message}`,
      replyTo: email,
      emailType: "contact_request_public",
    });

    if (!result.success) {
      console.error("[submitPublicContactRequest] send failed:", result.error);
      return {
        success: false,
        error: "Couldn't send your message. Please try again in a moment.",
      };
    }
    return { success: true, error: null };
  } catch (err) {
    console.error("submitPublicContactRequest unexpected error:", err);
    return { success: false, error: "Couldn't send your message." };
  }
}
