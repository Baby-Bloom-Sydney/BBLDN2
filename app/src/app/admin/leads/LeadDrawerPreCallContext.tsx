// T-032 — One-line stitched pre-call context strip (no AI, just templated).

import type { LeadDetail } from "@/lib/leads/fetch-lead-detail";

interface LeadDrawerPreCallContextProps {
  detail: LeadDetail;
}

import { formatLeadDateTime } from "@/lib/leads/format";

function composeContext(detail: LeadDetail): string {
  const parts: string[] = [];

  if (detail.nanny?.created_at) {
    parts.push(`Signed up ${formatLeadDateTime(detail.nanny.created_at)}`);
  }

  const v = detail.verifications;
  const verBadges: string[] = [];
  if (v?.identity_verified === true) verBadges.push("ID");
  if (v?.wwcc_verified === true) verBadges.push("WWCC");
  if (detail.user_profile?.profile_picture_url) verBadges.push("photo");
  if (detail.nanny?.abn) verBadges.push("ABN");
  if (verBadges.length > 0) parts.push(`${verBadges.join(" + ")} done`);
  else parts.push("no verification yet");

  const childrenTotal = detail.children_linked.length;
  const childrenLinked = detail.children_linked.filter(
    (c) => c.parent_connected,
  ).length;
  if (childrenTotal > 0) {
    parts.push(
      `${childrenTotal} ${childrenTotal === 1 ? "child" : "children"} on account` +
        (childrenLinked < childrenTotal
          ? ` (${childrenLinked} parent-linked)`
          : ""),
    );
  } else {
    parts.push("no children on account");
  }

  // T-023 lead signal — surface prominently if the nanny already nannies an
  // under-3 outside BB. That makes them a warm bonus-program upsell candidate
  // and the operator should know before the call starts.
  const leadSignals = (detail.nanny_lead as Record<string, unknown> | null)
    ?.lead_signals;
  const externalU3 =
    leadSignals && typeof leadSignals === "object"
      ? (leadSignals as Record<string, unknown>).external_u3_position
      : undefined;
  if (externalU3 === true) {
    parts.push("⚡ external U3 position");
  }

  const positionsCount = detail.interview_requests.length;
  if (positionsCount > 0) {
    parts.push(
      `${positionsCount} ${positionsCount === 1 ? "position" : "positions"} applied`,
    );
  }

  if (detail.nanny?.bonus_program_completed_at) {
    parts.push("contributions complete");
  } else {
    parts.push("contributions incomplete");
  }

  return parts.join(" · ");
}

export function LeadDrawerPreCallContext({
  detail,
}: LeadDrawerPreCallContextProps) {
  return (
    <div className="rounded-md bg-violet-50 px-3 py-2 text-sm text-violet-900 ring-1 ring-inset ring-violet-200">
      <span className="text-[10px] font-semibold uppercase tracking-wide text-violet-700">
        Pre-call{" "}
      </span>
      <span className="ml-1">{composeContext(detail)}</span>
    </div>
  );
}
