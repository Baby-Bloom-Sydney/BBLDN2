/**
 * `getDfyConnections` gives the position's parent each matched nanny as the cards show her: her age, never her date
 * of birth or account id. BB-wave1-041126, 2026-11-09.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeAdmin, type FakeAdmin } from "@/lib/payments/fake-admin.test-util";

let admin: FakeAdmin;
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: () => ({}) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => admin.client }));
vi.mock("./parent", () => ({ getParentId: async () => "p-1", getPosition: async () => ({ data: null, error: null }) }));

import { getDfyConnections } from "./matching";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-09T12:00:00Z"));
  admin = fakeAdmin({
    nanny_positions: { id: "pos-1" },
    connection_requests: [{ id: "c-1", nanny_id: "n-1", connection_stage: 10, proposed_times: [], confirmed_time: null, position_id: "pos-1" }],
    dfy_match_notifications: [{ id: "dn-1", nanny_id: "n-1", match_score: 82, distance_km: 2, metadata: {} }],
    nannies: [{ id: "n-1", user_id: "u-private-1", hourly_rate_min: 18, total_experience_years: 6, ai_content: null }],
    user_profiles: [{ user_id: "u-private-1", first_name: "Nina", last_name: "Walkerton", suburb: "Islington", profile_picture_url: null, date_of_birth: "1993-03-03", email: "nina.private@example.test", mobile_number: "+447700900999" }],
    nanny_availability: [],
  });
});
afterEach(() => vi.useRealTimers());

describe("getDfyConnections — the matched nanny as the cards show her", () => {
  it("gives her age, never her date of birth, account id, email or mobile", async () => {
    const { data } = await getDfyConnections("pos-1");
    expect(data?.[0]?.nanny).toMatchObject({ firstName: "Nina", age: 33 });
    expect(data?.[0]?.nanny).not.toHaveProperty("dateOfBirth");
    expect(JSON.stringify(data)).not.toMatch(/1993-03-03|u-private-1|nina\.private|7700900999/);
  });

  it("gives the initial of her last name (the cards show first name and initial)", async () => {
    const { data } = await getDfyConnections("pos-1");
    expect(data?.[0]?.nanny.lastName).toBe("W");
    expect(JSON.stringify(data)).not.toMatch(/Walkerton/);
  });

  it("leaves out the rows the family never sees (a held DFY accept, a held application)", async () => {
    admin.reads.connection_requests = [
      { id: "c-held", nanny_id: "n-1", connection_stage: 9, proposed_times: [], confirmed_time: null, position_id: "pos-1" },
      { id: "c-applied", nanny_id: "n-1", connection_stage: 4, proposed_times: [], confirmed_time: null, position_id: "pos-1" },
      { id: "c-1", nanny_id: "n-1", connection_stage: 10, proposed_times: [], confirmed_time: null, position_id: "pos-1" },
    ];
    const { data } = await getDfyConnections("pos-1");
    expect(data?.map((c) => c.connectionId)).toEqual(["c-1"]);
  });
});
