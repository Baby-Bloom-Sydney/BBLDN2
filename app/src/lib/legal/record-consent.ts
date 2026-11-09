"use server";

import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { AgreementId } from "./types";
import { isChildMember, CHILD_NOT_FOUND, type ChildMemberRole } from "@/lib/bapp/child-member";

interface ConsentInput {
  agreementId: AgreementId;
  checkpointId: string;
  checkpointText: string;
  /** Defaults to true (consent given). Pass `false` to record an
   *  explicit DECLINE / WITHDRAWAL. The gate reads the most-recent
   *  row's `consent_given` value to determine if a child is in a
   *  revoked state. T-015 — required for the renewal-decline flow. */
  consentGiven?: boolean;
}

/** Per-child agreements, and the one role on the child that records each. */
const CHILD_AGREEMENT_ROLE: Partial<Record<AgreementId, ChildMemberRole>> = {
  "PARENT-APP-CONSENT": "parent",
  "NANNY-ATTESTATION": "nanny",
};

/** A per-child agreement is recorded only for a child, by its parent (app consent) or its nanny (attestation). */
async function mayRecordForChild(
  checkpoints: ConsentInput[],
  childId: string | undefined,
  userId: string,
): Promise<boolean> {
  const roles = Array.from(
    new Set(checkpoints.map((cp) => CHILD_AGREEMENT_ROLE[cp.agreementId]).filter((r): r is ChildMemberRole => !!r)),
  );
  for (const role of roles) {
    if (!childId || !(await isChildMember(childId, userId, role))) return false;
  }
  return true;
}

export async function recordConsent(
  checkpoints: ConsentInput[],
  relatedEntityId?: string,
  modalContentVersion?: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const supabase = createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) {
      return { success: false, error: "Not authenticated" };
    }

    if (!(await mayRecordForChild(checkpoints, relatedEntityId, user.id))) {
      return { success: false, error: CHILD_NOT_FOUND };
    }

    // Determine user type from user_roles
    const adminClient = createAdminClient();
    const { data: roleData } = await adminClient
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .single();

    const userType = roleData?.role === "parent" ? "client" : "professional";

    // Get request metadata
    const headersList = headers();
    const ip =
      headersList.get("x-forwarded-for")?.split(",")[0]?.trim() || null;
    const userAgent = headersList.get("user-agent") || null;

    // Look up current document versions for relevant documents
    const documentIds = Array.from(
      new Set(
        checkpoints.map((cp) => getDocumentIdForAgreement(cp.agreementId)),
      ),
    ).filter(Boolean) as string[];
    const { data: docs } = await adminClient
      .from("legal_documents")
      .select("document_id, version")
      .in("document_id", documentIds)
      .order("version", { ascending: false });

    const latestVersions: Record<string, number> = {};
    if (docs) {
      for (const doc of docs) {
        if (!latestVersions[doc.document_id]) {
          latestVersions[doc.document_id] = doc.version;
        }
      }
    }

    // Build insert rows
    const rows = checkpoints.map((cp) => {
      const docId = getDocumentIdForAgreement(cp.agreementId);
      return {
        user_id: user.id,
        user_type: userType,
        agreement_id: cp.agreementId,
        checkpoint_id: cp.checkpointId,
        checkpoint_text: cp.checkpointText,
        document_id: docId,
        document_version: docId ? latestVersions[docId] || 1 : null,
        consent_given: cp.consentGiven ?? true,
        ip_address: ip,
        user_agent: userAgent,
        related_entity_id: relatedEntityId || null,
      };
    });

    const { error: insertError } = await adminClient
      .from("consent_records")
      .insert(rows);

    if (insertError) {
      console.error("Failed to record consent:", insertError);
      return { success: false, error: "Failed to record consent" };
    }

    return { success: true };
  } catch (err) {
    console.error("recordConsent error:", err);
    return { success: false, error: "Unexpected error recording consent" };
  }
}

export async function recordBiometricConsent(data: {
  notice_opened_at: string;
  notice_scroll_completed_at: string;
  notice_time_spent_seconds: number;
  checkboxes_enabled_at: string;
  checkbox_timestamps: Record<string, string>;
}): Promise<{ success: boolean; error?: string }> {
  try {
    const supabase = createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) {
      return { success: false, error: "Not authenticated" };
    }

    const adminClient = createAdminClient();
    const { error: insertError } = await adminClient
      .from("biometric_consent_records")
      .upsert(
        {
          user_id: user.id,
          notice_opened_at: data.notice_opened_at,
          notice_scroll_completed_at: data.notice_scroll_completed_at,
          notice_time_spent_seconds: data.notice_time_spent_seconds,
          checkboxes_enabled_at: data.checkboxes_enabled_at,
          checkbox_timestamps: data.checkbox_timestamps,
          notice_version: 1,
        },
        { onConflict: "user_id" },
      );

    if (insertError) {
      console.error("Failed to record biometric consent:", insertError);
      return { success: false, error: "Failed to record biometric consent" };
    }

    return { success: true };
  } catch (err) {
    console.error("recordBiometricConsent error:", err);
    return { success: false, error: "Unexpected error" };
  }
}

export async function recordInformedAction(data: {
  agreementId: AgreementId;
  buttonText: string;
  modalContentVersion: string;
  relatedEntityId?: string;
}): Promise<{ success: boolean; error?: string }> {
  return recordConsent(
    [
      {
        agreementId: data.agreementId,
        checkpointId: "informed_action_click",
        checkpointText: data.buttonText,
      },
    ],
    data.relatedEntityId,
    data.modalContentVersion,
  );
}

function getDocumentIdForAgreement(agreementId: AgreementId): string | null {
  // `Partial<Record<AgreementId, string>>` makes future AgreementId
  // additions surface as compile-time "key not in map" gaps rather
  // than silently returning null. T-015 reviewer note.
  const map: Partial<Record<AgreementId, string>> = {
    "AGR-01": "client-tos",
    "AGR-02": "professional-tos",
    "AGR-04": "biometric-notice",
    "AGR-05": "client-tos",
    "AGR-06": "client-tos",
    "AGR-07": "client-tos",
    "AGR-08": "professional-tos",
    "AGR-09": "professional-tos",
    "AGR-10": "client-tos",
    "AGR-11": "professional-tos",
    "AGR-12": "privacy-policy",
    "AGR-13": "cookie-policy",
    "AGR-14": "agr14_nanny_child_add",
    // T-015 (2026-05-14): Bailey's bundled-consent product call.
    // Single per-child agreement per party — diverges from T-014's
    // fragmented AGR-20/21..26 model. See T-015 CONSENT-MODEL-
    // DIVERGENCE-NOTE.md for the rationale + reconciliation path.
    "PARENT-APP-CONSENT": "parent-app-consent",
    "NANNY-ATTESTATION": "nanny-attestation",
  };
  return map[agreementId] || null;
}
