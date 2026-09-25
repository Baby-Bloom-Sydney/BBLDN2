/**
 * mintChildInvite — internal helper.
 *
 * Lives outside the "use server" boundary specifically so Next.js does
 * NOT register it as a callable Server Action. Every async export from
 * a "use server" file is auto-exposed as a remote-callable RPC, and
 * this function runs against the admin client without ownership gates
 * — exposing it would let any authenticated client mint invites for
 * arbitrary children. (security-reviewer H4, 2026-05-05.)
 *
 * Called by `createChild` and `createChildAsParent` after they've
 * verified caller ownership of the about-to-be-linked child.
 *
 * Token-stability policy (2026-05-04 decision): once minted, an invite
 * token does NOT rotate. The only ways it becomes invalid are
 *   (a) recipient claims it via connectChildInvite,
 *   (b) creator explicitly revokes via revokeChildInvite,
 *   (c) child row is deleted (cascade).
 * There is no regenerate flow. If a token leaks, the creator revokes
 * and creates a new child.
 */

import crypto from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ChildInviteDirection } from "@/types/bapp";
import { SITE_URL } from "@/lib/constants";

const TOKEN_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

function generateToken(): string {
  const buf = crypto.randomBytes(8);
  let out = "";
  for (let i = 0; i < 8; i++) {
    out += TOKEN_ALPHABET[buf[i] % TOKEN_ALPHABET.length];
    if (i === 3) out += "-";
  }
  return out;
}

function buildInviteUrl(token: string): string {
  const base =
    SITE_URL;
  return `${base}/invite/${token}`;
}

export interface MintInviteParams {
  childId: string;
  direction: ChildInviteDirection;
  userId: string;
  userEmail: string;
  /** Optional: carry over recipient_user_id from a revoked invite. */
  recipientUserId?: string | null;
  /**
   * T-022 — TRUE when this invite was minted via the bonus-program
   * onboarding flow. Persisted onto `child_invites.bonus_program` for
   * commission-attribution by the payouts engine. Defaults to false.
   */
  bonusProgram?: boolean;
}

export async function mintChildInvite(
  params: MintInviteParams,
): Promise<{ token: string; url: string }> {
  const admin = createAdminClient();
  const token = generateToken();

  const { error } = await admin.from("child_invites").insert({
    child_client_id: params.childId,
    token,
    created_by_user_id: params.userId,
    created_by_email_at_creation: params.userEmail,
    direction: params.direction,
    status: "pending",
    recipient_user_id: params.recipientUserId ?? null,
    bonus_program: params.bonusProgram ?? false,
  });

  if (error) {
    console.error("mintChildInvite insert error:", error);
    // The unique-pending-per-child-direction index fires if a pending
    // invite already exists — caller bug, they should revoke first.
    // Throw an opaque code; never propagate the raw driver message.
    throw new Error("mint_failed");
  }

  return { token, url: buildInviteUrl(token) };
}
