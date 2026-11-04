/**
 * BUILD/README § Wave 1 alignment item 7 (plan R9): /parent/call is in the regenerated Katie manifest, and Katie
 * never offers it to the wrong role — it is a parent path only, never on a nanny's list or the shared list.
 * (Teaching Katie about the call is out of scope, brief §10; while the flag is off the route answers 404.)
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildRouteAllowlistPrompt, getRouteAllowlist } from "@/lib/chat/route-allowlist";

const manifest = JSON.parse(readFileSync(path.resolve(__dirname, "../../../../public/katie-manifest.json"), "utf8")) as {
  pages: Array<{ path: string; file: string }>;
};

describe("/parent/call and Katie", () => {
  it("is in the manifest", () => {
    expect(manifest.pages).toContainEqual({ path: "/parent/call", file: "src/app/parent/call/page.tsx" });
  });

  it("is never on a nanny's list or the shared list", () => {
    const { nannyPaths, parentPaths, sharedPaths } = getRouteAllowlist();
    expect([...nannyPaths, ...sharedPaths]).not.toContain("/parent/call");
    expect(parentPaths).toContain("/parent/call");
    expect(buildRouteAllowlistPrompt("nanny")).not.toContain("/parent/call");
  });
});
