/**
 * BUILD/README § Wave 1 alignment item 7 and plan 02 R18: /admin/cohorts is in the regenerated Katie manifest, and
 * Katie never offers it to a parent or a nanny (her allowlist drops every /admin path).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildRouteAllowlistPrompt, getRouteAllowlist } from "@/lib/chat/route-allowlist";

const manifest = JSON.parse(readFileSync(path.resolve(__dirname, "../../../../public/katie-manifest.json"), "utf8")) as {
  pages: Array<{ path: string; file: string }>;
};

describe("/admin/cohorts and Katie", () => {
  it("is in the manifest", () => {
    expect(manifest.pages).toContainEqual({ path: "/admin/cohorts", file: "src/app/admin/cohorts/page.tsx" });
  });

  it("is never on a parent's or a nanny's list of valid URLs", () => {
    const { nannyPaths, parentPaths, sharedPaths } = getRouteAllowlist();
    expect([...nannyPaths, ...parentPaths, ...sharedPaths]).not.toContain("/admin/cohorts");
    for (const role of ["parent", "nanny"] as const) expect(buildRouteAllowlistPrompt(role)).not.toContain("/admin/cohorts");
  });
});
