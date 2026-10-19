/**
 * Unit 5b (BB-LDN-5b-151026) — `/nanny/positions` and `/nanny/babysitting` mount their clients without a
 * `shareUnlocked` prop, and the prop's old default (`false`) rendered a "share to unlock" link to `/nanny/share`.
 * While `SHARE_LOOP_ENABLED` is off the default is unlocked, so no share link renders (P-23). Flag on → as before.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  usePathname: () => "/nanny/positions",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/lib/actions/babysitting", () => ({
  requestBabysittingJob: vi.fn(),
  declineBabysittingRequest: vi.fn(),
  nannyCancelBabysittingRequest: vi.fn(),
}));
vi.mock("@/lib/legal/record-consent", () => ({ recordInformedAction: vi.fn() }));

import { NannyBabysittingClient } from "./babysitting/NannyBabysittingClient";
import { NannyPositionsClient } from "./positions/NannyPositionsClient";

afterEach(() => vi.unstubAllEnvs());

const shareLink = () => document.querySelector('a[href="/nanny/share"]');
const MOUNTS: Array<[string, () => void]> = [
  ["/nanny/positions (NannyPositionsClient, no prop)", () => render(<NannyPositionsClient placements={[]} />)],
  ["/nanny/babysitting (NannyBabysittingClient, no prop)", () => render(<NannyBabysittingClient jobs={[]} banned={false} banUntil={null} />)],
];

describe.each(MOUNTS)("%s", (_name, mount) => {
  it("off → no share-to-unlock link", () => {
    vi.stubEnv("SHARE_LOOP_ENABLED", "");
    mount();
    expect(shareLink()).toBeNull();
  });
  it("on → the share-to-unlock link as before", () => {
    vi.stubEnv("SHARE_LOOP_ENABLED", "true");
    mount();
    expect(shareLink()).not.toBeNull();
  });
});
