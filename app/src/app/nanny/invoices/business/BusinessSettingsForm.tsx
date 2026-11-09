"use client";

/**
 * The Settings Business page (plan 06 §14.6 b3.3; ledger B06 §9.1 R1–R5; brief 06 §0a B, C and §0b): who she is on
 * her invoices, her VAT and her bank details for them — plain rows with one Edit button for the whole page; in edit
 * mode every field in place and one Save (`saveBusinessSettings`).
 *
 * - **Save** checks the whole page with the server's own check (`checkBusinessPage`); a refusal marks each field,
 *   focus on the first, nothing she typed lost. It then sends only the records she changed, each with the version
 *   she loaded; nothing changed → back to the rows without a call.
 * - The lifecycle (stale, the 30 s give-up, focus) is `useEditMode`'s; leaving with unsaved changes asks first
 *   (`useUnsavedGuard`).
 * - Her address is her profile's (R2): Profile and this page show and edit the one record.
 *
 * BB-wave1-041126/06b3-build, 2026-11-07; rewritten for edit mode by BB-wave1-041126/06b3-rework, 2026-11-09.
 */

import { useId, useState, type FormEvent } from "react";
import { DiscardChangesDialog } from "@/components/settings/DiscardChangesDialog";
import { EditNotice } from "@/components/settings/EditNotice";
import { SettingsEditHeader } from "@/components/settings/SettingsEditHeader";
import { useEditMode, type SaveOutcome } from "@/components/settings/useEditMode";
import { useUnsavedGuard } from "@/components/settings/useUnsavedGuard";
import { checkBusinessPage } from "@/lib/invoices/actions/business-page";
import type { BusinessSettingsResult } from "@/lib/invoices/actions/messages";
import { saveBusinessSettings } from "@/lib/invoices/actions/save-business-settings";
import { hasStreetAndPostcode, type HomeAddress } from "@/lib/settings/nanny-profile-rules";
import { BusinessFields } from "./BusinessFields";
import { BusinessRows } from "./BusinessRows";
import { changedParts, formFrom, wholePage, type BankView, type BusinessForm, type BusinessView, type Versions } from "./business-view";

export interface BusinessSettingsFormProps {
  readonly business: BusinessView;
  readonly bank: BankView | null;
  readonly home: HomeAddress | null;
  readonly versions: Versions;
}

export const BUSINESS_TITLE = "Business";

function outcomeOf(result: BusinessSettingsResult): SaveOutcome {
  if (result.ok) return { kind: "saved" };
  if (result.error === "stale") return { kind: "stale" };
  if (result.fields) return { kind: "fields", fields: result.fields };
  return { kind: "refused", message: result.message };
}

export function BusinessSettingsForm({ business, bank, home, versions }: BusinessSettingsFormProps) {
  const mode = useEditMode();
  const formId = useId();
  const [form, setForm] = useState<BusinessForm>(() => formFrom(business, bank, home));
  const [loaded, setLoaded] = useState<{ readonly form: BusinessForm; readonly versions: Versions }>(() => ({ form, versions }));
  const parts = mode.editing ? changedParts(form, loaded.form, business, bank, loaded.versions) : {};
  const guard = useUnsavedGuard(mode.editing && Object.keys(parts).length > 0, mode.cancel);
  const set = (patch: Partial<BusinessForm>) => setForm((current) => ({ ...current, ...patch }));

  const begin = () => {
    const fresh = formFrom(business, bank, home);
    setForm(fresh);
    setLoaded({ form: fresh, versions });
    mode.begin();
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const fields = checkBusinessPage(wholePage(form, loaded.form, business, bank, loaded.versions), hasStreetAndPostcode(form.home));
    if (Object.keys(fields).length > 0) return mode.refuse(fields);
    if (Object.keys(parts).length === 0) return mode.cancel();
    void mode.save(async () => outcomeOf(await saveBusinessSettings(parts)));
  };

  return (
    <div className="space-y-5">
      <SettingsEditHeader title={BUSINESS_TITLE} editing={mode.editing} saving={mode.saving} onEdit={begin} onCancel={mode.cancel}
        formId={formId} editRef={mode.editRef} />
      <EditNotice notice={mode.notice} />
      {mode.editing ? (
        <form id={formId} ref={mode.formRef} onSubmit={submit} noValidate className="space-y-6">
          <BusinessFields form={form} set={set} view={business} errors={mode.errors} />
        </form>
      ) : (
        <div className="space-y-6">
          <BusinessRows view={business} bank={bank} home={home} />
        </div>
      )}
      <DiscardChangesDialog open={guard.confirming} onKeepEditing={guard.keepEditing} onDiscard={guard.discard} onClosed={guard.returnFocus} />
    </div>
  );
}
