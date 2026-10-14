/**
 * Unit 3g (BB-LDN-3g-141026) — README P-13 (BAI 2026-10-06): the AI-written social share post (the `<bio>` section —
 * "Facebook bio" — of the V2 prompt) lists the nanny's assurances in its credentials checklist, in ASSURANCE_OPTIONS
 * order after her certificates, and the old check name becomes "Enhanced DBS". The README named
 * `lib/actions/viral-loop.ts`; the checklist lives here (LEDGER/3g.md §2).
 */
import { describe, it, expect } from "vitest";
import { V2_SYSTEM_PROMPT, buildV2Prompt, type V2PromptData } from "./nanny-profile-prompts";

const sophie: V2PromptData = {
  firstName: "Sophie",
  lastName: "Taylor",
  suburb: "Clapham",
  dateOfBirth: null,
  nationality: "British",
  motivation: null,
  personalityTraits: ["Patient"],
  levelOfSupport: [],
  professionalValues: [],
  totalExperience: "6",
  under3Experience: 2,
  newbornExperience: 1,
  childcareRoles: [{ role: "Nanny", duration: 4 }],
  highestQualification: null,
  certificates: ["Paediatric First Aid (12-hour)", "CPR"],
  assurances: ["Ofsted Childcare Register", "References", "Food Hygiene (Level 2)"],
  roleTypes: [],
  minAge: null,
  maxAge: null,
  additionalNeeds: null,
  languages: ["English"],
  driversLicense: true,
  hasCar: false,
  vaccinationStatus: null,
  comfortableWithPets: null,
  nonSmoker: null,
};

describe("P-13 — credentials checklist in the social share post", () => {
  it("names Enhanced DBS first, then certificates, then assurances, and not the old check", () => {
    const line = V2_SYSTEM_PROMPT.split("\n").find((l) => l.includes("Credentials checklist"));
    expect(line).toBeDefined();
    expect(line).toContain("💚 Enhanced DBS + Certificates + Assurances");
    expect(line).toContain("(Enhanced DBS first, then certificates, then assurances)");
    expect(V2_SYSTEM_PROMPT).not.toContain("WW" + "CC");
  });

  it("passes her assurances to the model in ASSURANCE_OPTIONS order, after her certificates in CERTIFICATE_OPTIONS order", () => {
    const prompt = buildV2Prompt(sophie);
    const lines = prompt.split("\n");
    const certs = lines.findIndex((l) => l.startsWith("Certifications: "));
    const assurances = lines.findIndex((l) => l.startsWith("Assurances: "));
    expect(lines[certs]).toBe("Certifications: CPR, Paediatric First Aid (12-hour)");
    expect(lines[assurances]).toBe("Assurances: References, Food Hygiene (Level 2), Ofsted Childcare Register");
    expect(assurances).toBe(certs + 1);
  });

  it("says None when she has no assurances (the lead funnel has none yet)", () => {
    const { assurances: _omit, ...lead } = sophie;
    void _omit;
    expect(buildV2Prompt(lead)).toContain("\nAssurances: None\n");
  });
});
