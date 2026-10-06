"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { revalidatePath } from "next/cache";
import { openai } from "@/lib/ai/client";
import { isUkMobile, normaliseUkMobile } from "@/lib/uk-contact";

// ── Public nanny profile fetch (for /nannies/[id] page) ──

export interface PublicNannyProfile {
  // Identity
  nanny_id: string;
  user_id: string;
  first_name: string;
  last_name: string;
  suburb: string;
  postcode: string;
  profile_picture_url: string | null;
  date_of_birth: string | null;
  nationality: string | null;

  // Experience
  total_experience_years: number | null;
  nanny_experience_years: number | null;
  under_3_experience_years: number | null;
  newborn_experience_years: number | null;
  experience_details: string | null;

  // Preferences
  role_types_preferred: string[] | null;
  level_of_support_offered: string[] | null;
  max_children: number | null;
  min_child_age_months: number | null;
  max_child_age_months: number | null;
  additional_needs_ok: boolean;

  // Rate
  hourly_rate_min: number | null;
  pay_frequency: string[] | null;

  // Attributes
  drivers_license: boolean | null;
  has_car: boolean | null;
  comfortable_with_pets: boolean | null;
  vaccination_status: boolean | null;
  non_smoker: boolean | null;
  languages: string[] | null;

  // Personal
  hobbies_interests: string | null;
  strengths_traits: string | null;
  skills_training: string | null;

  // Status
  verification_tier: string;
  verification_level: number;

  // AI content (raw JSONB)
  ai_content: Record<string, unknown> | null;

  // Availability
  availability: {
    days_available: string[] | null;
    schedule: Record<string, string[]> | null;
  } | null;

  // V2 profile fields
  highest_qualification: string | null;
  certificates: string[];
  motivation: string | null;
  personality_traits: string[] | null;
  professional_values: string[] | null;
  childcare_roles: { role: string; duration: number }[] | null;
  additional_photos: string[];
  immediate_start: boolean;
}

export async function getPublicNannyProfile(
  nannyId: string,
): Promise<{ data: PublicNannyProfile | null; error: string | null }> {
  const supabase = createAdminClient();

  // Fetch nanny record (visible = active or pending_verification)
  const { data: nanny, error: nannyError } = await supabase
    .from("nannies")
    .select("*")
    .eq("id", nannyId)
    .eq("profile_visible", true)
    .single();

  if (nannyError || !nanny) {
    return { data: null, error: "Nanny not found" };
  }

  // Fetch user profile
  const { data: profile } = await supabase
    .from("user_profiles")
    .select(
      "first_name, last_name, suburb, postcode, profile_picture_url, date_of_birth",
    )
    .eq("user_id", nanny.user_id)
    .single();

  if (!profile) {
    return { data: null, error: "Profile not found" };
  }

  // AI content — keep raw JSONB structure for V2 rendering
  const aiContent =
    nanny.ai_content && typeof nanny.ai_content === "object"
      ? (nanny.ai_content as Record<string, unknown>)
      : null;

  // Fetch availability, credentials, and images in parallel
  const [{ data: avail }, { data: credentials }, { data: images }] =
    await Promise.all([
      supabase
        .from("nanny_availability")
        .select("days_available, schedule")
        .eq("nanny_id", nannyId)
        .single(),
      supabase
        .from("nanny_credentials")
        .select("credential_category, qualification_type, certification_type")
        .eq("nanny_id", nannyId),
      supabase.from("nanny_images").select("image_url").eq("nanny_id", nannyId),
    ]);

  const highestQualification =
    (credentials || []).find(
      (c: { credential_category: string }) =>
        c.credential_category === "qualification",
    )?.qualification_type || null;
  const certificates = (credentials || [])
    .filter(
      (c: { credential_category: string }) =>
        c.credential_category === "certification",
    )
    .map((c: { certification_type: string }) => c.certification_type)
    .filter(Boolean) as string[];
  const additionalPhotos = [
    nanny.photo_1_url,
    nanny.photo_2_url,
    nanny.photo_3_url,
  ].filter(Boolean) as string[];

  return {
    data: {
      nanny_id: nannyId,
      user_id: nanny.user_id,
      first_name: profile.first_name,
      last_name: profile.last_name,
      suburb: profile.suburb,
      postcode: profile.postcode,
      profile_picture_url: profile.profile_picture_url,
      date_of_birth: profile.date_of_birth,
      nationality: nanny.nationality,
      total_experience_years: nanny.total_experience_years,
      nanny_experience_years: nanny.nanny_experience_years,
      under_3_experience_years: nanny.under_3_experience_years,
      newborn_experience_years: nanny.newborn_experience_years,
      experience_details: nanny.experience_details,
      role_types_preferred: nanny.role_types_preferred,
      level_of_support_offered: nanny.level_of_support_offered,
      max_children: nanny.max_children,
      min_child_age_months: nanny.min_child_age_months,
      max_child_age_months: nanny.max_child_age_months,
      additional_needs_ok: nanny.additional_needs_ok ?? false,
      hourly_rate_min: nanny.hourly_rate_min,
      pay_frequency: nanny.pay_frequency,
      drivers_license: nanny.drivers_license,
      has_car: nanny.has_car,
      comfortable_with_pets: nanny.comfortable_with_pets,
      vaccination_status: nanny.vaccination_status,
      non_smoker: nanny.non_smoker,
      languages: nanny.languages,
      hobbies_interests: nanny.hobbies_interests,
      strengths_traits: nanny.strengths_traits,
      skills_training: nanny.skills_training,
      verification_tier: nanny.verification_tier,
      verification_level: nanny.verification_level ?? 0,
      ai_content: aiContent,
      availability: avail
        ? { days_available: avail.days_available, schedule: avail.schedule }
        : null,
      highest_qualification: highestQualification,
      certificates,
      motivation: nanny.motivation || null,
      personality_traits: nanny.personality_traits || null,
      professional_values: nanny.professional_values || null,
      childcare_roles: nanny.childcare_roles as
        | { role: string; duration: number }[]
        | null,
      additional_photos: additionalPhotos,
      immediate_start: nanny.immediate_start_available ?? false,
    },
    error: null,
  };
}

export interface NannyProfile {
  // From user_profiles
  first_name: string;
  last_name: string;
  email: string;
  mobile_number: string | null;
  date_of_birth: string | null;
  suburb: string;
  postcode: string;
  profile_picture_url: string | null;

  // From nannies
  gender: string | null;
  nationality: string | null;
  languages: string[] | null;

  total_experience_years: number | null;
  nanny_experience_years: number | null;
  under_3_experience_years: number | null;
  newborn_experience_years: number | null;
  experience_details: string | null;

  role_types_preferred: string[] | null;
  level_of_support_offered: string[] | null;

  hourly_rate_min: number | null;
  pay_frequency: string[] | null;
  immediate_start_available: boolean;
  placement_ongoing_preferred: boolean;
  start_date_earliest: string | null;
  end_date_latest: string | null;

  max_children: number | null;
  min_child_age_months: number | null;
  max_child_age_months: number | null;
  additional_needs_ok: boolean;

  sydney_resident: boolean | null;
  residency_status: string | null;
  right_to_work: boolean | null;
  drivers_license: boolean | null;
  has_car: boolean | null;
  comfortable_with_pets: boolean | null;
  vaccination_status: boolean | null;
  non_smoker: boolean | null;

  hobbies_interests: string | null;
  strengths_traits: string | null;
  skills_training: string | null;

  // V2 onboarding fields
  motivation: string | null;
  personality_traits: string[] | null;
  professional_values: string[] | null;
  childcare_roles: { role: string; duration: number }[] | null;
  photo_1_url: string | null;
  photo_2_url: string | null;
  photo_3_url: string | null;

  // Identity
  nanny_id: string;

  // Status fields (read-only)
  status: string;
  verification_tier: string;
  verification_level: number;
  wwcc_verified: boolean;
  identity_verified: boolean;

  // Related tables
  highest_qualification: string | null;
  certificates: string[];
  assurances: string[];
  availability: {
    days_available: string[] | null;
    schedule: Record<string, string[]> | null;
  } | null;
  ai_content: Record<string, unknown> | null;
}

export async function getNannyProfile(): Promise<{
  data: NannyProfile | null;
  error: string | null;
}> {
  const supabase = createClient();

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) {
    return { data: null, error: "Not authenticated" };
  }

  // Fetch user profile
  const { data: profile, error: profileError } = await supabase
    .from("user_profiles")
    .select(
      "first_name, last_name, email, mobile_number, date_of_birth, suburb, postcode, profile_picture_url",
    )
    .eq("user_id", user.id)
    .single();

  if (profileError) {
    console.error("Profile fetch error:", profileError);
    return { data: null, error: "Failed to fetch profile" };
  }

  // Fetch nanny record
  const { data: nanny, error: nannyError } = await supabase
    .from("nannies")
    .select("*")
    .eq("user_id", user.id)
    .single();

  if (nannyError) {
    console.error("Nanny fetch error:", nannyError);
    return { data: null, error: "Failed to fetch nanny data" };
  }

  // Fetch credentials
  const { data: credentials } = await supabase
    .from("nanny_credentials")
    .select("credential_category, qualification_type, certification_type")
    .eq("nanny_id", nanny.id);

  const highest_qualification =
    credentials?.find((c) => c.credential_category === "qualification")
      ?.qualification_type || null;
  const certificates = (credentials || [])
    .filter((c) => c.credential_category === "certification")
    .map((c) => c.certification_type)
    .filter((t): t is string => t !== null);

  // Fetch assurances
  const { data: assuranceRows } = await supabase
    .from("nanny_assurances")
    .select("assurance_type")
    .eq("nanny_id", nanny.id);

  const assurances = (assuranceRows || []).map((a) => a.assurance_type);

  // Fetch availability
  const { data: avail } = await supabase
    .from("nanny_availability")
    .select("days_available, schedule")
    .eq("nanny_id", nanny.id)
    .single();

  return {
    data: {
      ...profile,
      ...nanny,
      // user_profiles.profile_picture_url is the source of truth — restore after nanny spread
      profile_picture_url:
        profile.profile_picture_url || nanny.profile_picture_url || null,
      nanny_id: nanny.id,
      highest_qualification,
      certificates,
      assurances,
      availability: avail
        ? { days_available: avail.days_available, schedule: avail.schedule }
        : null,
      ai_content: nanny.ai_content || null,
    },
    error: null,
  };
}

export interface UpdateNannyProfileData {
  // user_profiles fields
  first_name?: string;
  last_name?: string;
  mobile_number?: string | null;
  date_of_birth?: string | null;
  suburb?: string;
  postcode?: string;
  profile_picture_url?: string | null;

  // nannies fields
  gender?: string | null;
  nationality?: string | null;
  languages?: string[] | null;

  total_experience_years?: number | null;
  nanny_experience_years?: number | null;
  under_3_experience_years?: number | null;
  newborn_experience_years?: number | null;
  experience_details?: string | null;

  role_types_preferred?: string[] | null;
  level_of_support_offered?: string[] | null;

  hourly_rate_min?: number | null;
  pay_frequency?: string[] | null;
  immediate_start_available?: boolean;
  placement_ongoing_preferred?: boolean;
  start_date_earliest?: string | null;
  end_date_latest?: string | null;

  max_children?: number | null;
  min_child_age_months?: number | null;
  max_child_age_months?: number | null;
  additional_needs_ok?: boolean;

  sydney_resident?: boolean | null;
  residency_status?: string | null;
  right_to_work?: boolean | null;
  drivers_license?: boolean | null;
  has_car?: boolean | null;
  comfortable_with_pets?: boolean | null;
  vaccination_status?: boolean | null;
  non_smoker?: boolean | null;

  hobbies_interests?: string | null;
  strengths_traits?: string | null;
  skills_training?: string | null;

  // V2 onboarding fields
  motivation?: string | null;
  personality_traits?: string[] | null;
  professional_values?: string[] | null;
  childcare_roles?: { role: string; duration: number }[] | null;
  photo_1_url?: string | null;
  photo_2_url?: string | null;
  photo_3_url?: string | null;

  // Related table fields
  highest_qualification?: string | null;
  certificates?: string[];
  assurances?: string[];
  available_days?: string[];
  schedule?: Record<string, string[]>;
}

export async function updateNannyProfile(
  data: UpdateNannyProfileData,
): Promise<{ success: boolean; error: string | null }> {
  const supabase = createClient();

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) {
    return { success: false, error: "Not authenticated" };
  }

  // Server-side profanity check on free-text fields
  const textFieldsToCheck: Record<string, string | undefined> = {};
  if (typeof data.motivation === "string")
    textFieldsToCheck["What drives me"] = data.motivation;
  const profanityHit = findProfanityInFields(textFieldsToCheck);
  if (profanityHit) {
    return {
      success: false,
      error: `Content contains inappropriate language. Please revise the "${profanityHit}" field.`,
    };
  }

  // Fields that go to user_profiles
  const profileFieldNames = [
    "first_name",
    "last_name",
    "mobile_number",
    "date_of_birth",
    "suburb",
    "postcode",
    "profile_picture_url",
  ];
  // Fields that go to related tables
  const relatedFieldNames = [
    "highest_qualification",
    "certificates",
    "assurances",
    "available_days",
    "schedule",
  ];

  const profileData: Record<string, unknown> = {};
  const nannyData: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(data)) {
    if (profileFieldNames.includes(key)) {
      profileData[key] = value;
    } else if (!relatedFieldNames.includes(key)) {
      nannyData[key] = value;
    }
  }

  // Update user_profiles if we have profile data
  if (Object.keys(profileData).length > 0) {
    const { error: profileError } = await supabase
      .from("user_profiles")
      .update(profileData)
      .eq("user_id", user.id);

    if (profileError) {
      console.error("Profile update error:", profileError);
      return { success: false, error: "Failed to update profile" };
    }
  }

  // Update nannies if we have nanny data
  if (Object.keys(nannyData).length > 0) {
    const { error: nannyError } = await supabase
      .from("nannies")
      .update(nannyData)
      .eq("user_id", user.id);

    if (nannyError) {
      console.error("Nanny update error:", nannyError);
      return { success: false, error: "Failed to update nanny data" };
    }
  }

  // Get nanny UUID for related table writes
  const { data: nanny } = await supabase
    .from("nannies")
    .select("id")
    .eq("user_id", user.id)
    .single();

  if (!nanny) {
    return { success: false, error: "Nanny record not found" };
  }

  // Update availability
  if (data.available_days !== undefined) {
    await supabase.from("nanny_availability").upsert(
      {
        nanny_id: nanny.id,
        days_available: data.available_days || [],
        schedule: data.schedule || {},
      },
      { onConflict: "nanny_id" },
    );
  }

  // Update credentials
  if (
    data.highest_qualification !== undefined ||
    data.certificates !== undefined
  ) {
    await supabase.from("nanny_credentials").delete().eq("nanny_id", nanny.id);

    if (
      data.highest_qualification &&
      data.highest_qualification !== "No Qualifications"
    ) {
      await supabase.from("nanny_credentials").insert({
        nanny_id: nanny.id,
        credential_category: "qualification",
        qualification_type: data.highest_qualification,
      });
    }

    for (const cert of (data.certificates || []).filter((c) => c !== "None")) {
      await supabase.from("nanny_credentials").insert({
        nanny_id: nanny.id,
        credential_category: "certification",
        certification_type: cert,
      });
    }
  }

  // Update assurances
  if (data.assurances !== undefined) {
    await supabase.from("nanny_assurances").delete().eq("nanny_id", nanny.id);

    for (const assurance of (data.assurances || []).filter(
      (a) => a !== "None",
    )) {
      await supabase.from("nanny_assurances").insert({
        nanny_id: nanny.id,
        assurance_type: assurance,
      });
    }
  }

  revalidatePath("/nanny/profile");
  revalidatePath("/nanny");
  revalidatePath(`/nannies/${nanny.id}`);
  return { success: true, error: null };
}

/**
 * Check if a nanny profile is complete (has all required fields)
 * Required: name, location, experience, at least one role type, hourly rate
 */
export async function isProfileComplete(): Promise<boolean> {
  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return false;

  // Fetch user profile
  const { data: profile } = await supabase
    .from("user_profiles")
    .select("first_name, last_name, suburb, postcode")
    .eq("user_id", user.id)
    .single();

  if (
    !profile?.first_name ||
    !profile?.last_name ||
    !profile?.suburb ||
    !profile?.postcode
  ) {
    return false;
  }

  // Fetch nanny record
  const { data: nanny } = await supabase
    .from("nannies")
    .select("total_experience_years, role_types_preferred, hourly_rate_min")
    .eq("user_id", user.id)
    .single();

  if (!nanny) return false;

  // Check required nanny fields
  if (nanny.total_experience_years === null) return false;
  if (!nanny.role_types_preferred || nanny.role_types_preferred.length === 0)
    return false;
  if (nanny.hourly_rate_min === null) return false;

  return true;
}

// ── Account Settings ──

export interface UpdateNannyAccountData {
  first_name?: string;
  last_name?: string;
  date_of_birth?: string | null;
  mobile_number?: string | null;
  suburb?: string;
  postcode?: string;
}

export async function updateNannyAccountSettings(
  data: UpdateNannyAccountData,
): Promise<{ success: boolean; error: string | null }> {
  const supabase = createClient();

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) {
    return { success: false, error: "Not authenticated" };
  }

  // Server-side mobile validation — mobile is REQUIRED and must be a
  // valid UK mobile (per user policy 2026-05-07). Mirrors the
  // client-side validation in the settings dialog so direct-action
  // calls cannot bypass. Shares `lib/uk-contact` with every other
  // surface so the rule cannot drift (12.05).
  if (data.mobile_number !== undefined) {
    const trimmed = (data.mobile_number ?? "").trim();
    if (trimmed.length === 0) {
      return { success: false, error: "Mobile number is required." };
    }
    if (!isUkMobile(trimmed)) {
      return {
        success: false,
        error: "Enter a valid UK mobile number.",
      };
    }
    data = { ...data, mobile_number: normaliseUkMobile(trimmed) };
  }

  const profileFields: Record<string, unknown> = {};
  if (data.first_name !== undefined) profileFields.first_name = data.first_name;
  if (data.last_name !== undefined) profileFields.last_name = data.last_name;
  if (data.date_of_birth !== undefined)
    profileFields.date_of_birth = data.date_of_birth;
  if (data.mobile_number !== undefined)
    profileFields.mobile_number = data.mobile_number;
  if (data.suburb !== undefined) profileFields.suburb = data.suburb;
  if (data.postcode !== undefined) profileFields.postcode = data.postcode;

  if (Object.keys(profileFields).length > 0) {
    const { error: profileError } = await supabase
      .from("user_profiles")
      .update(profileFields)
      .eq("user_id", user.id);

    if (profileError) {
      return { success: false, error: "Failed to update account info" };
    }
  }

  revalidatePath("/nanny/settings");
  revalidatePath("/nanny/profile");
  return { success: true, error: null };
}

export async function updateAccountEmail(
  newEmail: string,
): Promise<{ success: boolean; error: string | null }> {
  const supabase = createClient();

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) {
    return { success: false, error: "Not authenticated" };
  }

  // Defence-in-depth email validation server-side. The UI also
  // gates submission, but the server is the source of truth.
  const trimmed = newEmail.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
    return { success: false, error: "Please enter a valid email address." };
  }

  // Construct an absolute redirect URL that returns the user to the
  // contact-details section of their settings after they click the
  // confirmation link. Without this, gotrue falls back to the
  // project's Site URL — which lands on a generic dashboard with no
  // hint that the email change succeeded. We resolve the user's
  // role server-side so the redirect lands on the right role's
  // settings shell.
  const { data: roleRow } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", user.id)
    .maybeSingle();
  const role =
    roleRow?.role === "nanny" || roleRow?.role === "parent"
      ? roleRow.role
      : null;

  const siteUrl =
    SITE_URL;
  const next = role ? `/${role}/settings?s=contact&email_changed=1` : "/";
  const emailRedirectTo = `${siteUrl}/api/auth/callback?next=${encodeURIComponent(next)}`;

  // The DB-level trigger `sync_user_profile_email_trigger`
  // (sync-user-profile-email.sql) is what guarantees user_profiles.email
  // mirrors auth.users.email after the user clicks the confirmation
  // link. We do NOT update user_profiles here — only after gotrue
  // commits the change at confirmation time, which is when the
  // trigger fires.
  const { error: authUpdateError } = await supabase.auth.updateUser(
    { email: trimmed },
    { emailRedirectTo },
  );
  if (authUpdateError) {
    return { success: false, error: authUpdateError.message };
  }

  return { success: true, error: null };
}

export async function deactivateNannyAccount(): Promise<{
  success: boolean;
  error: string | null;
}> {
  const supabase = createClient();
  const admin = createAdminClient();

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) {
    return { success: false, error: "Not authenticated" };
  }

  const { error: nannyError } = await admin
    .from("nannies")
    .update({ status: "deactivated", deactivated_at: new Date().toISOString() })
    .eq("user_id", user.id);

  if (nannyError) {
    return { success: false, error: "Failed to deactivate account" };
  }

  await admin.from("activity_logs").insert({
    user_id: user.id,
    action: "account_deactivated",
    details: { deactivated_by: "user" },
  });

  await supabase.auth.signOut();
  return { success: true, error: null };
}

// ── AI Content Editing ──

import { findProfanityInFields } from "@/lib/profanity";
import { SITE_URL } from "@/lib/constants";

/**
 * Update AI-generated content with profanity check.
 * Used for inline editing on the profile view page.
 */
export async function updateNannyAIContent(
  nannyId: string,
  updates: Record<string, unknown>,
): Promise<{ success: boolean; error: string | null }> {
  const supabase = createClient();

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) {
    return { success: false, error: "Not authenticated" };
  }

  // Verify ownership
  const { data: nanny } = await supabase
    .from("nannies")
    .select("id, ai_content")
    .eq("id", nannyId)
    .eq("user_id", user.id)
    .single();

  if (!nanny) {
    return { success: false, error: "Not authorized" };
  }

  // Flatten all string values for profanity check
  const textFields: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(updates)) {
    if (typeof value === "string") {
      textFields[key] = value;
    } else if (typeof value === "object" && value !== null) {
      for (const [subKey, subValue] of Object.entries(
        value as Record<string, unknown>,
      )) {
        if (typeof subValue === "string") {
          textFields[`${key}.${subKey}`] = subValue;
        }
      }
    }
  }

  const offendingField = findProfanityInFields(textFields);
  if (offendingField) {
    return {
      success: false,
      error: "Content contains inappropriate language. Please revise.",
    };
  }

  // Deep-merge updates into existing ai_content (handles nested bio_summary)
  const existing = (nanny.ai_content as Record<string, unknown>) || {};
  const merged = { ...existing };
  for (const [key, value] of Object.entries(updates)) {
    if (
      typeof value === "object" &&
      value !== null &&
      !Array.isArray(value) &&
      typeof existing[key] === "object" &&
      existing[key] !== null
    ) {
      // Merge nested objects (e.g. bio_summary.about)
      merged[key] = {
        ...(existing[key] as Record<string, unknown>),
        ...(value as Record<string, unknown>),
      };
    } else {
      merged[key] = value;
    }
  }
  merged.ai_model = "manually_edited";
  merged.generated_at = new Date().toISOString();

  const { error: updateErr } = await supabase
    .from("nannies")
    .update({ ai_content: merged })
    .eq("id", nanny.id);

  if (updateErr) {
    return { success: false, error: "Failed to update content" };
  }

  revalidatePath(`/nannies/${nannyId}`);
  revalidatePath("/nanny/profile");
  return { success: true, error: null };
}

/**
 * Regenerate AI content from current profile data using V2 prompt.
 * Enforces once-per-day rate limit via last_regenerated_at column.
 */
export async function regenerateNannyAIContent(): Promise<{
  success: boolean;
  error: string | null;
}> {
  const supabase = createClient();
  const admin = createAdminClient();

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) {
    return { success: false, error: "Not authenticated" };
  }

  // Fetch nanny record (adminClient to bypass RLS)
  const { data: nanny } = await admin
    .from("nannies")
    .select("*")
    .eq("user_id", user.id)
    .single();

  if (!nanny) {
    return { success: false, error: "Profile not found" };
  }

  // Enforce once-per-day limit
  if (nanny.last_regenerated_at) {
    const lastRegen = new Date(nanny.last_regenerated_at);
    const hoursSince = (Date.now() - lastRegen.getTime()) / (1000 * 60 * 60);
    if (hoursSince < 24) {
      return {
        success: false,
        error:
          "You can only regenerate your profile once per day. Please try again tomorrow.",
      };
    }
  }

  // Fetch profile + credentials + assurances in parallel
  const [profileRes, credsRes, assuranceRes] = await Promise.all([
    admin
      .from("user_profiles")
      .select("first_name, last_name, date_of_birth, suburb")
      .eq("user_id", user.id)
      .single(),
    admin
      .from("nanny_credentials")
      .select("credential_category, qualification_type, certification_type")
      .eq("nanny_id", nanny.id),
    admin
      .from("nanny_assurances")
      .select("assurance_type")
      .eq("nanny_id", nanny.id),
  ]);

  const profile = profileRes.data;
  if (!profile) {
    return { success: false, error: "Profile not found" };
  }

  const highest_qualification =
    credsRes.data?.find((c) => c.credential_category === "qualification")
      ?.qualification_type || null;
  const certificates = (credsRes.data || [])
    .filter((c) => c.credential_category === "certification")
    .map((c) => c.certification_type)
    .filter((t): t is string => t !== null);

  // Convert months to friendly age labels for V2 prompt
  const monthsToLabel = (m: number | null): string | null => {
    if (m === null || m === undefined) return null;
    if (m === 0) return "Newborn";
    if (m < 12) return `${m} months`;
    if (m === 12) return "12 months";
    const years = Math.round(m / 12);
    return `${years} years`;
  };

  // Derive nanny experience from childcare roles
  const childcareRoles = (nanny.childcare_roles || []) as Array<{
    role: string;
    duration: number;
  }>;

  // Build V2 prompt data from live profile
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
    totalExperience:
      nanny.total_experience_years != null
        ? String(nanny.total_experience_years)
        : null,
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
    const {
      V2_SYSTEM_PROMPT,
      buildV2Prompt,
      parseAIProfileSections,
      generateV2Checklist,
    } = await import("@/lib/ai/nanny-profile-prompts");

    const userMessage = buildV2Prompt(promptData);

    const completion = await openai.chat.completions.create({
      model: "o4-mini",
      messages: [
        { role: "developer", content: V2_SYSTEM_PROMPT },
        { role: "user", content: userMessage },
      ],
      max_completion_tokens: 10000,
    });

    const raw = completion.choices[0]?.message?.content?.trim();
    if (!raw) {
      await admin
        .from("nannies")
        .update({ last_regenerated_at: null })
        .eq("id", nanny.id);
      return {
        success: false,
        error:
          "We were unable to regenerate your profile at this time. Please try again later.",
      };
    }

    const sections = parseAIProfileSections(raw);

    // Validate that key sections were populated
    if (!sections.headline && !sections.about && !sections.experience) {
      await admin
        .from("nannies")
        .update({ last_regenerated_at: null })
        .eq("id", nanny.id);
      return {
        success: false,
        error:
          "We were unable to regenerate your profile at this time. Please try again later.",
      };
    }

    const checklist = generateV2Checklist({
      personalityTraits: nanny.personality_traits || [],
      childcareRoles,
      totalExperience:
        nanny.total_experience_years != null
          ? String(nanny.total_experience_years)
          : null,
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
      headline: sections.headline || "",
      parent_pitch: sections.bio || "",
      bio_summary: {
        about: sections.about || "",
        personality: sections.personality || "",
        values: sections.values || "",
        background: sections.background || "",
        what_i_offer: sections.what_i_offer || "",
      },
      experience_summary: sections.experience || "",
      skills_highlight: checklist,
      ai_model: "o4-mini",
      generated_at: new Date().toISOString(),
    };

    await admin
      .from("nannies")
      .update({
        ai_content: aiContent,
        last_regenerated_at: new Date().toISOString(),
      })
      .eq("id", nanny.id);

    revalidatePath(`/nannies/${nanny.id}`);
    revalidatePath("/nanny/profile");
    revalidatePath("/nanny");
    return { success: true, error: null };
  } catch (err) {
    console.error("Failed to regenerate AI profile:", err);
    // Reset timestamp so user can retry
    await admin
      .from("nannies")
      .update({ last_regenerated_at: null })
      .eq("id", nanny.id);
    return {
      success: false,
      error:
        "We were unable to regenerate your profile at this time. Please try again later.",
    };
  }
}
