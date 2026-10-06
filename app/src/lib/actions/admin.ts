'use server';

/**
 * Admin server actions: identity approve/reject, DBS reject (→ 22), user delete/role/reset, bio regenerate, contact email.
 *
 * Unit 3d changes: `requireAdmin` moved to `lib/admin/require-admin.ts` (same body; R-A1); the OCG "Confirm" stamp
 * (`adminConfirmWWCC`) is deleted (spec §4); `adminRejectWWCC` is wired, stamps the deciding admin, writes her guidance,
 * logs, and sends the P-4 reject email; `adminSendEmail` can log "Ask for page 2" (#27). Approve / Bar / Lift bar /
 * Run DBS check now live in `lib/actions/admin-dbs.ts`.
 *
 * Contract
 * - Every export calls `requireAdmin` first and writes nothing without it.
 * - Never: writes `wwcc_verified=true` or status 40 (Approve in admin-dbs.ts is the only writer, D3), or logs an
 *   activity type outside the allow-list in `adminSendEmail`.
 */
import { createAdminClient } from '@/lib/supabase/admin';
import { revalidatePath } from 'next/cache';
import {
  VERIFICATION_STATUS,
  VERIFICATION_LEVEL,
  IDENTITY_STATUS,
  WWCC_STATUS,
  CROSS_CHECK_STATUS,
  deriveOverallStatus,
  type IdentityStatus,
  type WwccStatus,
  type CrossCheckStatus,
} from '@/lib/verification';
import { runCrossCheckPhase, runWWCCDocPhase } from '@/lib/ai/verification-pipeline';
import { syncNannyVerificationState } from '@/lib/actions/verification';
import { sendEmail } from '@/lib/email/resend';
import { openai } from '@/lib/ai/client';
import { V2_SYSTEM_PROMPT, buildV2Prompt, parseAIProfileSections, generateV2Checklist } from '@/lib/ai/nanny-profile-prompts';
import { emailFooter } from "@/lib/email/brand";
import { ADMIN_FROM_ADDRESSES } from "@/lib/constants";
import { requireAdmin } from '@/lib/admin/require-admin';
import { sendDbsRejectedEmail } from '@/lib/email/dbs-emails';

// ── Admin: Verify Identity (approve passport check) ──
// State transition: identity_status → verified, level 1 → 2

export async function adminVerifyIdentity(
  verificationId: string
): Promise<{ success: boolean; error: string | null }> {
  const { userId: adminId, error: authErr } = await requireAdmin();
  if (authErr) return { success: false, error: authErr };

  const supabase = createAdminClient();

  const { data: verification, error: fetchErr } = await supabase
    .from('verifications')
    .select('user_id, verification_status, wwcc_status')
    .eq('id', verificationId)
    .single();

  if (fetchErr || !verification) {
    return { success: false, error: 'Verification record not found' };
  }

  const { error: updateVerErr } = await supabase
    .from('verifications')
    .update({
      identity_verified: true,
      identity_verified_at: new Date().toISOString(),
      identity_verified_by: adminId,
      identity_status: IDENTITY_STATUS.VERIFIED,
      identity_status_at: new Date().toISOString(),
      identity_rejection_reason: null,
      identity_user_guidance: null,
      verification_status: deriveOverallStatus(
        IDENTITY_STATUS.VERIFIED as IdentityStatus,
        (verification.wwcc_status || WWCC_STATUS.NOT_STARTED) as WwccStatus,
        CROSS_CHECK_STATUS.NOT_STARTED as CrossCheckStatus
      ),
      updated_at: new Date().toISOString(),
    })
    .eq('id', verificationId);

  if (updateVerErr) {
    return { success: false, error: `Failed to update verification: ${updateVerErr.message}` };
  }

  await syncNannyVerificationState(verification.user_id);

  // Check if WWCC is ready → trigger cross-check
  if (verification.wwcc_status === WWCC_STATUS.DOC_VERIFIED) {
    await supabase.from('verifications').update({
      cross_check_status: CROSS_CHECK_STATUS.PENDING,
      updated_at: new Date().toISOString(),
    }).eq('id', verificationId);

    runCrossCheckPhase(verificationId).catch(err => {
      console.error('[adminVerifyIdentity] Cross-check error:', err);
    });
  } else if (verification.wwcc_status === WWCC_STATUS.PENDING) {
    // Auto-fire WWCC AI if Service NSW screenshot is waiting
    runWWCCDocPhase(verificationId).catch(err => {
      console.error('[adminVerifyIdentity] Auto WWCC doc phase error:', err);
    });
  }

  revalidatePath('/admin/users');
  return { success: true, error: null };
}

// ── Admin: Reject Identity ──
// State transition: identity_status → rejected, level stays 1

export async function adminRejectIdentity(
  verificationId: string,
  reason: string
): Promise<{ success: boolean; error: string | null }> {
  const { error: authErr } = await requireAdmin();
  if (authErr) return { success: false, error: authErr };

  if (!reason.trim()) {
    return { success: false, error: 'Rejection reason is required' };
  }

  const supabase = createAdminClient();

  // Fetch verification record (need user_id for nannies sync + wwcc_status for deriveOverallStatus)
  const { data: verification } = await supabase
    .from('verifications')
    .select('user_id, wwcc_status')
    .eq('id', verificationId)
    .single();

  if (!verification) return { success: false, error: 'Verification not found' };

  // Reject identity + clear extracted identity data (clean slate for resubmission).
  // WWCC data is preserved so user doesn't have to re-upload.
  // Cross-check is reset (can't run without verified identity).
  const { error: updateErr } = await supabase
    .from('verifications')
    .update({
      identity_status: IDENTITY_STATUS.REJECTED,
      identity_status_at: new Date().toISOString(),
      identity_rejection_reason: reason.trim(),
      identity_verified: false,
      // Clear extracted identity data (clean slate for resubmission)
      extracted_surname: null,
      extracted_given_names: null,
      extracted_dob: null,
      extracted_nationality: null,
      extracted_passport_number: null,
      extracted_passport_expiry: null,
      // Reset cross-check (identity is prerequisite)
      cross_check_status: CROSS_CHECK_STATUS.NOT_STARTED,
      cross_check_reasoning: null,
      // Derive status preserving existing WWCC status
      verification_status: deriveOverallStatus(
        IDENTITY_STATUS.REJECTED as IdentityStatus,
        (verification.wwcc_status || WWCC_STATUS.NOT_STARTED) as WwccStatus,
        CROSS_CHECK_STATUS.NOT_STARTED as CrossCheckStatus
      ),
      updated_at: new Date().toISOString(),
    })
    .eq('id', verificationId);

  if (updateErr) {
    return { success: false, error: `Failed to reject: ${updateErr.message}` };
  }

  // Sync nannies (demotes level, resets identity_verified + wwcc_verified)
  await syncNannyVerificationState(verification.user_id);

  revalidatePath('/admin/users');
  return { success: true, error: null };
}

// ── Admin: Reject DBS certificate → 22 (unit 3d, brief change 3; #11, #26, P-4) ──

/** Statuses an admin may reject from: list A (30), list B (21, and 20 when the API was down — #30). */
const DBS_REJECTABLE: readonly number[] = [
  VERIFICATION_STATUS.PENDING_WWCC_AUTO,
  VERIFICATION_STATUS.PENDING_WWCC_REVIEW,
  VERIFICATION_STATUS.PROVISIONALLY_VERIFIED,
];

/**
 * Reject her certificate → 22. Writes the reason, `wwcc_verified_by` ("decided by"), `wwcc_status_at`, guidance for
 * her `GuidanceCard`, resets the cross-check, syncs (level 2), logs `verification_rejected`, then sends the P-4 email
 * once. Refuses barred rows (Lift bar is that path) and any status outside 20/21/30. A failed email returns a warning;
 * the reject stands. VER-003 keys on `wwcc_status='failed'`, so it does not double-send for 22.
 */
export async function adminRejectWWCC(
  verificationId: string,
  reason: string
): Promise<{ success: boolean; error: string | null; warning?: string }> {
  const { userId: adminId, error: authErr } = await requireAdmin();
  if (authErr) return { success: false, error: authErr };

  const trimmed = reason.trim();
  if (!trimmed) {
    return { success: false, error: 'Rejection reason is required' };
  }

  const supabase = createAdminClient();

  const { data: verification, error: fetchErr } = await supabase
    .from('verifications')
    .select('user_id, identity_status, wwcc_status, verification_status')
    .eq('id', verificationId)
    .single();

  if (fetchErr || !verification) {
    return { success: false, error: 'Verification record not found' };
  }
  if (verification.wwcc_status === WWCC_STATUS.BARRED || !DBS_REJECTABLE.includes(verification.verification_status)) {
    return { success: false, error: `Cannot reject from status ${verification.verification_status}` };
  }

  const now = new Date().toISOString();
  const { data: written, error: updateVerErr } = await supabase
    .from('verifications')
    .update({
      wwcc_rejection_reason: trimmed,
      wwcc_status: WWCC_STATUS.REJECTED,
      wwcc_status_at: now,
      wwcc_verified_by: adminId,
      // copy: 3g pins
      wwcc_user_guidance: {
        title: 'Your DBS certificate needs another look',
        explanation: trimmed,
        steps_to_fix: ['Upload page 1 of your certificate again, or request a manual review'],
      },
      verification_status: deriveOverallStatus(
        verification.identity_status as IdentityStatus,
        WWCC_STATUS.REJECTED as WwccStatus,
        CROSS_CHECK_STATUS.NOT_STARTED as CrossCheckStatus
      ),
      // Reset cross-check (a rejected certificate invalidates it)
      cross_check_status: CROSS_CHECK_STATUS.NOT_STARTED,
      cross_check_reasoning: null,
      wwcc_verified: false,
      wwcc_doc_verified: false,
      updated_at: now,
    })
    .eq('id', verificationId)
    .eq('verification_status', verification.verification_status)
    .select('id');

  if (updateVerErr) {
    return { success: false, error: `Failed to reject: ${updateVerErr.message}` };
  }
  if (!written || written.length === 0) {
    return { success: false, error: 'Her record changed meanwhile — refresh and review again' };
  }

  await syncNannyVerificationState(verification.user_id);

  const { error: logErr } = await supabase.from('activity_logs').insert({
    user_id: verification.user_id,
    action_type: 'verification_rejected',
    action_details: { admin_id: adminId, decision: 'reject', reason: trimmed },
  });
  if (logErr) console.error('[adminRejectWWCC] could not write the activity row:', logErr.message);

  let warning: string | undefined;
  try {
    await sendDbsRejectedEmail(verification.user_id, trimmed);
  } catch (err) {
    console.error('[adminRejectWWCC] reject email failed:', err instanceof Error ? err.message : 'unknown');
    warning = 'Rejected, but the email to her could not be sent — contact her manually';
  }

  revalidatePath('/admin/users');
  return { success: true, error: null, ...(warning ? { warning } : {}) };
}

// ── Admin: Delete User ──
// Deletes from auth.users which cascades to all FK-referenced tables

export async function adminDeleteUser(
  userId: string
): Promise<{ success: boolean; error: string | null }> {
  const { error: authErr } = await requireAdmin();
  if (authErr) return { success: false, error: authErr };

  const adminClient = createAdminClient();

  const { error } = await adminClient.auth.admin.deleteUser(userId);

  if (error) {
    console.error('[Admin] Delete user error:', error);
    return { success: false, error: `Failed to delete user: ${error.message}` };
  }

  revalidatePath('/admin/users');
  return { success: true, error: null };
}

// ── Admin: Change Role ──
// Updates user_roles and creates skeleton role-specific record if needed

export async function adminChangeRole(
  userId: string,
  newRole: 'nanny' | 'parent' | 'admin'
): Promise<{ success: boolean; error: string | null }> {
  const { error: authErr } = await requireAdmin();
  if (authErr) return { success: false, error: authErr };

  const adminClient = createAdminClient();

  // Update role
  const { error: roleErr } = await adminClient
    .from('user_roles')
    .update({ role: newRole, updated_at: new Date().toISOString() })
    .eq('user_id', userId);

  if (roleErr) {
    return { success: false, error: `Failed to update role: ${roleErr.message}` };
  }

  // Create skeleton nanny record if switching to nanny
  if (newRole === 'nanny') {
    const { data: existing } = await adminClient
      .from('nannies')
      .select('id')
      .eq('user_id', userId)
      .maybeSingle();

    if (!existing) {
      const { error: insertErr } = await adminClient
        .from('nannies')
        .insert({ user_id: userId, status: 'active' });

      if (insertErr) {
        console.error('[Admin] Create nanny record error:', insertErr);
      }
    }
  }

  // Create skeleton parent record if switching to parent
  if (newRole === 'parent') {
    const { data: existing } = await adminClient
      .from('parents')
      .select('id')
      .eq('user_id', userId)
      .maybeSingle();

    if (!existing) {
      const { error: insertErr } = await adminClient
        .from('parents')
        .insert({ user_id: userId, status: 'active' });

      if (insertErr) {
        console.error('[Admin] Create parent record error:', insertErr);
      }
    }
  }

  revalidatePath('/admin/users');
  return { success: true, error: null };
}

// ── Admin: Reset Verification ──
// Resets nanny verification to zero for re-testing

export async function adminResetVerification(
  userId: string
): Promise<{ success: boolean; error: string | null }> {
  const { error: authErr } = await requireAdmin();
  if (authErr) return { success: false, error: authErr };

  const adminClient = createAdminClient();

  // Reset nanny record
  const { error: nannyErr } = await adminClient
    .from('nannies')
    .update({
      verification_level: VERIFICATION_LEVEL.SIGNED_UP,
      verification_status: VERIFICATION_STATUS.NOT_STARTED,
      wwcc_verified: false,
      identity_verified: false,
      updated_at: new Date().toISOString(),
    })
    .eq('user_id', userId);

  if (nannyErr) {
    return { success: false, error: `Failed to reset nanny: ${nannyErr.message}` };
  }

  // Delete all verification records
  const { error: deleteErr } = await adminClient
    .from('verifications')
    .delete()
    .eq('user_id', userId);

  if (deleteErr) {
    return { success: false, error: `Failed to delete verifications: ${deleteErr.message}` };
  }

  revalidatePath('/admin/users');
  return { success: true, error: null };
}

// ── Admin: Regenerate Nanny AI Bio ──

export async function adminRegenerateNannyBio(
  userId: string
): Promise<{ success: boolean; error: string | null }> {
  const { error: authErr } = await requireAdmin();
  if (authErr) return { success: false, error: authErr };

  const admin = createAdminClient();

  // Fetch nanny record
  const { data: nanny } = await admin
    .from('nannies')
    .select('*')
    .eq('user_id', userId)
    .single();

  if (!nanny) return { success: false, error: 'Nanny record not found' };

  // Fetch profile + credentials in parallel
  const [{ data: profile }, { data: credentials }] = await Promise.all([
    admin
      .from('user_profiles')
      .select('first_name, last_name, suburb, date_of_birth')
      .eq('user_id', userId)
      .single(),
    admin
      .from('nanny_credentials')
      .select('credential_category, qualification_type, certification_type')
      .eq('nanny_id', nanny.id),
  ]);

  if (!profile) return { success: false, error: 'User profile not found' };

  const highest_qualification = credentials
    ?.find(c => c.credential_category === 'qualification')?.qualification_type || null;
  const certificates = (credentials || [])
    .filter(c => c.credential_category === 'certification')
    .map(c => c.certification_type)
    .filter((t): t is string => t !== null);

  // Convert months to age labels for V2 prompt
  const monthsToLabel = (m: number | null): string | null => {
    if (m === null || m === undefined) return null;
    if (m === 0) return 'Newborn';
    if (m < 12) return `${m} months`;
    if (m === 12) return '12 months';
    const years = Math.round(m / 12);
    return `${years} years`;
  };

  const childcareRoles = (nanny.childcare_roles || []) as Array<{ role: string; duration: number }>;

  // Build V2 prompt data from live nanny profile
  const promptData = {
    firstName: profile.first_name,
    lastName: profile.last_name,
    suburb: profile.suburb || null,
    dateOfBirth: profile.date_of_birth || null,
    nationality: nanny.nationality || null,
    motivation: nanny.motivation || null,
    personalityTraits: nanny.personality_traits || [],
    levelOfSupport: nanny.level_of_support_offered || [],
    professionalValues: nanny.professional_values || [],
    totalExperience: nanny.total_experience_years != null ? String(nanny.total_experience_years) : null,
    under3Experience: nanny.under_3_experience_years,
    newbornExperience: nanny.newborn_experience_years,
    childcareRoles,
    highestQualification: highest_qualification,
    certificates,
    roleTypes: nanny.role_types_preferred || [],
    minAge: monthsToLabel(nanny.min_child_age_months),
    maxAge: monthsToLabel(nanny.max_child_age_months),
    additionalNeeds: nanny.additional_needs_ok,
    languages: nanny.languages || [],
    driversLicense: nanny.drivers_license,
    hasCar: nanny.has_car,
    vaccinationStatus: nanny.vaccination_status,
    comfortableWithPets: nanny.comfortable_with_pets,
    nonSmoker: nanny.non_smoker,
  };

  try {
    const userMessage = buildV2Prompt(promptData);

    const completion = await openai.chat.completions.create({
      model: 'o4-mini',
      messages: [
        { role: 'developer', content: V2_SYSTEM_PROMPT },
        { role: 'user', content: userMessage },
      ],
      max_completion_tokens: 10000,
    });

    const raw = completion.choices[0]?.message?.content?.trim();
    if (!raw) return { success: false, error: 'No content generated' };

    const sections = parseAIProfileSections(raw);

    if (!sections.headline && !sections.about && !sections.experience) {
      return { success: false, error: 'AI generation returned incomplete content' };
    }

    const checklist = generateV2Checklist({
      personalityTraits: nanny.personality_traits || [],
      childcareRoles,
      totalExperience: nanny.total_experience_years != null ? String(nanny.total_experience_years) : null,
      under3Experience: nanny.under_3_experience_years,
      newbornExperience: nanny.newborn_experience_years,
      highestQualification: highest_qualification,
      certificates,
      roleTypes: nanny.role_types_preferred || [],
      levelOfSupport: nanny.level_of_support_offered || [],
      minAge: monthsToLabel(nanny.min_child_age_months),
      maxAge: monthsToLabel(nanny.max_child_age_months),
      driversLicense: nanny.drivers_license,
      hasCar: nanny.has_car,
      comfortableWithPets: nanny.comfortable_with_pets,
      vaccinationStatus: nanny.vaccination_status,
      nonSmoker: nanny.non_smoker,
    });

    const aiContent = {
      headline: sections.headline || '',
      parent_pitch: sections.bio || '',
      bio_summary: {
        about: sections.about || '',
        personality: sections.personality || '',
        values: sections.values || '',
        background: sections.background || '',
        what_i_offer: sections.what_i_offer || '',
      },
      experience_summary: sections.experience || '',
      skills_highlight: checklist,
      ai_model: 'o4-mini',
      generated_at: new Date().toISOString(),
    };

    await admin
      .from('nannies')
      .update({ ai_content: aiContent })
      .eq('id', nanny.id);
  } catch (err) {
    console.error('[adminRegenerateNannyBio] AI error:', err);
    return { success: false, error: 'AI bio generation failed' };
  }

  revalidatePath('/admin/users');
  revalidatePath('/nannies');
  return { success: true, error: null };
}

// ── Admin: Send Email to User ──

/** The only history rows an admin email may write (3d, #27). Anything else is refused — fail closed. */
const ADMIN_EMAIL_LOG_TYPES = ['dbs_page2_requested'] as const;

/**
 * Sends one email from an admin sender. With `logActionType: 'dbs_page2_requested'` ("Ask for page 2", #27) it also
 * writes one `activity_logs` row `{admin_id}` for her — only after a successful send — and changes no status.
 */
export async function adminSendEmail(params: {
  toEmail: string;
  toUserId: string;
  fromAddress: string;
  subject: string;
  body: string;
  logActionType?: typeof ADMIN_EMAIL_LOG_TYPES[number];
}): Promise<{ success: boolean; error: string | null }> {
  const { userId: adminId, error: authErr } = await requireAdmin();
  if (authErr) return { success: false, error: authErr };

  const { toEmail, toUserId, fromAddress, subject, body, logActionType } = params;

  if (logActionType !== undefined && !(ADMIN_EMAIL_LOG_TYPES as readonly string[]).includes(logActionType)) {
    return { success: false, error: 'Invalid log type' };
  }

  if (!toEmail || !subject.trim() || !body.trim()) {
    return { success: false, error: 'Email, subject, and body are required' };
  }

  if (!(ADMIN_FROM_ADDRESSES as readonly string[]).includes(fromAddress)) {
    return { success: false, error: 'Invalid from address' };
  }

  const bodyHtml = body.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1e293b;background:#f8fafc;">
<div style="max-width:600px;margin:0 auto;padding:32px 16px;">
  <div style="background:#fff;border-radius:16px;border:1px solid #e2e8f0;padding:32px;">
    <div style="margin-bottom:24px;">
      <span style="font-size:20px;font-weight:700;"><span style="color:#0f172a;">Baby</span><span style="color:#8b5cf6;">Bloom</span></span>
    </div>
    <p style="font-size:15px;color:#475569;line-height:1.6;margin:0;">${bodyHtml}</p>
    ${emailFooter()}
  </div>
</div>
</body></html>`;

  const result = await sendEmail({
    to: toEmail,
    subject: subject.trim(),
    html,
    text: body,
    from: `Baby Bloom <${fromAddress}>`,
    replyTo: fromAddress,
    emailType: 'admin_contact',
    recipientUserId: toUserId,
  });

  if (!result.success) {
    return { success: false, error: result.error || 'Failed to send email' };
  }

  if (logActionType) {
    const { error: logErr } = await createAdminClient()
      .from('activity_logs')
      .insert({ user_id: toUserId, action_type: logActionType, action_details: { admin_id: adminId } });
    // The email has gone; a lost history row is reported, not swallowed.
    if (logErr) console.error('[adminSendEmail] could not write the activity row:', logErr.message);
  }

  return { success: true, error: null };
}
