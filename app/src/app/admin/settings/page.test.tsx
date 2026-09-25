/**
 * `/admin/settings` — the "Database Information" card.
 *
 * The card used to state the project ref, the hosting region and the
 * Postgres version as three hand-typed strings (LDN2 unit 2g, fate row
 * 12.NEW). Hand-typed, they went stale silently: the page named a
 * project the app no longer talks to, beside a region that contradicted
 * the one the policy documents claim (Q-6). Nothing read the values —
 * they were display only — so the fix is to derive what can be derived
 * and to stop asserting what the page cannot know.
 *
 * These tests are the unit's render proof. The page is admin-gated and
 * the London database has no admin yet (Stage 0 §9), so it cannot be
 * walked in a browser; a render here is what proves what a super admin
 * would see. They assert the **London** values — never the absence of an
 * old literal, which would put that literal back in the tree and trip
 * the london-sweep gate (2-0 ledger §8.3).
 *
 * BB-LDN-2g-250926, 2026-09-25.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { SUPABASE_REGION } from "@/lib/constants";

const state = vi.hoisted(() => ({
  role: "super_admin" as string | null,
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    user: null,
    role: state.role,
    profile: { first_name: "Ada", last_name: "Lovelace", email: "ada@example.com" },
    isLoading: false,
    signOut: async () => {},
  }),
}));

import AdminSettingsPage from "./page";

/** A project ref that is nobody's real project — the derivation is what is under test. */
const TEST_PROJECT_REF = "qwertyuiopasdfghjklz";

const originalUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;

beforeEach(() => {
  state.role = "super_admin";
  process.env.NEXT_PUBLIC_SUPABASE_URL = `https://${TEST_PROJECT_REF}.supabase.co`;
});

afterEach(() => {
  if (originalUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  else process.env.NEXT_PUBLIC_SUPABASE_URL = originalUrl;
});

describe("Database Information card", () => {
  it("shows the project the app is actually pointed at, derived from NEXT_PUBLIC_SUPABASE_URL", () => {
    render(<AdminSettingsPage />);

    expect(screen.getByText(TEST_PROJECT_REF)).toBeInTheDocument();
  });

  it("follows the environment when the deployment moves to another project", () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://zxcvbnmasdfghjklqwer.supabase.co";

    render(<AdminSettingsPage />);

    expect(screen.getByText("zxcvbnmasdfghjklqwer")).toBeInTheDocument();
  });

  it("shows the hosting region from the one constant", () => {
    render(<AdminSettingsPage />);

    expect(SUPABASE_REGION).toBe("eu-west-2");
    expect(screen.getByText(SUPABASE_REGION)).toBeInTheDocument();
  });

  it("renders no AWS region outside Europe", () => {
    const { container } = render(<AdminSettingsPage />);

    // textContent, not innerHTML: Tailwind's `gap-2` would match `ap-`.
    expect(container.textContent).not.toContain("ap-");
  });

  it("states no Postgres version — the page runs no query that could know one", () => {
    render(<AdminSettingsPage />);

    expect(screen.queryByText(/postgresql version/i)).not.toBeInTheDocument();
  });

  it("falls back to a placeholder rather than a guess when the URL is unset", () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;

    render(<AdminSettingsPage />);

    expect(screen.getByTestId("supabase-project-ref")).toHaveTextContent("—");
  });

  it("falls back to a placeholder when the URL is unparseable", () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "not a url";

    render(<AdminSettingsPage />);

    expect(screen.getByTestId("supabase-project-ref")).toHaveTextContent("—");
  });

  it("stays hidden from an ordinary admin", () => {
    state.role = "admin";

    render(<AdminSettingsPage />);

    expect(screen.queryByText(/database information/i)).not.toBeInTheDocument();
    expect(screen.queryByTestId("supabase-project-ref")).not.toBeInTheDocument();
  });
});
