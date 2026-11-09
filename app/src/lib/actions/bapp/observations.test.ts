import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks (must be hoisted via vi.mock before the SUT imports them) ──

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(),
}));

// The caller is the child's parent or nanny (that check has its own tests: lib/bapp/child-member.test.ts).
vi.mock("@/lib/bapp/child-member", () => ({ isChildMember: async () => true, CHILD_NOT_FOUND: "Child not found" }));

vi.mock("@/lib/payments/access-gate", () => ({
  requireChildFamilyAccess: vi.fn(),
}));

vi.mock("@/lib/legal/require-media-consent", () => ({
  requireMediaConsentForImageWrite: vi.fn(),
}));

vi.mock("@/lib/bapp/progress-write", () => ({
  recalculateProgress: vi.fn().mockResolvedValue(undefined),
  writeHistorySnapshot: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./insights", () => ({
  generateTileInsight: vi.fn().mockResolvedValue(undefined),
  getChildContext: vi.fn().mockResolvedValue({}),
}));

vi.mock("@/lib/chat/proactive/action-triggered", () => ({
  dispatchActionTriggeredInBackground: vi.fn(),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

const notifySpy = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/email/feed-post-notification", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/email/feed-post-notification")
  >("@/lib/email/feed-post-notification");
  return {
    notifyParentOfFeedPost: (
      input: import("@/lib/email/feed-post-notification").NotifyParentOfFeedPostArgs,
    ) => notifySpy(input),
    FEED_POST_NOTIFICATION_EMAIL_TYPE: actual.FEED_POST_NOTIFICATION_EMAIL_TYPE,
  };
});

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireChildFamilyAccess } from "@/lib/payments/access-gate";
import { requireMediaConsentForImageWrite } from "@/lib/legal/require-media-consent";
import { logObservation } from "./observations";

const USER_ID = "nanny-uuid-aaaa";
const CHILD_ID = "child-uuid-cccc";

function makeAuthedClient(user: { id: string } | null = { id: USER_ID }) {
  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user }, error: null }),
    },
  } as unknown as ReturnType<typeof createClient>;
}

interface AdminMockOptions {
  insertResult?: { data: { id: string } | null; error: unknown };
  /** Override the child_client select chain for the focused-observation insight branch. */
  childRow?: { status?: string | null } | null;
}

function makeAdminClient(options: AdminMockOptions = {}) {
  const insertSingle = vi
    .fn()
    .mockResolvedValue(
      options.insertResult ?? { data: { id: "log-1" }, error: null },
    );
  const insertSelect = vi.fn().mockReturnValue({ single: insertSingle });
  const insert = vi.fn().mockReturnValue({ select: insertSelect });

  // For maybeActivateChild's child_client select
  const childSelectSingle = vi
    .fn()
    .mockResolvedValue({
      data: options.childRow ?? { status: "active_nanny" },
    });
  const childSelectEq = vi.fn().mockReturnValue({ single: childSelectSingle });
  const childSelect = vi.fn().mockReturnValue({ eq: childSelectEq });

  // Generic update / select chain
  const updateEq = vi.fn().mockResolvedValue({ error: null });
  const update = vi.fn().mockReturnValue({ eq: updateEq });

  const from = vi.fn((table: string) => {
    if (table === "bapp_logs") {
      return { insert };
    }
    // child_client / child_client_events / bapp_milestones default chain
    return {
      select: childSelect,
      update,
    };
  });

  return {
    client: { from } as unknown as ReturnType<typeof createAdminClient>,
    insert,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  notifySpy.mockResolvedValue(undefined);
  vi.mocked(createClient).mockReturnValue(makeAuthedClient());
  vi.mocked(requireChildFamilyAccess).mockResolvedValue({
    hasAccess: true,
  } as Awaited<ReturnType<typeof requireChildFamilyAccess>>);
  vi.mocked(requireMediaConsentForImageWrite).mockResolvedValue({ ok: true });
});

describe("logObservation — feed-post notification wire-up", () => {
  it("fires notifyParentOfFeedPost on successful insert with the expected args", async () => {
    const { client } = makeAdminClient();
    vi.mocked(createAdminClient).mockReturnValue(client);

    const result = await logObservation(CHILD_ID, {
      domain: "General",
      milestone_id: null,
      score: null,
      note: "Quick observation",
      image_url: null,
      title: "Note",
    });

    expect(result.success).toBe(true);
    expect(notifySpy).toHaveBeenCalledTimes(1);
    expect(notifySpy).toHaveBeenCalledWith({
      childId: CHILD_ID,
      authorId: USER_ID,
      logType: "observation",
      logContext: "adhoc",
    });
  });

  it("does NOT fire notifyParentOfFeedPost when the insert fails", async () => {
    const { client } = makeAdminClient({
      insertResult: {
        data: null,
        error: { message: "RLS denied", code: "42501" },
      },
    });
    vi.mocked(createAdminClient).mockReturnValue(client);

    const result = await logObservation(CHILD_ID, {
      domain: "General",
      milestone_id: null,
      score: null,
      note: "Failed insert",
      image_url: null,
      title: "Note",
    });

    expect(result.success).toBe(false);
    expect(notifySpy).not.toHaveBeenCalled();
  });

  it("does NOT fire notifyParentOfFeedPost when authentication fails (insert never runs)", async () => {
    vi.mocked(createClient).mockReturnValue(makeAuthedClient(null));

    const result = await logObservation(CHILD_ID, {
      domain: "General",
      milestone_id: null,
      score: null,
      note: null,
      image_url: null,
      title: "Note",
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe("Not authenticated");
    expect(notifySpy).not.toHaveBeenCalled();
  });

  it("does NOT fire notifyParentOfFeedPost when the paywall gate blocks", async () => {
    const { client } = makeAdminClient();
    vi.mocked(createAdminClient).mockReturnValue(client);
    vi.mocked(requireChildFamilyAccess).mockResolvedValue({
      hasAccess: false,
    } as Awaited<ReturnType<typeof requireChildFamilyAccess>>);

    const result = await logObservation(CHILD_ID, {
      domain: "General",
      milestone_id: null,
      score: null,
      note: null,
      image_url: null,
      title: "Note",
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe("subscription_required");
    expect(notifySpy).not.toHaveBeenCalled();
  });
});
