import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  getNannyPlacements,
  getNannyUpcomingIntros,
} from "@/lib/actions/position-funnel";
import { getNannyBabysittingJobs } from "@/lib/actions/babysitting";
import { babysittingEnabled } from "@/lib/features/flags";
import { getDfyNotificationsForNanny } from "@/lib/actions/matching";
import { getVerificationData } from "@/lib/actions/verification";
import { getPendingInvitesForUser } from "@/lib/actions/bapp/child-invites";
import {
  NannyHubClient,
  type NannyProfileAccordionData,
  type NannyApplication,
} from "./NannyHubClient";
import type { OpenPosition } from "./jobs/NannyJobsView";
import { CONNECTION_STAGE } from "@/lib/position/constants";
import type { ChildClient } from "@/types/bapp";

async function fetchOpenPositions(): Promise<OpenPosition[]> {
  const admin = createAdminClient();

  const { data: positions, error } = await admin
    .from("nanny_positions")
    .select(
      "id, suburb, schedule_type, hourly_rate, hours_per_week, source, created_at, days_required, details",
    )
    .eq("status", "active")
    .order("created_at", { ascending: false });

  if (error || !positions) return [];

  // Batch-fetch children for all positions
  const positionIds = positions.map((p) => p.id);
  const { data: allChildren } = await admin
    .from("position_children")
    .select("position_id, age_months, gender")
    .in("position_id", positionIds)
    .order("display_order", { ascending: true });

  const childrenByPosition = new Map<
    string,
    Array<{ age_months: number; gender: string | null }>
  >();
  for (const child of allChildren ?? []) {
    const list = childrenByPosition.get(child.position_id) ?? [];
    list.push({ age_months: child.age_months, gender: child.gender });
    childrenByPosition.set(child.position_id, list);
  }

  // Batch-fetch schedules for AI/admin positions
  const adminPositionIds = positions
    .filter((p) => p.source && p.source !== "parent")
    .map((p) => p.id);
  const scheduleByPosition = new Map<string, Record<string, string[]>>();
  if (adminPositionIds.length > 0) {
    const { data: schedules } = await admin
      .from("position_schedule")
      .select("position_id, schedule")
      .in("position_id", adminPositionIds);

    for (const row of schedules ?? []) {
      if (row.schedule) {
        scheduleByPosition.set(
          row.position_id,
          row.schedule as Record<string, string[]>,
        );
      }
    }
  }

  const DAY_ROSTER_FIELD: Record<string, string> = {
    Monday: "monday_roster",
    Tuesday: "tuesday_roster",
    Wednesday: "wednesday_roster",
    Thursday: "thursday_roster",
    Friday: "friday_roster",
    Saturday: "saturday_roster",
    Sunday: "sunday_roster",
  };

  return positions.map((pos) => {
    let weeklyRoster: string[] = [];
    const rosterByDay: Record<string, string[]> = {};

    if (pos.source && pos.source !== "parent") {
      // AI/admin — read from position_schedule
      const schedule = scheduleByPosition.get(pos.id);
      if (schedule) {
        for (const [day, brackets] of Object.entries(schedule)) {
          const titleDay = day.charAt(0).toUpperCase() + day.slice(1);
          weeklyRoster.push(titleDay);
          rosterByDay[titleDay] = brackets;
        }
      } else {
        weeklyRoster = pos.days_required ?? [];
      }
    } else {
      // Parent — read from form_data
      const details = pos.details as Record<string, unknown> | null;
      const formData = (details?.form_data ?? {}) as Record<string, unknown>;
      weeklyRoster =
        (formData.weekly_roster as string[]) ?? pos.days_required ?? [];
      for (const day of weeklyRoster) {
        const field = DAY_ROSTER_FIELD[day];
        if (field && formData[field]) {
          rosterByDay[day] = formData[field] as string[];
        }
      }
    }

    return {
      id: pos.id,
      suburb: pos.suburb,
      schedule_type: pos.schedule_type,
      hourly_rate: pos.hourly_rate ? Number(pos.hourly_rate) : null,
      hours_per_week: pos.hours_per_week,
      source: pos.source ?? null,
      created_at: pos.created_at,
      children: childrenByPosition.get(pos.id) ?? [],
      weekly_roster: weeklyRoster,
      roster_by_day: rosterByDay,
    };
  });
}

async function fetchNannyApplications(
  nannyId: string,
  currentUserId: string,
): Promise<NannyApplication[]> {
  const admin = createAdminClient();

  // Get stage 4 (pending) and stage 5 (applied) connection requests for this nanny
  const { data: applications, error } = await admin
    .from("connection_requests")
    .select("id, position_id, created_at")
    .eq("nanny_id", nannyId)
    .in("connection_stage", [
      CONNECTION_STAGE.NANNY_APPLIED_PENDING,
      CONNECTION_STAGE.NANNY_APPLIED,
    ])
    .order("created_at", { ascending: false });

  if (error || !applications || applications.length === 0) return [];

  // Get position details (suburb + parent info)
  const positionIds = applications
    .map((a) => a.position_id)
    .filter(Boolean) as string[];
  if (positionIds.length === 0) return [];

  const { data: positions } = await admin
    .from("nanny_positions")
    .select("id, suburb, parent_id, family_display_name, source")
    .in("id", positionIds);

  if (!positions) return [];

  // Get parent names for parent-sourced positions
  const parentIds = positions
    .filter((p) => !p.source || p.source === "parent")
    .map((p) => p.parent_id);
  const parentNameMap = new Map<string, string>();
  if (parentIds.length > 0) {
    const { data: parents } = await admin
      .from("parents")
      .select("id, user_id")
      .in("id", parentIds);

    if (parents && parents.length > 0) {
      const userIds = parents.map((p) => p.user_id);
      const { data: profiles } = await admin
        .from("user_profiles")
        .select("user_id, last_name, first_name")
        .in("user_id", userIds);

      if (profiles) {
        const profileMap = new Map(profiles.map((p) => [p.user_id, p]));
        for (const parent of parents) {
          // Skip if parent resolves to the nanny's own user (dual role)
          if (parent.user_id === currentUserId) continue;
          const profile = profileMap.get(parent.user_id);
          if (profile) {
            parentNameMap.set(
              parent.id,
              profile.last_name
                ? `${profile.last_name} Family`
                : `${profile.first_name}'s Family`,
            );
          }
        }
      }
    }
  }

  const positionMap = new Map(positions.map((p) => [p.id, p]));

  return applications
    .filter((a) => a.position_id && positionMap.has(a.position_id))
    .map((a) => {
      const pos = positionMap.get(a.position_id!)!;
      const familyName =
        pos.family_display_name ?? parentNameMap.get(pos.parent_id) ?? "Family";
      return {
        id: a.id,
        positionId: a.position_id!,
        familyName,
        suburb: pos.suburb,
        createdAt: a.created_at,
      };
    });
}

export default async function NannyHubPage() {
  const supabase = createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) redirect("/login");

  const admin = createAdminClient();

  // Phase 1: profile + nanny record (needed for nannyId + accordion data)
  const [profileRes, nannyRes] = await Promise.all([
    admin
      .from("user_profiles")
      .select(
        "first_name, last_name, profile_picture_url, suburb, date_of_birth",
      )
      .eq("user_id", user.id)
      .single(),
    admin
      .from("nannies")
      .select(
        "id, verification_level, visible_in_bsr, ai_content, nationality, total_experience_years, nanny_experience_years, under_3_experience_years, newborn_experience_years, role_types_preferred, level_of_support_offered, hourly_rate_min, max_children, min_child_age_months, max_child_age_months, drivers_license, has_car, comfortable_with_pets, vaccination_status, non_smoker, languages, hobbies_interests, strengths_traits, skills_training, verification_tier, motivation, personality_traits, professional_values, childcare_roles, photo_1_url, photo_2_url, photo_3_url, immediate_start_available, additional_needs_ok",
      )
      .eq("user_id", user.id)
      .single(),
  ]);

  const nannyId = nannyRes.data?.id;

  // Phase 2: all data for both tabs + accordion availability + open positions + applications + connected children (the "Children" tab)
  const [
    placementsRes,
    introsRes,
    bsrRes,
    dfyRes,
    verificationRes,
    availRes,
    credsRes,
    openPositions,
    nannyApplications,
    educationChildrenRes,
    pendingInvitesResult,
  ] = await Promise.all([
    getNannyPlacements(),
    getNannyUpcomingIntros(),
    // 5c (P-23): not called while BABYSITTING_ENABLED is off, so its lazy expiry/reminder sweeps never run.
    babysittingEnabled()
      ? getNannyBabysittingJobs()
      : Promise.resolve({ data: [], error: null, banned: false, banUntil: null }),
    getDfyNotificationsForNanny(),
    getVerificationData(),
    nannyId
      ? admin
          .from("nanny_availability")
          .select("days_available, schedule")
          .eq("nanny_id", nannyId)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    nannyId
      ? admin
          .from("nanny_credentials")
          .select("credential_category, qualification_type, certification_type")
          .eq("nanny_id", nannyId)
      : Promise.resolve({ data: null }),
    fetchOpenPositions(),
    nannyId ? fetchNannyApplications(nannyId, user.id) : Promise.resolve([]),
    admin
      .from("child_client")
      .select("*")
      .eq("nanny_user_id", user.id)
      .eq("under_three", true)
      .order("created_at", { ascending: true }),
    getPendingInvitesForUser(),
  ]);

  const shareUnlocked = nannyRes.data?.visible_in_bsr === true;

  // DSS §8 Q8 (Bailey 2026-05-12) — small green tick on each child
  // tile whose family is currently subscribed. Resolve in one batched
  // query for all parent_user_ids on the nanny's children list.
  const educationChildrenRows = (educationChildrenRes.data ??
    []) as ChildClient[];
  const parentIdsForSub = Array.from(
    new Set(
      educationChildrenRows
        .map((c) => c.parent_user_id)
        .filter((id): id is string => typeof id === "string" && id.length > 0),
    ),
  );
  let subscribedChildIds: string[] = [];
  if (parentIdsForSub.length > 0) {
    const { data: activeSubs } = await admin
      .from("parent_subscriptions")
      .select("parent_user_id, status")
      .in("parent_user_id", parentIdsForSub)
      .in("status", ["trial", "active_monthly", "active_upfront"]);
    const subscribedParentIds = new Set(
      (activeSubs ?? []).map((s) => s.parent_user_id as string),
    );
    subscribedChildIds = educationChildrenRows
      .filter(
        (c) => c.parent_user_id && subscribedParentIds.has(c.parent_user_id),
      )
      .map((c) => c.id);
  }

  // Assemble accordion profile data
  const n = nannyRes.data;
  const nannyProfile: NannyProfileAccordionData | null = n
    ? {
        suburb: profileRes.data?.suburb || "",
        date_of_birth: profileRes.data?.date_of_birth || null,
        nationality: n.nationality,
        total_experience_years: n.total_experience_years,
        nanny_experience_years: n.nanny_experience_years,
        under_3_experience_years: n.under_3_experience_years,
        newborn_experience_years: n.newborn_experience_years,
        role_types_preferred: n.role_types_preferred,
        level_of_support_offered: n.level_of_support_offered,
        hourly_rate_min: n.hourly_rate_min,
        max_children: n.max_children,
        min_child_age_months: n.min_child_age_months,
        max_child_age_months: n.max_child_age_months,
        drivers_license: n.drivers_license,
        has_car: n.has_car,
        comfortable_with_pets: n.comfortable_with_pets,
        vaccination_status: n.vaccination_status,
        non_smoker: n.non_smoker,
        languages: n.languages,
        hobbies_interests: n.hobbies_interests,
        strengths_traits: n.strengths_traits,
        skills_training: n.skills_training,
        ai_content: n.ai_content as Record<string, unknown> | null,
        availability: availRes.data
          ? {
              days_available: availRes.data.days_available,
              schedule: availRes.data.schedule as Record<
                string,
                string[]
              > | null,
            }
          : null,
        highest_qualification:
          (credsRes.data || []).find(
            (c: { credential_category: string }) =>
              c.credential_category === "qualification",
          )?.qualification_type || null,
        certificates: (credsRes.data || [])
          .filter(
            (c: { credential_category: string }) =>
              c.credential_category === "certification",
          )
          .map((c: { certification_type: string }) => c.certification_type)
          .filter(Boolean) as string[],
        motivation: n.motivation || null,
        personality_traits: n.personality_traits || null,
        professional_values: n.professional_values || null,
        childcare_roles: n.childcare_roles as
          | { role: string; duration: number }[]
          | null,
        additional_photos: [n.photo_1_url, n.photo_2_url, n.photo_3_url].filter(
          Boolean,
        ) as string[],
        immediate_start: n.immediate_start_available ?? false,
        additional_needs: n.additional_needs_ok ?? false,
      }
    : null;

  return (
    <div className="mx-auto max-w-2xl space-y-3">
      <NannyHubClient
        firstName={profileRes.data?.first_name || "there"}
        lastName={profileRes.data?.last_name || ""}
        profilePictureUrl={profileRes.data?.profile_picture_url || null}
        verificationLevel={nannyRes.data?.verification_level ?? 0}
        verificationData={verificationRes.data}
        nannyProfile={nannyProfile}
        placements={placementsRes.data || []}
        upcomingIntros={introsRes.data || []}
        dfyNotifications={dfyRes.data || []}
        openPositions={openPositions}
        nannyApplications={nannyApplications}
        babysittingJobs={bsrRes.data || []}
        bsrBanned={bsrRes.banned || false}
        bsrBanUntil={bsrRes.banUntil || null}
        shareUnlocked={shareUnlocked}
        educationChildren={educationChildrenRows}
        subscribedChildIds={subscribedChildIds}
        pendingInvites={pendingInvitesResult.data ?? []}
      />
    </div>
  );
}
