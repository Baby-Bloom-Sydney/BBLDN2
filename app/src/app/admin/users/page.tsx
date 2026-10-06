import { Suspense } from "react";
import { createAdminClient } from "@/lib/supabase/admin";
import { AdminUsersClient } from "./AdminUsersClient";

export const dynamic = "force-dynamic";

// ── Interfaces ──

export interface UserData {
  user_id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  suburb: string | null;
  postcode: string | null;
  profile_picture_url: string | null;
  mobile_number: string | null;
  date_of_birth: string | null;
  created_at: string;
  role: string;
  nanny_status: string | null;
  // New integer-based verification fields
  verification_level: number | null;
  verification_status: number | null;
  // Legacy booleans (still on nannies table)
  wwcc_verified: boolean | null;
  identity_verified: boolean | null;
  parent_status: string | null;
  // Babysitter eligibility (derived from visible_in_bsr)
  babysitter_eligible: boolean | null;
  // Nanny table ID (for profile links)
  nanny_id: string | null;
}

export interface PendingIdentityCheck {
  id: string;
  user_id: string;
  surname: string | null;
  given_names: string | null;
  date_of_birth: string | null;
  passport_country: string | null;
  passport_upload_url: string | null;
  identification_photo_url: string | null;
  identity_verified: boolean;
  identity_rejection_reason: string | null;
  verification_status: number;
  created_at: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  profile_picture_url: string | null;
  // AI extraction fields
  extracted_surname: string | null;
  extracted_given_names: string | null;
  extracted_dob: string | null;
  extracted_nationality: string | null;
  extracted_passport_number: string | null;
  extracted_passport_expiry: string | null;
  identity_ai_reasoning: string | null;
  identity_ai_issues: string | null;
}

export interface PendingWWCCCheck {
  id: string;
  user_id: string;
  surname: string | null;
  given_names: string | null;
  date_of_birth: string | null;
  wwcc_number: string | null;
  wwcc_verification_method: string | null;
  wwcc_verified: boolean;
  wwcc_rejection_reason: string | null;
  verification_status: number;
  created_at: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  profile_picture_url: string | null;
  wwcc_ocg_submitted_at: string | null;
}

export interface VerificationStats {
  pending: number;
  approvedToday: number;
  rejectedToday: number;
  totalVerified: number;
}

export interface UserStats {
  total: number;
  nannies: number;
  parents: number;
  admins: number;
}

// ── Data Fetching ──

async function getUsers(): Promise<UserData[]> {
  const supabase = createAdminClient();

  const [profilesResult, rolesResult, nanniesResult, parentsResult, verificationsResult] = await Promise.all([
    supabase
      .from('user_profiles')
      .select('user_id, first_name, last_name, email, suburb, postcode, profile_picture_url, mobile_number, date_of_birth, created_at')
      .order('created_at', { ascending: false })
      .limit(100),
    supabase
      .from('user_roles')
      .select('user_id, role'),
    supabase
      .from('nannies')
      .select('id, user_id, status, verification_level, wwcc_verified, identity_verified, visible_in_bsr'),
    supabase
      .from('parents')
      .select('user_id, status'),
    supabase
      .from('verifications')
      .select('user_id, verification_status'),
  ]);

  if (profilesResult.error) {
    console.error('[getUsers] profiles error:', profilesResult.error);
    return [];
  }
  if (nanniesResult.error) console.error('[getUsers] nannies error:', nanniesResult.error);
  if (verificationsResult.error) console.error('[getUsers] verifications error:', verificationsResult.error);

  // Build lookup maps
  const roleMap = new Map<string, string>();
  if (rolesResult.data) {
    for (const r of rolesResult.data) roleMap.set(r.user_id, r.role);
  }

  const nannyMap = new Map<string, { id: string; status: string; verification_level: number; wwcc_verified: boolean; identity_verified: boolean; visible_in_bsr: boolean }>();
  if (nanniesResult.data) {
    for (const n of nanniesResult.data) nannyMap.set(n.user_id, n);
  }

  const parentMap = new Map<string, { status: string }>();
  if (parentsResult.data) {
    for (const p of parentsResult.data) parentMap.set(p.user_id, p);
  }

  const verificationMap = new Map<string, number>();
  if (verificationsResult.data) {
    for (const v of verificationsResult.data) verificationMap.set(v.user_id, v.verification_status);
  }

  return profilesResult.data.map((user) => {
    const nanny = nannyMap.get(user.user_id) ?? null;
    const parent = parentMap.get(user.user_id) ?? null;

    return {
      user_id: user.user_id,
      first_name: user.first_name,
      last_name: user.last_name,
      email: user.email,
      suburb: user.suburb,
      postcode: user.postcode,
      profile_picture_url: user.profile_picture_url,
      mobile_number: user.mobile_number,
      date_of_birth: user.date_of_birth,
      created_at: user.created_at,
      role: roleMap.get(user.user_id) ?? 'unknown',
      nanny_status: nanny?.status ?? null,
      verification_level: nanny?.verification_level ?? null,
      verification_status: verificationMap.get(user.user_id) ?? null,
      wwcc_verified: nanny?.wwcc_verified ?? null,
      identity_verified: nanny?.identity_verified ?? null,
      parent_status: parent?.status ?? null,
      babysitter_eligible: nanny?.visible_in_bsr ?? null,
      nanny_id: nanny?.id ?? null,
    };
  });
}

async function getUserStats(): Promise<UserStats> {
  const supabase = createAdminClient();

  const [totalResult, nanniesResult, parentsResult, adminsResult] = await Promise.all([
    supabase.from('user_roles').select('*', { count: 'exact', head: true }),
    supabase.from('user_roles').select('*', { count: 'exact', head: true }).eq('role', 'nanny'),
    supabase.from('user_roles').select('*', { count: 'exact', head: true }).eq('role', 'parent'),
    supabase.from('user_roles').select('*', { count: 'exact', head: true }).in('role', ['admin', 'super_admin']),
  ]);

  return {
    total: totalResult.count ?? 0,
    nannies: nanniesResult.count ?? 0,
    parents: parentsResult.count ?? 0,
    admins: adminsResult.count ?? 0,
  };
}

async function getVerificationStats(): Promise<VerificationStats> {
  const supabase = createAdminClient();
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Pending = all statuses between 10-29 (anything actively in review or awaiting action)
  // Approved = status 30 or 40 (provisionally or fully verified)
  // Rejected = status 12 or 22 (ID or WWCC rejected)
  // Total verified = status 40 (fully verified)
  const [pendingResult, approvedTodayResult, rejectedTodayResult, totalVerifiedResult] = await Promise.all([
    supabase.from('verifications').select('*', { count: 'exact', head: true }).in('verification_status', [10, 11, 20, 21, 24, 25, 26, 27, 28, 29]),
    supabase.from('verifications').select('*', { count: 'exact', head: true }).in('verification_status', [30, 40]).gte('updated_at', today.toISOString()),
    supabase.from('verifications').select('*', { count: 'exact', head: true }).in('verification_status', [12, 22, 23, 24]).gte('updated_at', today.toISOString()),
    supabase.from('verifications').select('*', { count: 'exact', head: true }).eq('verification_status', 40),
  ]);

  return {
    pending: pendingResult.count ?? 0,
    approvedToday: approvedTodayResult.count ?? 0,
    rejectedToday: rejectedTodayResult.count ?? 0,
    totalVerified: totalVerifiedResult.count ?? 0,
  };
}

async function getPendingIdentityChecks(): Promise<PendingIdentityCheck[]> {
  const supabase = createAdminClient();

  // ID review queue: status 10 (pending auto) or 11 (pending review)
  const [verificationsResult, profilesResult] = await Promise.all([
    supabase
      .from('verifications')
      .select('id, user_id, surname, given_names, date_of_birth, passport_country, passport_upload_url, identification_photo_url, identity_verified, identity_rejection_reason, verification_status, created_at, extracted_surname, extracted_given_names, extracted_dob, extracted_nationality, extracted_passport_number, extracted_passport_expiry, identity_ai_reasoning, identity_ai_issues')
      .in('verification_status', [10, 11])
      .order('created_at', { ascending: true })
      .limit(50),
    supabase
      .from('user_profiles')
      .select('user_id, first_name, last_name, email, profile_picture_url'),
  ]);

  if (verificationsResult.error || !verificationsResult.data) return [];

  const profileMap = new Map<string, { first_name: string | null; last_name: string | null; email: string | null; profile_picture_url: string | null }>();
  if (profilesResult.data) {
    for (const p of profilesResult.data) profileMap.set(p.user_id, p);
  }

  // Generate signed URLs for private storage documents
  const results: PendingIdentityCheck[] = [];
  for (const v of verificationsResult.data) {
    let passportSignedUrl: string | null = null;
    let selfieSignedUrl: string | null = null;

    if (v.passport_upload_url) {
      const { data } = await supabase.storage.from('verification-documents').createSignedUrl(v.passport_upload_url, 3600);
      passportSignedUrl = data?.signedUrl ?? null;
    }
    if (v.identification_photo_url) {
      const { data } = await supabase.storage.from('verification-documents').createSignedUrl(v.identification_photo_url, 3600);
      selfieSignedUrl = data?.signedUrl ?? null;
    }

    const profile = profileMap.get(v.user_id);
    results.push({
      id: v.id,
      user_id: v.user_id,
      surname: v.surname,
      given_names: v.given_names,
      date_of_birth: v.date_of_birth,
      passport_country: v.passport_country,
      passport_upload_url: passportSignedUrl,
      identification_photo_url: selfieSignedUrl,
      identity_verified: v.identity_verified,
      identity_rejection_reason: v.identity_rejection_reason,
      verification_status: v.verification_status,
      created_at: v.created_at,
      first_name: profile?.first_name ?? null,
      last_name: profile?.last_name ?? null,
      email: profile?.email ?? null,
      profile_picture_url: profile?.profile_picture_url ?? null,
      extracted_surname: v.extracted_surname,
      extracted_given_names: v.extracted_given_names,
      extracted_dob: v.extracted_dob,
      extracted_nationality: v.extracted_nationality,
      extracted_passport_number: v.extracted_passport_number,
      extracted_passport_expiry: v.extracted_passport_expiry,
      identity_ai_reasoning: v.identity_ai_reasoning,
      identity_ai_issues: v.identity_ai_issues,
    });
  }

  return results;
}

async function getPendingWWCCChecks(): Promise<PendingWWCCCheck[]> {
  const supabase = createAdminClient();

  // WWCC OCG submission queue: only statuses where admin needs to submit to OCG portal
  // 21 = manual entry awaiting admin OCG submission
  // 30 = provisionally verified (doc verified + cross-check) awaiting admin OCG submission
  // NOT included: 24 (doc failed — user retries), 25 (AI processing — transient),
  // 29 (submitted pre-AI — automated), 26/27/28 (post-OCG results — emails already sent)
  const [verificationsResult, profilesResult] = await Promise.all([
    supabase
      .from('verifications')
      .select('id, user_id, surname, given_names, date_of_birth, wwcc_number, wwcc_verification_method, wwcc_verified, wwcc_rejection_reason, verification_status, created_at, wwcc_ocg_submitted_at')
      .in('verification_status', [21, 30])
      .not('wwcc_verification_method', 'is', null)
      .order('created_at', { ascending: true })
      .limit(50),
    supabase
      .from('user_profiles')
      .select('user_id, first_name, last_name, email, profile_picture_url'),
  ]);

  if (verificationsResult.error || !verificationsResult.data) return [];

  const profileMap = new Map<string, { first_name: string | null; last_name: string | null; email: string | null; profile_picture_url: string | null }>();
  if (profilesResult.data) {
    for (const p of profilesResult.data) profileMap.set(p.user_id, p);
  }

  return verificationsResult.data.map((v) => {
    const profile = profileMap.get(v.user_id);
    return {
      id: v.id,
      user_id: v.user_id,
      surname: v.surname,
      given_names: v.given_names,
      date_of_birth: v.date_of_birth,
      wwcc_number: v.wwcc_number,
      wwcc_verification_method: v.wwcc_verification_method,
      wwcc_verified: v.wwcc_verified,
      wwcc_rejection_reason: v.wwcc_rejection_reason,
      verification_status: v.verification_status,
      created_at: v.created_at,
      first_name: profile?.first_name ?? null,
      last_name: profile?.last_name ?? null,
      email: profile?.email ?? null,
      profile_picture_url: profile?.profile_picture_url ?? null,
      wwcc_ocg_submitted_at: v.wwcc_ocg_submitted_at ?? null,
    };
  });
}

// ── Page Component ──

export default async function AdminUsersPage() {
  const [users, userStats, verificationStats, identityChecks, wwccChecks] = await Promise.all([
    getUsers(),
    getUserStats(),
    getVerificationStats(),
    getPendingIdentityChecks(),
    getPendingWWCCChecks(),
  ]);

  return (
    <Suspense fallback={<div className="p-8 text-center text-muted-foreground">Loading...</div>}>
      <AdminUsersClient
        users={users}
        userStats={userStats}
        verificationStats={verificationStats}
        identityChecks={identityChecks}
        wwccChecks={wwccChecks}
      />
    </Suspense>
  );
}
