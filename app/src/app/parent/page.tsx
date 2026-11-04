import { Card, CardContent } from "@/components/ui/card";
import { AlertCircle } from "lucide-react";
import { getPosition, PositionWithChildren } from "@/lib/actions/parent";
import {
  getParentPlacement,
  getConfirmedConnections,
  getParentUpcomingIntros,
} from "@/lib/actions/position-funnel";
import { getDfyStatus } from "@/lib/actions/matching";
import { getParentBabysittingRequests } from "@/lib/actions/babysitting";
import { babysittingEnabled, callBookingEnabled } from "@/lib/features/flags";
import { getPendingInvitesForUser } from "@/lib/actions/bapp/child-invites";
import { POSITION_STAGE } from "@/lib/position/constants";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { ParentHubClient } from "./ParentHubClient";
import type { ChildClient } from "@/types/bapp";
import { CallHubCard } from "@/components/calls/CallHubCard";
import { loadHubCallCard } from "@/lib/calls/parent-state";

const isDevMode = process.env.NEXT_PUBLIC_DEV_MODE === "true";

/** Brief 04 (B7, review F5): a call-card error never fails the hub. Logged by error name only. */
function noCallCard(thrown: unknown): null {
  console.error("[parent/page] the call card could not be loaded", { name: thrown instanceof Error ? thrown.name : typeof thrown });
  return null;
}

export default async function ParentHubPage({
  searchParams,
}: {
  searchParams: { t?: string; s?: string; v?: string };
}) {
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
    callBookingEnabled() && user ? loadHubCallCard(user.id).catch(noCallCard) : Promise.resolve(null),
  ]);

  const placement = placementResult.data;
  const confirmedNannies = connectionsResult.data;
  const upcomingIntros = introsResult.data;
  const dfyTier = dfyStatusResult.tier;
  const dfyExpiresAt = dfyStatusResult.expiresAt;
  const dfyActivated = dfyStatusResult.activated;
  const babysittingRequests = bsrResult.data ?? [];
  // Brief 04 §0a.4 (04b rework W9): the call card only while no nanny is hired or connected.
  const showCallCard = callCard !== null && !placement && confirmedNannies.length === 0;
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
        dfyTier={dfyTier}
        dfyExpiresAt={dfyExpiresAt}
        dfyActivated={dfyActivated}
        babysittingRequests={babysittingRequests}
        initialTab={searchParams.t}
        initialSub={searchParams.s}
        initialView={searchParams.v}
        educationChildren={(educationChildrenRes.data ?? []) as ChildClient[]}
        pendingInvites={pendingInvitesResult.data ?? []}
        // Brief 04 (B7, W9): only with a card — while CALL_BOOKING_ENABLED is off the props are exactly today's.
        {...(showCallCard ? { callCard: <CallHubCard card={callCard} /> } : {})}
      />
    </div>
  );
}
