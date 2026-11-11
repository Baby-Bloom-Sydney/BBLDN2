"use server";

/**
 * The parent's Profile and Contact details Save, moved out of `parent.ts` (over 800 lines) with the same exported
 * name. Edit mode on both pages calls it once per Save.
 *
 * - The version she loaded (`expected_updated_at`, the profile row's `updated_at`) is required: the write is
 *   conditional on it (`writeOwnProfile`), so a row changed since answers `stale` and nothing is written.
 * - Today's rules (`checkParentProfileInput`, the same check her page runs), each refusal by field, nothing written.
 * - Only the keys she sent are written, on her own row with her own session (her own-row RLS): names trimmed, the
 *   mobile stored as +44…, the town and postcode as the address search gave them. Never a street line.
 * - The answer has the nanny action's shape (`UpdateNannyAccountResult`), so edit mode reads it with `accountOutcome`.
 * - Input from the browser is narrowed before use; refusals are fixed, plain messages. Nothing here logs.
 *
 * Only async functions are exported: every async export of a `"use server"` file is callable from a browser.
 */

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { EDIT_MESSAGES } from "@/lib/settings/edit-messages";
import { checkParentProfileInput, type ParentProfileInput } from "@/lib/settings/parent-profile-rules";
import { writeOwnProfile } from "@/lib/settings/profile-write";
import { normaliseUkMobile } from "@/lib/uk-contact";

/** The fields she changed (a null or blank is refused by the check) and the version she loaded. */
export interface UpdateParentAccountData extends ParentProfileInput {
  /** The profile row's `updated_at` she loaded (null = none yet). Required. */
  readonly expected_updated_at: string | null;
}

export interface UpdateParentAccountResult {
  readonly success: boolean;
  readonly error: string | null;
  readonly code?: "invalid" | "stale";
  readonly fields?: Readonly<Record<string, string>>;
}

const KEYS = ["first_name", "last_name", "date_of_birth", "mobile_number", "suburb", "postcode"] as const;
const AREA_KEYS: ReadonlySet<string> = new Set(["suburb", "postcode"]);
const SIGNED_OUT = "Please sign in again, then try once more.";
const INVALID: UpdateParentAccountResult = { success: false, error: EDIT_MESSAGES.checkMarked, code: "invalid", fields: {} };
const STALE: UpdateParentAccountResult = { success: false, error: EDIT_MESSAGES.stale, code: "stale" };
const FAILED: UpdateParentAccountResult = { success: false, error: "Failed to update account info" };
const SAVED: UpdateParentAccountResult = { success: true, error: null };

const isVersion = (value: unknown): value is string | null => value === null || (typeof value === "string" && value.length <= 64);

/** The keys she sent, and only those; null when an area part isn't text. */
function narrow(data: Readonly<Record<string, unknown>>): ParentProfileInput | null {
  const sent = KEYS.filter((key) => Object.hasOwn(data, key));
  if (sent.some((key) => AREA_KEYS.has(key) && typeof data[key] !== "string")) return null;
  return Object.fromEntries(sent.map((key) => [key, data[key]])) as ParentProfileInput;
}

/** The row as written, once the check has passed: every value sent is text by then. */
function rowOf(input: ParentProfileInput): Readonly<Record<string, string>> {
  const text = (value: string | null | undefined): value is string => typeof value === "string";
  return {
    ...(text(input.first_name) ? { first_name: input.first_name.trim() } : {}),
    ...(text(input.last_name) ? { last_name: input.last_name.trim() } : {}),
    ...(text(input.date_of_birth) ? { date_of_birth: input.date_of_birth } : {}),
    ...(text(input.mobile_number) ? { mobile_number: normaliseUkMobile(input.mobile_number.trim()) } : {}),
    ...(text(input.suburb) ? { suburb: input.suburb } : {}),
    ...(text(input.postcode) ? { postcode: input.postcode } : {}),
  };
}

export async function updateParentAccountSettings(data: UpdateParentAccountData): Promise<UpdateParentAccountResult> {
  if (typeof data !== "object" || data === null || !isVersion((data as { expected_updated_at?: unknown }).expected_updated_at)) return INVALID;
  const supabase = createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return { success: false, error: SIGNED_OUT };

  const input = narrow(data as unknown as Readonly<Record<string, unknown>>);
  if (input === null) return INVALID;
  const fields = checkParentProfileInput(input);
  if (Object.keys(fields).length > 0) return { success: false, error: EDIT_MESSAGES.checkMarked, code: "invalid", fields };

  const row = rowOf(input);
  if (Object.keys(row).length === 0) return SAVED;
  const written = await writeOwnProfile(supabase, user.id, row, data.expected_updated_at);
  if (written.status === "stale") return STALE;
  if (written.status !== "saved") return FAILED;

  revalidatePath("/parent/settings");
  return SAVED;
}
