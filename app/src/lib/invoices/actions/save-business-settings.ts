"use server";

/**
 * Save the Business page (ledger B06 §9.1 R1–R5; replaces 06b-3's two dialog actions): her business details, her
 * address and her bank details for invoices, in one Save. Changes apply to future invoices only — a sent invoice keeps
 * its own snapshot (amendment 21). Invoices only: it never touches payouts.
 *
 * Contract:
 * - The switch first (off → `invoices_disabled`, before the session or any client is read); then her proof from the
 *   request's session (`proveNanny`, never an id from the client; none → `signed_out`).
 * - **Everything is checked before anything is written** (`checkBusinessPage`, the same check the page runs); a
 *   refusal names each field.
 * - **Versions:** each record sent carries the version she loaded. All are compared first, so a record changed since
 *   (another tab, verification's residence step) answers `stale` and nothing is written; the database and the
 *   profile write compare again, under the lock / in the update, for a change that lands in between.
 * - Her address is her profile's, written with her own session (`writeOwnProfile`: RLS, her row only), and first:
 *   an invoice created in between then pairs her old business details with an address that already suits them.
 * - A refusal after an earlier write says what was saved, with its version (`saved`), so the page re-bases and her
 *   retry isn't taken for a change made elsewhere (review round 1).
 * - **Bank details:** a change to saved details sends the security email (capped, best effort, at most 5 s). The full
 *   numbers are never in the reply, the email or a log (the store and the sender log codes only); the version check
 *   reads only the bank row's version.
 *
 * Only this async function is exported: every async export of a `"use server"` file is callable from a browser.
 *
 * BB-wave1-041126/06b3-rework, 2026-11-09.
 */

import { nannyInvoicesEnabled } from "@/lib/features/flags";
import { hasStreetAndPostcode } from "@/lib/settings/nanny-profile-rules";
import { addressColumns, readOwnProfile, writeOwnProfile, type OwnProfile } from "@/lib/settings/profile-write";
import { createClient } from "@/lib/supabase/server";
import { sendPaymentDetailsChangedEmail } from "../emails/send-payment-details-changed";
import { proveNanny, type NannyProof } from "../nanny-proof";
import { readBankVersion, saveDetails } from "../store";
import { readIssuer, saveBusiness } from "../store-business";
import {
  bankFields,
  businessFields,
  businessPageInput,
  checkBusinessPage,
  homeOf,
  sameAsOwnName,
  type BusinessPageInput,
} from "./business-page";
import { actionRefusal, fieldsRefusal, type ActionError, type ActionRefusal, type BusinessSettingsResult } from "./messages";

type Session = ReturnType<typeof createClient>;

/** Each record sent is still the version she loaded: null when so, else `stale` (or `error` when a read failed). */
async function changedSince(proof: NannyProof, page: BusinessPageInput, profile: OwnProfile): Promise<ActionError | null> {
  const [issuer, bank] = await Promise.all([
    page.business ? readIssuer(proof) : null,
    page.bank ? readBankVersion(proof) : null,
  ]);
  if ((issuer && !issuer.ok) || (bank && !bank.ok)) return "error";
  const stale =
    (issuer?.ok === true && issuer.value.businessUpdatedAt !== page.business?.expectedUpdatedAt) ||
    (bank?.ok === true && bank.value !== page.bank?.expectedUpdatedAt) ||
    (page.address !== undefined && profile.updatedAt !== page.address.expectedUpdatedAt);
  return stale ? "stale" : null;
}

type Saved = NonNullable<ActionRefusal["saved"]>;

/** A refusal, with what was already saved when something was. */
const refusedAfter = (error: ActionError, saved: Saved): ActionRefusal =>
  Object.keys(saved).length === 0 ? actionRefusal(error) : Object.freeze({ ...actionRefusal(error), saved });

async function writeBusiness(proof: NannyProof, page: BusinessPageInput, profile: OwnProfile): Promise<{ error: ActionError } | { version: string } | null> {
  if (!page.business) return null;
  const fields = businessFields(page.business);
  const ownName = sameAsOwnName(fields.tradingName ?? "", profile.firstName, profile.lastName);
  const saved = await saveBusiness(proof, ownName ? { ...fields, tradingName: "" } : fields, page.business.expectedUpdatedAt);
  return saved.ok ? { version: saved.value.updatedAt } : { error: saved.error };
}

/** The writes — address, business, bank — the first refusal stops the rest. */
async function write(proof: NannyProof, session: Session, page: BusinessPageInput, profile: OwnProfile): Promise<BusinessSettingsResult> {
  let saved: Saved = {};
  if (page.address) {
    const written = await writeOwnProfile(session, proof.userId, addressColumns(homeOf(page.address)), page.address.expectedUpdatedAt);
    if (written.status !== "saved") return refusedAfter(written.status, saved);
    saved = { ...saved, home: written.updatedAt };
  }
  const business = await writeBusiness(proof, page, profile);
  if (business && "error" in business) return refusedAfter(business.error, saved);
  if (business) saved = { ...saved, business: business.version };
  if (page.bank) {
    const bank = await saveDetails(proof, bankFields(page.bank), page.bank.expectedUpdatedAt);
    if (!bank.ok) return refusedAfter(bank.error, saved);
    if (bank.value.changed && !bank.value.firstSave) await sendPaymentDetailsChangedEmail(proof.userId);
  }
  return { ok: true };
}

export async function saveBusinessSettings(input: unknown): Promise<BusinessSettingsResult> {
  if (!nannyInvoicesEnabled()) return actionRefusal("invoices_disabled");
  const proof = await proveNanny();
  if (!proof) return actionRefusal("signed_out");
  const page = businessPageInput.safeParse(input);
  if (!page.success) return actionRefusal("invalid");
  const session = createClient();
  const profile = await readOwnProfile(session, proof.userId);
  if (!profile) return actionRefusal("error");
  const fields = checkBusinessPage(page.data, hasStreetAndPostcode(profile.home));
  if (Object.keys(fields).length > 0) return fieldsRefusal(fields);
  const since = await changedSince(proof, page.data, profile);
  return since === null ? write(proof, session, page.data, profile) : actionRefusal(since);
}
