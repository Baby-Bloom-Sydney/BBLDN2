'use server';

/**
 * Nanny verification server actions + `syncNannyVerificationState` (the one place nannies.verification_level is
 * derived; body pinned by G5). Unit 3d changed only `cleanupPendingConnections`: a dropped held request now expires
 * silently for the parent (README P-9). Never: tells a parent why a connection was dropped.
 */
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { revalidatePath } from 'next/cache';
import {
  IDENTITY_STATUS,
  WWCC_STATUS,
  CONTACT_STATUS,
  CROSS_CHECK_STATUS,
  VERIFICATION_LEVEL,
  deriveOverallStatus,
  DBS_VERIFICATION_METHOD,
  type IdentityStatus,
  type WwccStatus,
  type CrossCheckStatus,
  type UserGuidance,
} from '@/lib/verification';
import { capitalizeName } from '@/lib/utils';
import { sendEmail } from '@/lib/email/resend';
import { getUserEmailInfo } from '@/lib/email/helpers';
import { CONNECTION_STAGE } from '@/lib/position/constants';
import { createInboxMessage } from './connection-helpers';
import { emailHeader, emailFooter } from "@/lib/email/brand";
import { SITE_URL } from "@/lib/constants";

// ── Shared auth helper ──

async function getAuthUser() {
  const supabase = createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return null;
  return user;
}

// ── Sync nannies table from verifications (source of truth) ──

/**
 * Sync nannies table from verifications (source of truth).
 * Idempotent — safe to call multiple times.
 * MUST be called after every verifications table mutation.
 */
export async function syncNannyVerificationState(userId: string): Promise<void> {
  const admin = createAdminClient();

  // 0. Read old verification level for comparison (silent hold promotion/cleanup)
  const { data: existingNanny } = await admin
    .from('nannies')
    .select('id, verification_level')
    .eq('user_id', userId)
    .single();

  const oldLevel = existingNanny?.verification_level ?? 0;
  const nannyId = existingNanny?.id;

  // 1. Read current verifications state
  const { data: v } = await admin
    .from('verifications')
    .select('identity_status, identity_verified, wwcc_status, wwcc_verified, cross_check_status')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  // 2. If no verification record, reset nannies to baseline
  if (!v) {
    await admin
      .from('nannies')
      .update({
        identity_verified: false,
        wwcc_verified: false,
        verification_level: 0, // SIGNED_UP
        updated_at: new Date().toISOString(),
      })
      .eq('user_id', userId);
    return;
  }

  // 3. Derive correct nannies fields from verifications
  const identityVerified = v.identity_verified === true && v.identity_status === 'verified';
  const wwccVerified = v.wwcc_verified === true;

  let level: number;
  if (wwccVerified && identityVerified) {
    level = 4; // FULLY_VERIFIED — OCG cleared + identity verified
  } else if (v.cross_check_status === 'passed' && identityVerified) {
    level = 3; // PROVISIONALLY_VERIFIED
  } else if (identityVerified) {
    level = 2; // ID_VERIFIED
  } else if (v.identity_status !== 'not_started') {
    level = 1; // REGISTERED (identity submitted but not verified)
  } else {
    level = 0; // SIGNED_UP
  }

  // 4. Build update object
  const update: Record<string, unknown> = {
    identity_verified: identityVerified,
    wwcc_verified: wwccVerified,
    verification_level: level,
    updated_at: new Date().toISOString(),
  };

  // 5. Handle BARRED — suspend account
  if (v.wwcc_status === 'barred') {
    update.verification_level = 0;
    update.status = 'suspended';
  }

  // 6. Handle FULLY_VERIFIED — activate
  if (level === 4) {
    update.status = 'active';
  }

  // 7. Write to nannies
  await admin
    .from('nannies')
    .update(update)
    .eq('user_id', userId);

  // 8. Silent Hold: Promote or cleanup pending connections
  if (nannyId) {
    const finalLevel = (v.wwcc_status === 'barred') ? 0 : level;

    // PROMOTION: Old level < 4, new level = 4
    if (oldLevel < 4 && finalLevel === 4) {
      await promotePendingConnections(admin, nannyId, userId);
    }

    // CLEANUP: New level = 0 (BARRED) from level 3+
    if (finalLevel === 0 && oldLevel >= 3) {
      await cleanupPendingConnections(admin, nannyId);
    }
  }
}

// ── Silent Hold: Promote pending connections on level 4 ──

async function promotePendingConnections(
  admin: ReturnType<typeof createAdminClient>,
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

// ── Silent Hold: Cleanup pending connections on BARRED ──

/**
 * Drops her held connections when she is barred (level 3+ → 0). Stage 4 (applications the parent never saw) and DFY
 * stage 9 are deleted. A parent-initiated stage 9 — which the parent sees as "Request Sent" (G7) — expires silently
 * to the neutral REQUEST_EXPIRED state, exactly as an unanswered request times out (`expireStaleRequests`).
 * README P-9 (BAI 2026-10-06, unit 3d): dropped connections are silent to parents — no reason, no DBS wording, no
 * parent message. Supersedes the interim "DECLINED + nanny unable to proceed" message.
 */
async function cleanupPendingConnections(
  admin: ReturnType<typeof createAdminClient>,
  nannyId: string,
): Promise<void> {
  const now = new Date().toISOString();

  // 1. Delete all stage 4 connections (parent never saw them)
  await admin
    .from('connection_requests')
    .delete()
    .eq('nanny_id', nannyId)
    .eq('connection_stage', CONNECTION_STAGE.NANNY_APPLIED_PENDING);

  // 2. Handle stage 9 connections — split by source
  const { data: pendingAccepts } = await admin
    .from('connection_requests')
    .select('id, parent_id, source')
    .eq('nanny_id', nannyId)
    .eq('connection_stage', CONNECTION_STAGE.ACCEPTED_PENDING);

  for (const acc of pendingAccepts || []) {
    if (acc.source === 'dfy') {
      // DFY: delete silently (parent never saw it)
      await admin
        .from('connection_requests')
        .delete()
        .eq('id', acc.id);
    } else {
      // Parent-initiated: the parent saw "Request Sent" — it now reads as an expired request (P-9: no message)
      await admin
        .from('connection_requests')
        .update({
          connection_stage: CONNECTION_STAGE.REQUEST_EXPIRED,
          status: 'expired',
          updated_at: now,
        })
        .eq('id', acc.id);
    }
  }
}

// ── Submit Identity Section ──

interface SubmitIdentityData {
  surname: string;
  given_names: string;
  date_of_birth: string;
  passport_country: string;
  passport_upload_url: string;
  identification_photo_url: string;
}

export async function submitIdentitySection(
  data: SubmitIdentityData
): Promise<{ success: boolean; error: string | null; verificationId?: string }> {
  console.log('[submitIdentitySection] Starting...');
  const user = await getAuthUser();
  if (!user) {
    console.error('[submitIdentitySection] Not authenticated');
    return { success: false, error: 'Not authenticated' };
  }
  console.log('[submitIdentitySection] Auth OK, user:', user.id);

  if (!data.surname?.trim() || !data.given_names?.trim() || !data.date_of_birth || !data.passport_country) {
    return { success: false, error: 'Missing required identity fields' };
  }
  if (!data.passport_upload_url || !data.identification_photo_url) {
    return { success: false, error: 'Missing document uploads' };
  }

  const admin = createAdminClient();

  // Check for existing record
  const { data: existing, error: existingErr } = await admin
    .from('verifications')
    .select('id, wwcc_status')
    .eq('user_id', user.id)
    .single();
  console.log('[submitIdentitySection] Existing check:', existing ? 'found' : 'not found', existingErr?.code);

  const identityFields = {
    user_id: user.id,
    surname: capitalizeName(data.surname),
    given_names: capitalizeName(data.given_names),
    date_of_birth: data.date_of_birth,
    passport_country: data.passport_country,
    passport_upload_url: data.passport_upload_url,
    identification_photo_url: data.identification_photo_url,
    // Status
    identity_status: IDENTITY_STATUS.PENDING,
    identity_status_at: new Date().toISOString(),
    identity_verified: false,
    // Clear old AI data
    extracted_surname: null,
    extracted_given_names: null,
    extracted_dob: null,
    extracted_nationality: null,
    extracted_passport_number: null,
    extracted_passport_expiry: null,
    identity_ai_reasoning: null,
    identity_ai_issues: null,
    identity_rejection_reason: null,
    identity_user_guidance: null,
    // Reset cross-check (must re-run after identity resubmission)
    cross_check_status: CROSS_CHECK_STATUS.NOT_STARTED,
    cross_check_reasoning: null,
    cross_check_issues: null,
    cross_check_at: null,
    updated_at: new Date().toISOString(),
  };

  let verificationId: string;

  if (existing) {
    console.log('[submitIdentitySection] Updating existing record:', existing.id);
    const { error: updateErr } = await admin
      .from('verifications')
      .update({
        ...identityFields,
        verification_status: deriveOverallStatus(
          IDENTITY_STATUS.PENDING as IdentityStatus,
          (existing.wwcc_status || WWCC_STATUS.NOT_STARTED) as WwccStatus,
          CROSS_CHECK_STATUS.NOT_STARTED as CrossCheckStatus
        ),
      })
      .eq('id', existing.id);

    if (updateErr) {
      console.error('[submitIdentitySection] Update failed:', updateErr);
      return { success: false, error: `Failed to save identity data: ${updateErr.message}` };
    }
    verificationId = existing.id;
  } else {
    console.log('[submitIdentitySection] Inserting new record');
    const insertPayload = {
      ...identityFields,
      // Defaults for new record
      wwcc_status: WWCC_STATUS.NOT_STARTED,
      contact_status: CONTACT_STATUS.NOT_STARTED,
      verification_status: deriveOverallStatus(
        IDENTITY_STATUS.PENDING as IdentityStatus,
        WWCC_STATUS.NOT_STARTED as WwccStatus,
        CROSS_CHECK_STATUS.NOT_STARTED as CrossCheckStatus
      ),
    };
    console.log('[submitIdentitySection] Insert payload keys:', Object.keys(insertPayload).join(', '));

    const { data: inserted, error: insertErr } = await admin
      .from('verifications')
      .insert(insertPayload)
      .select('id')
      .single();

    if (insertErr || !inserted) {
      console.error('[submitIdentitySection] Insert failed:', insertErr);
      return { success: false, error: `Failed to create verification record: ${insertErr?.message ?? 'unknown'}` };
    }
    verificationId = inserted.id;
    console.log('[submitIdentitySection] Inserted:', verificationId);
  }

  // Sync nannies from verifications (resets identity_verified, sets level)
  await syncNannyVerificationState(user.id);

  console.log('[submitIdentitySection] Done, verificationId:', verificationId);
  revalidatePath('/nanny/verification');
  return { success: true, error: null, verificationId };
}

// ── Submit Identity for Manual Review ──

export async function submitIdentityForManualReview(): Promise<{ success: boolean; error: string | null }> {
  const user = await getAuthUser();
  if (!user) return { success: false, error: 'Not authenticated' };

  const admin = createAdminClient();

  const { data: existing } = await admin
    .from('verifications')
    .select('id, wwcc_status')
    .eq('user_id', user.id)
    .single();

  if (!existing) {
    return { success: false, error: 'No verification record found' };
  }

  // Set identity to review. WWCC data is preserved so user doesn't have to re-upload.
  // Cross-check is reset (can't run without verified identity).
  const { error: updateErr } = await admin
    .from('verifications')
    .update({
      identity_status: IDENTITY_STATUS.REVIEW,
      identity_status_at: new Date().toISOString(),
      identity_user_guidance: null,
      // Reset cross-check (identity is prerequisite)
      cross_check_status: CROSS_CHECK_STATUS.NOT_STARTED,
      cross_check_reasoning: null,
      cross_check_issues: null,
      cross_check_at: null,
      // Derive verification_status preserving existing WWCC status
      verification_status: deriveOverallStatus(
        IDENTITY_STATUS.REVIEW as IdentityStatus,
        (existing.wwcc_status || WWCC_STATUS.NOT_STARTED) as WwccStatus,
        CROSS_CHECK_STATUS.NOT_STARTED as CrossCheckStatus
      ),
      updated_at: new Date().toISOString(),
    })
    .eq('id', existing.id);

  if (updateErr) {
    console.error('[submitIdentityForManualReview] Update failed:', updateErr);
    return { success: false, error: 'Failed to submit for manual review' };
  }

  // Sync nannies (resets identity_verified, wwcc_verified, demotes level)
  await syncNannyVerificationState(user.id);

  // VER-004: Submitted for Manual Review email
  const userInfo = await getUserEmailInfo(user.id);
  if (userInfo) {
    const appUrl = SITE_URL;
    sendEmail({
      to: userInfo.email,
      subject: "We're reviewing your documents",
      html: `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1e293b;background:#f8fafc;">
<div style="max-width:600px;margin:0 auto;padding:32px 16px;">
  <div style="background:#fff;border-radius:16px;border:1px solid #e2e8f0;padding:32px;">
    <div style="margin-bottom:24px;">
      <span style="font-size:20px;font-weight:700;"><span style="color:#0f172a;">Baby</span><span style="color:#8b5cf6;">Bloom</span></span>
    </div>
    <h1 style="font-size:22px;font-weight:700;margin:0 0 16px;">We've received your documents</h1>
    <p style="font-size:15px;color:#475569;line-height:1.6;margin:0 0 12px;">Hi ${userInfo.firstName}, your identity documents have been submitted for manual review by our team.</p>
    <p style="font-size:15px;color:#475569;line-height:1.6;margin:0 0 12px;">We'll review everything and get back to you within <strong>24–48 hours</strong>. No further action is needed from you right now.</p>
    <p style="font-size:15px;color:#475569;line-height:1.6;margin:0 0 12px;">You can check the status of your verification at any time from your dashboard.</p>
    <div style="text-align:center;margin-top:24px;">
      <a href="${appUrl}/nanny/verification" style="display:inline-block;background:#8b5cf6;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;font-size:15px;">View Status</a>
    </div>
    ${emailFooter()}
  </div>
</div>
</body></html>`,
      emailType: 'verification_pending',
      recipientUserId: user.id,
    }).catch(err => console.error('[ManualReview] VER-004 email error:', err));
  }

  revalidatePath('/nanny/verification');
  return { success: true, error: null };
}

// ── Submit the DBS certificate (the section keeps its original name, D-4) ──
// Unit 3b (BB-LDN-3b-061026), rulings #3 and #34: one page-1 upload (photo or PDF) + the consent tick. No number, no
// date, no method choice, and nothing the client says about the certificate's contents is stored (security note A3:
// the old client-supplied extracted fields let a caller mark a check passed with no AI check). The AI reads the file.

interface SubmitWWCCData {
  /** Storage path of page 1 in `verification-documents`; must sit in the caller's own folder. */
  certificate_path: string;
  /** The consent tick (copy deck §1.3, [LEGAL] wording). Anything but `true` is refused. */
  consent: true;
}

const DBS_ERRORS = {
  missing: 'Please upload page 1 of your DBS certificate to continue.',
  consent: 'Please tick the box to confirm your certificate and agree to the check.',
  save: "We couldn't save your certificate. Please try again.",
} as const;

/**
 * The file name the upload helper makes (`<timestamp>-<safe name>`, `lib/supabase/storage.ts`). An allow-list, not a
 * deny-list: no `/`, `\`, `%`, `?`, `#` or space can pass, so no encoded or literal dot-segment can climb out of her
 * folder when the path is later signed with the service role (security review, 3b). The name must hold a letter or digit.
 */
const CERTIFICATE_FILE_NAME = /^\d{10,}-(?=[A-Za-z0-9._-]*[A-Za-z0-9])[A-Za-z0-9._-]+$/;
const CERTIFICATE_BUCKET = 'verification-documents';

/** `<her id>/<file name>` only — the name, or null. Fail closed. */
function ownCertificateName(path: string, userId: string): string | null {
  const prefix = `${userId}/`;
  if (!path.startsWith(prefix)) return null;
  const name = path.slice(prefix.length);
  return CERTIFICATE_FILE_NAME.test(name) ? name : null;
}

/** The object must exist in her folder (fail closed on any storage error). */
async function certificateExists(admin: ReturnType<typeof createAdminClient>, userId: string, name: string): Promise<boolean> {
  const { data, error } = await admin.storage.from(CERTIFICATE_BUCKET).list(userId, { search: name, limit: 100 });
  if (error) {
    console.error('[submitWWCCSection] Storage check failed:', error);
    return false;
  }
  return (data ?? []).some((o) => o.name === name);
}

/**
 * Saves her page-1 DBS certificate upload and starts the check (unit 3b; rulings #3, #34; security note A3).
 * In: `{certificate_path, consent: true}` from the signed-in nanny. Refuses — writing nothing — when not signed in,
 * without the consent tick, when the path is not `<her id>/<timestamp>-<name>` (allow-list), when the file is not in
 * her storage folder, or when she has no verification row.
 * Writes: method `'dbs_certificate'`, the path, the consent tick + time, status `pending` (29 via the derive), and
 * clears every AI / extracted / guidance / cross-check field. Out: `{success, error, verificationId}`.
 * Never: stores anything the client says about the certificate's contents; never sets a verified or passed state —
 * the AI phase (`/api/run-verification`, fired by the caller) does that.
 */
export async function submitWWCCSection(
  data: SubmitWWCCData
): Promise<{ success: boolean; error: string | null; verificationId?: string }> {
  const user = await getAuthUser();
  if (!user) return { success: false, error: 'Not authenticated' };

  if (data?.consent !== true) return { success: false, error: DBS_ERRORS.consent };
  const path = typeof data.certificate_path === 'string' ? data.certificate_path.trim() : '';
  if (!path) return { success: false, error: DBS_ERRORS.missing };
  const name = ownCertificateName(path, user.id);
  if (!name) return { success: false, error: DBS_ERRORS.missing };

  const admin = createAdminClient();
  if (!(await certificateExists(admin, user.id, name))) return { success: false, error: DBS_ERRORS.missing };

  const { data: existing } = await admin
    .from('verifications')
    .select('id, identity_status')
    .eq('user_id', user.id)
    .single();

  if (!existing) {
    return { success: false, error: 'No verification record found. Please complete Identity section first.' };
  }

  const now = new Date().toISOString();
  const dbsFields = {
    wwcc_verification_method: DBS_VERIFICATION_METHOD,
    wwcc_service_nsw_screenshot_url: path,   // column name kept (D-4); holds the certificate file
    wwcc_declaration: true,
    wwcc_declaration_at: now,
    // Nothing about the certificate comes from the client (A3) — the AI fills these from the file.
    wwcc_number: null,
    wwcc_expiry_date: null,
    wwcc_grant_email_url: null,
    extracted_wwcc_surname: null,
    extracted_wwcc_first_name: null,
    extracted_wwcc_other_names: null,
    extracted_wwcc_number: null,
    extracted_wwcc_clearance_type: null,
    extracted_wwcc_expiry: null,
    extracted_wwcc_dob: null,
    // Status: the AI runs next
    wwcc_status: WWCC_STATUS.PENDING,
    wwcc_status_at: now,
    wwcc_verified: false,
    wwcc_doc_verified: false,
    wwcc_doc_verified_at: null,
    // Clear old AI data
    wwcc_ai_reasoning: null,
    wwcc_ai_issues: null,
    wwcc_rejection_reason: null,
    wwcc_user_guidance: null,
    // Reset cross-check (must re-run after a resubmission)
    cross_check_status: CROSS_CHECK_STATUS.NOT_STARTED,
    cross_check_reasoning: null,
    cross_check_issues: null,
    cross_check_at: null,
    verification_status: deriveOverallStatus(
      (existing.identity_status || IDENTITY_STATUS.NOT_STARTED) as IdentityStatus,
      WWCC_STATUS.PENDING as WwccStatus,
      CROSS_CHECK_STATUS.NOT_STARTED as CrossCheckStatus
    ),
    updated_at: now,
  };

  const { error: updateErr } = await admin
    .from('verifications')
    .update(dbsFields)
    .eq('id', existing.id);

  if (updateErr) {
    console.error('[submitWWCCSection] Update failed:', updateErr);
    return { success: false, error: DBS_ERRORS.save };
  }

  // Sync nannies from verifications
  await syncNannyVerificationState(user.id);

  // Both screens fire POST /api/run-verification {phase:"wwcc"} next; there is no method branch here any more.
  revalidatePath('/nanny/verification');
  return { success: true, error: null, verificationId: existing.id };
}

// ── Submit Contact Section ──

interface SubmitContactData {
  phone_number: string;
  address_line: string;
  city: string;
  state?: string;
  postcode: string;
  country: string;
}

export async function submitContactSection(
  data: SubmitContactData
): Promise<{ success: boolean; error: string | null }> {
  const user = await getAuthUser();
  if (!user) return { success: false, error: 'Not authenticated' };

  if (!data.address_line?.trim() || !data.city?.trim() || !data.postcode?.trim()) {
    return { success: false, error: 'Missing required contact details' };
  }

  const admin = createAdminClient();

  const { error: updateErr } = await admin
    .from('verifications')
    .update({
      phone_number: data.phone_number?.trim() || null,
      address_line: data.address_line.trim(),
      city: data.city.trim(),
      state: data.state?.trim() ?? null,
      postcode: data.postcode.trim(),
      country: data.country.trim(),
      contact_status: CONTACT_STATUS.SAVED,
      updated_at: new Date().toISOString(),
    })
    .eq('user_id', user.id);

  if (updateErr) {
    console.error('[submitContactSection] Update failed:', updateErr);
    return { success: false, error: 'Failed to save contact details' };
  }

  // Sync verified suburb and postcode back to user_profiles
  // (overrides the self-reported suburb from the onboarding funnel)
  await admin.from('user_profiles').update({
    suburb: data.city.trim(),
    postcode: data.postcode.trim(),
    updated_at: new Date().toISOString(),
  }).eq('user_id', user.id);

  revalidatePath('/nanny/verification');
  return { success: true, error: null };
}

// ── Get Full Verification Data (for page load pre-population) ──

export interface VerificationData {
  id: string;
  // Per-section statuses
  identity_status: string;
  wwcc_status: string;
  contact_status: string;
  cross_check_status: string;
  // Legacy
  verification_status: number;
  // Identity fields
  surname: string | null;
  given_names: string | null;
  date_of_birth: string | null;
  passport_country: string | null;
  passport_upload_url: string | null;
  identification_photo_url: string | null;
  identity_verified: boolean;
  identity_rejection_reason: string | null;
  identity_user_guidance: UserGuidance | null;
  extracted_passport_number: string | null;
  extracted_nationality: string | null;
  // WWCC fields
  wwcc_verification_method: string | null;
  wwcc_number: string | null;
  wwcc_expiry_date: string | null;
  wwcc_grant_email_url: string | null;
  wwcc_service_nsw_screenshot_url: string | null;
  wwcc_doc_verified: boolean;
  wwcc_verified: boolean;
  wwcc_rejection_reason: string | null;
  wwcc_user_guidance: UserGuidance | null;
  // Update Service result (3b: the clear row's "checked {date}"). Optional so other readers' selects still fit.
  ocg_result_status?: string | null;
  ocg_verified_at?: string | null;
  // Contact fields
  phone_number: string | null;
  address_line: string | null;
  city: string | null;
  state: string | null;
  postcode: string | null;
  country: string | null;
  // Cross-check
  cross_check_reasoning: string | null;
  // Timestamps
  created_at: string;
  updated_at: string;
}

export async function getVerificationData(): Promise<{
  data: VerificationData | null;
  error: string | null;
}> {
  const user = await getAuthUser();
  if (!user) return { data: null, error: 'Not authenticated' };

  const supabase = createClient();
  const { data, error } = await supabase
    .from('verifications')
    .select(`
      id,
      identity_status, wwcc_status, contact_status, cross_check_status,
      verification_status,
      surname, given_names, date_of_birth, passport_country,
      passport_upload_url, identification_photo_url,
      identity_verified, identity_rejection_reason, identity_user_guidance,
      extracted_passport_number, extracted_nationality,
      wwcc_verification_method, wwcc_number, wwcc_expiry_date,
      wwcc_grant_email_url, wwcc_service_nsw_screenshot_url,
      wwcc_doc_verified, wwcc_verified, wwcc_rejection_reason, wwcc_user_guidance,
      ocg_result_status, ocg_verified_at,
      phone_number, address_line, city, state, postcode, country,
      cross_check_reasoning,
      created_at, updated_at
    `)
    .eq('user_id', user.id)
    .single();

  if (error && error.code !== 'PGRST116') {
    console.error('[getVerificationData] Error:', error);
    return { data: null, error: 'Failed to fetch verification data' };
  }

  return { data: (data as VerificationData) ?? null, error: null };
}
