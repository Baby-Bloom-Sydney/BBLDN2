"use client";

/**
 * Parent Settings › Account › Contact details: her email (read-only and verified, as today) and her mobile — plain
 * rows with one Edit; in edit mode the mobile in place. The mobile is required and a UK mobile (today's rule, the
 * server's own check). One Save with the version she loaded (`updateParentAccountSettings`). The nanny's Contact
 * details page as it stands, with the parent's action.
 */

import { useId, useState, type FormEvent } from "react";
import { accountOutcome } from "@/app/nanny/settings/account-outcome";
import { DiscardChangesDialog } from "@/components/settings/DiscardChangesDialog";
import { EditRow, TextField } from "@/components/settings/SettingsFields";
import { SettingsEditHeader } from "@/components/settings/SettingsEditHeader";
import { SettingsRow } from "@/components/settings/SettingsRow";
import { SettingsSubsection } from "@/components/settings/SettingsSubsection";
import { useEditMode } from "@/components/settings/useEditMode";
import { useUnsavedGuard } from "@/components/settings/useUnsavedGuard";
import { updateParentAccountSettings } from "@/lib/actions/parent-account-settings";
import { checkParentProfileInput } from "@/lib/settings/parent-profile-rules";
import { formatUkMobile, normaliseUkMobile } from "@/lib/uk-contact";

export interface ParentContactFields {
  readonly email: string;
  readonly mobile_number: string;
  readonly updated_at: string | null;
}

function EmailRows({ email }: { readonly email: string }) {
  return (
    <SettingsSubsection header="Email">
      <SettingsRow label="Email address" value={email} badge={email ? { label: "Verified", tone: "success" } : undefined} isLast wrap />
    </SettingsSubsection>
  );
}

export function ParentContactDetailsSection({ title, contact }: { readonly title: string; readonly contact: ParentContactFields }) {
  const mode = useEditMode();
  const id = useId();
  const shown = contact.mobile_number ? formatUkMobile(contact.mobile_number) : "";
  const [mobile, setMobile] = useState(shown);
  const [loaded, setLoaded] = useState(() => ({ mobile: shown, version: contact.updated_at }));
  const changed = mode.editing && normaliseUkMobile(mobile.trim()) !== normaliseUkMobile(loaded.mobile.trim());
  const guard = useUnsavedGuard(mode.armed && changed, mode.cancel);

  const begin = () => {
    setMobile(shown);
    setLoaded({ mobile: shown, version: contact.updated_at });
    mode.begin();
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const fields = checkParentProfileInput({ mobile_number: mobile });
    if (Object.keys(fields).length > 0) return mode.refuse(fields);
    if (!changed) return mode.cancel();
    void mode.save(async () => accountOutcome(await updateParentAccountSettings({ mobile_number: mobile, expected_updated_at: loaded.version })));
  };

  return (
    <div className="space-y-5">
      <SettingsEditHeader title={title} editing={mode.editing} saving={mode.saving} onEdit={begin} onCancel={mode.cancel} formId={`${id}-form`}
        editRef={mode.editRef} saveRef={mode.saveRef} notice={mode.notice} announcement={mode.announcement} />
      <div className="space-y-6">
        <EmailRows email={contact.email} />
        {mode.editing ? (
          <form id={`${id}-form`} ref={mode.formRef} onSubmit={submit} noValidate>
            <fieldset disabled={mode.saving} className="m-0 min-w-0 border-0 p-0">
              <SettingsSubsection header="Phone">
                <EditRow isLast>
                  <TextField id={`${id}-mobile`} label="Mobile number" value={mobile} onChange={(v) => { mode.clearError("mobile"); setMobile(v); }}
                    error={mode.errors.mobile} input={{ type: "tel", inputMode: "tel", autoComplete: "tel", placeholder: "07XXX XXX XXX" }} required />
                </EditRow>
              </SettingsSubsection>
            </fieldset>
          </form>
        ) : (
          <SettingsSubsection header="Phone">
            <SettingsRow label="Mobile number" value={shown || undefined} isLast wrap />
          </SettingsSubsection>
        )}
      </div>
      <DiscardChangesDialog open={guard.confirming} onKeepEditing={guard.keepEditing} onDiscard={guard.discard} onClosed={guard.returnFocus} />
    </div>
  );
}
