/**
 * `updateNannyAccountSettings`'s answer as edit mode reads it (06b-3 rework, ledger B06 §9.1 R1): saved, stale, a
 * refusal by field, or one plain message. Shared by Profile and Contact details.
 *
 * BB-wave1-041126/06b3-rework, 2026-11-09.
 */

import type { SaveOutcome } from "@/components/settings/useEditMode";
import type { UpdateNannyAccountResult } from "@/lib/actions/nanny-account-settings";
import { EDIT_MESSAGES } from "@/lib/settings/edit-messages";

export function accountOutcome(result: UpdateNannyAccountResult): SaveOutcome {
  if (result.success) return { kind: "saved" };
  if (result.code === "stale") return { kind: "stale" };
  if (result.code === "invalid" && result.fields) return { kind: "fields", fields: result.fields };
  return { kind: "refused", message: result.error ?? EDIT_MESSAGES.gaveUp };
}
