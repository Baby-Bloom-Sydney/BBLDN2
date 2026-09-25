import { describe, it, expect } from "vitest";
import { APP_TZ } from "@/lib/constants";
import { dayWindow, summariseMessagesFallback } from "./compaction";

describe("dayWindow", () => {
  it("returns start-of-day UTC and next-day-start UTC for a given ISO date", () => {
    const w = dayWindow("2026-04-23", APP_TZ);
    // London is UTC+1 on 2026-04-23 (BST); local midnight = previous UTC 23:00
    expect(w.startUtc).toBe("2026-04-22T23:00:00.000Z");
    expect(w.endUtc).toBe("2026-04-23T23:00:00.000Z");
    expect(w.dateIso).toBe("2026-04-23");
  });
});

describe("summariseMessagesFallback", () => {
  it("returns null for 0 messages", () => {
    const out = summariseMessagesFallback([]);
    expect(out).toBeNull();
  });

  it("produces a compact one-liner when only a few messages", () => {
    const out = summariseMessagesFallback([
      { role: "user", content: "log Obie's breakfast" },
      { role: "assistant", content: "logged: banana and yogurt" },
    ]);
    expect(out).not.toBeNull();
    expect(out!.length).toBeGreaterThan(0);
    expect(out).toContain("2 turns");
  });

  it("concatenates first-line snippets only", () => {
    const out = summariseMessagesFallback([
      { role: "user", content: "line 1\nline 2\nline 3" },
    ]);
    expect(out).toContain("line 1");
    expect(out).not.toContain("line 2");
  });
});
