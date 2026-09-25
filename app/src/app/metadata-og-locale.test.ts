/**
 * `og:locale` must survive on every public page that declares its own Open Graph object.
 *
 * Next.js **replaces** a parent's `openGraph` wholesale when a child route declares one, so the
 * root layout's `locale: OG_LOCALE` silently disappears from every page that sets a title or a
 * description of its own. Declared, wired, and unreachable — the checkpoint walk found it by
 * loading the pages (`NEXT.md` §3 W-1); reading `lib/constants.ts` never would.
 *
 * These tests execute the real metadata each page exports — the module-scope object for the five
 * static pages, and `generateMetadata()` itself for the three dynamic ones, with only the single
 * database read mocked. Every assertion is against `OG_LOCALE`, never against a spelled-out
 * literal (`LEDGER/2-0.md` §8.3).
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { Metadata } from "next";
import { OG_LOCALE } from "@/lib/constants";

// The root layout loads two self-hosted fonts through the Next compiler plugin, which vitest does
// not run. Stubbed so the layout's `metadata` can be imported; it has nothing to do with locale.
vi.mock("next/font/local", () => ({
  default: () => ({ variable: "--stub-font", className: "stub-font" }),
}));

// ── The data reads the three dynamic pages make, and nothing else ──

vi.mock("@/lib/actions/nanny", () => ({
  getPublicNannyProfile: vi.fn(async () => ({
    data: {
      first_name: "Test",
      suburb: "Clapham",
      ai_content: { parent_pitch: "A pitch." },
    },
  })),
}));

vi.mock("@/lib/actions/matching", () => ({
  getPublicPositionProfile: vi.fn(async () => ({
    data: {
      suburb: "Clapham",
      source: "parent",
      parentFirstName: "Test",
      parentLastName: "Family",
      daysRequired: ["Monday"],
      hoursPerWeek: 20,
    },
  })),
}));

vi.mock("@/lib/actions/babysitting", () => ({
  getPublicBsrProfile: vi.fn(async () => ({
    data: {
      suburb: "Clapham",
      hourly_rate: 22,
      parent_first_name: "Test",
      parent_last_name: "Family",
      time_slots: [{ slot_date: "2026-10-01" }],
    },
  })),
}));

const APP_DIR = path.resolve(__dirname);

/** Every page module under `src/app` that declares an `openGraph` of its own. */
const STATIC_PAGES = [
  "(public)/page.tsx",
  "(public)/nannies/page.tsx",
  "(public)/pricing/page.tsx",
  "(public)/about/page.tsx",
  "(public)/childcare-professionals/page.tsx",
] as const;

const DYNAMIC_PAGES = [
  "(public)/nannies/[id]/page.tsx",
  "(public)/position/[id]/page.tsx",
  "(public)/babysitting/[id]/page.tsx",
] as const;

/** The root layout is the one place the locale already lives — it is read, never listed. */
const ROOT_LAYOUT = "layout.tsx";

function moduleSpecifier(relPath: string): string {
  return `@/app/${relPath.replace(/\.tsx$/, "")}`;
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    if (entry === "node_modules") return [];
    if (statSync(full).isDirectory()) return walk(full);
    return full.endsWith(".tsx") || full.endsWith(".ts") ? [full] : [];
  });
}

describe("og:locale reaches every page that declares its own openGraph", () => {
  describe("static metadata", () => {
    it.each(STATIC_PAGES)("%s sets openGraph.locale", async (relPath) => {
      const mod = (await import(moduleSpecifier(relPath))) as { metadata: Metadata };

      expect(mod.metadata.openGraph).toBeDefined();
      expect(mod.metadata.openGraph?.locale).toBe(OG_LOCALE);
    });
  });

  describe("generateMetadata", () => {
    it.each(DYNAMIC_PAGES)("%s sets openGraph.locale", async (relPath) => {
      const mod = (await import(moduleSpecifier(relPath))) as {
        generateMetadata: (args: { params: { id: string } }) => Promise<Metadata>;
      };

      const metadata = await mod.generateMetadata({
        params: { id: "00000000-0000-0000-0000-000000000000" },
      });

      expect(metadata.openGraph).toBeDefined();
      expect(metadata.openGraph?.locale).toBe(OG_LOCALE);
    });
  });

  it("the root layout is still where the locale is declared", async () => {
    const mod = (await import(moduleSpecifier(ROOT_LAYOUT))) as { metadata: Metadata };

    expect(mod.metadata.openGraph?.locale).toBe(OG_LOCALE);
  });

  /**
   * Closes the defect class rather than its eight instances: a ninth page that declares an
   * `openGraph` without a `locale` fails here on the day it is written, not at the next walk.
   */
  it("the pages under test are every page in src/app that declares an openGraph", () => {
    const declaring = walk(APP_DIR)
      .filter((file) => /^\s*openGraph\s*:/m.test(readFileSync(file, "utf8")))
      .map((file) => path.relative(APP_DIR, file))
      .sort();

    const underTest = [...STATIC_PAGES, ...DYNAMIC_PAGES, ROOT_LAYOUT].sort();

    expect(declaring).toEqual(underTest);
  });
});
