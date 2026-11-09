"use client";

/**
 * The one message line under an editable page's title (06b-3 rework, ledger B06 §9.1 R1), inside its pinned header so
 * it stays in sight: something to fix or retry, or "These details were changed elsewhere. The latest are now showing."
 * Every notice is an alert — the stale one too, which arrives as focus moves and a polite status would be lost (a11y
 * review H2). Renders nothing when there is nothing to say.
 *
 * BB-wave1-041126/06b3-rework, 2026-11-09.
 */

import { cn } from "@/lib/utils";

export interface Notice {
  readonly tone: "alert" | "status";
  readonly text: string;
}

export function EditNotice({ notice }: { readonly notice: Notice | null }) {
  if (notice === null) return null;
  return (
    <p
      key={notice.text}
      role="alert"
      className={cn(
        "rounded-md border px-3 py-2 text-sm",
        notice.tone === "alert" ? "border-rose-200 bg-rose-50 text-rose-700" : "border-violet-200 bg-violet-50 text-violet-800",
      )}
    >
      {notice.text}
    </p>
  );
}
