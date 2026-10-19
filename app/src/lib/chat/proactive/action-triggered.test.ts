import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { ProactiveTrigger } from "@/lib/chat/modules/types";

// vi.hoisted keeps state in scope of the (hoisted) vi.mock factories.
const state = vi.hoisted(() => ({
  findProactiveTrigger: vi.fn(),
  bot: null as Record<string, unknown> | null,
  insertCalls: [] as Array<{ table: string; row: Record<string, unknown> }>,
  insertResult: { data: { id: "msg-1" } as { id: string } | null },
  generateMock: vi.fn(),
}));

vi.mock("@/lib/chat/modules/registry", () => ({
  findProactiveTrigger: (...args: unknown[]) =>
    state.findProactiveTrigger(...args),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from(table: string) {
      return {
        select() {
          return {
            eq() {
              return {
                maybeSingle: async () => ({ data: state.bot }),
              };
            },
          };
        },
        insert(row: Record<string, unknown>) {
          state.insertCalls.push({ table, row });
          return {
            select() {
              return {
                single: async () => ({ data: state.insertResult.data }),
              };
            },
          };
        },
      };
    },
  }),
}));

vi.mock("@/lib/ai/gemini-client", () => ({
  generate: (...args: unknown[]) => state.generateMock(...args),
}));

vi.mock("@/lib/ai/model-selector", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/ai/model-selector")
  >("@/lib/ai/model-selector");
  return { ...actual, selectGeminiModel: () => "gemini-3-flash" };
});

// ─────────────────────────────────────────────────────────────────────────
// Import under test AFTER mocks are set up.
// ─────────────────────────────────────────────────────────────────────────
import {
  dispatchActionTriggered,
  dispatchActionTriggeredInBackground,
} from "./action-triggered";

function makeTrigger(
  overrides: Partial<ProactiveTrigger> = {},
): ProactiveTrigger {
  return {
    id: "test.trigger",
    description: "a trigger",
    mode: "template",
    template: "Hello {name}.",
    resolvePayload: async (event) => ({
      name: (event.payload.name as string) ?? "friend",
    }),
    ...overrides,
  };
}

function setBot(overrides: Record<string, unknown> = {}) {
  state.bot = {
    id: "bot-1",
    user_id: "u-1",
    role: "nanny",
    settings: {
      waking_hours: { start: "00:00", end: "23:59", timezone: "UTC" },
    },
    ...overrides,
  };
}

beforeEach(() => {
  // Pin Date only (timers stay real) so the default 00:00–23:59 waking
  // window never misses: at 23:59 wall-clock the strict `< end` check
  // returned skipped_waking and failed CI (run 39178632640).
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-06-01T12:00:00Z"));
  state.bot = null;
  state.insertCalls = [];
  state.insertResult = { data: { id: "msg-1" } };
  state.findProactiveTrigger.mockReset();
  state.generateMock.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("dispatchActionTriggered — gates", () => {
  it("skips silently when the user has no bot (never throws)", async () => {
    const r = await dispatchActionTriggered({
      triggerId: "test.trigger",
      recipientUserId: "u-no-bot",
    });
    expect(r).toEqual({ status: "skipped_no_bot" });
    expect(state.insertCalls).toHaveLength(0);
  });

  it("skips when the trigger isn't registered", async () => {
    setBot();
    state.findProactiveTrigger.mockReturnValue(null);
    const r = await dispatchActionTriggered({
      triggerId: "unknown.trigger",
      recipientUserId: "u-1",
    });
    expect(r).toEqual({ status: "skipped_unknown_trigger" });
  });

  it("skips outside waking hours — deterministic via fake timers", async () => {
    // Pin system time to 03:00 UTC, which is outside the 07:00–22:00
    // UTC window. Previous test relied on wall-clock time-of-day and
    // would produce different results in CI vs. local.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-01T03:00:00Z"));
    try {
      setBot({
        settings: {
          waking_hours: { start: "07:00", end: "22:00", timezone: "UTC" },
        },
      });
      state.findProactiveTrigger.mockReturnValue({
        trigger: makeTrigger(),
        module: {} as never,
      });
      const r = await dispatchActionTriggered({
        triggerId: "test.trigger",
        recipientUserId: "u-1",
      });
      expect(r).toEqual({ status: "skipped_waking" });
      expect(state.insertCalls).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("fires inside waking hours — deterministic via fake timers", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-01T12:00:00Z"));
    try {
      setBot({
        settings: {
          waking_hours: { start: "07:00", end: "22:00", timezone: "UTC" },
        },
      });
      state.findProactiveTrigger.mockReturnValue({
        trigger: makeTrigger(),
        module: {} as never,
      });
      const r = await dispatchActionTriggered({
        triggerId: "test.trigger",
        recipientUserId: "u-1",
      });
      expect(r.status).toBe("fired");
    } finally {
      vi.useRealTimers();
    }
  });

  it("respects the condition function — skips when false", async () => {
    setBot();
    state.findProactiveTrigger.mockReturnValue({
      trigger: makeTrigger({
        condition: async () => false,
      }),
      module: {} as never,
    });
    const r = await dispatchActionTriggered({
      triggerId: "test.trigger",
      recipientUserId: "u-1",
    });
    expect(r).toEqual({ status: "skipped_condition" });
    expect(state.insertCalls).toHaveLength(0);
  });
});

describe("dispatchActionTriggered — template mode", () => {
  it("renders template with resolved vars + persists chat_messages", async () => {
    setBot();
    state.findProactiveTrigger.mockReturnValue({
      trigger: makeTrigger({
        template: "Hey {name}, your {thing} is ready.",
        resolvePayload: async (event) => ({
          name: event.payload.name as string,
          thing: event.payload.thing as string,
        }),
      }),
      module: {} as never,
    });

    const r = await dispatchActionTriggered({
      triggerId: "test.trigger",
      recipientUserId: "u-1",
      payload: { name: "Katie", thing: "summary" },
    });

    expect(r).toEqual({ status: "fired", messageId: "msg-1" });
    expect(state.insertCalls).toHaveLength(1);
    const call = state.insertCalls[0];
    expect(call.table).toBe("chat_messages");
    expect(call.row.content).toBe("Hey Katie, your summary is ready.");
    expect(call.row.trigger_source).toBe("proactive");
    expect(call.row.proactive_trigger_id).toBe("test.trigger");
    expect(call.row.is_read).toBe(false);
  });

  it("errors cleanly when template is missing", async () => {
    setBot();
    state.findProactiveTrigger.mockReturnValue({
      trigger: makeTrigger({ mode: "template", template: undefined }),
      module: {} as never,
    });
    const r = await dispatchActionTriggered({
      triggerId: "test.trigger",
      recipientUserId: "u-1",
    });
    expect(r.status).toBe("error");
  });
});

describe("dispatchActionTriggered — ai-minimal mode", () => {
  it("calls Gemini + persists the response", async () => {
    setBot();
    state.generateMock.mockResolvedValue({ text: "Nice work today." });
    state.findProactiveTrigger.mockReturnValue({
      trigger: makeTrigger({
        mode: "ai-minimal",
        template: undefined,
        promptFragment: "Celebrate a small win briefly.",
      }),
      module: {} as never,
    });
    const r = await dispatchActionTriggered({
      triggerId: "test.trigger",
      recipientUserId: "u-1",
      payload: { name: "Oliver" },
    });
    expect(r).toEqual({ status: "fired", messageId: "msg-1" });
    expect(state.generateMock).toHaveBeenCalled();
    const call = state.insertCalls[0];
    expect(call.row.content).toBe("Nice work today.");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const meta = call.row.metadata as any;
    expect(meta.mode).toBe("ai-minimal");
  });

  it("fills in a placeholder if Gemini returns empty", async () => {
    setBot();
    state.generateMock.mockResolvedValue({ text: "   " });
    state.findProactiveTrigger.mockReturnValue({
      trigger: makeTrigger({ mode: "ai-minimal", template: undefined }),
      module: {} as never,
    });
    const r = await dispatchActionTriggered({
      triggerId: "test.trigger",
      recipientUserId: "u-1",
    });
    expect(r.status).toBe("fired");
    expect(state.insertCalls[0].row.content).toBe("…");
  });
});

describe("dispatchActionTriggered — ai-full fallback", () => {
  it("skips ai-full without a fallback template", async () => {
    setBot();
    state.findProactiveTrigger.mockReturnValue({
      trigger: makeTrigger({ mode: "ai-full", template: undefined }),
      module: {} as never,
    });
    const r = await dispatchActionTriggered({
      triggerId: "test.trigger",
      recipientUserId: "u-1",
    });
    expect(r).toEqual({ status: "skipped_ai_full" });
  });

  it("falls back to fallbackTemplate when ai-full + fallback provided", async () => {
    setBot();
    state.findProactiveTrigger.mockReturnValue({
      trigger: makeTrigger({
        mode: "ai-full",
        template: undefined,
        fallbackTemplate: "Quick note about {name}.",
        resolvePayload: async (event) => ({
          name: event.payload.name as string,
        }),
      }),
      module: {} as never,
    });
    const r = await dispatchActionTriggered({
      triggerId: "test.trigger",
      recipientUserId: "u-1",
      payload: { name: "Alex" },
    });
    expect(r).toEqual({ status: "fired", messageId: "msg-1" });
    expect(state.insertCalls[0].row.content).toBe("Quick note about Alex.");
  });
});

describe("dispatchActionTriggered — never propagates errors", () => {
  it("returns status:error instead of throwing when resolvePayload fails", async () => {
    setBot();
    state.findProactiveTrigger.mockReturnValue({
      trigger: makeTrigger({
        resolvePayload: async () => {
          throw new Error("boom");
        },
      }),
      module: {} as never,
    });
    const r = await dispatchActionTriggered({
      triggerId: "test.trigger",
      recipientUserId: "u-1",
    });
    expect(r.status).toBe("error");
    if (r.status === "error") expect(r.error).toContain("boom");
  });

  it("returns status:error instead of throwing when Gemini fails", async () => {
    setBot();
    state.generateMock.mockRejectedValue(new Error("rate limited"));
    state.findProactiveTrigger.mockReturnValue({
      trigger: makeTrigger({ mode: "ai-minimal", template: undefined }),
      module: {} as never,
    });
    const r = await dispatchActionTriggered({
      triggerId: "test.trigger",
      recipientUserId: "u-1",
    });
    expect(r.status).toBe("error");
  });
});

describe("dispatchActionTriggeredInBackground", () => {
  it("returns void synchronously and never throws even when inner fn would reject", async () => {
    setBot();
    state.findProactiveTrigger.mockReturnValue({
      trigger: makeTrigger({ mode: "template", template: undefined }),
      module: {} as never,
    });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      expect(() =>
        dispatchActionTriggeredInBackground({
          triggerId: "test.trigger",
          recipientUserId: "u-1",
        }),
      ).not.toThrow();
      // Poll until the internal promise chain completes and the warn
      // fires — `loadContext` + the trigger resolution takes several
      // microtasks, so a fixed number of Promise.resolve() flushes was
      // non-deterministic.
      await vi.waitFor(() => expect(warnSpy).toHaveBeenCalled());
      const warnArgs = warnSpy.mock.calls[0];
      expect(String(warnArgs[0])).toMatch(/proactive.*test\.trigger/);
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("stays silent on the happy path", async () => {
    setBot();
    state.findProactiveTrigger.mockReturnValue({
      trigger: makeTrigger(),
      module: {} as never,
    });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      dispatchActionTriggeredInBackground({
        triggerId: "test.trigger",
        recipientUserId: "u-1",
      });
      // Give the internal chain time to run — if it was going to warn,
      // it would have by now.
      await new Promise((r) => setTimeout(r, 20));
      expect(warnSpy).not.toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
    }
  });
});
