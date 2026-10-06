/**
 * Unit 3b (BB-LDN-3b-061026) — profile "Enhanced DBS" glance: one trigger with the hub, level ≥ 3 (brief change 10;
 * copy deck §5.3; P-7). The old per-row verified flag no longer drives it.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/nanny/profile",
}));
vi.mock("@/lib/actions/nanny", () => ({
  updateNannyProfile: vi.fn(),
  updateNannyAIContent: vi.fn(),
  regenerateNannyAIContent: vi.fn(),
}));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({}) }));
vi.mock("@/lib/supabase/storage", () => ({ uploadFile: vi.fn() }));

import { NannyMyProfile } from "./NannyMyProfile";
import { nannyProfileFixture } from "@/lib/dbs/fixtures.test-util";

afterEach(cleanup);

function show(level: number, staleFlag: boolean) {
  render(<NannyMyProfile profile={nannyProfileFixture(level, staleFlag)} />);
  fireEvent.click(screen.getByRole("button", { name: "Experience" }));
}

describe("NannyMyProfile — Enhanced DBS glance", () => {
  it("shows the 'Enhanced DBS' glance at level 3", () => {
    show(3, false);
    expect(screen.getByText("Enhanced DBS")).toBeInTheDocument();
  });

  it("shows no 'Enhanced DBS' glance at level 2, even with a stale verified flag", () => {
    show(2, true);
    expect(screen.queryByText("Enhanced DBS")).toBeNull();
  });

  it("shows the 'Enhanced DBS' glance at level 4", () => {
    show(4, true);
    expect(screen.getByText("Enhanced DBS")).toBeInTheDocument();
  });
});
