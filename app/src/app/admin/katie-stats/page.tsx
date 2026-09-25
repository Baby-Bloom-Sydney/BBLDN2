/**
 * /admin/katie-stats — observability dashboard for Katie's chat usage (WU 13.4).
 *
 * Read-only. Pulls aggregates from chat_cost_daily, chat_messages.metadata,
 * and chat_draft_locks. Server component — no client interactivity in v1.
 *
 * Admin role is already enforced by `src/lib/supabase/middleware.ts`
 * (`/admin` paths require role 'admin' or 'super_admin'), so we don't
 * re-check here.
 *
 * What this dashboard answers:
 *   - Total cost in the last 7 / 30 days
 *   - Top users by daily cost (find runaway-cost outliers)
 *   - Cache hit rate from chat_messages.metadata.cache_hit (post WU 13.2)
 *   - Average input/output tokens per turn
 *   - Tool call counts and failure rates
 *   - Draft accept counts (chat_draft_locks rows) — Dismiss/Amend are
 *     client-side and not tracked server-side for v1.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import { APP_TZ } from "@/lib/constants";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  DollarSign,
  Activity,
  Zap,
  Wrench,
  CheckCircle2,
  Database,
} from "lucide-react";

export const dynamic = "force-dynamic";

interface ChatMessageMeta {
  metadata: {
    model?: string;
    input_tokens?: number;
    output_tokens?: number;
    cached_tokens?: number;
    cost_usd?: number;
    duration_ms?: number;
    cache_hit?: boolean;
    tool_calls?: Array<{ name: string; success: boolean }>;
  } | null;
  bloombot_id: string;
}

interface DailyCostRow {
  bloombot_id: string;
  date: string;
  estimated_cost_usd: number;
  input_tokens: number;
  output_tokens: number;
  cached_tokens: number;
  turn_count: number;
}

/**
 * Format a YYYY-MM-DD string for `APP_TZ` (where the business operates).
 * chat_cost_daily.date is a `DATE` column populated server-side by
 * `increment_chat_cost`; if our cutoff calculation uses UTC and the admin
 * is in the home zone, the boundary day can drift by one (e.g. a 1am local
 * query starts from "two days ago" UTC instead of "one day ago" local).
 * Computing the cutoff in the home zone keeps the displayed "last N days"
 * label accurate.
 */
function localDateMinusDays(daysAgo: number): string {
  const target = new Date(Date.now() - daysAgo * 86_400_000);
  // en-CA returns YYYY-MM-DD format directly.
  return target.toLocaleDateString("en-CA", { timeZone: APP_TZ });
}

async function getStats() {
  const admin = createAdminClient();
  const now = new Date();
  const sevenDaysAgo = localDateMinusDays(7);
  const thirtyDaysAgo = localDateMinusDays(30);

  // Per-day cost rows for 30 days
  const { data: costRows30 } = await admin
    .from("chat_cost_daily")
    .select(
      "bloombot_id, date, estimated_cost_usd, input_tokens, output_tokens, cached_tokens, turn_count",
    )
    .gte("date", thirtyDaysAgo);
  const costs30 = (costRows30 ?? []) as DailyCostRow[];

  const cost7 = costs30
    .filter((r) => r.date >= sevenDaysAgo)
    .reduce((s, r) => s + Number(r.estimated_cost_usd ?? 0), 0);
  const cost30 = costs30.reduce(
    (s, r) => s + Number(r.estimated_cost_usd ?? 0),
    0,
  );

  // Per-bot rollups (top users by 30d cost)
  const perBot = new Map<
    string,
    { cost: number; turns: number; cached: number; total_in: number }
  >();
  for (const r of costs30) {
    const cur = perBot.get(r.bloombot_id) ?? {
      cost: 0,
      turns: 0,
      cached: 0,
      total_in: 0,
    };
    cur.cost += Number(r.estimated_cost_usd ?? 0);
    cur.turns += r.turn_count;
    cur.cached += r.cached_tokens;
    cur.total_in += r.input_tokens;
    perBot.set(r.bloombot_id, cur);
  }
  const topBots = Array.from(perBot.entries())
    .sort((a, b) => b[1].cost - a[1].cost)
    .slice(0, 10);

  // Resolve bot_id → user-friendly name. The `bloombot` table joins to
  // user_profiles via owner. Run one fetch covering only the top-10 to
  // avoid scanning all bots.
  const topBotIds = topBots.map(([id]) => id);
  const { data: botRows } =
    topBotIds.length > 0
      ? await admin
          .from("bloombot")
          .select("id, role, user_id")
          .in("id", topBotIds)
      : { data: [] };
  const botInfo = new Map<string, { role: string; user_id: string }>();
  for (const b of (botRows ?? []) as Array<{
    id: string;
    role: string;
    user_id: string;
  }>) {
    botInfo.set(b.id, { role: b.role, user_id: b.user_id });
  }

  // Per-turn metadata for the last 7 days — for cache hit rate, tool
  // call totals, average tokens. We only need the metadata column.
  //
  // The 5000-row safety cap is fine for early deployment (one assistant
  // turn per chat reply, low traffic) but will start to clip the dataset
  // as usage scales. Production answer when we hit the cap: a daily
  // rollup table of metadata aggregates, computed by the existing
  // /api/cron/compact-daily cron and read instead of `chat_messages`
  // here. Until then, the cap is an under-count signal, not a wrong-
  // count signal — the rates we display stay correct, just over a
  // sampled window.
  const { data: msgRows } = await admin
    .from("chat_messages")
    .select("metadata, bloombot_id")
    .eq("role", "assistant")
    .gte("created_at", new Date(now.getTime() - 7 * 86_400_000).toISOString())
    .limit(5000);
  const msgs = (msgRows ?? []) as ChatMessageMeta[];

  let cacheHits = 0;
  let cacheTotal = 0;
  let toolCallCount = 0;
  let toolFailureCount = 0;
  const toolCounts = new Map<string, { calls: number; failures: number }>();
  let totalIn = 0;
  let totalOut = 0;
  let totalDuration = 0;
  let durationCount = 0;
  for (const m of msgs) {
    const meta = m.metadata;
    if (!meta) continue;
    if (typeof meta.cache_hit === "boolean") {
      cacheTotal += 1;
      if (meta.cache_hit) cacheHits += 1;
    }
    if (typeof meta.input_tokens === "number") totalIn += meta.input_tokens;
    if (typeof meta.output_tokens === "number") totalOut += meta.output_tokens;
    if (typeof meta.duration_ms === "number") {
      totalDuration += meta.duration_ms;
      durationCount += 1;
    }
    for (const tc of meta.tool_calls ?? []) {
      toolCallCount += 1;
      if (!tc.success) toolFailureCount += 1;
      const cur = toolCounts.get(tc.name) ?? { calls: 0, failures: 0 };
      cur.calls += 1;
      if (!tc.success) cur.failures += 1;
      toolCounts.set(tc.name, cur);
    }
  }

  const cacheHitRate = cacheTotal > 0 ? (cacheHits / cacheTotal) * 100 : 0;
  const avgInput = msgs.length > 0 ? Math.round(totalIn / msgs.length) : 0;
  const avgOutput = msgs.length > 0 ? Math.round(totalOut / msgs.length) : 0;
  const avgDuration =
    durationCount > 0 ? Math.round(totalDuration / durationCount) : 0;
  const toolFailureRate =
    toolCallCount > 0 ? (toolFailureCount / toolCallCount) * 100 : 0;
  const topTools = Array.from(toolCounts.entries())
    .sort((a, b) => b[1].calls - a[1].calls)
    .slice(0, 10);

  // Draft accepts in the last 7 days
  const { count: draftAccepts } = await admin
    .from("chat_draft_locks")
    .select("draft_id", { count: "exact", head: true })
    .gte("acquired_at", new Date(now.getTime() - 7 * 86_400_000).toISOString());

  return {
    cost7,
    cost30,
    topBots,
    botInfo,
    cacheHitRate,
    cacheTotal,
    avgInput,
    avgOutput,
    avgDuration,
    msgsConsidered: msgs.length,
    toolCallCount,
    toolFailureRate,
    topTools,
    draftAccepts: draftAccepts ?? 0,
  };
}

function formatUsd(n: number): string {
  return `$${n.toFixed(2)}`;
}

export default async function KatieStatsPage() {
  const stats = await getStats();

  return (
    <div className="space-y-6 p-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold text-slate-900">
          Katie — usage & cost
        </h1>
        <p className="text-sm text-slate-600">
          Read-only operational dashboard. Aggregated from{" "}
          <code>chat_cost_daily</code>, <code>chat_messages.metadata</code>, and{" "}
          <code>chat_draft_locks</code>.
        </p>
      </header>

      <section className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-4">
        <StatCard
          icon={<DollarSign className="h-4 w-4" />}
          label="Cost — last 7 days"
          value={formatUsd(stats.cost7)}
        />
        <StatCard
          icon={<DollarSign className="h-4 w-4" />}
          label="Cost — last 30 days"
          value={formatUsd(stats.cost30)}
        />
        <StatCard
          icon={<Zap className="h-4 w-4" />}
          label="Cache hit rate (7d)"
          value={`${stats.cacheHitRate.toFixed(1)}%`}
          sublabel={`${stats.cacheTotal} turns sampled`}
        />
        <StatCard
          icon={<CheckCircle2 className="h-4 w-4" />}
          label="Draft accepts (7d)"
          value={String(stats.draftAccepts)}
        />
      </section>

      <section className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <StatCard
          icon={<Activity className="h-4 w-4" />}
          label="Avg input tokens / turn"
          value={String(stats.avgInput)}
        />
        <StatCard
          icon={<Activity className="h-4 w-4" />}
          label="Avg output tokens / turn"
          value={String(stats.avgOutput)}
        />
        <StatCard
          icon={<Activity className="h-4 w-4" />}
          label="Avg turn latency"
          value={`${stats.avgDuration}ms`}
        />
      </section>

      <section>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Database className="h-4 w-4" />
              Top users by 30-day cost
            </CardTitle>
          </CardHeader>
          <CardContent>
            {stats.topBots.length === 0 ? (
              <p className="text-sm text-slate-500">No data yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-slate-200 text-sm">
                  <thead className="text-xs uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="py-2 text-left">Bot</th>
                      <th className="py-2 text-left">Role</th>
                      <th className="py-2 text-right">Cost (30d)</th>
                      <th className="py-2 text-right">Turns</th>
                      <th className="py-2 text-right">Cached %</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {stats.topBots.map(([botId, agg]) => {
                      const info = stats.botInfo.get(botId);
                      const cachedPct =
                        agg.total_in > 0
                          ? Math.round((agg.cached / agg.total_in) * 100)
                          : 0;
                      return (
                        <tr key={botId}>
                          <td className="py-2 font-mono text-xs text-slate-600">
                            {botId.slice(0, 8)}…
                          </td>
                          <td className="py-2 text-slate-700">
                            {info?.role ?? "—"}
                          </td>
                          <td className="py-2 text-right font-medium">
                            {formatUsd(agg.cost)}
                          </td>
                          <td className="py-2 text-right text-slate-700">
                            {agg.turns}
                          </td>
                          <td className="py-2 text-right text-slate-700">
                            {cachedPct}%
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </section>

      <section>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Wrench className="h-4 w-4" />
              Tool calls (7d)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="mb-3 text-sm text-slate-600">
              Total: {stats.toolCallCount} · Failure rate:{" "}
              {stats.toolFailureRate.toFixed(1)}% · Sampled across{" "}
              {stats.msgsConsidered} assistant turns.
            </p>
            {stats.topTools.length === 0 ? (
              <p className="text-sm text-slate-500">No tool calls yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-slate-200 text-sm">
                  <thead className="text-xs uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="py-2 text-left">Tool</th>
                      <th className="py-2 text-right">Calls</th>
                      <th className="py-2 text-right">Failures</th>
                      <th className="py-2 text-right">Failure %</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {stats.topTools.map(([name, agg]) => {
                      const pct =
                        agg.calls > 0
                          ? ((agg.failures / agg.calls) * 100).toFixed(1)
                          : "0.0";
                      return (
                        <tr key={name}>
                          <td className="py-2 font-mono text-xs text-slate-700">
                            {name}
                          </td>
                          <td className="py-2 text-right">{agg.calls}</td>
                          <td className="py-2 text-right">{agg.failures}</td>
                          <td className="py-2 text-right">{pct}%</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </section>
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  sublabel,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sublabel?: string;
}) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-1 p-4">
        <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-slate-500">
          {icon}
          {label}
        </div>
        <div className="text-2xl font-semibold text-slate-900">{value}</div>
        {sublabel ? (
          <div className="text-xs text-slate-500">{sublabel}</div>
        ) : null}
      </CardContent>
    </Card>
  );
}
