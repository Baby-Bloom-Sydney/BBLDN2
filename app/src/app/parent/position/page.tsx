import { Card, CardContent } from "@/components/ui/card";
import { AlertCircle } from "lucide-react";
import { getPosition, PositionWithChildren } from "@/lib/actions/parent";
import { getParentPlacement, getConfirmedConnections, getParentUpcomingIntros } from "@/lib/actions/position-funnel";
import { getDfyStatus } from "@/lib/actions/matching";
import { getParentExpiredConnections, getParentOpenRequestCount } from "@/lib/actions/expired-connections";
import { getParentBabysittingRequests } from "@/lib/actions/babysitting";
import { POSITION_STAGE } from "@/lib/position/constants";
import { PositionPageClient } from "./PositionPageClient";

const isDevMode = process.env.NEXT_PUBLIC_DEV_MODE === 'true';

export default async function ParentPositionPage() {
  let position: PositionWithChildren | null = null;
  let error: string | null = null;

  if (!isDevMode) {
    const result = await getPosition();
    position = result.data ?? null;
    error = result.error ?? null;
  }

  // Fetch placement + confirmed connections for Path B + upcoming intros
  const [placementResult, connectionsResult, introsResult, dfyStatusResult, bsrResult, expiredResult, pendingRequestCount] = await Promise.all([
    getParentPlacement(),
    position?.id ? getConfirmedConnections(position.id) : Promise.resolve({ data: [], error: null }),
    getParentUpcomingIntros(),
    getDfyStatus(),
    getParentBabysittingRequests(),
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
  const showFillButton = position && !placement &&
    (position as PositionWithChildren & { stage?: number }).stage === POSITION_STAGE.CONNECTING &&
    confirmedNannies.length > 0;

  if (error) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">My Childcare</h1>
          <p className="mt-1 text-slate-500">Create and manage your childcare position</p>
        </div>
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
    <div className="space-y-6">
      <PositionPageClient
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
      />
    </div>
  );
}
