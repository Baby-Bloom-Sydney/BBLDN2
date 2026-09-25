"use client";

/**
 * JobMatchTile — id-only interactive tile for a DFY match
 * notification. Nanny-only.
 *
 * Live-fetches from /api/chat/job-matches/[id]. No write actions
 * inline — applying happens via the connections flow or the main
 * /nanny/jobs page. The tile provides enough detail for the nanny
 * to decide whether to dig in.
 */

import { useEffect, useState } from "react";
import {
  Briefcase,
  ArrowRight,
  Loader2,
  AlertCircle,
  MapPin,
  Users,
} from "lucide-react";
import type { JobMatchChatTile } from "@/lib/chat/tiles";
import { useTileNavigation } from "./use-tile-navigation";
import { BRAND } from "@/lib/constants";

interface JobMatchLiveData {
  id: string;
  position_id: string;
  suburb: string | null;
  distance: string;
  hours_per_week: number | null;
  hourly_rate: number | null;
  days_required: string[];
  urgency: string | null;
  start_date: string | null;
  children: string;
  parent_first_name: string;
  requirements: string[];
  description: string | null;
  reason_for_nanny: string[];
  level_of_support: string[];
  placement_length: string | null;
}

interface ApiError {
  error: string;
}

function isError(value: unknown): value is ApiError {
  return (
    typeof value === "object" &&
    value !== null &&
    "error" in value &&
    typeof (value as { error?: unknown }).error === "string"
  );
}

export function JobMatchTile({ tile }: { tile: JobMatchChatTile }) {
  const { id } = tile.data;
  const [state, setState] = useState<
    | { kind: "loading" }
    | { kind: "ready"; data: JobMatchLiveData }
    | { kind: "error"; message: string }
  >({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const response = await fetch(`/api/chat/job-matches/${id}`, {
          cache: "no-store",
        });
        const body: unknown = await response.json();
        if (cancelled) return;
        if (!response.ok) {
          const msg = isError(body) ? body.error : "Failed to load match.";
          setState({ kind: "error", message: msg });
          return;
        }
        setState({ kind: "ready", data: body as JobMatchLiveData });
      } catch (err) {
        if (cancelled) return;
        setState({
          kind: "error",
          message: err instanceof Error ? err.message : "Failed to load match.",
        });
      }
    };
    load();
    const handleFocus = () => void load();
    window.addEventListener("focus", handleFocus);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", handleFocus);
    };
  }, [id]);

  if (state.kind === "loading") {
    return (
      <article className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Loading match…
        </div>
      </article>
    );
  }

  if (state.kind === "error") {
    return (
      <article className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
        <div className="flex items-center gap-2 text-xs text-red-600">
          <AlertCircle className="h-3.5 w-3.5" />
          {state.message}
        </div>
      </article>
    );
  }

  const d = state.data;

  return <JobMatchBody d={d} />;
}

function JobMatchBody({ d }: { d: JobMatchLiveData }) {
  const navProps = useTileNavigation("/nanny/jobs");
  return (
    <article
      {...navProps}
      aria-label={`Open match: ${d.parent_first_name}'s family`}
      className="cursor-pointer rounded-xl border border-emerald-200 bg-gradient-to-br from-emerald-50/60 to-white p-3 shadow-sm transition-shadow hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 focus-visible:ring-offset-2 focus-visible:ring-offset-white"
    >
      <header className="flex items-center gap-2">
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-emerald-100">
          <Briefcase className="h-3.5 w-3.5 text-emerald-600" />
        </div>
        <span className="text-xs font-medium text-emerald-700">
          Open position match
        </span>
      </header>

      <div className="mt-3 space-y-2">
        <p className="text-sm font-semibold text-slate-900">
          {d.parent_first_name}&apos;s family
        </p>

        <div className="flex items-center gap-1.5 text-xs text-slate-500">
          <MapPin className="h-3 w-3" />
          {d.suburb ?? BRAND.city} — {d.distance}
        </div>

        {d.hours_per_week != null || d.hourly_rate != null ? (
          <p className="text-xs text-slate-600">
            {d.hours_per_week != null ? `${d.hours_per_week}h/week` : ""}
            {d.hours_per_week != null && d.hourly_rate != null ? " · " : ""}
            {d.hourly_rate != null ? `$${d.hourly_rate}/hr` : ""}
          </p>
        ) : null}

        {d.days_required.length > 0 ? (
          <p className="text-xs text-slate-600">{d.days_required.join(", ")}</p>
        ) : null}

        <div className="flex items-center gap-1.5 text-xs text-slate-500">
          <Users className="h-3 w-3" />
          {d.children}
        </div>

        {d.requirements.length > 0 ? (
          <div className="flex flex-wrap gap-1 pt-1">
            {d.requirements.map((req) => (
              <span
                key={req}
                className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-600"
              >
                {req}
              </span>
            ))}
          </div>
        ) : null}

        {d.description ? (
          <p className="line-clamp-3 text-xs italic text-slate-500">
            {d.description}
          </p>
        ) : null}

        <p className="inline-flex items-center gap-1 pt-1 text-sm font-medium text-emerald-700">
          View match details
          <ArrowRight className="h-3.5 w-3.5" />
        </p>
      </div>
    </article>
  );
}
