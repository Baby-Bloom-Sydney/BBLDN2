"use server";

/**
 * The nanny's Profile and Contact details Save (ledger B06 §9.1 R1, R2, R4; BB-wave1-041126/06b3-rework, 2026-11-09),
 * moved out of `nanny.ts` (over 1,100 lines) in review round 1.
 *
 * - The same required-field rules as the page (`checkProfileInput`), each refusal by field, nothing written.
 * - Her name and date of birth are locked once identity verification is done — checked here on the server, not only
 *   by the page (they print on her invoices): locked when `nannies.identity_verified` (trigger-protected) is set or the
 *   level is at least 2; an unreadable row locks too.
 * - One address (R2), stored as verification stores it (`addressColumns`).
 * - The version she loaded (`expected_updated_at`, required): a row changed since answers `stale`, nothing written.
 * - Input from the browser is narrowed before use; refusals are fixed, plain messages.
 *
 * Only async functions are exported: every async export of a `"use server"` file is callable from a browser.
 */

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { EDIT_MESSAGES } from "@/lib/settings/edit-messages";
import { checkProfileInput, PROFILE_MESSAGES, type ProfileInput } from "@/lib/settings/nanny-profile-rules";
import { addressColumns, writeOwnProfile } from "@/lib/settings/profile-write";
import { normaliseUkMobile } from "@/lib/uk-contact";

/** The fields she changed (the page's `ProfileInput`; a null is refused by the check) and the version she loaded. */
export interface UpdateNannyAccountData extends ProfileInput {
  /** The profile row's `updated_at` she loaded (null = none yet). Required. */
  readonly expected_updated_at: string | null;
}

export interface UpdateNannyAccountResult {
  readonly success: boolean;
  readonly error: string | null;
  readonly code?: "invalid" | "locked" | "stale";
  readonly fields?: Readonly<Record<string, string>>;
}

const IDENTITY_VERIFIED_LEVEL = 2;
const LOCKED_KEYS = ["first_name", "last_name", "date_of_birth"] as const;
const SIGNED_OUT = "Please sign in again, then try once more.";
const INVALID: UpdateNannyAccountResult = { success: false, error: EDIT_MESSAGES.checkMarked, code: "invalid", fields: {} };

/** Name and date of birth are locked after identity verification; an unreadable row counts as locked. */
async function identityLocked(userId: string): Promise<boolean> {
  const { data, error } = await createAdminClient()
    .from("nannies").select("verification_level, identity_verified").eq("user_id", userId).maybeSingle();
  if (error) return true;
  return data?.identity_verified === true || (data?.verification_level ?? 0) >= IDENTITY_VERIFIED_LEVEL;
}

/** The profile columns this save writes (only the fields sent), trimmed and normalised. */
function accountColumns(data: ProfileInput): Record<string, string | null> {
  return {
    ...(data.first_name !== undefined ? { first_name: data.first_name.trim() } : {}),
    ...(data.last_name !== undefined ? { last_name: data.last_name.trim() } : {}),
    ...(typeof data.date_of_birth === "string" ? { date_of_birth: data.date_of_birth } : {}),
    ...(typeof data.mobile_number === "string" ? { mobile_number: normaliseUkMobile(data.mobile_number.trim()) } : {}),
    ...(data.address ? addressColumns(data.address) : {}),
  };
}

const isVersion = (value: unknown): value is string | null => value === null || (typeof value === "string" && value.length <= 64);

export async function updateNannyAccountSettings(data: UpdateNannyAccountData): Promise<UpdateNannyAccountResult> {
  if (typeof data !== "object" || data === null || !isVersion((data as { expected_updated_at?: unknown }).expected_updated_at)) return INVALID;
  const supabase = createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return { success: false, error: SIGNED_OUT };

  const { expected_updated_at: expected, ...input } = data;
  const fields = checkProfileInput(input);
  if (Object.keys(fields).length > 0) return { success: false, error: EDIT_MESSAGES.checkMarked, code: "invalid", fields };
  if (LOCKED_KEYS.some((key) => key in input) && (await identityLocked(user.id))) {
    return { success: false, error: PROFILE_MESSAGES.locked, code: "locked" };
  }

  const columns = accountColumns(input);
  if (Object.keys(columns).length > 0) {
    const written = await writeOwnProfile(supabase, user.id, columns, expected);
    if (written.status === "stale") return { success: false, error: EDIT_MESSAGES.stale, code: "stale" };
    if (written.status === "error") return { success: false, error: "Failed to update account info" };
  }

  revalidatePath("/nanny/settings");
  revalidatePath("/nanny/profile");
  return { success: true, error: null };
}
