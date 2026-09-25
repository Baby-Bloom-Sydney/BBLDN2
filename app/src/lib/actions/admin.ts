'use server';

import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { revalidatePath } from 'next/cache';
import {
  VERIFICATION_STATUS,
  VERIFICATION_LEVEL,
  IDENTITY_STATUS,
  WWCC_STATUS,
  CROSS_CHECK_STATUS,
  PARENT_IDENTITY_STATUS,
  PARENT_VERIFICATION_STATUS,
  PARENT_VERIFICATION_LEVEL,
  deriveOverallStatus,
  type IdentityStatus,
  type WwccStatus,
  type CrossCheckStatus,
} from '@/lib/verification';
import { runCrossCheckPhase, runWWCCDocPhase } from '@/lib/ai/verification-pipeline';
import { syncNannyVerificationState } from '@/lib/actions/verification';
import { sendEmail } from '@/lib/email/resend';
import { getUserEmailInfo } from '@/lib/email/helpers';
import { createInboxMessage } from '@/lib/actions/connection-helpers';
import { openai } from '@/lib/ai/client';
import { V2_SYSTEM_PROMPT, buildV2Prompt, parseAIProfileSections, generateV2Checklist } from '@/lib/ai/nanny-profile-prompts';
import { emailHeader, emailFooter } from "@/lib/email/brand";
import { SITE_URL } from "@/lib/constants";

// ── Helper: require admin role ──

async function requireAdmin(): Promise<{ userId: string; error: string | null }> {
  const supabase = createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return { userId: '', error: 'Not authenticated' };

  const { data: role } = await supabase
    .from('user_roles')
    .select('role')
    .eq('user_id', user.id)
    .single();

  if (!role || !['admin', 'super_admin'].includes(role.role)) {
    return { userId: '', error: 'Not authorized — admin role required' };
  }
  return { userId: user.id, error: null };
}

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

// ── Admin: Confirm WWCC (tracking-only — records that admin submitted to OCG portal) ──
// Does NOT change verification state. OCG webhook handles actual status changes.

export async function adminConfirmWWCC(
  verificationId: string
): Promise<{ success: boolean; error: string | null }> {
  const { userId: adminId, error: authErr } = await requireAdmin();
  if (authErr) return { success: false, error: authErr };

  const supabase = createAdminClient();

  const { error: updateErr } = await supabase
    .from('verifications')
    .update({
      wwcc_ocg_submitted_at: new Date().toISOString(),
      wwcc_verified_by: adminId,
      updated_at: new Date().toISOString(),
    })
    .eq('id', verificationId);

  if (updateErr) {
    return { success: false, error: `Failed to update verification: ${updateErr.message}` };
  }

  revalidatePath('/admin/users');
  return { success: true, error: null };
}

// ── Admin: Reject WWCC ──
// State transition: wwcc_status → rejected, level → 2

export async function adminRejectWWCC(
  verificationId: string,
  reason: string
): Promise<{ success: boolean; error: string | null }> {
  const { error: authErr } = await requireAdmin();
  if (authErr) return { success: false, error: authErr };

  if (!reason.trim()) {
    return { success: false, error: 'Rejection reason is required' };
  }

  const supabase = createAdminClient();

  const { data: verification, error: fetchErr } = await supabase
    .from('verifications')
    .select('user_id')
    .eq('id', verificationId)
    .single();

  if (fetchErr || !verification) {
    return { success: false, error: 'Verification record not found' };
  }

  const { error: updateVerErr } = await supabase
    .from('verifications')
    .update({
      wwcc_rejection_reason: reason.trim(),
      wwcc_status: WWCC_STATUS.REJECTED,
      wwcc_status_at: new Date().toISOString(),
      verification_status: VERIFICATION_STATUS.WWCC_REJECTED,
      // Reset cross-check (WWCC rejection invalidates it)
      cross_check_status: CROSS_CHECK_STATUS.NOT_STARTED,
      cross_check_reasoning: null,
      // Ensure wwcc_verified is false in verifications (not just nannies)
      wwcc_verified: false,
      wwcc_doc_verified: false,
      updated_at: new Date().toISOString(),
    })
    .eq('id', verificationId);

  if (updateVerErr) {
    return { success: false, error: `Failed to reject: ${updateVerErr.message}` };
  }

  await syncNannyVerificationState(verification.user_id);

  revalidatePath('/admin/users');
  return { success: true, error: null };
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

// ── Admin: Verify Parent Identity ──
// State transition: identity_status → verified, parents.verification_level → 1

export async function adminVerifyParentIdentity(
  verificationId: string
): Promise<{ success: boolean; error: string | null }> {
  const { userId: adminId, error: authErr } = await requireAdmin();
  if (authErr) return { success: false, error: authErr };

  const adminClient = createAdminClient();

  const { data: verification, error: fetchErr } = await adminClient
    .from('parent_verifications')
    .select('user_id')
    .eq('id', verificationId)
    .single();

  if (fetchErr || !verification) {
    return { success: false, error: 'Parent verification record not found' };
  }

  const { error: updateVerErr } = await adminClient
    .from('parent_verifications')
    .update({
      identity_verified: true,
      identity_verified_at: new Date().toISOString(),
      identity_verified_by: adminId,
      identity_status: PARENT_IDENTITY_STATUS.VERIFIED,
      identity_status_at: new Date().toISOString(),
      identity_rejection_reason: null,
      identity_user_guidance: null,
      verification_status: PARENT_VERIFICATION_STATUS.VERIFIED,
      cross_check_status: 'passed',
      cross_check_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', verificationId);

  if (updateVerErr) {
    return { success: false, error: `Failed to update verification: ${updateVerErr.message}` };
  }

  const { error: updateParentErr } = await adminClient
    .from('parents')
    .update({
      verification_level: PARENT_VERIFICATION_LEVEL.VERIFIED,
      updated_at: new Date().toISOString(),
    })
    .eq('user_id', verification.user_id);

  if (updateParentErr) {
    return { success: false, error: `Failed to update parent: ${updateParentErr.message}` };
  }

  // PVER-004 email + PVINB-004 inbox
  const userInfo = await getUserEmailInfo(verification.user_id);
  if (userInfo) {
    const appUrl = SITE_URL;
    sendEmail({
      to: userInfo.email,
      subject: "You're verified on Baby Bloom!",
      html: `<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px;">
        ${emailHeader()}
        <p style="color: #374151; font-size: 16px; line-height: 1.6;">Great news, ${userInfo.firstName}! Your identity has been verified.</p>
        <p style="color: #374151; font-size: 16px; line-height: 1.6;">You can now connect with verified nannies and post babysitting requests on Baby Bloom.</p>
        <p style="margin-top: 24px;"><a href="${appUrl}/parent/browse" style="background: #8B5CF6; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 600;">Browse Nannies</a></p>
      </div>`,
      emailType: 'parent_verification_approved',
      recipientUserId: verification.user_id,
    }).catch(err => console.error('[adminVerifyParentIdentity] Email error:', err));
  }

  createInboxMessage({
    userId: verification.user_id,
    type: 'parent_verification',
    title: "You're verified!",
    body: 'Your identity has been verified. You can now connect with nannies and post babysitting requests.',
    actionUrl: '/parent/browse',
  }).catch(err => console.error('[adminVerifyParentIdentity] Inbox error:', err));

  revalidatePath('/admin/users');
  return { success: true, error: null };
}

// ── Admin: Reject Parent Identity ──
// State transition: identity_status → rejected, verification_status → 13

export async function adminRejectParentIdentity(
  verificationId: string,
  reason: string
): Promise<{ success: boolean; error: string | null }> {
  const { error: authErr } = await requireAdmin();
  if (authErr) return { success: false, error: authErr };

  if (!reason.trim()) {
    return { success: false, error: 'Rejection reason is required' };
  }

  const adminClient = createAdminClient();

  const { data: verification, error: fetchErr } = await adminClient
    .from('parent_verifications')
    .select('user_id')
    .eq('id', verificationId)
    .single();

  if (fetchErr || !verification) {
    return { success: false, error: 'Parent verification record not found' };
  }

  const { error: updateErr } = await adminClient
    .from('parent_verifications')
    .update({
      identity_rejection_reason: reason.trim(),
      identity_status: PARENT_IDENTITY_STATUS.REJECTED,
      identity_status_at: new Date().toISOString(),
      verification_status: PARENT_VERIFICATION_STATUS.ID_REJECTED_ADMIN,
      updated_at: new Date().toISOString(),
    })
    .eq('id', verificationId);

  if (updateErr) {
    return { success: false, error: `Failed to reject: ${updateErr.message}` };
  }

  // PVER-003 email (delayed 20 min) + PVINB-003 inbox
  setTimeout(async () => {
    const userInfo = await getUserEmailInfo(verification.user_id);
    if (userInfo) {
      const appUrl = SITE_URL;
      sendEmail({
        to: userInfo.email,
        subject: 'Your ID verification needs resubmission',
        html: `<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px;">
          ${emailHeader()}
          <p style="color: #374151; font-size: 16px; line-height: 1.6;">Hi ${userInfo.firstName},</p>
          <p style="color: #374151; font-size: 16px; line-height: 1.6;">Unfortunately, we were unable to verify your identity documents. ${reason.trim()}</p>
          <p style="color: #374151; font-size: 16px; line-height: 1.6;">Please resubmit your documents to complete verification.</p>
          <p style="margin-top: 24px;"><a href="${appUrl}/parent/verification" style="background: #8B5CF6; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 600;">Resubmit Documents</a></p>
        </div>`,
        emailType: 'parent_verification_rejected',
        recipientUserId: verification.user_id,
      }).catch(err => console.error('[adminRejectParentIdentity] Email error:', err));
    }
  }, 20 * 60 * 1000);

  createInboxMessage({
    userId: verification.user_id,
    type: 'parent_verification',
    title: 'Please resubmit your ID',
    body: `Your identity verification was not approved. Reason: ${reason.trim()}. Please resubmit your documents.`,
    actionUrl: '/parent/verification',
  }).catch(err => console.error('[adminRejectParentIdentity] Inbox error:', err));

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

const ALLOWED_FROM_ADDRESSES = [
  'no-reply@babybloomsydney.com.au',
  'verification@babybloomsydney.com.au',
  'nannies@babybloomsydney.com.au',
  'support@babybloomsydney.com.au',
  'contact@babybloomsydney.com.au',
  'parents@babybloomsydney.com.au',
];

export async function adminSendEmail(params: {
  toEmail: string;
  toUserId: string;
  fromAddress: string;
  subject: string;
  body: string;
}): Promise<{ success: boolean; error: string | null }> {
  const { error: authErr } = await requireAdmin();
  if (authErr) return { success: false, error: authErr };

  const { toEmail, toUserId, fromAddress, subject, body } = params;

  if (!toEmail || !subject.trim() || !body.trim()) {
    return { success: false, error: 'Email, subject, and body are required' };
  }

  if (!ALLOWED_FROM_ADDRESSES.includes(fromAddress)) {
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

  return { success: true, error: null };
}
