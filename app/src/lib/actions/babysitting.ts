"use server";

import { createClient } from "@/lib/supabase/server";
import { APP_LOCALE, APP_TZ, HOURLY_RATE_BOUNDS, SITE_URL } from "@/lib/constants";
import { createAdminClient } from "@/lib/supabase/admin";
import { revalidatePath } from "next/cache";
import { getParentId } from "./parent";
import { createInboxMessage, getNannyPhone } from "./connection-helpers";
import { sendEmail, sendBatchEmails } from "@/lib/email/resend";
import { getUserEmailInfo } from "@/lib/email/helpers";
import { haversineDistance } from "@/lib/matching/normalize";
import { generateBsrPost } from "@/lib/viral-loop/generate-bsr-post";
import { dispatchActionTriggeredInBackground } from "@/lib/chat/proactive/action-triggered";
import { emailHeader } from "@/lib/email/brand";
import { BRAND } from "@/lib/constants";

// ── Types ──

export interface TimeSlotInput {
  date: string; // "YYYY-MM-DD"
  startTime: string; // "HH:MM" (24h)
  endTime: string; // "HH:MM" (24h)
}

export interface BabysittingRequestWithSlots {
  id: string;
  parent_id: string;
  title: string | null;
  description: string | null;
  special_requirements: string | null;
  suburb: string;
  postcode: string;
  address: string | null;
  hourly_rate: number | null;
  status: string;
  accepted_nanny_id: string | null;
  accepted_at: string | null;
  nannies_notified_count: number;
  created_at: string;
  expires_at: string | null;
  cancelled_by: string | null;
  slots: Array<{
    id: string;
    slot_date: string;
    start_time: string;
    end_time: string;
    is_selected: boolean;
  }>;
  acceptedNanny?: {
    firstName: string;
    lastName: string;
    dateOfBirth: string | null;
    suburb: string | null;
    profilePicUrl: string | null;
    distanceKm: number | null;
    phone: string | null;
  };
  requestingNannies: RequestingNanny[];
}

export interface RequestingNanny {
  nannyId: string;
  firstName: string;
  lastName: string;
  dateOfBirth: string | null;
  suburb: string | null;
  profilePicUrl: string | null;
  distanceKm: number | null;
  requestedAt: string;
  experienceYears: number | null;
  hourlyRateMin: number | null;
  verificationTier: string;
  verificationLevel: number;
  aiHeadline: string | null;
  languages: string[] | null;
}

export interface NannyBabysittingJob {
  id: string;
  title: string | null;
  special_requirements: string | null;
  suburb: string;
  postcode: string;
  address: string | null;
  hourly_rate: number | null;
  estimated_total: number | null;
  status: string;
  accepted_nanny_id: string | null;
  created_at: string;
  expires_at: string | null;
  slots: Array<{
    id: string;
    slot_date: string;
    start_time: string;
    end_time: string;
    is_selected: boolean;
  }>;
  notification: {
    distanceKm: number | null;
    notifiedAt: string;
    viewedAt: string | null;
    requestedAt: string | null;
    acceptedAt: string | null;
    declinedAt: string | null;
    notifiedFilled: boolean;
  };
  children: Array<{ age_months: number; gender: string | null }>;
  clashSlotIds: string[]; // slot IDs that clash with nanny's existing jobs
}

// ── Email styles (shared) ──

const APP_URL =
  SITE_URL;
const BASE_STYLE = `font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px;`;
const BTN_STYLE = `background: #8B5CF6; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 600;`;

function formatSlotDisplay(slot: {
  slot_date: string;
  start_time: string;
  end_time: string;
}): string {
  const d = new Date(slot.slot_date + "T00:00:00");
  const dayName = d.toLocaleDateString(APP_LOCALE, {
    weekday: "short",
    timeZone: APP_TZ,
  });
  const dateStr = d.toLocaleDateString(APP_LOCALE, {
    day: "numeric",
    month: "short",
    timeZone: APP_TZ,
  });
  const start = formatTime(slot.start_time);
  const end = formatTime(slot.end_time);
  return `${dayName} ${dateStr} — ${start} to ${end}`;
}

function formatTime(time: string): string {
  const [h, m] = time.split(":").map(Number);
  const ampm = h >= 12 ? "pm" : "am";
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return m === 0
    ? `${h12}${ampm}`
    : `${h12}:${String(m).padStart(2, "0")}${ampm}`;
}

function timeToMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + (m || 0);
}

function ageMonthsToDisplay(months: number): string {
  if (months < 12) return `${months}mo`;
  const years = Math.floor(months / 12);
  const remaining = months % 12;
  return remaining > 0 ? `${years}yr ${remaining}mo` : `${years}yr`;
}

// ── Helper: get nanny ID for current user ──

async function getNannyId(): Promise<{
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

// ── Helper: find 20 closest BSR-eligible nannies ──

async function findClosestNannies(
  suburb: string,
  postcode: string | number,
  excludeNannyIds: string[] = [],
  limit = 20,
): Promise<Array<{ nannyId: string; userId: string; distanceKm: number }>> {
  const adminClient = createAdminClient();

  // 1. Parent coordinates
  const { data: parentLoc } = await adminClient
    .from("london_districts")
    .select("latitude, longitude")
    .eq("district", suburb)
    .single();

  if (!parentLoc) return [];

  // 2. All BSR-eligible nannies (not banned)
  const now = new Date().toISOString();
  const nannyQuery = adminClient
    .from("nannies")
    .select("id, user_id")
    .eq("visible_in_bsr", true)
    .or(`bsr_banned_until.is.null,bsr_banned_until.lt.${now}`);

  const { data: nannies } = await nannyQuery;
  if (!nannies || nannies.length === 0) return [];

  // Filter out excluded nannies
  const eligible =
    excludeNannyIds.length > 0
      ? nannies.filter((n) => !excludeNannyIds.includes(n.id))
      : nannies;

  if (eligible.length === 0) return [];

  // 3. Nanny suburbs from user_profiles
  const nannyUserIds = eligible.map((n) => n.user_id);
  const { data: profiles } = await adminClient
    .from("user_profiles")
    .select("user_id, suburb, postcode")
    .in("user_id", nannyUserIds);

  if (!profiles) return [];

  const profileMap = new Map(profiles.map((p) => [p.user_id, p]));

  // 4. All unique suburb coordinates
  const uniqueSuburbs = Array.from(
    new Set(profiles.map((p) => p.suburb).filter(Boolean)),
  );
  const { data: districts } = await adminClient
    .from("london_districts")
    .select("district, latitude, longitude")
    .in("district", uniqueSuburbs);

  if (!districts) return [];

  const districtMap = new Map(
    districts.map((d) => [d.district.toLowerCase(), d]),
  );

  // 5. Calculate distances
  const nannyDistances: Array<{
    nannyId: string;
    userId: string;
    distanceKm: number;
  }> = [];

  for (const nanny of eligible) {
    const profile = profileMap.get(nanny.user_id);
    if (!profile?.suburb) continue;

    const loc = districtMap.get(profile.suburb.toLowerCase());
    if (!loc) continue;

    const dist = haversineDistance(
      Number(parentLoc.latitude),
      Number(parentLoc.longitude),
      Number(loc.latitude),
      Number(loc.longitude),
    );

    nannyDistances.push({
      nannyId: nanny.id,
      userId: nanny.user_id,
      distanceKm: Math.floor(dist),
    });
  }

  // 6. Sort by distance, take top N
  nannyDistances.sort((a, b) => a.distanceKm - b.distanceKm);
  return nannyDistances.slice(0, limit);
}

// ── Helper: check for scheduling clash with 2-hour buffer ──

async function hasClash(
  nannyId: string,
  slotDate: string,
  startTime: string,
  endTime: string,
  bufferMinutes = 120,
): Promise<{ clash: boolean; existingJob?: string }> {
  const adminClient = createAdminClient();

  // Get nanny's existing accepted jobs on the same date
  const { data: existingSlots } = await adminClient
    .from("bsr_notifications")
    .select(
      `
      babysitting_request_id,
      babysitting_requests!inner (id, status),
      accepted_at
    `,
    )
    .eq("nanny_id", nannyId)
    .not("accepted_at", "is", null);

  if (!existingSlots || existingSlots.length === 0) {
    return { clash: false };
  }

  // Get the filled BSR IDs
  const filledBsrIds = existingSlots
    .filter((s: Record<string, unknown>) => {
      const br = s.babysitting_requests as { status: string } | null;
      return br?.status === "filled";
    })
    .map((s: Record<string, unknown>) => s.babysitting_request_id as string);

  if (filledBsrIds.length === 0) return { clash: false };

  // Get selected time slots for those BSRs on the same date
  const { data: existingTimeSlots } = await adminClient
    .from("bsr_time_slots")
    .select("babysitting_request_id, start_time, end_time")
    .in("babysitting_request_id", filledBsrIds)
    .eq("slot_date", slotDate)
    .eq("is_selected", true);

  if (!existingTimeSlots || existingTimeSlots.length === 0) {
    return { clash: false };
  }

  const newStart = timeToMinutes(startTime);
  const newEnd = timeToMinutes(endTime);

  for (const job of existingTimeSlots) {
    const jobStart = timeToMinutes(job.start_time);
    const jobEnd = timeToMinutes(job.end_time);

    // Block zone = (jobStart - buffer) to (jobEnd + buffer)
    const blockedStart = jobStart - bufferMinutes;
    const blockedEnd = jobEnd + bufferMinutes;

    if (newStart < blockedEnd && newEnd > blockedStart) {
      return {
        clash: true,
        existingJob: `${formatTime(job.start_time)} to ${formatTime(job.end_time)}`,
      };
    }
  }

  return { clash: false };
}

// ── Helper: expire stale BSRs (lazy expiry) ──

async function expireStaleBSRs(parentId?: string): Promise<void> {
  const adminClient = createAdminClient();
  const now = new Date().toISOString();

  let query = adminClient
    .from("babysitting_requests")
    .select("id, parent_id")
    .eq("status", "open")
    .lt("expires_at", now);

  if (parentId) {
    query = query.eq("parent_id", parentId);
  }

  const { data: stale } = await query;
  if (!stale || stale.length === 0) return;

  for (const bsr of stale) {
    await adminClient
      .from("babysitting_requests")
      .update({ status: "expired", updated_at: now })
      .eq("id", bsr.id)
      .eq("status", "open");

    // BSR-005: notify parent
    const { data: parentData } = await adminClient
      .from("parents")
      .select("user_id")
      .eq("id", bsr.parent_id)
      .single();

    if (parentData) {
      const parentInfo = await getUserEmailInfo(parentData.user_id);

      await createInboxMessage({
        userId: parentData.user_id,
        type: "bsr_expired",
        title: "Babysitting request expired",
        body: "We're sorry — on this occasion we were unable to find a babysitter for you. Please try again with different times.",
        actionUrl: "/parent/babysitting",
        referenceId: bsr.id,
        referenceType: "babysitting_request",
      });

      if (parentInfo) {
        sendEmail({
          to: parentInfo.email,
          subject: "Your babysitting request has expired",
          html: `<div style="${BASE_STYLE}">
            <div style="background: #F5F3FF; border-radius: 12px; padding: 20px;">
              ${emailHeader()}
              <p style="color: #374151; font-size: 16px; line-height: 1.6;">Hi ${parentInfo.firstName},</p>
              <p style="color: #374151; font-size: 16px; line-height: 1.6;">We're sorry — on this occasion we were unable to find a babysitter for your request. We apologise for the inconvenience.</p>
              <p style="color: #374151; margin: 4px 0;">Please don't hesitate to try again — we have wonderful nannies across ${BRAND.city} and we'd love to help you find the right match.</p>
              <p style="margin-top: 16px;"><a href="${APP_URL}/parent/babysitting" style="${BTN_STYLE}">Post New Request</a></p>
            </div>
          </div>`,
          emailType: "bsr_expired",
          recipientUserId: parentData.user_id,
        }).catch((err) => console.error("[BSR] BSR-005 email error:", err));
      }
    }
  }
}

// ── Lazy: complete elapsed filled BSRs + send reminders ──

async function completeAndRemindBSRs(parentId?: string): Promise<void> {
  const adminClient = createAdminClient();
  const now = new Date();
  const nowIso = now.toISOString();

  // Find filled BSRs that might need completion or reminders
  let query = adminClient
    .from("babysitting_requests")
    .select(
      "id, parent_id, accepted_nanny_id, address, suburb, postcode, hourly_rate, special_requirements, reminder_sent_at",
    )
    .eq("status", "filled");

  if (parentId) {
    query = query.eq("parent_id", parentId);
  }

  const { data: filledBsrs } = await query;
  if (!filledBsrs || filledBsrs.length === 0) return;

  const bsrIds = filledBsrs.map((b) => b.id);

  // Get all slots for these BSRs
  const { data: allSlots } = await adminClient
    .from("bsr_time_slots")
    .select("babysitting_request_id, slot_date, start_time, end_time")
    .in("babysitting_request_id", bsrIds);

  const slotMap = new Map<string, typeof allSlots>();
  for (const slot of allSlots ?? []) {
    const existing = slotMap.get(slot.babysitting_request_id) ?? [];
    existing.push(slot);
    slotMap.set(slot.babysitting_request_id, existing);
  }

  for (const bsr of filledBsrs) {
    const slots = slotMap.get(bsr.id) ?? [];
    if (slots.length === 0) continue;

    // Find latest end time (for completion) and earliest start time (for reminders)
    let latestEnd = new Date(0);
    let earliestStart = new Date("9999-12-31");

    for (const s of slots) {
      if (s.end_time) {
        const end = new Date(`${s.slot_date}T${s.end_time}:00`);
        if (!isNaN(end.getTime()) && end > latestEnd) latestEnd = end;
      }
      if (s.start_time) {
        const start = new Date(`${s.slot_date}T${s.start_time}:00`);
        if (!isNaN(start.getTime()) && start < earliestStart)
          earliestStart = start;
      }
    }

    // ── Auto-complete: all slots have elapsed ──
    if (latestEnd.getTime() > 0 && latestEnd < now) {
      await adminClient
        .from("babysitting_requests")
        .update({ status: "completed", updated_at: nowIso })
        .eq("id", bsr.id)
        .eq("status", "filled");
      continue; // No reminder needed for completed jobs
    }

    // ── Reminder: earliest slot is ≤24h away and in the future ──
    if (
      !bsr.reminder_sent_at &&
      earliestStart.getTime() < new Date("9999-12-31").getTime()
    ) {
      const hoursUntil =
        (earliestStart.getTime() - now.getTime()) / (1000 * 60 * 60);

      if (hoursUntil > 0 && hoursUntil <= 24) {
        // Mark as sent immediately to prevent duplicates
        await adminClient
          .from("babysitting_requests")
          .update({ reminder_sent_at: nowIso })
          .eq("id", bsr.id);

        const firstSlot = slots.reduce((earliest, s) => {
          const start = new Date(`${s.slot_date}T${s.start_time}:00`);
          const currentEarliest = new Date(
            `${earliest.slot_date}T${earliest.start_time}:00`,
          );
          return start < currentEarliest ? s : earliest;
        }, slots[0]);

        const slotDisplay = formatSlotDisplay({
          slot_date: firstSlot.slot_date,
          start_time: firstSlot.start_time,
          end_time: firstSlot.end_time,
        });

        // Get parent email info
        const { data: parentData } = await adminClient
          .from("parents")
          .select("user_id")
          .eq("id", bsr.parent_id)
          .single();

        // Get nanny email info
        let nannyUserId: string | null = null;
        if (bsr.accepted_nanny_id) {
          const { data: nannyRow } = await adminClient
            .from("nannies")
            .select("user_id")
            .eq("id", bsr.accepted_nanny_id)
            .single();
          nannyUserId = nannyRow?.user_id ?? null;
        }

        // BSR-013: Reminder to parent
        if (parentData) {
          const parentInfo = await getUserEmailInfo(parentData.user_id);
          let nannyFirstName = "your babysitter";
          if (nannyUserId) {
            const nannyInfo = await getUserEmailInfo(nannyUserId);
            if (nannyInfo) nannyFirstName = nannyInfo.firstName;
          }

          if (parentInfo) {
            sendEmail({
              to: parentInfo.email,
              subject: `Reminder: babysitting tomorrow with ${nannyFirstName}`,
              html: `<div style="${BASE_STYLE}">
                <div style="background: #F5F3FF; border-radius: 12px; padding: 20px;">
                  ${emailHeader()}
                  <p style="color: #374151; font-size: 16px; line-height: 1.6;">Hi ${parentInfo.firstName},</p>
                  <p style="color: #374151; font-size: 16px; line-height: 1.6;">Just a friendly reminder that your babysitting job with <strong>${nannyFirstName}</strong> is coming up:</p>
                  <p style="color: #374151; font-size: 16px; line-height: 1.6; background: white; border-radius: 8px; padding: 12px;">📅 ${slotDisplay}</p>
                  <p style="color: #374151; font-size: 16px; line-height: 1.6;">View your booking in Baby Bloom to see your babysitter's contact details.</p>
                  <p style="margin-top: 16px;"><a href="${APP_URL}/parent/babysitting" style="${BTN_STYLE}">View Booking</a></p>
                </div>
              </div>`,
              emailType: "bsr_reminder_parent",
              recipientUserId: parentData.user_id,
            }).catch((err) => console.error("[BSR] BSR-013 email error:", err));
          }
        }

        // BSR-014: Reminder to nanny
        if (nannyUserId) {
          const nannyInfo = await getUserEmailInfo(nannyUserId);

          if (nannyInfo) {
            sendEmail({
              to: nannyInfo.email,
              subject: "Reminder: babysitting job tomorrow",
              html: `<div style="${BASE_STYLE}">
                <div style="background: #F5F3FF; border-radius: 12px; padding: 20px;">
                  ${emailHeader()}
                  <p style="color: #374151; font-size: 16px; line-height: 1.6;">Hi ${nannyInfo.firstName},</p>
                  <p style="color: #374151; font-size: 16px; line-height: 1.6;">Just a friendly reminder that your babysitting job is coming up:</p>
                  <p style="color: #374151; font-size: 16px; line-height: 1.6; background: white; border-radius: 8px; padding: 12px;">📅 ${slotDisplay}<br/>📍 ${bsr.suburb}</p>
                  <p style="color: #374151; font-size: 14px; line-height: 1.6; margin-top: 12px;">View the full address and job details in your Baby Bloom dashboard.</p>
                  <p style="margin-top: 16px;"><a href="${APP_URL}/nanny/babysitting" style="${BTN_STYLE}">See Full Details</a></p>
                </div>
              </div>`,
              emailType: "bsr_reminder_nanny",
              recipientUserId: nannyUserId,
            }).catch((err) => console.error("[BSR] BSR-014 email error:", err));
          }
        }
      }
    }
  }
}

// ── Helper: count nanny cancellations in rolling 365 days ──

async function countNannyCancellations(nannyId: string): Promise<number> {
  const adminClient = createAdminClient();
  const oneYearAgo = new Date();
  oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);

  const { count } = await adminClient
    .from("babysitting_requests")
    .select("id", { count: "exact", head: true })
    .eq("accepted_nanny_id", nannyId)
    .eq("cancelled_by", "nanny")
    .gt("nanny_cancelled_at", oneYearAgo.toISOString());

  return count ?? 0;
}

// ══════════════════════════════════════════════════════════════
// PUBLIC BSR PROFILE (no auth required — for landing page)
// ══════════════════════════════════════════════════════════════

export interface PublicBsrProfile {
  id: string;
  suburb: string;
  hourly_rate: number | null;
  estimated_hours: number | null;
  status: string;
  special_requirements: string | null;
  created_at: string;
  expires_at: string | null;
  parent_first_name: string;
  parent_last_name: string | null;
  parent_profile_pic: string | null;
  time_slots: Array<{
    slot_date: string;
    start_time: string;
    end_time: string;
  }>;
  children: Array<{ ageMonths: number; gender?: string }>;
}

export async function getPublicBsrProfile(bsrId: string): Promise<{
  data: PublicBsrProfile | null;
  error: string | null;
}> {
  const admin = createAdminClient();

  const { data: bsr, error: bsrErr } = await admin
    .from("babysitting_requests")
    .select(
      "id, parent_id, suburb, hourly_rate, estimated_hours, status, special_requirements, created_at, expires_at, children",
    )
    .eq("id", bsrId)
    .maybeSingle();

  if (bsrErr || !bsr)
    return { data: null, error: "Babysitting request not found" };

  // Get time slots
  const { data: slots } = await admin
    .from("bsr_time_slots")
    .select("slot_date, start_time, end_time")
    .eq("babysitting_request_id", bsrId)
    .order("slot_date", { ascending: true });

  // Get parent's first name + profile pic (via parents → user_profiles)
  const { data: parent } = await admin
    .from("parents")
    .select("user_id")
    .eq("id", bsr.parent_id)
    .single();

  let parentFirstName = "A family";
  let parentLastName: string | null = null;
  let parentProfilePic: string | null = null;

  if (parent) {
    const { data: profile } = await admin
      .from("user_profiles")
      .select("first_name, last_name, profile_picture_url")
      .eq("user_id", parent.user_id)
      .maybeSingle();

    if (profile) {
      parentFirstName = profile.first_name ?? "A family";
      parentLastName = profile.last_name ?? null;
      parentProfilePic = profile.profile_picture_url ?? null;
    }
  }

  const children =
    (bsr.children as Array<{ ageMonths: number; gender?: string }>) ?? [];

  return {
    data: {
      id: bsr.id,
      suburb: bsr.suburb,
      hourly_rate: bsr.hourly_rate ? Number(bsr.hourly_rate) : null,
      estimated_hours: bsr.estimated_hours ? Number(bsr.estimated_hours) : null,
      status: bsr.status,
      special_requirements: bsr.special_requirements,
      created_at: bsr.created_at,
      expires_at: bsr.expires_at,
      parent_first_name: parentFirstName,
      parent_last_name: parentLastName,
      parent_profile_pic: parentProfilePic,
      time_slots: slots ?? [],
      children,
    },
    error: null,
  };
}

// ══════════════════════════════════════════════════════════════
// 1. CREATE BABYSITTING REQUEST (Parent)
// ══════════════════════════════════════════════════════════════

export async function createBabysittingRequest(data: {
  timeSlots: TimeSlotInput[];
  children: Array<{ ageMonths: number; gender: string }>;
  suburb: string;
  postcode: string;
  address?: string;
  hourlyRate: number;
  specialRequirements?: string;
  title?: string;
}): Promise<{ success: boolean; error: string | null; requestId?: string }> {
  const adminClient = createAdminClient();

  const parentId = await getParentId();
  if (!parentId) {
    return { success: false, error: "Not authenticated as parent" };
  }

  // Validate time slots
  if (!data.timeSlots || data.timeSlots.length === 0) {
    return { success: false, error: "At least one time slot is required" };
  }
  if (data.timeSlots.length > 7) {
    return { success: false, error: "Maximum 7 time slots allowed" };
  }

  // Validate all slots are in the future (> 2 hours from now) and within 4 weeks
  const twoHoursFromNow = new Date(Date.now() + 2 * 60 * 60 * 1000);
  const fourWeeksFromNow = new Date(Date.now() + 28 * 24 * 60 * 60 * 1000);
  for (const slot of data.timeSlots) {
    const slotStart = new Date(`${slot.date}T${slot.startTime}:00`);
    if (slotStart <= twoHoursFromNow) {
      return {
        success: false,
        error: "All time slots must be at least 2 hours from now",
      };
    }
    const slotDate = new Date(`${slot.date}T00:00:00`);
    if (slotDate > fourWeeksFromNow) {
      return {
        success: false,
        error: "Babysitting requests cannot be more than 4 weeks in advance",
      };
    }
    if (slot.startTime >= slot.endTime) {
      return { success: false, error: "End time must be after start time" };
    }
  }

  // Validate children (1-3)
  if (!data.children || data.children.length === 0) {
    return { success: false, error: "At least one child is required" };
  }
  if (data.children.length > 3) {
    return { success: false, error: "Maximum 3 children allowed" };
  }

  // Validate hourly rate against the one configured bound (Q-1/Q-7).
  if (
    !data.hourlyRate ||
    data.hourlyRate < HOURLY_RATE_BOUNDS.min ||
    data.hourlyRate > HOURLY_RATE_BOUNDS.max
  ) {
    return {
      success: false,
      error: `Hourly rate must be between £${HOURLY_RATE_BOUNDS.min} and £${HOURLY_RATE_BOUNDS.max}`,
    };
  }

  // Validate suburb exists
  if (!data.suburb || !data.postcode) {
    return { success: false, error: "Please select an area" };
  }

  // Look up lat/lng from suburb
  const { data: coords } = await adminClient
    .from("london_districts")
    .select("latitude, longitude")
    .eq("district", data.suburb)
    .single();

  if (!coords) {
    return { success: false, error: "Invalid area selected" };
  }

  // Calculate estimated hours and total
  let totalMinutes = 0;
  for (const slot of data.timeSlots) {
    totalMinutes += timeToMinutes(slot.endTime) - timeToMinutes(slot.startTime);
  }
  const estimatedHours = Math.round((totalMinutes / 60) * 10) / 10;
  const estimatedTotal = Math.round(estimatedHours * data.hourlyRate);

  // Insert BSR — expires in 7 days or 3 hours before first slot, whichever is sooner
  const sevenDaysFromNow = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const earliestSlotStart = data.timeSlots
    .map((s) => new Date(`${s.date}T${s.startTime}:00`))
    .sort((a, b) => a.getTime() - b.getTime())[0];
  const threeHoursBeforeFirstSlot = new Date(
    earliestSlotStart.getTime() - 3 * 60 * 60 * 1000,
  );
  const expiresAt = (
    threeHoursBeforeFirstSlot < sevenDaysFromNow
      ? threeHoursBeforeFirstSlot
      : sevenDaysFromNow
  ).toISOString();

  const { data: bsr, error: bsrError } = await adminClient
    .from("babysitting_requests")
    .insert({
      parent_id: parentId,
      title: data.title || "Babysitting Request",
      special_requirements: data.specialRequirements || null,
      suburb: data.suburb,
      postcode: String(data.postcode),
      address: data.address || null,
      latitude: coords.latitude,
      longitude: coords.longitude,
      hourly_rate: data.hourlyRate,
      estimated_hours: estimatedHours,
      estimated_total: estimatedTotal,
      children: data.children.map((c) => ({
        ageMonths: c.ageMonths,
        gender: c.gender,
      })),
      status: "pending_payment",
      expires_at: expiresAt,
    })
    .select("id")
    .single();

  if (bsrError || !bsr) {
    console.error("[BSR] Create error:", bsrError);
    return { success: false, error: "Failed to create babysitting request" };
  }

  // Insert time slots
  const slotRows = data.timeSlots.map((slot) => ({
    babysitting_request_id: bsr.id,
    slot_date: slot.date,
    start_time: slot.startTime,
    end_time: slot.endTime,
  }));

  const { data: insertedSlots, error: slotsError } = await adminClient
    .from("bsr_time_slots")
    .insert(slotRows)
    .select("id, slot_date, start_time, end_time");

  if (slotsError) {
    console.error("[BSR] Slots insert error:", slotsError);
  }

  // Generate share post content
  const { data: parentProfile } = await adminClient
    .from("parents")
    .select("user_id")
    .eq("id", parentId)
    .single();
  let parentFirstName = "Parent";
  if (parentProfile) {
    const { data: up } = await adminClient
      .from("user_profiles")
      .select("first_name")
      .eq("user_id", parentProfile.user_id)
      .maybeSingle();
    if (up?.first_name) parentFirstName = up.first_name;
  }
  const sharePost = generateBsrPost({
    firstName: parentFirstName,
    suburb: data.suburb,
    timeSlots: (insertedSlots ?? []).map((s) => ({
      slot_date: s.slot_date,
      start_time: s.start_time,
      end_time: s.end_time,
    })),
    children: data.children,
    hourlyRate: data.hourlyRate,
  });
  await adminClient
    .from("babysitting_requests")
    .update({
      ai_content: {
        share_post: sharePost,
        generated_at: new Date().toISOString(),
        generator: "template_v1",
      },
    })
    .eq("id", bsr.id);

  revalidatePath("/parent/babysitting");
  return { success: true, error: null, requestId: bsr.id };
}

// ══════════════════════════════════════════════════════════════
// 1b. ACTIVATE BSR — Move from pending_payment → open + notify nannies
// ══════════════════════════════════════════════════════════════

export async function activateBsr(
  bsrId: string,
): Promise<{ success: boolean; error: string | null }> {
  const adminClient = createAdminClient();

  const parentId = await getParentId();
  if (!parentId) {
    return { success: false, error: "Not authenticated as parent" };
  }

  // Fetch BSR and verify ownership + status
  const { data: bsr } = await adminClient
    .from("babysitting_requests")
    .select(
      "id, parent_id, suburb, postcode, hourly_rate, estimated_total, special_requirements, children, status",
    )
    .eq("id", bsrId)
    .single();

  if (!bsr) {
    return { success: false, error: "Babysitting request not found" };
  }
  if (bsr.parent_id !== parentId) {
    return { success: false, error: "Not authorized" };
  }
  if (bsr.status !== "pending_payment") {
    // Already activated or in another state — not an error, just skip
    return { success: true, error: null };
  }

  // Update status to open
  await adminClient
    .from("babysitting_requests")
    .update({ status: "open" })
    .eq("id", bsrId);

  // Fetch time slots for email content
  const { data: slots } = await adminClient
    .from("bsr_time_slots")
    .select("slot_date, start_time, end_time")
    .eq("babysitting_request_id", bsrId)
    .order("slot_date");

  const children = (bsr.children ?? []) as Array<{
    ageMonths: number;
    gender?: string;
  }>;
  const childrenStr = `${children.length} child${children.length > 1 ? "ren" : ""}: ${children.map((c) => ageMonthsToDisplay(c.ageMonths)).join(", ")}`;

  // Find 20 closest nannies
  const closestNannies = await findClosestNannies(bsr.suburb, bsr.postcode);

  if (closestNannies.length === 0) {
    await adminClient
      .from("babysitting_requests")
      .update({ nannies_notified_count: 0 })
      .eq("id", bsrId);

    revalidatePath("/parent/babysitting");
    return { success: true, error: null };
  }

  // Insert notification rows
  const notifRows = closestNannies.map((n) => ({
    babysitting_request_id: bsrId,
    nanny_id: n.nannyId,
    notification_method: "email" as const,
    distance_km: n.distanceKm,
  }));

  const { error: notifInsertErr } = await adminClient
    .from("bsr_notifications")
    .insert(notifRows);
  if (notifInsertErr) {
    // Notification rows didn't land — don't fire Katie pings to nannies
    // who weren't actually notified. The BSR itself stays open and the
    // parent's request is still recorded; surface the failure.
    console.error(
      "[BSR] bsr_notifications insert failed; skipping Katie dispatch",
      notifInsertErr,
    );
    return { success: false, error: "Failed to notify nannies" };
  }

  // Update notified count
  await adminClient
    .from("babysitting_requests")
    .update({ nannies_notified_count: closestNannies.length })
    .eq("id", bsrId);

  // Katie proactive — narrate the new invitation to each invited nanny.
  // Plain-text "when" derived from the first slot; the email already
  // ships the full slotsStr, so we keep the chat ping concise.
  const firstSlot = slots?.[0];
  const whenText = firstSlot ? formatSlotDisplay(firstSlot) : "soon";
  for (const n of closestNannies) {
    dispatchActionTriggeredInBackground({
      triggerId: "bsr.invitation_received",
      recipientUserId: n.userId,
      payload: {
        when: whenText,
        suburb: bsr.suburb,
        distance: n.distanceKm < 1 ? "<1 km away" : `${n.distanceKm} km away`,
        bsr_id: bsrId,
      },
    });
  }

  const slotsStr = (slots ?? []).map((s) => formatSlotDisplay(s)).join("<br>");
  const estimatedTotal = bsr.estimated_total ?? 0;

  // Send batch emails to nannies (fire-and-forget)
  const emailPromises = closestNannies.map(async (n) => {
    const info = await getUserEmailInfo(n.userId);
    if (!info) return null;
    return {
      to: info.email,
      subject: `New babysitting job in ${bsr.suburb}`,
      html: `<div style="${BASE_STYLE}">
        <div style="background: #F5F3FF; border-radius: 12px; padding: 20px;">
          ${emailHeader()}
          <p style="color: #374151; font-size: 16px; line-height: 1.6;">Hi ${info.firstName},</p>
          <p style="color: #374151; font-size: 16px; line-height: 1.6;">A family in ${bsr.suburb} is looking for a babysitter!</p>
          <p style="color: #374151; margin: 4px 0;">${slotsStr}</p>
          <p style="color: #374151; margin: 4px 0;">📍 ${bsr.suburb} (${n.distanceKm < 1 ? "<1" : n.distanceKm} km from you)</p>
          <p style="color: #374151; margin: 4px 0;">👶 ${childrenStr}</p>
          ${bsr.special_requirements ? `<p style="color: #374151; margin: 4px 0;">📋 ${bsr.special_requirements}</p>` : ""}
          <p style="color: #374151; margin: 4px 0;">💰 £${bsr.hourly_rate}/hr (est. total £${estimatedTotal})</p>
          <p style="color: #374151; font-size: 14px; line-height: 1.6; margin-top: 12px;">Request this job and the family will choose their preferred babysitter.</p>
          <p style="margin-top: 16px;"><a href="${APP_URL}/nanny/babysitting" style="${BTN_STYLE}">View Job</a></p>
        </div>
      </div>`,
      emailType: "bsr_new_job",
      recipientUserId: n.userId,
    };
  });

  try {
    const emails = await Promise.all(emailPromises);
    const validEmails = emails.filter(
      (e): e is NonNullable<typeof e> => e !== null,
    );
    if (validEmails.length > 0) {
      await sendBatchEmails(validEmails);
    }
  } catch (err) {
    console.error("[BSR] Activate batch email error:", err);
  }

  // Inbox messages for nannies
  await Promise.all(
    closestNannies.map((n) =>
      createInboxMessage({
        userId: n.userId,
        type: "bsr_new_job",
        title: `New babysitting job in ${bsr.suburb}`,
        body: `A family needs a babysitter. ${n.distanceKm < 1 ? "<1" : n.distanceKm} km from you. £${bsr.hourly_rate}/hr. Request it now!`,
        actionUrl: "/nanny/babysitting",
        referenceId: bsrId,
        referenceType: "babysitting_request",
      }).catch((err) => console.error("[BSR] Inbox error:", err)),
    ),
  );

  revalidatePath("/parent/babysitting");
  return { success: true, error: null };
}

// ══════════════════════════════════════════════════════════════
// 2. REQUEST BABYSITTING JOB (Nanny requests — parent approves later)
// ══════════════════════════════════════════════════════════════

export async function requestBabysittingJob(
  babysittingRequestId: string,
): Promise<{ success: boolean; error: string | null }> {
  const adminClient = createAdminClient();
  const now = new Date().toISOString();

  const nannyInfo = await getNannyId();
  if (!nannyInfo) {
    return { success: false, error: "Not authenticated as nanny" };
  }

  // Check ban status
  const { data: nannyData } = await adminClient
    .from("nannies")
    .select("bsr_banned_until")
    .eq("id", nannyInfo.nannyId)
    .single();

  if (
    nannyData?.bsr_banned_until &&
    new Date(nannyData.bsr_banned_until) > new Date()
  ) {
    const banDate = new Date(nannyData.bsr_banned_until).toLocaleDateString(
      APP_LOCALE,
      {
        day: "numeric",
        month: "long",
        year: "numeric",
      },
    );
    return {
      success: false,
      error: `You are currently suspended from babysitting jobs until ${banDate}`,
    };
  }

  // Verify nanny was notified and hasn't already requested/declined/been accepted
  const { data: notification } = await adminClient
    .from("bsr_notifications")
    .select("id, distance_km")
    .eq("babysitting_request_id", babysittingRequestId)
    .eq("nanny_id", nannyInfo.nannyId)
    .is("declined_at", null)
    .is("requested_at", null)
    .is("accepted_at", null)
    .single();

  if (!notification) {
    return {
      success: false,
      error: "You are not eligible for this job or have already requested it",
    };
  }

  // Check ALL slots for clashes (nanny accepts entire job, not individual slots)
  const { data: allSlots } = await adminClient
    .from("bsr_time_slots")
    .select("slot_date, start_time, end_time")
    .eq("babysitting_request_id", babysittingRequestId);

  if (allSlots) {
    for (const slot of allSlots) {
      const clashResult = await hasClash(
        nannyInfo.nannyId,
        slot.slot_date,
        slot.start_time,
        slot.end_time,
      );

      if (clashResult.clash) {
        return {
          success: false,
          error: `You have a scheduling clash on ${formatSlotDisplay(slot)} (existing job: ${clashResult.existingJob}). We require a 2-hour buffer between jobs.`,
        };
      }
    }
  }

  // Verify BSR is still open
  const { data: bsr } = await adminClient
    .from("babysitting_requests")
    .select("id, parent_id, suburb, special_requirements, hourly_rate, status")
    .eq("id", babysittingRequestId)
    .eq("status", "open")
    .single();

  if (!bsr) {
    return { success: false, error: "This job is no longer available" };
  }

  // Mark this nanny's notification as requested
  await adminClient
    .from("bsr_notifications")
    .update({
      requested_at: now,
      viewed_at: now,
    })
    .eq("id", notification.id);

  // BSR-010: Email parent — nanny wants their job
  const nannyEmailInfo = await getUserEmailInfo(nannyInfo.userId);
  const { data: parentData } = await adminClient
    .from("parents")
    .select("user_id")
    .eq("id", bsr.parent_id)
    .single();

  if (parentData) {
    const parentInfo = await getUserEmailInfo(parentData.user_id);

    const { data: slots } = await adminClient
      .from("bsr_time_slots")
      .select("slot_date, start_time, end_time")
      .eq("babysitting_request_id", babysittingRequestId)
      .limit(1);

    const slotDisplay = slots?.[0] ? formatSlotDisplay(slots[0]) : "";

    if (parentInfo && nannyEmailInfo) {
      sendEmail({
        to: parentInfo.email,
        subject: `${nannyEmailInfo.firstName} wants to babysit for you!`,
        html: `<div style="${BASE_STYLE}">
          <div style="background: #F5F3FF; border-radius: 12px; padding: 20px;">
            ${emailHeader()}
            <p style="color: #374151; font-size: 16px; line-height: 1.6;">Hi ${parentInfo.firstName},</p>
            <p style="color: #374151; font-size: 16px; line-height: 1.6;">${nannyEmailInfo.firstName} has requested your babysitting job!</p>
            ${slotDisplay ? `<p style="color: #374151; margin: 4px 0;">${slotDisplay}</p>` : ""}
            <p style="color: #374151; margin: 4px 0;">Review their profile and accept or wait for more requests.</p>
            <p style="margin-top: 16px;"><a href="${APP_URL}/parent/babysitting" style="${BTN_STYLE}">Review Requests</a></p>
          </div>
        </div>`,
        emailType: "bsr_nanny_requested",
        recipientUserId: parentData.user_id,
      }).catch((err) => console.error("[BSR] BSR-010 email error:", err));
    }

    // Inbox for parent
    await createInboxMessage({
      userId: parentData.user_id,
      type: "bsr_nanny_requested",
      title: `${nannyEmailInfo?.firstName ?? "A nanny"} requested your babysitting job`,
      body: "Review their profile and accept if they're a good fit.",
      actionUrl: "/parent/babysitting",
      referenceId: babysittingRequestId,
      referenceType: "babysitting_request",
    });
  }

  // Proactive: acknowledge the request to the NANNY's Katie. The
  // nanny's own action → their own bot narrates "request sent".
  dispatchActionTriggeredInBackground({
    triggerId: "bsr.request_submitted",
    recipientUserId: nannyInfo.userId,
    payload: {
      bsr_id: babysittingRequestId,
    },
  });

  revalidatePath("/nanny/babysitting");
  revalidatePath("/parent/babysitting");
  return { success: true, error: null };
}

// ══════════════════════════════════════════════════════════════
// 2A. PUBLIC BSR APPLICATION (Nanny applies from public page)
// ══════════════════════════════════════════════════════════════

export type BsrPublicApplyResult =
  | { status: "applied" }
  | { status: "unauthenticated" }
  | { status: "not_nanny" }
  | { status: "not_eligible" }
  | { status: "already_applied" }
  | { status: "bsr_closed" }
  | { status: "clash"; error: string }
  | { status: "error"; error: string };

export async function applyToBsrPublic(
  bsrId: string,
): Promise<BsrPublicApplyResult> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { status: "unauthenticated" };

  const adminClient = createAdminClient();
  const now = new Date().toISOString();

  // Get nanny record
  const { data: nanny } = await adminClient
    .from("nannies")
    .select("id, visible_in_bsr, bsr_banned_until")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!nanny) return { status: "not_nanny" };
  if (!nanny.visible_in_bsr) return { status: "not_eligible" };

  // Ban check
  if (nanny.bsr_banned_until && new Date(nanny.bsr_banned_until) > new Date()) {
    const banDate = new Date(nanny.bsr_banned_until).toLocaleDateString(
      APP_LOCALE,
      {
        day: "numeric",
        month: "long",
        year: "numeric",
      },
    );
    return {
      status: "error",
      error: `You are suspended from babysitting jobs until ${banDate}`,
    };
  }

  // BSR must be open
  const { data: bsr } = await adminClient
    .from("babysitting_requests")
    .select("id, parent_id, suburb, special_requirements, hourly_rate, status")
    .eq("id", bsrId)
    .eq("status", "open")
    .single();

  if (!bsr) return { status: "bsr_closed" };

  // Check existing notification
  const { data: existingNotif } = await adminClient
    .from("bsr_notifications")
    .select("id, requested_at, declined_at, accepted_at")
    .eq("babysitting_request_id", bsrId)
    .eq("nanny_id", nanny.id)
    .maybeSingle();

  if (existingNotif) {
    if (existingNotif.requested_at || existingNotif.accepted_at)
      return { status: "already_applied" };
    if (existingNotif.declined_at)
      return { status: "error", error: "You previously declined this job" };
  }

  // Scheduling clash check
  const { data: allSlots } = await adminClient
    .from("bsr_time_slots")
    .select("slot_date, start_time, end_time")
    .eq("babysitting_request_id", bsrId);

  if (allSlots) {
    for (const slot of allSlots) {
      const clashResult = await hasClash(
        nanny.id,
        slot.slot_date,
        slot.start_time,
        slot.end_time,
      );
      if (clashResult.clash) {
        return {
          status: "clash",
          error: `You have a scheduling clash on ${formatSlotDisplay(slot)} (existing job: ${clashResult.existingJob}). We require a 2-hour buffer between jobs.`,
        };
      }
    }
  }

  // Compute distance
  let distanceKm = 0;
  const { data: nannyProfile } = await adminClient
    .from("user_profiles")
    .select("suburb")
    .eq("user_id", user.id)
    .maybeSingle();

  if (nannyProfile?.suburb) {
    const { data: nannyLoc } = await adminClient
      .from("london_districts")
      .select("latitude, longitude")
      .eq("district", nannyProfile.suburb)
      .maybeSingle();

    const { data: bsrLoc } = await adminClient
      .from("london_districts")
      .select("latitude, longitude")
      .eq("district", bsr.suburb)
      .maybeSingle();

    if (nannyLoc && bsrLoc) {
      distanceKm = Math.floor(
        haversineDistance(
          Number(nannyLoc.latitude),
          Number(nannyLoc.longitude),
          Number(bsrLoc.latitude),
          Number(bsrLoc.longitude),
        ),
      );
    }
  }

  // Create or update notification row
  if (existingNotif) {
    await adminClient
      .from("bsr_notifications")
      .update({ requested_at: now, viewed_at: now })
      .eq("id", existingNotif.id);
  } else {
    const { error: insertErr } = await adminClient
      .from("bsr_notifications")
      .insert({
        babysitting_request_id: bsrId,
        nanny_id: nanny.id,
        distance_km: distanceKm,
        notified_at: now,
        viewed_at: now,
        requested_at: now,
        notification_method: "in_app",
      });

    if (insertErr) {
      console.error("[BSR] Public apply insert error:", insertErr);
      return {
        status: "error",
        error: "Failed to submit application. Please try again.",
      };
    }
  }

  // BSR-010: Email parent — nanny wants their job
  const nannyEmailInfo = await getUserEmailInfo(user.id);
  const { data: parentData } = await adminClient
    .from("parents")
    .select("user_id")
    .eq("id", bsr.parent_id)
    .single();

  if (parentData) {
    const parentInfo = await getUserEmailInfo(parentData.user_id);

    const { data: slots } = await adminClient
      .from("bsr_time_slots")
      .select("slot_date, start_time, end_time")
      .eq("babysitting_request_id", bsrId)
      .limit(1);

    const slotDisplay = slots?.[0] ? formatSlotDisplay(slots[0]) : "";

    if (parentInfo && nannyEmailInfo) {
      sendEmail({
        to: parentInfo.email,
        subject: `${nannyEmailInfo.firstName} wants to babysit for you!`,
        html: `<div style="${BASE_STYLE}">
          <div style="background: #F5F3FF; border-radius: 12px; padding: 20px;">
            ${emailHeader()}
            <p style="color: #374151; font-size: 16px; line-height: 1.6;">Hi ${parentInfo.firstName},</p>
            <p style="color: #374151; font-size: 16px; line-height: 1.6;">${nannyEmailInfo.firstName} has requested your babysitting job!</p>
            ${slotDisplay ? `<p style="color: #374151; margin: 4px 0;">${slotDisplay}</p>` : ""}
            <p style="color: #374151; margin: 4px 0;">Review their profile and accept or wait for more requests.</p>
            <p style="margin-top: 16px;"><a href="${APP_URL}/parent/babysitting" style="${BTN_STYLE}">Review Requests</a></p>
          </div>
        </div>`,
        emailType: "bsr_nanny_requested",
        recipientUserId: parentData.user_id,
      }).catch((err) =>
        console.error("[BSR] BSR-010 public apply email error:", err),
      );
    }

    await createInboxMessage({
      userId: parentData.user_id,
      type: "bsr_nanny_requested",
      title: `${nannyEmailInfo?.firstName ?? "A nanny"} requested your babysitting job`,
      body: "Review their profile and accept if they're a good fit.",
      actionUrl: "/parent/babysitting",
      referenceId: bsrId,
      referenceType: "babysitting_request",
    });
  }

  revalidatePath("/nanny/babysitting");
  revalidatePath("/parent/babysitting");
  return { status: "applied" };
}

// ══════════════════════════════════════════════════════════════
// 2B. PARENT ACCEPT NANNY (Parent picks a nanny from requesters)
// ══════════════════════════════════════════════════════════════

export async function parentAcceptNanny(
  babysittingRequestId: string,
  nannyId: string,
): Promise<{
  success: boolean;
  error: string | null;
  nannyPhone?: string;
  nannyFirstName?: string;
}> {
  const adminClient = createAdminClient();
  const now = new Date().toISOString();

  const parentId = await getParentId();
  if (!parentId) {
    return { success: false, error: "Not authenticated as parent" };
  }

  // Verify BSR ownership and status
  const { data: bsr } = await adminClient
    .from("babysitting_requests")
    .select(
      "id, parent_id, suburb, address, special_requirements, hourly_rate, children",
    )
    .eq("id", babysittingRequestId)
    .eq("parent_id", parentId)
    .eq("status", "open")
    .single();

  if (!bsr) {
    return { success: false, error: "Request not found or already filled" };
  }

  // Verify nanny has requested this job
  const { data: notification } = await adminClient
    .from("bsr_notifications")
    .select("id, distance_km")
    .eq("babysitting_request_id", babysittingRequestId)
    .eq("nanny_id", nannyId)
    .not("requested_at", "is", null)
    .is("declined_at", null)
    .is("accepted_at", null)
    .single();

  if (!notification) {
    return {
      success: false,
      error: "This nanny has not requested or is no longer available",
    };
  }

  // Get nanny phone number BEFORE the fill update (same pattern as connections)
  const { data: nannyRowForPhone } = await adminClient
    .from("nannies")
    .select("user_id")
    .eq("id", nannyId)
    .single();

  let nannyPhoneToStore: string | null = null;
  if (nannyRowForPhone) {
    nannyPhoneToStore = await getNannyPhone(nannyRowForPhone.user_id);
  }

  // ATOMIC fill: only succeeds if status is still 'open'
  const { data: filled, error: fillError } = await adminClient
    .from("babysitting_requests")
    .update({
      status: "filled",
      accepted_nanny_id: nannyId,
      accepted_at: now,
      nanny_phone_shared: nannyPhoneToStore,
      updated_at: now,
    })
    .eq("id", babysittingRequestId)
    .eq("status", "open")
    .select("id")
    .single();

  if (fillError || !filled) {
    return { success: false, error: "This request has already been filled" };
  }

  // Mark this nanny's notification as accepted
  await adminClient
    .from("bsr_notifications")
    .update({ accepted_at: now })
    .eq("id", notification.id);

  // Mark ALL time slots as selected (nanny accepts entire job)
  await adminClient
    .from("bsr_time_slots")
    .update({ is_selected: true })
    .eq("babysitting_request_id", babysittingRequestId);

  // Mark all other notifications as filled
  await adminClient
    .from("bsr_notifications")
    .update({ notified_filled: true, notified_filled_at: now })
    .eq("babysitting_request_id", babysittingRequestId)
    .neq("nanny_id", nannyId);

  // BSR-003: Email winning nanny — "You got the job!"
  const { data: nannyRow } = await adminClient
    .from("nannies")
    .select("user_id")
    .eq("id", nannyId)
    .single();

  // Get slot display
  const { data: slots } = await adminClient
    .from("bsr_time_slots")
    .select("slot_date, start_time, end_time")
    .eq("babysitting_request_id", babysittingRequestId);

  const slotsDisplay = (slots ?? [])
    .map((s) => formatSlotDisplay(s))
    .join("<br>");

  // Get children info from BSR row
  const bsrChildren = (bsr.children ?? []) as Array<{
    ageMonths: number;
    gender: string;
  }>;
  const childrenStr =
    bsrChildren.length > 0
      ? `${bsrChildren.length} child${bsrChildren.length > 1 ? "ren" : ""}: ${bsrChildren.map((c) => ageMonthsToDisplay(c.ageMonths)).join(", ")}`
      : "";

  // Get nanny phone number and name for parent
  let nannyPhone: string | undefined;
  let nannyFirstName: string | undefined;

  if (nannyRow) {
    const nannyEmailInfo = await getUserEmailInfo(nannyRow.user_id);
    nannyPhone = (await getNannyPhone(nannyRow.user_id)) ?? undefined;
    nannyFirstName = nannyEmailInfo?.firstName;

    if (nannyEmailInfo) {
      // BSR-003: Email nanny — "You got the job, parent will contact you"
      sendEmail({
        to: nannyEmailInfo.email,
        subject: "You got the babysitting job!",
        html: `<div style="${BASE_STYLE}">
          <div style="background: #F5F3FF; border-radius: 12px; padding: 20px;">
            ${emailHeader()}
            <p style="color: #374151; font-size: 16px; line-height: 1.6;">Hi ${nannyEmailInfo.firstName},</p>
            <p style="color: #374151; font-size: 16px; line-height: 1.6;">Great news — the family has chosen you for their babysitting job!</p>
            ${slotsDisplay ? `<p style="color: #374151; margin: 4px 0;">${slotsDisplay}</p>` : ""}
            <p style="color: #374151; margin: 4px 0;">📍 ${bsr.suburb}</p>
            ${childrenStr ? `<p style="color: #374151; margin: 4px 0;">👶 ${childrenStr}</p>` : ""}
            ${bsr.hourly_rate ? `<p style="color: #374151; margin: 4px 0;">💰 £${bsr.hourly_rate}/hr</p>` : ""}
            <p style="color: #374151; font-size: 14px; line-height: 1.6; margin-top: 12px;">View the full details including the address in your Baby Bloom dashboard.</p>
            <p style="margin-top: 16px;"><a href="${APP_URL}/nanny/babysitting" style="${BTN_STYLE}">See Full Details</a></p>
          </div>
        </div>`,
        emailType: "bsr_accepted_nanny",
        recipientUserId: nannyRow.user_id,
      }).catch((err) => console.error("[BSR] BSR-003 email error:", err));
    }

    // Inbox for nanny
    await createInboxMessage({
      userId: nannyRow.user_id,
      type: "bsr_accepted",
      title: "You got the babysitting job!",
      body: `The family in ${bsr.suburb} has chosen you. The parent will be in contact soon to confirm all details.`,
      actionUrl: "/nanny/babysitting",
      referenceId: babysittingRequestId,
      referenceType: "babysitting_request",
    });
  }

  // BSR-012: Email parent — confirmation with nanny phone number
  const { data: parentRow } = await adminClient
    .from("parents")
    .select("user_id")
    .eq("id", parentId)
    .single();

  if (parentRow) {
    const parentInfo = await getUserEmailInfo(parentRow.user_id);

    if (parentInfo) {
      sendEmail({
        to: parentInfo.email,
        subject: "Babysitter confirmed!",
        html: `<div style="${BASE_STYLE}">
          <div style="background: #F5F3FF; border-radius: 12px; padding: 20px;">
            ${emailHeader()}
            <p style="color: #374151; font-size: 16px; line-height: 1.6;">Hi ${parentInfo.firstName},</p>
            <p style="color: #374151; font-size: 16px; line-height: 1.6;">Great news — your babysitter is confirmed!</p>
            ${nannyFirstName ? `<p style="color: #374151; margin: 4px 0; font-weight: 600;">👩 ${nannyFirstName}</p>` : ""}
            ${slotsDisplay ? `<p style="color: #374151; margin: 4px 0;">${slotsDisplay}</p>` : ""}
            <p style="color: #374151; margin: 4px 0;">📍 ${bsr.suburb}</p>
            ${bsr.hourly_rate ? `<p style="color: #374141; margin: 4px 0;">💰 £${bsr.hourly_rate}/hr</p>` : ""}
            <p style="color: #374151; font-size: 14px; line-height: 1.6; margin-top: 12px;">View the full booking details and your babysitter's contact information in your Baby Bloom dashboard.</p>
            <p style="margin-top: 16px;"><a href="${APP_URL}/parent/babysitting" style="${BTN_STYLE}">See Full Details</a></p>
          </div>
        </div>`,
        emailType: "bsr_confirmed_parent",
        recipientUserId: parentRow.user_id,
      }).catch((err) => console.error("[BSR] BSR-012 email error:", err));
    }

    // Inbox for parent
    await createInboxMessage({
      userId: parentRow.user_id,
      type: "bsr_confirmed",
      title: "Babysitter confirmed!",
      body: `Your babysitter${nannyFirstName ? ` ${nannyFirstName}` : ""} is confirmed. Please contact them directly to confirm all details.`,
      actionUrl: "/parent/babysitting",
      referenceId: babysittingRequestId,
      referenceType: "babysitting_request",
    });
  }

  // BSR-011: Email unsuccessful nannies who requested the job
  const { data: unsuccessfulNotifs } = await adminClient
    .from("bsr_notifications")
    .select("nanny_id")
    .eq("babysitting_request_id", babysittingRequestId)
    .not("requested_at", "is", null)
    .neq("nanny_id", nannyId);

  if (unsuccessfulNotifs && unsuccessfulNotifs.length > 0) {
    const unsuccessfulNannyIds = unsuccessfulNotifs.map((n) => n.nanny_id);
    const { data: unsuccessfulNannies } = await adminClient
      .from("nannies")
      .select("id, user_id")
      .in("id", unsuccessfulNannyIds);

    if (unsuccessfulNannies) {
      const firstSlotDisplay = slots?.[0] ? formatSlotDisplay(slots[0]) : "";
      const rejectEmails = unsuccessfulNannies.map(async (n) => {
        const info = await getUserEmailInfo(n.user_id);
        if (!info) return null;
        return {
          to: info.email,
          subject: "Babysitting position filled",
          html: `<div style="${BASE_STYLE}">
            <div style="background: #F5F3FF; border-radius: 12px; padding: 20px;">
              ${emailHeader()}
              <p style="color: #374151; font-size: 16px; line-height: 1.6;">Hi ${info.firstName},</p>
              <p style="color: #374151; font-size: 16px; line-height: 1.6;">The babysitting job in ${bsr.suburb}${firstSlotDisplay ? ` (${firstSlotDisplay})` : ""} has been filled by another nanny.</p>
              <p style="color: #374151; margin: 4px 0;">Keep an eye out for new opportunities — new jobs pop up regularly!</p>
              <p style="margin-top: 16px;"><a href="${APP_URL}/nanny/babysitting" style="${BTN_STYLE}">View Jobs</a></p>
            </div>
          </div>`,
          emailType: "bsr_position_filled",
          recipientUserId: n.user_id,
        };
      });

      Promise.all(rejectEmails)
        .then(async (emails) => {
          const valid = emails.filter(
            (e): e is NonNullable<typeof e> => e !== null,
          );
          if (valid.length > 0) await sendBatchEmails(valid);
        })
        .catch((err) => console.error("[BSR] BSR-011 batch email error:", err));

      // BINB-011: Inbox messages for unsuccessful nannies
      for (const n of unsuccessfulNannies) {
        createInboxMessage({
          userId: n.user_id,
          type: "bsr_position_filled",
          title: "Babysitting job filled",
          body: `The babysitting job in ${bsr.suburb}${firstSlotDisplay ? ` (${firstSlotDisplay})` : ""} has been filled. Keep an eye out for new opportunities!`,
          actionUrl: "/nanny/babysitting",
          referenceId: babysittingRequestId,
          referenceType: "babysitting_request",
        }).catch((err) => console.error("[BSR] BINB-011 inbox error:", err));
      }
    }
  }

  // Proactive: narrate the "you got it!" to the winning nanny's Katie.
  // Parent's own bot already saw them take the action; no need to
  // narrate that side. Only the booked nanny hears from Katie here.
  //
  // `family_phrase` is passed as a COMPLETE subject phrase so the
  // template never has to prepend/append words around it ("The" + bare
  // word → grammar break). When we can resolve the parent's first name
  // we pass "The Chen family"; otherwise we pass the neutral fallback
  // and the template still reads cleanly.
  if (nannyRow) {
    const slotForTemplate = (slots ?? [])[0]
      ? formatSlotDisplay((slots ?? [])[0])
      : "your booking";
    const { data: parentRow } = await adminClient
      .from("parents")
      .select("user_id")
      .eq("id", bsr.parent_id)
      .maybeSingle();
    const parentEmailForName = parentRow
      ? await getUserEmailInfo(parentRow.user_id).catch(() => null)
      : null;
    const familyPhrase =
      parentEmailForName && parentEmailForName.lastName
        ? `The ${parentEmailForName.lastName} family`
        : "A family";
    dispatchActionTriggeredInBackground({
      triggerId: "bsr.accepted_by_parent",
      recipientUserId: nannyRow.user_id,
      payload: {
        family_phrase: familyPhrase,
        when: slotForTemplate,
        bsr_id: babysittingRequestId,
      },
    });
  }

  revalidatePath("/parent/babysitting");
  revalidatePath("/nanny/babysitting");
  return { success: true, error: null, nannyPhone, nannyFirstName };
}

// ══════════════════════════════════════════════════════════════
// 2C. PARENT DECLINE NANNY (Parent rejects a requesting nanny)
// ══════════════════════════════════════════════════════════════

export async function parentDeclineNanny(
  babysittingRequestId: string,
  nannyId: string,
): Promise<{ success: boolean; error: string | null }> {
  const adminClient = createAdminClient();
  const now = new Date().toISOString();

  const parentId = await getParentId();
  if (!parentId) {
    return { success: false, error: "Not authenticated as parent" };
  }

  // Verify BSR ownership
  const { data: bsr } = await adminClient
    .from("babysitting_requests")
    .select("id")
    .eq("id", babysittingRequestId)
    .eq("parent_id", parentId)
    .eq("status", "open")
    .single();

  if (!bsr) {
    return { success: false, error: "Request not found" };
  }

  await adminClient
    .from("bsr_notifications")
    .update({ declined_at: now, declined_reason: "parent_declined" })
    .eq("babysitting_request_id", babysittingRequestId)
    .eq("nanny_id", nannyId)
    .is("accepted_at", null);

  // Proactive: let the DECLINED nanny's Katie know softly. The main
  // site UI keeps the parent-decline silent from the nanny's
  // perspective (no notification); Katie's chat is the user's own
  // private space, so a gentle heads-up is appropriate here.
  //
  // Pass `family_phrase` as a complete subject phrase. Fallback
  // "That family" reads cleanly when we can't resolve the parent's
  // last name.
  const { data: nannyRowForDecline } = await adminClient
    .from("nannies")
    .select("user_id")
    .eq("id", nannyId)
    .maybeSingle();
  if (nannyRowForDecline) {
    const { data: bsrParentRow } = await adminClient
      .from("babysitting_requests")
      .select("parent_id")
      .eq("id", babysittingRequestId)
      .maybeSingle();
    let familyPhrase = "That family";
    if (bsrParentRow?.parent_id) {
      const { data: pRow } = await adminClient
        .from("parents")
        .select("user_id")
        .eq("id", bsrParentRow.parent_id)
        .maybeSingle();
      if (pRow) {
        const info = await getUserEmailInfo(pRow.user_id).catch(() => null);
        if (info?.lastName) familyPhrase = `The ${info.lastName} family`;
      }
    }
    dispatchActionTriggeredInBackground({
      triggerId: "bsr.declined_by_parent",
      recipientUserId: nannyRowForDecline.user_id,
      payload: {
        family_phrase: familyPhrase,
        bsr_id: babysittingRequestId,
      },
    });
  }

  revalidatePath("/parent/babysitting");
  revalidatePath("/nanny/babysitting");
  return { success: true, error: null };
}

// ══════════════════════════════════════════════════════════════
// 3. DECLINE BABYSITTING REQUEST (Nanny)
// ══════════════════════════════════════════════════════════════

export async function declineBabysittingRequest(
  babysittingRequestId: string,
  reason?: string,
): Promise<{ success: boolean; error: string | null }> {
  const adminClient = createAdminClient();
  const now = new Date().toISOString();

  const nannyInfo = await getNannyId();
  if (!nannyInfo) {
    return { success: false, error: "Not authenticated as nanny" };
  }

  const { error } = await adminClient
    .from("bsr_notifications")
    .update({
      declined_at: now,
      declined_reason: reason || null,
    })
    .eq("babysitting_request_id", babysittingRequestId)
    .eq("nanny_id", nannyInfo.nannyId)
    .is("declined_at", null)
    .is("accepted_at", null);

  if (error) {
    console.error("[BSR] Decline error:", error);
    return { success: false, error: "Failed to decline" };
  }

  revalidatePath("/nanny/babysitting");
  return { success: true, error: null };
}

// ══════════════════════════════════════════════════════════════
// 4. CANCEL BABYSITTING REQUEST (Parent)
// ══════════════════════════════════════════════════════════════

export async function cancelBabysittingRequest(
  babysittingRequestId: string,
): Promise<{ success: boolean; error: string | null }> {
  const adminClient = createAdminClient();
  const now = new Date().toISOString();

  const parentId = await getParentId();
  if (!parentId) {
    return { success: false, error: "Not authenticated as parent" };
  }

  // Get BSR and verify ownership
  const { data: bsr } = await adminClient
    .from("babysitting_requests")
    .select("id, status, accepted_nanny_id, suburb")
    .eq("id", babysittingRequestId)
    .eq("parent_id", parentId)
    .single();

  if (!bsr) {
    return { success: false, error: "Babysitting request not found" };
  }

  if (!["pending_payment", "open", "filled"].includes(bsr.status)) {
    return { success: false, error: "This request cannot be cancelled" };
  }

  const wasFilled = bsr.status === "filled";

  await adminClient
    .from("babysitting_requests")
    .update({ status: "cancelled", cancelled_by: "parent", updated_at: now })
    .eq("id", babysittingRequestId);

  // BSR-006: If was filled, notify the accepted nanny
  if (wasFilled && bsr.accepted_nanny_id) {
    const { data: nanny } = await adminClient
      .from("nannies")
      .select("user_id")
      .eq("id", bsr.accepted_nanny_id)
      .single();

    if (nanny) {
      const nannyEmailInfo = await getUserEmailInfo(nanny.user_id);

      await createInboxMessage({
        userId: nanny.user_id,
        type: "bsr_cancelled",
        title: "Babysitting job cancelled",
        body: "The parent has cancelled the babysitting request you accepted.",
        actionUrl: "/nanny/babysitting",
        referenceId: babysittingRequestId,
        referenceType: "babysitting_request",
      });

      if (nannyEmailInfo) {
        sendEmail({
          to: nannyEmailInfo.email,
          subject: "Babysitting job cancelled",
          html: `<div style="${BASE_STYLE}">
            <div style="background: #F5F3FF; border-radius: 12px; padding: 20px;">
              ${emailHeader()}
              <p style="color: #374151; font-size: 16px; line-height: 1.6;">Hi ${nannyEmailInfo.firstName},</p>
              <p style="color: #374151; font-size: 16px; line-height: 1.6;">The parent has cancelled the babysitting request in ${bsr.suburb} that you accepted. We apologise for any inconvenience.</p>
              <p style="color: #374151; margin: 4px 0;">Don't worry — new opportunities pop up regularly.</p>
              <p style="margin-top: 16px;"><a href="${APP_URL}/nanny/babysitting" style="${BTN_STYLE}">View Jobs</a></p>
            </div>
          </div>`,
          emailType: "bsr_cancelled_nanny",
          recipientUserId: nanny.user_id,
        }).catch((err) => console.error("[BSR] BSR-006 email error:", err));
      }
    }
  }

  revalidatePath("/parent/babysitting");
  revalidatePath("/nanny/babysitting");
  return { success: true, error: null };
}

// ══════════════════════════════════════════════════════════════
// 5. NANNY CANCEL BABYSITTING REQUEST (Nanny cancels accepted job)
// ══════════════════════════════════════════════════════════════

export async function nannyCancelBabysittingRequest(
  babysittingRequestId: string,
): Promise<{
  success: boolean;
  error: string | null;
  cancellationCount?: number;
  banned?: boolean;
}> {
  const adminClient = createAdminClient();
  const now = new Date().toISOString();

  const nannyInfo = await getNannyId();
  if (!nannyInfo) {
    return { success: false, error: "Not authenticated as nanny" };
  }

  // Verify nanny is the accepted nanny and BSR is filled
  const { data: bsr } = await adminClient
    .from("babysitting_requests")
    .select("id, parent_id, suburb, accepted_nanny_id, status")
    .eq("id", babysittingRequestId)
    .eq("accepted_nanny_id", nannyInfo.nannyId)
    .eq("status", "filled")
    .single();

  if (!bsr) {
    return { success: false, error: "Cannot cancel this request" };
  }

  // Set status to nanny_cancelled
  await adminClient
    .from("babysitting_requests")
    .update({
      status: "nanny_cancelled",
      cancelled_by: "nanny",
      nanny_cancelled_at: now,
      accepted_nanny_id: null,
      accepted_at: null,
      updated_at: now,
    })
    .eq("id", babysittingRequestId);

  // Mark nanny's notification as declined (prevents re-accept on reopen)
  await adminClient
    .from("bsr_notifications")
    .update({ declined_at: now, declined_reason: "nanny_cancelled" })
    .eq("babysitting_request_id", babysittingRequestId)
    .eq("nanny_id", nannyInfo.nannyId);

  // Count cancellations
  const cancellationCount = await countNannyCancellations(nannyInfo.nannyId);
  let banned = false;

  // 3-strike ban check
  if (cancellationCount >= 3) {
    const banUntil = new Date();
    banUntil.setMonth(banUntil.getMonth() + 3);

    await adminClient
      .from("nannies")
      .update({ bsr_banned_until: banUntil.toISOString() })
      .eq("id", nannyInfo.nannyId);

    banned = true;

    // BSR-009: Ban notification email
    const nannyEmailInfo = await getUserEmailInfo(nannyInfo.userId);
    if (nannyEmailInfo) {
      const banDateStr = banUntil.toLocaleDateString(APP_LOCALE, {
        day: "numeric",
        month: "long",
        year: "numeric",
      });

      sendEmail({
        to: nannyEmailInfo.email,
        subject: "Babysitting suspension notice",
        html: `<div style="${BASE_STYLE}">
          ${emailHeader()}
          <p style="color: #374151; font-size: 16px; line-height: 1.6;">Hi ${nannyEmailInfo.firstName},</p>
          <p style="color: #374151; font-size: 16px; line-height: 1.6;">You have been suspended from babysitting opportunities for 3 months (until ${banDateStr}).</p>
          <p style="color: #374151; font-size: 16px; line-height: 1.6;">This is because you have cancelled 3 accepted babysitting jobs within the last 12 months. You will automatically be eligible again after ${banDateStr}.</p>
        </div>`,
        emailType: "bsr_ban_notice",
        recipientUserId: nannyInfo.userId,
      }).catch((err) => console.error("[BSR] BSR-009 email error:", err));
    }
  }

  // BSR-007: Notify parent
  const { data: parentData } = await adminClient
    .from("parents")
    .select("user_id")
    .eq("id", bsr.parent_id)
    .single();

  // Check if we can reopen (earliest slot > 4h from now)
  const { data: slots } = await adminClient
    .from("bsr_time_slots")
    .select("id, slot_date, start_time")
    .eq("babysitting_request_id", babysittingRequestId)
    .order("slot_date")
    .order("start_time");

  const fourHoursFromNow = new Date(Date.now() + 4 * 60 * 60 * 1000);
  const canReopen =
    slots &&
    slots.length > 0 &&
    slots.some((s) => {
      const slotStart = new Date(`${s.slot_date}T${s.start_time}`);
      return slotStart > fourHoursFromNow;
    });

  if (canReopen) {
    // Reopen the BSR
    const newExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    await adminClient
      .from("babysitting_requests")
      .update({
        status: "open",
        expires_at: newExpiry,
        updated_at: now,
      })
      .eq("id", babysittingRequestId);

    // Reset filled/requested status on non-declined notifications (nannies must re-request)
    await adminClient
      .from("bsr_notifications")
      .update({
        notified_filled: false,
        notified_filled_at: null,
        requested_at: null,
      })
      .eq("babysitting_request_id", babysittingRequestId)
      .is("declined_at", null);

    // BSR-008: Re-notify remaining nannies
    const { data: remainingNotifs } = await adminClient
      .from("bsr_notifications")
      .select("nanny_id")
      .eq("babysitting_request_id", babysittingRequestId)
      .is("declined_at", null);

    if (remainingNotifs && remainingNotifs.length > 0) {
      const nannyIds = remainingNotifs.map((n) => n.nanny_id);
      const { data: remainingNannies } = await adminClient
        .from("nannies")
        .select("id, user_id")
        .in("id", nannyIds);

      if (remainingNannies) {
        const reopenEmails = remainingNannies.map(async (n) => {
          const info = await getUserEmailInfo(n.user_id);
          if (!info) return null;
          return {
            to: info.email,
            subject: `Babysitting job in ${bsr.suburb} is available again!`,
            html: `<div style="${BASE_STYLE}">
              <div style="background: #F5F3FF; border-radius: 12px; padding: 20px;">
                ${emailHeader()}
                <p style="color: #374151; font-size: 16px; line-height: 1.6;">Hi ${info.firstName},</p>
                <p style="color: #374151; font-size: 16px; line-height: 1.6;">A babysitting job in ${bsr.suburb} is available again! The previous nanny had to cancel.</p>
                <p style="color: #374151; margin: 4px 0;">Request this job and the family will choose their preferred babysitter.</p>
                <p style="margin-top: 16px;"><a href="${APP_URL}/nanny/babysitting" style="${BTN_STYLE}">View Job</a></p>
              </div>
            </div>`,
            emailType: "bsr_reopened",
            recipientUserId: n.user_id,
          };
        });

        Promise.all(reopenEmails)
          .then(async (emails) => {
            const valid = emails.filter(
              (e): e is NonNullable<typeof e> => e !== null,
            );
            if (valid.length > 0) await sendBatchEmails(valid);
          })
          .catch((err) =>
            console.error("[BSR] BSR-008 batch email error:", err),
          );
      }
    }

    // BSR-007 to parent (reopened)
    if (parentData) {
      const parentInfo = await getUserEmailInfo(parentData.user_id);

      await createInboxMessage({
        userId: parentData.user_id,
        type: "bsr_nanny_cancelled",
        title: "Nanny cancelled — we're finding a replacement",
        body: "The nanny cancelled your babysitting job. We've re-notified other nannies in your area.",
        actionUrl: "/parent/babysitting",
        referenceId: babysittingRequestId,
        referenceType: "babysitting_request",
      });

      if (parentInfo) {
        sendEmail({
          to: parentInfo.email,
          subject: "Your babysitter cancelled — we're finding a replacement",
          html: `<div style="${BASE_STYLE}">
            <div style="background: #F5F3FF; border-radius: 12px; padding: 20px;">
              ${emailHeader()}
              <p style="color: #374151; font-size: 16px; line-height: 1.6;">Hi ${parentInfo.firstName},</p>
              <p style="color: #374151; font-size: 16px; line-height: 1.6;">Unfortunately, the nanny who accepted your babysitting request has had to cancel. We've already re-notified other nannies in your area.</p>
              <p style="color: #374151; margin: 4px 0;">We're working to find you a replacement babysitter.</p>
              <p style="margin-top: 16px;"><a href="${APP_URL}/parent/babysitting" style="${BTN_STYLE}">View Request</a></p>
            </div>
          </div>`,
          emailType: "bsr_nanny_cancelled_parent",
          recipientUserId: parentData.user_id,
        }).catch((err) => console.error("[BSR] BSR-007 email error:", err));
      }
    }
  } else {
    // Can't reopen — notify parent it's terminal
    if (parentData) {
      const parentInfo = await getUserEmailInfo(parentData.user_id);

      await createInboxMessage({
        userId: parentData.user_id,
        type: "bsr_nanny_cancelled",
        title: "Nanny cancelled your babysitting job",
        body: "The nanny cancelled your babysitting request. Please create a new request.",
        actionUrl: "/parent/babysitting",
        referenceId: babysittingRequestId,
        referenceType: "babysitting_request",
      });

      if (parentInfo) {
        sendEmail({
          to: parentInfo.email,
          subject: "Your babysitter has cancelled",
          html: `<div style="${BASE_STYLE}">
            <div style="background: #F5F3FF; border-radius: 12px; padding: 20px;">
              ${emailHeader()}
              <p style="color: #374151; font-size: 16px; line-height: 1.6;">Hi ${parentInfo.firstName},</p>
              <p style="color: #374151; font-size: 16px; line-height: 1.6;">Unfortunately, the nanny who accepted your babysitting request has had to cancel. As the job is too soon to find a replacement, please create a new request.</p>
              <p style="color: #374151; margin: 4px 0;">Create a new request to find another babysitter.</p>
              <p style="margin-top: 16px;"><a href="${APP_URL}/parent/babysitting" style="${BTN_STYLE}">Post New Request</a></p>
            </div>
          </div>`,
          emailType: "bsr_nanny_cancelled_parent",
          recipientUserId: parentData.user_id,
        }).catch((err) => console.error("[BSR] BSR-007 email error:", err));
      }
    }
  }

  revalidatePath("/parent/babysitting");
  revalidatePath("/nanny/babysitting");
  return { success: true, error: null, cancellationCount, banned };
}

// ══════════════════════════════════════════════════════════════
// 6. GET PARENT BABYSITTING REQUESTS
// ══════════════════════════════════════════════════════════════

export async function getParentBabysittingRequests(): Promise<{
  data: BabysittingRequestWithSlots[];
  error: string | null;
}> {
  const adminClient = createAdminClient();

  const parentId = await getParentId();
  if (!parentId) {
    return { data: [], error: "Not authenticated as parent" };
  }

  // Lazy expiry
  await expireStaleBSRs(parentId);
  await completeAndRemindBSRs(parentId);

  // Get all BSRs for this parent
  const { data: bsrs, error } = await adminClient
    .from("babysitting_requests")
    .select("*")
    .eq("parent_id", parentId)
    .order("created_at", { ascending: false });

  if (error || !bsrs) {
    return { data: [], error: "Failed to fetch babysitting requests" };
  }

  const bsrIds = bsrs.map((b) => b.id);

  // Get all time slots
  const { data: allSlots } = await adminClient
    .from("bsr_time_slots")
    .select(
      "id, babysitting_request_id, slot_date, start_time, end_time, is_selected",
    )
    .in("babysitting_request_id", bsrIds.length > 0 ? bsrIds : ["__none__"]);

  const slotMap = new Map<string, typeof allSlots>();
  for (const slot of allSlots ?? []) {
    const existing = slotMap.get(slot.babysitting_request_id) ?? [];
    existing.push(slot);
    slotMap.set(slot.babysitting_request_id, existing);
  }

  // Get accepted nanny details
  const acceptedNannyIds = bsrs
    .filter((b) => b.accepted_nanny_id)
    .map((b) => b.accepted_nanny_id!);

  const nannyDetailsMap = new Map<
    string,
    {
      firstName: string;
      lastName: string;
      dateOfBirth: string | null;
      suburb: string | null;
      profilePicUrl: string | null;
      distanceKm: number | null;
      phone: string | null;
    }
  >();

  if (acceptedNannyIds.length > 0) {
    const { data: acceptedNannies } = await adminClient
      .from("nannies")
      .select("id, user_id")
      .in("id", acceptedNannyIds);

    if (acceptedNannies) {
      const userIds = acceptedNannies.map((n) => n.user_id);
      const nannyIdToUserId = new Map<string, string>();
      for (const n of acceptedNannies) {
        nannyIdToUserId.set(n.id, n.user_id);
      }

      // Fetch profiles, phone sources, and distances in parallel (same adminClient)
      const [profilesResult, verificationsResult, notifsResult] =
        await Promise.all([
          adminClient
            .from("user_profiles")
            .select(
              "user_id, first_name, last_name, date_of_birth, suburb, profile_picture_url, mobile_number",
            )
            .in("user_id", userIds),
          adminClient
            .from("verifications")
            .select("user_id, phone_number")
            .in("user_id", userIds)
            .not("phone_number", "is", null)
            .order("created_at", { ascending: false }),
          adminClient
            .from("bsr_notifications")
            .select("nanny_id, babysitting_request_id, distance_km")
            .in("nanny_id", acceptedNannyIds)
            .not("accepted_at", "is", null),
        ]);

      const profiles = profilesResult.data;
      const verifications = verificationsResult.data;
      const notifs = notifsResult.data;

      // Build phone map: user_id → phone (verifications first, then profile mobile_number)
      const phoneMap = new Map<string, string>();
      // First pass: profile mobile_number (lower priority)
      for (const p of profiles ?? []) {
        if (p.mobile_number) phoneMap.set(p.user_id, p.mobile_number);
      }
      // Second pass: verifications phone_number (higher priority, overwrites)
      for (const v of verifications ?? []) {
        if (v.phone_number) phoneMap.set(v.user_id, v.phone_number);
      }

      const distanceMap = new Map<string, number>();
      for (const n of notifs ?? []) {
        distanceMap.set(
          `${n.nanny_id}_${n.babysitting_request_id}`,
          Number(n.distance_km),
        );
      }

      for (const nanny of acceptedNannies) {
        const profile = profiles?.find((p) => p.user_id === nanny.user_id);
        if (profile) {
          const phone = phoneMap.get(nanny.user_id) ?? null;
          nannyDetailsMap.set(nanny.id, {
            firstName: profile.first_name ?? "",
            lastName: profile.last_name ?? "",
            dateOfBirth: profile.date_of_birth ?? null,
            suburb: profile.suburb,
            profilePicUrl: profile.profile_picture_url,
            distanceKm: null,
            phone,
          });
        }
      }

      // Set per-BSR distances
      for (const bsr of bsrs) {
        if (bsr.accepted_nanny_id) {
          const details = nannyDetailsMap.get(bsr.accepted_nanny_id);
          if (details) {
            const distKey = `${bsr.accepted_nanny_id}_${bsr.id}`;
            const dist = distanceMap.get(distKey);
            nannyDetailsMap.set(`${bsr.accepted_nanny_id}_${bsr.id}`, {
              ...details,
              distanceKm:
                dist !== undefined ? Math.floor(dist) : details.distanceKm,
            });
          }
        }
      }
    }
  }

  // Get requesting nannies for open BSRs
  const openBsrIds = bsrs.filter((b) => b.status === "open").map((b) => b.id);
  const requestingNanniesMap = new Map<string, RequestingNanny[]>();

  if (openBsrIds.length > 0) {
    const { data: requestNotifs } = await adminClient
      .from("bsr_notifications")
      .select("babysitting_request_id, nanny_id, distance_km, requested_at")
      .in("babysitting_request_id", openBsrIds)
      .not("requested_at", "is", null)
      .is("declined_at", null)
      .is("accepted_at", null);

    if (requestNotifs && requestNotifs.length > 0) {
      const reqNannyIds = requestNotifs.map((n) => n.nanny_id);

      const { data: reqNannies } = await adminClient
        .from("nannies")
        .select(
          "id, user_id, total_experience_years, hourly_rate_min, verification_tier, verification_level, languages",
        )
        .in("id", reqNannyIds);

      const reqUserIds = (reqNannies ?? []).map((n) => n.user_id);
      const { data: reqProfiles } = await adminClient
        .from("user_profiles")
        .select(
          "user_id, first_name, last_name, date_of_birth, suburb, profile_picture_url",
        )
        .in("user_id", reqUserIds);

      // Build maps
      const reqNannyMap = new Map((reqNannies ?? []).map((n) => [n.id, n]));
      const reqProfileByUserId = new Map(
        (reqProfiles ?? []).map((p) => [p.user_id, p]),
      );

      for (const notif of requestNotifs) {
        const nanny = reqNannyMap.get(notif.nanny_id);
        if (!nanny) continue;
        const profile = reqProfileByUserId.get(nanny.user_id);
        if (!profile) continue;

        const entry: RequestingNanny = {
          nannyId: notif.nanny_id,
          firstName: profile.first_name ?? "",
          lastName: profile.last_name ?? "",
          dateOfBirth: profile.date_of_birth ?? null,
          suburb: profile.suburb,
          profilePicUrl: profile.profile_picture_url,
          distanceKm:
            notif.distance_km != null
              ? Math.floor(Number(notif.distance_km))
              : null,
          requestedAt: notif.requested_at,
          experienceYears: nanny.total_experience_years,
          hourlyRateMin: nanny.hourly_rate_min
            ? Number(nanny.hourly_rate_min)
            : null,
          verificationTier: nanny.verification_tier,
          verificationLevel: nanny.verification_level ?? 0,
          aiHeadline: null,
          languages: nanny.languages,
        };

        const existing =
          requestingNanniesMap.get(notif.babysitting_request_id) ?? [];
        existing.push(entry);
        requestingNanniesMap.set(notif.babysitting_request_id, existing);
      }
    }
  }

  const now = new Date();

  const results: BabysittingRequestWithSlots[] = [];

  for (const bsr of bsrs) {
    const bsrSlots = (slotMap.get(bsr.id) ?? []).map((s) => ({
      id: s.id,
      slot_date: s.slot_date,
      start_time: s.start_time,
      end_time: s.end_time,
      is_selected: s.is_selected,
    }));

    // Check if 24 hours have passed since the latest slot end time
    const latestEnd = bsrSlots.reduce((latest, s) => {
      if (!s.end_time) return latest;
      const end = new Date(`${s.slot_date}T${s.end_time}:00`);
      return !isNaN(end.getTime()) && end > latest ? end : latest;
    }, new Date(0));
    const phoneExpiry = new Date(latestEnd.getTime() + 24 * 60 * 60 * 1000);
    const phoneExpired = latestEnd.getTime() > 0 && phoneExpiry < now;

    let acceptedNanny = bsr.accepted_nanny_id
      ? (nannyDetailsMap.get(`${bsr.accepted_nanny_id}_${bsr.id}`) ??
        nannyDetailsMap.get(bsr.accepted_nanny_id) ??
        undefined)
      : undefined;

    // Strip phone 24 hours after the final time slot
    if (acceptedNanny && phoneExpired) {
      acceptedNanny = { ...acceptedNanny, phone: null };
    }

    results.push({
      id: bsr.id,
      parent_id: bsr.parent_id,
      title: bsr.title,
      description: bsr.description,
      special_requirements: bsr.special_requirements,
      suburb: bsr.suburb,
      postcode: bsr.postcode,
      address: bsr.address ?? null,
      hourly_rate: bsr.hourly_rate ? Number(bsr.hourly_rate) : null,
      status: bsr.status,
      accepted_nanny_id: bsr.accepted_nanny_id,
      accepted_at: bsr.accepted_at,
      nannies_notified_count: bsr.nannies_notified_count ?? 0,
      created_at: bsr.created_at,
      expires_at: bsr.expires_at,
      cancelled_by: bsr.cancelled_by,
      slots: bsrSlots,
      acceptedNanny,
      requestingNannies: requestingNanniesMap.get(bsr.id) ?? [],
    });
  }

  return { data: results, error: null };
}

// ══════════════════════════════════════════════════════════════
// 7. GET NANNY BABYSITTING JOBS
// ══════════════════════════════════════════════════════════════

export async function getNannyBabysittingJobs(): Promise<{
  data: NannyBabysittingJob[];
  error: string | null;
  banned: boolean;
  banUntil: string | null;
}> {
  const adminClient = createAdminClient();

  const nannyInfo = await getNannyId();
  if (!nannyInfo) {
    return {
      data: [],
      error: "Not authenticated as nanny",
      banned: false,
      banUntil: null,
    };
  }

  // Lazy expiry + completion + reminders (global)
  await expireStaleBSRs();
  await completeAndRemindBSRs();

  // Check ban status
  const { data: nannyData } = await adminClient
    .from("nannies")
    .select("bsr_banned_until")
    .eq("id", nannyInfo.nannyId)
    .single();

  const banned = !!(
    nannyData?.bsr_banned_until &&
    new Date(nannyData.bsr_banned_until) > new Date()
  );
  const banUntil = banned ? nannyData!.bsr_banned_until : null;

  // Get nanny's notifications
  const { data: notifications } = await adminClient
    .from("bsr_notifications")
    .select(
      "babysitting_request_id, distance_km, notified_at, viewed_at, requested_at, accepted_at, declined_at, notified_filled",
    )
    .eq("nanny_id", nannyInfo.nannyId)
    .order("notified_at", { ascending: false });

  if (!notifications || notifications.length === 0) {
    return { data: [], error: null, banned, banUntil };
  }

  const bsrIds = notifications.map((n) => n.babysitting_request_id);

  // Get BSR details
  const { data: bsrs } = await adminClient
    .from("babysitting_requests")
    .select(
      "id, title, special_requirements, suburb, postcode, address, hourly_rate, estimated_total, children, status, accepted_nanny_id, created_at, expires_at, parent_id",
    )
    .in("id", bsrIds);

  if (!bsrs) {
    return { data: [], error: null, banned, banUntil };
  }

  const bsrMap = new Map(bsrs.map((b) => [b.id, b]));

  // Get all time slots
  const { data: allSlots } = await adminClient
    .from("bsr_time_slots")
    .select(
      "id, babysitting_request_id, slot_date, start_time, end_time, is_selected",
    )
    .in("babysitting_request_id", bsrIds);

  const slotMap = new Map<
    string,
    Array<{
      id: string;
      slot_date: string;
      start_time: string;
      end_time: string;
      is_selected: boolean;
    }>
  >();
  for (const slot of allSlots ?? []) {
    const existing = slotMap.get(slot.babysitting_request_id) ?? [];
    existing.push(slot);
    slotMap.set(slot.babysitting_request_id, existing);
  }

  // Check clashes for open BSRs
  const results: NannyBabysittingJob[] = [];

  for (const notif of notifications) {
    const bsr = bsrMap.get(notif.babysitting_request_id);
    if (!bsr) continue;

    const slots = slotMap.get(bsr.id) ?? [];
    const children = (
      (bsr.children ?? []) as Array<{ ageMonths: number; gender: string }>
    ).map((c) => ({ age_months: c.ageMonths, gender: c.gender }));

    // Check clashes only for open BSRs where nanny hasn't declined
    const clashSlotIds: string[] = [];
    if (bsr.status === "open" && !notif.declined_at && !notif.notified_filled) {
      for (const slot of slots) {
        const clashResult = await hasClash(
          nannyInfo.nannyId,
          slot.slot_date,
          slot.start_time,
          slot.end_time,
        );
        if (clashResult.clash) {
          clashSlotIds.push(slot.id);
        }
      }
    }

    // Only show full address to nanny once they are accepted
    const isNannyAccepted =
      bsr.status === "filled" && bsr.accepted_nanny_id === nannyInfo.nannyId;

    results.push({
      id: bsr.id,
      title: bsr.title,
      special_requirements: bsr.special_requirements,
      suburb: bsr.suburb,
      postcode: bsr.postcode,
      address: isNannyAccepted ? (bsr.address ?? null) : null,
      hourly_rate: bsr.hourly_rate ? Number(bsr.hourly_rate) : null,
      estimated_total: bsr.estimated_total ? Number(bsr.estimated_total) : null,
      status: bsr.status,
      accepted_nanny_id: bsr.accepted_nanny_id,
      created_at: bsr.created_at,
      expires_at: bsr.expires_at,
      slots: slots.map((s) => ({
        id: s.id,
        slot_date: s.slot_date,
        start_time: s.start_time,
        end_time: s.end_time,
        is_selected: s.is_selected,
      })),
      notification: {
        distanceKm:
          notif.distance_km != null
            ? Math.floor(Number(notif.distance_km))
            : null,
        notifiedAt: notif.notified_at,
        viewedAt: notif.viewed_at,
        requestedAt: notif.requested_at ?? null,
        acceptedAt: notif.accepted_at,
        declinedAt: notif.declined_at,
        notifiedFilled: notif.notified_filled ?? false,
      },
      children,
      clashSlotIds,
    });
  }

  // Mark unviewed notifications as viewed
  const unviewedBsrIds = notifications
    .filter((n) => !n.viewed_at)
    .map((n) => n.babysitting_request_id);

  if (unviewedBsrIds.length > 0) {
    adminClient
      .from("bsr_notifications")
      .update({ viewed_at: new Date().toISOString() })
      .eq("nanny_id", nannyInfo.nannyId)
      .in("babysitting_request_id", unviewedBsrIds)
      .is("viewed_at", null)
      .then(
        () => {},
        (err: unknown) => console.error("[BSR] Mark viewed error:", err),
      );
  }

  return { data: results, error: null, banned, banUntil };
}

// ══════════════════════════════════════════════════════════════
// 8. GET LONDON DISTRICTS (for babysitting request form)
// ══════════════════════════════════════════════════════════════

export async function getLondonDistricts(): Promise<
  Array<{ district: string; prefix: string; label: string }>
> {
  const adminClient = createAdminClient();
  const { data } = await adminClient
    .from("london_districts")
    .select("district, prefix, label")
    .order("district");
  return data ?? [];
}
