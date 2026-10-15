/**
 * Nanny add-child onboarding — the contribution copy is hidden while payouts are off (4g, P-23).
 *
 * The "we contribute up to …" sentence, the two contribution bullets and the "Get Contributions" step describe the
 * old commission payouts. London has no nanny commission (cards 9a/9b), so they render only when
 * `PAYOUTS_ENABLED` is "true" — hidden, not deleted.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/components/bapp/AddChildSheet", () => ({
  AddChildSheet: () => null,
}));

import { AddChildOnboardingClient } from "./AddChildOnboardingClient";

afterEach(() => {
  vi.unstubAllEnvs();
});

const PAYOUT_COPY = [/contribute/i, /contribution/i, /£/, /payouts/i];

describe("AddChildOnboardingClient — payouts off (default)", () => {
  it("shows no contribution copy and no amount", () => {
    vi.stubEnv("PAYOUTS_ENABLED", "");
    render(<AddChildOnboardingClient currentlyCaringForU3 />);
    const text = document.body.textContent ?? "";
    for (const re of PAYOUT_COPY) expect(text).not.toMatch(re);
  });

  it("keeps the page: a heading, the three plain steps and the Add Child button", () => {
    vi.stubEnv("PAYOUTS_ENABLED", "");
    render(<AddChildOnboardingClient currentlyCaringForU3 />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
      "Set up your account",
    );
    expect(
      screen
        .getAllByRole("listitem")
        .map((li) => li.textContent)
        .join(" "),
    ).toMatch(/Add Children.*Invite Parent.*Use Baby Bloom/);
    expect(screen.queryByText("Get Contributions")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /^add child to start/i }),
    ).toBeInTheDocument();
  });
});

describe("AddChildOnboardingClient — payouts on", () => {
  it("shows the contribution copy as before", () => {
    vi.stubEnv("PAYOUTS_ENABLED", "true");
    render(<AddChildOnboardingClient currentlyCaringForU3 />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toMatch(
      /so we can contribute/,
    );
    expect(screen.getByText("Get Contributions")).toBeInTheDocument();
    expect(document.body.textContent ?? "").toMatch(/£/);
  });
});
