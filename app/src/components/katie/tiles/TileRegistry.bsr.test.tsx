/**
 * Unit 5c (BB-LDN-5c-151026) — Katie's `bsr_job` tile is not offered while `BABYSITTING_ENABLED` is off: a persisted
 * tile renders nothing (so `BsrJobTile` never mounts or fetches `/api/chat/bsr/[id]`).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, cleanup } from "@testing-library/react";

const mounted = vi.hoisted(() => vi.fn());
vi.mock("./BsrJobTile", () => ({
  BsrJobTile: () => {
    mounted();
    return <div data-testid="bsr-job-tile" />;
  },
}));

import { RenderTile } from "./TileRegistry";

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  mounted.mockReset();
});

const TILE = { kind: "bsr_job", data: { id: "bsr-1" } } as const;

describe("RenderTile — bsr_job", () => {
  it("renders nothing while off", () => {
    vi.stubEnv("BABYSITTING_ENABLED", "");
    const { container } = render(<RenderTile tile={TILE} />);
    expect(container).toBeEmptyDOMElement();
    expect(mounted).not.toHaveBeenCalled();
  });

  it("renders BsrJobTile with the flag on", () => {
    vi.stubEnv("BABYSITTING_ENABLED", "true");
    const { getByTestId } = render(<RenderTile tile={TILE} />);
    expect(getByTestId("bsr-job-tile")).toBeInTheDocument();
  });
});
