/**
 * Prompt-as-data loader + system prompt builder.
 *
 * Reads prompt sections from the `katie_prompt` table and assembles the
 * full system prompt at request time.
 *
 * Serverless-safe cache invalidation:
 *   - A singleton `katie_prompt_version` table holds a UUID version_hash.
 *   - Writes to `katie_prompt` bump the hash via trigger.
 *   - This loader SELECTs the hash on every request (sub-5ms, single-row
 *     PK lookup). If the hash matches the worker's cached value, use the
 *     cache; otherwise reload.
 *   - No cross-worker coordination required.
 *
 * See system/APP/BLOOMBOT/ARCHITECTURE.md "Prompt-as-Data Loading" section.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import type { BotRole } from "@/lib/ai/model-selector";
import { getActiveModules } from "@/lib/chat/modules/registry";
import { buildRouteAllowlistPrompt } from "@/lib/chat/route-allowlist";
import { renderOnboardingStateBlock } from "@/lib/chat/modules/child-onboarding";
import type { BotSettings } from "@/types/bapp";
import { createHash } from "node:crypto";
import { formatRelativeTime, classifyGap } from "@/lib/chat/relative-time";
import type { PreloadedContext } from "@/lib/chat/preload/types";
import { renderPreloadBlock } from "@/lib/chat/preload/render";
import { APP_LOCALE, APP_TZ, BRAND } from "@/lib/constants";

// ── Types ────────────────────────────────────────────────────────────────────

export type PromptSectionId =
  | "identity"
  | "voice"
  | "personality"
  | "boundaries"
  | "data_surfaces"
  | "proactive_rules"
  | "progress_proactivity"
  | "logging_rules"
  | "runtime_context_rules"
  | "scheduling_constraints"
  | "role_nanny"
  | "role_parent"
  | "role_admin"
  | `module.${string}`;

export interface PromptSection {
  section: PromptSectionId;
  content: string;
  version: number;
  protected: boolean;
}

export interface ChildSummary {
  id: string;
  firstName: string;
  ageMonths: number;
  ageBracket: string;
  gender: string | null;
}

export interface CurrentSurface {
  route: string;
  feature: string;
  viewing?: { type: string; id: string } | null;
}

export interface BotContext {
  botId: string;
  userId: string;
  role: BotRole;
  effectiveRole: BotRole;
  userName: string;
  children: ChildSummary[];
  currentSurface?: CurrentSurface | null;
  /** Pre-rendered memory table (from memory/context-builder — Phase 2). Null in Phase 1. */
  memoryTable?: string | null;
  /**
   * Pre-rendered developmental snapshot block (WU 10.4). Lists every
   * milestone across the child's previous + current + next bracket along
   * with their observed scores, so Katie reasons from real data and can
   * never invent a milestone id. Null when the user has no children
   * linked to the account.
   */
  developmentalSnapshot?: string | null;
  /**
   * ISO timestamp of the most recent prior chat_messages row (any role)
   * for this bot, before the current turn. Used to render a "user
   * returning after N hours/days" note in the runtime header so Gemini
   * re-fetches state-dependent info instead of quoting from history.
   * Null when this is the user's first chat ever.
   */
  lastInteractionAt?: string | null;
  /**
   * The bot's `settings` JSONB — flowed in so per-bot module gating
   * (`enabledForBot`) is consistent across every prompt-building path.
   * Optional because some legacy callers (tests, admin tools) don't
   * have a bot in scope; they get the static module set.
   */
  botSettings?: BotSettings;
  /**
   * Verified pre-loaded data, embedded into the runtime context block
   * by `buildRuntimeContext`. May come from:
   *   - Client passthrough (verified by `verifyPreload` at the route
   *     boundary — Latency:Efficiency build, WU4).
   *   - Server-side always-on fetch (no verification needed; we read
   *     it ourselves — WU5).
   *   - Mixed (some slots client, some server).
   *
   * Always undefined for tests / admin tools that don't go through
   * the chat route. The `buildRuntimeContext` rendering is a no-op
   * when `preload` is undefined or empty.
   */
  preload?: PreloadedContext;
}

// ── Worker-local cache ───────────────────────────────────────────────────────

interface CacheEntry {
  hash: string;
  sections: Map<string, PromptSection>;
  loadedAt: number;
}

let cache: CacheEntry | null = null;

/** Test-only: reset the worker cache between tests. */
export function __resetPromptCache(): void {
  cache = null;
}

// ── DB ───────────────────────────────────────────────────────────────────────

async function fetchVersionHash(): Promise<string> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("katie_prompt_version")
    .select("version_hash")
    .eq("id", 1)
    .maybeSingle();
  if (error || !data) {
    throw new Error(
      `Failed to fetch katie_prompt_version: ${error?.message ?? "no row"}`,
    );
  }
  return data.version_hash as string;
}

async function fetchActiveSections(): Promise<Map<string, PromptSection>> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("katie_prompt")
    .select("section, content, version, protected")
    .eq("is_active", true);
  if (error) {
    throw new Error(`Failed to fetch katie_prompt: ${error.message}`);
  }
  const map = new Map<string, PromptSection>();
  for (const row of data ?? []) {
    map.set(row.section as string, row as PromptSection);
  }
  return map;
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Loads prompt sections, using worker-local cache when the version hash matches.
 * Safe across Vercel serverless workers — each worker keeps its own cache
 * but all share the DB-stored hash, so invalidation propagates within one
 * DB round-trip.
 */
export async function loadActiveSections(
  sectionIds?: PromptSectionId[],
): Promise<Map<string, PromptSection>> {
  const hash = await fetchVersionHash();

  if (!cache || cache.hash !== hash) {
    const sections = await fetchActiveSections();
    cache = { hash, sections, loadedAt: Date.now() };
  }

  if (!sectionIds) return cache.sections;

  const filtered = new Map<string, PromptSection>();
  for (const id of sectionIds) {
    const s = cache.sections.get(id);
    if (s) filtered.set(id, s);
  }
  return filtered;
}

/**
 * Fallback section content when the DB has no matching row.
 * Kept minimal on purpose — if the DB is empty something is wrong and
 * we want the seed script to run, not patch over missing content.
 */
const FALLBACK_IDENTITY = `You are Katie — the user's personal assistant on Baby Bloom. You are not a chatbot; you are the interface to the platform. Be confident, clear, and concise. See seed-katie-prompt for the full prompt.`;

/**
 * Interpolates {variable} placeholders in section content.
 */
export function interpolate(
  template: string,
  values: Record<string, string>,
): string {
  return template.replace(/\{(\w+)\}/g, (match, key) => {
    return Object.prototype.hasOwnProperty.call(values, key)
      ? values[key]
      : match;
  });
}

/**
 * Assembles the full system prompt for a given bot context.
 *
 * Load order (concatenated with `\n\n`):
 *   1. identity
 *   2. voice
 *   3. boundaries
 *   4. logging_rules
 *   5. proactive_rules
 *   6. scheduling_constraints
 *   7. role_{effective_role}
 *   8. module.* fragments (sorted by module id)
 *   9. memory_table (runtime, not from DB)
 *   10. user/children/current-surface/date header (runtime)
 */
export async function buildSystemPrompt(ctx: BotContext): Promise<string> {
  // Compatibility shim: composes the static + runtime halves into a
  // single string. Used by callers that don't need the split (tests,
  // any caller that's not the cached chat path). The cached path in
  // `route.ts` calls buildStaticPrompt + buildRuntimeContext directly
  // so the static half can be cached on the Gemini side.
  //
  // `botSettings` is forwarded so per-bot module gating
  // (`enabledForBot`) applies in dispatcher / non-cached callers
  // identically to the cached chat route. Without this thread,
  // a proactive message dispatched by `dispatcher.ts` for a
  // post-onboarding bot would still receive the onboarding fragment
  // because the static prompt would be assembled with the static
  // module set rather than the bot-filtered one.
  const { staticPrompt } = await buildStaticPrompt({
    effectiveRole: ctx.effectiveRole,
    role: ctx.role,
    botSettings: ctx.botSettings,
  });
  const runtime = buildRuntimeContext(ctx);
  return [staticPrompt, runtime].filter(Boolean).join("\n\n");
}

/**
 * The CACHEABLE half of the system prompt — everything that doesn't
 * depend on per-user runtime state. Returns both the rendered string
 * and the active prompt-version hash so the caller can key the Gemini
 * cache without a second DB round-trip.
 *
 * Variables NOT interpolated here:
 *   - `{user_name}` — per-user, lives in the runtime block.
 *   - `{current_date}`, `{day_of_week}`, `{current_time}` — per-turn,
 *     live in the runtime block.
 * Variables that ARE interpolated:
 *   - `{user_role}` — stable for a given cache key (the cache key
 *     includes effectiveRole as its third dimension).
 *
 * To keep the cache shareable across users on the same role+model+
 * prompt-hash, `{user_name}` is rendered as the placeholder string
 * "the user". The runtime block then provides the real name in the
 * runtime header so Katie can address them properly.
 */
/**
 * Builds the cacheable half of Katie's system prompt.
 *
 * Cache-key correctness:
 *   The Gemini cache key composites `versionHash` with a hash of the tool
 *   list (see gemini-cache-manager.ts compositeHash). When `botSettings`
 *   shrinks the active-module set via `enabledForBot`, the tools change
 *   automatically — but the static prompt text ALSO changes (a module's
 *   systemPromptFragment drops out) and `versionHash` from the
 *   `katie_prompt_version` table doesn't reflect that. Without an
 *   augmentation we'd serve a cached prompt baked for one bot to
 *   another bot in a different onboarding state.
 *
 *   Fix: append a stable fingerprint of the per-bot active-module set
 *   to `versionHash`. The fingerprint is identity for a fixed module
 *   list (which is the common case — only `child-onboarding` toggles
 *   today), so cache reuse across bots in the same state is preserved.
 */
export async function buildStaticPrompt(
  ctx: Pick<BotContext, "effectiveRole" | "role"> & {
    botSettings?: BotSettings;
  },
): Promise<{ staticPrompt: string; versionHash: string }> {
  const isAdmin = ctx.effectiveRole === "admin";
  const sectionIds: PromptSectionId[] = [
    "identity",
    "voice",
    "personality",
    "boundaries",
    "data_surfaces",
    "logging_rules",
    // Latency:Efficiency build, WU9 (F4) — directive teaching Katie
    // to use pre-loaded runtime context before reaching for read
    // tools. Position: between logging_rules and proactive_rules so
    // it lands right before behaviour rules. Per
    // 05-prompt-update-plan.md.
    "runtime_context_rules",
    "proactive_rules",
    // WU 13.1 — conditional section loading. progress_proactivity is
    // ~1800 tokens of developmental coaching that's irrelevant to
    // admin (they're inspecting/training, not parenting).
    ...(isAdmin ? [] : (["progress_proactivity"] as const)),
    "scheduling_constraints",
    `role_${ctx.effectiveRole}` as PromptSectionId,
  ];

  // Fetch hash AND sections together. The version_hash drives cache
  // invalidation on the Gemini side — every prompt edit bumps it via
  // the trg_katie_prompt_bump_version trigger.
  const versionHash = await fetchVersionHash();
  const sections = await loadActiveSections();
  const parts: string[] = [];

  // Static-safe interpolation: stable variables only. Per-user / per-turn
  // variables are rendered as stable placeholders.
  const staticVars: Record<string, string> = {
    user_name: "the user",
    user_role: ctx.effectiveRole,
    current_date: "{current_date}",
    day_of_week: "{day_of_week}",
    current_time: "{current_time}",
  };

  for (const id of sectionIds) {
    const s = sections.get(id);
    if (s) {
      parts.push(interpolate(s.content, staticVars));
    } else if (id === "identity") {
      parts.push(FALLBACK_IDENTITY);
    }
  }

  // Module fragments — DB rows preferred (editable by admin Katie),
  // fall back to each module's own systemPromptFragment.
  const byModuleId = new Map<string, string>();
  for (const [id, s] of sections) {
    if (!id.startsWith("module.")) continue;
    const modId = id.slice("module.".length);
    byModuleId.set(modId, interpolate(s.content, staticVars));
  }
  // Per-bot module filtering — when `botSettings` is supplied, modules
  // whose `enabledForBot` predicate returns false are excluded entirely
  // (no fragment, no tools, no triggers). See registry.ts for the two-pass
  // filter contract.
  const activeModules = getActiveModules(ctx.effectiveRole, ctx.botSettings);
  for (const mod of activeModules) {
    if (byModuleId.has(mod.id)) continue;
    if (mod.systemPromptFragment) {
      byModuleId.set(mod.id, mod.systemPromptFragment);
    }
  }
  const ordered = Array.from(byModuleId.entries()).sort((a, b) =>
    a[0].localeCompare(b[0]),
  );
  for (const [, content] of ordered) {
    parts.push(content);
  }

  // Anti-hallucination guardrail — appended after module fragments so
  // it reads as the final word on what URLs Katie may emit. Driven
  // from public/katie-manifest.json so the list is always current
  // (the manifest is regenerated on every build). Capability listing
  // is intentionally NOT duplicated here: that lives in the
  // "What You Can Do" section seeded from SYSTEM-PROMPT.md plus each
  // module's `systemPromptFragment` "Not yet wired" notes — the
  // anti-hallucination rule below references those by name so the
  // single source of truth stays in one place.
  parts.push(buildRouteAllowlistPrompt(ctx.effectiveRole));

  // Cache-key augmentation. Two bots in different per-bot states
  // (e.g. one mid-onboarding, one post-onboarding) produce different
  // assembled prompts because their active-module sets differ — but
  // `versionHash` from `katie_prompt_version` doesn't reflect that. We
  // append a short hash of the active-module-id set so the composite
  // cache key (built downstream by gemini-cache-manager.compositeHash)
  // changes whenever the per-bot module set changes. When all modules
  // are static (no `enabledForBot`), the fingerprint is identical for
  // every bot — cache reuse is preserved exactly as before.
  const moduleFingerprint = createHash("sha256")
    .update(
      activeModules
        .map((m) => m.id)
        .sort()
        .join(","),
    )
    .digest("hex")
    .slice(0, 8);

  return {
    staticPrompt: parts.filter(Boolean).join("\n\n"),
    versionHash: `${versionHash}::m${moduleFingerprint}`,
  };
}

/**
 * The PER-TURN half of the system prompt — runtime header, memory
 * table, developmental snapshot, anything that varies per user/turn.
 * The cached chat path injects this as a synthetic priming turn at
 * position 0 of `contents`; the uncached path appends it to the
 * static prompt as systemInstruction.
 */
export function buildRuntimeContext(ctx: BotContext): string {
  const parts: string[] = [renderRuntimeHeader(ctx)];
  if (ctx.developmentalSnapshot) parts.push(ctx.developmentalSnapshot);
  if (ctx.memoryTable) parts.push(ctx.memoryTable);
  // Latency:Efficiency build, WU4 — "Already loaded for you" block.
  // Verified pre-loaded data from the route's body parser + the WU5
  // always-on builder lands here. Renderer returns null when no
  // slots are populated, so this is a no-op for callers that don't
  // populate `ctx.preload`.
  const preloadBlock = renderPreloadBlock(ctx.preload);
  if (preloadBlock) parts.push(preloadBlock);
  // Onboarding state is per-bot + per-turn data — it must live in the
  // runtime block, not the cached static prompt. The renderer is
  // conservative: returns null when no cascade is active, so this
  // line is a no-op for any bot that's already finished onboarding
  // or never started one.
  const onboardingBlock = renderOnboardingStateBlock(ctx.botSettings);
  if (onboardingBlock) parts.push(onboardingBlock);
  return parts.filter(Boolean).join("\n\n");
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function buildVariables(ctx: BotContext): Record<string, string> {
  const now = new Date();
  return {
    user_name: ctx.userName || "there",
    user_role: ctx.effectiveRole,
    current_date: now.toISOString().slice(0, 10),
    day_of_week: now.toLocaleString(APP_LOCALE, { weekday: "long" }),
    current_time: now.toLocaleString(APP_LOCALE, {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone: APP_TZ,
    }),
  };
}

function renderRuntimeHeader(ctx: BotContext): string {
  const lines: string[] = ["## Today"];
  const now = new Date();
  lines.push(`Date: ${now.toISOString().slice(0, 10)}`);
  lines.push(
    `Day: ${now.toLocaleString(APP_LOCALE, { weekday: "long", timeZone: APP_TZ })}`,
  );
  lines.push(
    `Local time (${BRAND.city}): ${now.toLocaleString(APP_LOCALE, {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone: APP_TZ,
    })}`,
  );

  // Conversation-continuity note. Tiered: skip entirely on tight
  // continuous chat (<15 min gap), soft warning at 15min-4h, strong
  // warning at >=4h. The history turns are timestamp-prefixed on user
  // messages (see route.ts), but this header line lifts the most
  // actionable piece so Gemini can't miss it.
  if (ctx.lastInteractionAt) {
    const tier = classifyGap(ctx.lastInteractionAt, now);
    if (tier !== "fresh") {
      const relative = formatRelativeTime(ctx.lastInteractionAt, now);
      lines.push("");
      lines.push("## Conversation continuity");
      lines.push(`Last interaction: ${relative}.`);
      if (tier === "stale") {
        lines.push(
          "The user is returning after a meaningful gap. Anything you said in past turns about state-dependent entities (connections, BSRs, positions, placements, verifications, jobs) MAY BE STALE — those move forward in real time. For any such question, call the relevant read tool fresh; do not quote the state you reported in past turns.",
        );
      } else {
        // tier === "warming"
        lines.push(
          "The user may have stepped away briefly. For any state-dependent question (connection stage, BSR status, etc.) prefer a fresh tool call over re-quoting prior turns — state may have moved on.",
        );
      }
    }
  }

  lines.push("");
  lines.push("## Who You Are Speaking With");
  lines.push(`Name: ${ctx.userName}`);
  lines.push(`Role: ${ctx.effectiveRole}`);

  // Always render the children section — even when empty — so Gemini
  // has authoritative ground truth about what's connected. Without an
  // explicit "(none)" line, an absent section reads ambiguously: did
  // we forget to load children, or are there genuinely none? That
  // ambiguity caused Gemini to spiral on read_child_profile when the
  // user named a child that wasn't actually linked.
  lines.push("");
  lines.push("## Children This User Has Access To");
  if (ctx.children.length === 0) {
    lines.push(
      "(none) — this account has no children linked to it. If the user names a child, that child is NOT in this account. Tell them so directly; do not call read_child_profile to double-check.",
    );
  } else {
    for (const c of ctx.children) {
      const g = c.gender ? `, ${c.gender}` : "";
      lines.push(`- ${c.firstName} — ${c.ageMonths}mo (${c.ageBracket})${g}`);
    }
    lines.push(
      "If the user names a child NOT in the list above, that child is NOT linked to this account. Tell them so directly; do not call read_child_profile to double-check.",
    );
  }

  if (ctx.currentSurface) {
    lines.push("");
    lines.push("## Current Surface");
    lines.push(`Route: ${ctx.currentSurface.route}`);
    lines.push(`Feature: ${ctx.currentSurface.feature}`);
    if (ctx.currentSurface.viewing) {
      lines.push(
        `Viewing: ${ctx.currentSurface.viewing.type} (${ctx.currentSurface.viewing.id})`,
      );
    }
  }

  return lines.join("\n");
}
