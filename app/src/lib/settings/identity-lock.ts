/**
 * Her name and date of birth are fixed once her identity is verified: `nannies.identity_verified`, or verification
 * level 2 and up. A row that can't be read counts as locked (logged by its code only); no nannies row (not a nanny)
 * does not.
 *
 * Used by the server actions that write her name or date of birth (Settings Profile, the profile editor): the rule is
 * enforced in the action. Server-only by use (it uses the service key) and never a `"use server"` file: an async export
 * there would be callable from a browser.
 *
 * BB-wave1-041126, 2026-11-09.
 */

import { failureCode } from "@/lib/failure-code";
import { createAdminClient } from "@/lib/supabase/admin";
import { VERIFICATION_LEVEL } from "@/lib/verification";

export async function identityLocked(userId: string): Promise<boolean> {
  try {
    const { data, error } = await createAdminClient()
      .from("nannies").select("verification_level, identity_verified").eq("user_id", userId).maybeSingle();
    if (error) throw error;
    return data?.identity_verified === true || (data?.verification_level ?? 0) >= VERIFICATION_LEVEL.ID_VERIFIED;
  } catch (error) {
    console.error("[identityLocked] lookup failed", { code: failureCode(error) });
    return true;
  }
}
