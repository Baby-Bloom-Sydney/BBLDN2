'use server';

import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { revalidatePath } from 'next/cache';
import {
  PARENT_IDENTITY_STATUS,
  CONTACT_STATUS,
  CROSS_CHECK_STATUS,
  PARENT_VERIFICATION_STATUS,
} from '@/lib/verification';
import { sendEmail } from '@/lib/email/resend';
import { getUserEmailInfo } from '@/lib/email/helpers';
import { createInboxMessage } from '@/lib/actions/connection-helpers';
import { ParentVerificationData } from '@/types/parent';
import { capitalizeName } from '@/lib/utils';
import { emailHeader } from "@/lib/email/brand";
import { SITE_NAME, SITE_URL } from "@/lib/constants";

// ── Shared auth helper ──

async function getAuthUser() {
  const supabase = createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return null;
  return user;
}

// ── Submit Identity Section ──

interface SubmitParentIdentityData {
  document_type: string; // 'passport' | 'drivers_license'
  issuing_country: string;
  surname: string;
  given_names: string;
  date_of_birth: string;
  document_upload_url: string;
  identification_photo_url: string;
}

export async function submitParentIdentitySection(
  data: SubmitParentIdentityData
): Promise<{ success: boolean; error: string | null; verificationId?: string }> {
  console.log('[submitParentIdentitySection] Starting...');
  const user = await getAuthUser();
  if (!user) {
    console.error('[submitParentIdentitySection] Not authenticated');
    return { success: false, error: 'Not authenticated' };
  }
  console.log('[submitParentIdentitySection] Auth OK, user:', user.id);

  if (!data.document_type || !data.issuing_country || !data.surname?.trim() || !data.given_names?.trim() || !data.date_of_birth) {
    return { success: false, error: 'Missing required identity fields' };
  }
  if (!data.document_upload_url || !data.identification_photo_url) {
    return { success: false, error: 'Missing document uploads' };
  }

  const admin = createAdminClient();

  // Check for existing record
  const { data: existing, error: existingErr } = await admin
    .from('parent_verifications')
    .select('id')
    .eq('user_id', user.id)
    .single();
  console.log('[submitParentIdentitySection] Existing check:', existing ? 'found' : 'not found', existingErr?.code);

  const identityFields = {
    user_id: user.id,
    document_type: data.document_type,
    issuing_country: data.issuing_country,
    surname: capitalizeName(data.surname),
    given_names: capitalizeName(data.given_names),
    date_of_birth: data.date_of_birth,
    document_upload_url: data.document_upload_url,
    identification_photo_url: data.identification_photo_url,
    // Status
    identity_status: PARENT_IDENTITY_STATUS.PENDING,
    identity_status_at: new Date().toISOString(),
    identity_verified: false,
    // Clear old AI data
    extracted_surname: null,
    extracted_given_names: null,
    extracted_dob: null,
    extracted_nationality: null,
    extracted_passport_number: null,
    extracted_passport_expiry: null,
    extracted_license_number: null,
    extracted_license_expiry: null,
    extracted_license_state: null,
    extracted_license_class: null,
    identity_ai_reasoning: null,
    identity_ai_issues: null,
    identity_rejection_reason: null,
    identity_user_guidance: null,
    selfie_confidence: null,
    // Reset cross-check (must re-run after identity resubmission)
    cross_check_status: CROSS_CHECK_STATUS.NOT_STARTED,
    cross_check_reasoning: null,
    cross_check_at: null,
    updated_at: new Date().toISOString(),
  };

  let verificationId: string;

  if (existing) {
    console.log('[submitParentIdentitySection] Updating existing record:', existing.id);
    const { error: updateErr } = await admin
      .from('parent_verifications')
      .update(identityFields)
      .eq('id', existing.id);

    if (updateErr) {
      console.error('[submitParentIdentitySection] Update failed:', updateErr);
      return { success: false, error: `Failed to save identity data: ${updateErr.message}` };
    }
    verificationId = existing.id;
  } else {
    console.log('[submitParentIdentitySection] Inserting new record');
    const insertPayload = {
      ...identityFields,
      // Defaults for new record
      contact_status: CONTACT_STATUS.NOT_STARTED,
      verification_status: PARENT_VERIFICATION_STATUS.PENDING_ID_AUTO,
    };
    console.log('[submitParentIdentitySection] Insert payload keys:', Object.keys(insertPayload).join(', '));

    const { data: inserted, error: insertErr } = await admin
      .from('parent_verifications')
      .insert(insertPayload)
      .select('id')
      .single();

    if (insertErr || !inserted) {
      console.error('[submitParentIdentitySection] Insert failed:', insertErr);
      return { success: false, error: `Failed to create verification record: ${insertErr?.message ?? 'unknown'}` };
    }
    verificationId = inserted.id;
    console.log('[submitParentIdentitySection] Inserted:', verificationId);
  }

  // Fire-and-forget: AI pipeline triggered by client via API route
  // (Same pattern as nanny verification)

  console.log('[submitParentIdentitySection] Done, verificationId:', verificationId);
  revalidatePath('/parent/verification');
  return { success: true, error: null, verificationId };
}

// ── Submit Identity for Manual Review ──

export async function submitParentIdentityForManualReview(): Promise<{ success: boolean; error: string | null }> {
  const user = await getAuthUser();
  if (!user) return { success: false, error: 'Not authenticated' };

  const admin = createAdminClient();

  const { data: existing } = await admin
    .from('parent_verifications')
    .select('id')
    .eq('user_id', user.id)
    .single();

  if (!existing) {
    return { success: false, error: 'No verification record found' };
  }

  // Set identity to review + reset cross-check
  const { error: updateErr } = await admin
    .from('parent_verifications')
    .update({
      identity_status: PARENT_IDENTITY_STATUS.REVIEW,
      identity_status_at: new Date().toISOString(),
      identity_user_guidance: null,
      verification_status: PARENT_VERIFICATION_STATUS.PENDING_ID_REVIEW,
      // Reset cross-check
      cross_check_status: CROSS_CHECK_STATUS.NOT_STARTED,
      cross_check_reasoning: null,
      cross_check_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', existing.id);

  if (updateErr) {
    console.error('[submitParentIdentityForManualReview] Update failed:', updateErr);
    return { success: false, error: 'Failed to submit for manual review' };
  }

  // PVER-001: Email - Documents submitted for manual review
  const userInfo = await getUserEmailInfo(user.id);
  if (userInfo) {
    const appUrl = SITE_URL;
    sendEmail({
      to: userInfo.email,
      subject: "We're reviewing your identity documents",
      html: `<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px;">
        ${emailHeader()}
        <p style="color: #374151; font-size: 16px; line-height: 1.6; margin-bottom: 16px;">
          Hi ${userInfo.firstName},
        </p>
        <p style="color: #374151; font-size: 16px; line-height: 1.6; margin-bottom: 16px;">
          We've received your identity documents and our team will review them within 1-3 business days.
        </p>
        <p style="color: #374151; font-size: 16px; line-height: 1.6; margin-bottom: 24px;">
          You'll receive an email once your verification is complete.
        </p>
        <p style="margin-top: 24px;"><a href="${appUrl}/parent/verification" style="background: #8B5CF6; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 600; display: inline-block;">View Status</a></p>
        <p style="color: #6B7280; font-size: 14px; margin-top: 32px;">
          — ${SITE_NAME} Team
        </p>
      </div>`,
      emailType: 'parent_verification_review',
      recipientUserId: user.id,
    }).catch(err => console.error('[ParentManualReview] PVER-001 email error:', err));
  }

  // PVINB-001: Inbox message - Documents under review
  createInboxMessage({
    userId: user.id,
    type: 'parent_verification',
    title: 'Your documents are being reviewed',
    body: "We've received your identity documents and our team will review them within 1-3 business days. We'll notify you once your verification is complete.",
    actionUrl: '/parent/verification',
  }).catch(err => console.error('[ParentManualReview] PVINB-001 inbox error:', err));

  revalidatePath('/parent/verification');
  return { success: true, error: null };
}

// ── Submit Contact Section ──

interface SubmitParentContactData {
  phone_number: string;
  address_line: string;
  city: string;
  state?: string;
  postcode: string;
  country: string;
}

export async function submitParentContactSection(
  data: SubmitParentContactData
): Promise<{ success: boolean; error: string | null }> {
  const user = await getAuthUser();
  if (!user) return { success: false, error: 'Not authenticated' };

  if (!data.phone_number?.trim() || !data.address_line?.trim() || !data.city?.trim() || !data.postcode?.trim() || !data.country?.trim()) {
    return { success: false, error: 'Missing required contact details' };
  }

  const admin = createAdminClient();

  const { data: existing } = await admin
    .from('parent_verifications')
    .select('id')
    .eq('user_id', user.id)
    .single();

  if (!existing) {
    return { success: false, error: 'No verification record found. Please complete Identity section first.' };
  }

  const { error: updateErr } = await admin
    .from('parent_verifications')
    .update({
      phone_number: data.phone_number.trim(),
      address_line: data.address_line.trim(),
      city: data.city.trim(),
      state: data.state?.trim() ?? null,
      postcode: data.postcode.trim(),
      country: data.country.trim(),
      contact_status: CONTACT_STATUS.SAVED,
      updated_at: new Date().toISOString(),
    })
    .eq('id', existing.id);

  if (updateErr) {
    console.error('[submitParentContactSection] Update failed:', updateErr);
    return { success: false, error: 'Failed to save contact details' };
  }

  revalidatePath('/parent/verification');
  return { success: true, error: null };
}

// ── Get Full Verification Data (for page load pre-population) ──

export async function getParentVerificationData(): Promise<{
  data: ParentVerificationData | null;
  error: string | null;
}> {
  const user = await getAuthUser();
  if (!user) return { data: null, error: 'Not authenticated' };

  const supabase = createClient();
  const { data, error } = await supabase
    .from('parent_verifications')
    .select(`
      id,
      document_type, issuing_country,
      identity_status, contact_status, cross_check_status,
      verification_status,
      surname, given_names, date_of_birth,
      document_upload_url, identification_photo_url,
      identity_verified, identity_rejection_reason, identity_user_guidance,
      selfie_confidence,
      extracted_surname, extracted_given_names, extracted_dob,
      extracted_nationality, extracted_passport_number, extracted_passport_expiry,
      extracted_license_number, extracted_license_expiry, extracted_license_state, extracted_license_class,
      phone_number, address_line, city, state, postcode, country,
      cross_check_reasoning,
      created_at, updated_at
    `)
    .eq('user_id', user.id)
    .single();

  if (error && error.code !== 'PGRST116') {
    console.error('[getParentVerificationData] Error:', error);
    return { data: null, error: 'Failed to fetch verification data' };
  }

  return { data: (data as ParentVerificationData) ?? null, error: null };
}
