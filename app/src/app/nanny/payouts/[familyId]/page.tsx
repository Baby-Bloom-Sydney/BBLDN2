import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

/**
 * `/nanny/payouts/[familyId]` — per-family detail (S12).
 *
 * v1 scope: header + per-cycle status + past payouts list + back link.
 * The withdraw-flow state machine (state-A explainer, state-B Connect
 * onboarding, state-C Express dashboard link) extends here once
 * Phase E lands.
 */
export default async function FamilyPayoutDetailPage({
  params,
}: {
  params: { familyId: string };
}) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=/nanny/payouts/${params.familyId}`);

  const admin = createAdminClient();

  // Confirm this nanny actually serves a child in this family —
  // otherwise the route is just a parent_user_id probe.
  const { data: child } = await admin
    .from("child_client")
    .select("id, first_name")
    .eq("nanny_user_id", user.id)
    .eq("parent_user_id", params.familyId)
    .maybeSingle<{ id: string; first_name: string | null }>();
  if (!child) redirect("/nanny/payouts");

  const [{ data: parentProfile }, { data: payouts }] = await Promise.all([
    admin
      .from("user_profiles")
      .select("first_name")
      .eq("user_id", params.familyId)
      .maybeSingle<{ first_name: string | null }>(),
    admin
      .from("nanny_payouts")
      .select("id, amount_aud_cents, status, paid_at, scheduled_release_at")
      .eq("nanny_user_id", user.id)
      .eq("parent_user_id", params.familyId)
      .order("scheduled_release_at", { ascending: false })
      .limit(24)
      .returns<
        Array<{
          id: string;
          amount_aud_cents: number;
          status: string;
          paid_at: string | null;
          scheduled_release_at: string;
        }>
      >(),
  ]);

  const parentName = parentProfile?.first_name ?? "the parent";
  const childName = child.first_name ?? "your charge";

  return (
    <div className="mx-auto max-w-2xl px-4 py-12">
      <Link
        href="/nanny/payouts"
        className="text-sm text-slate-500 hover:text-slate-700"
      >
        ← Back to payouts
      </Link>

      <h1 className="mt-4 text-2xl font-bold text-slate-900">
        {parentName}&apos;s family — {childName}
      </h1>

      <Card className="mt-6">
        <CardContent className="p-6">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
            Past payouts
          </p>
          {!payouts || payouts.length === 0 ? (
            <p className="mt-3 text-sm text-slate-600">
              No payouts yet for this family.
            </p>
          ) : (
            <ul className="mt-4 divide-y divide-slate-100">
              {payouts.map((p) => (
                <li
                  key={p.id}
                  className="flex items-center justify-between py-3 text-sm"
                >
                  <span className="font-medium text-slate-900">
                    A${(p.amount_aud_cents / 100).toFixed(2)}
                  </span>
                  <span className="text-slate-500">
                    {p.status === "paid" && p.paid_at
                      ? `Paid ${formatDate(p.paid_at)}`
                      : `${p.status} · scheduled ${formatDate(p.scheduled_release_at)}`}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <div className="mt-6">
        <Button asChild className="bg-violet-600 hover:bg-violet-700">
          <Link href="/nanny/payouts/onboarding">Set up payouts</Link>
        </Button>
      </div>
    </div>
  );
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}
