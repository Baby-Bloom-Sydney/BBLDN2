"use client";

/**
 * The call slide, the client (`/matchmaking/call`; brief 04 §0a.1, §3 parent 2–4; plan B6; 04b rework W3, W5): her
 * booking panel in the funnel's shell, onward to the checked `next` (labelled by where it goes), and straight into
 * changing her time with `?change=1`. Every line arrives preformatted from the server; nothing here formats a time.
 * Actions: `./actions.ts`.
 *
 * BB-wave1-041126/04b-build, 2026-11-04; BB-wave1-041126/04b-rework, 2026-11-05.
 */

import { CallBookingPanel } from "@/components/calls/CallBookingPanel";
import { onwardFor } from "@/lib/calls/next-path";
import type { MyCallView } from "@/lib/calls/parent-view";

export interface CallPageClientProps {
  readonly initial: MyCallView;
  readonly nextHref: string;
  /** `?change=1`: straight into picking a new time for her booking. */
  readonly startChanging?: boolean;
}

export function CallPageClient({ initial, nextHref, startChanging = false }: CallPageClientProps) {
  return <CallBookingPanel initial={initial} onward={onwardFor(nextHref)} startChanging={startChanging} />;
}
