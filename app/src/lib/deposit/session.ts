/**
 * The parent's Pay, Back and Done (plan 03 §3 "Pay", "Session", "Back", "Done"; brief 03 §3 parent 2–4, §5). 03c's
 * public actions call these with the `DepositParentProof` its page minted from the code — never a login (D15), so BAI
 * taking the card on a call (his own browser) gets exactly the parent's path.
 *
 * - Pay: re-resolve the page state (link, family row, 02's cohorts, her live hold); hold a place; the press that made
 *   the hold creates ONE Checkout session (idempotency key `deposit-session-<holdId>`) and attaches it — a Stripe
 *   failure releases the hold. A second press reuses the first session; a double tap re-reads for it. A hold still
 *   without a session after those re-reads, made over `SESSIONLESS_HOLD_STALE_SECONDS` ago, lost its press: it is
 *   released and Pay runs once more on a NEW hold (so a new idempotency key), at most once a press.
 * - The session: `PRICES.dfy.depositPence` (never input), card only, saved for off-session use (brief 07), metadata on
 *   the session and its payment, ending 31 minutes from now (see `SESSION_MINUTES`).
 * - Back: expire her open session, then release the hold; complete → paid; a Stripe error releases nothing.
 * - Done: the session must be this link's and this parent's. Writes nothing.
 * - Server-only, NOT `"use server"` (`src/lib/invite/mint.ts:1-9`). Logs carry error codes only.
 *
 * BB-wave2-231126/03-build, 2026-11-25.
 */

import type Stripe from "stripe";
import { z } from "zod";
import { PRICES, VAT } from "@/config/prices";
import { logFailure, type AdminClient } from "@/lib/cohorts/db";
import { attachHoldSession, holdPlace, releaseHold } from "@/lib/cohorts/places";
import { findCohorts } from "@/lib/cohorts/read";
import type { PlaceState } from "@/lib/cohorts/types";
import { SITE_NAME, SITE_URL } from "@/lib/constants";
import { customerFor } from "@/lib/payments/stripe-customer";
import { getStripeClient } from "@/lib/stripe/client";
import { isDepositCode, UUID_RE } from "./code";
import {
  CHECKOUT_SESSION_MINUTES, HOLD_MINUTES, PAY_REREAD_DELAY_MS, PAY_REREAD_TRIES, SESSIONLESS_HOLD_STALE_SECONDS,
} from "./constants";
import { PAGE_COPY } from "./copy";
import { depositPageState } from "./page-state";
import { depositLinkRow, isDepositParentProof, type DepositParentProof } from "./proof";
import type { DepositPageState } from "./types";

/** Stripe takes `expires_at` 30 min–24 h after ITS creation, so 30 computed here can be refused: plan's 30 + 1. */
const EXPIRY_MARGIN_MINUTES = 1;
const SESSION_MINUTES = CHECKOUT_SESSION_MINUTES + EXPIRY_MARGIN_MINUTES;
const SECONDS_PER_MINUTE = 60;
const MS_PER_SECOND = 1000;
const SESSION_ID_RE = /^cs_[A-Za-z0-9_]{1,252}$/;
/** `cohort_places.state`: 02's `PlaceState`, every one. */
const PLACE_STATES = ["held", "hold_released", "taken", "reopened"] as const satisfies readonly PlaceState[];

export type PayResult =
  | { readonly kind: "redirect"; readonly url: string }
  | { readonly kind: "state"; readonly state: DepositPageState }
  | { readonly kind: "try_again" | "try_again_soon" | "invalid" };
export type BackResult = { readonly kind: "paid" | "released" | "nothing" | "try_again" | "invalid" };
export type DoneResult = "paid" | "not_paid" | "foreign" | "invalid";

export interface PayOptions {
  /** How a double tap waits between re-reads (tests pass an instant one). */
  readonly wait?: (ms: number) => Promise<void>;
}

const INVALID = Object.freeze({ kind: "invalid" } as const);
const TRY_AGAIN = Object.freeze({ kind: "try_again" } as const);
const TRY_AGAIN_SOON = Object.freeze({ kind: "try_again_soon" } as const);
const redirect = (url: string): PayResult => Object.freeze({ kind: "redirect", url });
const showState = (state: DepositPageState): PayResult => Object.freeze({ kind: "state", state: Object.freeze(state) });
const back = (kind: BackResult["kind"]): BackResult => Object.freeze({ kind });
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// ── reads ──

/** Proof's one `deposit_links` parser, plus the code (the session's return URLs). */
const linkRow = depositLinkRow.safeExtend({ code: z.string().refine(isDepositCode) });
const familyRow = z.object({ id: z.string().min(1), stripe_customer_id: z.string().nullable(), deposit_paid_at: z.string().nullable() });
const holdRow = z.object({
  id: z.string().regex(UUID_RE), cohort_start_date: z.string().min(1), is_goodwill: z.boolean(),
  stripe_checkout_session_id: z.string().nullable(), state: z.enum(PLACE_STATES),
});
type LinkRow = z.infer<typeof linkRow>;
type FamilyRow = z.infer<typeof familyRow>;

/** One single-row read, parsed. `undefined` = failed (logged); null = no row. */
async function readOne<T>(label: string, schema: z.ZodType<T>, query: PromiseLike<{ data: unknown; error: { code?: string } | null }>): Promise<T | null | undefined> {
  const { data, error } = await query;
  if (error) {
    logFailure(label, error);
    return undefined;
  }
  if (data === null) return null;
  const row = schema.safeParse(data);
  if (!row.success) {
    logFailure(label, { code: "unexpected_row" });
    return undefined;
  }
  return row.data;
}

const HOLD_COLUMNS = "id, cohort_start_date, is_goodwill, stripe_checkout_session_id, state";

/** Her live hold: held and not yet lapsed (at most one, amendment 17). */
const readOwnHold = (admin: AdminClient, parentUserId: string, now: Date) =>
  readOne("deposit own hold read", holdRow,
    admin.from("cohort_places").select(HOLD_COLUMNS).eq("parent_user_id", parentUserId).eq("state", "held").gt("hold_expires_at", now.toISOString()).maybeSingle());

interface Resolved {
  readonly link: LinkRow;
  readonly family: FamilyRow | null;
  readonly state: DepositPageState;
  readonly nextAvailable: string | null;
}

/** Plan §3 Pay step 1: the page state, re-resolved now. A cancelled or foreign link → invalid; a failed read → error. */
async function resolve(admin: AdminClient, proof: DepositParentProof, now: Date): Promise<Resolved | "invalid" | "error"> {
  const [link, family, cohorts, hold] = await Promise.all([
    readOne("deposit link read", linkRow, admin.from("deposit_links").select("id, parent_user_id, code, state, target, goodwill_cohort_start_date").eq("id", proof.linkId).maybeSingle()),
    readOne("deposit family read", familyRow, admin.from("parent_subscriptions").select("id, stripe_customer_id, deposit_paid_at").eq("parent_user_id", proof.parentUserId).maybeSingle()),
    findCohorts(admin, now),
    readOwnHold(admin, proof.parentUserId, now),
  ]);
  if (link === undefined || family === undefined || hold === undefined || !cohorts.ok) return "error";
  if (link === null || link.state === "cancelled" || link.parent_user_id !== proof.parentUserId) return "invalid";
  const { current, next, nextAvailable } = cohorts.value;
  const state = depositPageState({
    link: { state: link.state, target: link.target, goodwillStartDate: link.goodwill_cohort_start_date },
    depositPaidAt: family?.deposit_paid_at ?? null,
    cohorts: { current, next, nextAvailable },
    ownHold: hold === null ? null : { cohortStartDate: hold.cohort_start_date, isGoodwill: hold.is_goodwill },
  });
  return { link, family, state, nextAvailable: nextAvailable?.start ?? null };
}

// ── the Checkout session ──

interface Hold {
  readonly placeId: string;
  readonly cohortStartDate: string;
  readonly isGoodwill: boolean;
}

const doneUrl = (code: string, sessionId: string) => `${SITE_URL}/deposit/${code}/done?session=${encodeURIComponent(sessionId)}`;

/** Plan §3 "Session" / brief §5, exactly. Nothing in it comes from the page. */
function sessionParams(parentUserId: string, customer: string, link: LinkRow, hold: Hold, now: Date): Stripe.Checkout.SessionCreateParams {
  const metadata = {
    user_id: parentUserId,
    link_kind: "deposit",
    pence: String(PRICES.dfy.depositPence),
    deposit_link_id: link.id,
    hold_id: hold.placeId,
    cohort_start_date: hold.cohortStartDate,
    goodwill: hold.isGoodwill ? "true" : "false",
  };
  return {
    mode: "payment",
    customer,
    customer_update: { address: "auto", name: "auto" },
    client_reference_id: parentUserId,
    line_items: [{
      quantity: 1,
      price_data: {
        currency: PRICES.currency, unit_amount: PRICES.dfy.depositPence, tax_behavior: VAT.inclusive ? "inclusive" : "exclusive",
        product_data: { name: `${SITE_NAME} — Deposit` },
      },
    }],
    automatic_tax: { enabled: VAT.stripeTaxEnabled },
    billing_address_collection: "required",
    payment_method_types: ["card"],
    payment_intent_data: { setup_future_usage: "off_session", metadata },
    metadata,
    custom_text: { submit: { message: PAGE_COPY.consent } },
    expires_at: Math.floor(now.getTime() / MS_PER_SECOND) + SESSION_MINUTES * SECONDS_PER_MINUTE,
    success_url: `${SITE_URL}/deposit/${link.code}/done?session={CHECKOUT_SESSION_ID}`,
    cancel_url: `${SITE_URL}/deposit/${link.code}?cancelled=1`,
  };
}

/** The family's Stripe customer; her account email is read only when one has to be made. A failure throws. */
async function familyCustomer(admin: AdminClient, parentUserId: string, family: FamilyRow | null): Promise<string> {
  if (family?.stripe_customer_id) return family.stripe_customer_id;
  const profile = await readOne("deposit email read", z.object({ email: z.string().nullable() }),
    admin.from("user_profiles").select("email").eq("user_id", parentUserId).maybeSingle());
  if (profile === undefined) throw new Error("email read failed");
  return customerFor(admin, parentUserId, family === null ? null : { id: family.id, stripe_customer_id: family.stripe_customer_id }, profile?.email ?? null);
}

async function release(admin: AdminClient, proof: DepositParentProof, placeId: string): Promise<boolean> {
  const released = await releaseHold(admin, { proof, placeId, parentUserId: proof.parentUserId });
  return released.ok;
}

async function expireQuietly(sessionId: string): Promise<void> {
  try {
    await getStripeClient().checkout.sessions.expire(sessionId);
  } catch (thrown) {
    logFailure("deposit session expire", thrown);
  }
}

/** Plan §3 Pay step 3: this press made the hold, so it makes the session and attaches it. */
async function createAndAttach(admin: AdminClient, proof: DepositParentProof, resolved: Resolved, hold: Hold, now: Date): Promise<PayResult> {
  let session: Stripe.Checkout.Session;
  try {
    const customer = await familyCustomer(admin, proof.parentUserId, resolved.family);
    const params = sessionParams(proof.parentUserId, customer, resolved.link, hold, now);
    session = await getStripeClient().checkout.sessions.create(params, { idempotencyKey: `deposit-session-${hold.placeId}` });
  } catch (thrown) {
    logFailure("deposit session create", thrown);
    await release(admin, proof, hold.placeId);
    return TRY_AGAIN;
  }
  const attached = session.url ? await attachHoldSession(admin, { proof, placeId: hold.placeId, parentUserId: proof.parentUserId, sessionId: session.id }) : null;
  if (session.url && attached?.ok) return redirect(session.url);
  await expireQuietly(session.id);
  await release(admin, proof, hold.placeId);
  return TRY_AGAIN;
}

/** Plan §3 Pay step 4: the hold already has a session — open → its page; complete → done; expired → release. */
async function reuseSession(admin: AdminClient, proof: DepositParentProof, code: string, placeId: string, sessionId: string): Promise<PayResult> {
  let session: Stripe.Checkout.Session;
  try {
    session = await getStripeClient().checkout.sessions.retrieve(sessionId);
  } catch (thrown) {
    logFailure("deposit session retrieve", thrown);
    return TRY_AGAIN;
  }
  if (session.status === "open" && session.url) return redirect(session.url);
  if (session.status === "complete") return redirect(doneUrl(code, session.id));
  if (session.status === "expired") await release(admin, proof, placeId);
  return TRY_AGAIN;
}

/** Plan §3 Pay step 5: a double tap racing the first press — wait for its session, a few times. */
async function awaitFirstSession(admin: AdminClient, proof: DepositParentProof, code: string, placeId: string, wait: (ms: number) => Promise<void>): Promise<PayResult> {
  for (let attempt = 0; attempt < PAY_REREAD_TRIES; attempt += 1) {
    await wait(PAY_REREAD_DELAY_MS);
    const place = await readOne("deposit hold reread", holdRow,
      admin.from("cohort_places").select(HOLD_COLUMNS).eq("id", placeId).eq("parent_user_id", proof.parentUserId).maybeSingle());
    if (!place || place.state !== "held") return TRY_AGAIN;
    if (place.stripe_checkout_session_id) return reuseSession(admin, proof, code, placeId, place.stripe_checkout_session_id);
  }
  return TRY_AGAIN_SOON;
}

/** Made over `SESSIONLESS_HOLD_STALE_SECONDS` ago (its start = expiry − `HOLD_MINUTES`)? An unreadable expiry is not. */
function isStaleHold(holdExpiresAt: string, now: Date): boolean {
  const expiresMs = Date.parse(holdExpiresAt);
  if (Number.isNaN(expiresMs)) return false;
  const madeMs = expiresMs - HOLD_MINUTES * SECONDS_PER_MINUTE * MS_PER_SECOND;
  return now.getTime() - madeMs > SESSIONLESS_HOLD_STALE_SECONDS * MS_PER_SECOND;
}

interface Press {
  readonly admin: AdminClient;
  readonly proof: DepositParentProof;
  readonly resolved: Resolved;
  readonly state: Extract<DepositPageState, { kind: "bookable" }>;
  readonly now: Date;
  readonly wait: (ms: number) => Promise<void>;
}

/**
 * Plan §3 Pay steps 2–5. With `mayRecover`, a sessionless hold that outlived the re-reads and is stale lost its press
 * (code review M1): release it and run these steps ONCE more — a new hold, so a new idempotency key (Stripe refuses a
 * key reused with other params, and `expires_at` differs per call). If that late press still creates its session, its
 * attach answers `not_a_hold`, and `createAndAttach` expires that session and releases.
 */
async function holdAndPay(press: Press, mayRecover: boolean): Promise<PayResult> {
  const { admin, proof, resolved, state } = press;
  const held = await holdPlace(admin, { proof, parentUserId: proof.parentUserId, startDate: state.start, goodwill: state.goodwill });
  if (held.status === "full") return showState({ kind: held.reason === "being_paid" ? "being_paid" : "full", nextAvailable: resolved.nextAvailable });
  if (held.status === "already_taken") return showState({ kind: "paid" });
  if (!held.ok) return TRY_AGAIN;
  const hold: Hold = { placeId: held.placeId, cohortStartDate: held.cohortStartDate, isGoodwill: held.isGoodwill };
  if (held.status === "held") return createAndAttach(admin, proof, resolved, hold, press.now);
  if (held.sessionId) return reuseSession(admin, proof, resolved.link.code, held.placeId, held.sessionId);
  const waited = await awaitFirstSession(admin, proof, resolved.link.code, held.placeId, press.wait);
  if (waited.kind !== "try_again_soon" || !mayRecover || !isStaleHold(held.holdExpiresAt, press.now)) return waited;
  if (!(await release(admin, proof, held.placeId))) return TRY_AGAIN;
  return holdAndPay(press, false);
}

/** The parent's Pay (or BAI's on her page, D15). */
export async function startDepositCheckout(admin: AdminClient, proof: DepositParentProof, now: Date, options: PayOptions = {}): Promise<PayResult> {
  if (!isDepositParentProof(proof)) return INVALID;
  try {
    const resolved = await resolve(admin, proof, now);
    if (resolved === "invalid") return INVALID;
    if (resolved === "error") return TRY_AGAIN;
    const { state } = resolved;
    if (state.kind !== "bookable") return showState(state);
    return await holdAndPay({ admin, proof, resolved, state, now, wait: options.wait ?? sleep }, true);
  } catch (thrown) {
    logFailure("startDepositCheckout", thrown);
    return TRY_AGAIN;
  }
}

/** Back from Stripe (`?cancelled=1`): end her open session so it can't be paid later, then free the place. */
export async function returnFromCheckout(admin: AdminClient, proof: DepositParentProof, now: Date): Promise<BackResult> {
  if (!isDepositParentProof(proof)) return back("invalid");
  try {
    const hold = await readOwnHold(admin, proof.parentUserId, now);
    if (hold === undefined) return back("try_again");
    if (hold === null || hold.stripe_checkout_session_id === null) return back("nothing");
    const stripe = getStripeClient();
    const session = await stripe.checkout.sessions.retrieve(hold.stripe_checkout_session_id);
    if (session.status === "complete") return back("paid");
    if (session.status === "open") await stripe.checkout.sessions.expire(session.id);
    return back((await release(admin, proof, hold.id)) ? "released" : "try_again");
  } catch (thrown) {
    // a Stripe error releases nothing: the session may still be paid
    logFailure("returnFromCheckout", thrown);
    return back("try_again");
  }
}

/** The done page: is this session paid, and is it this link's and this parent's? Writes nothing. */
export async function checkDepositDone(proof: DepositParentProof, sessionId: unknown): Promise<DoneResult> {
  if (!isDepositParentProof(proof) || typeof sessionId !== "string" || !SESSION_ID_RE.test(sessionId)) return "invalid";
  let session: Stripe.Checkout.Session;
  try {
    session = await getStripeClient().checkout.sessions.retrieve(sessionId);
  } catch (thrown) {
    logFailure("checkDepositDone", thrown);
    return "not_paid";
  }
  const metadata = session.metadata ?? {};
  const ours = metadata.link_kind === "deposit" && metadata.deposit_link_id === proof.linkId && session.client_reference_id === proof.parentUserId;
  if (!ours) return "foreign";
  return session.payment_status === "paid" ? "paid" : "not_paid";
}
