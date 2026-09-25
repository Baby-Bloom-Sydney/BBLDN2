"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { APP_LOCALE, APP_TZ } from "@/lib/constants";
import { revalidatePath } from "next/cache";
import { getParentId } from "./parent";
import {
  HOURS_TO_INT,
  AGE_RANGE_TO_MONTHS,
  buildScheduleJson,
} from "./position-utils";
import type { TypeformFormData } from "@/app/parent/request/questions";
import { getNannyId, scheduleConnectionTime } from "./connection";
import { createInboxMessage, logConnectionEvent } from "./connection-helpers";
import { sendEmail } from "@/lib/email/resend";
import { getUserEmailInfo } from "@/lib/email/helpers";
import { sendHireConfirmationEmails } from "@/lib/email/hire-emails";
import { dispatchActionTriggeredInBackground } from "@/lib/chat/proactive/action-triggered";
import {
  CONNECTION_STAGE,
  POSITION_STAGE,
  POSITION_STATUS,
  END_REASON_TO_STATUS,
} from "@/lib/position/constants";
import type { EndReason } from "@/lib/position/constants";
import { funnelLog, funnelError } from "@/lib/position/logger";

// ── Email helpers ──

const appUrl =
  process.env.NEXT_PUBLIC_APP_URL || "https://app-babybloom.vercel.app";
const baseStyle = `font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px;`;
const btnStyle = `background: #8B5CF6; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 600;`;

// ── Helper: resolve names for emails/inbox ──

async function getConnectionParties(
  adminClient: ReturnType<typeof createAdminClient>,
  parentId: string,
  nannyId: string,
): Promise<{
  parentUserId: string | null;
  nannyUserId: string | null;
  parentName: string;
  nannyName: string;
  parentEmail: string | null;
  nannyEmail: string | null;
}> {
  const { data: parent } = await adminClient
    .from("parents")
    .select("user_id")
    .eq("id", parentId)
    .single();

  const { data: nanny } = await adminClient
    .from("nannies")
    .select("user_id")
    .eq("id", nannyId)
    .single();

  const parentInfo = parent ? await getUserEmailInfo(parent.user_id) : null;
  const nannyInfo = nanny ? await getUserEmailInfo(nanny.user_id) : null;

  return {
    parentUserId: parent?.user_id ?? null,
    nannyUserId: nanny?.user_id ?? null,
    parentName: parentInfo
      ? `${parentInfo.firstName} ${parentInfo.lastName}`
      : "the family",
    nannyName: nannyInfo
      ? `${nannyInfo.firstName} ${nannyInfo.lastName}`
      : "your nanny",
    parentEmail: parentInfo?.email ?? null,
    nannyEmail: nannyInfo?.email ?? null,
  };
}

// ════════════════════════════════════════════════════════════
// 1. LAZY TRIGGER: Auto-advance meets that have passed (internal code uses "intro"; user-facing label is "Meet and Greet")
// ════════════════════════════════════════════════════════════

export async function checkPostIntroOutcomes(
  adminClient: ReturnType<typeof createAdminClient>,
  filter: { nanny_id?: string; parent_id?: string },
): Promise<void> {
  const now = new Date().toISOString();
  const skipIntroWait = process.env.NEXT_PUBLIC_SKIP_INTRO_WAIT === "true";

  // Find scheduled intros where confirmed_time has passed (or all if skip toggle is on)
  let query = adminClient
    .from("connection_requests")
    .select("id, parent_id, nanny_id, confirmed_time, connection_stage")
    .eq("connection_stage", CONNECTION_STAGE.INTRO_SCHEDULED)
    .not("confirmed_time", "is", null);

  if (!skipIntroWait) {
    query = query.lt("confirmed_time", now);
  }

  if (filter.nanny_id) query = query.eq("nanny_id", filter.nanny_id);
  if (filter.parent_id) query = query.eq("parent_id", filter.parent_id);

  const { data: stale } = await query;

  for (const req of stale ?? []) {
    // Advance to Intro Complete (keep legacy status as 'confirmed' — connection_stage is the source of truth)
    const { error } = await adminClient
      .from("connection_requests")
      .update({
        connection_stage: CONNECTION_STAGE.INTRO_COMPLETE,
        updated_at: now,
      })
      .eq("id", req.id)
      .eq("connection_stage", CONNECTION_STAGE.INTRO_SCHEDULED); // optimistic lock

    if (error) {
      funnelError(
        "checkPostIntro",
        req.id,
        "Failed to advance to INTRO_COMPLETE",
        error,
      );
      continue;
    }

    funnelLog("checkPostIntro", req.id, "20 → 21 (auto)", {
      confirmedTime: req.confirmed_time,
    });

    // Send POST-001 to nanny: "How did your intro go?"
    const parties = await getConnectionParties(
      adminClient,
      req.parent_id,
      req.nanny_id,
    );

    if (parties.nannyUserId) {
      await createInboxMessage({
        userId: parties.nannyUserId,
        type: "post_intro_followup",
        title: `How did your meet and greet with ${parties.parentName} go?`,
        body: "Let us know how it went so we can help with next steps.",
        actionUrl: "/nanny/positions",
        referenceId: req.id,
        referenceType: "connection_request",
      });

      if (parties.nannyEmail) {
        sendEmail({
          to: parties.nannyEmail,
          subject: `How did your meet and greet with ${parties.parentName} go?`,
          html: `<div style="${baseStyle}">
            <h1 style="color: #8B5CF6; font-size: 24px; margin-bottom: 16px;">Baby Bloom Sydney</h1>
            <p style="color: #374151; font-size: 16px; line-height: 1.6;">We hope your meet and greet with ${parties.parentName} went well! When you have a moment, let us know how it went so we can help with next steps.</p>
            <p style="margin-top: 24px;"><a href="${appUrl}/nanny/positions" style="${btnStyle}">Update in My Positions</a></p>
          </div>`,
          emailType: "post_intro_followup",
          recipientUserId: parties.nannyUserId,
        }).catch((err) =>
          funnelError("checkPostIntro", req.id, "POST-001 email failed", err),
        );
      }
    }

    await logConnectionEvent({
      connectionRequestId: req.id,
      parentId: req.parent_id,
      nannyId: req.nanny_id,
      eventType: "intro_complete",
      eventData: { auto: true, confirmed_time: req.confirmed_time },
    });
  }
}

// ════════════════════════════════════════════════════════════
// 1b. LAZY TRIGGER: Auto-advance trials that have passed
// ════════════════════════════════════════════════════════════

export async function checkPostTrialOutcomes(
  adminClient: ReturnType<typeof createAdminClient>,
  filter: { nanny_id?: string; parent_id?: string },
): Promise<void> {
  const now = new Date();
  const todayStr = now.toISOString().split("T")[0]; // YYYY-MM-DD

  // Find confirmed trials (fill_initiated_by IS NULL = both sides confirmed) where trial_date has passed
  let query = adminClient
    .from("connection_requests")
    .select("id, parent_id, nanny_id, trial_date, connection_stage")
    .eq("connection_stage", CONNECTION_STAGE.TRIAL_ARRANGED)
    .is("fill_initiated_by", null) // only confirmed trials
    .not("trial_date", "is", null)
    .lt("trial_date", todayStr); // trial_date < today (trial day has fully elapsed)

  if (filter.nanny_id) query = query.eq("nanny_id", filter.nanny_id);
  if (filter.parent_id) query = query.eq("parent_id", filter.parent_id);

  const { data: stale } = await query;

  for (const req of stale ?? []) {
    const { error } = await adminClient
      .from("connection_requests")
      .update({
        connection_stage: CONNECTION_STAGE.TRIAL_COMPLETE,
        updated_at: now.toISOString(),
      })
      .eq("id", req.id)
      .eq("connection_stage", CONNECTION_STAGE.TRIAL_ARRANGED); // optimistic lock

    if (error) {
      funnelError(
        "checkPostTrial",
        req.id,
        "Failed to advance to TRIAL_COMPLETE",
        error,
      );
      continue;
    }

    funnelLog("checkPostTrial", req.id, "31 → 32 (auto)", {
      trialDate: req.trial_date,
    });

    // Send followup to nanny: "How did your trial go?"
    const parties = await getConnectionParties(
      adminClient,
      req.parent_id,
      req.nanny_id,
    );

    if (parties.nannyUserId) {
      await createInboxMessage({
        userId: parties.nannyUserId,
        type: "post_trial_followup",
        title: `How did your trial with ${parties.parentName} go?`,
        body: "Let us know how it went so we can help with next steps.",
        actionUrl: "/nanny/positions",
        referenceId: req.id,
        referenceType: "connection_request",
      });

      if (parties.nannyEmail) {
        sendEmail({
          to: parties.nannyEmail,
          subject: `How did your trial with ${parties.parentName} go?`,
          html: `<div style="${baseStyle}">
            <h1 style="color: #8B5CF6; font-size: 24px; margin-bottom: 16px;">Baby Bloom Sydney</h1>
            <p style="color: #374151; font-size: 16px; line-height: 1.6;">We hope your trial shift with ${parties.parentName} went well! When you have a moment, let us know how it went so we can help with next steps.</p>
            <p style="margin-top: 24px;"><a href="${appUrl}/nanny/positions" style="${btnStyle}">Update in My Positions</a></p>
          </div>`,
          emailType: "post_trial_followup",
          recipientUserId: parties.nannyUserId,
        }).catch((err) =>
          funnelError("checkPostTrial", req.id, "POST-TRIAL email failed", err),
        );
      }
    }

    await logConnectionEvent({
      connectionRequestId: req.id,
      parentId: req.parent_id,
      nannyId: req.nanny_id,
      eventType: "trial_complete",
      eventData: { auto: true, trial_date: req.trial_date },
    });
  }
}

// ════════════════════════════════════════════════════════════
// 2. NANNY REPORTS MEET OUTCOME (internal code uses "intro"; user-facing label is "Meet and Greet")
// ════════════════════════════════════════════════════════════

export async function reportIntroOutcome(
  requestId: string,
  outcome: "hired" | "not_hired" | "awaiting" | "trial" | "incomplete",
  trialDate?: string,
): Promise<{ success: boolean; error: string | null }> {
  const adminClient = createAdminClient();

  const nannyInfo = await getNannyId();
  if (!nannyInfo) {
    return { success: false, error: "Not authenticated as nanny" };
  }

  // Fetch connection
  const { data: req, error: fetchErr } = await adminClient
    .from("connection_requests")
    .select(
      "id, parent_id, nanny_id, position_id, connection_stage, fill_initiated_by, confirmed_time",
    )
    .eq("id", requestId)
    .eq("nanny_id", nannyInfo.nannyId)
    .single();

  if (fetchErr || !req) {
    return { success: false, error: "Connection request not found." };
  }

  // Validate: must be in a post-intro stage (or scheduled — nanny may report after intro happens)
  const validStages = [
    CONNECTION_STAGE.INTRO_SCHEDULED,
    CONNECTION_STAGE.INTRO_COMPLETE,
    CONNECTION_STAGE.AWAITING_RESPONSE,
    CONNECTION_STAGE.TRIAL_ARRANGED,
    CONNECTION_STAGE.TRIAL_COMPLETE,
  ];
  if (!validStages.includes(req.connection_stage)) {
    return {
      success: false,
      error: `Cannot report outcome from stage ${req.connection_stage}.`,
    };
  }

  // Guard: nanny can't report outcomes from an unconfirmed trial (parent must confirm first)
  if (
    req.connection_stage === CONNECTION_STAGE.TRIAL_ARRANGED &&
    req.fill_initiated_by === "nanny"
  ) {
    return { success: false, error: "Trial is awaiting parent confirmation." };
  }

  const now = new Date().toISOString();
  const parties = await getConnectionParties(
    adminClient,
    req.parent_id,
    req.nanny_id,
  );

  // ── HIRED (Path A start) ──
  if (outcome === "hired") {
    const { error: updateErr } = await adminClient
      .from("connection_requests")
      .update({
        connection_stage: CONNECTION_STAGE.OFFERED,
        fill_initiated_by: "nanny",
        intro_outcome_reported_at: now,
        updated_at: now,
      })
      .eq("id", requestId)
      .eq("connection_stage", req.connection_stage);

    if (updateErr) {
      funnelError(
        "reportIntroOutcome",
        requestId,
        "Failed to update to OFFERED",
        updateErr,
      );
      return { success: false, error: "Failed to update connection." };
    }

    funnelLog(
      "reportIntroOutcome",
      requestId,
      `${req.connection_stage} → 33 (hired, Path A)`,
      {},
    );

    // POST-002 to parent: service-framed confirmation request
    if (parties.parentUserId) {
      await createInboxMessage({
        userId: parties.parentUserId,
        type: "confirm_nanny",
        title: `Confirm ${parties.nannyName}`,
        body: `${parties.nannyName} has indicated they've been selected for your position — please confirm to get started.`,
        actionUrl: "/parent/connections",
        referenceId: requestId,
        referenceType: "connection_request",
      });

      if (parties.parentEmail) {
        sendEmail({
          to: parties.parentEmail,
          subject: `${parties.nannyName} has been selected — please confirm`,
          html: `<div style="${baseStyle}">
            <h1 style="color: #8B5CF6; font-size: 24px; margin-bottom: 16px;">Baby Bloom Sydney</h1>
            <p style="color: #374151; font-size: 16px; line-height: 1.6;">We're delighted to hear your meet and greet with ${parties.nannyName} went well! ${parties.nannyName} has indicated they've been selected for your position — please confirm the details to get started.</p>
            <p style="margin-top: 24px;"><a href="${appUrl}/parent/connections" style="${btnStyle}">Confirm Placement</a></p>
          </div>`,
          emailType: "confirm_nanny",
          recipientUserId: parties.parentUserId,
        }).catch((err) =>
          funnelError(
            "reportIntroOutcome",
            requestId,
            "POST-002 email failed",
            err,
          ),
        );
      }
    }

    await logConnectionEvent({
      connectionRequestId: requestId,
      parentId: req.parent_id,
      nannyId: req.nanny_id,
      eventType: "nanny_reported_hired",
      eventData: {
        from_stage: req.connection_stage,
        fill_initiated_by: "nanny",
      },
    });
  }

  // ── NOT HIRED ──
  else if (outcome === "not_hired") {
    const { error: updateErr } = await adminClient
      .from("connection_requests")
      .update({
        connection_stage: CONNECTION_STAGE.NOT_HIRED,
        intro_outcome_reported_at: now,
        updated_at: now,
      })
      .eq("id", requestId)
      .eq("connection_stage", req.connection_stage);

    if (updateErr) {
      funnelError(
        "reportIntroOutcome",
        requestId,
        "Failed to update to NOT_HIRED",
        updateErr,
      );
      return { success: false, error: "Failed to update connection." };
    }

    funnelLog(
      "reportIntroOutcome",
      requestId,
      `${req.connection_stage} → 35 (not hired)`,
      {},
    );

    // Check if this was the last active connection for the position
    if (req.position_id) {
      const { count } = await adminClient
        .from("connection_requests")
        .select("id", { count: "exact", head: true })
        .eq("position_id", req.position_id)
        .not(
          "connection_stage",
          "in",
          `(${[
            CONNECTION_STAGE.REQUEST_EXPIRED,
            CONNECTION_STAGE.DECLINED,
            CONNECTION_STAGE.REQUEST_CANCELLED,
            CONNECTION_STAGE.SCHEDULE_EXPIRED,
            CONNECTION_STAGE.NOT_HIRED,
            CONNECTION_STAGE.NOT_SELECTED,
            CONNECTION_STAGE.CANCELLED_BY_PARENT,
            CONNECTION_STAGE.CANCELLED_BY_NANNY,
          ].join(",")})`,
        );

      if (count === 0 && parties.parentUserId && parties.parentEmail) {
        // POST-003: last candidate gone — encourage parent
        sendEmail({
          to: parties.parentEmail,
          subject: "We'd love to help you find the right fit",
          html: `<div style="${baseStyle}">
            <h1 style="color: #8B5CF6; font-size: 24px; margin-bottom: 16px;">Baby Bloom Sydney</h1>
            <p style="color: #374151; font-size: 16px; line-height: 1.6;">Thank you for meeting with ${parties.nannyName}. We'd love to help you find the right fit — would you like us to arrange meet and greets with other nannies?</p>
            <p style="margin-top: 24px;"><a href="${appUrl}/parent/browse" style="${btnStyle}">Browse Nannies</a></p>
          </div>`,
          emailType: "no_candidates_left",
          recipientUserId: parties.parentUserId,
        }).catch((err) =>
          funnelError(
            "reportIntroOutcome",
            requestId,
            "POST-003 email failed",
            err,
          ),
        );

        funnelLog(
          "reportIntroOutcome",
          requestId,
          "last active connection — POST-003 sent",
          {},
        );
      }
    }

    await logConnectionEvent({
      connectionRequestId: requestId,
      parentId: req.parent_id,
      nannyId: req.nanny_id,
      eventType: "nanny_reported_not_hired",
      eventData: { from_stage: req.connection_stage },
    });
  }

  // ── AWAITING RESPONSE ──
  else if (outcome === "awaiting") {
    if (req.connection_stage !== CONNECTION_STAGE.INTRO_COMPLETE) {
      return {
        success: false,
        error: 'Can only report "awaiting" from Meet Complete stage.',
      };
    }

    const { error: updateErr } = await adminClient
      .from("connection_requests")
      .update({
        connection_stage: CONNECTION_STAGE.AWAITING_RESPONSE,
        intro_outcome_reported_at: now,
        updated_at: now,
      })
      .eq("id", requestId)
      .eq("connection_stage", CONNECTION_STAGE.INTRO_COMPLETE);

    if (updateErr) {
      funnelError(
        "reportIntroOutcome",
        requestId,
        "Failed to update to AWAITING_RESPONSE",
        updateErr,
      );
      return { success: false, error: "Failed to update connection." };
    }

    funnelLog("reportIntroOutcome", requestId, "21 → 30 (awaiting)", {});

    await logConnectionEvent({
      connectionRequestId: requestId,
      parentId: req.parent_id,
      nannyId: req.nanny_id,
      eventType: "nanny_reported_awaiting",
    });
  }

  // ── TRIAL ARRANGED ──
  else if (outcome === "trial") {
    if (
      ![
        CONNECTION_STAGE.INTRO_COMPLETE,
        CONNECTION_STAGE.AWAITING_RESPONSE,
      ].includes(req.connection_stage)
    ) {
      return {
        success: false,
        error:
          "Can only arrange trial from Meet Complete or Awaiting Response stage.",
      };
    }

    // Validate trial date is not before the intro call date
    if (trialDate && req.confirmed_time) {
      const introDay = req.confirmed_time.split("T")[0];
      if (trialDate < introDay) {
        return {
          success: false,
          error: "Trial date cannot be before the meet and greet date.",
        };
      }
    }

    // Nanny-reported trial: set fill_initiated_by='nanny' so parent must confirm
    const { error: updateErr } = await adminClient
      .from("connection_requests")
      .update({
        connection_stage: CONNECTION_STAGE.TRIAL_ARRANGED,
        fill_initiated_by: "nanny",
        trial_date: trialDate || null,
        intro_outcome_reported_at: now,
        updated_at: now,
      })
      .eq("id", requestId)
      .eq("connection_stage", req.connection_stage);

    if (updateErr) {
      funnelError(
        "reportIntroOutcome",
        requestId,
        "Failed to update to TRIAL_ARRANGED (pending)",
        updateErr,
      );
      return { success: false, error: "Failed to update connection." };
    }

    funnelLog(
      "reportIntroOutcome",
      requestId,
      `${req.connection_stage} → 31 (trial, pending parent confirm)`,
      { trialDate },
    );

    // Inbox to parent: ask them to confirm the trial
    if (parties.parentUserId) {
      await createInboxMessage({
        userId: parties.parentUserId,
        type: "trial_arranged",
        title: `Confirm trial with ${parties.nannyName}`,
        body: `${parties.nannyName} says a trial shift has been arranged${trialDate ? ` for ${trialDate}` : ""}. Please confirm or suggest a different date.`,
        actionUrl: "/parent/connections",
        referenceId: requestId,
        referenceType: "connection_request",
      });
    }

    await logConnectionEvent({
      connectionRequestId: requestId,
      parentId: req.parent_id,
      nannyId: req.nanny_id,
      eventType: "nanny_reported_trial",
      eventData: { trial_date: trialDate },
    });
  }

  // ── INTRO INCOMPLETE ──
  else if (outcome === "incomplete") {
    if (req.connection_stage !== CONNECTION_STAGE.INTRO_COMPLETE) {
      return {
        success: false,
        error: "Can only report incomplete from Meet Complete stage.",
      };
    }

    const { error: updateErr } = await adminClient
      .from("connection_requests")
      .update({
        connection_stage: CONNECTION_STAGE.INTRO_INCOMPLETE,
        intro_outcome_reported_at: now,
        updated_at: now,
      })
      .eq("id", requestId)
      .eq("connection_stage", CONNECTION_STAGE.INTRO_COMPLETE);

    if (updateErr) {
      funnelError(
        "reportIntroOutcome",
        requestId,
        "Failed to update to INTRO_INCOMPLETE",
        updateErr,
      );
      return { success: false, error: "Failed to update connection." };
    }

    funnelLog("reportIntroOutcome", requestId, "21 → 22 (incomplete)", {});

    // Service-framed inbox to parent
    if (parties.parentUserId) {
      await createInboxMessage({
        userId: parties.parentUserId,
        type: "intro_incomplete",
        title: `Regarding your meet and greet with ${parties.nannyName}`,
        body: `It looks like your meet and greet with ${parties.nannyName} may not have taken place. Would you like to reschedule?`,
        actionUrl: "/parent/connections",
        referenceId: requestId,
        referenceType: "connection_request",
      });
    }

    await logConnectionEvent({
      connectionRequestId: requestId,
      parentId: req.parent_id,
      nannyId: req.nanny_id,
      eventType: "nanny_reported_incomplete",
    });
  }

  revalidatePath("/nanny/inbox");
  revalidatePath("/parent/connections");
  return { success: true, error: null };
}

// ════════════════════════════════════════════════════════════
// 2b. PARENT CONFIRMS / DECLINES NANNY-PROPOSED TRIAL
// ════════════════════════════════════════════════════════════

export async function confirmTrialArrangement(
  requestId: string,
  trialDate?: string,
): Promise<{ success: boolean; error: string | null }> {
  const adminClient = createAdminClient();

  const parentId = await getParentId();
  if (!parentId) {
    return { success: false, error: "Not authenticated as parent" };
  }

  const { data: req, error: fetchErr } = await adminClient
    .from("connection_requests")
    .select(
      "id, parent_id, nanny_id, connection_stage, fill_initiated_by, trial_date, confirmed_time",
    )
    .eq("id", requestId)
    .eq("parent_id", parentId)
    .single();

  if (fetchErr || !req) {
    return { success: false, error: "Connection request not found." };
  }

  if (
    req.connection_stage !== CONNECTION_STAGE.TRIAL_ARRANGED ||
    req.fill_initiated_by !== "nanny"
  ) {
    return {
      success: false,
      error: "This trial is not awaiting confirmation.",
    };
  }

  const now = new Date().toISOString();
  const finalDate = trialDate || req.trial_date;

  // Validate trial date is not before the intro call date
  if (finalDate && req.confirmed_time) {
    const introDay = req.confirmed_time.split("T")[0];
    if (finalDate < introDay) {
      return {
        success: false,
        error: "Trial date cannot be before the meet and greet date.",
      };
    }
  }

  const { error: updateErr } = await adminClient
    .from("connection_requests")
    .update({
      fill_initiated_by: null,
      trial_date: finalDate,
      updated_at: now,
    })
    .eq("id", requestId)
    .eq("connection_stage", CONNECTION_STAGE.TRIAL_ARRANGED);

  if (updateErr) {
    funnelError(
      "confirmTrialArrangement",
      requestId,
      "Failed to confirm trial",
      updateErr,
    );
    return { success: false, error: "Failed to confirm trial." };
  }

  funnelLog("confirmTrialArrangement", requestId, `trial confirmed by parent`, {
    trialDate: finalDate,
  });

  // Notify nanny
  const parties = await getConnectionParties(
    adminClient,
    req.parent_id,
    req.nanny_id,
  );
  if (parties.nannyUserId) {
    await createInboxMessage({
      userId: parties.nannyUserId,
      type: "trial_confirmed",
      title: "Trial shift confirmed!",
      body: `${parties.parentName} has confirmed your trial shift${finalDate ? ` for ${finalDate}` : ""}. Good luck!`,
      actionUrl: "/nanny/positions",
      referenceId: requestId,
      referenceType: "connection_request",
    });
  }

  await logConnectionEvent({
    connectionRequestId: requestId,
    parentId: req.parent_id,
    nannyId: req.nanny_id,
    eventType: "parent_confirmed_trial",
    eventData: { trial_date: finalDate },
  });

  revalidatePath("/parent");
  revalidatePath("/parent/connections");
  revalidatePath("/nanny/positions");
  return { success: true, error: null };
}

export async function declineTrialArrangement(
  requestId: string,
): Promise<{ success: boolean; error: string | null }> {
  const adminClient = createAdminClient();

  const parentId = await getParentId();
  if (!parentId) {
    return { success: false, error: "Not authenticated as parent" };
  }

  const { data: req, error: fetchErr } = await adminClient
    .from("connection_requests")
    .select("id, parent_id, nanny_id, connection_stage, fill_initiated_by")
    .eq("id", requestId)
    .eq("parent_id", parentId)
    .single();

  if (fetchErr || !req) {
    return { success: false, error: "Connection request not found." };
  }

  if (
    req.connection_stage !== CONNECTION_STAGE.TRIAL_ARRANGED ||
    req.fill_initiated_by !== "nanny"
  ) {
    return {
      success: false,
      error: "This trial is not awaiting confirmation.",
    };
  }

  const now = new Date().toISOString();

  // Revert to AWAITING_RESPONSE so the connection stays active
  const { error: updateErr } = await adminClient
    .from("connection_requests")
    .update({
      connection_stage: CONNECTION_STAGE.AWAITING_RESPONSE,
      fill_initiated_by: null,
      trial_date: null,
      updated_at: now,
    })
    .eq("id", requestId)
    .eq("connection_stage", CONNECTION_STAGE.TRIAL_ARRANGED);

  if (updateErr) {
    funnelError(
      "declineTrialArrangement",
      requestId,
      "Failed to decline trial",
      updateErr,
    );
    return { success: false, error: "Failed to decline trial." };
  }

  funnelLog(
    "declineTrialArrangement",
    requestId,
    "trial declined by parent, reverted to AWAITING_RESPONSE",
  );

  const parties = await getConnectionParties(
    adminClient,
    req.parent_id,
    req.nanny_id,
  );
  if (parties.nannyUserId) {
    await createInboxMessage({
      userId: parties.nannyUserId,
      type: "trial_declined",
      title: "Trial update",
      body: `${parties.parentName} would like to discuss the trial arrangement. Please check in with them.`,
      actionUrl: "/nanny/positions",
      referenceId: requestId,
      referenceType: "connection_request",
    });
  }

  await logConnectionEvent({
    connectionRequestId: requestId,
    parentId: req.parent_id,
    nannyId: req.nanny_id,
    eventType: "parent_declined_trial",
  });

  revalidatePath("/parent");
  revalidatePath("/parent/connections");
  revalidatePath("/nanny/positions");
  return { success: true, error: null };
}

// ════════════════════════════════════════════════════════════
// 3. NANNY REPORTS TRIAL OUTCOME
// ════════════════════════════════════════════════════════════

export async function reportTrialOutcome(
  requestId: string,
  outcome: "hired" | "not_hired" | "awaiting",
  startDate?: string,
): Promise<{ success: boolean; error: string | null }> {
  const adminClient = createAdminClient();

  const nannyInfo = await getNannyId();
  if (!nannyInfo) {
    return { success: false, error: "Not authenticated as nanny" };
  }

  const { data: req, error: fetchErr } = await adminClient
    .from("connection_requests")
    .select(
      "id, parent_id, nanny_id, position_id, connection_stage, fill_initiated_by",
    )
    .eq("id", requestId)
    .eq("nanny_id", nannyInfo.nannyId)
    .single();

  if (fetchErr || !req) {
    return { success: false, error: "Connection request not found." };
  }

  if (
    ![
      CONNECTION_STAGE.TRIAL_ARRANGED,
      CONNECTION_STAGE.TRIAL_COMPLETE,
    ].includes(req.connection_stage)
  ) {
    return {
      success: false,
      error: `Cannot report trial outcome from stage ${req.connection_stage}.`,
    };
  }

  // Guard: nanny can't report outcomes from an unconfirmed trial
  if (
    req.connection_stage === CONNECTION_STAGE.TRIAL_ARRANGED &&
    req.fill_initiated_by === "nanny"
  ) {
    return { success: false, error: "Trial is awaiting parent confirmation." };
  }

  const now = new Date().toISOString();

  if (outcome === "hired") {
    // Same as reportIntroOutcome 'hired' — moves to Offered(33)
    return reportIntroOutcome(requestId, "hired", startDate);
  }

  if (outcome === "awaiting") {
    const { error: awaitErr } = await adminClient
      .from("connection_requests")
      .update({
        connection_stage: CONNECTION_STAGE.AWAITING_RESPONSE,
        updated_at: now,
      })
      .eq("id", requestId)
      .eq("connection_stage", req.connection_stage);

    if (awaitErr) {
      funnelError(
        "reportTrialOutcome",
        requestId,
        "Failed to update to AWAITING_RESPONSE",
        awaitErr,
      );
      return { success: false, error: "Failed to update connection." };
    }

    funnelLog(
      "reportTrialOutcome",
      requestId,
      `${req.connection_stage} → ${CONNECTION_STAGE.AWAITING_RESPONSE} (trial awaiting)`,
      {},
    );
    revalidatePath("/nanny/positions");
    return { success: true, error: null };
  }

  // not_hired
  const { error: updateErr } = await adminClient
    .from("connection_requests")
    .update({
      connection_stage: CONNECTION_STAGE.NOT_HIRED,
      trial_reported_at: now,
      updated_at: now,
    })
    .eq("id", requestId)
    .eq("connection_stage", req.connection_stage);

  if (updateErr) {
    funnelError(
      "reportTrialOutcome",
      requestId,
      "Failed to update to NOT_HIRED",
      updateErr,
    );
    return { success: false, error: "Failed to update connection." };
  }

  funnelLog(
    "reportTrialOutcome",
    requestId,
    `${req.connection_stage} → 35 (trial not hired)`,
    {},
  );

  await logConnectionEvent({
    connectionRequestId: requestId,
    parentId: req.parent_id,
    nannyId: req.nanny_id,
    eventType: "trial_not_hired",
    eventData: { from_stage: req.connection_stage },
  });

  revalidatePath("/nanny/inbox");
  revalidatePath("/parent/connections");
  return { success: true, error: null };
}

// ════════════════════════════════════════════════════════════
// 4. SHARED: Create Placement (used by Path A + Path B)
// ════════════════════════════════════════════════════════════

async function _createPlacement(
  requestId: string,
  nannyId: string,
  parentId: string,
  positionId: string,
  adminClient: ReturnType<typeof createAdminClient>,
): Promise<{ success: boolean; error: string | null; placementId?: string }> {
  const now = new Date().toISOString();

  // 1. Move connection → Confirmed(34) (accept from OFFERED or already CONFIRMED)
  const { error: confirmErr } = await adminClient
    .from("connection_requests")
    .update({
      connection_stage: CONNECTION_STAGE.CONFIRMED,
      updated_at: now,
    })
    .eq("id", requestId)
    .in("connection_stage", [
      CONNECTION_STAGE.OFFERED,
      CONNECTION_STAGE.CONFIRMED,
    ]);

  if (confirmErr) {
    funnelError(
      "_createPlacement",
      requestId,
      "Failed to confirm connection",
      confirmErr,
    );
    return { success: false, error: "Failed to confirm connection." };
  }

  // 2. Get position details for placement record
  const { data: position } = await adminClient
    .from("nanny_positions")
    .select("id, hours_per_week, hourly_rate, start_date, stage")
    .eq("id", positionId)
    .single();

  if (!position) {
    funnelError("_createPlacement", requestId, "Position not found", {
      positionId,
    });
    return { success: false, error: "Position not found." };
  }

  if (
    ![
      POSITION_STAGE.OPEN,
      POSITION_STAGE.CONNECTING,
      POSITION_STAGE.ACTIVE,
    ].includes(position.stage)
  ) {
    funnelError(
      "_createPlacement",
      requestId,
      `Position at wrong stage: ${position.stage}`,
      {},
    );
    return {
      success: false,
      error: "Position is not in a valid state for placement.",
    };
  }

  // 3. Update position → Active(30)
  const { error: posErr } = await adminClient
    .from("nanny_positions")
    .update({
      stage: POSITION_STAGE.ACTIVE,
      position_status: POSITION_STATUS.ACTIVE,
      status: "filled",
      filled_at: now,
      filled_by_nanny_id: nannyId,
      activated_at: now,
    })
    .eq("id", positionId)
    .in("stage", [
      POSITION_STAGE.OPEN,
      POSITION_STAGE.CONNECTING,
      POSITION_STAGE.ACTIVE,
    ]);

  if (posErr) {
    funnelError(
      "_createPlacement",
      requestId,
      "Failed to activate position",
      posErr,
    );
    return { success: false, error: "Failed to activate position." };
  }

  funnelLog("_createPlacement", requestId, `position → Active(30)`, {
    positionId,
  });

  // 4. Move confirmed connection → Active(40)
  const { error: activeErr } = await adminClient
    .from("connection_requests")
    .update({ connection_stage: CONNECTION_STAGE.ACTIVE, updated_at: now })
    .eq("id", requestId);

  if (activeErr)
    console.warn(
      `[_createPlacement] Step 4 — failed to move connection to Active:`,
      activeErr.message,
    );

  // 5. Auto-close other active connections for this position → Not Selected(36)
  //    Also set status='expired' so duplicate check in createConnectionRequest won't block reconnecting
  const { error: closeOthersErr } = await adminClient
    .from("connection_requests")
    .update({
      connection_stage: CONNECTION_STAGE.NOT_SELECTED,
      status: "expired",
      updated_at: now,
    })
    .eq("position_id", positionId)
    .neq("id", requestId)
    .not(
      "connection_stage",
      "in",
      `(${[
        CONNECTION_STAGE.REQUEST_EXPIRED,
        CONNECTION_STAGE.DECLINED,
        CONNECTION_STAGE.REQUEST_CANCELLED,
        CONNECTION_STAGE.SCHEDULE_EXPIRED,
        CONNECTION_STAGE.NOT_HIRED,
        CONNECTION_STAGE.NOT_SELECTED,
        CONNECTION_STAGE.CANCELLED_BY_PARENT,
        CONNECTION_STAGE.CANCELLED_BY_NANNY,
      ].join(",")})`,
    );

  if (closeOthersErr)
    console.warn(
      `[_createPlacement] Step 5 — failed to close other connections:`,
      closeOthersErr.message,
    );

  // PINB-020: Notify not-selected nannies (inbox only — bad news, fire-and-forget)
  (async () => {
    try {
      const { data: closedConns } = await adminClient
        .from("connection_requests")
        .select("nanny_id")
        .eq("position_id", positionId)
        .eq("connection_stage", CONNECTION_STAGE.NOT_SELECTED)
        .eq("status", "expired")
        .neq("id", requestId);

      if (closedConns && closedConns.length > 0) {
        const nannyIds = [...new Set(closedConns.map((c) => c.nanny_id))];
        const { data: nannies } = await adminClient
          .from("nannies")
          .select("id, user_id")
          .in("id", nannyIds);

        for (const n of nannies ?? []) {
          await createInboxMessage({
            userId: n.user_id,
            type: "not_selected",
            title: "Position filled",
            body: "The family has filled their position with another nanny. Keep an eye out for new opportunities.",
            actionUrl: "/nanny/positions",
            referenceType: "connection_request",
          });
        }
      }
    } catch (err) {
      console.warn(
        "[_createPlacement] PINB-020 inbox notifications failed:",
        err,
      );
    }
  })();

  funnelLog(
    "_createPlacement",
    requestId,
    "other connections → Not Selected(36) + expired",
    { positionId },
  );

  // 5b. Expire all remaining DFY notifications for this position
  const { error: dfyExpireErr } = await adminClient
    .from("dfy_match_notifications")
    .update({ status: "expired", updated_at: now })
    .eq("position_id", positionId)
    .in("status", ["notified", "viewed", "interested", "pending_wave"]);

  if (dfyExpireErr) {
    console.warn(
      `[_createPlacement] Step 5b — failed to expire DFY notifications:`,
      dfyExpireErr.message,
    );
  } else {
    funnelLog(
      "_createPlacement",
      requestId,
      "DFY notifications expired (position filled)",
      { positionId },
    );
  }

  // 6. Create nanny_placements record
  const { data: placement, error: placementErr } = await adminClient
    .from("nanny_placements")
    .insert({
      nanny_id: nannyId,
      parent_id: parentId,
      position_id: positionId,
      interview_request_id: requestId,
      source: "interview_request",
      status: "active",
      hired_at: now,
      start_date: position.start_date || now,
      weekly_hours: position.hours_per_week,
      hourly_rate: position.hourly_rate,
    })
    .select("id")
    .single();

  if (placementErr) {
    funnelError(
      "_createPlacement",
      requestId,
      "Failed to create placement",
      placementErr,
    );
    return { success: false, error: "Failed to create placement record." };
  }

  funnelLog("_createPlacement", requestId, `placement created`, {
    placementId: placement.id,
  });

  // 7. Update parent cross-references
  const { error: parentRefErr } = await adminClient
    .from("parents")
    .update({
      current_nanny_id: nannyId,
      current_placement_id: placement.id,
    })
    .eq("id", parentId);

  if (parentRefErr)
    console.warn(
      `[_createPlacement] Step 7 — failed to update parent cross-refs:`,
      parentRefErr.message,
    );

  // 8. Update nanny cross-references
  const { error: nannyRefErr } = await adminClient
    .from("nannies")
    .update({ current_placement_id: placement.id })
    .eq("id", nannyId);

  if (nannyRefErr)
    console.warn(
      `[_createPlacement] Step 8 — failed to update nanny cross-refs:`,
      nannyRefErr.message,
    );

  return { success: true, error: null, placementId: placement.id };
}

// ════════════════════════════════════════════════════════════
// 5. PARENT CONFIRMS NANNY (Path A completion)
// ════════════════════════════════════════════════════════════

export async function confirmPlacement(
  requestId: string,
  startWeek?: string,
): Promise<{ success: boolean; error: string | null }> {
  const adminClient = createAdminClient();

  const parentId = await getParentId();
  if (!parentId) {
    return { success: false, error: "Not authenticated as parent" };
  }

  // Fetch connection
  const { data: req, error: fetchErr } = await adminClient
    .from("connection_requests")
    .select(
      "id, parent_id, nanny_id, position_id, connection_stage, fill_initiated_by",
    )
    .eq("id", requestId)
    .eq("parent_id", parentId)
    .single();

  if (fetchErr || !req) {
    return { success: false, error: "Connection request not found." };
  }

  if (req.connection_stage !== CONNECTION_STAGE.OFFERED) {
    return {
      success: false,
      error: "This connection is not awaiting confirmation.",
    };
  }

  if (req.fill_initiated_by !== "nanny") {
    return {
      success: false,
      error: "This connection was not initiated by the nanny.",
    };
  }

  if (!req.position_id) {
    return { success: false, error: "No position linked to this connection." };
  }

  funnelLog("confirmPlacement", requestId, "parent confirming (Path A)", {
    nannyId: req.nanny_id,
  });

  // Save start_week on connection if provided
  if (startWeek) {
    await adminClient
      .from("connection_requests")
      .update({
        start_date: startWeek,
        updated_at: new Date().toISOString(),
      })
      .eq("id", requestId);
  }

  const result = await _createPlacement(
    requestId,
    req.nanny_id,
    req.parent_id,
    req.position_id,
    adminClient,
  );

  if (!result.success) {
    return result;
  }

  // Notifications
  const parties = await getConnectionParties(
    adminClient,
    req.parent_id,
    req.nanny_id,
  );

  // Hire confirmation PDFs + detailed emails (fire-and-forget)
  if (
    result.placementId &&
    parties.parentEmail &&
    parties.nannyEmail &&
    parties.parentUserId &&
    parties.nannyUserId
  ) {
    sendHireConfirmationEmails({
      placementId: result.placementId,
      nannyId: req.nanny_id,
      parentId: req.parent_id,
      parentName: parties.parentName,
      nannyName: parties.nannyName,
      parentEmail: parties.parentEmail,
      nannyEmail: parties.nannyEmail,
      parentUserId: parties.parentUserId,
      nannyUserId: parties.nannyUserId,
    }).catch((err) =>
      funnelError(
        "confirmPlacement",
        requestId,
        "Hire confirmation emails failed",
        err,
      ),
    );
  }

  // POST-004 to nanny: "Congratulations!"
  if (parties.nannyUserId) {
    await createInboxMessage({
      userId: parties.nannyUserId,
      type: "placement_confirmed",
      title: `Position confirmed with ${parties.parentName}!`,
      body: "Congratulations! Please update your availability to reflect your new commitment.",
      actionUrl: "/nanny/positions",
      referenceId: requestId,
      referenceType: "connection_request",
    });

    if (parties.nannyEmail) {
      sendEmail({
        to: parties.nannyEmail,
        subject: `Congratulations! Your position with ${parties.parentName} is confirmed`,
        html: `<div style="${baseStyle}">
          <h1 style="color: #8B5CF6; font-size: 24px; margin-bottom: 16px;">Baby Bloom Sydney</h1>
          <p style="color: #374151; font-size: 16px; line-height: 1.6;">Great news — ${parties.parentName} has confirmed you for their nanny position. Please update your availability to reflect your new commitment.</p>
          <p style="margin-top: 24px;"><a href="${appUrl}/nanny/positions" style="${btnStyle}">View Position</a></p>
        </div>`,
        emailType: "placement_confirmed",
        recipientUserId: parties.nannyUserId,
      }).catch((err) =>
        funnelError(
          "confirmPlacement",
          requestId,
          "POST-004 email failed",
          err,
        ),
      );
    }
  }

  // Inbox to parent
  if (parties.parentUserId) {
    await createInboxMessage({
      userId: parties.parentUserId,
      type: "placement_confirmed",
      title: `${parties.nannyName} is confirmed as your nanny!`,
      body: "You can view your placement details in My Childcare.",
      actionUrl: "/parent",
      referenceId: requestId,
      referenceType: "connection_request",
    });
  }

  // Katie proactive — both parties get a high-stakes acknowledgment.
  // Each side hears the OTHER party's name as the counterparty.
  if (parties.nannyUserId) {
    dispatchActionTriggeredInBackground({
      triggerId: "connections.placement_confirmed",
      recipientUserId: parties.nannyUserId,
      payload: {
        counterparty_name: parties.parentName,
        connection_id: requestId,
      },
    });
  }
  if (parties.parentUserId) {
    dispatchActionTriggeredInBackground({
      triggerId: "connections.placement_confirmed",
      recipientUserId: parties.parentUserId,
      payload: {
        counterparty_name: parties.nannyName,
        connection_id: requestId,
      },
    });
  }

  await logConnectionEvent({
    connectionRequestId: requestId,
    parentId: req.parent_id,
    nannyId: req.nanny_id,
    eventType: "placement_confirmed",
    eventData: {
      fill_initiated_by: "nanny",
      path: "A",
      placementId: result.placementId,
    },
  });

  funnelLog(
    "confirmPlacement",
    requestId,
    "COMPLETE — placement active (Path A)",
    { placementId: result.placementId },
  );

  revalidatePath("/parent/connections");
  revalidatePath("/parent");
  revalidatePath("/nanny/inbox");
  revalidatePath("/nanny/positions");
  return { success: true, error: null };
}

// ════════════════════════════════════════════════════════════
// 6. PARENT INITIATES FILL (Path B start)
// ════════════════════════════════════════════════════════════

export async function parentInitiateFill(
  nannyId: string,
  positionId: string,
  startWeek?: string,
): Promise<{ success: boolean; error: string | null }> {
  const adminClient = createAdminClient();

  const parentId = await getParentId();
  if (!parentId) {
    return { success: false, error: "Not authenticated as parent" };
  }

  // Verify position belongs to parent and is at Connecting
  const { data: position } = await adminClient
    .from("nanny_positions")
    .select("id, stage")
    .eq("id", positionId)
    .eq("parent_id", parentId)
    .single();

  if (!position) {
    return { success: false, error: "Position not found." };
  }

  if (position.stage !== POSITION_STAGE.CONNECTING) {
    return { success: false, error: "Position is not in Connecting stage." };
  }

  // Find the connection between this parent and nanny for this position
  const { data: connection } = await adminClient
    .from("connection_requests")
    .select("id, connection_stage")
    .eq("parent_id", parentId)
    .eq("nanny_id", nannyId)
    .eq("position_id", positionId)
    .in("connection_stage", [
      CONNECTION_STAGE.INTRO_COMPLETE,
      CONNECTION_STAGE.INTRO_INCOMPLETE,
      CONNECTION_STAGE.AWAITING_RESPONSE,
      CONNECTION_STAGE.TRIAL_ARRANGED,
      CONNECTION_STAGE.TRIAL_COMPLETE,
    ])
    .single();

  if (!connection) {
    return {
      success: false,
      error: "No eligible connection found with this nanny.",
    };
  }

  const now = new Date().toISOString();

  // Move to Offered(33) with parent as initiator
  const updateData: Record<string, unknown> = {
    connection_stage: CONNECTION_STAGE.OFFERED,
    fill_initiated_by: "parent",
    updated_at: now,
  };
  if (startWeek) updateData.start_date = startWeek;

  const { error: updateErr } = await adminClient
    .from("connection_requests")
    .update(updateData)
    .eq("id", connection.id)
    .eq("connection_stage", connection.connection_stage);

  if (updateErr) {
    funnelError(
      "parentInitiateFill",
      connection.id,
      "Failed to update to OFFERED",
      updateErr,
    );
    return { success: false, error: "Failed to update connection." };
  }

  funnelLog(
    "parentInitiateFill",
    connection.id,
    `${connection.connection_stage} → 33 (Path B)`,
    { nannyId },
  );

  // POST-006 to nanny: "Parent has selected you"
  const parties = await getConnectionParties(adminClient, parentId, nannyId);

  if (parties.nannyUserId) {
    await createInboxMessage({
      userId: parties.nannyUserId,
      type: "parent_selected_you",
      title: `${parties.parentName} has selected you!`,
      body: `We're delighted to share that ${parties.parentName} would like you for their nanny position. Please confirm to get started.`,
      actionUrl: "/nanny/positions",
      referenceId: connection.id,
      referenceType: "connection_request",
    });

    if (parties.nannyEmail) {
      sendEmail({
        to: parties.nannyEmail,
        subject: `Great news! ${parties.parentName} has selected you`,
        html: `<div style="${baseStyle}">
          <h1 style="color: #8B5CF6; font-size: 24px; margin-bottom: 16px;">Baby Bloom Sydney</h1>
          <p style="color: #374151; font-size: 16px; line-height: 1.6;">We're delighted to share that ${parties.parentName} would like you for their nanny position. Please confirm to get started.</p>
          <p style="margin-top: 24px;"><a href="${appUrl}/nanny/positions" style="${btnStyle}">Confirm Position</a></p>
        </div>`,
        emailType: "parent_initiated_fill",
        recipientUserId: parties.nannyUserId,
      }).catch((err) =>
        funnelError(
          "parentInitiateFill",
          connection.id,
          "POST-006 email failed",
          err,
        ),
      );
    }
  }

  await logConnectionEvent({
    connectionRequestId: connection.id,
    parentId,
    nannyId,
    eventType: "parent_initiated_fill",
    eventData: { from_stage: connection.connection_stage },
  });

  revalidatePath("/parent");
  revalidatePath("/parent/connections");
  revalidatePath("/nanny/inbox");
  return { success: true, error: null };
}

// ════════════════════════════════════════════════════════════
// 7. NANNY CONFIRMS POSITION (Path B completion)
// ════════════════════════════════════════════════════════════

export async function nannyConfirmPosition(
  requestId: string,
): Promise<{ success: boolean; error: string | null }> {
  const adminClient = createAdminClient();

  const nannyInfo = await getNannyId();
  if (!nannyInfo) {
    return { success: false, error: "Not authenticated as nanny" };
  }

  // Fetch connection
  const { data: req, error: fetchErr } = await adminClient
    .from("connection_requests")
    .select(
      "id, parent_id, nanny_id, position_id, connection_stage, fill_initiated_by",
    )
    .eq("id", requestId)
    .eq("nanny_id", nannyInfo.nannyId)
    .single();

  if (fetchErr || !req) {
    return { success: false, error: "Connection request not found." };
  }

  if (
    req.connection_stage !== CONNECTION_STAGE.OFFERED &&
    req.connection_stage !== CONNECTION_STAGE.CONFIRMED
  ) {
    return {
      success: false,
      error: "This connection is not awaiting confirmation.",
    };
  }

  if (req.fill_initiated_by !== "parent") {
    return {
      success: false,
      error: "This connection was not initiated by the parent.",
    };
  }

  if (!req.position_id) {
    return { success: false, error: "No position linked to this connection." };
  }

  funnelLog("nannyConfirmPosition", requestId, "nanny confirming (Path B)", {
    parentId: req.parent_id,
  });

  const result = await _createPlacement(
    requestId,
    req.nanny_id,
    req.parent_id,
    req.position_id,
    adminClient,
  );

  if (!result.success) {
    return result;
  }

  // Notifications
  const parties = await getConnectionParties(
    adminClient,
    req.parent_id,
    req.nanny_id,
  );

  // Hire confirmation PDFs + detailed emails (fire-and-forget)
  if (
    result.placementId &&
    parties.parentEmail &&
    parties.nannyEmail &&
    parties.parentUserId &&
    parties.nannyUserId
  ) {
    sendHireConfirmationEmails({
      placementId: result.placementId,
      nannyId: req.nanny_id,
      parentId: req.parent_id,
      parentName: parties.parentName,
      nannyName: parties.nannyName,
      parentEmail: parties.parentEmail,
      nannyEmail: parties.nannyEmail,
      parentUserId: parties.parentUserId,
      nannyUserId: parties.nannyUserId,
    }).catch((err) =>
      funnelError(
        "nannyConfirmPosition",
        requestId,
        "Hire confirmation emails failed",
        err,
      ),
    );
  }

  // POST-007 to parent: "Your nanny is confirmed!"
  if (parties.parentUserId) {
    await createInboxMessage({
      userId: parties.parentUserId,
      type: "placement_confirmed",
      title: `${parties.nannyName} is confirmed as your nanny!`,
      body: "You can view your placement details in My Childcare.",
      actionUrl: "/parent",
      referenceId: requestId,
      referenceType: "connection_request",
    });

    if (parties.parentEmail) {
      sendEmail({
        to: parties.parentEmail,
        subject: `Your nanny ${parties.nannyName} is confirmed!`,
        html: `<div style="${baseStyle}">
          <h1 style="color: #8B5CF6; font-size: 24px; margin-bottom: 16px;">Baby Bloom Sydney</h1>
          <p style="color: #374151; font-size: 16px; line-height: 1.6;">Wonderful news — ${parties.nannyName} has confirmed your nanny position. You can view your placement details in My Childcare.</p>
          <p style="margin-top: 24px;"><a href="${appUrl}/parent" style="${btnStyle}">View My Childcare</a></p>
        </div>`,
        emailType: "placement_confirmed",
        recipientUserId: parties.parentUserId,
      }).catch((err) =>
        funnelError(
          "nannyConfirmPosition",
          requestId,
          "POST-007 email failed",
          err,
        ),
      );
    }
  }

  // Inbox to nanny
  if (parties.nannyUserId) {
    await createInboxMessage({
      userId: parties.nannyUserId,
      type: "placement_confirmed",
      title: `Position confirmed with ${parties.parentName}!`,
      body: "Congratulations! Please update your availability to reflect your new commitment.",
      actionUrl: "/nanny/positions",
      referenceId: requestId,
      referenceType: "connection_request",
    });
  }

  // Katie proactive — both parties get a high-stakes acknowledgment
  // (Path B: nanny initiated the placement confirmation).
  if (parties.nannyUserId) {
    dispatchActionTriggeredInBackground({
      triggerId: "connections.placement_confirmed",
      recipientUserId: parties.nannyUserId,
      payload: {
        counterparty_name: parties.parentName,
        connection_id: requestId,
      },
    });
  }
  if (parties.parentUserId) {
    dispatchActionTriggeredInBackground({
      triggerId: "connections.placement_confirmed",
      recipientUserId: parties.parentUserId,
      payload: {
        counterparty_name: parties.nannyName,
        connection_id: requestId,
      },
    });
  }

  await logConnectionEvent({
    connectionRequestId: requestId,
    parentId: req.parent_id,
    nannyId: req.nanny_id,
    eventType: "placement_confirmed",
    eventData: {
      fill_initiated_by: "parent",
      path: "B",
      placementId: result.placementId,
    },
  });

  funnelLog(
    "nannyConfirmPosition",
    requestId,
    "COMPLETE — placement active (Path B)",
    { placementId: result.placementId },
  );

  revalidatePath("/parent/connections");
  revalidatePath("/parent");
  revalidatePath("/nanny/inbox");
  revalidatePath("/nanny/positions");
  return { success: true, error: null };
}

// ════════════════════════════════════════════════════════════
// 8. END POSITION (active → ended)
// ════════════════════════════════════════════════════════════

export async function endPosition(
  positionId: string,
  reason: EndReason,
): Promise<{ success: boolean; error: string | null }> {
  const adminClient = createAdminClient();

  // Determine caller
  const parentId = await getParentId();
  const nannyInfo = await getNannyId();

  if (!parentId && !nannyInfo) {
    return { success: false, error: "Not authenticated" };
  }

  // Fetch position
  const { data: position } = await adminClient
    .from("nanny_positions")
    .select("id, parent_id, filled_by_nanny_id, stage")
    .eq("id", positionId)
    .single();

  if (!position) {
    return { success: false, error: "Position not found." };
  }

  if (position.stage !== POSITION_STAGE.ACTIVE) {
    return { success: false, error: "Position is not active." };
  }

  // Verify ownership
  const isParent = parentId === position.parent_id;
  const isNanny = nannyInfo?.nannyId === position.filled_by_nanny_id;

  if (!isParent && !isNanny) {
    return {
      success: false,
      error: "You do not have permission to end this position.",
    };
  }

  const positionStatus = END_REASON_TO_STATUS[reason];
  if (!positionStatus) {
    return { success: false, error: "Invalid end reason." };
  }

  const now = new Date().toISOString();

  // 1. Update position
  const { error: posErr } = await adminClient
    .from("nanny_positions")
    .update({
      stage: POSITION_STAGE.ENDED,
      position_status: positionStatus,
      status: "ended",
      ended_at: now,
      end_reason: reason,
    })
    .eq("id", positionId)
    .eq("stage", POSITION_STAGE.ACTIVE);

  if (posErr) {
    funnelError("endPosition", positionId, "Failed to end position", posErr);
    return { success: false, error: "Failed to end position." };
  }

  funnelLog(
    "endPosition",
    positionId,
    `Active(30) → Ended(${positionStatus})`,
    { reason },
  );

  // 2. Move active connection → Finished(41)
  await adminClient
    .from("connection_requests")
    .update({ connection_stage: CONNECTION_STAGE.FINISHED, updated_at: now })
    .eq("position_id", positionId)
    .eq("connection_stage", CONNECTION_STAGE.ACTIVE);

  // 3. End placement
  await adminClient
    .from("nanny_placements")
    .update({ status: "ended", ended_at: now })
    .eq("position_id", positionId)
    .eq("status", "active");

  // 4. Clear cross-references
  await adminClient
    .from("parents")
    .update({ current_nanny_id: null, current_placement_id: null })
    .eq("id", position.parent_id);

  if (position.filled_by_nanny_id) {
    await adminClient
      .from("nannies")
      .update({ current_placement_id: null })
      .eq("id", position.filled_by_nanny_id);
  }

  // Notifications
  const parties = await getConnectionParties(
    adminClient,
    position.parent_id,
    position.filled_by_nanny_id || "",
  );

  if (parties.parentUserId) {
    await createInboxMessage({
      userId: parties.parentUserId,
      type: "position_ended",
      title: "Position has ended",
      body: "Your nanny position has been marked as ended. You can create a new position when you're ready.",
      actionUrl: "/parent",
    });
  }

  if (parties.nannyUserId) {
    await createInboxMessage({
      userId: parties.nannyUserId,
      type: "position_ended",
      title: `Position with ${parties.parentName} has ended`,
      body: "This position has been marked as ended.",
      actionUrl: "/nanny/positions",
    });
  }

  await logConnectionEvent({
    connectionRequestId: positionId, // using positionId as reference
    parentId: position.parent_id,
    nannyId: position.filled_by_nanny_id || "",
    eventType: "position_ended",
    eventData: {
      reason,
      position_status: positionStatus,
      ended_by: isParent ? "parent" : "nanny",
    },
  });

  revalidatePath("/parent");
  revalidatePath("/parent/connections");
  revalidatePath("/nanny/inbox");
  revalidatePath("/nanny/positions");
  return { success: true, error: null };
}

// ════════════════════════════════════════════════════════════
// 9. DISPLAY FETCHERS
// ════════════════════════════════════════════════════════════

/** Get active placement for parent's "My Childcare" card */
export async function getParentPlacement(): Promise<{
  data: {
    id: string;
    nannyId: string;
    nannyName: string;
    nannySuburb: string;
    nannyPhoto: string | null;
    nannyDateOfBirth: string | null;
    weeklyHours: number | null;
    hourlyRate: number | null;
    hiredAt: string;
    startDate: string | null;
    // Enriched nanny fields
    nannyEmail: string | null;
    nannyPhone: string | null;
    totalExperienceYears: number | null;
    nannyExperienceYears: number | null;
    highestQualification: string | null;
    certifications: string[];
    wwccVerified: boolean;
    wwccExpiry: string | null;
    vaccinationStatus: boolean;
    nannyHourlyRate: number | null;
  } | null;
  error: string | null;
}> {
  const adminClient = createAdminClient();

  const parentId = await getParentId();
  if (!parentId) {
    return { data: null, error: "Not authenticated as parent" };
  }

  const { data: placement } = await adminClient
    .from("nanny_placements")
    .select("id, nanny_id, weekly_hours, hourly_rate, hired_at, start_date")
    .eq("parent_id", parentId)
    .eq("status", "active")
    .single();

  if (!placement) {
    return { data: null, error: null };
  }

  // Get nanny details (experience, verification)
  const { data: nanny } = await adminClient
    .from("nannies")
    .select(
      "user_id, total_experience_years, nanny_experience_years, wwcc_verified, hourly_rate_min",
    )
    .eq("id", placement.nanny_id)
    .single();

  let nannyName = "Your nanny";
  let nannySuburb = "";
  let nannyPhoto: string | null = null;
  let nannyDateOfBirth: string | null = null;
  let nannyEmail: string | null = null;
  let nannyPhone: string | null = null;

  if (nanny) {
    const { data: profile } = await adminClient
      .from("user_profiles")
      .select(
        "first_name, last_name, suburb, profile_picture_url, date_of_birth, email, mobile_number",
      )
      .eq("user_id", nanny.user_id)
      .single();

    if (profile) {
      nannyName = `${profile.first_name} ${profile.last_name}`;
      nannySuburb = profile.suburb || "";
      nannyPhoto = profile.profile_picture_url;
      nannyDateOfBirth = profile.date_of_birth;
      nannyEmail = profile.email || null;
      nannyPhone = profile.mobile_number || null;
    }
  }

  // Get qualifications and certifications
  let highestQualification: string | null = null;
  const certifications: string[] = [];

  const { data: credentials } = await adminClient
    .from("nanny_credentials")
    .select("credential_category, qualification_type, certification_type")
    .eq("nanny_id", placement.nanny_id);

  if (credentials) {
    for (const cred of credentials) {
      if (
        cred.credential_category === "qualification" &&
        cred.qualification_type
      ) {
        highestQualification = cred.qualification_type;
      }
      if (
        cred.credential_category === "certification" &&
        cred.certification_type
      ) {
        certifications.push(cred.certification_type);
      }
    }
  }

  return {
    data: {
      id: placement.id,
      nannyId: placement.nanny_id,
      nannyName,
      nannySuburb,
      nannyPhoto,
      nannyDateOfBirth,
      weeklyHours: placement.weekly_hours,
      hourlyRate: placement.hourly_rate,
      hiredAt: placement.hired_at,
      startDate: placement.start_date,
      nannyEmail,
      nannyPhone,
      totalExperienceYears: nanny?.total_experience_years ?? null,
      nannyExperienceYears: nanny?.nanny_experience_years ?? null,
      highestQualification,
      certifications,
      wwccVerified: nanny?.wwcc_verified ?? false,
      wwccExpiry: null,
      vaccinationStatus: false,
      nannyHourlyRate: nanny?.hourly_rate_min ?? null,
    },
    error: null,
  };
}

/** Remove (end) an active nanny placement */
/** Parent updates hourly rate on an active placement */
export async function updateParentPlacementRate(
  placementId: string,
  newRate: number,
): Promise<{ success: boolean; error?: string }> {
  const adminClient = createAdminClient();
  const parentId = await getParentId();
  if (!parentId) return { success: false, error: "Not authenticated" };
  if (newRate < 0 || newRate > 999)
    return { success: false, error: "Invalid rate" };

  const { data: placement } = await adminClient
    .from("nanny_placements")
    .select("id")
    .eq("id", placementId)
    .eq("parent_id", parentId)
    .eq("status", "active")
    .single();

  if (!placement) return { success: false, error: "Placement not found" };

  const { error } = await adminClient
    .from("nanny_placements")
    .update({ hourly_rate: newRate })
    .eq("id", placementId);

  if (error) return { success: false, error: error.message };
  revalidatePath("/parent");
  return { success: true };
}

/** Parent updates weekly hours on an active placement */
export async function updateParentPlacementHours(
  placementId: string,
  newHours: number,
): Promise<{ success: boolean; error?: string }> {
  const adminClient = createAdminClient();
  const parentId = await getParentId();
  if (!parentId) return { success: false, error: "Not authenticated" };
  if (newHours < 0 || newHours > 168)
    return { success: false, error: "Invalid hours" };

  const { data: placement } = await adminClient
    .from("nanny_placements")
    .select("id")
    .eq("id", placementId)
    .eq("parent_id", parentId)
    .eq("status", "active")
    .single();

  if (!placement) return { success: false, error: "Placement not found" };

  const { error } = await adminClient
    .from("nanny_placements")
    .update({ weekly_hours: newHours })
    .eq("id", placementId);

  if (error) return { success: false, error: error.message };
  revalidatePath("/parent");
  return { success: true };
}

export async function removeNannyPlacement(
  placementId: string,
  endReason: string,
  endNotes?: string,
): Promise<{ success: boolean; error: string | null }> {
  const adminClient = createAdminClient();

  const parentId = await getParentId();
  if (!parentId) {
    return { success: false, error: "Not authenticated as parent" };
  }

  // Verify this placement belongs to the parent
  const { data: placement, error: placementErr } = await adminClient
    .from("nanny_placements")
    .select("id, nanny_id, parent_id, position_id, interview_request_id")
    .eq("id", placementId)
    .eq("parent_id", parentId)
    .eq("status", "active")
    .single();

  funnelLog(
    "removeNannyPlacement",
    placementId,
    `lookup: ${JSON.stringify({ found: !!placement, parentId, error: placementErr?.message })}`,
  );

  if (!placement) {
    return { success: false, error: "Placement not found." };
  }

  const now = new Date().toISOString();

  // 1. End the placement
  const { error: endErr } = await adminClient
    .from("nanny_placements")
    .update({
      status: "ended",
      ended_at: now,
      end_reason: endReason,
      end_notes: endNotes || null,
      updated_at: now,
    })
    .eq("id", placementId);

  if (endErr) {
    funnelError(
      "removeNannyPlacement",
      placementId,
      `Failed to end placement: ${endErr.message}`,
    );
    return {
      success: false,
      error: `Failed to end placement: ${endErr.message}`,
    };
  }

  funnelLog(
    "removeNannyPlacement",
    placementId,
    "Step 1 done — placement status set to ended",
  );

  // 2. Clear parent cross-references
  const { error: parentErr } = await adminClient
    .from("parents")
    .update({
      current_nanny_id: null,
      current_placement_id: null,
    })
    .eq("id", parentId);

  if (parentErr)
    funnelError(
      "removeNannyPlacement",
      placementId,
      `Step 2 parent clear failed: ${parentErr.message}`,
    );

  // 3. Clear nanny cross-references
  const { error: nannyErr } = await adminClient
    .from("nannies")
    .update({ current_placement_id: null })
    .eq("id", placement.nanny_id);

  if (nannyErr)
    funnelError(
      "removeNannyPlacement",
      placementId,
      `Step 3 nanny clear failed: ${nannyErr.message}`,
    );

  // 4. Revert position to OPEN so parent can find a new nanny (only if position is still ACTIVE)
  if (placement.position_id) {
    const { error: posRevertErr } = await adminClient
      .from("nanny_positions")
      .update({
        stage: POSITION_STAGE.OPEN,
        position_status: POSITION_STATUS.OPEN,
        status: "active",
        filled_by_nanny_id: null,
        filled_at: null,
        updated_at: now,
      })
      .eq("id", placement.position_id)
      .eq("stage", POSITION_STAGE.ACTIVE);

    if (posRevertErr)
      funnelError(
        "removeNannyPlacement",
        placementId,
        `Step 4 position revert failed: ${posRevertErr.message}`,
      );
  }

  // 5. Terminate ALL connections for this position (clean slate for parent)
  if (placement.position_id) {
    await adminClient
      .from("connection_requests")
      .update({
        connection_stage: CONNECTION_STAGE.FINISHED,
        status: "expired",
        updated_at: now,
      })
      .eq("position_id", placement.position_id)
      .not(
        "connection_stage",
        "in",
        `(${[
          CONNECTION_STAGE.REQUEST_EXPIRED,
          CONNECTION_STAGE.DECLINED,
          CONNECTION_STAGE.REQUEST_CANCELLED,
          CONNECTION_STAGE.SCHEDULE_EXPIRED,
          CONNECTION_STAGE.CANCELLED_BY_PARENT,
          CONNECTION_STAGE.CANCELLED_BY_NANNY,
          CONNECTION_STAGE.FINISHED,
        ].join(",")})`,
      );
  }

  // 6. Notify the nanny via inbox
  const { data: nannyRecord } = await adminClient
    .from("nannies")
    .select("user_id")
    .eq("id", placement.nanny_id)
    .single();

  if (nannyRecord) {
    const { data: parentRecord } = await adminClient
      .from("parents")
      .select("user_id")
      .eq("id", parentId)
      .single();

    let familyName = "Your employer";
    if (parentRecord) {
      const { data: parentProfile } = await adminClient
        .from("user_profiles")
        .select("last_name")
        .eq("user_id", parentRecord.user_id)
        .single();
      if (parentProfile?.last_name) {
        familyName = `The ${parentProfile.last_name} family`;
      }
    }

    await createInboxMessage({
      userId: nannyRecord.user_id,
      type: "placement_ended",
      title: `${familyName} has ended your placement`,
      body: "This placement has come to an end. You can dismiss this position from your list when ready.",
      actionUrl: "/nanny/positions",
    });
  }

  funnelLog(
    "removeNannyPlacement",
    placementId,
    "COMPLETE — placement ended, position reverted to OPEN",
  );

  revalidatePath("/parent");
  revalidatePath("/nanny/positions");
  return { success: true, error: null };
}

/** Get all placements for nanny's "My Positions" page */
export async function getNannyPlacements(): Promise<{
  data: Array<{
    id: string;
    parentName: string;
    parentLastName: string;
    parentSuburb: string;
    parentPhoto: string | null;
    parentDateOfBirth: string | null;
    weeklyHours: number | null;
    hourlyRate: number | null;
    hiredAt: string;
    startDate: string | null;
    status: string;
    positionId: string | null;
    // Enriched fields
    parentEmail: string | null;
    parentPhone: string | null;
    positionFormData: Record<string, unknown> | null;
    rosterNotes: string | null;
    nannyNotes: string | null;
  }>;
  error: string | null;
}> {
  const adminClient = createAdminClient();

  const nannyInfo = await getNannyId();
  if (!nannyInfo) {
    return { data: [], error: "Not authenticated as nanny" };
  }

  const { data: placements } = await adminClient
    .from("nanny_placements")
    .select(
      "id, parent_id, position_id, weekly_hours, hourly_rate, hired_at, start_date, status, end_notes",
    )
    .eq("nanny_id", nannyInfo.nannyId)
    .order("hired_at", { ascending: false });

  if (!placements || placements.length === 0) {
    return { data: [], error: null };
  }

  // Filter out placements dismissed by the nanny
  const visiblePlacements = placements.filter(
    (p) => !p.end_notes?.includes("[NANNY_DISMISSED]"),
  );

  if (visiblePlacements.length === 0) {
    return { data: [], error: null };
  }

  // Get parent details with contact info
  const parentIds = Array.from(
    new Set(visiblePlacements.map((p) => p.parent_id)),
  );
  const { data: parents } = await adminClient
    .from("parents")
    .select("id, user_id")
    .in("id", parentIds);

  const parentMap = new Map((parents || []).map((p) => [p.id, p]));
  const parentUserIds = (parents || []).map((p) => p.user_id);

  const { data: profiles } = await adminClient
    .from("user_profiles")
    .select(
      "user_id, first_name, last_name, suburb, profile_picture_url, date_of_birth, email, mobile_number",
    )
    .in("user_id", parentUserIds);

  const profileMap = new Map((profiles || []).map((p) => [p.user_id, p]));

  // Get position form data for active placements
  const positionIds = visiblePlacements
    .filter((p) => p.position_id && p.status === "active")
    .map((p) => p.position_id!);

  const positionFormDataMap = new Map<string, Record<string, unknown>>();
  const positionDetailsMap = new Map<string, Record<string, unknown>>();
  const positionSuburbMap = new Map<string, string>();
  if (positionIds.length > 0) {
    const { data: positions } = await adminClient
      .from("nanny_positions")
      .select("id, details, suburb")
      .in("id", positionIds);

    if (positions) {
      for (const pos of positions) {
        const details = pos.details as Record<string, unknown> | null;
        if (details) positionDetailsMap.set(pos.id, details);
        const formData = details?.form_data as Record<string, unknown> | null;
        if (formData) {
          positionFormDataMap.set(pos.id, formData);
        }
        if (pos.suburb) positionSuburbMap.set(pos.id, pos.suburb);
      }
    }
  }

  const result = visiblePlacements.map((p) => {
    const parent = parentMap.get(p.parent_id);
    const profile = parent ? profileMap.get(parent.user_id) : null;
    return {
      id: p.id,
      parentName: profile
        ? `${profile.first_name} ${profile.last_name}`
        : "Unknown",
      parentLastName: profile?.last_name || "",
      parentSuburb:
        (p.position_id ? positionSuburbMap.get(p.position_id) : null) || "",
      parentPhoto: profile?.profile_picture_url || null,
      parentDateOfBirth: profile?.date_of_birth || null,
      weeklyHours: p.weekly_hours,
      hourlyRate: p.hourly_rate,
      hiredAt: p.hired_at,
      startDate: p.start_date,
      status: p.status,
      positionId: p.position_id,
      parentEmail: profile?.email || null,
      parentPhone: profile?.mobile_number || null,
      positionFormData: p.position_id
        ? positionFormDataMap.get(p.position_id) || null
        : null,
      rosterNotes: p.position_id
        ? (positionDetailsMap.get(p.position_id)?.roster_notes as string) ||
          null
        : null,
      nannyNotes: p.position_id
        ? (positionDetailsMap.get(p.position_id)?.nanny_notes as string) || null
        : null,
    };
  });

  return { data: result, error: null };
}

/** Fetch position data for nanny's active placement (for PositionDetailView) */
export async function getPositionForNanny(positionId: string): Promise<{
  data: { formData: Partial<TypeformFormData> } | null;
  error: string | null;
}> {
  const adminClient = createAdminClient();

  const nannyInfo = await getNannyId();
  if (!nannyInfo) {
    return { data: null, error: "Not authenticated as nanny" };
  }

  // Verify nanny has active placement for this position
  const { data: placement } = await adminClient
    .from("nanny_placements")
    .select("id")
    .eq("nanny_id", nannyInfo.nannyId)
    .eq("position_id", positionId)
    .eq("status", "active")
    .maybeSingle();

  if (!placement) {
    return { data: null, error: "No active placement for this position" };
  }

  const { data: position } = await adminClient
    .from("nanny_positions")
    .select("details")
    .eq("id", positionId)
    .single();

  if (!position) {
    return { data: null, error: "Position not found" };
  }

  const details = position.details as Record<string, unknown> | null;
  const formData = (details?.form_data ?? {}) as Partial<TypeformFormData>;

  return { data: { formData }, error: null };
}

/** Save position details as nanny + notify parent */
export async function savePositionAsNanny(
  positionId: string,
  formData: Partial<TypeformFormData>,
): Promise<{ success: boolean; error: string | null }> {
  const adminClient = createAdminClient();

  const nannyInfo = await getNannyId();
  if (!nannyInfo) {
    return { success: false, error: "Not authenticated as nanny" };
  }

  // Verify nanny has active placement for this position
  const { data: placement } = await adminClient
    .from("nanny_placements")
    .select("id, parent_id")
    .eq("nanny_id", nannyInfo.nannyId)
    .eq("position_id", positionId)
    .eq("status", "active")
    .maybeSingle();

  if (!placement) {
    return { success: false, error: "No active placement for this position" };
  }

  // Build position row (same mapping as saveTypeformPosition)
  const positionRow = {
    minimum_age_requirement: formData.minimum_age
      ? parseInt(formData.minimum_age)
      : null,
    years_of_experience: formData.years_of_experience
      ? parseInt(formData.years_of_experience)
      : null,
    hours_per_week: formData.hours_per_week
      ? (HOURS_TO_INT[formData.hours_per_week] ?? null)
      : null,
    drivers_license_required: formData.drivers_license_required === "Yes",
    car_required: formData.car_required === "Yes",
    vaccination_required: false,
    non_smoker_required: false,
    comfortable_with_pets_required: false,
    language_preference: formData.language_preference ?? null,
    language_preference_details: formData.language_preference_details ?? null,
    suburb: formData.suburb ?? null,
    postcode: formData.postcode ?? null,
    schedule_type: formData.schedule_type ?? null,
    urgency: formData.urgency ?? null,
    start_date: formData.start_date ?? null,
    placement_length: formData.placement_length ?? null,
    days_required: formData.weekly_roster ?? [],
    reason_for_nanny: formData.reason_for_nanny
      ? [formData.reason_for_nanny]
      : [],
    details: {
      has_pets_details: formData.has_pets_details ?? null,
      child_needs: formData.child_needs_yn === "Yes",
      child_needs_details: formData.child_needs_details ?? null,
      dietary_restrictions: formData.dietary_restrictions_yn === "Yes",
      dietary_restrictions_details:
        formData.dietary_restrictions_details ?? null,
      focus_type: formData.focus_type ?? null,
      support_type: formData.support_type ?? null,
      placement_duration: formData.placement_duration ?? null,
      hours_per_week_label: formData.hours_per_week ?? null,
      notes: formData.notes ?? null,
      form_data: formData,
    },
  };

  const { error: updateErr } = await adminClient
    .from("nanny_positions")
    .update(positionRow)
    .eq("id", positionId);

  if (updateErr) {
    return { success: false, error: "Failed to update position" };
  }

  // Update children
  await adminClient
    .from("position_children")
    .delete()
    .eq("position_id", positionId);
  const numChildren = formData.num_children ?? 0;
  if (numChildren > 0) {
    const AGE_KEYS = ["child_a_age", "child_b_age", "child_c_age"] as const;
    const GENDER_KEYS = [
      "child_a_gender",
      "child_b_gender",
      "child_c_gender",
    ] as const;
    const childrenRows = Array.from({ length: numChildren }).map((_, i) => ({
      position_id: positionId,
      child_label: ["A", "B", "C"][i],
      age_months:
        AGE_RANGE_TO_MONTHS[
          (formData[AGE_KEYS[i] as keyof TypeformFormData] as string) ?? ""
        ] ?? 0,
      gender:
        (formData[GENDER_KEYS[i] as keyof TypeformFormData] as string) ?? null,
      display_order: i + 1,
    }));
    await adminClient.from("position_children").insert(childrenRows);
  }

  // Update schedule
  const schedule = buildScheduleJson(formData);
  if (Object.keys(schedule).length > 0) {
    await adminClient
      .from("position_schedule")
      .upsert(
        { position_id: positionId, schedule },
        { onConflict: "position_id" },
      );
  }

  // Also sync hourly_rate and weekly_hours to the placement record
  const syncFields: Record<string, unknown> = {};
  if (positionRow.hours_per_week !== null)
    syncFields.weekly_hours = positionRow.hours_per_week;
  // hourly_rate is stored on the position, not derived from hours label
  // Sync hourly rate from the position's hourly_rate column if it exists
  const { data: posAfter } = await adminClient
    .from("nanny_positions")
    .select("hourly_rate, hours_per_week")
    .eq("id", positionId)
    .single();
  if (posAfter) {
    await adminClient
      .from("nanny_placements")
      .update({
        weekly_hours: posAfter.hours_per_week,
        hourly_rate: posAfter.hourly_rate,
      })
      .eq("id", placement.id);
  }

  // Notify parent via inbox
  const { data: parent } = await adminClient
    .from("parents")
    .select("user_id")
    .eq("id", placement.parent_id)
    .single();

  if (parent) {
    // Get nanny name for notification
    const { data: nannyProfile } = await adminClient
      .from("user_profiles")
      .select("first_name")
      .eq("user_id", nannyInfo.userId)
      .single();

    const nannyName = nannyProfile?.first_name || "Your nanny";
    await createInboxMessage({
      userId: parent.user_id,
      type: "position_updated",
      title: `${nannyName} has updated the position details`,
      body: "Your nanny has made changes to the position. Review the updates on your dashboard.",
      actionUrl: "/parent",
    });
  }

  revalidatePath("/nanny/positions");
  revalidatePath("/parent");
  return { success: true, error: null };
}

/** Nanny updates their hourly rate on an active placement */
export async function updateNannyPlacementRate(
  placementId: string,
  newRate: number,
): Promise<{ success: boolean; error?: string }> {
  const adminClient = createAdminClient();
  const nannyInfo = await getNannyId();
  if (!nannyInfo) return { success: false, error: "Not authenticated" };

  if (newRate < 0 || newRate > 999)
    return { success: false, error: "Invalid rate" };

  const { data: placement } = await adminClient
    .from("nanny_placements")
    .select("id")
    .eq("id", placementId)
    .eq("nanny_id", nannyInfo.nannyId)
    .eq("status", "active")
    .single();

  if (!placement) return { success: false, error: "Placement not found" };

  const { error } = await adminClient
    .from("nanny_placements")
    .update({ hourly_rate: newRate })
    .eq("id", placementId);

  if (error) return { success: false, error: error.message };

  revalidatePath("/nanny/positions");
  return { success: true };
}

/** Nanny updates their weekly hours on an active placement */
export async function updateNannyPlacementHours(
  placementId: string,
  newHours: number,
): Promise<{ success: boolean; error?: string }> {
  const adminClient = createAdminClient();
  const nannyInfo = await getNannyId();
  if (!nannyInfo) return { success: false, error: "Not authenticated" };

  if (newHours < 0 || newHours > 168)
    return { success: false, error: "Invalid hours" };

  const { data: placement } = await adminClient
    .from("nanny_placements")
    .select("id")
    .eq("id", placementId)
    .eq("nanny_id", nannyInfo.nannyId)
    .eq("status", "active")
    .single();

  if (!placement) return { success: false, error: "Placement not found" };

  const { error } = await adminClient
    .from("nanny_placements")
    .update({ weekly_hours: newHours })
    .eq("id", placementId);

  if (error) return { success: false, error: error.message };

  revalidatePath("/nanny/positions");
  return { success: true };
}

/** Nanny updates roster notes on the position details JSONB */
export async function updatePositionRosterNotes(
  positionId: string,
  notes: string,
): Promise<{ success: boolean; error?: string }> {
  "use server";
  const adminClient = createAdminClient();
  const nannyInfo = await getNannyId();
  if (!nannyInfo) return { success: false, error: "Not authenticated" };

  // Verify nanny has active placement for this position
  const { data: placement } = await adminClient
    .from("nanny_placements")
    .select("id")
    .eq("nanny_id", nannyInfo.nannyId)
    .eq("position_id", positionId)
    .eq("status", "active")
    .single();

  if (!placement)
    return { success: false, error: "No active placement for this position" };

  // Read current details, merge, write back
  const { data: position } = await adminClient
    .from("nanny_positions")
    .select("details")
    .eq("id", positionId)
    .single();

  const currentDetails = (position?.details as Record<string, unknown>) || {};
  const updatedDetails = { ...currentDetails, roster_notes: notes };

  const { error } = await adminClient
    .from("nanny_positions")
    .update({ details: updatedDetails })
    .eq("id", positionId);

  if (error) return { success: false, error: error.message };
  revalidatePath("/nanny/positions");
  return { success: true };
}

/** Nanny updates their own notes on the position details JSONB */
export async function updatePositionNannyNotes(
  positionId: string,
  notes: string,
): Promise<{ success: boolean; error?: string }> {
  "use server";
  const adminClient = createAdminClient();
  const nannyInfo = await getNannyId();
  if (!nannyInfo) return { success: false, error: "Not authenticated" };

  const { data: placement } = await adminClient
    .from("nanny_placements")
    .select("id")
    .eq("nanny_id", nannyInfo.nannyId)
    .eq("position_id", positionId)
    .eq("status", "active")
    .single();

  if (!placement)
    return { success: false, error: "No active placement for this position" };

  const { data: position } = await adminClient
    .from("nanny_positions")
    .select("details")
    .eq("id", positionId)
    .single();

  const currentDetails = (position?.details as Record<string, unknown>) || {};
  const updatedDetails = { ...currentDetails, nanny_notes: notes };

  const { error } = await adminClient
    .from("nanny_positions")
    .update({ details: updatedDetails })
    .eq("id", positionId);

  if (error) return { success: false, error: error.message };
  revalidatePath("/nanny/positions");
  return { success: true };
}

/** Nanny ends their own placement */
export async function nannyEndPlacement(
  placementId: string,
  endReason: string,
  endNotes?: string,
): Promise<{ success: boolean; error: string | null }> {
  const adminClient = createAdminClient();

  const nannyInfo = await getNannyId();
  if (!nannyInfo) {
    return { success: false, error: "Not authenticated as nanny" };
  }

  // Verify nanny owns this placement
  const { data: placement, error: placementErr } = await adminClient
    .from("nanny_placements")
    .select("id, parent_id, position_id, interview_request_id")
    .eq("id", placementId)
    .eq("nanny_id", nannyInfo.nannyId)
    .eq("status", "active")
    .single();

  funnelLog(
    "nannyEndPlacement",
    placementId,
    `lookup: ${JSON.stringify({ found: !!placement, nannyId: nannyInfo.nannyId, error: placementErr?.message })}`,
  );

  if (!placement) {
    return { success: false, error: "Placement not found." };
  }

  const now = new Date().toISOString();

  // 1. End the placement
  const { error: endErr } = await adminClient
    .from("nanny_placements")
    .update({
      status: "ended",
      ended_at: now,
      end_reason: endReason,
      end_notes: endNotes || null,
      updated_at: now,
    })
    .eq("id", placementId);

  if (endErr) {
    funnelError(
      "nannyEndPlacement",
      placementId,
      `Failed to end placement: ${endErr.message}`,
    );
    return {
      success: false,
      error: `Failed to end placement: ${endErr.message}`,
    };
  }

  funnelLog(
    "nannyEndPlacement",
    placementId,
    "Step 1 done — placement status set to ended",
  );

  // 2. Clear nanny cross-references
  const { error: nannyErr } = await adminClient
    .from("nannies")
    .update({ current_placement_id: null })
    .eq("id", nannyInfo.nannyId);

  if (nannyErr)
    funnelError(
      "nannyEndPlacement",
      placementId,
      `Step 2 nanny clear failed: ${nannyErr.message}`,
    );

  // 3. Clear parent cross-references
  const { error: parentErr } = await adminClient
    .from("parents")
    .update({
      current_nanny_id: null,
      current_placement_id: null,
    })
    .eq("id", placement.parent_id);

  if (parentErr)
    funnelError(
      "nannyEndPlacement",
      placementId,
      `Step 3 parent clear failed: ${parentErr.message}`,
    );

  // 4. Revert position to OPEN so parent can find a new nanny (only if position is still ACTIVE)
  if (placement.position_id) {
    const { error: posRevertErr } = await adminClient
      .from("nanny_positions")
      .update({
        stage: POSITION_STAGE.OPEN,
        position_status: POSITION_STATUS.OPEN,
        status: "active",
        filled_by_nanny_id: null,
        filled_at: null,
        updated_at: now,
      })
      .eq("id", placement.position_id)
      .eq("stage", POSITION_STAGE.ACTIVE);

    if (posRevertErr)
      funnelError(
        "nannyEndPlacement",
        placementId,
        `Step 4 position revert failed: ${posRevertErr.message}`,
      );
  }

  // 5. Terminate ALL connections for this position (clean slate for parent)
  if (placement.position_id) {
    await adminClient
      .from("connection_requests")
      .update({
        connection_stage: CONNECTION_STAGE.FINISHED,
        status: "expired",
        updated_at: now,
      })
      .eq("position_id", placement.position_id)
      .not(
        "connection_stage",
        "in",
        `(${[
          CONNECTION_STAGE.REQUEST_EXPIRED,
          CONNECTION_STAGE.DECLINED,
          CONNECTION_STAGE.REQUEST_CANCELLED,
          CONNECTION_STAGE.SCHEDULE_EXPIRED,
          CONNECTION_STAGE.CANCELLED_BY_PARENT,
          CONNECTION_STAGE.CANCELLED_BY_NANNY,
          CONNECTION_STAGE.FINISHED,
        ].join(",")})`,
      );
  }

  // 6. Notify parent via inbox
  const { data: parent } = await adminClient
    .from("parents")
    .select("user_id")
    .eq("id", placement.parent_id)
    .single();

  if (parent) {
    const { data: nannyProfile } = await adminClient
      .from("user_profiles")
      .select("first_name")
      .eq("user_id", nannyInfo.userId)
      .single();

    const nannyName = nannyProfile?.first_name || "Your nanny";
    await createInboxMessage({
      userId: parent.user_id,
      type: "placement_ended",
      title: `${nannyName} has ended their placement`,
      body: "Your nanny is no longer available. Your childcare position remains active so we can help you find a new match.",
      actionUrl: "/parent",
    });
  }

  funnelLog(
    "nannyEndPlacement",
    placementId,
    "COMPLETE — placement ended, position reverted to OPEN",
  );

  revalidatePath("/nanny/positions");
  revalidatePath("/parent");
  return { success: true, error: null };
}

/** Nanny dismisses an ended placement from their list */
export async function nannyDismissPlacement(
  placementId: string,
): Promise<{ success: boolean; error: string | null }> {
  const adminClient = createAdminClient();

  const nannyInfo = await getNannyId();
  if (!nannyInfo) {
    return { success: false, error: "Not authenticated as nanny" };
  }

  // Mark as dismissed by appending marker to end_notes (no schema change needed)
  const { data: placement } = await adminClient
    .from("nanny_placements")
    .select("end_notes")
    .eq("id", placementId)
    .eq("nanny_id", nannyInfo.nannyId)
    .eq("status", "ended")
    .single();

  if (!placement) {
    return { success: false, error: "Placement not found." };
  }

  const { error: updateErr } = await adminClient
    .from("nanny_placements")
    .update({ end_notes: `${placement.end_notes || ""}[NANNY_DISMISSED]` })
    .eq("id", placementId)
    .eq("nanny_id", nannyInfo.nannyId)
    .eq("status", "ended");

  if (updateErr) {
    return { success: false, error: "Failed to dismiss placement." };
  }

  revalidatePath("/nanny/positions");
  return { success: true, error: null };
}

/** Get post-intro connections for Path B nanny picker */
export async function getConfirmedConnections(positionId: string): Promise<{
  data: Array<{
    connectionId: string;
    nannyId: string;
    nannyName: string;
    nannySuburb: string;
    nannyPhoto: string | null;
    connectionStage: number;
    confirmedTime: string | null;
  }>;
  error: string | null;
}> {
  const adminClient = createAdminClient();

  const parentId = await getParentId();
  if (!parentId) {
    return { data: [], error: "Not authenticated as parent" };
  }

  // Verify position ownership
  const { data: position } = await adminClient
    .from("nanny_positions")
    .select("id")
    .eq("id", positionId)
    .eq("parent_id", parentId)
    .single();

  if (!position) {
    return { data: [], error: "Position not found." };
  }

  // Get connections where an intro time has been confirmed (phone number revealed)
  // Excludes REQUEST_SENT and ACCEPTED (pre-intro, no phone number yet)
  const { data: connections } = await adminClient
    .from("connection_requests")
    .select("id, nanny_id, connection_stage, confirmed_time")
    .eq("position_id", positionId)
    .gte("connection_stage", CONNECTION_STAGE.INTRO_SCHEDULED)
    .not(
      "connection_stage",
      "in",
      `(${CONNECTION_STAGE.NOT_HIRED},${CONNECTION_STAGE.NOT_SELECTED},${CONNECTION_STAGE.FINISHED},${CONNECTION_STAGE.ACTIVE},${CONNECTION_STAGE.CANCELLED_BY_PARENT},${CONNECTION_STAGE.CANCELLED_BY_NANNY})`,
    );

  if (!connections || connections.length === 0) {
    return { data: [], error: null };
  }

  // Get nanny details
  const nannyIds = Array.from(new Set(connections.map((c) => c.nanny_id)));
  const { data: nannies } = await adminClient
    .from("nannies")
    .select("id, user_id")
    .in("id", nannyIds);

  const nannyMap = new Map((nannies || []).map((n) => [n.id, n]));
  const nannyUserIds = (nannies || []).map((n) => n.user_id);

  const { data: profiles } = await adminClient
    .from("user_profiles")
    .select("user_id, first_name, last_name, suburb, profile_picture_url")
    .in("user_id", nannyUserIds);

  const profileMap = new Map((profiles || []).map((p) => [p.user_id, p]));

  // Deduplicate: keep only the most advanced connection per nanny
  const bestByNanny = new Map<string, (typeof connections)[number]>();
  for (const c of connections) {
    const existing = bestByNanny.get(c.nanny_id);
    if (!existing || c.connection_stage > existing.connection_stage) {
      bestByNanny.set(c.nanny_id, c);
    }
  }

  const result = Array.from(bestByNanny.values()).map((c) => {
    const nanny = nannyMap.get(c.nanny_id);
    const profile = nanny ? profileMap.get(nanny.user_id) : null;
    return {
      connectionId: c.id,
      nannyId: c.nanny_id,
      nannyName: profile
        ? `${profile.first_name} ${profile.last_name}`
        : "Unknown",
      nannySuburb: profile?.suburb || "",
      nannyPhoto: profile?.profile_picture_url || null,
      connectionStage: c.connection_stage,
      confirmedTime: c.confirmed_time,
    };
  });

  return { data: result, error: null };
}

// ════════════════════════════════════════════════════════════
// 10. UPCOMING INTROS (for My Positions / My Childcare)
// ════════════════════════════════════════════════════════════

interface PositionSummary {
  scheduleType: string | null;
  hoursPerWeek: number | null;
  daysRequired: string[] | null;
  schedule: Record<string, string[]> | null;
  levelOfSupport: string[] | null;
  hourlyRate: number | null;
  children: { ageMonths: number; gender: string | null }[];
  urgency: string | null;
  startDate: string | null;
  placementLength: string | null;
  reasonForNanny: string[] | null;
  languagePreference: string | null;
  languagePreferenceDetails: string | null;
  qualificationRequirement: string | null;
  certificateRequirements: string[] | null;
  vaccinationRequired: boolean | null;
  driversLicenseRequired: boolean | null;
  carRequired: boolean | null;
  comfortableWithPetsRequired: boolean | null;
  nonSmokerRequired: boolean | null;
  otherRequirements: string | null;
  suburb: string | null;
  description: string | null;
  yearsOfExperience: number | null;
  focusType: string | null;
  supportType: string | null;
  childNeeds: boolean;
  childNeedsDetails: string | null;
  source: string | null;
}

/** Note: "intro" in code = "Meet and Greet" in user-facing UI */
export interface UpcomingIntro {
  connectionId: string;
  otherPartyName: string;
  otherPartySuburb: string;
  otherPartyPhoto: string | null;
  confirmedTime: string;
  connectionStage: number;
  fillInitiatedBy: string | null;
  trialDate: string | null;
  startDate: string | null;
  status: string | null;
  proposedTimes: string[] | null;
  message: string | null;
  expiresAt: string | null;
  nannyPhoneShared: string | null;
  positionId: string | null;
  position: PositionSummary | null;
  source: string | null;
  nannyId: string | null;
}

/** Get upcoming/active meets for nanny's "My Positions" page (internal code uses "intro") */
export async function getNannyUpcomingIntros(): Promise<{
  data: UpcomingIntro[];
  error: string | null;
}> {
  const adminClient = createAdminClient();

  const nannyInfo = await getNannyId();
  if (!nannyInfo) {
    return { data: [], error: "Not authenticated as nanny" };
  }

  // Fire lazy triggers — auto-advance past intros and trials
  await checkPostIntroOutcomes(adminClient, { nanny_id: nannyInfo.nannyId });
  await checkPostTrialOutcomes(adminClient, { nanny_id: nannyInfo.nannyId });

  const { data: connections } = await adminClient
    .from("connection_requests")
    .select(
      "id, parent_id, position_id, connection_stage, confirmed_time, fill_initiated_by, trial_date, start_date, status, proposed_times, message, expires_at, nanny_phone_shared, source",
    )
    .eq("nanny_id", nannyInfo.nannyId)
    .in("connection_stage", [
      CONNECTION_STAGE.REQUEST_SENT,
      CONNECTION_STAGE.NANNY_APPLIED_PENDING,
      CONNECTION_STAGE.NANNY_APPLIED,
      CONNECTION_STAGE.ACCEPTED_PENDING,
      CONNECTION_STAGE.ACCEPTED,
      CONNECTION_STAGE.INTRO_SCHEDULED,
      CONNECTION_STAGE.INTRO_COMPLETE,
      CONNECTION_STAGE.AWAITING_RESPONSE,
      CONNECTION_STAGE.TRIAL_ARRANGED,
      CONNECTION_STAGE.TRIAL_COMPLETE,
      CONNECTION_STAGE.OFFERED,
      CONNECTION_STAGE.CONFIRMED,
      CONNECTION_STAGE.NOT_HIRED,
    ])
    .order("created_at", { ascending: false });

  if (!connections || connections.length === 0) {
    return { data: [], error: null };
  }

  // Fetch parent profiles
  const parentIds = Array.from(new Set(connections.map((c) => c.parent_id)));
  const { data: parents } = await adminClient
    .from("parents")
    .select("id, user_id")
    .in("id", parentIds);

  const parentMap = new Map((parents || []).map((p) => [p.id, p]));
  const parentUserIds = (parents || []).map((p) => p.user_id);

  const { data: profiles } = await adminClient
    .from("user_profiles")
    .select("user_id, first_name, last_name, suburb, profile_picture_url")
    .in("user_id", parentUserIds);

  const profileMap = new Map((profiles || []).map((p) => [p.user_id, p]));

  // Fetch position data for connections that have a position_id
  const positionIds = Array.from(
    new Set(connections.map((c) => c.position_id).filter(Boolean)),
  );
  const positionMap = new Map<string, PositionSummary>();
  const positionDisplayNameMap = new Map<string, string>();
  if (positionIds.length > 0) {
    const { data: positions } = await adminClient
      .from("nanny_positions")
      .select(
        "id, schedule_type, hours_per_week, days_required, level_of_support, hourly_rate, urgency, start_date, placement_length, reason_for_nanny, language_preference, language_preference_details, qualification_requirement, certificate_requirements, vaccination_required, drivers_license_required, car_required, comfortable_with_pets_required, non_smoker_required, other_requirements_details, description, parent_id, suburb, family_display_name, years_of_experience, details, source",
      )
      .in("id", positionIds);

    if (positions) {
      // Build display-name fallback map for admin-created positions
      for (const pos of positions) {
        if (pos.family_display_name) {
          positionDisplayNameMap.set(pos.id, pos.family_display_name);
        }
      }
      // Fetch children for all positions
      const { data: allChildren } = await adminClient
        .from("position_children")
        .select("position_id, age_months, gender")
        .in("position_id", positionIds)
        .order("display_order");

      const childrenByPosition = new Map<
        string,
        { ageMonths: number; gender: string | null }[]
      >();
      for (const child of allChildren || []) {
        const arr = childrenByPosition.get(child.position_id) || [];
        arr.push({ ageMonths: child.age_months, gender: child.gender });
        childrenByPosition.set(child.position_id, arr);
      }

      // Fetch schedule (time brackets) for all positions
      const { data: scheduleRows } = await adminClient
        .from("position_schedule")
        .select("position_id, schedule")
        .in("position_id", positionIds);

      const scheduleByPosition = new Map<string, Record<string, string[]>>(
        (scheduleRows || []).map((s) => [
          s.position_id,
          s.schedule as Record<string, string[]>,
        ]),
      );

      for (const pos of positions) {
        const details = pos.details as Record<string, unknown> | null;
        positionMap.set(pos.id, {
          scheduleType: pos.schedule_type,
          hoursPerWeek: pos.hours_per_week,
          daysRequired: pos.days_required,
          schedule: scheduleByPosition.get(pos.id) || null,
          levelOfSupport: pos.level_of_support,
          hourlyRate: pos.hourly_rate,
          children: childrenByPosition.get(pos.id) || [],
          urgency: pos.urgency,
          startDate: pos.start_date,
          placementLength: pos.placement_length,
          reasonForNanny: pos.reason_for_nanny,
          languagePreference: pos.language_preference,
          languagePreferenceDetails: pos.language_preference_details ?? null,
          qualificationRequirement: pos.qualification_requirement,
          certificateRequirements: pos.certificate_requirements,
          vaccinationRequired: pos.vaccination_required,
          driversLicenseRequired: pos.drivers_license_required,
          carRequired: pos.car_required,
          comfortableWithPetsRequired: pos.comfortable_with_pets_required,
          nonSmokerRequired: pos.non_smoker_required,
          otherRequirements: pos.other_requirements_details,
          suburb: pos.suburb || null,
          description: pos.description,
          yearsOfExperience: pos.years_of_experience
            ? Number(pos.years_of_experience)
            : null,
          focusType: (details?.focus_type as string) ?? null,
          supportType: (details?.support_type as string) ?? null,
          childNeeds: !!details?.child_needs,
          childNeedsDetails: (details?.child_needs_details as string) ?? null,
          source: pos.source ?? null,
        });
      }
    }
  }

  const result: UpcomingIntro[] = connections.map((c) => {
    const parent = parentMap.get(c.parent_id);
    const profile = parent ? profileMap.get(parent.user_id) : null;
    const isSelfReference = parent?.user_id === nannyInfo.userId;
    const displayName = c.position_id
      ? positionDisplayNameMap.get(c.position_id)
      : null;
    // Prefer family_display_name when set, or when parent resolves to nanny's own profile
    const otherPartyName = displayName
      ? displayName
      : profile?.last_name && !isSelfReference
        ? `${profile.last_name} Family`
        : "Family";
    return {
      connectionId: c.id,
      otherPartyName,
      otherPartySuburb:
        (c.position_id ? positionMap.get(c.position_id)?.suburb : null) || "",
      otherPartyPhoto: isSelfReference
        ? null
        : profile?.profile_picture_url || null,
      confirmedTime: c.confirmed_time || "",
      connectionStage: c.connection_stage,
      fillInitiatedBy: c.fill_initiated_by ?? null,
      trialDate: c.trial_date ?? null,
      startDate: c.start_date ?? null,
      status: c.status,
      proposedTimes: c.proposed_times ?? null,
      message: c.message ?? null,
      expiresAt: c.expires_at ?? null,
      nannyPhoneShared: c.nanny_phone_shared ?? null,
      positionId: c.position_id ?? null,
      position: c.position_id ? (positionMap.get(c.position_id) ?? null) : null,
      source: c.source ?? null,
      nannyId: null,
    };
  });

  return { data: result, error: null };
}

/** Get upcoming/active meets for parent's "My Childcare" page (internal code uses "intro") */
export async function getParentUpcomingIntros(): Promise<{
  data: UpcomingIntro[];
  error: string | null;
}> {
  const adminClient = createAdminClient();

  const parentId = await getParentId();
  if (!parentId) {
    return { data: [], error: "Not authenticated as parent" };
  }

  // Fire lazy triggers — auto-advance past intros and trials
  await checkPostIntroOutcomes(adminClient, { parent_id: parentId });
  await checkPostTrialOutcomes(adminClient, { parent_id: parentId });

  const { data: connections } = await adminClient
    .from("connection_requests")
    .select(
      "id, nanny_id, connection_stage, confirmed_time, fill_initiated_by, trial_date, start_date, status, proposed_times, message, expires_at, nanny_phone_shared, source",
    )
    .eq("parent_id", parentId)
    .in("connection_stage", [
      CONNECTION_STAGE.REQUEST_SENT,
      CONNECTION_STAGE.ACCEPTED,
      CONNECTION_STAGE.INTRO_SCHEDULED,
      CONNECTION_STAGE.INTRO_COMPLETE,
      CONNECTION_STAGE.AWAITING_RESPONSE,
      CONNECTION_STAGE.TRIAL_ARRANGED,
      CONNECTION_STAGE.TRIAL_COMPLETE,
      CONNECTION_STAGE.OFFERED,
      CONNECTION_STAGE.CONFIRMED,
      CONNECTION_STAGE.ACTIVE,
    ])
    .order("created_at", { ascending: false });

  if (!connections || connections.length === 0) {
    return { data: [], error: null };
  }

  const nannyIds = Array.from(new Set(connections.map((c) => c.nanny_id)));
  const { data: nannies } = await adminClient
    .from("nannies")
    .select("id, user_id")
    .in("id", nannyIds);

  const nannyMap = new Map((nannies || []).map((n) => [n.id, n]));
  const nannyUserIds = (nannies || []).map((n) => n.user_id);

  const { data: profiles } = await adminClient
    .from("user_profiles")
    .select("user_id, first_name, last_name, suburb, profile_picture_url")
    .in("user_id", nannyUserIds);

  const profileMap = new Map((profiles || []).map((p) => [p.user_id, p]));

  const result: UpcomingIntro[] = connections.map((c) => {
    const nanny = nannyMap.get(c.nanny_id);
    const profile = nanny ? profileMap.get(nanny.user_id) : null;
    return {
      connectionId: c.id,
      otherPartyName: profile
        ? `${profile.first_name} ${profile.last_name}`
        : "Unknown",
      otherPartySuburb: profile?.suburb || "",
      otherPartyPhoto: profile?.profile_picture_url || null,
      confirmedTime: c.confirmed_time || "",
      connectionStage: c.connection_stage,
      fillInitiatedBy: c.fill_initiated_by ?? null,
      trialDate: c.trial_date ?? null,
      startDate: c.start_date ?? null,
      status: c.status,
      proposedTimes: c.proposed_times ?? null,
      message: c.message ?? null,
      expiresAt: c.expires_at ?? null,
      nannyPhoneShared: c.nanny_phone_shared ?? null,
      source: c.source ?? null,
      nannyId: c.nanny_id,
      positionId: null,
      position: null, // Parent doesn't need position data (it's their own)
    };
  });

  return { data: result, error: null };
}

// ════════════════════════════════════════════════════════════
// 11. PARENT OUTCOME REPORTING
// ════════════════════════════════════════════════════════════

export async function reportParentOutcome(
  requestId: string,
  outcome: "hired" | "not_hired" | "awaiting" | "trial",
  dateValue?: string,
): Promise<{ success: boolean; error: string | null }> {
  const adminClient = createAdminClient();

  const parentId = await getParentId();
  if (!parentId) {
    return { success: false, error: "Not authenticated as parent" };
  }

  const { data: req, error: fetchErr } = await adminClient
    .from("connection_requests")
    .select(
      "id, parent_id, nanny_id, position_id, connection_stage, confirmed_time",
    )
    .eq("id", requestId)
    .eq("parent_id", parentId)
    .single();

  if (fetchErr || !req) {
    return { success: false, error: "Connection request not found." };
  }

  const validStages = [
    CONNECTION_STAGE.INTRO_SCHEDULED,
    CONNECTION_STAGE.INTRO_COMPLETE,
    CONNECTION_STAGE.AWAITING_RESPONSE,
    CONNECTION_STAGE.TRIAL_COMPLETE,
    CONNECTION_STAGE.TRIAL_ARRANGED,
  ];
  if (!validStages.includes(req.connection_stage)) {
    return {
      success: false,
      error: `Cannot report outcome from stage ${req.connection_stage}.`,
    };
  }

  const now = new Date().toISOString();
  const parties = await getConnectionParties(
    adminClient,
    req.parent_id,
    req.nanny_id,
  );

  if (outcome === "hired") {
    const updateData: Record<string, unknown> = {
      connection_stage: CONNECTION_STAGE.OFFERED,
      fill_initiated_by: "parent",
      intro_outcome_reported_at: now,
      updated_at: now,
    };
    if (dateValue) updateData.start_date = dateValue;

    const { error: updateErr, count } = await adminClient
      .from("connection_requests")
      .update(updateData, { count: "exact" })
      .eq("id", requestId)
      .eq("connection_stage", req.connection_stage);

    if (updateErr || count === 0) {
      return {
        success: false,
        error:
          "Connection was modified by another action. Please refresh and try again.",
      };
    }

    funnelLog(
      "parent-outcome",
      requestId,
      `${req.connection_stage} → 33 (hired, parent-initiated)`,
      { startDate: dateValue },
    );

    if (parties.nannyUserId) {
      await createInboxMessage({
        userId: parties.nannyUserId,
        type: "position_offered",
        title: `Great news! ${parties.parentName} has selected you`,
        body: `${parties.parentName} would like you for their nanny position. Please confirm to get started.`,
        actionUrl: "/nanny/positions",
        referenceId: requestId,
        referenceType: "connection_request",
      });

      const nannyEmail = await getUserEmailInfo(parties.nannyUserId);
      if (nannyEmail) {
        sendEmail({
          to: nannyEmail.email,
          subject: `Great news! ${parties.parentName} has selected you`,
          html: `<div style="${baseStyle}">
            <h1 style="color: #8B5CF6; font-size: 24px; margin-bottom: 16px;">Baby Bloom Sydney</h1>
            <p style="color: #374151; font-size: 16px; line-height: 1.6;">We're delighted to share that ${parties.parentName} would like you for their nanny position. Please confirm to get started.</p>
            <p style="margin-top: 24px;"><a href="${appUrl}/nanny/positions" style="${btnStyle}">View in My Positions</a></p>
          </div>`,
          emailType: "position_offered",
          recipientUserId: parties.nannyUserId,
        }).catch((err) => console.error("[ParentOutcome] email error:", err));
      }
    }

    revalidatePath("/parent");
    revalidatePath("/nanny/positions");
    return { success: true, error: null };
  }

  if (outcome === "not_hired") {
    const { error: updateErr, count } = await adminClient
      .from("connection_requests")
      .update(
        {
          connection_stage: CONNECTION_STAGE.NOT_HIRED,
          intro_outcome_reported_at: now,
          updated_at: now,
        },
        { count: "exact" },
      )
      .eq("id", requestId)
      .eq("connection_stage", req.connection_stage);

    if (updateErr || count === 0) {
      return {
        success: false,
        error:
          "Connection was modified by another action. Please refresh and try again.",
      };
    }

    funnelLog(
      "parent-outcome",
      requestId,
      `${req.connection_stage} → 35 (not_hired)`,
    );

    if (parties.nannyUserId) {
      await createInboxMessage({
        userId: parties.nannyUserId,
        type: "not_hired",
        title: "Update on your connection",
        body: `${parties.parentName} has decided to go in a different direction. Thank you for your time.`,
        actionUrl: "/nanny/positions",
        referenceId: requestId,
        referenceType: "connection_request",
      });
    }

    revalidatePath("/parent");
    revalidatePath("/nanny/positions");
    return { success: true, error: null };
  }

  if (outcome === "trial") {
    // Validate trial date is not before the intro call date
    if (dateValue && req.confirmed_time) {
      const introDay = req.confirmed_time.split("T")[0];
      if (dateValue < introDay) {
        return {
          success: false,
          error: "Trial date cannot be before the meet and greet date.",
        };
      }
    }

    // Parent-reported trial: immediately confirmed (parent is the authority)
    const updateData: Record<string, unknown> = {
      connection_stage: CONNECTION_STAGE.TRIAL_ARRANGED,
      fill_initiated_by: null,
      intro_outcome_reported_at: now,
      updated_at: now,
    };
    if (dateValue) updateData.trial_date = dateValue;

    const { error: updateErr, count } = await adminClient
      .from("connection_requests")
      .update(updateData, { count: "exact" })
      .eq("id", requestId)
      .eq("connection_stage", req.connection_stage);

    if (updateErr || count === 0) {
      return {
        success: false,
        error:
          "Connection was modified by another action. Please refresh and try again.",
      };
    }

    funnelLog(
      "parent-outcome",
      requestId,
      `${req.connection_stage} → 31 (trial, confirmed)`,
      { trialDate: dateValue },
    );

    if (parties.nannyUserId) {
      await createInboxMessage({
        userId: parties.nannyUserId,
        type: "trial_arranged",
        title: "Trial shift arranged!",
        body: `${parties.parentName} has arranged a trial shift${dateValue ? ` on ${dateValue}` : ""}. Good luck!`,
        actionUrl: "/nanny/positions",
        referenceId: requestId,
        referenceType: "connection_request",
      });
    }

    revalidatePath("/parent");
    revalidatePath("/nanny/positions");
    return { success: true, error: null };
  }

  if (outcome === "awaiting") {
    const { error: updateErr, count } = await adminClient
      .from("connection_requests")
      .update(
        {
          connection_stage: CONNECTION_STAGE.AWAITING_RESPONSE,
          updated_at: now,
        },
        { count: "exact" },
      )
      .eq("id", requestId)
      .eq("connection_stage", req.connection_stage);

    if (updateErr || count === 0) {
      return {
        success: false,
        error:
          "Connection was modified by another action. Please refresh and try again.",
      };
    }

    funnelLog(
      "parent-outcome",
      requestId,
      `${req.connection_stage} → 30 (awaiting)`,
    );
    revalidatePath("/parent");
    return { success: true, error: null };
  }

  return { success: false, error: "Invalid outcome." };
}

// ════════════════════════════════════════════════════════════
// 12. REJECT HIRED CLAIM
// ════════════════════════════════════════════════════════════

export async function rejectHiredClaim(
  requestId: string,
): Promise<{ success: boolean; error: string | null }> {
  const adminClient = createAdminClient();

  const parentId = await getParentId();
  if (!parentId) {
    return { success: false, error: "Not authenticated as parent" };
  }

  const { data: req, error: fetchErr } = await adminClient
    .from("connection_requests")
    .select("id, parent_id, nanny_id, connection_stage, fill_initiated_by")
    .eq("id", requestId)
    .eq("parent_id", parentId)
    .single();

  if (fetchErr || !req) {
    return { success: false, error: "Connection request not found." };
  }

  if (
    req.connection_stage !== CONNECTION_STAGE.OFFERED ||
    req.fill_initiated_by !== "nanny"
  ) {
    return {
      success: false,
      error: "This connection is not in a state that can be rejected.",
    };
  }

  const now = new Date().toISOString();

  const { error: updateErr, count } = await adminClient
    .from("connection_requests")
    .update(
      {
        connection_stage: CONNECTION_STAGE.NOT_HIRED,
        fill_initiated_by: null,
        updated_at: now,
      },
      { count: "exact" },
    )
    .eq("id", requestId)
    .eq("connection_stage", CONNECTION_STAGE.OFFERED);

  if (updateErr || count === 0) {
    return {
      success: false,
      error:
        "Connection was modified by another action. Please refresh and try again.",
    };
  }

  funnelLog(
    "reject-claim",
    requestId,
    "33 → 35 (parent rejected nanny hired claim — disconnected)",
  );

  // PINB-024: Notify nanny (inbox only — bad news)
  const parties = await getConnectionParties(
    adminClient,
    req.parent_id,
    req.nanny_id,
  );
  if (parties.nannyUserId) {
    await createInboxMessage({
      userId: parties.nannyUserId,
      type: "hired_claim_rejected",
      title: "Update on your connection",
      body: `The ${parties.parentName} family has decided to go in a different direction. Keep an eye out for new opportunities.`,
      actionUrl: "/nanny/positions",
      referenceId: requestId,
      referenceType: "connection_request",
    });
  }

  revalidatePath("/parent");
  revalidatePath("/nanny/positions");
  return { success: true, error: null };
}

// ════════════════════════════════════════════════════════════
// 12b. REVERT TO AWAITING (parent hasn't decided yet)
// ════════════════════════════════════════════════════════════

export async function revertToAwaiting(
  requestId: string,
): Promise<{ success: boolean; error: string | null }> {
  const adminClient = createAdminClient();

  const parentId = await getParentId();
  if (!parentId) {
    return { success: false, error: "Not authenticated as parent" };
  }

  const { data: req, error: fetchErr } = await adminClient
    .from("connection_requests")
    .select("id, parent_id, nanny_id, connection_stage, fill_initiated_by")
    .eq("id", requestId)
    .eq("parent_id", parentId)
    .single();

  if (fetchErr || !req) {
    return { success: false, error: "Connection request not found." };
  }

  if (
    req.connection_stage !== CONNECTION_STAGE.OFFERED ||
    req.fill_initiated_by !== "nanny"
  ) {
    return {
      success: false,
      error: "This connection is not in a state that can be reverted.",
    };
  }

  const now = new Date().toISOString();
  const parties = await getConnectionParties(
    adminClient,
    req.parent_id,
    req.nanny_id,
  );

  const { error: updateErr, count } = await adminClient
    .from("connection_requests")
    .update(
      {
        connection_stage: CONNECTION_STAGE.AWAITING_RESPONSE,
        fill_initiated_by: null,
        updated_at: now,
      },
      { count: "exact" },
    )
    .eq("id", requestId)
    .eq("connection_stage", CONNECTION_STAGE.OFFERED);

  if (updateErr || count === 0) {
    return {
      success: false,
      error:
        "Connection was modified by another action. Please refresh and try again.",
    };
  }

  funnelLog(
    "revert-to-awaiting",
    requestId,
    "33 → 30 (parent hasn't decided yet)",
  );

  if (parties.nannyUserId) {
    await createInboxMessage({
      userId: parties.nannyUserId,
      type: "claim_rejected",
      title: "Update on your connection",
      body: `${parties.parentName} has indicated they haven't made a decision yet. We'll keep you updated.`,
      actionUrl: "/nanny/positions",
      referenceId: requestId,
      referenceType: "connection_request",
    });
  }

  revalidatePath("/parent");
  revalidatePath("/nanny/positions");
  return { success: true, error: null };
}

// ════════════════════════════════════════════════════════════
// 13. CLOSE POSITION (external hire / no longer needed)
// ════════════════════════════════════════════════════════════

export async function closePositionWithReason(
  reason: "found_elsewhere" | "no_longer_needed",
): Promise<{ success: boolean; error: string | null }> {
  const adminClient = createAdminClient();

  const parentId = await getParentId();
  if (!parentId) {
    return { success: false, error: "Not authenticated as parent" };
  }

  const { data: position } = await adminClient
    .from("nanny_positions")
    .select("id, status, stage")
    .eq("parent_id", parentId)
    .in("status", ["active", "filled"])
    .maybeSingle();

  if (!position) {
    return { success: false, error: "No active position found." };
  }

  if (position.status === "filled") {
    return {
      success: false,
      error:
        "Cannot close a position with an active placement. End the placement first.",
    };
  }

  const now = new Date().toISOString();
  const statusCode =
    reason === "found_elsewhere"
      ? POSITION_STATUS.CLOSED
      : POSITION_STATUS.CLOSED_NO_CANDIDATES;

  // End all active connections as NOT_HIRED (nannies see encouraging message)
  const { data: activeConns } = await adminClient
    .from("connection_requests")
    .select("id")
    .eq("position_id", position.id)
    .not(
      "connection_stage",
      "in",
      `(${CONNECTION_STAGE.NOT_HIRED},${CONNECTION_STAGE.NOT_SELECTED},${CONNECTION_STAGE.DECLINED},${CONNECTION_STAGE.REQUEST_EXPIRED},${CONNECTION_STAGE.SCHEDULE_EXPIRED},${CONNECTION_STAGE.REQUEST_CANCELLED},${CONNECTION_STAGE.CANCELLED_BY_PARENT},${CONNECTION_STAGE.CANCELLED_BY_NANNY})`,
    );

  for (const conn of activeConns || []) {
    const { error: connErr } = await adminClient
      .from("connection_requests")
      .update({
        connection_stage: CONNECTION_STAGE.NOT_HIRED,
        status: "expired",
        updated_at: now,
      })
      .eq("id", conn.id);

    if (connErr) {
      console.warn(
        `[closePositionWithReason] Failed to close connection ${conn.id}:`,
        connErr.message,
      );
    }
  }

  // Close position — set stage to CLOSED + position_status + legacy status
  const { error: posErr } = await adminClient
    .from("nanny_positions")
    .update({
      stage: POSITION_STAGE.CLOSED,
      position_status: statusCode,
      status: "cancelled",
      updated_at: now,
    })
    .eq("id", position.id);

  if (posErr) {
    console.warn(
      `[closePositionWithReason] Failed to update position ${position.id}:`,
      posErr.message,
    );
  }

  // Expire all remaining DFY notifications for this position
  await adminClient
    .from("dfy_match_notifications")
    .update({ status: "expired", updated_at: now })
    .eq("position_id", position.id)
    .in("status", ["notified", "viewed", "interested", "pending_wave"]);

  funnelLog(
    "close-position",
    position.id,
    `connections ended (${reason}), position closed`,
    { connectionsClosedCount: activeConns?.length || 0 },
  );

  revalidatePath("/parent");
  revalidatePath("/nanny/positions");
  return { success: true, error: null };
}

// ── Schedule meet and greet time (internal code uses "intro") ──

export async function scheduleIntroTime(
  requestId: string,
  isoTime: string,
): Promise<{ success: boolean; error: string | null }> {
  // Parse ISO time back to a local date/hour/minute
  const dt = new Date(isoTime);
  const parts = new Intl.DateTimeFormat(APP_LOCALE, {
    timeZone: APP_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(dt);

  const year = parts.find((p) => p.type === "year")!.value;
  const month = parts.find((p) => p.type === "month")!.value;
  const day = parts.find((p) => p.type === "day")!.value;
  const hour = parseInt(parts.find((p) => p.type === "hour")!.value, 10);
  const minute = parseInt(parts.find((p) => p.type === "minute")!.value, 10);

  return scheduleConnectionTime(
    requestId,
    `${year}-${month}-${day}`,
    hour,
    minute,
  );
}

// ── Nanny dismiss ended connection ──

export async function nannyDismissConnection(
  requestId: string,
): Promise<{ success: boolean; error: string | null }> {
  const adminClient = createAdminClient();

  const nannyInfo = await getNannyId();
  if (!nannyInfo) {
    return { success: false, error: "Not authenticated as nanny" };
  }

  const { error: updateErr } = await adminClient
    .from("connection_requests")
    .update({
      connection_stage: CONNECTION_STAGE.NOT_SELECTED,
      updated_at: new Date().toISOString(),
    })
    .eq("id", requestId)
    .eq("nanny_id", nannyInfo.nannyId)
    .eq("connection_stage", CONNECTION_STAGE.NOT_HIRED);

  if (updateErr) {
    return { success: false, error: "Failed to dismiss connection." };
  }

  funnelLog("nanny-dismiss", requestId, "35 → 36 (nanny dismissed)");

  revalidatePath("/nanny/positions");
  return { success: true, error: null };
}

// ── Update start week on a connection ──

export async function updateConnectionStartWeek(
  requestId: string,
  startDate: string,
): Promise<{ success: boolean; error: string | null }> {
  const adminClient = createAdminClient();

  const parentId = await getParentId();
  if (!parentId) {
    return { success: false, error: "Not authenticated as parent" };
  }

  const { error: updateErr } = await adminClient
    .from("connection_requests")
    .update({
      start_date: startDate,
      updated_at: new Date().toISOString(),
    })
    .eq("id", requestId)
    .eq("parent_id", parentId)
    .in("connection_stage", [
      CONNECTION_STAGE.OFFERED,
      CONNECTION_STAGE.CONFIRMED,
      CONNECTION_STAGE.ACTIVE,
    ]);

  if (updateErr) {
    return { success: false, error: "Failed to update start week." };
  }

  funnelLog("update-start-week", requestId, `start_date → ${startDate}`);

  revalidatePath("/parent");
  revalidatePath("/nanny/positions");
  return { success: true, error: null };
}
