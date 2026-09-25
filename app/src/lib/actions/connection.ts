"use server";

import { createClient } from "@/lib/supabase/server";
import { CONNECTION_ERRORS } from "./connection-errors";
import { createAdminClient } from "@/lib/supabase/admin";
import { revalidatePath } from "next/cache";
import { getParentId } from "./parent";
import {
  getNannyPhone,
  getPositionSummary,
  createInboxMessage,
  logConnectionEvent,
} from "./connection-helpers";
import { sendEmail } from "@/lib/email/resend";
import { getUserEmailInfo } from "@/lib/email/helpers";
import {
  localToUTC,
  BRACKET_KEYS,
  TIME_BRACKETS,
  getBracketForHour,
  formatLondonDate,
} from "@/lib/timezone";
import type { BracketKey } from "@/lib/timezone";
import {
  CONNECTION_STAGE,
  POSITION_STAGE,
  POSITION_STATUS,
  HIDDEN_CONNECTION_STAGES,
} from "@/lib/position/constants";
import { funnelLog } from "@/lib/position/logger";
import {
  checkPostIntroOutcomes,
  checkPostTrialOutcomes,
} from "./position-funnel";
import { dispatchActionTriggeredInBackground } from "@/lib/chat/proactive/action-triggered";
import { emailHeader } from "@/lib/email/brand";

// ── Types ──

export interface ConnectionRequest {
  id: string;
  parent_id: string;
  nanny_id: string;
  position_id: string | null;
  status:
    | "pending"
    | "accepted"
    | "confirmed"
    | "declined"
    | "cancelled"
    | "expired"
    | "completed";
  proposed_times: string[];
  confirmed_time: string | null;
  confirmed_at: string | null;
  message: string | null;
  decline_reason: string | null;
  nanny_phone_shared: string | null;
  expires_at: string | null;
  created_at: string;
  updated_at: string;

  // Funnel (new — nullable until fully migrated)
  connection_stage: number | null;
  intro_outcome_reported_at: string | null;
  fill_initiated_by: "nanny" | "parent" | null;
  trial_date: string | null;
  trial_reported_at: string | null;
}

export interface ConnectionRequestWithDetails extends ConnectionRequest {
  nanny?: {
    id: string;
    user_id: string;
    first_name: string;
    last_name: string;
    suburb: string;
    hourly_rate_min: number | null;
    profile_picture_url: string | null;
  };
  parent?: {
    id: string;
    user_id: string;
    first_name: string;
    last_name: string;
    suburb: string;
  };
  position?: Awaited<ReturnType<typeof getPositionSummary>>;
}

// ── Helper: get nanny ID for current user ──

export async function getNannyId(): Promise<{
  nannyId: string;
  userId: string;
} | null> {
  const supabase = createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) return null;

  const adminClient = createAdminClient();
  const { data: nanny, error } = await adminClient
    .from("nannies")
    .select("id")
    .eq("user_id", user.id)
    .single();

  if (error || !nanny) return null;
  return { nannyId: nanny.id, userId: user.id };
}

// ── Helper: expire stale pending/accepted requests ──

async function expireStaleRequests(
  supabase: ReturnType<typeof createAdminClient>,
  filter: { nanny_id?: string; parent_id?: string },
): Promise<void> {
  const now = new Date().toISOString();

  const query = supabase
    .from("connection_requests")
    .select("id, parent_id, nanny_id, status, connection_stage, source")
    .in("status", ["pending", "accepted"])
    .lt("expires_at", now);

  if (filter.nanny_id) query.eq("nanny_id", filter.nanny_id);
  if (filter.parent_id) query.eq("parent_id", filter.parent_id);

  const { data: stale } = await query;

  for (const req of stale ?? []) {
    // Determine correct expiry stage based on pending status
    const isPendingApp =
      req.connection_stage === CONNECTION_STAGE.NANNY_APPLIED_PENDING;
    const isPendingAcceptDfy =
      req.connection_stage === CONNECTION_STAGE.ACCEPTED_PENDING &&
      req.source === "dfy";
    const isPendingAcceptParent =
      req.connection_stage === CONNECTION_STAGE.ACCEPTED_PENDING &&
      req.source !== "dfy";

    // Stage 4 and parent-initiated stage 9: expire to REQUEST_EXPIRED
    // (from parent's perspective, nanny never responded)
    let expireStage: number;
    if (isPendingApp || isPendingAcceptParent) {
      expireStage = CONNECTION_STAGE.REQUEST_EXPIRED;
    } else {
      expireStage =
        req.status === "accepted"
          ? CONNECTION_STAGE.SCHEDULE_EXPIRED
          : CONNECTION_STAGE.REQUEST_EXPIRED;
    }

    await supabase
      .from("connection_requests")
      .update({
        status: "expired",
        connection_stage: expireStage,
        updated_at: now,
      })
      .eq("id", req.id)
      .in("status", ["pending", "accepted"]);

    funnelLog("expire", req.id, `${req.status} → expired`, {
      connection_stage: expireStage,
    });

    // Get user IDs for inbox messages
    const { data: nannyData } = await supabase
      .from("nannies")
      .select("user_id")
      .eq("id", req.nanny_id)
      .single();

    const { data: parentData } = await supabase
      .from("parents")
      .select("user_id")
      .eq("id", req.parent_id)
      .single();

    const expiredStatus = req.status as string;

    // Parent notification — skip for connections parent never saw
    const skipParentNotification = isPendingApp || isPendingAcceptDfy;

    if (parentData && !skipParentNotification) {
      await createInboxMessage({
        userId: parentData.user_id,
        type: "connection_expired",
        title: "Connection request expired",
        body: isPendingAcceptParent
          ? "Your connection request has expired as the nanny did not respond in time."
          : expiredStatus === "accepted"
            ? "Your accepted connection has expired because a meet and greet was not scheduled in time."
            : "Your connection request has expired as the nanny did not respond in time.",
        actionUrl: "/parent/connections",
        referenceId: req.id,
        referenceType: "connection_request",
      });
    }

    // Nanny notification — always sent
    if (nannyData) {
      await createInboxMessage({
        userId: nannyData.user_id,
        type: "connection_expired",
        title:
          expiredStatus === "accepted"
            ? "Accepted connection expired"
            : "Missed connection request",
        body:
          expiredStatus === "accepted"
            ? "An accepted connection has expired because the family did not schedule a meet and greet in time."
            : "A connection request has expired. Responding promptly helps families find the right nanny.",
        actionUrl: "/nanny/inbox",
        referenceId: req.id,
        referenceType: "connection_request",
      });
    }

    await logConnectionEvent({
      connectionRequestId: req.id,
      parentId: req.parent_id,
      nannyId: req.nanny_id,
      eventType: "expired",
    });
  }
}

// ── 1. Create Connection Request (Parent → Nanny) ──

export async function createConnectionRequest(
  nannyId: string,
  message?: string,
): Promise<{ success: boolean; error: string | null; requestId?: string }> {
  const supabase = createClient();

  const parentId = await getParentId();
  if (!parentId) {
    return { success: false, error: "Not authenticated as parent" };
  }

  // Check for active/filled position
  const { data: position, error: positionLookupError } = await supabase
    .from("nanny_positions")
    .select("id, stage")
    .eq("parent_id", parentId)
    .in("status", ["active", "filled"])
    .maybeSingle();

  // A DB error on the position lookup MUST NOT silently masquerade as
  // POSITION_REQUIRED (which would tell a real parent they have no
  // position). Surface it as a transient failure the client can retry.
  if (positionLookupError) {
    console.error("[Connection] Position lookup error:", positionLookupError);
    return {
      success: false,
      error: "Couldn't check your position. Please try again.",
    };
  }

  // T-041: gate manual Connect on having an active/filled position.
  //
  // The linked-children "shell position" path passes this gate by design:
  // when a parent claims a child-invite token, `ensure_placement` (SQL)
  // creates a `nanny_positions` row with `status='filled'`. That parent
  // can then Connect with any verified nanny — broadening from "only the
  // inviting nanny" to "any nanny" is intentional per the product threat
  // model (parents who arrive via invite are validated parents and the
  // platform wants them able to expand their childcare team).
  //
  // The downstream `position?.id ?? null` fallback stays so future API/cron
  // consumers that legitimately create position-less requests are unchanged
  // — but for this manual-Connect path, `position` is guaranteed truthy
  // below by the early-return here.
  //
  // See system/forms/Connect position gate/ for the full design rationale.
  if (!position) {
    return { success: false, error: CONNECTION_ERRORS.POSITION_REQUIRED };
  }

  // Max 5 pending requests
  const { count } = await supabase
    .from("connection_requests")
    .select("id", { count: "exact", head: true })
    .eq("parent_id", parentId)
    .eq("status", "pending");

  if (count !== null && count >= 5) {
    return {
      success: false,
      error:
        "You have reached the maximum of 5 open connection requests. Wait for a response or cancel an existing request.",
    };
  }

  // No duplicate with same nanny (exclude terminal stages so parents can reconnect)
  const { data: existing } = await supabase
    .from("connection_requests")
    .select("id")
    .eq("parent_id", parentId)
    .eq("nanny_id", nannyId)
    .in("status", ["pending", "accepted", "confirmed"])
    .not("connection_stage", "in", `(${HIDDEN_CONNECTION_STAGES.join(",")})`)
    .single();

  if (existing) {
    return {
      success: false,
      error: "You already have an active connection request with this nanny.",
    };
  }

  // expires_at = 72 hours from now
  const expiresAt = new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString();

  // Insert
  const { data: request, error } = await supabase
    .from("connection_requests")
    .insert({
      parent_id: parentId,
      nanny_id: nannyId,
      position_id: position?.id ?? null,
      status: "pending",
      connection_stage: CONNECTION_STAGE.REQUEST_SENT,
      proposed_times: [],
      message: message || null,
      expires_at: expiresAt,
    })
    .select("id")
    .single();

  if (error) {
    console.error("[Connection] Create error:", error);
    return { success: false, error: "Failed to create connection request." };
  }

  funnelLog("createConnection", request.id, "created", {
    nannyId,
    parentId,
    positionId: position?.id,
  });

  const adminClient = createAdminClient();

  // Move position from Open → Connecting (if this is the first connection)
  if (position?.id && position.stage === POSITION_STAGE.OPEN) {
    await adminClient
      .from("nanny_positions")
      .update({
        stage: POSITION_STAGE.CONNECTING,
        position_status: POSITION_STATUS.CONNECTING,
      })
      .eq("id", position.id)
      .eq("stage", POSITION_STAGE.OPEN);

    funnelLog("createConnection", request.id, "position Open → Connecting", {
      positionId: position.id,
    });
  }
  const { data: nanny } = await adminClient
    .from("nannies")
    .select("user_id")
    .eq("id", nannyId)
    .single();

  if (nanny) {
    // Log event
    await logConnectionEvent({
      connectionRequestId: request.id,
      parentId,
      nannyId,
      eventType: "created",
      eventData: { message: message || null },
    });

    // Inbox message for nanny
    await createInboxMessage({
      userId: nanny.user_id,
      type: "connection_request",
      title: "New connection request",
      body: "A family would like to connect with you for a meet and greet.",
      actionUrl: "/nanny/inbox",
      referenceId: request.id,
      referenceType: "connection_request",
    });

    // INT-001 email (fire-and-forget)
    const nannyInfo = await getUserEmailInfo(nanny.user_id);
    if (nannyInfo) {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      const { data: parentProfile } = await adminClient
        .from("user_profiles")
        .select("first_name, last_name, suburb")
        .eq("user_id", user!.id)
        .single();

      const parentName = parentProfile
        ? `${parentProfile.first_name} ${parentProfile.last_name}`
        : "A family";
      const parentSuburb = parentProfile?.suburb || "";
      const appUrl =
        process.env.NEXT_PUBLIC_APP_URL || "https://app-babybloom.vercel.app";
      const baseStyle = `font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px;`;
      const btnStyle = `background: #8B5CF6; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 600;`;

      sendEmail({
        to: nannyInfo.email,
        subject: `New connection request from ${parentName}`,
        html: `<div style="${baseStyle}">
          ${emailHeader()}
          <p style="color: #374151; font-size: 16px; line-height: 1.6;">${parentName} from ${parentSuburb} would like to connect with you for a meet and greet. Review their request and respond within 3 days.</p>
          <p style="margin-top: 24px;"><a href="${appUrl}/nanny/inbox" style="${btnStyle}">View Request</a></p>
        </div>`,
        emailType: "interview_request",
        recipientUserId: nanny.user_id,
      }).catch((err) =>
        console.error("[Connection] INT-001 email error:", err),
      );

      // Proactive: narrate to the NANNY's Katie that a new request
      // arrived. Reuse the parentProfile we already fetched above so we
      // don't re-query. Fire-and-forget — must never block this action.
      //
      // Prefer "the {LastName} family" over the bare first name —
      // matches the scope doc's "always address parents as a family"
      // rule (system/APP/BLOOMBOT/modules/profile-nanny/katie-scope.md
      // section 4).
      const familyNameForTemplate = parentProfile?.last_name
        ? `the ${parentProfile.last_name} family`
        : (parentProfile?.first_name ?? "a family");
      dispatchActionTriggeredInBackground({
        triggerId: "connections.request_received",
        recipientUserId: nanny.user_id,
        payload: {
          family_name: familyNameForTemplate,
          suburb: parentProfile?.suburb ?? "Sydney",
          connection_id: request.id,
        },
      });
    }
  }

  revalidatePath("/parent/connections");
  return { success: true, error: null, requestId: request.id };
}

// ── 2. Accept Connection Request (Nanny accepts with availability slots) ──

export async function acceptConnectionRequest(
  requestId: string,
  availableSlots: string[],
): Promise<{ success: boolean; error: string | null }> {
  const adminClient = createAdminClient();

  const nannyInfo = await getNannyId();
  if (!nannyInfo) {
    return { success: false, error: "Not authenticated as nanny" };
  }

  // Check verification level (level 3+ can accept)
  const { data: nannyVerData } = await adminClient
    .from("nannies")
    .select("verification_level")
    .eq("id", nannyInfo.nannyId)
    .single();

  const verificationLevel = nannyVerData?.verification_level ?? 0;
  if (verificationLevel < 3) {
    return {
      success: false,
      error: "Please complete verification to accept connections.",
    };
  }

  // Validate available slots
  if (!availableSlots || availableSlots.length < 5) {
    return {
      success: false,
      error: "Please select at least 5 available time slots.",
    };
  }

  // Validate format and extract unique brackets/days
  const validBrackets = new Set(BRACKET_KEYS);
  const selectedBrackets = new Set<string>();
  const selectedDays = new Set<string>();

  for (const slot of availableSlots) {
    const parts = slot.split("_");
    if (parts.length !== 2)
      return { success: false, error: `Invalid slot format: ${slot}` };
    const [date, bracket] = parts;
    if (!validBrackets.has(bracket as BracketKey))
      return { success: false, error: `Invalid bracket: ${bracket}` };
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date))
      return { success: false, error: `Invalid date format: ${date}` };
    selectedBrackets.add(bracket);
    selectedDays.add(date);
  }

  if (selectedBrackets.size < 4) {
    return {
      success: false,
      error:
        "Please select at least one slot from each time bracket (Morning, Midday, Afternoon, Evening).",
    };
  }

  if (selectedDays.size < 3) {
    return {
      success: false,
      error: "Please select slots across at least 3 different days.",
    };
  }

  // Fetch request (use adminClient to bypass RLS)
  const { data: request, error: fetchErr } = await adminClient
    .from("connection_requests")
    .select("id, parent_id, nanny_id, status")
    .eq("id", requestId)
    .eq("nanny_id", nannyInfo.nannyId)
    .single();

  if (fetchErr || !request) {
    return { success: false, error: "Connection request not found." };
  }

  if (request.status !== "pending") {
    return { success: false, error: "This request is no longer pending." };
  }

  const now = new Date().toISOString();
  // Parent has 72 hours to pick a time
  const newExpiresAt = new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString();

  // Update request — level 3 gets pending stage, level 4+ gets real stage
  const acceptStage =
    verificationLevel >= 4
      ? CONNECTION_STAGE.ACCEPTED
      : CONNECTION_STAGE.ACCEPTED_PENDING;

  const { error: updateErr } = await adminClient
    .from("connection_requests")
    .update({
      status: "accepted",
      connection_stage: acceptStage,
      proposed_times: availableSlots,
      responded_at: now,
      expires_at: newExpiresAt,
      updated_at: now,
    })
    .eq("id", requestId)
    .eq("status", "pending");

  if (updateErr) {
    console.error("[Connection] Accept error:", updateErr);
    return { success: false, error: "Failed to accept connection." };
  }

  funnelLog(
    "accept",
    requestId,
    verificationLevel >= 4 ? "0 → 10" : "0 → 9 (pending)",
    { nannyId: nannyInfo.nannyId },
  );

  // Log event
  await logConnectionEvent({
    connectionRequestId: requestId,
    parentId: request.parent_id,
    nannyId: request.nanny_id,
    eventType: "accepted",
  });

  // Get nanny name for messages
  const nannyEmailInfo = await getUserEmailInfo(nannyInfo.userId);
  const nannyName = nannyEmailInfo ? nannyEmailInfo.firstName : "Your nanny";

  // Get parent user_id
  const { data: parentData } = await adminClient
    .from("parents")
    .select("user_id")
    .eq("id", request.parent_id)
    .single();

  // Parent notifications — only at level 4+ (deferred for level 3)
  if (parentData && verificationLevel >= 4) {
    // Inbox message for parent
    await createInboxMessage({
      userId: parentData.user_id,
      type: "connection_accepted",
      title: `${nannyName} accepted your connection!`,
      body: `${nannyName} has shared their available times. Pick a slot for your meet and greet.`,
      actionUrl: "/parent/connections",
      referenceId: requestId,
      referenceType: "connection_request",
    });

    // Email to parent: pick a time
    const parentEmailInfo = await getUserEmailInfo(parentData.user_id);
    if (parentEmailInfo) {
      const appUrl =
        process.env.NEXT_PUBLIC_APP_URL || "https://app-babybloom.vercel.app";
      const baseStyle = `font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px;`;
      const btnStyle = `background: #8B5CF6; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 600;`;

      sendEmail({
        to: parentEmailInfo.email,
        subject: `${nannyName} accepted your connection request!`,
        html: `<div style="${baseStyle}">
          ${emailHeader()}
          <p style="color: #374151; font-size: 16px; line-height: 1.6;">Great news! ${nannyName} has accepted your connection request and shared their available times. Check their availability and pick a slot for your meet and greet.</p>
          <p style="color: #6B7280; font-size: 14px; margin-top: 8px;">You have 3 days to schedule a time.</p>
          <p style="margin-top: 24px;"><a href="${appUrl}/parent/connections" style="${btnStyle}">Pick a Time</a></p>
        </div>`,
        emailType: "interview_confirmed",
        recipientUserId: parentData.user_id,
      }).catch((err) => console.error("[Connection] Accept email error:", err));
    }

    // Proactive: narrate to the PARENT's Katie that the nanny accepted.
    // Only fires for level-4+ verified (parent already gets the inbox
    // message otherwise); `verificationLevel >= 4` branch means this
    // is a real accept, not the held-for-OCG stage-9 state.
    dispatchActionTriggeredInBackground({
      triggerId: "connections.request_accepted",
      recipientUserId: parentData.user_id,
      payload: {
        nanny_name: nannyName,
        connection_id: requestId,
      },
    });
  }

  // Inbox message for nanny — always sent immediately
  await createInboxMessage({
    userId: nannyInfo.userId,
    type: "connection_accepted_nanny",
    title: "Connection accepted",
    body: "You accepted this connection. Waiting for the family to schedule a meet and greet.",
    actionUrl: "/nanny/inbox",
    referenceId: requestId,
    referenceType: "connection_request",
  });

  revalidatePath("/nanny/inbox");
  revalidatePath("/parent/connections");
  revalidatePath("/parent/inbox");
  return { success: true, error: null };
}

// ── 3. Schedule Connection Time (Parent picks time from nanny's available brackets) ──

export async function scheduleConnectionTime(
  requestId: string,
  date: string,
  hour: number,
  minute: number,
): Promise<{ success: boolean; error: string | null }> {
  const adminClient = createAdminClient();

  const parentId = await getParentId();
  if (!parentId) {
    return { success: false, error: "Not authenticated as parent" };
  }

  // Validate inputs
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date))
    return { success: false, error: "Invalid date format." };
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59)
    return { success: false, error: "Invalid time." };

  // Determine which bracket this time falls into
  const bracket = getBracketForHour(hour);
  if (!bracket)
    return {
      success: false,
      error: "Selected time is outside available brackets (8am-8pm).",
    };

  // Validate time is within bracket range (not at the end hour itself)
  const bracketDef = TIME_BRACKETS[bracket];
  if (hour >= bracketDef.endHour)
    return {
      success: false,
      error: "Selected time is outside the bracket range.",
    };

  // Fetch request with proposed_times
  const { data: request, error: fetchErr } = await adminClient
    .from("connection_requests")
    .select("id, parent_id, nanny_id, status, proposed_times")
    .eq("id", requestId)
    .eq("parent_id", parentId)
    .single();

  if (fetchErr || !request) {
    return { success: false, error: "Connection request not found." };
  }

  if (request.status !== "accepted") {
    return {
      success: false,
      error: "This connection is not ready to be scheduled.",
    };
  }

  // Validate the selected date+bracket matches one of the nanny's proposed_times
  const slotKey = `${date}_${bracket}`;
  if (!request.proposed_times || !request.proposed_times.includes(slotKey)) {
    return {
      success: false,
      error: "The selected time is not within the nanny's available slots.",
    };
  }

  // Construct UTC ISO string from Sydney date/time (server-side conversion)
  const selectedTime = localToUTC(date, hour, minute);

  // Validate scheduled time is reasonable (24h–8d from now)
  const t = new Date(selectedTime).getTime();
  const now = Date.now();
  if (t < now + 12 * 60 * 60 * 1000)
    return {
      success: false,
      error: "Call time must be at least 12 hours from now.",
    };
  if (t > now + 9 * 24 * 60 * 60 * 1000)
    return {
      success: false,
      error: "Call time must be within the next 9 days.",
    };

  // Get nanny's user_id
  const { data: nannyData } = await adminClient
    .from("nannies")
    .select("user_id")
    .eq("id", request.nanny_id)
    .single();

  if (!nannyData) {
    return { success: false, error: "Nanny not found." };
  }

  // Get nanny's phone number
  const phone = await getNannyPhone(nannyData.user_id);
  if (!phone) {
    return {
      success: false,
      error: "Nanny phone number not available. Please contact support.",
    };
  }

  const nowIso = new Date().toISOString();

  // Update request
  const { error: updateErr } = await adminClient
    .from("connection_requests")
    .update({
      status: "confirmed",
      connection_stage: CONNECTION_STAGE.INTRO_SCHEDULED,
      confirmed_time: selectedTime,
      confirmed_at: nowIso,
      nanny_phone_shared: phone,
      updated_at: nowIso,
    })
    .eq("id", requestId)
    .eq("status", "accepted");

  if (updateErr) {
    console.error("[Connection] Schedule error:", updateErr);
    return { success: false, error: "Failed to schedule connection." };
  }

  funnelLog("schedule", requestId, "10 → 20", { confirmedTime: selectedTime });

  // Log event
  await logConnectionEvent({
    connectionRequestId: requestId,
    parentId: request.parent_id,
    nannyId: request.nanny_id,
    eventType: "confirmed",
    eventData: { selected_time: selectedTime, phone_shared: phone },
  });

  const nannyEmailInfo = await getUserEmailInfo(nannyData.user_id);
  const nannyName = nannyEmailInfo
    ? `${nannyEmailInfo.firstName} ${nannyEmailInfo.lastName}`
    : "Your nanny";

  const confirmedDate = formatLondonDate(selectedTime);

  // Get parent user_id
  const { data: parentUserData } = await adminClient
    .from("parents")
    .select("user_id")
    .eq("id", request.parent_id)
    .single();

  if (parentUserData) {
    // Inbox message for parent
    await createInboxMessage({
      userId: parentUserData.user_id,
      type: "connection_confirmed",
      title: `Meet and greet scheduled with ${nannyName}!`,
      body: `Your meet and greet is set for ${confirmedDate}. View contact details on your dashboard.`,
      actionUrl: "/parent/connections",
      referenceId: requestId,
      referenceType: "connection_request",
      metadata: { phone, confirmed_time: selectedTime },
    });

    // INT-002 email to parent (with phone + time)
    const parentEmailInfo = await getUserEmailInfo(parentUserData.user_id);
    if (parentEmailInfo) {
      const appUrl =
        process.env.NEXT_PUBLIC_APP_URL || "https://app-babybloom.vercel.app";
      const baseStyle = `font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px;`;
      const btnStyle = `background: #8B5CF6; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 600;`;

      sendEmail({
        to: parentEmailInfo.email,
        subject: `Meet and greet scheduled with ${nannyName}!`,
        html: `<div style="${baseStyle}">
          ${emailHeader()}
          <p style="color: #374151; font-size: 16px; line-height: 1.6;">Your meet and greet with ${nannyName} is confirmed.</p>
          <div style="background: #F0FDF4; border: 1px solid #86EFAC; border-radius: 8px; padding: 16px; margin: 16px 0;">
            <p style="margin: 0; font-weight: 600; color: #166534;">Meet Time: ${confirmedDate}</p>
          </div>
          <p style="color: #374151; font-size: 14px;">Call ${nannyName} to confirm the location of your meet and greet. Contact details are available on your Baby Bloom dashboard.</p>
          <p style="margin-top: 24px;"><a href="${appUrl}/parent/connections" style="${btnStyle}">View Details</a></p>
        </div>`,
        emailType: "interview_confirmed",
        recipientUserId: parentUserData.user_id,
      }).catch((err) =>
        console.error("[Connection] INT-002 email error:", err),
      );
    }
  }

  // Inbox message for nanny
  await createInboxMessage({
    userId: nannyData.user_id,
    type: "connection_confirmed_nanny",
    title: "Meet and greet scheduled",
    body: `Your meet and greet is set for ${confirmedDate}. Your contact details will be available to the family on their dashboard.`,
    actionUrl: "/nanny/inbox",
    referenceId: requestId,
    referenceType: "connection_request",
  });

  // INT-003 email to nanny
  if (nannyEmailInfo) {
    const parentProfile = parentUserData
      ? await getUserEmailInfo(parentUserData.user_id)
      : null;
    const parentName = parentProfile
      ? `${parentProfile.firstName} ${parentProfile.lastName}`
      : "the family";
    const appUrl =
      process.env.NEXT_PUBLIC_APP_URL || "https://app-babybloom.vercel.app";
    const baseStyle = `font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px;`;
    const btnStyle = `background: #8B5CF6; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 600;`;

    sendEmail({
      to: nannyEmailInfo.email,
      subject: `Meet and greet scheduled with ${parentName}`,
      html: `<div style="${baseStyle}">
        ${emailHeader()}
        <p style="color: #374151; font-size: 16px; line-height: 1.6;">Your meet and greet with ${parentName} is confirmed for ${confirmedDate}. Your contact details will be available to the family on their dashboard.</p>
        <p style="margin-top: 24px;"><a href="${appUrl}/nanny/inbox" style="${btnStyle}">View in Inbox</a></p>
      </div>`,
      emailType: "interview_confirmed",
      recipientUserId: nannyData.user_id,
    }).catch((err) => console.error("[Connection] INT-003 email error:", err));
  }

  // Proactive: narrate to BOTH sides. Same template id, different
  // recipient + counterparty. Fire-and-forget — no await.
  //
  // Each dispatch is guarded by the presence of the recipient row —
  // consistent with the email dispatch above which also guards. An
  // earlier version dropped the guard on the nanny-side call; the
  // nannyData early-return at the top of this function makes it safe
  // in practice, but the explicit guard matches the parent-side and
  // protects against refactors that might remove the top-of-function
  // check.
  if (parentUserData) {
    const nannyFullName = nannyEmailInfo
      ? `${nannyEmailInfo.firstName} ${nannyEmailInfo.lastName}`
      : "your nanny";
    dispatchActionTriggeredInBackground({
      triggerId: "connections.meet_scheduled",
      recipientUserId: parentUserData.user_id,
      payload: {
        counterparty_name: nannyFullName,
        when: confirmedDate,
        connection_id: requestId,
      },
    });
  }
  if (nannyData) {
    const parentEmailInfo = parentUserData
      ? await getUserEmailInfo(parentUserData.user_id)
      : null;
    const parentFullNameForNanny = parentEmailInfo
      ? `${parentEmailInfo.firstName} ${parentEmailInfo.lastName}`
      : "the family";
    dispatchActionTriggeredInBackground({
      triggerId: "connections.meet_scheduled",
      recipientUserId: nannyData.user_id,
      payload: {
        counterparty_name: parentFullNameForNanny,
        when: confirmedDate,
        connection_id: requestId,
      },
    });
  }

  revalidatePath("/nanny/inbox");
  revalidatePath("/parent/connections");
  revalidatePath("/parent/inbox");
  return { success: true, error: null };
}

// ── 4. Decline Connection Request (Nanny) ──

export async function declineConnectionRequest(
  requestId: string,
  reason?: string,
): Promise<{ success: boolean; error: string | null }> {
  const adminClient = createAdminClient();

  const nannyInfo = await getNannyId();
  if (!nannyInfo) {
    return { success: false, error: "Not authenticated as nanny" };
  }

  const now = new Date().toISOString();

  const { data: request, error: fetchErr } = await adminClient
    .from("connection_requests")
    .select("id, parent_id, nanny_id, status")
    .eq("id", requestId)
    .eq("nanny_id", nannyInfo.nannyId)
    .single();

  if (fetchErr || !request) {
    return { success: false, error: "Connection request not found." };
  }

  if (request.status !== "pending") {
    return { success: false, error: "This request is no longer pending." };
  }

  const { error: updateErr } = await adminClient
    .from("connection_requests")
    .update({
      status: "declined",
      connection_stage: CONNECTION_STAGE.DECLINED,
      decline_reason: reason || null,
      responded_at: now,
      updated_at: now,
    })
    .eq("id", requestId)
    .eq("status", "pending");

  if (updateErr) {
    console.error("[Connection] Decline error:", updateErr);
    return { success: false, error: "Failed to decline connection." };
  }

  funnelLog("decline", requestId, "0 → 2", { nannyId: nannyInfo.nannyId });

  // Log event
  await logConnectionEvent({
    connectionRequestId: requestId,
    parentId: request.parent_id,
    nannyId: request.nanny_id,
    eventType: "declined",
    eventData: reason ? { reason } : {},
  });

  // Inbox message for parent (neutral — no reason shown)
  const { data: parentData } = await adminClient
    .from("parents")
    .select("user_id")
    .eq("id", request.parent_id)
    .single();

  const nannyEmailInfo = await getUserEmailInfo(nannyInfo.userId);
  const nannyName = nannyEmailInfo ? nannyEmailInfo.firstName : "The nanny";

  if (parentData) {
    await createInboxMessage({
      userId: parentData.user_id,
      type: "connection_declined",
      title: `Update on your connection request`,
      body: `${nannyName} is unable to connect at this time. This could be due to scheduling or availability.`,
      actionUrl: "/parent/connections",
      referenceId: requestId,
      referenceType: "connection_request",
    });

    // INT-004 email to parent (neutral, no reason)
    const parentEmailInfo = await getUserEmailInfo(parentData.user_id);
    if (parentEmailInfo) {
      const appUrl =
        process.env.NEXT_PUBLIC_APP_URL || "https://app-babybloom.vercel.app";
      const baseStyle = `font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px;`;
      const btnStyle = `background: #8B5CF6; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 600;`;

      sendEmail({
        to: parentEmailInfo.email,
        subject: `Update on your connection with ${nannyName}`,
        html: `<div style="${baseStyle}">
          ${emailHeader()}
          <p style="color: #374151; font-size: 16px; line-height: 1.6;">Unfortunately, ${nannyName} is unable to connect at this time. This could be due to scheduling or availability.</p>
          <p style="margin-top: 24px;"><a href="${appUrl}/parent/browse" style="${btnStyle}">Browse More Nannies</a></p>
        </div>`,
        emailType: "interview_request",
        recipientUserId: parentData.user_id,
      }).catch((err) =>
        console.error("[Connection] INT-004 email error:", err),
      );
    }

    // Proactive: narrate to the PARENT's Katie. Neutral wording —
    // matches the "no reason shared" rule the inbox/email follow.
    dispatchActionTriggeredInBackground({
      triggerId: "connections.request_declined",
      recipientUserId: parentData.user_id,
      payload: {
        nanny_name: nannyName,
        connection_id: requestId,
      },
    });
  }

  revalidatePath("/nanny/inbox");
  revalidatePath("/parent/connections");
  revalidatePath("/parent/inbox");
  return { success: true, error: null };
}

// ── 5. Cancel Connection Request (Parent or Nanny, any active status) ──

export async function cancelConnectionRequest(
  requestId: string,
): Promise<{ success: boolean; error: string | null }> {
  const adminClient = createAdminClient();

  // Determine if caller is parent or nanny
  const parentId = await getParentId();
  const nannyInfo = await getNannyId();

  if (!parentId && !nannyInfo) {
    return { success: false, error: "Not authenticated" };
  }

  // Fetch request
  const { data: request, error: fetchErr } = await adminClient
    .from("connection_requests")
    .select("id, parent_id, nanny_id, status")
    .eq("id", requestId)
    .single();

  if (fetchErr || !request) {
    return { success: false, error: "Connection request not found." };
  }

  // Verify ownership
  const isParent = parentId === request.parent_id;
  const isNanny = nannyInfo?.nannyId === request.nanny_id;

  if (!isParent && !isNanny) {
    return {
      success: false,
      error: "You do not have permission to cancel this request.",
    };
  }

  // Allow cancel unless already cancelled
  if (request.status === "cancelled") {
    return {
      success: false,
      error: "This connection has already been removed.",
    };
  }

  const cancelStage = isParent
    ? CONNECTION_STAGE.CANCELLED_BY_PARENT
    : CONNECTION_STAGE.CANCELLED_BY_NANNY;

  const { error: updateErr } = await adminClient
    .from("connection_requests")
    .update({
      status: "cancelled",
      connection_stage: cancelStage,
      updated_at: new Date().toISOString(),
    })
    .eq("id", requestId);

  if (updateErr) {
    console.error("[Connection] Cancel error:", updateErr);
    return { success: false, error: "Failed to cancel connection request." };
  }

  funnelLog("cancel", requestId, `→ ${cancelStage}`, {
    cancelledBy: isParent ? "parent" : "nanny",
  });

  // Log event
  await logConnectionEvent({
    connectionRequestId: requestId,
    parentId: request.parent_id,
    nannyId: request.nanny_id,
    eventType: "cancelled",
    eventData: { cancelled_by: isParent ? "parent" : "nanny" },
  });

  // Inbox message for the OTHER party
  if (isParent) {
    const { data: nannyData } = await adminClient
      .from("nannies")
      .select("user_id")
      .eq("id", request.nanny_id)
      .single();

    if (nannyData) {
      await createInboxMessage({
        userId: nannyData.user_id,
        type: "connection_cancelled",
        title: "Connection request cancelled",
        body: "A family has cancelled their connection request.",
        actionUrl: "/nanny/inbox",
        referenceId: requestId,
        referenceType: "connection_request",
      });
    }
  } else {
    const { data: parentData } = await adminClient
      .from("parents")
      .select("user_id")
      .eq("id", request.parent_id)
      .single();

    if (parentData) {
      const nannyEmailInfo = nannyInfo
        ? await getUserEmailInfo(nannyInfo.userId)
        : null;
      const nannyName = nannyEmailInfo ? nannyEmailInfo.firstName : "The nanny";
      await createInboxMessage({
        userId: parentData.user_id,
        type: "connection_cancelled",
        title: "Connection cancelled",
        body: `${nannyName} has cancelled this connection.`,
        actionUrl: "/parent/connections",
        referenceId: requestId,
        referenceType: "connection_request",
      });
    }
  }

  revalidatePath("/parent/connections");
  revalidatePath("/nanny/inbox");
  return { success: true, error: null };
}

// ── 6. Get Parent Connection Requests ──

export async function getParentConnectionRequests(): Promise<{
  data: ConnectionRequestWithDetails[];
  error: string | null;
}> {
  const adminClient = createAdminClient();

  const parentId = await getParentId();
  if (!parentId) {
    return { data: [], error: "Not authenticated as parent" };
  }

  // Lazy expire stale requests + advance completed intros and trials
  await expireStaleRequests(adminClient, { parent_id: parentId });
  await checkPostIntroOutcomes(adminClient, { parent_id: parentId });
  await checkPostTrialOutcomes(adminClient, { parent_id: parentId });

  const { data, error } = await adminClient
    .from("connection_requests")
    .select("*")
    .eq("parent_id", parentId)
    .not("connection_stage", "eq", CONNECTION_STAGE.NANNY_APPLIED_PENDING) // Hide pending applications
    .order("created_at", { ascending: false });

  if (error) {
    console.error("[Connection] Parent fetch error:", error);
    return { data: [], error: "Failed to fetch connection requests." };
  }

  if (!data || data.length === 0) {
    return { data: [], error: null };
  }

  // Filter and remap pending stages for parent view:
  // - DFY stage 9: hide entirely (parent never saw it)
  // - Parent-initiated stage 9: remap to stage 0 (parent sees "Request Sent")
  const parentViewData = data
    .filter((req) => {
      if (
        req.connection_stage === CONNECTION_STAGE.ACCEPTED_PENDING &&
        req.source === "dfy"
      )
        return false;
      return true;
    })
    .map((req) => {
      if (req.connection_stage === CONNECTION_STAGE.ACCEPTED_PENDING) {
        return { ...req, connection_stage: CONNECTION_STAGE.REQUEST_SENT };
      }
      return req;
    });

  if (parentViewData.length === 0) {
    return { data: [], error: null };
  }

  // Fetch nanny details separately
  const nannyIds = Array.from(new Set(parentViewData.map((r) => r.nanny_id)));

  const { data: nannies } = await adminClient
    .from("nannies")
    .select("id, user_id, hourly_rate_min")
    .in("id", nannyIds);

  const nannyMap = new Map((nannies || []).map((n) => [n.id, n]));
  const userIds = (nannies || []).map((n) => n.user_id);

  const { data: profiles } = await adminClient
    .from("user_profiles")
    .select("user_id, first_name, last_name, suburb, profile_picture_url")
    .in("user_id", userIds);

  const profileMap = new Map((profiles || []).map((p) => [p.user_id, p]));

  const requests: ConnectionRequestWithDetails[] = parentViewData.map((req) => {
    const nanny = nannyMap.get(req.nanny_id);
    const profile = nanny ? profileMap.get(nanny.user_id) : null;
    return {
      ...req,
      nanny: {
        id: req.nanny_id,
        user_id: nanny?.user_id || "",
        first_name: profile?.first_name || "Unknown",
        last_name: profile?.last_name || "",
        suburb: profile?.suburb || "",
        hourly_rate_min: nanny?.hourly_rate_min || null,
        profile_picture_url: profile?.profile_picture_url || null,
      },
    } as ConnectionRequestWithDetails;
  });

  return { data: requests, error: null };
}

// ── 7. Get Nanny Connection Requests ──

export async function getNannyConnectionRequests(): Promise<{
  data: ConnectionRequestWithDetails[];
  error: string | null;
}> {
  const adminClient = createAdminClient();

  const nannyInfo = await getNannyId();
  if (!nannyInfo) {
    return { data: [], error: "Not authenticated as nanny" };
  }

  // Lazy expire stale requests + advance completed intros and trials
  await expireStaleRequests(adminClient, { nanny_id: nannyInfo.nannyId });
  await checkPostIntroOutcomes(adminClient, { nanny_id: nannyInfo.nannyId });
  await checkPostTrialOutcomes(adminClient, { nanny_id: nannyInfo.nannyId });

  const { data, error } = await adminClient
    .from("connection_requests")
    .select("*")
    .eq("nanny_id", nannyInfo.nannyId)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("[Connection] Nanny fetch error:", error);
    return { data: [], error: "Failed to fetch connection requests." };
  }

  if (!data || data.length === 0) {
    return { data: [], error: null };
  }

  // Fetch parent user_ids from parents table
  const parentIds = Array.from(new Set(data.map((r) => r.parent_id)));
  const { data: parents } = await adminClient
    .from("parents")
    .select("id, user_id")
    .in("id", parentIds);

  const parentMap = new Map((parents || []).map((p) => [p.id, p]));
  const parentUserIds = (parents || []).map((p) => p.user_id);

  // Fetch profiles using user_ids
  const { data: profiles } = await adminClient
    .from("user_profiles")
    .select("user_id, first_name, last_name, suburb")
    .in("user_id", parentUserIds);

  const profileMap = new Map((profiles || []).map((p) => [p.user_id, p]));

  // Enrich with parent + position data
  const requests: ConnectionRequestWithDetails[] = await Promise.all(
    data.map(async (req) => {
      const parent = parentMap.get(req.parent_id);
      const profile = parent ? profileMap.get(parent.user_id) : null;

      let position = null;
      if (req.position_id) {
        position = await getPositionSummary(req.position_id);
      }

      return {
        ...req,
        parent: {
          id: req.parent_id,
          user_id: parent?.user_id || "",
          first_name: profile?.first_name || "Unknown",
          last_name: profile?.last_name || "",
          suburb: profile?.suburb || "",
        },
        position,
      } as ConnectionRequestWithDetails;
    }),
  );

  return { data: requests, error: null };
}
