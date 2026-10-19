// T-032 — Server-side fetcher for the leads list.
//
// Reads from `nannies` (every signed-up nanny) + INNER JOINs `user_profiles`
// (always present per signup flow) + LEFT JOINs `verifications` +
// `nanny_contact_state`. Filters that map cleanly to direct columns are
// pushed server-side; tab-derived filters (worklist composition) +
// responded-derived filters are applied in JS after fetch.
//
// At thousands of rows this is pragmatic — every request fetches at most
// one page (default 50). If perf demands later, swap for a Postgres RPC.

import { createAdminClient } from "@/lib/supabase/admin";
import { payoutsEnabled } from "@/lib/payments/flags";
import type {
  LeadQueryState,
  LeadRow,
  NannyContactState,
  VerificationSnapshot,
} from "./types";
import { buildSortSpec, paginationRange } from "./query-builder";

interface NannyJoinedRow {
  id: string;
  user_id: string;
  created_at: string;
  verification_level: number | null;
  bonus_program_completed_at: string | null;
  abn: string | null;
  user_profiles: {
    first_name: string | null;
    last_name: string | null;
    email: string | null;
    mobile_number: string | null;
    suburb: string | null;
    profile_picture_url: string | null;
  } | null;
  verifications: {
    identity_verified: boolean | null;
    wwcc_verified: boolean | null;
    verification_status: number | null;
  } | null;
  nanny_contact_state: NannyContactState | null;
}

export interface LeadsPage {
  rows: LeadRow[];
  total: number;
  page: number;
  pageSize: number;
}

export interface LeadsAggregateStats {
  newThisWeek: number;
  contactedThisWeek: number;
  activatedThisWeek: number;
  totalNannies: number;
}

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const FOURTEEN_DAYS_MS = 14 * 24 * 60 * 60 * 1000;
const FIVE_DAYS_MS = 5 * 24 * 60 * 60 * 1000;

/**
 * Apply user_profiles-side filters (search, suburb) by first resolving the
 * candidate user_id set, returning null if no filters are present.
 */
async function resolveProfileFilterUserIds(
  state: LeadQueryState,
): Promise<string[] | null> {
  const supa = createAdminClient();
  const hasFilter =
    Boolean(state.filters.search) || Boolean(state.filters.suburb);
  if (!hasFilter) return null;

  let q = supa.from("user_profiles").select("user_id");

  if (state.filters.suburb) {
    q = q.eq("suburb", state.filters.suburb);
  }

  if (state.filters.search) {
    const pattern = `%${state.filters.search.replace(/[%_]/g, (m) => `\\${m}`)}%`;
    q = q.or(
      `first_name.ilike.${pattern},last_name.ilike.${pattern},email.ilike.${pattern},mobile_number.ilike.${pattern}`,
    );
  }

  const { data, error } = await q;
  if (error || !data) return [];
  return data.map((r) => r.user_id);
}

/**
 * Resolve the set of user_ids that match a per-dimension verification filter.
 * Returns null if no verification filters are present.
 */
async function resolveVerificationFilterUserIds(
  state: LeadQueryState,
): Promise<string[] | null> {
  const supa = createAdminClient();
  const f = state.filters;
  const needsVerificationsFilter = f.wwcc !== "any" || f.gov_id !== "any";

  if (!needsVerificationsFilter) return null;

  let q = supa.from("verifications").select("user_id");

  if (f.wwcc === "has") q = q.eq("wwcc_verified", true);
  if (f.wwcc === "missing") q = q.not("wwcc_verified", "is", true);
  if (f.gov_id === "has") q = q.eq("identity_verified", true);
  if (f.gov_id === "missing") q = q.not("identity_verified", "is", true);

  const { data, error } = await q;
  if (error || !data) return [];
  return data.map((r) => r.user_id);
}

/**
 * Apply tab-specific filters at the query level where possible. Returns the
 * patched query.
 */
function applyTabFilter(
  state: LeadQueryState,
  userIds: string[] | null,
): { afterFetch: (rows: LeadRow[]) => LeadRow[] } {
  // Some tabs are best applied post-fetch because they depend on derived
  // computations (cold_7d, verification_stuck, etc.). Keep the query simple
  // server-side; apply the predicates here.
  const now = Date.now();
  switch (state.filters.tab) {
    case "all":
      return { afterFetch: (rows) => rows };
    case "never_contacted":
      return {
        afterFetch: (rows) =>
          rows.filter((r) => r.total_contacts_derived === 0),
      };
    case "snoozed_today":
      return {
        afterFetch: (rows) =>
          rows.filter((r) => {
            const next = r.contact_state?.next_action_at;
            if (!next) return false;
            const t = new Date(next).getTime();
            // Surface anything due on or before end-of-today.
            const endOfToday = new Date();
            endOfToday.setHours(23, 59, 59, 999);
            return t <= endOfToday.getTime();
          }),
      };
    case "cold_7d":
      return {
        afterFetch: (rows) =>
          rows.filter((r) => {
            const last = r.contact_state?.last_contact_at;
            if (!last) return false; // Never contacted = caught by another tab.
            const t = new Date(last).getTime();
            if (now - t < SEVEN_DAYS_MS) return false;
            const status = r.contact_state?.lead_status ?? "untouched";
            return status !== "do_not_contact" && status !== "dormant";
          }),
      };
    case "verification_stuck":
      return {
        afterFetch: (rows) =>
          rows.filter((r) => {
            const v = r.verification;
            const hasOne =
              v.identity_verified === true ||
              (r.bonus_program_completed_at === null &&
                r.children_linked_count > 0);
            const lvl = v.verification_level ?? 0;
            return hasOne && lvl < 4;
          }),
      };
    case "responded":
      return {
        afterFetch: (rows) =>
          rows.filter(
            (r) =>
              r.responded_ever_derived && r.bonus_program_completed_at === null,
          ),
      };
    case "activated":
      return {
        afterFetch: (rows) =>
          rows.filter((r) => r.bonus_program_completed_at !== null),
      };
    case "dormant":
      return {
        afterFetch: (rows) =>
          rows.filter((r) => r.contact_state?.lead_status === "dormant"),
      };
    case "worklist":
    default:
      // Worklist = union of: untouched-and-fresh, snoozed-due, cold>7d,
      // verification-stuck, responded-not-activated, fresh<14d.
      return {
        afterFetch: (rows) =>
          rows.filter((r) => {
            const status = r.contact_state?.lead_status ?? "untouched";
            if (status === "do_not_contact" || status === "dormant")
              return false;

            const signupAge = now - new Date(r.signup_at).getTime();
            const last = r.contact_state?.last_contact_at;
            const lastAge = last ? now - new Date(last).getTime() : null;
            const next = r.contact_state?.next_action_at;
            const nextDue = next ? new Date(next).getTime() <= now : false;

            if (r.total_contacts_derived === 0 && signupAge < FOURTEEN_DAYS_MS)
              return true;
            if (nextDue) return true;
            if (lastAge !== null && lastAge > SEVEN_DAYS_MS) return true;
            if (
              r.responded_ever_derived &&
              r.bonus_program_completed_at === null
            )
              return true;

            // Verification stuck: has some doc, still not at level 4, last
            // verification activity > 5 days ago. Cheap proxy.
            const v = r.verification;
            const lvl = v.verification_level ?? 0;
            if (
              v.identity_verified === true &&
              lvl < 4 &&
              signupAge > FIVE_DAYS_MS
            ) {
              return true;
            }

            return false;
          }),
      };
  }
  // Userids parameter is unused for now; reserved for future tab joins.
  void userIds;
}

/**
 * Hydrate denormalised aggregates (total_contacts_derived, responded_ever_derived,
 * children_linked_count, bonus_children_count) for a batch of nanny user_ids.
 */
async function hydrateAggregates(userIds: string[]): Promise<
  Map<
    string,
    {
      total_contacts: number;
      responded_ever: boolean;
      children_linked: number;
      parent_linked_children: number;
      bonus_children: number;
      external_u3_position: boolean | null;
    }
  >
> {
  const supa = createAdminClient();
  const result = new Map<
    string,
    {
      total_contacts: number;
      responded_ever: boolean;
      children_linked: number;
      parent_linked_children: number;
      bonus_children: number;
      external_u3_position: boolean | null;
    }
  >();
  if (userIds.length === 0) return result;

  // Children: canonical link is `child_client.nanny_user_id` (the entity that
  // represents an actual child→nanny relationship — not `child_invites` which
  // is the invite/handoff intermediary and uses a different status enum).
  // child_invites.bonus_program is still the source for bonus-program attribution
  // since the flag lives on the invite.
  // Helper: run a Supabase query, swallow column-not-found (42703) so a
  // missing T-022 / T-020 / T-023 column degrades to zero rows rather than
  // crashing the whole aggregate hydration.
  async function safeFetch<T>(
    queryFn: () => PromiseLike<{ data: T[] | null; error: unknown }>,
  ): Promise<T[]> {
    try {
      const { data, error } = await queryFn();
      if (error) return [];
      return data ?? [];
    } catch {
      return [];
    }
  }

  const [
    contactsRes,
    inboundRes,
    childClientsRes,
    bonusChildrenRes,
    leadSignalsRes,
  ] = await Promise.all([
    safeFetch<{ nanny_user_id: string }>(() =>
      supa
        .from("lead_contacts")
        .select("nanny_user_id")
        .in("nanny_user_id", userIds),
    ),
    safeFetch<{ nanny_user_id: string }>(() =>
      supa
        .from("lead_contacts")
        .select("nanny_user_id")
        .in("nanny_user_id", userIds)
        .eq("direction", "inbound"),
    ),
    // Canonical nanny→child link. Exclude `closed` children. We also pull
    // parent_user_id so we can compute the "of those, how many have a parent
    // on BB" subset (linked children) without a second query.
    safeFetch<{
      nanny_user_id: string;
      status: string;
      parent_user_id: string | null;
    }>(() =>
      supa
        .from("child_client")
        .select("nanny_user_id, status, parent_user_id")
        .in("nanny_user_id", userIds)
        .neq("status", "closed"),
    ),
    // Bonus-program attribution from child_invites. The `bonus_program`
    // column is T-022 — if the migration isn't applied this query returns
    // [] via safeFetch (column-not-found 42703 → empty). The "contributions
    // complete" check below ALSO falls back to nannies.bonus_program_completed_at,
    // so completeness is detected as long as either signal is populated.
    safeFetch<{ nanny_user_id: string }>(() =>
      supa
        .from("child_invites")
        .select("nanny_user_id")
        .in("nanny_user_id", userIds)
        .eq("status", "connected")
        .eq("bonus_program", true),
    ),
    // T-023 lead signal — nanny currently nannies an under-3 outside BB.
    // Lives in `nanny_leads.lead_signals` JSONB keyed by `auth_user_id`.
    safeFetch<{
      auth_user_id: string;
      lead_signals: Record<string, unknown> | null;
    }>(() =>
      supa
        .from("nanny_leads")
        .select("auth_user_id, lead_signals")
        .in("auth_user_id", userIds),
    ),
  ]);

  // Tally counts per user_id.
  const tally = new Map<
    string,
    {
      total: number;
      inbound: number;
      children: number;
      parent_linked: number;
      bonus: number;
      external_u3: boolean | null;
    }
  >();
  for (const id of userIds) {
    tally.set(id, {
      total: 0,
      inbound: 0,
      children: 0,
      parent_linked: 0,
      bonus: 0,
      external_u3: null,
    });
  }
  for (const r of contactsRes) {
    const t = tally.get(r.nanny_user_id);
    if (t) t.total += 1;
  }
  for (const r of inboundRes) {
    const t = tally.get(r.nanny_user_id);
    if (t) t.inbound += 1;
  }
  for (const r of childClientsRes) {
    const t = tally.get(r.nanny_user_id);
    if (!t) continue;
    t.children += 1;
    if (r.parent_user_id) t.parent_linked += 1;
  }
  for (const r of bonusChildrenRes) {
    const t = tally.get(r.nanny_user_id);
    if (t) t.bonus += 1;
  }
  for (const r of leadSignalsRes) {
    const t = tally.get(r.auth_user_id);
    if (!t) continue;
    const value = r.lead_signals?.external_u3_position;
    if (typeof value === "boolean") {
      t.external_u3 = value;
    }
  }

  for (const [id, t] of tally.entries()) {
    result.set(id, {
      total_contacts: t.total,
      responded_ever: t.inbound > 0,
      children_linked: t.children,
      parent_linked_children: t.parent_linked,
      bonus_children: t.bonus,
      external_u3_position: t.external_u3,
    });
  }
  return result;
}

/**
 * Hydrate the base nanny rows with their user_profiles + verifications +
 * nanny_contact_state. Three parallel queries keyed on user_id; stitched in JS.
 * Required because PostgREST cannot derive the nannies ↔ user_profiles
 * relationship through the shared auth.users FK.
 */
async function hydrateBaseRows(
  nannies: Array<{
    id: string;
    user_id: string;
    created_at: string;
    verification_level: number | null;
    bonus_program_completed_at: string | null;
    abn: string | null;
  }>,
  userIds: string[],
): Promise<NannyJoinedRow[]> {
  const supa = createAdminClient();
  if (userIds.length === 0) return [];

  const [profilesRes, verificationsRes, contactStateRes] = await Promise.all([
    supa
      .from("user_profiles")
      .select(
        "user_id, first_name, last_name, email, mobile_number, suburb, profile_picture_url",
      )
      .in("user_id", userIds),
    supa
      .from("verifications")
      .select("user_id, identity_verified, wwcc_verified, verification_status")
      .in("user_id", userIds),
    supa
      .from("nanny_contact_state")
      .select(
        "id, nanny_user_id, lead_status, last_contact_at, total_contacts_manual_offset, responded_ever_override, next_action_at, pinned_note, assigned_operator, created_at, updated_at",
      )
      .in("nanny_user_id", userIds),
  ]);

  type ProfileRow = NonNullable<NannyJoinedRow["user_profiles"]> & {
    user_id: string;
  };
  type VerificationRow = NonNullable<NannyJoinedRow["verifications"]> & {
    user_id: string;
  };

  const profileMap = new Map<string, ProfileRow>();
  for (const p of (profilesRes.data ?? []) as ProfileRow[]) {
    profileMap.set(p.user_id, p);
  }
  const verificationMap = new Map<string, VerificationRow>();
  for (const v of (verificationsRes.data ?? []) as VerificationRow[]) {
    verificationMap.set(v.user_id, v);
  }
  const contactStateMap = new Map<string, NannyContactState>();
  for (const cs of (contactStateRes.data ?? []) as NannyContactState[]) {
    contactStateMap.set(cs.nanny_user_id, cs);
  }

  return nannies.map((n) => {
    const profile = profileMap.get(n.user_id);
    const verification = verificationMap.get(n.user_id);
    const contactState = contactStateMap.get(n.user_id) ?? null;
    return {
      id: n.id,
      user_id: n.user_id,
      created_at: n.created_at,
      verification_level: n.verification_level,
      bonus_program_completed_at: n.bonus_program_completed_at,
      abn: n.abn,
      user_profiles: profile
        ? {
            first_name: profile.first_name,
            last_name: profile.last_name,
            email: profile.email,
            mobile_number: profile.mobile_number,
            suburb: profile.suburb,
            profile_picture_url: profile.profile_picture_url,
          }
        : null,
      verifications: verification
        ? {
            identity_verified: verification.identity_verified,
            wwcc_verified: verification.wwcc_verified,
            verification_status: verification.verification_status,
          }
        : null,
      nanny_contact_state: contactState,
    };
  });
}

/**
 * Fetch a single page of leads matching the query state.
 *
 * Implementation note: `nannies` ↔ `user_profiles` are both FK'd to
 * `auth.users`, so PostgREST cannot auto-join them via the nested-select
 * syntax (PGRST200: "Could not find a relationship between 'nannies' and
 * 'user_profiles'"). Instead we fetch the base nanny page, then hydrate
 * user_profiles + verifications + nanny_contact_state via separate parallel
 * queries keyed on user_id. Same pattern the admin/users page uses.
 */
export async function fetchLeads(state: LeadQueryState): Promise<LeadsPage> {
  const supa = createAdminClient();

  // Resolve indirect filters first (search/suburb on user_profiles,
  // wwcc/gov_id on verifications). Returns a set of candidate user_ids
  // to AND into the base query.
  const [profileIds, verificationIds] = await Promise.all([
    resolveProfileFilterUserIds(state),
    resolveVerificationFilterUserIds(state),
  ]);

  let candidateIds: string[] | null = null;
  if (profileIds !== null && verificationIds !== null) {
    const verSet = new Set(verificationIds);
    candidateIds = profileIds.filter((id) => verSet.has(id));
  } else if (profileIds !== null) {
    candidateIds = profileIds;
  } else if (verificationIds !== null) {
    candidateIds = verificationIds;
  }

  if (candidateIds !== null && candidateIds.length === 0) {
    return { rows: [], total: 0, page: state.page, pageSize: state.pageSize };
  }

  // Base query on nannies only — direct-column filters + sort + paginate.
  // SELECT * so missing columns from un-applied migrations (T-020 abn,
  // T-022 bonus_program_completed_at) gracefully resolve to undefined
  // rather than failing the whole query. Nullish-coalesce when reading.
  let q = supa.from("nannies").select("*", { count: "exact" });

  if (candidateIds !== null) {
    q = q.in("user_id", candidateIds);
  }

  // Direct-column filters. Skip filters whose column may not exist when
  // the value is the default ("any" / empty array). Apply only when the
  // operator opted in.
  const f = state.filters;
  if (f.level.length > 0) q = q.in("verification_level", f.level);
  // 5-w3fix (W3-M3, P-23): the Contributions filter is hidden unless PAYOUTS_ENABLED — `?contributions=` is ignored.
  if (payoutsEnabled()) {
    if (f.contributions === "complete")
      q = q.not("bonus_program_completed_at", "is", null);
    if (f.contributions === "incomplete")
      q = q.is("bonus_program_completed_at", null);
  }
  // 4-w5fix (W5-M2, P-23): the ABN filter is hidden unless PAYOUTS_ENABLED — `?abn=` is ignored.
  if (payoutsEnabled()) {
    if (f.abn === "has") q = q.not("abn", "is", null);
    if (f.abn === "missing") q = q.is("abn", null);
  }

  // Sort. Foreign-table sorts (last_contact / next_action) can't apply at
  // the nannies query — fall back to created_at and re-sort the page in
  // JS after hydration. Page boundaries are then signup-ordered, not
  // last-contact-ordered; acceptable trade-off for V1.
  const sort = buildSortSpec(state.sort);
  if (sort.foreignTable) {
    q = q.order("created_at", { ascending: false });
  } else {
    q = q.order(sort.column, {
      ascending: sort.ascending,
      nullsFirst: sort.nullsFirst,
    });
  }

  // Page slice. We over-fetch on tabs that apply post-fetch filters so the
  // visible page-of-N doesn't shrink below pageSize when some rows are
  // filtered out. "all" tab doesn't need over-fetch.
  const range = paginationRange(state);
  const overFetch = state.filters.tab === "all" ? 0 : state.pageSize;
  q = q.range(range.from, range.to + overFetch);

  const { data: nannyData, count, error } = await q;
  if (error) {
    console.error("[fetchLeads] base query failed:", error);
    return { rows: [], total: 0, page: state.page, pageSize: state.pageSize };
  }
  // Pick only the columns we actually use. Anything missing from the
  // database (e.g. T-020 abn, T-022 bonus_program_completed_at if those
  // migrations aren't applied yet) gracefully resolves to null.
  const nannyRows = ((nannyData ?? []) as Array<Record<string, unknown>>).map(
    (r) => ({
      id: r.id as string,
      user_id: r.user_id as string,
      created_at: r.created_at as string,
      verification_level:
        typeof r.verification_level === "number" ? r.verification_level : null,
      bonus_program_completed_at:
        typeof r.bonus_program_completed_at === "string"
          ? r.bonus_program_completed_at
          : null,
      abn: typeof r.abn === "string" ? r.abn : null,
    }),
  );

  // Hydrate user_profiles + verifications + nanny_contact_state in parallel
  // for this page's nanny user_ids. Stitch back into NannyJoinedRow shape.
  const pageUserIds = nannyRows.map((r) => r.user_id);
  const baseRows: NannyJoinedRow[] = await hydrateBaseRows(
    nannyRows,
    pageUserIds,
  );

  // Hydrate per-row aggregates.
  const userIds = baseRows.map((r) => r.user_id);
  const aggregates = await hydrateAggregates(userIds);

  // Build LeadRow[].
  const allRows: LeadRow[] = baseRows.map((r) => {
    const profile = r.user_profiles ?? {
      first_name: null,
      last_name: null,
      email: null,
      mobile_number: null,
      suburb: null,
      profile_picture_url: null,
    };
    const v = r.verifications;
    const agg = aggregates.get(r.user_id);
    const contactState = r.nanny_contact_state;
    const totalDerived =
      (agg?.total_contacts ?? 0) +
      (contactState?.total_contacts_manual_offset ?? 0);
    const respondedDerived =
      contactState?.responded_ever_override !== null &&
      contactState?.responded_ever_override !== undefined
        ? contactState.responded_ever_override
        : (agg?.responded_ever ?? false);

    const verification: VerificationSnapshot = {
      identity_verified: v?.identity_verified ?? null,
      wwcc_verified: v?.wwcc_verified ?? null,
      photo_present: Boolean(profile.profile_picture_url),
      abn_present: Boolean(r.abn),
      verification_level: r.verification_level,
      verification_status: v?.verification_status ?? null,
    };

    return {
      nanny_user_id: r.user_id,
      nanny_id: r.id,
      first_name: profile.first_name,
      last_name: profile.last_name,
      email: profile.email,
      mobile_number: profile.mobile_number,
      suburb: profile.suburb,
      profile_picture_url: profile.profile_picture_url,
      signup_at: r.created_at,
      verification,
      children_linked_count: agg?.children_linked ?? 0,
      parent_linked_children_count: agg?.parent_linked_children ?? 0,
      bonus_children_count: agg?.bonus_children ?? 0,
      bonus_program_completed_at: r.bonus_program_completed_at,
      contributions_complete_derived:
        r.bonus_program_completed_at !== null || (agg?.bonus_children ?? 0) > 0,
      contact_state: contactState,
      total_contacts_derived: totalDerived,
      responded_ever_derived: respondedDerived,
      external_u3_position: agg?.external_u3_position ?? null,
    };
  });

  // Apply tab-derived filter post-fetch.
  let tabFiltered = applyTabFilter(state, candidateIds).afterFetch(allRows);

  // Apply derived responded filter.
  if (state.filters.responded === "yes") {
    tabFiltered = tabFiltered.filter((r) => r.responded_ever_derived);
  } else if (state.filters.responded === "no") {
    tabFiltered = tabFiltered.filter((r) => !r.responded_ever_derived);
  }

  // Apply derived external_u3 filter (post-fetch — signal lives in nanny_leads
  // JSONB so can't be expressed as a server-side WHERE here).
  if (state.filters.external_u3 === "has") {
    tabFiltered = tabFiltered.filter((r) => r.external_u3_position === true);
  } else if (state.filters.external_u3 === "missing") {
    tabFiltered = tabFiltered.filter((r) => r.external_u3_position !== true);
  }

  // Apply derived children + linked_children filters (post-fetch — counts come
  // from hydrateAggregates).
  if (state.filters.children === "has") {
    tabFiltered = tabFiltered.filter((r) => r.children_linked_count > 0);
  } else if (state.filters.children === "missing") {
    tabFiltered = tabFiltered.filter((r) => r.children_linked_count === 0);
  }
  if (state.filters.linked_children === "has") {
    tabFiltered = tabFiltered.filter((r) => r.parent_linked_children_count > 0);
  } else if (state.filters.linked_children === "missing") {
    tabFiltered = tabFiltered.filter(
      (r) => r.parent_linked_children_count === 0,
    );
  }

  // Apply status filter post-fetch when 'untouched' is requested (need to
  // include rows without contact_state) OR when status is multi-select
  // mixing untouched + concrete states.
  if (state.filters.status.length > 0) {
    const allowed = new Set(state.filters.status);
    tabFiltered = tabFiltered.filter((r) => {
      const status = r.contact_state?.lead_status ?? "untouched";
      return allowed.has(status);
    });
  }

  // Apply derived-value sorts post-fetch.
  if (state.sort === "total_contacts_desc") {
    tabFiltered = [...tabFiltered].sort(
      (a, b) => b.total_contacts_derived - a.total_contacts_derived,
    );
  } else if (state.sort === "children_desc") {
    tabFiltered = [...tabFiltered].sort(
      (a, b) => b.children_linked_count - a.children_linked_count,
    );
  } else if (state.sort === "children_asc") {
    tabFiltered = [...tabFiltered].sort(
      (a, b) => a.children_linked_count - b.children_linked_count,
    );
  } else if (state.sort === "linked_children_desc") {
    tabFiltered = [...tabFiltered].sort(
      (a, b) => b.parent_linked_children_count - a.parent_linked_children_count,
    );
  } else if (state.sort === "linked_children_asc") {
    tabFiltered = [...tabFiltered].sort(
      (a, b) => a.parent_linked_children_count - b.parent_linked_children_count,
    );
  }

  // Final slice to pageSize.
  const sliced = tabFiltered.slice(0, state.pageSize);

  // Pagination total: for tabs that apply post-fetch derived filters (worklist,
  // verification_stuck, responded, etc.), the raw Supabase count would mislead
  // the operator. Fall back to the post-filter count when post-filtering ran.
  const tabApplyingPostFilter = state.filters.tab !== "all";
  const usedDerivedFilter =
    state.filters.responded !== "any" ||
    state.filters.status.length > 0 ||
    state.filters.external_u3 !== "any" ||
    state.filters.children !== "any" ||
    state.filters.linked_children !== "any";
  const total =
    tabApplyingPostFilter || usedDerivedFilter
      ? (state.page - 1) * state.pageSize + tabFiltered.length
      : (count ?? sliced.length);

  return {
    rows: sliced,
    total,
    page: state.page,
    pageSize: state.pageSize,
  };
}

/**
 * Aggregate stats for the funnel widget in the list header.
 * Each sub-query is independently error-tolerant so a single missing
 * column (e.g. un-applied T-022 `bonus_program_completed_at`) doesn't
 * blank out the whole widget.
 */
export async function fetchLeadsAggregateStats(): Promise<LeadsAggregateStats> {
  const supa = createAdminClient();
  const sevenDaysAgo = new Date(Date.now() - SEVEN_DAYS_MS).toISOString();

  async function safeCount(
    queryFn: () => PromiseLike<{ count: number | null; error: unknown }>,
  ): Promise<number> {
    try {
      const { count, error } = await queryFn();
      if (error) return 0;
      return count ?? 0;
    } catch {
      return 0;
    }
  }

  const [totalNannies, newThisWeek, contactedThisWeek, activatedThisWeek] =
    await Promise.all([
      safeCount(() =>
        supa.from("nannies").select("id", { count: "exact", head: true }),
      ),
      safeCount(() =>
        supa
          .from("nannies")
          .select("id", { count: "exact", head: true })
          .gte("created_at", sevenDaysAgo),
      ),
      safeCount(() =>
        supa
          .from("lead_contacts")
          .select("nanny_user_id", { count: "exact", head: true })
          .gte("contacted_at", sevenDaysAgo),
      ),
      safeCount(() =>
        supa
          .from("nannies")
          .select("id", { count: "exact", head: true })
          .gte("bonus_program_completed_at", sevenDaysAgo),
      ),
    ]);

  return {
    totalNannies,
    newThisWeek,
    contactedThisWeek,
    activatedThisWeek,
  };
}
