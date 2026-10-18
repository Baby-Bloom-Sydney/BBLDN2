import { getPositionSharePageData, createShareRecord } from "@/lib/actions/viral-loop";
import { generatePositionPost } from "@/lib/viral-loop/generate-position-post";
import { SHARE_CASE_TYPE } from "@/lib/viral-loop/constants";
import { PositionShareClient } from "./PositionShareClient";
import { notFound, redirect } from "next/navigation";
import { shareLoopEnabled } from "@/lib/features/flags";

export default async function PositionSharePage() {
  // 5b (P-23): the share loop is hidden unless SHARE_LOOP_ENABLED is "true" — 404 before any read.
  if (!shareLoopEnabled()) notFound();

  const { data, error } = await getPositionSharePageData();

  if (error || !data) {
    console.error('[PositionSharePage] Redirect reason:', error);
    redirect("/parent/matches");
  }

  // Always generate fresh (template-based, fast)
  if (!data.sharePost) {
    data.sharePost = generatePositionPost({
      firstName: data.firstName,
      suburb: data.suburb,
      children: data.children,
      daysRequired: data.daysRequired,
      hoursPerWeek: data.hoursPerWeek,
      hourlyRate: data.hourlyRate,
      scheduleType: data.scheduleType,
      startTiming: null,
    });
  }

  // Auto-create share record if it doesn't exist
  if (!data.share) {
    const { share } = await createShareRecord(
      SHARE_CASE_TYPE.PARENT_POSITION,
      data.positionId
    );
    if (share) {
      data.share = share;
    }
  }

  return <PositionShareClient initialData={data} />;
}
