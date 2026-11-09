"use client";

/**
 * An editable Settings page's title row (06b-3 rework, ledger B06 §9.1 R1; brief 06 §0b 3): the page title with one
 * Edit button at the top right — one for the whole page, never one per row. While editing, Cancel and Save replace
 * it and the row is pinned to the top of the scrolling area (below the app bar on wide screens), so Save stays in
 * reach on a 320 px phone. Save submits the page's form (`formId`), so Enter in a field saves too.
 *
 * Shared: the nanny's Profile, Contact details and Business pages, and parent Settings in its own PR.
 *
 * BB-wave1-041126/06b3-rework, 2026-11-09.
 */

import { type RefObject } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { SettingsSectionTitle } from "./SettingsSectionTitle";

export interface SettingsEditHeaderProps {
  readonly title: string;
  readonly editing: boolean;
  readonly saving: boolean;
  readonly onEdit: () => void;
  readonly onCancel: () => void;
  /** The id of the page's form: Save submits it. */
  readonly formId: string;
  /** Focus returns here after a save or Cancel. */
  readonly editRef: RefObject<HTMLButtonElement>;
}

export function SettingsEditHeader({ title, editing, saving, onEdit, onCancel, formId, editRef }: SettingsEditHeaderProps) {
  return (
    <div
      data-pinned={editing ? "true" : "false"}
      className={cn(
        "flex items-center justify-between gap-3 px-1",
        editing && "sticky top-0 z-30 -mx-1 border-b border-slate-200 bg-slate-50 px-2 py-3 xl:top-16",
      )}
    >
      <SettingsSectionTitle>{title}</SettingsSectionTitle>
      {editing ? (
        <div className="flex shrink-0 items-center gap-2">
          <Button type="button" variant="outline" size="sm" onClick={onCancel} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" form={formId} size="sm" disabled={saving} className="bg-violet-600 text-white hover:bg-violet-700">
            {saving ? (
              <>
                <Loader2 className="animate-spin" aria-hidden="true" />
                Saving…
              </>
            ) : (
              "Save"
            )}
          </Button>
        </div>
      ) : (
        <Button ref={editRef} type="button" variant="outline" size="sm" onClick={onEdit} aria-label={`Edit ${title.toLowerCase()}`}
          className="shrink-0 focus-visible:ring-violet-500">
          Edit
        </Button>
      )}
    </div>
  );
}
