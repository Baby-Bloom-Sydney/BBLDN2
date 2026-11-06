"use client";

/**
 * The one save the Calendar tab's forms share (plan C5; BB-wave1-041126/04c2-build), the 04c-1 `useOutcomeSave` way
 * (review round 2 M3):
 *
 * - an in-flight ref, so a double click sends one write — React 18.3.1's async `startTransition` clears `pending`
 *   before the promise settles, so `pending` can't be the guard;
 * - `saving` held until the promise settles: the buttons say so and are `aria-disabled` (`BUSY_LOOK`), never
 *   `disabled`, so the focused button keeps focus (React review M4) — the in-flight ref is the guard;
 * - a refusal as one closed line (`calendarErrorLine`, the form's own line for `invalid`), never detail; a throw (the
 *   network) as the failed line;
 * - the page refreshed after a write that landed (fresh props, no remount, so the status line stays), and after a
 *   `not_found` (the page is stale: a block already removed elsewhere leaves the list); never after another refusal.
 */

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { CalendarCallResult } from "@/lib/calls/admin-calls";
import { ADMIN_COPY, calendarErrorLine } from "@/lib/calls/copy";

/** A button whose save is in flight: looks disabled, stays focusable (`aria-disabled`). */
export const BUSY_LOOK = "aria-disabled:cursor-not-allowed aria-disabled:opacity-50";

export interface CalendarSave {
  readonly saving: boolean;
  readonly error: string | null;
  readonly status: string;
  /** Run one write; its value when it landed, null when refused, failed, or another is still in flight. */
  readonly run: <T>(action: () => Promise<CalendarCallResult<T>>, doneLine?: string) => Promise<T | null>;
  /** Clear the error and the status (a dialog opened again starts clean). */
  readonly reset: () => void;
}

export function useCalendarSave(invalidLine: string): CalendarSave {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const inFlight = useRef(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState("");

  const run = async <T,>(action: () => Promise<CalendarCallResult<T>>, doneLine: string = ADMIN_COPY.saved): Promise<T | null> => {
    if (inFlight.current) return null;
    inFlight.current = true;
    setSaving(true);
    setError(null);
    setStatus("");
    try {
      const result = await action();
      if (!result.ok) {
        setError(calendarErrorLine(result.error, invalidLine));
        if (result.error === "not_found") startTransition(() => router.refresh());
        return null;
      }
      setStatus(doneLine);
      startTransition(() => router.refresh());
      return result.value;
    } catch {
      setError(calendarErrorLine("error", invalidLine));
      return null;
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  };

  const reset = () => {
    setError(null);
    setStatus("");
  };

  return { saving, error, status, run, reset };
}
