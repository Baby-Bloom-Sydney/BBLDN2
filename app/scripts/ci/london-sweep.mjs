#!/usr/bin/env node
// london-sweep.mjs — the Stage 2 whole-tree gate (LDN2 `PLAN/05-gate.md`; `PLAN/DECISIONS.md` P-6).
//
// The failure mode of a surgical amendment is the partial sweep: London in the places we looked, Sydney everywhere
// else. This check fails CI while any artefact class the Stage 1 inventory named is still present ANYWHERE in the
// scanned tree, so "Stage 2 is done" is a mechanical fact rather than a belief.
//
// Ported from LDN1's `scripts/ci/check-config-literals.mjs` — **the script, not the rules** (P-6). What carried over:
// the rule table, one pass over an extension-filtered file list, a rule name per hit, the `rule  path:line  snippet`
// output, the zero-files-scanned guard, the allow-file ratchet, and the `main()` guard so that importing this module
// never scans and never calls `process.exit`. The ten rules below are this tree's, with every pattern derived from
// the actual hits in `PLAN/02a`/`02b`/`02c` (see `PLAN/LEDGER/2-gate.md` §3 for which inventory lines produced which
// pattern).
//
// ── The allow-file ──────────────────────────────────────────────────────────────────────────────────────────────
// `london-sweep.allow.json` is a JSON array. One entry per **deliberately deferred** hit:
//
//   {
//     "rule":  "identity",                                  // one of the ten rule names below
//     "file":  "app/src/lib/verification.ts",               // repo-relative path, exactly as this script prints it
//     "match": "WWCCNotification@ocg.nsw.gov.au",           // a substring that must appear on the matched line
//     "owner": "identity",                                  // the stage that owns it — 04-sequence.md §4:
//                                                           //   identity · money · legal · removals ·
//                                                           //   matching · hardening · cleanup
//     "note":  "OCG sender address; the identity stage rewrites the regulator wiring for DBS."
//   }
//
// `match` is a plain substring, never a second regex, so an allow entry cannot quietly widen itself.
//
// **Ratchet.** An entry that silences nothing — no line of that rule, in that file, contains its `match` any more —
// FAILS. The list may only shrink. An allow-file cannot outlive its reason. Two entries may overlap on a line; both
// are live as long as each silences something.
//
// `match` is compared against the **whole** trimmed line. (Until W6 it was compared against the 140-character
// snippet the report prints, so an entry whose `match` sat past character 140 silenced nothing and failed as stale.)
//
// **`safeguarding` is refused.** Any entry whose rule is `safeguarding` is an error before a single file is read
// (LDN1 ADR-172: a wrong child-safety instruction is deleted the day it is found, never translated, never deferred).
//
// ── Flags ───────────────────────────────────────────────────────────────────────────────────────────────────────
//   --rule <name>   only that rule: its count and its hits
//   --json          machine-readable result on stdout
//
// Exit 0 = every hit is allowed and every allow entry is live. Exit 1 = un-allowed hits, stale allow entries, a
// malformed allow-file, or a scan that found no files at all (a gate that cannot find the tree must not report OK).

import { readFileSync, readdirSync, lstatSync } from "node:fs";
import { resolve, dirname, relative, join, extname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url)); // app/scripts/ci
const APP_ROOT = resolve(HERE, "../.."); // app
const REPO_ROOT = resolve(APP_ROOT, ".."); // repository root

export const ALLOW_FILE = resolve(HERE, "london-sweep.allow.json");

/** Directories and single files swept, per the unit brief. `app/tests/` (Playwright e2e) is not a root. */
export const SCAN_DIRS = ["src", "supabase", "public", "scripts"].map((dir) =>
  resolve(APP_ROOT, dir),
);
export const SCAN_FILES = [
  "vercel.json",
  "next.config.mjs",
  "vitest.setup.ts",
].map((file) => resolve(APP_ROOT, file));

/** Allow-list, not deny-list: a new binary type can never accidentally be read (fail closed). */
const EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".mts",
  ".cjs",
  ".json",
  ".sql",
]);
const SKIP_DIR_NAMES = new Set([
  "node_modules",
  ".next",
  ".git",
  "coverage",
  "dist",
  "out",
  "playwright-report",
  "test-results",
]);
/** Repo-relative path prefixes that are never scanned. `scripts/ci` holds the patterns themselves — a rule table
 *  that reddened its own source would be unwritable (the seed carries the same self-exemption). */
const SKIP_PATH_PREFIXES = ["app/tests/e2e/artifacts", "app/scripts/ci"];
const SKIP_FILE_NAMES = new Set([
  "package-lock.json",
  "yarn.lock",
  "pnpm-lock.yaml",
]);

/** The stages that may own a deferred hit (`04-sequence.md` §4). An entry nobody owns is a deferral nobody returns to. */
export const OWNERS = [
  "identity",
  "money",
  "legal",
  "removals",
  "matching",
  "hardening",
  "cleanup",
];

/** The one rule that is never allow-listed (ADR-172). */
export const NEVER_ALLOWED = "safeguarding";

// ── Pattern helpers ────────────────────────────────────────────────────────────────────────────────────────────

/** `a` within 40 characters of `b` on one line, either order. Ported verbatim from the seed. */
const near = (a, b) =>
  new RegExp(`(?:${a})[^\\n]{0,40}(?:${b})|(?:${b})[^\\n]{0,40}(?:${a})`, "i");

/**
 * An acronym as it actually travels through this tree: on its own (`"NSW"`), in snake_case (`wwcc_ocg_submitted_at`),
 * and at a camelCase boundary (`wwccNumber`, `nswOnly`). A plain `\b` misses the snake_case tail, because `_` is a
 * word character; a plain case-insensitive match reddens `abnormal`. Case-sensitive on purpose — both spellings are
 * spelled out, so the case-insensitive `[a-z]` trap (with `/i`, `[a-z]` also matches `A-Z`) never arises.
 */
const acronym = (word) => {
  const upper = word.toUpperCase();
  const lower = word.toLowerCase();
  return [
    `(?<![A-Za-z0-9])(?:${upper}|${lower})(?![A-Za-z0-9])`,
    `(?<![A-Za-z0-9])${lower}(?=[A-Z])`,
  ].join("|");
};

/**
 * Sydney place names that are unambiguously Sydney's. **Deliberately absent: Paddington, Manly, Kensington,
 * Richmond, Newtown, Glebe, Avalon, Palm Beach** — every one of them is also a London district or an ordinary English
 * word, so listing them would leave `geography` un-greenable after 2a swaps the mock values for London districts.
 * They are caught wherever an NSW postcode or another Sydney name shares the line (the `geography` postcode rule
 * below, and the `PLACEHOLDER_SUBURBS` array, do exactly that); `LEDGER/2-gate.md` records the residue by file.
 */
/**
 * An emergency number as a number, never as part of one. The guards are the seed's, plus `#` and the currency signs
 * added at W6: `A$1,000` and `£1,000` keep their comma guard, `#000` / `#000000` are colours, `20 000` is a count (the
 * space-after-a-digit guard is W6's — the seed's comma guard alone let it through once the verb stopped being
 * required),
 * and `0000` is neither. Case-insensitivity comes from the rule's own `i` flag.
 */
const EMERGENCY_NUMBER =
  "(?<!\\d)(?<!\\d[,. ])(?<![A-Fa-f#])(?:000|999|112)\\b(?!\\d)(?![,.]\\d)";

/** The words that turn a three-digit number into a child-safety instruction (W6 T1). */
const EMERGENCY_CONTEXT = [
  "emergency",
  "immediate danger",
  "in danger",
  "in active danger",
  "being harmed",
  "harm(?:ed)?\\b",
  "child(?:ren)?(?:['\\u2019]s)? safety",
  "safety concern",
  "police",
  "ambulance",
].join("|");

const SYDNEY_PLACES = [
  "Surry Hills",
  "Bondi",
  "Coogee",
  "Mosman",
  "Woollahra",
  "Vaucluse",
  "Randwick",
  "Maroubra",
  "Potts Point",
  "Double Bay",
  "Bellevue Hill",
  "Darling Point",
  "Balmoral",
  "Neutral Bay",
  "Cremorne",
  "Clovelly",
  "Bronte",
  "Rose Bay",
  "Chatswood",
  "Parramatta",
  "Marrickville",
  "Darlinghurst",
  "Redfern",
  "Rozelle",
  "Pyrmont",
  "Hornsby",
  "Dee Why",
  "Bondi Junction",
];

// ── The ten rules (`05-gate.md`) ───────────────────────────────────────────────────────────────────────────────
// A line may match more than one rule and is then counted once per rule — the seed behaves the same way, and a
// per-rule count is what each later unit watches fall. Several rules are split across entries so that one half can
// be case-sensitive (place names, acronyms) while the other is not.

export const RULES = [
  // 12.01 — service-area geography. The table, the route, the exported helper, the place names, the NSW postcode
  // shape in a postcode context, hardcoded Sydney latitudes, and the AU country filter on the geocoder.
  {
    rule: "geography",
    pattern:
      /sydney[_-]postcodes|getSydneySuburbs|Greater Sydney|countrycode[^\n]{0,20}\bAU\b|\blat\s*=\s*-3[34]|(?<![\d.])-3[34]\.\d{2,}/i,
  },
  { rule: "geography", pattern: new RegExp(`\\b(?:${SYDNEY_PLACES.join("|")})\\b`) },
  // A quoted NSW 4-digit postcode, only next to a postcode/suburb word: bare `"2026"` is indistinguishable from a
  // year, and `"2024"` appears in dates all over the tree.
  {
    rule: "geography",
    pattern: near("postcode|postCode|post_code|suburb", "['\"]2\\d{3}['\"]"),
  },

  // 12.02 — timezone. `+10:00`/`+11:00` are the AEST/AEDT offsets written out; they are the point, not a false hit.
  {
    rule: "timezone",
    pattern:
      /Australia\/Sydney|SYDNEY_TZ|formatSydney|sydneyToUTC|\+1[01]:00|\bAEST\b|\bAEDT\b/,
  },

  // 12.03 — locale. Word-boundaried so `en-CA` (correct, left alone per 04 §2 2c) and `en-US` cannot match.
  { rule: "locale", pattern: /(?<![A-Za-z0-9])en[-_]AU(?![A-Za-z0-9])/i },

  // 12.04 — currency, the display half. The behaviour half (Stripe, price IDs, `*_aud_cents` columns) is
  // allow-listed to the money stage — the rule exists so that list stays visible.
  {
    rule: "currency",
    pattern:
      /A\$|(?<![A-Za-z0-9])AUD(?![A-Za-z0-9])|[a-z]Aud(?![a-z])|currency\s*[:=]\s*["'`]aud["'`]/,
  },
  // W6 (T2a, `LEDGER/2d.md` §9): the lower-case `aud` alternation used to stand alone, and could not tell a currency
  // from a JWT **audience** claim or a local variable holding a route's audience. It cost four allow entries that
  // existed only because the rule cried wolf — a rule defect written down as a deferral. It now has to stand next to
  // a money token. Nothing real was lost: every true hit in this tree carries `AUD`, `A$`, `_aud_cents`, `…Aud`, or
  // `currency: "aud"`, and the last of those is matched above in its own right.
  {
    rule: "currency",
    pattern: near(
      "currency|amount|cents|price|fee|total|payout|charge|refund|balance|\\$|£",
      "(?<![A-Za-z0-9])aud(?![A-Za-z0-9])",
    ),
  },
  // W6 (T2b, `LEDGER/2d.md` §9): a bare `$` before a digit — the display half of a price, which the rule could not
  // see at all, so `$38/hr` shipped on `/ui` with `currency` at 0. **Bounded to rendered `.tsx` under `src/app` and
  // `src/components`**: repo-wide it would redden every USD Gemini/OpenAI cost line in `lib/`, every `$1` regex
  // replacement and every shell snippet, and a rule that cries wolf is how allow-files grow. `${…}` is untouched —
  // the pattern needs a digit, not a brace.
  {
    rule: "currency",
    path: /src\/(?:app|components)\/[^\n]*\.tsx$/,
    pattern: /\$\d/,
  },

  // 12.05 — phone and mobile-validation copy.
  {
    rule: "phone",
    pattern:
      /\+61|(?<!\d)04\d{8}(?!\d)|(?<!\d)04\d{2}[ -]\d{3}[ -]\d{3}(?!\d)|04XX|AU_MOBILE|normaliseAuMobile|isAuMobile|formatAuMobile|au-contact|Australian (?:mobile|number|phone)/i,
  },

  // 12.06 — identity and regulatory formats. Allow-listed to the identity stage in a later wave; the rule exists so
  // the list is visible rather than remembered.
  {
    rule: "identity",
    pattern: /wwcc|Medicare|Australian passport|NSW driver/i,
  },
  {
    rule: "identity",
    pattern: new RegExp([acronym("OCG"), acronym("ABN")].join("|")),
  },

  // 12.07 — brand, domain, senders. The bare word `Sydney` is here (it is brand copy), with guards that keep the same
  // token from being counted twice under two rules: the left `(?<![A-Za-z0-9])` drops `getSydneySuburbs` and
  // `formatSydneyDate` (geography and timezone own those), `(?<!Australia\/)` drops the IANA zone `Australia/Sydney`
  // — measured at 48 of 670 brand lines, every one of them 2b's timezone work and none of them 2f's — and the
  // trailing guards drop `sydney_postcodes` / `sydney-postcodes` (geography's) and `sydneyToUTC` (timezone's).
  //
  // W6 (T3a, `LEDGER/2h.md` §6 and its log): there used to be a trailing `(?![A-Za-z0-9])` here, and `#SydneyNanny`
  // and `#SydneyBabysitter` therefore rendered on `/ui` with `brand` at **0** — the render proof caught what the gate
  // could not. A city name glued to the next word is still the city name, so the general boundary is gone and only
  // the two named identifier forms are excluded, by name.
  {
    rule: "brand",
    pattern:
      /babybloomsydney|babybloom\.com\.au|app-babybloom|babybloom\.dev|(?<![A-Za-z0-9])(?<!Australia\/)sydney(?![-_]postcode)(?!ToUTC)/i,
  },

  // 12.08 — jurisdiction facts in application code. Legal-page bodies are NOT excluded by the rule; the legal stage
  // allow-lists them by file, so the deferral is written down instead of built in.
  {
    rule: "jurisdiction",
    pattern: new RegExp(
      [
        acronym("NSW"),
        acronym("OAIC"),
        "New South Wales",
        "Privacy Act 1988",
        "Fair Work",
        "Australian Consumer Law",
      ].join("|"),
    ),
  },

  // 12.08 — safeguarding. **Never allow-listed; a hit is deleted the day it is found** (LDN1 ADR-172). Carried over
  // from the seed whole and widened to any jurisdiction: the duty, the threshold, the agencies and the hotlines,
  // England-and-Wales as well as NSW, because the correct English route is a safeguarding decision for BAI with a
  // solicitor and belongs in a versioned document body, never hardcoded in a component, an email or a PDF. Typing a
  // reporting route into code is exactly how the NSW one shipped.
  //
  // The emergency numbers match only next to an instruction verb, and never with a digit or a digit-hugging comma or
  // period against them, so `A$1,000`, `?? 999` and `20 000` stay green.
  {
    rule: "safeguarding",
    pattern: new RegExp(
      [
        "mandatory report(?:er|ers|ing)",
        "Reportable Conduct",
        "Risk of Significant Harm",
        "\\bROSH\\b",
        "Child Protection Helpline",
        "\\bDCJ\\b",
        "Department of Communities and Justice",
        "\\bNSPCC\\b",
        "\\bChild\\s?line\\b",
        "children[\\u2019']?s social care",
        "\\b132\\s?111\\b",
        "\\b1800\\s?55\\s?1800\\b",
        `\\b(?:call|dial|phone|ring|contact)\\b[^\\n]{0,30}${EMERGENCY_NUMBER}`,
        // W6 (T1, `LEDGER/2s.md` §4.2b and §7.2): the verb form above is not how the number usually appears. On
        // `legal/disclaimer/page.tsx:273` it read "**000** for immediate danger (child is injured, in active danger,
        // or being harmed NOW)" — an instruction with no verb in front of it, under an "IMMEDIATE Child Safety
        // Concern?" heading, directly above the flagged `132 111`. The rule caught the neighbour and missed it.
        // Deleting only the flagged line would have left an Australian emergency number as the sole surviving
        // child-safety instruction. A number standing next to a danger or child-safety phrase IS the instruction, so
        // it is caught either way round now, verb or no verb.
        near(EMERGENCY_CONTEXT, EMERGENCY_NUMBER).source,
      ].join("|"),
      "i",
    ),
  },

  // 12.NEW — hosting and data region. The Sydney project ref is a public Supabase identifier, not a secret; this
  // rule's job is to find it in the tree, never to reach the project.
  {
    rule: "region",
    pattern:
      /ap-southeast-2|ap-northeast-1|(?<![A-Za-z0-9])syd1(?![A-Za-z0-9])|umkqevipzmoovyrnynrf/i,
  },
];

/** Rule names in `05-gate.md`'s order — the order the scoreboard prints in. */
export const RULE_NAMES = [...new Set(RULES.map(({ rule }) => rule))];

// ── Scanning ───────────────────────────────────────────────────────────────────────────────────────────────────

/** Repo-relative, POSIX-separated — the exact string an allow entry's `file` must carry. Exported for the spec. */
export function relPath(file) {
  return relative(REPO_ROOT, file).split("\\").join("/");
}

function isSkippedPath(path) {
  return SKIP_PATH_PREFIXES.some(
    (prefix) => path === prefix || path.startsWith(`${prefix}/`),
  );
}

/**
 * Recursive listing. Symlinks are never followed (no reads outside the tree, no cycles); an unreadable entry is
 * skipped rather than fatal. Ported from the seed's `lib/list-files.mjs`, inlined so this gate is one file.
 */
export function listFiles(root) {
  const found = [];
  const pending = [root];
  while (pending.length > 0) {
    const current = pending.pop();
    let entries;
    try {
      entries = readdirSync(current);
    } catch {
      continue;
    }
    for (const name of entries) {
      if (SKIP_DIR_NAMES.has(name) || SKIP_FILE_NAMES.has(name)) continue;
      const path = join(current, name);
      if (isSkippedPath(relPath(path))) continue;
      let info;
      try {
        info = lstatSync(path);
      } catch {
        continue;
      }
      if (info.isSymbolicLink()) continue;
      if (info.isDirectory()) pending.push(path);
      else if (EXTENSIONS.has(extname(name))) found.push(path);
    }
  }
  return found.sort();
}

function scanFile(file, rules) {
  const path = relPath(file);
  // A rule may carry a `path` regex, tested against the repo-relative path, so a pattern that is only safe in one
  // part of the tree can be written without widening it everywhere (W6 T2b: a bare `$` before a digit is a price in
  // rendered tsx and a USD cost note in `lib/`).
  const applicable = rules.filter(({ path: scope }) => !scope || scope.test(path));
  if (applicable.length === 0) return [];
  let source;
  try {
    source = readFileSync(file, "utf8");
  } catch {
    return [];
  }
  const hits = [];
  source.split("\n").forEach((line, index) => {
    const matched = new Set(
      applicable
        .filter(({ pattern }) => pattern.test(line))
        .map(({ rule }) => rule),
    );
    const text = line.trim();
    for (const rule of matched) {
      hits.push({
        rule,
        file: path,
        line: index + 1,
        // `text` is the whole line and is what an allow entry's `match` is compared against; `snippet` is the
        // report's truncated copy. W6 (T3b, `LEDGER/2h.md` §6): these used to be one field, so an allow entry whose
        // `match` fell past character 140 silenced nothing and failed as stale — two of 2h's entries did, silently,
        // until they were re-anchored. Truncation is a display concern and now stays one.
        text,
        snippet: text.slice(0, 140),
      });
    }
  });
  return hits;
}

/**
 * One pass over the tree. Exported so the spec can drive the gate rather than take its word — a gate nobody has run
 * is a claim, not a control.
 */
export function scanTree({ dirs = SCAN_DIRS, files = SCAN_FILES, rules = RULES } = {}) {
  const scanned = [
    ...dirs.flatMap((dir) => listFiles(dir)),
    ...files.filter((file) => {
      try {
        return lstatSync(file).isFile();
      } catch {
        return false;
      }
    }),
  ];
  const hits = scanned.flatMap((file) => scanFile(file, rules));
  hits.sort(
    (a, b) =>
      RULE_NAMES.indexOf(a.rule) - RULE_NAMES.indexOf(b.rule) ||
      a.file.localeCompare(b.file) ||
      a.line - b.line,
  );
  return { hits, filesScanned: scanned.length };
}

// ── The allow-file ─────────────────────────────────────────────────────────────────────────────────────────────

export class AllowFileError extends Error {}

/** Reads and validates the allow-file. A missing file is an empty list; a malformed one throws (fail closed). */
export function loadAllow(file = ALLOW_FILE) {
  let raw;
  try {
    raw = readFileSync(file, "utf8");
  } catch (error) {
    if (error && error.code === "ENOENT") return [];
    throw error;
  }
  let entries;
  try {
    entries = JSON.parse(raw);
  } catch (error) {
    throw new AllowFileError(`${relPath(file)} is not valid JSON — ${error.message}`);
  }
  if (!Array.isArray(entries))
    throw new AllowFileError(`${relPath(file)} must be a JSON array of entries`);

  entries.forEach((entry, index) => {
    const where = `${relPath(file)} entry ${index}`;
    if (entry === null || typeof entry !== "object" || Array.isArray(entry))
      throw new AllowFileError(`${where} must be an object`);
    for (const field of ["rule", "file", "match", "owner", "note"]) {
      if (typeof entry[field] !== "string" || entry[field].trim() === "")
        throw new AllowFileError(`${where} is missing a non-empty "${field}"`);
    }
    if (entry.rule === NEVER_ALLOWED)
      throw new AllowFileError(
        `${where} allow-lists the \`${NEVER_ALLOWED}\` rule — refused. A child-safety duty, threshold, agency or ` +
          `hotline is deleted the day it is found, never deferred and never translated (LDN1 ADR-172). Delete the ` +
          `line in ${entry.file} instead of recording it here.`,
      );
    if (!RULE_NAMES.includes(entry.rule))
      throw new AllowFileError(
        `${where} names rule "${entry.rule}", which is not one of: ${RULE_NAMES.join(", ")}`,
      );
    if (!OWNERS.includes(entry.owner))
      throw new AllowFileError(
        `${where} names owner "${entry.owner}", which is not one of: ${OWNERS.join(", ")} ` +
          `(04-sequence.md §4). An entry nobody owns is a deferral nobody comes back for.`,
      );
  });
  return entries;
}

const silences = (entry, hit) =>
  entry.rule === hit.rule &&
  entry.file === hit.file &&
  (hit.text ?? hit.snippet).includes(entry.match);

/**
 * The whole decision, pure: hits in, verdict out. `main()` only prints it and exits, so the spec proves the exit
 * codes by running this rather than by reading them.
 */
export function evaluate({ hits, filesScanned, allow, only = null }) {
  const used = new Set();
  const remaining = [];
  for (const hit of hits) {
    let silenced = false;
    // **Every** entry that matches this hit is marked used, not just the first. W6 (T3b): the ratchet's rule is
    // "an entry whose hit no longer exists fails". First-match accounting said something narrower — "an entry no
    // other entry beat it to" — and two overlapping entries on one file made the broader one report the narrower
    // one stale. Comparing against the whole line (above) widened the broad entries and turned 22 live legal- and
    // removals-stage entries stale overnight, every one of them still silencing a real hit. Deleting them would
    // have thrown away another stage's record for a reason that was never the ratchet's.
    allow.forEach((entry, index) => {
      if (!silences(entry, hit)) return;
      used.add(index);
      silenced = true;
    });
    if (!silenced) remaining.push(hit);
  }
  const stale = allow
    .map((entry, index) => ({ entry, index }))
    .filter(({ index }) => !used.has(index))
    .map(({ entry }) => entry);

  const scoped = only ? remaining.filter((hit) => hit.rule === only) : remaining;
  const counts = Object.fromEntries(
    (only ? [only] : RULE_NAMES).map((rule) => [
      rule,
      remaining.filter((hit) => hit.rule === rule).length,
    ]),
  );

  const emptyScan = filesScanned === 0;
  const exitCode = emptyScan || scoped.length > 0 || stale.length > 0 ? 1 : 0;
  return { counts, hits: scoped, stale, filesScanned, emptyScan, exitCode };
}

// ── CLI ────────────────────────────────────────────────────────────────────────────────────────────────────────

export function parseArgs(argv) {
  const options = { only: null, json: false };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--json") options.json = true;
    else if (argv[i] === "--rule") {
      options.only = argv[i + 1];
      i += 1;
      if (!RULE_NAMES.includes(options.only))
        throw new Error(
          `--rule expects one of: ${RULE_NAMES.join(", ")} (got ${options.only ?? "nothing"})`,
        );
    } else throw new Error(`unknown argument \`${argv[i]}\``);
  }
  return options;
}

function report(result, options) {
  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  const width = Math.max(...RULE_NAMES.map((rule) => rule.length));
  if (result.emptyScan) {
    console.error(
      "london-sweep: FAIL — scanned zero files; the scan roots are wrong. A gate that cannot find the tree must not report OK.",
    );
    return;
  }
  const headline =
    result.exitCode === 0
      ? `london-sweep: OK — ${result.filesScanned} file(s) scanned, 0 un-allowed hit(s)`
      : `london-sweep: FAIL — ${result.hits.length} un-allowed hit(s) on ${result.filesScanned} file(s) scanned` +
        (result.stale.length > 0
          ? `, ${result.stale.length} stale allow entry/entries`
          : "");
  (result.exitCode === 0 ? console.log : console.error)(headline);

  console.error("");
  for (const [rule, count] of Object.entries(result.counts))
    console.error(`  ${rule.padEnd(width)}  ${count}`);
  if (result.hits.length > 0) console.error("");
  for (const hit of result.hits)
    console.error(
      `  ${hit.rule.padEnd(width)}  ${hit.file}:${hit.line}  ${hit.snippet}`,
    );
  if (result.stale.length > 0) {
    console.error("");
    console.error(
      "  stale allow entries — the hit is gone; delete the entry (the list may only shrink):",
    );
    for (const entry of result.stale)
      console.error(`    ${entry.rule}  ${entry.file}  ${entry.match}  (owner: ${entry.owner})`);
  }
}

function main(argv) {
  let options;
  let allow;
  try {
    options = parseArgs(argv);
    allow = loadAllow();
  } catch (error) {
    console.error(`london-sweep: FAIL — ${error.message}`);
    process.exitCode = 1;
    return;
  }
  const rules = options.only
    ? RULES.filter(({ rule }) => rule === options.only)
    : RULES;
  const { hits, filesScanned } = scanTree({ rules });
  const result = evaluate({ hits, filesScanned, allow, only: options.only });
  report(result, options);
  // `process.exitCode`, never `process.exit()`: on a pipe, stdout is asynchronous and an immediate exit truncates
  // it. Measured — `--json | head` lost the tail of a 3,600-hit report, which would have made every sample of the
  // scoreboard quietly wrong.
  process.exitCode = result.exitCode;
}

// Importing this module must not scan and must never call `process.exit` — the spec imports `RULES`, `scanTree`,
// `loadAllow` and `evaluate`, and a top-level failure would abort the whole vitest process with exit 1 instead of
// reporting a failing test. (Ported from the seed, for the same reason.)
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main(process.argv.slice(2));
