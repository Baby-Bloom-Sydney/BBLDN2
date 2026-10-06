/**
 * Unit 3c (BB-LDN-3c-061026) — surname + DOB matching, C1–C4b, C8 (04-test-plan §2.3; 00-RULINGS #21).
 */
import { describe, it, expect } from "vitest";
import { normaliseSurname, surnamesMatch, datesMatch, forenamesMatch } from "./match";

describe("surname / DOB matching (#21)", () => {
  it("C1 returns passed when passport and certificate surname + DOB are identical", () => {
    expect(surnamesMatch("Doe", "Doe")).toBe(true);
    expect(datesMatch("1990-03-05", "1990-03-05")).toBe(true);
  });

  it("C2 returns passed when surnames differ only in case (SMITH / Smith)", () => {
    expect(surnamesMatch("SMITH", "Smith")).toBe(true);
  });

  it("C3 returns passed when surnames differ only in accents (Zoë / ZOE, Núñez / NUNEZ)", () => {
    expect(surnamesMatch("Zoë", "ZOE")).toBe(true);
    expect(surnamesMatch("Núñez", "NUNEZ")).toBe(true);
  });

  it("C4 returns passed when surnames differ only in hyphen vs space (Smith-Jones / SMITH JONES)", () => {
    expect(surnamesMatch("Smith-Jones", "SMITH JONES")).toBe(true);
  });

  it("C4b returns passed when surnames differ only in apostrophe vs space/hyphen (O'Brien / O BRIEN / O-BRIEN) or in leading/trailing spaces", () => {
    expect(surnamesMatch("O'Brien", "O BRIEN")).toBe(true);
    expect(surnamesMatch("O’Brien", "O-BRIEN")).toBe(true);
    expect(surnamesMatch("  Doe ", "DOE")).toBe(true);
    expect(surnamesMatch("Smith  -  Jones", "smith jones")).toBe(true);
  });

  it("C8 returns review when only one half of a double-barrelled surname matches", () => {
    expect(surnamesMatch("Smith-Jones", "Smith")).toBe(false);
    expect(surnamesMatch("Jones", "SMITH JONES")).toBe(false);
  });

  it("does not match a different surname, an empty one or a missing one", () => {
    expect(surnamesMatch("Doe", "Roe")).toBe(false);
    expect(surnamesMatch("", "")).toBe(false);
    expect(surnamesMatch(null, "Doe")).toBe(false);
    expect(surnamesMatch("'-", "-'")).toBe(false);
  });

  it("normaliseSurname folds case, accents and separators", () => {
    expect(normaliseSurname(" O’Bríen-Smith ")).toBe("o brien smith");
  });

  it("datesMatch compares calendar dates and refuses missing or invalid ones", () => {
    expect(datesMatch("1990-03-05", "1990-03-06")).toBe(false);
    expect(datesMatch(null, "1990-03-05")).toBe(false);
    expect(datesMatch("1990-02-30", "1990-02-30")).toBe(false);
    expect(datesMatch("05/03/1990", "05/03/1990")).toBe(false);
    expect(datesMatch("1990-03-05T00:00:00Z", "1990-03-05")).toBe(true);
  });

  it("forenamesMatch accepts full forenames or the first forename only (T11 open), refuses others", () => {
    expect(forenamesMatch("JANE", "Jane Mary")).toBe(true);
    expect(forenamesMatch("JANE MARY", "Jane Mary")).toBe(true);
    expect(forenamesMatch("MARY", "Jane Mary")).toBe(false);
    expect(forenamesMatch(null, "Jane")).toBe(false);
  });
});
