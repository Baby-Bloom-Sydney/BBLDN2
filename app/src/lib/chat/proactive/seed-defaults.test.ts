/**
 * Seed-defaults tests — verify the weekly overview default schedule is
 * built correctly and inserted idempotently on bot creation.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { APP_TZ } from "@/lib/constants";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildWeeklyOverviewSeed,
  seedDefaultSchedules,
  WEEKLY_OVERVIEW_CRON,
  WEEKLY_OVERVIEW_TRIGGER_ID,
} from "./seed-defaults";

describe("buildWeeklyOverviewSeed", () => {
  it("builds a row with the canonical trigger id + cron + ai-full mode", () => {
    const row = buildWeeklyOverviewSeed(
      "bot-1",
      { id: "c-1", firstName: "Oliver" },
      APP_TZ,
    );
    expect(row.trigger_id).toBe(WEEKLY_OVERVIEW_TRIGGER_ID);
    expect(row.cron_expr).toBe(WEEKLY_OVERVIEW_CRON);
    expect(row.mode).toBe("ai-full");
    expect(row.active).toBe(true);
    expect(row.bloombot_id).toBe("bot-1");
    expect(row.child_client_id).toBe("c-1");
    expect(row.created_by).toBe("module");
    expect(row.template).toBeNull();
    expect(row.one_time_at).toBeNull();
  });

  it("includes the child's first name in description + prompt + payload", () => {
    const row = buildWeeklyOverviewSeed(
      "bot-1",
      { id: "c-1", firstName: "Oliver" },
      APP_TZ,
    );
    expect(row.description).toContain("Oliver");
    expect(row.prompt_fragment).toContain("Oliver");
    expect(row.payload.child_name).toBe("Oliver");
  });

  it("honours a custom timezone and produces a future next_run_at", () => {
    const row = buildWeeklyOverviewSeed(
      "bot-1",
      { id: "c-1", firstName: "Oliver" },
      "America/New_York",
    );
    expect(row.timezone).toBe("America/New_York");
    const ts = new Date(row.next_run_at).getTime();
    expect(Number.isFinite(ts)).toBe(true);
    // Cron-parser must produce the next future occurrence.
    expect(ts).toBeGreaterThan(Date.now());
  });

  it("defaults to the configured app timezone when tz omitted", () => {
    const row = buildWeeklyOverviewSeed("bot-1", {
      id: "c-1",
      firstName: "Oliver",
    });
    expect(row.timezone).toBe(APP_TZ);
  });
});

// ─── seedDefaultSchedules ─────────────────────────────────────────────────

interface MockState {
  existingPairs: Array<{ child_client_id: string | null }>;
  insertedRows: Record<string, unknown>[];
  selectError: { message: string } | null;
  insertError: { message: string } | null;
}

function makeAdmin(state: MockState): SupabaseClient {
  const client = {
    from(_table: string) {
      return {
        select() {
          return {
            eq() {
              return {
                eq() {
                  return {
                    in: async () => ({
                      data: state.existingPairs,
                      error: state.selectError,
                    }),
                  };
                },
              };
            },
          };
        },
        insert(rows: Record<string, unknown>[]) {
          state.insertedRows.push(...rows);
          return Promise.resolve({ error: state.insertError });
        },
      };
    },
  };
  return client as unknown as SupabaseClient;
}

describe("seedDefaultSchedules", () => {
  let state: MockState;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    state = {
      existingPairs: [],
      insertedRows: [],
      selectError: null,
      insertError: null,
    };
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("returns 0 and skips insert when no children", async () => {
    const n = await seedDefaultSchedules(makeAdmin(state), "bot-1", []);
    expect(n).toBe(0);
    expect(state.insertedRows).toHaveLength(0);
  });

  it("inserts one row per child when none are seeded yet", async () => {
    const n = await seedDefaultSchedules(makeAdmin(state), "bot-1", [
      {
        id: "c-1",
        firstName: "Oliver",
        ageMonths: 18,
        ageBracket: "12-18 months",
        gender: null,
      },
      {
        id: "c-2",
        firstName: "Amara",
        ageMonths: 24,
        ageBracket: "18-24 months",
        gender: null,
      },
    ]);
    expect(n).toBe(2);
    expect(state.insertedRows).toHaveLength(2);
    const childIds = state.insertedRows.map((r) => r.child_client_id);
    expect(childIds).toEqual(["c-1", "c-2"]);
  });

  it("skips children that already have a weekly_overview schedule", async () => {
    state.existingPairs = [{ child_client_id: "c-1" }];
    const n = await seedDefaultSchedules(makeAdmin(state), "bot-1", [
      {
        id: "c-1",
        firstName: "Oliver",
        ageMonths: 18,
        ageBracket: "12-18 months",
        gender: null,
      },
      {
        id: "c-2",
        firstName: "Amara",
        ageMonths: 24,
        ageBracket: "18-24 months",
        gender: null,
      },
    ]);
    expect(n).toBe(1);
    expect(state.insertedRows).toHaveLength(1);
    expect(state.insertedRows[0].child_client_id).toBe("c-2");
  });

  it("returns 0 without inserting when every child is already seeded", async () => {
    state.existingPairs = [{ child_client_id: "c-1" }];
    const n = await seedDefaultSchedules(makeAdmin(state), "bot-1", [
      {
        id: "c-1",
        firstName: "Oliver",
        ageMonths: 18,
        ageBracket: "12-18 months",
        gender: null,
      },
    ]);
    expect(n).toBe(0);
    expect(state.insertedRows).toHaveLength(0);
  });

  it("uses the supplied timezone on the inserted row", async () => {
    await seedDefaultSchedules(
      makeAdmin(state),
      "bot-1",
      [
        {
          id: "c-1",
          firstName: "Oliver",
          ageMonths: 18,
          ageBracket: "12-18 months",
          gender: null,
        },
      ],
      "America/New_York",
    );
    expect(state.insertedRows[0].timezone).toBe("America/New_York");
  });

  it("logs and returns 0 when insert fails — never throws", async () => {
    state.insertError = { message: "RLS denied" };
    const n = await seedDefaultSchedules(makeAdmin(state), "bot-1", [
      {
        id: "c-1",
        firstName: "Oliver",
        ageMonths: 18,
        ageBracket: "12-18 months",
        gender: null,
      },
    ]);
    expect(n).toBe(0);
    expect(warnSpy).toHaveBeenCalled();
  });
});
