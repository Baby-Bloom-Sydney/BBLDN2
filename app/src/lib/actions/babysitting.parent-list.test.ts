/**
 * `getParentBabysittingRequests` gives the family each nanny as the screens show her: first name, the initial of her
 * last name, her age — never her date of birth or account id; her phone only once she is the accepted nanny.
 * BB-wave1-041126, 2026-11-09.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeAdmin, type FakeAdmin } from "@/lib/payments/fake-admin.test-util";

let admin: FakeAdmin;
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: () => ({}) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => admin.client }));
vi.mock("./parent", () => ({ getParentId: async () => "p-1" }));
vi.mock("./connection-helpers", () => ({ createInboxMessage: vi.fn(), getNannyPhone: vi.fn(async () => null) }));
vi.mock("@/lib/email/resend", () => ({ sendEmail: vi.fn(async () => ({ success: true })), sendBatchEmails: vi.fn(async () => ({ sent: 0, failed: 0 })) }));
vi.mock("@/lib/email/helpers", () => ({ getUserEmailInfo: vi.fn(async () => null) }));
vi.mock("@/lib/chat/proactive/action-triggered", () => ({ dispatchActionTriggeredInBackground: vi.fn() }));

import { getParentBabysittingRequests } from "./babysitting";

const FUTURE = "2026-11-20";
const BSR = { parent_id: "p-1", title: null, description: null, special_requirements: null, suburb: "Islington", postcode: "N1 1AA", address: null, hourly_rate: 18, accepted_at: null, nannies_notified_count: 1, created_at: "2026-11-09T10:00:00Z", expires_at: null, cancelled_by: null };

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-09T12:00:00Z"));
  vi.stubEnv("BABYSITTING_ENABLED", "true");
  admin = fakeAdmin({
    babysitting_requests: [
      { ...BSR, id: "b-1", status: "filled", accepted_nanny_id: "n-1", accepted_at: "2026-11-09T11:00:00Z" },
      { ...BSR, id: "b-2", status: "open", accepted_nanny_id: null },
    ],
    bsr_time_slots: [
      { id: "s-1", babysitting_request_id: "b-1", slot_date: FUTURE, start_time: "18:00", end_time: "21:00", is_selected: true },
      { id: "s-2", babysitting_request_id: "b-2", slot_date: FUTURE, start_time: "18:00", end_time: "21:00", is_selected: false },
    ],
    nannies: [{ id: "n-1", user_id: "u-private-1", total_experience_years: 6, hourly_rate_min: 18, verification_tier: "tier3", verification_level: 4, ai_content: null, languages: ["English"] }],
    user_profiles: [{ user_id: "u-private-1", first_name: "Nina", last_name: "Walkerton", suburb: "Islington", profile_picture_url: null, date_of_birth: "1993-03-03", email: "nina.private@example.test" }],
    verifications: [{ user_id: "u-private-1", phone_number: "07700900999" }],
    bsr_notifications: [{ nanny_id: "n-1", babysitting_request_id: "b-2", distance_km: 2, requested_at: "2026-11-09T11:30:00Z" }],
  });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("getParentBabysittingRequests — the nannies as the screens show them", () => {
  it("accepted and requesting nannies: age and last initial, never date of birth, full last name or account id", async () => {
    const { data } = await getParentBabysittingRequests();
    const accepted = data.find((r) => r.id === "b-1")?.acceptedNanny;
    const requesting = data.find((r) => r.id === "b-2")?.requestingNannies[0];
    expect(accepted).toMatchObject({ firstName: "Nina", lastName: "W", age: 33 });
    expect(requesting).toMatchObject({ firstName: "Nina", lastName: "W", age: 33 });
    expect(JSON.stringify(data)).not.toMatch(/1993-03-03|Walkerton|u-private-1|nina\.private|dateOfBirth/);
  });

  it("her phone only on the request she accepted", async () => {
    const { data } = await getParentBabysittingRequests();
    expect(data.find((r) => r.id === "b-1")?.acceptedNanny?.phone).toBe("07700900999");
    expect(JSON.stringify(data.find((r) => r.id === "b-2"))).not.toMatch(/7700900999/);
  });
});
