import { describe, it, expect } from "vitest";
import { APP_TZ } from "@/lib/constants";
import {
  childOnboardingModule,
  renderOnboardingStateBlock,
} from "./child-onboarding";
import type { ModuleContext } from "./types";
import type { BotSettings, OnboardingState } from "@/types/bapp";
import type { SupabaseClient } from "@supabase/supabase-js";

/** Minimal ModuleContext for tests where the handler shouldn't reach
 *  any of the context's fields. The supabase client is a stub — if a
 *  test inadvertently hits it the call will throw on the missing
 *  method, surfacing the leak loudly. */
function fakeCtx(): ModuleContext {
  return {
    botId: "test-bot",
    userId: "test-user",
    userRole: "nanny",
    effectiveRole: "nanny",
    children: [],
    currentSurface: null,
    supabase: {} as SupabaseClient,
  };
}

describe("child-onboarding module — skeleton (Unit 2)", () => {
  describe("module identity + shape", () => {
    it("uses the canonical id 'child-onboarding' (not 'onboarding')", () => {
      // The existing parent-position-coach module owns id 'onboarding'.
      // Collision would silently shadow one of them in the registry
      // because the byModuleId map keys on id. Asserting here so a
      // future refactor can't accidentally rename to the colliding id.
      expect(childOnboardingModule.id).toBe("child-onboarding");
    });

    it("declares a human-readable name + description", () => {
      expect(childOnboardingModule.name.length).toBeGreaterThan(0);
      // BloomBotModule.description is required (non-optional in the
      // interface) — read directly without a nullish guard so the
      // assertion fails loudly if the field is ever mistakenly removed.
      expect(childOnboardingModule.description.length).toBeGreaterThan(0);
    });

    it("is allowed for both nannies and parents", () => {
      expect(childOnboardingModule.rolesAllowed).toContain("nanny");
      expect(childOnboardingModule.rolesAllowed).toContain("parent");
    });

    it("exposes the update_onboarding_state tool (T4)", () => {
      const toolNames = childOnboardingModule.tools.map((t) => t.name);
      expect(toolNames).toContain("update_onboarding_state");
    });

    it("declares the child.created proactive trigger (T5)", () => {
      const ids = (childOnboardingModule.proactiveTriggers ?? []).map(
        (t) => t.id,
      );
      expect(ids).toContain("child.created");
    });

    it("update_onboarding_state declares the canonical topic enum + status enum", () => {
      const tool = childOnboardingModule.tools.find(
        (t) => t.name === "update_onboarding_state",
      );
      expect(tool).toBeDefined();
      const params = tool!.parameters as {
        properties: { topic: { enum: string[] }; status: { enum: string[] } };
      };
      expect(params.properties.topic.enum).toEqual([
        "welcome",
        "schedule",
        "routine",
        "dev_snapshot",
        "first_post",
        "activity",
        "child_photo",
        "wrap",
      ]);
      expect(params.properties.status.enum).toEqual([
        "pending",
        "captured",
        "skipped",
        "deferred",
      ]);
    });
  });

  // ── T3: prompt fragment + runtime state block ──────────────────────────
  describe("systemPromptFragment content", () => {
    // Pulled to the describe scope so each test reads from a single
    // narrowed reference instead of casting `as string` per assertion.
    const fragment = childOnboardingModule.systemPromptFragment;

    it("is a non-empty string", () => {
      expect(typeof fragment).toBe("string");
      expect(typeof fragment === "string" && fragment.length > 0).toBe(true);
    });

    it("instructs Katie never to mention 'bath time' (Bailey constraint)", () => {
      if (typeof fragment !== "string") throw new Error("fragment missing");
      // Locate the bath line + assert it carries a NEGATIVE directive.
      const bathLine = fragment.split("\n").find((l) => /bath time/i.test(l));
      expect(bathLine).toBeDefined();
      expect(bathLine).toMatch(/never|do not|don't/i);
    });

    it("includes the explicit directive that the topic id is internal-only (PRINCIPLES §8)", () => {
      if (typeof fragment !== "string") throw new Error("fragment missing");
      // The id `dev_snapshot` legitimately appears in two contexts:
      //   (a) markdown-bold topic headings (`**dev_snapshot** — ...`)
      //       where the id is being labelled, not spoken
      //   (b) tool-call arguments (`update_onboarding_state(topic='dev_snapshot', ...)`)
      // Both are fine — Katie reads them, doesn't echo them. The
      // constitutional requirement is that the fragment contain an
      // explicit directive telling Katie not to say the id to the
      // user. Assert the directive's presence rather than over-
      // policing the heading format.
      const directiveLine = fragment
        .split("\n")
        .find(
          (l) =>
            /dev_snapshot|topic id/i.test(l) &&
            /never|internal/i.test(l) &&
            /user/i.test(l),
        );
      expect(directiveLine).toBeDefined();
    });

    it("instructs that the snapshot/dev_snapshot label is internal-only", () => {
      if (typeof fragment !== "string") throw new Error("fragment missing");
      // Must contain a directive that "snapshot" is internal — exact
      // phrasing tolerated, but the assertion verifies the rule lands.
      expect(fragment.toLowerCase()).toMatch(/internal/);
      expect(fragment).toMatch(/milestones/i);
    });

    it("age-gates the bottle question to children under 24 months", () => {
      if (typeof fragment !== "string") throw new Error("fragment missing");
      expect(fragment).toMatch(/bottle/i);
      expect(fragment).toMatch(/24/);
    });

    it("references the runtime state block (the block lives in runtime, not this fragment)", () => {
      if (typeof fragment !== "string") throw new Error("fragment missing");
      // Static prompts cannot contain per-turn state; the renderer
      // injects the table at runtime. The fragment must point Katie
      // at it.
      expect(fragment).toMatch(/onboarding state/i);
      expect(fragment).toMatch(/runtime/i);
    });

    it("ties the wrap step to update_onboarding_state — the only thing that flips onboarding_completed", () => {
      if (typeof fragment !== "string") throw new Error("fragment missing");
      expect(fragment).toMatch(/wrap/i);
      expect(fragment).toMatch(/update_onboarding_state/);
    });

    it("explicitly distinguishes 'deferred' from 'skipped'", () => {
      if (typeof fragment !== "string") throw new Error("fragment missing");
      expect(fragment).toMatch(/deferred/i);
      expect(fragment).toMatch(/skipped/i);
      expect(fragment).toMatch(/deferred ≠ skipped|deferred is different/i);
    });

    it("forbids composing UUID-bearing URLs in plain text (PRINCIPLES §8)", () => {
      if (typeof fragment !== "string") throw new Error("fragment missing");
      // The wrap section must route through create_tile's `action`
      // slot rather than instructing Katie to type a URL with a
      // child id. This is a structural defense against the UUID-leak
      // hazard the comment-analyzer caught in the v0 fragment.
      expect(fragment).toMatch(/create_tile/i);
      expect(fragment).toMatch(/action/i);
      // The literal placeholder `{{child_id}}` must NOT appear in the
      // fragment — that template would be substituted into a plain-
      // text URL the user reads.
      expect(fragment).not.toContain("{{child_id}}");
    });
  });

  describe("renderOnboardingStateBlock", () => {
    function makeState(): OnboardingState {
      return {
        started_at: "2026-05-08T01:23:00Z",
        last_active_at: "2026-05-08T01:31:42Z",
        current_step: "dev_snapshot",
        topics: {
          welcome: { status: "captured", summary: "(greeted)" },
          schedule: { status: "captured", summary: "Mon-Fri 8-4" },
          routine: { status: "skipped" },
          dev_snapshot: { status: "pending" },
          first_post: { status: "pending" },
          activity: { status: "pending" },
          child_photo: { status: "pending" },
          wrap: { status: "pending" },
        },
      };
    }

    it("returns null when no settings provided", () => {
      expect(renderOnboardingStateBlock(undefined)).toBeNull();
    });

    it("returns null when settings have no onboarding_state (cascade not yet started)", () => {
      const settings: BotSettings = {};
      expect(renderOnboardingStateBlock(settings)).toBeNull();
    });

    it("returns null when onboarding_completed=true (defense-in-depth — even if predicate forgot to filter)", () => {
      // The enabledForBot predicate already excludes the module post-
      // completion, but the runtime renderer is also defensive: if a
      // future caller forgets to thread settings to the registry, the
      // block still drops out at the runtime layer.
      const settings: BotSettings = {
        onboarding_completed: true,
        onboarding_state: makeState(),
      };
      expect(renderOnboardingStateBlock(settings)).toBeNull();
    });

    it("renders a markdown block with all 8 topic ids when state is active", () => {
      const settings: BotSettings = { onboarding_state: makeState() };
      const block = renderOnboardingStateBlock(settings);
      expect(block).not.toBeNull();
      const expectedTopics = [
        "welcome",
        "schedule",
        "routine",
        "dev_snapshot",
        "first_post",
        "activity",
        "child_photo",
        "wrap",
      ];
      for (const topic of expectedTopics) {
        expect(block).toContain(topic);
      }
    });

    it("includes captured-topic summaries verbatim", () => {
      const settings: BotSettings = { onboarding_state: makeState() };
      const block = renderOnboardingStateBlock(settings)!;
      expect(block).toContain("Mon-Fri 8-4");
      expect(block).toContain("(greeted)");
    });

    it("renders an em-dash (not undefined / null) for non-captured topics", () => {
      const settings: BotSettings = { onboarding_state: makeState() };
      const block = renderOnboardingStateBlock(settings)!;
      // Pending / skipped rows must not leak the literal word
      // 'undefined' or 'null' — they show '—' in the summary cell.
      expect(block).not.toContain("undefined");
      expect(block).not.toContain("null");
      expect(block).toContain("—");
    });

    it("renders current_step + last_active_at as separate lines below the table", () => {
      const settings: BotSettings = { onboarding_state: makeState() };
      const block = renderOnboardingStateBlock(settings)!;
      expect(block).toContain("current_step: dev_snapshot");
      expect(block).toContain("last_active_at: 2026-05-08T01:31:42Z");
    });

    it("truncates a long captured-summary so the table stays aligned", () => {
      const longSummary =
        "Mon-Fri 8am-4pm, Saturday mornings sometimes, plus occasional evening sits";
      // BotSettings is typed; cast a plausible overflow value through
      // the type so we can construct it. The renderer doesn't care
      // about the type-system origin, only the runtime length.
      const state: OnboardingState = {
        ...makeState(),
        topics: {
          ...makeState().topics,
          schedule: { status: "captured", summary: longSummary },
        },
      };
      const block = renderOnboardingStateBlock({ onboarding_state: state })!;
      // Truncation marker '…' must appear once in the rendered cell;
      // the original 70+ char summary must NOT appear in full.
      expect(block).not.toContain(longSummary);
      expect(block).toContain("…");
    });

    it("silently skips a topic key that's missing from state.topics (defensive)", () => {
      const state = makeState();
      // Construct a topics map missing one key. TS forbids removing a
      // required Record member, so cast through unknown to model the
      // partial-write case at runtime (a malformed DB row, an old
      // migration, etc.).
      const partialTopics = { ...state.topics } as Record<string, unknown>;
      delete partialTopics.routine;
      const malformed = {
        ...state,
        topics: partialTopics,
      } as unknown as OnboardingState;
      const block = renderOnboardingStateBlock({
        onboarding_state: malformed,
      })!;
      // Other topics still render; the missing one simply doesn't
      // appear. The renderer doesn't throw, doesn't render `undefined`.
      expect(block).toContain("welcome");
      expect(block).toContain("schedule");
      expect(block).not.toContain("routine ");
      expect(block).not.toContain("undefined");
    });
  });

  describe("enabledForBot predicate", () => {
    it("is active when settings have no onboarding_completed flag (fresh bot)", () => {
      const settings: BotSettings = {};
      expect(childOnboardingModule.enabledForBot?.(settings)).toBe(true);
    });

    it("is active when onboarding_completed is explicitly false", () => {
      const settings: BotSettings = { onboarding_completed: false };
      expect(childOnboardingModule.enabledForBot?.(settings)).toBe(true);
    });

    it("is INACTIVE when onboarding_completed is exactly true (the only off switch)", () => {
      const settings: BotSettings = { onboarding_completed: true };
      expect(childOnboardingModule.enabledForBot?.(settings)).toBe(false);
    });

    it("stays active when onboarding_completed is undefined alongside other fields", () => {
      // A bot with waking_hours set but no onboarding_completed — older
      // bots created before A-08 ships will look like this. They must
      // still see the cascade if they create their first child.
      const settings: BotSettings = {
        waking_hours: {
          start: "07:00",
          end: "22:00",
          timezone: APP_TZ,
        },
      };
      expect(childOnboardingModule.enabledForBot?.(settings)).toBe(true);
    });

    it("stays active when onboarding_completed has a truthy NON-boolean value (defensive against unexpected DB payloads)", () => {
      // The JSONB column is `unknown` outside typed fields. A row
      // could in principle contain `onboarding_completed: "done"` or
      // `1` from a hand-edited DB write or a future schema drift.
      // The predicate uses strict `!== true`, so any value other
      // than literal boolean `true` keeps the cascade active —
      // critical because the only thing that turns it off should be
      // a deliberate `update_onboarding_state(topic='wrap',
      // status='captured')` call, which writes the boolean.
      const stringy = {
        onboarding_completed: "done",
      } as unknown as BotSettings;
      const numeric = { onboarding_completed: 1 } as unknown as BotSettings;
      expect(childOnboardingModule.enabledForBot?.(stringy)).toBe(true);
      expect(childOnboardingModule.enabledForBot?.(numeric)).toBe(true);
    });
  });

  // ── T5: child.created proactive trigger ──────────────────────────────
  describe("child.created proactive trigger", () => {
    function getTrigger() {
      const t = (childOnboardingModule.proactiveTriggers ?? []).find(
        (x) => x.id === "child.created",
      );
      if (!t) throw new Error("child.created trigger missing");
      return t;
    }

    it("is declared with mode='template' so the welcome fires instantly with no AI cost", () => {
      const t = getTrigger();
      expect(t.mode).toBe("template");
      expect(t.event).toBe("child.created");
    });

    it("produces a welcome_text payload that resolves child name + user name (first child)", async () => {
      const t = getTrigger();
      const out = await t.resolvePayload(
        {
          source: "event",
          payload: {
            user_first_name: "Emma",
            child_first_name: "Oliver",
            parent_first_name_if_known: "Sarah",
            child_age_months: 18,
            is_subsequent: false,
          },
        },
        fakeCtx(),
      );
      expect(typeof out.welcome_text).toBe("string");
      const text = out.welcome_text as string;
      expect(text).toContain("Emma");
      expect(text).toContain("Oliver");
      // First-child variant carries the brand-+-trust framing.
      expect(text).toContain("Baby Bloom");
      // The trust line names the parent when known.
      expect(text).toContain("Sarah");
    });

    it("treats is_subsequent='true' (string) as truthy — defense against JSON-serialised booleans", async () => {
      const t = getTrigger();
      const out = await t.resolvePayload(
        {
          source: "event",
          payload: {
            user_first_name: "Emma",
            child_first_name: "Lily",
            // String 'true' instead of boolean — this can happen if
            // a caller serialises the payload through JSON or a
            // query parameter. Strict ===true would silently fall
            // through to the long welcome.
            is_subsequent: "true",
          },
        },
        fakeCtx(),
      );
      const text = out.welcome_text as string;
      expect(text).toMatch(/you know the drill/i);
    });

    it("uses the lightweight subsequent-child variant when is_subsequent=true", async () => {
      const t = getTrigger();
      const out = await t.resolvePayload(
        {
          source: "event",
          payload: {
            user_first_name: "Emma",
            child_first_name: "Lily",
            is_subsequent: true,
          },
        },
        fakeCtx(),
      );
      const text = out.welcome_text as string;
      expect(text).toContain("Lily");
      // Subsequent variant uses the "you know the drill" framing.
      expect(text).toMatch(/you know the drill/i);
      // It does NOT include the long brand description.
      expect(text).not.toContain("Baby Bloom is where");
    });

    it("falls back to 'the parent' when the parent name isn't known yet", async () => {
      const t = getTrigger();
      const out = await t.resolvePayload(
        {
          source: "event",
          payload: {
            user_first_name: "Jess",
            child_first_name: "Theo",
            // parent_first_name_if_known intentionally absent
          },
        },
        fakeCtx(),
      );
      const text = out.welcome_text as string;
      expect(text).toContain("the parent");
      // The fallback string itself MUST NOT leak the placeholder.
      expect(text).not.toContain("{parent_phrase}");
    });

    it("never leaks unresolved {placeholders} into the rendered text", async () => {
      const t = getTrigger();
      const out = await t.resolvePayload(
        {
          source: "event",
          payload: {
            user_first_name: "Bailey",
            child_first_name: "Casey",
            parent_first_name_if_known: "Sam",
          },
        },
        fakeCtx(),
      );
      const text = out.welcome_text as string;
      // Every {placeholder} should have been substituted.
      expect(text).not.toMatch(/\{[a-z_]+\}/);
    });

    it("defaults gracefully when child_first_name is missing", async () => {
      const t = getTrigger();
      const out = await t.resolvePayload(
        {
          source: "event",
          payload: { user_first_name: "Robin" },
        },
        fakeCtx(),
      );
      const text = out.welcome_text as string;
      // Should not crash, should not include 'undefined', should
      // use a sensible fallback.
      expect(text).not.toContain("undefined");
      expect(text).toMatch(/your child/);
    });
  });

  // ── T6: parent.connected_to_child proactive trigger ─────────────────
  describe("parent.connected_to_child proactive trigger", () => {
    function getTrigger() {
      const t = (childOnboardingModule.proactiveTriggers ?? []).find(
        (x) => x.id === "parent.connected_to_child",
      );
      if (!t) throw new Error("parent.connected_to_child trigger missing");
      return t;
    }

    it("is declared with mode='template' and the canonical event name", () => {
      const t = getTrigger();
      expect(t.mode).toBe("template");
      expect(t.event).toBe("parent.connected_to_child");
    });

    it("renders parent + nanny + child names into the welcome text", async () => {
      const t = getTrigger();
      const out = await t.resolvePayload(
        {
          source: "event",
          payload: {
            parent_first_name: "Sarah",
            nanny_first_name: "Emma",
            child_first_name: "Oliver",
          },
        },
        fakeCtx(),
      );
      const text = out.welcome_text as string;
      expect(text).toContain("Sarah");
      expect(text).toContain("Emma");
      expect(text).toContain("Oliver");
      // Spec invariants from A-08 § 'Parent post-invite-claim'
      expect(text).toContain("Baby Bloom");
      expect(text).toMatch(/private to your family/i);
      expect(text).toMatch(/about a minute/i);
    });

    it("falls back gracefully when names are missing", async () => {
      const t = getTrigger();
      const out = await t.resolvePayload(
        { source: "event", payload: {} },
        fakeCtx(),
      );
      const text = out.welcome_text as string;
      expect(text).not.toContain("undefined");
      expect(text).not.toMatch(/\{[a-z_]+\}/);
      expect(text).toMatch(/your nanny/);
      expect(text).toMatch(/your child/);
    });
  });

  describe("execute handler — unknown tool routing", () => {
    it("rejects an unknown tool name with a clear error", async () => {
      const result = await childOnboardingModule.execute(
        "definitely_not_a_real_tool",
        {},
        fakeCtx(),
      );
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/unknown tool/i);
    });
  });

  // ── T4: update_onboarding_state — handler behaviour ─────────────────────
  describe("update_onboarding_state — input validation", () => {
    it("rejects when topic is missing", async () => {
      const result = await childOnboardingModule.execute(
        "update_onboarding_state",
        { status: "captured" },
        fakeCtx(),
      );
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/topic must be one of/i);
    });

    it("rejects when topic is not in the canonical set", async () => {
      const result = await childOnboardingModule.execute(
        "update_onboarding_state",
        { topic: "hallucinated_topic", status: "captured" },
        fakeCtx(),
      );
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/topic must be one of/i);
    });

    it("rejects when status is invalid", async () => {
      const result = await childOnboardingModule.execute(
        "update_onboarding_state",
        { topic: "schedule", status: "done" },
        fakeCtx(),
      );
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/status must be one of/i);
    });

    it("rejects when status='captured' but summary is missing", async () => {
      const result = await childOnboardingModule.execute(
        "update_onboarding_state",
        { topic: "schedule", status: "captured" },
        fakeCtx(),
      );
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/summary is required/i);
    });

    it("rejects status='pending' on the wrap topic (semantically invalid)", async () => {
      const result = await childOnboardingModule.execute(
        "update_onboarding_state",
        { topic: "wrap", status: "pending" },
        fakeCtx(),
      );
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/pending.*wrap|wrap.*pending|terminal/i);
    });
  });

  describe("update_onboarding_state — JSONB merge writes (handler-level)", () => {
    /** A spy-style supabase stub that captures the read + write
     *  payloads the handler issues, so each test can assert against
     *  the exact JSON written. The shape mirrors the real call chain
     *  the handler uses: from(...).select(...).eq(...).single() for
     *  the read, from(...).update(...).eq(...).select().single() for
     *  the write. */
    /** Stub mirroring the handler's call chain:
     *    select("settings").eq("id", ...).eq("user_id", ...).single()  // read
     *    update(payload).eq("id", ...).eq("user_id", ...).select().single()  // write
     *  Both .eq() links return the next link so the chain length
     *  matches what the handler issues. */
    function makeSupabaseStub(initial: BotSettings | null) {
      let writePayload: Record<string, unknown> | null = null;
      const readChain = {
        eq: () => readChain,
        single: async () => ({
          data: initial === null ? null : { settings: initial },
          error: null,
        }),
      };
      const writeChain = {
        eq: () => writeChain,
        select: () => ({
          single: async () => ({ data: null, error: null }),
        }),
      };
      const stub = {
        from: () => ({
          select: () => readChain,
          update: (payload: Record<string, unknown>) => {
            writePayload = payload;
            return writeChain;
          },
        }),
      } as unknown as SupabaseClient;
      return {
        supabase: stub,
        getWritePayload: () => writePayload,
      };
    }

    function ctxWith(supabase: SupabaseClient): ModuleContext {
      return { ...fakeCtx(), supabase };
    }

    it("initialises onboarding_state when absent (welcome captured, others pending)", async () => {
      const { supabase, getWritePayload } = makeSupabaseStub({});
      const result = await childOnboardingModule.execute(
        "update_onboarding_state",
        {
          topic: "schedule",
          status: "captured",
          summary: "Mon-Fri 8-4",
        },
        ctxWith(supabase),
      );
      expect(result.success).toBe(true);
      const payload = getWritePayload();
      expect(payload).not.toBeNull();
      const settings = payload!.settings as BotSettings;
      const state = settings.onboarding_state!;
      expect(state.topics.welcome.status).toBe("captured");
      expect(state.topics.schedule.status).toBe("captured");
      // schedule was just captured; current_step should be the next pending.
      expect(state.current_step).toBe("routine");
    });

    it("preserves other settings keys during a merge write", async () => {
      const { supabase, getWritePayload } = makeSupabaseStub({
        waking_hours: {
          start: "07:00",
          end: "22:00",
          timezone: APP_TZ,
        },
        effective_role: "nanny",
      });
      await childOnboardingModule.execute(
        "update_onboarding_state",
        { topic: "routine", status: "skipped" },
        ctxWith(supabase),
      );
      const settings = getWritePayload()!.settings as BotSettings;
      expect(settings.waking_hours).toEqual({
        start: "07:00",
        end: "22:00",
        timezone: APP_TZ,
      });
      expect(settings.effective_role).toBe("nanny");
    });

    it("flips onboarding_completed=true ONLY when wrap captures", async () => {
      // Schedule capture — onboarding_completed stays false.
      const { supabase: s1, getWritePayload: p1 } = makeSupabaseStub({});
      await childOnboardingModule.execute(
        "update_onboarding_state",
        { topic: "schedule", status: "captured", summary: "Mon-Fri" },
        ctxWith(s1),
      );
      const settings1 = p1()!.settings as BotSettings;
      expect(settings1.onboarding_completed).toBeUndefined();

      // Wrap capture — onboarding_completed flips to true.
      const { supabase: s2, getWritePayload: p2 } = makeSupabaseStub({});
      await childOnboardingModule.execute(
        "update_onboarding_state",
        { topic: "wrap", status: "captured", summary: "(wrapped)" },
        ctxWith(s2),
      );
      const settings2 = p2()!.settings as BotSettings;
      expect(settings2.onboarding_completed).toBe(true);

      // Wrap SKIPPED — onboarding_completed stays false (skipping
      // wrap is unusual but should not flip the completion flag).
      const { supabase: s3, getWritePayload: p3 } = makeSupabaseStub({});
      await childOnboardingModule.execute(
        "update_onboarding_state",
        { topic: "wrap", status: "skipped" },
        ctxWith(s3),
      );
      const settings3 = p3()!.settings as BotSettings;
      expect(settings3.onboarding_completed).toBeUndefined();
    });

    it("advances current_step to the next pending topic after capture", async () => {
      // Pre-existing state: schedule + routine already captured.
      const initialState: OnboardingState = {
        started_at: "2026-05-01T00:00:00Z",
        last_active_at: "2026-05-01T00:00:00Z",
        current_step: "dev_snapshot",
        topics: {
          welcome: { status: "captured", summary: "(greeted)" },
          schedule: { status: "captured", summary: "Mon-Fri" },
          routine: { status: "captured", summary: "Naps 12-2" },
          dev_snapshot: { status: "pending" },
          first_post: { status: "pending" },
          activity: { status: "pending" },
          child_photo: { status: "pending" },
          wrap: { status: "pending" },
        },
      };
      const { supabase, getWritePayload } = makeSupabaseStub({
        onboarding_state: initialState,
      });
      await childOnboardingModule.execute(
        "update_onboarding_state",
        {
          topic: "dev_snapshot",
          status: "captured",
          summary: "Walking, 5+ words",
        },
        ctxWith(supabase),
      );
      const state = (getWritePayload()!.settings as BotSettings)
        .onboarding_state!;
      expect(state.current_step).toBe("first_post");
    });

    it("propagates a DB read error as a tool-level failure (silent-failure-hunter requirement)", async () => {
      const readChain: {
        eq: () => typeof readChain;
        single: () => Promise<unknown>;
      } = {
        eq: () => readChain,
        single: async () => ({
          data: null,
          error: { message: "connection reset" },
        }),
      };
      const failingSupabase = {
        from: () => ({ select: () => readChain }),
      } as unknown as SupabaseClient;
      const result = await childOnboardingModule.execute(
        "update_onboarding_state",
        { topic: "schedule", status: "skipped" },
        ctxWith(failingSupabase),
      );
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/connection reset/i);
    });

    it("returns a clear error when no bot row matches (phantom-null defence)", async () => {
      // .single() can in principle return null data with no error
      // (future Supabase client behaviour change). The handler must
      // refuse to bootstrap state onto a non-existent bot.
      const readChain: {
        eq: () => typeof readChain;
        single: () => Promise<unknown>;
      } = {
        eq: () => readChain,
        single: async () => ({ data: null, error: null }),
      };
      const phantomNull = {
        from: () => ({ select: () => readChain }),
      } as unknown as SupabaseClient;
      const result = await childOnboardingModule.execute(
        "update_onboarding_state",
        { topic: "schedule", status: "skipped" },
        ctxWith(phantomNull),
      );
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/no bloombot row matched/i);
    });

    it("propagates a DB write error as a tool-level failure", async () => {
      const readChain: {
        eq: () => typeof readChain;
        single: () => Promise<unknown>;
      } = {
        eq: () => readChain,
        single: async () => ({ data: { settings: {} }, error: null }),
      };
      const writeChain: {
        eq: () => typeof writeChain;
        select: () => { single: () => Promise<unknown> };
      } = {
        eq: () => writeChain,
        select: () => ({
          single: async () => ({
            data: null,
            error: { message: "row-level security" },
          }),
        }),
      };
      const failingWrite = {
        from: () => ({
          select: () => readChain,
          update: () => writeChain,
        }),
      } as unknown as SupabaseClient;
      const result = await childOnboardingModule.execute(
        "update_onboarding_state",
        { topic: "schedule", status: "skipped" },
        ctxWith(failingWrite),
      );
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/row-level security/i);
    });

    it("threads count through to the captured topic record (multi-instance topics like first_post)", async () => {
      const { supabase, getWritePayload } = makeSupabaseStub({});
      await childOnboardingModule.execute(
        "update_onboarding_state",
        {
          topic: "first_post",
          status: "captured",
          summary: "Park visit",
          count: 2,
        },
        ctxWith(supabase),
      );
      const settings = getWritePayload()!.settings as BotSettings;
      const firstPost = settings.onboarding_state!.topics.first_post;
      expect(firstPost.status).toBe("captured");
      if (firstPost.status === "captured") {
        expect(firstPost.summary).toBe("Park visit");
        expect(firstPost.count).toBe(2);
      }
    });

    it("floors a non-integer count and rejects negative count silently (count drops to undefined)", async () => {
      const { supabase, getWritePayload } = makeSupabaseStub({});
      await childOnboardingModule.execute(
        "update_onboarding_state",
        {
          topic: "first_post",
          status: "captured",
          summary: "Floor test",
          count: 2.7,
        },
        ctxWith(supabase),
      );
      const settings = getWritePayload()!.settings as BotSettings;
      const fp = settings.onboarding_state!.topics.first_post;
      if (fp.status === "captured") expect(fp.count).toBe(2);

      const { supabase: s2, getWritePayload: p2 } = makeSupabaseStub({});
      await childOnboardingModule.execute(
        "update_onboarding_state",
        {
          topic: "first_post",
          status: "captured",
          summary: "Negative test",
          count: -1,
        },
        ctxWith(s2),
      );
      const fp2 = (p2()!.settings as BotSettings).onboarding_state!.topics
        .first_post;
      if (fp2.status === "captured") {
        expect(fp2.count).toBeUndefined();
      }
    });

    it("can overwrite the welcome topic when Katie explicitly skips it", async () => {
      // Welcome is auto-captured by freshInitialState. If Katie ever
      // writes welcome=skipped (unusual but legal), the new record
      // must replace the auto-capture rather than being shadowed.
      const { supabase, getWritePayload } = makeSupabaseStub({});
      await childOnboardingModule.execute(
        "update_onboarding_state",
        { topic: "welcome", status: "skipped" },
        ctxWith(supabase),
      );
      const settings = getWritePayload()!.settings as BotSettings;
      expect(settings.onboarding_state!.topics.welcome.status).toBe("skipped");
    });

    it("is idempotent — writing the same {topic, status, summary} twice yields the same final topic record", async () => {
      const { supabase: s1, getWritePayload: p1 } = makeSupabaseStub({});
      await childOnboardingModule.execute(
        "update_onboarding_state",
        { topic: "schedule", status: "captured", summary: "Mon-Fri 8-4" },
        ctxWith(s1),
      );
      const after1 = (p1()!.settings as BotSettings).onboarding_state!.topics
        .schedule;

      const { supabase: s2, getWritePayload: p2 } = makeSupabaseStub({
        onboarding_state: (p1()!.settings as BotSettings).onboarding_state,
      });
      await childOnboardingModule.execute(
        "update_onboarding_state",
        { topic: "schedule", status: "captured", summary: "Mon-Fri 8-4" },
        ctxWith(s2),
      );
      const after2 = (p2()!.settings as BotSettings).onboarding_state!.topics
        .schedule;

      // Same input → same final topic record (the wrapping state's
      // last_active_at differs across calls, but the topic itself is
      // stable, which is the idempotency contract Katie can rely on).
      expect(after2).toEqual(after1);
    });
  });
});
