"use client";

/**
 * One save at a time (b3.3). React 18.3.1 batches state, and `useTransition` doesn't track an async transition, so two
 * submits (a double Enter, a double tap) can both run before anything re-renders; a ref can't be stale.
 *
 * - The same call while one is in flight gets the same promise: the action runs once and both callers see its answer.
 * - A different call (other arguments) while one is in flight gets `busy(...)` when given — never the first call's
 *   outcome, which would report a save that never ran (06b-3 TypeScript review M1). Without `busy`, it shares too.
 * - Once the call settles — resolved or rejected — the next one runs the latest function.
 *
 * 06b-4's first-invoice setup reuses it.
 *
 * BB-wave1-041126/06b3-build, 2026-11-07.
 */

import { useCallback, useEffect, useRef } from "react";

interface InFlight<R> {
  readonly key: string;
  readonly call: Promise<R>;
}

export function useSingleFlight<A extends unknown[], R>(
  work: (...args: A) => Promise<R>,
  busy?: (...args: A) => R,
): (...args: A) => Promise<R> {
  const latest = useRef({ work, busy });
  const inFlight = useRef<InFlight<R> | null>(null);

  useEffect(() => {
    latest.current = { work, busy };
  }, [work, busy]);

  return useCallback((...args: A): Promise<R> => {
    const key = JSON.stringify(args);
    const now = inFlight.current;
    if (now) {
      const answer = latest.current.busy;
      return now.key === key || answer === undefined ? now.call : Promise.resolve(answer(...args));
    }
    const call = latest.current.work(...args).finally(() => {
      inFlight.current = null;
    });
    inFlight.current = { key, call };
    return call;
  }, []);
}
