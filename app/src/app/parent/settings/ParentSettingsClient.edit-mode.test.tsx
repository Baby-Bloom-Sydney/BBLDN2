/**
 * Parent Settings with edit mode: Profile and Contact details each have one Edit for the page and no pop-up; every
 * other part of parent Settings renders exactly as before. The pinned markup (a digest of the rendered page, with
 * its text beside it for a readable diff) was captured at main b7b3f1e, before this change, whose parent Settings
 * files are byte-identical to aad83f8's.
 */
import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ChildClient } from "@/types/bapp";

const h = vi.hoisted(() => ({ search: "", push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: h.push, replace: vi.fn(), refresh: h.refresh }),
  useSearchParams: () => new URLSearchParams(h.search),
}));
vi.mock("@/lib/actions/parent", () => ({ deactivateParentAccount: vi.fn(async () => ({ success: true, error: null })) }));
vi.mock("@/lib/actions/parent-account-settings", () => ({ updateParentAccountSettings: vi.fn(async () => ({ success: true, error: null })) }));
vi.mock("@/lib/actions/account-security", () => ({ requestPasswordChange: vi.fn(async () => ({ success: true, error: null })) }));

import { ParentSettingsClient } from "./ParentSettingsClient";

const PROFILE = {
  first_name: "Olivia",
  last_name: "Hartley",
  email: "olivia@example.test",
  mobile_number: "+447700900123",
  date_of_birth: "",
  suburb: "Clapham",
  postcode: "SW4",
  updated_at: "2027-02-15T10:00:00.123456+00:00",
};

const CHILD = {
  id: "c0000000-0000-4000-8000-000000000001",
  placement_id: null,
  nanny_user_id: "n0000000-0000-4000-8000-000000000001",
  parent_user_id: "p0000000-0000-4000-8000-000000000001",
  parent_lead_email: null,
  first_name: "Mia",
  date_of_birth: "2024-05-01",
  gender: null,
  age_months_approx: null,
  under_three: true,
  onboarded: true,
  status: "setup",
  orphaned_at: null,
  profile_picture_url: null,
  created_at: "2026-01-01T00:00:00+00:00",
  updated_at: "2026-01-01T00:00:00+00:00",
} as ChildClient;

const OLD_DIALOGS = ["Edit your full name", "Edit your date of birth", "Edit address", "Edit mobile number"];

function show(search: string, children: ChildClient[] = []) {
  h.search = search;
  return render(<ParentSettingsClient profile={PROFILE} managedChildren={children} />);
}

const digest = (html: string) => createHash("sha256").update(html).digest("hex");

beforeEach(() => {
  h.push.mockReset();
  h.refresh.mockReset();
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => [] })));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Profile and Contact details — edit mode, no pop-ups", () => {
  it.each([
    ["s=profile", "Profile"],
    ["s=contact", "Contact details"],
  ])("%s: no old pop-up is reachable from any button", async (search) => {
    show(search);
    for (const button of screen.getAllByRole("button")) {
      await act(async () => { fireEvent.click(button); });
      expect(screen.queryByRole("dialog")).toBeNull();
    }
    for (const title of OLD_DIALOGS) expect(screen.queryByText(title)).toBeNull();
  });

  it.each([
    ["s=profile", "Profile", "Edit profile"],
    ["s=contact", "Contact details", "Edit contact details"],
  ])("%s: one Edit for the page, beside its own title; the rows are not buttons", (search, title, edit) => {
    show(search);
    const headings = screen.getAllByRole("heading", { level: 2, name: title });
    const buttons = screen.getAllByRole("button");
    expect(buttons.length).toBeGreaterThan(0);
    expect(buttons.every((b) => b.getAttribute("aria-label") === edit)).toBe(true);
    expect(buttons).toHaveLength(headings.length);
  });

  it("with no ?s= the desktop still lands on \"Select a setting\" (no default leaf)", () => {
    show("");
    expect(screen.getByText("Select a setting from the sidebar.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit profile" })).toBeNull();
  });
});

describe("every other part of parent Settings is unchanged (markup pinned before the change)", () => {
  it("Security", () => {
    const { container } = show("s=security");
    expect(container.textContent).toMatchInlineSnapshot(`"AccountSettingsProfileAccountLinked childrenSubscriptionContact UsSettingsAccountSecuritySecurityPasswordSend a password reset link to your registered email.Send password reset email"`);
    expect(digest(container.innerHTML)).toMatchInlineSnapshot(`"8623d5c0c070829f0c16eb074e43c2d1b9da9f29338270514ed4bf6430f949de"`);
  });

  it("Linked children, with none and with one", () => {
    const none = show("s=linked-children");
    expect(none.container.textContent).toMatchInlineSnapshot(`"SettingsSettingsProfileAccountLinked childrenSubscriptionContact UsSettingsLinked childrenLinked childrenLinked childrenNo linked children yet."`);
    expect(digest(none.container.innerHTML)).toMatchInlineSnapshot(`"f0f8fe2ffc166124d63c7909abb48c50448c2bde145496e446de815493a092fe"`);
    cleanup();
    const one = show("s=linked-children", [CHILD]);
    expect(one.container.textContent).toMatchInlineSnapshot(`"SettingsSettingsProfileAccountLinked children1SubscriptionContact UsSettingsLinked childrenLinked children1Linked childrenMiaBorn 01/05/2024Remove nannyDelete child"`);
    expect(digest(one.container.innerHTML)).toMatchInlineSnapshot(`"de618584eeab1ca3cb3ae75946ce16d2761e0985a8a968c2b51e0532bc493fe8"`);
  });

  it("Subscription", () => {
    const { container } = show("s=subscription");
    expect(container.textContent).toMatchInlineSnapshot(`"SettingsSettingsProfileAccountLinked childrenSubscriptionContact UsSettingsSubscriptionSubscriptionSubscriptionManage your Baby Bloom subscription — view current plan, update payment method, cancel, or resubscribe.Open subscription"`);
    expect(digest(container.innerHTML)).toMatchInlineSnapshot(`"90e7b48f5988db5f463bdd7efa83559b24afa4929bdd3948af269c8dd4539a96"`);
  });

  it("Contact Us", () => {
    const { container } = show("s=contact-us");
    expect(container.textContent).toMatchInlineSnapshot(`"SettingsSettingsProfileAccountLinked childrenSubscriptionContact UsSettingsContact UsContact UsSubjectMessage0 / 4000Send message"`);
    expect(digest(container.innerHTML)).toMatchInlineSnapshot(`"ad7298e3b0ddb73305d557c63486716928b90e335a0e64087ce628bb4444682f"`);
  });

  it("Close account", () => {
    const { container } = show("s=close-account");
    expect(container.textContent).toMatchInlineSnapshot(`"SettingsSettingsProfileAccountLinked childrenSubscriptionContact UsSettingsClose accountClose accountClosing your account is permanentThis closes any active positions, cancels pending connections, and signs you out of every device. You will need to contact support to reactivate your account.Close my account"`);
    expect(digest(container.innerHTML)).toMatchInlineSnapshot(`"8ddd3dfa6d379778dabd2aeb83e19e939455c888e28eb99a56350fe84a780201"`);
  });

  it("the Account menu and the landing", () => {
    const account = show("s=account");
    expect(account.container.textContent).toMatchInlineSnapshot(`"SettingsSettingsProfileAccountLinked childrenSubscriptionContact UsSettingsAccountAccountContact detailsSecurityClose account"`);
    expect(digest(account.container.innerHTML)).toMatchInlineSnapshot(`"7ca0de284f97f8585aa0ca59aa0276172b847ecd7afe66c4da28b105edcbfafa"`);
    cleanup();
    const landing = show("");
    expect(landing.container.textContent).toMatchInlineSnapshot(`"SettingsOHOlivia Hartleyolivia@example.test · ParentProfileAccountLinked childrenSubscriptionContact UsSettingsProfileAccountLinked childrenSubscriptionContact UsOHOlivia Hartleyolivia@example.test · ParentSelect a setting from the sidebar.Your selection opens here."`);
    expect(digest(landing.container.innerHTML)).toMatchInlineSnapshot(`"f9cbf68aeb6c1e501d79eca3b0d9b67e9540496fc14a89ac90511a9493090ad5"`);
  });
});
