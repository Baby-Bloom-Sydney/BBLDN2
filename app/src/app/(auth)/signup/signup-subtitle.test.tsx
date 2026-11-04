/**
 * /signup subtitle (plan B5; brief §3 parent 1, §9.1; 04b rework W7, W11, brief §0a.5–6). A cold /signup keeps today's
 * line in both CALL_BOOKING_ENABLED states (she books her call after her position). A quick-match sign-up
 * (`/signup?src=std`) goes straight on to the call slide (W11), so with the flag on it names the call. Flag off:
 * today's line. `/matchmaking/signup` keeps the call line (its own test).
 */
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const nav = vi.hoisted(() => ({ search: "src=std" }));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(nav.search) }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ auth: { signOut: vi.fn(async () => ({})) } }) }));
vi.mock("@/lib/auth/actions", () => ({ signUp: vi.fn() }));
vi.mock("@/lib/legal/record-consent", () => ({ recordConsent: vi.fn() }));

import SignupPage from "./page";

const TODAY = "Sign up to find the best childcare for your family";
const CALL_LINE = "Next: your Complimentary matchmaker call, to introduce you to your top nannies.";

afterEach(() => {
  vi.unstubAllEnvs();
  nav.search = "src=std";
});

describe("/signup subtitle", () => {
  it("flag off → today's line", async () => {
    vi.stubEnv("CALL_BOOKING_ENABLED", "");
    render(<SignupPage />);
    expect(await screen.findByText(TODAY)).toBeInTheDocument();
    expect(screen.queryByText(CALL_LINE)).not.toBeInTheDocument();
  });

  it("flag on, a cold sign-up (no src) → still today's line, in the same place (W7)", async () => {
    vi.stubEnv("CALL_BOOKING_ENABLED", "true");
    nav.search = "";
    render(<SignupPage />);
    const line = await screen.findByText(TODAY);
    expect(line.previousElementSibling).toHaveTextContent("Create your parent account");
    expect(screen.queryByText(CALL_LINE)).not.toBeInTheDocument();
  });

  it("flag on, a quick-match sign-up (src=std) → the call line, in the same place (W11: the call is next)", async () => {
    vi.stubEnv("CALL_BOOKING_ENABLED", "true");
    render(<SignupPage />);
    const line = await screen.findByText(CALL_LINE);
    expect(line.previousElementSibling).toHaveTextContent("Create your parent account");
    expect(screen.queryByText(TODAY)).not.toBeInTheDocument();
  });

  it("flag off, a quick-match sign-up → today's line", async () => {
    vi.stubEnv("CALL_BOOKING_ENABLED", "");
    render(<SignupPage />);
    expect(await screen.findByText(TODAY)).toBeInTheDocument();
  });
});
