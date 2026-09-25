import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendEmail } from "@/lib/email/resend";
import { buildTrialExpiryReminderEmail } from "@/lib/email/templates/trial-expiry-reminder";
import { SITE_URL } from "@/lib/constants";

/**
 * Cron — trial-reminders (S17).
 *
 * Daily run. Finds parent_subscriptions in trial whose
 * `trial_ends_at` falls between NOW + 4d and NOW + 5d AND haven't
 * yet had a reminder sent (`trial_reminder_5d_sent_at IS NULL`).
 * Sends the T-5 email + marks the row.
 *
 * Idempotent: same row never gets two emails because the marker is
 * set immediately after a successful send. Cron can run more often
 * than daily without duplicating sends.
 *
 * Spec: `system/APP/PAYMENTS/FRONTEND/03-build-spec.md` §S17.
 *
 * Per Bailey Q11 — in-app trial-countdown banners are rejected;
 * this email is the only urgency surface during trial.
 *
 * Returns: { reminded: number, errors: number }.
 */
export async function GET(request: NextRequest) {
  // Fail-CLOSED: require CRON_SECRET to be set. If it's missing in the
  // environment, the cron endpoint MUST refuse to run rather than
  // silently accept any caller. A misconfigured deploy that drops the
  // env var would otherwise expose the endpoint to the open internet,
  // letting anyone trigger marketing emails to real customers.
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json(
      { error: "cron_secret_not_configured" },
      { status: 503 },
    );
  }
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const now = new Date();
  const minBound = new Date(now.getTime() + 4 * 24 * 60 * 60 * 1000);
  const maxBound = new Date(now.getTime() + 5 * 24 * 60 * 60 * 1000);

  const { data: candidates, error: readErr } = await admin
    .from("parent_subscriptions")
    .select("id, parent_user_id, trial_ends_at")
    .eq("status", "trial")
    .is("trial_reminder_5d_sent_at", null)
    .gte("trial_ends_at", minBound.toISOString())
    .lte("trial_ends_at", maxBound.toISOString())
    .returns<
      Array<{
        id: string;
        parent_user_id: string;
        trial_ends_at: string;
      }>
    >();
  if (readErr) {
    return NextResponse.json(
      { error: "read_failed", details: readErr.message },
      { status: 500 },
    );
  }

  if (!candidates || candidates.length === 0) {
    return NextResponse.json({ reminded: 0, errors: 0 });
  }

  const appUrl =
    SITE_URL;

  let reminded = 0;
  let errors = 0;

  for (const row of candidates) {
    try {
      // Resolve parent name + email + the first connected child.
      const [{ data: profile }, { data: child }] = await Promise.all([
        admin
          .from("user_profiles")
          .select("first_name, email")
          .eq("user_id", row.parent_user_id)
          .maybeSingle<{
            first_name: string | null;
            email: string | null;
          }>(),
        admin
          .from("child_client")
          .select("id, first_name")
          .eq("parent_user_id", row.parent_user_id)
          .limit(1)
          .maybeSingle<{ id: string; first_name: string | null }>(),
      ]);

      if (!profile?.email) {
        // No deliverable address — skip but mark sent so we don't
        // re-evaluate this row daily.
        await admin
          .from("parent_subscriptions")
          .update({ trial_reminder_5d_sent_at: now.toISOString() })
          .eq("id", row.id);
        errors++;
        continue;
      }

      const tmpl = buildTrialExpiryReminderEmail({
        firstName: profile.first_name ?? "there",
        childFirstName: child?.first_name ?? "your child",
        trialEndsAt: row.trial_ends_at,
        appUrl,
        childId: child?.id ?? "",
      });

      const send = await sendEmail({
        to: profile.email,
        subject: tmpl.subject,
        html: tmpl.html,
        emailType: "trial_expiry_reminder_5d",
        recipientUserId: row.parent_user_id,
      });

      if (!send.success) {
        errors++;
        continue;
      }

      await admin
        .from("parent_subscriptions")
        .update({ trial_reminder_5d_sent_at: now.toISOString() })
        .eq("id", row.id);
      reminded++;
    } catch (err) {
      console.error("[cron/trial-reminders] row failed", row.id, err);
      errors++;
    }
  }

  return NextResponse.json({ reminded, errors });
}
