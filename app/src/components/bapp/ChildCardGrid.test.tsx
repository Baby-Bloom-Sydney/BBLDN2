/**
 * The nanny's add-child sheet on arrival (06b-4 rework addition, BAI 2026-11-12: "an option to 'Add Family' which would
 * take them to the part of the app where nannies are able to invite their own families"): `openAddOnArrival` starts the
 * nanny's `AddChildSheet` open, on arrival only. Without it, or for a parent, the grid is today's: nothing opens.
 *
 * BB-wave1-041126/06b4-ui, 2026-11-12.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/nanny",
  useSearchParams: () => new URLSearchParams(),
}));

import type { ChildClient } from "@/types/bapp";
import { ChildCardGrid } from "./ChildCardGrid";

afterEach(cleanup);

const NO_CHILDREN = { children: [] as ChildClient[] };

describe("ChildCardGrid — the nanny's add-child sheet on arrival", () => {
  it("a nanny with openAddOnArrival: the add-child sheet is open on arrival", () => {
    render(<ChildCardGrid {...NO_CHILDREN} role="nanny" openAddOnArrival />);
    expect(screen.getByRole("dialog", { name: "Add a Child" })).toBeInTheDocument();
  });

  it("without it: nothing open, today's grid", () => {
    render(<ChildCardGrid {...NO_CHILDREN} role="nanny" />);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("button", { name: "Add Child" })).toBeInTheDocument();
  });

  it("a parent with it: nothing opens (the prop is the nanny's only)", () => {
    render(<ChildCardGrid {...NO_CHILDREN} role="parent" openAddOnArrival />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("closed by her, it stays closed: the prop is read on arrival only", async () => {
    const view = render(<ChildCardGrid {...NO_CHILDREN} role="nanny" openAddOnArrival />);
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    view.rerender(<ChildCardGrid {...NO_CHILDREN} role="nanny" openAddOnArrival />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
