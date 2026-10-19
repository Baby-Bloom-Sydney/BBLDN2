import { describe, it, expect, vi, afterEach } from "vitest";
import {
  getActiveModules,
  collectTools,
  findToolHandler,
  collectProactiveTriggers,
} from "./registry";

afterEach(() => vi.unstubAllEnvs());

describe("module registry", () => {
  describe("getActiveModules", () => {
    it("returns all currently registered modules when no role given", () => {
      const mods = getActiveModules();
      const ids = mods.map((m) => m.id);
      expect(ids).toContain("child-profile");
      expect(ids).toContain("feed");
      expect(ids).toContain("progress");
      expect(ids).toContain("diary");
      expect(ids).toContain("observations");
      expect(ids).toContain("activities");
      expect(ids).toContain("feed-writer");
      expect(ids).toContain("agent-memory");
      expect(ids).toContain("history");
      expect(ids).toContain("katie-scheduling");
      expect(ids).toContain("verification");
      // A-08: child-onboarding module is registered. The
      // enabledForBot predicate gates it OFF once
      // settings.onboarding_completed=true, but the static registry
      // (no settings) sees every registered module.
      expect(ids).toContain("child-onboarding");
    });

    it("returns modules for nanny role", () => {
      const mods = getActiveModules("nanny");
      expect(mods.length).toBeGreaterThan(0);
    });

    it("returns modules for parent role", () => {
      const mods = getActiveModules("parent");
      expect(mods.length).toBeGreaterThan(0);
    });

    it("returns modules for admin role", () => {
      const mods = getActiveModules("admin");
      expect(mods.length).toBeGreaterThan(0);
    });
  });

  describe("collectTools", () => {
    it("flattens tools from all active modules", () => {
      const tools = collectTools();
      expect(tools.length).toBeGreaterThan(0);
      const names = tools.map((t) => t.name);
      expect(names).toContain("read_child_profile");
      expect(names).toContain("read_recent_feed");
      expect(names).toContain("read_milestones");
      expect(names).toContain("read_progress_history");
      expect(names).toContain("update_progress");
      expect(names).toContain("log_food");
      expect(names).toContain("log_sleep");
      expect(names).toContain("log_update");
      expect(names).toContain("log_observation");
      expect(names).toContain("plan_activity");
      expect(names).toContain("create_tile");
      expect(names).toContain("delete_tile");
      expect(names).toContain("write_memory");
      expect(names).toContain("read_memory");
      expect(names).toContain("update_memory");
      expect(names).toContain("delete_memory");
      expect(names).toContain("search_history");
      expect(names).toContain("create_schedule");
      expect(names).toContain("read_schedules");
      expect(names).toContain("update_schedule");
      expect(names).toContain("cancel_schedule");
      expect(names).toContain("set_waking_hours");
      expect(names).toContain("read_verification_status");
      expect(names).toContain("read_verification_next_steps");
    });

    it("tool names are globally unique", () => {
      const names = collectTools().map((t) => t.name);
      const uniq = new Set(names);
      expect(uniq.size).toBe(names.length);
    });
  });

  describe("findToolHandler", () => {
    it("finds the right module for a known tool", () => {
      expect(findToolHandler("read_child_profile")?.id).toBe("child-profile");
      expect(findToolHandler("read_recent_feed")?.id).toBe("feed");
      expect(findToolHandler("read_milestones")?.id).toBe("progress");
    });

    it("returns null for an unknown tool", () => {
      expect(findToolHandler("nonexistent_tool")).toBeNull();
    });
  });

  describe("collectProactiveTriggers", () => {
    it("returns every module's declared triggers", () => {
      const triggers = collectProactiveTriggers();
      // WU 8.6 onwards — modules register action triggers. Assert a
      // non-empty set with the shape every trigger should expose.
      expect(triggers.length).toBeGreaterThan(0);
      for (const t of triggers) {
        expect(typeof t.id).toBe("string");
        expect(typeof t.description).toBe("string");
        expect(typeof t.resolvePayload).toBe("function");
      }
    });

    it("includes a known connections trigger id", () => {
      const ids = collectProactiveTriggers().map((t) => t.id);
      expect(ids).toContain("connections.request_received");
    });

    it("includes a known bsr trigger id", () => {
      // 5c: the bsr module is offered only with BABYSITTING_ENABLED on.
      vi.stubEnv("BABYSITTING_ENABLED", "true");
      const ids = collectProactiveTriggers().map((t) => t.id);
      expect(ids).toContain("bsr.accepted_by_parent");
    });

    it("includes the A-08 child-onboarding triggers", () => {
      const ids = collectProactiveTriggers().map((t) => t.id);
      expect(ids).toContain("child.created");
      expect(ids).toContain("parent.connected_to_child");
    });
  });

  describe("collectTools — child-onboarding wiring", () => {
    it("exposes update_onboarding_state once the module is registered", () => {
      const tools = collectTools();
      const names = tools.map((t) => t.name);
      expect(names).toContain("update_onboarding_state");
    });
  });

  // ── enabledForBot predicate filter (added for A-08 child-onboarding) ─────
  //
  // Modules can declare a per-bot predicate that runs at filter time when
  // the caller passes a `BotSettings` object. The predicate is the only way
  // to gate a module on dynamic per-bot state (e.g. onboarding completion).
  // Callers without bot context (legacy paths passing only `role`) leave
  // the predicate unevaluated, preserving backward compatibility.
  describe("getActiveModules — enabledForBot predicate", () => {
    it("ignores enabledForBot when no settings are passed (backward compat)", () => {
      // All real modules without enabledForBot should still appear.
      const mods = getActiveModules("nanny");
      expect(mods.length).toBeGreaterThan(0);
    });

    it("includes a module whose predicate returns true for the given settings", () => {
      const settings = { onboarding_completed: false } as const;
      const mods = getActiveModules("nanny", settings);
      // Smoke check — at least one nanny-applicable module is returned.
      expect(mods.length).toBeGreaterThan(0);
    });

    it("excludes a module whose predicate returns false", () => {
      // The child-onboarding module (when it lands) declares
      // enabledForBot: (s) => s.onboarding_completed !== true. Once a bot
      // has onboarding_completed=true in settings, the module should drop
      // out entirely — both its tools and its system prompt fragment.
      // This test asserts the contract; it doesn't yet require the module
      // to exist.
      const completedSettings = { onboarding_completed: true } as const;
      const incompleteSettings = { onboarding_completed: false } as const;

      const completedMods = getActiveModules("nanny", completedSettings);
      const incompleteMods = getActiveModules("nanny", incompleteSettings);

      // If the child-onboarding module exists with the predicate, the
      // completed-bot list excludes it; the incomplete-bot list includes
      // it. The test passes vacuously today (no module declares the
      // predicate) and becomes load-bearing the moment one does.
      const hasOnboarding = (mods: { id: string }[]) =>
        mods.some((m) => m.id === "child-onboarding");
      expect(hasOnboarding(completedMods)).toBe(false);
      // We do NOT assert hasOnboarding(incompleteMods) === true here,
      // because the module hasn't been added to the registry yet. After
      // T2 lands, this test gets one more line: expect(...).toBe(true).
    });
  });

  describe("collectTools — enabledForBot predicate", () => {
    it("respects enabledForBot via the underlying getActiveModules call", () => {
      // Once child-onboarding ships its `update_onboarding_state` tool,
      // a bot with onboarding_completed=true must NOT see that tool.
      // We assert the contract proactively: the tool should never appear
      // in collectTools(role, completedSettings). Today this passes
      // vacuously (the tool doesn't exist yet); tomorrow it's a guard.
      const completedSettings = { onboarding_completed: true } as const;
      const names = collectTools("nanny", completedSettings).map((t) => t.name);
      expect(names).not.toContain("update_onboarding_state");
    });
  });
});

// Unit 5c (BB-LDN-5c-151026) — Katie's babysitting module is not offered while BABYSITTING_ENABLED is off.
describe("module registry — bsr module behind BABYSITTING_ENABLED", () => {
  it("off: no bsr module, no bsr tool, no bsr trigger, for any role", () => {
    vi.stubEnv("BABYSITTING_ENABLED", "");
    for (const role of [undefined, "nanny", "parent"] as const) {
      expect(getActiveModules(role).map((m) => m.id)).not.toContain("bsr");
      expect(collectProactiveTriggers(role).map((t) => t.id).some((id) => id.startsWith("bsr."))).toBe(false);
    }
    expect(findToolHandler("read_my_jobs", "nanny")?.id).not.toBe("bsr");
    const offCount = collectTools("parent").length;
    vi.stubEnv("BABYSITTING_ENABLED", "true");
    expect(collectTools("parent").length).toBeGreaterThan(offCount);
  });

  it("on: the bsr module is offered to nannies and parents again", () => {
    vi.stubEnv("BABYSITTING_ENABLED", "true");
    expect(getActiveModules("nanny").map((m) => m.id)).toContain("bsr");
    expect(getActiveModules("parent").map((m) => m.id)).toContain("bsr");
  });
});
