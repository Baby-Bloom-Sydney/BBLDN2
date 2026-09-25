// T-032 — Curated activity timeline. Reverse-chronological list of meaningful
// events from the source tables (activity_logs subset + user_progress +
// payouts + emails + consent + placements).

import {
  Activity,
  ShieldCheck,
  CreditCard,
  Mail,
  FileCheck,
  Briefcase,
  Heart,
  User as UserIcon,
  Wallet,
} from "lucide-react";
import type { TimelineEvent, TimelineEventCategory } from "@/lib/leads/types";

interface LeadDrawerActivityTimelineProps {
  events: TimelineEvent[];
}

const CATEGORY_ICON: Record<
  TimelineEventCategory,
  React.ComponentType<{ className?: string }>
> = {
  signup: UserIcon,
  profile: UserIcon,
  verification: ShieldCheck,
  position: Briefcase,
  babysitting: Briefcase,
  placement: Briefcase,
  payout: Wallet,
  subscription: CreditCard,
  child: Heart,
  consent: FileCheck,
  email: Mail,
  admin: ShieldCheck,
  other: Activity,
};

import { formatLeadDateTime } from "@/lib/leads/format";

const fmt = formatLeadDateTime;

export function LeadDrawerActivityTimeline({
  events,
}: LeadDrawerActivityTimelineProps) {
  return (
    <section>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
        Activity timeline{" "}
        <span className="font-normal text-slate-400">({events.length})</span>
      </h3>
      {events.length === 0 ? (
        <p className="rounded-md border border-dashed border-slate-200 px-3 py-4 text-center text-xs text-slate-400">
          No activity yet.
        </p>
      ) : (
        <ol className="space-y-2">
          {events.map((event, i) => {
            const Icon = CATEGORY_ICON[event.category] ?? Activity;
            return (
              <li
                key={`${event.event_at}-${i}`}
                className="flex items-start gap-2"
              >
                <div className="mt-0.5 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500">
                  <Icon className="h-3 w-3" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="text-sm text-slate-900">{event.title}</p>
                    <time
                      className="flex-shrink-0 text-[10px] text-slate-400"
                      title={event.event_at}
                    >
                      {fmt(event.event_at)}
                    </time>
                  </div>
                  {event.detail && (
                    <p className="mt-0.5 text-xs text-slate-500">
                      {event.detail}
                    </p>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
