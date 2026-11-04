/** Brief 12 B2, B3: the home page's structured data offers no babysitting while `BABYSITTING_ENABLED` is off. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { serviceJsonLd } from "./home-json-ld";

afterEach(() => vi.unstubAllEnvs());

const offers = (): string[] =>
  serviceJsonLd().hasOfferCatalog.itemListElement.map((o) => o.itemOffered.name);

describe("serviceJsonLd (brief 12 §0.2, §0.5)", () => {
  it("off: three offers, no babysitting, and a description that names nannies only", () => {
    vi.stubEnv("BABYSITTING_ENABLED", "");
    expect(offers()).toEqual(["Permanent Nanny Matching", "Part-Time Nanny Matching", "After-School Care"]);
    expect(serviceJsonLd().description).toMatch(/ID-verified nannies\.$/);
    expect(JSON.stringify(serviceJsonLd())).not.toMatch(/babysit/i);
  });

  it("on: today's four offers and description", () => {
    vi.stubEnv("BABYSITTING_ENABLED", "true");
    expect(offers()).toContain("Casual Babysitting");
    expect(offers()).toHaveLength(4);
    expect(serviceJsonLd().description).toMatch(/nannies and babysitters\.$/);
  });
});
