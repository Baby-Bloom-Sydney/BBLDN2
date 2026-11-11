/**
 * signupViaInvite — moved unchanged from `lib/actions/bapp/child-invites.ts`. Server-only, not a server action: the
 * one caller is `signUp` (`lib/auth/actions.ts`), with the id of the user it has just created.
 *
 * BB-wave1-041126, 2026-11-09.
 */
import crypto from "node:crypto";
import { revalidateTag } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { invitesDisabled } from "@/lib/invite/flags";
import { INVITE_TOKEN_REGEX } from "@/lib/invite/redirect";

function isValidTokenFormat(token: unknown): token is string {
  return typeof token === "string" && INVITE_TOKEN_REGEX.test(token);
}

/**
 * Stamps recipient_user_id on the invite row after a freshly-signed-up
 * user has been created in auth.users. Must be called from inside the
 * signUp server action (NOT from the browser) using the admin client,
 * because the user's session may not be fully established at that
 * moment depending on the email-confirm setting.
 *
 * Tracking field only — does NOT create the link / placement. The user
 * still needs to tap Connect on the landing page to claim the invite.
 */
export async function signupViaInvite(params: {
  token: string;
  userId: string;
}): Promise<{ success: boolean; error: string | null }> {
  if (invitesDisabled()) {
    return { success: false, error: "invites_disabled" };
  }
  if (!isValidTokenFormat(params.token)) {
    return { success: false, error: "invite_not_found" };
  }

  try {
    const admin = createAdminClient();
    // Race guard: only stamp if the slot is still empty. Two concurrent
    // signups via the same shared token resolve in arrival order — the
    // second writer no-ops rather than silently overwriting the first.
    // The PG `connect_child_invite` function still gates the actual claim,
    // so this is purely about which user's pending-invite card surfaces.
    const { error } = await admin
      .from("child_invites")
      .update({ recipient_user_id: params.userId })
      .eq("token", params.token)
      .eq("status", "pending")
      .is("recipient_user_id", null);

    if (error) {
      console.error("signupViaInvite update error:", error);
      return { success: false, error: "stamp_failed" };
    }

    // Audit log — token is hashed for cross-reference without leaking.
    const tokenHash = crypto
      .createHash("sha256")
      .update(params.token)
      .digest("hex")
      .slice(0, 16);
    await admin.from("activity_logs").insert({
      action_type: "signup_via_invite",
      user_id: params.userId,
      action_details: { token_hash: tokenHash },
    });

    revalidateTag("pending-invites");

    return { success: true, error: null };
  } catch (err) {
    console.error("signupViaInvite unexpected error:", err);
    return { success: false, error: "Failed to record signup-via-invite" };
  }
}
