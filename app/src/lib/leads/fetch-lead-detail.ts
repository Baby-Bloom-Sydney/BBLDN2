// T-032 — Drawer detail fetcher. Pulls the full nanny-360 for one user.

import { createAdminClient } from "@/lib/supabase/admin";
import { payoutsEnabled } from "@/lib/payments/flags";
import {
  CONNECTION_STAGE_LABELS,
  type ConnectionStage,
} from "@/lib/position/constants";
import type { LeadContact, LeadNote, NannyContactState } from "./types";

export interface LeadDetail {
  nanny_user_id: string;
  nanny_id: string | null;
  user_profile: {
    first_name: string | null;
    last_name: string | null;
    email: string | null;
    mobile_number: string | null;
    suburb: string | null;
    postcode: string | null;
    address_line1: string | null;
    address_line2: string | null;
    state: string | null;
    profile_picture_url: string | null;
    date_of_birth: string | null;
  } | null;
  nanny: {
    id: string;
    user_id: string;
    created_at: string;
    status: string | null;
    verification_level: number | null;
    abn: string | null;
    abn_updated_at: string | null;
    abn_push_flagged_at: string | null;
    bonus_program_completed_at: string | null;
    bonus_program_dismissed_at: string | null;
    payouts_enabled: boolean | null;
    charges_enabled: boolean | null;
    payout_application_status: string | null;
    deactivated_at: string | null;
    babysitter_eligible: boolean | null;
  } | null;
  verifications: {
    identity_verified: boolean | null;
    identity_verified_at: string | null;
    wwcc_verified: boolean | null;
    wwcc_verified_at: string | null;
    wwcc_expiry_date: string | null;
    wwcc_number: string | null;
    verification_status: number | null;
    ocg_result_status: string | null;
    ocg_recorded_at: string | null;
  } | null;
  contact_state: NannyContactState | null;
  contacts: LeadContact[];
  notes: LeadNote | null;
  nanny_lead: Record<string, unknown> | null;
  /**
   * All children on the nanny's account — sourced from `child_client.nanny_user_id`,
   * excluding closed records. This is broader than "linked" — it includes
   * children whose parent is NOT yet on BB (parent_user_id null) AND children
   * whose parent IS on BB and connected via an invite.
   *
   * `parent_connected` is true when the child has a parent_user_id (= parent
   * has a Baby Bloom account, regardless of whether they ever accepted an
   * invite — the column is set when the parent_user_id resolves).
   *
   * `invite_status` is the most-recent `child_invites.status` for this child
   * (`pending` / `connected` / `declined` / `revoked` / null = no invite exists).
   *
   * `bonus_program` is true if ANY invite for this child has `bonus_program=true`.
   */
  children_linked: Array<{
    child_client_id: string;
    child_first_name: string | null;
    child_date_of_birth: string | null;
    child_age_months_approx: number | null;
    child_status: string;
    parent_user_id: string | null;
    parent_connected: boolean;
    invite_status: string | null;
    bonus_program: boolean;
    family_trial_started_at: string | null;
    created_at: string;
  }>;
  placements: Array<{
    id: string;
    parent_id: string;
    source: string | null;
    status: string;
    hired_at: string | null;
    ended_at: string | null;
    end_reason: string | null;
  }>;
  interview_requests: Array<{
    id: string;
    parent_id: string;
    position_id: string | null;
    status: string;
    responded_at: string | null;
    interview_date: string | null;
    outcome: string | null;
    created_at: string;
  }>;
  babysitting_notifications: Array<{
    id: string;
    babysitting_request_id: string;
    notified_at: string;
    accepted_at: string | null;
    declined_at: string | null;
    distance_km: number | null;
  }>;
  /**
   * Lookup of parent_user_id → display details. Populated from any
   * child_invites + placements + interview_requests that reference a
   * parent on this nanny. Used by the drawer's children/positions section
   * to render parent names + hyperlinks to /admin/users?openUser={id}.
   */
  parent_directory: Record<
    string,
    {
      first_name: string | null;
      last_name: string | null;
      email: string | null;
    }
  >;
  /**
   * parent_user_id → most-recent `parent_subscriptions` row for that parent.
   * Lets the drawer show "Trial · ends Apr 12" or "Active monthly" next to
   * each linked child so the operator knows where the parent's money sits
   * before the call.
   */
  subscription_directory: Record<
    string,
    {
      status: string;
      trial_ends_at: string | null;
      paid_period_ends_at: string | null;
      cancelled_at: string | null;
    }
  >;
  /**
   * The nanny's authoritative weekly schedule from the `nanny_availability`
   * table — `days_available` is a string[] of day names, `schedule` is a
   * day-keyed object (Mon..Sun lowercased) whose values describe time-slot
   * coverage (consumed by the existing `AvailabilityGrid` component).
   * Distinct from the funnel-captured `nanny_leads.availability` JSONB,
   * which has the start/end-date + immediate-start signup answers.
   */
  availability: {
    days_available: string[];
    schedule: Record<string, unknown>;
  } | null;
  last_sign_in_at: string | null;
}

export async function fetchLeadDetail(
  nannyUserId: string,
): Promise<LeadDetail | null> {
  const supa = createAdminClient();

  const [
    profileRes,
    nannyRes,
    verificationsRes,
    contactStateRes,
    contactsRes,
    notesRes,
    nannyLeadRes,
    childrenRes,
    placementsRes,
    interviewsRes,
    bsrRes,
    availabilityRes,
    authRes,
  ] = await Promise.all([
    supa
      .from("user_profiles")
      .select(
        "first_name, last_name, email, mobile_number, suburb, postcode, address_line1, address_line2, state, profile_picture_url, date_of_birth",
      )
      .eq("user_id", nannyUserId)
      .maybeSingle(),
    // SELECT * so missing T-020 (`abn`, `abn_*`) or T-022
    // (`bonus_program_completed_at`, `bonus_program_*`) columns don't fail
    // the whole query with code 42703. Nullish-coalesce when reading.
    supa.from("nannies").select("*").eq("user_id", nannyUserId).maybeSingle(),
    supa
      .from("verifications")
      .select(
        "identity_verified, identity_verified_at, wwcc_verified, wwcc_verified_at, wwcc_expiry_date, wwcc_number, verification_status, ocg_result_status, ocg_recorded_at",
      )
      .eq("user_id", nannyUserId)
      .maybeSingle(),
    supa
      .from("nanny_contact_state")
      .select("*")
      .eq("nanny_user_id", nannyUserId)
      .maybeSingle(),
    supa
      .from("lead_contacts")
      .select("*")
      .eq("nanny_user_id", nannyUserId)
      .order("contacted_at", { ascending: false })
      .limit(100),
    supa
      .from("lead_notes")
      .select("*")
      .eq("nanny_user_id", nannyUserId)
      .maybeSingle(),
    supa
      .from("nanny_leads")
      .select("*")
      .eq("auth_user_id", nannyUserId)
      .maybeSingle(),
    // Children on this nanny's account — canonical link via child_client.
    // Exclude `closed` (relationship ended). All other status values count
    // as "this nanny has this child".
    supa
      .from("child_client")
      .select(
        "id, first_name, date_of_birth, age_months_approx, parent_user_id, status, created_at",
      )
      .eq("nanny_user_id", nannyUserId)
      .neq("status", "closed")
      .order("created_at", { ascending: false }),
    nannyOnlyPlacements(supa, nannyUserId),
    nannyOnlyInterviews(supa, nannyUserId),
    nannyOnlyBabysitting(supa, nannyUserId),
    nannyOnlyAvailability(supa, nannyUserId),
    supa.auth.admin.getUserById(nannyUserId),
  ]);

  // Sanity: if no nanny record + no profile, nanny doesn't exist or not a nanny.
  if (!profileRes.data && !nannyRes.data) return null;

  // Hydrate per-child metadata for the drawer's children section.
  // 1) For each child, find the most-recent child_invites row (gives invite
  //    status + bonus_program flag + family_trial_started_at)
  // 2) Collect parent_user_ids from children + placements + interview_requests
  // 3) Load user_profiles for that distinct set
  // 4) Load parent_subscriptions (1 row per parent) for those parents
  const childClientRows = (childrenRes.data ?? []) as Array<{
    id: string;
    first_name: string | null;
    date_of_birth: string | null;
    age_months_approx: number | null;
    parent_user_id: string | null;
    status: string;
    created_at: string;
  }>;
  const childClientIds = childClientRows.map((r) => r.id);

  // SELECT * — child_invites.bonus_program (T-022) may not exist in the DB
  // yet. Nullish-coalesce when reading. Other columns (status,
  // family_trial_started_at, created_at) are pre-T-022 and stable.
  const [invitesRes] = await Promise.all([
    childClientIds.length > 0
      ? supa
          .from("child_invites")
          .select("*")
          .in("child_client_id", childClientIds)
          .order("created_at", { ascending: false })
      : Promise.resolve({
          data: [] as Array<Record<string, unknown>>,
        }),
  ]);

  // Group invites by child_client_id, latest first per group.
  // Tolerate missing T-022 `bonus_program` column → defaults to false.
  const invitesByChild = new Map<
    string,
    Array<{
      status: string;
      bonus_program: boolean;
      family_trial_started_at: string | null;
      created_at: string;
    }>
  >();
  for (const raw of (invitesRes.data ?? []) as Array<Record<string, unknown>>) {
    const childClientId = raw.child_client_id;
    if (typeof childClientId !== "string") continue;
    const inv = {
      status: typeof raw.status === "string" ? raw.status : "",
      bonus_program: raw.bonus_program === true,
      family_trial_started_at:
        typeof raw.family_trial_started_at === "string"
          ? raw.family_trial_started_at
          : null,
      created_at: typeof raw.created_at === "string" ? raw.created_at : "",
    };
    const list = invitesByChild.get(childClientId) ?? [];
    list.push(inv);
    invitesByChild.set(childClientId, list);
  }

  // Stitch per-child detail.
  const childrenLinked = childClientRows.map((c) => {
    const invites = invitesByChild.get(c.id) ?? [];
    const latestInvite = invites[0];
    const bonus = invites.some((i) => i.bonus_program === true);
    const familyTrialStartedAt =
      invites.find((i) => i.family_trial_started_at)?.family_trial_started_at ??
      null;
    return {
      child_client_id: c.id,
      child_first_name: c.first_name,
      child_date_of_birth: c.date_of_birth,
      child_age_months_approx: c.age_months_approx,
      child_status: c.status,
      parent_user_id: c.parent_user_id,
      parent_connected: Boolean(c.parent_user_id),
      invite_status: latestInvite?.status ?? null,
      bonus_program: bonus,
      family_trial_started_at: familyTrialStartedAt,
      created_at: c.created_at,
    };
  });

  // Build the parent_directory + subscription_directory from all distinct
  // parent_user_ids (children + placements + interview_requests).
  const parentUserIds = Array.from(
    new Set(
      [
        ...childrenLinked.map((c) => c.parent_user_id),
        ...placementsRes.map((p) => p.parent_id),
        ...interviewsRes.map((i) => i.parent_id),
      ].filter((id): id is string => Boolean(id)),
    ),
  );

  const parentDirectory: LeadDetail["parent_directory"] = {};
  const subscriptionDirectory: LeadDetail["subscription_directory"] = {};
  if (parentUserIds.length > 0) {
    const [parentProfilesRes, subscriptionsRes] = await Promise.all([
      supa
        .from("user_profiles")
        .select("user_id, first_name, last_name, email")
        .in("user_id", parentUserIds),
      supa
        .from("parent_subscriptions")
        .select(
          "parent_user_id, status, trial_ends_at, paid_period_ends_at, cancelled_at, updated_at",
        )
        .in("parent_user_id", parentUserIds),
    ]);
    for (const p of (parentProfilesRes.data ?? []) as Array<{
      user_id: string;
      first_name: string | null;
      last_name: string | null;
      email: string | null;
    }>) {
      parentDirectory[p.user_id] = {
        first_name: p.first_name,
        last_name: p.last_name,
        email: p.email,
      };
    }
    // Subscriptions: 1 row per parent expected; if multiple, take latest updated.
    const subSeen = new Map<string, string>(); // parent_user_id → updated_at
    for (const s of (subscriptionsRes.data ?? []) as Array<{
      parent_user_id: string;
      status: string;
      trial_ends_at: string | null;
      paid_period_ends_at: string | null;
      cancelled_at: string | null;
      updated_at: string | null;
    }>) {
      const prevTs = subSeen.get(s.parent_user_id);
      if (prevTs && s.updated_at && s.updated_at < prevTs) continue;
      subscriptionDirectory[s.parent_user_id] = {
        status: s.status,
        trial_ends_at: s.trial_ends_at,
        paid_period_ends_at: s.paid_period_ends_at,
        cancelled_at: s.cancelled_at,
      };
      if (s.updated_at) subSeen.set(s.parent_user_id, s.updated_at);
    }
  }

  // Coerce nannyRes.data (typed as Record<string, unknown> from SELECT *)
  // into the typed LeadDetail.nanny shape, treating any missing columns
  // (e.g. unapplied T-020 / T-022) as null rather than failing.
  const rawNanny = nannyRes.data as Record<string, unknown> | null;
  const nannyShaped: LeadDetail["nanny"] = rawNanny
    ? {
        id: typeof rawNanny.id === "string" ? rawNanny.id : "",
        user_id:
          typeof rawNanny.user_id === "string" ? rawNanny.user_id : nannyUserId,
        created_at:
          typeof rawNanny.created_at === "string" ? rawNanny.created_at : "",
        status: typeof rawNanny.status === "string" ? rawNanny.status : null,
        verification_level:
          typeof rawNanny.verification_level === "number"
            ? rawNanny.verification_level
            : null,
        // 4-w5fix (W5-M2, P-23): the tax ID is not sent unless PAYOUTS_ENABLED.
        abn: payoutsEnabled() && typeof rawNanny.abn === "string" ? rawNanny.abn : null,
        abn_updated_at:
          typeof rawNanny.abn_updated_at === "string"
            ? rawNanny.abn_updated_at
            : null,
        abn_push_flagged_at:
          typeof rawNanny.abn_push_flagged_at === "string"
            ? rawNanny.abn_push_flagged_at
            : null,
        bonus_program_completed_at:
          typeof rawNanny.bonus_program_completed_at === "string"
            ? rawNanny.bonus_program_completed_at
            : null,
        bonus_program_dismissed_at:
          typeof rawNanny.bonus_program_dismissed_at === "string"
            ? rawNanny.bonus_program_dismissed_at
            : null,
        payouts_enabled:
          typeof rawNanny.payouts_enabled === "boolean"
            ? rawNanny.payouts_enabled
            : null,
        charges_enabled:
          typeof rawNanny.charges_enabled === "boolean"
            ? rawNanny.charges_enabled
            : null,
        payout_application_status:
          typeof rawNanny.payout_application_status === "string"
            ? rawNanny.payout_application_status
            : null,
        deactivated_at:
          typeof rawNanny.deactivated_at === "string"
            ? rawNanny.deactivated_at
            : null,
        babysitter_eligible:
          typeof rawNanny.babysitter_eligible === "boolean"
            ? rawNanny.babysitter_eligible
            : null,
      }
    : null;

  return {
    nanny_user_id: nannyUserId,
    nanny_id: nannyShaped?.id ?? null,
    user_profile: profileRes.data ?? null,
    nanny: nannyShaped,
    verifications: verificationsRes.data ?? null,
    contact_state: (contactStateRes.data ?? null) as NannyContactState | null,
    contacts: (contactsRes.data ?? []) as LeadContact[],
    notes: (notesRes.data ?? null) as LeadNote | null,
    nanny_lead: (nannyLeadRes.data ?? null) as Record<string, unknown> | null,
    children_linked: childrenLinked,
    placements: placementsRes,
    interview_requests: interviewsRes,
    babysitting_notifications: bsrRes,
    availability: availabilityRes,
    parent_directory: parentDirectory,
    subscription_directory: subscriptionDirectory,
    last_sign_in_at: authRes.data?.user?.last_sign_in_at ?? null,
  };
}

async function nannyOnlyPlacements(
  supa: ReturnType<typeof createAdminClient>,
  nannyUserId: string,
): Promise<LeadDetail["placements"]> {
  // nanny_placements joins on nanny_id (the nannies.id), not user_id.
  // Two-step: fetch nanny row to get id, then placements.
  const { data: n } = await supa
    .from("nannies")
    .select("id")
    .eq("user_id", nannyUserId)
    .maybeSingle<{ id: string }>();
  if (!n) return [];
  const { data } = await supa
    .from("nanny_placements")
    .select("id, parent_id, source, status, hired_at, ended_at, end_reason")
    .eq("nanny_id", n.id)
    .order("hired_at", { ascending: false, nullsFirst: false });
  return data ?? [];
}

async function nannyOnlyInterviews(
  supa: ReturnType<typeof createAdminClient>,
  nannyUserId: string,
): Promise<LeadDetail["interview_requests"]> {
  const { data: n } = await supa
    .from("nannies")
    .select("id")
    .eq("user_id", nannyUserId)
    .maybeSingle<{ id: string }>();
  if (!n) return [];
  // 5e (R-4): the legacy `interview_requests` table does not exist in the
  // London schema; its rows live in `connection_requests`. Mapped into the
  // unchanged `interview_requests` shape: stage label → outcome, meet time
  // → interview_date, and the parent's auth user id → parent_id (the key
  // `parent_directory` and the drawer's parent link use).
  const { data } = await supa
    .from("connection_requests")
    .select(
      "id, position_id, status, responded_at, connection_stage, confirmed_time, created_at, parents:parents!inner(user_id)",
    )
    .eq("nanny_id", n.id)
    .order("created_at", { ascending: false })
    .limit(30);
  return ((data ?? []) as unknown as ConnectionRequestRow[]).map(
    toInterviewRow,
  );
}

interface ConnectionRequestRow {
  id: string;
  position_id: string | null;
  status: string;
  responded_at: string | null;
  connection_stage: number | null;
  confirmed_time: string | null;
  created_at: string;
  // A many-to-one embed arrives as an object; the untyped client infers an
  // array, so both are accepted (same handling as lib/chat/bot.ts:319–323).
  parents: { user_id: string } | Array<{ user_id: string }> | null;
}

function toInterviewRow(
  r: ConnectionRequestRow,
): LeadDetail["interview_requests"][number] {
  return {
    id: r.id,
    parent_id:
      (Array.isArray(r.parents) ? r.parents[0] : r.parents)?.user_id ?? "",
    position_id: r.position_id,
    status: r.status,
    responded_at: r.responded_at,
    interview_date: r.confirmed_time,
    outcome:
      r.connection_stage === null
        ? null
        : (CONNECTION_STAGE_LABELS[r.connection_stage as ConnectionStage] ??
          null),
    created_at: r.created_at,
  };
}

async function nannyOnlyBabysitting(
  supa: ReturnType<typeof createAdminClient>,
  nannyUserId: string,
): Promise<LeadDetail["babysitting_notifications"]> {
  const { data: n } = await supa
    .from("nannies")
    .select("id")
    .eq("user_id", nannyUserId)
    .maybeSingle<{ id: string }>();
  if (!n) return [];
  const { data } = await supa
    .from("bsr_notifications")
    .select(
      "id, babysitting_request_id, notified_at, accepted_at, declined_at, distance_km",
    )
    .eq("nanny_id", n.id)
    .order("notified_at", { ascending: false })
    .limit(30);
  return data ?? [];
}

async function nannyOnlyAvailability(
  supa: ReturnType<typeof createAdminClient>,
  nannyUserId: string,
): Promise<LeadDetail["availability"]> {
  const { data: n } = await supa
    .from("nannies")
    .select("id")
    .eq("user_id", nannyUserId)
    .maybeSingle<{ id: string }>();
  if (!n) return null;
  const { data } = await supa
    .from("nanny_availability")
    .select("days_available, schedule")
    .eq("nanny_id", n.id)
    .maybeSingle<{
      days_available: string[] | null;
      schedule: Record<string, unknown> | null;
    }>();
  if (!data) return null;
  return {
    days_available: Array.isArray(data.days_available)
      ? data.days_available
      : [],
    schedule:
      data.schedule && typeof data.schedule === "object" ? data.schedule : {},
  };
}
