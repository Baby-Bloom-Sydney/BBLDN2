/**
 * Unit 3b (BB-LDN-3b-061026) — the one nanny-side DBS decoder and the deck §3 cards, written before the code.
 * Brief `3b-nanny-dbs-screens.md` change 1 (states), change 8 (cards + extras), change 10 (badge trigger).
 */
import { describe, it, expect } from "vitest";
import {
  getDbsDisplayState,
  getDbsStateForSection,
  dbsInputFromPoll,
  dbsCardFor,
  dbsCardExtras,
  showsEnhancedDbsBadge,
  isDbsFailState,
  formatDbsNumber,
  formatDbsDate,
  DBS_NO_MATCH_EXPLAINER,
  DBS_FALLBACK_CARD,
  type DbsDisplayState,
} from "./nanny-display";
import { DBS_LINKS } from "@/lib/constants";
import { dbsInput, dbsPoll, STORED_SECTION } from "./fixtures.test-util";
import { GUIDANCE_MESSAGES, type UserGuidance } from "@/lib/verification";

const retry: UserGuidance = { ...GUIDANCE_MESSAGES.TECHNICAL_RETRY };
const retryNoCode: UserGuidance = { title: GUIDANCE_MESSAGES.TECHNICAL_RETRY.title, explanation: "x", steps_to_fix: [] };
const aiReview: UserGuidance = { title: "t", explanation: "e", steps_to_fix: [], reason_code: "name_mismatch" };

describe("getDbsDisplayState", () => {
  it.each<[string, Parameters<typeof getDbsDisplayState>[0], DbsDisplayState]>([
    ["pending (29)", dbsInput({code: 29, section: "pending" }), "reading"],
    ["processing (25)", dbsInput({code: 25, section: "processing" }), "reading"],
    ["pending while identity still runs (10)", dbsInput({code: 10, section: "pending" }), "reading"],
    ["doc_verified + cross-check pending", dbsInput({code: 20, section: "doc_verified", crossCheck: "pending" }), "checking"],
    ["doc_verified + cross-check not_started", dbsInput({code: 20, section: "doc_verified", crossCheck: "not_started" }), "checking"],
    ["20 + TECHNICAL_RETRY reason_code (#30)", dbsInput({code: 20, section: "doc_verified", crossCheck: "pending", guidance: retry }), "technical_retry"],
    ["20 + TECHNICAL_RETRY title only", dbsInput({code: 20, section: "doc_verified", crossCheck: "pending", guidance: retryNoCode }), "technical_retry"],
    ["30", dbsInput({code: 30, section: "doc_verified", crossCheck: "passed" }), "clear"],
    ["40", dbsInput({code: 40, section: "doc_verified", crossCheck: "passed" }), "clear"],
    ["code 30 alone", dbsInput({code: 30 }), "clear"],
    ["doc_verified + cross-check passed, no code", dbsInput({section: "doc_verified", crossCheck: "passed" }), "clear"],
    ["21 by cross-check review", dbsInput({code: 21, section: "doc_verified", crossCheck: "review" }), "with_team"],
    ["21 by AI review (guidance kept)", dbsInput({code: 21, section: "review", guidance: aiReview }), "with_team"],
    ["21 she asked (review, no guidance)", dbsInput({code: 21, section: "review", guidance: null }), "manual_review"],
    ["code 21 alone", dbsInput({code: 21 }), "with_team"],
    ["23", dbsInput({code: 23, section: "expired" }), "new_info"],
    ["26", dbsInput({code: 26, section: STORED_SECTION.NO_MATCH }), "no_match"],
    ["24", dbsInput({code: 24, section: "failed" }), "failed"],
    ["22", dbsInput({code: 22, section: "rejected" }), "rejected"],
    ["27", dbsInput({code: 27, section: "barred" }), "barred"],
    ["code 23 alone", dbsInput({code: 23 }), "new_info"],
    ["code 26 alone", dbsInput({code: 26 }), "no_match"],
    ["code 24 alone", dbsInput({code: 24 }), "failed"],
    ["code 22 alone", dbsInput({code: 22 }), "rejected"],
    ["code 27 alone", dbsInput({code: 27 }), "barred"],
    ["code 29 alone", dbsInput({code: 29 }), "reading"],
    ["code 25 alone", dbsInput({code: 25 }), "reading"],
    ["not started", dbsInput({code: 20, section: "not_started" }), "not_started"],
    ["empty", dbsInput({}), "not_started"],
  ])("returns the right state when %s", (_name, input, expected) => {
    expect(getDbsDisplayState(input)).toBe(expected);
  });

  it("returns not_started for null input", () => {
    expect(getDbsDisplayState(null)).toBe("not_started");
    expect(getDbsDisplayState(undefined)).toBe("not_started");
  });

  it.each([
    [dbsInput({code: 28 })],
    [dbsInput({section: "closed" })],
    [dbsInput({section: "application_pending" })],
    [dbsInput({code: 28, section: "application_pending" })],
  ])("never returns a state for the deleted regulator values (%o) — falls back to not_started", (input) => {
    expect(getDbsDisplayState(input)).toBe("not_started");
  });

  it("does not let a stale code beat a section outcome (23 section wins over code 30)", () => {
    expect(getDbsDisplayState(dbsInput({code: 30, section: "expired" }))).toBe("new_info");
  });
});

describe("isDbsFailState", () => {
  it.each<[DbsDisplayState, boolean]>([
    ["failed", true], ["new_info", true], ["no_match", true], ["rejected", true], ["technical_retry", true],
    ["barred", false], ["clear", false], ["with_team", false], ["manual_review", false], ["reading", false],
    ["checking", false], ["not_started", false],
  ])("%s → %s", (state, expected) => {
    expect(isDbsFailState(state)).toBe(expected);
  });
});

describe("dbsCardExtras", () => {
  it("returns both links in the order Join → Get, plus the explainer, when the reason is DBS_NO_MATCH", () => {
    const x = dbsCardExtras("DBS_NO_MATCH");
    expect(x.links.map((l) => l.href)).toEqual([DBS_LINKS.joinUpdateService, DBS_LINKS.getEnhanced]);
    expect(x.explainer?.heading).toBe("What is the Update Service?");
    expect(x.explainer?.body).toMatch(/^It's the DBS's own service/);
  });

  it("keeps the explainer identical to the 3a guidance text", () => {
    expect(`${DBS_NO_MATCH_EXPLAINER.heading} ${DBS_NO_MATCH_EXPLAINER.body}`).toBe(GUIDANCE_MESSAGES.DBS_NO_MATCH.explainer);
  });

  it.each(["not_enhanced", "no_childrens_barred_list", "adult_workforce_only", "not_a_dbs_certificate", "DBS_NEW_INFO"])(
    "returns one 'Get an enhanced DBS' link and no explainer for %s",
    (code) => {
      const x = dbsCardExtras(code);
      expect(x.links).toEqual([{ label: "Get an enhanced DBS", href: DBS_LINKS.getEnhanced }]);
      expect(x.explainer).toBeUndefined();
    },
  );

  it.each(["wrong_page", "unreadable", "altered_document", "TECHNICAL_RETRY", "DBS_BARRED", "made_up", null, undefined])(
    "returns no links for %s",
    (code) => {
      expect(dbsCardExtras(code).links).toEqual([]);
    },
  );

  it("returns hrefs equal to DBS_LINKS values, never literals", () => {
    const all = ["DBS_NO_MATCH", "DBS_NEW_INFO", "not_enhanced"].flatMap((c) => dbsCardExtras(c).links.map((l) => l.href));
    const allowed = new Set<string>(Object.values(DBS_LINKS));
    expect(all.length).toBeGreaterThan(0);
    for (const href of all) expect(allowed.has(href)).toBe(true);
  });
});

describe("dbsCardFor", () => {
  const stored: UserGuidance = { title: "Model title", explanation: "Model text", steps_to_fix: ["model step"] };

  it("returns the deck card when reason_code is known (not_enhanced), not the stored model text", () => {
    const card = dbsCardFor("not_enhanced", { ...stored, reason_code: "not_enhanced" });
    expect(card.title).toBe("This isn't an enhanced DBS certificate");
    expect(card.steps_to_fix).toHaveLength(3);
  });

  it.each([
    ["no_childrens_barred_list", "This certificate doesn't include the children's barred list"],
    ["adult_workforce_only", "This certificate is for work with adults"],
    ["wrong_page", "We need page 1 of your certificate"],
    ["unreadable", "We couldn't read your certificate"],
    ["not_a_dbs_certificate", "This doesn't look like a DBS certificate"],
    ["altered_document", "We couldn't check this certificate"],
    ["DBS_NEW_INFO", GUIDANCE_MESSAGES.DBS_NEW_INFO.title],
    ["DBS_NO_MATCH", GUIDANCE_MESSAGES.DBS_NO_MATCH.title],
    ["DBS_BARRED", GUIDANCE_MESSAGES.DBS_BARRED.title],
    ["TECHNICAL_RETRY", GUIDANCE_MESSAGES.TECHNICAL_RETRY.title],
  ])("returns the deck card for %s", (code, title) => {
    expect(dbsCardFor(code, stored).title).toBe(title);
  });

  it("returns the stored guidance when the code is unknown", () => {
    expect(dbsCardFor("made_up", stored)).toEqual(stored);
  });

  it("returns the deck fallback when the code is unknown and nothing is stored", () => {
    expect(dbsCardFor(undefined, null)).toEqual(DBS_FALLBACK_CARD);
    expect(DBS_FALLBACK_CARD.title).toBe("We couldn't verify your DBS certificate");
  });

  it("never says fake, forged or tampered on the altered_document card", () => {
    const blob = JSON.stringify(dbsCardFor("altered_document", null)).toLowerCase();
    for (const w of ["fake", "forged", "tamper"]) expect(blob).not.toContain(w);
  });
});

describe("showsEnhancedDbsBadge", () => {
  it.each([[3, true], [4, true], [2, false], [1, false], [0, false], [null, false], [undefined, false]])(
    "level %s → %s",
    (level, expected) => {
      expect(showsEnhancedDbsBadge(level)).toBe(expected);
    },
  );
});

describe("formatting", () => {
  it("groups a 12-digit certificate number in fours", () => {
    expect(formatDbsNumber("001234567890")).toBe("0012 3456 7890");
  });
  it("leaves a non-12-digit value as it is", () => {
    expect(formatDbsNumber("12345")).toBe("12345");
    expect(formatDbsNumber(null)).toBe("");
  });
  it("formats a date as d MMM yyyy", () => {
    expect(formatDbsDate("2024-03-05")).toBe("5 Mar 2024");
    expect(formatDbsDate("2026-10-06T05:00:00.000Z")).toMatch(/^\d{1,2} Oct 2026$/);
    expect(formatDbsDate(null)).toBe("");
    expect(formatDbsDate("not a date")).toBe("");
  });
});

describe("dbsInputFromPoll", () => {
  it("maps a poll body onto the decoder input", () => {
    const g = { ...GUIDANCE_MESSAGES.TECHNICAL_RETRY };
    const input = dbsInputFromPoll(dbsPoll({ code: 20, section: "doc_verified", crossCheck: "pending", guidance: g }));
    expect(getDbsDisplayState(input)).toBe("technical_retry");
  });

  it("returns null for no body and drops wrongly typed fields", () => {
    expect(dbsInputFromPoll(null)).toBeNull();
    expect(dbsInputFromPoll(undefined)).toBeNull();
    expect(getDbsDisplayState(dbsInputFromPoll({ status: "30", cross_check_status: 1 }))).toBe("not_started");
  });
});

describe("getDbsStateForSection", () => {
  it.each([
    ["pending", "reading"],
    [STORED_SECTION.NEW_INFO, "new_info"],
    [STORED_SECTION.NO_MATCH, "no_match"],
    ["barred", "barred"],
    [null, "not_started"],
  ] as const)("decodes a bare %s as %s", (section, state) => {
    expect(getDbsStateForSection(section)).toBe(state);
  });
});
