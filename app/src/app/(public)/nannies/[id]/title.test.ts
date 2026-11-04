/** Brief 12 B5: a public nanny profile's title says "nanny", not "Nanny & Babysit", while babysitting is off. */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/actions/nanny", () => ({
  getPublicNannyProfile: vi.fn(async () => ({
    data: { first_name: "Sophie", suburb: "Clapham", ai_content: { parent_pitch: "A pitch." } },
  })),
}));

afterEach(() => vi.unstubAllEnvs());

async function title(): Promise<string> {
  const { generateMetadata } = await import("./page");
  const meta = await generateMetadata({ params: { id: "n-1" } });
  return String(meta.title);
}

describe("public nanny profile title (brief 12 §0.4, §0.5; §11 Q2 default)", () => {
  it("off: 'now has availability to nanny'", async () => {
    vi.stubEnv("BABYSITTING_ENABLED", "");
    expect(await title()).toBe("Sophie now has availability to nanny | see availability now");
  });

  it("on: today's 'Nanny & Babysit'", async () => {
    vi.stubEnv("BABYSITTING_ENABLED", "true");
    expect(await title()).toBe("Sophie now has availability to Nanny & Babysit | see availability now");
  });
});
