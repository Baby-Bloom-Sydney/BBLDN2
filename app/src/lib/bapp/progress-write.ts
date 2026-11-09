/**
 * Progress writes after a logged observation, progress update or report: scores only go up (`recalculateProgress`),
 * and a history snapshot of the domain totals (`writeHistorySnapshot`). Moved unchanged from
 * `lib/actions/bapp/progress.ts`; server-only, not a server action — its callers check the child first.
 *
 * BB-wave1-041126, 2026-11-09.
 */
import { createAdminClient } from "@/lib/supabase/admin";
import { DOMAIN_CODES } from "@/lib/bapp-constants";

// ---------------------------------------------------------------------------
// recalculateProgress — scores only go up (max of existing vs new)
// ---------------------------------------------------------------------------

export async function recalculateProgress(
  childId: string,
  updates: { id: string; score: number }[],
): Promise<void> {
  const admin = createAdminClient();

  // Look up domains for each milestone ID
  const milestoneIds = updates.map((u) => u.id);
  const { data: milestones } = await admin
    .from("bapp_milestones")
    .select("id, domain")
    .in("id", milestoneIds);

  if (!milestones) return;

  const milestoneDomainMap = new Map<string, string>();
  for (const m of milestones) {
    milestoneDomainMap.set(m.id, m.domain);
  }

  // Group updates by domain
  const updatesByDomain = new Map<string, { id: string; score: number }[]>();
  for (const u of updates) {
    const domain = milestoneDomainMap.get(u.id);
    if (!domain) continue;
    const list = updatesByDomain.get(domain) ?? [];
    list.push(u);
    updatesByDomain.set(domain, list);
  }

  // For each affected domain, read → merge → upsert
  for (const [domain, domainUpdates] of Array.from(updatesByDomain)) {
    // Read current scores for this domain
    const { data: existing } = await admin
      .from("bapp_progress_scores")
      .select("*")
      .eq("child_client_id", childId)
      .eq("domain", domain)
      .maybeSingle();

    const scores: Record<string, number> = existing?.scores
      ? { ...(existing.scores as Record<string, number>) }
      : {};

    // Merge — scores only go up
    for (const u of domainUpdates) {
      scores[u.id] = Math.max(scores[u.id] || 0, u.score);
    }

    // Count total active milestones for this domain
    const { count } = await admin
      .from("bapp_milestones")
      .select("id", { count: "exact", head: true })
      .eq("domain", domain)
      .eq("is_active", true);

    const milestoneCount = count ?? 0;
    const sumScores = Object.values(scores).reduce((a, b) => a + b, 0);
    const percent =
      milestoneCount > 0
        ? Math.round((sumScores / (milestoneCount * 4)) * 100)
        : 0;

    // Upsert progress_scores
    if (existing) {
      await admin
        .from("bapp_progress_scores")
        .update({ scores, percent })
        .eq("id", existing.id);
    } else {
      await admin.from("bapp_progress_scores").insert({
        child_client_id: childId,
        domain,
        scores,
        percent,
      });
    }
  }
}

// ---------------------------------------------------------------------------
// writeHistorySnapshot
// ---------------------------------------------------------------------------

export async function writeHistorySnapshot(
  childId: string,
  refLogId: string | null,
): Promise<void> {
  const admin = createAdminClient();

  const { data: allScores } = await admin
    .from("bapp_progress_scores")
    .select("domain, scores")
    .eq("child_client_id", childId);

  const domainTotals: Record<string, number> = {};
  for (const code of DOMAIN_CODES) {
    domainTotals[code] = 0;
  }

  for (const row of allScores ?? []) {
    const scores = row.scores as Record<string, number>;
    domainTotals[row.domain] = Object.values(scores).reduce((a, b) => a + b, 0);
  }

  await admin.from("bapp_progress_history").insert({
    child_client_id: childId,
    ref_log_id: refLogId,
    cl_total: domainTotals.CL ?? 0,
    pse_total: domainTotals.PSE ?? 0,
    pd_total: domainTotals.PD ?? 0,
    lit_total: domainTotals.LIT ?? 0,
    num_total: domainTotals.NUM ?? 0,
    uw_total: domainTotals.UW ?? 0,
    ead_total: domainTotals.EAD ?? 0,
  });
}
