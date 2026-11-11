"use client";

/**
 * Parent Settings › Profile: her legal name, date of birth and area — plain rows with one Edit for the page; in edit
 * mode every field in place and one Save with the version she loaded (`updateParentAccountSettings`). The nanny's
 * Profile page, built from the same shared edit-mode parts, with the parent's fields only (no identity lock, no
 * home address record).
 *
 * - **Her address is a town and a postcode**, as today: shown as the Area and Postcode rows, edited with the inline
 *   search. A pick keeps its town and postcode only; no street line is kept, sent or shown.
 * - **Today's rules only** (`checkParentProfileInput`, the server's own check), on what changed: a name can't be
 *   blank; a date of birth on file can't be cleared; one empty on file and left untouched is never sent, so never
 *   refused. Nothing new becomes required.
 * - Only what changed is sent; unchanged → back to the rows without a call.
 */

import { useId, useState, type FormEvent } from "react";
import { accountOutcome } from "@/app/nanny/settings/account-outcome";
import { AddressSearchField } from "@/components/settings/AddressSearchField";
import { DiscardChangesDialog } from "@/components/settings/DiscardChangesDialog";
import { EditRow, TextField } from "@/components/settings/SettingsFields";
import { SettingsEditHeader } from "@/components/settings/SettingsEditHeader";
import { SettingsRow } from "@/components/settings/SettingsRow";
import { SettingsSubsection } from "@/components/settings/SettingsSubsection";
import { useEditMode } from "@/components/settings/useEditMode";
import { useUnsavedGuard } from "@/components/settings/useUnsavedGuard";
import { updateParentAccountSettings } from "@/lib/actions/parent-account-settings";
import { homeLines, sameHome, type HomeAddress } from "@/lib/settings/nanny-profile-rules";
import { checkParentProfileInput, type ParentProfileInput } from "@/lib/settings/parent-profile-rules";

export interface ParentProfileFields {
  readonly first_name: string;
  readonly last_name: string;
  readonly date_of_birth: string;
  readonly suburb: string;
  readonly postcode: string;
  readonly updated_at: string | null;
}

interface ProfileForm {
  readonly firstName: string;
  readonly lastName: string;
  readonly dateOfBirth: string;
  /** Her town and postcode in the search field's shape, street lines always blank; null when neither is on file. */
  readonly home: HomeAddress | null;
}

/** Today's date display, unchanged. */
function formatDate(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
}

/** A town and a postcode only: a picked address's street line is dropped here, never kept. */
const areaOf = (town: string, postcode: string): HomeAddress => ({ line1: "", line2: "", town, postcode });

function homeOf(profile: ParentProfileFields): HomeAddress | null {
  const home = areaOf(profile.suburb, profile.postcode);
  return homeLines(home).length > 0 ? home : null;
}

const formOf = (profile: ParentProfileFields): ProfileForm => ({
  firstName: profile.first_name, lastName: profile.last_name, dateOfBirth: profile.date_of_birth, home: homeOf(profile),
});

/** Only what changed; an address as its town and postcode. */
function changesOf(form: ProfileForm, initial: ProfileForm): ParentProfileInput {
  const changed = (a: string, b: string) => a.trim() !== b.trim();
  return {
    ...(changed(form.firstName, initial.firstName) ? { first_name: form.firstName } : {}),
    ...(changed(form.lastName, initial.lastName) ? { last_name: form.lastName } : {}),
    ...(changed(form.dateOfBirth, initial.dateOfBirth) ? { date_of_birth: form.dateOfBirth } : {}),
    ...(form.home && !sameHome(form.home, initial.home) ? { suburb: form.home.town, postcode: form.home.postcode } : {}),
  };
}

function ProfileRows({ profile }: { readonly profile: ParentProfileFields }) {
  return (
    <div className="space-y-6">
      <SettingsSubsection header="Personal information">
        <SettingsRow label="Full legal name" value={`${profile.first_name} ${profile.last_name}`.trim() || undefined} wrap />
        <SettingsRow label="Date of birth" value={profile.date_of_birth ? formatDate(profile.date_of_birth) : undefined} isLast wrap />
      </SettingsSubsection>
      <SettingsSubsection header="Address">
        <SettingsRow label="Area" value={profile.suburb} wrap />
        <SettingsRow label="Postcode" value={profile.postcode} isLast wrap />
      </SettingsSubsection>
    </div>
  );
}

interface FieldsProps {
  readonly form: ProfileForm;
  readonly set: (patch: Partial<ProfileForm>) => void;
  readonly errors: Readonly<Record<string, string>>;
  readonly id: string;
  /** A date of birth on file can't be cleared; one not on file stays optional. */
  readonly dobRequired: boolean;
}

function ProfileEditFields({ form, set, errors, id, dobRequired }: FieldsProps) {
  return (
    <div className="space-y-6">
      <SettingsSubsection header="Personal information">
        <EditRow><TextField id={`${id}-first`} label="First name" value={form.firstName} onChange={(v) => set({ firstName: v })} error={errors.firstName} input={{ autoComplete: "given-name" }} required /></EditRow>
        <EditRow><TextField id={`${id}-last`} label="Last name" value={form.lastName} onChange={(v) => set({ lastName: v })} error={errors.lastName} input={{ autoComplete: "family-name" }} required /></EditRow>
        <EditRow isLast><TextField id={`${id}-dob`} label="Date of birth" value={form.dateOfBirth} onChange={(v) => set({ dateOfBirth: v })} error={errors.dateOfBirth} input={{ type: "date", autoComplete: "bday" }} required={dobRequired} /></EditRow>
      </SettingsSubsection>
      <SettingsSubsection header="Address">
        <EditRow isLast><AddressSearchField id={`${id}-address`} value={form.home} onPick={(home) => set({ home: areaOf(home.town, home.postcode) })} /></EditRow>
      </SettingsSubsection>
    </div>
  );
}

export function ParentProfileSection({ title, profile }: { readonly title: string; readonly profile: ParentProfileFields }) {
  const mode = useEditMode();
  const id = useId();
  const [form, setForm] = useState<ProfileForm>(() => formOf(profile));
  const [loaded, setLoaded] = useState(() => ({ form: formOf(profile), version: profile.updated_at }));
  const changes = mode.editing ? changesOf(form, loaded.form) : {};
  const guard = useUnsavedGuard(mode.armed && Object.keys(changes).length > 0, mode.cancel);
  const set = (patch: Partial<ProfileForm>) => {
    Object.keys(patch).forEach((key) => mode.clearError(key));
    setForm((current) => ({ ...current, ...patch }));
  };

  const begin = () => {
    const fresh = formOf(profile);
    setForm(fresh);
    setLoaded({ form: fresh, version: profile.updated_at });
    mode.begin();
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const fields = checkParentProfileInput(changes);
    if (Object.keys(fields).length > 0) return mode.refuse(fields);
    if (Object.keys(changes).length === 0) return mode.cancel();
    void mode.save(async () => accountOutcome(await updateParentAccountSettings({ ...changes, expected_updated_at: loaded.version })));
  };

  return (
    <div className="space-y-5">
      <SettingsEditHeader title={title} editing={mode.editing} saving={mode.saving} onEdit={begin} onCancel={mode.cancel} formId={`${id}-form`}
        editRef={mode.editRef} saveRef={mode.saveRef} notice={mode.notice} announcement={mode.announcement} />
      {mode.editing ? (
        <form id={`${id}-form`} ref={mode.formRef} onSubmit={submit} noValidate>
          <fieldset disabled={mode.saving} className="m-0 min-w-0 border-0 p-0">
            <ProfileEditFields form={form} set={set} errors={mode.errors} id={id} dobRequired={loaded.form.dateOfBirth.trim() !== ""} />
          </fieldset>
        </form>
      ) : (
        <ProfileRows profile={profile} />
      )}
      <DiscardChangesDialog open={guard.confirming} onKeepEditing={guard.keepEditing} onDiscard={guard.discard} onClosed={guard.returnFocus} />
    </div>
  );
}
