/**
 * Every raw-HTML render in the app goes through `safeHtml`, unless its file is listed below with what it renders
 * (fixed text or JSON-LD written by the app itself). A new raw-HTML render of stored text is a reviewed change.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = join(__dirname, "..");

const FIXED_CONTENT: Record<string, string> = {
  "app/layout.tsx": "JSON-LD and the error-reporting start-up script, both written by the app",
  "app/ui/embed/layout.tsx": "a fixed style block",
  "app/nanny/profiletest/ProfileTestClient.tsx": "fixed sample text",
  "app/(public)/page.tsx": "JSON-LD",
  "app/(public)/nannies/[id]/page.tsx": "JSON-LD with `<` escaped",
  "app/(public)/pricing/page.tsx": "JSON-LD",
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

describe("raw-HTML renders", () => {
  it("finds the profile renders (the scan works)", () => {
    expect(renders.filter((r) => r.path.endsWith("ParentNannyProfileView.tsx")).length).toBeGreaterThanOrEqual(7);
  });

  it("render stored text only through safeHtml", () => {
    const open = renders
      .filter((r) => !(r.path in FIXED_CONTENT))
      .filter((r) => !r.expr.startsWith("safeHtml("))
      .map((r) => `${r.path}:${r.line} ${r.expr}`);
    expect(open).toEqual([]);
  });
});
