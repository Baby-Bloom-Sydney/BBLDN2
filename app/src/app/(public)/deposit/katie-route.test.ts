/**
 * Katie and the parent's deposit page (plan 03 row C2, D12; BUILD/README § Wave 1 alignment item 7).
 *
 * The build regenerates the manifest (`prebuild` → `scripts/generate-katie-manifest.mjs`), so the deposit pages land
 * in it like any page under `src/app`. Outside `/nanny` and `/parent` they would read as shared pages and be offered
 * to every role. A deposit link is one family's private page, reached only from BAI's email: Katie must never offer
 * it. The allowlist denies the `/deposit` prefix, so the page and anything under it is on no role's list or prompt.
 *
 * The manifest here is the committed one with the deposit pages added the way the generator writes them (`node:fs`
 * answers it), so the test doesn't depend on the committed copy's age. Adding them changes nothing Katie sees.
 *
 * BB-wave2-231126/03-build, 2026-11-25.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BotRole } from "@/lib/ai/model-selector";

const h = vi.hoisted(() => ({
  withDeposit: true,
  /** As the generator writes them (route group stripped), plus a later page under the same root. */
  depositPages: [
    { path: "/deposit", file: "src/app/(public)/deposit/page.tsx" },
    { path: "/deposit/[code]", file: "src/app/(public)/deposit/[code]/page.tsx" },
    { path: "/deposit/[code]/done", file: "src/app/(public)/deposit/[code]/done/page.tsx" },
    { path: "/deposit/[code]/anything-later", file: "src/app/(public)/deposit/[code]/anything-later/page.tsx" },
  ],
}));

vi.mock("node:fs", async (original) => {
  const fs = await original<typeof import("node:fs")>();
  const realRead = fs.readFileSync as (...a: unknown[]) => unknown;
  const readFileSync = ((file: unknown, ...rest: unknown[]) => {
    const real = realRead(file, ...rest);
    if (!String(file).endsWith("katie-manifest.json")) return real;
    const committed = JSON.parse(String(real)) as { pages: Array<{ path: string; file: string }> };
    const others = committed.pages.filter((p) => !p.path.startsWith("/deposit"));
    return JSON.stringify({ ...committed, pages: h.withDeposit ? [...others, ...h.depositPages] : others });
  }) as typeof fs.readFileSync;
  return { ...fs, default: { ...fs, readFileSync }, readFileSync };
});

const ROLES: readonly BotRole[] = ["parent", "nanny", "admin"];

/** The allowlist module, fresh (it caches the manifest), over a manifest with or without the deposit pages. */
async function allowlist(withDeposit: boolean) {
  h.withDeposit = withDeposit;
  vi.resetModules();
  return import("@/lib/chat/route-allowlist");
}

afterEach(() => {
  h.withDeposit = true;
});

describe("/deposit and Katie", () => {
  it("is on no role's list: not parent, not nanny, not shared", async () => {
    const { getRouteAllowlist } = await allowlist(true);
    const { nannyPaths, parentPaths, sharedPaths } = getRouteAllowlist();
    const all = [...nannyPaths, ...parentPaths, ...sharedPaths];
    expect(all.filter((p) => p.startsWith("/deposit"))).toEqual([]);
    expect(all).not.toContain("/deposit/{code}");
  });

  it.each(ROLES)("is never in the %s's prompt", async (role) => {
    const { buildRouteAllowlistPrompt } = await allowlist(true);
    expect(buildRouteAllowlistPrompt(role)).not.toContain("/deposit");
  });

  it("every other page is offered exactly as before", async () => {
    const before = await allowlist(false);
    const lists = before.getRouteAllowlist();
    const prompts = ROLES.map((role) => before.buildRouteAllowlistPrompt(role));
    const after = await allowlist(true);
    expect(after.getRouteAllowlist()).toEqual(lists);
    expect(ROLES.map((role) => after.buildRouteAllowlistPrompt(role))).toEqual(prompts);
    expect(lists.parentPaths).toContain("/matchmaking/call");
    expect(lists.nannyPaths).toContain("/nanny/profile");
  });
});
