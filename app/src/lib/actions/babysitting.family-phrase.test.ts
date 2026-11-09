/**
 * When a family books or passes on a nanny for a babysitting request, her assistant's message names the family as
 * "The {Last} family" when their last name is known, else the plain phrase ("A family" / "That family").
 * BB-wave1-041126, 2026-11-09.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeAdmin, type FakeAdmin } from "@/lib/payments/fake-admin.test-util";

let admin: FakeAdmin;
const h = vi.hoisted(() => ({ dispatch: vi.fn(), parentLastName: "Chen" as string | null }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: () => ({}) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => admin.client }));
vi.mock("./parent", () => ({ getParentId: async () => "p-1" }));
vi.mock("./connection-helpers", () => ({ createInboxMessage: vi.fn(), getNannyPhone: vi.fn(async () => null) }));
vi.mock("@/lib/email/resend", () => ({ sendEmail: vi.fn(async () => ({ success: true })), sendBatchEmails: vi.fn(async () => ({ sent: 0, failed: 0 })) }));
vi.mock("@/lib/email/helpers", () => ({
  getUserEmailInfo: vi.fn(async (userId: string) =>
    userId === "u-parent" ? { email: "family@example.test", firstName: "Pat", lastName: h.parentLastName } : null),
}));
vi.mock("@/lib/chat/proactive/action-triggered", () => ({ dispatchActionTriggeredInBackground: h.dispatch }));

import { parentAcceptNanny, parentDeclineNanny } from "./babysitting";

beforeEach(() => {
  vi.stubEnv("BABYSITTING_ENABLED", "true");
  h.dispatch.mockClear();
  h.parentLastName = "Chen";
  admin = fakeAdmin({
    babysitting_requests: { id: "b-1", parent_id: "p-1", suburb: "Islington", address: null, special_requirements: null, hourly_rate: 18, children: [] },
    bsr_notifications: { id: "bn-1", distance_km: 2 },
    nannies: { user_id: "u-nanny" },
    bsr_time_slots: [],
    parents: { user_id: "u-parent" },
  });
  admin.writeResults.babysitting_requests = { id: "b-1" };
});
afterEach(() => vi.unstubAllEnvs());

function phraseOf(triggerId: string): unknown {
  const call = h.dispatch.mock.calls.find(([arg]) => (arg as { triggerId: string }).triggerId === triggerId);
  return (call?.[0] as { payload: { family_phrase: string } } | undefined)?.payload.family_phrase;
}

describe("the babysitting messages to the nanny's assistant name the family", () => {
  it("booked: 'The Chen family'", async () => {
    expect(await parentAcceptNanny("b-1", "n-1")).toMatchObject({ success: true });
    expect(phraseOf("bsr.accepted_by_parent")).toBe("The Chen family");
  });

  it("booked, no last name on file: 'A family'", async () => {
    h.parentLastName = null;
    await parentAcceptNanny("b-1", "n-1");
    expect(phraseOf("bsr.accepted_by_parent")).toBe("A family");
  });

  it("passed on: 'The Chen family'", async () => {
    expect(await parentDeclineNanny("b-1", "n-1")).toMatchObject({ success: true });
    expect(phraseOf("bsr.declined_by_parent")).toBe("The Chen family");
  });

  it("passed on, the family's details unreadable: 'That family'", async () => {
    const helpers = await import("@/lib/email/helpers");
    vi.mocked(helpers.getUserEmailInfo).mockRejectedValueOnce(new Error("read failed"));
    expect(await parentDeclineNanny("b-1", "n-1")).toMatchObject({ success: true });
    expect(phraseOf("bsr.declined_by_parent")).toBe("That family");
  });

  it("passed on, no last name on file: 'That family'", async () => {
    h.parentLastName = null;
    await parentDeclineNanny("b-1", "n-1");
    expect(phraseOf("bsr.declined_by_parent")).toBe("That family");
  });
});
