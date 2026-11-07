"use client";

/**
 * One save at a time (b3.3). React 18.3.1 batches state, so two submits (a double Enter, a double tap) can both run
 * before `isPending` re-renders; a ref can't be stale. While a call is in flight, another call gets the same promise:
 * the action runs once and both callers see its answer. Once it settles — resolved or rejected — the next call runs
 * the latest function. 06b-4's first-invoice setup reuses it.
 *
 * BB-wave1-041126/06b3-build, 2026-11-07.
 */

import { useCallback, useEffect, useRef } from "react";

export function useSingleFlight<A extends unknown[], R>(work: (...args: A) => Promise<R>): (...args: A) => Promise<R> {
  const latest = useRef(work);
  const inFlight = useRef<Promise<R> | null>(null);

  useEffect(() => {
    latest.current = work;
  }, [work]);

  return useCallback((...args: A): Promise<R> => {
    if (inFlight.current) return inFlight.current;
    const call = latest.current(...args).finally(() => {
      inFlight.current = null;
    });
    inFlight.current = call;
    return call;
  }, []);
}
