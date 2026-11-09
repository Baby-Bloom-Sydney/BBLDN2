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
 * - Her address is her home address (R2; her own row): Profile and this page show and edit the one record.
 * - Review round 1: a refusal after part of the page was saved re-bases what was saved (`rebased`), so her retry sends
 *   only the rest; a refusal naming no field on the page shows its own words; fields are locked while saving; an error
 *   clears as she fixes its field.
 *
 * BB-wave1-041126/06b3-build, 2026-11-07; rewritten for edit mode by BB-wave1-041126/06b3-rework, 2026-11-09.
 */

import { useId, useState, type FormEvent } from "react";
import { DiscardChangesDialog } from "@/components/settings/DiscardChangesDialog";
import { SettingsEditHeader } from "@/components/settings/SettingsEditHeader";
import { useEditMode, type SaveOutcome } from "@/components/settings/useEditMode";
import { useUnsavedGuard } from "@/components/settings/useUnsavedGuard";
import { checkBusinessPage } from "@/lib/invoices/actions/business-page";
import type { BusinessSettingsResult } from "@/lib/invoices/actions/messages";
import { saveBusinessSettings } from "@/lib/invoices/actions/save-business-settings";
import { hasStreetAndPostcode, type HomeAddress } from "@/lib/settings/nanny-profile-rules";
import { BusinessFields } from "./BusinessFields";
import { BusinessRows } from "./BusinessRows";
import {
  changedParts, formFrom, rebased, wholePage, type BankView, type BusinessForm, type BusinessView, type Loaded, type Versions,
} from "./business-view";

export interface BusinessSettingsFormProps {
  readonly business: BusinessView;
  readonly bank: BankView | null;
  readonly home: HomeAddress | null;
  readonly versions: Versions;
}

export const BUSINESS_TITLE = "Business";

/** The fields this page shows, by the keys a refusal names them with. */
const PAGE_FIELDS = new Set([
  "tradingName", "companyName", "companyNumber", "registeredOffice", "partnershipName", "vatNumber", "address", "accountName", "sortCode", "accountNumber",
]);

function outcomeOf(result: BusinessSettingsResult): SaveOutcome {
  if (result.ok) return { kind: "saved" };
  if (result.error === "stale") return { kind: "stale" };
  const fields = result.fields ?? {};
  if (Object.keys(fields).some((key) => PAGE_FIELDS.has(key))) return { kind: "fields", fields };
  return { kind: "refused", message: Object.values(fields)[0] ?? result.message };
}

/** The error a change clears: the field's own (her address's key is `address`). */
const errorKeysOf = (patch: Partial<BusinessForm>): string[] =>
  Object.keys(patch).map((key) => (key === "home" ? "address" : key)).filter((key) => key !== "accountNameTouched");

/** The marks a choice hides with their fields (round 2 #4): a business type's own fields (a limited company has no
 * address of hers), the VAT number when VAT registered goes back to No. */
function hiddenKeysOf(patch: Partial<BusinessForm>): string[] {
  const type = patch.businessType;
  const byType = type === undefined ? [] : [
    ...(type === "limited_company" ? ["address"] : ["companyName", "companyNumber", "registeredOffice"]),
    ...(type === "partnership" ? [] : ["partnershipName"]),
  ];
  return patch.vatRegistered === false ? [...byType, "vatNumber"] : byType;
}

export function BusinessSettingsForm({ business, bank, home, versions }: BusinessSettingsFormProps) {
  const mode = useEditMode();
  const formId = useId();
  const [form, setForm] = useState<BusinessForm>(() => formFrom(business, bank, home));
  const [loaded, setLoaded] = useState<Loaded>(() => ({ form, versions }));
  const parts = mode.editing ? changedParts(form, loaded.form, business, bank, loaded.versions) : {};
  const guard = useUnsavedGuard(mode.armed && Object.keys(parts).length > 0, mode.cancel);
  const set = (patch: Partial<BusinessForm>) => {
    [...errorKeysOf(patch), ...hiddenKeysOf(patch)].forEach(mode.clearError);
    setForm((current) => ({ ...current, ...patch }));
  };

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
    const submitted = form;
    void mode.save(async () => {
      const result = await saveBusinessSettings(parts);
      const saved = result.ok ? undefined : result.saved;
      if (saved) setLoaded((current) => rebased(current, submitted, saved));
      return outcomeOf(result);
    });
  };

  return (
    <div className="space-y-5">
      <SettingsEditHeader title={BUSINESS_TITLE} editing={mode.editing} saving={mode.saving} onEdit={begin} onCancel={mode.cancel}
        formId={formId} editRef={mode.editRef} saveRef={mode.saveRef} notice={mode.notice} announcement={mode.announcement} />
      {mode.editing ? (
        <form id={formId} ref={mode.formRef} onSubmit={submit} noValidate>
          <fieldset disabled={mode.saving} className="m-0 min-w-0 space-y-6 border-0 p-0">
            <BusinessFields form={form} set={set} view={business} errors={mode.errors} />
          </fieldset>
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
