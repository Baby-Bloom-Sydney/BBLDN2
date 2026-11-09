"use client";

/**
 * The in-app confirm before leaving with unsaved changes (06b-3 rework, ledger B06 §9.1 R1): "Discard your changes?",
 * Keep editing (focused first — the safe choice) / Discard. Escape, the close button or a tap outside keep editing.
 * One of the three pop-ups Settings keeps (with Close account and Leave child).
 *
 * BB-wave1-041126/06b3-rework, 2026-11-09.
 */

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EDIT_MESSAGES } from "@/lib/settings/edit-messages";

export interface DiscardChangesDialogProps {
  readonly open: boolean;
  readonly onKeepEditing: () => void;
  readonly onDiscard: () => void;
  /** Once closed: where focus goes (the dialog has no trigger, so Radix would leave it on the page). */
  readonly onClosed: () => void;
}

export function DiscardChangesDialog({ open, onKeepEditing, onDiscard, onClosed }: DiscardChangesDialogProps) {
  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onKeepEditing(); }}>
      <DialogContent className="sm:max-w-sm" aria-describedby={undefined}
        onCloseAutoFocus={(event) => { event.preventDefault(); onClosed(); }}>
        <DialogHeader>
          <DialogTitle>{EDIT_MESSAGES.discardTitle}</DialogTitle>
        </DialogHeader>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button type="button" variant="outline" onClick={onKeepEditing} autoFocus>
            Keep editing
          </Button>
          <Button type="button" onClick={onDiscard} className="bg-rose-600 text-white hover:bg-rose-700">
            Discard
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
