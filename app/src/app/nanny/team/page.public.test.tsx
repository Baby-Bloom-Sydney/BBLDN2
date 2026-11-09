/**
 * "Our Team" shows each nanny as the cards do — first name, last initial — and its page carries nothing only the
 * server may hold. BB-wave1-041126, 2026-11-09.
 */
import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { fakeAdmin } from "@/lib/payments/fake-admin.test-util";

const admin = fakeAdmin({
  nannies: [{ id: "n-1", user_id: "u-private-1", hourly_rate_min: 18, verification_tier: "tier3", verification_level: 4, languages: [], role_types_preferred: [], ai_content: null }],
  user_profiles: [{ user_id: "u-private-1", first_name: "Nina", last_name: "Walkerton", suburb: "Islington", profile_picture_url: "https://example.test/n.png", date_of_birth: "1993-03-03" }],
  nanny_credentials: [],
});
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => admin.client }));

import OurTeamPage from "./page";

describe("Our Team", () => {
  it("names her by first name and last initial; nothing only the server may hold", async () => {
    const { container } = render(await OurTeamPage());
    expect(container.innerHTML).toContain("Nina W");
    expect(container.innerHTML).not.toMatch(/Walkerton|u-private-1|1993-03-03/);
  });
});
