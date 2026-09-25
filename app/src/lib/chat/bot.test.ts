/**
 * Integration test for getOrCreateBot's default-schedule seeding.
 *
 * The seed module itself is covered by seed-defaults.test.ts. Here we
 * verify the wiring: on fresh create, seedDefaultSchedules runs with
 * the new bot id + the user's children + the bot's timezone. On a
 * repeat call (row already exists), seeding is skipped entirely.
 *
 * We mock at the Supabase admin layer so getUserChildren runs for real
 * against stubbed DB responses — mocking same-module exports via vi.mock
 * doesn't intercept intra-module function references.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { APP_TZ } from "@/lib/constants";

const state = vi.hoisted(() => ({
  existingBot: null as Record<string, unknown> | null,
  createdBot: {
    id: "bot-new",
    user_id: "user-1",
    role: "nanny",
    settings: {
      waking_hours: {
        start: "07:00",
        end: "22:00",
        timezone: "America/New_York",
      },
    },
    is_active: true,
    created_at: "2026-04-24T10:00:00Z",
  } as Record<string, unknown>,
  directChildren: [] as Array<{
    id: string;
    first_name: string;
    gender: string | null;
    date_of_birth: string | null;
  }>,
  placements: [] as unknown[],
  insertBloombotCalled: 0,
  insertChatMessagesCalled: 0,
  seedDefaultSchedulesCalls: [] as Array<{
    botId: string;
    childCount: number;
    tz: string;
  }>,
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from(table: string) {
      if (table === "bloombot") {
        return {
          select() {
            return {
              eq() {
                return {
                  maybeSingle: async () => ({
                    data: state.existingBot,
                    error: null,
                  }),
                };
              },
            };
          },
          insert(_row: Record<string, unknown>) {
            state.insertBloombotCalled += 1;
            return {
              select() {
                return {
                  single: async () => ({
                    data: state.createdBot,
                    error: null,
                  }),
                };
              },
            };
          },
        };
      }
      if (table === "chat_messages") {
        return {
          insert: async () => {
            state.insertChatMessagesCalled += 1;
            return { data: null, error: null };
          },
        };
      }
      if (table === "child_client") {
        // getUserChildren: .eq("nanny_user_id", userId).eq("under_three", true)
        return {
          select() {
            return {
              eq() {
                return {
                  eq: async () => ({
                    data: state.directChildren,
                    error: null,
                  }),
                };
              },
            };
          },
        };
      }
      if (table === "nanny_placements") {
        // getUserChildren: .eq("status", "active") — single eq chain
        return {
          select() {
            return {
              eq: async () => ({ data: state.placements, error: null }),
            };
          },
        };
      }
      return {
        select: () => ({ eq: () => ({ eq: async () => ({ data: [] }) }) }),
      };
    },
  }),
}));

const seedBehaviour = vi.hoisted(() => ({
  shouldThrow: false,
}));

vi.mock("@/lib/chat/proactive/seed-defaults", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/chat/proactive/seed-defaults")
  >("@/lib/chat/proactive/seed-defaults");
  return {
    ...actual,
    seedDefaultSchedules: async (
      _admin: unknown,
      botId: string,
      children: Array<{ id: string }>,
      tz: string,
    ) => {
      state.seedDefaultSchedulesCalls.push({
        botId,
        childCount: children.length,
        tz,
      });
      if (seedBehaviour.shouldThrow) {
        throw new Error("seed blew up");
      }
      return children.length;
    },
  };
});

// Import after mocks.
import { getOrCreateBot } from "@/lib/chat/bot";

describe("getOrCreateBot — default schedule seeding", () => {
  beforeEach(() => {
    state.existingBot = null;
    state.insertBloombotCalled = 0;
    state.insertChatMessagesCalled = 0;
    state.seedDefaultSchedulesCalls = [];
    state.directChildren = [];
    state.placements = [];
    seedBehaviour.shouldThrow = false;
    state.createdBot = {
      id: "bot-new",
      user_id: "user-1",
      role: "nanny",
      settings: {
        waking_hours: {
          start: "07:00",
          end: "22:00",
          timezone: "America/New_York",
        },
      },
      is_active: true,
      created_at: "2026-04-24T10:00:00Z",
    };
  });

  it("seeds default schedules on fresh create with the bot's timezone + children", async () => {
    state.directChildren = [
      {
        id: "c-1",
        first_name: "Oliver",
        gender: null,
        date_of_birth: "2024-10-01",
      },
      {
        id: "c-2",
        first_name: "Amara",
        gender: null,
        date_of_birth: "2024-06-01",
      },
    ];

    const bot = await getOrCreateBot("user-1", "nanny");
    expect(bot.id).toBe("bot-new");
    expect(state.insertBloombotCalled).toBe(1);
    expect(state.seedDefaultSchedulesCalls).toHaveLength(1);
    const call = state.seedDefaultSchedulesCalls[0];
    expect(call.botId).toBe("bot-new");
    expect(call.childCount).toBe(2);
    expect(call.tz).toBe("America/New_York");
  });

  it("falls back to the configured app timezone when settings.waking_hours is missing", async () => {
    state.createdBot = {
      ...state.createdBot,
      settings: {},
    };
    state.directChildren = [
      {
        id: "c-1",
        first_name: "Oliver",
        gender: null,
        date_of_birth: "2024-10-01",
      },
    ];

    await getOrCreateBot("user-1", "nanny");
    expect(state.seedDefaultSchedulesCalls[0].tz).toBe(APP_TZ);
  });

  it("seeds with empty children array when user has no child access", async () => {
    // No directChildren, no placements — getUserChildren returns []
    await getOrCreateBot("user-1", "nanny");
    expect(state.seedDefaultSchedulesCalls).toHaveLength(1);
    expect(state.seedDefaultSchedulesCalls[0].childCount).toBe(0);
  });

  it("does not seed when returning an existing bot row", async () => {
    state.existingBot = {
      id: "bot-existing",
      user_id: "user-1",
      role: "nanny",
      settings: {},
      is_active: true,
      created_at: "2026-04-20T10:00:00Z",
    };

    const bot = await getOrCreateBot("user-1", "nanny");
    expect(bot.id).toBe("bot-existing");
    expect(state.insertBloombotCalled).toBe(0);
    expect(state.seedDefaultSchedulesCalls).toHaveLength(0);
  });

  it("returns the new bot even if seedDefaultSchedules throws", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    seedBehaviour.shouldThrow = true;
    state.directChildren = [
      {
        id: "c-1",
        first_name: "Oliver",
        gender: null,
        date_of_birth: "2024-10-01",
      },
    ];

    const bot = await getOrCreateBot("user-1", "nanny");
    expect(bot.id).toBe("bot-new");
    expect(state.seedDefaultSchedulesCalls).toHaveLength(1);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});
