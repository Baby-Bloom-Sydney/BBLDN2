// @vitest-environment node
/**
 * The assistant's placement tile gets the placement for its card: her name and age — no email, phone or date of
 * birth (the card shows none of them). BB-wave1-041126, 2026-11-09.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/chat/flags", () => ({ KATIE_ENABLED: true }));
vi.mock("next/headers", () => ({ cookies: () => ({ get: () => undefined }) }));
vi.mock("@supabase/ssr", () => ({ createServerClient: () => ({ auth: { getUser: async () => ({ data: { user: { id: "u-parent" } }, error: null }) } }) }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { role: "parent" }, error: null }) }) }) }) }),
}));
vi.mock("@/lib/actions/position-funnel", () => ({
  getParentPlacement: async () => ({
    data: { id: "pl-1", nannyId: "n-1", nannyName: "Nina Walkerton", nannySuburb: "Islington", nannyPhoto: null, nannyAge: 33, weeklyHours: 30, hourlyRate: 18, hiredAt: "2026-11-01", startDate: null, nannyEmail: "nina.private@example.test", nannyPhone: "+447700900999", totalExperienceYears: 6, nannyExperienceYears: 4, highestQualification: null, certifications: [], vaccinationStatus: false, nannyHourlyRate: 18 },
    error: null,
  }),
}));

import { GET } from "./route";

describe("/api/chat/placement/[id]", () => {
  it("returns the placement as its card shows it — no email, phone or date of birth", async () => {
    const res = await GET(new Request("http://localhost/api/chat/placement/pl-1"), { params: { id: "pl-1" } });
    const body = await res.json();
    expect(body.placement).toMatchObject({ nannyName: "Nina Walkerton", nannyAge: 33 });
    expect(JSON.stringify(body)).not.toMatch(/nina\.private|7700900999|nannyEmail|nannyPhone|DateOfBirth/);
  });
});
