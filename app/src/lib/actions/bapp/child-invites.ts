"use server";

/**
 * Child invite linking — server actions.
 *
 * Implements the redesign from system/APP/Nanny:Parent\ child\ linking/
 * (canonical spec: 02-design.md; this file maps to 04-server-actions.md
 * sections 3-10).
 *
 * Module boundary: ALL invite-related logic lives here. Other code
 * consumes via the typed envelope contract — never reaches inside.
 *
 * Kill switch: every invite-creation entry point checks
 * INVITE_LINKS_ENABLED. When 'false', actions early-return with
 * 'invites_disabled' (audit fix C11).
 *
 * Atomic transactions go through SECURITY DEFINER PG functions
 * (connect_child_invite, ensure_placement, get_invite_preview,
 * get_pending_invites_for_recipient) installed in the migration.
 * Direct UPDATEs to child_client.parent_user_id / nanny_user_id are
 * forbidden in app code — that invariant is enforced via review per
 * 04 §8 and 06 §8.
 */

import crypto from "node:crypto";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { revalidatePath, revalidateTag } from "next/cache";
import { dispatchParentConnectedToChild } from "./child-onboarding-dispatch";
import type {
  ChildInviteDirection,
  ChildInvitePreview,
  PendingInviteCard,
} from "@/types/bapp";
import { invitesDisabled } from "@/lib/invite/flags";
import { SITE_URL } from "@/lib/constants";

// ── Internal helpers ────────────────────────────────────────────────────

/** Builds the public invite URL. Default origin per audit fix C13. */
function buildInviteUrl(token: string): string {
  const base =
    SITE_URL;
  return `${base}/invite/${token}`;
}

/**
 * Validates token format BEFORE any DB call. Defence-in-depth rate
 * limiter: malformed tokens never reach Postgres. Tokens are exactly
 * `XXXX-XXXX` from the Crockford-like alphabet (uppercase, no I/L/O/0/1).
 */
const TOKEN_FORMAT_REGEX = /^[A-HJKMN-Z2-9]{4}-[A-HJKMN-Z2-9]{4}$/;
function isValidTokenFormat(token: unknown): token is string {
  return typeof token === "string" && TOKEN_FORMAT_REGEX.test(token);
}

// mintChildInvite was moved to `@/lib/invite/mint.ts` so Next.js doesn't
// register it as a callable Server Action (every async export from a
// "use server" file is auto-exposed). Callers import from there.
// (security-reviewer H4, 2026-05-05.)

// ── 4b. getInviteForChild (creator-side banner read) ──────────────────
//
// Returns the pending invite for a child the caller created.
// Used by InviteBanner to display the share URL on the creator's side.
// The token IS exposed in the response — but only to the user who minted
// it (`created_by_user_id === auth.uid()`), so this is consistent with
// the same user already seeing it via the AddChild post-create surface.

export async function getInviteForChild(childId: string): Promise<{
  success: boolean;
  error: string | null;
  data: { token: string; url: string; direction: ChildInviteDirection } | null;
}> {
  // Read operation — NOT gated by invitesDisabled(). When the kill
  // switch is on we still let the banner load the existing share URL
  // so the creator can copy a link they minted earlier; only NEW mints
  // are blocked. (security-reviewer M3, 2026-05-05.)
  try {
    const supabase = createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) {
      return { success: false, error: "not_authenticated", data: null };
    }

    const admin = createAdminClient();
    const { data: invite, error } = await admin
      .from("child_invites")
      .select("token, direction, created_by_user_id")
      .eq("child_client_id", childId)
      .eq("status", "pending")
      .maybeSingle();

    if (error) {
      console.error("getInviteForChild select error:", error);
      return { success: false, error: "lookup_failed", data: null };
    }
    if (!invite) {
      return { success: true, error: null, data: null };
    }
    // Authorisation: only the creator can read the token. Recipients
    // never see the token via this surface (dashboard cards use the
    // separate `getPendingInvitesForUser` which strips the token).
    if (invite.created_by_user_id !== user.id) {
      return { success: false, error: "not_creator", data: null };
    }

    return {
      success: true,
      error: null,
      data: {
        token: invite.token,
        url: buildInviteUrl(invite.token),
        direction: invite.direction as ChildInviteDirection,
      },
    };
  } catch (err) {
    console.error("getInviteForChild unexpected error:", err);
    return { success: false, error: "lookup_failed", data: null };
  }
}

// ── 4c. getSwitchContextForInvite (landing-page switch-detection) ─────
//
// Implements the switch-confirmation surface from
// `CORRECTION-UNIQUE-PLACEMENT-CONSTRAINT.md`. When an authenticated
// parent opens a nanny→parent invite landing page, we need to know:
// "do they currently have an active placement with a DIFFERENT nanny
// than the inviter?" If yes, the UI gates the Connect button behind a
// confirmation checkbox so the auto-end-on-switch in `ensure_placement`
// is never a surprise.
//
// Returns `{ isSwitching: false, fromNannyName: null }` for every
// case where the gate is unnecessary — anon, non-parent, no existing
// placement, same-nanny invite, parent_to_nanny direction, malformed
// token. The default-deny shape means the UI always gets a usable
// answer; an error in lookup is preferred to be silent (no false
// positives) since the auto-end-on-switch is itself safe.

export async function getSwitchContextForInvite(token: string): Promise<{
  success: boolean;
  error: string | null;
  data: { isSwitching: boolean; fromNannyName: string | null };
}> {
  const noSwitch = {
    success: true as const,
    error: null,
    data: { isSwitching: false, fromNannyName: null },
  };

  if (!isValidTokenFormat(token)) return noSwitch;

  try {
    const supabase = createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) return noSwitch;

    const admin = createAdminClient();

    // 1. Resolve the invite's intended nanny. Direction filter cuts the
    //    parent_to_nanny case immediately — switching is only meaningful
    //    when a nanny is inviting a parent.
    const { data: invite } = await admin
      .from("child_invites")
      .select("created_by_user_id, direction, status")
      .eq("token", token)
      .maybeSingle();
    if (
      !invite ||
      invite.status !== "pending" ||
      invite.direction !== "nanny_to_parent"
    ) {
      return noSwitch;
    }
    const invitingNannyUserId = invite.created_by_user_id as string;

    // 2. Resolve the caller's parent_id.
    const { data: parent } = await admin
      .from("parents")
      .select("id")
      .eq("user_id", user.id)
      .maybeSingle();
    if (!parent) return noSwitch;

    // 3. Existing active placement?
    const { data: placement } = await admin
      .from("nanny_placements")
      .select("nanny_id")
      .eq("parent_id", parent.id)
      .eq("status", "active")
      .maybeSingle();
    if (!placement) return noSwitch;

    // 4. Resolve the placed nanny's user_id and compare.
    const { data: nanny } = await admin
      .from("nannies")
      .select("user_id")
      .eq("id", placement.nanny_id)
      .maybeSingle();
    if (!nanny || nanny.user_id === invitingNannyUserId) return noSwitch;

    // 5. Look up the previous nanny's first_name for UI display.
    const { data: profile } = await admin
      .from("user_profiles")
      .select("first_name")
      .eq("user_id", nanny.user_id)
      .maybeSingle();

    return {
      success: true,
      error: null,
      data: {
        isSwitching: true,
        fromNannyName: profile?.first_name ?? null,
      },
    };
  } catch (err) {
    console.error("getSwitchContextForInvite unexpected error:", err);
    // Default-deny on lookup failure — caller still sees Connect, the
    // PG-function side enforces single-nanny via the unique index.
    return noSwitch;
  }
}

// regenerateChildInvite — REMOVED 2026-05-04.
// Per token-stability policy on mintChildInvite above: tokens never
// rotate while pending. If a token leaks, the creator revokes (the
// invite stays at status='revoked', recipient sees a "no longer
// active" state) and creates a new child to mint a fresh token.
//
// The `invite_regenerated` value remains in the `activity_logs.action_type`
// CHECK constraint as a no-op reserved value — left intact to avoid a
// throwaway migration if the policy is ever revisited.

// ── 5. revokeChildInvite ───────────────────────────────────────────────

export async function revokeChildInvite(childId: string): Promise<{
  success: boolean;
  error: string | null;
}> {
  if (invitesDisabled()) {
    return { success: false, error: "invites_disabled" };
  }

  try {
    const supabase = createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) {
      return { success: false, error: "not_authenticated" };
    }

    const admin = createAdminClient();

    // Authorise: only the creator can revoke.
    const { data: current } = await admin
      .from("child_invites")
      .select("created_by_user_id")
      .eq("child_client_id", childId)
      .eq("status", "pending")
      .maybeSingle();
    if (!current) {
      return { success: false, error: "no_pending_invite" };
    }
    if (current.created_by_user_id !== user.id) {
      return { success: false, error: "not_creator" };
    }

    const { error: revokeError } = await admin
      .from("child_invites")
      .update({
        status: "revoked",
        revoked_at: new Date().toISOString(),
        revoked_reason: "manual",
      })
      .eq("child_client_id", childId)
      .eq("status", "pending");

    if (revokeError) {
      console.error("revokeChildInvite error:", revokeError);
      // Opaque code — never echo the raw driver message to the client.
      // (security-reviewer H3, 2026-05-05.)
      return { success: false, error: "revoke_failed" };
    }

    await admin.from("activity_logs").insert({
      action_type: "invite_revoked",
      user_id: user.id,
      action_details: { child_id: childId, reason: "manual" },
    });

    revalidateTag("pending-invites");

    return { success: true, error: null };
  } catch (err) {
    console.error("revokeChildInvite unexpected error:", err);
    return { success: false, error: "Failed to revoke invite" };
  }
}

// ── 6. getInvitePreview (public — anonymous-safe) ──────────────────────

export async function getInvitePreview(token: string): Promise<{
  success: boolean;
  error: string | null;
  data: ChildInvitePreview | null;
}> {
  // Token-format pre-check: defence-in-depth rate limiter.
  if (!isValidTokenFormat(token)) {
    return { success: false, error: "invite_not_found", data: null };
  }

  try {
    // Use the user-scoped client so the JWT (or absence) flows into the
    // SECURITY DEFINER function's auth.uid() check. The function itself
    // gates redaction on auth.uid() IS NOT NULL.
    const supabase = createClient();
    const { data, error } = await supabase.rpc("get_invite_preview", {
      invite_token: token,
    });

    if (error) {
      console.error("getInvitePreview rpc error:", error);
      return { success: false, error: "transaction_failed", data: null };
    }

    if (!data || data.length === 0) {
      return { success: false, error: "invite_not_found", data: null };
    }

    const row = data[0] as {
      status: string;
      direction: string;
      child_first_name: string;
      inviter_display: string;
    };

    return {
      success: true,
      error: null,
      data: {
        status: row.status as ChildInvitePreview["status"],
        direction: row.direction as ChildInviteDirection,
        childFirstName: row.child_first_name,
        inviterDisplay: row.inviter_display,
      },
    };
  } catch (err) {
    console.error("getInvitePreview unexpected error:", err);
    return { success: false, error: "transaction_failed", data: null };
  }
}

// ── 7. signupViaInvite (called server-side from inside signUp) ─────────

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

/**
 * Best-effort A-08 parent welcome dispatch. Runs after
 * `connect_child_invite` commits the linkage — the RPC has already
 * succeeded, so NOTHING in here may surface as a caller-facing error.
 *
 * - Reads `child_client` to resolve parent_user_id (the recipient)
 *   and the linked nanny_user_id (for the welcome's nanny_first_name).
 * - Reads both user_profiles in parallel for first names.
 * - Dispatches the proactive trigger fire-and-forget.
 *
 * Every read here is wrapped in `.catch` so a transport-layer throw
 * cannot escape this function and contaminate the outer try/catch
 * (which would otherwise return success:false to the client and
 * cause a confusing retry against an already-claimed invite).
 */
async function dispatchParentWelcomeBestEffort(input: {
  admin: ReturnType<typeof createAdminClient>;
  childId: string;
}): Promise<void> {
  const { admin, childId } = input;
  try {
    const { data: childRow, error: childRowError } = await admin
      .from("child_client")
      .select("first_name, parent_user_id, nanny_user_id")
      .eq("id", childId)
      .maybeSingle<{
        first_name: string | null;
        parent_user_id: string | null;
        nanny_user_id: string | null;
      }>();
    if (childRowError) {
      console.error(
        "[connectChildInvite] post-claim child_client read failed; skipping welcome dispatch:",
        childRowError.code,
      );
      return;
    }
    if (!childRow) {
      console.warn(
        "[connectChildInvite] post-claim child row not found; skipping welcome dispatch",
        { childId },
      );
      return;
    }
    if (!childRow.parent_user_id || !childRow.nanny_user_id) {
      // Theoretically impossible post-claim — RPC populates both
      // pointers in a single transaction. Log enough detail to
      // diagnose if it ever fires.
      console.warn(
        "[connectChildInvite] post-claim child row has null pointer; skipping welcome dispatch",
        {
          childId,
          parentUserId: childRow.parent_user_id,
          nannyUserId: childRow.nanny_user_id,
        },
      );
      return;
    }

    type ProfileResult = {
      data: { first_name: string | null } | null;
      error: { code?: string; message?: string } | null;
    };
    const profileFallback: ProfileResult = { data: null, error: null };
    const fetchProfile = async (
      userId: string,
      label: string,
    ): Promise<ProfileResult> => {
      try {
        return await admin
          .from("user_profiles")
          .select("first_name")
          .eq("user_id", userId)
          .maybeSingle<{ first_name: string | null }>();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(
          `[connectChildInvite] ${label} profile fetch threw:`,
          message,
        );
        return profileFallback;
      }
    };
    const [parentProfileRes, nannyProfileRes] = await Promise.all([
      fetchProfile(childRow.parent_user_id, "parent"),
      fetchProfile(childRow.nanny_user_id, "nanny"),
    ]);
    if (parentProfileRes.error) {
      console.warn(
        "[connectChildInvite] parent profile read error; dispatching with empty parent_first_name:",
        parentProfileRes.error.code,
      );
    }
    if (nannyProfileRes.error) {
      console.warn(
        "[connectChildInvite] nanny profile read error; dispatching with empty nanny_first_name:",
        nannyProfileRes.error.code,
      );
    }

    dispatchParentConnectedToChild({
      recipientUserId: childRow.parent_user_id,
      childId,
      childFirstName: (childRow.first_name ?? "").trim(),
      parentFirstName: parentProfileRes.data?.first_name?.trim() ?? "",
      nannyFirstName: nannyProfileRes.data?.first_name?.trim() ?? "",
    });
  } catch (err) {
    // Belt-and-braces: any exception that escapes the inner branches
    // (which we don't expect) MUST NOT propagate back to the action.
    const message = err instanceof Error ? err.message : String(err);
    console.error(
      "[connectChildInvite] unexpected error in best-effort welcome dispatch:",
      message,
    );
  }
}

// ── 8. connectChildInvite (the atomic claim transaction) ───────────────

/**
 * The most security-critical action in the file. All DB writes happen
 * inside the SECURITY DEFINER PG function `connect_child_invite()`.
 * This wrapper authenticates the caller, calls the RPC with the
 * caller's user_id as an explicit parameter, and translates RAISE
 * EXCEPTION error codes into the action's error envelope.
 *
 * Stable error codes (per 03-schema-migration.md):
 *   P0001 invite_not_found         P0005 role_mismatch
 *   P0002 invite_already_connected P0006 child_not_found
 *   P0003 invite_revoked           P0007 role_table_missing
 *   P0004 no_role
 */
const CONNECT_ERROR_MAP: Record<string, string> = {
  P0001: "invite_not_found",
  P0002: "invite_already_connected",
  P0003: "invite_revoked",
  P0004: "no_role",
  P0005: "role_mismatch",
  P0006: "child_not_found",
  P0007: "role_table_missing",
  // P0010 = concurrent_switch_conflict — two parents tried to switch to
  // different nannies in the same instant; the unique-per-parent index
  // caught the loser. Maps to transaction_failed so the UI offers a
  // generic retry rather than a confusing race-specific message.
  P0010: "transaction_failed",
};

export async function connectChildInvite(token: string): Promise<{
  success: boolean;
  error: string | null;
  data: { childId: string } | null;
}> {
  if (invitesDisabled()) {
    return { success: false, error: "invites_disabled", data: null };
  }
  if (!isValidTokenFormat(token)) {
    return { success: false, error: "invite_not_found", data: null };
  }

  try {
    const supabase = createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) {
      return { success: false, error: "not_authenticated", data: null };
    }

    const admin = createAdminClient();
    const { data, error } = await admin.rpc("connect_child_invite", {
      p_token: token,
      p_caller_user: user.id,
    });

    if (error) {
      const envelope = CONNECT_ERROR_MAP[error.code] ?? "transaction_failed";
      console.error("connectChildInvite rpc error:", {
        code: error.code,
        envelope,
      });
      return { success: false, error: envelope, data: null };
    }

    if (!data || data.length === 0) {
      return { success: false, error: "transaction_failed", data: null };
    }

    const row = data[0] as { child_id: string };

    // A-08 cascade: dispatch the parent.connected_to_child welcome onto
    // the parent's bot. ALL post-RPC work below is best-effort —
    // the linkage already committed inside the RPC, so no failure
    // here may flip the action's success envelope. The resume banner
    // recovers any missed welcome.
    //
    // The connect_child_invite RPC works in both directions
    // (nanny→parent and parent→nanny). The dispatched recipient is
    // ALWAYS the parent. We resolve who the parent is from the child
    // row's parent_user_id (set by the RPC) rather than assuming the
    // caller is the parent — that assumption breaks under
    // parent_to_nanny direction.
    await dispatchParentWelcomeBestEffort({
      admin,
      childId: row.child_id,
    });

    // Auto-start the family's 30-day trial the first time a parent +
    // nanny become connected on this child. The PG function is
    // idempotent + no-ops when the parent already has a row with
    // `has_used_trial=true` or is a test user. Best-effort — a failure
    // here must not roll back the linkage. (Bailey bug 2026-05-13:
    // previously this was never called, so newly-linked families
    // landed in a "no subscription row" state and the dev page
    // mis-framed them as lapsed.)
    try {
      const { data: linkedChild } = await admin
        .from("child_client")
        .select("parent_user_id")
        .eq("id", row.child_id)
        .maybeSingle<{ parent_user_id: string | null }>();
      if (linkedChild?.parent_user_id) {
        const { error: trialErr } = await admin.rpc(
          "start_family_trial_if_first",
          { p_parent_user_id: linkedChild.parent_user_id },
        );
        if (trialErr) {
          console.error(
            "[connectChildInvite] trial-start rpc error:",
            trialErr,
          );
        }
      }
    } catch (e) {
      console.error("[connectChildInvite] trial-start unexpected:", e);
    }

    // T-015 — record bundled consent at invite-accept moment. The
    // invitee's role determines which agreement: parent →
    // PARENT-APP-CONSENT, nanny → NANNY-ATTESTATION. Both are scoped
    // to the new child. Best-effort: a row miss here does not unwind
    // the link (the consent intent is captured by the checkbox state
    // at submit time; the missing row will be re-prompted by the
    // T-7d renewal cron at next opportunity).
    try {
      const { data: roleRow } = await admin
        .from("user_roles")
        .select("role")
        .eq("user_id", user.id)
        .maybeSingle<{ role: string }>();
      const role = roleRow?.role;
      if (role === "parent" || role === "nanny") {
        const { recordConsent } = await import("@/lib/legal/record-consent");
        const agreementId =
          role === "parent" ? "PARENT-APP-CONSENT" : "NANNY-ATTESTATION";
        const checkpointText =
          role === "parent"
            ? "I consent to Baby Bloom collecting and processing data for this child including photos, daily observations, and any sensitive information I choose to share, in accordance with the Privacy Policy."
            : "I agree to Baby Bloom's professional terms for this engagement, including my responsibilities while caring for this child + handling their data.";
        await recordConsent(
          [
            {
              agreementId,
              checkpointId: "invite-accept",
              checkpointText,
            },
          ],
          row.child_id,
        );
      }
    } catch (consentErr) {
      console.warn(
        "[connectChildInvite] consent record failed (non-fatal):",
        consentErr,
      );
    }

    revalidatePath("/parent");
    revalidatePath("/nanny");
    revalidateTag("pending-invites");

    return { success: true, error: null, data: { childId: row.child_id } };
  } catch (err) {
    console.error("connectChildInvite unexpected error:", err);
    return { success: false, error: "transaction_failed", data: null };
  }
}

// ── 9. declineChildInvite ──────────────────────────────────────────────

/**
 * Clears recipient_user_id but leaves the invite alive at status='pending'.
 * Per design, the same parent (or someone else) can come back later and
 * claim the same token. No DB writes to child_client / nanny_placements.
 */
export async function declineChildInvite(token: string): Promise<{
  success: boolean;
  error: string | null;
}> {
  if (invitesDisabled()) {
    return { success: false, error: "invites_disabled" };
  }
  if (!isValidTokenFormat(token)) {
    return { success: false, error: "invite_not_found" };
  }

  try {
    const supabase = createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) {
      return { success: false, error: "not_authenticated" };
    }

    const admin = createAdminClient();
    // Capture child_id before clearing recipient_user_id (audit metadata).
    const { data: current } = await admin
      .from("child_invites")
      .select("child_client_id, recipient_user_id")
      .eq("token", token)
      .eq("status", "pending")
      .maybeSingle();
    if (!current) {
      return { success: false, error: "invite_not_found" };
    }
    if (current.recipient_user_id !== user.id) {
      // Decline is scoped to the user the invite was stamped to.
      return { success: false, error: "not_recipient" };
    }

    // Re-assert recipient_user_id at write time — TOCTOU guard parity
    // with declineChildInviteById (security-reviewer M1, 2026-05-05).
    // The SELECT above proved the row was stamped to this user, but
    // a concurrent signupViaInvite could re-stamp between the snapshot
    // and the UPDATE; without this predicate we'd clear someone else's
    // stamp.
    const { error: updateError } = await admin
      .from("child_invites")
      .update({ recipient_user_id: null })
      .eq("token", token)
      .eq("status", "pending")
      .eq("recipient_user_id", user.id);

    if (updateError) {
      console.error("declineChildInvite update error:", updateError);
      return { success: false, error: "decline_failed" };
    }

    await admin.from("activity_logs").insert({
      action_type: "invite_declined",
      user_id: user.id,
      action_details: { child_id: current.child_client_id },
    });

    revalidatePath("/parent");
    revalidatePath("/nanny");
    revalidateTag("pending-invites");

    return { success: true, error: null };
  } catch (err) {
    console.error("declineChildInvite unexpected error:", err);
    return { success: false, error: "Failed to decline invite" };
  }
}

// ── 9b. declineChildInviteById (token-free decline for dashboard) ──────
//
// Equivalent to declineChildInvite but keyed by the row UUID instead of
// the token. The pending-invites dashboard cards never receive the raw
// token (per 05-ui-surfaces.md §6 security note); they hold only
// `invite.id`. This action lets a recipient decline by id without the
// token ever crossing the client boundary.

export async function declineChildInviteById(inviteId: string): Promise<{
  success: boolean;
  error: string | null;
}> {
  if (invitesDisabled()) {
    return { success: false, error: "invites_disabled" };
  }
  // UUID-format pre-check — defence-in-depth before the DB call.
  if (
    typeof inviteId !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      inviteId,
    )
  ) {
    return { success: false, error: "invite_not_found" };
  }

  try {
    const supabase = createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) {
      return { success: false, error: "not_authenticated" };
    }

    const admin = createAdminClient();
    const { data: current } = await admin
      .from("child_invites")
      .select("child_client_id, recipient_user_id, status")
      .eq("id", inviteId)
      .maybeSingle();
    if (!current) {
      return { success: false, error: "invite_not_found" };
    }
    // Authorisation parity with the token-keyed variant: must be the
    // stamped recipient AND the invite must still be claimable.
    if (current.recipient_user_id !== user.id) {
      return { success: false, error: "not_recipient" };
    }
    if (current.status !== "pending") {
      return { success: false, error: "invite_not_found" };
    }

    // Authorisation re-asserted at write time — the SELECT-then-UPDATE
    // window admits a race where another action could re-stamp
    // recipient_user_id between the snapshot and our update. Including
    // both `recipient_user_id` and `status` predicates makes the UPDATE
    // a no-op if the row drifted underneath us, instead of clearing
    // somebody else's stamp.
    const { error: updateError, count } = await admin
      .from("child_invites")
      .update({ recipient_user_id: null }, { count: "exact" })
      .eq("id", inviteId)
      .eq("status", "pending")
      .eq("recipient_user_id", user.id);

    if (updateError) {
      console.error("declineChildInviteById update error:", updateError);
      // Stable opaque code — never leak raw driver messages to the client.
      return { success: false, error: "update_failed" };
    }
    if ((count ?? 0) === 0) {
      // Row drifted between SELECT and UPDATE. Treat as a benign race —
      // the user gets the same UX as "already declined".
      return { success: false, error: "invite_not_found" };
    }

    await admin.from("activity_logs").insert({
      action_type: "invite_declined",
      user_id: user.id,
      action_details: {
        child_id: current.child_client_id,
        via: "dashboard",
      },
    });

    revalidatePath("/parent");
    revalidatePath("/nanny");
    revalidateTag("pending-invites");

    return { success: true, error: null };
  } catch (err) {
    console.error("declineChildInviteById unexpected error:", err);
    return { success: false, error: "Failed to decline invite" };
  }
}

// ── 10. getPendingInvitesForUser ───────────────────────────────────────

export async function getPendingInvitesForUser(): Promise<{
  success: boolean;
  error: string | null;
  data: PendingInviteCard[];
}> {
  try {
    const supabase = createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) {
      return { success: false, error: "not_authenticated", data: [] };
    }

    // The SECURITY DEFINER function scopes by auth.uid() internally and
    // never returns the token column. We use the user-scoped client so
    // auth.uid() inside the function resolves to this user (admin client
    // would see auth.uid() = NULL).
    const { data, error } = await supabase.rpc(
      "get_pending_invites_for_recipient",
    );

    if (error) {
      console.error("getPendingInvitesForUser rpc error:", error);
      return { success: false, error: "lookup_failed", data: [] };
    }

    const cards: PendingInviteCard[] = (data ?? []).map(
      (row: {
        id: string;
        child_client_id: string;
        direction: string;
        child_first_name: string;
        inviter_first_name: string | null;
        created_at: string;
      }) => ({
        inviteId: row.id,
        childClientId: row.child_client_id,
        direction: row.direction as ChildInviteDirection,
        childFirstName: row.child_first_name,
        inviterFirstName: row.inviter_first_name ?? "",
        createdAt: row.created_at,
      }),
    );

    return { success: true, error: null, data: cards };
  } catch (err) {
    console.error("getPendingInvitesForUser unexpected error:", err);
    return {
      success: false,
      error: "Failed to load pending invites",
      data: [],
    };
  }
}
