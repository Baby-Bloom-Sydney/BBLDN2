/** Brief 12 B4: the pricing FAQ's babysitting question shows only while `BABYSITTING_ENABLED` is "true". */
import { afterEach, describe, expect, it, vi } from "vitest";
import { faqJsonLd } from "./faq-json-ld";

afterEach(() => vi.unstubAllEnvs());

const questions = (): string[] => faqJsonLd().mainEntity.map((q) => q.name);

describe("faqJsonLd — babysitting hidden while off (brief 12 §0.3, §0.5)", () => {
  it("off: no babysitter question anywhere in the structured data", () => {
    vi.stubEnv("BABYSITTING_ENABLED", "");
    expect(questions()).toHaveLength(3);
    expect(JSON.stringify(faqJsonLd())).not.toMatch(/babysit/i);
  });

  it("on: today's four questions, the babysitting one last", () => {
    vi.stubEnv("BABYSITTING_ENABLED", "true");
    expect(questions()).toEqual([
      "How much does a nanny cost in London?",
      "Are Baby Bloom nannies DBS checked?",
      "How does the nanny matching process work?",
      "Can I find a babysitter for a one-off job?",
    ]);
  });
});
