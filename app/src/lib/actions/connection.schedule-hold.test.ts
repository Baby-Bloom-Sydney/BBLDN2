/**
 * `scheduleConnectionTime` books an intro only for a connection the nanny has accepted (stage 10, status "accepted"):
 * the read checks both, the update's WHERE carries both, and a row that is no longer there to update books nothing.
 * BB-wave1-041126, 2026-11-09.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeAdmin, type FakeAdmin } from "@/lib/payments/fake-admin.test-util";

let admin: FakeAdmin;
const h = vi.hoisted(() => ({ getNannyPhone: vi.fn(), logConnectionEvent: vi.fn(), createInboxMessage: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: () => ({}) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => admin.client }));
vi.mock("./parent", () => ({ getParentId: async () => "p-1" }));
vi.mock("./connection-helpers", () => ({
  getNannyPhone: h.getNannyPhone, logConnectionEvent: h.logConnectionEvent, createInboxMessage: h.createInboxMessage,
  getPositionSummary: vi.fn(async () => null),
}));
vi.mock("@/lib/email/resend", () => ({ sendEmail: vi.fn(async () => ({ success: true })) }));
vi.mock("@/lib/email/helpers", () => ({ getUserEmailInfo: vi.fn(async () => null) }));
vi.mock("@/lib/chat/proactive/action-triggered", () => ({ dispatchActionTriggeredInBackground: vi.fn() }));

import { scheduleConnectionTime } from "./connection";

const NOT_READY = "This connection is not ready to be scheduled.";
const row = (stage: number) => ({ id: "c-1", parent_id: "p-1", nanny_id: "n-1", status: "accepted", connection_stage: stage, proposed_times: ["2026-11-12_morning"] });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-09T12:00:00Z"));
  h.getNannyPhone.mockReset().mockResolvedValue("+447700900999");
  h.logConnectionEvent.mockReset();
  h.createInboxMessage.mockReset();
  admin = fakeAdmin({ connection_requests: row(10), nannies: { user_id: "u-nanny" }, parents: { user_id: "u-parent" } });
  admin.writeResults.connection_requests = [{ id: "c-1" }];
});
afterEach(() => vi.useRealTimers());

const updates = () => admin.ops.filter((op) => op.table === "connection_requests" && op.kind === "update");

describe("scheduleConnectionTime — only an accepted connection (stage 10) is booked", () => {
  it("books an accepted connection: the update's WHERE carries the status and the stage", async () => {
    expect(await scheduleConnectionTime("c-1", "2026-11-12", 9, 0)).toEqual({ success: true, error: null });
    const [update] = updates();
    expect(update?.filters).toEqual(expect.arrayContaining([["eq", "status", "accepted"], ["eq", "connection_stage", 10]]));
    expect(update?.payload).toMatchObject({ connection_stage: 20, nanny_phone_shared: "+447700900999" });
  });

  it.each([[9], [4], [0], [20]])("refuses a connection at stage %i: nothing written, no phone read", async (stage) => {
    admin.reads.connection_requests = row(stage);
    expect(await scheduleConnectionTime("c-1", "2026-11-12", 9, 0)).toEqual({ success: false, error: NOT_READY });
    expect(updates()).toHaveLength(0);
    expect(h.getNannyPhone).not.toHaveBeenCalled();
  });

  it("books nothing when the row no longer matches at the update (no row back)", async () => {
    admin.writeResults.connection_requests = [];
    expect(await scheduleConnectionTime("c-1", "2026-11-12", 9, 0)).toEqual({ success: false, error: NOT_READY });
    expect(h.logConnectionEvent).not.toHaveBeenCalled();
    expect(h.createInboxMessage).not.toHaveBeenCalled();
  });
});
