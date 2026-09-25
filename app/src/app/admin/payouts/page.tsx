import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/admin/require-admin";
import { Card, CardContent } from "@/components/ui/card";

/**
 * `/admin/payouts` — nanny payouts overview (S19).
 *
 * Spec: `system/APP/PAYMENTS/FRONTEND/03-build-spec.md` §S19.
 *
 * Counters at top + recent payouts table. Helps Bailey spot
 * blocked-on-onboarding nannies + frozen earnings + upcoming
 * releases.
 */
export default async function AdminNannyPayoutsPage() {
  await requireAdmin();
  const admin = createAdminClient();

  const now = new Date();
  const sevenDaysFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  const [
    { count: releasingCount, data: releasing },
    { count: frozenCount, data: frozen },
    { data: blockedNannies },
  ] = await Promise.all([
    admin
      .from("nanny_payouts")
      .select(
        "id, nanny_user_id, parent_user_id, amount_aud_cents, status, scheduled_release_at",
        { count: "exact" },
      )
      .in("status", ["pending", "held"])
      .gte("scheduled_release_at", now.toISOString())
      .lte("scheduled_release_at", sevenDaysFromNow.toISOString())
      .order("scheduled_release_at", { ascending: true })
      .limit(50)
      .returns<
        Array<{
          id: string;
          nanny_user_id: string;
          parent_user_id: string;
          amount_aud_cents: number;
          status: string;
          scheduled_release_at: string;
        }>
      >(),
    admin
      .from("nanny_payouts")
      .select("id, nanny_user_id, amount_aud_cents, status", {
        count: "exact",
      })
      .eq("status", "frozen")
      .limit(50)
      .returns<
        Array<{
          id: string;
          nanny_user_id: string;
          amount_aud_cents: number;
          status: string;
        }>
      >(),
    // Nannies with payment_application_status != 'verified' but who
    // have pending payouts scheduled — they need to onboard.
    admin
      .from("nannies")
      .select(
        "id, user_id, payout_application_status, stripe_connect_account_id",
      )
      .neq("payout_application_status", "verified")
      .limit(20)
      .returns<
        Array<{
          id: string;
          user_id: string;
          payout_application_status: string;
          stripe_connect_account_id: string | null;
        }>
      >(),
  ]);

  const releasingTotalCents = (releasing ?? []).reduce(
    (a, r) => a + r.amount_aud_cents,
    0,
  );
  const frozenTotalCents = (frozen ?? []).reduce(
    (a, r) => a + r.amount_aud_cents,
    0,
  );

  // Resolve nanny names from user_profiles in one batch.
  const allNannyUserIds = Array.from(
    new Set([
      ...(releasing ?? []).map((r) => r.nanny_user_id),
      ...(frozen ?? []).map((r) => r.nanny_user_id),
      ...(blockedNannies ?? []).map((r) => r.user_id),
    ]),
  );
  const { data: profiles } = allNannyUserIds.length
    ? await admin
        .from("user_profiles")
        .select("user_id, first_name, last_name, email")
        .in("user_id", allNannyUserIds)
        .returns<
          Array<{
            user_id: string;
            first_name: string | null;
            last_name: string | null;
            email: string | null;
          }>
        >()
    : { data: [] };
  const profileByUser = new Map(profiles?.map((p) => [p.user_id, p]) ?? []);

  return (
    <div className="mx-auto max-w-5xl px-4 py-12">
      <h1 className="text-2xl font-bold text-slate-900">
        Nanny payouts overview
      </h1>

      <div className="mt-6 grid grid-cols-1 gap-3 md:grid-cols-3">
        <SummaryTile
          label="Releasing in 7 days"
          count={releasingCount ?? 0}
          totalCents={releasingTotalCents}
        />
        <SummaryTile
          label="Frozen earnings"
          count={frozenCount ?? 0}
          totalCents={frozenTotalCents}
        />
        <SummaryTile
          label="Awaiting Connect onboarding"
          count={blockedNannies?.length ?? 0}
        />
      </div>

      <h2 className="mt-10 text-lg font-semibold text-slate-900">
        Upcoming releases (next 7 days)
      </h2>
      <Card className="mt-2">
        <CardContent className="p-0">
          {!releasing || releasing.length === 0 ? (
            <p className="p-6 text-sm text-slate-600">
              No payouts scheduled in the next 7 days.
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-2">Nanny</th>
                  <th className="px-4 py-2">Amount</th>
                  <th className="px-4 py-2">Status</th>
                  <th className="px-4 py-2">Releases</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {releasing.map((r) => {
                  const p = profileByUser.get(r.nanny_user_id);
                  return (
                    <tr key={r.id}>
                      <td className="px-4 py-3 font-medium text-slate-900">
                        {[p?.first_name, p?.last_name]
                          .filter(Boolean)
                          .join(" ") ||
                          p?.email ||
                          r.nanny_user_id.slice(0, 8)}
                      </td>
                      <td className="px-4 py-3 text-slate-700">
                        A${(r.amount_aud_cents / 100).toFixed(2)}
                      </td>
                      <td className="px-4 py-3 text-slate-500">{r.status}</td>
                      <td className="px-4 py-3 text-slate-500">
                        {formatDate(r.scheduled_release_at)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      {blockedNannies && blockedNannies.length > 0 && (
        <>
          <h2 className="mt-10 text-lg font-semibold text-slate-900">
            Nannies still to onboard with Stripe Connect
          </h2>
          <Card className="mt-2">
            <CardContent className="p-0">
              <ul className="divide-y divide-slate-100 text-sm">
                {blockedNannies.map((n) => {
                  const p = profileByUser.get(n.user_id);
                  return (
                    <li key={n.id} className="px-6 py-3">
                      <p className="font-medium text-slate-900">
                        {[p?.first_name, p?.last_name]
                          .filter(Boolean)
                          .join(" ") ||
                          p?.email ||
                          n.user_id.slice(0, 8)}
                      </p>
                      <p className="text-xs text-slate-500">
                        Status: {n.payout_application_status}{" "}
                        {n.stripe_connect_account_id
                          ? `· Stripe account ${n.stripe_connect_account_id.slice(0, 12)}…`
                          : "· no Stripe account yet"}
                      </p>
                    </li>
                  );
                })}
              </ul>
            </CardContent>
          </Card>
        </>
      )}

      <div className="mt-8">
        <Link
          href="/admin/subscriptions"
          className="text-sm text-violet-700 hover:underline"
        >
          ← Subscriptions overview
        </Link>
      </div>
    </div>
  );
}

function SummaryTile({
  label,
  count,
  totalCents,
}: {
  label: string;
  count: number;
  totalCents?: number;
}) {
  return (
    <Card>
      <CardContent className="space-y-1 p-4">
        <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
          {label}
        </p>
        <p className="text-2xl font-bold text-slate-900">{count}</p>
        {totalCents !== undefined && (
          <p className="text-sm text-slate-600">
            A${(totalCents / 100).toFixed(2)}
          </p>
        )}
      </CardContent>
    </Card>
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
