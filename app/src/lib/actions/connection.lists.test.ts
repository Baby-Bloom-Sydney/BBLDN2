/**
 * The connection lists give each side the other's name (the screens show first name and initial; the assistant finds
 * a connection by first or last name); the family's list carries no phone field (the intro popup has its own
 * reader). BB-wave1-041126, 2026-11-09.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeAdmin, type FakeAdmin, type Op } from "@/lib/payments/fake-admin.test-util";

let admin: FakeAdmin;
const h = vi.hoisted(() => ({ role: "parent" as "parent" | "nanny" }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => admin.client }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: () => ({
    auth: { getUser: async () => ({ data: { user: { id: h.role === "parent" ? "u-parent" : "u-nanny" } }, error: null }) },
    from: admin.client.from,
  }),
}));
vi.mock("./parent", () => ({ getParentId: async () => "p-1" }));
vi.mock("./connection-helpers", () => ({ createInboxMessage: vi.fn(), logConnectionEvent: vi.fn(), getNannyPhone: vi.fn(async () => null), getPositionSummary: vi.fn(async () => null) }));
vi.mock("@/lib/email/resend", () => ({ sendEmail: vi.fn() }));
vi.mock("@/lib/email/helpers", () => ({ getUserEmailInfo: vi.fn() }));
vi.mock("@/lib/chat/proactive/action-triggered", () => ({ dispatchActionTriggeredInBackground: vi.fn() }));

import { getParentConnectionRequests, getNannyConnectionRequests } from "./connection";

const REQUEST = { id: "c-1", nanny_id: "n-1", parent_id: "p-1", position_id: null, status: "confirmed", connection_stage: 20, source: "manual", nanny_phone_shared: "+447700900999", parent_phone_shared: null, expires_at: null, created_at: "2026-11-09T10:00:00Z", decline_reason: "Not free at weekends", internal_note: "x" };

beforeEach(() => {
  admin = fakeAdmin({
    connection_requests: [REQUEST],
    nannies: (op: Op) => (op.filters.some(([f, c]) => f === "eq" && c === "user_id") ? { id: "n-1" } : [{ id: "n-1", user_id: "u-nanny", hourly_rate_min: 18 }]),
    parents: [{ id: "p-1", user_id: "u-parent" }],
    user_profiles: [
      { user_id: "u-nanny", first_name: "Nina", last_name: "Walkerton", suburb: "Islington", profile_picture_url: null },
      { user_id: "u-parent", first_name: "Pat", last_name: "Parkerton", suburb: "Hackney", profile_picture_url: null },
    ],
  });
});

describe("connection lists", () => {
  it("the family's list: the nanny's first and last name, no phone field", async () => {
    h.role = "parent";
    const { data } = await getParentConnectionRequests();
    expect(data[0]?.nanny).toMatchObject({ first_name: "Nina", last_name: "Walkerton" });
    expect(data[0]).not.toHaveProperty("nanny_phone_shared");
    expect(JSON.stringify(data)).not.toMatch(/7700900999/);
  });

  it("the family's list carries only its own columns: no decline reason, no other column, no account id for the nanny", async () => {
    h.role = "parent";
    const { data } = await getParentConnectionRequests();
    expect(data[0]).not.toHaveProperty("decline_reason");
    expect(data[0]).not.toHaveProperty("internal_note");
    expect(data[0]).not.toHaveProperty("parent_phone_shared");
    expect(data[0]?.nanny).not.toHaveProperty("user_id");
    expect(JSON.stringify(data)).not.toMatch(/Not free at weekends|u-nanny/);
    expect(data[0]).toMatchObject({ id: "c-1", status: "confirmed", connection_stage: 20, source: "manual", created_at: "2026-11-09T10:00:00Z" });
  });

  it("the nanny's list: the family's first and last name", async () => {
    h.role = "nanny";
    const { data } = await getNannyConnectionRequests();
    expect(data[0]?.parent).toMatchObject({ first_name: "Pat", last_name: "Parkerton" });
  });
});
