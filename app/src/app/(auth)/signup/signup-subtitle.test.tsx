/**
 * /signup subtitle (plan B5; brief §3 parent 1, §9.1): today's line with CALL_BOOKING_ENABLED off, the Complimentary
 * matchmaker call line with it on. Nothing else on the form changes.
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

  it("flag on → the call line, in the same place", async () => {
    vi.stubEnv("CALL_BOOKING_ENABLED", "true");
    render(<SignupPage />);
    const line = await screen.findByText(CALL_LINE);
    expect(line.previousElementSibling).toHaveTextContent("Create your parent account");
    expect(screen.queryByText(TODAY)).not.toBeInTheDocument();
  });
});
