import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  interpolate,
  __resetPromptCache,
  buildRuntimeContext,
} from "./context";
import { APP_LOCALE, APP_TZ, BRAND } from "@/lib/constants";

// Mock the supabase admin client. All DB calls flow through this mock.
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => mockAdminClient,
}));

// Shared test state — reset in beforeEach
let mockVersionHash = "hash-1";
let mockSections: Array<{
  section: string;
  content: string;
  version: number;
  protected: boolean;
}> = [];

const mockAdminClient = {
  from: (table: string) => {
    if (table === "katie_prompt_version") {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: { version_hash: mockVersionHash },
              error: null,
            }),
          }),
        }),
      };
    }
    if (table === "katie_prompt") {
      return {
        select: () => ({
          eq: async () => ({
            data: mockSections,
            error: null,
          }),
        }),
      };
    }
    throw new Error(`unexpected table: ${table}`);
  },
};

describe("interpolate", () => {
  it("replaces {variable} with provided values", () => {
    expect(interpolate("Hello {name}!", { name: "Bailey" })).toBe(
      "Hello Bailey!",
    );
  });

  it("leaves unknown placeholders as-is", () => {
    expect(interpolate("Hi {x}", {})).toBe("Hi {x}");
  });

  it("handles multiple occurrences", () => {
    expect(interpolate("{a} and {a}", { a: "x" })).toBe("x and x");
  });
});

describe("loadActiveSections + cache invalidation", () => {
  beforeEach(() => {
    __resetPromptCache();
    mockVersionHash = "hash-1";
    mockSections = [
      {
        section: "identity",
        content: "I am Katie.",
        version: 1,
        protected: false,
      },
      {
        section: "voice",
        content: "Be concise.",
        version: 1,
        protected: false,
      },
    ];
  });

  it("loads from DB on first call", async () => {
    const { loadActiveSections } = await import("./context");
    const sections = await loadActiveSections();
    expect(sections.size).toBe(2);
    expect(sections.get("identity")?.content).toBe("I am Katie.");
  });

  it("uses cache on second call with same hash", async () => {
    const { loadActiveSections } = await import("./context");
    await loadActiveSections();

    // Change DB content but keep hash — should use cache
    mockSections = [
      {
        section: "identity",
        content: "CHANGED but cached should win",
        version: 2,
        protected: false,
      },
    ];

    const second = await loadActiveSections();
    expect(second.get("identity")?.content).toBe("I am Katie."); // still cached
  });

  it("reloads when hash changes (invalidation)", async () => {
    const { loadActiveSections } = await import("./context");
    await loadActiveSections();

    mockSections = [
      {
        section: "identity",
        content: "Updated content",
        version: 2,
        protected: false,
      },
    ];
    mockVersionHash = "hash-2";

    const second = await loadActiveSections();
    expect(second.get("identity")?.content).toBe("Updated content");
    expect(second.size).toBe(1); // voice is gone from new snapshot
  });

  it("filters by requested sectionIds", async () => {
    const { loadActiveSections } = await import("./context");
    const result = await loadActiveSections(["identity"]);
    expect(result.size).toBe(1);
    expect(result.has("identity")).toBe(true);
  });
});

describe("buildSystemPrompt", () => {
  beforeEach(() => {
    __resetPromptCache();
    mockVersionHash = "hash-build";
    mockSections = [
      {
        section: "identity",
        content: "You are Katie, {user_name}'s assistant.",
        version: 1,
        protected: false,
      },
      {
        section: "voice",
        content: "Be concise.",
        version: 1,
        protected: false,
      },
      {
        section: "role_nanny",
        content: "User is a nanny.",
        version: 1,
        protected: false,
      },
      {
        section: "role_parent",
        content: "User is a parent.",
        version: 1,
        protected: false,
      },
      {
        section: "module.diary",
        content: "Use log_food for meals.",
        version: 1,
        protected: false,
      },
      {
        section: "module.feed",
        content: "Use read_recent_feed.",
        version: 1,
        protected: false,
      },
    ];
  });

  it("assembles nanny prompt with role_nanny section", async () => {
    const { buildSystemPrompt } = await import("./context");
    const prompt = await buildSystemPrompt({
      botId: "b1",
      userId: "u1",
      role: "nanny",
      effectiveRole: "nanny",
      userName: "Bailey",
      children: [],
    });
    // WU 13.2 — `{user_name}` is rendered as the placeholder "the user"
    // in the static (cacheable) portion so the cache can be shared
    // across users. The real name appears in the runtime header
    // section ("Name: Bailey") — verify both halves are present.
    expect(prompt).toContain("You are Katie, the user's assistant.");
    expect(prompt).toContain("Name: Bailey");
    expect(prompt).toContain("Be concise.");
    expect(prompt).toContain("User is a nanny.");
    expect(prompt).not.toContain("User is a parent.");
  });

  it("includes module.* fragments sorted alphabetically", async () => {
    const { buildSystemPrompt } = await import("./context");
    const prompt = await buildSystemPrompt({
      botId: "b1",
      userId: "u1",
      role: "nanny",
      effectiveRole: "nanny",
      userName: "Bailey",
      children: [],
    });
    const diaryPos = prompt.indexOf("log_food for meals");
    // Use the trailing period to disambiguate from other modules that
    // also mention `read_recent_feed` (notably the activities module's
    // complete_activity instruction added in WU 11.1). The mock's feed
    // fragment is exactly "Use read_recent_feed." — terminal period
    // is unique to the mock and pins this match to the feed module.
    const feedPos = prompt.indexOf("Use read_recent_feed.");
    expect(diaryPos).toBeGreaterThan(-1);
    expect(feedPos).toBeGreaterThan(-1);
    expect(diaryPos).toBeLessThan(feedPos); // "diary" < "feed"
  });

  it("renders runtime header with user + children + role", async () => {
    const { buildSystemPrompt } = await import("./context");
    const prompt = await buildSystemPrompt({
      botId: "b1",
      userId: "u1",
      role: "nanny",
      effectiveRole: "nanny",
      userName: "Bailey",
      children: [
        {
          id: "c1",
          firstName: "Oliver",
          ageMonths: 18,
          ageBracket: "12-24 months",
          gender: "male",
        },
      ],
    });
    expect(prompt).toContain("## Who You Are Speaking With");
    expect(prompt).toContain("Name: Bailey");
    expect(prompt).toContain("Role: nanny");
    expect(prompt).toContain("Oliver — 18mo");
  });

  it("includes currentSurface block when provided", async () => {
    const { buildSystemPrompt } = await import("./context");
    const prompt = await buildSystemPrompt({
      botId: "b1",
      userId: "u1",
      role: "nanny",
      effectiveRole: "nanny",
      userName: "Bailey",
      children: [],
      currentSurface: { route: "/nanny/jobs", feature: "job-search" },
    });
    expect(prompt).toContain("## Current Surface");
    expect(prompt).toContain("Route: /nanny/jobs");
    expect(prompt).toContain("Feature: job-search");
  });

  it("uses effective_role for role section selection", async () => {
    const { buildSystemPrompt } = await import("./context");
    // Admin user simulating parent
    const prompt = await buildSystemPrompt({
      botId: "b1",
      userId: "u1",
      role: "admin",
      effectiveRole: "parent",
      userName: "Admin",
      children: [],
    });
    expect(prompt).toContain("User is a parent.");
    expect(prompt).not.toContain("User is a nanny.");
  });

  it("falls back to hardcoded identity when DB has no identity row", async () => {
    mockSections = []; // empty
    __resetPromptCache();
    const { buildSystemPrompt } = await import("./context");
    const prompt = await buildSystemPrompt({
      botId: "b1",
      userId: "u1",
      role: "nanny",
      effectiveRole: "nanny",
      userName: "Bailey",
      children: [],
    });
    expect(prompt).toContain("You are Katie");
  });

  it("falls back to module.systemPromptFragment when DB lacks a module.<id> row", async () => {
    // DB provides no module.* rows. Registered modules (progress, feed,
    // child-profile) should contribute their fallback fragments.
    mockSections = [
      {
        section: "identity",
        content: "You are Katie.",
        version: 1,
        protected: false,
      },
      {
        section: "role_nanny",
        content: "User is a nanny.",
        version: 1,
        protected: false,
      },
    ];
    __resetPromptCache();
    const { buildSystemPrompt } = await import("./context");
    const prompt = await buildSystemPrompt({
      botId: "b1",
      userId: "u1",
      role: "nanny",
      effectiveRole: "nanny",
      userName: "Bailey",
      children: [],
    });
    // Fragment strings come verbatim from each module definition.
    expect(prompt).toContain("read_child_profile");
    expect(prompt).toContain("read_recent_feed");
    expect(prompt).toContain("read_milestones");
  });

  it("prefers DB row over module fragment when both exist", async () => {
    mockSections = [
      {
        section: "identity",
        content: "You are Katie.",
        version: 1,
        protected: false,
      },
      {
        section: "role_nanny",
        content: "User is a nanny.",
        version: 1,
        protected: false,
      },
      {
        section: "module.feed",
        content: "DB-ONLY-FEED-MARKER",
        version: 1,
        protected: false,
      },
    ];
    __resetPromptCache();
    const { buildSystemPrompt } = await import("./context");
    const prompt = await buildSystemPrompt({
      botId: "b1",
      userId: "u1",
      role: "nanny",
      effectiveRole: "nanny",
      userName: "Bailey",
      children: [],
    });
    expect(prompt).toContain("DB-ONLY-FEED-MARKER");
    // The feed module's fallback fragment must NOT leak in when the DB
    // row is present, otherwise admin Katie edits get shadowed.
    expect(prompt).not.toContain("Use `read_recent_feed` to see");
  });
});

/**
 * 12.11 / 12.02 — the runtime header is the block prefixed to EVERY Katie turn,
 * so it is the one place where a wrong city or zone reaches every user at once.
 * `KATIE_ENABLED` is off locally and no provider key is configured, so this is
 * the render proof for unit 2h in place of a live exchange: it calls the real
 * builder and reads the real string.
 */
describe("buildRuntimeContext — the place facts Katie is told every turn", () => {
  const ctx = {
    botId: "bot-1",
    userId: "user-1",
    role: "nanny",
    effectiveRole: "nanny",
    userName: "Sophie",
    children: [],
  } as unknown as Parameters<typeof buildRuntimeContext>[0];

  it("names the configured city, not the one the code was written for", () => {
    const header = buildRuntimeContext(ctx);
    expect(header).toContain(`Local time (${BRAND.city})`);
    expect(header).toContain("Local time (London)");
  });

  it("renders the day and the local time in the configured zone", () => {
    const now = new Date();
    const header = buildRuntimeContext(ctx);
    expect(header).toContain(
      `Day: ${now.toLocaleString(APP_LOCALE, { weekday: "long", timeZone: APP_TZ })}`,
    );
    expect(header).toContain(
      now.toLocaleString(APP_LOCALE, {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
        timeZone: APP_TZ,
      }),
    );
  });
});
