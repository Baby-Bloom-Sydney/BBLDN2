"use client";

/**
 * /admin/calls with JustCall logging on (plan 05 §5 B6; D1). BB-wave2-231126/05-build.
 *
 * 04's `CallsClient`, unchanged, with brief 05's two slots filled — a server page can't pass a function across to the
 * client, so this small client wrapper makes them:
 * - `callsTabExtra`: the Unmatched JustCall calls, after the Calls tab's sections;
 * - `renderAttemptAction`: JustCall's lines and **Add outcome** under each past attempt in her drawer.
 * A dismiss, an attach or a save refreshes the page (the server re-reads). `page.tsx` renders this only while
 * `JUSTCALL_WEBHOOK_ENABLED` is on; otherwise `CallsClient` exactly as today.
 */

import { useRouter } from "next/navigation";
import { JustCallAttemptAction } from "@/components/calls/justcall/AddOutcome";
import { UnmatchedCalls } from "@/components/calls/justcall/UnmatchedCalls";
import type { UnmatchedList } from "@/lib/justcall/types";
import { CallsClient, type CallsClientProps } from "./CallsClient";

export interface JustCallCallsClientProps extends Omit<CallsClientProps, "callsTabExtra" | "renderAttemptAction"> {
  /** Null: the Unmatched list couldn't be read (its section says so). */
  readonly unmatched: UnmatchedList | null;
}

export function JustCallCallsClient({ unmatched, ...props }: JustCallCallsClientProps) {
  const router = useRouter();
  const refresh = () => router.refresh();
  return (
    <CallsClient
      {...props}
      callsTabExtra={<UnmatchedCalls list={unmatched} onChanged={refresh} />}
      renderAttemptAction={(attempt, family) => <JustCallAttemptAction attempt={attempt} family={family} onSaved={refresh} />}
    />
  );
}
