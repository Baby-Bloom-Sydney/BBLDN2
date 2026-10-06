/**
 * Unit 3a — the funnel/profile option lists London owns in one place (E-2, D-5, E-1, E-3, P-2, P-6).
 * 3e and the profile edit only import these; no other unit declares the lists.
 */
import { describe, it, expect } from "vitest";
import {
  ASSURANCE_OPTIONS,
  CERTIFICATE_OPTIONS,
  HIGHER_QUALIFICATION_MIN_RANK,
  QUALIFICATION_LADDER,
  RIGHT_TO_WORK_OPTIONS,
  RTW_AUTO_NATIONALITIES,
  byOptionOrder,
  isHigherQualification,
  qualificationRank,
  qualificationScore,
  qualificationShort,
  rightToWorkFor,
} from "./nanny-options";

const L2 = "Level 2 early years";
const L3 = "Level 3 early years educator (incl. NNEB / CACHE diploma)";
const L5 = "Level 5 / foundation degree in early years";
const L6 = "Level 6 — degree in early years, EYTS or QTS";
const OTHER = "Other childcare qualification";
const NONE = "No Qualifications";

/**
 * The UK-only values of the four CHECKs in `LDN2/schema/amendments/08-3a-funnel-checks-uk-only.sql`, kept beside the
 * SQL as a literal list. Changing a constant without a new amendment breaks this test; the 08 read-back compares the
 * live CHECK definitions against the same list.
 */
const FILE_08_UK_VALUES = {
  residency: ["citizen", "settled", "visa_with_rtw", "no_rtw"],
  qualification: [NONE, OTHER, L2, L3, L5, L6],
  certification: ["CPR", "First Aid", "Emergency Paediatric First Aid (6-hour)", "Paediatric First Aid (12-hour)"],
  assurance: [
    "References",
    "Food Hygiene (Level 2)",
    "Safeguarding / Child Protection training",
    "Common Core Skills",
    "Ofsted Childcare Register",
  ],
};

describe("qualification ladder (E-2, P-6)", () => {
  it("ladder values equal the five E-2 labels plus No Qualifications", () => {
    expect(QUALIFICATION_LADDER.map((q) => q.value)).toEqual([NONE, OTHER, L2, L3, L5, L6]);
  });

  it("scores are Other 10, Level 2 30, Level 3 50, Level 5 75, Level 6 100", () => {
    expect([OTHER, L2, L3, L5, L6].map(qualificationScore)).toEqual([10, 30, 50, 75, 100]);
    expect(qualificationScore(NONE)).toBe(0);
  });

  it("ranks strictly increase from Level 2 to Level 6", () => {
    const ranks = [L2, L3, L5, L6].map(qualificationRank);
    expect(ranks).toEqual([1, 2, 3, 4]);
    for (let i = 1; i < ranks.length; i++) expect(ranks[i]).toBeGreaterThan(ranks[i - 1]);
  });

  it("qualificationScore returns 0 for an unknown label", () => {
    expect(qualificationScore("Something else")).toBe(0);
    expect(qualificationScore(null)).toBe(0);
    expect(qualificationScore(undefined)).toBe(0);
    expect(qualificationRank("Something else")).toBe(0);
  });

  it("qualificationShort returns the short label, or the label itself when unknown", () => {
    expect(qualificationShort(L3)).toBe("Level 3 Early Years");
    expect(qualificationShort(L6)).toBe("Degree / EYTS / QTS");
    expect(qualificationShort("Something else")).toBe("Something else");
    expect(qualificationShort(null)).toBe("");
  });

  it("isHigherQualification is true for Level 5 and Level 6 and false for Level 3, Level 2, Other, No Qualifications and any label from the old ladder", () => {
    expect(HIGHER_QUALIFICATION_MIN_RANK).toBe(3);
    expect(isHigherQualification(L5)).toBe(true);
    expect(isHigherQualification(L6)).toBe(true);
    for (const label of [L3, L2, OTHER, NONE, null, undefined, ""]) expect(isHigherQualification(label)).toBe(false);
    // Rejected inputs: the old ladder's labels (still accepted by the transitional 07 CHECK) never earn the bonus.
    for (const oldLadderLabel of [
      "Diploma of Early Childhood Education and Care",
      "Bachelor of Early Childhood Education (Or Equivalent)",
      "Certificate III in Early Childhood Education and Care",
      "Other",
    ])
      expect(isHigherQualification(oldLadderLabel)).toBe(false);
  });
});

describe("right to work (D-5, E-1, E-3)", () => {
  it("rightToWorkFor maps citizen, settled and visa_with_rtw to true and no_rtw to false", () => {
    expect(rightToWorkFor("citizen")).toBe(true);
    expect(rightToWorkFor("settled")).toBe(true);
    expect(rightToWorkFor("visa_with_rtw")).toBe(true);
    expect(rightToWorkFor("no_rtw")).toBe(false);
    expect(rightToWorkFor("unknown" as never)).toBe(false); // a key outside the table fails closed
    expect(RIGHT_TO_WORK_OPTIONS.map((o) => o.key)).toEqual(["citizen", "settled", "visa_with_rtw", "no_rtw"]);
  });

  it("RTW_AUTO_NATIONALITIES equals British and Irish", () => {
    expect([...RTW_AUTO_NATIONALITIES]).toEqual(["British", "Irish"]);
  });
});

describe("P-2 option lists (BAI 2026-10-06)", () => {
  it("CERTIFICATE_OPTIONS equals CPR, First Aid, Emergency Paediatric First Aid (6-hour), Paediatric First Aid (12-hour) in that order", () => {
    expect([...CERTIFICATE_OPTIONS]).toEqual([
      "CPR",
      "First Aid",
      "Emergency Paediatric First Aid (6-hour)",
      "Paediatric First Aid (12-hour)",
    ]);
  });

  it("ASSURANCE_OPTIONS equals References, Food Hygiene (Level 2), Safeguarding / Child Protection training, Common Core Skills, Ofsted Childcare Register in that order", () => {
    expect([...ASSURANCE_OPTIONS]).toEqual([
      "References",
      "Food Hygiene (Level 2)",
      "Safeguarding / Child Protection training",
      "Common Core Skills",
      "Ofsted Childcare Register",
    ]);
  });

  it("byOptionOrder sorts stored values into constant order and puts unknown values last", () => {
    const stored = ["Unknown B", "Paediatric First Aid (12-hour)", "CPR", "Unknown A", "First Aid"];
    expect([...stored].sort(byOptionOrder(CERTIFICATE_OPTIONS))).toEqual([
      "CPR",
      "First Aid",
      "Paediatric First Aid (12-hour)",
      "Unknown B",
      "Unknown A",
    ]);
    expect(stored[0]).toBe("Unknown B"); // the comparator never mutates its input list
  });
});

describe("constants equal the UK CHECK values of file 08", () => {
  it("RTW keys, ladder values, CERTIFICATE_OPTIONS and ASSURANCE_OPTIONS equal the UK values in the residency, qualification, certificate and assurance CHECKs of file 08", () => {
    expect(RIGHT_TO_WORK_OPTIONS.map((o) => o.key)).toEqual(FILE_08_UK_VALUES.residency);
    expect(QUALIFICATION_LADDER.map((q) => q.value)).toEqual(FILE_08_UK_VALUES.qualification);
    expect([...CERTIFICATE_OPTIONS]).toEqual(FILE_08_UK_VALUES.certification);
    expect([...ASSURANCE_OPTIONS]).toEqual(FILE_08_UK_VALUES.assurance);
  });
});
