/**
 * Unit 3a — the DBS meanings of every verification code, guidance key and DBS constant.
 * Cites: 00-RULINGS #10–#13, #22–#24, #30, #33, #34; QUESTIONS D-3, D-8; 03-status-mapping §2–§3;
 * 03-admin-dbs-tab-spec §1.3–§1.4, §5; 02-copy-deck §4.
 *
 * Absence checks use the London gate's own rules (`scripts/ci/london-sweep.mjs`), so this file never spells out
 * an old regulator literal to assert it is gone (LEDGER/2-0.md §8(3)).
 */
import { describe, it, expect } from "vitest";
import {
  ADMIN_PENDING_CODES,
  CROSS_CHECK_STATUS,
  DBS_ACTIVITY,
  DBS_API_RESULT,
  DBS_CERTIFICATE_NUMBER_PATTERN,
  DBS_FAILED_CODES,
  DBS_REVIEW_CODES,
  DBS_VERIFICATION_METHOD,
  GUIDANCE_MESSAGES,
  IDENTITY_STATUS,
  ID_FAILED_CODES,
  ID_REVIEW_CODES,
  LEVEL_LABELS,
  STATUS_LABELS,
  STATUS_META,
  VERIFICATION_STATUS,
  WWCC_STATUS,
  deriveOverallStatus,
  isDbsApiPass,
  statusTone,
  type UserGuidance,
} from "./verification";
import { DBS_LINKS } from "./constants";
import { RULES } from "../../scripts/ci/london-sweep.mjs";

const SECTION = WWCC_STATUS; // D-4: the DBS section keeps its stored name; this file reads it once.

const OLD_REGULATOR_RULES = (RULES as Array<{ rule: string; pattern: RegExp }>).filter(
  ({ rule }) => rule === "identity" || rule === "jurisdiction",
);
const flaggedByGate = (text: string) => OLD_REGULATOR_RULES.some(({ pattern }) => pattern.test(text));

const IDENTITY_VALUES = Object.values(IDENTITY_STATUS);
const SECTION_VALUES = Object.values(SECTION);
const CROSS_CHECK_VALUES = Object.values(CROSS_CHECK_STATUS);

describe("deriveOverallStatus — DBS ordering (3a change 10)", () => {
  it("returns 27 when the DBS section is barred whatever identity and cross-check are", () => {
    for (const id of IDENTITY_VALUES)
      for (const cc of CROSS_CHECK_VALUES)
        expect(deriveOverallStatus(id, SECTION.BARRED, cc)).toBe(27);
  });

  it.each([
    ["not_started", 0],
    ["pending", 10],
    ["processing", 10],
    ["review", 11],
    ["rejected", 12],
    ["failed", 11],
  ] as const)("returns 0, 10, 11, 12 for the identity states before any DBS state (%s → %i)", (id, code) => {
    expect(deriveOverallStatus(id, SECTION.NEW_INFO, CROSS_CHECK_STATUS.PASSED)).toBe(code);
    expect(deriveOverallStatus(id, SECTION.DOC_VERIFIED, CROSS_CHECK_STATUS.REVIEW)).toBe(code);
  });

  it("returns 21, not 30, when identity is verified and cross-check is review", () => {
    expect(deriveOverallStatus("verified", SECTION.DOC_VERIFIED, CROSS_CHECK_STATUS.REVIEW)).toBe(21);
  });

  it("returns 30 when identity is verified, the section is doc_verified and cross-check is passed", () => {
    expect(deriveOverallStatus("verified", SECTION.DOC_VERIFIED, CROSS_CHECK_STATUS.PASSED)).toBe(30);
  });

  it("returns 20 when the section is doc_verified and cross-check is pending (API unreachable, #30)", () => {
    expect(deriveOverallStatus("verified", SECTION.DOC_VERIFIED, CROSS_CHECK_STATUS.PENDING)).toBe(20);
  });

  it("returns 23 when the section is new-information even though cross-check is passed (re-check fail)", () => {
    expect(deriveOverallStatus("verified", SECTION.NEW_INFO, CROSS_CHECK_STATUS.PASSED)).toBe(23);
  });

  it("returns 26 when the section is no-match even though cross-check is passed", () => {
    expect(deriveOverallStatus("verified", SECTION.NO_MATCH, CROSS_CHECK_STATUS.PASSED)).toBe(26);
  });

  it.each([
    [SECTION.REJECTED, 22],
    [SECTION.FAILED, 24],
    [SECTION.REVIEW, 21],
    [SECTION.PROCESSING, 25],
    [SECTION.PENDING, 29],
  ] as const)("returns 22 / 24 / 21 / 25 / 29 for rejected / failed / review / processing / pending (%s)", (s, code) => {
    expect(deriveOverallStatus("verified", s, CROSS_CHECK_STATUS.NOT_STARTED)).toBe(code);
  });

  it("returns 20 when identity is verified and nothing is submitted, and 30 over processing once cross-check passed", () => {
    expect(deriveOverallStatus("verified", SECTION.NOT_STARTED, CROSS_CHECK_STATUS.NOT_STARTED)).toBe(20);
    expect(deriveOverallStatus("verified", SECTION.PROCESSING, CROSS_CHECK_STATUS.PASSED)).toBe(30);
  });

  it("returns 0 for an identity value outside the vocabulary (fails closed)", () => {
    expect(deriveOverallStatus("unknown" as never, SECTION.DOC_VERIFIED, CROSS_CHECK_STATUS.PASSED)).toBe(0);
  });

  it("never returns 28 or 40 for any identity × section × cross-check combination", () => {
    let seen = 0;
    for (const id of IDENTITY_VALUES)
      for (const s of SECTION_VALUES)
        for (const cc of CROSS_CHECK_VALUES) {
          const code = deriveOverallStatus(id, s, cc);
          expect(code).not.toBe(28);
          expect(code).not.toBe(40);
          expect(STATUS_META[code], `code ${code} has no meaning`).toBeDefined();
          seen++;
        }
    expect(seen).toBe(IDENTITY_VALUES.length * SECTION_VALUES.length * CROSS_CHECK_VALUES.length);
  });
});

describe("section-status vocabulary (D-3)", () => {
  it("has no closed or application-pending value and keeps the stored values of the re-meant keys", () => {
    expect(SECTION_VALUES).not.toContain("closed");
    expect(SECTION_VALUES).not.toContain("application_pending");
    expect(SECTION.NEW_INFO).toBe("expired");
    expect(SECTION.BARRED).toBe("barred");
    expect(SECTION_VALUES).toHaveLength(10);
  });

  it("re-means 23, 26 and 27 under DBS names and deletes 28", () => {
    expect(VERIFICATION_STATUS.DBS_NEW_INFO).toBe(23);
    expect(VERIFICATION_STATUS.DBS_NO_MATCH).toBe(26);
    expect(VERIFICATION_STATUS.DBS_BARRED).toBe(27);
    expect(Object.values(VERIFICATION_STATUS)).not.toContain(28);
  });
});

describe("STATUS_META — the single decoder", () => {
  const LONDON_LABELS: Record<number, string> = {
    0: "Not Started (0)",
    10: "Pending ID Auto (10)",
    11: "Pending ID Review (11)",
    12: "ID Rejected (12)",
    20: "ID Verified (20)",
    21: "DBS Needs Review (21)",
    22: "DBS Rejected (22)",
    23: "DBS New Information (23)",
    24: "DBS Document Failed (24)",
    25: "DBS Processing (25)",
    26: "No Update Service Match (26)",
    27: "DBS Barred (27)",
    29: "DBS Submitted (29)",
    30: "Awaiting Approval (30)",
    40: "Fully Verified (40)",
  };

  it("decodes every code in 03-status-mapping §3 to its London label and has no entry for 28", () => {
    expect(Object.keys(STATUS_META).map(Number).sort((a, b) => a - b)).toEqual(
      Object.keys(LONDON_LABELS).map(Number).sort((a, b) => a - b),
    );
    for (const [code, label] of Object.entries(LONDON_LABELS)) {
      expect(STATUS_META[Number(code)].label).toBe(label);
      expect(STATUS_LABELS[Number(code)]).toBe(label);
    }
    expect(STATUS_META[28]).toBeUndefined();
    expect(STATUS_LABELS[28]).toBeUndefined();
  });

  it("returns no old-regulator text (the gate's identity and jurisdiction rules) in any STATUS_META label or description", () => {
    for (const meta of Object.values(STATUS_META)) {
      for (const text of [meta.label, meta.short, meta.group, meta.description]) {
        expect(text.trim().length).toBeGreaterThan(0);
        expect(flaggedByGate(text), text).toBe(false);
      }
    }
  });

  it("labels level 3 as awaiting approval and level 4 as admin approved", () => {
    expect(LEVEL_LABELS[3]).toBe("Provisional: awaiting approval (3)");
    expect(LEVEL_LABELS[4]).toBe("Fully Verified: admin approved (4)");
    expect(LEVEL_LABELS[2]).toBe("ID Verified (2)");
  });
});

describe("statusTone and the shared code sets", () => {
  it("statusTone returns failed for 12, 22, 23, 24, 26, 27; info for 20; active for 30; verified for 40", () => {
    for (const code of [12, 22, 23, 24, 26, 27]) expect(statusTone(code)).toBe("failed");
    expect(statusTone(20)).toBe("info");
    expect(statusTone(30)).toBe("active");
    expect(statusTone(40)).toBe("verified");
    expect(statusTone(0)).toBe("unattempted");
    for (const code of [10, 11, 21, 25, 29]) expect(statusTone(code)).toBe("pending");
  });

  it("statusTone treats null as unattempted and an unknown code as pending", () => {
    expect(statusTone(null)).toBe("unattempted");
    expect(statusTone(undefined)).toBe("unattempted");
    expect(statusTone(28)).toBe("pending");
  });

  it("ADMIN_PENDING_CODES equals 10, 11, 21, 30", () => {
    expect([...ADMIN_PENDING_CODES]).toEqual([10, 11, 21, 30]);
  });

  it("the failed and review code sets hold the DBS meanings", () => {
    expect([...ID_FAILED_CODES]).toEqual([12]);
    expect([...ID_REVIEW_CODES]).toEqual([11]);
    expect([...DBS_FAILED_CODES].sort((a, b) => a - b)).toEqual([22, 23, 24, 26, 27]);
    expect([...DBS_REVIEW_CODES]).toEqual([21]);
  });
});

describe("DBS constants", () => {
  it('DBS_CERTIFICATE_NUMBER_PATTERN accepts "001234567890" and rejects 11 or 13 digits, letters and spaces', () => {
    expect(DBS_CERTIFICATE_NUMBER_PATTERN.test("001234567890")).toBe(true);
    for (const bad of ["12345678901", "1234567890123", "00123456789A", "001234 567890", " 001234567890", ""])
      expect(DBS_CERTIFICATE_NUMBER_PATTERN.test(bad), bad).toBe(false);
  });

  it("isDbsApiPass returns true only for BLANK_NO_NEW_INFO and NON_BLANK_NO_NEW_INFO", () => {
    expect(isDbsApiPass(DBS_API_RESULT.BLANK)).toBe(true);
    expect(isDbsApiPass(DBS_API_RESULT.NON_BLANK)).toBe(true);
    expect(isDbsApiPass(DBS_API_RESULT.NEW_INFO)).toBe(false);
    expect(isDbsApiPass(DBS_API_RESULT.NO_MATCH)).toBe(false);
    expect(isDbsApiPass("CLEARED")).toBe(false);
    expect(isDbsApiPass(null)).toBe(false);
    expect(isDbsApiPass(undefined)).toBe(false);
  });

  it("stores the Update Service vocabulary, the method and the two log types (#33, #34)", () => {
    expect(DBS_API_RESULT).toEqual({
      BLANK: "BLANK_NO_NEW_INFO",
      NON_BLANK: "NON_BLANK_NO_NEW_INFO",
      NEW_INFO: "NEW_INFO",
      NO_MATCH: "NO_MATCH_FOUND",
    });
    expect(DBS_VERIFICATION_METHOD).toBe("dbs_certificate");
    expect(DBS_ACTIVITY).toEqual({ STATUS_CHECK: "dbs_status_check", PAGE2_REQUESTED: "dbs_page2_requested" });
  });
});

describe("guidance — DBS keys (#22, #24)", () => {
  it("DBS_NO_MATCH guidance carries the Update Service explainer and both DBS_LINKS (#22)", () => {
    const g = GUIDANCE_MESSAGES.DBS_NO_MATCH;
    expect(g.explainer).toMatch(/Update Service/);
    expect(g.links.map((l) => l.href)).toEqual([DBS_LINKS.joinUpdateService, DBS_LINKS.getEnhanced]);
    expect(g.links.map((l) => l.label)).toEqual(["Join the Update Service", "Get an enhanced DBS"]);
  });

  it("DBS_NEW_INFO guidance links Get an enhanced DBS", () => {
    expect(GUIDANCE_MESSAGES.DBS_NEW_INFO.links).toEqual([{ label: "Get an enhanced DBS", href: DBS_LINKS.getEnhanced }]);
    expect(GUIDANCE_MESSAGES.DBS_NEW_INFO.title).toBe("You'll need a new DBS certificate");
  });

  it("DBS_NEW_INFO, DBS_NO_MATCH and DBS_BARRED guidance each carry their own reason_code", () => {
    expect(GUIDANCE_MESSAGES.DBS_NEW_INFO.reason_code).toBe("DBS_NEW_INFO");
    expect(GUIDANCE_MESSAGES.DBS_NO_MATCH.reason_code).toBe("DBS_NO_MATCH");
    expect(GUIDANCE_MESSAGES.DBS_BARRED.reason_code).toBe("DBS_BARRED");
    expect(GUIDANCE_MESSAGES.TECHNICAL_RETRY.reason_code).toBe("TECHNICAL_RETRY");
  });

  it("UserGuidance accepts reason_code and confidence and stays assignable from the old three-field shape", () => {
    const old: UserGuidance = { title: "t", explanation: "e", steps_to_fix: ["s"] };
    const rich: UserGuidance = {
      ...old,
      reason_code: "unreadable",
      confidence: "low",
      explainer: "x",
      links: [
        { label: "a", href: "https://a.example" },
        { label: "b", href: "https://b.example" },
      ],
    };
    const fromConstant: UserGuidance = GUIDANCE_MESSAGES.DBS_NO_MATCH;
    expect(rich.confidence).toBe("low");
    expect(fromConstant.links).toHaveLength(2);
  });

  // Retargeted by 3b (BB-LDN-3b-061026): PDF_UNREADABLE / PDF_NAME_MISMATCH left with their last importer (the old
  // DBS section), as this brief's A.9 rule says — so no guidance is exempt any more.
  it("returns no old-regulator text in any guidance", () => {
    for (const [key, g] of Object.entries(GUIDANCE_MESSAGES)) {
      const blob = JSON.stringify(g);
      expect(flaggedByGate(blob), key).toBe(false);
    }
    expect(Object.keys(GUIDANCE_MESSAGES).sort()).toEqual(
      ["DBS_BARRED", "DBS_NEW_INFO", "DBS_NO_MATCH", "TECHNICAL_RETRY", "TECHNICAL_STALE"].sort(),
    );
  });
});
