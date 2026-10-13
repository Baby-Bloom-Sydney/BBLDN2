/**
 * Silent hold — the connection side of `syncNannyVerificationState` (lib/actions/verification.ts), the only caller.
 * Plain server module (NOT 'use server': nothing here is callable from the browser).
 *
 * - `promotePendingConnections` — level < 4 → 4: held rows (stage 4 / 9) are released and parents told. Moved here
 *   verbatim from verification.ts by unit 3d (BB-LDN-3d-141026) to keep that file under 800 lines; no behaviour change.
 * - `onNannyBarred` / `dropBarredConnections` — README **P-14** (BAI 2026-10-14): a barred nanny loses EVERY live
 *   connection, at any stage (hired included) and from any old level, and the VER-011 admin alert lists each affected
 *   family (parent name, email, phone, position, stage) so the team contacts them personally. Supersedes "Bar drops
 *   only held requests". **P-9** stands for the automated side: parents get no message, no email and no reason.
 *
 * Contract (barred drop)
 * - Input: admin client + the nanny's `nannies.id` (+ her user id, and whether she was already barred before this sync).
 * - Rows parents never saw (stage 4 held application, DFY stage 9 held accept) are deleted and only counted.
 * - Every other live row (not in `HIDDEN_CONNECTION_STAGES`) moves to the existing neutral expiry, `status='expired'`:
 *   accepted-not-scheduled (10) → SCHEDULE_EXPIRED, as `expireStaleRequests` does for accepted rows; every other stage
 *   → REQUEST_EXPIRED (the app has no neutral terminal for meet / trial / offered / hired — P-14 ledger note).
 * - Output: the families dropped, the families whose row could NOT be dropped (write error, or it moved on between the
 *   read and the stage-guarded write) and the unseen count. A failed read throws (the sync's caller reports "retry"),
 *   so admin never gets a false "no families". `onNannyBarred` sends one VER-011 per bar (not on a re-sync of an
 *   already-barred nanny with nothing left to drop). A send failure is logged, never thrown — the drop stands and the
 *   rows stay findable (`status='expired'`, `updated_at` = the bar).
 * - Known limit: "already barred" = old level 0 + suspended (the sync cannot see the previous DBS state); a nanny
 *   suspended for another reason at level 0 and barred with nothing to drop gets no sync alert (ledger 3d §10).
 * - Never: messages a parent, says why, touches placements / positions / schema, or touches another nanny's rows.
 */
import { createAdminClient } from '@/lib/supabase/admin';
import { sendEmail } from '@/lib/email/resend';
import { getUserEmailInfo } from '@/lib/email/helpers';
import { sendBarredAdminAlert } from '@/lib/email/dbs-emails';
import { CONNECTION_STAGE, HIDDEN_CONNECTION_STAGES } from '@/lib/position/constants';
import { createInboxMessage } from '@/lib/actions/connection-helpers';
import { emailHeader } from '@/lib/email/brand';
import { SITE_URL } from '@/lib/constants';

type AdminClient = ReturnType<typeof createAdminClient>;

/** One family to contact after a bar (P-14). Every field is user data — escape before rendering. */
export interface AffectedFamily {
  connectionId: string;
  parentName: string;
  email: string | null;
  phone: string | null;
  positionId: string | null;
  positionTitle: string | null;
  /** The connection stage the row was at before it was dropped. */
  stage: number;
}

export interface BarredDropResult {
  /** Families whose connection was dropped (the write moved the row). */
  families: AffectedFamily[];
  /** Families whose row could NOT be dropped (write error, or the row moved on meanwhile) — admin checks by hand. */
  notDropped: AffectedFamily[];
  /** Held rows parents never saw (deleted, nobody to contact). */
  removedUnseen: number;
}

interface LiveRow {
  id: string;
  parent_id: string;
  position_id: string | null;
  connection_stage: number;
  status: string;
  source: string | null;
  parent_phone_shared: string | null;
}

const HIDDEN: readonly number[] = HIDDEN_CONNECTION_STAGES;

/** True for the held rows a parent never saw: stage 4, and a DFY stage 9. */
function isUnseenByParent(r: LiveRow): boolean {
  if (r.connection_stage === CONNECTION_STAGE.NANNY_APPLIED_PENDING) return true;
  return r.connection_stage === CONNECTION_STAGE.ACCEPTED_PENDING && r.source === 'dfy';
}

/** The existing neutral expiry for a row the parent saw (see the module contract). */
function neutralExpiryStage(stage: number): number {
  return stage === CONNECTION_STAGE.ACCEPTED ? CONNECTION_STAGE.SCHEDULE_EXPIRED : CONNECTION_STAGE.REQUEST_EXPIRED;
}

/** Rows of a read, or a throw — a failed read must never turn into "no families" (code-reviewer HIGH 1). */
function must(res: { data: unknown; error: { message: string } | null }, what: string): Record<string, unknown>[] {
  if (res.error) throw new Error(`barred drop: ${what} read failed: ${res.error.message}`);
  return (res.data ?? []) as Record<string, unknown>[];
}

/** Name, email, phone and position title for each visible row — three batched reads; any read error throws. */
async function describeFamilies(admin: AdminClient, rows: LiveRow[]): Promise<AffectedFamily[]> {
  if (rows.length === 0) return [];
  const parentIds = [...new Set(rows.map((r) => r.parent_id))];
  const positionIds = [...new Set(rows.map((r) => r.position_id).filter((id): id is string => !!id))];

  const parents = must(await admin.from('parents').select('id, user_id').in('id', parentIds), 'parents');
  const userIds = parents.map((p) => p.user_id as string);
  const profiles = userIds.length
    ? must(await admin.from('user_profiles').select('user_id, first_name, last_name, email, mobile_number').in('user_id', userIds), 'user_profiles')
    : [];
  const positions = positionIds.length
    ? must(await admin.from('nanny_positions').select('id, title').in('id', positionIds), 'nanny_positions')
    : [];

  const userOf = new Map(parents.map((p) => [p.id as string, p.user_id as string]));
  const profileOf = new Map(profiles.map((p) => [p.user_id as string, p]));
  const titleOf = new Map(positions.map((p) => [p.id as string, (p.title as string | null) ?? null]));

  return rows.map((r) => {
    const profile = profileOf.get(userOf.get(r.parent_id) ?? '');
    const name = profile ? `${profile.first_name ?? ''} ${profile.last_name ?? ''}`.trim() : '';
    return {
      connectionId: r.id,
      parentName: name || `Parent ${r.parent_id}`,
      email: (profile?.email as string | undefined) ?? null,
      phone: (profile?.mobile_number as string | null | undefined) ?? r.parent_phone_shared ?? null,
      positionId: r.position_id,
      positionTitle: r.position_id ? titleOf.get(r.position_id) ?? null : null,
      stage: r.connection_stage,
    };
  });
}

/** Moves one row to its neutral expiry, guarded on the stage read (a row that moved on is left alone). True = moved. */
async function expireRow(admin: AdminClient, nannyId: string, r: LiveRow, now: string): Promise<boolean> {
  const { data, error } = await admin
    .from('connection_requests')
    .update({ connection_stage: neutralExpiryStage(r.connection_stage), status: 'expired', updated_at: now })
    .eq('id', r.id)
    .eq('nanny_id', nannyId)
    .eq('connection_stage', r.connection_stage)
    .select('id');
  return !error && Array.isArray(data) && data.length === 1;
}

/**
 * P-14: drop every live connection of a barred nanny. The read and the family details throw on error; each write is
 * checked, and a row that did not move is returned in `notDropped` (never silently listed as dropped).
 */
export async function dropBarredConnections(admin: AdminClient, nannyId: string): Promise<BarredDropResult> {
  const read = await admin
    .from('connection_requests')
    .select('id, parent_id, position_id, connection_stage, status, source, parent_phone_shared')
    .eq('nanny_id', nannyId);
  const live = (must(read, 'connection_requests') as unknown as LiveRow[]).filter((r) => !HIDDEN.includes(r.connection_stage));
  const unseen = live.filter(isUnseenByParent);
  const visible = live.filter((r) => !isUnseenByParent(r));

  const described = await describeFamilies(admin, visible);
  const now = new Date().toISOString();

  for (const r of unseen) {
    await admin.from('connection_requests').delete().eq('id', r.id).eq('nanny_id', nannyId).eq('connection_stage', r.connection_stage);
  }
  const moved = await Promise.all(visible.map((r) => expireRow(admin, nannyId, r, now)));
  return {
    families: described.filter((_, i) => moved[i]),
    notDropped: described.filter((_, i) => !moved[i]),
    removedUnseen: unseen.length,
  };
}

/**
 * The sync's barred branch (P-14). Drops her connections, then sends ONE VER-011 listing the families — skipped only
 * when she was already barred before this sync and nothing was left to drop (a re-sync), so a bar is never alerted twice.
 */
export async function onNannyBarred(
  admin: AdminClient,
  args: { nannyId: string; userId: string; alreadyBarred: boolean },
): Promise<void> {
  const { families, notDropped, removedUnseen } = await dropBarredConnections(admin, args.nannyId);
  if (args.alreadyBarred && families.length === 0 && notDropped.length === 0 && removedUnseen === 0) return;
  try {
    await sendBarredAdminAlert(args.userId, families, removedUnseen, notDropped);
  } catch (err) {
    console.error(
      `[onNannyBarred] VER-011 admin alert failed for user ${args.userId} (${families.length} families; rows are status=expired):`,
      err instanceof Error ? err.message : 'unknown',
    );
  }
}

// ── Silent Hold: Promote pending connections on level 4 ──

export async function promotePendingConnections(
  admin: AdminClient,
  nannyId: string,
  userId: string,
): Promise<void> {
  // 1. Find all stage 4 connections (pending applications)
  const { data: pendingApps } = await admin
    .from('connection_requests')
    .select('id, parent_id, position_id')
    .eq('nanny_id', nannyId)
    .eq('connection_stage', CONNECTION_STAGE.NANNY_APPLIED_PENDING);

  // 2. Find all stage 9 connections (pending acceptances)
  const { data: pendingAccepts } = await admin
    .from('connection_requests')
    .select('id, parent_id, position_id, source')
    .eq('nanny_id', nannyId)
    .eq('connection_stage', CONNECTION_STAGE.ACCEPTED_PENDING);

  // 3. Get active position IDs
  const positionIds = [
    ...(pendingApps || []).map(c => c.position_id),
    ...(pendingAccepts || []).map(c => c.position_id),
  ].filter(Boolean);

  let activePositionIds = new Set<string>();
  if (positionIds.length > 0) {
    const { data: activePositions } = await admin
      .from('nanny_positions')
      .select('id')
      .in('id', positionIds)
      .eq('status', 'active');
    activePositionIds = new Set((activePositions || []).map(p => p.id));
  }

  const now = new Date().toISOString();

  // 4. Promote stage 4 → 5 for active positions
  for (const app of pendingApps || []) {
    if (activePositionIds.has(app.position_id)) {
      await admin
        .from('connection_requests')
        .update({ connection_stage: CONNECTION_STAGE.NANNY_APPLIED, updated_at: now })
        .eq('id', app.id);

      // Send deferred parent inbox message
      const { data: parentData } = await admin
        .from('parents')
        .select('user_id')
        .eq('id', app.parent_id)
        .single();

      if (parentData) {
        await createInboxMessage({
          userId: parentData.user_id,
          type: 'new_application',
          title: 'New application received!',
          body: 'A nanny has applied to your position. Check their profile and schedule a meet and greet.',
          actionUrl: '/parent',
          referenceId: app.id,
          referenceType: 'connection_request',
        });
      }
    } else {
      // Position no longer active — delete the pending connection
      await admin
        .from('connection_requests')
        .delete()
        .eq('id', app.id);
    }
  }

  // 5. Promote stage 9 → 10 for active positions
  const nannyEmailInfo = await getUserEmailInfo(userId);
  const nannyName = nannyEmailInfo ? nannyEmailInfo.firstName : 'A nanny';
  const appUrl = SITE_URL;
  const baseStyle = `font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px;`;
  const btnStyle = `background: #8B5CF6; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 600;`;

  for (const acc of pendingAccepts || []) {
    if (activePositionIds.has(acc.position_id)) {
      await admin
        .from('connection_requests')
        .update({ connection_stage: CONNECTION_STAGE.ACCEPTED, updated_at: now })
        .eq('id', acc.id);

      // Send deferred parent notifications
      const { data: parentData } = await admin
        .from('parents')
        .select('user_id')
        .eq('id', acc.parent_id)
        .single();

      if (parentData) {
        const parentEmailInfo = await getUserEmailInfo(parentData.user_id);

        if (acc.source === 'dfy') {
          // DFY acceptance — DFY-002 email + inbox
          await createInboxMessage({
            userId: parentData.user_id,
            type: 'dfy_nanny_interested',
            title: `${nannyName} is interested and available for a meet and greet!`,
            body: `${nannyName} has shared their availability. Pick a time for a meet and greet.`,
            actionUrl: '/parent',
            referenceId: acc.id,
            referenceType: 'connection_request',
          });

          if (parentEmailInfo) {
            sendEmail({
              to: parentEmailInfo.email,
              subject: `${nannyName} is interested and available for a meet and greet!`,
              html: `<div style="${baseStyle}">
                ${emailHeader()}
                <p style="color: #374151; font-size: 16px; line-height: 1.6;">${nannyName} has expressed interest in your nanny position and shared their availability for a meet and greet.</p>
                <p style="color: #374151; font-size: 14px;">Pick a time that works for your meet and greet.</p>
                <p style="margin-top: 24px;"><a href="${appUrl}/parent" style="${btnStyle}">Pick a Time</a></p>
              </div>`,
              emailType: 'dfy_parent_applicant',
              recipientUserId: parentData.user_id,
            }).catch(err => console.error('[Promotion] DFY-002 email error:', err));
          }
        } else {
          // Parent-initiated acceptance — connection_accepted email + inbox
          await createInboxMessage({
            userId: parentData.user_id,
            type: 'connection_accepted',
            title: `${nannyName} accepted your connection!`,
            body: `${nannyName} has shared their available times. Pick a slot for your meet and greet.`,
            actionUrl: '/parent/connections',
            referenceId: acc.id,
            referenceType: 'connection_request',
          });

          if (parentEmailInfo) {
            sendEmail({
              to: parentEmailInfo.email,
              subject: `${nannyName} accepted your connection request!`,
              html: `<div style="${baseStyle}">
                ${emailHeader()}
                <p style="color: #374151; font-size: 16px; line-height: 1.6;">Great news! ${nannyName} has accepted your connection request and shared their available times. Check their availability and pick a slot for your meet and greet.</p>
                <p style="color: #6B7280; font-size: 14px; margin-top: 8px;">You have 3 days to schedule a time.</p>
                <p style="margin-top: 24px;"><a href="${appUrl}/parent/connections" style="${btnStyle}">Pick a Time</a></p>
              </div>`,
              emailType: 'interview_confirmed',
              recipientUserId: parentData.user_id,
            }).catch(err => console.error('[Promotion] Accept email error:', err));
          }
        }
      }
    } else {
      // Position no longer active — delete
      await admin
        .from('connection_requests')
        .delete()
        .eq('id', acc.id);
    }
  }
}
