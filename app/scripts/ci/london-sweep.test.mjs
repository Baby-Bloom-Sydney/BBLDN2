// london-sweep.test.mjs — drives the Stage 2 gate rather than reading it.
//
// `05-gate.md`, "Proof before trust": *two LDN1 gates passed vacuously until someone drove them.* A gate nobody has
// run is a claim, not a control. So this spec builds a fixture tree with exactly one hit per rule and proves, by
// running the gate over it, that each rule fires, that an allow entry silences its hit, that a stale allow entry
// fails (the ratchet), and that a `safeguarding` allow entry is refused outright (LDN1 ADR-172).

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";

import {
  RULES,
  RULE_NAMES,
  OWNERS,
  NEVER_ALLOWED,
  AllowFileError,
  ALLOW_FILE,
  relPath,
  scanTree,
  loadAllow,
  evaluate,
  parseArgs,
} from "./london-sweep.mjs";

/**
 * One line per rule, each written so it matches **only** its own rule — which is itself the assertion that the
 * cross-rule guards (`Australia/Sydney` is timezone not brand; `sydney-postcodes` is geography not brand) hold.
 */
const FIXTURE_LINES = {
  geography: 'const endpoint = "/api/sydney-postcodes";',
  timezone: 'const zone = "Australia/Sydney";',
  locale: 'const label = d.toLocaleDateString("en-AU");',
  currency: 'const price = "A$50";',
  phone: 'const mobile = "0412345678";',
  identity: 'const document = "wwcc";',
  brand: 'const site = "babybloomsydney.com.au";',
  jurisdiction: 'const statute = "Privacy Act 1988";',
  safeguarding: 'const duty = "Report Risk of Significant Harm.";',
  region: 'const region = "ap-southeast-2";',
};

let fixtureDir;
let fixtureFile;
let fixturePath;

beforeAll(() => {
  fixtureDir = mkdtempSync(join(tmpdir(), "london-sweep-"));
  mkdirSync(join(fixtureDir, "src"), { recursive: true });
  fixtureFile = join(fixtureDir, "src", "fixture.ts");
  writeFileSync(
    fixtureFile,
    `${RULE_NAMES.map((rule) => FIXTURE_LINES[rule]).join("\n")}\n`,
    "utf8",
  );
  fixturePath = relPath(fixtureFile);
});

afterAll(() => {
  rmSync(fixtureDir, { recursive: true, force: true });
});

const sweepFixture = () => scanTree({ dirs: [fixtureDir], files: [] });

describe("the rule table", () => {
  it("covers every class 05-gate.md names, in its order", () => {
    expect(RULE_NAMES).toEqual([
      "geography",
      "timezone",
      "locale",
      "currency",
      "phone",
      "identity",
      "brand",
      "jurisdiction",
      "safeguarding",
      "region",
    ]);
  });

  it("has a fixture line for every rule, so no rule can be added without being driven", () => {
    expect(Object.keys(FIXTURE_LINES).sort()).toEqual([...RULE_NAMES].sort());
    expect(RULES.every(({ rule }) => RULE_NAMES.includes(rule))).toBe(true);
  });
});

describe("scanning the fixture tree", () => {
  it("fires each rule exactly once, and fires no rule twice on another rule's line", () => {
    const { hits, filesScanned } = sweepFixture();
    expect(filesScanned).toBe(1);
    for (const rule of RULE_NAMES) {
      expect(
        hits.filter((hit) => hit.rule === rule),
        `rule \`${rule}\` should fire exactly once on the fixture`,
      ).toHaveLength(1);
    }
    expect(hits).toHaveLength(RULE_NAMES.length);
  });

  it("reports the repo-relative path, the 1-based line and the trimmed line", () => {
    const { hits } = sweepFixture();
    const geography = hits.find((hit) => hit.rule === "geography");
    expect(geography.file).toBe(fixturePath);
    expect(geography.line).toBe(RULE_NAMES.indexOf("geography") + 1);
    expect(geography.snippet).toBe(FIXTURE_LINES.geography);
  });

  it("fails while any hit is un-allowed", () => {
    const { hits, filesScanned } = sweepFixture();
    const result = evaluate({ hits, filesScanned, allow: [] });
    expect(result.exitCode).toBe(1);
    expect(result.hits).toHaveLength(RULE_NAMES.length);
  });

  it("fails a scan that found no files — a gate that cannot find the tree must not report OK", () => {
    const result = evaluate({ hits: [], filesScanned: 0, allow: [] });
    expect(result.emptyScan).toBe(true);
    expect(result.exitCode).toBe(1);
  });

  it("passes only when every hit is allowed", () => {
    const { hits, filesScanned } = sweepFixture();
    const allow = RULE_NAMES.filter((rule) => rule !== NEVER_ALLOWED).map(
      (rule) => ({
        rule,
        file: fixturePath,
        match: FIXTURE_LINES[rule],
        owner: "cleanup",
        note: "fixture",
      }),
    );
    // Every rule but `safeguarding` is silenced; the one that can never be silenced still fails the run.
    const result = evaluate({ hits, filesScanned, allow });
    expect(result.hits.map((hit) => hit.rule)).toEqual([NEVER_ALLOWED]);
    expect(result.exitCode).toBe(1);

    const withoutSafeguarding = evaluate({
      hits: hits.filter((hit) => hit.rule !== NEVER_ALLOWED),
      filesScanned,
      allow,
    });
    expect(withoutSafeguarding.hits).toHaveLength(0);
    expect(withoutSafeguarding.stale).toHaveLength(0);
    expect(withoutSafeguarding.exitCode).toBe(0);
  });
});

describe("the allow-file", () => {
  const entry = (overrides = {}) => ({
    rule: "identity",
    file: fixturePath,
    match: FIXTURE_LINES.identity,
    owner: "identity",
    note: "the identity stage rewrites the regulator wiring for DBS",
    ...overrides,
  });

  it("silences exactly the hit it names, and nothing else", () => {
    const { hits, filesScanned } = sweepFixture();
    const result = evaluate({ hits, filesScanned, allow: [entry()] });
    expect(result.counts.identity).toBe(0);
    expect(result.hits.map((hit) => hit.rule)).not.toContain("identity");
    expect(result.hits).toHaveLength(RULE_NAMES.length - 1);
    expect(result.stale).toHaveLength(0);
  });

  it("does not silence the same line under a different rule", () => {
    const { hits, filesScanned } = sweepFixture();
    const result = evaluate({
      hits,
      filesScanned,
      allow: [entry({ rule: "brand", match: FIXTURE_LINES.identity })],
    });
    // The entry matches no hit at all (brand fires on a different line), so it is stale, not a silencer.
    expect(result.counts.identity).toBe(1);
    expect(result.stale).toHaveLength(1);
  });

  it("fails on a stale entry — the ratchet: the list may only shrink", () => {
    const { hits, filesScanned } = sweepFixture();
    const stale = entry({ match: "a line that no longer exists anywhere" });
    const result = evaluate({ hits, filesScanned, allow: [entry(), stale] });
    expect(result.stale).toEqual([stale]);
    expect(result.exitCode).toBe(1);
  });

  it("fails on a stale entry even when every live hit is allowed", () => {
    const { hits, filesScanned } = sweepFixture();
    const allow = [
      ...RULE_NAMES.filter((rule) => rule !== NEVER_ALLOWED).map((rule) => ({
        rule,
        file: fixturePath,
        match: FIXTURE_LINES[rule],
        owner: "cleanup",
        note: "fixture",
      })),
      entry({ match: "gone" }),
    ];
    const result = evaluate({
      hits: hits.filter((hit) => hit.rule !== NEVER_ALLOWED),
      filesScanned,
      allow,
    });
    expect(result.hits).toHaveLength(0);
    expect(result.stale).toHaveLength(1);
    expect(result.exitCode).toBe(1);
  });

  it("refuses a `safeguarding` entry outright (ADR-172)", () => {
    const file = join(fixtureDir, "safeguarding.allow.json");
    writeFileSync(
      file,
      JSON.stringify([entry({ rule: "safeguarding", owner: "legal" })]),
      "utf8",
    );
    expect(() => loadAllow(file)).toThrow(AllowFileError);
    expect(() => loadAllow(file)).toThrow(/safeguarding/);
    expect(() => loadAllow(file)).toThrow(/ADR-172/);
  });

  it("refuses an owner that is not one of the stages in 04-sequence.md §4", () => {
    const file = join(fixtureDir, "owner.allow.json");
    writeFileSync(file, JSON.stringify([entry({ owner: "someone" })]), "utf8");
    expect(() => loadAllow(file)).toThrow(AllowFileError);
    expect(() => loadAllow(file)).toThrow(/someone/);
    for (const owner of OWNERS) {
      writeFileSync(file, JSON.stringify([entry({ owner })]), "utf8");
      expect(loadAllow(file)).toHaveLength(1);
    }
  });

  it("refuses an unknown rule, a missing field and a non-array file", () => {
    const file = join(fixtureDir, "shape.allow.json");
    const rejects = [
      [entry({ rule: "vibes" })],
      [entry({ note: "" })],
      [{ rule: "identity", file: fixturePath }],
      ["not an object"],
      { rule: "identity" },
    ];
    for (const payload of rejects) {
      writeFileSync(file, JSON.stringify(payload), "utf8");
      expect(() => loadAllow(file), JSON.stringify(payload)).toThrow(
        AllowFileError,
      );
    }
    writeFileSync(file, "{ not json", "utf8");
    expect(() => loadAllow(file)).toThrow(AllowFileError);
  });

  it("treats a missing allow-file as an empty list, never as a pass", () => {
    expect(loadAllow(join(fixtureDir, "does-not-exist.json"))).toEqual([]);
  });

  it("reads the committed allow-file without throwing", () => {
    // Cheap standing check on every later unit's edits: the file stays valid JSON, with known rules and known owners.
    expect(Array.isArray(loadAllow(ALLOW_FILE))).toBe(true);
  });
});

// ── W6 tightenings ────────────────────────────────────────────────────────────────────────────────────────────
// Four defects, each found by a unit running the gate rather than reading it (LEDGER/2s.md §4.2b, 2d.md §9,
// 2h.md §6). Each case below was written and watched fail before the pattern it pins was changed.

/** Scan one throwaway file at a chosen repo-relative-ish sub-path, so a path-scoped rule can be driven. */
const sweepLines = (relative, lines) => {
  const dir = mkdtempSync(join(tmpdir(), "london-sweep-case-"));
  const file = join(dir, ...relative.split("/"));
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${lines.join("\n")}\n`, "utf8");
  try {
    return scanTree({ dirs: [dir], files: [] }).hits;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

const rulesFiring = (relative, line) =>
  sweepLines(relative, [line]).map((hit) => hit.rule);

describe("W6 T1 — `safeguarding` sees an emergency number given as guidance, not only after a verb", () => {
  it("catches a bare `000` beside a child-danger phrase (LEDGER/2s.md §4.2b, disclaimer:273)", () => {
    // The exact line 2s deleted. The rule missed it because no instruction verb precedes the number.
    expect(
      rulesFiring(
        "src/app/legal/page.tsx",
        '<li><strong>000</strong> for immediate danger (child is injured, in active danger, or being harmed NOW)</li>',
      ),
    ).toContain("safeguarding");
  });

  it("still catches the verb form, and the England-and-Wales numbers", () => {
    expect(rulesFiring("src/a.ts", 'const help = "call 000 immediately";')).toContain("safeguarding");
    expect(
      rulesFiring("src/a.tsx", "<p>Ring 999 if a child is in immediate danger.</p>"),
    ).toContain("safeguarding");
  });

  it("does not fire on money, hex colours or grouped digits near the same words", () => {
    for (const line of [
      'const cap = "A$1,000 emergency fund";',
      'const border = "1px solid #000"; // danger state',
      'const swatch = "#000000"; // emergency banner',
      "const population = 20 000; // harm index",
      'const fee = "£1,000 emergency call-out";',
    ])
      expect(rulesFiring("src/app/x.tsx", line), line).not.toContain("safeguarding");
  });
});

describe("W6 T2a — `currency` no longer reads a JWT audience claim as money (LEDGER/2d.md §9)", () => {
  it("ignores a bare `aud` outside a money context", () => {
    for (const line of [
      'const session = { aud: "authenticated", role: "nanny" };',
      "const aud = route.startsWith(\"/nanny\") ? \"nanny\" : \"parent\";",
    ])
      expect(rulesFiring("src/lib/auth.ts", line), line).not.toContain("currency");
  });

  it("still catches `aud` beside a money token, and every spelled-out form", () => {
    for (const line of [
      'await stripe.transfers.create({ amount, currency: "aud" });',
      "const totalAud = sum(amount_aud_cents);",
      'const label = "A$50";',
      "// amounts are stored in AUD cents",
    ])
      expect(rulesFiring("src/lib/pay.ts", line), line).toContain("currency");
  });
});

describe("W6 T2b — `currency` sees a bare `$` before a digit in rendered tsx (LEDGER/2d.md §9)", () => {
  it("fires on a `$` price inside src/app and src/components tsx", () => {
    expect(rulesFiring("src/app/ui/Showcase.tsx", '<span>$38/hr</span>')).toContain("currency");
    expect(rulesFiring("src/components/rate/Card.tsx", 'value="$35"')).toContain("currency");
  });

  it("is bounded — a `$` cost line in lib, in a .ts file, or a template placeholder stays green", () => {
    expect(rulesFiring("src/lib/ai/cost.ts", "// Gemini Flash: $0.075 per 1M input tokens")).not.toContain("currency");
    expect(rulesFiring("src/app/api/x/route.ts", "const usd = \"$12.50\";")).not.toContain("currency");
    expect(rulesFiring("src/app/ui/Rate.tsx", "const label = `${rate}/hr`;")).not.toContain("currency");
  });
});

describe("W6 T3a — `brand` sees a city glued to the next word (LEDGER/2h.md §6)", () => {
  it("catches the hashtags the render proof caught and the gate did not", () => {
    for (const line of ["<p>#SydneyNanny</p>", "const tag = \"#SydneyBabysitter\";"])
      expect(rulesFiring("src/app/ui/Share.tsx", line), line).toContain("brand");
  });

  it("still leaves the other rules' identifiers to them", () => {
    expect(rulesFiring("src/a.ts", 'const zone = "Australia/Sydney";')).toEqual(["timezone"]);
    expect(rulesFiring("src/a.ts", 'fetch("/api/sydney-postcodes");')).toEqual(["geography"]);
    expect(rulesFiring("src/a.ts", "export function getSydneySuburbs() {}")).toEqual(["geography"]);
    expect(rulesFiring("src/a.ts", "export const sydneyToUTC = (d) => d;")).toEqual(["timezone"]);
  });
});

describe("W6 T3b — an allow entry is compared against the whole line, not a 140-character snippet", () => {
  it("silences a hit whose `match` sits past character 140 (LEDGER/2h.md §6)", () => {
    const padding = "x".repeat(200);
    const line = `// ${padding} wwcc`;
    const hits = sweepLines("src/long.ts", [line]);
    expect(hits).toHaveLength(1);
    expect(hits[0].snippet.length).toBe(140);
    expect(hits[0].snippet).not.toContain("wwcc");
    expect(hits[0].text).toBe(line);

    const result = evaluate({
      hits,
      filesScanned: 1,
      allow: [
        {
          rule: "identity",
          file: hits[0].file,
          match: "wwcc",
          owner: "identity",
          note: "fixture",
        },
      ],
    });
    expect(result.hits).toHaveLength(0);
    expect(result.stale).toHaveLength(0);
    expect(result.exitCode).toBe(0);
  });
});

describe("W6 T3b — overlapping allow entries are both live; the ratchet means the hit is gone, nothing narrower", () => {
  it("does not report a narrow entry stale because a broader one matched the same line first", () => {
    const hits = sweepLines("src/legal.tsx", [
      'const notice = "Baby Bloom, Sydney — babybloomsydney.com.au";',
    ]);
    expect(hits.map((hit) => hit.rule)).toEqual(["brand"]);
    const base = { rule: "brand", file: hits[0].file, owner: "legal", note: "fixture" };
    const result = evaluate({
      hits,
      filesScanned: 1,
      allow: [
        { ...base, match: "Sydney" },
        { ...base, match: "babybloomsydney.com.au" },
      ],
    });
    expect(result.stale).toHaveLength(0);
    expect(result.exitCode).toBe(0);
  });

  it("still fails an entry that silences nothing at all", () => {
    const hits = sweepLines("src/legal.tsx", ['const notice = "Baby Bloom, Sydney";']);
    const result = evaluate({
      hits,
      filesScanned: 1,
      allow: [
        { rule: "brand", file: hits[0].file, match: "Sydney", owner: "legal", note: "live" },
        { rule: "brand", file: hits[0].file, match: "Melbourne", owner: "legal", note: "stale" },
      ],
    });
    expect(result.stale.map((entry) => entry.match)).toEqual(["Melbourne"]);
    expect(result.exitCode).toBe(1);
  });
});

describe("the command line", () => {
  it("accepts --rule with a known rule and --json", () => {
    expect(parseArgs(["--rule", "timezone"])).toEqual({
      only: "timezone",
      json: false,
    });
    expect(parseArgs(["--json"])).toEqual({ only: null, json: true });
  });

  it("refuses an unknown rule or an unknown flag", () => {
    expect(() => parseArgs(["--rule", "vibes"])).toThrow(/--rule expects/);
    expect(() => parseArgs(["--rule"])).toThrow(/--rule expects/);
    expect(() => parseArgs(["--sweep-everything"])).toThrow(/unknown argument/);
  });

  it("scopes the report to one rule", () => {
    const { hits, filesScanned } = sweepFixture();
    const result = evaluate({ hits, filesScanned, allow: [], only: "region" });
    expect(Object.keys(result.counts)).toEqual(["region"]);
    expect(result.hits.map((hit) => hit.rule)).toEqual(["region"]);
  });
});
