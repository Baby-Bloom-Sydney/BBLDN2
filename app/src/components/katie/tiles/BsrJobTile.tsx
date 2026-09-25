"use client";

/**
 * BsrJobTile — id-only interactive tile for a babysitting request.
 *
 * Same pattern as ConnectionRequestTile: the tile ships only the id,
 * fetches live state from /api/chat/bsr/[id] on mount + window focus.
 * The chat view never drifts from /nanny/babysitting or
 * /parent/babysitting.
 *
 * Action buttons (request / accept / decline / cancel) are NOT wired
 * directly from the tile. The tile surfaces enough info for the user
 * to act via chat (Katie has the tools) or the main page (link at
 * the bottom). This keeps the tile passive — the module handlers are
 * the single source of write truth.
 */

import { useEffect, useState } from "react";
import {
  Baby,
  ArrowRight,
  Loader2,
  AlertCircle,
  Clock,
  MapPin,
} from "lucide-react";
import type { BsrJobChatTile } from "@/lib/chat/tiles";
import { useTileNavigation } from "./use-tile-navigation";

interface BsrLiveData {
  id: string;
  role: "nanny" | "parent";
  bucket: string;
  headline: string;
  title: string | null;
  suburb: string;
  distance?: string; // nanny side
  hourly_rate: number | null;
  estimated_total: number | null;
  slots: string[];
  children: string;
  special_requirements?: string | null;
  expires: string | null;
  expires_urgent: boolean;
  clash_warning?: boolean;
  requester_count?: number | null;
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

export function BsrJobTile({ tile }: { tile: BsrJobChatTile }) {
  const { id } = tile.data;
  const [state, setState] = useState<
    | { kind: "loading" }
    | { kind: "ready"; data: BsrLiveData }
    | { kind: "error"; message: string }
  >({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const response = await fetch(`/api/chat/bsr/${id}`, {
          cache: "no-store",
        });
        const body: unknown = await response.json();
        if (cancelled) return;
        if (!response.ok) {
          const msg = isError(body) ? body.error : "Failed to load job.";
          setState({ kind: "error", message: msg });
          return;
        }
        setState({ kind: "ready", data: body as BsrLiveData });
      } catch (err) {
        if (cancelled) return;
        setState({
          kind: "error",
          message: err instanceof Error ? err.message : "Failed to load job.",
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
          Loading job…
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
  const actionHref =
    d.role === "nanny" ? "/nanny/babysitting" : "/parent/babysitting";

  return <BsrTileBody d={d} actionHref={actionHref} />;
}

function BsrTileBody({
  d,
  actionHref,
}: {
  d: BsrLiveData;
  actionHref: string;
}) {
  const navProps = useTileNavigation(actionHref);
  return (
    <article
      {...navProps}
      aria-label={`Open ${d.headline}`}
      className="cursor-pointer rounded-xl border border-sky-200 bg-gradient-to-br from-sky-50/60 to-white p-3 shadow-sm transition-shadow hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-600 focus-visible:ring-offset-2 focus-visible:ring-offset-white"
    >
      <header className="flex items-center gap-2">
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-sky-100">
          <Baby className="h-3.5 w-3.5 text-sky-600" />
        </div>
        <span className="text-xs font-medium text-sky-700">Babysitting</span>
      </header>

      <div className="mt-3 space-y-2">
        <p className="text-sm font-semibold text-slate-900">{d.headline}</p>

        {d.title ? <p className="text-xs text-slate-600">{d.title}</p> : null}

        <div className="flex items-center gap-1.5 text-xs text-slate-500">
          <MapPin className="h-3 w-3" />
          {d.suburb}
          {d.distance ? ` — ${d.distance}` : ""}
        </div>

        {d.slots.length > 0 ? (
          <ul className="space-y-0.5">
            {d.slots.map((slot) => (
              <li
                key={slot}
                className="flex items-center gap-1.5 text-xs text-slate-600"
              >
                <Clock className="h-3 w-3" />
                {slot}
              </li>
            ))}
          </ul>
        ) : null}

        {d.hourly_rate != null ? (
          <p className="text-xs text-slate-600">
            £{d.hourly_rate}/hr
            {d.estimated_total != null ? ` · ~£${d.estimated_total} total` : ""}
          </p>
        ) : null}

        <p className="text-xs text-slate-500">{d.children}</p>

        {d.clash_warning ? (
          <p className="rounded-lg bg-amber-50 px-2.5 py-2 text-xs font-medium text-amber-800">
            ⚠ Schedule clash with an existing booking — needs a 2-hour buffer.
          </p>
        ) : null}

        {d.expires ? (
          <p
            className={`text-xs italic ${
              d.expires_urgent ? "text-red-600" : "text-slate-500"
            }`}
          >
            {d.expires}
          </p>
        ) : null}

        <p className="inline-flex items-center gap-1 pt-1 text-sm font-medium text-sky-700">
          Open babysitting page
          <ArrowRight className="h-3.5 w-3.5" />
        </p>
      </div>
    </article>
  );
}
