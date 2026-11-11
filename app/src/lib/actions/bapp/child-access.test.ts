/**
 * The child-scoped development actions answer only the child's parent or nanny: anyone else gets "Child not found"
 * and nothing past the child lookup is read or written.
 *
 * BB-wave1-041126, 2026-11-09.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeAdmin, type FakeAdmin, type Op } from "@/lib/payments/fake-admin.test-util";

let admin: FakeAdmin;
const h = vi.hoisted(() => ({ userId: "u-nanny" }));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: () => ({ auth: { getUser: async () => ({ data: { user: { id: h.userId } }, error: null }) } }),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => admin.client }));
vi.mock("@/lib/payments/access-gate", () => ({ requireChildFamilyAccess: async () => ({ hasAccess: true }) }));
vi.mock("@/lib/legal/require-media-consent", () => ({ requireMediaConsentForImageWrite: async () => ({ ok: true }) }));
vi.mock("@/lib/email/feed-post-notification", () => ({ notifyParentOfFeedPost: async () => undefined }));
vi.mock("@/lib/chat/proactive/action-triggered", () => ({ dispatchActionTriggeredInBackground: () => undefined }));
vi.mock("@/lib/ai/client", () => ({
  openai: { chat: { completions: { create: async () => ({ choices: [{ message: { content: "{}" } }] }) } } },
}));

import { getActivities } from "./activities-feed";
import { getFeed } from "./feed";
import { logObservation, logBulkProgress } from "./observations";
import { getProgressMatrix, getDashboardData } from "./progress";
import { submitReport } from "./reports";
import { generateActivity } from "./activities";
import { logDiaryEntry } from "./diary";
import { getLibraryImages } from "./library";

const CHILD_ID = "c-1";
const ACTIVITY_ID = "log-activity";
const RATINGS = [{ id: "m-1", score: 2 }];

const CALLS: Array<[string, () => Promise<{ success: boolean; error: string | null }>]> = [
  ["getActivities", () => getActivities(CHILD_ID, null, 20)],
  ["getFeed", () => getFeed(CHILD_ID)],
  ["logObservation", () => logObservation(CHILD_ID, { domain: "General", milestone_id: null, score: null, note: "n", image_url: null, title: "t" })],
  ["logBulkProgress", () => logBulkProgress(CHILD_ID, RATINGS, null, null)],
  ["getProgressMatrix", () => getProgressMatrix(CHILD_ID)],
  ["getDashboardData", () => getDashboardData(CHILD_ID)],
  ["submitReport", () => submitReport(ACTIVITY_ID, CHILD_ID, RATINGS, null, null)],
  ["generateActivity", () => generateActivity(CHILD_ID, ["m-1"])],
  ["logDiaryEntry", () => logDiaryEntry(CHILD_ID, { kind: "nap" })],
  ["getLibraryImages", () => getLibraryImages(CHILD_ID, null, 12)],
];

const pastChildLookup = (ops: Op[]) => ops.filter((o) => o.table !== "child_client");

beforeEach(() => {
  h.userId = "u-nanny";
  admin = fakeAdmin({
    child_client: { id: CHILD_ID, parent_user_id: "u-parent", nanny_user_id: "u-nanny", status: "active_nanny", first_name: "Ada" },
    bapp_logs: (op: Op) =>
      op.filters.some(([, col, val]) => col === "id" && val === ACTIVITY_ID) ? { id: ACTIVITY_ID, child_client_id: CHILD_ID } : null,
  });
  admin.writeResults.bapp_logs = { id: "log-new" };
});

describe("child-scoped development actions — someone not linked to the child", () => {
  it.each(CALLS)("%s → Child not found, nothing past the child lookup", async (_name, call) => {
    h.userId = "u-other";
    const result = await call();
    expect(result).toMatchObject({ success: false, error: "Child not found" });
    expect(pastChildLookup(admin.ops)).toEqual([]);
  });
});

describe("child-scoped development actions — the child's parent or nanny", () => {
  it.each(CALLS)("%s → goes ahead for the nanny", async (_name, call) => {
    await call();
    expect(pastChildLookup(admin.ops).length).toBeGreaterThan(0);
  });

  it.each(CALLS)("%s → goes ahead for the parent", async (_name, call) => {
    h.userId = "u-parent";
    await call();
    expect(pastChildLookup(admin.ops).length).toBeGreaterThan(0);
  });
});

describe("submitReport — the activity is this child's", () => {
  it("refuses an activity of another child, writing nothing", async () => {
    admin.reads.bapp_logs = { id: ACTIVITY_ID, child_client_id: "c-2" };
    const result = await submitReport(ACTIVITY_ID, CHILD_ID, RATINGS, null, null);
    expect(result).toEqual({ success: false, error: "Activity not found" });
    expect(admin.ops.filter((o) => o.kind !== "select")).toEqual([]);
  });

  it("writes the report for an activity of this child", async () => {
    await submitReport(ACTIVITY_ID, CHILD_ID, RATINGS, null, null);
    const inserts = admin.ops.filter((o) => o.table === "bapp_logs" && o.kind === "insert");
    expect(inserts[0]?.payload).toMatchObject({ child_client_id: CHILD_ID, parent_log_id: ACTIVITY_ID, type: "report" });
  });
});
