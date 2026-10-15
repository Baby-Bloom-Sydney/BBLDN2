import { notFound } from "next/navigation";
import { legacyTierCheckoutEnabled } from "@/lib/features/flags";
import { MatchmakerClient } from "./MatchmakerClient";

export default function MatchmakerPage() {
  // 5g (P-23): this page only redirects into the hidden tier checkout.
  if (!legacyTierCheckoutEnabled()) notFound();
  return <MatchmakerClient />;
}
