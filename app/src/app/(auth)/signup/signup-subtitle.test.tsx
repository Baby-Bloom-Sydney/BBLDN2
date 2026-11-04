/**
 * /signup subtitle (plan B5; brief §3 parent 1, §9.1; 04b rework W7, brief §0a.5): today's line in both
 * CALL_BOOKING_ENABLED states — a cold or quick-match sign-up books her call later (after her position, or on the
 * slide), so this form doesn't announce it. `/matchmaking/signup` keeps the call line (its own test).
 */
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams("src=std") }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ auth: { signOut: vi.fn(async () => ({})) } }) }));
vi.mock("@/lib/auth/actions", () => ({ signUp: vi.fn() }));
vi.mock("@/lib/legal/record-consent", () => ({ recordConsent: vi.fn() }));

import SignupPage from "./page";

const TODAY = "Sign up to find the best childcare for your family";
const CALL_LINE = "Next: your Complimentary matchmaker call, to introduce you to your top nannies.";

afterEach(() => vi.unstubAllEnvs());

describe("/signup subtitle", () => {
  it("flag off → today's line", async () => {
    vi.stubEnv("CALL_BOOKING_ENABLED", "");
    render(<SignupPage />);
    expect(await screen.findByText(TODAY)).toBeInTheDocument();
    expect(screen.queryByText(CALL_LINE)).not.toBeInTheDocument();
  });

  it("flag on → still today's line, in the same place (W7)", async () => {
    vi.stubEnv("CALL_BOOKING_ENABLED", "true");
    render(<SignupPage />);
    const line = await screen.findByText(TODAY);
    expect(line.previousElementSibling).toHaveTextContent("Create your parent account");
    expect(screen.queryByText(CALL_LINE)).not.toBeInTheDocument();
  });
});
