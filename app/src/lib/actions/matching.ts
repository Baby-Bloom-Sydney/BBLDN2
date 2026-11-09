'use server';

import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { revalidatePath } from 'next/cache';
import { getParentId, getPosition } from './parent';
import { runMatchmaking } from '@/lib/matching/engine';
import { normalizeNannySchedule } from '@/lib/matching/normalize';
import { DFY_TIERS, type DfyTier } from '@/lib/matching/constants';
import { createInboxMessage, logConnectionEvent } from './connection-helpers';
import { sendEmail } from '@/lib/email/resend';
import { getUserEmailInfo } from '@/lib/email/helpers';
import { BRACKET_KEYS, formatLondonDate } from '@/lib/timezone';
import type { BracketKey } from '@/lib/timezone';
import { CONNECTION_STAGE, HIDDEN_CONNECTION_STAGES, POSITION_STAGE, POSITION_STATUS } from '@/lib/position/constants';
import { funnelLog } from '@/lib/position/logger';
import { publicMatch, type PublicMatchResult } from '@/lib/matching/public-match';
import { profileAge } from '@/lib/profile-age';
import { isUnseenByParent } from '@/lib/connections/silent-hold';
import { emailHeader } from "@/lib/email/brand";
import {
  APP_URL,
  BASE_STYLE,
  BTN_STYLE,
  activateDfyPosition,
  expireDfyNotifications,
  processDfyWaves,
  sendDfyNotifications,
  type DfyEmailContext,
} from '@/lib/matching/dfy-dispatch';


// ── Types ──

export interface MatchesResponse {
  data: {
    matches: PublicMatchResult[];
    stats: {
      totalEligible: number;
      returned: number;
    };
  } | null;
  error: string | null;
}

export interface DfyConnection {
  connectionId: string;
  notificationId: string;
  nannyId: string;
  connectionStage: number;
  proposedTimes: string[] | null;
  confirmedTime: string | null;
  matchScore: number;
  distanceKm: number | null;
  breakdown: {
    experience: number;
    schedule: number;
    location: number;
  } | null;
  overQualifiedBonuses: string[];
  unmetRequirements: string[];
  nanny: {
    firstName: string;
    lastName: string;
    suburb: string | null;
    profilePicUrl: string | null;
    hourlyRateMin: number | null;
    experienceYears: number | null;
    aiHeadline: string | null;
    /** Her age (never her date of birth: the receiver is the family). */
    age: number | null;
    wwccVerified: boolean;
    schedule: Record<string, string[]> | null;
  };
}

export interface DfyNotification {
  id: string;
  positionId: string;
  matchScore: number;
  distanceKm: number | null;
  dfyTier: 'standard' | 'priority';
  status: string;
  notifiedAt: string;
  viewedAt: string | null;
  respondedAt: string | null;
  position: {
    suburb: string | null;
    scheduleType: string | null;
    hourlyRate: number | null;
    hoursPerWeek: number | null;
    daysRequired: string[] | null;
    schedule: Record<string, string[]> | null;
    levelOfSupport: string[] | null;
    urgency: string | null;
    startDate: string | null;
    placementLength: string | null;
    reasonForNanny: string[] | null;
    languagePreference: string | null;
    qualificationRequirement: string | null;
    certificateRequirements: string[] | null;
    vaccinationRequired: boolean | null;
    driversLicenseRequired: boolean | null;
    carRequired: boolean | null;
    comfortableWithPetsRequired: boolean | null;
    nonSmokerRequired: boolean | null;
    otherRequirements: string | null;
    description: string | null;
    children: Array<{ ageMonths: number; gender: string | null }>;
  };
  parent: {
    firstName: string;
    lastName: string;
    profilePicUrl: string | null;
  };
}

// ── Helper: get nanny ID for current user ──

async function getNannyId(): Promise<{ nannyId: string; userId: string } | null> {
  const supabase = createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return null;

  const adminClient = createAdminClient();
  const { data: nanny, error } = await adminClient
    .from('nannies')
    .select('id')
    .eq('user_id', user.id)
    .single();

  if (error || !nanny) return null;
  return { nannyId: nanny.id, userId: user.id };
}

// ════════════════════════════════════════════════════════════════════════════
// 1. GET MATCHES FOR POSITION (existing)
// ════════════════════════════════════════════════════════════════════════════

export async function getMatchesForPosition(): Promise<MatchesResponse> {
  const parentId = await getParentId();
  if (!parentId) {
    return { data: null, error: 'Not authenticated as parent' };
  }

  // Get active position
  const { data: position, error: positionError } = await getPosition();
  if (positionError || !position) {
    return { data: null, error: positionError || 'No active position found' };
  }

  // Run matching
  const { matches, totalEligible } = await runMatchmaking(position.id);

  return {
    data: {
      matches: matches.map(publicMatch),
      stats: {
        totalEligible,
        returned: matches.length,
      },
    },
    error: null,
  };
}

// ════════════════════════════════════════════════════════════════════════════
// 2. TRIGGER DFY MATCHMAKING (Parent) — Wave 1 + pre-create wave 2/3
// ════════════════════════════════════════════════════════════════════════════

export async function triggerDfyMatchmaking(): Promise<{ success: boolean; error: string | null; notifiedCount?: number }> {
  const adminClient = createAdminClient();

  const parentId = await getParentId();
  if (!parentId) {
    return { success: false, error: 'Not authenticated as parent' };
  }

  // Get active position
  const { data: position, error: positionError } = await getPosition();
  if (positionError || !position) {
    return { success: false, error: positionError || 'No active position found' };
  }

  // Check DFY status — allow re-trigger only after expiry
  const { data: positionData } = await adminClient
    .from('nanny_positions')
    .select('dfy_activated_at, dfy_expires_at')
    .eq('id', position.id)
    .single();

  if (positionData?.dfy_activated_at) {
    if (positionData.dfy_expires_at && new Date(positionData.dfy_expires_at) > new Date()) {
      const expiryDate = formatLondonDate(positionData.dfy_expires_at);
      return { success: false, error: `Your search is still active until ${expiryDate}. You can boost again after it expires.` };
    }
    // Expired — run lazy cleanup before re-triggering
    await expireDfyNotifications(position.id, parentId);
  }

  // Run matching algorithm
  const { matches } = await runMatchmaking(position.id);

  // Exclude nannies with existing active connections
  const { data: existingConnections } = await adminClient
    .from('connection_requests')
    .select('nanny_id')
    .eq('position_id', position.id)
    .in('status', ['pending', 'accepted', 'confirmed']);

  // Also exclude ALL previously notified nannies (from any DFY round)
  const { data: previouslyNotified } = await adminClient
    .from('dfy_match_notifications')
    .select('nanny_id')
    .eq('position_id', position.id);

  const excludedNannyIds = new Set([
    ...(existingConnections ?? []).map(c => c.nanny_id),
    ...(previouslyNotified ?? []).map(n => n.nanny_id),
  ]);

  // Take top 60 matches (3 waves of 20), excluding nannies with existing connections
  const topMatches = matches
    .filter(m => !excludedNannyIds.has(m.nannyId))
    .slice(0, 60);

  if (topMatches.length === 0) {
    return { success: false, error: 'No eligible nannies found to notify.' };
  }

  // Split into 3 waves of 20
  const wave1 = topMatches.slice(0, 20);
  const wave2 = topMatches.slice(20, 40);
  const wave3 = topMatches.slice(40, 60);

  const now = new Date().toISOString();

  // Build notification rows for ALL waves
  const allNotificationRows = [
    ...wave1.map(m => ({
      position_id: position.id,
      nanny_id: m.nannyId,
      match_score: m.rawScore,
      distance_km: m.distanceKm,
      notification_method: 'email',
      notified_at: now,
      status: 'notified',
      wave: 1,
      metadata: {
        breakdown: m.breakdown ?? null,
        headline: m.nanny.ai_content?.headline ?? null,
        overQualifiedBonuses: m.overQualifiedBonuses,
        unmetRequirements: m.unmetRequirements,
      },
    })),
    ...wave2.map(m => ({
      position_id: position.id,
      nanny_id: m.nannyId,
      match_score: m.rawScore,
      distance_km: m.distanceKm,
      notification_method: 'email',
      notified_at: null,
      status: 'pending_wave',
      wave: 2,
      metadata: {
        breakdown: m.breakdown ?? null,
        headline: m.nanny.ai_content?.headline ?? null,
        overQualifiedBonuses: m.overQualifiedBonuses,
        unmetRequirements: m.unmetRequirements,
      },
    })),
    ...wave3.map(m => ({
      position_id: position.id,
      nanny_id: m.nannyId,
      match_score: m.rawScore,
      distance_km: m.distanceKm,
      notification_method: 'email',
      notified_at: null,
      status: 'pending_wave',
      wave: 3,
      metadata: {
        breakdown: m.breakdown ?? null,
        headline: m.nanny.ai_content?.headline ?? null,
        overQualifiedBonuses: m.overQualifiedBonuses,
        unmetRequirements: m.unmetRequirements,
      },
    })),
  ];

  const { error: insertError } = await adminClient
    .from('dfy_match_notifications')
    .insert(allNotificationRows);

  if (insertError) {
    console.error('[DFY] Failed to insert notifications:', insertError);
    return { success: false, error: `Failed to create notifications: ${insertError.message}` };
  }

  // Only mark position as DFY-activated AFTER notifications succeed
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const wavesSent = [1];
  await adminClient
    .from('nanny_positions')
    .update({
      dfy_activated_at: now,
      dfy_expires_at: expiresAt,
      dfy_wave_sent: wavesSent,
      updated_at: now,
    })
    .eq('id', position.id);

  // Get parent info for emails
  const { data: parentRecord } = await adminClient
    .from('parents')
    .select('user_id')
    .eq('id', parentId)
    .single();

  const parentProfile = parentRecord
    ? await getUserEmailInfo(parentRecord.user_id)
    : null;
  const parentName = parentProfile ? `${parentProfile.firstName}` : 'A family';
  const parentSuburb = position.suburb || '';

  // Send emails + inbox messages for wave 1 only
  const emailContext: DfyEmailContext = { parentName, parentSuburb, position };
  const { sent } = await sendDfyNotifications(wave1, emailContext);

  if (sent === 0 && wave1.length > 0) {
    return { success: false, error: 'Failed to send notification emails. Please try again or contact support.' };
  }

  revalidatePath('/parent/matches');
  revalidatePath('/parent');
  return { success: true, error: null, notifiedCount: sent };
}

// ════════════════════════════════════════════════════════════════════════════
// 3. GET DFY NOTIFICATIONS FOR NANNY
// ════════════════════════════════════════════════════════════════════════════

export async function getDfyNotificationsForNanny(): Promise<{
  data: DfyNotification[] | null;
  error: string | null;
}> {
  const nannyInfo = await getNannyId();
  if (!nannyInfo) {
    return { data: null, error: 'Not authenticated as nanny' };
  }

  const adminClient = createAdminClient();

  // Get active notifications
  const { data: notifications, error } = await adminClient
    .from('dfy_match_notifications')
    .select('id, position_id, match_score, distance_km, status, notified_at, viewed_at, responded_at')
    .eq('nanny_id', nannyInfo.nannyId)
    .in('status', ['notified', 'viewed', 'interested'])
    .order('match_score', { ascending: false });

  if (error) {
    console.error('[DFY] Error fetching nanny notifications:', error);
    return { data: null, error: 'Failed to fetch notifications.' };
  }

  if (!notifications || notifications.length === 0) {
    return { data: [], error: null };
  }

  // Get position details + parent info
  const positionIds = Array.from(new Set(notifications.map(n => n.position_id)));

  const { data: positions } = await adminClient
    .from('nanny_positions')
    .select('id, parent_id, suburb, schedule_type, hourly_rate, hours_per_week, days_required, level_of_support, urgency, start_date, placement_length, reason_for_nanny, language_preference, qualification_requirement, certificate_requirements, vaccination_required, drivers_license_required, car_required, comfortable_with_pets_required, non_smoker_required, other_requirements_details, description, dfy_tier')
    .in('id', positionIds);

  const { data: children } = await adminClient
    .from('position_children')
    .select('position_id, age_months, gender')
    .in('position_id', positionIds)
    .order('display_order', { ascending: true });

  // Get parent profiles
  const parentIds = Array.from(new Set((positions ?? []).map(p => p.parent_id)));
  const { data: parents } = await adminClient
    .from('parents')
    .select('id, user_id')
    .in('id', parentIds);

  const parentUserIds = (parents ?? []).map(p => p.user_id);
  const { data: parentProfiles } = await adminClient
    .from('user_profiles')
    .select('user_id, first_name, last_name, profile_picture_url')
    .in('user_id', parentUserIds);

  // Build lookup maps
  const positionMap = new Map((positions ?? []).map(p => [p.id, p]));
  const childrenMap = new Map<string, Array<{ ageMonths: number; gender: string | null }>>();
  for (const c of children ?? []) {
    const arr = childrenMap.get(c.position_id) ?? [];
    arr.push({ ageMonths: c.age_months, gender: c.gender });
    childrenMap.set(c.position_id, arr);
  }
  const parentMap = new Map((parents ?? []).map(p => [p.id, p]));
  const parentProfileMap = new Map((parentProfiles ?? []).map(p => [p.user_id, p]));

  // Fetch position schedules (time brackets)
  const { data: scheduleRows } = await adminClient
    .from('position_schedule')
    .select('position_id, schedule')
    .in('position_id', positionIds);

  const scheduleByPosition = new Map<string, Record<string, string[]>>(
    (scheduleRows ?? []).map(s => [s.position_id, s.schedule as Record<string, string[]>])
  );

  const result: DfyNotification[] = notifications.map(n => {
    const pos = positionMap.get(n.position_id);
    const parent = pos ? parentMap.get(pos.parent_id) : null;
    const parentProfile = parent ? parentProfileMap.get(parent.user_id) : null;

    return {
      id: n.id,
      positionId: n.position_id,
      matchScore: n.match_score,
      distanceKm: n.distance_km,
      dfyTier: (pos?.dfy_tier as 'standard' | 'priority') || 'standard',
      status: n.status,
      notifiedAt: n.notified_at,
      viewedAt: n.viewed_at,
      respondedAt: n.responded_at,
      position: {
        suburb: pos?.suburb ?? null,
        scheduleType: pos?.schedule_type ?? null,
        hourlyRate: pos?.hourly_rate ?? null,
        hoursPerWeek: pos?.hours_per_week ?? null,
        daysRequired: pos?.days_required ?? null,
        schedule: scheduleByPosition.get(n.position_id) ?? null,
        levelOfSupport: pos?.level_of_support ?? null,
        urgency: pos?.urgency ?? null,
        startDate: pos?.start_date ?? null,
        placementLength: pos?.placement_length ?? null,
        reasonForNanny: pos?.reason_for_nanny ?? null,
        languagePreference: pos?.language_preference ?? null,
        qualificationRequirement: pos?.qualification_requirement ?? null,
        certificateRequirements: pos?.certificate_requirements ?? null,
        vaccinationRequired: pos?.vaccination_required ?? null,
        driversLicenseRequired: pos?.drivers_license_required ?? null,
        carRequired: pos?.car_required ?? null,
        comfortableWithPetsRequired: pos?.comfortable_with_pets_required ?? null,
        nonSmokerRequired: pos?.non_smoker_required ?? null,
        otherRequirements: pos?.other_requirements_details ?? null,
        description: pos?.description ?? null,
        children: childrenMap.get(n.position_id) ?? [],
      },
      parent: {
        firstName: parentProfile?.first_name ?? 'Family',
        lastName: parentProfile?.last_name ?? '',
        profilePicUrl: parentProfile?.profile_picture_url ?? null,
      },
    };
  });

  return { data: result, error: null };
}

// ════════════════════════════════════════════════════════════════════════════
// 4. RESPOND TO DFY MATCH (Nanny)
// ════════════════════════════════════════════════════════════════════════════

export async function respondToDfyMatch(
  notificationId: string,
  availableSlots: string[]
): Promise<{ success: boolean; error: string | null; connectionId?: string }> {
  const adminClient = createAdminClient();

  const nannyInfo = await getNannyId();
  if (!nannyInfo) {
    return { success: false, error: 'Not authenticated as nanny' };
  }

  // Check verification level (level 3+ can respond)
  const { data: nannyVerData } = await adminClient
    .from('nannies')
    .select('verification_level')
    .eq('id', nannyInfo.nannyId)
    .single();

  const verificationLevel = nannyVerData?.verification_level ?? 0;
  if (verificationLevel < 3) {
    return { success: false, error: 'Please complete verification first.' };
  }

  // Validate availability slots — same rules as acceptConnectionRequest
  if (!availableSlots || availableSlots.length < 5) {
    return { success: false, error: 'Please select at least 5 available time slots.' };
  }

  const validBrackets = new Set(BRACKET_KEYS);
  const selectedBrackets = new Set<string>();
  const selectedDays = new Set<string>();

  for (const slot of availableSlots) {
    const parts = slot.split('_');
    if (parts.length !== 2) return { success: false, error: `Invalid slot format: ${slot}` };
    const [date, bracket] = parts;
    if (!validBrackets.has(bracket as BracketKey)) return { success: false, error: `Invalid bracket: ${bracket}` };
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { success: false, error: `Invalid date format: ${date}` };
    selectedBrackets.add(bracket);
    selectedDays.add(date);
  }

  if (selectedBrackets.size < 4) {
    return { success: false, error: 'Please select at least one slot from each time bracket (Morning, Midday, Afternoon, Evening).' };
  }

  if (selectedDays.size < 3) {
    return { success: false, error: 'Please select slots across at least 3 different days.' };
  }

  // Fetch notification
  const { data: notification, error: fetchErr } = await adminClient
    .from('dfy_match_notifications')
    .select('id, position_id, nanny_id, status')
    .eq('id', notificationId)
    .eq('nanny_id', nannyInfo.nannyId)
    .single();

  if (fetchErr || !notification) {
    return { success: false, error: 'Notification not found.' };
  }

  if (notification.status !== 'notified' && notification.status !== 'viewed') {
    return { success: false, error: 'This notification has already been responded to.' };
  }

  // Get position details
  const { data: position } = await adminClient
    .from('nanny_positions')
    .select('id, dfy_expires_at, parent_id, suburb, stage')
    .eq('id', notification.position_id)
    .single();

  if (!position) {
    return { success: false, error: 'Position not found.' };
  }

  // Check if DFY has expired
  if (position.dfy_expires_at && new Date(position.dfy_expires_at) <= new Date()) {
    await expireDfyNotifications(notification.position_id);
    return { success: false, error: 'This opportunity has expired. The family\'s search window has closed.' };
  }

  // Check position is still open (not ended/closed)
  if (position.stage >= POSITION_STAGE.ENDED) {
    return { success: false, error: 'This position has been closed.' };
  }

  // Check no existing active connection between parent and nanny
  const { data: existingConnection } = await adminClient
    .from('connection_requests')
    .select('id')
    .eq('parent_id', position.parent_id)
    .eq('nanny_id', nannyInfo.nannyId)
    .in('status', ['pending', 'accepted', 'confirmed'])
    .maybeSingle();

  if (existingConnection) {
    return { success: false, error: 'You already have an active connection with this family.' };
  }

  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString();

  // Create connection_request — level 3 gets pending stage, level 4+ gets real stage
  const dfyStage = verificationLevel >= 4
    ? CONNECTION_STAGE.ACCEPTED
    : CONNECTION_STAGE.ACCEPTED_PENDING;

  const { data: connection, error: insertErr } = await adminClient
    .from('connection_requests')
    .insert({
      parent_id: position.parent_id,
      nanny_id: nannyInfo.nannyId,
      position_id: notification.position_id,
      status: 'accepted',
      connection_stage: dfyStage,
      proposed_times: availableSlots,
      responded_at: now,
      expires_at: expiresAt,
      source: 'dfy',
    })
    .select('id')
    .single();

  if (insertErr || !connection) {
    console.error('[DFY] Failed to create connection:', insertErr);
    return { success: false, error: 'Failed to create connection.' };
  }

  funnelLog('dfyRespond', connection.id, verificationLevel >= 4 ? 'DFY → ACCEPTED (10)' : 'DFY → ACCEPTED_PENDING (9)', {
    nannyId: nannyInfo.nannyId, parentId: position.parent_id,
    positionId: notification.position_id, source: 'dfy',
  });

  // Mark notification as interested (for DFY metrics)
  await adminClient
    .from('dfy_match_notifications')
    .update({
      status: 'interested',
      responded_at: now,
      updated_at: now,
    })
    .eq('id', notificationId)
    .in('status', ['notified', 'viewed']);

  // Move position to Connecting if still Open
  if (position.stage === POSITION_STAGE.OPEN) {
    await adminClient
      .from('nanny_positions')
      .update({ stage: POSITION_STAGE.CONNECTING, position_status: POSITION_STATUS.CONNECTING })
      .eq('id', position.id)
      .eq('stage', POSITION_STAGE.OPEN);
  }

  await logConnectionEvent({
    connectionRequestId: connection.id,
    parentId: position.parent_id,
    nannyId: nannyInfo.nannyId,
    eventType: 'dfy_interest_accepted',
    // written while the row is held (below level 4): the family's log read leaves it out
    eventData: { source: 'dfy', slotsCount: availableSlots.length, ...(dfyStage === CONNECTION_STAGE.ACCEPTED_PENDING ? { held: true } : {}) },
  });

  // Parent notifications — only at level 4+ (deferred for level 3)
  if (verificationLevel >= 4) {
    const nannyEmailInfo = await getUserEmailInfo(nannyInfo.userId);
    const nannyName = nannyEmailInfo ? nannyEmailInfo.firstName : 'A nanny';

    const { data: parentData } = await adminClient
      .from('parents')
      .select('user_id')
      .eq('id', position.parent_id)
      .single();

    if (parentData) {
      await createInboxMessage({
        userId: parentData.user_id,
        type: 'dfy_nanny_interested',
        title: `${nannyName} is interested and available for a meet and greet!`,
        body: `${nannyName} has shared their availability. Pick a time for a meet and greet.`,
        actionUrl: '/parent',
        referenceId: connection.id,
        referenceType: 'connection_request',
      });

      const parentEmailInfo = await getUserEmailInfo(parentData.user_id);
      if (parentEmailInfo) {
        sendEmail({
          to: parentEmailInfo.email,
          subject: `${nannyName} is interested and available for a meet and greet!`,
          html: `<div style="${BASE_STYLE}">
            ${emailHeader()}
            <p style="color: #374151; font-size: 16px; line-height: 1.6;">${nannyName} has expressed interest in your nanny position and shared their availability for a meet and greet.</p>
            <p style="color: #374151; font-size: 14px;">Pick a time that works for your meet and greet.</p>
            <p style="margin-top: 24px;"><a href="${APP_URL}/parent" style="${BTN_STYLE}">Pick a Time</a></p>
          </div>`,
          emailType: 'dfy_parent_applicant',
          recipientUserId: parentData.user_id,
        }).catch(err => console.error('[DFY] DFY-002 email error:', err));
      }
    }
  }

  revalidatePath('/nanny/positions');
  revalidatePath('/parent');
  return { success: true, error: null, connectionId: connection.id };
}

// ════════════════════════════════════════════════════════════════════════════
// 5. MARK DFY NOTIFICATION VIEWED (Nanny)
// ════════════════════════════════════════════════════════════════════════════

export async function markDfyNotificationViewed(
  notificationId: string
): Promise<{ success: boolean; error: string | null }> {
  const adminClient = createAdminClient();

  const nannyInfo = await getNannyId();
  if (!nannyInfo) {
    return { success: false, error: 'Not authenticated as nanny' };
  }

  const now = new Date().toISOString();

  await adminClient
    .from('dfy_match_notifications')
    .update({
      status: 'viewed',
      viewed_at: now,
      updated_at: now,
    })
    .eq('id', notificationId)
    .eq('nanny_id', nannyInfo.nannyId)
    .eq('status', 'notified');

  return { success: true, error: null };
}

// ════════════════════════════════════════════════════════════════════════════
// 6. GET DFY CONNECTIONS (Parent)
// ════════════════════════════════════════════════════════════════════════════

export async function getDfyConnections(
  positionId: string
): Promise<{ data: DfyConnection[] | null; error: string | null }> {
  const parentId = await getParentId();
  if (!parentId) {
    return { data: null, error: 'Not authenticated as parent' };
  }

  const adminClient = createAdminClient();

  // Verify parent owns this position
  const { data: position } = await adminClient
    .from('nanny_positions')
    .select('id')
    .eq('id', positionId)
    .eq('parent_id', parentId)
    .single();

  if (!position) {
    return { data: null, error: 'Position not found.' };
  }

  // Get DFY connections (source='dfy') for this position — exclude cancelled/declined
  const { data: connections, error } = await adminClient
    .from('connection_requests')
    .select('id, nanny_id, connection_stage, proposed_times, confirmed_time, position_id')
    .eq('position_id', positionId)
    .eq('source', 'dfy')
    .not('connection_stage', 'in', `(${[...HIDDEN_CONNECTION_STAGES, CONNECTION_STAGE.ACTIVE].join(',')})`)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('[DFY] Error fetching connections:', error);
    return { data: null, error: 'Failed to fetch connections.' };
  }

  // the rows the family doesn't see yet (a held DFY accept) stay out — the silent hold's own definition
  const shown = (connections ?? []).filter((c) => !isUnseenByParent({ connection_stage: c.connection_stage, source: 'dfy' }));
  if (shown.length === 0) {
    return { data: [], error: null };
  }

  // Get match data from dfy_match_notifications
  const nannyIds = shown.map(c => c.nanny_id);
  const { data: notifications } = await adminClient
    .from('dfy_match_notifications')
    .select('id, nanny_id, match_score, distance_km, metadata')
    .eq('position_id', positionId)
    .in('nanny_id', nannyIds);

  const notificationMap = new Map(
    (notifications ?? []).map(n => [n.nanny_id, n])
  );

  // Get nanny profiles
  const { data: nannies } = await adminClient
    .from('nannies')
    .select('id, user_id, hourly_rate_min, total_experience_years, ai_content, wwcc_verified')
    .in('id', nannyIds);

  const nannyMap = new Map((nannies ?? []).map(n => [n.id, n]));

  const nannyUserIds = (nannies ?? []).map(n => n.user_id);
  const { data: profiles } = await adminClient
    .from('user_profiles')
    .select('user_id, first_name, last_name, suburb, profile_picture_url, date_of_birth')
    .in('user_id', nannyUserIds);

  const profileMap = new Map((profiles ?? []).map(p => [p.user_id, p]));

  // Fetch availability schedules
  const { data: availabilityRows } = await adminClient
    .from('nanny_availability')
    .select('nanny_id, schedule')
    .in('nanny_id', nannyIds);

  const availabilityMap = new Map(
    (availabilityRows ?? []).map(a => [
      a.nanny_id,
      normalizeNannySchedule(a.schedule as Record<string, unknown>),
    ])
  );

  const result: DfyConnection[] = shown.map(c => {
    const notification = notificationMap.get(c.nanny_id);
    const nanny = nannyMap.get(c.nanny_id);
    const profile = nanny ? profileMap.get(nanny.user_id) : null;

    const meta = notification?.metadata as Record<string, unknown> | null;
    const bd = meta?.breakdown as { experience: number; schedule: number; location: number } | undefined;
    const bonuses = (meta?.overQualifiedBonuses as string[]) ?? [];
    const unmet = (meta?.unmetRequirements as string[]) ?? [];

    return {
      connectionId: c.id,
      notificationId: notification?.id ?? '',
      nannyId: c.nanny_id,
      connectionStage: c.connection_stage,
      proposedTimes: c.proposed_times,
      confirmedTime: c.confirmed_time,
      matchScore: notification?.match_score ?? 0,
      distanceKm: notification?.distance_km ?? null,
      breakdown: bd ?? null,
      overQualifiedBonuses: bonuses,
      unmetRequirements: unmet,
      nanny: {
        firstName: profile?.first_name ?? 'Nanny',
        lastName: profile?.last_name ?? '',
        suburb: profile?.suburb ?? null,
        profilePicUrl: profile?.profile_picture_url ?? null,
        hourlyRateMin: nanny?.hourly_rate_min ?? null,
        experienceYears: nanny?.total_experience_years ?? null,
        aiHeadline: nanny?.ai_content?.headline ?? null,
        age: profileAge(profile?.date_of_birth ?? null),
        wwccVerified: nanny?.wwcc_verified ?? false,
        schedule: availabilityMap.get(c.nanny_id) ?? null,
      },
    };
  });

  return { data: result, error: null };
}

// ════════════════════════════════════════════════════════════════════════════
// 8. DECLINE DFY CONNECTION (Parent)
// ════════════════════════════════════════════════════════════════════════════

export async function declineDfyConnection(
  connectionId: string
): Promise<{ success: boolean; error: string | null }> {
  const adminClient = createAdminClient();

  const parentId = await getParentId();
  if (!parentId) {
    return { success: false, error: 'Not authenticated as parent' };
  }

  // Find the DFY connection
  const { data: connection, error: fetchErr } = await adminClient
    .from('connection_requests')
    .select('id, parent_id, nanny_id, position_id, source, connection_stage')
    .eq('id', connectionId)
    .eq('parent_id', parentId)
    .eq('source', 'dfy')
    .single();

  if (fetchErr || !connection) {
    return { success: false, error: 'Connection not found.' };
  }
  // the DFY card offers Decline for an accepted answer, before a meet is booked (stage 10)
  if (connection.connection_stage !== CONNECTION_STAGE.ACCEPTED) {
    return { success: false, error: 'This match can no longer be declined.' };
  }

  // Cancel the connection
  const now = new Date().toISOString();
  const { data: declined, error: declineErr } = await adminClient
    .from('connection_requests')
    .update({
      status: 'declined',
      connection_stage: CONNECTION_STAGE.CANCELLED_BY_PARENT,
      updated_at: now,
    })
    .eq('id', connectionId)
    .eq('connection_stage', CONNECTION_STAGE.ACCEPTED)
    .select('id');
  if (declineErr) console.error('[DFY] decline error:', { code: declineErr.code ?? null });
  if (!declined || declined.length === 0) {
    return { success: false, error: 'This match can no longer be declined.' };
  }

  // Mark the related DFY notification as declined
  await adminClient
    .from('dfy_match_notifications')
    .update({ status: 'declined', updated_at: now })
    .eq('position_id', connection.position_id)
    .eq('nanny_id', connection.nanny_id)
    .eq('status', 'interested');

  await logConnectionEvent({
    connectionRequestId: connectionId,
    parentId,
    nannyId: connection.nanny_id,
    eventType: 'dfy_declined',
    eventData: { source: 'dfy' },
  });

  revalidatePath('/parent');
  return { success: true, error: null };
}

// ════════════════════════════════════════════════════════════════════════════
// 10. GET DFY STATUS FOR POSITION (Parent)
// ════════════════════════════════════════════════════════════════════════════

/** The nannies whose DFY answer on this position is still at stage 9 (not yet on the family's list). */
async function heldDfyNannyIds(adminClient: ReturnType<typeof createAdminClient>, positionId: string): Promise<Set<string>> {
  const { data } = await adminClient
    .from('connection_requests')
    .select('nanny_id')
    .eq('position_id', positionId)
    .eq('source', 'dfy')
    .eq('connection_stage', CONNECTION_STAGE.ACCEPTED_PENDING);
  return new Set((data ?? []).map((r) => r.nanny_id as string));
}

export async function getDfyStatus(): Promise<{
  activated: boolean;
  activatedAt: string | null;
  expiresAt: string | null;
  expired: boolean;
  notifiedCount: number;
  interestedCount: number;
  connectedCount: number;
  tier: 'standard' | 'priority' | null;
  maxRespondents: number;
  positionId: string | null;
}> {
  const defaultResult = {
    activated: false, activatedAt: null, expiresAt: null, expired: false,
    notifiedCount: 0, interestedCount: 0, connectedCount: 0,
    tier: null as 'standard' | 'priority' | null, maxRespondents: DFY_TIERS.standard.maxRespondents,
    positionId: null as string | null,
  };

  const parentId = await getParentId();
  if (!parentId) return defaultResult;

  const adminClient = createAdminClient();

  const { data: position } = await adminClient
    .from('nanny_positions')
    .select('id, dfy_activated_at, dfy_expires_at, dfy_wave_sent, dfy_tier')
    .eq('parent_id', parentId)
    .in('status', ['active', 'filled'])
    .maybeSingle();

  if (!position) return defaultResult;

  if (!position.dfy_activated_at) return { ...defaultResult, positionId: position.id };

  const activatedTier = (position.dfy_tier as DfyTier) || 'standard';
  const tierConfig = DFY_TIERS[activatedTier];

  // Check if expired and trigger lazy cleanup
  const isExpired = position.dfy_expires_at
    ? new Date(position.dfy_expires_at) <= new Date()
    : false;

  if (isExpired) {
    await expireDfyNotifications(position.id, parentId);
  }

  // Lazy wave trigger — fire pending waves on parent page visit
  if (!isExpired) {
    await processDfyWaves();
  }

  // Get counts by status (re-fetch after potential wave processing)
  const { data: notifications } = await adminClient
    .from('dfy_match_notifications')
    .select('nanny_id, status')
    .eq('position_id', position.id);

  // an answer counts once the family's DFY list shows it (stage 10 on), as getDfyConnections lists them
  const held = await heldDfyNannyIds(adminClient, position.id);
  const interestedCount = (notifications ?? []).filter((n) => n.status === 'interested' && !held.has(n.nanny_id)).length;

  // Count DFY connections
  const { count: connectedCount } = await adminClient
    .from('connection_requests')
    .select('id', { count: 'exact', head: true })
    .eq('position_id', position.id)
    .eq('source', 'dfy')
    .not('connection_stage', 'in', `(${[...HIDDEN_CONNECTION_STAGES, CONNECTION_STAGE.ACTIVE].join(',')})`)
    .neq('connection_stage', CONNECTION_STAGE.ACCEPTED_PENDING);

  return {
    activated: true,
    activatedAt: position.dfy_activated_at,
    expiresAt: position.dfy_expires_at,
    expired: isExpired,
    notifiedCount: (notifications ?? []).length,
    interestedCount,
    connectedCount: connectedCount ?? 0,
    tier: activatedTier,
    maxRespondents: tierConfig.maxRespondents,
    positionId: position.id,
  };
}

// ════════════════════════════════════════════════════════════════════════════
// 11b. CONFIRM MATCHMAKING (activate DFY without share proof)
// ════════════════════════════════════════════════════════════════════════════

export async function confirmMatchmaking(): Promise<{ success: boolean; error?: string }> {
  const parentId = await getParentId();
  if (!parentId) {
    return { success: false, error: 'Not authenticated as parent' };
  }

  const { data: position, error: positionError } = await getPosition();
  if (positionError || !position) {
    return { success: false, error: positionError || 'No active position found' };
  }

  const adminClient = createAdminClient();
  const { data: pos } = await adminClient
    .from('nanny_positions')
    .select('id, dfy_activated_at')
    .eq('id', position.id)
    .single();

  if (!pos) {
    return { success: false, error: 'Position not found.' };
  }

  if (pos.dfy_activated_at) {
    return { success: false, error: 'Matchmaking is already active.' };
  }

  // Activate DFY directly — standard tier
  await activateDfyPosition(pos.id, 'standard');

  revalidatePath('/parent/matches');
  return { success: true };
}

// ════════════════════════════════════════════════════════════════════════════
// 13. GET PUBLIC POSITION PROFILE (for OG image + public page)
// ════════════════════════════════════════════════════════════════════════════

export interface PublicPositionProfile {
  id: string;
  suburb: string | null;
  hourlyRate: number | null;
  hoursPerWeek: number | null;
  daysRequired: string[] | null;
  scheduleType: string | null;
  children: Array<{ ageMonths: number; gender: string | null }>;
  parentFirstName: string;
  parentLastName: string | null;
  weeklyRoster: string[];
  rosterByDay: Record<string, string[]>;
  description: string | null;
  levelOfSupport: string[] | null;
  reasonForNanny: string[] | null;
  driversLicenseRequired: boolean | null;
  carRequired: boolean | null;
  nonSmokerRequired: boolean | null;
  vaccinationRequired: boolean | null;
  comfortableWithPetsRequired: boolean | null;
  urgency: string | null;
  startDate: string | null;
  placementLength: string | null;
  languagePreference: string | null;
  languagePreferenceDetails: string | null;
  yearsOfExperience: number | null;
  minimumAgeRequirement: number | null;
  focusType: string | null;
  supportType: string | null;
  childNeeds: boolean;
  childNeedsDetails: string | null;
  createdAt: string;
  source: string | null;
  expiresAt: string | null;
}

export async function getPublicPositionProfile(positionId: string): Promise<{
  data: PublicPositionProfile | null;
  error: string | null;
}> {
  const admin = createAdminClient();

  const { data: position, error: posErr } = await admin
    .from('nanny_positions')
    .select('id, parent_id, suburb, hourly_rate, hours_per_week, days_required, schedule_type, details, description, level_of_support, reason_for_nanny, drivers_license_required, car_required, non_smoker_required, vaccination_required, comfortable_with_pets_required, urgency, start_date, placement_length, language_preference, language_preference_details, years_of_experience, minimum_age_requirement, created_at, family_display_name, source, expires_at')
    .eq('id', positionId)
    .maybeSingle();

  if (posErr || !position) return { data: null, error: 'Position not found' };

  // Check expiry for admin/AI positions
  if (position.expires_at && new Date(position.expires_at) < new Date()) {
    return { data: null, error: 'Position expired' };
  }

  // Get children
  const { data: children } = await admin
    .from('position_children')
    .select('age_months, gender')
    .eq('position_id', positionId)
    .order('display_order', { ascending: true });

  // Get parent's name + profile pic
  let parentFirstName = 'A family';
  let parentLastName: string | null = null;

  if (position.family_display_name) {
    // Admin/AI position — use display name directly
    parentFirstName = position.family_display_name;
    parentLastName = null;
  } else {
    // Regular parent position — look up from parents → user_profiles
    const { data: parent } = await admin
      .from('parents')
      .select('user_id')
      .eq('id', position.parent_id)
      .single();

    if (parent) {
      const { data: profile } = await admin
        .from('user_profiles')
        .select('first_name, last_name, profile_picture_url')
        .eq('user_id', parent.user_id)
        .maybeSingle();

      if (profile) {
        parentFirstName = profile.first_name ?? 'A family';
        parentLastName = profile.last_name ?? null;
      }
    }
  }

  // Extract roster from details.form_data or position_schedule
  const details = position.details as Record<string, unknown> | null;
  const formData = (details?.form_data ?? {}) as Record<string, unknown>;
  let weeklyRoster: string[] = (formData.weekly_roster as string[]) ?? position.days_required ?? [];
  const DAY_ROSTER_FIELD: Record<string, string> = {
    Monday: 'monday_roster', Tuesday: 'tuesday_roster', Wednesday: 'wednesday_roster',
    Thursday: 'thursday_roster', Friday: 'friday_roster', Saturday: 'saturday_roster', Sunday: 'sunday_roster',
  };
  const rosterByDay: Record<string, string[]> = {};

  if (position.source && position.source !== 'parent') {
    // Admin/AI position — use position_schedule table
    const { data: scheduleRow } = await admin
      .from('position_schedule')
      .select('schedule')
      .eq('position_id', positionId)
      .maybeSingle();

    if (scheduleRow?.schedule) {
      const schedule = scheduleRow.schedule as Record<string, string[]>;
      // Convert lowercase day keys to title case for weeklyRoster
      weeklyRoster = Object.keys(schedule).map(d => d.charAt(0).toUpperCase() + d.slice(1));
      // Build rosterByDay with title-case keys
      for (const [day, brackets] of Object.entries(schedule)) {
        const titleDay = day.charAt(0).toUpperCase() + day.slice(1);
        rosterByDay[titleDay] = brackets;
      }
    }
  } else {
    // Regular parent position — use form_data roster fields
    for (const day of weeklyRoster) {
      const field = DAY_ROSTER_FIELD[day];
      if (field && formData[field]) {
        rosterByDay[day] = formData[field] as string[];
      }
    }
  }

  return {
    data: {
      id: position.id,
      suburb: position.suburb,
      hourlyRate: position.hourly_rate ? Number(position.hourly_rate) : null,
      hoursPerWeek: position.hours_per_week ? Number(position.hours_per_week) : null,
      daysRequired: position.days_required,
      scheduleType: position.schedule_type,
      children: (children ?? []).map(c => ({ ageMonths: c.age_months, gender: c.gender })),
      parentFirstName,
      parentLastName,
      weeklyRoster,
      rosterByDay,
      description: position.description ?? null,
      levelOfSupport: position.level_of_support ?? null,
      reasonForNanny: position.reason_for_nanny ?? null,
      driversLicenseRequired: position.drivers_license_required ?? null,
      carRequired: position.car_required ?? null,
      nonSmokerRequired: position.non_smoker_required ?? null,
      vaccinationRequired: position.vaccination_required ?? null,
      comfortableWithPetsRequired: position.comfortable_with_pets_required ?? null,
      urgency: position.urgency ?? null,
      startDate: position.start_date ?? null,
      placementLength: position.placement_length ?? null,
      languagePreference: position.language_preference ?? null,
      languagePreferenceDetails: position.language_preference_details ?? null,
      yearsOfExperience: position.years_of_experience ? Number(position.years_of_experience) : null,
      minimumAgeRequirement: position.minimum_age_requirement ? Number(position.minimum_age_requirement) : null,
      focusType: (details?.focus_type as string) ?? null,
      supportType: (details?.support_type as string) ?? null,
      childNeeds: !!(details?.child_needs),
      childNeedsDetails: (details?.child_needs_details as string) ?? null,
      createdAt: position.created_at,
      source: position.source ?? null,
      expiresAt: position.expires_at ?? null,
    },
    error: null,
  };
}
