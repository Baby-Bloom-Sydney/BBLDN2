import { Card, CardContent } from "@/components/ui/card";
import { AlertCircle } from "lucide-react";
import { getPosition, PositionWithChildren } from "@/lib/actions/parent";
import {
  getParentPlacement,
  getConfirmedConnections,
  getParentUpcomingIntros,
} from "@/lib/actions/position-funnel";
import { getDfyStatus } from "@/lib/actions/matching";
import { getParentExpiredConnections, getParentOpenRequestCount } from "@/lib/actions/expired-connections";
import { getParentBabysittingRequests } from "@/lib/actions/babysitting";
import { babysittingEnabled, callBookingEnabled } from "@/lib/features/flags";
import { getPendingInvitesForUser } from "@/lib/actions/bapp/child-invites";
import { POSITION_STAGE } from "@/lib/position/constants";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { ParentHubClient } from "./ParentHubClient";
import type { ChildClient } from "@/types/bapp";
import { ChildcareCall } from "@/components/calls/ChildcareCall";
import { slotAtLine } from "@/lib/calls/copy";
import { parseCallAt, parseCallPopup } from "@/lib/calls/next-path";
import { slotWords } from "@/lib/calls/slot-words";
import { loadHubCall } from "@/lib/calls/parent-state";

const isDevMode = process.env.NEXT_PUBLIC_DEV_MODE === "true";

/** Brief 04 (B7, review F5): a call-card error never fails the hub. Logged by error name only. */
function noCallCard(thrown: unknown): null {
  console.error("[parent/page] the call card could not be loaded", { name: thrown instanceof Error ? thrown.name : typeof thrown });
  return null;
}

/**
 * Brief 04 (04b rework W12): the call popup's `call` param (open | booked | gone), checked; with `gone`, the time that
 * went (`at`) in London words for the notice. Anything else → null (ignored).
 */
type SearchParams = Readonly<Record<string, string | string[] | undefined>>;

/** One value, or undefined for a missing or repeated param (TS review). */
const one = (value: string | string[] | undefined): string | undefined => (typeof value === "string" ? value : undefined);

function callPopupFrom(searchParams: SearchParams) {
  const openWith = parseCallPopup(searchParams.call);
  const at = openWith === "gone" ? parseCallAt(searchParams.at) : null;
  return {
    openWith,
    goneWhen: at === null ? null : slotAtLine(slotWords(at)),
    failed: openWith === "open" && one(searchParams.failed) === "1",
  };
}

const NO_POPUP = { openWith: null, goneWhen: null, failed: false } as const;

export default async function ParentHubPage({ searchParams }: { searchParams: SearchParams }) {
  let position: PositionWithChildren | null = null;
  let error: string | null = null;

  if (!isDevMode) {
    const result = await getPosition();
    position = result.data ?? null;
    error = result.error ?? null;
  }

  // Get auth user for education children query
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const admin = createAdminClient();

  const [
    placementResult,
    connectionsResult,
    introsResult,
    dfyStatusResult,
    bsrResult,
    educationChildrenRes,
    pendingInvitesResult,
    callCard,
    expiredResult,
    pendingRequestCount,
  ] = await Promise.all([
    getParentPlacement(),
    position?.id
      ? getConfirmedConnections(position.id)
      : Promise.resolve({ data: [], error: null }),
    getParentUpcomingIntros(),
    getDfyStatus(),
    // 5c (P-23): not called while BABYSITTING_ENABLED is off, so its lazy expiry/reminder sweeps never run.
    babysittingEnabled()
      ? getParentBabysittingRequests()
      : Promise.resolve({ data: [], error: null }),
    user
      ? admin
          .from("child_client")
          .select("*")
          .eq("parent_user_id", user.id)
          .eq("under_three", true)
          .order("created_at", { ascending: true })
      : Promise.resolve({ data: [] }),
    user ? getPendingInvitesForUser() : Promise.resolve({ data: [] }),
    // Brief 04 (B7): not called while CALL_BOOKING_ENABLED is off, so no call table is read.
    callBookingEnabled() && user ? loadHubCall(user.id).catch(noCallCard) : Promise.resolve(null),
    // the connections that ran out of time while she could see them, and her open requests (the Connect form's limit)
    getParentExpiredConnections(),
    getParentOpenRequestCount(),
  ]);

  const placement = placementResult.data;
  const confirmedNannies = connectionsResult.data;
  const upcomingIntros = introsResult.data;
  const dfyTier = dfyStatusResult.tier;
  const dfyExpiresAt = dfyStatusResult.expiresAt;
  const dfyActivated = dfyStatusResult.activated;
  const babysittingRequests = bsrResult.data ?? [];
  // Brief 04 §0a.4 (04b rework W9, W12, TS review): the call card — and the popup it opens, or that `call=` opens — only
  // with the flag on and while no nanny is hired or connected; `call=` only while the call is offered to her (the
  // card's rule), else it is ignored.
  const offered = callCard?.offered === true;
  const popup = callBookingEnabled() && offered ? callPopupFrom(searchParams) : NO_POPUP;
  const card = callCard?.card ?? null;
  const showCallCard = callBookingEnabled() && !placement && confirmedNannies.length === 0 && (card !== null || popup.openWith !== null);
  const showFillButton =
    position &&
    !placement &&
    (position as PositionWithChildren & { stage?: number }).stage ===
      POSITION_STAGE.CONNECTING &&
    confirmedNannies.length > 0;

  if (error) {
    return (
      <div className="space-y-6">
        <Card>
          <CardContent className="flex items-center gap-3 py-6">
            <AlertCircle className="h-5 w-5 text-red-500" />
            <p className="text-red-600">{error}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-3">
      <ParentHubClient
        position={position}
        placement={placement}
        confirmedNannies={confirmedNannies}
        showFillButton={!!showFillButton}
        upcomingIntros={upcomingIntros}
        expiredConnections={expiredResult.data}
        pendingRequestCount={pendingRequestCount}
        dfyTier={dfyTier}
        dfyExpiresAt={dfyExpiresAt}
        dfyActivated={dfyActivated}
        babysittingRequests={babysittingRequests}
        initialTab={one(searchParams.t)}
        initialSub={one(searchParams.s)}
        initialView={one(searchParams.v)}
        educationChildren={(educationChildrenRes.data ?? []) as ChildClient[]}
        pendingInvites={pendingInvitesResult.data ?? []}
        // Brief 04 (B7, W9): only with a card — while CALL_BOOKING_ENABLED is off the props are exactly today's.
        {...(showCallCard ? { callCard: <ChildcareCall card={card} openWith={popup.openWith} goneWhen={popup.goneWhen} failed={popup.failed} /> } : {})}
      />
    </div>
  );
}
