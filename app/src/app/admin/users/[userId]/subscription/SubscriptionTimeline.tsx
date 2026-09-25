import { Card, CardContent } from "@/components/ui/card";
import {
  CreditCard,
  Banknote,
  Baby,
  RotateCcw,
  Wrench,
  Wallet,
} from "lucide-react";
import { formatAuDate } from "@/lib/format/date";
import { formatClockHourMinute } from "@/lib/timezone";
import type { TimelineCategory, TimelineEntry } from "./build-timeline";

interface Props {
  entries: TimelineEntry[];
}

const CATEGORY_VISUAL: Record<
  TimelineCategory,
  {
    icon: typeof Wallet;
    iconBg: string;
    iconColor: string;
  }
> = {
  subscription: {
    icon: CreditCard,
    iconBg: "bg-violet-100",
    iconColor: "text-violet-700",
  },
  billing: {
    icon: Banknote,
    iconBg: "bg-emerald-100",
    iconColor: "text-emerald-700",
  },
  commission: {
    icon: Wallet,
    iconBg: "bg-sky-100",
    iconColor: "text-sky-700",
  },
  child: {
    icon: Baby,
    iconBg: "bg-rose-100",
    iconColor: "text-rose-700",
  },
  refund: {
    icon: RotateCcw,
    iconBg: "bg-amber-100",
    iconColor: "text-amber-700",
  },
  system: {
    icon: Wrench,
    iconBg: "bg-slate-100",
    iconColor: "text-slate-600",
  },
};

export function SubscriptionTimeline({ entries }: Props) {
  return (
    <section className="mt-8">
      <h2 className="text-sm font-medium uppercase tracking-wide text-slate-500">
        Activity timeline
      </h2>
      <Card className="mt-3">
        <CardContent className="p-0">
          {entries.length === 0 ? (
            <p className="p-6 text-sm text-slate-600">
              No activity recorded yet for this subscription.
            </p>
          ) : (
            <ol className="divide-y divide-slate-100">
              {entries.map((entry) => (
                <li key={entry.id}>
                  <TimelineRow entry={entry} />
                </li>
              ))}
            </ol>
          )}
        </CardContent>
      </Card>
    </section>
  );
}

function TimelineRow({ entry }: { entry: TimelineEntry }) {
  const visual = CATEGORY_VISUAL[entry.category];
  const Icon = visual.icon;
  return (
    <div className="flex items-start gap-4 px-5 py-4">
      <div
        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${visual.iconBg}`}
      >
        <Icon className={`h-4 w-4 ${visual.iconColor}`} aria-hidden="true" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-slate-900">{entry.title}</p>
        {entry.detail && (
          <p className="mt-0.5 text-xs text-slate-600">{entry.detail}</p>
        )}
      </div>
      <div className="shrink-0 text-right">
        <p className="text-xs font-medium text-slate-700">
          {formatAuDate(entry.timestampIso)}
        </p>
        <p className="text-xs text-slate-500">
          {formatTimeOnly(entry.timestampIso)}
        </p>
      </div>
    </div>
  );
}

function formatTimeOnly(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return formatClockHourMinute(d.getHours(), d.getMinutes());
}
