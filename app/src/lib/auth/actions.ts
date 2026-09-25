"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { redirect } from "next/navigation";
import { UserRole } from "./types";
import { getDashboardPath } from "./roles";
import { sendEmail } from "@/lib/email/resend";
import { buildWelcomeNannyEmail } from "@/lib/email/templates/welcome-nanny";
import { buildWelcomeParentEmail } from "@/lib/email/templates/welcome-parent";
import { buildWelcomeInviteParentEmail } from "@/lib/email/templates/welcome-invite-parent";
import { capitalizeName } from "@/lib/utils";
import { signupViaInvite } from "@/lib/actions/bapp/child-invites";
import { isUkMobile, normaliseUkMobile } from "@/lib/uk-contact";

const INVITE_TOKEN_REGEX = /^[A-HJKMN-Z2-9]{4}-[A-HJKMN-Z2-9]{4}$/;

type InviteDirection = "nanny_to_parent" | "parent_to_nanny";

type InviteContext = {
  token: string;
  direction: InviteDirection;
  /** First name of the invite creator (the nanny in nanny_to_parent flow,
   *  the parent in parent_to_nanny). Used by the welcome-variant email so
   *  the recipient sees who invited them. May be `null` if the inviter
   *  hasn't filled their profile yet. */
  inviterFirstName: string | null;
  /** First name of the child the invite is for. May be `null` for a freshly
   *  created child_client row that hasn't been edited. */
  childFirstName: string | null;
  /** child_client row id — keeps deep-linking options open (e.g. an email
   *  CTA that bypasses the invite landing). Currently unused by callers
   *  but cheap to surface here while we already have it. */
  childClientId: string;
};

function isInviteDirection(value: unknown): value is InviteDirection {
  return value === "nanny_to_parent" || value === "parent_to_nanny";
}

/** Narrows the unpredictable Supabase FK-embed result shape (single row,
 *  array of rows, null, or undefined) down to a single row or null. */
function pickFkRow<T>(value: T | T[] | null | undefined): T | null {
  if (value == null) return null;
  if (Array.isArray(value)) return value[0] ?? null;
  return value;
}

async function lookupValidInvite(
  token: string,
  expectedRole: UserRole,
): Promise<InviteContext | null> {
  if (!INVITE_TOKEN_REGEX.test(token)) {
    return null;
  }

  const admin = createAdminClient();

  // Step 1 — child_invites + child_client (direct FK embed, supported).
  // We do NOT embed user_profiles here: child_invites.created_by_user_id
  // references auth.users(id), and there's no direct FK between
  // child_invites and user_profiles, so PostgREST silently drops the
  // embed (real-soak finding 2026-05-06, code-reviewer CRITICAL).
  // The two-hop user_profiles fetch is in step 2 below.
  const { data, error } = await admin
    .from("child_invites")
    .select(
      "direction, status, child_client_id, created_by_user_id, child_client(first_name)",
    )
    .eq("token", token)
    .maybeSingle();

  if (error || !data || data.status !== "pending") {
    return null;
  }

  if (!isInviteDirection(data.direction)) {
    // Defensive: the CHECK constraint on `child_invites.direction` should
    // make this unreachable, but we narrow rather than cast so a future
    // schema drift fails loudly instead of poisoning the InviteContext.
    return null;
  }
  const direction = data.direction;

  // Direction encodes who created it; recipient is the opposite role.
  const expectedRecipientRole: UserRole =
    direction === "nanny_to_parent" ? "parent" : "nanny";
  if (expectedRecipientRole !== expectedRole) {
    return null;
  }

  if (typeof data.child_client_id !== "string" || !data.child_client_id) {
    return null;
  }
  const childClientId = data.child_client_id;

  const child = pickFkRow(data.child_client);
  const childFirstName =
    typeof child?.first_name === "string" && child.first_name.length > 0
      ? child.first_name
      : null;

  // Step 2 — inviter's first name. Separate query because the
  // child_invites → user_profiles relationship is two-hop through
  // auth.users. `created_by_user_id` is nullable (ON DELETE SET NULL),
  // so an orphaned invite is allowed to claim — we just lose the
  // personalised greeting in that case (welcome variant falls back).
  let inviterFirstName: string | null = null;
  const inviterUserId = data.created_by_user_id;
  if (typeof inviterUserId === "string" && inviterUserId) {
    const { data: profile } = await admin
      .from("user_profiles")
      .select("first_name")
      .eq("user_id", inviterUserId)
      .maybeSingle();
    if (
      profile &&
      typeof profile.first_name === "string" &&
      profile.first_name.length > 0
    ) {
      inviterFirstName = profile.first_name;
    }
  }

  return {
    token,
    direction,
    childClientId,
    childFirstName,
    inviterFirstName,
  };
}

function inviteSignupSource(direction: InviteDirection): string {
  return direction === "nanny_to_parent" ? "nanny_invite" : "parent_invite";
}

export interface ActionResult {
  error?: string;
  success?: boolean;
  redirectTo?: string;
}

export async function signUp(formData: FormData): Promise<ActionResult> {
  const supabase = createClient();

  // Clear any existing session first to prevent conflicts
  await supabase.auth.signOut();

  const email = formData.get("email") as string;
  const password = formData.get("password") as string;
  const firstName = formData.get("firstName") as string;
  const lastName = formData.get("lastName") as string;
  const role = formData.get("role") as UserRole;
  const rawInviteToken =
    (formData.get("invite_token") as string | null) ?? null;
  const rawMobile = (formData.get("mobile_number") as string | null) ?? null;

  // Resolve invite context up-front so we can override signup_source.
  // Invalid / mismatched tokens are silently dropped — the standard signup
  // proceeds and the user simply lands on the dashboard.
  let inviteContext: InviteContext | null = null;
  if (rawInviteToken) {
    inviteContext = await lookupValidInvite(rawInviteToken, role);
  }
  const signupSource = inviteContext
    ? inviteSignupSource(inviteContext.direction)
    : (formData.get("signupSource") as string) || "direct";

  // Validate required fields
  if (!email || !password || !firstName || !lastName || !role) {
    return { error: "All fields are required" };
  }

  // Validate email format
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return { error: "Please enter a valid email address" };
  }

  // Validate password strength
  if (password.length < 8) {
    return { error: "Password must be at least 8 characters" };
  }
  if (!/[0-9]/.test(password)) {
    return { error: "Password must include a number" };
  }
  if (!/[^A-Za-z0-9]/.test(password)) {
    return { error: "Password must include a special character" };
  }

  // Validate role
  if (!["nanny", "parent"].includes(role)) {
    return { error: "Invalid role" };
  }

  // T-021 — parent mobile collection at signup. Required + AU-format only
  // when role=parent. Nanny side collects mobile via the apply funnel and
  // writes it to user_profiles via that path; signUp() must NOT require it
  // for role=nanny or `/signup/nanny` + the apply→signup chain breaks.
  // Server-side defence in depth: even if a UI bypasses validation, the
  // request is rejected here before any auth user is created.
  // `isUkMobile` internally normalises before regex-matching, and the regex
  // rejects empty strings, so a single normalise + validate is sufficient.
  let normalisedMobile: string | null = null;
  if (role === "parent") {
    normalisedMobile = normaliseUkMobile(rawMobile ?? "");
    if (!isUkMobile(normalisedMobile)) {
      return {
        error: "A valid UK mobile number is required (07XXX XXX XXX)",
      };
    }
  }

  // 1. Create auth user
  const { data: authData, error: authError } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: {
        first_name: capitalizeName(firstName),
        last_name: capitalizeName(lastName),
      },
    },
  });

  if (authError) {
    console.error("Auth signup error:", authError);
    if (authError.message.includes("already registered")) {
      return { error: "An account with this email already exists" };
    }
    return { error: authError.message };
  }

  if (!authData.user) {
    return { error: "Failed to create user account" };
  }

  const userId = authData.user.id;

  // Use admin client for post-signup inserts to bypass RLS
  // The user's session isn't fully established yet, so RLS auth.uid() checks fail
  const adminClient = createAdminClient();

  try {
    // 2. Insert user role
    const { error: roleError } = await adminClient
      .from("user_roles")
      .insert({ user_id: userId, role });

    if (roleError) {
      console.error("Role insert error:", roleError);
      // Clean up auth user on failure
      await adminClient.auth.admin.deleteUser(userId);
      return { error: "Failed to set up user role. Please try again." };
    }

    // 3. Insert user profile
    // mobile_number is the normalised AU mobile for parents (validated above)
    // or null for nannies (their apply funnel writes it via a separate path).
    const { error: profileError } = await adminClient
      .from("user_profiles")
      .insert({
        user_id: userId,
        first_name: capitalizeName(firstName),
        last_name: capitalizeName(lastName),
        email: email,
        mobile_number: normalisedMobile,
      });

    if (profileError) {
      console.error("Profile insert error:", profileError);
      // Clean up auth user and role on failure
      await adminClient.from("user_roles").delete().eq("user_id", userId);
      await adminClient.auth.admin.deleteUser(userId);
      return { error: "Failed to create user profile. Please try again." };
    }

    // 4. Insert role-specific record (nanny or parent)
    if (role === "nanny") {
      const { error: nannyError } = await adminClient.from("nannies").insert({
        user_id: userId,
        status: "pending_verification",
        verification_tier: "tier1",
      });

      if (nannyError) {
        console.error("Nanny insert error:", nannyError);
        return { error: "Failed to create nanny profile. Please try again." };
      }
    } else if (role === "parent") {
      const { error: parentError } = await adminClient.from("parents").insert({
        user_id: userId,
        status: "active",
        signup_source: signupSource,
      });

      if (parentError) {
        console.error("Parent insert error:", parentError);
        return { error: "Failed to create parent profile. Please try again." };
      }
    }

    // 5. Insert user progress
    const { error: progressError } = await adminClient
      .from("user_progress")
      .insert({
        user_id: userId,
        stage: role === "nanny" ? "nanny_profile_created" : "parent_signup",
      });

    if (progressError) {
      console.error("Progress insert error:", progressError);
      // Non-critical, don't fail the signup
    }

    // 6. Send welcome email (fire-and-forget).
    //
    // Three variants (amendment A-01, 2026-05-06):
    //   • role=nanny                  → standard nanny welcome
    //   • role=parent, no inviteCtx   → standard parent welcome
    //   • role=parent, inviteCtx with
    //     direction=nanny_to_parent   → invite-flow welcome (frames the
    //                                   product as "track {child}'s day
    //                                   with {nanny}", not "find a nanny")
    //
    // The opposite case — role=nanny signing up via a parent_to_nanny
    // invite — currently falls through to the standard nanny welcome.
    // It cannot accidentally reach the parent fall-through below because
    // `lookupValidInvite` only returns a non-null inviteContext when the
    // direction matches the role being signed up; a parent_to_nanny
    // invite with role=nanny is handled in the first `if` branch and
    // never reaches the parent-flow else.
    //
    // emailType strings are distinguishable in `email_logs` so the variants
    // can be measured separately:
    //   `welcome` (standard parent + nanny — preserved for back-compat with
    //              existing dashboards/queries) and
    //   `welcome-invite-parent` (new).
    const appUrl =
      process.env.NEXT_PUBLIC_APP_URL || "https://app-babybloom.vercel.app";

    if (role === "nanny") {
      const { subject, html } = buildWelcomeNannyEmail({ firstName, appUrl });
      sendEmail({
        to: email,
        subject,
        html,
        emailType: "welcome",
        recipientUserId: userId,
      }).catch((err) => console.error("[Signup] ACC-001 email error:", err));
    } else if (inviteContext && inviteContext.direction === "nanny_to_parent") {
      // Inviter + child names may legitimately be null when the nanny
      // hasn't filled her profile or named the child yet. The template
      // handles the fallback wording internally — the subject avoids
      // the merge-error-looking "your nanny" phrase, the body uses
      // it inline where it reads naturally.
      const { subject, html } = buildWelcomeInviteParentEmail({
        firstName,
        nannyFirstName: inviteContext.inviterFirstName,
        childFirstName: inviteContext.childFirstName,
        inviteToken: inviteContext.token,
        appUrl,
      });
      sendEmail({
        to: email,
        subject,
        html,
        emailType: "welcome-invite-parent",
        recipientUserId: userId,
      }).catch((err) => console.error("[Signup] ACC-003 email error:", err));
    } else if (formData.get("skip_welcome_email") === "true") {
      // T-040 Step 1c: caller (currently `signUpAndConvertLead` for the
      // adv funnel) takes responsibility for sending a context-aware
      // welcome email AFTER the position is created + autofire has run.
      // We skip here so the parent never sees the generic "now create
      // a position" copy when their position is already live.
    } else {
      const { subject, html } = buildWelcomeParentEmail({ firstName, appUrl });
      sendEmail({
        to: email,
        subject,
        html,
        emailType: "welcome",
        recipientUserId: userId,
      }).catch((err) => console.error("[Signup] ACC-002 email error:", err));
    }

    // 7. If signup came in via an invite link, stamp recipient_user_id
    //    on the invite row and route the user to the invite landing page
    //    so they can claim it. Tracking-only — does NOT create the link.
    if (inviteContext) {
      const stampResult = await signupViaInvite({
        token: inviteContext.token,
        userId,
      });
      if (!stampResult.success) {
        // Non-fatal: account exists, user can still claim manually by
        // visiting the invite URL.
        console.error(
          "[Signup] signupViaInvite failed (non-fatal):",
          stampResult.error,
        );
      }
      // `?auto=1` tells InviteLandingClient to auto-fire `connect` once the
      // page mounts so the freshly-signed-up parent doesn't have to tap a
      // second "Connect" button. Switch-ack and other gates still apply
      // client-side; auto-mode skips itself when those are present.
      return {
        success: true,
        redirectTo: `/invite/${inviteContext.token}?auto=1`,
      };
    }

    return {
      success: true,
      redirectTo: getDashboardPath(role),
    };
  } catch (error) {
    console.error("Signup error:", error);
    return { error: "An unexpected error occurred. Please try again." };
  }
}

export async function signIn(formData: FormData): Promise<ActionResult> {
  const supabase = createClient();

  // Clear any existing session first to prevent conflicts
  await supabase.auth.signOut();

  const email = formData.get("email") as string;
  const password = formData.get("password") as string;

  if (!email || !password) {
    return { error: "Email and password are required" };
  }

  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    console.error("Sign in error:", error);
    if (error.message.includes("Invalid login credentials")) {
      return { error: "Invalid email or password" };
    }
    return { error: error.message };
  }

  if (!data.user) {
    return { error: "Failed to sign in" };
  }

  // Fetch user role to determine redirect
  const { data: roleData, error: roleError } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", data.user.id)
    .single();

  if (roleError || !roleData) {
    console.error("Role fetch error:", roleError);
    return { error: "Failed to fetch user role" };
  }

  const role = roleData.role as UserRole;
  return {
    success: true,
    redirectTo: getDashboardPath(role),
  };
}

export async function signOut(): Promise<void> {
  const supabase = createClient();
  await supabase.auth.signOut();
  redirect("/login");
}

export async function forgotPassword(
  formData: FormData,
): Promise<ActionResult> {
  const supabase = createClient();

  const email = formData.get("email") as string;

  if (!email) {
    return { error: "Email is required" };
  }

  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${process.env.NEXT_PUBLIC_APP_URL}/api/auth/callback?next=/reset-password`,
  });

  if (error) {
    console.error("Forgot password error:", error);
    return { error: "Failed to send reset email. Please try again." };
  }

  return { success: true };
}

export async function resetPassword(formData: FormData): Promise<ActionResult> {
  const supabase = createClient();

  const password = formData.get("password") as string;
  const confirmPassword = formData.get("confirmPassword") as string;

  if (!password || !confirmPassword) {
    return { error: "Both password fields are required" };
  }

  if (password !== confirmPassword) {
    return { error: "Passwords do not match" };
  }

  if (password.length < 8) {
    return { error: "Password must be at least 8 characters" };
  }
  if (!/[0-9]/.test(password)) {
    return { error: "Password must include a number" };
  }
  if (!/[^A-Za-z0-9]/.test(password)) {
    return { error: "Password must include a special character" };
  }

  const { error } = await supabase.auth.updateUser({
    password,
  });

  if (error) {
    console.error("Reset password error:", error);
    return { error: "Failed to reset password. Please try again." };
  }

  return { success: true, redirectTo: "/login" };
}

export async function getUserRole(userId: string): Promise<UserRole | null> {
  const supabase = createClient();

  const { data, error } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .single();

  if (error || !data) {
    return null;
  }

  return data.role as UserRole;
}
