import { notFound } from "next/navigation";
import { logFailure, type AdminClient } from "@/lib/cohorts/db";
import { stampLinkOpened } from "@/lib/deposit/links";
import { readOpenPrebooking } from "@/lib/deposit/prebook";
import { proveDepositCode, type DepositParentProof } from "@/lib/deposit/proof";
import { readDepositPage, returnFromCheckout } from "@/lib/deposit/session";
import type { DepositPageState } from "@/lib/deposit/types";
import { depositLinkEnabled } from "@/lib/features/flags";
import { createAdminClient } from "@/lib/supabase/admin";
import { DepositTryAgain, InvalidDepositLink } from "../InvalidDepositLink";
import { DepositClient } from "./DepositClient";

/**
 * `/deposit/<code>` — the parent's deposit page, with no login (plan 03 row C1, §3 "Page state", "Back", D15; brief
 * 03 §0.2, §3 parent 1–9). Per request, in this order:
 *
 * 1. the switch (`depositLinkEnabled()`): off → 404 before the admin client, the proof or any read;
 * 2. the code, proven now (never a cached proof): malformed, unknown or cancelled → the ONE invalid page, with
 *    nothing written; a failed proof read → a plain try-again line;
 * 3. "opened" is stamped on her link — the only write a valid view makes; a failure is logged and the page goes on;
 * 4. back from Stripe (`?cancelled=1`): 03a's `returnFromCheckout` first (her open session expired, then her hold
 *    released); a session Stripe says is complete → the paid page;
 * 5. the state from the page read (03a's resolver → `depositPageState`) and her first name; in the full and
 *    being-paid states, whether she has pre-booked already (then the pre-book panel opens at once, D8).
 *
 * The family comes only from the code: no session or login is read here (D15). The layout sends no referrer and
 * asks not to be indexed.
 *
 * BB-wave2-231126/03-build, 2026-11-25.
 */
export const dynamic = "force-dynamic";

type SearchParams = Readonly<Record<string, string | string[] | undefined>>;

interface PageProps {
  readonly params: { readonly code: string };
  readonly searchParams: SearchParams;
}

const PAID: DepositPageState = Object.freeze({ kind: "paid" });

/** Step 3: logged and passed over on any failure — the page never depends on the stamp. */
async function stampOpened(admin: AdminClient, proof: DepositParentProof): Promise<void> {
  try {
    await stampLinkOpened(admin, proof);
  } catch (thrown) {
    logFailure("deposit page opened stamp", thrown);
  }
}

/** Step 5's last part: an open pre-booking, asked only where Pre-book is offered. A failed read → not pre-booked. */
async function hasPrebooked(admin: AdminClient, proof: DepositParentProof, state: DepositPageState): Promise<boolean> {
  if (state.kind !== "full" && state.kind !== "being_paid") return false;
  const open = await readOpenPrebooking(admin, proof.parentUserId);
  return open.ok && open.value !== null;
}

export default async function DepositCodePage(props: PageProps) {
  if (!depositLinkEnabled()) notFound();
  try {
    return await depositPage(props);
  } catch (thrown) {
    logFailure("deposit page", thrown); // by name only; the page never errors out with the code in it
    return <DepositTryAgain />;
  }
}

/** Steps 2–5, after the switch. Any throw becomes the try-again line (03c review L). */
async function depositPage({ params, searchParams }: PageProps) {
  const admin = createAdminClient();
  const proven = await proveDepositCode(admin, params.code);
  if (!proven.ok) return proven.status === "invalid" ? <InvalidDepositLink /> : <DepositTryAgain />;
  const { proof } = proven;
  await stampOpened(admin, proof);
  const now = new Date();
  if (searchParams.cancelled === "1" && (await returnFromCheckout(admin, proof, now)).kind === "paid") {
    return <DepositClient code={params.code} initialState={PAID} firstName={null} prebooked={false} />;
  }
  const read = await readDepositPage(admin, proof, now);
  if (read.kind !== "ok") return read.kind === "invalid" ? <InvalidDepositLink /> : <DepositTryAgain />;
  const prebooked = await hasPrebooked(admin, proof, read.state);
  return <DepositClient code={params.code} initialState={read.state} firstName={read.firstName} prebooked={prebooked} />;
}
