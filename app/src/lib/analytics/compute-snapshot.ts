import { createAdminClient } from "@/lib/supabase/admin";
import { SITE_DOMAIN } from "@/lib/constants";

/* eslint-disable @typescript-eslint/no-explicit-any */

// ── Types ──

export interface SnapshotStage {
  label: string;
  total_unique: number;
  total_all: number;
  live_unique: number | null;
  live_all: number | null;
  median_dwell_ms: number | null;
  tags: string[] | null;
}

export interface SectionSnapshot {
  section_key: string;
  stages: SnapshotStage[];
}

// ── Constants ──

const PLACED_STAGES = new Set([34, 50, 51]);
const TERMINAL_STAGES = new Set([1, 2, 3, 11, 22, 35, 36, 50, 51]);
const CONN_LABELS = [
  "Requested", "Accepted", "Meet Scheduled", "Meet Completed",
  "Trial Arranged", "Trial Completed", "Offered", "Placements",
];

const IDENTITY_OUTCOMES = ["verified", "rejected", "failed"];
const IDENTITY_PAST_PENDING = ["processing", "review", ...IDENTITY_OUTCOMES];
const WWCC_OUTCOMES = ["doc_verified", "review", "rejected", "failed", "expired", "barred", "ocg_not_found", "closed"];
const WWCC_PAST_APP_PENDING = ["pending", "processing", ...WWCC_OUTCOMES];
const WWCC_PAST_PENDING = ["processing", ...WWCC_OUTCOMES];

// ── Helpers ──

function toMs(ts: string | null | undefined): number | null {
  if (!ts) return null;
  return new Date(ts).getTime();
}

function medianVal(arr: number[]): number | null {
  if (arr.length === 0) return null;
  const sorted = [...arr].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

interface IntStage {
  label: string;
  records: any[];
  liveRecords?: any[];
  idKey: string;
  tags?: string[];
  medianDwell?: number | null;
}

function annotateDwell(
  stages: IntStage[],
  timestamps: (number | null)[][],
  indexMap: number[]
) {
  if (!timestamps.length) return;
  for (let ci = 0; ci < stages.length && ci < indexMap.length; ci++) {
    const ti = indexMap[ci];
    if (ti < 0) continue;
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
    stages[ci].medianDwell = diffs.length > 0 ? medianVal(diffs) : null;
  }
}

function snap(stages: IntStage[], defaultTags?: string[]): SnapshotStage[] {
  return stages.map(s => ({
    label: s.label,
    total_unique: new Set(s.records.map(r => r[s.idKey])).size,
    total_all: s.records.length,
    live_unique: s.liveRecords ? new Set(s.liveRecords.map(r => r[s.idKey])).size : null,
    live_all: s.liveRecords ? s.liveRecords.length : null,
    median_dwell_ms: s.medianDwell ?? null,
    tags: s.tags ?? defaultTags ?? null,
  }));
}

function connStages(conns: any[], idKey: string): IntStage[] {
  const thresholds = [0, 10, 20, 21, 31, 32, 33, -1];
  const ranges: [number, number][] = [
    [0, 0], [10, 19], [20, 20], [21, 30], [31, 31], [32, 32], [33, 33], [34, 34],
  ];
  const active = conns.filter(c => !TERMINAL_STAGES.has(c.connection_stage));
  return CONN_LABELS.map((label, i) => {
    const threshold = thresholds[i];
    const filtered = threshold === -1
      ? conns.filter(c => PLACED_STAGES.has(c.connection_stage))
      : conns.filter(c => c.connection_stage >= threshold);
    const [mn, mx] = ranges[i];
    const live = active.filter(c => c.connection_stage >= mn && c.connection_stage <= mx);
    return { label, records: filtered, liveRecords: live, idKey };
  });
}

// ── Main ──

export async function computeSnapshot(): Promise<SectionSnapshot[]> {
  const admin = createAdminClient();
  const now = Date.now();

  const [
    connectionsRes, userStatsRes, verificationsRes,
    dfyNotificationsRes, viralSharesRes, bsrRequestsRes, bsrNotificationsRes, dfyPositionsRes,
    testFlagRes, testEmailRes,
    visitsRes, applyVisitsRes, nanniesRes, parentsRes, placementsRes, positionsRes, leadsRes,
  ] = await Promise.all([
    admin.from("connection_requests").select("id, nanny_id, parent_id, position_id, connection_stage, created_at"),
    admin.from("user_stats").select("user_id, user_type, lead_id, lead_created_at, lead_status, account_created_at, first_connection_at, first_accepted_at, first_meetup_at, first_placement_at, first_position_at, updated_at"),
    admin.from("verifications").select("user_id, identity_status, wwcc_status, created_at"),
    admin.from("dfy_match_notifications").select("id, position_id, nanny_id, status, wave, notified_at, viewed_at, responded_at, created_at").then((r: any) => r, () => ({ data: null })),
    admin.from("viral_shares").select("id, user_id, case_type, share_status, created_at, shared_at, submitted_at, approved_at, failed_at, bypassed_at").then((r: any) => r, () => ({ data: null })),
    admin.from("babysitting_requests").select("id, parent_id, status, accepted_at, created_at, expires_at").then((r: any) => r, () => ({ data: null })),
    admin.from("bsr_notifications").select("id, babysitting_request_id, nanny_id, notified_at, viewed_at, requested_at, accepted_at, declined_at, created_at").then((r: any) => r, () => ({ data: null })),
    admin.from("nanny_positions").select("id, parent_id, dfy_activated_at, dfy_tier, dfy_expires_at, source, created_at").not('dfy_activated_at', 'is', null).eq("source", "parent").then((r: any) => r, () => ({ data: null })),
    admin.from("user_profiles").select("user_id").eq("is_test", true).then((r: any) => r, () => ({ data: [] })),
    admin.from("user_profiles").select("user_id").ilike("email", `%${SITE_DOMAIN}`),
    admin.from("page_visits").select("visitor_id, referrer_source, page_path, created_at"),
    admin.from("page_visits").select("visitor_id, created_at").or("page_path.like./apply/nanny%,page_path.eq./apply"),
    admin.from("nannies").select("id, user_id, verification_level, visible_in_bsr, created_at, updated_at"),
    admin.from("parents").select("id, user_id, signup_source, created_at, updated_at"),
    admin.from("nanny_placements").select("id, nanny_id, parent_id, created_at"),
    admin.from("nanny_positions").select("id, parent_id, status, source, created_at").eq("source", "parent"),
    admin.from("nanny_leads").select("id, visitor_id, lead_status, funnel_step, highest_page_reached, created_at, updated_at"),
  ]);

  // ── Test account filtering ──
  const testUserIds = new Set([
    ...((testFlagRes.data || []).map((u: any) => u.user_id as string)),
    ...((testEmailRes.data || []).map((u: any) => u.user_id as string)),
  ]);
  const allNanniesRaw = (nanniesRes.data || []) as any[];
  const allParentsRaw = (parentsRes.data || []) as any[];
  const testNannyIds = new Set(allNanniesRaw.filter((n: any) => testUserIds.has(n.user_id)).map((n: any) => n.id as string));
  const testParentIds = new Set(allParentsRaw.filter((p: any) => testUserIds.has(p.user_id)).map((p: any) => p.id as string));

  const rawDfyPos = (dfyPositionsRes.data || []) as any[];
  const rawBsr = (bsrRequestsRes.data || []) as any[];
  const rawUS = (userStatsRes.data || []) as any[];
  const testPosIds = new Set(rawDfyPos.filter((p: any) => testParentIds.has(p.parent_id)).map((p: any) => p.id));
  const testBsrIds = new Set(rawBsr.filter((r: any) => testParentIds.has(r.parent_id)).map((r: any) => r.id));
  const testLeadIds = new Set(rawUS.filter((us: any) => testUserIds.has(us.user_id) && us.lead_id).map((us: any) => us.lead_id as string));

  // ── Apply filters ──
  const connections = ((connectionsRes.data || []) as any[]).filter((c: any) => !testNannyIds.has(c.nanny_id) && !testParentIds.has(c.parent_id));
  const userStats = rawUS.filter((us: any) => !testUserIds.has(us.user_id));
  const verifs = ((verificationsRes.data || []) as any[]).filter((v: any) => !testUserIds.has(v.user_id));
  const dfyNotifs = ((dfyNotificationsRes.data || []) as any[]).filter((n: any) => !testNannyIds.has(n.nanny_id) && !testPosIds.has(n.position_id));
  const viralAll = ((viralSharesRes.data || []) as any[]).filter((s: any) => !testUserIds.has(s.user_id));
  const bsrReqs = rawBsr.filter((r: any) => !testParentIds.has(r.parent_id));
  const bsrNots = ((bsrNotificationsRes.data || []) as any[]).filter((n: any) => !testNannyIds.has(n.nanny_id) && !testBsrIds.has(n.babysitting_request_id));
  const dfyPos = rawDfyPos.filter((p: any) => !testParentIds.has(p.parent_id));

  const visits = (visitsRes.data || []) as any[];
  const applyVisits = (applyVisitsRes.data || []) as any[];
  const nannies = allNanniesRaw.filter((n: any) => !testUserIds.has(n.user_id));
  const parents = allParentsRaw.filter((p: any) => !testUserIds.has(p.user_id));
  const placements = ((placementsRes.data || []) as any[]).filter((pl: any) => !testNannyIds.has(pl.nanny_id) && !testParentIds.has(pl.parent_id));
  const positions = ((positionsRes.data || []) as any[]).filter((p: any) => !testParentIds.has(p.parent_id));
  const leads = ((leadsRes.data || []) as any[]).filter((l: any) => !testLeadIds.has(l.id));

  // ID sets
  const nannyIdSet = new Set(nannies.map((n: any) => n.id));
  const nannyUserIdSet = new Set(nannies.map((n: any) => n.user_id));
  const parentIdSet = new Set(parents.map((p: any) => p.id));
  const parentUserIdSet = new Set(parents.map((p: any) => p.user_id));

  const sections: SectionSnapshot[] = [];

  // ═══════════════════════════════════════════════
  // STATS (KPIs)
  // ═══════════════════════════════════════════════
  const uniqueVisitors = !visitsRes.error ? new Set(visits.map((v: any) => v.visitor_id)).size : 0;
  const supplyCount = nannies.filter((n: any) => n.verification_level >= 2).length;
  const demandCount = positions.filter((p: any) => p.status === "active" || p.status === "open").length;

  const parentCreateMap = new Map(parents.map((p: any) => [p.id, new Date(p.created_at).getTime()]));
  const daysArr: number[] = [];
  for (const pl of placements) {
    const parentTs = parentCreateMap.get(pl.parent_id);
    if (parentTs) daysArr.push(Math.round((new Date(pl.created_at).getTime() - parentTs) / 86400000));
  }
  daysArr.sort((a, b) => a - b);
  const medianDays = daysArr.length > 0 ? daysArr[Math.floor(daysArr.length / 2)] : null;

  const posConnMap = new Map<string, number>();
  for (const c of connections) {
    if (c.position_id) posConnMap.set(c.position_id, (posConnMap.get(c.position_id) || 0) + 1);
  }
  const pcc = Array.from(posConnMap.values());
  const avgConnsPerPos = pcc.length > 0 ? Math.round((pcc.reduce((a, b) => a + b, 0) / pcc.length) * 10) / 10 : null;

  const placedPosIds = new Set<string>();
  for (const c of connections) {
    if (c.position_id && PLACED_STAGES.has(c.connection_stage)) placedPosIds.add(c.position_id);
  }
  const fillRate = positions.length > 0 ? Math.round((placedPosIds.size / positions.length) * 100) : null;

  const kpi = (label: string, value: number | null): SnapshotStage => ({
    label, total_unique: value ?? 0, total_all: value ?? 0,
    live_unique: null, live_all: null, median_dwell_ms: null, tags: null,
  });

  sections.push({
    section_key: 'stats',
    stages: [
      kpi("uniqueVisitors", uniqueVisitors),
      kpi("totalNannySignups", nannies.length),
      kpi("totalParentSignups", parents.length),
      kpi("totalPlacements", placements.length),
      kpi("supplyCount", supplyCount),
      kpi("demandCount", demandCount),
      kpi("medianDays", medianDays),
      kpi("avgConnsPerPos", avgConnsPerPos),
      kpi("fillRate", fillRate),
    ],
  });

  // ═══════════════════════════════════════════════
  // WEB TRAFFIC
  // ═══════════════════════════════════════════════
  const pageCats: { label: string; match: (p: string) => boolean }[] = [
    { label: "Home", match: p => p === "/" },
    { label: "For Nannies", match: p => p === "/for-nannies" || p === "/childcare-professionals" },
    { label: "Browse Nannies", match: p => p === "/nannies" || p.startsWith("/nannies/") },
    { label: "Quick Match Results", match: p => p.startsWith("/matchmaking/results") },
    { label: "Matchmaking Form", match: p => p.startsWith("/matchmaking/onboarding") },
    { label: "Matchmaking Signup", match: p => p.startsWith("/matchmaking/signup") },
    { label: "How It Works", match: p => p === "/how-it-works" },
    { label: "Pricing", match: p => p === "/pricing" },
    { label: "Apply Page", match: p => p.startsWith("/apply/nanny") || p === "/apply" },
    { label: "Signup Pages", match: p => p.startsWith("/signup") },
    { label: "Login", match: p => p === "/login" },
    { label: "Nanny Profiles", match: p => /^\/nannies\/[^/]+/.test(p) },
    { label: "BSR Pages", match: p => /^\/babysitting\/[^/]+/.test(p) },
    { label: "Position Pages", match: p => /^\/position\/[^/]+/.test(p) },
  ];

  const refGroups = new Map<string, any[]>();
  for (const v of visits) {
    const src = v.referrer_source || "Direct";
    if (!refGroups.has(src)) refGroups.set(src, []);
    refGroups.get(src)!.push(v);
  }
  const topRefs = Array.from(refGroups.entries())
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, 8);

  const completedLeads = leads.filter((l: any) => ["applied", "ai_generated", "converted"].includes(l.lead_status));

  const wtStages: IntStage[] = [
    { label: "All Visitors", records: visits, idKey: 'visitor_id' },
    ...pageCats.map(({ label, match }) => ({
      label, records: visits.filter((v: any) => match(v.page_path)), idKey: 'visitor_id',
    })),
    ...topRefs.map(([src, recs]) => ({
      label: `↳ ${src}`, records: recs, idKey: 'visitor_id',
    })),
    { label: "Started Application", records: leads, idKey: 'id' },
    { label: "Completed App", records: completedLeads, idKey: 'id' },
    { label: "Nanny Accounts", records: nannies, idKey: 'id' },
    { label: "Parent Accounts", records: parents, idKey: 'id' },
  ];
  sections.push({ section_key: 'wt', stages: snap(wtStages, ['T']) });

  // ═══════════════════════════════════════════════
  // NANNY FLOW (14 stages)
  // ═══════════════════════════════════════════════
  const nfConns = connections.filter((c: any) => nannyIdSet.has(c.nanny_id));
  const nfActive = nfConns.filter((c: any) => !TERMINAL_STAGES.has(c.connection_stage));

  const nfStages: IntStage[] = [
    { label: "Visited Apply", records: applyVisits, idKey: 'visitor_id', tags: ['N'] },
    { label: "Started Form", records: leads, liveRecords: leads.filter((l: any) => !["applied", "ai_generated", "converted"].includes(l.lead_status)), idKey: 'id', tags: ['N'] },
    { label: "Submitted Form", records: leads.filter((l: any) => ["applied", "ai_generated", "converted"].includes(l.lead_status)), liveRecords: leads.filter((l: any) => l.lead_status === "applied"), idKey: 'id', tags: ['N'] },
    { label: "Profile Generated", records: leads.filter((l: any) => ["ai_generated", "converted"].includes(l.lead_status)), liveRecords: leads.filter((l: any) => l.lead_status === "ai_generated"), idKey: 'id', tags: ['N'] },
    { label: "Account Created", records: leads.filter((l: any) => l.lead_status === "converted"), idKey: 'id', tags: ['N'] },
    { label: "Fully Verified", records: nannies.filter((n: any) => n.verification_level === 4), idKey: 'user_id', tags: ['N'] },
    { label: "Requested", records: nfConns, liveRecords: nfActive.filter((c: any) => c.connection_stage === 0), idKey: 'nanny_id', tags: ['N'] },
    { label: "Accepted", records: nfConns.filter((c: any) => c.connection_stage >= 10), liveRecords: nfActive.filter((c: any) => c.connection_stage >= 10 && c.connection_stage <= 19), idKey: 'nanny_id', tags: ['N'] },
    { label: "Meet Scheduled", records: nfConns.filter((c: any) => c.connection_stage >= 20), liveRecords: nfActive.filter((c: any) => c.connection_stage === 20), idKey: 'nanny_id', tags: ['N'] },
    { label: "Meet Completed", records: nfConns.filter((c: any) => c.connection_stage >= 21), liveRecords: nfActive.filter((c: any) => c.connection_stage >= 21 && c.connection_stage <= 30), idKey: 'nanny_id', tags: ['N'] },
    { label: "Trial Arranged", records: nfConns.filter((c: any) => c.connection_stage >= 31), liveRecords: nfActive.filter((c: any) => c.connection_stage === 31), idKey: 'nanny_id', tags: ['N'] },
    { label: "Trial Completed", records: nfConns.filter((c: any) => c.connection_stage >= 32), liveRecords: nfActive.filter((c: any) => c.connection_stage === 32), idKey: 'nanny_id', tags: ['N'] },
    { label: "Offered", records: nfConns.filter((c: any) => c.connection_stage >= 33), liveRecords: nfActive.filter((c: any) => c.connection_stage === 33), idKey: 'nanny_id', tags: ['N'] },
    { label: "Placements", records: nfConns.filter((c: any) => PLACED_STAGES.has(c.connection_stage)), liveRecords: nfConns.filter((c: any) => c.connection_stage === 34), idKey: 'nanny_id', tags: ['N'] },
  ];

  const nfUS = userStats.filter((us: any) => us.user_type === "nanny" && nannyUserIdSet.has(us.user_id));
  const nfTS: (number | null)[][] = nfUS.map((us: any) => [
    null, toMs(us.lead_created_at),
    ["applied", "ai_generated", "converted"].includes(us.lead_status) ? toMs(us.lead_created_at) : null,
    ["ai_generated", "converted"].includes(us.lead_status) ? toMs(us.lead_created_at) : null,
    us.lead_status === "converted" ? toMs(us.account_created_at) : null,
    null, toMs(us.first_connection_at), toMs(us.first_accepted_at),
    null, toMs(us.first_meetup_at), null, null, null, toMs(us.first_placement_at),
  ]);
  annotateDwell(nfStages, nfTS, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
  sections.push({ section_key: 'nf', stages: snap(nfStages, ['N']) });

  // ═══════════════════════════════════════════════
  // PAGE DROP-OFF (10 stages)
  // ═══════════════════════════════════════════════
  const pageNames = ["Identity", "Experience", "Qualifications", "Residency", "Contact", "Preferences", "Matching", "Availability", "Salary", "About You"];
  const lwp = leads.filter((l: any) => l.highest_page_reached != null && l.highest_page_reached > 0);

  if (lwp.length >= 3) {
    const pdStages: IntStage[] = pageNames.map((label, i) => ({
      label,
      records: lwp.filter((l: any) => l.highest_page_reached >= i + 1),
      liveRecords: lwp.filter((l: any) => l.highest_page_reached === i + 1),
      idKey: 'id',
      tags: ['N'] as string[],
    }));
    sections.push({ section_key: 'pd', stages: snap(pdStages, ['N']) });
  }

  // ═══════════════════════════════════════════════
  // PARENT PIPELINE (10 stages)
  // ═══════════════════════════════════════════════
  const pfConns = connections.filter((c: any) => parentIdSet.has(c.parent_id));
  const pfPos = positions.filter((p: any) => parentIdSet.has(p.parent_id));
  const pfCS = connStages(pfConns, 'parent_id');
  const pfStages: IntStage[] = [
    { label: "Account Created", records: parents, idKey: 'user_id', tags: ['P'] },
    { label: "Position Created", records: pfPos, idKey: 'parent_id', tags: ['P'] },
    ...pfCS.map(s => ({ ...s, label: s.label === "Requested" ? "Request Sent" : s.label === "Placements" ? "Hired" : s.label, tags: ['P'] as string[] })),
  ];

  const pfUS = userStats.filter((us: any) => us.user_type === "parent" && parentUserIdSet.has(us.user_id));
  const pfTS: (number | null)[][] = pfUS.map((us: any) => [
    toMs(us.account_created_at), toMs(us.first_position_at), toMs(us.first_connection_at),
    toMs(us.first_accepted_at), null, toMs(us.first_meetup_at), null, null, null, toMs(us.first_placement_at),
  ]);
  annotateDwell(pfStages, pfTS, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  sections.push({ section_key: 'pf', stages: snap(pfStages, ['P']) });

  // ═══════════════════════════════════════════════
  // POSITION CONNECTIONS (11 stages)
  // ═══════════════════════════════════════════════
  const pcPosSet = new Set(pfPos.map((p: any) => p.parent_id));
  const pcActive = pfConns.filter((c: any) => !TERMINAL_STAGES.has(c.connection_stage));
  const pcCS = connStages(pfConns, 'parent_id');
  const pcStages: IntStage[] = [
    { label: "Parents", records: parents, liveRecords: parents.filter((p: any) => !pcPosSet.has(p.id)), idKey: 'user_id', tags: ['P'] },
    { label: "Positions", records: pfPos, liveRecords: pfPos, idKey: 'id', tags: ['P'] },
    { label: "Connections", records: pfConns, liveRecords: pcActive, idKey: 'id', tags: ['P'] },
    ...pcCS.map(s => ({ ...s, tags: ['P'] as string[] })),
  ];

  const pcTS: (number | null)[][] = pfUS.map((us: any) => [
    null, toMs(us.first_position_at), toMs(us.first_connection_at),
    toMs(us.first_connection_at), toMs(us.first_accepted_at), null, toMs(us.first_meetup_at),
    null, null, null, toMs(us.first_placement_at),
  ]);
  annotateDwell(pcStages, pcTS, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  sections.push({ section_key: 'pc', stages: snap(pcStages, ['P']) });

  // ═══════════════════════════════════════════════
  // NANNY CONNECTIONS (9 stages)
  // ═══════════════════════════════════════════════
  const ncConns = nfConns;
  const ncNoConn = nannies.filter((n: any) => !new Set(ncConns.map((c: any) => c.nanny_id)).has(n.id));
  const ncCS = connStages(ncConns, 'nanny_id');
  const ncStages: IntStage[] = [
    { label: "Nannies", records: nannies, liveRecords: ncNoConn, idKey: 'user_id', tags: ['N'] },
    ...ncCS.map(s => ({ ...s, tags: ['N'] as string[] })),
  ];

  const ncTS: (number | null)[][] = nfUS.map((us: any) => [
    null, toMs(us.first_connection_at), toMs(us.first_accepted_at),
    null, toMs(us.first_meetup_at), null, null, null, toMs(us.first_placement_at),
  ]);
  annotateDwell(ncStages, ncTS, [0, 1, 2, 3, 4, 5, 6, 7, 8]);
  sections.push({ section_key: 'nc', stages: snap(ncStages, ['N']) });

  // ═══════════════════════════════════════════════
  // NANNY VERIFICATION LEVELS (5 stages)
  // ═══════════════════════════════════════════════
  const nvStages: IntStage[] = [
    { label: "Unverified", records: nannies.filter((n: any) => n.verification_level === 0), idKey: 'user_id' },
    { label: "ID Verified", records: nannies.filter((n: any) => n.verification_level >= 1), liveRecords: nannies.filter((n: any) => n.verification_level === 1), idKey: 'user_id' },
    { label: "WWCC Verified", records: nannies.filter((n: any) => n.verification_level >= 2), liveRecords: nannies.filter((n: any) => n.verification_level === 2), idKey: 'user_id' },
    { label: "Provisional", records: nannies.filter((n: any) => n.verification_level >= 3), liveRecords: nannies.filter((n: any) => n.verification_level === 3), idKey: 'user_id' },
    { label: "Fully Verified", records: nannies.filter((n: any) => n.verification_level >= 4), idKey: 'user_id' },
  ];
  sections.push({ section_key: 'nv', stages: snap(nvStages, ['V', 'N']) });

  // ═══════════════════════════════════════════════
  // IDENTITY VERIFICATION (5 stages)
  // ═══════════════════════════════════════════════
  const niVerifs = verifs.filter((v: any) => nannyUserIdSet.has(v.user_id));
  const niStages: IntStage[] = [
    { label: "Nannies", records: niVerifs, idKey: 'user_id' },
    { label: "Initiated", records: niVerifs.filter((v: any) => v.identity_status !== "not_started"), idKey: 'user_id' },
    { label: "Processing", records: niVerifs.filter((v: any) => IDENTITY_PAST_PENDING.includes(v.identity_status)), idKey: 'user_id' },
    { label: "Outcome", records: niVerifs.filter((v: any) => IDENTITY_OUTCOMES.includes(v.identity_status)), idKey: 'user_id' },
    { label: "Verified", records: niVerifs.filter((v: any) => v.identity_status === "verified"), idKey: 'user_id' },
  ];
  sections.push({ section_key: 'ni', stages: snap(niStages, ['V', 'N']) });

  // ═══════════════════════════════════════════════
  // WWCC VERIFICATION (6 stages)
  // ═══════════════════════════════════════════════
  const nwStages: IntStage[] = [
    { label: "Nannies", records: niVerifs, idKey: 'user_id' },
    { label: "Initiated", records: niVerifs.filter((v: any) => v.wwcc_status !== "not_started"), idKey: 'user_id' },
    { label: "Submitted", records: niVerifs.filter((v: any) => WWCC_PAST_APP_PENDING.includes(v.wwcc_status)), idKey: 'user_id' },
    { label: "Processing", records: niVerifs.filter((v: any) => WWCC_PAST_PENDING.includes(v.wwcc_status)), idKey: 'user_id' },
    { label: "Outcome", records: niVerifs.filter((v: any) => WWCC_OUTCOMES.includes(v.wwcc_status)), idKey: 'user_id' },
    { label: "Verified", records: niVerifs.filter((v: any) => v.wwcc_status === "doc_verified"), idKey: 'user_id' },
  ];
  sections.push({ section_key: 'nw', stages: snap(nwStages, ['V', 'N']) });

  // ═══════════════════════════════════════════════
  // PARENT VERIFICATION (5 stages)
  // ═══════════════════════════════════════════════
  const pvVerifs = verifs.filter((v: any) => parentUserIdSet.has(v.user_id));
  const pvStages: IntStage[] = [
    { label: "Parents", records: pvVerifs, idKey: 'user_id' },
    { label: "Initiated", records: pvVerifs.filter((v: any) => v.identity_status !== "not_started"), idKey: 'user_id' },
    { label: "Processing", records: pvVerifs.filter((v: any) => IDENTITY_PAST_PENDING.includes(v.identity_status)), idKey: 'user_id' },
    { label: "Outcome", records: pvVerifs.filter((v: any) => IDENTITY_OUTCOMES.includes(v.identity_status)), idKey: 'user_id' },
    { label: "Verified", records: pvVerifs.filter((v: any) => v.identity_status === "verified"), idKey: 'user_id' },
  ];
  sections.push({ section_key: 'pv', stages: snap(pvStages, ['V', 'P']) });

  // ═══════════════════════════════════════════════
  // DFY MATCHMAKING (12 stages)
  // ═══════════════════════════════════════════════
  const dfSent = dfyNotifs.filter((n: any) => n.status !== 'pending_wave');
  const NT = ['N'] as string[];
  const PT = ['P'] as string[];

  const dfStages: IntStage[] = [
    { label: "DFY Activated", records: dfyPos, liveRecords: dfyPos, idKey: 'id', tags: PT },
    { label: "Standard Tier", records: dfyPos.filter((p: any) => p.dfy_tier === 'standard'), idKey: 'id', tags: PT },
    { label: "Priority Tier", records: dfyPos.filter((p: any) => p.dfy_tier === 'priority'), idKey: 'id', tags: PT },
    { label: "Active (Not Expired)", records: dfyPos.filter((p: any) => p.dfy_expires_at && new Date(p.dfy_expires_at).getTime() > now), idKey: 'id', tags: PT },
    { label: "Expired", records: dfyPos.filter((p: any) => p.dfy_expires_at && new Date(p.dfy_expires_at).getTime() <= now), idKey: 'id', tags: PT },
    { label: "Nannies Notified", records: dfSent, liveRecords: dfyNotifs.filter((n: any) => n.status === 'notified'), idKey: 'nanny_id', tags: NT },
    { label: "Wave 1", records: dfSent.filter((n: any) => n.wave === 1), idKey: 'nanny_id', tags: NT },
    { label: "Wave 2", records: dfSent.filter((n: any) => n.wave === 2), idKey: 'nanny_id', tags: NT },
    { label: "Wave 3", records: dfSent.filter((n: any) => n.wave === 3), idKey: 'nanny_id', tags: NT },
    { label: "Viewed", records: dfyNotifs.filter((n: any) => n.viewed_at), liveRecords: dfyNotifs.filter((n: any) => n.status === 'viewed'), idKey: 'nanny_id', tags: NT },
    { label: "Interested", records: dfyNotifs.filter((n: any) => n.status === 'interested'), idKey: 'nanny_id', tags: NT },
    { label: "No Response", records: dfyNotifs.filter((n: any) => n.status === 'expired'), idKey: 'nanny_id', tags: NT },
  ];

  const dfTS: (number | null)[][] = dfSent.map((n: any) => [
    null, null, null, null, null,
    toMs(n.notified_at),
    n.wave === 1 ? toMs(n.notified_at) : null,
    n.wave === 2 ? toMs(n.notified_at) : null,
    n.wave === 3 ? toMs(n.notified_at) : null,
    toMs(n.viewed_at),
    n.status === 'interested' ? toMs(n.responded_at) : null,
    null,
  ]);
  annotateDwell(dfStages, dfTS, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  sections.push({ section_key: 'df', stages: snap(dfStages) });

  // ═══════════════════════════════════════════════
  // DFY CONNECTIONS (9 stages)
  // ═══════════════════════════════════════════════
  const dfyIntKeys = new Set(dfyNotifs.filter((n: any) => n.status === 'interested').map((n: any) => `${n.nanny_id}|${n.position_id}`));
  const dcConns = connections.filter((c: any) => c.position_id && dfyIntKeys.has(`${c.nanny_id}|${c.position_id}`));
  const dcActive = dcConns.filter((c: any) => !TERMINAL_STAGES.has(c.connection_stage));
  const dcCS = connStages(dcConns, 'nanny_id');

  const dcStages: IntStage[] = [
    { label: "All DFY Connections", records: dcConns, liveRecords: dcActive, idKey: 'nanny_id', tags: NT },
    ...dcCS.map(s => ({ ...s, tags: NT })),
  ];
  sections.push({ section_key: 'dc', stages: snap(dcStages, ['N']) });

  // ═══════════════════════════════════════════════
  // VIRAL SHARES (vn, vp, vb)
  // ═══════════════════════════════════════════════
  function viralStages(shares: any[]): IntStage[] {
    return [
      { label: "Created", records: shares, liveRecords: shares.filter((s: any) => s.share_status === 10), idKey: 'user_id' },
      { label: "Shared", records: shares.filter((s: any) => s.share_status >= 20), liveRecords: shares.filter((s: any) => s.share_status === 20), idKey: 'user_id' },
      { label: "Submitted", records: shares.filter((s: any) => s.share_status >= 30), liveRecords: shares.filter((s: any) => s.share_status === 30 || s.share_status === 40), idKey: 'user_id' },
      { label: "Approved", records: shares.filter((s: any) => s.share_status === 50 || s.share_status === 90), idKey: 'user_id' },
      { label: "Failed", records: shares.filter((s: any) => s.share_status === 60), idKey: 'user_id' },
      { label: "Bypassed", records: shares.filter((s: any) => s.share_status === 90), idKey: 'user_id' },
    ];
  }

  function viralTS(shares: any[]): (number | null)[][] {
    return shares.map((s: any) => [
      toMs(s.created_at), toMs(s.shared_at), toMs(s.submitted_at),
      toMs(s.approved_at || s.bypassed_at), toMs(s.failed_at), toMs(s.bypassed_at),
    ]);
  }

  const vnS = viralAll.filter((s: any) => s.case_type === 'nanny_profile');
  const vpS = viralAll.filter((s: any) => s.case_type === 'parent_position');
  const vbS = viralAll.filter((s: any) => s.case_type === 'parent_bsr');

  const vnStages = viralStages(vnS);
  annotateDwell(vnStages, viralTS(vnS), [0, 1, 2, 3, 4, 5]);
  sections.push({ section_key: 'vn', stages: snap(vnStages, ['N']) });

  const vpStages = viralStages(vpS);
  annotateDwell(vpStages, viralTS(vpS), [0, 1, 2, 3, 4, 5]);
  sections.push({ section_key: 'vp', stages: snap(vpStages, ['P']) });

  const vbStages = viralStages(vbS);
  annotateDwell(vbStages, viralTS(vbS), [0, 1, 2, 3, 4, 5]);
  sections.push({ section_key: 'vb', stages: snap(vbStages, ['P']) });

  // ═══════════════════════════════════════════════
  // BABYSITTING REQUESTS (6 stages)
  // ═══════════════════════════════════════════════
  const bsStages: IntStage[] = [
    { label: "Created", records: bsrReqs, liveRecords: bsrReqs, idKey: 'parent_id' },
    { label: "Open", records: bsrReqs.filter((r: any) => r.status === 'open'), idKey: 'parent_id' },
    { label: "Filled", records: bsrReqs.filter((r: any) => r.status === 'filled' || r.status === 'completed'), liveRecords: bsrReqs.filter((r: any) => r.status === 'filled'), idKey: 'parent_id' },
    { label: "Completed", records: bsrReqs.filter((r: any) => r.status === 'completed'), idKey: 'parent_id' },
    { label: "Expired", records: bsrReqs.filter((r: any) => r.status === 'expired'), idKey: 'parent_id' },
    { label: "Cancelled", records: bsrReqs.filter((r: any) => r.status === 'cancelled'), idKey: 'parent_id' },
  ];

  const bsTS: (number | null)[][] = bsrReqs.map((r: any) => [
    toMs(r.created_at), r.status === 'open' ? toMs(r.created_at) : null,
    toMs(r.accepted_at), null,
    r.status === 'expired' ? toMs(r.expires_at) : null, null,
  ]);
  annotateDwell(bsStages, bsTS, [0, 1, 2, 3, 4, 5]);
  sections.push({ section_key: 'bs', stages: snap(bsStages, ['P']) });

  // ═══════════════════════════════════════════════
  // BSR NOTIFICATIONS (5 stages)
  // ═══════════════════════════════════════════════
  const bnViewed = bsrNots.filter((n: any) => n.viewed_at);
  const bnReqd = bsrNots.filter((n: any) => n.requested_at);
  const bnAcc = bsrNots.filter((n: any) => n.accepted_at);
  const bnDec = bsrNots.filter((n: any) => n.declined_at);
  const bnNotifOnly = bsrNots.filter((n: any) => !n.viewed_at && !n.requested_at && !n.accepted_at && !n.declined_at);
  const bnViewedOnly = bsrNots.filter((n: any) => n.viewed_at && !n.requested_at && !n.accepted_at && !n.declined_at);
  const bnReqdOnly = bsrNots.filter((n: any) => n.requested_at && !n.accepted_at && !n.declined_at);

  const bnStages: IntStage[] = [
    { label: "Notified", records: bsrNots, liveRecords: bnNotifOnly, idKey: 'nanny_id' },
    { label: "Viewed", records: bnViewed, liveRecords: bnViewedOnly, idKey: 'nanny_id' },
    { label: "Requested", records: bnReqd, liveRecords: bnReqdOnly, idKey: 'nanny_id' },
    { label: "Accepted", records: bnAcc, idKey: 'nanny_id' },
    { label: "Declined", records: bnDec, idKey: 'nanny_id' },
  ];

  const bnTS: (number | null)[][] = bsrNots.map((n: any) => [
    toMs(n.notified_at || n.created_at), toMs(n.viewed_at),
    toMs(n.requested_at), toMs(n.accepted_at), toMs(n.declined_at),
  ]);
  annotateDwell(bnStages, bnTS, [0, 1, 2, 3, 4]);
  sections.push({ section_key: 'bn', stages: snap(bnStages, ['N']) });

  // ═══════════════════════════════════════════════
  // PARENT SIGNUP SOURCES (ps)
  // ═══════════════════════════════════════════════
  const SIGNUP_SOURCES = [
    { value: 'direct', label: 'Direct' },
    { value: 'browse', label: 'Browse Nannies' },
    { value: 'profile', label: 'Nanny Profile' },
    { value: 'quick_match', label: 'Quick Match' },
    { value: 'advanced_match', label: 'Advanced Match' },
    { value: 'bsr', label: 'BSR Page' },
    { value: 'position', label: 'Position Page' },
    { value: 'pricing', label: 'Pricing' },
  ];
  const knownSrcValues = new Set(SIGNUP_SOURCES.map(s => s.value));
  const psStages: IntStage[] = SIGNUP_SOURCES.map(src => ({
    label: src.label,
    records: parents.filter((p: any) => p.signup_source === src.value),
    idKey: 'user_id',
    tags: ['P'] as string[],
  }));
  const unknownParents = parents.filter((p: any) => !p.signup_source || !knownSrcValues.has(p.signup_source));
  psStages.push({ label: "Unknown", records: unknownParents, idKey: 'user_id', tags: ['P'] });
  sections.push({ section_key: 'ps', stages: snap(psStages, ['P']) });

  // ═══════════════════════════════════════════════
  // TERMINAL STAGES — PARENT PERSPECTIVE (tp)
  // ═══════════════════════════════════════════════
  const TERMINAL_LABELS: Record<number, string> = {
    1: "Parent Cancelled", 2: "Nanny Declined", 3: "Expired",
    11: "Post-Accept Cancel", 22: "Post-MeetUp Cancel",
    35: "Offer Declined", 36: "Offer Expired",
    50: "Ended", 51: "Terminated",
  };
  const tpStages: IntStage[] = Object.entries(TERMINAL_LABELS).map(([stage, label]) => ({
    label,
    records: connections.filter((c: any) => c.connection_stage === parseInt(stage)),
    idKey: 'parent_id',
    tags: ['P'] as string[],
  }));
  sections.push({ section_key: 'tp', stages: snap(tpStages, ['P']) });

  // ═══════════════════════════════════════════════
  // TERMINAL STAGES — NANNY PERSPECTIVE (tn)
  // ═══════════════════════════════════════════════
  const tnStages: IntStage[] = Object.entries(TERMINAL_LABELS).map(([stage, label]) => ({
    label,
    records: connections.filter((c: any) => c.connection_stage === parseInt(stage)),
    idKey: 'nanny_id',
    tags: ['N'] as string[],
  }));
  sections.push({ section_key: 'tn', stages: snap(tnStages, ['N']) });

  // ═══════════════════════════════════════════════
  // KEY NANNY METRICS (kn)
  // ═══════════════════════════════════════════════
  const activeNannies = nannies.filter((n: any) => n.verification_level >= 2);
  const babysitters = nannies.filter((n: any) => n.visible_in_bsr === true);
  const allActiveConns = connections.filter((c: any) => !TERMINAL_STAGES.has(c.connection_stage));
  const openBsr = bsrReqs.filter((r: any) => r.status === 'open');

  const knStages: IntStage[] = [
    { label: "Nannies", records: nannies, idKey: 'user_id' },
    { label: "Active Nannies", records: activeNannies, idKey: 'user_id' },
    { label: "Babysitters", records: babysitters, idKey: 'user_id' },
    { label: "Placements", records: placements, idKey: 'nanny_id' },
  ];
  sections.push({ section_key: 'kn', stages: snap(knStages, ['N']) });

  // ═══════════════════════════════════════════════
  // KEY PARENT METRICS (kp)
  // ═══════════════════════════════════════════════
  const kpStages: IntStage[] = [
    { label: "Parents", records: parents, idKey: 'user_id' },
    { label: "Positions", records: positions, idKey: 'id' },
    { label: "Connections", records: connections, liveRecords: allActiveConns, idKey: 'id' },
    { label: "Active BSR", records: openBsr, idKey: 'id' },
    { label: "Placements", records: placements, idKey: 'parent_id' },
  ];
  sections.push({ section_key: 'kp', stages: snap(kpStages, ['P']) });

  return sections;
}
