/**
 * The nanny proof (plan 06 §9 surface 3; the 04a/02 review lesson "a subject id is never proof of who acts").
 * Every invoice operation for a nanny takes one as its first parameter, so the safe path is the only path: no caller
 * can name a nanny id and act for her.
 *
 * - Made only by `proveNanny()`, from the request's session (`getNannyId()`, `src/lib/actions/connection.ts`), and
 *   only while the switch is on — so with it off not even the session is read.
 * - Branded at the type level (the brand symbol isn't exported, so no object literal type-checks as one) and at
 *   run time (`isNannyProof` accepts only an object `proveNanny` issued in this process; a look-alike, a copy or a
 *   cast is refused) — the shape of `src/lib/calls/admin-proof.ts`.
 *
 * BB-wave1-041126/06a-build, 2026-11-04.
 */

import { getNannyId } from "@/lib/actions/connection";
import { nannyInvoicesEnabled } from "@/lib/features/flags";
import { logFailure } from "./db";

declare const NANNY_PROOF: unique symbol;

export type NannyProof = {
  readonly kind: "nanny_proof";
  readonly nannyId: string;
  readonly userId: string;
  readonly [NANNY_PROOF]: true;
};

const issued = new WeakSet<object>();

/** A proof for the request's nanny session; null when the switch is off, there's no nanny, or the check failed. */
export async function proveNanny(): Promise<NannyProof | null> {
  if (!nannyInvoicesEnabled()) return null;
  try {
    const who = await getNannyId();
    if (!who || typeof who.nannyId !== "string" || who.nannyId === "" || typeof who.userId !== "string" || who.userId === "") {
      return null;
    }
    const proof = Object.freeze({ kind: "nanny_proof", nannyId: who.nannyId, userId: who.userId }) as NannyProof;
    issued.add(proof);
    return proof;
  } catch (thrown) {
    logFailure("the nanny check", thrown);
    return null;
  }
}

export function isNannyProof(value: unknown): value is NannyProof {
  return typeof value === "object" && value !== null && issued.has(value);
}
