/**
 * Unit 3g (BB-LDN-3g-141026) — brief change 6 (D-7). `client-hire-summary.tsx` is a LEGAL-owned file: 3g removes only
 * the parent instruction to link the nanny's check via the state portal (its section and the portal list line) and
 * renumbers. The commitment sentence stays for the legal chat. Rendered as a React element tree (all text nodes),
 * which is what the PDF renderer lays out.
 */
import { describe, it, expect } from "vitest";
import { isValidElement, type ReactNode } from "react";
import { ClientHireSummaryPDF } from "./client-hire-summary";

/** Every string in the element tree (children only — the renderer's primitives are not expanded). */
function textOf(node: ReactNode): string[] {
  if (node === null || node === undefined || typeof node === "boolean") return [];
  if (typeof node === "string" || typeof node === "number") return [String(node)];
  if (Array.isArray(node)) return node.flatMap(textOf);
  if (isValidElement(node)) {
    return textOf((node.props as { children?: ReactNode }).children);
  }
  return [];
}

const props = {
  clientName: "Olivia Hartley",
  professionalName: "Sophie Taylor",
  referenceNumber: "BB-2026-0001",
  hireDate: "14 Oct 2026",
  verificationDate: "1 Oct 2026",
};

describe("ClientHireSummaryPDF", () => {
  const text = textOf(ClientHireSummaryPDF(props)).join("");

  it("contains no state-portal instruction when rendered", () => {
    expect(text).not.toContain("Service " + "N" + "SW");
    expect(text).not.toContain("service." + "n" + "sw");
    expect(text).not.toContain("Monitoring");
  });

  it("renumbers the sections 1–5", () => {
    const numbered = textOf(ClientHireSummaryPDF(props)).filter((t) => /^\d\. /.test(t));
    expect(numbered.map((t) => t[0])).toEqual(["1", "2", "3", "4", "5"]);
    expect(numbered[1]).toBe("2. EdTech Developmental Logging");
    expect(numbered[4]).toBe("5. Important Links");
  });
});
