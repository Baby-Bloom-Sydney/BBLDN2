/**
 * Unit 3b (BB-LDN-3b-061026) — settings "Enhanced DBS certificate" leaf (brief change 11; copy deck §5.2).
 * The page decodes the row with `getDbsDisplayState`; the client renders the state it is given.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

const params = vi.hoisted(() => ({ s: "s=dbs" }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(params.s),
  usePathname: () => "/nanny/settings",
}));
vi.mock("@/lib/actions/nanny", () => ({ updateNannyAccountSettings: vi.fn(), deactivateNannyAccount: vi.fn() }));
vi.mock("@/lib/actions/account-security", () => ({ requestPasswordChange: vi.fn() }));

import { NannySettingsClient, type NannyDbsSettings } from "./NannySettingsClient";

afterEach(cleanup);

const PROFILE = {
  first_name: "Jane", last_name: "Doe", email: "jane@example.test", mobile_number: "+447700900123",
  date_of_birth: "1990-01-01", suburb: "Camden", postcode: "NW1 0AA",
};

function show(dbs: NannyDbsSettings | null) {
  return render(
    <NannySettingsClient
      profile={PROFILE}
      verificationLevel={2}
      dbs={dbs}
      payoutsDashboard={null}
      payoutHistory={null}
      payoutOnboarding={{ status: "not_started" as never, email: null, bankSummary: null }}
    />,
  );
}

/** The settings shell renders the leaf in more than one responsive pane, so presence is "at least one". */
const has = (text: string) => expect(screen.getAllByText(text).length).toBeGreaterThan(0);

const base: NannyDbsSettings = { state: "clear", number: "001234567890", issueDate: "2024-03-05", checkedAt: "2026-10-06T09:00:00.000Z" };

describe("NannySettingsClient — DBS", () => {
  it("shows the empty state when the state is not_started even if a number is set", () => {
    show({ ...base, state: "not_started" });
    expect(screen.getAllByText("Enhanced DBS certificate").length).toBeGreaterThan(0);
    has("Upload your DBS certificate to start receiving match requests.");
    expect(screen.getAllByRole("button", { name: /Upload certificate/ }).length).toBeGreaterThan(0);
    expect(screen.queryByText("0012 3456 7890")).toBeNull();
  });

  it("shows the empty state when there is no row", () => {
    show(null);
    has("Upload your DBS certificate to start receiving match requests.");
  });

  it("shows the number, issue date and 'Current · checked {date}' rows when clear", () => {
    show(base);
    has("Certificate number");
    has("0012 3456 7890");
    has("Issue date");
    has("5 Mar 2024");
    has("Update Service");
    has("Current · checked 6 Oct 2026");
    has("Verified");
    has("Got a new DBS certificate?");
  });

  it("shows 'Not on Update Service' when 26, with 'Not found · checked {date}'", () => {
    show({ ...base, state: "no_match" });
    has("Not on Update Service");
    has("Not found · checked 6 Oct 2026");
  });

  it("shows 'New certificate needed' as the pill and the row when 23", () => {
    show({ ...base, state: "new_info" });
    // pill + row value, in each pane
    expect(screen.getAllByText("New certificate needed").length % 2).toBe(0);
    has("New certificate needed");
    expect(screen.queryByText("Expired")).toBeNull();
  });

  it.each<[NannyDbsSettings["state"], string]>([
    ["checking", "Checking…"],
    ["with_team", "Not checked yet"],
    ["failed", "Not checked yet"],
  ])("shows the Update Service value for %s", (state, value) => {
    show({ ...base, state });
    has(value);
  });
});

describe("NannySettingsClient — DBS tree", () => {
  it("labels the tree node 'DBS' with its pill", () => {
    params.s = "s=verification";
    show({ ...base, state: "no_match" });
    has("DBS");
    has("Not on Update Service");
    params.s = "s=dbs";
  });
});
