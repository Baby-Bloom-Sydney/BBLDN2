/**
 * The one save the Calendar forms share (plan C5; 04c-1 review round 2 M3): an in-flight ref, so a double click sends
 * one write (React 18.3.1's async `startTransition` clears `pending` before the promise settles, so `pending` can't be
 * the guard); `saving` held until the promise settles; a refusal as one closed line (never detail); the page refreshed
 * after a write that landed, and not after one that didn't.
 */
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const nav = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => nav }));

import { ADMIN_COPY } from "@/lib/calls/copy";
import type { CalendarCallResult } from "@/lib/calls/admin-calls";
import { useCalendarSave } from "./use-calendar-save";

const INVALID = "Check the form.";

beforeEach(() => nav.refresh.mockReset());

function deferred<T>() {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe("useCalendarSave", () => {
  it("a write that landed: its value back, 'Saved.', the page refreshed", async () => {
    const { result } = renderHook(() => useCalendarSave(INVALID));
    let value: unknown;
    await act(async () => {
      value = await result.current.run(async () => ({ ok: true, value: { blockId: "b1" } }) as const);
    });
    expect(value).toEqual({ blockId: "b1" });
    expect(result.current.status).toBe(ADMIN_COPY.saved);
    expect(result.current.error).toBeNull();
    expect(nav.refresh).toHaveBeenCalledTimes(1);
  });

  it("a done line of its own replaces 'Saved.'", async () => {
    const { result } = renderHook(() => useCalendarSave(INVALID));
    await act(async () => {
      await result.current.run(async () => ({ ok: true, value: true }) as const, "Removed.");
    });
    expect(result.current.status).toBe("Removed.");
  });

  it.each([
    ["invalid", INVALID],
    ["overlap", "Those hours overlap — change one range"],
    ["not_authorized", "Admins only."],
    ["error", "That didn't save — try again."],
  ] as const)("refused (%s) → one line, no refresh, nothing back", async (error, line) => {
    const { result } = renderHook(() => useCalendarSave(INVALID));
    let value: unknown = "unset";
    await act(async () => {
      value = await result.current.run(async (): Promise<CalendarCallResult<true>> => ({ ok: false, error }));
    });
    expect(value).toBeNull();
    expect(result.current.error).toBe(line);
    expect(result.current.status).toBe("");
    expect(nav.refresh).not.toHaveBeenCalled();
  });

  it("a double submit sends one write; saving holds until the promise settles", async () => {
    const { result } = renderHook(() => useCalendarSave(INVALID));
    const pending = deferred<CalendarCallResult<true>>();
    const action = vi.fn(() => pending.promise);
    let first: Promise<unknown> = Promise.resolve();
    act(() => {
      first = result.current.run(action);
    });
    expect(result.current.saving).toBe(true);
    await act(async () => {
      expect(await result.current.run(action)).toBeNull();
    });
    expect(action).toHaveBeenCalledTimes(1);
    await act(async () => {
      pending.resolve({ ok: true, value: true });
      await first;
    });
    expect(result.current.saving).toBe(false);
  });

  it("a throw (the network) → the failed line, and the next submit is let through", async () => {
    const { result } = renderHook(() => useCalendarSave(INVALID));
    await act(async () => {
      await result.current.run(async () => {
        throw new Error("fetch failed");
      });
    });
    expect(result.current.error).toBe("That didn't save — try again.");
    const action = vi.fn(async () => ({ ok: true, value: true }) as const);
    await act(async () => {
      await result.current.run(action);
    });
    expect(action).toHaveBeenCalledTimes(1);
    expect(result.current.error).toBeNull();
  });
});
