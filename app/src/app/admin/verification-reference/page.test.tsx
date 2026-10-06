/**
 * Unit 3a (BB-LDN-3a-061026) — render proof for decoder 2 (stand-in for the admin walk: no test admin exists on
 * bb-ldn until 3d, and 3a does not deploy). The page builds its status rows from STATUS_META; no 28, 27 = barred,
 * level 2 excludes 27, no expiry cron. Absence is checked with the gate's own rules (LEDGER/2-0.md §8(3)).
 */
import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import VerificationReferencePage from "./page";
import { STATUS_META } from "@/lib/verification";
import { RULES } from "../../../../scripts/ci/london-sweep.mjs";

const oldRegulatorRules = (RULES as Array<{ rule: string; pattern: RegExp }>).filter(
  ({ rule }) => rule === "identity" || rule === "jurisdiction",
);

/** Every text node joined with spaces, so the gate's word boundaries still apply (textContent glues words). */
function spacedText(el: Element): string {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const parts: string[] = [];
  while (walker.nextNode()) parts.push(walker.currentNode.textContent ?? "");
  return parts.join(" ");
}

describe("admin verification reference — DBS meanings", () => {
  it("renders one status row per STATUS_META code, with 27 as DBS Barred and no row for 28", () => {
    const { container } = render(<VerificationReferencePage />);
    for (const meta of Object.values(STATUS_META)) expect(screen.getAllByText(meta.label).length).toBeGreaterThan(0);
    expect(screen.getByText("DBS Barred (27)")).toBeTruthy();
    expect(container.textContent).not.toMatch(/\(28\)/);
  });

  it("shows no old-regulator text, no expiry cron, and keeps 27 out of level 2", () => {
    const { container } = render(<VerificationReferencePage />);
    const text = spacedText(container);
    for (const { pattern } of oldRegulatorRules) expect(pattern.test(text), String(pattern)).toBe(false);
    expect(text).not.toMatch(/cron/i);
    const syncRow = screen.getByText("20, 21, 22, 23, 24, 25, 26, 29");
    expect(within(syncRow.closest("tr") as HTMLElement).getByText("2")).toBeTruthy();
    expect(screen.getByText(/27 \(barred, suspended\)/)).toBeTruthy();
    expect(screen.getByText("Admin Approve (needs an Update Service pass)")).toBeTruthy();
  });
});
