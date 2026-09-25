/**
 * One clock — the rule that keeps 12-hour labels out of `src/`.
 *
 * BabyBloom renders every time on a single 24-hour clock, from the locale
 * (`APP_LOCALE` = `en-GB`, 12.03). The London sweep gate cannot see a breach of
 * that rule: a hand-rolled `h >= 12 ? "pm" : "am"` carries none of the tokens
 * the locale and timezone rules look for — no old locale tag, no old zone name,
 * not even `hour12` — so every rule passes straight over it. That blindness is
 * exactly how fifteen of these survived three sweeps and were only found by
 * reading (LDN2 W-12, ledger `2j` §7).
 *
 * (Written without naming those tokens on purpose: `LEDGER/2-0.md` §8, lesson
 * 3 — a literal written into a file to describe its own absence is a gate hit.
 * It was, the first time this comment was written, and the gate said so.)
 *
 * So the rule lives here instead, as a spec rather than a gate class: gate
 * classes are reserved for the London value classes, and a spec can assert the
 * *shape of code* rather than the presence of a token.
 *
 * It matches **construction**, never a literal. `"Morning (6am-10am)"` is a
 * stored enum value (Q-12, BAI's call) and `"2:00pm"` in the brand-kit page is
 * hardcoded showcase data; neither builds a clock from an hour, so neither
 * trips this and neither needs to be silenced. That is why `ALLOWED` is empty.
 */

import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const SRC = path.resolve(__dirname, "..");

/**
 * Files exempt from the rule.
 *
 * Empty, and the test below keeps it empty. An entry belongs here only when a
 * file must build a 12-hour label because the label is a **stored value** — a
 * string written to or compared against the database — and each entry carries
 * the column it is stored in. Today no such file exists:
 *
 *   • Q-12's availability brackets (`"Morning (6am-10am)"` …, stored in
 *     `day_times`) live in `src/types/nanny-leads.ts`, `admin/leads/actions.ts`,
 *     `nanny/register/steps/StepAvailability.tsx`,
 *     `nanny/register/NannyRegistrationFunnel.tsx`,
 *     `nanny/profile/NannyMyProfile.tsx` and `nanny/profiletest/`. They are
 *     whole literal strings, never assembled from an hour, so the patterns
 *     below do not reach them.
 *   • `nanny/register/steps/StepReview.tsx` abbreviates those bracket *names*
 *     to `"AM"`/`"PM"`. Also a literal; also out of reach.
 *
 * Adding an entry is therefore a decision to be argued in a ledger, not a way
 * to quiet a failure.
 */
const ALLOWED: string[] = [];

/** Hand-rolled 12-hour construction, in every spelling found in this tree. */
const PATTERNS: { name: string; re: RegExp }[] = [
  {
    name: 'an am/pm label chosen by comparing an hour to 12',
    re: /[A-Za-z_$][\w$]*\s*[<>]=?\s*12\s*\?\s*['"`](?:am|pm)['"`]/i,
  },
  {
    name: "an hour folded into 12-hour range with `h > 12 ? h - 12`",
    re: /[A-Za-z_$][\w$]*\s*>\s*12\s*\?\s*[A-Za-z_$][\w$]*\s*-\s*12/,
  },
  { name: "an hour folded with `% 12 || 12`", re: /%\s*12\s*\|\|\s*12/ },
  {
    name: "an hour folded with `((h + 11) % 12) + 1`",
    re: /\(\s*[A-Za-z_$][\w$]*\s*\+\s*11\s*\)\s*%\s*12\s*\)?\s*\+\s*1/,
  },
  { name: "an explicit `hour12: true` pin", re: /hour12\s*:\s*true/ },
];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    if (!/\.tsx?$/.test(entry.name)) return [];
    if (/\.(test|spec)\.tsx?$/.test(entry.name)) return [];
    return [full];
  });
}

function hits(): string[] {
  const found: string[] = [];
  for (const file of sourceFiles(SRC)) {
    const rel = path.relative(SRC, file);
    if (ALLOWED.includes(rel)) continue;
    readFileSync(file, "utf8")
      .split("\n")
      .forEach((line, i) => {
        for (const { name, re } of PATTERNS) {
          if (re.test(line)) found.push(`src/${rel}:${i + 1} — ${name}`);
        }
      });
  }
  return found;
}

describe("one clock", () => {
  it("builds no 12-hour time label by hand anywhere in src/", () => {
    expect(hits()).toEqual([]);
  });

  it("can actually see a hand-rolled label — the detector is not vacuous", () => {
    // Every spelling this tree contained before LDN2 unit 2k, as data. If a
    // pattern is ever weakened, this fails rather than the suite going quietly
    // green on a rule that no longer matches anything.
    const spellings = [
      'const ampm = h >= 12 ? "pm" : "am";',
      "const am = hour < 12 ? 'AM' : 'PM';",
      "const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;",
      "const h12 = h % 12 || 12;",
      "const h12 = ((hour + 11) % 12) + 1;",
      "toLocaleString(APP_LOCALE, { hour12: true })",
    ];
    for (const spelling of spellings) {
      expect(
        PATTERNS.some(({ re }) => re.test(spelling)),
        `no pattern matched: ${spelling}`,
      ).toBe(true);
    }
  });

  it("exempts no file — the allow-list is empty and stays empty", () => {
    // See the comment on ALLOWED: every stored-value 12-hour string in this
    // tree is a whole literal, so none of them needs an exemption.
    expect(ALLOWED).toEqual([]);
  });

  it("scans the real tree, not an empty directory", () => {
    expect(sourceFiles(SRC).length).toBeGreaterThan(500);
  });
});
