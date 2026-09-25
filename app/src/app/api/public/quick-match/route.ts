import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { scoreLocation, scoreSchedule, calculateFinalScore } from "@/lib/matching/scoring";
import { haversineDistance, normalizeNannySchedule, ageFromDob } from "@/lib/matching/normalize";

/**
 * Public quick match API — no auth required, no database writes.
 *
 * Accepts suburb + availability, runs lightweight logistical scoring
 * (location × 0.45 + schedule × 0.55) against all visible nannies,
 * and returns the total match count + top 3 results.
 *
 * Reuses the same scoring functions as runBasicMatchmaking but
 * without requiring a saved position record.
 */

interface QuickMatchRequest {
  suburb: string;
  availability: Record<string, string[]>; // e.g. { monday: ["morning", "afternoon"], ... }
}

interface QuickMatchNanny {
  id: string;
  first_name: string;
  suburb: string;
  profile_picture_url: string | null;
  age: number | null;
  total_experience_years: number | null;
  under_3_experience_years: number | null;
  highest_qualification: string | null;
  verified: boolean;
  ai_headline: string | null;
  logistical_score: number;
  distance_km: number | null;
  schedule_overlap_percent: number;
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as QuickMatchRequest;

    // Validate input
    if (!body.suburb || typeof body.suburb !== "string") {
      return NextResponse.json({ error: "suburb is required" }, { status: 400 });
    }
    if (!body.availability || typeof body.availability !== "object") {
      return NextResponse.json({ error: "availability is required" }, { status: 400 });
    }

    const supabase = createAdminClient();

    // ── Fetch all visible nannies ──
    const { data: nannies, error: nannyError } = await supabase
      .from("nannies")
      .select("id, user_id, has_car, total_experience_years, under_3_experience_years, verification_tier, verification_level, ai_content")
      .eq("profile_visible", true);

    if (nannyError || !nannies?.length) {
      return NextResponse.json({ totalMatches: 0, topNannies: [] });
    }

    const nannyIds = nannies.map((n) => n.id);
    const userIds = nannies.map((n) => n.user_id);

    // ── Batch fetch profiles, availability, credentials ──
    const [profilesRes, availabilityRes, credentialsRes] = await Promise.all([
      supabase
        .from("user_profiles")
        .select("user_id, first_name, suburb, profile_picture_url, date_of_birth")
        .in("user_id", userIds),
      supabase
        .from("nanny_availability")
        .select("nanny_id, schedule")
        .in("nanny_id", nannyIds),
      supabase
        .from("nanny_credentials")
        .select("nanny_id, qualification_type")
        .in("nanny_id", nannyIds)
        .eq("credential_category", "qualification"),
    ]);

    const profileMap = new Map(
      (profilesRes.data ?? []).map((p) => [p.user_id, p])
    );
    const availabilityMap = new Map(
      (availabilityRes.data ?? []).map((a) => [
        a.nanny_id,
        normalizeNannySchedule(a.schedule as Record<string, unknown>),
      ])
    );
    const qualMap = new Map(
      (credentialsRes.data ?? []).map((c) => [c.nanny_id, c.qualification_type as string])
    );

    // ── Fetch district centroids for distance calc ──
    const allSuburbs = new Set<string>();
    allSuburbs.add(body.suburb);
    for (const p of profilesRes.data ?? []) {
      if (p.suburb) allSuburbs.add(p.suburb);
    }

    const { data: districts } = await supabase
      .from("london_districts")
      .select("district, latitude, longitude")
      .in("district", Array.from(allSuburbs));

    const districtMap = new Map(
      (districts ?? []).map((d) => [
        d.district.toLowerCase(),
        { latitude: Number(d.latitude), longitude: Number(d.longitude) },
      ])
    );

    const parentLocation = districtMap.get(body.suburb.toLowerCase());

    // ── Score each nanny ──
    const scored: QuickMatchNanny[] = [];

    for (const nanny of nannies) {
      const profile = profileMap.get(nanny.user_id);
      if (!profile) continue;

      const nannySchedule = availabilityMap.get(nanny.id) ?? {};

      // Distance
      let distanceKm: number | null = null;
      if (parentLocation && profile.suburb) {
        const nannyLocation = districtMap.get(profile.suburb.toLowerCase());
        if (nannyLocation) {
          distanceKm = Math.floor(
            haversineDistance(
              parentLocation.latitude,
              parentLocation.longitude,
              nannyLocation.latitude,
              nannyLocation.longitude
            )
          );
        }
      }

      // Scores — same weights as runBasicMatchmaking
      const locationScore = scoreLocation(distanceKm, nanny.has_car ?? false);
      const { score: scheduleScore, overlapPercent } = scoreSchedule(
        body.availability,
        nannySchedule,
        false // not flexible — we don't know from quick match
      );

      const basicScore = locationScore * 0.45 + scheduleScore * 0.55;
      const { finalScore } = calculateFinalScore(basicScore, 1.0, 1.0);

      const qual = qualMap.get(nanny.id) ?? null;
      const ai = nanny.ai_content as Record<string, unknown> | null;

      scored.push({
        id: nanny.id,
        first_name: profile.first_name,
        suburb: profile.suburb,
        profile_picture_url: profile.profile_picture_url,
        age: ageFromDob(profile.date_of_birth),
        total_experience_years: nanny.total_experience_years,
        under_3_experience_years: nanny.under_3_experience_years,
        highest_qualification: qual,
        verified: (nanny.verification_level ?? 0) >= 3,
        ai_headline: (ai?.headline as string) || null,
        logistical_score: finalScore,
        distance_km: distanceKm,
        schedule_overlap_percent: overlapPercent,
      });
    }

    // Sort by score descending
    scored.sort((a, b) => b.logistical_score - a.logistical_score);

    // totalMatches = nannies scoring 50% or higher
    const qualifiedMatches = scored.filter((n) => n.logistical_score >= 50);

    // Top 3 for display — pad to 3 if fewer than 3 score ≥85%
    const top3 = scored.slice(0, 3);
    const realHighCount = top3.filter((n) => n.logistical_score >= 85).length;
    const needsPadding = realHighCount < 3;

    const displayTop3 = top3.map((n) => ({
      ...n,
      // Only bolster scores to 85% when padding (fewer than 3 real ≥85% matches)
      logistical_score: needsPadding ? Math.max(85, n.logistical_score) : n.logistical_score,
    }));

    return NextResponse.json({
      totalMatches: qualifiedMatches.length,
      topNannies: displayTop3,
    });
  } catch (err) {
    console.error("[quick-match] Error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
