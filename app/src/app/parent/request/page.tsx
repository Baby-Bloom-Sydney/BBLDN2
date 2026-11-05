import { parseCallAt } from "@/lib/calls/next-path";
import { callBookingEnabled } from "@/lib/features/flags";
import { TypeformFlow } from "./TypeformFlow";

/**
 * The in-app position form. Brief 04 §0a.6 (04b rework W11): a parent with no position who picked a call time
 * arrives with `?callAt=` — checked here (an instant with an offset; anything else ignored) and handed to the flow,
 * which opens on its intro (W15) and books the time as her once the position is saved. Without it — or with call
 * booking off — today's flow.
 */
export default function ParentRequestPage({ searchParams = {} }: { searchParams?: { callAt?: string | string[] } }) {
  const callAt = callBookingEnabled() ? parseCallAt(searchParams.callAt) : null;
  return callAt === null ? <TypeformFlow /> : <TypeformFlow callAt={callAt} />;
}
