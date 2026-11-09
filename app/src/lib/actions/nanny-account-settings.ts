"use server";

/**
 * The nanny's Profile and Contact details Save (ledger B06 §9.1 R1, R2, R4; BB-wave1-041126/06b3-rework, 2026-11-09),
 * moved out of `nanny.ts` (over 1,100 lines) in review round 1.
 *
 * - The same required-field rules as the page (`checkProfileInput`), each refusal by field, nothing written.
 * - Her name and date of birth are locked once identity verification is done — checked here on the server, not only
 *   by the page (they print on her invoices): locked when `nannies.identity_verified` (trigger-protected) is set or the
 *   level is at least 2; an unreadable row locks too.
 * - Profile (name, date of birth, address): one atomic save across her profile and her own home address row
 *   (`nanny_profile_save`; security H1 — coordinator, option (a), §9.11), each row with the version she loaded
 *   (`expected_updated_at`, `expected_address_updated_at`, both required); either changed since → `stale`, nothing
 *   written. Her street line never goes on her profile, which parents may read; her area follows it there.
 * - Contact details (mobile): her profile row alone, with its version (`expected_updated_at`, required).
 * - One page, one save: a Profile change and a mobile in one request is refused.
 * - Input from the browser is narrowed before use; refusals are fixed, plain messages.
 *
 * Only async functions are exported: every async export of a `"use server"` file is callable from a browser.
 */

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { EDIT_MESSAGES } from "@/lib/settings/edit-messages";
import { saveOwnProfile } from "@/lib/settings/home-address";
import { checkProfileInput, PROFILE_MESSAGES, type ProfileInput } from "@/lib/settings/nanny-profile-rules";
import { writeOwnProfile } from "@/lib/settings/profile-write";
import { normaliseUkMobile } from "@/lib/uk-contact";

/** The fields she changed (the page's `ProfileInput`; a null is refused by the check) and the versions she loaded. */
export interface UpdateNannyAccountData extends ProfileInput {
  /** The profile row's `updated_at` she loaded (null = none yet). Required. */
  readonly expected_updated_at: string | null;
  /** Her home address row's `updated_at` she loaded (null = she had none). Required with a Profile change. */
  readonly expected_address_updated_at?: string | null;
}

export interface UpdateNannyAccountResult {
  readonly success: boolean;
  readonly error: string | null;
  readonly code?: "invalid" | "locked" | "stale";
  readonly fields?: Readonly<Record<string, string>>;
}

type Session = ReturnType<typeof createClient>;

const IDENTITY_VERIFIED_LEVEL = 2;
const LOCKED_KEYS = ["first_name", "last_name", "date_of_birth"] as const;
const PROFILE_KEYS = [...LOCKED_KEYS, "address"] as const;
const SIGNED_OUT = "Please sign in again, then try once more.";
const INVALID: UpdateNannyAccountResult = { success: false, error: EDIT_MESSAGES.checkMarked, code: "invalid", fields: {} };
const STALE: UpdateNannyAccountResult = { success: false, error: EDIT_MESSAGES.stale, code: "stale" };
const FAILED: UpdateNannyAccountResult = { success: false, error: "Failed to update account info" };

/** Name and date of birth are locked after identity verification; an unreadable row counts as locked. */
async function identityLocked(userId: string): Promise<boolean> {
  const { data, error } = await createAdminClient()
    .from("nannies").select("verification_level, identity_verified").eq("user_id", userId).maybeSingle();
  if (error) return true;
  return data?.identity_verified === true || (data?.verification_level ?? 0) >= IDENTITY_VERIFIED_LEVEL;
}

const isVersion = (value: unknown): value is string | null => value === null || (typeof value === "string" && value.length <= 64);

/** Profile: what she changed, at once, both rows with the version she loaded. Null when saved. */
async function saveProfile(userId: string, input: ProfileInput, expected: { profile: string | null; address: string | null }) {
  const saved = await saveOwnProfile(userId, {
    ...(input.first_name !== undefined ? { first_name: input.first_name } : {}),
    ...(input.last_name !== undefined ? { last_name: input.last_name } : {}),
    ...(typeof input.date_of_birth === "string" ? { date_of_birth: input.date_of_birth } : {}),
    ...(input.address ? { address: input.address } : {}),
  }, expected);
  if (saved.status === "stale") return STALE;
  return saved.status === "saved" ? null : FAILED;
}

/** Contact details: her mobile, normalised, with her profile's version. Null when saved. */
async function saveContact(session: Session, userId: string, mobile: string, expected: string | null) {
  const written = await writeOwnProfile(session, userId, { mobile_number: normaliseUkMobile(mobile.trim()) }, expected);
  if (written.status === "stale") return STALE;
  return written.status === "saved" ? null : FAILED;
}

export async function updateNannyAccountSettings(data: UpdateNannyAccountData): Promise<UpdateNannyAccountResult> {
  if (typeof data !== "object" || data === null || !isVersion((data as { expected_updated_at?: unknown }).expected_updated_at)) return INVALID;
  const supabase = createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return { success: false, error: SIGNED_OUT };

  const { expected_updated_at: expected, expected_address_updated_at: expectedAddress, ...input } = data;
  const profileChange = PROFILE_KEYS.some((key) => key in input);
  if (profileChange && (!isVersion(expectedAddress) || "mobile_number" in input)) return INVALID;
  const fields = checkProfileInput(input);
  if (Object.keys(fields).length > 0) return { success: false, error: EDIT_MESSAGES.checkMarked, code: "invalid", fields };
  if (LOCKED_KEYS.some((key) => key in input) && (await identityLocked(user.id))) {
    return { success: false, error: PROFILE_MESSAGES.locked, code: "locked" };
  }

  const refused = profileChange
    ? await saveProfile(user.id, input, { profile: expected, address: expectedAddress ?? null })
    : typeof input.mobile_number === "string" ? await saveContact(supabase, user.id, input.mobile_number, expected) : null;
  if (refused) return refused;

  revalidatePath("/nanny/settings");
  revalidatePath("/nanny/profile");
  return { success: true, error: null };
}
