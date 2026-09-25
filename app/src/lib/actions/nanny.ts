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

export interface CreateNannyProfileData {
  // user_profiles fields
  first_name: string;
  last_name: string;
  mobile_number?: string | null;
  date_of_birth?: string | null;
  suburb: string;
  postcode: string;
  profile_picture_url?: string | null;

  // nannies fields
  gender?: string | null;
  nationality?: string | null;
  languages?: string[];

  total_experience_years: number | null;
  nanny_experience_years?: number | null;
  under_3_experience_years?: number | null;
  newborn_experience_years?: number | null;
  experience_details?: string | null;

  role_types_preferred: string[];
  level_of_support_offered?: string[];

  hourly_rate_min: number | null;
  pay_frequency?: string[];
  immediate_start_available?: boolean;
  placement_ongoing_preferred?: boolean;
  start_date_earliest?: string | null;
  end_date_latest?: string | null;

  max_children?: number | null;
  min_child_age_months?: number | null;
  max_child_age_months?: number | null;
  additional_needs_ok?: boolean;

  sydney_resident?: boolean;
  residency_status?: string | null;
  right_to_work?: boolean;
  drivers_license?: boolean;
  has_car?: boolean;
  comfortable_with_pets?: boolean;
  vaccination_status?: boolean;
  non_smoker?: boolean;

  hobbies_interests?: string | null;
  strengths_traits?: string | null;
  skills_training?: string | null;

  // Credentials (for nanny_credentials table)
  highest_qualification?: string | null;
  certificates?: string[];

  // Assurances (for nanny_assurances table)
  assurances?: string[];

  // Availability (for nanny_availability table)
  available_days?: string[];
  schedule?: Record<string, string[]>;
}

/**
 * Create/complete a nanny profile from registration funnel
 * Updates both user_profiles and nannies tables, then triggers AI bio generation
 */
export async function createNannyProfile(
  data: CreateNannyProfileData,
): Promise<{ success: boolean; error: string | null }> {
  const supabase = createClient();

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) {
    return { success: false, error: "Not authenticated" };
  }

  // Fields that go to user_profiles (not nannies)
  const profileFields = [
    "first_name",
    "last_name",
    "mobile_number",
    "date_of_birth",
    "suburb",
    "postcode",
    "profile_picture_url",
  ];
  // Fields that go to related tables, not the nannies table directly
  const relatedFields = [
    "highest_qualification",
    "certificates",
    "assurances",
    "available_days",
    "schedule",
  ];

  const profileData: Record<string, unknown> = {};
  const nannyData: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(data)) {
    if (profileFields.includes(key)) {
      profileData[key] = value;
    } else if (!relatedFields.includes(key)) {
      nannyData[key] = value;
    }
  }

  // Update user_profiles
  const { error: profileError } = await supabase
    .from("user_profiles")
    .update(profileData)
    .eq("user_id", user.id);

  if (profileError) {
    console.error("Profile update error:", profileError);
    return { success: false, error: "Failed to update profile" };
  }

  // Update nannies with status set to active
  const { error: nannyError } = await supabase
    .from("nannies")
    .update({ ...nannyData, status: "active" })
    .eq("user_id", user.id);

  if (nannyError) {
    console.error("Nanny update error:", nannyError);
    return { success: false, error: "Failed to update nanny data" };
  }

  // Get the nanny UUID for related table writes
  const { data: nanny } = await supabase
    .from("nannies")
    .select("id")
    .eq("user_id", user.id)
    .single();

  if (!nanny) {
    return { success: false, error: "Nanny record not found" };
  }

  // Write availability
  if (data.available_days && data.available_days.length > 0) {
    await supabase.from("nanny_availability").upsert(
      {
        nanny_id: nanny.id,
        days_available: data.available_days,
        schedule: data.schedule || {},
      },
      { onConflict: "nanny_id" },
    );
  }

  // Write credentials (qualification + certificates)
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

  // Write assurances
  await supabase.from("nanny_assurances").delete().eq("nanny_id", nanny.id);

  for (const assurance of (data.assurances || []).filter((a) => a !== "None")) {
    await supabase.from("nanny_assurances").insert({
      nanny_id: nanny.id,
      assurance_type: assurance,
    });
  }

  // Save form snapshot for audit trail
  await supabase.from("form_snapshots").insert({
    user_id: user.id,
    form_type: "nanny_registration",
    data: data as unknown as Record<string, unknown>,
  });

  // Generate AI bio in background (don't block the response)
  generateNannyBio(user.id, data).catch(console.error);

  revalidatePath("/nanny/profile");
  revalidatePath("/nanny/register");
  return { success: true, error: null };
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

// ── AI Profile Generation (o4-mini via Chat Completions) ──

const PROFILE_SYSTEM_PROMPT = `You are a professional nanny profile writer. Your task is to generate concise content using all relevant provided fields, in a warm, engaging, first-person tone tailored for Sydney families, avoiding salesy or generic language and focusing on family/child benefits with natural, personal phrasing and cohesive sentence connections or structured lists. The nanny's name must not be included in most sections, except for the <bio> section's profile link. For the <bio> section, use direct language (e.g., "your kids") except in the intro (broader, e.g., "little ones"), with Sydney references and specified emojis. For the <tagline> section, use "children" for broader appeal, mirroring the <bio>'s Traits paragraph.

Before responding, validate all fields for completeness (use neutral assumptions for missing fields, e.g., "caring" for Traits). Paraphrase input essence. Rationalize and prioritize family-desirable benefits. Segment for readability using transitions, spacing, and emojis where applicable.

Respond with ONLY the 7 HTML-wrapped sections below. No extra text, explanations, or code formatting outside the wrappers.

**Section Structures**:

<about> - Short paragraph (~30 words) from Traits + Hobbies & Interest. Warm connection with Sydney parents, paraphrased, benefit-led, direct language. Example: "<p>A cheerful and patient soul, I find joy in baking treats that spark smiles and family bonding in your home.</p>"

<experience> - Short paragraph (~35 words) starting with "I have." Uses Total Experience, Nanny Experience, Under 3 Experience, Newborn Experience, Experience Details. Paraphrased, benefit-led. Example: "<p>I have 5 years of childcare experience, including 3 years as a nanny, with 2 years caring for children under 3. I spent time in daycare creating joyful routines for your family.</p>"

<traits> - Short paragraph (~30 words) using "I am {Traits}, allowing me to..." Paraphrased, benefit-led, emphasizing child development benefits. Example: "<p>I am patient and creative, allowing me to build a nurturing environment that encourages your child's confidence and sparks their imagination.</p>"

<background> - Paragraph (~40-50 words) from Skills & Training. Structure: "I [have/am] {skill}, [therefore/so] I am able to {benefit}" for each skill. Use transitions (e.g., "I am also," "Additionally"). Exclude certifications. Example: "<p>I have a coaching background, therefore I am able to guide your child to build confidence through fun activities. I am also experienced in Montessori practices, so I can adapt to your child's unique needs.</p>"

<services> - Paragraph (~40-50 words) from Services, Level Of Support, Min Age, Max Age. Include "I specialise in working with your children between {Min Age} and {Max Age}." Use transitions for cohesive flow. Example: "<p>I specialise in working with your children between newborn and 5 years, providing mothers help to ease your transition with reliable care. I also handle educational support, simplifying your schedule.</p>"

<tagline> - Single sentence (~10-20 words) using Traits with "children" for broader appeal. Include confidence-focused benefit. Mirrors <bio> Traits paragraph. Example: "<p>I'm patient and creative, creating fun, safe spaces for children, helping them learn with self-esteem.</p>"

<bio> - Social media advert (~100-120 words) structured with <br> as: Header (💫 Experienced Nanny Available! 💫), Location (📍 {Suburb}-based), Intro (Hello families, broad language "little ones", age range, total experience, passion statement, "I'm now looking for my next wonderful Nanny Family! 😊"), Checklist A "I have" (✨ Total Experience, 🌟 Nanny Experience with age range, 👼 Infant/Newborn if non-zero, 🌟 Experience Details, 👩‍🎓 Qualifications), Checklist B "I am" (⭐️ Skills & Training items), Checklist C "I also have" (✅ Assurances, 🩺 Certificates, 🪪 License, 🚗 Car, 💚 Vaccinated — exclude Pets), Traits paragraph (direct "your kids", Traits + Hobbies, confidence benefit), CTA (synonym traits, profile link: babybloomsydney.com.au/nannies/{Suburb}/{FirstName}/{LastName} 💕). Do NOT bold "Experienced" in header. Do NOT include name in intro. Use synonyms for traits in CTA (e.g., "gentle" → "kind").`;

function buildProfilePrompt(data: CreateNannyProfileData): string {
  const yesNo = (v: boolean | undefined) => (v ? "Yes" : "No");

  // Calculate age from DOB
  let age = "";
  if (data.date_of_birth) {
    const birth = new Date(data.date_of_birth);
    const now = new Date();
    let years = now.getFullYear() - birth.getFullYear();
    const m = now.getMonth() - birth.getMonth();
    if (m < 0 || (m === 0 && now.getDate() < birth.getDate())) years--;
    if (years > 0 && years < 120) age = String(years);
  }

  // Map child age months to display strings
  const ageLabel = (months: number | null | undefined): string => {
    if (months === null || months === undefined) return "Any";
    if (months === 0) return "Newborn";
    if (months < 12) return `${months} months`;
    const y = Math.floor(months / 12);
    return `${y} year${y > 1 ? "s" : ""}`;
  };

  return `Generate a nanny profile based on:
First Name: ${data.first_name}
Last Name: ${data.last_name}
Suburb: ${data.suburb}
Age: ${age || "Not provided"}
Nationality: ${data.nationality || "Not provided"}
Total Childcare Experience: ${data.total_experience_years ?? 0} years
Nanny Experience: ${data.nanny_experience_years ?? 0} years
Nanny Experience under 3 years: ${data.under_3_experience_years ?? 0} years
Newborn Experience: ${data.newborn_experience_years ?? 0} years
Related Childcare Experience: ${data.experience_details || "None"}
Services: ${data.role_types_preferred?.join(", ") || "None"}
Level of Support: ${data.level_of_support_offered?.join(", ") || "None"}
Max Children: ${data.max_children ?? "Not specified"}
Minimum Age: ${ageLabel(data.min_child_age_months)}
Maximum Age: ${ageLabel(data.max_child_age_months)}
Additional Child Needs: ${yesNo(data.additional_needs_ok)}
Strengths: ${data.strengths_traits || "None"}
Hobbies and Interests: ${data.hobbies_interests || "None"}
Skills and Training: ${data.skills_training || "None"}
Qualifications: ${data.highest_qualification || "None"}
Assurances: ${(data.assurances || []).filter((a) => a !== "None").join(", ") || "None"}
Certifications: ${(data.certificates || []).filter((c) => c !== "None").join(", ") || "None"}
Driver's License: ${yesNo(data.drivers_license)}
Access to a Car: ${yesNo(data.has_car)}
Pets: ${yesNo(data.comfortable_with_pets)}
Vaccination Status: ${yesNo(data.vaccination_status)}`;
}

/**
 * Generate a checklist HTML from nanny profile data (programmatic, not AI-generated)
 */
function generateChecklist(data: CreateNannyProfileData): string {
  const ageLabel = (months: number | null | undefined): string => {
    if (months === null || months === undefined) return "Any";
    if (months === 0) return "Newborn";
    if (months < 12) return `${months} months`;
    const y = Math.floor(months / 12);
    return `${y} year${y > 1 ? "s" : ""}`;
  };

  const lines: string[] = [];

  // Summary
  lines.push("<strong>Summary</strong>");
  const minAge = ageLabel(data.min_child_age_months);
  const maxAge = ageLabel(data.max_child_age_months);
  if (minAge !== "Any" || maxAge !== "Any") {
    lines.push(`✅ Age range: ${minAge} – ${maxAge}`);
  }
  if (data.role_types_preferred?.length) {
    lines.push(`✅ Services: ${data.role_types_preferred.join(", ")}`);
  }
  if (data.level_of_support_offered?.length) {
    lines.push(`✅ Support: ${data.level_of_support_offered.join(", ")}`);
  }

  // Qualifications & Training
  const quals: string[] = [];
  if (
    data.highest_qualification &&
    data.highest_qualification !== "No Qualifications"
  ) {
    quals.push(`✅ ${data.highest_qualification}`);
  }
  if (quals.length) {
    lines.push("<br><strong>Qualifications & Training</strong>");
    lines.push(...quals);
  }

  // Experience
  lines.push("<br><strong>Experience</strong>");
  if (data.total_experience_years)
    lines.push(
      `✅ ${data.total_experience_years} years total childcare experience`,
    );
  if (data.nanny_experience_years)
    lines.push(`✅ ${data.nanny_experience_years} years nanny experience`);
  if (data.under_3_experience_years)
    lines.push(
      `✅ ${data.under_3_experience_years} years infant experience (under 3)`,
    );
  if (data.newborn_experience_years)
    lines.push(`✅ ${data.newborn_experience_years} years newborn experience`);
  if (data.experience_details) lines.push(`✅ ${data.experience_details}`);

  // Strengths
  if (data.skills_training) {
    lines.push("<br><strong>Strengths</strong>");
    const skills = data.skills_training
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    for (const skill of skills) {
      lines.push(`✅ ${skill}`);
    }
  }

  // Accreditations
  const accreds: string[] = [];
  for (const cert of (data.certificates || []).filter((c) => c !== "None")) {
    accreds.push(`✅ ${cert}`);
  }
  for (const assurance of (data.assurances || []).filter((a) => a !== "None")) {
    accreds.push(`✅ ${assurance}`);
  }
  if (accreds.length) {
    lines.push("<br><strong>Accreditations</strong>");
    lines.push(...accreds);
  }

  // Transport
  const transport: string[] = [];
  if (data.drivers_license) transport.push("🪪 Driver's License");
  if (data.has_car) transport.push("🚗 Access to a Car");
  if (transport.length) {
    lines.push("<br><strong>Transport</strong>");
    lines.push(...transport);
  }

  // Plus
  const plus: string[] = [];
  if (data.comfortable_with_pets) plus.push("✅ Comfortable with Pets");
  if (data.vaccination_status) plus.push("✅ Fully Vaccinated");
  if (data.non_smoker) plus.push("✅ Non-Smoker");
  if (plus.length) {
    lines.push("<br><strong>Plus</strong>");
    lines.push(...plus);
  }

  return lines.join("<br>");
}

/**
 * Parse the 7 AI-generated sections from the response
 */
function parseAIProfileSections(raw: string): Record<string, string> {
  const sections: Record<string, string> = {};
  const tags = [
    "about",
    "experience",
    "traits",
    "background",
    "services",
    "tagline",
    "bio",
  ];

  for (const tag of tags) {
    const regex = new RegExp(`<${tag}>(.*?)</${tag}>`, "s");
    const match = raw.match(regex);
    if (match) {
      // Strip outer <p> tags for cleaner storage, keep inner HTML
      sections[tag] = match[1].trim();
    }
  }

  return sections;
}

/**
 * Generate an AI profile for a nanny (7 sections) using o4-mini
 */
export async function generateNannyBio(
  userId: string,
  data: CreateNannyProfileData,
): Promise<void> {
  // Use admin client — this runs as fire-and-forget after the server action returns,
  // so the cookie-based request context is gone and createClient() can't authenticate.
  const supabase = createAdminClient();

  try {
    const userMessage = buildProfilePrompt(data);

    const completion = await openai.chat.completions.create({
      model: "o4-mini",
      messages: [
        { role: "developer", content: PROFILE_SYSTEM_PROMPT },
        { role: "user", content: userMessage },
      ],
      max_completion_tokens: 10000,
    });

    const raw = completion.choices[0]?.message?.content?.trim();
    if (!raw) return;

    // Get the nanny ID
    const { data: nanny } = await supabase
      .from("nannies")
      .select("id")
      .eq("user_id", userId)
      .single();

    if (!nanny) return;

    // Parse sections from AI response
    const sections = parseAIProfileSections(raw);

    // Generate programmatic checklist from data (not AI-generated)
    const checklist = generateChecklist(data);

    // Build single JSONB object with all AI content
    const aiContent = {
      headline: sections.tagline || "",
      parent_pitch: sections.bio || "",
      bio_summary: {
        about: sections.about || "",
        traits: sections.traits || "",
        background: sections.background || "",
        services: sections.services || "",
      },
      experience_summary: sections.experience || "",
      skills_highlight: checklist,
      ai_model: "o4-mini",
      generated_at: new Date().toISOString(),
    };

    // Write single JSONB to nannies.ai_content
    const { error: updateErr } = await supabase
      .from("nannies")
      .update({ ai_content: aiContent })
      .eq("id", nanny.id);

    if (updateErr) {
      console.error("[AI Bio] Update error:", updateErr.message);
    }
  } catch (error) {
    console.error("Failed to generate AI profile:", error);
  }
}
