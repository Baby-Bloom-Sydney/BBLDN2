/**
 * DFY dispatch — activating matchmaking for a position (wave 1 + pre-created waves 2/3), processing due waves, expiring
 * notifications, and the nanny emails / inbox messages they send. Moved unchanged from `lib/actions/matching.ts`; a
 * server-only module, not a server action: its callers (the parent actions, lead conversion, the waves cron) run their
 * own checks first.
 *
 * BB-wave1-041126, 2026-11-09.
 */
import { createAdminClient } from '@/lib/supabase/admin';
import { runMatchmaking, runBasicMatchmaking } from '@/lib/matching/engine';
import { DFY_TIERS, type DfyTier } from '@/lib/matching/constants';
import { createInboxMessage } from '@/lib/actions/connection-helpers';
import { sendEmail, sendBatchEmails } from '@/lib/email/resend';
import { getUserEmailInfo } from '@/lib/email/helpers';
import type { MatchResult } from '@/lib/matching/types';
import { emailHeader } from '@/lib/email/brand';
import { SITE_URL } from '@/lib/constants';

// ── Email styles (shared) ──

export const APP_URL = SITE_URL;
export const BASE_STYLE = `font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px;`;
export const BTN_STYLE = `background: #8B5CF6; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 600;`;

// ── Helper: build DFY email items for a batch of matches ──

interface DfyEmailPosition {
  id: string;
  children: Array<{ age_months: number }>;
  days_required?: string[] | null;
  hours_per_week?: number | null;
  hourly_rate?: number | null;
  schedule_type?: string | null;
  qualification_requirement?: string | null;
  certificate_requirements?: string[] | null;
  drivers_license_required?: boolean | null;
  car_required?: boolean | null;
  vaccination_required?: boolean | null;
  non_smoker_required?: boolean | null;
  comfortable_with_pets_required?: boolean | null;
  language_preference?: string | null;
  urgency?: string | null;
  start_date?: string | null;
  placement_length?: string | null;
  level_of_support?: string[] | null;
  description?: string | null;
}

export interface DfyEmailContext {
  parentName: string;
  parentSuburb: string;
  position: DfyEmailPosition | null;
}

async function buildDfyEmailItems(
  matches: MatchResult[],
  context: DfyEmailContext,
): Promise<Array<{
  to: string;
  subject: string;
  html: string;
  emailType: string;
  recipientUserId: string;
}>> {
  const adminClient = createAdminClient();
  const { parentName, parentSuburb, position } = context;

  if (!position) return [];

  // Build children display
  const childrenDisplay = position.children
    .map((c: { age_months: number }) => {
      if (c.age_months < 12) return `${c.age_months}mo`;
      const years = Math.floor(c.age_months / 12);
      return `${years}yr`;
    })
    .join(', ');

  // Build comprehensive position details for email
  const daysDisplay = position.days_required?.join(', ') || '';
  const hoursDisplay = position.hours_per_week ? `${position.hours_per_week}h/week` : '';
  const rateDisplay = position.hourly_rate ? `£${position.hourly_rate}/hr` : 'Rate negotiable';
  const scheduleDisplay = position.schedule_type || 'Flexible';

  // Get nanny email info for batch emails
  const nannyUserIds = matches.map(m => m.nanny.user_id);
  const { data: nannyProfiles } = await adminClient
    .from('user_profiles')
    .select('user_id, email, first_name')
    .in('user_id', nannyUserIds);

  const profileMap = new Map(
    (nannyProfiles ?? []).map(p => [p.user_id, p])
  );

  return matches
    .map(m => {
      const profile = profileMap.get(m.nanny.user_id);
      if (!profile) return null;
      return {
        to: profile.email,
        subject: `A family in ${parentSuburb} matched with you!`,
        html: `<div style="${BASE_STYLE}">
          ${emailHeader()}
          <p style="color: #374151; font-size: 16px; line-height: 1.6;">Hi ${profile.first_name},</p>
          <p style="color: #374151; font-size: 16px; line-height: 1.6;">${parentName} from ${parentSuburb} is looking for a nanny and you're one of their top matches!</p>
          <div style="background: #F5F3FF; border: 1px solid #C4B5FD; border-radius: 8px; padding: 16px; margin: 16px 0;">
            <p style="margin: 0 0 12px; font-weight: 600; color: #5B21B6;">Position Details</p>
            <table style="width: 100%; font-size: 14px; color: #374151; border-collapse: collapse;">
              <tr><td style="padding: 4px 8px 4px 0; color: #6B7280;">Children</td><td style="padding: 4px 0;">${position.children.length} ${position.children.length === 1 ? 'child' : 'children'} (${childrenDisplay})</td></tr>
              <tr><td style="padding: 4px 8px 4px 0; color: #6B7280;">Schedule</td><td style="padding: 4px 0;">${scheduleDisplay}</td></tr>
              <tr><td style="padding: 4px 8px 4px 0; color: #6B7280;">Rate</td><td style="padding: 4px 0;">${rateDisplay}</td></tr>
              ${hoursDisplay ? `<tr><td style="padding: 4px 8px 4px 0; color: #6B7280;">Hours</td><td style="padding: 4px 0;">${hoursDisplay}</td></tr>` : ''}
              ${daysDisplay ? `<tr><td style="padding: 4px 8px 4px 0; color: #6B7280;">Days</td><td style="padding: 4px 0;">${daysDisplay}</td></tr>` : ''}
              ${parentSuburb ? `<tr><td style="padding: 4px 8px 4px 0; color: #6B7280;">Location</td><td style="padding: 4px 0;">${parentSuburb}</td></tr>` : ''}
              ${position.urgency ? `<tr><td style="padding: 4px 8px 4px 0; color: #6B7280;">Start</td><td style="padding: 4px 0;">${position.urgency}${position.start_date ? ` — ${position.start_date}` : ''}</td></tr>` : ''}
              ${position.placement_length ? `<tr><td style="padding: 4px 8px 4px 0; color: #6B7280;">Duration</td><td style="padding: 4px 0;">${position.placement_length}</td></tr>` : ''}
              ${position.level_of_support?.length ? `<tr><td style="padding: 4px 8px 4px 0; color: #6B7280;">Support</td><td style="padding: 4px 0;">${position.level_of_support.join(', ')}</td></tr>` : ''}
            </table>
            ${position.description ? `<p style="margin: 8px 0 0; font-size: 13px; color: #374151;">${position.description}</p>` : ''}
          </div>
          <p style="color: #374151; font-size: 14px;">View the full position details and let the family know you're interested.</p>
          <p style="margin-top: 24px;"><a href="${APP_URL}/nanny/positions" style="${BTN_STYLE}">View Position & Respond</a></p>
        </div>`,
        emailType: 'dfy_nanny_notification',
        recipientUserId: m.nanny.user_id,
      };
    })
    .filter((e): e is NonNullable<typeof e> => e !== null);
}

// ── Helper: send DFY notifications (emails + inbox messages) for a batch of matches ──

export async function sendDfyNotifications(
  matches: MatchResult[],
  context: DfyEmailContext,
): Promise<{ sent: number; failed: number }> {
  const { parentName, parentSuburb, position } = context;
  if (!position) return { sent: 0, failed: 0 };

  // Build and send emails
  const emailItems = await buildDfyEmailItems(matches, context);
  const result = await sendBatchEmails(emailItems);

  if (result.failed > 0) {
    console.error(`[DFY] Email: ${result.sent} sent, ${result.failed} failed out of ${emailItems.length}`,
      { nannyIds: matches.map(m => m.nannyId) });
  }

  // Create inbox messages
  const inboxResults = await Promise.allSettled(
    matches.map(m =>
      createInboxMessage({
        userId: m.nanny.user_id,
        type: 'dfy_match',
        title: `A family in ${parentSuburb} matched with you!`,
        body: `${parentName} is looking for a nanny and you're one of their top matches. View the position and respond.`,
        actionUrl: '/nanny/positions',
        referenceId: position.id,
        referenceType: 'dfy_match_notification',
      })
    )
  );

  const inboxFailed = inboxResults.filter(r => r.status === 'rejected');
  if (inboxFailed.length > 0) {
    console.error(`[DFY] Inbox messages: ${inboxFailed.length}/${matches.length} failed`,
      inboxFailed.map(r => (r as PromiseRejectedResult).reason?.message ?? 'unknown'));
  }

  return result;
}

// ════════════════════════════════════════════════════════════════════════════
// 9. PROCESS DFY WAVES (Cron + lazy trigger)
// ════════════════════════════════════════════════════════════════════════════

export async function processDfyWaves(): Promise<{ processed: number }> {
  const adminClient = createAdminClient();
  const now = new Date();
  const nowIso = now.toISOString();
  let processed = 0;

  // Find all active DFY positions
  const { data: positions } = await adminClient
    .from('nanny_positions')
    .select('id, parent_id, dfy_activated_at, dfy_expires_at, dfy_wave_sent, dfy_tier, suburb, schedule_type, hourly_rate, hours_per_week, days_required, level_of_support, urgency, start_date, placement_length, qualification_requirement, certificate_requirements, drivers_license_required, car_required, vaccination_required, non_smoker_required, comfortable_with_pets_required, language_preference, description')
    .not('dfy_activated_at', 'is', null)
    .gt('dfy_expires_at', nowIso);

  if (!positions || positions.length === 0) return { processed: 0 };

  for (const pos of positions) {
    const tier = (pos.dfy_tier as DfyTier) || 'standard';
    const config = DFY_TIERS[tier];
    const activatedAt = new Date(pos.dfy_activated_at);
    const wavesSent: number[] = (pos.dfy_wave_sent as number[]) ?? [];
    const daysSinceActivation = (now.getTime() - activatedAt.getTime()) / (1000 * 60 * 60 * 24);

    // Determine which waves are due (standard has only wave 1, already sent)
    const pendingWaves: number[] = [];
    if (daysSinceActivation >= 2 && !wavesSent.includes(2)) pendingWaves.push(2);
    if (daysSinceActivation >= 5 && !wavesSent.includes(3)) pendingWaves.push(3);

    if (pendingWaves.length === 0) continue;

    // Check interested count — skip remaining waves if threshold met
    const { count: interestedCount } = await adminClient
      .from('dfy_match_notifications')
      .select('id', { count: 'exact', head: true })
      .eq('position_id', pos.id)
      .eq('status', 'interested');

    if ((interestedCount ?? 0) >= config.maxRespondents) {
      // Expire all remaining pending_wave rows
      await adminClient
        .from('dfy_match_notifications')
        .update({ status: 'expired', updated_at: nowIso })
        .eq('position_id', pos.id)
        .eq('status', 'pending_wave');

      // Mark all waves as "sent" to prevent re-checking
      await adminClient
        .from('nanny_positions')
        .update({ dfy_wave_sent: [1, 2, 3], updated_at: nowIso })
        .eq('id', pos.id);

      continue;
    }

    // Get parent info for emails
    const { data: parentRecord } = await adminClient
      .from('parents')
      .select('user_id')
      .eq('id', pos.parent_id)
      .single();

    const parentProfile = parentRecord
      ? await getUserEmailInfo(parentRecord.user_id)
      : null;
    const parentName = parentProfile ? `${parentProfile.firstName}` : 'A family';
    const parentSuburb = pos.suburb || '';

    // Get children for position
    const { data: children } = await adminClient
      .from('position_children')
      .select('age_months, gender')
      .eq('position_id', pos.id)
      .order('display_order', { ascending: true });

    for (const waveNum of pendingWaves) {
      // Fetch pending_wave rows for this wave
      const { data: waveRows } = await adminClient
        .from('dfy_match_notifications')
        .select('id, nanny_id, match_score')
        .eq('position_id', pos.id)
        .eq('wave', waveNum)
        .eq('status', 'pending_wave');

      if (!waveRows || waveRows.length === 0) {
        // No rows for this wave — just mark as sent
        const updatedWaves = [...wavesSent, waveNum];
        const { error: waveErr } = await adminClient
          .from('nanny_positions')
          .update({ dfy_wave_sent: updatedWaves, updated_at: nowIso })
          .eq('id', pos.id);
        if (waveErr) console.error(`[DFY-Wave] Failed to update wave_sent for ${pos.id}:`, waveErr);
        wavesSent.push(waveNum);
        continue;
      }

      // Update status to 'notified' — optimistic lock on 'pending_wave' prevents duplicate sends
      const waveRowIds = waveRows.map(r => r.id);
      const { data: updatedRows } = await adminClient
        .from('dfy_match_notifications')
        .update({ status: 'notified', notified_at: nowIso, updated_at: nowIso })
        .in('id', waveRowIds)
        .eq('status', 'pending_wave')
        .select('id, nanny_id');

      // If 0 rows updated, another process already handled this wave
      if (!updatedRows || updatedRows.length === 0) {
        const updatedWaves = [...wavesSent, waveNum];
        const { error: waveErr } = await adminClient
          .from('nanny_positions')
          .update({ dfy_wave_sent: updatedWaves, updated_at: nowIso })
          .eq('id', pos.id);
        if (waveErr) console.error(`[DFY-Wave] Failed to update wave_sent for ${pos.id}:`, waveErr);
        wavesSent.push(waveNum);
        continue;
      }

      // Get nanny user_ids for this wave (only for rows we actually updated)
      const nannyIds = updatedRows.map(r => r.nanny_id);
      const { data: nannies } = await adminClient
        .from('nannies')
        .select('id, user_id')
        .in('id', nannyIds);

      if (nannies && nannies.length > 0) {
        // Build MatchResult-like objects for the email helper
        const nannyUserIds = nannies.map(n => n.user_id);
        const { data: profiles } = await adminClient
          .from('user_profiles')
          .select('user_id, email, first_name')
          .in('user_id', nannyUserIds);

        const profileMap = new Map((profiles ?? []).map(p => [p.user_id, p]));
        const nannyMap = new Map(nannies.map(n => [n.id, n]));

        // Build email items directly (use updatedRows — only nannies we claimed)
        const emailItems = updatedRows
          .map(row => {
            const nanny = nannyMap.get(row.nanny_id);
            if (!nanny) return null;
            const profile = profileMap.get(nanny.user_id);
            if (!profile) return null;

            // Build position details for email (reuse same template)
            const childrenDisplay = (children ?? [])
              .map((c: { age_months: number }) => {
                if (c.age_months < 12) return `${c.age_months}mo`;
                return `${Math.floor(c.age_months / 12)}yr`;
              })
              .join(', ');

            const daysDisplay = pos.days_required?.join(', ') || '';
            const hoursDisplay = pos.hours_per_week ? `${pos.hours_per_week}h/week` : '';
            const rateDisplay = pos.hourly_rate ? `£${pos.hourly_rate}/hr` : 'Rate negotiable';
            const scheduleDisplay = pos.schedule_type || 'Flexible';
            const childCount = (children ?? []).length;

            return {
              to: profile.email,
              subject: `A family in ${parentSuburb} matched with you!`,
              html: `<div style="${BASE_STYLE}">
                ${emailHeader()}
                <p style="color: #374151; font-size: 16px; line-height: 1.6;">Hi ${profile.first_name},</p>
                <p style="color: #374151; font-size: 16px; line-height: 1.6;">${parentName} from ${parentSuburb} is looking for a nanny and you're one of their top matches!</p>
                <div style="background: #F5F3FF; border: 1px solid #C4B5FD; border-radius: 8px; padding: 16px; margin: 16px 0;">
                  <p style="margin: 0 0 12px; font-weight: 600; color: #5B21B6;">Position Details</p>
                  <table style="width: 100%; font-size: 14px; color: #374151; border-collapse: collapse;">
                    <tr><td style="padding: 4px 8px 4px 0; color: #6B7280;">Children</td><td style="padding: 4px 0;">${childCount} ${childCount === 1 ? 'child' : 'children'} (${childrenDisplay})</td></tr>
                    <tr><td style="padding: 4px 8px 4px 0; color: #6B7280;">Schedule</td><td style="padding: 4px 0;">${scheduleDisplay}</td></tr>
                    <tr><td style="padding: 4px 8px 4px 0; color: #6B7280;">Rate</td><td style="padding: 4px 0;">${rateDisplay}</td></tr>
                    ${hoursDisplay ? `<tr><td style="padding: 4px 8px 4px 0; color: #6B7280;">Hours</td><td style="padding: 4px 0;">${hoursDisplay}</td></tr>` : ''}
                    ${daysDisplay ? `<tr><td style="padding: 4px 8px 4px 0; color: #6B7280;">Days</td><td style="padding: 4px 0;">${daysDisplay}</td></tr>` : ''}
                    ${parentSuburb ? `<tr><td style="padding: 4px 8px 4px 0; color: #6B7280;">Location</td><td style="padding: 4px 0;">${parentSuburb}</td></tr>` : ''}
                    ${pos.urgency ? `<tr><td style="padding: 4px 8px 4px 0; color: #6B7280;">Start</td><td style="padding: 4px 0;">${pos.urgency}${pos.start_date ? ` — ${pos.start_date}` : ''}</td></tr>` : ''}
                    ${pos.placement_length ? `<tr><td style="padding: 4px 8px 4px 0; color: #6B7280;">Duration</td><td style="padding: 4px 0;">${pos.placement_length}</td></tr>` : ''}
                    ${pos.level_of_support?.length ? `<tr><td style="padding: 4px 8px 4px 0; color: #6B7280;">Support</td><td style="padding: 4px 0;">${pos.level_of_support.join(', ')}</td></tr>` : ''}
                  </table>
                  ${pos.description ? `<p style="margin: 8px 0 0; font-size: 13px; color: #374151;">${pos.description}</p>` : ''}
                </div>
                <p style="color: #374151; font-size: 14px;">View the full position details and let the family know you're interested.</p>
                <p style="margin-top: 24px;"><a href="${APP_URL}/nanny/positions" style="${BTN_STYLE}">View Position & Respond</a></p>
              </div>`,
              emailType: 'dfy_nanny_notification',
              recipientUserId: nanny.user_id,
            };
          })
          .filter((e): e is NonNullable<typeof e> => e !== null);

        // Send batch emails
        const { sent, failed } = await sendBatchEmails(emailItems);
        if (failed > 0) {
          console.error(`[DFY-Wave] Wave ${waveNum}: ${sent} sent, ${failed} failed`);
        }

        // Create inbox messages
        await Promise.allSettled(
          nannies.map(n =>
            createInboxMessage({
              userId: n.user_id,
              type: 'dfy_match',
              title: `A family in ${parentSuburb} matched with you!`,
              body: `${parentName} is looking for a nanny and you're one of their top matches. View the position and respond.`,
              actionUrl: '/nanny/positions',
              referenceId: pos.id,
              referenceType: 'dfy_match_notification',
            })
          )
        );

        console.log(`[DFY-Wave] Position ${pos.id}: wave ${waveNum} sent to ${sent} nannies`);
      }

      // Follow-up reminders for priority tier — re-send email to earlier wave nannies who haven't responded
      if (config.followUpReminders && waveNum >= 2) {
        const { data: unresponsiveRows } = await adminClient
          .from('dfy_match_notifications')
          .select('id, nanny_id')
          .eq('position_id', pos.id)
          .lt('wave', waveNum)
          .in('status', ['notified', 'viewed']);

        if (unresponsiveRows && unresponsiveRows.length > 0) {
          const reminderNannyIds = unresponsiveRows.map(r => r.nanny_id);
          const { data: reminderNannies } = await adminClient
            .from('nannies')
            .select('id, user_id')
            .in('id', reminderNannyIds);

          if (reminderNannies && reminderNannies.length > 0) {
            const reminderUserIds = reminderNannies.map(n => n.user_id);
            const { data: reminderProfiles } = await adminClient
              .from('user_profiles')
              .select('user_id, email, first_name')
              .in('user_id', reminderUserIds);

            const reminderProfileMap = new Map((reminderProfiles ?? []).map(p => [p.user_id, p]));
            const reminderNannyMap = new Map(reminderNannies.map(n => [n.id, n]));

            const reminderEmails = unresponsiveRows
              .map(row => {
                const nanny = reminderNannyMap.get(row.nanny_id);
                if (!nanny) return null;
                const profile = reminderProfileMap.get(nanny.user_id);
                if (!profile) return null;

                return {
                  to: profile.email,
                  subject: `Reminder: A family in ${parentSuburb} is still looking for a nanny`,
                  html: `<div style="${BASE_STYLE}">
                    ${emailHeader()}
                    <p style="color: #374151; font-size: 16px; line-height: 1.6;">Hi ${profile.first_name},</p>
                    <p style="color: #374151; font-size: 16px; line-height: 1.6;">${parentName} from ${parentSuburb} is still looking for a nanny. You were matched as one of their top candidates — let them know if you're interested!</p>
                    <p style="margin-top: 24px;"><a href="${APP_URL}/nanny/positions" style="${BTN_STYLE}">View Position & Respond</a></p>
                  </div>`,
                  emailType: 'dfy_nanny_reminder' as const,
                  recipientUserId: nanny.user_id,
                };
              })
              .filter((e): e is NonNullable<typeof e> => e !== null);

            if (reminderEmails.length > 0) {
              const { sent: reminderSent } = await sendBatchEmails(reminderEmails);
              console.log(`[DFY-Wave] Position ${pos.id}: wave ${waveNum} reminder sent to ${reminderSent} unresponsive nannies`);
            }
          }
        }
      }

      // Update dfy_wave_sent
      const updatedWaves = [...wavesSent, waveNum];
      const { error: waveErr } = await adminClient
        .from('nanny_positions')
        .update({ dfy_wave_sent: updatedWaves, updated_at: nowIso })
        .eq('id', pos.id);
      if (waveErr) console.error(`[DFY-Wave] Failed to update wave_sent for ${pos.id}:`, waveErr);
      wavesSent.push(waveNum);

      processed++;
    }
  }

  return { processed };
}

// ════════════════════════════════════════════════════════════════════════════
// 10. EXPIRE DFY NOTIFICATIONS (Internal lazy trigger)
// ════════════════════════════════════════════════════════════════════════════

export async function expireDfyNotifications(
  positionId: string,
  parentId?: string
): Promise<{ expired: boolean }> {
  const adminClient = createAdminClient();
  const now = new Date().toISOString();

  // Check if DFY has expired
  const { data: position } = await adminClient
    .from('nanny_positions')
    .select('id, dfy_activated_at, dfy_expires_at, parent_id')
    .eq('id', positionId)
    .single();

  if (!position || !position.dfy_expires_at) return { expired: false };
  if (new Date(position.dfy_expires_at) > new Date()) return { expired: false };

  // Bulk update: 'notified'/'viewed'/'pending_wave' → 'expired'
  // Leave 'interested' untouched — parent can still approve/decline
  const { data: expiredNotifs } = await adminClient
    .from('dfy_match_notifications')
    .update({ status: 'expired', updated_at: now })
    .eq('position_id', positionId)
    .in('status', ['notified', 'viewed', 'pending_wave'])
    .select('id');

  // Send parent notification only when we actually expired rows (avoids duplicate sends)
  if (expiredNotifs && expiredNotifs.length > 0) {
    const resolvedParentId = parentId || position.parent_id;
    const { data: parentRecord } = await adminClient
      .from('parents')
      .select('user_id')
      .eq('id', resolvedParentId)
      .single();

    if (parentRecord) {
      await createInboxMessage({
        userId: parentRecord.user_id,
        type: 'dfy_expired',
        title: 'Your Done For You search has completed',
        body: 'All matched nannies have been notified about your position. You can boost your position again or browse and connect with nannies from your matches.',
        actionUrl: '/parent/matches',
        referenceId: positionId,
        referenceType: 'nanny_position',
      });

      const parentEmailInfo = await getUserEmailInfo(parentRecord.user_id);
      if (parentEmailInfo) {
        sendEmail({
          to: parentEmailInfo.email,
          subject: 'Your Done For You search has completed',
          html: `<div style="${BASE_STYLE}">
            ${emailHeader()}
            <p style="color: #374151; font-size: 16px; line-height: 1.6;">Hi ${parentEmailInfo.firstName},</p>
            <p style="color: #374151; font-size: 16px; line-height: 1.6;">Your Done For You search has completed &mdash; all matched nannies have been notified about your position.</p>
            <div style="background: #F5F3FF; border: 1px solid #C4B5FD; border-radius: 8px; padding: 16px; margin: 16px 0;">
              <p style="margin: 0; font-size: 14px; color: #5B21B6; font-weight: 600;">What&rsquo;s next?</p>
              <ul style="margin: 8px 0 0; padding-left: 20px; font-size: 14px; color: #374151;">
                <li>Boost your position again to reach more nannies</li>
                <li>Browse and connect with nannies from your matches</li>
              </ul>
            </div>
            <p style="margin-top: 24px;"><a href="${APP_URL}/parent/matches" style="${BTN_STYLE}">View Matches</a></p>
          </div>`,
          emailType: 'dfy_expired',
          recipientUserId: parentRecord.user_id,
        }).catch(err => console.error('[DFY] Expiry email error:', err));
      }
    }
  }

  return { expired: true };
}

// ════════════════════════════════════════════════════════════════════════════
// 12. ACTIVATE DFY POSITION (called when share is approved)
// ════════════════════════════════════════════════════════════════════════════

export async function activateDfyPosition(positionId: string, tier: DfyTier = 'standard'): Promise<void> {
  const adminClient = createAdminClient();
  const config = DFY_TIERS[tier];

  // Get position
  const { data: position } = await adminClient
    .from('nanny_positions')
    .select('id, dfy_activated_at, parent_id')
    .eq('id', positionId)
    .single();

  if (!position) {
    console.error('[activateDfyPosition] Position not found:', positionId);
    return;
  }

  // Check DFY status — allow re-trigger after expiry OR when upgrading tier (standard → priority)
  let isUpgrade = false;
  if (position.dfy_activated_at) {
    const { data: posData } = await adminClient
      .from('nanny_positions')
      .select('dfy_expires_at, dfy_tier')
      .eq('id', positionId)
      .single();

    isUpgrade = posData?.dfy_tier === 'standard' && tier === 'priority';
    if (posData?.dfy_expires_at && new Date(posData.dfy_expires_at) > new Date() && !isUpgrade) {
      console.log('[activateDfyPosition] DFY still active, skipping:', positionId);
      return;
    }
  }

  // Run matching algorithm — standard uses basic (distance + schedule), priority uses full
  const { matches } = tier === 'priority'
    ? await runMatchmaking(positionId)
    : await runBasicMatchmaking(positionId);

  // Exclude nannies with existing active connections
  const { data: existingConnections } = await adminClient
    .from('connection_requests')
    .select('nanny_id')
    .eq('position_id', positionId)
    .in('status', ['pending', 'accepted', 'confirmed']);

  // Also exclude ALL previously notified nannies (any status) to avoid double-notifying
  const { data: previouslyNotified } = await adminClient
    .from('dfy_match_notifications')
    .select('nanny_id')
    .eq('position_id', positionId);

  const excludedNannyIds = new Set([
    ...(existingConnections ?? []).map(c => c.nanny_id),
    ...(previouslyNotified ?? []).map(n => n.nanny_id),
  ]);

  // Take top N matches based on tier
  const topMatches = matches
    .filter(m => !excludedNannyIds.has(m.nannyId))
    .slice(0, config.totalNannies);

  if (topMatches.length === 0) {
    console.log('[activateDfyPosition] No eligible nannies found for:', positionId);
    return;
  }

  const now = new Date().toISOString();

  // Build notification rows — standard: 1 wave (all notified), priority: 3 waves
  const buildMetadata = (m: typeof topMatches[number]) => ({
    breakdown: m.breakdown ?? null,
    headline: m.nanny.ai_content?.headline ?? null,
    overQualifiedBonuses: m.overQualifiedBonuses,
    unmetRequirements: m.unmetRequirements,
  });

  let allNotificationRows;
  if (tier === 'standard') {
    // Standard: single wave, all nannies notified immediately
    allNotificationRows = topMatches.map(m => ({
      position_id: positionId,
      nanny_id: m.nannyId,
      match_score: m.rawScore,
      distance_km: m.distanceKm,
      notification_method: 'email',
      notified_at: now,
      status: 'notified',
      wave: 1,
      metadata: buildMetadata(m),
    }));
  } else {
    // Priority: 3 waves — ~17 per wave
    const perWave = Math.ceil(config.totalNannies / config.waves);
    const wave1 = topMatches.slice(0, perWave);
    const wave2 = topMatches.slice(perWave, perWave * 2);
    const wave3 = topMatches.slice(perWave * 2);

    allNotificationRows = [
      ...wave1.map(m => ({
        position_id: positionId,
        nanny_id: m.nannyId,
        match_score: m.rawScore,
        distance_km: m.distanceKm,
        notification_method: 'email',
        notified_at: now,
        status: 'notified',
        wave: 1,
        metadata: buildMetadata(m),
      })),
      ...wave2.map(m => ({
        position_id: positionId,
        nanny_id: m.nannyId,
        match_score: m.rawScore,
        distance_km: m.distanceKm,
        notification_method: 'email',
        notified_at: null,
        status: 'pending_wave',
        wave: 2,
        metadata: buildMetadata(m),
      })),
      ...wave3.map(m => ({
        position_id: positionId,
        nanny_id: m.nannyId,
        match_score: m.rawScore,
        distance_km: m.distanceKm,
        notification_method: 'email',
        notified_at: null,
        status: 'pending_wave',
        wave: 3,
        metadata: buildMetadata(m),
      })),
    ];
  }

  // Race guard: verify no notifications were just created by a concurrent call
  if (!isUpgrade) {
    const { count } = await adminClient
      .from('dfy_match_notifications')
      .select('id', { count: 'exact', head: true })
      .eq('position_id', positionId)
      .neq('status', 'expired');
    if ((count ?? 0) > 0) {
      console.log('[activateDfyPosition] Notifications already exist, skipping duplicate insert');
      return;
    }
  }

  const { error: insertError } = await adminClient
    .from('dfy_match_notifications')
    .insert(allNotificationRows);

  if (insertError) {
    console.error('[activateDfyPosition] Failed to insert notifications:', insertError);
    return;
  }

  // Mark position as DFY-activated
  const expiresAt = new Date(Date.now() + config.expiryDays * 24 * 60 * 60 * 1000).toISOString();
  await adminClient
    .from('nanny_positions')
    .update({
      dfy_activated_at: now,
      dfy_expires_at: expiresAt,
      dfy_wave_sent: [1],
      dfy_tier: tier,
      updated_at: now,
    })
    .eq('id', positionId);

  // Get parent info for emails
  const { data: parentRecord } = await adminClient
    .from('parents')
    .select('user_id')
    .eq('id', position.parent_id)
    .single();

  const parentProfile = parentRecord
    ? await getUserEmailInfo(parentRecord.user_id)
    : null;
  const parentName = parentProfile ? `${parentProfile.firstName}` : 'A family';

  // Get position details for emails
  const { data: positionDetails } = await adminClient
    .from('nanny_positions')
    .select('id, suburb, schedule_type, hourly_rate, hours_per_week, days_required, level_of_support, urgency, start_date, placement_length, qualification_requirement, certificate_requirements, drivers_license_required, car_required, vaccination_required, non_smoker_required, comfortable_with_pets_required, language_preference, description')
    .eq('id', positionId)
    .single();

  const parentSuburb = positionDetails?.suburb || '';

  // Get children for email context
  const { data: children, error: childrenErr } = await adminClient
    .from('position_children')
    .select('age_months')
    .eq('position_id', positionId);

  if (childrenErr) {
    console.error('[activateDfyPosition] Failed to fetch children:', childrenErr);
  }

  const emailContext: DfyEmailContext = {
    parentName,
    parentSuburb,
    position: positionDetails ? { ...positionDetails, children: children ?? [] } : null,
  };

  // Send emails + inbox messages for wave 1 only
  const wave1Matches = tier === 'standard'
    ? topMatches
    : topMatches.slice(0, Math.ceil(config.totalNannies / config.waves));
  await sendDfyNotifications(wave1Matches, emailContext);

  console.log(`[activateDfyPosition] DFY activated (${tier}) for position ${positionId}: ${wave1Matches.length} nannies notified (wave 1)`);
}
