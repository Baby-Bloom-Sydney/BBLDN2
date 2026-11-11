/**
 * Every raw-HTML render in the app goes through `safeHtml`, unless its file is listed below with what it renders
 * (fixed text or JSON-LD written by the app itself). A new raw-HTML render of stored text is a reviewed change.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = join(__dirname, "..");

/** File → what its raw-HTML renders may be: JSON-LD the app writes (with `<` escaped), or fixed text. */
const FIXED_CONTENT: Record<string, RegExp> = {
  "app/layout.tsx": /^JSON\.stringify\(\w+\)\.replace\(\/<\/g, ["']\\\\u003c["']\),?$/,
  "app/ui/embed/layout.tsx": /^'\[class\*="z-\[9998\]"\]/,
  "app/nanny/profiletest/ProfileTestClient.tsx": /^MOCK_[A-Z_]+ \}\}$/,
  "app/(public)/page.tsx": /^JSON\.stringify\(\w+(\(\))?\)\.replace\(\/<\/g, ["']\\\\u003c["']\),?$/,
  "app/(public)/nannies/[id]/page.tsx": /^JSON\.stringify\(\w+\)\.replace\(\/<\/g, ["']\\\\u003c["']\),?$/,
  "app/(public)/pricing/page.tsx": /^JSON\.stringify\(\w+(\(\))?\)\.replace\(\/<\/g, ["']\\\\u003c["']\),?$/,
};

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = join(dir, e.name);
    if (e.isDirectory()) return e.name === "node_modules" ? [] : sourceFiles(full);
    return /\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [full] : [];
  });
}

const renders = sourceFiles(SRC).flatMap((file) => {
  const text = readFileSync(file, "utf8");
  const path = relative(SRC, file).split(sep).join("/");
  return [...text.matchAll(/dangerouslySetInnerHTML=\{\{\s*__html:\s*([^\n]*)/g)].map((m) => ({
    path,
    line: text.slice(0, m.index).split("\n").length,
    expr: m[1].trim(),
  }));
});

/** The whole expression is one `safeHtml(…)` call (nothing joined to it): "safeHtml(x) }}" yes, "safeHtml(a) + b }}" no. */
function wholeSafeHtml(expr: string): boolean {
  const body = expr.replace(/\s*\}\}\s*\/?>?\s*$/, "").trim();
  if (!body.startsWith("safeHtml(")) return false;
  let depth = 0;
  for (let i = "safeHtml".length; i < body.length; i += 1) {
    if (body[i] === "(") depth += 1;
    if (body[i] === ")") depth -= 1;
    if (depth === 0) return i === body.length - 1;
  }
  return false;
}

describe("raw-HTML renders", () => {
  it("reads a whole safeHtml call, and nothing joined to it", () => {
    expect(wholeSafeHtml("safeHtml(tagline.replace(/<\\/?p>/g, \"\")) }}")).toBe(true);
    expect(wholeSafeHtml("safeHtml(aiAbout) }} />")).toBe(true);
    expect(wholeSafeHtml("safeHtml(a) + b }}")).toBe(false);
  });

  it("finds the profile renders (the scan works)", () => {
    expect(renders.filter((r) => r.path.endsWith("ParentNannyProfileView.tsx")).length).toBeGreaterThanOrEqual(7);
  });

  it("render stored text only through safeHtml (or the listed fixed content)", () => {
    const open = renders
      .filter((r) => !wholeSafeHtml(r.expr))
      .filter((r) => !(FIXED_CONTENT[r.path]?.test(r.expr) ?? false))
      .map((r) => `${r.path}:${r.line} ${r.expr}`);
    expect(open).toEqual([]);
  });

  it("allows nothing else in a listed file (a profile render there goes through safeHtml too)", () => {
    expect(FIXED_CONTENT["app/(public)/nannies/[id]/page.tsx"].test("nanny.ai_content.headline }}")).toBe(false);
  });
});
