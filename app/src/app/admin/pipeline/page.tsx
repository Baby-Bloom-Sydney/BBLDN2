import { createAdminClient } from "@/lib/supabase/admin";
import { Card, CardContent } from "@/components/ui/card";
import { PipelineTable } from "@/components/analytics/PipelineTable";
import { PipelineTabs } from "@/components/analytics/PipelineTabs";
import { DateRangePicker } from "@/components/analytics/DateRangePicker";
import { FilterBar } from "@/components/analytics/FilterBar";
import { Suspense } from "react";
import { SITE_DOMAIN } from "@/lib/constants";

// Stages that represent a completed placement
const PLACED_STAGES = new Set([34, 50, 51]);

// Terminal stages (connection ended)
const TERMINAL_STAGES = new Set([1, 2, 3, 11, 22, 35, 36, 50, 51]);

// Terminal stage labels for the breakdown chart
const TERMINAL_LABELS: Record<number, string> = {
  1: "Parent Cancelled",
  2: "Nanny Declined",
  3: "Expired",
  11: "Post-Accept Cancel",
  22: "Post-MeetUp Cancel",
  35: "Offer Declined",
  36: "Offer Expired",
  50: "Ended",
  51: "Terminated",
};

// Connection funnel stage labels
const CONN_STAGES: { label: string; tooltip: string }[] = [
  { label: "Requested", tooltip: "Connection request sent" },
  { label: "Accepted", tooltip: "Request accepted by other party" },
  { label: "Meet Scheduled", tooltip: "Meet and greet time confirmed" },
  { label: "Meet Completed", tooltip: "Attended a meet and greet" },
  { label: "Trial Arranged", tooltip: "Trial period arranged" },
  { label: "Trial Completed", tooltip: "Completed a trial period" },
  { label: "Offered", tooltip: "Formal job offer made" },
  { label: "Placements", tooltip: "Employment confirmed" },
];

interface DateRange {
  from: string | undefined;
  to: string | undefined;
}

interface SectionRanges {
  global: DateRange;
  nf?: DateRange; pd?: DateRange; pf?: DateRange;
  wt?: DateRange; pc?: DateRange; nc?: DateRange; nv?: DateRange;
  ni?: DateRange; nw?: DateRange; pv?: DateRange;
  df?: DateRange; dc?: DateRange;
  vn?: DateRange; vp?: DateRange; vb?: DateRange;
  bs?: DateRange; bn?: DateRange;
}

interface RowOverride {
  count?: 'all' | 'unique';
  min?: number;
  max?: number;
  mode?: 'alltime' | 'live';
}

interface SectionConfig {
  count: 'all' | 'unique';
  active?: number;
  rows?: Record<number, RowOverride>;
}

interface InternalStage {
  label: string;
  tooltip?: string;
  records: any[];
  liveRecords?: any[];
  idKey: string;
  tags?: ('N' | 'P' | 'T' | 'V')[];
  medianDwell?: number | null;
}

const TABLE_NAMES: Record<string, string> = {
  wt: 'Web Traffic', wtg: 'Web Traffic', wtn: 'Web Traffic', wtp: 'Web Traffic',
  nf: 'Nanny Flow', pd: 'Page Drop-off',
  pf: 'Parent Pipeline', pc: 'Position Connections', nc: 'Nanny Connections',
  nv: 'Nanny Verification', ni: 'Identity Verification',
  nw: 'WWCC Verification', pv: 'Parent Verification',
  kn: 'Key Nanny Metrics', kp: 'Key Parent Metrics',
  df: 'DFY Matchmaking', dc: 'DFY Connections',
  vn: 'Nanny Shares', vp: 'Position Shares', vb: 'BSR Shares',
  bs: 'Babysitting', bn: 'BSR Notifications',
};

const ENTITY_TAGS: Record<string, ('N' | 'P' | 'T' | 'V')[] | undefined> = {
  wtg: ['T'], wtn: ['T', 'N'], wtp: ['T', 'P'],
  nf: ['N'], pd: ['N'], nc: ['N'],
  nv: ['V', 'N'], ni: ['V', 'N'], nw: ['V', 'N'],
  pf: ['P'], pc: ['P'], pv: ['V', 'P'],
  kn: ['N'], kp: ['P'],
  df: undefined, dc: ['N'],
  vn: ['N'], vp: ['P'], vb: ['P'],
  bs: ['P'], bn: ['N'],
};

/* eslint-disable @typescript-eslint/no-explicit-any */

function toMs(ts: string | null | undefined): number | null {
  if (!ts) return null;
  return new Date(ts).getTime();
}

/** Filter entities by their user's last platform activity (from user_stats) */
function filterByActivity(
  entities: any[],
  idField: string,
  activityMap: Map<string, number>,
  activeDays: number | undefined
): any[] {
  if (!activeDays) return entities;
  const cutoff = Date.now() - activeDays * 86400000;
  return entities.filter(e => {
    const id = e[idField];
    if (!id) return false;
    const lastActive = activityMap.get(id);
    return lastActive !== undefined && lastActive >= cutoff;
  });
}

/** Count with per-row override (min/max entity-frequency filtering) */
function countWithOverride(
  records: any[],
  idKey: string,
  tableCount: 'all' | 'unique',
  rowOverride?: RowOverride
): number {
  const countMode = rowOverride?.count || tableCount;
  const min = rowOverride?.min;
  const max = rowOverride?.max;

  if (min === undefined && max === undefined) {
    return countMode === 'all'
      ? records.length
      : new Set(records.map(r => r[idKey])).size;
  }

  const groups = new Map<string, number>();
  for (const r of records) {
    const id = r[idKey];
    if (id) groups.set(id, (groups.get(id) || 0) + 1);
  }

  let filtered = Array.from(groups.entries());
  if (min !== undefined) filtered = filtered.filter(([, n]) => n >= min);
  if (max !== undefined) filtered = filtered.filter(([, n]) => n <= max);

  return countMode === 'unique'
    ? filtered.length
    : filtered.reduce((sum, [, n]) => sum + n, 0);
}

function parseRowOverrides(param: string): Record<number, RowOverride> {
  if (!param) return {};
  const result: Record<number, RowOverride> = {};
  for (const part of param.split(',')) {
    const parts = part.split('.');
    const idx = parts[0], c = parts[1], mn = parts[2], mx = parts[3], md = parts[4];
    if (idx === undefined) continue;
    const override: RowOverride = {};
    if (c === 'a') override.count = 'all';
    else if (c === 'u') override.count = 'unique';
    if (mn && mn !== '-') override.min = parseInt(mn);
    if (mx && mx !== '-') override.max = parseInt(mx);
    if (md === 'l') override.mode = 'live';
    else if (md === 't') override.mode = 'alltime';
    if (override.count !== undefined || override.min !== undefined || override.max !== undefined || override.mode !== undefined) {
      result[parseInt(idx)] = override;
    }
  }
  return result;
}

/** Compute live (differential) stages from cumulative stages */
function toLiveStages(stages: { label: string; total: number }[]) {
  return stages.map((stage, i) => ({
    label: stage.label,
    total:
      i < stages.length - 1
        ? Math.max(0, stage.total - stages[i + 1].total)
        : stage.total,
  }));
}

function medianMs(arr: number[]): number | null {
  if (arr.length === 0) return null;
  const sorted = [...arr].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

/** Annotate InternalStage[] with pre-computed median dwell times from timestamp matrix.
 *  indexMap[catalogIdx] = timestampIdx (-1 = no timestamp for this stage) */
function annotateTimings(
  stages: InternalStage[],
  timestamps: (number | null)[][],
  indexMap: number[]
) {
  if (!timestamps.length) return;
  for (let ci = 0; ci < stages.length && ci < indexMap.length; ci++) {
    const ti = indexMap[ci];
    if (ti < 0) continue;
    // Find next mapped timestamp index
    let nextTi = -1;
    for (let ni = ci + 1; ni < indexMap.length; ni++) {
      if (indexMap[ni] >= 0) { nextTi = indexMap[ni]; break; }
    }
    if (nextTi < 0) continue;
    const diffs: number[] = [];
    for (const row of timestamps) {
      if (row[ti] != null && row[nextTi] != null) {
        diffs.push(row[nextTi]! - row[ti]!);
      }
    }
    stages[ci].medianDwell = diffs.length > 0 ? medianMs(diffs) : null;
  }
}

/** Build cumulative connection stages (unique entities with connection_stage >= N) */
function buildConnCumulative(
  conns: any[],
  idKey: "parent_id" | "nanny_id",
  countMode: 'all' | 'unique' = 'unique',
  rowOverrides?: Record<number, RowOverride>,
  rowOffset = 0
) {
  const thresholds = [0, 10, 20, 21, 31, 32, 33, -1]; // -1 = PLACED_STAGES
  return CONN_STAGES.map((stage, i) => {
    const threshold = thresholds[i];
    const filtered =
      threshold === -1
        ? conns.filter((c) => PLACED_STAGES.has(c.connection_stage))
        : conns.filter((c) => c.connection_stage >= threshold);
    const ro = rowOverrides?.[rowOffset + i];
    return {
      label: stage.label,
      tooltip: stage.tooltip,
      total: countWithOverride(filtered, idKey, countMode, ro),
      override: ro,
    };
  });
}

/** Build live connection stages (unique entities with active connection at each stage range) */
function buildConnLive(
  conns: any[],
  idKey: "parent_id" | "nanny_id",
  countMode: 'all' | 'unique' = 'unique',
  rowOverrides?: Record<number, RowOverride>,
  rowOffset = 0
) {
  const active = conns.filter((c) => !TERMINAL_STAGES.has(c.connection_stage));
  const ranges: [number, number][] = [
    [0, 0],     // Requested
    [10, 19],   // Accepted
    [20, 20],   // Meet Scheduled
    [21, 30],   // Meet Completed
    [31, 31],   // Trial Arranged
    [32, 32],   // Trial Completed
    [33, 33],   // Offered
    [34, 34],   // Placed
  ];
  return CONN_STAGES.map((stage, i) => {
    const [mn, mx] = ranges[i];
    const filtered = active.filter(
      (c) => c.connection_stage >= mn && c.connection_stage <= mx
    );
    const ro = rowOverrides?.[rowOffset + i];
    return {
      label: stage.label,
      tooltip: stage.tooltip,
      total: countWithOverride(filtered, idKey, countMode, ro),
      override: ro,
    };
  });
}

/** Build internal catalog entries for connection stages (for custom tab recomputation) */
function buildConnInternalStages(conns: any[], idKey: string): InternalStage[] {
  const thresholds = [0, 10, 20, 21, 31, 32, 33, -1];
  const ranges: [number, number][] = [
    [0, 0], [10, 19], [20, 20], [21, 30], [31, 31], [32, 32], [33, 33], [34, 34],
  ];
  const active = conns.filter((c) => !TERMINAL_STAGES.has(c.connection_stage));
  return CONN_STAGES.map((stage, i) => {
    const threshold = thresholds[i];
    const filtered = threshold === -1
      ? conns.filter((c) => PLACED_STAGES.has(c.connection_stage))
      : conns.filter((c) => c.connection_stage >= threshold);
    const [mn, mx] = ranges[i];
    const liveFiltered = active.filter(c => c.connection_stage >= mn && c.connection_stage <= mx);
    return { label: stage.label, tooltip: stage.tooltip, records: filtered, liveRecords: liveFiltered, idKey };
  });
}

/** Apply shared custom filters (date range + activity) to a record set */
function applyCustomFilters(
  records: any[],
  idKey: string,
  customRange: DateRange | undefined,
  activeDays: number | undefined,
  activityMap: Map<string, number> | undefined,
): any[] {
  let filtered = records;
  if (customRange && (customRange.from || customRange.to)) {
    filtered = filtered.filter((r: any) => {
      const ts = r.created_at;
      if (!ts) return true;
      if (customRange.from && customRange.from !== '1970-01-01' && ts < `${customRange.from}T00:00:00`) return false;
      if (customRange.to && ts > `${customRange.to}T23:59:59`) return false;
      return true;
    });
  }
  if (activeDays && activityMap) {
    const cutoff = Date.now() - activeDays * 86400000;
    filtered = filtered.filter((r: any) => {
      const id = r[idKey];
      if (!id) return false;
      const lastActive = activityMap.get(id);
      return lastActive !== undefined && lastActive >= cutoff;
    });
  }
  return filtered;
}

/** Build custom stages from internal catalog using custom tab's own settings */
function buildCustomStages(
  internalCatalog: Map<string, InternalStage[]>,
  customEntries: { key: string; index: number }[],
  customCfg: SectionConfig,
  customRange?: DateRange,
  activityMap?: Map<string, number>,
) {
  const customRo = customCfg.rows || {};
  return customEntries.map((entry, i) => {
    const stages = internalCatalog.get(entry.key);
    const stage = stages?.[entry.index];
    if (!stage) return null;

    const records = applyCustomFilters(stage.records, stage.idKey, customRange, customCfg.active, activityMap);

    // Compute live total if liveRecords exist
    let liveTotal: number | undefined;
    if (stage.liveRecords) {
      const liveRecs = applyCustomFilters(stage.liveRecords, stage.idKey, customRange, customCfg.active, activityMap);
      const ro = customRo[i];
      liveTotal = countWithOverride(liveRecs, stage.idKey, ro?.count || customCfg.count, ro);
    }

    const ro = customRo[i];
    const catName = TABLE_NAMES[entry.key] || entry.key;
    return {
      label: stage.label,
      tooltip: stage.tooltip ? `${catName}: ${stage.tooltip}` : catName,
      total: countWithOverride(records, stage.idKey, ro?.count || customCfg.count, ro),
      liveTotal,
      tags: stage.tags || ENTITY_TAGS[entry.key],
      override: ro,
      medianDwell: stage.medianDwell,
    };
  }).filter(Boolean) as { label: string; tooltip?: string; total: number; liveTotal?: number; tags?: ('N' | 'P' | 'T' | 'V')[]; override?: RowOverride; medianDwell?: number | null }[];
}

/** Range key for deduplication */
function rk(r: DateRange): string {
  return `${r.from || ''}|${r.to || ''}`;
}

/** Fetch all date-filtered queries for a given range */
async function fetchCohort(admin: any, range: DateRange) {
  const { from, to } = range;
  function wd(q: any) {
    if (from && from !== '1970-01-01') q = q.gte("created_at", `${from}T00:00:00`);
    if (to) q = q.lte("created_at", `${to}T23:59:59`);
    return q;
  }
  const [visitsRes, applyVisitsRes, nanniesRes, parentsRes, placementsRes, positionsRes, leadsRes] =
    await Promise.all([
      wd(admin.from("page_visits").select("visitor_id, referrer, page_path, created_at")),
      wd(admin.from("page_visits").select("visitor_id, created_at").or("page_path.like./apply/nanny%,page_path.eq./apply")),
      wd(admin.from("nannies").select("id, user_id, verification_level, visible_in_bsr, created_at, updated_at")),
      wd(admin.from("parents").select("id, user_id, signup_source, created_at, updated_at")),
      wd(admin.from("nanny_placements").select("id, nanny_id, parent_id, created_at")),
      wd(admin.from("nanny_positions").select("id, parent_id, status, source, created_at").eq("source", "parent")),
      wd(admin.from("nanny_leads").select("id, visitor_id, lead_status, funnel_step, highest_page_reached, created_at, updated_at")),
    ]);
  return {
    visits: (visitsRes.data || []) as any[],
    applyVisits: (applyVisitsRes.data || []) as any[],
    nannies: (nanniesRes.data || []) as any[],
    parents: (parentsRes.data || []) as any[],
    placements: (placementsRes.data || []) as any[],
    positions: (positionsRes.data || []) as any[],
    leads: (leadsRes.data || []) as any[],
    hasVisitorTracking: !visitsRes.error,
  };
}

/** Fetch non-date-filtered shared data (run once) */
async function fetchShared(admin: any) {
  const [connectionsRes, userStatsRes, connectionStatsRes, verificationsRes,
         dfyNotificationsRes, viralSharesRes, bsrRequestsRes, bsrNotificationsRes, dfyPositionsRes,
         testFlagRes, testEmailRes, allNanniesRes, allParentsRes] =
    await Promise.all([
      admin.from("connection_requests").select("id, nanny_id, parent_id, position_id, connection_stage, created_at"),
      admin.from("user_stats").select(
        "user_id, user_type, lead_id, lead_created_at, lead_status, account_created_at, first_connection_at, first_accepted_at, first_meetup_at, first_placement_at, first_position_at, updated_at"
      ),
      admin.from("connection_stats").select(
        "connection_id, nanny_id, parent_id, current_stage, request_sent_at, accepted_at, meetup_completed_at, trial_completed_at, offered_at, confirmed_at"
      ),
      admin.from("verifications").select("user_id, identity_status, wwcc_status, identity_status_at, wwcc_status_at, verification_status, created_at"),
      admin.from("dfy_match_notifications").select("id, position_id, nanny_id, status, wave, notified_at, viewed_at, responded_at, created_at").then((r: any) => r).catch(() => ({ data: null })),
      admin.from("viral_shares").select("id, user_id, case_type, reference_id, share_status, created_at, shared_at, submitted_at, approved_at, failed_at, bypassed_at, retry_count").then((r: any) => r).catch(() => ({ data: null })),
      admin.from("babysitting_requests").select("id, parent_id, status, accepted_nanny_id, accepted_at, created_at, expires_at").then((r: any) => r).catch(() => ({ data: null })),
      admin.from("bsr_notifications").select("id, babysitting_request_id, nanny_id, notified_at, viewed_at, requested_at, accepted_at, declined_at, created_at").then((r: any) => r).catch(() => ({ data: null })),
      admin.from("nanny_positions").select("id, parent_id, dfy_activated_at, dfy_tier, dfy_expires_at, source, created_at").not('dfy_activated_at', 'is', null).eq("source", "parent").then((r: any) => r).catch(() => ({ data: null })),
      // Test account identification (is_test flag + email domain fallback)
      admin.from("user_profiles").select("user_id").eq("is_test", true).then((r: any) => r).catch(() => ({ data: [] })),
      admin.from("user_profiles").select("user_id").ilike("email", `%${SITE_DOMAIN}`),
      // Full ID mappings for cross-referencing test entities
      admin.from("nannies").select("id, user_id"),
      admin.from("parents").select("id, user_id"),
    ]);
  // ── Build test account ID sets ──
  const testUserIds = new Set([
    ...((testFlagRes.data || []).map((u: any) => u.user_id as string)),
    ...((testEmailRes.data || []).map((u: any) => u.user_id as string)),
  ]);
  const testNannyIds = new Set(
    (allNanniesRes.data || []).filter((n: any) => testUserIds.has(n.user_id)).map((n: any) => n.id as string)
  );
  const testParentIds = new Set(
    (allParentsRes.data || []).filter((p: any) => testUserIds.has(p.user_id)).map((p: any) => p.id as string)
  );

  // Build derived test ID sets for cross-referenced entities
  const rawDfyPositions = (dfyPositionsRes.data || []) as any[];
  const rawBsrRequests = (bsrRequestsRes.data || []) as any[];
  const rawUserStats = (userStatsRes.data || []) as any[];
  const testPositionIds = new Set(rawDfyPositions.filter((p: any) => testParentIds.has(p.parent_id)).map((p: any) => p.id));
  const testBsrIds = new Set(rawBsrRequests.filter((r: any) => testParentIds.has(r.parent_id)).map((r: any) => r.id));
  const testLeadIds = new Set(rawUserStats.filter((us: any) => testUserIds.has(us.user_id) && us.lead_id).map((us: any) => us.lead_id as string));

  // ── Filter all shared data to exclude test accounts ──
  return {
    connections: ((connectionsRes.data || []) as any[]).filter((c: any) => !testNannyIds.has(c.nanny_id) && !testParentIds.has(c.parent_id)),
    userStats: rawUserStats.filter((us: any) => !testUserIds.has(us.user_id)),
    connectionStatsData: ((connectionStatsRes.data || []) as any[]).filter((cs: any) => !testNannyIds.has(cs.nanny_id) && !testParentIds.has(cs.parent_id)),
    verificationsData: ((verificationsRes.data || []) as any[]).filter((v: any) => !testUserIds.has(v.user_id)),
    dfyNotifications: ((dfyNotificationsRes.data || []) as any[]).filter((n: any) => !testNannyIds.has(n.nanny_id) && !testPositionIds.has(n.position_id)),
    viralShares: ((viralSharesRes.data || []) as any[]).filter((s: any) => !testUserIds.has(s.user_id)),
    bsrRequests: rawBsrRequests.filter((r: any) => !testParentIds.has(r.parent_id)),
    bsrNotifications: ((bsrNotificationsRes.data || []) as any[]).filter((n: any) => !testNannyIds.has(n.nanny_id) && !testBsrIds.has(n.babysitting_request_id)),
    dfyPositions: rawDfyPositions.filter((p: any) => !testParentIds.has(p.parent_id)),
    testUserIds,
    testNannyIds,
    testParentIds,
    testLeadIds,
  };
}

/** Helper: count verifications by status field value */
function statusCounts(
  records: any[],
  field: string,
  statusGroups: { label: string; statuses: string[] }[]
) {
  return statusGroups.map(({ label, statuses }) => ({
    label,
    total: records.filter((v: any) => statuses.includes(v[field])).length,
  }));
}

const IDENTITY_OUTCOMES = ["verified", "rejected", "failed"];
const IDENTITY_PAST_PENDING = ["processing", "review", ...IDENTITY_OUTCOMES];
const WWCC_OUTCOMES = ["doc_verified", "review", "rejected", "failed", "expired", "barred", "ocg_not_found", "closed"];
const WWCC_PAST_APP_PENDING = ["pending", "processing", ...WWCC_OUTCOMES];
const WWCC_PAST_PENDING = ["processing", ...WWCC_OUTCOMES];

async function getPipelineData(
  ranges: SectionRanges, sourceFilter: string,
  configs: Record<string, SectionConfig> = {},
  customEntries: { key: string; index: number }[] = [],
) {
  const admin = createAdminClient();

  // Determine effective range for each section (fall back to global)
  const eff = {
    global: ranges.global,
    wt: ranges.wt || ranges.global,
    nf: ranges.nf || ranges.global,
    pd: ranges.pd || ranges.global,
    pf: ranges.pf || ranges.global,
    pc: ranges.pc || ranges.global,
    nc: ranges.nc || ranges.global,
    nv: ranges.nv || ranges.global,
    ni: ranges.ni || ranges.global,
    nw: ranges.nw || ranges.global,
    pv: ranges.pv || ranges.global,
    df: ranges.df || ranges.global,
    dc: ranges.dc || ranges.global,
    vn: ranges.vn || ranges.global,
    vp: ranges.vp || ranges.global,
    vb: ranges.vb || ranges.global,
    bs: ranges.bs || ranges.global,
    bn: ranges.bn || ranges.global,
  };

  // Deduplicate ranges — fetch cohort data once per unique range
  const uniqueRanges = new Map<string, DateRange>();
  for (const r of Object.values(eff)) uniqueRanges.set(rk(r), r);

  const [shared, ...cohortResults] = await Promise.all([
    fetchShared(admin),
    ...Array.from(uniqueRanges.entries()).map(async ([key, range]) => ({
      key,
      data: await fetchCohort(admin, range),
    })),
  ]);

  const cohortCache = new Map<string, Awaited<ReturnType<typeof fetchCohort>>>();
  for (const { key, data } of cohortResults) cohortCache.set(key, data);

  // Filter test accounts from cohort data
  if (shared.testUserIds.size > 0) {
    for (const [key, data] of cohortCache.entries()) {
      cohortCache.set(key, {
        ...data,
        nannies: data.nannies.filter((n: any) => !shared.testUserIds.has(n.user_id)),
        parents: data.parents.filter((p: any) => !shared.testUserIds.has(p.user_id)),
        positions: data.positions.filter((p: any) => !shared.testParentIds.has(p.parent_id)),
        placements: data.placements.filter((pl: any) => !shared.testNannyIds.has(pl.nanny_id) && !shared.testParentIds.has(pl.parent_id)),
        leads: data.leads.filter((l: any) => !shared.testLeadIds.has(l.id)),
      });
    }
  }

  const cohort = (section: keyof typeof eff) => cohortCache.get(rk(eff[section]))!;

  const { connections, userStats, verificationsData, dfyNotifications, viralShares: viralSharesData, bsrRequests: bsrRequestsData, bsrNotifications: bsrNotificationsData, dfyPositions } = shared;

  // Build user-activity maps from user_stats (keyed by user_id and lead_id)
  const userLastActive = new Map<string, number>();
  const leadLastActive = new Map<string, number>();
  for (const us of userStats) {
    if (us.updated_at) {
      const ts = new Date(us.updated_at).getTime();
      if (us.user_id) userLastActive.set(us.user_id, ts);
      if (us.lead_id) leadLastActive.set(us.lead_id, ts);
    }
  }

  // ── Top-level stats (always global range) ──
  const g = cohort('global');
  const uniqueVisitors = g.hasVisitorTracking
    ? new Set(g.visits.map((v: any) => v.visitor_id)).size
    : 0;

  // ── Nanny Flow (uses nf cohort) ──
  const nfRaw = cohort('nf');
  const nfCfg = configs.nf || { count: 'unique' as const };
  const nfNannies = filterByActivity(nfRaw.nannies, 'user_id', userLastActive, nfCfg.active);
  const nfLeads = filterByActivity(nfRaw.leads, 'id', leadLastActive, nfCfg.active);
  const nfApplyVisits = nfRaw.applyVisits; // visitors are anonymous, no user-level filtering
  const nfNannyIdSet = new Set(nfNannies.map((n: any) => n.id));
  const nfNannyUserIdSet = new Set(nfNannies.map((n: any) => n.user_id));
  const nfCohortConn = connections.filter((c: any) => nfNannyIdSet.has(c.nanny_id));
  const nfIsAll = nfCfg.count === 'all';

  const nfRo = nfCfg.rows || {};
  const nfCnt = (idx: number, records: any[], idKey: string) =>
    countWithOverride(records, idKey, nfCfg.count, nfRo[idx]);
  const nfConnFiltered = (filter: (c: any) => boolean) => nfCohortConn.filter(filter);

  const nannyFlow = [
    { label: "Visited Apply", tooltip: "Unique visitors to the nanny application page", total: countWithOverride(nfApplyVisits, 'visitor_id', nfCfg.count, nfRo[0]), override: nfRo[0] },
    { label: "Started Form", tooltip: "Began filling out the multi-step application", total: nfCnt(1, nfLeads, 'id'), override: nfRo[1] },
    { label: "Submitted Form", tooltip: "Completed and submitted the application", total: nfCnt(2, nfLeads.filter((l: any) => ["applied", "ai_generated", "converted"].includes(l.lead_status)), 'id'), override: nfRo[2] },
    { label: "Profile Generated", tooltip: "AI-generated nanny profile created from form data", total: nfCnt(3, nfLeads.filter((l: any) => ["ai_generated", "converted"].includes(l.lead_status)), 'id'), override: nfRo[3] },
    { label: "Account Created", tooltip: "Nanny account registered on the platform", total: nfCnt(4, nfLeads.filter((l: any) => l.lead_status === "converted"), 'id'), override: nfRo[4] },
    { label: "Fully Verified", tooltip: "All verification steps completed (ID + WWCC + references)", total: nfCnt(5, nfNannies.filter((n: any) => n.verification_level === 4), 'user_id'), override: nfRo[5] },
    { label: "Requested", tooltip: "Received at least one connection request from a parent", total: nfCnt(6, nfCohortConn, 'nanny_id'), override: nfRo[6] },
    { label: "Accepted", tooltip: "Accepted a connection request", total: nfCnt(7, nfConnFiltered((c) => c.connection_stage >= 10), 'nanny_id'), override: nfRo[7] },
    { label: "Meet Scheduled", tooltip: "Meet and greet time confirmed with a parent", total: nfCnt(8, nfConnFiltered((c) => c.connection_stage >= 20), 'nanny_id'), override: nfRo[8] },
    { label: "Meet Completed", tooltip: "Attended a meet and greet", total: nfCnt(9, nfConnFiltered((c) => c.connection_stage >= 21), 'nanny_id'), override: nfRo[9] },
    { label: "Trial Arranged", tooltip: "Trial period arranged with a parent", total: nfCnt(10, nfConnFiltered((c) => c.connection_stage >= 31), 'nanny_id'), override: nfRo[10] },
    { label: "Trial Completed", tooltip: "Completed a trial period", total: nfCnt(11, nfConnFiltered((c) => c.connection_stage >= 32), 'nanny_id'), override: nfRo[11] },
    { label: "Offered", tooltip: "Received a formal job offer", total: nfCnt(12, nfConnFiltered((c) => c.connection_stage >= 33), 'nanny_id'), override: nfRo[12] },
    { label: "Placements", tooltip: "Confirmed employment with a family", total: nfCnt(13, nfConnFiltered((c) => PLACED_STAGES.has(c.connection_stage)), 'nanny_id'), override: nfRo[13] },
  ];

  const nfUserStats = userStats.filter((us: any) => us.user_type === "nanny" && nfNannyUserIdSet.has(us.user_id));
  const nannyTimestamps: (number | null)[][] = nfUserStats.map((us: any) => {
    const leadTs = toMs(us.lead_created_at);
    const accountTs = toMs(us.account_created_at);
    return [
      null,                                                                     // Visited Apply
      leadTs,                                                                   // Started Form
      ["applied", "ai_generated", "converted"].includes(us.lead_status) ? leadTs : null, // Submitted Form
      ["ai_generated", "converted"].includes(us.lead_status) ? leadTs : null,   // Profile Generated
      us.lead_status === "converted" ? accountTs : null,                        // Account Created
      null,                                                                     // Fully Verified
      toMs(us.first_connection_at),                                             // Requested
      toMs(us.first_accepted_at),                                               // Accepted
      null,                                                                     // Meet Scheduled
      toMs(us.first_meetup_at),                                                 // Meet Completed
      null,                                                                     // Trial Arranged
      null,                                                                     // Trial Completed
      null,                                                                     // Offered
      toMs(us.first_placement_at),                                              // Placements
    ];
  });
  const nannyFlowLive = toLiveStages(nannyFlow);

  // ── Page Drop-off (uses pd cohort) ──
  const pdRaw = cohort('pd');
  const pdCfg = configs.pd || { count: 'unique' as const };
  const pdLeads = filterByActivity(pdRaw.leads, 'id', leadLastActive, pdCfg.active);
  const pageStages: { label: string; tooltip: string }[] = [
    { label: "Identity", tooltip: "Name, photo, and identity details" },
    { label: "Experience", tooltip: "Childcare experience and history" },
    { label: "Qualifications", tooltip: "Education and certifications" },
    { label: "Residency", tooltip: "Location and work eligibility" },
    { label: "Contact", tooltip: "Phone and contact details" },
    { label: "Preferences", tooltip: "Job type and schedule preferences" },
    { label: "Matching", tooltip: "Matching criteria and availability radius" },
    { label: "Availability", tooltip: "Weekly availability schedule" },
    { label: "Salary", tooltip: "Rate and compensation expectations" },
    { label: "About You", tooltip: "Personal bio and additional info" },
  ];
  const leadsWithPages = pdLeads.filter((l: any) => l.highest_page_reached != null && l.highest_page_reached > 0);
  const pageDropoff = leadsWithPages.length >= 3
    ? pageStages.map((s, i) => ({ label: s.label, tooltip: s.tooltip, total: leadsWithPages.filter((l: any) => l.highest_page_reached >= i + 1).length }))
    : null;
  const pageDropoffLive = pageDropoff ? toLiveStages(pageDropoff) : null;

  // ── Parent Pipeline (uses pf cohort, with source filter) ──
  const pfRaw = cohort('pf');
  const pfCfg = configs.pf || { count: 'unique' as const };
  const pfParentsBase = sourceFilter ? pfRaw.parents.filter((p: any) => p.signup_source === sourceFilter) : pfRaw.parents;
  const pfParents = filterByActivity(pfParentsBase, 'user_id', userLastActive, pfCfg.active);
  const pfParentIdSet = new Set(pfParents.map((p: any) => p.id));
  const pfParentUserIdSet = new Set(pfParents.map((p: any) => p.user_id));
  const pfPositions = pfRaw.positions.filter((p: any) => pfParentIdSet.has(p.parent_id));
  const pfCohortConn = connections.filter((c: any) => pfParentIdSet.has(c.parent_id));
  const pfIsAll = pfCfg.count === 'all';

  const pfRo = pfCfg.rows || {};
  const pfCnt = (idx: number, records: any[], idKey: string) =>
    countWithOverride(records, idKey, pfCfg.count, pfRo[idx]);
  const pfConnFiltered = (filter: (c: any) => boolean) => pfCohortConn.filter(filter);

  const parentFunnel = [
    { label: "Account Created", tooltip: "Parent registered an account", total: pfCnt(0, pfParents, 'user_id'), override: pfRo[0] },
    { label: "Position Created", tooltip: "Posted a childcare position listing", total: pfCnt(1, pfPositions, 'parent_id'), override: pfRo[1] },
    { label: "Request Sent", tooltip: "Sent a connection request to a nanny", total: pfCnt(2, pfCohortConn, 'parent_id'), override: pfRo[2] },
    { label: "Accepted", tooltip: "Request accepted by a nanny", total: pfCnt(3, pfConnFiltered((c) => c.connection_stage >= 10), 'parent_id'), override: pfRo[3] },
    { label: "Meet Scheduled", tooltip: "Meet and greet time confirmed", total: pfCnt(4, pfConnFiltered((c) => c.connection_stage >= 20), 'parent_id'), override: pfRo[4] },
    { label: "Meet Completed", tooltip: "Attended a meet and greet", total: pfCnt(5, pfConnFiltered((c) => c.connection_stage >= 21), 'parent_id'), override: pfRo[5] },
    { label: "Trial Arranged", tooltip: "Trial period arranged with a nanny", total: pfCnt(6, pfConnFiltered((c) => c.connection_stage >= 31), 'parent_id'), override: pfRo[6] },
    { label: "Trial Completed", tooltip: "Completed a trial period", total: pfCnt(7, pfConnFiltered((c) => c.connection_stage >= 32), 'parent_id'), override: pfRo[7] },
    { label: "Offered", tooltip: "Made a formal job offer", total: pfCnt(8, pfConnFiltered((c) => c.connection_stage >= 33), 'parent_id'), override: pfRo[8] },
    { label: "Hired", tooltip: "Nanny confirmed — placement active", total: pfCnt(9, pfConnFiltered((c) => PLACED_STAGES.has(c.connection_stage)), 'parent_id'), override: pfRo[9] },
  ];

  const pfUserStats = userStats.filter((us: any) => us.user_type === "parent" && pfParentUserIdSet.has(us.user_id));
  const parentTimestamps: (number | null)[][] = pfUserStats.map((us: any) => [
    toMs(us.account_created_at),    // Account Created
    toMs(us.first_position_at),     // Position Created
    toMs(us.first_connection_at),   // Request Sent
    toMs(us.first_accepted_at),     // Accepted
    null,                           // Meet Scheduled
    toMs(us.first_meetup_at),       // Meet Completed
    null,                           // Trial Arranged
    null,                           // Trial Completed
    null,                           // Offered
    toMs(us.first_placement_at),    // Hired
  ]);
  const parentFunnelLive = toLiveStages(parentFunnel);

  // ── Parent Signup Source Breakdown ──
  const SIGNUP_SOURCES: { value: string; label: string }[] = [
    { value: 'direct', label: 'Direct' },
    { value: 'browse', label: 'Browse Nannies' },
    { value: 'profile', label: 'Nanny Profile' },
    { value: 'quick_match', label: 'Quick Match' },
    { value: 'advanced_match', label: 'Advanced Match' },
    { value: 'bsr', label: 'BSR Page' },
    { value: 'position', label: 'Position Page' },
    { value: 'pricing', label: 'Pricing' },
  ];
  // Use unfiltered parents (pfRaw) so the breakdown shows the full distribution
  const pfAllParents = filterByActivity(pfRaw.parents, 'user_id', userLastActive, pfCfg.active);
  const parentSourceBreakdown = SIGNUP_SOURCES.map(src => ({
    label: src.label,
    tooltip: `Parents who signed up from ${src.label.toLowerCase()}`,
    total: pfAllParents.filter((p: any) => p.signup_source === src.value).length,
  })).filter(s => s.total > 0);
  // Add "Unknown" for parents without a tracked source
  const knownSourceValues = new Set(SIGNUP_SOURCES.map(s => s.value));
  const unknownCount = pfAllParents.filter((p: any) => !p.signup_source || !knownSourceValues.has(p.signup_source)).length;
  if (unknownCount > 0) {
    parentSourceBreakdown.push({ label: "Unknown", tooltip: "No signup source recorded", total: unknownCount });
  }

  // ── Position Connections (uses pc cohort) ──
  const pcRaw = cohort('pc');
  const pcCfg = configs.pc || { count: 'unique' as const };
  const pcParents = filterByActivity(pcRaw.parents, 'user_id', userLastActive, pcCfg.active);
  const pcParentIdSet = new Set(pcParents.map((p: any) => p.id));
  const pcPositions = pcRaw.positions.filter((p: any) => pcParentIdSet.has(p.parent_id));
  const pcParentsWithPos = new Set(pcPositions.map((p: any) => p.parent_id));
  const pcConns = connections.filter((c: any) => pcParentIdSet.has(c.parent_id));
  const pcUniqueParentsInConn = new Set(pcConns.map((c: any) => c.parent_id)).size;

  const pcRo = pcCfg.rows || {};
  const parentConnCumulative = [
    { label: "Parents", tooltip: "Total parent accounts in this cohort", total: countWithOverride(pcParents, 'user_id', pcCfg.count, pcRo[0]), override: pcRo[0] },
    { label: "Positions", tooltip: "Total position listings created", total: countWithOverride(pcPositions, 'id', pcCfg.count, pcRo[1]), override: pcRo[1] },
    { label: "Connections", tooltip: "Total connection requests from parents", total: countWithOverride(pcConns, 'id', pcCfg.count, pcRo[2]), override: pcRo[2] },
    ...buildConnCumulative(pcConns, "parent_id", pcCfg.count, pcRo, 3),
  ];
  const pcActiveConns = pcConns.filter((c: any) => !TERMINAL_STAGES.has(c.connection_stage));
  const parentConnLive = [
    { label: "Parents", tooltip: "Total parent accounts in this cohort", total: Math.max(0, pcParents.length - pcParentsWithPos.size), override: pcRo[0] },
    { label: "Positions", tooltip: "Total position listings created", total: pcPositions.length, override: pcRo[1] },
    { label: "Connections", tooltip: "Active connection requests", total: pcActiveConns.length, override: pcRo[2] },
    ...buildConnLive(pcConns, "parent_id", pcCfg.count, pcRo, 3),
  ];

  const pcParentUserIdSet = new Set(pcParents.map((p: any) => p.user_id));
  const pcUserStats = userStats.filter((us: any) => us.user_type === "parent" && pcParentUserIdSet.has(us.user_id));
  const parentConnTimestamps: (number | null)[][] = pcUserStats.map((us: any) => [
    null,                           // Parents
    toMs(us.first_position_at),     // Positions
    toMs(us.first_connection_at),   // Connections
    toMs(us.first_connection_at),   // Requested
    toMs(us.first_accepted_at),     // Accepted
    null,                           // Meet Scheduled
    toMs(us.first_meetup_at),       // Meet Completed
    null,                           // Trial Arranged
    null,                           // Trial Completed
    null,                           // Offered
    toMs(us.first_placement_at),    // Placements
  ]);

  // ── Nanny Connections (uses nc cohort) ──
  const ncRaw = cohort('nc');
  const ncCfg = configs.nc || { count: 'unique' as const };
  const ncNannies = filterByActivity(ncRaw.nannies, 'user_id', userLastActive, ncCfg.active);
  const ncNannyIdSet = new Set(ncNannies.map((n: any) => n.id));
  const ncConns = connections.filter((c: any) => ncNannyIdSet.has(c.nanny_id));
  const ncUniqueNanniesInConn = new Set(ncConns.map((c: any) => c.nanny_id)).size;

  const ncRo = ncCfg.rows || {};
  const nannyConnCumulative = [
    { label: "Nannies", tooltip: "Total nanny accounts in this cohort", total: countWithOverride(ncNannies, 'user_id', ncCfg.count, ncRo[0]), override: ncRo[0] },
    ...buildConnCumulative(ncConns, "nanny_id", ncCfg.count, ncRo, 1),
  ];
  const nannyConnLive = [
    { label: "Nannies", tooltip: "Total nanny accounts in this cohort", total: Math.max(0, ncNannies.length - ncUniqueNanniesInConn), override: ncRo[0] },
    ...buildConnLive(ncConns, "nanny_id", ncCfg.count, ncRo, 1),
  ];

  const ncNannyUserIdSet2 = new Set(ncNannies.map((n: any) => n.user_id));
  const ncUserStats = userStats.filter((us: any) => us.user_type === "nanny" && ncNannyUserIdSet2.has(us.user_id));
  const nannyConnTimestamps: (number | null)[][] = ncUserStats.map((us: any) => [
    null,                           // Nannies
    toMs(us.first_connection_at),   // Requested
    toMs(us.first_accepted_at),     // Accepted
    null,                           // Meet Scheduled
    toMs(us.first_meetup_at),       // Meet Completed
    null,                           // Trial Arranged
    null,                           // Trial Completed
    null,                           // Offered
    toMs(us.first_placement_at),    // Placements
  ]);

  // ── Terminal state distribution (per perspective) ──
  const parentTerminalStages = Object.entries(TERMINAL_LABELS)
    .map(([stage, label]) => ({
      label,
      total: new Set(connections.filter((c: any) => c.connection_stage === parseInt(stage)).map((c: any) => c.parent_id)).size,
    }))
    .filter((s) => s.total > 0);

  const nannyTerminalStages = Object.entries(TERMINAL_LABELS)
    .map(([stage, label]) => ({
      label,
      total: new Set(connections.filter((c: any) => c.connection_stage === parseInt(stage)).map((c: any) => c.nanny_id)).size,
    }))
    .filter((s) => s.total > 0);

  // ── Secondary stats (global cohort) ──
  const supplyCount = g.nannies.filter((n: any) => n.verification_level >= 2).length;
  const demandCount = g.positions.filter((p: any) => p.status === "active" || p.status === "open").length;

  const parentCreateMap = new Map(g.parents.map((p: any) => [p.id, new Date(p.created_at).getTime()]));
  const daysArr: number[] = [];
  for (const pl of g.placements) {
    const parentTs = parentCreateMap.get(pl.parent_id);
    if (parentTs) daysArr.push(Math.round((new Date(pl.created_at).getTime() - parentTs) / 86400000));
  }
  daysArr.sort((a, b) => a - b);
  const medianDays = daysArr.length > 0 ? daysArr[Math.floor(daysArr.length / 2)] : null;

  const posConnMap = new Map<string, number>();
  for (const conn of connections) {
    if (conn.position_id) posConnMap.set(conn.position_id, (posConnMap.get(conn.position_id) || 0) + 1);
  }
  const posConnCounts = Array.from(posConnMap.values());
  const avgConnsPerPos = posConnCounts.length > 0
    ? Math.round((posConnCounts.reduce((a, b) => a + b, 0) / posConnCounts.length) * 10) / 10
    : null;

  const placedPositionIds = new Set<string>();
  for (const conn of connections) {
    if (conn.position_id && PLACED_STAGES.has(conn.connection_stage)) placedPositionIds.add(conn.position_id);
  }
  const fillRate = g.positions.length > 0 ? Math.round((placedPositionIds.size / g.positions.length) * 100) : null;

  // ── Nanny Verification Levels (uses nv cohort) ──
  const nvRaw = cohort('nv');
  const nvCfg = configs.nv || { count: 'unique' as const };
  const nvNannies = filterByActivity(nvRaw.nannies, 'user_id', userLastActive, nvCfg.active);
  const nannyVerifLevelsCumulative = [
    { label: "Nannies", tooltip: "Total nanny accounts", total: nvNannies.length },
    { label: "ID Verified", tooltip: "Identity document verified (Level 1)", total: nvNannies.filter((n: any) => n.verification_level >= 1).length },
    { label: "WWCC Verified", tooltip: "Working With Children Check verified (Level 2)", total: nvNannies.filter((n: any) => n.verification_level >= 2).length },
    { label: "Provisional", tooltip: "Basic verifications complete (Level 3)", total: nvNannies.filter((n: any) => n.verification_level >= 3).length },
    { label: "Fully Verified", tooltip: "All verification steps completed (Level 4)", total: nvNannies.filter((n: any) => n.verification_level >= 4).length },
  ];
  const nannyVerifLevelsLive = [
    { label: "Nannies", tooltip: "Total nanny accounts", total: nvNannies.length },
    { label: "ID Verified", tooltip: "Identity document verified (Level 1)", total: nvNannies.filter((n: any) => n.verification_level === 1).length },
    { label: "WWCC Verified", tooltip: "Working With Children Check verified (Level 2)", total: nvNannies.filter((n: any) => n.verification_level === 2).length },
    { label: "Provisional", tooltip: "Basic verifications complete (Level 3)", total: nvNannies.filter((n: any) => n.verification_level === 3).length },
    { label: "Fully Verified", tooltip: "All verification steps completed (Level 4)", total: nvNannies.filter((n: any) => n.verification_level === 4).length },
  ];

  // ── Identity Verification (uses ni cohort) ──
  const niRaw = cohort('ni');
  const niCfg = configs.ni || { count: 'unique' as const };
  const niNannies = filterByActivity(niRaw.nannies, 'user_id', userLastActive, niCfg.active);
  const niNannyUserIdSet = new Set(niNannies.map((n: any) => n.user_id));
  const niNannyVerifs = verificationsData.filter((v: any) => niNannyUserIdSet.has(v.user_id));

  const nannyIdentityCumulative = [
    { label: "Nannies", tooltip: "Nannies with a verification record", total: niNannyVerifs.length },
    { label: "Initiated", tooltip: "Started identity verification", total: niNannyVerifs.filter((v: any) => v.identity_status !== "not_started").length },
    { label: "Processing", tooltip: "Identity document being processed", total: niNannyVerifs.filter((v: any) => IDENTITY_PAST_PENDING.includes(v.identity_status)).length },
    { label: "Outcome", tooltip: "Processing complete — result received", total: niNannyVerifs.filter((v: any) => IDENTITY_OUTCOMES.includes(v.identity_status)).length },
    { label: "Verified", tooltip: "Identity successfully verified", total: niNannyVerifs.filter((v: any) => v.identity_status === "verified").length },
  ];
  const nannyIdentityLive = [
    { label: "Nannies", tooltip: "Nannies with a verification record", total: niNannyVerifs.length },
    ...statusCounts(niNannyVerifs, "identity_status", [
      { label: "Not Started", statuses: ["not_started"] },
      { label: "Pending", statuses: ["pending"] },
      { label: "Processing", statuses: ["processing"] },
      { label: "Manual Review", statuses: ["review"] },
      { label: "Verified", statuses: ["verified"] },
      { label: "Rejected", statuses: ["rejected"] },
      { label: "Failed", statuses: ["failed"] },
    ]),
  ];

  // ── WWCC Verification (uses nw cohort) ──
  const nwRaw = cohort('nw');
  const nwCfg = configs.nw || { count: 'unique' as const };
  const nwNannies = filterByActivity(nwRaw.nannies, 'user_id', userLastActive, nwCfg.active);
  const nwNannyUserIdSet = new Set(nwNannies.map((n: any) => n.user_id));
  const nwNannyVerifs = verificationsData.filter((v: any) => nwNannyUserIdSet.has(v.user_id));

  const nannyWwccCumulative = [
    { label: "Nannies", tooltip: "Nannies with a verification record", total: nwNannyVerifs.length },
    { label: "Initiated", tooltip: "Started WWCC process", total: nwNannyVerifs.filter((v: any) => v.wwcc_status !== "not_started").length },
    { label: "Submitted", tooltip: "WWCC application submitted", total: nwNannyVerifs.filter((v: any) => WWCC_PAST_APP_PENDING.includes(v.wwcc_status)).length },
    { label: "Processing", tooltip: "WWCC being processed", total: nwNannyVerifs.filter((v: any) => WWCC_PAST_PENDING.includes(v.wwcc_status)).length },
    { label: "Outcome", tooltip: "Processing complete — result received", total: nwNannyVerifs.filter((v: any) => WWCC_OUTCOMES.includes(v.wwcc_status)).length },
    { label: "Verified", tooltip: "WWCC document verified and current", total: nwNannyVerifs.filter((v: any) => v.wwcc_status === "doc_verified").length },
  ];
  const nannyWwccLive = [
    { label: "Nannies", tooltip: "Nannies with a verification record", total: nwNannyVerifs.length },
    ...statusCounts(nwNannyVerifs, "wwcc_status", [
      { label: "Not Started", statuses: ["not_started"] },
      { label: "App Pending", statuses: ["application_pending"] },
      { label: "Pending", statuses: ["pending"] },
      { label: "Processing", statuses: ["processing"] },
      { label: "Verified", statuses: ["doc_verified"] },
      { label: "Manual Review", statuses: ["review"] },
      { label: "Rejected", statuses: ["rejected"] },
      { label: "Failed", statuses: ["failed"] },
      { label: "Expired", statuses: ["expired"] },
      { label: "Barred", statuses: ["barred"] },
      { label: "OCG Not Found", statuses: ["ocg_not_found"] },
      { label: "Closed", statuses: ["closed"] },
    ]),
  ];

  // ── Parent Verification (uses pv cohort) ──
  const pvRaw = cohort('pv');
  const pvCfg = configs.pv || { count: 'unique' as const };
  const pvParents = filterByActivity(pvRaw.parents, 'user_id', userLastActive, pvCfg.active);
  const pvParentUserIds = new Set(pvParents.map((p: any) => p.user_id));
  const pvParentVerifs = verificationsData.filter((v: any) => pvParentUserIds.has(v.user_id));

  const parentIdentityCumulative = pvParentVerifs.length > 0
    ? [
        { label: "Parents", tooltip: "Parents with a verification record", total: pvParentVerifs.length },
        { label: "Initiated", tooltip: "Started identity verification", total: pvParentVerifs.filter((v: any) => v.identity_status !== "not_started").length },
        { label: "Processing", tooltip: "Identity document being processed", total: pvParentVerifs.filter((v: any) => IDENTITY_PAST_PENDING.includes(v.identity_status)).length },
        { label: "Outcome", tooltip: "Processing complete — result received", total: pvParentVerifs.filter((v: any) => IDENTITY_OUTCOMES.includes(v.identity_status)).length },
        { label: "Verified", tooltip: "Identity successfully verified", total: pvParentVerifs.filter((v: any) => v.identity_status === "verified").length },
      ]
    : null;
  const parentIdentityLive = pvParentVerifs.length > 0
    ? [
        { label: "Parents", tooltip: "Parents with a verification record", total: pvParentVerifs.length },
        ...statusCounts(pvParentVerifs, "identity_status", [
          { label: "Not Started", statuses: ["not_started"] },
          { label: "Pending", statuses: ["pending"] },
          { label: "Processing", statuses: ["processing"] },
          { label: "Manual Review", statuses: ["review"] },
          { label: "Verified", statuses: ["verified"] },
          { label: "Rejected", statuses: ["rejected"] },
          { label: "Failed", statuses: ["failed"] },
        ]),
      ]
    : null;

  // ── Web Traffic (uses wt cohort) ──
  const wtRaw = cohort('wt');
  const wtCfg = configs.wt || { count: 'unique' as const };
  const wtIsAll = wtCfg.count === 'all';
  const wtVisits = wtRaw.visits;
  const wtLeads = wtRaw.leads;
  const wtNannies = wtRaw.nannies;
  const wtParents = wtRaw.parents;

  // Page categories
  // Indices: 0=Home, 1=ForNannies, 2=BrowseNannies, 3=QuickMatchResults, 4=MatchmakingForm, 5=MatchmakingSignup,
  //          6=HowItWorks, 7=Pricing, 8=ApplyPage, 9=SignupPages, 10=Login
  const pageCategories: { label: string; tooltip: string; match: (path: string) => boolean }[] = [
    { label: "Home", tooltip: "Visits to the homepage (/)", match: (p) => p === "/" },
    { label: "For Nannies", tooltip: "Visits to /childcare-professionals", match: (p) => p === "/for-nannies" || p === "/childcare-professionals" },
    { label: "Browse Nannies", tooltip: "Visits to /nannies and nanny profiles", match: (p) => p === "/nannies" || p.startsWith("/nannies/") },
    { label: "Quick Match Results", tooltip: "Visits to /matchmaking/results (from quick match widget)", match: (p) => p.startsWith("/matchmaking/results") },
    { label: "Matchmaking Form", tooltip: "Visits to /matchmaking/onboarding (advanced matchmaking)", match: (p) => p.startsWith("/matchmaking/onboarding") },
    { label: "Matchmaking Signup", tooltip: "Visits to /matchmaking/signup (signup after matching)", match: (p) => p.startsWith("/matchmaking/signup") },
    { label: "How It Works", tooltip: "Visits to /how-it-works", match: (p) => p === "/how-it-works" },
    { label: "Pricing", tooltip: "Visits to /pricing", match: (p) => p === "/pricing" },
    { label: "Apply Page", tooltip: "Visits to /apply", match: (p) => p.startsWith("/apply/nanny") || p === "/apply" },
    { label: "Signup Pages", tooltip: "Visits to /signup pages", match: (p) => p.startsWith("/signup") },
    { label: "Login", tooltip: "Visits to /login", match: (p) => p === "/login" },
    { label: "Nanny Profiles", tooltip: "Visits to individual nanny profile pages (shared to Facebook)", match: (p) => /^\/nannies\/[^/]+/.test(p) },
    { label: "BSR Pages", tooltip: "Visits to shared babysitting request pages", match: (p) => /^\/babysitting\/[^/]+/.test(p) },
    { label: "Position Pages", tooltip: "Visits to shared position pages", match: (p) => /^\/position\/[^/]+/.test(p) },
  ];

  const allVisitorsCount = wtIsAll
    ? wtVisits.length
    : new Set(wtVisits.map((v: any) => v.visitor_id)).size;

  const pageTraffic = pageCategories.map(({ label, tooltip, match }) => {
    const matched = wtVisits.filter((v: any) => match(v.page_path));
    return {
      label,
      tooltip,
      total: wtIsAll ? matched.length : new Set(matched.map((v: any) => v.visitor_id)).size,
    };
  });

  // Referrer sources (top 8)
  const wtRefMap = new Map<string, Set<string> | number>();
  for (const v of wtVisits) {
    const src = v.referrer || "Direct";
    if (wtIsAll) {
      wtRefMap.set(src, ((wtRefMap.get(src) as number) || 0) + 1);
    } else {
      if (!wtRefMap.has(src)) wtRefMap.set(src, new Set<string>());
      (wtRefMap.get(src) as Set<string>).add(v.visitor_id);
    }
  }
  const wtReferrers = Array.from(wtRefMap.entries())
    .map(([label, val]) => ({
      label: `↳ ${label}`,
      total: typeof val === 'number' ? val : val.size,
    }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 8);

  // Conversion events
  const startedApp = wtIsAll
    ? wtLeads.length
    : new Set(wtLeads.map((l: any) => l.visitor_id || l.id)).size;
  const completedApp = wtLeads.filter((l: any) =>
    ["applied", "ai_generated", "converted"].includes(l.lead_status)
  ).length;
  const nannyAccounts = wtNannies.length;
  const parentAccounts = wtParents.length;

  const webTraffic = [
    { label: "All Visitors", tooltip: "Total unique visitors or page views across all pages", total: allVisitorsCount },
    ...pageTraffic,
    { label: "Started Application", tooltip: "Began the nanny application form", total: startedApp },
    { label: "Completed App", tooltip: "Submitted the nanny application", total: completedApp },
    { label: "Nanny Accounts", tooltip: "Nanny accounts created", total: nannyAccounts },
    { label: "Parent Accounts", tooltip: "Parent accounts created", total: parentAccounts },
  ];

  // Referrers as separate table (no limit — show all)
  const wtAllReferrers = Array.from(wtRefMap.entries())
    .map(([label, val]) => ({
      label,
      tooltip: `Traffic from ${label}`,
      total: typeof val === 'number' ? val : val.size,
    }))
    .sort((a, b) => b.total - a.total);

  // ── Internal Catalog (for custom tab recomputation) ──
  const internalCatalog = new Map<string, InternalStage[]>();

  // Web Traffic — split into general, nanny, parent catalogs
  const wtPageRecords = pageCategories.map(({ label, tooltip, match }) => ({
    label, tooltip,
    records: wtVisits.filter((v: any) => match(v.page_path)),
    idKey: 'visitor_id',
  }));
  const wtRefRecords = wtReferrers.map(ref => {
    const refName = ref.label.replace('↳ ', '');
    return {
      label: ref.label, tooltip: `Traffic from ${refName}`,
      records: wtVisits.filter((v: any) => (v.referrer || "Direct") === refName),
      idKey: 'visitor_id',
    };
  });
  const wtCompletedLeads = wtLeads.filter((l: any) => ["applied", "ai_generated", "converted"].includes(l.lead_status));

  // Full wt catalog (kept for backward compat with existing custom selections)
  internalCatalog.set('wt', [
    { label: "All Visitors", tooltip: "Total unique visitors or page views", records: wtVisits, idKey: 'visitor_id' },
    ...wtPageRecords,
    ...wtRefRecords,
    { label: "Started Application", tooltip: "Began the nanny application form", records: wtLeads, idKey: 'id' },
    { label: "Completed App", tooltip: "Submitted the nanny application", records: wtCompletedLeads, idKey: 'id' },
    { label: "Nanny Accounts", tooltip: "Nanny accounts created", records: wtNannies, idKey: 'id' },
    { label: "Parent Accounts", tooltip: "Parent accounts created", records: wtParents, idKey: 'id' },
  ]);

  // All traffic in one catalog with per-stage user tags
  const TP = ['T', 'P'] as ('N' | 'P' | 'T' | 'V')[];
  const TN = ['T', 'N'] as ('N' | 'P' | 'T' | 'V')[];
  internalCatalog.set('wtg', [
    { label: "All Visitors", tooltip: "Total unique visitors or page views", records: wtVisits, idKey: 'visitor_id' },
    wtPageRecords[0],                          // Home [T]
    { ...wtPageRecords[1], tags: TN },         // For Nannies [T][N]
    { ...wtPageRecords[2], tags: TP },         // Browse Nannies [T][P]
    { ...wtPageRecords[3], tags: TP },         // Quick Match Results [T][P]
    { ...wtPageRecords[4], tags: TP },         // Matchmaking Form [T][P]
    { ...wtPageRecords[5], tags: TP },         // Matchmaking Signup [T][P]
    wtPageRecords[6],                          // How It Works [T]
    { ...wtPageRecords[7], tags: TP },         // Pricing [T][P]
    { ...wtPageRecords[8], tags: TN },         // Apply Page [T][N]
    wtPageRecords[9],                          // Signup Pages [T]
    wtPageRecords[10],                         // Login [T]
    { ...wtPageRecords[11], tags: TN },        // Nanny Profiles [T][N]
    { ...wtPageRecords[12], tags: TP },        // BSR Pages [T][P]
    { ...wtPageRecords[13], tags: TP },        // Position Pages [T][P]
    ...wtRefRecords,
  ]);

  // Nanny Flow (Visited Apply removed — covered by Apply Page in Traffic)
  const nfActiveConns = nfCohortConn.filter((c: any) => !TERMINAL_STAGES.has(c.connection_stage));
  internalCatalog.set('nf', [
    { label: "Started Form", tooltip: "Began filling out the multi-step application", records: nfLeads, liveRecords: nfLeads.filter((l: any) => !["applied", "ai_generated", "converted"].includes(l.lead_status)), idKey: 'id' },
    { label: "Submitted Form", tooltip: "Completed and submitted the application", records: nfLeads.filter((l: any) => ["applied", "ai_generated", "converted"].includes(l.lead_status)), liveRecords: nfLeads.filter((l: any) => l.lead_status === "applied"), idKey: 'id' },
    { label: "Profile Generated", tooltip: "AI-generated nanny profile created from form data", records: nfLeads.filter((l: any) => ["ai_generated", "converted"].includes(l.lead_status)), liveRecords: nfLeads.filter((l: any) => l.lead_status === "ai_generated"), idKey: 'id' },
    { label: "Account Created", tooltip: "Nanny account registered on the platform", records: nfLeads.filter((l: any) => l.lead_status === "converted"), idKey: 'id' },
    { label: "Fully Verified", tooltip: "All verification steps completed (ID + WWCC + references)", records: nfNannies.filter((n: any) => n.verification_level === 4), idKey: 'user_id' },
    { label: "Connections", tooltip: "Total connection requests involving this nanny (toggle unique/all)", records: nfCohortConn, liveRecords: nfActiveConns, idKey: 'nanny_id' },
    ...buildConnInternalStages(nfCohortConn, 'nanny_id'),
  ]);

  // Page Drop-off
  if (pageDropoff) {
    internalCatalog.set('pd', pageStages.map((s, i) => ({
      label: s.label, tooltip: s.tooltip,
      records: leadsWithPages.filter((l: any) => l.highest_page_reached >= i + 1),
      liveRecords: leadsWithPages.filter((l: any) => l.highest_page_reached === i + 1),
      idKey: 'id',
    })));
  } else {
    internalCatalog.set('pd', []);
  }

  // Parent Pipeline — matches parentFunnel order exactly
  const pfConnInternal = buildConnInternalStages(pfCohortConn, 'parent_id');
  internalCatalog.set('pf', [
    { label: "Account Created", tooltip: "Parent registered an account", records: pfParents, idKey: 'user_id' },
    { label: "Position Created", tooltip: "Posted a childcare position listing", records: pfPositions, idKey: 'parent_id' },
    pfConnInternal[0], // Request Sent = Requested
    pfConnInternal[1], // Accepted
    pfConnInternal[2], // Meet Scheduled
    pfConnInternal[3], // Meet Completed
    pfConnInternal[4], // Trial Arranged
    pfConnInternal[5], // Trial Completed
    pfConnInternal[6], // Offered
    pfConnInternal[7], // Hired = Placements
  ]);

  // Position Connections
  const pcParentsWithoutPos = pcParents.filter((p: any) => !pcParentsWithPos.has(p.id));
  const pcParentsWithPosNoConn = Array.from(pcParentsWithPos).filter(id => !new Set(pcConns.map((c: any) => c.parent_id)).has(id)).map(id => ({ parent_id: id }));
  internalCatalog.set('pc', [
    { label: "Parents", tooltip: "Total parent accounts in this cohort", records: pcParents, liveRecords: pcParentsWithoutPos, idKey: 'user_id' },
    { label: "Positions", tooltip: "Total position listings created", records: pcPositions, liveRecords: pcPositions, idKey: 'id' },
    { label: "Connections", tooltip: "Total connection requests from parents", records: pcConns, liveRecords: pcActiveConns, idKey: 'id' },
    ...buildConnInternalStages(pcConns, 'parent_id'),
  ]);

  // Nanny Connections
  const ncNanniesNoConn = ncNannies.filter((n: any) => !new Set(ncConns.map((c: any) => c.nanny_id)).has(n.id));
  internalCatalog.set('nc', [
    { label: "Nannies", tooltip: "Total nanny accounts in this cohort", records: ncNannies, liveRecords: ncNanniesNoConn, idKey: 'user_id' },
    ...buildConnInternalStages(ncConns, 'nanny_id'),
  ]);

  // Nanny Verification Levels (all-time = cumulative >=, live = exact ===)
  internalCatalog.set('nv', [
    { label: "Unverified", tooltip: "No verification completed (Level 0)", records: nvNannies.filter((n: any) => n.verification_level === 0), idKey: 'user_id' },
    { label: "ID Verified", tooltip: "Identity document verified (Level 1)", records: nvNannies.filter((n: any) => n.verification_level >= 1), liveRecords: nvNannies.filter((n: any) => n.verification_level === 1), idKey: 'user_id' },
    { label: "WWCC Verified", tooltip: "Working With Children Check verified (Level 2)", records: nvNannies.filter((n: any) => n.verification_level >= 2), liveRecords: nvNannies.filter((n: any) => n.verification_level === 2), idKey: 'user_id' },
    { label: "Provisional", tooltip: "Basic verifications complete (Level 3)", records: nvNannies.filter((n: any) => n.verification_level >= 3), liveRecords: nvNannies.filter((n: any) => n.verification_level === 3), idKey: 'user_id' },
    { label: "Fully Verified", tooltip: "All verification steps completed (Level 4)", records: nvNannies.filter((n: any) => n.verification_level >= 4), idKey: 'user_id' },
  ]);

  // Identity Verification
  const niFailedTotal = niNannyVerifs.filter((v: any) => v.identity_status === "failed" || v.identity_status === "rejected");
  internalCatalog.set('ni', [
    { label: "ID: Initiated", tooltip: "Started identity verification", records: niNannyVerifs.filter((v: any) => v.identity_status !== "not_started"), idKey: 'user_id' },
    { label: "ID: Processing", tooltip: "Identity document being processed", records: niNannyVerifs.filter((v: any) => IDENTITY_PAST_PENDING.includes(v.identity_status)), idKey: 'user_id' },
    { label: "ID: Outcome", tooltip: "Processing complete — result received", records: niNannyVerifs.filter((v: any) => IDENTITY_OUTCOMES.includes(v.identity_status)), idKey: 'user_id' },
    { label: "ID: Verified", tooltip: "Identity successfully verified", records: niNannyVerifs.filter((v: any) => v.identity_status === "verified"), idKey: 'user_id' },
    { label: "ID: Unverified", tooltip: "Not yet started identity verification", records: niNannyVerifs.filter((v: any) => v.identity_status === "not_started"), idKey: 'user_id' },
    { label: "ID: Failed (Total)", tooltip: "All failed identity checks (auto + manual)", records: niFailedTotal, idKey: 'user_id' },
    { label: "ID: Failed (Auto)", tooltip: "Automated identity check failed", records: niNannyVerifs.filter((v: any) => v.identity_status === "failed"), idKey: 'user_id' },
    { label: "ID: Rejected", tooltip: "Manually rejected by admin review", records: niNannyVerifs.filter((v: any) => v.identity_status === "rejected"), idKey: 'user_id' },
    { label: "ID: In Review", tooltip: "Flagged for manual admin review", records: niNannyVerifs.filter((v: any) => v.identity_status === "review"), idKey: 'user_id' },
  ]);

  // WWCC Verification
  const nwNegativeStatuses = ["failed", "rejected", "barred", "ocg_not_found", "expired", "closed"];
  internalCatalog.set('nw', [
    { label: "WWCC: Initiated", tooltip: "Started WWCC process", records: nwNannyVerifs.filter((v: any) => v.wwcc_status !== "not_started"), idKey: 'user_id' },
    { label: "WWCC: Submitted", tooltip: "WWCC application submitted", records: nwNannyVerifs.filter((v: any) => WWCC_PAST_APP_PENDING.includes(v.wwcc_status)), idKey: 'user_id' },
    { label: "WWCC: Processing", tooltip: "WWCC being processed", records: nwNannyVerifs.filter((v: any) => WWCC_PAST_PENDING.includes(v.wwcc_status)), idKey: 'user_id' },
    { label: "WWCC: Outcome", tooltip: "Processing complete — result received", records: nwNannyVerifs.filter((v: any) => WWCC_OUTCOMES.includes(v.wwcc_status)), idKey: 'user_id' },
    { label: "WWCC: Verified", tooltip: "WWCC document verified and current", records: nwNannyVerifs.filter((v: any) => v.wwcc_status === "doc_verified"), idKey: 'user_id' },
    { label: "WWCC: Unverified", tooltip: "Not yet started WWCC verification", records: nwNannyVerifs.filter((v: any) => v.wwcc_status === "not_started"), idKey: 'user_id' },
    { label: "WWCC: Failed (Total)", tooltip: "All negative WWCC outcomes combined", records: nwNannyVerifs.filter((v: any) => nwNegativeStatuses.includes(v.wwcc_status)), idKey: 'user_id' },
    { label: "WWCC: Failed (Auto)", tooltip: "Automated WWCC check failed", records: nwNannyVerifs.filter((v: any) => v.wwcc_status === "failed"), idKey: 'user_id' },
    { label: "WWCC: Rejected", tooltip: "WWCC manually rejected", records: nwNannyVerifs.filter((v: any) => v.wwcc_status === "rejected"), idKey: 'user_id' },
    { label: "WWCC: OCG Not Found", tooltip: "Office of Children's Guardian record not found", records: nwNannyVerifs.filter((v: any) => v.wwcc_status === "ocg_not_found"), idKey: 'user_id' },
    { label: "WWCC: Barred", tooltip: "Person barred from working with children", records: nwNannyVerifs.filter((v: any) => v.wwcc_status === "barred"), idKey: 'user_id' },
    { label: "WWCC: Expired", tooltip: "WWCC has expired and needs renewal", records: nwNannyVerifs.filter((v: any) => v.wwcc_status === "expired"), idKey: 'user_id' },
  ]);

  // Parent Verification (always include — totals will be 0 if no records)
  const pvFailedTotal = pvParentVerifs.filter((v: any) => v.identity_status === "failed" || v.identity_status === "rejected");
  internalCatalog.set('pv', [
    { label: "ID: Initiated", tooltip: "Started identity verification", records: pvParentVerifs.filter((v: any) => v.identity_status !== "not_started"), idKey: 'user_id' },
    { label: "ID: Processing", tooltip: "Identity document being processed", records: pvParentVerifs.filter((v: any) => IDENTITY_PAST_PENDING.includes(v.identity_status)), idKey: 'user_id' },
    { label: "ID: Outcome", tooltip: "Processing complete — result received", records: pvParentVerifs.filter((v: any) => IDENTITY_OUTCOMES.includes(v.identity_status)), idKey: 'user_id' },
    { label: "ID: Verified", tooltip: "Identity successfully verified", records: pvParentVerifs.filter((v: any) => v.identity_status === "verified"), idKey: 'user_id' },
    { label: "ID: Unverified", tooltip: "Not yet started identity verification", records: pvParentVerifs.filter((v: any) => v.identity_status === "not_started"), idKey: 'user_id' },
    { label: "ID: Failed (Total)", tooltip: "All failed identity checks (auto + manual)", records: pvFailedTotal, idKey: 'user_id' },
    { label: "ID: Failed (Auto)", tooltip: "Automated identity check failed", records: pvParentVerifs.filter((v: any) => v.identity_status === "failed"), idKey: 'user_id' },
    { label: "ID: Rejected", tooltip: "Manually rejected by admin review", records: pvParentVerifs.filter((v: any) => v.identity_status === "rejected"), idKey: 'user_id' },
  ]);

  // ── DFY Matchmaking (uses df section config + shared dfy data) ──
  const dfCfg = configs.df || { count: 'unique' as const };
  const dfRo = dfCfg.rows || {};
  const now = Date.now();

  // Date-filter DFY notifications and positions based on df section range
  const dfRange = eff.df;
  const dfFilterDate = (records: any[], dateField = 'created_at') => {
    if (!dfRange.from && !dfRange.to) return records;
    return records.filter((r: any) => {
      const ts = r[dateField];
      if (!ts) return true;
      if (dfRange.from && dfRange.from !== '1970-01-01' && ts < `${dfRange.from}T00:00:00`) return false;
      if (dfRange.to && ts > `${dfRange.to}T23:59:59`) return false;
      return true;
    });
  };

  const dfPositions = dfFilterDate(dfyPositions, 'dfy_activated_at');
  const dfNotifs = dfFilterDate(dfyNotifications);
  const dfNotifsSent = dfNotifs.filter((n: any) => n.status !== 'pending_wave');
  // Identify DFY connections by cross-referencing interested notifications with connections
  const dfyInterestedKeys = new Set(
    dfyNotifications.filter((n: any) => n.status === 'interested').map((n: any) => `${n.nanny_id}|${n.position_id}`)
  );
  const dfConns = connections.filter((c: any) => c.position_id && dfyInterestedKeys.has(`${c.nanny_id}|${c.position_id}`));
  const dfConnsFiltered = dfFilterDate(dfConns);

  const dfCnt = (idx: number, records: any[], idKey: string) =>
    countWithOverride(records, idKey, dfCfg.count, dfRo[idx]);

  const PT = ['P'] as ('N' | 'P' | 'T' | 'V')[];
  const NT = ['N'] as ('N' | 'P' | 'T' | 'V')[];

  const dfyMatchmaking = [
    { label: "DFY Activated", tooltip: "Positions with DFY matchmaking triggered", total: dfCnt(0, dfPositions, 'id'), override: dfRo[0], tags: PT },
    { label: "Standard Tier", tooltip: "DFY standard tier activations", total: dfCnt(1, dfPositions.filter((p: any) => p.dfy_tier === 'standard'), 'id'), override: dfRo[1], tags: PT },
    { label: "Priority Tier", tooltip: "DFY priority tier activations", total: dfCnt(2, dfPositions.filter((p: any) => p.dfy_tier === 'priority'), 'id'), override: dfRo[2], tags: PT },
    { label: "Active (Not Expired)", tooltip: "DFY searches still within expiry window", total: dfCnt(3, dfPositions.filter((p: any) => p.dfy_expires_at && new Date(p.dfy_expires_at).getTime() > now), 'id'), override: dfRo[3], tags: PT },
    { label: "Expired", tooltip: "DFY searches past expiry window", total: dfCnt(4, dfPositions.filter((p: any) => p.dfy_expires_at && new Date(p.dfy_expires_at).getTime() <= now), 'id'), override: dfRo[4], tags: PT },
    { label: "Nannies Notified", tooltip: "Unique nannies sent DFY notifications (all waves)", total: dfCnt(5, dfNotifsSent, 'nanny_id'), override: dfRo[5], tags: NT },
    { label: "Wave 1", tooltip: "Nannies notified in wave 1", total: dfCnt(6, dfNotifsSent.filter((n: any) => n.wave === 1), 'nanny_id'), override: dfRo[6], tags: NT },
    { label: "Wave 2", tooltip: "Nannies notified in wave 2", total: dfCnt(7, dfNotifsSent.filter((n: any) => n.wave === 2), 'nanny_id'), override: dfRo[7], tags: NT },
    { label: "Wave 3", tooltip: "Nannies notified in wave 3", total: dfCnt(8, dfNotifsSent.filter((n: any) => n.wave === 3), 'nanny_id'), override: dfRo[8], tags: NT },
    { label: "Viewed", tooltip: "Nannies who viewed the DFY notification", total: dfCnt(9, dfNotifs.filter((n: any) => n.viewed_at), 'nanny_id'), override: dfRo[9], tags: NT },
    { label: "Interested", tooltip: "Nannies who responded with interest", total: dfCnt(10, dfNotifs.filter((n: any) => n.status === 'interested'), 'nanny_id'), override: dfRo[10], tags: NT },
    { label: "No Response", tooltip: "Notifications that expired without response", total: dfCnt(11, dfNotifs.filter((n: any) => n.status === 'expired'), 'nanny_id'), override: dfRo[11], tags: NT },
  ];

  // DFY notification timestamps (notified_at → viewed_at → responded_at)
  const dfyTimestamps: (number | null)[][] = dfNotifsSent.map((n: any) => [
    null, null, null, null, null, // position-level stages (no per-notification timestamp)
    toMs(n.notified_at),         // Nannies Notified
    n.wave === 1 ? toMs(n.notified_at) : null, // Wave 1
    n.wave === 2 ? toMs(n.notified_at) : null, // Wave 2
    n.wave === 3 ? toMs(n.notified_at) : null, // Wave 3
    toMs(n.viewed_at),           // Viewed
    n.status === 'interested' ? toMs(n.responded_at) : null, // Interested
    null,                         // No Response
  ]);

  // DFY live mode
  const dfyMatchmakingLive = [
    { label: "DFY Activated", total: dfPositions.length, tags: PT },
    { label: "Standard Tier", total: dfPositions.filter((p: any) => p.dfy_tier === 'standard').length, tags: PT },
    { label: "Priority Tier", total: dfPositions.filter((p: any) => p.dfy_tier === 'priority').length, tags: PT },
    { label: "Active (Not Expired)", total: dfPositions.filter((p: any) => p.dfy_expires_at && new Date(p.dfy_expires_at).getTime() > now).length, tags: PT },
    { label: "Expired", total: dfPositions.filter((p: any) => p.dfy_expires_at && new Date(p.dfy_expires_at).getTime() <= now).length, tags: PT },
    { label: "Nannies Notified", total: dfNotifs.filter((n: any) => n.status === 'notified').length, tags: NT },
    { label: "Wave 1", total: dfNotifs.filter((n: any) => n.wave === 1 && n.status === 'notified').length, tags: NT },
    { label: "Wave 2", total: dfNotifs.filter((n: any) => n.wave === 2 && n.status === 'notified').length, tags: NT },
    { label: "Wave 3", total: dfNotifs.filter((n: any) => n.wave === 3 && n.status === 'notified').length, tags: NT },
    { label: "Viewed", total: dfNotifs.filter((n: any) => n.status === 'viewed').length, tags: NT },
    { label: "Interested", total: dfNotifs.filter((n: any) => n.status === 'interested').length, tags: NT },
    { label: "No Response", total: dfNotifs.filter((n: any) => n.status === 'expired').length, tags: NT },
  ];

  // Internal catalog for df
  internalCatalog.set('df', [
    { label: "DFY Activated", tooltip: "Positions with DFY matchmaking triggered", records: dfPositions, liveRecords: dfPositions, idKey: 'id', tags: PT },
    { label: "Standard Tier", tooltip: "DFY standard tier activations", records: dfPositions.filter((p: any) => p.dfy_tier === 'standard'), idKey: 'id', tags: PT },
    { label: "Priority Tier", tooltip: "DFY priority tier activations", records: dfPositions.filter((p: any) => p.dfy_tier === 'priority'), idKey: 'id', tags: PT },
    { label: "Active (Not Expired)", tooltip: "DFY searches still within expiry window", records: dfPositions.filter((p: any) => p.dfy_expires_at && new Date(p.dfy_expires_at).getTime() > now), idKey: 'id', tags: PT },
    { label: "Expired", tooltip: "DFY searches past expiry window", records: dfPositions.filter((p: any) => p.dfy_expires_at && new Date(p.dfy_expires_at).getTime() <= now), idKey: 'id', tags: PT },
    { label: "Nannies Notified", tooltip: "Unique nannies sent DFY notifications", records: dfNotifsSent, liveRecords: dfNotifs.filter((n: any) => n.status === 'notified'), idKey: 'nanny_id', tags: NT },
    { label: "Wave 1", tooltip: "Nannies notified in wave 1", records: dfNotifsSent.filter((n: any) => n.wave === 1), idKey: 'nanny_id', tags: NT },
    { label: "Wave 2", tooltip: "Nannies notified in wave 2", records: dfNotifsSent.filter((n: any) => n.wave === 2), idKey: 'nanny_id', tags: NT },
    { label: "Wave 3", tooltip: "Nannies notified in wave 3", records: dfNotifsSent.filter((n: any) => n.wave === 3), idKey: 'nanny_id', tags: NT },
    { label: "Viewed", tooltip: "Nannies who viewed the notification", records: dfNotifs.filter((n: any) => n.viewed_at), liveRecords: dfNotifs.filter((n: any) => n.status === 'viewed'), idKey: 'nanny_id', tags: NT },
    { label: "Interested", tooltip: "Nannies who responded with interest", records: dfNotifs.filter((n: any) => n.status === 'interested'), idKey: 'nanny_id', tags: NT },
    { label: "No Response", tooltip: "Notifications expired without response", records: dfNotifs.filter((n: any) => n.status === 'expired'), idKey: 'nanny_id', tags: NT },
  ]);

  // ── DFY Connections (uses dc section config) ──
  const dcCfg = configs.dc || { count: 'unique' as const };
  const dcRo = dcCfg.rows || {};
  const dcConns = dfConnsFiltered;

  const dfyConnectionsCumulative = [
    { label: "All DFY Connections", tooltip: "Total connections sourced from DFY matchmaking", total: countWithOverride(dcConns, 'nanny_id', dcCfg.count, dcRo[0]), override: dcRo[0] },
    ...buildConnCumulative(dcConns, "nanny_id", dcCfg.count, dcRo, 1),
  ];
  const dfyConnectionsLive = [
    { label: "All DFY Connections", tooltip: "Total connections sourced from DFY matchmaking", total: dcConns.length - new Set(dcConns.filter((c: any) => !TERMINAL_STAGES.has(c.connection_stage)).map((c: any) => c.nanny_id)).size, override: dcRo[0] },
    ...buildConnLive(dcConns, "nanny_id", dcCfg.count, dcRo, 1),
  ];

  internalCatalog.set('dc', [
    { label: "All DFY Connections", tooltip: "Total connections sourced from DFY matchmaking", records: dcConns, liveRecords: dcConns.filter((c: any) => !TERMINAL_STAGES.has(c.connection_stage)), idKey: 'nanny_id' },
    ...buildConnInternalStages(dcConns, 'nanny_id'),
  ]);

  // ── Viral Shares ──
  const vnShares = viralSharesData.filter((s: any) => s.case_type === 'nanny_profile');
  const vpShares = viralSharesData.filter((s: any) => s.case_type === 'parent_position');
  const vbShares = viralSharesData.filter((s: any) => s.case_type === 'parent_bsr');

  function buildViralCatalog(shares: any[]): InternalStage[] {
    return [
      { label: "Created", tooltip: "Share record created", records: shares, liveRecords: shares.filter((s: any) => s.share_status === 10), idKey: 'user_id' },
      { label: "Shared", tooltip: "User confirmed sharing to Facebook", records: shares.filter((s: any) => s.share_status >= 20), liveRecords: shares.filter((s: any) => s.share_status === 20), idKey: 'user_id' },
      { label: "Submitted", tooltip: "Screenshot uploaded for verification", records: shares.filter((s: any) => s.share_status >= 30), liveRecords: shares.filter((s: any) => s.share_status === 30 || s.share_status === 40), idKey: 'user_id' },
      { label: "Approved", tooltip: "Share verified and access granted", records: shares.filter((s: any) => s.share_status === 50 || s.share_status === 90), idKey: 'user_id' },
      { label: "Failed", tooltip: "Screenshot verification failed", records: shares.filter((s: any) => s.share_status === 60), idKey: 'user_id' },
      { label: "Bypassed", tooltip: "Admin override — access granted manually", records: shares.filter((s: any) => s.share_status === 90), idKey: 'user_id' },
    ];
  }

  function buildViralMetrics(shares: any[], cfg: SectionConfig) {
    const ro = cfg.rows || {};
    const cnt = (idx: number, records: any[], idKey: string) =>
      countWithOverride(records, idKey, cfg.count, ro[idx]);
    return [
      { label: "Created", tooltip: "Share record created", total: cnt(0, shares, 'user_id'), override: ro[0] },
      { label: "Shared", tooltip: "User confirmed sharing to Facebook", total: cnt(1, shares.filter((s: any) => s.share_status >= 20), 'user_id'), override: ro[1] },
      { label: "Submitted", tooltip: "Screenshot uploaded for verification", total: cnt(2, shares.filter((s: any) => s.share_status >= 30), 'user_id'), override: ro[2] },
      { label: "Approved", tooltip: "Share verified and access granted", total: cnt(3, shares.filter((s: any) => s.share_status === 50 || s.share_status === 90), 'user_id'), override: ro[3] },
      { label: "Failed", tooltip: "Screenshot verification failed", total: cnt(4, shares.filter((s: any) => s.share_status === 60), 'user_id'), override: ro[4] },
      { label: "Bypassed", tooltip: "Admin override — access granted manually", total: cnt(5, shares.filter((s: any) => s.share_status === 90), 'user_id'), override: ro[5] },
    ];
  }

  function buildViralLive(shares: any[]) {
    return [
      { label: "Created", total: shares.filter((s: any) => s.share_status === 10).length },
      { label: "Shared", total: shares.filter((s: any) => s.share_status === 20).length },
      { label: "Submitted", total: shares.filter((s: any) => s.share_status === 30 || s.share_status === 40).length },
      { label: "Approved", total: shares.filter((s: any) => s.share_status === 50).length },
      { label: "Failed", total: shares.filter((s: any) => s.share_status === 60).length },
      { label: "Bypassed", total: shares.filter((s: any) => s.share_status === 90).length },
    ];
  }

  function buildViralTimestamps(shares: any[]): (number | null)[][] {
    return shares.map((s: any) => [
      toMs(s.created_at),   // Created
      toMs(s.shared_at),    // Shared
      toMs(s.submitted_at), // Submitted
      toMs(s.approved_at || s.bypassed_at), // Approved
      toMs(s.failed_at),    // Failed
      toMs(s.bypassed_at),  // Bypassed
    ]);
  }

  const vnCfg = configs.vn || { count: 'unique' as const };
  const vpCfg = configs.vp || { count: 'unique' as const };
  const vbCfg = configs.vb || { count: 'unique' as const };

  const nannySharesMetrics = buildViralMetrics(vnShares, vnCfg);
  const nannySharesLive = buildViralLive(vnShares);
  const nannySharesTimestamps = buildViralTimestamps(vnShares);

  const positionSharesMetrics = buildViralMetrics(vpShares, vpCfg);
  const positionSharesLive = buildViralLive(vpShares);
  const positionSharesTimestamps = buildViralTimestamps(vpShares);

  const bsrSharesMetrics = buildViralMetrics(vbShares, vbCfg);
  const bsrSharesLive = buildViralLive(vbShares);
  const bsrSharesTimestamps = buildViralTimestamps(vbShares);

  internalCatalog.set('vn', buildViralCatalog(vnShares));
  internalCatalog.set('vp', buildViralCatalog(vpShares));
  internalCatalog.set('vb', buildViralCatalog(vbShares));

  // ── Babysitting Requests ──
  const bsCfg = configs.bs || { count: 'unique' as const };
  const bsRo = bsCfg.rows || {};
  const bsFilterDate = (records: any[]) => {
    const range = eff.bs;
    if (!range.from && !range.to) return records;
    return records.filter((r: any) => {
      const ts = r.created_at;
      if (!ts) return true;
      if (range.from && range.from !== '1970-01-01' && ts < `${range.from}T00:00:00`) return false;
      if (range.to && ts > `${range.to}T23:59:59`) return false;
      return true;
    });
  };
  const bsReqs = bsFilterDate(bsrRequestsData);
  const bsCnt = (idx: number, records: any[], idKey: string) =>
    countWithOverride(records, idKey, bsCfg.count, bsRo[idx]);

  const bsrMetrics = [
    { label: "Created", tooltip: "Total babysitting requests created", total: bsCnt(0, bsReqs, 'parent_id'), override: bsRo[0] },
    { label: "Open", tooltip: "Requests currently seeking a babysitter", total: bsCnt(1, bsReqs.filter((r: any) => r.status === 'open'), 'parent_id'), override: bsRo[1] },
    { label: "Filled", tooltip: "A babysitter has been accepted", total: bsCnt(2, bsReqs.filter((r: any) => r.status === 'filled' || r.status === 'completed'), 'parent_id'), override: bsRo[2] },
    { label: "Completed", tooltip: "Babysitting job completed", total: bsCnt(3, bsReqs.filter((r: any) => r.status === 'completed'), 'parent_id'), override: bsRo[3] },
    { label: "Expired", tooltip: "Request expired without being filled", total: bsCnt(4, bsReqs.filter((r: any) => r.status === 'expired'), 'parent_id'), override: bsRo[4] },
    { label: "Cancelled", tooltip: "Request cancelled by parent", total: bsCnt(5, bsReqs.filter((r: any) => r.status === 'cancelled'), 'parent_id'), override: bsRo[5] },
  ];

  const bsrLive = [
    { label: "Created", total: bsReqs.length },
    { label: "Open", total: bsReqs.filter((r: any) => r.status === 'open').length },
    { label: "Filled", total: bsReqs.filter((r: any) => r.status === 'filled').length },
    { label: "Completed", total: bsReqs.filter((r: any) => r.status === 'completed').length },
    { label: "Expired", total: bsReqs.filter((r: any) => r.status === 'expired').length },
    { label: "Cancelled", total: bsReqs.filter((r: any) => r.status === 'cancelled').length },
  ];

  const bsrTimestamps: (number | null)[][] = bsReqs.map((r: any) => [
    toMs(r.created_at),  // Created
    r.status === 'open' ? toMs(r.created_at) : null, // Open
    toMs(r.accepted_at), // Filled
    null,                // Completed (auto, no explicit timestamp)
    r.status === 'expired' ? toMs(r.expires_at) : null, // Expired
    null,                // Cancelled
  ]);

  internalCatalog.set('bs', [
    { label: "Created", tooltip: "Total babysitting requests created", records: bsReqs, liveRecords: bsReqs, idKey: 'parent_id' },
    { label: "Open", tooltip: "Requests currently seeking a babysitter", records: bsReqs.filter((r: any) => r.status === 'open'), idKey: 'parent_id' },
    { label: "Filled", tooltip: "A babysitter has been accepted", records: bsReqs.filter((r: any) => r.status === 'filled' || r.status === 'completed'), liveRecords: bsReqs.filter((r: any) => r.status === 'filled'), idKey: 'parent_id' },
    { label: "Completed", tooltip: "Babysitting job completed", records: bsReqs.filter((r: any) => r.status === 'completed'), idKey: 'parent_id' },
    { label: "Expired", tooltip: "Request expired without being filled", records: bsReqs.filter((r: any) => r.status === 'expired'), idKey: 'parent_id' },
    { label: "Cancelled", tooltip: "Request cancelled by parent", records: bsReqs.filter((r: any) => r.status === 'cancelled'), idKey: 'parent_id' },
  ]);

  // ── BSR Notifications (nanny response funnel) ──
  const bnCfg = configs.bn || { count: 'unique' as const };
  const bnRo = bnCfg.rows || {};
  const bnFilterDate = (records: any[]) => {
    const range = eff.bn;
    if (!range.from && !range.to) return records;
    return records.filter((r: any) => {
      const ts = r.created_at;
      if (!ts) return true;
      if (range.from && range.from !== '1970-01-01' && ts < `${range.from}T00:00:00`) return false;
      if (range.to && ts > `${range.to}T23:59:59`) return false;
      return true;
    });
  };
  const bnNotifs = bnFilterDate(bsrNotificationsData);
  const bnCnt = (idx: number, records: any[], idKey: string) =>
    countWithOverride(records, idKey, bnCfg.count, bnRo[idx]);

  const bnViewed = bnNotifs.filter((n: any) => n.viewed_at);
  const bnRequested = bnNotifs.filter((n: any) => n.requested_at);
  const bnAccepted = bnNotifs.filter((n: any) => n.accepted_at);
  const bnDeclined = bnNotifs.filter((n: any) => n.declined_at);

  const bsrNotifMetrics = [
    { label: "Notified", tooltip: "Nannies sent a babysitting notification", total: bnCnt(0, bnNotifs, 'nanny_id'), override: bnRo[0] },
    { label: "Viewed", tooltip: "Nannies who viewed the babysitting request", total: bnCnt(1, bnViewed, 'nanny_id'), override: bnRo[1] },
    { label: "Requested", tooltip: "Nannies who expressed interest in the job", total: bnCnt(2, bnRequested, 'nanny_id'), override: bnRo[2] },
    { label: "Accepted", tooltip: "Nannies accepted for the babysitting job", total: bnCnt(3, bnAccepted, 'nanny_id'), override: bnRo[3] },
    { label: "Declined", tooltip: "Nannies who declined the babysitting request", total: bnCnt(4, bnDeclined, 'nanny_id'), override: bnRo[4] },
  ];

  // Live: exact current state (no subsequent action taken)
  const bnNotifOnly = bnNotifs.filter((n: any) => !n.viewed_at && !n.requested_at && !n.accepted_at && !n.declined_at);
  const bnViewedOnly = bnNotifs.filter((n: any) => n.viewed_at && !n.requested_at && !n.accepted_at && !n.declined_at);
  const bnRequestedOnly = bnNotifs.filter((n: any) => n.requested_at && !n.accepted_at && !n.declined_at);

  const bsrNotifLive = [
    { label: "Notified", total: bnNotifOnly.length },
    { label: "Viewed", total: bnViewedOnly.length },
    { label: "Requested", total: bnRequestedOnly.length },
    { label: "Accepted", total: bnAccepted.length },
    { label: "Declined", total: bnDeclined.length },
  ];

  const bsrNotifTimestamps: (number | null)[][] = bnNotifs.map((n: any) => [
    toMs(n.notified_at || n.created_at), // Notified
    toMs(n.viewed_at),     // Viewed
    toMs(n.requested_at),  // Requested
    toMs(n.accepted_at),   // Accepted
    toMs(n.declined_at),   // Declined
  ]);

  internalCatalog.set('bn', [
    { label: "Notified", tooltip: "Nannies sent a babysitting notification", records: bnNotifs, liveRecords: bnNotifOnly, idKey: 'nanny_id' },
    { label: "Viewed", tooltip: "Nannies who viewed the request", records: bnViewed, liveRecords: bnViewedOnly, idKey: 'nanny_id' },
    { label: "Requested", tooltip: "Nannies who expressed interest", records: bnRequested, liveRecords: bnRequestedOnly, idKey: 'nanny_id' },
    { label: "Accepted", tooltip: "Nannies accepted for the job", records: bnAccepted, idKey: 'nanny_id' },
    { label: "Declined", tooltip: "Nannies who declined the request", records: bnDeclined, idKey: 'nanny_id' },
  ]);

  // ── Key Metrics (broad summary stages for custom tab dropdown) ──
  const activeNannies = g.nannies.filter((n: any) => n.verification_level >= 2);
  const babysitters = g.nannies.filter((n: any) => n.visible_in_bsr === true);
  const activeConnsAll = connections.filter((c: any) => !TERMINAL_STAGES.has(c.connection_stage));
  const openBsr = bsrRequestsData.filter((r: any) => r.status === 'open');

  internalCatalog.set('kn', [
    { label: "Nannies", tooltip: "Total nanny accounts", records: g.nannies, idKey: 'user_id' },
    { label: "Active Nannies", tooltip: "Verified for matchmaking (Level 2+)", records: activeNannies, idKey: 'user_id' },
    { label: "Babysitters", tooltip: "Approved for babysitting (visible_in_bsr)", records: babysitters, idKey: 'user_id' },
    { label: "Placements", tooltip: "Nannies with a confirmed placement", records: g.placements, idKey: 'nanny_id' },
  ]);

  internalCatalog.set('kp', [
    { label: "Parents", tooltip: "Total parent accounts", records: g.parents, idKey: 'user_id' },
    { label: "Positions", tooltip: "Total position listings", records: g.positions, idKey: 'id' },
    { label: "Connections", tooltip: "Total connection requests", records: connections, liveRecords: activeConnsAll, idKey: 'id' },
    { label: "Active BSR", tooltip: "Currently open babysitting requests", records: openBsr, idKey: 'id' },
    { label: "Placements", tooltip: "Parents with a confirmed placement", records: g.placements, idKey: 'parent_id' },
  ]);

  // ── Annotate catalog stages with pre-computed dwell times ──
  // nf: catalog[0-4] → nannyTimestamps[1-5], catalog[5]=Connections(no ts), catalog[6-13] → ts[6-13]
  annotateTimings(internalCatalog.get('nf')!, nannyTimestamps, [1, 2, 3, 4, 5, -1, 6, 7, 8, 9, 10, 11, 12, 13]);
  // pf: 1:1 mapping (10 stages → parentTimestamps[0-9])
  annotateTimings(internalCatalog.get('pf')!, parentTimestamps, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  // pc: 11 stages → parentConnTimestamps[0-10] (Parents, Positions, Connections, then 8 conn stages)
  annotateTimings(internalCatalog.get('pc')!, parentConnTimestamps, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  // nc: 9 stages → nannyConnTimestamps[0-8]
  annotateTimings(internalCatalog.get('nc')!, nannyConnTimestamps, [0, 1, 2, 3, 4, 5, 6, 7, 8]);
  // df: 12 stages → dfyTimestamps[0-11]
  annotateTimings(internalCatalog.get('df')!, dfyTimestamps, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  // vn/vp/vb: 6 stages each → viral timestamps[0-5]
  annotateTimings(internalCatalog.get('vn')!, nannySharesTimestamps, [0, 1, 2, 3, 4, 5]);
  annotateTimings(internalCatalog.get('vp')!, positionSharesTimestamps, [0, 1, 2, 3, 4, 5]);
  annotateTimings(internalCatalog.get('vb')!, bsrSharesTimestamps, [0, 1, 2, 3, 4, 5]);
  // bs: 6 stages → bsrTimestamps[0-5]
  annotateTimings(internalCatalog.get('bs')!, bsrTimestamps, [0, 1, 2, 3, 4, 5]);
  // bn: 5 stages → bsrNotifTimestamps[0-4]
  annotateTimings(internalCatalog.get('bn')!, bsrNotifTimestamps, [0, 1, 2, 3, 4]);

  // ── Compute custom stages ──
  const customCfg = configs.custom || { count: 'unique' as const };

  // Build merged activity map for custom tab (covers all entity ID types)
  const allLastActive = new Map<string, number>();
  userLastActive.forEach((v, k) => allLastActive.set(k, v));
  leadLastActive.forEach((v, k) => allLastActive.set(k, v));
  for (const n of g.nannies) {
    const ts = userLastActive.get(n.user_id);
    if (ts) allLastActive.set(n.id, ts);
  }
  for (const p of g.parents) {
    const ts = userLastActive.get(p.user_id);
    if (ts) allLastActive.set(p.id, ts);
  }

  // Custom date range (from custom_from / custom_to URL params)
  const customRange: DateRange | undefined =
    (ranges as any).custom || undefined;

  const customStages = customEntries.length > 0
    ? buildCustomStages(internalCatalog, customEntries, customCfg, customRange, allLastActive)
    : [];

  // ── Client catalog (strip records, for dropdown) ──
  // Limit nf/pf to unique stages (connection stages covered by nc/pc)
  // Exclude wt (replaced by wtg/wtn/wtp in dropdown)
  const CATALOG_LIMITS: Record<string, number> = { nf: 6, pf: 2 };
  const CATALOG_EXCLUDE = new Set(['wt', 'wtn', 'wtp']);
  const catalog = Array.from(internalCatalog.entries())
    .filter(([key, stages]) => stages.length > 0 && !CATALOG_EXCLUDE.has(key))
    .map(([key, stages]) => {
      const limit = CATALOG_LIMITS[key];
      const visible = limit ? stages.slice(0, limit) : stages;
      return {
        name: TABLE_NAMES[key] || key,
        key,
        stages: visible.map(s => ({
          label: s.label,
          tooltip: s.tooltip,
          total: countWithOverride(s.records, s.idKey, (configs[key] || { count: 'unique' as const }).count),
          ...(s.tags ? { tags: s.tags } : {}),
        })),
      };
    });

  return {
    uniqueVisitors,
    totalNannySignups: g.nannies.length,
    totalParentSignups: g.parents.length,
    totalPlacements: g.placements.length,
    hasVisitorTracking: g.hasVisitorTracking,
    supplyCount, demandCount, medianDays,
    webTraffic, referrers: wtAllReferrers,
    nannyFlow, nannyTimestamps, nannyFlowLive,
    pageDropoff, pageDropoffLive,
    parentFunnel, parentTimestamps, parentFunnelLive, parentSourceBreakdown,
    parentConnCumulative, parentConnLive, parentConnTimestamps,
    nannyConnCumulative, nannyConnLive, nannyConnTimestamps,
    parentTerminalStages, nannyTerminalStages,
    avgConnsPerPos, fillRate,
    nannyVerifLevelsCumulative, nannyVerifLevelsLive,
    nannyIdentityCumulative, nannyIdentityLive,
    nannyWwccCumulative, nannyWwccLive,
    parentIdentityCumulative, parentIdentityLive,
    dfyMatchmaking, dfyMatchmakingLive, dfyTimestamps,
    dfyConnectionsCumulative, dfyConnectionsLive,
    nannySharesMetrics, nannySharesLive, nannySharesTimestamps,
    positionSharesMetrics, positionSharesLive, positionSharesTimestamps,
    bsrSharesMetrics, bsrSharesLive, bsrSharesTimestamps,
    bsrMetrics, bsrLive, bsrTimestamps,
    bsrNotifMetrics, bsrNotifLive, bsrNotifTimestamps,
    catalog,
    customStages,
  };
}

/* eslint-enable @typescript-eslint/no-explicit-any */

const TABLE_KEYS = ['wt', 'nf', 'pd', 'pf', 'pc', 'nc', 'nv', 'ni', 'nw', 'pv', 'df', 'dc', 'vn', 'vp', 'vb', 'bs', 'bn', 'custom'] as const;

function extractRange(params: Record<string, string | undefined>, key: string): DateRange | undefined {
  const from = params[`${key}_from`];
  const to = params[`${key}_to`];
  return (from || to) ? { from, to } : undefined;
}

export default async function AdminPipelinePage({
  searchParams,
}: {
  searchParams: Record<string, string | undefined>;
}) {
  const globalRange: DateRange = { from: searchParams.from, to: searchParams.to };
  const sourceFilter = searchParams.source || "";

  const sectionRanges: SectionRanges = { global: globalRange };
  const sectionConfigs: Record<string, SectionConfig> = {};
  for (const key of TABLE_KEYS) {
    const range = extractRange(searchParams, key);
    if (range) (sectionRanges as any)[key] = range;
    const count = searchParams[`${key}_count`] === 'all' ? 'all' as const : 'unique' as const;
    const activeStr = searchParams[`${key}_active`];
    const active = activeStr ? parseInt(activeStr) : undefined;
    const rowsStr = searchParams[`${key}_rows`];
    const rows = rowsStr ? parseRowOverrides(rowsStr) : undefined;
    if (count !== 'unique' || active !== undefined || rows) {
      sectionConfigs[key] = { count, active, rows };
    }
  }

  // Parse custom entries
  const customParam = searchParams.custom || '';
  const customEntries = customParam
    ? customParam.split(',').map(part => {
        const [key, idx] = part.split('.');
        return { key, index: parseInt(idx) };
      }).filter(e => !isNaN(e.index))
    : [];

  const data = await getPipelineData(sectionRanges, sourceFilter, sectionConfigs, customEntries);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Pipeline</h1>
        <p className="mt-1 text-slate-500">
          User journey funnels and conversion metrics
        </p>
      </div>

      <PipelineTabs catalog={data.catalog} customStages={data.customStages}>
      <div className="space-y-6">

      {/* Date Range */}
      <Card>
        <CardContent className="py-3 px-4">
          <Suspense fallback={<div className="h-8" />}>
            <DateRangePicker />
          </Suspense>
        </CardContent>
      </Card>

      {/* Key Metrics */}
      <Card>
        <CardContent className="py-3 px-5">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-[13px]">
            <div className="flex items-center gap-1.5">
              <span className="text-slate-400">Visitors</span>
              <span className="font-bold text-slate-900 tabular-nums">
                {data.hasVisitorTracking ? data.uniqueVisitors : "--"}
              </span>
            </div>
            <div className="h-4 w-px bg-slate-200" />
            <div className="flex items-center gap-1.5">
              <span className="text-slate-400">Nannies</span>
              <span className="font-bold text-slate-900 tabular-nums">{data.totalNannySignups}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-slate-400">Parents</span>
              <span className="font-bold text-slate-900 tabular-nums">{data.totalParentSignups}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-slate-400">Placements</span>
              <span className="font-bold text-slate-900 tabular-nums">{data.totalPlacements}</span>
            </div>
            <div className="h-4 w-px bg-slate-200" />
            <div className="flex items-center gap-1.5">
              <span className="text-slate-400">Supply:Demand</span>
              <span className="font-bold text-slate-900 tabular-nums">{data.supplyCount}:{data.demandCount}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-slate-400">Days to Placement</span>
              <span className="font-bold text-slate-900 tabular-nums">
                {data.medianDays !== null ? `${data.medianDays}d` : "--"}
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-slate-400">Conns/Position</span>
              <span className="font-bold text-slate-900 tabular-nums">{data.avgConnsPerPos ?? "--"}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-slate-400">Fill Rate</span>
              <span className="font-bold text-slate-900 tabular-nums">
                {data.fillRate !== null ? `${data.fillRate}%` : "--"}
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-slate-400">Open Positions</span>
              <span className="font-bold text-slate-900 tabular-nums">{data.demandCount}</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Web Traffic */}
      <Card>
        <CardContent className="pt-5">
          <PipelineTable
            title="Web Traffic"
            subtitle="Page visits, actions, and signup conversions"
            metricType="current"
            stages={data.webTraffic}
            tableKey="wt"
          />
        </CardContent>
      </Card>

      {/* Nanny Flow (11-stage table) */}
      <Card>
        <CardContent className="pt-5">
          <PipelineTable
            title="Nanny Flow"
            subtitle="Full lifecycle from first visit to placement"
            metricType="cumulative"
            stages={data.nannyFlow}
            liveStages={data.nannyFlowLive}
            timestamps={
              data.nannyTimestamps.length > 0
                ? data.nannyTimestamps
                : undefined
            }
            tableKey="nf"
          />
        </CardContent>
      </Card>

      {/* Parent Pipeline (full width) */}
      <Card>
        <CardContent className="pt-5">
          <div className="flex items-center justify-end mb-1">
            <Suspense fallback={null}>
              <FilterBar />
            </Suspense>
          </div>
          <PipelineTable
            title="Parent Pipeline"
            subtitle={
              sourceFilter ? `Filtered: ${sourceFilter}` : undefined
            }
            metricType="cumulative"
            stages={data.parentFunnel}
            liveStages={data.parentFunnelLive}
            timestamps={
              data.parentTimestamps.length > 0
                ? data.parentTimestamps
                : undefined
            }
            tableKey="pf"
          />
          {data.parentSourceBreakdown.length > 0 && (
            <div className="mt-4 pt-4 border-t border-slate-100">
              <PipelineTable
                title="Signup Sources"
                subtitle="Where parents signed up from (referrer page)"
                metricType="current"
                stages={data.parentSourceBreakdown}
                hideDatePicker
                hideActiveFilter
              />
            </div>
          )}
        </CardContent>
      </Card>

      {/* Row 7: Position Connections (Parent perspective, full width) */}
      <Card>
        <CardContent className="pt-5">
          <PipelineTable
            title="Position Connections"
            subtitle="Unique parents at each connection stage"
            metricType="cumulative"
            stages={data.parentConnCumulative}
            liveStages={data.parentConnLive}
            timestamps={
              data.parentConnTimestamps.length > 0
                ? data.parentConnTimestamps
                : undefined
            }
            tableKey="pc"
          />
          {data.parentTerminalStages.length > 0 && (
            <div className="mt-4 pt-4 border-t border-slate-100">
              <PipelineTable
                title="Terminal States"
                subtitle="Unique parents whose connections ended at each stage"
                metricType="current"
                stages={data.parentTerminalStages}
              />
            </div>
          )}
        </CardContent>
      </Card>

      {/* Row 8: Nanny Connections (full width) */}
      <Card>
        <CardContent className="pt-5">
          <PipelineTable
            title="Nanny Connections"
            subtitle="Unique nannies at each connection stage"
            metricType="cumulative"
            stages={data.nannyConnCumulative}
            liveStages={data.nannyConnLive}
            timestamps={
              data.nannyConnTimestamps.length > 0
                ? data.nannyConnTimestamps
                : undefined
            }
            tableKey="nc"
          />
          {data.nannyTerminalStages.length > 0 && (
            <div className="mt-4 pt-4 border-t border-slate-100">
              <PipelineTable
                title="Terminal States"
                subtitle="Unique nannies whose connections ended at each stage"
                metricType="current"
                stages={data.nannyTerminalStages}
              />
            </div>
          )}
        </CardContent>
      </Card>

      {/* Row 9: Nanny Verification Levels */}
      <Card>
        <CardContent className="pt-5">
          <PipelineTable
            title="Nanny Verification Levels"
            subtitle="Progression through verification stages"
            metricType="cumulative"
            stages={data.nannyVerifLevelsCumulative}
            liveStages={data.nannyVerifLevelsLive}
            tableKey="nv"
          />
        </CardContent>
      </Card>

      {/* Row 11: Nanny Identity Verification */}
      <Card>
        <CardContent className="pt-5">
          <PipelineTable
            title="Identity Verification"
            subtitle="Nanny identity verification progression"
            metricType="cumulative"
            stages={data.nannyIdentityCumulative}
            liveStages={data.nannyIdentityLive}
            tableKey="ni"
          />
        </CardContent>
      </Card>

      {/* Row 12: WWCC Verification */}
      <Card>
        <CardContent className="pt-5">
          <PipelineTable
            title="WWCC Verification"
            subtitle="Nanny WWCC verification progression"
            metricType="cumulative"
            stages={data.nannyWwccCumulative}
            liveStages={data.nannyWwccLive}
            tableKey="nw"
          />
        </CardContent>
      </Card>

      {/* Row 13: Parent Verification */}
      <Card>
        <CardContent className="pt-5">
          {data.parentIdentityCumulative ? (
            <PipelineTable
              title="Parent Verification"
              subtitle="Parent identity verification progression"
              metricType="cumulative"
              stages={data.parentIdentityCumulative}
              liveStages={data.parentIdentityLive ?? undefined}
              tableKey="pv"
            />
          ) : (
            <div className="py-6 text-center">
              <h3 className="text-base font-semibold text-slate-900 mb-1">
                Parent Verification
              </h3>
              <p className="text-sm text-slate-400">
                No parent verification records yet
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* DFY Matchmaking */}
      <Card>
        <CardContent className="pt-5">
          <PipelineTable
            title="DFY Matchmaking"
            subtitle="Done-for-you matching: position activation and nanny response funnel"
            metricType="cumulative"
            stages={data.dfyMatchmaking}
            liveStages={data.dfyMatchmakingLive}
            timestamps={data.dfyTimestamps.length > 0 ? data.dfyTimestamps : undefined}
            tableKey="df"
          />
        </CardContent>
      </Card>

      {/* DFY Connections */}
      <Card>
        <CardContent className="pt-5">
          <PipelineTable
            title="DFY Connections"
            subtitle="Connection funnel for DFY-sourced matches"
            metricType="cumulative"
            stages={data.dfyConnectionsCumulative}
            liveStages={data.dfyConnectionsLive}
            tableKey="dc"
          />
        </CardContent>
      </Card>

      {/* Viral Shares — Nanny */}
      <Card>
        <CardContent className="pt-5">
          <PipelineTable
            title="Nanny Profile Shares"
            subtitle="Nannies sharing their profile to Facebook groups"
            metricType="cumulative"
            stages={data.nannySharesMetrics}
            liveStages={data.nannySharesLive}
            timestamps={data.nannySharesTimestamps.length > 0 ? data.nannySharesTimestamps : undefined}
            tableKey="vn"
          />
        </CardContent>
      </Card>

      {/* Viral Shares — Position */}
      <Card>
        <CardContent className="pt-5">
          <PipelineTable
            title="Position Shares"
            subtitle="Parents sharing their nanny position to Facebook groups"
            metricType="cumulative"
            stages={data.positionSharesMetrics}
            liveStages={data.positionSharesLive}
            timestamps={data.positionSharesTimestamps.length > 0 ? data.positionSharesTimestamps : undefined}
            tableKey="vp"
          />
        </CardContent>
      </Card>

      {/* Viral Shares — BSR */}
      <Card>
        <CardContent className="pt-5">
          <PipelineTable
            title="BSR Shares"
            subtitle="Parents sharing their babysitting request to Facebook groups"
            metricType="cumulative"
            stages={data.bsrSharesMetrics}
            liveStages={data.bsrSharesLive}
            timestamps={data.bsrSharesTimestamps.length > 0 ? data.bsrSharesTimestamps : undefined}
            tableKey="vb"
          />
        </CardContent>
      </Card>

      {/* Babysitting Requests */}
      <Card>
        <CardContent className="pt-5">
          <PipelineTable
            title="Babysitting Requests"
            subtitle="One-time babysitting job request lifecycle"
            metricType="cumulative"
            stages={data.bsrMetrics}
            liveStages={data.bsrLive}
            timestamps={data.bsrTimestamps.length > 0 ? data.bsrTimestamps : undefined}
            tableKey="bs"
          />
        </CardContent>
      </Card>

      {/* BSR Notifications */}
      <Card>
        <CardContent className="pt-5">
          <PipelineTable
            title="BSR Notifications"
            subtitle="Nanny response funnel for babysitting notifications"
            metricType="cumulative"
            stages={data.bsrNotifMetrics}
            liveStages={data.bsrNotifLive}
            timestamps={data.bsrNotifTimestamps.length > 0 ? data.bsrNotifTimestamps : undefined}
            tableKey="bn"
          />
        </CardContent>
      </Card>

      {/* Application Page Drop-off (bottom) */}
      <Card>
        <CardContent className="pt-5">
          {data.pageDropoff ? (
            <PipelineTable
              title="Application Page Drop-off"
              subtitle="Where nanny applicants stop in the multi-step form"
              metricType="cumulative"
              stages={data.pageDropoff}
              liveStages={data.pageDropoffLive ?? undefined}
              tableKey="pd"
            />
          ) : (
            <div className="py-8 text-center">
              <h3 className="text-base font-semibold text-slate-900 mb-2">
                Application Page Drop-off
              </h3>
              <p className="text-sm text-slate-400">Collecting data...</p>
              <p className="text-xs text-slate-300 mt-1">
                Page drop-off tracking activates once applicants use the
                updated form
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Referrers */}
      {data.referrers.length > 0 && (
        <Card>
          <CardContent className="pt-5">
            <PipelineTable
              title="Referrers"
              subtitle="Where visitors came from (all referrer sources)"
              metricType="current"
              stages={data.referrers}
              hideDatePicker
              hideActiveFilter
            />
          </CardContent>
        </Card>
      )}

      </div>
      </PipelineTabs>
    </div>
  );
}
