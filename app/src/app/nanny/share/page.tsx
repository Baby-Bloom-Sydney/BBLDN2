import { getNannySharePageData, createShareRecord } from "@/lib/actions/viral-loop";
import { SHARE_CASE_TYPE } from "@/lib/viral-loop/constants";
import { NannyShareClient } from "./NannyShareClient";
import { notFound, redirect } from "next/navigation";
import { shareLoopEnabled } from "@/lib/features/flags";

export default async function NannySharePage() {
  // 5b (P-23): the share loop is hidden unless SHARE_LOOP_ENABLED is "true" — 404 before any read.
  if (!shareLoopEnabled()) notFound();

  const { data, error } = await getNannySharePageData();

  if (error || !data) {
    console.error('[NannySharePage] Redirect reason:', error, '| data:', data);
    redirect("/nanny");
  }

  // Auto-create share record if it doesn't exist
  if (!data.share) {
    const { share } = await createShareRecord(
      SHARE_CASE_TYPE.NANNY_PROFILE,
      data.nannyId
    );
    if (share) {
      data.share = share;
    }
  }

  return <NannyShareClient initialData={data} />;
}
