"use server";

/**
 * Account-security flows initiated from the settings page.
 *
 * Currently:
 *   - `requestPasswordChange` — sends a password-reset email to
 *     the authenticated user's registered address. Standard
 *     Supabase pattern: link in the email lands at
 *     `/api/auth/callback?next=/reset-password`, which exchanges
 *     the code and routes to the existing reset-password page
 *     where the user picks a new value.
 *
 * Why we use the email-confirm flow rather than asking for the
 * current password in-app:
 *   - The user is already authenticated, but a password change
 *     is sensitive enough to warrant an out-of-band confirmation.
 *     Email-link confirmation proves the user controls the
 *     registered address — protects against session hijack
 *     (someone with stolen cookies still can't change the
 *     password unless they also have the inbox).
 *   - Mirrors the "forgot password" flow so users see a single,
 *     consistent password-change pattern.
 */

import { createClient } from "@/lib/supabase/server";
import { SITE_URL } from "@/lib/constants";

export async function requestPasswordChange(): Promise<{
  success: boolean;
  error: string | null;
}> {
  try {
    const supabase = createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user || !user.email) {
      return { success: false, error: "Not authenticated" };
    }

    const siteUrl = process.env.NEXT_PUBLIC_APP_URL ?? SITE_URL;
    const redirectTo = `${siteUrl}/api/auth/callback?next=/reset-password`;

    const { error } = await supabase.auth.resetPasswordForEmail(user.email, {
      redirectTo,
    });
    if (error) {
      console.error("[requestPasswordChange] Supabase error:", error);
      return {
        success: false,
        error: "Couldn't send the password reset email. Please try again.",
      };
    }
    return { success: true, error: null };
  } catch (err) {
    console.error("requestPasswordChange unexpected error:", err);
    return { success: false, error: "Couldn't start password change." };
  }
}
