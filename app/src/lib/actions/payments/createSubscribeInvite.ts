"use server";

/**
 * createSubscribeInvite — S5 nanny share-link server action.
 *
 * When the nanny clicks Share in SubscribeModalNanny, this action
 * mints (or returns the existing) `subscribe_invites` row + builds
 * the share URL + the pre-written template message text. The nanny's
 * device then routes both through Web Share API (mobile) or
 * clipboard (desktop).
 *
 * Idempotency:
 *   - If a pending invite already exists for (child, nanny), reuse
 *     it. Idempotent re-share returns the same URL — no duplicate
 *     rows, no churned tokens.
 *   - Token stability policy mirrors child-invites (memory:
 *     project_invite_token_stability) — once minted, a token does
 *     not rotate. Revocation is the only invalidation path.
 *
 * Ownership:
 *   - Caller MUST be the nanny on the child_client row.
 *   - Lookup happens via admin client; RLS does not gate this
 *     action (same pattern as child-invites mint).
 *
 * Output:
 *   - `token`: XXXX-XXXX 8-char Crockford-like.
 *   - `url`: full /subscribe-for/{token} URL.
 *   - `shareText`: pre-written template for the OS share sheet.
 *
 * Spec: `system/APP/PAYMENTS/FRONTEND/03-build-spec.md` §S5.
 */

import crypto from "node:crypto";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { SUBSCRIBE_INVITE_TOKEN_ALPHABET } from "@/lib/payments/subscribe-invite-token";
import { SITE_URL } from "@/lib/constants";

// Token shape (alphabet + regex + validator) lives at
// `lib/payments/subscribe-invite-token.ts` so it can be imported
// from non-server contexts (server components, page components).
// Next.js 14 rejects sync exports from "use server" files, so this
// action file holds only the async writer + the generator.

/** Generate a fresh XXXX-XXXX token. Matches child-invites format
 *  so future agents reading either table recognise the shape. */
function generateToken(): string {
  const buf = crypto.randomBytes(8);
  let out = "";
  for (let i = 0; i < 8; i++) {
    out +=
      SUBSCRIBE_INVITE_TOKEN_ALPHABET[
        buf[i] % SUBSCRIBE_INVITE_TOKEN_ALPHABET.length
      ];
    if (i === 3) out += "-";
  }
  return out;
}

function buildSubscribeUrl(token: string): string {
  const base =
    SITE_URL;
  return `${base}/subscribe-for/${token}`;
}

export interface CreateSubscribeInviteSuccess {
  success: true;
  data: {
    token: string;
    url: string;
    shareText: string;
  };
}

export interface CreateSubscribeInviteFailure {
  success: false;
  error: string;
}

export type CreateSubscribeInviteResult =
  | CreateSubscribeInviteSuccess
  | CreateSubscribeInviteFailure;

export async function createSubscribeInvite(
  childId: string,
): Promise<CreateSubscribeInviteResult> {
  try {
    const supabase = createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) {
      return { success: false, error: "Not authenticated" };
    }

    if (!childId || typeof childId !== "string") {
      return { success: false, error: "Invalid childId" };
    }

    const admin = createAdminClient();

    // Verify the caller is the nanny on this child + resolve names
    // for the share-text template.
    const { data: child, error: childErr } = await admin
      .from("child_client")
      .select("id, first_name, nanny_user_id, parent_user_id")
      .eq("id", childId)
      .maybeSingle<{
        id: string;
        first_name: string | null;
        nanny_user_id: string | null;
        parent_user_id: string | null;
      }>();
    if (childErr || !child) {
      return { success: false, error: "Child not found" };
    }
    if (child.nanny_user_id !== user.id) {
      return { success: false, error: "Not authorised" };
    }
    if (!child.parent_user_id) {
      // The whole point of the share link is to send the parent to
      // checkout — if there's no parent connected yet, the nanny
      // should be using the child-invite flow, not this one.
      return {
        success: false,
        error: "Child has no connected parent yet",
      };
    }

    // Idempotency — reuse an existing pending invite for this
    // (child, nanny) pair. Stability: once minted, the token
    // doesn't rotate.
    const { data: existing } = await admin
      .from("subscribe_invites")
      .select("token")
      .eq("child_client_id", childId)
      .eq("nanny_user_id", user.id)
      .eq("status", "pending")
      .maybeSingle<{ token: string }>();

    let token: string;
    if (existing?.token) {
      token = existing.token;
    } else {
      token = generateToken();
      const { error: insertErr } = await admin
        .from("subscribe_invites")
        .insert({
          token,
          child_client_id: childId,
          nanny_user_id: user.id,
          parent_user_id: child.parent_user_id,
          status: "pending",
        });
      if (insertErr) {
        console.error("createSubscribeInvite insert error:", insertErr);
        return { success: false, error: "Failed to create invite" };
      }
    }

    // Names for the share-text template.
    const childName = child.first_name ?? "your child";
    const { data: nannyProfile } = await admin
      .from("user_profiles")
      .select("first_name")
      .eq("user_id", user.id)
      .maybeSingle<{ first_name: string | null }>();
    const { data: parentProfile } = await admin
      .from("user_profiles")
      .select("first_name")
      .eq("user_id", child.parent_user_id)
      .maybeSingle<{ first_name: string | null }>();

    const nannyName = nannyProfile?.first_name ?? "your nanny";
    const parentName = parentProfile?.first_name ?? "there";

    const url = buildSubscribeUrl(token);
    const shareText = `Hi ${parentName} — Baby Bloom helps ${nannyName} support ${childName}'s development. Subscribe to continue: ${url}`;

    return {
      success: true,
      data: { token, url, shareText },
    };
  } catch (err) {
    console.error("createSubscribeInvite unexpected error:", err);
    return { success: false, error: "Failed to create invite" };
  }
}
