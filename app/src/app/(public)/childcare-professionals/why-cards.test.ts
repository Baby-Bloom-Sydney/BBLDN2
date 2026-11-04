/** Brief 12 B1: the nanny-recruitment page shows no babysitting card while `BABYSITTING_ENABLED` is off. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { whyCards, whyCardsGridClass } from "./why-cards";

afterEach(() => vi.unstubAllEnvs());

describe("whyCards (brief 12 §0.1, §0.5)", () => {
  it("off: three cards, in order, no babysitting, and three large-screen columns", () => {
    vi.stubEnv("BABYSITTING_ENABLED", "");
    expect(whyCards().map((c) => c.title)).toEqual([
      "Families who get it",
      "Your terms, always",
      "Professional development",
    ]);
    expect(whyCardsGridClass(whyCards().length)).toContain("lg:grid-cols-3");
    expect(whyCardsGridClass(whyCards().length)).toContain("sm:grid-cols-2");
  });

  it("on: today's four cards and four large-screen columns", () => {
    vi.stubEnv("BABYSITTING_ENABLED", "true");
    expect(whyCards().map((c) => c.title)).toEqual([
      "Families who get it",
      "Your terms, always",
      "Babysitting requests",
      "Professional development",
    ]);
    expect(whyCardsGridClass(whyCards().length)).toContain("lg:grid-cols-4");
  });
});
