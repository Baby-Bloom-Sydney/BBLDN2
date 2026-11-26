/**
 * BUILD/README § Wave 1 alignment item 7 (plan 05 §5 A11): /api/webhooks/justcall is in the regenerated Katie manifest,
 * and Katie never offers it to a parent or a nanny (her allowlist reads pages only and denies every /api/ path).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildRouteAllowlistPrompt, getRouteAllowlist } from "@/lib/chat/route-allowlist";

const manifest = JSON.parse(readFileSync(path.resolve(__dirname, "../../../../../public/katie-manifest.json"), "utf8")) as {
  routes: Array<{ path: string; methods: string[]; file: string }>;
  pages: Array<{ path: string; file: string }>;
};

describe("/api/webhooks/justcall and Katie", () => {
  it("is in the manifest as a POST route", () => {
    expect(manifest.routes).toContainEqual({ path: "/api/webhooks/justcall", methods: ["POST"], file: "src/app/api/webhooks/justcall/route.ts" });
  });

  it("is never on a parent's or a nanny's list of valid URLs, nor in any role's prompt", () => {
    const { nannyPaths, parentPaths, sharedPaths } = getRouteAllowlist();
    expect([...nannyPaths, ...parentPaths, ...sharedPaths].filter((p) => p.includes("justcall"))).toEqual([]);
    for (const role of ["parent", "nanny", "admin"] as const) expect(buildRouteAllowlistPrompt(role)).not.toContain("justcall");
  });
});
