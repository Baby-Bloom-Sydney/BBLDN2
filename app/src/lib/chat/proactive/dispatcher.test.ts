import { describe, it, expect, beforeEach, vi } from "vitest";
import { APP_TZ } from "@/lib/constants";
import { inWakingHours, renderTemplate } from "./dispatcher";

describe("inWakingHours", () => {
  it("accepts a time inside the window", () => {
    expect(
      inWakingHours(
        { start: "07:00", end: "22:00", timezone: APP_TZ },
        new Date("2026-04-23T11:00:00Z"), // 12pm London (BST UTC+1)
      ),
    ).toBe(true);
  });

  it("rejects before start", () => {
    expect(
      inWakingHours(
        { start: "07:00", end: "22:00", timezone: APP_TZ },
        new Date("2026-04-23T05:00:00Z"), // 6am London
      ),
    ).toBe(false);
  });

  it("rejects after end", () => {
    expect(
      inWakingHours(
        { start: "07:00", end: "22:00", timezone: APP_TZ },
        new Date("2026-04-23T23:00:00Z"), // midnight London
      ),
    ).toBe(false);
  });

  it("defaults to the configured app timezone, 07:00–22:00, when settings are missing", () => {
    expect(
      inWakingHours(
        undefined,
        new Date("2026-04-23T11:00:00Z"), // 12pm London
      ),
    ).toBe(true);
  });
});

describe("renderTemplate", () => {
  beforeEach(() => vi.clearAllMocks());

  it("substitutes {child_name} and {today}", () => {
    const out = renderTemplate(
      "Good morning! A reminder about {child_name} for {today}.",
      { child_name: "Oliver", today: "Thursday" },
    );
    expect(out).toBe("Good morning! A reminder about Oliver for Thursday.");
  });

  it("leaves unknown placeholders untouched", () => {
    const out = renderTemplate("Hi {unknown}", {});
    expect(out).toBe("Hi {unknown}");
  });
});
