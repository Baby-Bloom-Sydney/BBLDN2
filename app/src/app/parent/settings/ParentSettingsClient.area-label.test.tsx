/**
 * 2i render proof — the settings address form says "Area", not "Suburb".
 *
 * P-15: the London word is "Area"; `district` stays the data-model term and
 * `profile.suburb` keeps its name because it is the column. The fixture
 * therefore still passes `suburb: "Clapham"` and the test asserts the
 * district renders in the row the "Area" label heads — label and data proved
 * together, which is the pairing the checkpoint walk looks for.
 *
 * Paired with `AdminPositionsClient.area-label.test.tsx`; the two are
 * `04-sequence.md` §0's render proof in its vitest form (the Stage 0 nanny's
 * password is not recorded in `LEDGER/stage-0-findings.md` §5, so the
 * browser form of the proof is not available to this unit).
 *
 * The *parent* settings form is the one rendered here rather than the
 * nanny's: they carry byte-identical Address subsections, but the nanny
 * component takes a required check-name prop whose literal is an `identity`
 * gate class, and this unit must leave the gate at exactly main's count.
 * (2-0's lesson, generalised: do not write a gate-class token into a file
 * merely to talk about it.)
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ParentSettingsClient } from "./ParentSettingsClient";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams("s=profile"),
}));

vi.mock("@/lib/actions/parent", () => ({
  updateParentAccountSettings: vi.fn(async () => ({ success: true })),
  deactivateParentAccount: vi.fn(async () => ({ success: true })),
}));

vi.mock("@/lib/actions/account-security", () => ({
  requestPasswordChange: vi.fn(async () => ({ success: true })),
}));

const PROFILE = {
  first_name: "Amara",
  last_name: "Okonkwo",
  email: "amara@example.com",
  mobile_number: "+447700900123",
  date_of_birth: "1994-03-02",
  suburb: "Clapham",
  postcode: "SW4",
};

describe("2i — settings place label (P-15)", () => {
  // SettingsShell renders the active leaf into both its mobile and its
  // desktop pane, so every label appears more than once. `getAllByText` is
  // the honest query here; asserting on one would be asserting on whichever
  // pane the DOM happened to emit first.
  it('labels the address field "Area" and shows the district as its value', () => {
    render(<ParentSettingsClient profile={PROFILE} />);

    const labels = screen.getAllByText("Area");
    expect(labels.length).toBeGreaterThan(0);
    expect(screen.queryAllByText("Suburb")).toHaveLength(0);

    for (const label of labels) {
      const row = label.closest("button") ?? label.parentElement?.parentElement;
      expect(row).not.toBeNull();
      expect((row as HTMLElement).textContent).toContain("Clapham");
    }
  });

  it('keeps "Postcode" beside it — British English, not in P-15 scope', () => {
    render(<ParentSettingsClient profile={PROFILE} />);
    expect(screen.getAllByText("Postcode").length).toBeGreaterThan(0);
  });
});
