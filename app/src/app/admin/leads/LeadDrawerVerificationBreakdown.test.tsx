/**
 * Unit 3a (BB-LDN-3a-061026) — render proof for decoder 4: no expiry warning (the stored date is the DBS issue date),
 * warn on 23 / 26, rows read "Enhanced DBS" and "Update Service". Fixtures carry only the fields under test.
 */
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { LeadDrawerVerificationBreakdown } from "./LeadDrawerVerificationBreakdown";
import type { LeadDetail } from "@/lib/leads/fetch-lead-detail";
import { RULES } from "../../../../scripts/ci/london-sweep.mjs";

const oldRegulatorRules = (RULES as Array<{ rule: string; pattern: RegExp }>).filter(
  ({ rule }) => rule === "identity" || rule === "jurisdiction",
);
const detailWith = (verification_status: number | null) =>
  ({ verifications: { verification_status, identity_verified: true }, nanny: null, user_profile: null }) as unknown as LeadDetail;

function rowIcon(container: HTMLElement, label: string) {
  const row = [...container.querySelectorAll("div.flex.items-center.justify-between")].find((el) =>
    el.textContent?.startsWith(label),
  );
  return row?.querySelector("span.rounded-full")?.className ?? "";
}

/** Every text node joined with spaces, so the gate's word boundaries still apply (textContent glues words). */
function spacedText(el: Element): string {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const parts: string[] = [];
  while (walker.nextNode()) parts.push(walker.currentNode.textContent ?? "");
  return parts.join(" ");
}

describe("lead drawer verification breakdown — DBS meanings", () => {
  it.each([23, 26])("warns on the DBS row when the status is %i", (code) => {
    const { container } = render(<LeadDrawerVerificationBreakdown detail={detailWith(code)} />);
    expect(rowIcon(container, "Enhanced DBS")).toMatch(/amber/);
  });

  it("does not warn on the DBS row for a pending status and labels the Update Service row", () => {
    const { container } = render(<LeadDrawerVerificationBreakdown detail={detailWith(30)} />);
    expect(rowIcon(container, "Enhanced DBS")).not.toMatch(/amber/);
    expect(container.textContent).toContain("Update Service");
    expect(container.textContent).not.toMatch(/expires/i);
  });

  it("decodes the status code with its STATUS_META short label, so 27 reads as barred", () => {
    const { container } = render(<LeadDrawerVerificationBreakdown detail={detailWith(27)} />);
    expect(container.textContent).toContain("code 27 · Barred");
  });

  it("renders no old-regulator text in the identity, DBS and Update Service rows", () => {
    const { container } = render(<LeadDrawerVerificationBreakdown detail={detailWith(23)} />);
    const rows = [...container.querySelectorAll("div.flex.items-center.justify-between")].slice(0, 3);
    expect(rows.map((r) => r.querySelector("span.text-slate-700")?.textContent)).toEqual(["Identity", "Enhanced DBS", "Update Service"]);
    const text = rows.map(spacedText).join(" ");
    for (const { pattern } of oldRegulatorRules) expect(pattern.test(text), String(pattern)).toBe(false);
  });
});
