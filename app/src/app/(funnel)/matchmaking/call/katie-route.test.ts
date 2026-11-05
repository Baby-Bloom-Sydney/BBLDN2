/**
 * BUILD/README § Wave 1 alignment item 7 (plan R9): the call page is in the regenerated Katie manifest, and Katie
 * never offers it to the wrong role — it is a parent path only, never on a nanny's list or the shared list. Since the
 * 04b rework (W1) it lives at /matchmaking/call, outside `/parent`, so the allowlist names it a parent path itself.
 * (Teaching Katie about the call is out of scope, brief §10; while the flag is off the route answers 404.)
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildRouteAllowlistPrompt, getRouteAllowlist } from "@/lib/chat/route-allowlist";

const manifest = JSON.parse(readFileSync(path.resolve(__dirname, "../../../../../public/katie-manifest.json"), "utf8")) as {
  pages: Array<{ path: string; file: string }>;
};

describe("/matchmaking/call and Katie", () => {
  it("is in the manifest, and /parent/call is gone from it", () => {
    expect(manifest.pages.map((p) => p.path)).not.toContain("/parent/call");
    expect(manifest.pages).toContainEqual({ path: "/matchmaking/call", file: "src/app/(funnel)/matchmaking/call/page.tsx" });
  });

  it("is never on a nanny's list or the shared list", () => {
    const { nannyPaths, parentPaths, sharedPaths } = getRouteAllowlist();
    expect([...nannyPaths, ...sharedPaths]).not.toContain("/matchmaking/call");
    expect(parentPaths).toContain("/matchmaking/call");
    expect(buildRouteAllowlistPrompt("nanny")).not.toContain("/matchmaking/call");
  });
});
