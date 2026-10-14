/**
 * Unit 3g (BB-LDN-3g-141026) — brief change 6 (D-7): the parent "link your check via the state portal" instruction is
 * removed from the client hire confirmation email; the sections that follow are renumbered. Old words are spelled in
 * pieces so this file carries no Australian literal (LEDGER/2-0 §8(3)).
 */
import { describe, it, expect } from "vitest";
import { buildClientHireConfirmationEmail } from "./client-hire-confirmation";

const params = {
  clientName: "Olivia Hartley",
  professionalName: "Sophie Taylor",
  referenceNumber: "BB-2026-0001",
  hireDate: "14 Oct 2026",
  edtechLink: "https://app.example.test/parent/feed",
};

describe("buildClientHireConfirmationEmail", () => {
  it("contains no state-portal instruction and no portal-link param when built", () => {
    const { html, text } = buildClientHireConfirmationEmail(params);
    for (const word of ["Service " + "N" + "SW", "service." + "n" + "sw", "Monitoring", "ww" + "ccPortalLink"]) {
      expect(html, word).not.toContain(word);
      expect(text, word).not.toContain(word);
    }
    expect(html).not.toContain("undefined");
  });

  it("numbers its sections 1–4", () => {
    const { html } = buildClientHireConfirmationEmail(params);
    const headings = [...html.matchAll(/<h3[^>]*>([^<]*)<\/h3>/g)].map((m) => m[1]);
    expect(headings.map((t) => t.split(".")[0])).toEqual(["1", "2", "3", "4"]);
    expect(headings[1]).toBe("2. EdTech Tools");
    expect(headings[2]).toBe("3. AI Content Notice");
    expect(headings[3]).toMatch(/^4\. .*Commitments to You$/);
  });
});
