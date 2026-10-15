/**
 * Unit 5b (BB-LDN-5b-151026) — the last nanny funnel stage. While `SHARE_LOOP_ENABLED` is off it shows no share
 * CTA, no "I don't want more matches" opt-out and no "Are you sure?" modal; one button goes to the dashboard (the
 * same target as the modal's existing "Skip for now"). Flag on → the share CTA as before.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { StageProps } from "../../FunnelOrchestrator";

const push = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

import { N5Welcome } from "./N5Welcome";

const props = {
  state: { first_name: "Sam", last_name: "Lee", about_you: { profile_picture_url: null }, ai_content: null },
} as unknown as StageProps;

beforeEach(() => push.mockReset());
afterEach(() => vi.unstubAllEnvs());

describe("N5Welcome — share loop off", () => {
  it("renders no share CTA, opt-out link or share wording", () => {
    vi.stubEnv("SHARE_LOOP_ENABLED", "");
    const { container } = render(<N5Welcome {...props} />);
    expect(screen.queryByRole("button", { name: /share your profile/i })).toBeNull();
    expect(screen.queryByText(/don.t want more matches/i)).toBeNull();
    expect(container.textContent ?? "").not.toMatch(/share/i);
    expect(screen.getByText(/Welcome to Baby Bloom, Sam!/)).toBeInTheDocument();
  });

  it("offers one way forward: the dashboard", () => {
    vi.stubEnv("SHARE_LOOP_ENABLED", "");
    render(<N5Welcome {...props} />);
    fireEvent.click(screen.getByRole("button", { name: /go to my dashboard/i }));
    expect(push).toHaveBeenCalledWith("/nanny");
    expect(push).not.toHaveBeenCalledWith("/nanny/share");
  });
});

describe("N5Welcome — share loop on", () => {
  it("shows the share CTA as before", () => {
    vi.stubEnv("SHARE_LOOP_ENABLED", "true");
    render(<N5Welcome {...props} />);
    fireEvent.click(screen.getByRole("button", { name: /share your profile/i }));
    expect(push).toHaveBeenCalledWith("/nanny/share");
    expect(screen.queryByRole("button", { name: /go to my dashboard/i })).toBeNull();
  });
});
