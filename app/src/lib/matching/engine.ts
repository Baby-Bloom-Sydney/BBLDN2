// ── Matchmaking engine — orchestrates data fetching + scoring ──

import { createAdminClient } from '@/lib/supabase/admin';
import type {
  PositionMatchData,
  PositionChildData,
  NannyMatchData,
  NannyProfileData,
  NannyCredentialData,
  LondonDistrict,
  MatchResult,
  MatchingResult,
} from './types';
import { normalizeNannySchedule, haversineDistance, ageFromDob } from './normalize';
import {
  scoreLocation,
  scoreSchedule,
  calculateQualityBase,
  calculateRequirementMultiplier,
  calculateOverQualifiedMultiplier,
  calculateFinalScore,
} from './scoring';
import { QUAL_SCORES } from './constants';

/**
 * Shared scoring pipeline: fetches all eligible nannies, scores them against
 * the given position data, and returns sorted results.
 * Used by both runMatchmaking (DB-backed) and runPreAuthMatching (lead-backed).
 */
export async function fetchAndScoreNannies(
  position: PositionMatchData,
  children: PositionChildData[],
  positionSchedule: Record<string, string[]> | null
): Promise<MatchingResult> {
  const supabase = createAdminClient();

  // ── Fetch all visible nannies (single query for nannies, then batch related) ──
  const { data: nannies, error: nannyError } = await supabase
    .from('nannies')
    .select('id, user_id, total_experience_years, nanny_experience_years, under_3_experience_years, newborn_experience_years, max_children, min_child_age_months, max_child_age_months, additional_needs_ok, drivers_license, has_car, vaccination_status, non_smoker, comfortable_with_pets, hourly_rate_min, nationality, languages, role_types_preferred, level_of_support_offered, immediate_start_available, ai_content')
    .gte('verification_level', 3);

  if (nannyError || !nannies || nannies.length === 0) {
    if (nannyError) console.error('Nanny fetch error:', nannyError);
    return { matches: [], totalEligible: 0 };
  }

  const totalEligible = nannies.length;
  const nannyIds = nannies.map((n) => n.id);
  const userIds = nannies.map((n) => n.user_id);

  // Batch fetch related data
  const [profilesRes, availabilityRes, credentialsRes] = await Promise.all([
    supabase
      .from('user_profiles')
      .select('user_id, first_name, last_name, suburb, postcode, date_of_birth, profile_picture_url')
      .in('user_id', userIds),
    supabase
      .from('nanny_availability')
      .select('nanny_id, days_available, schedule')
      .in('nanny_id', nannyIds),
    supabase
      .from('nanny_credentials')
      .select('nanny_id, credential_category, qualification_type, certification_type')
      .in('nanny_id', nannyIds),
  ]);

  // Build lookup maps
  const profileMap = new Map<string, NannyProfileData>();
  for (const p of profilesRes.data ?? []) {
    profileMap.set(p.user_id, p as NannyProfileData);
  }

  const availabilityMap = new Map<string, Record<string, string[]>>();
  for (const a of availabilityRes.data ?? []) {
    availabilityMap.set(
      a.nanny_id,
      normalizeNannySchedule(a.schedule as Record<string, unknown>)
    );
  }

  const credentialMap = new Map<string, NannyCredentialData[]>();
  for (const c of credentialsRes.data ?? []) {
    const existing = credentialMap.get(c.nanny_id) ?? [];
    existing.push(c as NannyCredentialData);
    credentialMap.set(c.nanny_id, existing);
  }

  // ── Fetch district centroids for distance calc ──
  const allSuburbs = new Set<string>();
  if (position.suburb) allSuburbs.add(position.suburb);
  for (const p of profilesRes.data ?? []) {
    if (p.suburb) allSuburbs.add(p.suburb);
  }

  const districtMap = new Map<
    string,
    Pick<LondonDistrict, 'district' | 'latitude' | 'longitude'>
  >();
  if (allSuburbs.size > 0) {
    const { data: districts } = await supabase
      .from('london_districts')
      .select('district, latitude, longitude')
      .in('district', Array.from(allSuburbs));

    for (const d of districts ?? []) {
      districtMap.set(d.district.toLowerCase(), {
        district: d.district,
        latitude: Number(d.latitude),
        longitude: Number(d.longitude),
      });
    }
  }

  // Parent's coordinates
  const parentDistrict = position.suburb
    ? districtMap.get(position.suburb.toLowerCase())
    : null;

  // ── Score each nanny ──
  const results: MatchResult[] = [];

  for (const nanny of nannies as NannyMatchData[]) {
    const profile = profileMap.get(nanny.user_id);
    if (!profile) continue; // skip nannies without profile

    const nannySchedule = availabilityMap.get(nanny.id) ?? {};
    const nannyCredentials = credentialMap.get(nanny.id) ?? [];

    // Distance
    let distanceKm: number | null = null;
    if (parentDistrict && profile.suburb) {
      const nannyDistrict = districtMap.get(profile.suburb.toLowerCase());
      if (nannyDistrict) {
        distanceKm = haversineDistance(
          parentDistrict.latitude,
          parentDistrict.longitude,
          nannyDistrict.latitude,
          nannyDistrict.longitude
        );
        distanceKm = Math.floor(distanceKm); // whole km, rounded down
      }
    }

    // Nanny age
    const nannyAge = ageFromDob(profile.date_of_birth);

    // Layer 1: Quality Base
    const { score: qualityBase, breakdown, scheduleOverlapPercent } =
      calculateQualityBase(
        position,
        children,
        nanny,
        nannyCredentials,
        distanceKm,
        nannySchedule,
        positionSchedule
      );

    // Layer 2: Requirement Multiplier
    const { multiplier: reqMultiplier, unmetRequirements } =
      calculateRequirementMultiplier(position, children, nanny, nannyAge);

    // Layer 3: Over-qualified Multiplier
    const { multiplier: oqMultiplier, bonuses: oqBonuses } =
      calculateOverQualifiedMultiplier(position, nanny, nannyCredentials, nannyAge);

    // Final score
    const { rawScore, finalScore } = calculateFinalScore(
      qualityBase,
      reqMultiplier,
      oqMultiplier
    );

    // Highest qualification for display
    let highestQualification: string | null = null;
    let highestQualScore = 0;
    for (const cred of nannyCredentials) {
      if (cred.credential_category === 'qualification' && cred.qualification_type) {
        const qs = QUAL_SCORES[cred.qualification_type] ?? 0;
        if (qs > highestQualScore) {
          highestQualScore = qs;
          highestQualification = cred.qualification_type;
        }
      }
    }

    // Specific certification names for display
    const rawCerts = nannyCredentials
      .filter((c) => c.credential_category === 'certification' && c.certification_type)
      .map((c) => c.certification_type!);
    // "First Aid in Childcare Setting" → "Child First Aid" and takes priority over plain "First Aid"
    const hasChildFirstAid = rawCerts.some((c) =>
      c.toLowerCase().includes('childcare') || c.toLowerCase().includes('child first aid')
    );
    const certifications = rawCerts
      .map((c) => {
        if (c.toLowerCase().includes('childcare')) return 'Child First Aid';
        return c;
      })
      .filter((c) => !(hasChildFirstAid && c === 'First Aid'));

    results.push({
      nannyId: nanny.id,
      nanny,
      profile,
      qualityBase,
      requirementMultiplier: reqMultiplier,
      overQualifiedMultiplier: oqMultiplier,
      rawScore,
      finalScore,
      breakdown,
      distanceKm,
      scheduleOverlapPercent,
      highestQualification,
      certifications,
      nannySchedule: nannySchedule,
      unmetRequirements,
      overQualifiedBonuses: oqBonuses,
    });
  }

  // Sort by final score descending
  results.sort((a, b) => b.finalScore - a.finalScore);

  return { matches: results, totalEligible };
}

export async function runMatchmaking(positionId: string): Promise<MatchingResult> {
  const supabase = createAdminClient();

  // ── Fetch position data (3 parallel queries) ──
  const [positionRes, childrenRes, scheduleRes] = await Promise.all([
    supabase
      .from('nanny_positions')
      .select('id, parent_id, drivers_license_required, car_required, vaccination_required, non_smoker_required, comfortable_with_pets_required, minimum_age_requirement, years_of_experience, language_preference, language_preference_details, reason_for_nanny, schedule_type, urgency, suburb, postcode, details')
      .eq('id', positionId)
      .single(),
    supabase
      .from('position_children')
      .select('age_months')
      .eq('position_id', positionId),
    supabase
      .from('position_schedule')
      .select('schedule')
      .eq('position_id', positionId)
      .maybeSingle(),
  ]);

  if (positionRes.error || !positionRes.data) {
    console.error('Position fetch error:', positionRes.error);
    return { matches: [], totalEligible: 0 };
  }

  const position = positionRes.data as PositionMatchData;
  const children: PositionChildData[] = (childrenRes.data ?? []).map((c) => ({
    age_months: c.age_months,
  }));
  const positionSchedule = (scheduleRes.data?.schedule as Record<string, string[]>) ?? null;

  return fetchAndScoreNannies(position, children, positionSchedule);
}

/**
 * Basic matchmaking for DFY Standard tier.
 * Only scores location (distance + car) and schedule overlap.
 * Skips credentials fetch, requirement checks, and over-qualified bonuses.
 */
export async function runBasicMatchmaking(positionId: string): Promise<MatchingResult> {
  const supabase = createAdminClient();

  // ── Step 1: Fetch position data (3 parallel queries) ──
  const [positionRes, scheduleRes] = await Promise.all([
    supabase
      .from('nanny_positions')
      .select('id, parent_id, suburb, postcode, schedule_type')
      .eq('id', positionId)
      .single(),
    supabase
      .from('position_schedule')
      .select('schedule')
      .eq('position_id', positionId)
      .maybeSingle(),
  ]);

  if (positionRes.error || !positionRes.data) {
    console.error('Position fetch error:', positionRes.error);
    return { matches: [], totalEligible: 0 };
  }

  const position = positionRes.data;
  const positionSchedule = (scheduleRes.data?.schedule as Record<string, string[]>) ?? null;

  // ── Step 2: Fetch all visible nannies ──
  const { data: nannies, error: nannyError } = await supabase
    .from('nannies')
    .select('id, user_id, has_car, ai_content')
    .gte('verification_level', 3);

  if (nannyError || !nannies || nannies.length === 0) {
    if (nannyError) console.error('Nanny fetch error:', nannyError);
    return { matches: [], totalEligible: 0 };
  }

  const totalEligible = nannies.length;
  const nannyIds = nannies.map((n) => n.id);
  const userIds = nannies.map((n) => n.user_id);

  // Batch fetch profiles + availability (skip credentials)
  const [profilesRes, availabilityRes] = await Promise.all([
    supabase
      .from('user_profiles')
      .select('user_id, first_name, last_name, suburb, postcode, date_of_birth, profile_picture_url')
      .in('user_id', userIds),
    supabase
      .from('nanny_availability')
      .select('nanny_id, days_available, schedule')
      .in('nanny_id', nannyIds),
  ]);

  // Build lookup maps
  const profileMap = new Map<string, NannyProfileData>();
  for (const p of profilesRes.data ?? []) {
    profileMap.set(p.user_id, p as NannyProfileData);
  }

  const availabilityMap = new Map<string, Record<string, string[]>>();
  for (const a of availabilityRes.data ?? []) {
    availabilityMap.set(
      a.nanny_id,
      normalizeNannySchedule(a.schedule as Record<string, unknown>)
    );
  }

  // ── Step 3: Fetch district centroids for distance calc ──
  const allSuburbs = new Set<string>();
  if (position.suburb) allSuburbs.add(position.suburb);
  for (const p of profilesRes.data ?? []) {
    if (p.suburb) allSuburbs.add(p.suburb);
  }

  const districtMap = new Map<
    string,
    Pick<LondonDistrict, 'district' | 'latitude' | 'longitude'>
  >();
  if (allSuburbs.size > 0) {
    const { data: districts } = await supabase
      .from('london_districts')
      .select('district, latitude, longitude')
      .in('district', Array.from(allSuburbs));

    for (const d of districts ?? []) {
      districtMap.set(d.district.toLowerCase(), {
        district: d.district,
        latitude: Number(d.latitude),
        longitude: Number(d.longitude),
      });
    }
  }

  const parentDistrict = position.suburb
    ? districtMap.get(position.suburb.toLowerCase())
    : null;

  // ── Step 4: Score each nanny (location + schedule only) ──
  const results: MatchResult[] = [];

  for (const nanny of nannies) {
    const profile = profileMap.get(nanny.user_id);
    if (!profile) continue;

    const nannySchedule = availabilityMap.get(nanny.id) ?? {};

    // Distance
    let distanceKm: number | null = null;
    if (parentDistrict && profile.suburb) {
      const nannyDistrict = districtMap.get(profile.suburb.toLowerCase());
      if (nannyDistrict) {
        distanceKm = haversineDistance(
          parentDistrict.latitude,
          parentDistrict.longitude,
          nannyDistrict.latitude,
          nannyDistrict.longitude
        );
        distanceKm = Math.floor(distanceKm);
      }
    }

    const locationScore = scoreLocation(distanceKm, nanny.has_car ?? false);
    const isFlexible = position.schedule_type === 'Flexible';
    const { score: scheduleScore, overlapPercent } = scoreSchedule(
      positionSchedule,
      nannySchedule,
      isFlexible
    );

    const basicScore = locationScore * 0.45 + scheduleScore * 0.55;
    const { rawScore, finalScore } = calculateFinalScore(basicScore, 1.0, 1.0);

    // Build a full NannyMatchData-shaped object with nulls for fields we didn't fetch
    const nannyMatchData: NannyMatchData = {
      id: nanny.id,
      user_id: nanny.user_id,
      total_experience_years: null,
      nanny_experience_years: null,
      under_3_experience_years: null,
      newborn_experience_years: null,
      max_children: null,
      min_child_age_months: null,
      max_child_age_months: null,
      additional_needs_ok: null,
      drivers_license: null,
      has_car: nanny.has_car ?? null,
      vaccination_status: null,
      non_smoker: null,
      comfortable_with_pets: null,
      hourly_rate_min: null,
      languages: null,
      role_types_preferred: null,
      level_of_support_offered: null,
      immediate_start_available: null,
      nationality: null,
      ai_content: nanny.ai_content as NannyMatchData['ai_content'],
    };

    results.push({
      nannyId: nanny.id,
      nanny: nannyMatchData,
      profile,
      qualityBase: basicScore,
      requirementMultiplier: 1.0,
      overQualifiedMultiplier: 1.0,
      rawScore,
      finalScore,
      breakdown: {
        location: locationScore,
        schedule: scheduleScore,
        experience: 0,
        roleFit: 0,
        qualifications: 0,
        supportFit: 0,
      },
      distanceKm,
      scheduleOverlapPercent: overlapPercent,
      highestQualification: null,
      certifications: [],
      nannySchedule,
      unmetRequirements: [],
      overQualifiedBonuses: [],
    });
  }

  results.sort((a, b) => b.finalScore - a.finalScore);

  return { matches: results, totalEligible };
}
