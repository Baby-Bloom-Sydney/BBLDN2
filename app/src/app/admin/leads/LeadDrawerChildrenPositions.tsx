// T-032 — Children + positions + placements + babysitting summary in the drawer.
//
// "Children" here = every child_client row on the nanny's account (not just
// invite-accepted ones). Each row shows the child's first name + age + whether
// the parent is connected to BB + (if connected) parent name as a hyperlink
// to /admin/users?openUser={id} + parent subscription status.

import Link from "next/link";
import { Heart, Briefcase, Baby, ExternalLink } from "lucide-react";
import type { LeadDetail } from "@/lib/leads/fetch-lead-detail";

interface LeadDrawerChildrenPositionsProps {
  detail: LeadDetail;
}

import { formatLeadDate } from "@/lib/leads/format";

const fmt = formatLeadDate;

function ageLabel(
  ageMonths: number | null | undefined,
  dob: string | null | undefined,
): string | null {
  const months = (() => {
    if (typeof ageMonths === "number" && ageMonths >= 0) return ageMonths;
    if (dob) {
      const d = new Date(dob);
      if (Number.isNaN(d.getTime())) return null;
      return Math.floor(
        (Date.now() - d.getTime()) / (30.44 * 24 * 60 * 60 * 1000),
      );
    }
    return null;
  })();
  if (months === null) return null;
  if (months < 24) return `${months}mo`;
  const years = Math.floor(months / 12);
  const remMonths = months % 12;
  return remMonths === 0 ? `${years}y` : `${years}y ${remMonths}mo`;
}

function parentName(
  parentUserId: string | null | undefined,
  directory: LeadDetail["parent_directory"],
): string {
  if (!parentUserId) return "—";
  const p = directory[parentUserId];
  if (!p) return parentUserId.slice(0, 8);
  return (
    `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim() ||
    p.email ||
    parentUserId.slice(0, 8)
  );
}

interface ParentLinkProps {
  parentUserId: string | null | undefined;
  directory: LeadDetail["parent_directory"];
}

function ParentLink({ parentUserId, directory }: ParentLinkProps) {
  if (!parentUserId) {
    return <span className="text-slate-400">parent not on Baby Bloom</span>;
  }
  const name = parentName(parentUserId, directory);
  return (
    <Link
      href={`/admin/users?openUser=${parentUserId}`}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-0.5 font-medium text-violet-600 hover:text-violet-800 hover:underline"
      title="Open parent in User Management"
    >
      {name}
      <ExternalLink className="h-2.5 w-2.5" aria-hidden="true" />
    </Link>
  );
}

interface SubscriptionBadgeProps {
  parentUserId: string | null | undefined;
  subs: LeadDetail["subscription_directory"];
}

function SubscriptionBadge({ parentUserId, subs }: SubscriptionBadgeProps) {
  if (!parentUserId) return null;
  const sub = subs[parentUserId];
  if (!sub) {
    return (
      <span
        className="rounded bg-slate-50 px-1.5 py-0.5 text-[10px] font-medium text-slate-500 ring-1 ring-inset ring-slate-200"
        title="No subscription row found for this parent"
      >
        no subscription
      </span>
    );
  }
  const tone =
    sub.status === "trial"
      ? "bg-blue-50 text-blue-700 ring-blue-200"
      : sub.status === "active_monthly" || sub.status === "active_upfront"
        ? "bg-green-50 text-green-700 ring-green-200"
        : sub.status === "past_due"
          ? "bg-amber-50 text-amber-700 ring-amber-200"
          : sub.status === "cancelled" || sub.status === "lapsed"
            ? "bg-red-50 text-red-700 ring-red-200"
            : "bg-slate-50 text-slate-600 ring-slate-200";
  const label = sub.status.replace(/_/g, " ");
  const endsAt = sub.trial_ends_at ?? sub.paid_period_ends_at;
  const suffix = endsAt
    ? sub.status === "trial"
      ? ` · trial ends ${fmt(sub.trial_ends_at)}`
      : sub.status.startsWith("active")
        ? ` · renews ${fmt(sub.paid_period_ends_at)}`
        : sub.status === "cancelled"
          ? ` · cancelled ${fmt(sub.cancelled_at)}`
          : ""
    : "";
  return (
    <span
      className={`rounded px-1.5 py-0.5 text-[10px] font-medium ring-1 ring-inset ${tone}`}
      title={`Subscription: ${label}${suffix}`}
    >
      {label}
      {suffix && <span className="font-normal opacity-80">{suffix}</span>}
    </span>
  );
}

export function LeadDrawerChildrenPositions({
  detail,
}: LeadDrawerChildrenPositionsProps) {
  const children = detail.children_linked;
  const totalChildren = children.length;
  const parentLinkedCount = children.filter((c) => c.parent_connected).length;
  const activePlacements = detail.placements.filter(
    (p) => p.status === "active",
  );

  return (
    <section className="space-y-3">
      {/* Children */}
      <div>
        <h3 className="mb-1 flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
          <Heart className="h-3 w-3" />
          Children on account
          <span className="font-normal text-slate-400">
            ({totalChildren} total
            {totalChildren > 0 ? ` · ${parentLinkedCount} parent-linked` : ""})
          </span>
        </h3>
        {totalChildren === 0 ? (
          <p className="rounded border border-dashed border-slate-200 px-2 py-2 text-xs text-slate-400">
            No children on this nanny&apos;s account.{" "}
            {!detail.nanny?.bonus_program_completed_at && (
              <span className="text-violet-700">
                Bonus contributions not set up yet — upsell opportunity.
              </span>
            )}
          </p>
        ) : (
          <ul className="space-y-1.5">
            {children.slice(0, 10).map((c) => {
              const childLabel =
                c.child_first_name ?? `Child ${c.child_client_id.slice(0, 8)}`;
              const age = ageLabel(
                c.child_age_months_approx,
                c.child_date_of_birth,
              );
              return (
                <li
                  key={c.child_client_id}
                  className="rounded border border-slate-200 bg-white px-2 py-1.5 text-xs"
                >
                  {/* Row 1: child name + age + badges + status */}
                  <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5">
                    <div className="flex flex-wrap items-center gap-x-1.5">
                      <span className="font-medium text-slate-800">
                        {childLabel}
                      </span>
                      {age && <span className="text-slate-500">({age})</span>}
                      {c.bonus_program && (
                        <span
                          className="rounded bg-violet-50 px-1 py-0.5 text-[10px] font-medium text-violet-700"
                          title="Child added via bonus contributions program"
                        >
                          ★ bonus
                        </span>
                      )}
                    </div>
                    <span className="text-[10px] text-slate-500">
                      {c.child_status} · added {fmt(c.created_at)}
                    </span>
                  </div>
                  {/* Row 2: parent connection + subscription */}
                  <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-slate-600">
                    <span className="text-slate-400">parent:</span>
                    <ParentLink
                      parentUserId={c.parent_user_id}
                      directory={detail.parent_directory}
                    />
                    {c.parent_connected && (
                      <SubscriptionBadge
                        parentUserId={c.parent_user_id}
                        subs={detail.subscription_directory}
                      />
                    )}
                    {!c.parent_connected && c.invite_status && (
                      <span
                        className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 ring-1 ring-inset ring-amber-200"
                        title="An invite exists but the parent hasn't joined Baby Bloom yet"
                      >
                        invite {c.invite_status}
                      </span>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Positions / interviews */}
      <div>
        <h3 className="mb-1 flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
          <Briefcase className="h-3 w-3" />
          Positions applied
          <span className="font-normal text-slate-400">
            ({detail.interview_requests.length})
          </span>
        </h3>
        {detail.interview_requests.length === 0 ? (
          <p className="rounded border border-dashed border-slate-200 px-2 py-2 text-xs text-slate-400">
            No position applications.
          </p>
        ) : (
          <ul className="space-y-1">
            {detail.interview_requests.slice(0, 6).map((r) => (
              <li
                key={r.id}
                className="rounded border border-slate-200 bg-white px-2 py-1.5 text-xs"
              >
                <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5">
                  <div className="flex flex-wrap items-center gap-x-1.5">
                    <span className="font-medium text-slate-800">
                      Position {r.position_id?.slice(0, 8) ?? "—"}
                    </span>
                  </div>
                  <span className="text-[10px] text-slate-500">
                    {r.status}
                    {r.outcome ? ` · ${r.outcome}` : ""} · {fmt(r.created_at)}
                  </span>
                </div>
                <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-slate-600">
                  <span className="text-slate-400">parent:</span>
                  <ParentLink
                    parentUserId={r.parent_id}
                    directory={detail.parent_directory}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Placements */}
      <div>
        <h3 className="mb-1 flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
          <Briefcase className="h-3 w-3" />
          Placements
          <span className="font-normal text-slate-400">
            ({activePlacements.length} active / {detail.placements.length}{" "}
            total)
          </span>
        </h3>
        {detail.placements.length === 0 ? (
          <p className="rounded border border-dashed border-slate-200 px-2 py-2 text-xs text-slate-400">
            No placements yet.
          </p>
        ) : (
          <ul className="space-y-1">
            {detail.placements.slice(0, 4).map((p) => (
              <li
                key={p.id}
                className="rounded border border-slate-200 bg-white px-2 py-1.5 text-xs"
              >
                <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5">
                  <div className="flex flex-wrap items-center gap-x-1.5">
                    <span className="font-medium text-slate-800">
                      Hired {fmt(p.hired_at)}
                    </span>
                    {p.source && (
                      <span className="text-slate-500">via {p.source}</span>
                    )}
                  </div>
                  <span className="text-[10px] text-slate-500">
                    {p.status}
                    {p.end_reason ? ` · ${p.end_reason}` : ""}
                  </span>
                </div>
                <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-slate-600">
                  <span className="text-slate-400">parent:</span>
                  <ParentLink
                    parentUserId={p.parent_id}
                    directory={detail.parent_directory}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Babysitting */}
      {detail.babysitting_notifications.length > 0 && (
        <div>
          <h3 className="mb-1 flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
            <Baby className="h-3 w-3" />
            Babysitting offers
            <span className="font-normal text-slate-400">
              ({detail.babysitting_notifications.length})
            </span>
          </h3>
          <p className="rounded border border-slate-200 bg-white px-2 py-1 text-xs text-slate-600">
            {
              detail.babysitting_notifications.filter((b) => b.accepted_at)
                .length
            }{" "}
            accepted ·{" "}
            {
              detail.babysitting_notifications.filter((b) => b.declined_at)
                .length
            }{" "}
            declined · last notified{" "}
            {fmt(detail.babysitting_notifications[0]?.notified_at)}
          </p>
        </div>
      )}
    </section>
  );
}
