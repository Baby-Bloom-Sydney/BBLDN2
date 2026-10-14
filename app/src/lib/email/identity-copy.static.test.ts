// @vitest-environment node
/**
 * Unit 3g (BB-LDN-3g-141026) — static gate (brief "Static test"): no old check name, regulator or state portal is left
 * in the emails, Katie, the hire PDF or the §B files, outside identifier names (D-4 — renamed in `cleanup`) and the
 * legal-pointer lines the legal chat owns (00-RULINGS #17).
 *
 * The pattern is assembled from pieces so this file never matches itself and carries no Australian literal.
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const SRC = resolve(__dirname, "../..");

const OLD = new RegExp(["WW" + "CC", "Working With " + "Children", "Service " + "N" + "SW", "O" + "CG"].join("|"));

/** Identifier names (`admin…Reject…`, `…_STATUS` constants with the old check name): renamed by `cleanup`, not copy. */
const IDENTIFIER = new RegExp(`\\w+(?:${"WW" + "CC"}|${"O" + "CG"})\\w*|(?:${"WW" + "CC"}|${"O" + "CG"})_\\w+`, "g");

/** Legal-pointer lines (left as written; listed in LEDGER/3g.md's legal section) — only in these two files. */
const LEGAL_POINTER = "identity verified at onboarding";
const LEGAL_POINTER_FILES = ["lib/email/templates/client-hire-confirmation.ts", "lib/pdf/client-hire-summary.tsx"];

const SECTION_B = [
  "app/parent/browse/[id]/ParentNannyProfileView.tsx",
  "app/parent/ParentHubClient.tsx",
  "app/parent/position/PositionPageClient.tsx",
  "components/parent/PlacementCard.tsx",
  "app/(public)/nanny/apply/page.tsx",
  "app/(public)/position/[id]/PositionJobView.tsx",
  "app/(public)/childcare-professionals/page.tsx",
  "app/(public)/pricing/page.tsx",
  "components/landing/TrustStrip.tsx",
  "components/landing/QuickMatch.tsx",
  "app/(funnel)/matchmaking/results/MatchResultsClient.tsx",
  "app/(funnel)/results/QuickMatchResultsClient.tsx",
  "lib/pdf/client-hire-summary.tsx",
  "lib/ai/nanny-profile-prompts.ts",
  "app/api/cron/send-delayed-emails/route.ts",
];

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return files(p);
    return /\.(ts|tsx)$/.test(name) ? [p] : [];
  });
}

function hits(rel: string): string[] {
  return readFileSync(join(SRC, rel), "utf8")
    .split("\n")
    .map((line, i) => ({ line, n: i + 1 }))
    .filter(({ line }) => !(LEGAL_POINTER_FILES.includes(rel) && line.includes(LEGAL_POINTER)))
    .filter(({ line }) => OLD.test(line.replace(IDENTIFIER, "")))
    .map(({ line, n }) => `${rel}:${n}: ${line.trim()}`);
}

describe("3g static — London words in emails, Katie and the §B files", () => {
  const scanned = [
    ...files(join(SRC, "lib/email")),
    ...files(join(SRC, "lib/chat")),
  ].map((p) => p.slice(SRC.length + 1));

  it("scans every email and Katie file plus the §B files", () => {
    expect(scanned.length).toBeGreaterThan(20);
    expect(scanned).toContain("lib/email/templates/dbs-nanny-emails.ts");
    expect(scanned).toContain("lib/chat/modules/verification.ts");
  });

  it.each([...scanned, ...SECTION_B])("%s has no old check, regulator or portal name", (rel) => {
    expect(hits(rel)).toEqual([]);
  });

  it("no \"3g pins\" copy marker is left in app/src (brief change 10b)", () => {
    const marker = "copy: " + "3g pins";
    const left = files(SRC).filter((p) => readFileSync(p, "utf8").includes(marker)).map((p) => p.slice(SRC.length + 1));
    expect(left).toEqual([]);
  });

  it("the orphan hub component is deleted (no importer)", () => {
    expect(() => statSync(join(SRC, "components/hub/NannyHubClient.tsx"))).toThrow();
  });
});
