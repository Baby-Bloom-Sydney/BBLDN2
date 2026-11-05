"use client";

/**
 * The row drawer's read-only blocks (plan C4; brief §3 admin 2; BB-wave1-041126/04c1-build): a titled block (a
 * labelled region), and every past attempt with its note, who recorded it and any call-back — newest first. In the
 * leads drawer's idiom: small uppercase slate-500 headings, slate text on white.
 */

import { useId, type ReactNode } from "react";
import { ADMIN_COPY } from "@/lib/calls/copy";
import type { AttemptView } from "@/lib/calls/family-panel";

export function PanelBlock({ title, children }: { readonly title: string; readonly children: ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="space-y-2">
      <h3 id={id} className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        {title}
      </h3>
      {children}
    </section>
  );
}

export function AttemptList({ attempts }: { readonly attempts: readonly AttemptView[] }) {
  if (attempts.length === 0) return <p className="text-sm text-slate-500">{ADMIN_COPY.noAttempts}</p>;
  return (
    <ol className="space-y-2">
      {attempts.map((a) => (
        <li key={a.key} className="rounded-md border border-slate-200 bg-white p-3">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <p className="text-sm font-medium text-slate-900">{a.what}</p>
            <p className="text-xs text-slate-500">{a.when}</p>
          </div>
          {a.callBack && <p className="mt-1 text-xs font-medium text-amber-700">{a.callBack}</p>}
          {a.note && <p className="mt-1 whitespace-pre-line text-sm text-slate-600">{a.note}</p>}
          {a.by && <p className="mt-1 text-xs text-slate-500">{`${ADMIN_COPY.by} ${a.by}`}</p>}
        </li>
      ))}
    </ol>
  );
}
