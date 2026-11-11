// @vitest-environment node
/**
 * Each lead action refuses a caller who isn't an admin before it reads or writes anything.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  gate: { userId: "", error: "Not authenticated" as string | null },
  adminClient: vi.fn(),
  email: vi.fn(),
}));

vi.mock("@/lib/admin/require-admin", () => ({ requireAdmin: async () => h.gate }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => {
    h.adminClient();
    throw new Error("admin client used");
  },
}));
vi.mock("@/lib/email/resend", () => ({ sendEmail: h.email }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import * as actions from "./actions";

const ID = "5e1c0000-0000-4000-8000-000000000001";
const AT = "2026-11-12T09:00:00.000Z";

const CALLS: Array<[string, () => Promise<{ success: boolean }>]> = [
  ["logContact", () => actions.logContact({ nanny_user_id: ID, method: "call", direction: "outbound" })],
  ["editLogEntry", () => actions.editLogEntry({ log_id: ID, note: "n" })],
  ["updateLeadStatus", () => actions.updateLeadStatus({ nanny_user_id: ID, status: "called" })],
  ["setNextAction", () => actions.setNextAction({ nanny_user_id: ID, next_action_at: AT })],
  ["pinNote", () => actions.pinNote({ nanny_user_id: ID, pinned_note: "n" })],
  ["updateContactsOffset", () => actions.updateContactsOffset({ nanny_user_id: ID, offset: 1 })],
  ["overrideResponded", () => actions.overrideResponded({ nanny_user_id: ID, value: true })],
  ["assignOperator", () => actions.assignOperator({ nanny_user_id: ID, operator: "x" })],
  ["upsertNotes", () => actions.upsertNotes({ nanny_user_id: ID, body: "n" })],
  ["bulkSnooze", () => actions.bulkSnooze({ nanny_user_ids: [ID], next_action_at: AT })],
  ["bulkMoveToDormant", () => actions.bulkMoveToDormant({ nanny_user_ids: [ID] })],
  ["fetchRecentLogs", () => actions.fetchRecentLogs({ nanny_user_id: ID })],
  ["updateNannyAvailability", () => actions.updateNannyAvailability({ nanny_user_id: ID, available_days: [], schedule: {} })],
];

beforeEach(() => {
  h.gate = { userId: "", error: "Not authenticated" };
  h.adminClient.mockClear();
  h.email.mockClear();
});

describe("lead actions refuse a caller who isn't an admin", () => {
  it("covers every exported action", () => {
    const exported = Object.entries(actions).filter(([, v]) => typeof v === "function").map(([k]) => k).sort();
    expect(CALLS.map(([n]) => n).sort()).toEqual(exported);
  });

  it.each(CALLS)("%s", async (_name, call) => {
    const res = await call();
    expect(res.success).toBe(false);
    expect(h.adminClient).not.toHaveBeenCalled();
    expect(h.email).not.toHaveBeenCalled();
  });
});
