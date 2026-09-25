-- =============================================================================
-- T-017 — Load T-014 v2 policy bodies into legal_documents
-- =============================================================================
--
-- Bailey 2026-05-14 directive (chat): "apply the policies that have been
-- created correctly where they need to go, and ensure that the database
-- write and consents allow us to follow proper paper trails for consent
-- and documentation."
--
-- APPEND-ONLY INVARIANT — Bailey 2026-05-14 lock:
--   This migration NEVER deletes a `legal_documents` row.
--   This migration NEVER mutates an existing `legal_documents` row.
--   Every change to a policy is captured by INSERTing a new row with the
--   same `document_id` (slug) and a bumped `version`.
--
--   Rationale: `consent_records.document_version` is captured at signing
--   time. A user who signed under v1 keeps the v1 reference forever; the
--   audit trail can reconstruct exactly what text they agreed to on
--   what date by joining (consent_records.document_id, .document_version)
--   → (legal_documents.document_id, .version) → legal_documents.body_md.
--   If we mutated v1's body or deleted v1, that paper trail would break.
--
-- What this migration does:
--   1. INSERTs `parent-app-consent` v2 with the full T-014 authored body
--      (~5,900 words, sections 1-10 + Quick Read). Preserves v1
--      (placeholder body inserted by T-015's seed migration on 2026-05-14).
--   2. INSERTs `nanny-attestation` v2 with the full T-014 authored body
--      (~6,200 words). Preserves v1 placeholder.
--
-- What this migration does NOT do:
--   - Touch the 11 other `legal_documents` rows seeded long before T-015
--     (client-tos, professional-tos, privacy-policy, biometric-notice,
--     agr14_nanny_child_add, etc.).
--   - Insert rows for the 7 deprecated JIT surface files (AGR-Self,
--     AGR-Invite-Claim, AGR-Switch, AGR-20, AGR-21..26, AGR-Renewal).
--     These are preserved on disk as future-fragmentation reference per
--     the T-014 / T-015 reconciliation (see
--     `/system/legal/documents/JIT-CONSENT-SURFACES/README.md` §"The 7
--     deprecated files").
--   - Touch the v2.1 Section amendment docs in
--     `system/legal/documents/Sections/{14,22,25,28,29}/`. Those are
--     policy-architecture documents, not user-facing clickwrap.
--
-- Idempotent: `ON CONFLICT (document_id, version) DO NOTHING` — re-running
-- this migration leaves the DB in the same state.
--
-- Reviewer references:
--   - T-017 README §Approach + §Acceptance criteria.
--   - T-015 CONSENT-MODEL-DIVERGENCE-NOTE.md (the negotiation doc
--     between Policies090526 and the runtime).
--   - PARENT-APP-CONSENT and NANNY-ATTESTATION agreement_id mappings
--     in `src/lib/legal/record-consent.ts:getDocumentIdForAgreement`.
-- =============================================================================

BEGIN;

-- ============================================================
-- 1. parent-app-consent v2
-- ============================================================
INSERT INTO legal_documents (
  document_id,
  version,
  effective_date,
  change_summary,
  body_md
) VALUES (
  'parent-app-consent',
  2,
  DATE '2026-05-14',
  'v2 — T-014 authored canonical body. ~5,900 words. Replaces T-015 v1 placeholder. Sections 1-10 + Quick Read summary. Covers Legal Guardian attestation, scope of collection (incl. 6 sensitive-info categories), storage + access, retention, 12-month renewal, withdrawal cascade, ACL/UCT no-refund framework, COPC alignment.',
  $body$# Baby Bloom — Parent App Consent

**Document slug (`legal_documents.document_id`):** `parent-app-consent`
**Version:** 1.0
**Effective:** [DATE — to be inserted at publication]
**Format:** This document is the bundled, in-app consent the Legal Guardian gives at the moment they tap **Add child** (when creating their child's record themselves) or **Connect** (when accepting an invite from a Childcare Professional who has already created the child's record). It is captured separately from, and in addition to, the Legal Guardian's acceptance of Baby Bloom's Client Terms of Service (Section 01) at account sign-up.
**Governing law:** Commonwealth of Australia and New South Wales — in particular the *Privacy Act 1988* (Cth) and the Australian Privacy Principles (APPs), with explicit reliance on APP 3 (collection), APP 5 (notification of collection), APP 6 (use or disclosure), APP 8 (cross-border disclosure), APP 11 (security and destruction), APP 12 (access), and APP 13 (correction); the Children's Online Privacy Code (COPC), registered by the Office of the Australian Information Commissioner and commencing 10 December 2026; the *Australian Consumer Law* (Schedule 2 to the *Competition and Consumer Act 2010* (Cth)), in particular the unfair-contract-terms regime under sections 23 to 28 in the post-26 March 2026 penalty regime; the *Family Law Act 1975* (Cth) Part VII, in connection with parental responsibility and the identification of a Legal Guardian; and the *Education and Care Services National Law* (NSW) where it interacts with the photograph-handling regime in Section 28.

---

## Quick read — what you are agreeing to

When you tap the consent button below, you are confirming five things at once. Read the long version in sections 1 to 10 before you tap if any of them feel unfamiliar to you.

1. **You are [Child First Name]'s Legal Guardian** under Australian law (section 1).
2. **You consent to Baby Bloom collecting personal information about [Child]** for the purpose of providing the Baby Bloom service — including [Child]'s first name, date of birth, and gender; observations, activity logs, diary entries, and Early Years Learning Framework progress notes that you or your linked Childcare Professional add; photographs that you or your linked Childcare Professional upload; and, where you choose to share them, sensitive-information categories such as allergies, medical conditions, developmental concerns, mental-health observations, and medication (section 2).
3. **You understand who can see [Child]'s information** — you, your linked Childcare Professional, the Katie AI agent on each of your accounts, and authorised Baby Bloom staff under our Admin Access Policy. Not the public internet. Not advertisers. Not third-party AI training (section 3).
4. **You understand how long Baby Bloom keeps the information** — for the life of your active account, with a 90-day soft-delete cycle when you remove an individual item, and a hard cascade if you withdraw this consent or close your account (sections 4 and 5).
5. **You understand that withdrawing this consent permanently deletes [Child]'s profile and cancels your subscription at the end of the current paid period, and that no refund is owed** (section 6).

This consent is **separate from** the Client Terms of Service you accepted at account sign-up. The Children's Online Privacy Code (commencing 10 December 2026) asks Baby Bloom to capture child-specific consent at the moment of collection, not at account sign-up. You are seeing this consent now because [Child]'s record is being created (or being accepted) now.

---

## 1. The Legal Guardian attestation

By tapping the consent button, you confirm that you are [Child First Name]'s **Legal Guardian** within the meaning of:

(a) the *Family Law Act 1975* (Cth) — including a parent under section 61C; a person who has parental responsibility for [Child] under a court order; an adoptive parent of [Child]; or another person to whom a court has formally granted parental responsibility for [Child]; or

(b) the equivalent provisions of any other Australian or foreign law of [Child]'s ordinary place of residence.

If you do not hold parental responsibility for [Child] under one of the above, you must not tap the consent button. Adding a child to Baby Bloom without legal authority is a misrepresentation and may engage the consequences set out in Section 25 (Child Invite & Linking Terms) § 3.5, including removal of the child record, suspension or closure of your Baby Bloom account, and any indemnity claim Baby Bloom is entitled to bring under Section 01 (Client Terms of Service) § 16.

Where parental responsibility for [Child] is shared with another Legal Guardian (a co-parent, a separated parent, a court-appointed guardian), you further confirm that either (a) the other Legal Guardian has agreed to your adding [Child] to Baby Bloom, or (b) you have the lawful authority to make this decision alone under the relevant arrangement. Where another Legal Guardian later objects to a record having been added, the dispute-resolution mechanism in Section 25 § 3.5 applies.

---

## 2. What you are consenting to — the scope of collection

By tapping the consent button, you consent to Baby Bloom collecting, holding, and using the following categories of [Child]'s personal information for the purpose of providing the Baby Bloom service:

### 2.1 Identity information

[Child]'s **first name**, **date of birth**, and **gender**, as you enter them when [Child]'s record is created. Baby Bloom does not collect [Child]'s surname, address, or contact details under this consent — those are explicitly out of scope unless and until you choose to provide them through a separately-consented surface in a future release.

### 2.2 Observations, activity logs, diary entries, and EYLF progress notes

Information that you, your linked Childcare Professional, or the Katie AI agent (acting on your account or on your Childcare Professional's account) adds to [Child]'s feed in the ordinary course of using Baby Bloom. Examples include a textual note about [Child]'s afternoon nap, a tag recording a meal, a diary entry describing the day, or an Early Years Learning Framework progress entry recording development across the five EYLF outcome domains. None of these entries are required; you choose what to enter.

### 2.3 Photographs

Photographs of [Child] uploaded to Baby Bloom by you, or — where you separately and expressly authorise it — by your linked Childcare Professional. Photographs are subject to additional protections set out in Section 28 (Child Photo Upload Consent), which is incorporated by reference into this consent. In particular: photographs cannot be uploaded by anyone before this consent is live (section 5.4 below); photographs are stored in Australia; photographs are not used for marketing or for the training of AI models; and photographs are deleted on a 90-day soft-delete cycle when removed individually, or as a cascade of the deletion of [Child]'s record.

### 2.4 Sensitive-information categories

Where you choose to share them, the following categories of sensitive information about [Child] within the meaning of section 6(1) of the *Privacy Act 1988* (Cth):

(a) **Allergies and dietary restrictions** — food allergies, environmental allergies, contact allergies, religious or cultural dietary restrictions, EpiPen requirements, and specific food-avoidance instructions.

(b) **Medical conditions** — chronic or acute, physical or congenital. Examples include asthma, eczema, type-1 diabetes, congenital heart condition, prior surgery, recurring ear infections, hearing or vision impairment. Genetic predispositions that you volunteer fall within this category.

(c) **Developmental concerns, special needs, and diagnoses** — suspected or assessed delays in any EYLF outcome domain; formal diagnoses appropriate to [Child]'s age (autism spectrum disorder, global developmental delay, hearing or vision impairment with developmental implications); NDIS plans, therapy plans, and individual education plans.

(d) **Mental-health and behavioural observations** — clinical-adjacent observations of emotional state, mood, distress, anxiety, or behavioural patterns. Treated as **high-sensitivity** under the OAIC's *Guide to Health Privacy* (May 2025) and handled with elevated access controls described in section 3.

(e) **Medication** — names, doses, schedules, and prescriber details for any medication [Child] is taking or has recently taken. Treated as **high-sensitivity** on the same basis as section 2.4(d).

(f) **Photographs disclosing visible health context** — photographs that show [Child]'s medical device, EpiPen, cast, splint, hospital environment, or other visible health-context content. These photographs are subject both to the photograph treatment at section 2.3 (and Section 28) and to the sensitive-information treatment at this section 2.4.

You may choose, inside the app at any time, which of these six categories to share for [Child] and which to withhold. Withholding any category means that the relevant in-app surfaces (the allergy block, the medication block, and so on) will not be populated for [Child]; you and your linked Childcare Professional remain free to manage the relevant category off-platform — for example through a paper plan, in-person communication, or your own messaging app. For some categories, particularly medication and allergies, this is a real operational change: the in-app safety prompts that would otherwise fire when a meal is logged, or when a dose is recorded, will not fire.

The fuller treatment of each sensitive-information category — what it covers, who can see it, where it appears in the platform, what happens if you do not share it — is at Section 29 (Children's Sensitive Information Consent Form), which is incorporated by reference.

### 2.5 Katie AI agent shared memory

You consent to the Katie AI agent on your account, and the Katie AI agent on your linked Childcare Professional's account, holding notes about [Child] in **shared memory** — notes that the two Katie agents can each see, write to, and surface in chat. Shared memory allows the platform to maintain continuity across the two adults caring for [Child]. Notes classified as sensitive (the categories at section 2.4) are written to shared memory only where you have consented to the corresponding category. The fuller treatment is at Section 26 (Katie AI Agent Terms of Use) § 6.4.

### 2.6 What is NOT in scope

Baby Bloom does not, under this consent, collect about [Child]:

- their surname or full name;
- their physical address, school address, or any other location information;
- their direct contact details ([Child] does not have a Baby Bloom account in this product);
- biometric templates of [Child] — Baby Bloom's AI image-processing path is configured so that images are passed as context to the model rather than processed for biometric matching, subject to a pre-launch operational confirmation from Google Cloud that the Vertex AI service in our configuration does not generate persistent biometric templates;
- any financial information of [Child] or your household beyond what Stripe captures for the purpose of subscription billing under your account, governed by Section 22 (Subscription Terms and Billing);
- any information for the purpose of marketing to [Child] or to you on the basis of [Child]'s profile;
- any information for the purpose of training AI models on [Child] specifically; or
- any information for disclosure to a third party except as set out at section 3 below.

If you want a specific category of information about [Child] to be removed from the platform, the access-and-correction mechanism at section 8 applies.

---

## 3. Where the information is held and who can see it

### 3.1 Where stored

[Child]'s personal information is held in **Supabase**, in the **AWS Sydney region** (`ap-southeast-2`), Australia. Photographs are held in Supabase Storage in the same region. Information is encrypted at rest using AES-256, and in transit using TLS version 1.2 or higher. Information does not leave Australia in the ordinary course; the cross-border disclosure regime at Section 03 (Privacy Policy) § 7 governs the limited cases where information transits a non-Australian processor (in practice, this is the image-as-context routing to Google Cloud's Vertex AI service in the Sydney region, which is also in Australia, and the limited operational data flows to Stripe for subscription billing).

### 3.2 Who can see it

The following parties can access [Child]'s information through normal product flows:

- **you**, as the Legal Guardian, for the life of your active Baby Bloom account;
- **your linked Childcare Professional**, where one is currently engaged on [Child]'s record. Access ends the moment the engagement ends under Section 25 § 10 — the Professional is unbound from [Child]'s record at the moment of placement-end, not on a cron cycle;
- **the Katie AI agent on your account, and the Katie AI agent on your linked Childcare Professional's account**, each acting as the AI agent of the party in question;
- **authorised Baby Bloom administrators**, under Section 18 (Admin Access Policy), for support, abuse and safety review, audit, and incident investigation. Administrator access is logged in an immutable audit trail and is reviewable on request;
- **third-party processors named in the Privacy Policy** — in particular Supabase Inc. (database and storage), Google LLC and Google Cloud Australia Pty Ltd (Vertex AI for image-as-context routing), Resend (transactional email), and Stripe (subscription billing). Each processor is under contractual confidentiality and data-protection obligations.

The following parties **cannot** see [Child]'s information through normal product flows:

- the public internet and search-engine crawlers;
- other Legal Guardians, including, where a photograph incidentally includes another child, that other child's Legal Guardian;
- other Childcare Professionals not linked to [Child];
- advertising networks or analytics partners with audience-targeting capability — Baby Bloom does not run such partners on authenticated surfaces;
- AI model training pipelines outside the image-as-context routing disclosed in the Privacy Policy.

### 3.3 What Baby Bloom does not do

Baby Bloom does not sell, license, trade, or commercialise [Child]'s information to any party.

Baby Bloom does not use [Child]'s photograph or any other content about [Child] on the public Baby Bloom website, in app-store listings, in advertising, in social-media posts, in case studies, in screenshots used externally, in investor materials, or in any other public-facing surface.

Baby Bloom does not run audience-targeting analytics partners on authenticated surfaces.

Baby Bloom does not disclose [Child]'s information in response to a third-party request except where Baby Bloom is legally compelled to do so. Where Baby Bloom is legally compelled — for example, a Family Court production order or a lawful police request — the disclosure framework in Section 03 (Privacy Policy) §§ 8 and 17 governs.

---

## 4. How long Baby Bloom keeps the information

### 4.1 Active account

For as long as your Baby Bloom account is active and [Child]'s record is on it, Baby Bloom retains the information in accordance with the access controls at section 3.2.

### 4.2 In-app deletion of an individual item

When you (or, for an item your linked Childcare Professional added under delegated authority during the active grace, the Professional themselves) delete a feed item, a photograph, or another entry through the in-app delete affordance, the item is **soft-deleted**. It is hidden from view across the platform immediately, and held for a **90-day grace period**, after which it is **hard-deleted** from the database (and, in the case of photographs, from Supabase Storage). The 90-day grace lets you recover from accidental deletion.

You can request **expedited hard-deletion** of a specific item before the 90 days elapses by emailing `compliance@babybloomsydney.com.au`. Baby Bloom acts on expedited deletion requests within the standard access-and-deletion service level at Section 03 (Privacy Policy) § 12 (currently 10 business days), and aims to complete child-record expedited requests within 3 business days as a trust signal.

### 4.3 Removing [Child] from your account in the ordinary course

If you remove [Child]'s record from your account through the **Remove child** affordance in child profile settings (and this is not done as part of a consent-withdrawal under section 6), the cascade in Section 28 § 4.4 (photographs hard-deleted) and Section 29 § 8 (sensitive-information entries hard-deleted) applies, together with hard-deletion of observations, activity logs, diary entries, and EYLF progress notes. Cascade is subject to the statutory carve-outs at section 4.5 below.

### 4.4 Closing your account

When you close your Baby Bloom account, the standard post-closure retention applies: the account and all data attached to it, including [Child]'s record, are kept for **90 days** after closure and then hard-deleted on the retention cron disclosed at Section 03 (Privacy Policy) § 10. The 90-day post-closure grace gives you a window to re-open your account if you change your mind.

### 4.5 Statutory retention carve-outs

Where a record is subject to a statutory retention obligation, that record is preserved in an admin-only, child-record-unlinked archive for the period required by law, notwithstanding any cascade or deletion under sections 4.2 to 4.4. The statutory retention obligations Baby Bloom recognises are:

- the **NDIS Quality and Safeguards Commission** notification scheme;
- the **Working With Children Check** disclosure pathway;
- the **ATO** tax-record retention regime under the *Tax Administration Act 1953* (Cth) section 382-5 (currently five years for tax-adjacent records); and
- any other obligation imposed by Australian or applicable foreign law.

Where a record is retained under a statutory carve-out, you are notified by email of the retention and the basis for it. The retention is for the minimum period the law requires and ends at the end of that period.

### 4.6 Baby Bloom does not use "for as long as necessary"

Baby Bloom does not use the formulation "for as long as necessary" as its retention floor. The OAIC has consistently warned against that formulation under APP 11.2. The retention floors above are the floors Baby Bloom commits to. If a shorter floor becomes legally required under the Children's Online Privacy Code after its commencement (10 December 2026), Baby Bloom will reduce the retention period and re-issue this consent.

---

## 5. How this consent gates [Child]'s information collection

### 5.1 Identity-data collection at child creation

[Child]'s first name, date of birth, and gender are collected at the moment you (or, on the Path A invite-accept flow, the inviting Childcare Professional under Section 25 § 3) create [Child]'s record. These items are the minimum identifying information needed for the platform to function and are protected by the GREEN-tier data architecture at Section 25 § 3.3. They are collected even before this consent fires on the invite-accept path — your consent at the invite landing ratifies the prior collection.

### 5.2 Text observations, activity logs, diary entries, EYLF progress notes

Collected at the moment you, your linked Childcare Professional, or the Katie AI agent writes the entry to [Child]'s feed. These entries are gated by your active Baby Bloom subscription but are not separately gated by this consent so long as this consent remains live for [Child].

### 5.3 Sensitive-information categories

Collected at the moment you enter information into a sensitive-tagged field (such as the allergy block, the medication block, the medical-conditions block, the developmental-concerns block, or the mental-health-observations block), or when you apply a sensitive-category tag to a feed entry. Information cannot be entered into a sensitive-tagged field unless you have first turned the relevant category on in the in-app sensitive-information controls. Childcare Professionals are not authorised to enter sensitive information about [Child] except in connection with section 2.4(f) photographs uploaded under delegated authority.

### 5.4 Photographs — gated on this consent

Photographs of [Child] cannot be uploaded by **anyone** — including you — until **this consent is live for [Child]**. The platform enforces the photo gate at three layers:

(a) at the user interface (the upload affordance is disabled, with a clear reason);

(b) at the server action (any payload attempting to upload a photograph is rejected); and

(c) at the database row-level security policy (the storage object write is denied).

The pre-Connect photo prohibition reflects the position taken by Apple Family Sharing, Google Family Link, Brightwheel (United States childcare app), and Australian childcare centres operating under the *Education and Care Services National Law* (NSW). It also reflects the OAIC's *Children and Young People* guidance and the eSafety Commissioner's [Sharing photographs and videos of children](https://www.esafety.gov.au/parents/issues-and-advice/sharing-images-children) guidance, both of which treat children's photographs as elevated-sensitivity content. The full long-form treatment of the photo regime is at Section 28 (Child Photo Upload Consent).

### 5.5 Where the Childcare Professional uploads a photograph of [Child]

A Childcare Professional engaged on [Child]'s record may upload a photograph **only where you have given that Professional express permission to do so**, given out-of-band — for example, by saying yes when the Professional asks, by signing a paper consent or a clear written message, or through your own messaging channel. The Professional's attestation at upload is recorded against their account; the indemnity at Section 02 (Professional Terms of Service) § 16 applies if the attestation turns out to have been false. Importantly: the Professional's attestation does **not** unlock photographs by itself — the photo gate keys on **this consent** (`PARENT-APP-CONSENT`), not on the Professional's attestation (`NANNY-ATTESTATION`). Your consent is what unlocks photographs of [Child].

### 5.6 Katie's shared-memory writes

When the Katie AI agent attempts to write a note about [Child] to shared memory and the note is classified as sensitive under any of the six categories at section 2.4, the write requires you to have turned the corresponding category on. If the category is off, Katie's internal `write_memory` tool fails closed: the note is not written to shared memory and is not held in your or your Childcare Professional's chat history. The full treatment is at Section 26 (Katie AI Agent Terms of Use) § 6.4.

---

## 6. Withdrawing this consent

### 6.1 Three ways you can withdraw

You can withdraw this consent at any time, in three ways:

(a) **At the invite landing.** If you arrived at this consent via `/invite/{token}` — a Childcare Professional created [Child]'s record before you joined Baby Bloom and then invited you to connect — you can tap **Decline** instead of **Connect**. Declining at the invite landing immediately permanently deletes [Child]'s record from Baby Bloom (subject to the statutory carve-outs at section 4.5) and prevents any future use of the invite token. The 30-day notice window at section 6.2 does **not** apply to decline-at-invite — it is treated as a refusal of an offer, not as a withdrawal of a previously-given consent.

(b) **At the 12-month renewal modal.** Twelve months after you give this consent, Baby Bloom shows you a re-confirmation modal (described at section 7). At the modal you can tap **Renew** (which continues your consent for another twelve months) or **Withdraw** (which begins the withdrawal sequence at section 6.2 below).

(c) **At any time via child profile settings.** Inside the app, under [Child]'s profile settings, the option **Withdraw consent for [Child]** is available at all times. Tapping it begins the withdrawal sequence at section 6.2.

### 6.2 The 30-day notice-and-revocation window

When you confirm a withdrawal under section 6.1(b) or 6.1(c), a **30-day notice-and-revocation window** runs from the moment you confirm. During the window:

(a) Forward writes to [Child]'s record are paused — no new feed entries, no new photographs, no new sensitive-information entries can be added by any user;

(b) Historical data remains visible and accessible to you, including for export under section 8;

(c) A persistent banner on your dashboard offers the option **I changed my mind — keep [Child] on Baby Bloom**. Tapping it cancels the withdrawal: gating clears, the 12-month renewal cycle resumes from the original anniversary, and your subscription continues uninterrupted;

(d) Your subscription is **not** cancelled during the window. You remain a paying subscriber, preserving the option to revoke without administrative friction. If you want to cancel the subscription in parallel, the standard cancellation flow at Section 22 § 11 remains available to you;

(e) Trust & Safety review is triggered on the withdrawal event so that, where the withdrawal looks like it might have been the product of duress or account compromise, a Baby Bloom administrator can reach out to you through an alternative channel before deletion runs.

### 6.3 After the 30-day window — what happens

If you do not tap **I changed my mind** within 30 days, the deletion runs:

(a) **[Child]'s profile is permanently deleted**, with cascade through all attached entries — feed observations, activity logs, diary entries, EYLF progress notes, photographs (deleted from Supabase Storage), sensitive-information entries (deleted from the sensitive blocks and the relevant feed tags), and Katie shared-scope memory notes about [Child]. Deletion is subject to the statutory carve-outs at section 4.5.

(b) **Your subscription is auto-cancelled at the end of the current paid period**, via Stripe with `cancel_at_period_end: true` and no proration. You are not charged again. The mechanics are at Section 22 § 11.7.

(c) **No refund is owed.** Baby Bloom does not refund any subscription fees paid for the current period or for any prior period. The full refund position is at Section 14 § 4.5; section 6.4 below summarises the architecture.

(d) **A confirmation email is sent to you** confirming the deletion has completed and the subscription cancellation has been scheduled. The email includes a list of any records retained under a section 4.5 statutory carve-out, with the legal basis for each retention.

### 6.4 Why no refund — the informed-decision framing

The decision to withdraw this consent is **your informed decision**, not a Baby-Bloom-initiated termination. The Australian Consumer Law unfair-contract-terms regime (Schedule 2 to the *Competition and Consumer Act 2010* (Cth) sections 23 to 28, in the post-26 March 2026 penalty regime under which the cap is the higher of A$50 million, 30 per cent of adjusted turnover, or three times the value of the benefit obtained) treats no-refund postures unevenly: a platform-imposed termination with a no-refund posture is fragile; a genuinely parent-initiated termination with a no-refund posture is defensible where:

(a) the parent made the decision after seeing the consequences clearly, in advance of commitment (this clause is the clearest place where they are stated, and the renewal modal at section 7 surfaces them again at the moment of action);

(b) the parent had a real cooling-off opportunity (the 30-day revocation window at section 6.2 is that opportunity, and is genuinely revocable through the **I changed my mind** affordance);

(c) the underlying decision is about the parent's privacy preferences for the parent's own child, not about the platform's commercial choice; and

(d) the alternative postures — refunding, half-states, "we hold the data just in case" — would themselves create privacy-law risk by extending Baby Bloom's processing of children's data without lawful basis under APP 3.

Section 14 § 4.5 carries the full refund-side architecture and records Baby Bloom's compliance with the Mable section 87B undertaking (no penalty fees, no deemed acceptance, no unilateral fee or term changes, no retroactive change to paid commission). The 30-day Goodwill Refund commitment at Section 14 § 3.2 — which is a contractual commitment, **not** the statutory cooling-off right under the *Australian Consumer Law* Part 3-2 Division 2 (a right that applies to unsolicited consumer agreements and does not apply to a solicited online subscription) — does not apply to consent-withdrawal terminations.

### 6.5 Withdrawing the link to one Childcare Professional without withdrawing this consent

If you want to end your engagement with the Childcare Professional currently linked to [Child] but keep [Child] on Baby Bloom — for example, because you are switching to a new Childcare Professional — you do so through the **End engagement with [Professional]** action in [Child]'s profile settings, not through consent withdrawal under this section 6. The mechanics are at Section 25 § 10. Your subscription is not affected; [Child]'s record stays on Baby Bloom; the Professional's `nanny-attestation` consent for [Child] is ended; and a fresh attestation is captured the next time you link a Professional.

### 6.6 Where one Legal Guardian withdraws and another disputes

If [Child] has more than one Legal Guardian and the other Legal Guardian disputes a withdrawal you have initiated, the dispute-resolution mechanism in Section 25 § 3.5 applies. Pending resolution, the withdrawal pauses; [Child]'s record is retained but gated; no deletion fires. The dispute may engage the Family Court or another competent decision-maker, and Baby Bloom acts on a court order or other binding direction.

---

## 7. Annual re-confirmation — the 12-month cadence

Twelve months after the date you tap the consent button (recorded in the `recorded_at` field of the `consent_records` row for this consent), Baby Bloom asks you to re-confirm. The cadence implements the Children's Online Privacy Code (commencing 10 December 2026), which sets a maximum 12-month validity period for any consent involving the collection of children's personal information not strictly necessary to provide the service.

### 7.1 The T-7-days banner

Seven days before the 12-month anniversary, an unobtrusive banner appears on your dashboard:

> *"You confirmed [Child]'s consent on [date]. We check in every twelve months — tap to renew."*

The banner is dismissible per session (you can ignore it today and come back tomorrow), but persists across sessions until you decide.

### 7.2 The renewal modal

Tapping the banner opens a modal that shows you:

(a) the **current** consent text — the version you previously accepted;

(b) the **proposed** consent text — the version you are being asked to renew under (usually the same; if Baby Bloom has updated the policy in the intervening 12 months, the changes are highlighted inline);

(c) a primary affordance: **Renew my consent for [Child] for another twelve months**; and

(d) a secondary affordance: **I no longer want to use Baby Bloom for [Child]** — which, when tapped, expands to surface the consequences at section 6 (permanent deletion, subscription cancellation, no refund) and requires a second tap on **Withdraw** to commit. This two-tap pattern is intentional friction at the moment of an irreversible decision.

### 7.3 If you renew

A new `consent_records` row is written under the same `agreement_id` (`PARENT-APP-CONSENT`) and the same `document_id` (`parent-app-consent`), with `parent_consent_record_id` threaded back to the prior row for audit-trail continuity. Your consent continues for another 12 months. A confirmation toast on your dashboard reads *"Consent renewed for [Child] for the next 12 months."*

### 7.4 If you withdraw

The withdrawal sequence at section 6.2 begins immediately upon the second tap on **Withdraw**. The 30-day notice-and-revocation window runs from that moment.

### 7.5 If you do not respond for 30 days after the anniversary

Forward photographic uploads and sensitive-information entries are gated (the three-layer block described at section 5). No deletion fires automatically; the renewal modal continues to surface until you decide. If a further 30 days pass without response, an escalated email reminder is sent and forward writes are progressively gated until the platform is unusable for [Child] until you renew or withdraw. The full subscription-side escalation architecture is at Section 22 § 7.7.

### 7.6 If [Child] reaches 15 years of age while their record is active

The Children's Online Privacy Code sets the age at which a child can give their own consent (rather than a Legal Guardian giving it on the child's behalf) at 15 years old. Baby Bloom serves the 0-to-5 Early Years Learning Framework cohort and does not accept the creation of records for children above the age of 5 — the **Add child** form rejects entries above that age. As a practical matter, no child on Baby Bloom reaches the COPC 15-year threshold while their record is active, and consent under this document is always given by the Legal Guardian. The 15-plus self-consent pathway under the COPC is not implemented in this version of Baby Bloom; if Baby Bloom expands the service to older children in future, the pathway will be introduced by a separate amendment.

---

## 8. Your access and correction rights — APP 12 and APP 13

You have rights under the *Privacy Act 1988* (Cth) to access information Baby Bloom holds about [Child] (APP 12) and to seek correction of inaccurate information (APP 13). The rights are summarised here and treated in full at Section 03 (Privacy Policy) § 12.

### 8.1 Access

You can request a copy of all information Baby Bloom holds about [Child] by emailing `compliance@babybloomsydney.com.au`. Baby Bloom acts on access requests within 10 business days; for child-record requests Baby Bloom aims for 3 business days. The response is delivered as a structured export (JSON or CSV format) plus a downloadable archive of photographs and other binary attachments.

### 8.2 Correction

You can request correction of any information Baby Bloom holds about [Child] by emailing the same address, or by using the in-app edit affordance for entries that you (or your linked Childcare Professional) added. Baby Bloom acts on correction requests within 10 business days.

### 8.3 Export under the COPC

The Children's Online Privacy Code (commencing 10 December 2026) is expected to require structured export of children's data in a machine-readable format on request. Baby Bloom is committed to that standard from the COPC commencement date.

---

## 9. Changes to this consent

If Baby Bloom updates this consent text — for example to expand or narrow the scope under section 2, to add a new data category, or to refine the withdrawal mechanics — Baby Bloom will:

(a) **not apply the change retroactively** to information collected under the prior version of the consent. The version archive at Section 22 § 15.5 preserves every prior version of every consent document.

(b) **present you with the updated text** at the next product action that depends on the consent. For most updates this is the next 12-month renewal anniversary; for material updates (changes that materially expand the scope of collection or weaken your rights), the updated text is presented at your next sign-in rather than at the next anniversary.

(c) **require you to either accept the updated text** (which then governs collection going forward) **or withdraw** under section 6 (which triggers the deletion sequence as if you were withdrawing at the 12-month renewal).

(d) **treat your prior consent as governing the prior period**. The `agreement_version` and `modal_content_version` fields recorded against the prior `consent_records` row are the forensic evidence of the exact text you accepted.

---

## 10. Governing law and dispute resolution

### 10.1 Governing law

This consent is governed by the law of the **State of New South Wales** and the **Commonwealth of Australia**. Any dispute arising out of or in connection with this consent is subject to the non-exclusive jurisdiction of the courts of New South Wales.

### 10.2 Disputes — internal complaints first

If you are unhappy with how Baby Bloom is handling [Child]'s information, contact `compliance@babybloomsydney.com.au` in the first instance. Baby Bloom's complaints process is at Section 03 (Privacy Policy) § 17 and Section 21 (Legal & Contact) § 4. Baby Bloom commits to a substantive response within 30 days.

### 10.3 External escalation

If your complaint is not resolved to your satisfaction within 30 days of your contacting Baby Bloom, you may escalate to:

- the **Office of the Australian Information Commissioner (OAIC)** for privacy-related complaints (`oaic.gov.au`);
- the **NSW Civil and Administrative Tribunal (NCAT)** for consumer-law disputes;
- the **eSafety Commissioner** for content-of-children-related complaints (`esafety.gov.au`); and
- any other regulator with jurisdiction over the relevant subject-matter.

Contact details and the broader regulator map are at Section 21 (Legal & Contact) § 6.

### 10.4 Children's Online Privacy Code

From 10 December 2026, the Children's Online Privacy Code provides additional rights and protections for children's data. Baby Bloom is committed to compliance from the COPC commencement date. The COPC readiness framework is summarised at Section 03 (Privacy Policy) § 13.

---

## Confirmation

By tapping **Add [Child First Name]** (on the add-child path) or **Connect to [Child First Name]** (on the invite-accept path) with the consent box ticked above this confirmation, you confirm that:

- you have read this consent in full or in the Quick Read summary;
- you understand what you are agreeing to;
- you are [Child First Name]'s Legal Guardian within the meaning of section 1;
- you give this consent freely, without coercion; and
- you understand that withdrawing this consent permanently deletes [Child]'s profile and cancels your subscription at the end of the current paid period, with no refund owed.

The consent box is ticked by default. **Unticking it disables the button.** If you do not consent, do not tap the button: close the modal and return to the parent surface. No consent is recorded; no child record is created. On the invite-accept path, the invite remains pending and you can return to it later, or decline it expressly under section 6.1(a).
$body$
)
ON CONFLICT (document_id, version) DO NOTHING;

-- ============================================================
-- 2. nanny-attestation v2
-- ============================================================
INSERT INTO legal_documents (
  document_id,
  version,
  effective_date,
  change_summary,
  body_md
) VALUES (
  'nanny-attestation',
  2,
  DATE '2026-05-14',
  'v2 — T-014 authored canonical body. ~6,200 words. Replaces T-015 v1 placeholder. Sections 1-10 + Quick Read summary. Covers per-engagement legal-guardian-permission attestation (Path A/B), engagement scope, photograph gating (parent consent gates, not nanny attestation), sensitive-info Professional restrictions, retention, 12-month renewal, withdrawal unlink (no cascade delete), false-attestation consequences + indemnity cap.',
  $body$# Baby Bloom — Childcare Professional Attestation

**Document slug (`legal_documents.document_id`):** `nanny-attestation`
**Version:** 1.0
**Effective:** [DATE — to be inserted at publication]
**Format:** This document is the bundled, in-app attestation a Childcare Professional gives at the moment they tap **Add child** (when they are creating a child record under the Path A nanny-first flow, before the Legal Guardian has joined Baby Bloom) or **Connect** (when they are accepting an invite from a Legal Guardian who has already created the child's record under the Path B parent-first flow). It is captured separately from, and in addition to, the Childcare Professional's acceptance of Baby Bloom's Professional Terms of Service (Section 02) at account sign-up.
**Governing law:** Commonwealth of Australia and New South Wales — in particular the *Privacy Act 1988* (Cth) and the Australian Privacy Principles (APPs), with explicit reliance on APP 3 (collection), APP 3.6 (collection from someone other than the individual), APP 5 (notification of collection), APP 6 (use or disclosure), APP 11 (security and destruction), APP 12 (access), and APP 13 (correction); the Children's Online Privacy Code (COPC), registered by the Office of the Australian Information Commissioner and commencing 10 December 2026; the *Fair Work Act 2009* (Cth) and the *Fair Work Act 2024* (Cth) amendments at section 15AA in connection with the substance-over-form characterisation of the engagement; the *Australian Consumer Law* (Schedule 2 to the *Competition and Consumer Act 2010* (Cth)) under the post-26 March 2026 penalty regime; the *Education and Care Services National Law* (NSW) where it interacts with childcare delivery.

---

## Quick read — what you are confirming

When you tap the attestation button below, you are confirming five things at once. Read the long version in sections 1 to 10 before you tap if any of them feel unfamiliar to you.

1. **You have [Child First Name]'s Legal Guardian's permission to add [Child] to Baby Bloom** (or, on the invite-accept flow, to accept the link the Legal Guardian has offered you) (section 1).
2. **You are engaging with [Child] as a Childcare Professional**, not as a family member, volunteer, or other capacity (section 2).
3. **You will use Baby Bloom in service of the engagement** — observations, activity logs, diary entries, EYLF progress notes that are accurate to what happened during your time with [Child], not fabricated or written for other purposes (section 2).
4. **Photographs of [Child] are gated by the Legal Guardian's consent, not yours** — you can only upload photographs once the Legal Guardian has connected and given their own `parent-app-consent`, and only where the Guardian has expressly authorised you (out-of-band) to be the uploader (section 3).
5. **You understand the consequences of a false attestation** — including removal of your access to [Child]'s record, possible suspension or closure of your Baby Bloom Childcare Professional account, and potentially an indemnity claim under Section 02 (Professional Terms of Service) § 16 (section 9).

This attestation is **separate from** the Professional Terms of Service you accepted at account sign-up. The Professional Terms of Service is the platform-level agreement between you and Baby Bloom; this attestation is the per-child layer that covers your engagement with [Child] specifically. The Children's Online Privacy Code (commencing 10 December 2026) and Australian Privacy Principle 3.6 ask Baby Bloom to capture a per-child attestation at the moment of collection where a Childcare Professional is the inviter or the engaging party.

---

## 1. The legal-guardian-permission attestation

By tapping the attestation button, you confirm — depending on which flow you are on — one of the following:

### 1.1 Add-child path (Path A — nanny-first)

You are creating [Child]'s record on Baby Bloom **before** [Child]'s Legal Guardian has joined the platform. By tapping **Add [Child]**, you confirm:

(a) you have spoken to [Child]'s Legal Guardian — by phone, in person, by message, or through another channel — and the Legal Guardian has said yes to your adding [Child] to Baby Bloom so that the two of you can use the platform together;

(b) you understand that the Legal Guardian will receive an invite link from Baby Bloom (generated when you tap **Add [Child]**) which you share with them through your own channel, and the Legal Guardian will ratify your prior collection of [Child]'s information by tapping **Connect** on the invite landing within the 365-day orphan-cleanup window (the architecture is at Section 25 (Child Invite & Linking Terms) §§ 5 and 13);

(c) until the Legal Guardian connects, your collection of [Child]'s information is limited to the GREEN-tier data set under the data-scope gradient at Section 25 § 3.3 — first name, date of birth, gender; textual observations, activity logs, diary entries, EYLF progress notes. You cannot upload photographs of [Child] (Section 28 § 5; the photo gate enforces this at three layers). You cannot enter sensitive-information categories about [Child] (Section 29 § 3; the relevant fields are blocked at three layers). You cannot enter [Child]'s surname, address, or other RED-tier data (Section 25 § 3.3); and

(d) if it turns out that you did not in fact have the Legal Guardian's permission — if the Legal Guardian later says they never agreed — the consequences at section 9 of this attestation apply, including removal of [Child]'s record and possible suspension of your Baby Bloom account.

The wording at section 1.1(a) is the **load-bearing attestation** for the APP 3.6 (collection from someone other than the individual) lawful basis Baby Bloom relies on to collect GREEN-tier data about [Child] in the pre-Connect period. The OAIC's view of APP 3.6 sufficiency in a third-party-attestation scenario is documented at the open lawyer question Q1 of Section 25's lawyer notes; Baby Bloom defends the position with the safeguards at Section 25 § 3 (the GREEN-tier limitation, the 30-day soft-lock, the 365-day orphan cleanup, the parent ratification + review-and-delete affordance at Section 25 § 7.4, and the misrepresentation consequences at section 9 of this attestation).

### 1.2 Invite-accept path (Path B — parent-first)

[Child]'s Legal Guardian has created [Child]'s record on Baby Bloom and is now inviting you, through `/invite/{token}`, to connect to it as the Childcare Professional engaged on [Child]'s care. By tapping **Connect**, you confirm:

(a) you understand the Legal Guardian's invitation to you, expressed through their tapping **Share invite to [Child]** in their copy of Baby Bloom, is their explicit permission for you to engage with [Child] on the platform — no separate out-of-band permission is needed under section 1.1(a) because the invite itself is the permission;

(b) you accept the engagement with [Child] subject to this attestation, the Professional Terms of Service at Section 02, and the Connection Agreement that is concurrently created under Sections 04–07 (matchmaking or babysitting variant, as applicable to the engagement type); and

(c) you understand the engagement is between you and the Legal Guardian — Baby Bloom is the platform on which the two of you record observations and use the AI tools; the underlying care arrangement (rates, hours, scope) is yours to agree separately with the Legal Guardian, and Baby Bloom is not a party to it.

The Path B attestation is materially less load-bearing than the Path A attestation because the Legal Guardian's invite itself is the consent; the attestation here is more an acceptance of the engagement than a third-party-permission claim.

---

## 2. Your engagement with [Child] — what this covers

### 2.1 You are engaging as a Childcare Professional

By tapping the attestation button, you confirm you are engaging with [Child] as a **Childcare Professional** — meaning a person who provides paid childcare services as a profession, holds the Working With Children Check that NSW law requires for the placement (or will hold it by the start of the placement), and operates under the Professional Terms of Service at Section 02. You are not engaging as a family member, volunteer, neighbour, or other capacity.

This characterisation is load-bearing for the substance-over-form analysis under the *Fair Work Act 2009* (Cth) section 15AA (Fair Work Act 2024 amendments). If the underlying relationship has the substance of employment under the multi-factor whole-of-relationship test rather than the form of independent contracting, the relevant employment-law consequences attach to the engagement between you and the Legal Guardian, not to Baby Bloom. Section 02 § 3 records the substance-over-form posture; the per-engagement commission cap and other defensive features under Section 23 (Nanny Commission and Payout Terms) are designed to keep individual engagements below the SG section 12(3) deemed-employee threshold.

### 2.2 What you will use Baby Bloom for in connection with [Child]

You will use Baby Bloom in service of the engagement — meaning the following classes of activity:

(a) **Recording observations** of [Child] during your time with [Child], in text, structured tags, or activity-log format;

(b) **Logging meals, sleep, nappies, and other day-to-day activities** as feed entries on [Child]'s record;

(c) **Maintaining diary entries** about [Child]'s day for the Legal Guardian to read;

(d) **Recording EYLF progress** — your assessment, in text and structured scoring where Baby Bloom offers it, of [Child]'s development across the five EYLF outcome domains;

(e) **Conversing with the Katie AI agent on your account** about [Child], including asking Katie to log entries, draft diary text, surface progress patterns, and remember relevant facts in the shared-memory store that you and the Legal Guardian's Katie agent each draw on. Sensitive notes are gated by the Legal Guardian's category-level consent at Section 29 (see section 4 below);

(f) **Uploading photographs of [Child]** — only where the Legal Guardian's `parent-app-consent` is live and only where you have the Legal Guardian's express permission to be the uploader (section 3 below); and

(g) **Engaging with the Baby Bloom support and Trust & Safety surfaces** in connection with [Child]'s record where required — for example, by reporting an incident through the Section 16 (Incident & Accident Report Form) surface.

### 2.3 What you will NOT use Baby Bloom for in connection with [Child]

You will not use Baby Bloom in connection with [Child]:

(a) for any purpose unrelated to the engagement — including personal recording, social media, or content creation outside the engagement;

(b) to record information about [Child] that is fabricated, exaggerated, or written for purposes other than supporting the engagement (for example, padding an EYLF progress note to make your performance look better);

(c) to record information about another child who is not in the engagement, except incidentally and where the other child's Legal Guardian's consent for the incidental recording is in scope;

(d) to share [Child]'s information with any other party outside the platform's normal access controls — meaning Baby Bloom, the Legal Guardian, and Katie are the only parties who see [Child]'s record through the platform, and you will not export, screenshot, photograph (for separate use), or otherwise extract [Child]'s information from the platform; and

(e) to continue use after the engagement has ended. The engagement ends when either you or the Legal Guardian terminates it; when termination occurs, your access to [Child]'s record ends at the moment of placement-end under Section 25 § 10, not on a cron cycle.

---

## 3. Photographs — gated by the Legal Guardian's consent

### 3.1 The gate

Photographs of [Child] are subject to additional protections at Section 28 (Child Photo Upload Consent). The platform's photo gate keys on the **Legal Guardian's `parent-app-consent`** — not on this attestation. The architecture is:

(a) **Until the Legal Guardian has connected** (Path A pre-Connect or Path B awaiting your acceptance), photographs cannot be uploaded by anyone, including you. The platform enforces the prohibition at three layers (user interface, server action, database row-level security policy). The block message reads: *"Photos of [Child] are disabled until [Child]'s Legal Guardian connects to Baby Bloom."* This reflects the OAIC's photographs-of-children guidance and the position taken by Apple Family Sharing, Google Family Link, Brightwheel, and Australian childcare centres under the *Education and Care Services National Law* (NSW).

(b) **After the Legal Guardian's `parent-app-consent` is live**, photographs can be uploaded — but, where you are the uploader, only where the Legal Guardian has given you **express permission to be the uploader of photographs**, out-of-band. Your attestation at the moment of each photograph upload (the §11 single-line confirmation at Section 28) records that you had that permission. The Legal Guardian's underlying consent for photographs is at section 2.3 of their `parent-app-consent`; their permission to you as the uploader is a separate act between you and the Legal Guardian.

(c) **If the Legal Guardian's `parent-app-consent` expires or is withdrawn**, your ability to upload photographs is gated at the same three layers as the pre-Connect prohibition. Section 28 § 4.7.3 governs.

### 3.2 What this means for you in practice

You should not upload photographs of [Child] to Baby Bloom unless:

(a) the Legal Guardian has joined Baby Bloom and ticked `parent-app-consent` for [Child] (you can confirm this in the in-app **Linked Adults** view of [Child]'s profile); and

(b) the Legal Guardian has expressly told you — by phone, in person, by message, by signing a paper consent — that you may upload photographs of [Child]; and

(c) your upload is for a purpose within the engagement, not for personal use, social media, content creation, or any other purpose outside the engagement.

If any of (a), (b), or (c) is missing, do not upload. If you are uncertain, contact `compliance@babybloomsydney.com.au` before uploading.

### 3.3 The misrepresentation framework on photograph attestation

If you upload a photograph attesting falsely that you have the Legal Guardian's permission, the consequences at section 9 of this attestation apply — including hard-deletion of the photograph (subject to statutory carve-outs at section 4.5 of `parent-app-consent`), Trust & Safety review of your account, possible suspension or closure of your Baby Bloom account, and potentially an indemnity claim under Section 02 § 16. The framework is structurally similar to the Section 25 § 3.5 framework for false legal-guardian-permission attestations at child creation.

---

## 4. Sensitive information about [Child] — your role

### 4.1 You cannot enter sensitive information

Sensitive-information categories about [Child] (allergies, medical conditions, developmental concerns, mental-health observations, medication, photographs disclosing health context — the six categories at Section 29 § 4) are entered into Baby Bloom **by the Legal Guardian**, not by you. The platform's sensitive-information UI controls are surfaced on the Legal Guardian's surface; the equivalent fields on your surface are read-only or absent.

This is because sensitive-information consent under APP 3.3 of the *Privacy Act 1988* (Cth) must be given by the data subject's lawful representative — for [Child], the Legal Guardian — and the consent is bundled into the Legal Guardian's `parent-app-consent`. Your attestation under this document does not extend to sensitive-information consent.

### 4.2 Where you observe sensitive content during the engagement

Where, during the engagement, you observe a sensitive-information fact about [Child] — for example, you notice that [Child] reacts to a particular food and the Legal Guardian has not yet shared an allergy entry for it; or you notice [Child] is consistently distressed at drop-off — you may:

(a) **mention it to the Legal Guardian off-platform**, in the ordinary course of your care relationship; or

(b) **add it as a non-sensitive observation** on the platform if the observation is genuinely non-sensitive (for example, "Mia is reluctant to eat the lentil bake — recommend trialling alternatives"). The Section 29 § 2 classification rules govern what crosses from non-sensitive to sensitive — broadly: an observation about ordinary preferences or routines is non-sensitive; an observation that names or implies a clinical-adjacent fact is sensitive.

(c) If you observe something clearly within a sensitive category that the Legal Guardian has not yet consented to share, you should **raise it with the Legal Guardian off-platform** before adding it on the platform. The platform's content classifier (where shipped) catches obvious sensitive content and prompts the Legal Guardian to consent; until the Legal Guardian consents, the entry is held in a non-published state.

---

## 5. Where the information goes and who can see it

### 5.1 Where stored

Information that you add to [Child]'s record is held in **Supabase**, in the **AWS Sydney region** (`ap-southeast-2`), Australia. The encryption and cross-border architecture is identical to that described at section 3 of `parent-app-consent`. The full treatment is at Section 03 (Privacy Policy) §§ 7 and 9.

### 5.2 Who can see what you add

What you add to [Child]'s record is visible to:

(a) **the Legal Guardian**, for the life of their Baby Bloom account;

(b) **you yourself**, for the life of your active engagement on [Child]'s record (access ends at placement-end under Section 25 § 10);

(c) **the Katie AI agent on your account, and the Katie AI agent on the Legal Guardian's account**, each acting as the AI agent of the party in question;

(d) **authorised Baby Bloom administrators** under Section 18 (Admin Access Policy), for support, abuse and safety review, audit, and incident investigation;

(e) **third-party processors named in the Privacy Policy**, each under contractual confidentiality and data-protection obligations.

What you add is **not** visible to:

(a) the public internet or search-engine crawlers;

(b) other Legal Guardians (including, where you incidentally record information about another child, that other child's Legal Guardian);

(c) other Childcare Professionals not linked to [Child];

(d) advertising networks or analytics partners;

(e) AI model training pipelines outside the image-as-context routing.

### 5.3 Visibility of historical entries after placement-end

When your engagement with [Child] ends — whether by your initiative, the Legal Guardian's initiative, or the end of a fixed-term arrangement — your access to [Child]'s record ends at the moment of placement-end. The Legal Guardian retains everything you added during the active engagement. The Legal Guardian may delete entries you added through their own deletion affordances; they are not required to. Information you added is governed by the Legal Guardian's retention preferences from the moment placement ends.

---

## 6. Retention + your removal from [Child]'s record

### 6.1 Active engagement

For as long as your engagement on [Child]'s record is active, your attestation here remains live and you retain access to [Child]'s record under the access controls at section 5.

### 6.2 Engagement-end via the in-app affordance

When you end your engagement with [Child] through the in-app **End engagement with [Child]** affordance (in your placement-management view), or when the Legal Guardian ends it through their equivalent affordance, the `nanny_placements.ended_at` field is set, and:

(a) your access to [Child]'s record ends at the moment of placement-end (section 5.3);

(b) the Legal Guardian retains [Child]'s record and all entries (including entries you added);

(c) the Legal Guardian receives a notification email: *"Your Childcare Professional [Name] has ended their engagement with [Child]"*;

(d) the engagement's prior `nanny-attestation` row for you on [Child] remains in `consent_records` as historical evidence — append-only, not overwritten; and

(e) if the engagement is to be replaced by a new Childcare Professional, the Legal Guardian initiates the link to the new Professional through the in-app **Link a new Childcare Professional** flow, which fires a fresh `nanny-attestation` event for the new Professional.

### 6.3 Engagement-end via the Section 25 § 9 single-nanny-per-parent switch

Where the Legal Guardian elects to connect a different Childcare Professional's invite while you are the active Professional on [Child]'s record, the single-nanny-per-parent invariant at Section 25 § 9 + Section 23 § 3 fires and your engagement ends atomically at the moment the new Professional's `nanny-attestation` writes. You are notified by email of the switch.

### 6.4 If you withdraw from the engagement before placement-end

You may withdraw from the engagement at any time through the in-app **End engagement** affordance. The mechanics are the same as section 6.2 above. If you are uncertain about the appropriate timing or the consequences for [Child]'s record, contact `compliance@babybloomsydney.com.au`.

---

## 7. Withdrawing this attestation

### 7.1 Three ways you can withdraw

You can withdraw this attestation at any time, in three ways:

(a) **At the invite landing.** If you arrived at this attestation via `/invite/{token}` (the Legal Guardian created [Child]'s record and invited you), you can tap **Decline** instead of **Connect**. Declining at the invite landing is treated as a refusal of the engagement — [Child]'s record stays on Baby Bloom; the Legal Guardian retains everything; no `nanny_placements` row is created; the `child_invites.status` flips to `declined`. The 30-day notice window at section 7.2 does **not** apply to decline-at-invite.

(b) **At the 12-month renewal modal.** Twelve months after you give this attestation, Baby Bloom shows you a re-confirmation modal (section 8). At the modal you can tap **Renew** (which continues your attestation for another twelve months) or **End engagement with [Child]** (which begins the unlink sequence at section 7.2 below).

(c) **At any time via the in-app End engagement affordance.** In your placement-management view, the option **End engagement with [Child]** is available at all times. Tapping it begins the unlink sequence.

### 7.2 The unlink sequence (no cascade delete)

Where you withdraw under section 7.1(b) or 7.1(c), the following happens immediately:

(a) the `nanny_placements.ended_at` field is set;

(b) your access to [Child]'s record ends at the moment the unlink is confirmed (no 30-day grace);

(c) the Legal Guardian retains [Child]'s record and all entries — including entries you added during the engagement (the Legal Guardian may delete them through their own affordances at their discretion);

(d) the Legal Guardian receives the notification email at section 6.2(c);

(e) the prior `nanny-attestation` row remains in `consent_records` as historical evidence; and

(f) **no cascade delete fires**. Unlike `parent-app-consent` withdrawal, your withdrawal does **not** trigger deletion of [Child]'s record or cancellation of the Legal Guardian's subscription. The Legal Guardian's `parent-app-consent` is unaffected.

### 7.3 Why the asymmetry between your withdrawal and the Legal Guardian's

The Legal Guardian's `parent-app-consent` is the **foundational** consent for [Child]'s presence on Baby Bloom. Without it, Baby Bloom has no lawful basis under APP 3 to process [Child]'s information; cascade deletion is required by law on withdrawal. Your attestation is **subsidiary** — it covers your engagement, not [Child]'s presence on the platform. Your withdrawal ends your access; it does not affect [Child]'s presence. The Legal Guardian may immediately link a new Childcare Professional.

### 7.4 Trust & Safety review on unusual withdrawal patterns

A withdrawal during an active engagement, or multiple withdrawals from different engagements in a short timeframe, is flagged in the Trust & Safety queue for human review. The review is operational rather than punitive — Baby Bloom looks at the pattern in case of safeguarding concerns, employment-law concerns, or platform-abuse concerns.

---

## 8. Annual re-confirmation — the 12-month cadence

Twelve months after the date you tap the attestation button (recorded in the `recorded_at` field of the `consent_records` row for this attestation), Baby Bloom asks you to re-confirm. The cadence is the same suite-wide 12-month cadence that applies to the Legal Guardian's `parent-app-consent`, implementing the Children's Online Privacy Code's maximum 12-month validity period for consent involving children's personal information.

### 8.1 The T-7-days banner

Seven days before the 12-month anniversary, an unobtrusive banner appears on your dashboard:

> *"You attested to your engagement with [Child] on [date]. We check in every twelve months — tap to renew."*

### 8.2 The renewal modal

Tapping the banner opens a modal with:

(a) the current attestation text and the proposed renewal text (highlighted if changed);

(b) a primary affordance: **Renew my engagement with [Child] for another twelve months**;

(c) a secondary affordance: **End engagement with [Child]** — which expands to the unlink consequences at section 7.2 and requires a second tap to commit.

### 8.3 If you renew

A new `consent_records` row is written under the same `agreement_id` (`NANNY-ATTESTATION`) and the same `document_id` (`nanny-attestation`), with `parent_consent_record_id` threaded back to the prior row.

### 8.4 If you end the engagement

The unlink sequence at section 7.2 fires immediately upon the second tap.

### 8.5 If you do not respond for 30 days

Forward writes to [Child]'s record from your account are gated until you decide. The renewal modal continues to surface; an escalated email is sent at +30 days; at a further +30 days, your engagement is treated as unlinked under section 7.2 (passively-ended, not deletion-triggering).

---

## 9. Consequences of a false attestation

If you tap the attestation button under section 1 and it later turns out that you did not in fact have the Legal Guardian's permission (Path A) or you have continued to use Baby Bloom after the engagement ended (any path):

### 9.1 Removal of [Child]'s record (Path A misrepresentation)

Where the Legal Guardian (or another person entitled to act for [Child]) contacts Baby Bloom to dispute your Path A attestation, the response sequence at Section 25 § 3.5 applies:

(a) **Hard-deletion of [Child]'s record** and any data attached to it (subject to the statutory carve-outs at Section 25 § 3.10.6);

(b) **Trust & Safety review** of your account;

(c) **Suspension or closure of your Childcare Professional account** under Section 02 § 7, where the review concludes that the misrepresentation was deliberate or grossly negligent;

(d) **Notification to the OAIC** under Part IIIC of the *Privacy Act 1988* (Cth) where the breach falls within the Notifiable Data Breach regime.

### 9.2 Indemnity under Professional Terms of Service § 16

Where Baby Bloom suffers loss as a direct result of a **knowingly false** attestation under section 1 (Path A), Baby Bloom may pursue an indemnity claim against you under Section 02 (Professional Terms of Service) § 16. The indemnity is capped under Section 02 § 16.1 at the lower of (i) actual loss, (ii) A$10,000, or (iii) twelve months of the Commission Baby Bloom received from your engagements. The cap is a defensive measure designed to keep the indemnity proportionate; it does not waive Baby Bloom's right to pursue uncapped relief in court for fraud or other intentional tort.

### 9.3 Photograph misrepresentation

Where you upload a photograph under section 3 attesting falsely that the Legal Guardian gave you permission to be the uploader:

(a) the photograph is hard-deleted (subject to statutory carve-outs);

(b) the §16.1 indemnity above applies; and

(c) where the upload itself contains content meeting the eSafety threshold, the relevant statutory pathway is followed.

### 9.4 Misrepresentation about the engagement's nature

Where it turns out that your engagement with [Child] is, in substance, not childcare-professional engagement (for example, you are a relative or family friend who is not paid for the engagement, or the engagement is materially different in substance from what was attested), Baby Bloom may close your Childcare Professional account and require the relationship to be regularised — either through the Legal Guardian creating [Child]'s record under their own `parent-app-consent` (no nanny linkage), or through your providing a Working With Children Check and converting to a genuine Childcare Professional engagement.

---

## 10. Governing law and dispute resolution

### 10.1 Governing law

This attestation is governed by the law of the **State of New South Wales** and the **Commonwealth of Australia**.

### 10.2 Disputes — Professional Terms of Service framework

Disputes between you and Baby Bloom concerning this attestation are handled under the dispute-resolution framework in the Professional Terms of Service (Section 02) §§ 17–18. The first-instance contact is `compliance@babybloomsydney.com.au`; escalation paths are at Section 21 (Legal & Contact) § 6.

### 10.3 Disputes between you and the Legal Guardian

Disputes between you and the Legal Guardian concerning [Child]'s information on Baby Bloom — for example, you say the Legal Guardian gave you permission and the Legal Guardian says they did not — are handled by Baby Bloom under the Section 25 § 3.5 framework. Baby Bloom's role is to apply the disclosed framework (record deletion, account suspension where misrepresentation is concluded) — the underlying relational dispute between you and the Legal Guardian is between the two of you and is outside Baby Bloom's adjudication scope.

### 10.4 Children's Online Privacy Code

From 10 December 2026, the Children's Online Privacy Code provides additional standards for the handling of children's information by Childcare Professionals operating on platforms like Baby Bloom. Baby Bloom commits to compliance from the COPC commencement date.

---

## Confirmation

By tapping **Add [Child First Name]** (on the add-child path) or **Connect to [Child First Name]** (on the invite-accept path) with the attestation box ticked above this confirmation, you confirm that:

- you have read this attestation in full or in the Quick Read summary;
- you understand what you are agreeing to;
- the attestation in section 1 is true to the best of your knowledge;
- you give this attestation freely; and
- you understand the consequences of a false attestation under section 9, including the possibility of suspension or closure of your Baby Bloom Childcare Professional account.

The attestation box is ticked by default. **Unticking it disables the button.** If you do not attest, do not tap the button: close the modal and return to the parent surface. No attestation is recorded; on the add-child path no child record is created; on the invite-accept path the invite remains pending and you can return to it later, or decline it expressly under section 7.1(a).
$body$
)
ON CONFLICT (document_id, version) DO NOTHING;

COMMIT;

-- =============================================================================
-- Post-migration verification queries (copy-paste into SQL editor; do not run
-- as part of the migration itself).
--
-- 1. Confirm both v2 rows exist:
--    SELECT document_id, version, effective_date, LEFT(body_md, 80) AS body_preview
--    FROM legal_documents
--    WHERE document_id IN ('parent-app-consent', 'nanny-attestation')
--    ORDER BY document_id, version;
--
--    Expected: 4 rows (v1 + v2 for each slug). v1 rows are placeholders;
--    v2 rows are the T-014 authored canonical bodies.
--
-- 2. Confirm no pre-existing rows were mutated:
--    SELECT document_id, version, effective_date
--    FROM legal_documents
--    ORDER BY document_id, version;
--
--    Expected: every pre-T-017 row survives unchanged. Spot-check
--    client-tos v1, professional-tos v1, privacy-policy v1, etc.
--
-- 3. Confirm the PolicyContent component picks up v2 at runtime:
--    The component reads `MAX(version) FOR document_id`. After this
--    migration:
--      - parent-app-consent: v1 + v2 exist; MAX = 2 → v2 body is rendered.
--      - nanny-attestation:  v1 + v2 exist; MAX = 2 → v2 body is rendered.
--    Historical consent_records rows pinned to v1 keep their reference.
-- =============================================================================
