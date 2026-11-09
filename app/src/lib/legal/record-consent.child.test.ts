/**
 * Per-child consent rows (the parent's app consent, the nanny's attestation) are recorded only by that child's
 * parent or nanny respectively; other agreements are recorded as before.
 *
 * BB-wave1-041126, 2026-11-09.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeAdmin, writesTo, type FakeAdmin } from "@/lib/payments/fake-admin.test-util";

let admin: FakeAdmin;
const h = vi.hoisted(() => ({ userId: "u-parent" }));

vi.mock("next/headers", () => ({ headers: () => new Map<string, string>() }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: () => ({ auth: { getUser: async () => ({ data: { user: { id: h.userId } }, error: null }) } }),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => admin.client }));

import { recordConsent, recordInformedAction } from "./record-consent";
import { renewChildConsent } from "./consent-renewal";

const CHILD_ID = "c-1";
const parentConsent = { agreementId: "PARENT-APP-CONSENT" as const, checkpointId: "cp", checkpointText: "I consent" };
const nannyAttestation = { agreementId: "NANNY-ATTESTATION" as const, checkpointId: "cp", checkpointText: "I agree" };
const consentRows = () => writesTo(admin, "consent_records");

beforeEach(() => {
  h.userId = "u-parent";
  admin = fakeAdmin({
    user_roles: { role: "parent" },
    legal_documents: [],
    child_client: { id: CHILD_ID, parent_user_id: "u-parent", nanny_user_id: "u-nanny" },
  });
});

describe("recordConsent — per-child agreements", () => {
  it("records the parent's consent for her own child", async () => {
    expect(await recordConsent([parentConsent], CHILD_ID)).toEqual({ success: true });
    expect(consentRows()[0]?.payload).toEqual([expect.objectContaining({ user_id: "u-parent", related_entity_id: CHILD_ID })]);
  });

  it("records the nanny's attestation for her own child", async () => {
    h.userId = "u-nanny";
    expect(await recordConsent([nannyAttestation], CHILD_ID)).toEqual({ success: true });
    expect(consentRows()).toHaveLength(1);
  });

  it("refuses either agreement for someone not linked to the child", async () => {
    h.userId = "u-other";
    for (const checkpoint of [parentConsent, nannyAttestation, { ...parentConsent, consentGiven: false }]) {
      expect(await recordConsent([checkpoint], CHILD_ID)).toEqual({ success: false, error: "Child not found" });
    }
    expect(consentRows()).toEqual([]);
  });

  it("refuses the agreement of the other role", async () => {
    h.userId = "u-nanny";
    expect(await recordConsent([parentConsent], CHILD_ID)).toEqual({ success: false, error: "Child not found" });
    h.userId = "u-parent";
    expect(await recordConsent([nannyAttestation], CHILD_ID)).toEqual({ success: false, error: "Child not found" });
    expect(consentRows()).toEqual([]);
  });

  it("refuses a per-child agreement with no child", async () => {
    expect(await recordConsent([parentConsent])).toEqual({ success: false, error: "Child not found" });
    expect(consentRows()).toEqual([]);
  });

  it("refuses a mixed batch whole when one checkpoint is refused", async () => {
    h.userId = "u-other";
    const tos = { agreementId: "AGR-01" as const, checkpointId: "tos", checkpointText: "Terms" };
    expect(await recordConsent([tos, parentConsent], CHILD_ID)).toEqual({ success: false, error: "Child not found" });
    expect(consentRows()).toEqual([]);
  });

  it("the informed-action path follows the same rule", async () => {
    h.userId = "u-other";
    const result = await recordInformedAction({ agreementId: "PARENT-APP-CONSENT", buttonText: "OK", modalContentVersion: "1", relatedEntityId: CHILD_ID });
    expect(result).toEqual({ success: false, error: "Child not found" });
    expect(consentRows()).toEqual([]);
  });
});

describe("recordConsent — other agreements unchanged", () => {
  it("records a terms agreement with or without a related id", async () => {
    h.userId = "u-other";
    const tos = { agreementId: "AGR-01" as const, checkpointId: "tos", checkpointText: "Terms" };
    expect(await recordConsent([tos])).toEqual({ success: true });
    expect(await recordConsent([tos], "pos-9")).toEqual({ success: true });
    expect(consentRows()).toHaveLength(2);
    expect(admin.ops.some((o) => o.table === "child_client")).toBe(false);
  });
});

describe("renewChildConsent", () => {
  it("renews for the child's parent and refuses anyone else", async () => {
    expect(await renewChildConsent({ childId: CHILD_ID, agreementId: "PARENT-APP-CONSENT" })).toEqual({ success: true, error: null });
    h.userId = "u-other";
    expect(await renewChildConsent({ childId: CHILD_ID, agreementId: "PARENT-APP-CONSENT" })).toEqual({ success: false, error: "Child not found" });
    expect(consentRows()).toHaveLength(1);
  });
});
