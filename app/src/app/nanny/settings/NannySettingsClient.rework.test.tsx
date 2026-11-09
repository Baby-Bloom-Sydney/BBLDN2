/**
 * Nanny Settings after BAI's rework (ledger B06 §9.1 R1, R6): Profile, Contact details and Business draw their own
 * title row (one Edit each); desktop with no `?s=` opens Profile; "Contact us"; Identity without "Confirmed details";
 * Submit ID and Upload certificate stay in the app (no external-link icon); DBS "Upload a new certificate"; Security
 * without its explanatory line; Linked children without the inner heading.
 *
 * BB-wave1-041126/06b3-rework, 2026-11-09.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

const params = vi.hoisted(() => ({ s: "" }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(params.s),
  usePathname: () => "/nanny/settings",
}));
vi.mock("@/lib/actions/nanny", () => ({ deactivateNannyAccount: vi.fn() }));
vi.mock("@/lib/actions/nanny-account-settings", () => ({ updateNannyAccountSettings: vi.fn() }));
vi.mock("@/lib/actions/account-security", () => ({ requestPasswordChange: vi.fn() }));

import { NannySettingsClient, type NannyDbsSettings } from "./NannySettingsClient";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const PROFILE = {
  first_name: "Jane", last_name: "Doe", email: "jane@example.test", mobile_number: "+447700900123", date_of_birth: "1990-01-01",
  suburb: "London", postcode: "NW1 0AA", address_line1: "1 Camden Road", address_line2: "", updated_at: "2027-02-15T10:00:00.1+00:00",
  address_updated_at: "2027-02-15T10:00:00.2+00:00",
};
const DBS: NannyDbsSettings = { state: "clear", number: "001234567890", issueDate: "2024-03-05", checkedAt: null };

function show(s: string, opts: { level?: number; dbs?: NannyDbsSettings | null } = {}) {
  params.s = s;
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => [] })));
  return render(
    <NannySettingsClient profile={PROFILE} verificationLevel={opts.level ?? 1} dbs={opts.dbs === undefined ? DBS : opts.dbs}
      payoutsDashboard={null} payoutHistory={null} payoutOnboarding={{ status: "not_applied", email: null, bankSummary: null }} />,
  );
}

describe("nanny Settings — the rework", () => {
  it("desktop with no ?s= opens Profile (once); no 'Select a setting' panel", () => {
    show("");
    expect(screen.queryByText("Select a setting from the sidebar.")).toBeNull();
    expect(screen.getAllByRole("button", { name: "Edit profile" })).toHaveLength(1);
  });

  it("Profile and Contact details: one title each, with its Edit", () => {
    show("s=profile");
    expect(screen.getAllByRole("heading", { level: 2, name: "Profile" })).toHaveLength(1); // one section for every width
    expect(screen.getAllByRole("button", { name: "Edit profile" })).toHaveLength(1);
    cleanup();
    show("s=contact");
    expect(screen.getAllByRole("heading", { level: 2, name: "Contact details" })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "Edit contact details" })).toHaveLength(1);
  });

  it("the menu says Contact us, and its page's title too", () => {
    show("s=contact-us");
    expect(screen.getAllByText("Contact us").length).toBeGreaterThan(0);
    expect(screen.queryAllByText("Contact Us")).toHaveLength(0);
  });

  it("Identity: no Confirmed details; Submit ID without an external-link icon", () => {
    show("s=identity");
    expect(screen.queryByText("Confirmed details")).toBeNull();
    for (const link of screen.getAllByRole("link", { name: "Submit ID" })) expect(link.querySelector("svg")).toBeNull();
  });

  it("DBS: Upload certificate without an icon; with a certificate, the link 'Upload a new certificate'", () => {
    show("s=dbs", { dbs: null });
    for (const link of screen.getAllByRole("link", { name: "Upload certificate" })) expect(link.querySelector("svg")).toBeNull();
    cleanup();
    show("s=dbs");
    expect(screen.getAllByRole("link", { name: "Upload a new certificate" })[0]).toHaveAttribute("href", "/nanny/verification");
    expect(screen.queryByText(/Got a new DBS certificate/)).toBeNull();
  });

  it("Security: the button, without the explanatory line", () => {
    show("s=security");
    expect(screen.getAllByRole("button", { name: "Send password reset email" }).length).toBeGreaterThan(0);
    expect(screen.queryByText("Send a password reset link to your registered email.")).toBeNull();
  });

  it("Linked children: the page title only, no inner heading", () => {
    show("s=linked-children");
    expect(screen.getAllByRole("heading", { name: "Linked children" }).every((h) => h.tagName === "H2")).toBe(true);
    expect(screen.getAllByText("No linked children yet.").length).toBeGreaterThan(0);
  });
});
