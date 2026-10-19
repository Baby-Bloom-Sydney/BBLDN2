import { getBsrSharePageData, createShareRecord } from "@/lib/actions/viral-loop";
import { generateBsrPost } from "@/lib/viral-loop/generate-bsr-post";
import { SHARE_CASE_TYPE } from "@/lib/viral-loop/constants";
import { createAdminClient } from "@/lib/supabase/admin";
import { BsrShareClient } from "./BsrShareClient";
import { notFound, redirect } from "next/navigation";
import { shareLoopEnabled } from "@/lib/features/flags";

export default async function BsrSharePage({
  params,
}: {
  params: { id: string };
}) {
  // 5b (P-23): the share loop is hidden unless SHARE_LOOP_ENABLED is "true" — 404 before any read.
  if (!shareLoopEnabled()) notFound();

  const { data, error } = await getBsrSharePageData(params.id);

  if (error || !data) {
    console.error('[BsrSharePage] Redirect reason:', error, '| data:', data);
    redirect("/parent/babysitting");
  }

  // Generate share post on-demand if missing
  if (!data.sharePost && data.timeSlots.length > 0) {
    const post = generateBsrPost({
      firstName: data.firstName,
      suburb: data.suburb,
      timeSlots: data.timeSlots,
      children: data.children,
      hourlyRate: data.hourlyRate ?? 40,
      specialRequirements: null,
    });

    // Persist to BSR record
    const admin = createAdminClient();
    await admin
      .from('babysitting_requests')
      .update({
        ai_content: {
          share_post: post,
          generated_at: new Date().toISOString(),
          generator: 'template_v1',
        },
      })
      .eq('id', data.bsrId);

    data.sharePost = post;
  }

  // Auto-create share record if it doesn't exist
  if (!data.share) {
    const { share } = await createShareRecord(
      SHARE_CASE_TYPE.PARENT_BSR,
      data.bsrId
    );
    if (share) {
      data.share = share;
    }
  }

  return <BsrShareClient initialData={data} />;
}
