/**
 * The in-flight guard every Business dialog's save shares (b3.3; React 18.3.1: two submits can land before a state
 * update re-renders, so `isPending` alone lets a double Enter call the action twice). A second call while the first
 * is in flight gets the first call's promise — one action call, both callers see its answer — and the next call
 * after it settles runs again, with the latest function.
 *
 * BB-wave1-041126/06b3-build, 2026-11-07.
 */
import { describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useSingleFlight } from "./useSingleFlight";

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe("useSingleFlight", () => {
  it("a second call while the first is in flight shares the first's promise: the work runs once", async () => {
    const gate = deferred<string>();
    const work = vi.fn((label: string) => gate.promise.then((v) => `${v}:${label}`));
    const { result } = renderHook(() => useSingleFlight(work));
    const first = result.current("a");
    const second = result.current("b");
    expect(second).toBe(first);
    expect(work).toHaveBeenCalledTimes(1);
    await act(async () => gate.resolve("done"));
    await expect(first).resolves.toBe("done:a");
    await expect(second).resolves.toBe("done:a");
  });

  it("with a busy answer: a call with different arguments gets it, never the first call's outcome (TS review M1)", async () => {
    const gate = deferred<string>();
    const work = vi.fn((label: string) => gate.promise.then((v) => `${v}:${label}`));
    const { result } = renderHook(() => useSingleFlight(work, () => "busy"));
    const first = result.current("a");
    expect(result.current("a")).toBe(first);
    await expect(result.current("b")).resolves.toBe("busy");
    expect(work).toHaveBeenCalledTimes(1);
    await act(async () => gate.resolve("done"));
    await expect(first).resolves.toBe("done:a");
  });

  it("after it settles (even by failing), the next call runs again", async () => {
    const work = vi.fn().mockRejectedValueOnce(new Error("boom")).mockResolvedValueOnce("ok");
    const { result } = renderHook(() => useSingleFlight(work));
    await expect(result.current()).rejects.toThrow("boom");
    await expect(result.current()).resolves.toBe("ok");
    expect(work).toHaveBeenCalledTimes(2);
  });

  it("keeps one stable function across renders, calling the latest work", async () => {
    const one = vi.fn().mockResolvedValue(1);
    const two = vi.fn().mockResolvedValue(2);
    const { result, rerender } = renderHook(({ fn }) => useSingleFlight(fn), { initialProps: { fn: one } });
    const stable = result.current;
    rerender({ fn: two });
    expect(result.current).toBe(stable);
    await expect(result.current()).resolves.toBe(2);
    expect(one).not.toHaveBeenCalled();
  });
});
