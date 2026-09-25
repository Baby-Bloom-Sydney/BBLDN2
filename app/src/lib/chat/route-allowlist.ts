/**
 * Build the "Valid URLs" allowlist that gets injected into Katie's
 * system prompt at request time.
 *
 * Source of truth: `public/katie-manifest.json`, regenerated at every
 * build by `scripts/generate-katie-manifest.mjs`. Reading the manifest
 * (instead of hardcoding) means the list is always current — every
 * time someone adds or removes a page, the allowlist updates on the
 * next deploy without anyone editing a separate document.
 *
 * Why this exists: Katie was caught in production fabricating URLs
 * (e.g. claiming a "Hidden" toggle at /nanny/profile that doesn't
 * exist in the UI, or pointing at /nanny/edit-profile which 404s).
 * A tight allowlist plus an explicit "do not invent" rule makes that
 * class of hallucination structurally impossible.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { BotRole } from "@/lib/ai/model-selector";
import { SENDERS } from "@/lib/constants";

interface ManifestPage {
  path: string;
  file: string;
}

interface Manifest {
  pages?: ManifestPage[];
}

/**
 * Routes that exist but Katie must NEVER link the user to. Add to
 * this list anything that is admin-only, internal tooling, dev-only
 * scratch, or otherwise off-limits.
 */
const PATH_DENY_PREFIXES = [
  "/api/", // server endpoints, never user-facing
  "/admin", // admin surfaces have their own chrome
  "/_next/", // framework internals
  "/auth/", // implementation of login/logout, not the visible /login page
];

const PATH_DENY_EXACT = new Set<string>([
  "/nanny/profiletest", // dev scratchpad
  "/ui", // component playground
  "/ui2",
  "/ui/embed/[component]",
]);

/**
 * Convert a Next.js dynamic route file pattern into a brace-template
 * that's natural for an LLM to reason about.
 *
 *   `/nanny/development/[childId]/progress`
 *     → `/nanny/development/{childId}/progress`
 */
function toTemplatePath(path: string): string {
  return path.replace(/\[(\.\.\.)?(\w+)\]/g, (_, _spread, name) => `{${name}}`);
}

function isAllowed(path: string): boolean {
  if (PATH_DENY_EXACT.has(path)) return false;
  for (const prefix of PATH_DENY_PREFIXES) {
    if (path.startsWith(prefix)) return false;
  }
  return true;
}

/**
 * Audience for a path — used so a nanny doesn't see a parent-only URL
 * dangling in their prompt (and vice versa). Anything that's neither
 * /nanny/* nor /parent/* is considered shared (login, contact, etc.)
 * and shown to both roles.
 */
type Audience = "nanny" | "parent" | "shared";

function audienceOf(path: string): Audience {
  if (path.startsWith("/nanny")) return "nanny";
  if (path.startsWith("/parent")) return "parent";
  return "shared";
}

let cached: Manifest | null = null;

function loadManifest(): Manifest {
  if (cached) return cached;
  try {
    const manifestPath = join(process.cwd(), "public", "katie-manifest.json");
    const raw = readFileSync(manifestPath, "utf-8");
    cached = JSON.parse(raw) as Manifest;
    return cached;
  } catch {
    // Manifest missing in some build/test environments. Fall back to
    // an empty list — the prompt will still include the strict
    // anti-hallucination rule, just without an enumerated allowlist.
    cached = { pages: [] };
    return cached;
  }
}

export interface AllowlistSections {
  nannyPaths: string[];
  parentPaths: string[];
  sharedPaths: string[];
}

export function getRouteAllowlist(): AllowlistSections {
  const { pages = [] } = loadManifest();
  const nannyPaths: string[] = [];
  const parentPaths: string[] = [];
  const sharedPaths: string[] = [];

  for (const page of pages) {
    if (!page?.path) continue;
    if (!isAllowed(page.path)) continue;
    const tmpl = toTemplatePath(page.path);
    const aud = audienceOf(page.path);
    if (aud === "nanny") nannyPaths.push(tmpl);
    else if (aud === "parent") parentPaths.push(tmpl);
    else sharedPaths.push(tmpl);
  }
  nannyPaths.sort();
  parentPaths.sort();
  sharedPaths.sort();
  return { nannyPaths, parentPaths, sharedPaths };
}

/**
 * Render the allowlist as a markdown section to append to Katie's
 * static system prompt. Filtered by the user's effective role so the
 * prompt only mentions paths relevant to them.
 */
export function buildRouteAllowlistPrompt(role: BotRole): string {
  const { nannyPaths, parentPaths, sharedPaths } = getRouteAllowlist();

  const lines: string[] = [
    "## Valid URLs and the no-fabrication rule",
    "",
    "Two strict rules — they cover both URL hallucinations and feature hallucinations, the two things production has been burned by:",
    "",
    "1. **URLs.** When you suggest a link or include an `action.href`, the path MUST appear in the list below. Do NOT invent paths that look plausible but are not on the list (production was burned by fabricated paths like `/nanny/edit-profile` and `/nanny/settings/hidden` that 404'd). Dynamic segments are written `{like_this}` — substitute the actual id when you emit the link.",
    "",
    '2. **Features.** Your capabilities are defined by the **What You Can Do** section above and each module\'s tool list and **Not yet wired** notes. If the user asks for something that is not in those, the feature is NOT BUILT YET. Do NOT invent a UI affordance (e.g. "toggle Hidden in your profile") to make it sound plausible — there have been hallucinated toggles before, and they break user trust when the user goes looking and the toggle is not there.',
    "",
    `When the request is not buildable from the allowed URLs and capabilities: acknowledge it, say it is not available yet, and suggest emailing ${SENDERS.support} if they need it now. Do not pretend.`,
    "",
  ];

  if (role === "nanny" && nannyPaths.length > 0) {
    lines.push("Nanny routes (your audience):");
    for (const p of nannyPaths) lines.push(`- ${p}`);
    lines.push("");
  }

  if (role === "parent" && parentPaths.length > 0) {
    lines.push("Parent routes (your audience):");
    for (const p of parentPaths) lines.push(`- ${p}`);
    lines.push("");
  }

  // Admin sees everything — admins use Katie cross-role for testing.
  if (role === "admin") {
    if (nannyPaths.length > 0) {
      lines.push("Nanny routes:");
      for (const p of nannyPaths) lines.push(`- ${p}`);
      lines.push("");
    }
    if (parentPaths.length > 0) {
      lines.push("Parent routes:");
      for (const p of parentPaths) lines.push(`- ${p}`);
      lines.push("");
    }
  }

  if (sharedPaths.length > 0) {
    lines.push("Shared / public routes:");
    for (const p of sharedPaths) lines.push(`- ${p}`);
    lines.push("");
  }

  return lines.join("\n").trimEnd();
}
