/**
 * 3d follow-up (BB-LDN-3dfix-141026), finding 4 — during the 3d walk, Submit was clicked before hydration and the
 * browser did its default native submit: GET `/login?email=…&password=…`, putting the password in the URL, the history
 * and the dev log. Without JS the form must POST to a fixed same-page path, so credentials are never in a query string.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, createEvent, fireEvent } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  // A redirect param keeps the page's stale-session sign-out effect from running.
  useSearchParams: () => new URLSearchParams("redirect=/nanny/dashboard"),
}));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ auth: { signOut: vi.fn() } }) }));
vi.mock("@/lib/auth/actions", () => ({ signIn: vi.fn() }));

import LoginPage from "./page";

describe("/login form — safe without JS", () => {
  it("posts (never GETs) to /login with no query string", () => {
    render(<LoginPage />);
    const form = screen.getByLabelText("Password").closest("form") as HTMLFormElement;
    expect(form).not.toBeNull();
    expect(form.getAttribute("method")).toBe("post");
    expect(form.getAttribute("action")).toBe("/login");
  });

  it("with JS, a submit is handled in the page (native submit prevented), so the form never navigates", () => {
    render(<LoginPage />);
    const form = screen.getByLabelText("Password").closest("form") as HTMLFormElement;
    const submit = createEvent.submit(form);
    fireEvent(form, submit);
    expect(submit.defaultPrevented).toBe(true);
  });
});
