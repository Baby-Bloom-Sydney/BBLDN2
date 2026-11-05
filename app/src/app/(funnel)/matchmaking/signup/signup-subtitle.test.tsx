/**
 * /matchmaking/signup subtitle (plan B5; brief §3 parent 1, §9.1): today's line with CALL_BOOKING_ENABLED off, the
 * Complimentary matchmaker call line with it on. Nothing else on the form changes.
 */
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/actions/lead-conversion", () => ({ signUpAndConvertLead: vi.fn() }));
vi.mock("@/lib/legal/record-consent", () => ({ recordConsent: vi.fn() }));

import { MatchmakingSignupClient } from "./MatchmakingSignupClient";

const TODAY = "We'll connect you with your top nannies";
const CALL_LINE = "Next: your Complimentary matchmaker call, to introduce you to your top nannies.";

afterEach(() => vi.unstubAllEnvs());

describe("MatchmakingSignupClient subtitle", () => {
  it("flag off → today's line", () => {
    vi.stubEnv("CALL_BOOKING_ENABLED", "");
    render(<MatchmakingSignupClient leadId="lead-1" matchSummary={null} />);
    expect(screen.getByText(TODAY)).toBeInTheDocument();
    expect(screen.queryByText(CALL_LINE)).not.toBeInTheDocument();
  });

  it("flag on → the call line, in the same place", () => {
    vi.stubEnv("CALL_BOOKING_ENABLED", "true");
    render(<MatchmakingSignupClient leadId="lead-1" matchSummary={null} />);
    const line = screen.getByText(CALL_LINE);
    expect(line.tagName).toBe("P");
    expect(line.previousElementSibling).toHaveTextContent("Create your account");
    expect(screen.queryByText(TODAY)).not.toBeInTheDocument();
  });
});
