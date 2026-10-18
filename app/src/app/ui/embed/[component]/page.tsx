import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/admin/require-admin";
import { EmbedClient } from "./EmbedClient";

/**
 * Demo embed — admin only (5a, R-1). The middleware matcher skips paths ending
 * in an image extension, so `/ui/embed/x.png` reaches this page without the
 * middleware's admin gate; this check is the lock that holds there.
 */
export default async function EmbedPage({ params }: { params: { component: string } }) {
  const { error } = await requireAdmin();
  if (error) notFound();

  return <EmbedClient slug={params.component} />;
}
