/**
 * The admin proof (04a security review H2e). Every call operation that returns parent contact details or acts as
 * an admin takes one as its first parameter, so no caller can reach them without having passed `requireAdmin()`.
 *
 * - Made only by `proveAdmin()`, after `src/lib/admin/require-admin.ts` passes for the request's session.
 * - Branded at the type level (the brand symbol isn't exported, so no object literal type-checks as one) and at
 *   run time (`isAdminProof` accepts only an object `proveAdmin` issued in this process; a look-alike, a copy or
 *   a cast is refused). An operation given anything else answers `invalid` before it reads or writes.
 *
 * BB-wave1-041126/04a-core, 2026-11-04.
 */

import { requireAdmin } from "@/lib/admin/require-admin";
import type { CallActor } from "./types";

declare const ADMIN_PROOF: unique symbol;

export type AdminProof = {
  readonly kind: "admin_proof";
  readonly userId: string;
  readonly [ADMIN_PROOF]: true;
};

const issued = new WeakSet<object>();

/** A proof for the request's admin session, or null when there isn't one (or the check failed — logged). */
export async function proveAdmin(): Promise<AdminProof | null> {
  try {
    const gate = await requireAdmin();
    if (gate.error !== null || gate.userId === "") return null;
    const proof = Object.freeze({ kind: "admin_proof", userId: gate.userId }) as AdminProof;
    issued.add(proof);
    return proof;
  } catch (thrown) {
    console.error("[calls/admin-proof] the admin check failed", { name: thrown instanceof Error ? thrown.name : typeof thrown });
    return null;
  }
}

export function isAdminProof(value: unknown): value is AdminProof {
  return typeof value === "object" && value !== null && issued.has(value);
}

/** The repository's actor for a proven admin. */
export function actingAdmin(proof: AdminProof): CallActor {
  return { userId: proof.userId, kind: "admin" };
}
