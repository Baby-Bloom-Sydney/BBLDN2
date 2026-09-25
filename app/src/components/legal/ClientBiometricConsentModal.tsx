'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { LEGAL_ENTITY, SENDERS } from "@/lib/constants";

interface ClientBiometricConsentModalProps {
  open: boolean;
  onComplete: (data: {
    notice_opened_at: string;
    notice_scroll_completed_at: string;
    notice_time_spent_seconds: number;
    checkboxes_enabled_at: string;
  }) => void;
}

export function ClientBiometricConsentModal({ open, onComplete }: ClientBiometricConsentModalProps) {
  const [scrollPercent, setScrollPercent] = useState(0);
  const [scrollCompleted, setScrollCompleted] = useState(false);
  const [openedAt] = useState(() => new Date().toISOString());
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);

  const handleScroll = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const percent = Math.round((el.scrollTop / (el.scrollHeight - el.clientHeight)) * 100);
    setScrollPercent(Math.min(percent, 100));
  }, []);

  useEffect(() => {
    if (!open || !sentinelRef.current) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setScrollCompleted(true);
        }
      },
      { threshold: 0.5 }
    );
    observer.observe(sentinelRef.current);
    return () => observer.disconnect();
  }, [open]);

  const handleAcknowledge = () => {
    const now = new Date().toISOString();
    const timeSpent = Math.round((Date.now() - new Date(openedAt).getTime()) / 1000);
    onComplete({
      notice_opened_at: openedAt,
      notice_scroll_completed_at: now,
      notice_time_spent_seconds: timeSpent,
      checkboxes_enabled_at: now,
    });
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 bg-white flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
        <h2 className="text-lg font-bold text-slate-900">Biometric Data Collection Notice (Client)</h2>
        <div className="flex items-center gap-3">
          <span className="text-xs text-slate-400">{scrollPercent}% read</span>
          <div className="w-20 h-1.5 bg-slate-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-violet-500 rounded-full transition-all duration-300"
              style={{ width: `${scrollPercent}%` }}
            />
          </div>
        </div>
      </div>

      {/* Scrollable content */}
      <div
        ref={scrollContainerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto px-6 py-6"
      >
        <div className="max-w-3xl mx-auto prose prose-slate prose-sm">
          <p className="text-sm text-slate-500 mb-6">
            Version 1.0 | Last updated: 23 March 2026
          </p>

          <h3>How We Verify Your Identity</h3>
          <p>Before you can be connected with Childcare Professionals on Baby Bloom, we need to verify that you are who you say you are. This notice explains how we use your biometric data during the verification process.</p>
          <p><strong>Please read this notice carefully before consenting.</strong></p>

          <h3>What Data We Collect</h3>
          <p>During the verification process, we collect:</p>
          <ul>
            <li><strong>Facial geometry:</strong> We extract measurements of your facial features from the selfie photograph you take during verification.</li>
            <li><strong>ID document data:</strong> We extract information from your uploaded passport or government-issued ID (name, photo, document number, expiry date).</li>
          </ul>

          <h3>What We Compare</h3>
          <p>Your selfie photograph is compared against the photograph on your identity document using AI facial recognition technology. This confirms that the person creating the account is the same person shown on the ID document.</p>
          <p>We also verify that your registered address is a valid address within New South Wales, Australia.</p>

          <h3>Overseas Processing and Your Risks</h3>
          <p><strong>OpenAI (United States):</strong> Your biometric data (facial geometry and identity document images) is transmitted to and processed by OpenAI&apos;s servers located in the United States (specifically, AWS US-East region).</p>

          <p><strong>Data Agreement:</strong> Baby Bloom has executed a Data Processing Agreement with OpenAI that requires:</p>
          <ul>
            <li>OpenAI to process your biometric data only as instructed by Baby Bloom.</li>
            <li>OpenAI to implement security measures to protect your data.</li>
            <li>OpenAI to not share your biometric data with third parties without Baby Bloom&apos;s consent.</li>
            <li>OpenAI to delete your data upon Baby Bloom&apos;s instruction.</li>
          </ul>

          <p><strong>US Government Access:</strong> Because your biometric data is processed in the United States:</p>
          <ul>
            <li>US law enforcement may access your data under court order or warrant.</li>
            <li>US intelligence agencies may access your data under FISA (Foreign Intelligence Surveillance Act) Section 702, which allows bulk surveillance of non-US persons&apos; international communications. Unlike Australian law, FISA does not require a warrant or showing of probable cause for foreign persons.</li>
            <li>Baby Bloom has <strong>no ability to prevent or disclose such access</strong> to you &mdash; US law prohibits companies from disclosing FISA requests.</li>
            <li>The US does not provide the same legal protections as Australian privacy law. Australian Privacy Principles do not apply to US government access.</li>
            <li><strong>You have limited recourse</strong> if your data is accessed by US authorities.</li>
          </ul>

          <p><strong>Your Choice:</strong> You must consent to overseas processing to use Baby Bloom&apos;s connection features. If you do not consent, you cannot be connected with Childcare Professionals through Baby Bloom.</p>

          <p><strong>Data Retention at OpenAI:</strong> Your biometric data is retained by OpenAI for 7 days after Baby Bloom receives the verification result, then deleted from OpenAI&apos;s systems.</p>

          <p><strong>Potential Changes to AI Provider:</strong> If Baby Bloom changes the AI provider used for facial verification, Baby Bloom will notify all users via email, provide a new notice, and require affirmative consent within 30 days. If you do not consent, your connection features will be suspended and your account may be closed with pro-rata refund.</p>

          <h3>How AI and Human Review Work Together</h3>
          <p><strong>AI Facial Matching:</strong> Baby Bloom uses OpenAI facial recognition (GPT-4o or similar) to compare your selfie against your ID photo. The AI produces a &ldquo;match score&rdquo; (0&ndash;100%, indicating confidence that the selfie matches the ID photo).</p>

          <p><strong>Flagging Threshold:</strong> Cases with a match score <strong>below 85%</strong> are flagged for human review.</p>

          <p><strong>Human Review:</strong> A Baby Bloom staff member reviews flagged cases manually. The human reviewer:</p>
          <ul>
            <li>Compares your selfie and ID photo themselves.</li>
            <li>Considers factors the AI may have missed (lighting, angle, facial hair, age, etc.).</li>
            <li>Makes the final <strong>VERIFICATION DECISION</strong> (approved or rejected).</li>
            <li>Is not bound by the AI&apos;s match score; human judgment overrides AI.</li>
          </ul>

          <p><strong>Access to Your Records:</strong> You can request a copy of your verification audit trail at any time by contacting {SENDERS.compliance}. Baby Bloom will respond within 10 business days.</p>

          <p><strong>Appeal Process:</strong> If your verification is rejected, you can contact Baby Bloom within 14 days to request a detailed explanation, a manual review by a different staff member, or a copy of your AI match score. Baby Bloom will respond within 7 business days.</p>

          <h3>How Long We Keep Your Identity Verification Data</h3>
          <table>
            <thead>
              <tr><th>Data Type</th><th>Retention Period</th></tr>
            </thead>
            <tbody>
              <tr><td>Selfie photograph &amp; facial geometry</td><td>Life of account + deleted 90 days after closure</td></tr>
              <tr><td>Identity document photo</td><td>Life of account + deleted 90 days after closure</td></tr>
              <tr><td>Verification result (doc type, last 4 digits, outcome, date, match score)</td><td>Retained permanently in de-identified form</td></tr>
            </tbody>
          </table>

          <p><strong>Purpose of permanent retention:</strong> Fraud prevention, regulatory compliance, system improvement, and dispute resolution.</p>

          <h3>Your Rights and Consequences of Withdrawing Biometric Consent</h3>
          <p>You have the right to:</p>
          <ul>
            <li><strong>Access</strong> your biometric data at any time.</li>
            <li><strong>Delete</strong> your biometric data (request deletion; may need to re-verify to continue).</li>
            <li><strong>Withdraw consent</strong> for biometric data processing at any time.</li>
          </ul>
          <p>However, withdrawing consent means:</p>
          <ul>
            <li>Your connection features will be suspended (no new connections).</li>
            <li>Active care arrangements are NOT affected.</li>
            <li>Your account can be reactivated by re-consenting and re-verifying.</li>
            <li>Your biometric data is deleted immediately upon withdrawal.</li>
          </ul>
          <p>To exercise any of these rights, contact {SENDERS.compliance}. Baby Bloom will respond within 30 days.</p>

          <h3>What If Your Verification Is Rejected?</h3>
          <ul>
            <li>Request a detailed explanation within 7 days.</li>
            <li>Request re-verification at any time (free, up to 3 times).</li>
            <li>Request manual escalation &mdash; contact {SENDERS.compliance}.</li>
            <li>Lodge a complaint with the OAIC at www.oaic.gov.au.</li>
          </ul>

          <h3>Security of Your Biometric Data</h3>
          <p><strong>In Transit:</strong> Encrypted using TLS 1.2+.<br />
          <strong>At Rest:</strong> Encrypted using AES-256.<br />
          <strong>Access Controls:</strong> Only authorised Baby Bloom staff can access your biometric data. Access is logged and audited.<br />
          <strong>Incident Response:</strong> Affected users notified within 30 days of any breach.</p>

          <h3>Legal Basis for Biometric Verification</h3>
          <p>Baby Bloom collects your biometric data under Australian Privacy Principle (APP) 3.3 with your express consent. Biometric data is classified as &ldquo;sensitive information&rdquo; under the Privacy Act 1988 (Cth). This is not optional &mdash; if you do not consent, you cannot use Baby Bloom&apos;s connection features.</p>

          <h3>Liveness Detection and Spoofing Prevention</h3>
          <p>Your selfie must be taken in real-time using your device&apos;s camera during verification. You cannot use a stored photo. Liveness detection prevents the use of printed photos, deepfakes, or pre-recorded video.</p>

          <h3>What Is Facial Geometry?</h3>
          <p>&ldquo;Facial geometry&rdquo; is a mathematical representation of your face &mdash; specifically, the measurements of key facial features (distance between eyes, nose shape, jawline, etc.). It is NOT a photograph. It is a set of numbers and measurements.</p>

          <h3>Complaints About Your Privacy Rights</h3>
          <p>If you believe Baby Bloom has breached the Australian Privacy Principles, lodge a complaint with:</p>
          <p><strong>Office of the Australian Information Commissioner (OAIC)</strong><br />
          Website: www.oaic.gov.au | Phone: 1300 363 992</p>

          <hr />
          <p className="text-xs text-slate-400">
            {LEGAL_ENTITY}<br />
            Compliance: {SENDERS.compliance}
          </p>

          {/* Sentinel for scroll detection */}
          <div ref={sentinelRef} className="h-1" />
        </div>
      </div>

      {/* Footer */}
      <div className="border-t border-slate-200 px-6 py-4 bg-white">
        <div className="max-w-3xl mx-auto">
          {scrollCompleted ? (
            <Button
              onClick={handleAcknowledge}
              className="w-full bg-violet-600 hover:bg-violet-700 text-white h-11"
            >
              I have read this notice
            </Button>
          ) : (
            <p className="text-center text-sm text-slate-400">
              Please scroll through the entire notice to continue
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
