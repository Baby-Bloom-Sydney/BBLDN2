import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { NannyHubClient, type NannyProfileAccordionData } from "@/app/nanny/NannyHubClient";
import { ParentHubClient } from "@/app/parent/ParentHubClient";
import { CONNECTION_STAGE, POSITION_STAGE } from "@/lib/position/constants";

interface PositionSummary {
  scheduleType: string | null;
  hoursPerWeek: number | null;
  daysRequired: string[] | null;
  schedule: Record<string, string[]> | null;
  levelOfSupport: string[] | null;
  hourlyRate: number | null;
  children: { ageMonths: number; gender: string | null }[];
  urgency: string | null;
  startDate: string | null;
  placementLength: string | null;
  reasonForNanny: string[] | null;
  languagePreference: string | null;
  qualificationRequirement: string | null;
  certificateRequirements: string[] | null;
  vaccinationRequired: boolean | null;
  driversLicenseRequired: boolean | null;
  carRequired: boolean | null;
  comfortableWithPetsRequired: boolean | null;
  nonSmokerRequired: boolean | null;
  otherRequirements: string | null;
  suburb: string | null;
  description: string | null;
}

export default async function AdminViewerHubPage({
  params,
}: {
  params: { id: string };
}) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const admin = createAdminClient();
  const targetUserId = params.id;

  // Determine role
  const { data: roleData } = await admin
    .from("user_roles")
    .select("role")
    .eq("user_id", targetUserId)
    .single();

  if (!roleData) redirect("/admin/users");

  const role = roleData.role as string;

  if (role === "nanny") {
    return renderNannyHub(admin, targetUserId);
  } else if (role === "parent") {
    return renderParentHub(admin, targetUserId);
  }

  return (
    <div className="p-6 text-center text-slate-500">
      Viewer not available for role: {role}
    </div>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function renderNannyHub(admin: any, targetUserId: string) {
  // Phase 1: profile + nanny record
  const [profileRes, nannyRes] = await Promise.all([
    admin
      .from("user_profiles")
      .select("first_name, last_name, profile_picture_url, suburb, date_of_birth")
      .eq("user_id", targetUserId)
      .single(),
    admin
      .from("nannies")
      .select(
        "id, verification_level, visible_in_bsr, ai_content, nationality, total_experience_years, nanny_experience_years, under_3_experience_years, newborn_experience_years, role_types_preferred, level_of_support_offered, hourly_rate_min, max_children, min_child_age_months, max_child_age_months, drivers_license, has_car, comfortable_with_pets, vaccination_status, non_smoker, languages, hobbies_interests, strengths_traits, skills_training, verification_tier, motivation, personality_traits, professional_values, childcare_roles, photo_1_url, photo_2_url, photo_3_url, immediate_start_available, additional_needs_ok"
      )
      .eq("user_id", targetUserId)
      .single(),
  ]);

  const nannyId = nannyRes.data?.id;
  if (!nannyId) {
    return <div className="p-6 text-center text-slate-500">Nanny record not found</div>;
  }

  // Phase 2: all parallel data fetches
  const [
    placementsRes,
    introsConnections,
    bsrNotifications,
    dfyNotifications,
    verificationRes,
    availRes,
    credsRes,
  ] = await Promise.all([
    // Placements
    admin
      .from("nanny_placements")
      .select("id, parent_id, position_id, weekly_hours, hourly_rate, hired_at, start_date, status, end_notes")
      .eq("nanny_id", nannyId)
      .order("hired_at", { ascending: false }),
    // Upcoming intros (connection requests)
    admin
      .from("connection_requests")
      .select(
        "id, parent_id, position_id, connection_stage, confirmed_time, fill_initiated_by, trial_date, start_date, status, proposed_times, message, expires_at, nanny_phone_shared, source"
      )
      .eq("nanny_id", nannyId)
      .in("connection_stage", [
        CONNECTION_STAGE.REQUEST_SENT,
        CONNECTION_STAGE.ACCEPTED,
        CONNECTION_STAGE.INTRO_SCHEDULED,
        CONNECTION_STAGE.INTRO_COMPLETE,
        CONNECTION_STAGE.AWAITING_RESPONSE,
        CONNECTION_STAGE.TRIAL_ARRANGED,
        CONNECTION_STAGE.TRIAL_COMPLETE,
        CONNECTION_STAGE.OFFERED,
        CONNECTION_STAGE.CONFIRMED,
        CONNECTION_STAGE.NOT_HIRED,
      ])
      .order("created_at", { ascending: false }),
    // BSR notifications
    admin
      .from("bsr_notifications")
      .select(
        "babysitting_request_id, distance_km, notified_at, viewed_at, requested_at, accepted_at, declined_at, notified_filled"
      )
      .eq("nanny_id", nannyId)
      .order("notified_at", { ascending: false }),
    // DFY notifications
    admin
      .from("dfy_match_notifications")
      .select("id, position_id, match_score, distance_km, status, notified_at, viewed_at, responded_at")
      .eq("nanny_id", nannyId)
      .in("status", ["notified", "viewed", "interested"])
      .order("match_score", { ascending: false }),
    // Verification
    admin
      .from("verifications")
      .select(
        `id, identity_status, wwcc_status, contact_status, cross_check_status,
        verification_status, surname, given_names, date_of_birth, passport_country,
        passport_upload_url, identification_photo_url,
        identity_verified, identity_rejection_reason, identity_user_guidance,
        extracted_passport_number, extracted_nationality,
        wwcc_verification_method, wwcc_number, wwcc_expiry_date,
        wwcc_grant_email_url, wwcc_service_nsw_screenshot_url,
        wwcc_doc_verified, wwcc_verified, wwcc_rejection_reason, wwcc_user_guidance,
        phone_number, address_line, city, state, postcode, country,
        cross_check_reasoning, created_at, updated_at`
      )
      .eq("user_id", targetUserId)
      .maybeSingle(),
    // Availability
    admin
      .from("nanny_availability")
      .select("days_available, schedule")
      .eq("nanny_id", nannyId)
      .maybeSingle(),
    // Credentials
    admin
      .from("nanny_credentials")
      .select("credential_category, qualification_type, certification_type")
      .eq("nanny_id", nannyId),
  ]);

  // Build placements data
  const placements = await buildNannyPlacements(admin, placementsRes.data || []);

  // Build upcoming intros
  const upcomingIntros = await buildNannyUpcomingIntros(admin, introsConnections.data || []);

  // Build babysitting jobs
  const babysittingJobs = await buildNannyBabysittingJobs(admin, nannyId, bsrNotifications.data || []);

  // Build DFY notifications
  const dfyData = await buildDfyNotifications(admin, dfyNotifications.data || []);

  // Check ban status
  const { data: banData } = await admin
    .from("nannies")
    .select("bsr_banned_until")
    .eq("id", nannyId)
    .single();

  const banned = !!(banData?.bsr_banned_until && new Date(banData.bsr_banned_until) > new Date());
  const banUntil = banned ? banData!.bsr_banned_until : null;

  const shareUnlocked = nannyRes.data?.visible_in_bsr === true;

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
              schedule: availRes.data.schedule as Record<string, string[]> | null,
            }
          : null,
        highest_qualification:
          (credsRes.data || []).find(
            (c: { credential_category: string }) => c.credential_category === "qualification"
          )?.qualification_type || null,
        certificates: (credsRes.data || [])
          .filter((c: { credential_category: string }) => c.credential_category === "certification")
          .map((c: { certification_type: string }) => c.certification_type)
          .filter(Boolean) as string[],
        motivation: n.motivation || null,
        personality_traits: n.personality_traits || null,
        professional_values: n.professional_values || null,
        childcare_roles: n.childcare_roles as { role: string; duration: number }[] | null,
        additional_photos: [n.photo_1_url, n.photo_2_url, n.photo_3_url].filter(Boolean) as string[],
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
        placements={placements}
        upcomingIntros={upcomingIntros as unknown as import("@/lib/actions/position-funnel").UpcomingIntro[]}
        dfyNotifications={dfyData}
        babysittingJobs={babysittingJobs.data as unknown as import("@/lib/actions/babysitting").NannyBabysittingJob[]}
        openPositions={[]}
        nannyApplications={[]}
        educationChildren={[]}
        bsrBanned={banned}
        bsrBanUntil={banUntil}
        shareUnlocked={shareUnlocked}
      />
    </div>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function renderParentHub(admin: any, targetUserId: string) {
  // Get parent record
  const { data: parentData } = await admin
    .from("parents")
    .select("id")
    .eq("user_id", targetUserId)
    .single();

  if (!parentData) {
    return <div className="p-6 text-center text-slate-500">Parent record not found</div>;
  }

  const parentId = parentData.id;

  // Get position
  const { data: position } = await admin
    .from("nanny_positions")
    .select("*")
    .eq("parent_id", parentId)
    .in("status", ["active", "filled"])
    .maybeSingle();

  // Get position children if position exists
  let positionWithChildren = null;
  if (position) {
    const { data: children } = await admin
      .from("position_children")
      .select("*")
      .eq("position_id", position.id)
      .order("display_order");

    positionWithChildren = { ...position, children: children || [] };
  }

  // Parallel fetches
  const [placementRes, introsRes, dfyStatusRes, bsrRes] = await Promise.all([
    // Placement
    buildParentPlacement(admin, parentId),
    // Upcoming intros
    buildParentUpcomingIntros(admin, parentId),
    // DFY status
    buildDfyStatus(admin, parentId),
    // Babysitting requests
    buildParentBabysittingRequests(admin, parentId),
  ]);

  // Confirmed connections
  let confirmedNannies: Array<{
    connectionId: string;
    nannyId: string;
    nannyName: string;
    nannySuburb: string;
    nannyPhoto: string | null;
    connectionStage: number;
    confirmedTime: string | null;
  }> = [];
  let showFillButton = false;

  if (position) {
    const { data: conns } = await admin
      .from("connection_requests")
      .select("id, nanny_id, connection_stage, confirmed_time")
      .eq("position_id", position.id)
      .gte("connection_stage", CONNECTION_STAGE.INTRO_SCHEDULED);

    if (conns && conns.length > 0) {
      const nannyIds = Array.from(new Set(conns.map((c: { nanny_id: string }) => c.nanny_id)));
      const { data: nannies } = await admin.from("nannies").select("id, user_id").in("id", nannyIds);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const nannyMap = new Map<string, any>((nannies || []).map((n: any) => [n.id, n]));
      const nannyUserIds = (nannies || []).map((n: { user_id: string }) => n.user_id);
      const { data: profiles } = await admin
        .from("user_profiles")
        .select("user_id, first_name, last_name, suburb, profile_picture_url")
        .in("user_id", nannyUserIds);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const profileMap = new Map<string, any>((profiles || []).map((p: any) => [p.user_id, p]));

      // Deduplicate — keep highest stage per nanny
      const bestByNanny = new Map<string, typeof conns[0]>();
      for (const c of conns) {
        const existing = bestByNanny.get(c.nanny_id);
        if (!existing || c.connection_stage > existing.connection_stage) {
          bestByNanny.set(c.nanny_id, c);
        }
      }

      confirmedNannies = Array.from(bestByNanny.values()).map((c) => {
        const nanny = nannyMap.get(c.nanny_id);
        const profile = nanny ? profileMap.get(nanny.user_id) : null;
        return {
          connectionId: c.id,
          nannyId: c.nanny_id,
          nannyName: profile ? `${profile.first_name} ${profile.last_name}` : "Unknown",
          nannySuburb: profile?.suburb || "",
          nannyPhoto: profile?.profile_picture_url || null,
          connectionStage: c.connection_stage,
          confirmedTime: c.confirmed_time,
        };
      });

      showFillButton = !placementRes && position.stage === POSITION_STAGE.CONNECTING && confirmedNannies.length > 0;
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-3">
      <ParentHubClient
        position={positionWithChildren}
        placement={placementRes}
        confirmedNannies={confirmedNannies}
        showFillButton={showFillButton}
        upcomingIntros={introsRes}
        dfyTier={dfyStatusRes.tier}
        dfyExpiresAt={dfyStatusRes.expiresAt}
        dfyActivated={dfyStatusRes.activated}
        babysittingRequests={bsrRes}
      />
    </div>
  );
}

// ── Helper: Build nanny placements ──────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function buildNannyPlacements(admin: any, rawPlacements: any[]) {
  if (!rawPlacements.length) return [];

  const visible = rawPlacements.filter(
    (p: { end_notes?: string }) => !p.end_notes?.includes("[NANNY_DISMISSED]")
  );
  if (!visible.length) return [];

  const parentIds = Array.from(new Set(visible.map((p: { parent_id: string }) => p.parent_id)));
  const { data: parents } = await admin.from("parents").select("id, user_id").in("id", parentIds);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const parentMap = new Map<string, any>((parents || []).map((p: any) => [p.id, p]));
  const parentUserIds = (parents || []).map((p: { user_id: string }) => p.user_id);

  const { data: profiles } = await admin
    .from("user_profiles")
    .select("user_id, first_name, last_name, suburb, profile_picture_url, date_of_birth, email, mobile_number")
    .in("user_id", parentUserIds);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const profileMap = new Map<string, any>((profiles || []).map((p: any) => [p.user_id, p]));

  const positionIds = visible
    .filter((p: { position_id: string | null; status: string }) => p.position_id && p.status === "active")
    .map((p: { position_id: string }) => p.position_id);

  const positionSuburbMap = new Map<string, string>();
  if (positionIds.length > 0) {
    const { data: positions } = await admin.from("nanny_positions").select("id, suburb").in("id", positionIds);
    for (const pos of positions || []) {
      if (pos.suburb) positionSuburbMap.set(pos.id, pos.suburb);
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return visible.map((p: any) => {
    const parent = parentMap.get(p.parent_id);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const profile: any = parent ? profileMap.get(parent.user_id) : null;
    return {
      id: p.id,
      parentName: profile ? `${profile.first_name} ${profile.last_name}` : "Unknown",
      parentLastName: profile?.last_name || "",
      parentSuburb: (p.position_id ? positionSuburbMap.get(p.position_id) : null) || "",
      parentPhoto: profile?.profile_picture_url || null,
      parentDateOfBirth: profile?.date_of_birth || null,
      weeklyHours: p.weekly_hours,
      hourlyRate: p.hourly_rate,
      hiredAt: p.hired_at,
      startDate: p.start_date,
      status: p.status,
      positionId: p.position_id,
      parentEmail: profile?.email || null,
      parentPhone: profile?.mobile_number || null,
      positionFormData: null,
      rosterNotes: null,
      nannyNotes: null,
    };
  });
}

// ── Helper: Build nanny upcoming intros ─────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function buildNannyUpcomingIntros(admin: any, connections: any[]) {
  if (!connections.length) return [];

  const parentIds = Array.from(new Set(connections.map((c: { parent_id: string }) => c.parent_id)));
  const { data: parents } = await admin.from("parents").select("id, user_id").in("id", parentIds);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const parentMap = new Map<string, any>((parents || []).map((p: any) => [p.id, p]));
  const parentUserIds = (parents || []).map((p: { user_id: string }) => p.user_id);

  const { data: profiles } = await admin
    .from("user_profiles")
    .select("user_id, first_name, last_name, suburb, profile_picture_url")
    .in("user_id", parentUserIds);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const profileMap = new Map<string, any>((profiles || []).map((p: any) => [p.user_id, p]));

  // Fetch position data
  const positionIds = Array.from(
    new Set(connections.map((c: { position_id: string | null }) => c.position_id).filter(Boolean))
  ) as string[];
  const positionMap = new Map<string, PositionSummary>();

  if (positionIds.length > 0) {
    const { data: positions } = await admin
      .from("nanny_positions")
      .select(
        "id, schedule_type, hours_per_week, days_required, level_of_support, hourly_rate, urgency, start_date, placement_length, reason_for_nanny, language_preference, qualification_requirement, certificate_requirements, vaccination_required, drivers_license_required, car_required, comfortable_with_pets_required, non_smoker_required, other_requirements_details, description, parent_id, suburb"
      )
      .in("id", positionIds);

    const { data: allChildren } = await admin
      .from("position_children")
      .select("position_id, age_months, gender")
      .in("position_id", positionIds)
      .order("display_order");

    const childrenByPosition = new Map<string, { ageMonths: number; gender: string | null }[]>();
    for (const child of allChildren || []) {
      const arr = childrenByPosition.get(child.position_id) || [];
      arr.push({ ageMonths: child.age_months, gender: child.gender });
      childrenByPosition.set(child.position_id, arr);
    }

    const { data: scheduleRows } = await admin
      .from("position_schedule")
      .select("position_id, schedule")
      .in("position_id", positionIds);

    const scheduleByPosition = new Map<string, Record<string, string[]>>(
      (scheduleRows || []).map((s: { position_id: string; schedule: Record<string, string[]> }) => [
        s.position_id,
        s.schedule,
      ])
    );

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const pos of positions || [] as any[]) {
      positionMap.set(pos.id, {
        scheduleType: pos.schedule_type,
        hoursPerWeek: pos.hours_per_week,
        daysRequired: pos.days_required,
        schedule: scheduleByPosition.get(pos.id) || null,
        levelOfSupport: pos.level_of_support,
        hourlyRate: pos.hourly_rate,
        children: childrenByPosition.get(pos.id) || [],
        urgency: pos.urgency,
        startDate: pos.start_date,
        placementLength: pos.placement_length,
        reasonForNanny: pos.reason_for_nanny,
        languagePreference: pos.language_preference,
        qualificationRequirement: pos.qualification_requirement,
        certificateRequirements: pos.certificate_requirements,
        vaccinationRequired: pos.vaccination_required,
        driversLicenseRequired: pos.drivers_license_required,
        carRequired: pos.car_required,
        comfortableWithPetsRequired: pos.comfortable_with_pets_required,
        nonSmokerRequired: pos.non_smoker_required,
        otherRequirements: pos.other_requirements_details,
        suburb: pos.suburb || null,
        description: pos.description,
      });
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return connections.map((c: any) => {
    const parent = parentMap.get(c.parent_id);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const profile: any = parent ? profileMap.get(parent.user_id) : null;
    return {
      connectionId: c.id,
      otherPartyName: profile ? `${profile.last_name} Family` : "Unknown",
      otherPartySuburb: (c.position_id ? positionMap.get(c.position_id)?.suburb : null) || "",
      otherPartyPhoto: profile?.profile_picture_url || null,
      confirmedTime: c.confirmed_time || "",
      connectionStage: c.connection_stage,
      fillInitiatedBy: c.fill_initiated_by ?? null,
      trialDate: c.trial_date ?? null,
      startDate: c.start_date ?? null,
      status: c.status,
      proposedTimes: c.proposed_times ?? null,
      message: c.message ?? null,
      expiresAt: c.expires_at ?? null,
      nannyPhoneShared: c.nanny_phone_shared ?? null,
      positionId: c.position_id ?? null,
      position: c.position_id ? positionMap.get(c.position_id) ?? null : null,
      source: c.source ?? null,
      nannyId: null,
    };
  });
}

// ── Helper: Build nanny babysitting jobs ────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function buildNannyBabysittingJobs(admin: any, nannyId: string, notifications: any[]) {
  if (!notifications.length) return { data: [], banned: false, banUntil: null };

  const bsrIds = notifications.map((n: { babysitting_request_id: string }) => n.babysitting_request_id);

  const [bsrRes, slotsRes] = await Promise.all([
    admin
      .from("babysitting_requests")
      .select(
        "id, title, special_requirements, suburb, postcode, address, hourly_rate, estimated_total, children, status, accepted_nanny_id, created_at, expires_at, parent_id"
      )
      .in("id", bsrIds),
    admin
      .from("bsr_time_slots")
      .select("id, babysitting_request_id, slot_date, start_time, end_time, is_selected")
      .in("babysitting_request_id", bsrIds),
  ]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const bsrMap = new Map<string, any>((bsrRes.data || []).map((b: any) => [b.id, b]));
  const slotMap = new Map<string, typeof slotsRes.data>();
  for (const slot of slotsRes.data || []) {
    const existing = slotMap.get(slot.babysitting_request_id) ?? [];
    existing.push(slot);
    slotMap.set(slot.babysitting_request_id, existing);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const results = notifications.map((notif: any) => {
    const bsr = bsrMap.get(notif.babysitting_request_id);
    if (!bsr) return null;

    const slots = (slotMap.get(bsr.id) ?? []).map((s: { id: string; slot_date: string; start_time: string; end_time: string; is_selected: boolean }) => ({
      id: s.id,
      slot_date: s.slot_date,
      start_time: s.start_time,
      end_time: s.end_time,
      is_selected: s.is_selected,
    }));

    const children = ((bsr.children ?? []) as Array<{ ageMonths: number; gender: string }>).map(
      (c: { ageMonths: number; gender: string }) => ({
        age_months: c.ageMonths,
        gender: c.gender,
      })
    );

    const isNannyAccepted = bsr.status === "filled" && bsr.accepted_nanny_id === nannyId;

    return {
      id: bsr.id,
      title: bsr.title,
      special_requirements: bsr.special_requirements,
      suburb: bsr.suburb,
      postcode: bsr.postcode,
      address: isNannyAccepted ? (bsr.address ?? null) : null,
      hourly_rate: bsr.hourly_rate ? Number(bsr.hourly_rate) : null,
      estimated_total: bsr.estimated_total ? Number(bsr.estimated_total) : null,
      status: bsr.status,
      accepted_nanny_id: bsr.accepted_nanny_id,
      created_at: bsr.created_at,
      expires_at: bsr.expires_at,
      slots,
      notification: {
        distanceKm: notif.distance_km != null ? Math.floor(Number(notif.distance_km)) : null,
        notifiedAt: notif.notified_at,
        viewedAt: notif.viewed_at,
        requestedAt: notif.requested_at ?? null,
        acceptedAt: notif.accepted_at,
        declinedAt: notif.declined_at,
        notifiedFilled: notif.notified_filled ?? false,
      },
      children,
      clashSlotIds: [],
    };
  });

  return { data: results.filter(Boolean), banned: false, banUntil: null };
}

// ── Helper: Build DFY notifications ─────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function buildDfyNotifications(admin: any, notifications: any[]) {
  if (!notifications.length) return [];

  const positionIds = Array.from(new Set(notifications.map((n: { position_id: string }) => n.position_id)));

  const [posRes, childrenRes, parentRes, scheduleRes] = await Promise.all([
    admin
      .from("nanny_positions")
      .select(
        "id, parent_id, suburb, schedule_type, hourly_rate, hours_per_week, days_required, level_of_support, urgency, start_date, placement_length, reason_for_nanny, language_preference, qualification_requirement, certificate_requirements, vaccination_required, drivers_license_required, car_required, comfortable_with_pets_required, non_smoker_required, other_requirements_details, description, dfy_tier"
      )
      .in("id", positionIds),
    admin
      .from("position_children")
      .select("position_id, age_months, gender")
      .in("position_id", positionIds)
      .order("display_order", { ascending: true }),
    admin.from("parents").select("id, user_id"),
    admin.from("position_schedule").select("position_id, schedule").in("position_id", positionIds),
  ]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const positionMap = new Map<string, any>((posRes.data || []).map((p: any) => [p.id, p]));
  const childrenByPosition = new Map<string, { ageMonths: number; gender: string | null }[]>();
  for (const c of childrenRes.data || []) {
    const arr = childrenByPosition.get(c.position_id) || [];
    arr.push({ ageMonths: c.age_months, gender: c.gender });
    childrenByPosition.set(c.position_id, arr);
  }

  const scheduleByPosition = new Map<string, Record<string, string[]>>(
    (scheduleRes.data || []).map((s: { position_id: string; schedule: Record<string, string[]> }) => [
      s.position_id,
      s.schedule,
    ])
  );

  // Get parent profiles
  const parentIds = Array.from(new Set((posRes.data || []).map((p: { parent_id: string }) => p.parent_id)));
  const allParents = (parentRes.data || []).filter((p: { id: string }) => parentIds.includes(p.id));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const parentMap = new Map<string, any>(allParents.map((p: any) => [p.id, p]));
  const parentUserIds = allParents.map((p: { user_id: string }) => p.user_id);

  const { data: parentProfiles } = await admin
    .from("user_profiles")
    .select("user_id, first_name, last_name, profile_picture_url")
    .in("user_id", parentUserIds.length > 0 ? parentUserIds : ["__none__"]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const parentProfileMap = new Map<string, any>(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (parentProfiles || []).map((p: any) => [p.user_id, p])
  );

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return notifications.map((n: any) => {
    const pos = positionMap.get(n.position_id);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const parent: any = pos ? parentMap.get(pos.parent_id) : null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const parentProfile: any = parent ? parentProfileMap.get(parent.user_id) : null;

    return {
      id: n.id,
      positionId: n.position_id,
      matchScore: n.match_score,
      distanceKm: n.distance_km,
      dfyTier: (pos?.dfy_tier as "standard" | "priority") || "standard",
      status: n.status,
      notifiedAt: n.notified_at,
      viewedAt: n.viewed_at,
      respondedAt: n.responded_at,
      position: {
        suburb: pos?.suburb ?? null,
        scheduleType: pos?.schedule_type ?? null,
        hourlyRate: pos?.hourly_rate ?? null,
        hoursPerWeek: pos?.hours_per_week ?? null,
        daysRequired: pos?.days_required ?? null,
        schedule: scheduleByPosition.get(n.position_id) ?? null,
        levelOfSupport: pos?.level_of_support ?? null,
        urgency: pos?.urgency ?? null,
        startDate: pos?.start_date ?? null,
        placementLength: pos?.placement_length ?? null,
        reasonForNanny: pos?.reason_for_nanny ?? null,
        languagePreference: pos?.language_preference ?? null,
        qualificationRequirement: pos?.qualification_requirement ?? null,
        certificateRequirements: pos?.certificate_requirements ?? null,
        vaccinationRequired: pos?.vaccination_required ?? null,
        driversLicenseRequired: pos?.drivers_license_required ?? null,
        carRequired: pos?.car_required ?? null,
        comfortableWithPetsRequired: pos?.comfortable_with_pets_required ?? null,
        nonSmokerRequired: pos?.non_smoker_required ?? null,
        otherRequirements: pos?.other_requirements_details ?? null,
        description: pos?.description ?? null,
        children: childrenByPosition.get(n.position_id) ?? [],
      },
      parent: {
        firstName: parentProfile?.first_name ?? "Family",
        lastName: parentProfile?.last_name ?? "",
        profilePicUrl: parentProfile?.profile_picture_url ?? null,
      },
    };
  });
}

// ── Helper: Build parent placement ──────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function buildParentPlacement(admin: any, parentId: string) {
  const { data: placement } = await admin
    .from("nanny_placements")
    .select("id, nanny_id, weekly_hours, hourly_rate, hired_at, start_date")
    .eq("parent_id", parentId)
    .eq("status", "active")
    .maybeSingle();

  if (!placement) return null;

  const { data: nanny } = await admin
    .from("nannies")
    .select("user_id, total_experience_years, nanny_experience_years, wwcc_verified, hourly_rate_min")
    .eq("id", placement.nanny_id)
    .single();

  let nannyName = "Your nanny";
  let nannySuburb = "";
  let nannyPhoto: string | null = null;
  let nannyDateOfBirth: string | null = null;
  let nannyEmail: string | null = null;
  let nannyPhone: string | null = null;

  if (nanny) {
    const { data: profile } = await admin
      .from("user_profiles")
      .select("first_name, last_name, suburb, profile_picture_url, date_of_birth, email, mobile_number")
      .eq("user_id", nanny.user_id)
      .single();

    if (profile) {
      nannyName = `${profile.first_name} ${profile.last_name}`;
      nannySuburb = profile.suburb || "";
      nannyPhoto = profile.profile_picture_url;
      nannyDateOfBirth = profile.date_of_birth;
      nannyEmail = profile.email || null;
      nannyPhone = profile.mobile_number || null;
    }
  }

  const { data: credentials } = await admin
    .from("nanny_credentials")
    .select("credential_category, qualification_type, certification_type")
    .eq("nanny_id", placement.nanny_id);

  let highestQualification: string | null = null;
  const certifications: string[] = [];
  for (const cred of credentials || []) {
    if (cred.credential_category === "qualification" && cred.qualification_type) {
      highestQualification = cred.qualification_type;
    }
    if (cred.credential_category === "certification" && cred.certification_type) {
      certifications.push(cred.certification_type);
    }
  }

  return {
    id: placement.id,
    nannyId: placement.nanny_id,
    nannyName,
    nannySuburb,
    nannyPhoto,
    nannyDateOfBirth,
    weeklyHours: placement.weekly_hours,
    hourlyRate: placement.hourly_rate,
    hiredAt: placement.hired_at,
    startDate: placement.start_date,
    nannyEmail,
    nannyPhone,
    totalExperienceYears: nanny?.total_experience_years ?? null,
    nannyExperienceYears: nanny?.nanny_experience_years ?? null,
    highestQualification,
    certifications,
    wwccVerified: nanny?.wwcc_verified ?? false,
    wwccExpiry: null,
    vaccinationStatus: false,
    nannyHourlyRate: nanny?.hourly_rate_min ?? null,
  };
}

// ── Helper: Build parent upcoming intros ────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function buildParentUpcomingIntros(admin: any, parentId: string) {
  const { data: connections } = await admin
    .from("connection_requests")
    .select(
      "id, nanny_id, connection_stage, confirmed_time, fill_initiated_by, trial_date, start_date, status, proposed_times, message, expires_at, nanny_phone_shared, source"
    )
    .eq("parent_id", parentId)
    .in("connection_stage", [
      CONNECTION_STAGE.REQUEST_SENT,
      CONNECTION_STAGE.ACCEPTED,
      CONNECTION_STAGE.INTRO_SCHEDULED,
      CONNECTION_STAGE.INTRO_COMPLETE,
      CONNECTION_STAGE.AWAITING_RESPONSE,
      CONNECTION_STAGE.TRIAL_ARRANGED,
      CONNECTION_STAGE.TRIAL_COMPLETE,
      CONNECTION_STAGE.OFFERED,
      CONNECTION_STAGE.CONFIRMED,
      CONNECTION_STAGE.ACTIVE,
    ])
    .order("created_at", { ascending: false });

  if (!connections || connections.length === 0) return [];

  const nannyIds = Array.from(new Set(connections.map((c: { nanny_id: string }) => c.nanny_id)));
  const { data: nannies } = await admin.from("nannies").select("id, user_id").in("id", nannyIds);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const nannyMap = new Map<string, any>((nannies || []).map((n: any) => [n.id, n]));
  const nannyUserIds = (nannies || []).map((n: { user_id: string }) => n.user_id);

  const { data: profiles } = await admin
    .from("user_profiles")
    .select("user_id, first_name, last_name, suburb, profile_picture_url")
    .in("user_id", nannyUserIds);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const profileMap = new Map<string, any>((profiles || []).map((p: any) => [p.user_id, p]));

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return connections.map((c: any) => {
    const nanny = nannyMap.get(c.nanny_id);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const profile: any = nanny ? profileMap.get(nanny.user_id) : null;
    return {
      connectionId: c.id,
      otherPartyName: profile ? `${profile.first_name} ${profile.last_name}` : "Unknown",
      otherPartySuburb: profile?.suburb || "",
      otherPartyPhoto: profile?.profile_picture_url || null,
      confirmedTime: c.confirmed_time || "",
      connectionStage: c.connection_stage,
      fillInitiatedBy: c.fill_initiated_by ?? null,
      trialDate: c.trial_date ?? null,
      startDate: c.start_date ?? null,
      status: c.status,
      proposedTimes: c.proposed_times ?? null,
      message: c.message ?? null,
      expiresAt: c.expires_at ?? null,
      nannyPhoneShared: c.nanny_phone_shared ?? null,
      source: c.source ?? null,
      nannyId: c.nanny_id,
      positionId: null,
      position: null,
    };
  });
}

// ── Helper: Build DFY status ────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function buildDfyStatus(admin: any, parentId: string) {
  const defaultResult = {
    activated: false,
    activatedAt: null as string | null,
    expiresAt: null as string | null,
    expired: false,
    notifiedCount: 0,
    interestedCount: 0,
    connectedCount: 0,
    tier: null as "standard" | "priority" | null,
    maxRespondents: 5,
    positionId: null as string | null,
  };

  const { data: position } = await admin
    .from("nanny_positions")
    .select("id, dfy_activated_at, dfy_expires_at, dfy_wave_sent, dfy_tier")
    .eq("parent_id", parentId)
    .in("status", ["active", "filled"])
    .maybeSingle();

  if (!position) return defaultResult;
  if (!position.dfy_activated_at) return { ...defaultResult, positionId: position.id };

  const activatedTier = (position.dfy_tier as "standard" | "priority") || "standard";
  const isExpired = position.dfy_expires_at
    ? new Date(position.dfy_expires_at) <= new Date()
    : false;

  const { data: notifications } = await admin
    .from("dfy_match_notifications")
    .select("status")
    .eq("position_id", position.id);

  let interestedCount = 0;
  for (const n of notifications ?? []) {
    if (n.status === "interested") interestedCount++;
  }

  const { count: connectedCount } = await admin
    .from("connection_requests")
    .select("id", { count: "exact", head: true })
    .eq("position_id", position.id)
    .eq("source", "dfy");

  return {
    activated: true,
    activatedAt: position.dfy_activated_at,
    expiresAt: position.dfy_expires_at,
    expired: isExpired,
    notifiedCount: (notifications ?? []).length,
    interestedCount,
    connectedCount: connectedCount ?? 0,
    tier: activatedTier,
    maxRespondents: activatedTier === "priority" ? 10 : 5,
    positionId: position.id,
  };
}

// ── Helper: Build parent babysitting requests ───────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function buildParentBabysittingRequests(admin: any, parentId: string) {
  const { data: bsrs } = await admin
    .from("babysitting_requests")
    .select("*")
    .eq("parent_id", parentId)
    .order("created_at", { ascending: false });

  if (!bsrs || bsrs.length === 0) return [];

  const bsrIds = bsrs.map((b: { id: string }) => b.id);

  const { data: allSlots } = await admin
    .from("bsr_time_slots")
    .select("id, babysitting_request_id, slot_date, start_time, end_time, is_selected")
    .in("babysitting_request_id", bsrIds);

  const slotMap = new Map<string, typeof allSlots>();
  for (const slot of allSlots ?? []) {
    const existing = slotMap.get(slot.babysitting_request_id) ?? [];
    existing.push(slot);
    slotMap.set(slot.babysitting_request_id, existing);
  }

  // Get accepted nanny details
  const acceptedNannyIds = bsrs
    .filter((b: { accepted_nanny_id: string | null }) => b.accepted_nanny_id)
    .map((b: { accepted_nanny_id: string }) => b.accepted_nanny_id);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const nannyDetailsMap = new Map<string, any>();

  if (acceptedNannyIds.length > 0) {
    const { data: nannies } = await admin
      .from("nannies")
      .select("id, user_id")
      .in("id", acceptedNannyIds);

    if (nannies) {
      const userIds = nannies.map((n: { user_id: string }) => n.user_id);
      const { data: profiles } = await admin
        .from("user_profiles")
        .select("user_id, first_name, last_name, date_of_birth, suburb, profile_picture_url, mobile_number")
        .in("user_id", userIds);

      for (const nanny of nannies) {
        const profile = (profiles || []).find((p: { user_id: string }) => p.user_id === nanny.user_id);
        if (profile) {
          nannyDetailsMap.set(nanny.id, {
            firstName: profile.first_name ?? "",
            lastName: profile.last_name ?? "",
            dateOfBirth: profile.date_of_birth ?? null,
            suburb: profile.suburb,
            profilePicUrl: profile.profile_picture_url,
            distanceKm: null,
            phone: profile.mobile_number ?? null,
          });
        }
      }
    }
  }

  // Get requesting nannies for open BSRs
  const openBsrIds = bsrs.filter((b: { status: string }) => b.status === "open").map((b: { id: string }) => b.id);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const requestingNanniesMap = new Map<string, any[]>();

  if (openBsrIds.length > 0) {
    const { data: requestNotifs } = await admin
      .from("bsr_notifications")
      .select("babysitting_request_id, nanny_id, distance_km, requested_at")
      .in("babysitting_request_id", openBsrIds)
      .not("requested_at", "is", null)
      .is("declined_at", null)
      .is("accepted_at", null);

    if (requestNotifs && requestNotifs.length > 0) {
      const reqNannyIds = requestNotifs.map((n: { nanny_id: string }) => n.nanny_id);
      const { data: reqNannies } = await admin
        .from("nannies")
        .select("id, user_id, total_experience_years, hourly_rate_min, verification_tier, verification_level, languages")
        .in("id", reqNannyIds);

      const reqUserIds = (reqNannies ?? []).map((n: { user_id: string }) => n.user_id);
      const { data: reqProfiles } = await admin
        .from("user_profiles")
        .select("user_id, first_name, last_name, date_of_birth, suburb, profile_picture_url")
        .in("user_id", reqUserIds);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const reqNannyMap = new Map<string, any>((reqNannies ?? []).map((n: any) => [n.id, n]));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const reqProfileByUserId = new Map<string, any>((reqProfiles ?? []).map((p: any) => [p.user_id, p]));

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for (const notif of requestNotifs as any[]) {
        const nanny = reqNannyMap.get(notif.nanny_id);
        if (!nanny) continue;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const profile: any = reqProfileByUserId.get(nanny.user_id);
        if (!profile) continue;

        const entry = {
          nannyId: notif.nanny_id,
          firstName: profile.first_name ?? "",
          lastName: profile.last_name ?? "",
          dateOfBirth: profile.date_of_birth ?? null,
          suburb: profile.suburb,
          profilePicUrl: profile.profile_picture_url,
          distanceKm: notif.distance_km != null ? Math.floor(Number(notif.distance_km)) : null,
          requestedAt: notif.requested_at,
          experienceYears: nanny.total_experience_years,
          hourlyRateMin: nanny.hourly_rate_min ? Number(nanny.hourly_rate_min) : null,
          verificationTier: nanny.verification_tier,
          verificationLevel: nanny.verification_level ?? 0,
          aiHeadline: null,
          languages: nanny.languages,
        };

        const existing = requestingNanniesMap.get(notif.babysitting_request_id) ?? [];
        existing.push(entry);
        requestingNanniesMap.set(notif.babysitting_request_id, existing);
      }
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return bsrs.map((bsr: any) => {
    const bsrSlots = (slotMap.get(bsr.id) ?? []).map((s: { id: string; slot_date: string; start_time: string; end_time: string; is_selected: boolean }) => ({
      id: s.id,
      slot_date: s.slot_date,
      start_time: s.start_time,
      end_time: s.end_time,
      is_selected: s.is_selected,
    }));

    return {
      id: bsr.id,
      parent_id: bsr.parent_id,
      title: bsr.title,
      description: bsr.description,
      special_requirements: bsr.special_requirements,
      suburb: bsr.suburb,
      postcode: bsr.postcode,
      address: bsr.address ?? null,
      hourly_rate: bsr.hourly_rate ? Number(bsr.hourly_rate) : null,
      status: bsr.status,
      accepted_nanny_id: bsr.accepted_nanny_id,
      accepted_at: bsr.accepted_at,
      nannies_notified_count: bsr.nannies_notified_count ?? 0,
      created_at: bsr.created_at,
      expires_at: bsr.expires_at,
      cancelled_by: bsr.cancelled_by,
      slots: bsrSlots,
      acceptedNanny: bsr.accepted_nanny_id ? nannyDetailsMap.get(bsr.accepted_nanny_id) : undefined,
      requestingNannies: requestingNanniesMap.get(bsr.id) ?? [],
    };
  });
}
