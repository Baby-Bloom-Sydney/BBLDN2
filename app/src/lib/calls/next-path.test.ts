/**
 * next-path.ts (plan B3, §12 R20; brief §3 parent 2): "Go to my matches" goes where she would have gone today, carried
 * as a checked internal `next` path. Only a same-site path under /parent is kept — never /parent/call (a loop) —
 * anything else falls back to /parent. `callPagePath` builds the sign-up redirect.
 */
import { describe, expect, it } from "vitest";
import { CALL_PAGE_PATH, PARENT_HOME, callPagePath, safeNextPath } from "./next-path";

const MATCHES = "/parent?t=childcare&s=nannies&v=matches";

describe("safeNextPath", () => {
  it.each([MATCHES, "/parent", "/parent/matches", "/parent/position/abc?tab=1#top"])("keeps %s", (path) => {
    expect(safeNextPath(path)).toBe(path);
  });

  it.each([
    ["scheme-relative", "//evil.com"],
    ["absolute", "https://evil.com/parent"],
    ["javascript", "javascript:alert(1)"],
    ["backslash", "/\\evil.com"],
    ["a tab the URL parser strips", "/\t/evil.com/parent"],
    ["admin", "/admin"],
    ["another role", "/nanny"],
    ["a look-alike prefix", "/parentx"],
    ["a look-alike segment", "/parents/x"],
    ["dot segments out of /parent", "/parent/../admin"],
    ["encoded dot segments", "/parent/%2e%2e/admin"],
    ["the call page (a loop)", "/parent/call"],
    ["the call page with its own next", "/parent/call?next=%2Fparent"],
    ["below the call page", "/parent/call/x"],
    ["the call page by dot segments", "/parent/x/../call"],
    ["empty", ""],
    ["missing", undefined],
    ["null", null],
    ["an array (a repeated ?next=)", ["/parent", "/admin"]],
    ["too long", `/parent?x=${"a".repeat(600)}`],
  ])("%s → /parent", (_why, raw) => {
    expect(safeNextPath(raw as string | string[] | null | undefined)).toBe(PARENT_HOME);
  });
});

describe("callPagePath", () => {
  it("carries today's target, encoded (R20: the redirect itself)", () => {
    expect(callPagePath(MATCHES)).toBe("/parent/call?next=%2Fparent%3Ft%3Dchildcare%26s%3Dnannies%26v%3Dmatches");
    expect(callPagePath("/parent")).toBe("/parent/call?next=%2Fparent");
  });

  it("round-trips through safeNextPath", () => {
    const next = new URL(callPagePath(MATCHES), "https://x.test").searchParams.get("next");
    expect(safeNextPath(next)).toBe(MATCHES);
  });

  it("the call page path is /parent/call", () => {
    expect(CALL_PAGE_PATH).toBe("/parent/call");
  });
});
