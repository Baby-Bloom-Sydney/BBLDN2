export type AgreementId =
  | "AGR-01" // Client Registration
  | "AGR-02" // Professional Registration
  | "AGR-04" // Professional Verification
  | "AGR-05" // Client Job Posting
  | "AGR-06" // Client Matchmaking Connection
  | "AGR-07" // Client Babysitting Connection
  | "AGR-08" // Professional Matchmaking Connection
  | "AGR-09" // Professional Babysitting Connection
  | "AGR-10" // Client Hire Confirmation
  | "AGR-11" // Professional Hire Confirmation
  | "AGR-12" // Professional Facebook Sharing
  | "AGR-13" // Website Visitor (Cookie)
  | "AGR-14" // Nanny child-add — legal guardian permission (invite linking)
  | "PARENT-APP-CONSENT" // Bundled per-child parent consent (Bailey 2026-05-14 — covers app use + photos + sensitive info; 12-month renewable). Diverges from T-014's AGR-20 fragmentation — see T-015 CONSENT-MODEL-DIVERGENCE-NOTE.md.
  | "NANNY-ATTESTATION"; // Bundled per-child nanny attestation (Bailey 2026-05-14 — covers professional ToS for that engagement; 12-month renewable).

export interface CheckpointConfig {
  id: string;
  text: string;
  links?: { label: string; href: string }[];
}

export interface ConsentCheckpoint {
  agreementId: AgreementId;
  checkpointId: string;
  checkpointText: string;
}

export interface ConsentRecord {
  id: string;
  user_id: string;
  user_type: "client" | "professional";
  agreement_id: AgreementId;
  checkpoint_id: string;
  checkpoint_text: string;
  document_id: string | null;
  document_version: number | null;
  consent_given: boolean;
  ip_address: string | null;
  user_agent: string | null;
  session_id: string | null;
  related_entity_id: string | null;
  created_at: string;
}

export interface ConsentModalConfig {
  title: string;
  subtitle?: string;
  checkpoints: CheckpointConfig[];
  buttonText: string;
  agreementId: AgreementId;
  /** Reminder bullet points displayed as readable text (not checkboxes) */
  reminderTitle?: string;
  reminderItems?: string[];
  reminderFooter?: string;
  /** Disclosure text shown above the action button (for informed action modals with no checkboxes) */
  disclosureText?: string;
  /** "What happens next" text shown below the action button */
  footerText?: string;
  /** Version identifier for the modal content displayed */
  modalContentVersion?: string;
}

export interface BiometricConsentData {
  notice_opened_at: string;
  notice_scroll_completed_at: string;
  notice_time_spent_seconds: number;
  checkboxes_enabled_at: string;
  checkbox_timestamps: Record<string, string>;
}

export interface CookiePreferences {
  consent_choice: "accept_all" | "reject_non_essential" | "custom";
  analytics_enabled: boolean;
  marketing_enabled: boolean;
}
