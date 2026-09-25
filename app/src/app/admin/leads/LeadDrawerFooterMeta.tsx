// T-032 — Drawer footer metadata. Created · source · assigned operator · user-id cross-link.

import Link from "next/link";
import type { LeadDetail } from "@/lib/leads/fetch-lead-detail";
import { formatLeadDateTime } from "@/lib/leads/format";

interface LeadDrawerFooterMetaProps {
  detail: LeadDetail;
}

function extractSource(
  nannyLead: Record<string, unknown> | null,
): string | null {
  if (!nannyLead) return null;
  const signals = nannyLead.lead_signals as Record<string, unknown> | undefined;
  if (signals && typeof signals === "object") {
    const src = signals.recruitment_agent_source;
    if (typeof src === "string") return src;
  }
  return null;
}

export function LeadDrawerFooterMeta({ detail }: LeadDrawerFooterMetaProps) {
  const source = extractSource(detail.nanny_lead);

  return (
    <footer className="mt-4 border-t border-slate-200 pt-3 text-[10px] text-slate-400">
      <dl className="grid grid-cols-2 gap-x-3 gap-y-1">
        <div>
          <dt className="uppercase">Created</dt>
          <dd>
            {detail.nanny?.created_at
              ? formatLeadDateTime(detail.nanny.created_at)
              : "—"}
          </dd>
        </div>
        <div>
          <dt className="uppercase">Last sign-in</dt>
          <dd>
            {detail.last_sign_in_at
              ? formatLeadDateTime(detail.last_sign_in_at)
              : "—"}
          </dd>
        </div>
        <div>
          <dt className="uppercase">Source</dt>
          <dd>{source ?? "—"}</dd>
        </div>
        <div>
          <dt className="uppercase">Assigned operator</dt>
          <dd>{detail.contact_state?.assigned_operator ?? "—"}</dd>
        </div>
        <div className="col-span-2">
          <dt className="uppercase">User ID</dt>
          <dd>
            <Link
              href={`/admin/users?openUser=${detail.nanny_user_id}`}
              className="text-violet-600 hover:underline"
            >
              {detail.nanny_user_id}
            </Link>
          </dd>
        </div>
      </dl>
    </footer>
  );
}
