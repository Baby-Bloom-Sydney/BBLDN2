import Link from "next/link";
import { notFound } from "next/navigation";
import { Button } from "@/components/ui/button";
import { logFailure } from "@/lib/cohorts/db";
import { donePaid, PAGE_COPY, PAGE_MORE_COPY } from "@/lib/deposit/copy";
import { proveDepositCode } from "@/lib/deposit/proof";
import { readDepositDone } from "@/lib/deposit/session";
import { depositLinkEnabled } from "@/lib/features/flags";
import { createAdminClient } from "@/lib/supabase/admin";
import { DepositNotice, DepositTryAgain, InvalidDepositLink } from "../../InvalidDepositLink";

/**
 * `/deposit/<code>/done?session=…` — where Stripe returns her after paying (plan 03 §3 "Done"; brief 03 §0.3, §3
 * parent 4). The switch first (off → 404 before any read), then the code proven. 03a's done check asks Stripe
 * whether that session is paid AND is this link's and this parent's, so it confirms straight away, before the
 * webhook lands:
 * - paid → "Payment received. Your place in the cohort starting … is confirmed." (the cohort of the place that
 *   session holds or took; "Payment received. Thank you." when none is found);
 * - not paid → "We haven't received your payment yet. Try again." with the way back to `/deposit/<code>`;
 * - someone else's session, or anything but one session id → the one invalid page.
 * It writes nothing; no login is read (D15).
 *
 * BB-wave2-231126/03-build, 2026-11-25.
 */
export const dynamic = "force-dynamic";

interface PageProps {
  readonly params: { readonly code: string };
  readonly searchParams: Readonly<Record<string, string | string[] | undefined>>;
}

export default async function DepositDonePage(props: PageProps) {
  if (!depositLinkEnabled()) notFound();
  try {
    return await donePage(props);
  } catch (thrown) {
    logFailure("deposit done page", thrown); // by name only
    return <DepositTryAgain />;
  }
}

/** After the switch: the code, then the done check. Any throw becomes the try-again line (03c review L). */
async function donePage({ params, searchParams }: PageProps) {
  const admin = createAdminClient();
  const proven = await proveDepositCode(admin, params.code);
  if (!proven.ok) return proven.status === "invalid" ? <InvalidDepositLink /> : <DepositTryAgain />;
  const done = await readDepositDone(admin, proven.proof, searchParams.session);
  if (done.result === "paid") return <DepositNotice heading={donePaid(done.cohortStartDate)} tone="success" />;
  if (done.result !== "not_paid") return <InvalidDepositLink />;
  return (
    <DepositNotice heading={PAGE_COPY.doneNotPaid}>
      <Button asChild size="lg" className="w-full bg-violet-600 text-base hover:bg-violet-700">
        <Link href={`/deposit/${params.code}`}>{PAGE_MORE_COPY.doneBackLink}</Link>
      </Button>
    </DepositNotice>
  );
}
