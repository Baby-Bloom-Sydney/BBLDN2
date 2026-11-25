/**
 * A plain `/deposit` with no code (brief 03 §3 parent 8): the same one invalid page. Switch off → 404. Nothing is read.
 */
import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ notFound: vi.fn(), clients: 0 }));
vi.mock("next/navigation", () => ({
  notFound: () => {
    h.notFound();
    throw new Error("NEXT_NOT_FOUND");
  },
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => {
    h.clients += 1;
    throw new Error("no read on /deposit");
  },
}));

import { PAGE_COPY } from "@/lib/deposit/copy";
import DepositIndexPage, { dynamic } from "./page";

beforeEach(() => {
  vi.stubEnv("DEPOSIT_LINK_ENABLED", "true");
  vi.stubEnv("COHORTS_ENABLED", "true");
  h.notFound.mockReset();
  h.clients = 0;
});
afterEach(() => vi.unstubAllEnvs());

describe("/deposit", () => {
  it("is rendered per request", () => {
    expect(dynamic).toBe("force-dynamic");
  });

  it.each([
    ["DEPOSIT_LINK_ENABLED unset", "DEPOSIT_LINK_ENABLED", ""],
    ["COHORTS_ENABLED off", "COHORTS_ENABLED", "false"],
  ])("%s → 404", (_label, name, value) => {
    vi.stubEnv(name, value);
    expect(() => DepositIndexPage()).toThrow("NEXT_NOT_FOUND");
  });

  it("on → the one invalid page, with no read", () => {
    render(DepositIndexPage());
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(PAGE_COPY.invalid);
    expect(h.clients).toBe(0);
  });
});
