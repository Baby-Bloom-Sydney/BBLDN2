/**
 * Placements as each side's screens show the other: the family gets the hired nanny's name and age, plus her contact
 * details for an active placement (the assistant's placement reply names her in full; the cards show first name and
 * initial); the nanny gets the family's contact details only for an active placement, never their date of birth.
 * BB-wave1-041126, 2026-11-09.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeAdmin, type FakeAdmin, type Op } from "@/lib/payments/fake-admin.test-util";

let admin: FakeAdmin;
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: () => ({}) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => admin.client }));
vi.mock("./parent", () => ({ getParentId: async () => "p-1" }));
vi.mock("./connection", () => ({ getNannyId: async () => ({ nannyId: "n-1", userId: "u-nanny" }), scheduleConnectionTime: vi.fn() }));
vi.mock("./connection-helpers", () => ({ createInboxMessage: vi.fn(), logConnectionEvent: vi.fn() }));
vi.mock("@/lib/email/resend", () => ({ sendEmail: vi.fn() }));
vi.mock("@/lib/email/helpers", () => ({ getUserEmailInfo: vi.fn() }));
vi.mock("@/lib/email/hire-emails", () => ({ sendHireConfirmationEmails: vi.fn() }));
vi.mock("@/lib/chat/proactive/action-triggered", () => ({ dispatchActionTriggeredInBackground: vi.fn() }));
vi.mock("@/lib/payments/dfy-access", () => ({ openDfyAccess: vi.fn() }));

import { getParentPlacement, getNannyPlacements } from "./position-funnel";

const NANNY_PROFILE = { first_name: "Nina", last_name: "Walkerton", suburb: "Islington", profile_picture_url: null, date_of_birth: "1993-03-03", email: "nina.private@example.test", mobile_number: "+447700900999" };
const PARENT_PROFILE = { user_id: "u-parent", first_name: "Pat", last_name: "Parkerton", suburb: "Hackney", profile_picture_url: null, date_of_birth: "1985-05-05", email: "pat.private@example.test", mobile_number: "+447700900888" };

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-09T12:00:00Z"));
});
afterEach(() => vi.useRealTimers());

describe("getParentPlacement — the hired nanny as the family's screens show her", () => {
  it("her full name, her age; her contact details for the active placement; never her date of birth", async () => {
    admin = fakeAdmin({
      nanny_placements: { id: "pl-1", nanny_id: "n-1", weekly_hours: 30, hourly_rate: 18, hired_at: "2026-11-01T00:00:00Z", start_date: "2026-11-03" },
      nannies: { user_id: "u-nanny", total_experience_years: 6, nanny_experience_years: 4, hourly_rate_min: 18 },
      user_profiles: NANNY_PROFILE,
      nanny_credentials: [],
    });
    const { data } = await getParentPlacement();
    expect(data).toMatchObject({ nannyName: "Nina Walkerton", nannyAge: 33, nannyEmail: "nina.private@example.test", nannyPhone: "+447700900999" });
    expect(data).not.toHaveProperty("nannyDateOfBirth");
    expect(JSON.stringify(data)).not.toMatch(/1993-03-03/);
  });
});

describe("getNannyPlacements — the family as the nanny's screens show them", () => {
  it("never their date of birth; their email and phone only on an active placement", async () => {
    admin = fakeAdmin({
      nanny_placements: [
        { id: "pl-1", parent_id: "p-1", position_id: null, weekly_hours: 30, hourly_rate: 18, hired_at: "2026-11-01T00:00:00Z", start_date: null, status: "active", end_notes: null },
        { id: "pl-2", parent_id: "p-1", position_id: null, weekly_hours: 20, hourly_rate: 17, hired_at: "2026-01-01T00:00:00Z", start_date: null, status: "ended", end_notes: null },
      ],
      parents: [{ id: "p-1", user_id: "u-parent" }],
      user_profiles: (op: Op) => (op.filters.some(([, col]) => col === "user_id") ? [PARENT_PROFILE] : []),
    });
    const { data } = await getNannyPlacements();
    const active = data.find((p) => p.id === "pl-1");
    const ended = data.find((p) => p.id === "pl-2");
    expect(active).toMatchObject({ parentEmail: "pat.private@example.test", parentPhone: "+447700900888" });
    expect(ended).toMatchObject({ parentEmail: null, parentPhone: null });
    expect(JSON.stringify(data)).not.toMatch(/1985-05-05|parentDateOfBirth/);
  });
});
