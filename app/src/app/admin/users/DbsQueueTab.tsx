"use client";

/**
 * The DBS sub-tab's four lists (unit 3d, brief change 9; #25, #30, #35, #36):
 * A Awaiting approval (30) · B Needs a person (21 + API down) · C Re-check alerts (approved once, now 23/26) ·
 * D Barred (27, collapsed). "Review" opens `DBSCheckModal` with the list, which decides the actions shown.
 * Props: the split queues from `getDbsQueues`. Never: writes anything or re-sorts the lists (the server sorted A).
 */
import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/dashboard/EmptyState";
import { UserAvatar } from "@/components/dashboard/UserAvatar";
import { StatusBadge } from "@/components/dashboard/StatusBadge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatRelativeTime } from "@/lib/utils";
import { STATUS_LABELS, statusTone } from "@/lib/verification";
import { hasRecordChip, isApiDownState, whyHereChip, type DbsListKey, type DbsQueues, type PendingDbsCheck } from "@/lib/admin/dbs-queues";
import { DBSCheckModal } from "./DBSCheckModal";
import { Check, Copy, FileText } from "lucide-react";

function CopyCell({ value }: { value: string | null }) {
  const [copied, setCopied] = useState(false);
  if (!value) return <span className="text-slate-400">-</span>;
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        navigator.clipboard.writeText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      className="group flex items-center gap-1 text-left hover:text-violet-600 transition-colors"
      title="Click to copy"
    >
      <span>{value}</span>
      {copied ? <Check className="h-3 w-3 text-green-600" /> : <Copy className="h-3 w-3 text-slate-300 group-hover:text-violet-400" />}
    </button>
  );
}

function Chip({ tone, children }: { tone: "amber" | "grey" | "red" | "violet"; children: React.ReactNode }) {
  const cls = {
    amber: "bg-amber-100 text-amber-800",
    grey: "bg-slate-100 text-slate-600",
    red: "bg-red-100 text-red-700",
    violet: "bg-violet-100 text-violet-700",
  }[tone];
  return <span className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-medium ${cls}`}>{children}</span>;
}

function chipsFor(c: PendingDbsCheck, list: DbsListKey) {
  const chips: React.ReactNode[] = [];
  if (list === "awaiting" && hasRecordChip(c)) chips.push(<Chip key="rec" tone="amber">Has a record</Chip>);
  if (list === "needsPerson") {
    if (isApiDownState(c)) {
      chips.push(<Chip key="api" tone="grey">API not answering{c.api_down_since ? ` since ${formatRelativeTime(c.api_down_since)}` : ""}</Chip>);
    } else {
      const why = whyHereChip(c);
      if (why) chips.push(<Chip key="why" tone="violet">{why}</Chip>);
    }
  }
  if (list === "recheckAlerts") {
    chips.push(
      <Chip key="rc" tone="red">
        {c.verification_status === 23 ? "New information" : "No Update Service match"}
        {c.ocg_verified_at ? `, checked ${formatRelativeTime(c.ocg_verified_at)}` : ""}
      </Chip>,
    );
  }
  return chips;
}

const LISTS: { key: DbsListKey; title: string; description: string; empty: string }[] = [
  { key: "awaiting", title: "A. Awaiting approval", description: "Update Service passed — approve to make her fully verified", empty: "Nobody is awaiting approval." },
  { key: "needsPerson", title: "B. Needs a person", description: "AI unsure, name/DOB mismatch, manual review asked, or the API was not answering", empty: "Nothing needs a person." },
  { key: "recheckAlerts", title: "C. Re-check alerts", description: "Approved once, then the Update Service reported a change", empty: "No re-check alerts." },
  { key: "barred", title: "D. Barred", description: "Suspended; only Lift bar", empty: "Nobody is barred." },
];

function QueueTable({ rows, list, onReview }: { rows: PendingDbsCheck[]; list: DbsListKey; onReview: (c: PendingDbsCheck) => void }) {
  return (
    <div className="overflow-x-auto -mx-4 sm:mx-0">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Nanny</TableHead>
            <TableHead>Certificate no.</TableHead>
            <TableHead>Since</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Action</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((c) => {
            const name = `${c.first_name || ""} ${c.last_name || ""}`.trim() || "Unknown";
            const tone = statusTone(c.verification_status);
            return (
              <TableRow key={c.id}>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <UserAvatar name={name} imageUrl={c.profile_picture_url || undefined} className="h-7 w-7" />
                    <div>
                      <p className="text-sm font-medium">{name}</p>
                      <p className="text-xs text-slate-400">{c.email}</p>
                      <div className="mt-0.5 flex flex-wrap gap-1">{chipsFor(c, list)}</div>
                    </div>
                  </div>
                </TableCell>
                <TableCell><CopyCell value={c.extracted_wwcc_number} /></TableCell>
                <TableCell><span className="text-sm text-slate-500">{formatRelativeTime(c.wwcc_status_at ?? c.created_at)}</span></TableCell>
                <TableCell>
                  <StatusBadge variant={tone === "unattempted" ? "pending" : tone}>
                    {STATUS_LABELS[c.verification_status] || `Unknown (${c.verification_status})`}
                  </StatusBadge>
                </TableCell>
                <TableCell className="text-right">
                  <Button size="sm" variant="outline" onClick={() => onReview(c)}>Review</Button>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

export function DbsQueueTab({ queues }: { queues: DbsQueues<PendingDbsCheck> }) {
  const [selected, setSelected] = useState<{ check: PendingDbsCheck; list: DbsListKey } | null>(null);

  return (
    <Card>
      <CardHeader>
        <CardTitle>DBS decisions</CardTitle>
        <CardDescription>Certificate, AI and Update Service result ({queues.badgeCount} to decide)</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {LISTS.map(({ key, title, description, empty }) => {
          const rows = queues[key];
          const body = rows.length > 0
            ? <QueueTable rows={rows} list={key} onReview={(check) => setSelected({ check, list: key })} />
            : <EmptyState icon={FileText} title={empty} description="" />;
          if (key === "barred") {
            return (
              <details key={key} className="rounded-lg border p-3">
                <summary className="cursor-pointer text-sm font-semibold text-slate-700">{title} ({rows.length})</summary>
                <p className="mb-2 text-xs text-slate-500">{description}</p>
                {body}
              </details>
            );
          }
          return (
            <section key={key} aria-labelledby={`dbs-list-${key}`}>
              <h3 id={`dbs-list-${key}`} className="text-sm font-semibold text-slate-700">{title} ({rows.length})</h3>
              <p className="mb-2 text-xs text-slate-500">{description}</p>
              {body}
            </section>
          );
        })}
      </CardContent>
      <DBSCheckModal
        check={selected?.check ?? null}
        list={selected?.list ?? "awaiting"}
        open={!!selected}
        onOpenChange={(open) => !open && setSelected(null)}
      />
    </Card>
  );
}
