import { notFound } from "next/navigation";
import { depositLinkEnabled } from "@/lib/features/flags";
import { InvalidDepositLink } from "./InvalidDepositLink";

/**
 * A plain `/deposit` with no code (brief 03 §3 parent 8): the same one invalid page as any bad code. Switch off → 404.
 * Nothing is read.
 *
 * BB-wave2-231126/03-build, 2026-11-25.
 */
export const dynamic = "force-dynamic";

export default function DepositIndexPage() {
  if (!depositLinkEnabled()) notFound();
  return <InvalidDepositLink />;
}
