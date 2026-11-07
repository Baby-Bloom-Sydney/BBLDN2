"use client";

/**
 * The address her invoices print (plan 06 §14.6 b3.3; brief §0a C: by default her verification address — "no need to
 * ask for street address. because we already have it from her sign up"). A text area; blank means the address from
 * her verification. 06b-4's first-invoice setup reuses it, `required`, in the rare case none is on file (plan X5).
 *
 * BB-wave1-041126/06b3-build, 2026-11-07.
 */

import { useId, useState } from "react";
import { EditFieldDialog } from "@/components/settings/EditFieldDialog";
import type { SaveOutcome } from "./business-view";
import { DialogFields, TextField } from "./form-fields";

export interface AddressDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (next: boolean) => void;
  readonly title: string;
  readonly description?: string;
  /** What the box opens on (what she entered; blank for the default). */
  readonly initial: string;
  /** Save waits for something typed (06b-4's setup, when no address is on file). */
  readonly required?: boolean;
  readonly onSave: (address: string) => Promise<SaveOutcome>;
}

export function AddressDialog({ open, onOpenChange, title, description, initial, required = false, onSave }: AddressDialogProps) {
  const id = useId();
  const [address, setAddress] = useState(initial);
  const [issue, setIssue] = useState<string | undefined>(undefined);

  async function submit() {
    const outcome = await onSave(address);
    setIssue(outcome.fields?.businessAddress);
    return outcome;
  }

  return (
    <EditFieldDialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={description}
      canSubmit={!required || address.trim() !== ""}
      onSubmit={submit}
    >
      <DialogFields>
        <TextField id={`${id}-address`} label="Address" value={address} onChange={setAddress} multiline error={issue} />
      </DialogFields>
    </EditFieldDialog>
  );
}
