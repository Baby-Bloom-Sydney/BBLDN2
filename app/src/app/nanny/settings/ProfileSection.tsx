"use client";

/**
 * Settings › Profile (06b-3 rework, ledger B06 §9.1 R1, R2, R4; brief 06 §0b): her legal name, date of birth and
 * address — plain rows with one Edit for the page; in edit mode every field in place and one Save with the version she
 * loaded (`updateNannyAccountSettings`).
 *
 * - **Her address** is one record (her home address, her own row): shown in full, edited with the inline search, the same record the
 *   Business page shows and her invoices print. It replaces the old Area and Postcode rows.
 * - **Never saved empty** (R4): first name, last name, date of birth (unless identity verification has locked them —
 *   then they stay locked rows, and the server refuses them too) and the address; the page checks with the server's
 *   own rules (`checkProfileInput`) before Save calls it.
 * - Only what changed is sent; unchanged → back to the rows without a call.
 *
 * Moved out of `NannySettingsClient.tsx` (1,027 lines) by BB-wave1-041126/06b3-rework, 2026-11-09.
 */

import { useId, useState, type FormEvent } from "react";
import { AddressSearchField } from "@/components/settings/AddressSearchField";
import { DiscardChangesDialog } from "@/components/settings/DiscardChangesDialog";
import { EditRow, TextField } from "@/components/settings/SettingsFields";
import { SettingsEditHeader } from "@/components/settings/SettingsEditHeader";
import { SettingsRow } from "@/components/settings/SettingsRow";
import { SettingsSubsection } from "@/components/settings/SettingsSubsection";
import { useEditMode } from "@/components/settings/useEditMode";
import { useUnsavedGuard } from "@/components/settings/useUnsavedGuard";
import { ValueLines } from "@/components/settings/ValueLines";
import { updateNannyAccountSettings } from "@/lib/actions/nanny-account-settings";
import { checkProfileInput, homeLines, sameHome, type HomeAddress, type ProfileInput } from "@/lib/settings/nanny-profile-rules";
import { accountOutcome } from "./account-outcome";

export interface ProfileFields {
  readonly first_name: string;
  readonly last_name: string;
  readonly date_of_birth: string;
  readonly address_line1: string;
  readonly address_line2: string;
  readonly suburb: string;
  readonly postcode: string;
  readonly updated_at: string | null;
  /** Her home address row's version (null = she has none): the Profile save checks it too (security H1). */
  readonly address_updated_at: string | null;
}

interface ProfileForm {
  readonly firstName: string;
  readonly lastName: string;
  readonly dateOfBirth: string;
  readonly home: HomeAddress | null;
}

const VERIFIED = { label: "Verified", tone: "success" } as const;

function formatDate(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  // a date-only value is midnight UTC: shown in UTC, it is the same day wherever she is
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}

function homeOf(profile: ProfileFields): HomeAddress | null {
  const home = { line1: profile.address_line1, line2: profile.address_line2, town: profile.suburb, postcode: profile.postcode };
  return homeLines(home).length > 0 ? home : null;
}

const formOf = (profile: ProfileFields): ProfileForm => ({
  firstName: profile.first_name, lastName: profile.last_name, dateOfBirth: profile.date_of_birth, home: homeOf(profile),
});

/** The whole page as the check reads it; locked fields are not hers to send. */
function wholeOf(form: ProfileForm, locked: boolean): ProfileInput {
  const person = locked ? {} : { first_name: form.firstName, last_name: form.lastName, date_of_birth: form.dateOfBirth };
  return { ...person, address: form.home };
}

/** Only what changed. */
function changesOf(form: ProfileForm, initial: ProfileForm, locked: boolean): ProfileInput {
  const changed = (a: string, b: string) => !locked && a.trim() !== b.trim();
  return {
    ...(changed(form.firstName, initial.firstName) ? { first_name: form.firstName } : {}),
    ...(changed(form.lastName, initial.lastName) ? { last_name: form.lastName } : {}),
    ...(changed(form.dateOfBirth, initial.dateOfBirth) ? { date_of_birth: form.dateOfBirth } : {}),
    ...(!sameHome(form.home, initial.home) && form.home ? { address: form.home } : {}),
  };
}

function PersonRows({ profile, locked }: { readonly profile: ProfileFields; readonly locked: boolean }) {
  return (
    <>
      <SettingsRow label="Full legal name" value={`${profile.first_name} ${profile.last_name}`.trim() || undefined}
        locked={locked} badge={locked ? VERIFIED : undefined} wrap />
      <SettingsRow label="Date of birth" value={profile.date_of_birth ? formatDate(profile.date_of_birth) : undefined}
        locked={locked} badge={locked ? VERIFIED : undefined} wrap />
    </>
  );
}

function PersonFields({ form, set, errors, id }: { readonly form: ProfileForm; readonly set: (p: Partial<ProfileForm>) => void; readonly errors: Readonly<Record<string, string>>; readonly id: string }) {
  return (
    <>
      <EditRow><TextField id={`${id}-first`} label="First name" value={form.firstName} onChange={(v) => set({ firstName: v })} error={errors.firstName} input={{ autoComplete: "given-name" }} required /></EditRow>
      <EditRow><TextField id={`${id}-last`} label="Last name" value={form.lastName} onChange={(v) => set({ lastName: v })} error={errors.lastName} input={{ autoComplete: "family-name" }} required /></EditRow>
      <EditRow><TextField id={`${id}-dob`} label="Date of birth" value={form.dateOfBirth} onChange={(v) => set({ dateOfBirth: v })} error={errors.dateOfBirth} input={{ type: "date", autoComplete: "bday" }} required /></EditRow>
    </>
  );
}

export function ProfileSection({ title, profile, identityVerified }: { readonly title: string; readonly profile: ProfileFields; readonly identityVerified: boolean }) {
  const mode = useEditMode();
  const id = useId();
  const [form, setForm] = useState<ProfileForm>(() => formOf(profile));
  const [loaded, setLoaded] = useState(() => ({ form: formOf(profile), version: profile.updated_at, addressVersion: profile.address_updated_at }));
  const changes = mode.editing ? changesOf(form, loaded.form, identityVerified) : {};
  const guard = useUnsavedGuard(mode.armed && Object.keys(changes).length > 0, mode.cancel);
  const set = (patch: Partial<ProfileForm>) => {
    Object.keys(patch).forEach((key) => mode.clearError(key === "home" ? "address" : key));
    setForm((current) => ({ ...current, ...patch }));
  };

  const begin = () => {
    const fresh = formOf(profile);
    setForm(fresh);
    setLoaded({ form: fresh, version: profile.updated_at, addressVersion: profile.address_updated_at });
    mode.begin();
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const fields = checkProfileInput(wholeOf(form, identityVerified));
    if (Object.keys(fields).length > 0) return mode.refuse(fields);
    if (Object.keys(changes).length === 0) return mode.cancel();
    void mode.save(async () => accountOutcome(await updateNannyAccountSettings({
      ...changes, expected_updated_at: loaded.version, expected_address_updated_at: loaded.addressVersion,
    })));
  };

  return (
    <div className="space-y-5">
      <SettingsEditHeader title={title} editing={mode.editing} saving={mode.saving} onEdit={begin} onCancel={mode.cancel} formId={`${id}-form`}
        editRef={mode.editRef} saveRef={mode.saveRef} notice={mode.notice} announcement={mode.announcement} />
      {mode.editing ? (
        <form id={`${id}-form`} ref={mode.formRef} onSubmit={submit} noValidate>
          <fieldset disabled={mode.saving} className="m-0 min-w-0 border-0 p-0">
            <SettingsSubsection header="Personal information">
              {identityVerified ? <PersonRows profile={profile} locked /> : <PersonFields form={form} set={set} errors={mode.errors} id={id} />}
              <EditRow isLast><AddressSearchField id={`${id}-address`} value={form.home} onPick={(home) => set({ home })} error={mode.errors.address} required /></EditRow>
            </SettingsSubsection>
          </fieldset>
        </form>
      ) : (
        <SettingsSubsection header="Personal information">
          <PersonRows profile={profile} locked={identityVerified} />
          <SettingsRow label="Address" display={<ValueLines lines={homeLines(homeOf(profile))} />} isLast />
        </SettingsSubsection>
      )}
      <DiscardChangesDialog open={guard.confirming} onKeepEditing={guard.keepEditing} onDiscard={guard.discard} onClosed={guard.returnFocus} />
    </div>
  );
}
