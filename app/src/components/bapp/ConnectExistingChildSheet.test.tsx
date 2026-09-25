/**
 * The validation logic itself is covered by `lib/invite/extract-token.test.ts`.
 * This file covers the user-facing behaviour of the sheet:
 * - valid paste → router.push to /invite/{token}
 * - malformed paste → inline error, no navigation
 * - clearing the input clears the error
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

const state = vi.hoisted(() => ({
  pushCalls: [] as string[],
}));

beforeEach(() => {
  state.pushCalls = [];
});

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: (url: string) => state.pushCalls.push(url) }),
}));

import { ConnectExistingChildSheet } from "./ConnectExistingChildSheet";
import { SITE_URL } from "@/lib/constants";

const VALID_URL = `${SITE_URL}/invite/ABCD-2345`;

function renderOpen(role: "nanny" | "parent" = "parent") {
  return render(
    <ConnectExistingChildSheet
      open={true}
      onOpenChange={() => {}}
      role={role}
    />,
  );
}

describe("ConnectExistingChildSheet", () => {
  it("routes to /invite/{token} when a valid URL is submitted", () => {
    renderOpen("parent");
    fireEvent.change(screen.getByLabelText(/invite link/i), {
      target: { value: VALID_URL },
    });
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));
    expect(state.pushCalls).toEqual(["/invite/ABCD-2345"]);
  });

  it("shows an inline validation error for a malformed URL and does not navigate", () => {
    renderOpen("parent");
    fireEvent.change(screen.getByLabelText(/invite link/i), {
      target: { value: "https://lookalike.example.com/invite/ABCD-2345" },
    });
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));
    expect(state.pushCalls).toEqual([]);
    expect(screen.getByRole("alert")).toHaveTextContent(/invite link/i);
  });

  it("clears the error when the user edits the input again", () => {
    renderOpen("parent");
    const input = screen.getByLabelText(/invite link/i);
    fireEvent.change(input, { target: { value: "garbage" } });
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));
    expect(screen.getByRole("alert")).toBeInTheDocument();
    fireEvent.change(input, { target: { value: "https://" } });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("varies the body copy by role (parent expects link from nanny)", () => {
    renderOpen("parent");
    expect(screen.getByText(/your nanny sent you/i)).toBeInTheDocument();
  });

  it("varies the body copy by role (nanny expects link from parent)", () => {
    renderOpen("nanny");
    expect(screen.getByText(/your parent sent you/i)).toBeInTheDocument();
  });

  it("disables Continue when the input is empty", () => {
    renderOpen("parent");
    expect(screen.getByRole("button", { name: /continue/i })).toBeDisabled();
  });
});
