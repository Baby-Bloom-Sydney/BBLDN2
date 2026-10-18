/**
 * Unit 5a (BB-LDN-5a-151026) — `/ui/embed/[component]` answers only to an admin (R-1). The middleware
 * matcher skips any path ending in an image extension, so `/ui/embed/x.png` reaches this page without the
 * middleware; the page's own `requireAdmin()` is the lock that holds there (ledger 5a §3a).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const gate = vi.hoisted(() => ({ result: { userId: "", error: null as string | null } }));

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
}));
vi.mock("@/lib/admin/require-admin", () => ({
  requireAdmin: async () => gate.result,
}));
vi.mock("./EmbedClient", () => ({
  EmbedClient: function EmbedClient() {
    return null;
  },
}));

import EmbedPage from "./page";
import { EmbedClient } from "./EmbedClient";

describe("/ui/embed/[component] — admin only (5a, R-1)", () => {
  beforeEach(() => {
    gate.result = { userId: "", error: null };
  });

  it("404s for a signed-out visitor (the .png path the middleware never sees)", async () => {
    gate.result = { userId: "", error: "Not authenticated" };

    await expect(EmbedPage({ params: { component: "x.png" } })).rejects.toThrow("NOT_FOUND");
  });

  it("404s for a non-admin", async () => {
    gate.result = { userId: "", error: "Not authorized — admin role required" };

    await expect(EmbedPage({ params: { component: "button" } })).rejects.toThrow("NOT_FOUND");
  });

  it("renders the embed client with the slug for an admin", async () => {
    gate.result = { userId: "admin-1", error: null };

    const el = await EmbedPage({ params: { component: "button" } });

    expect(el.type).toBe(EmbedClient);
    expect(el.props.slug).toBe("button");
  });
});
