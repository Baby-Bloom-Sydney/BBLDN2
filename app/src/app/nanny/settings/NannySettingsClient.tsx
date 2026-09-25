"use client";

/**
 * Nanny settings — tree-driven multi-level drill-down.
 *
 * Top-level tree (2026-05-07):
 *
 *   Profile           — leaf (legal name, DOB, address)
 *   Account           — branch
 *     ▸ Contact details
 *     ▸ Verification (branch)
 *         ▸ Identity
 *         ▸ WWCC
 *     ▸ Security
 *     (small "Close account" link at the bottom)
 *   Linked children   — leaf
 *   Contact Us        — leaf
 *
 * Notes (per user feedback 2026-05-07):
 *   - "Communication preferences" is intentionally NOT shipped in
 *     v1.
 *   - Internal verification level numbers / tier names ("Level 2",
 *     "Provisionally verified") are NEVER displayed user-facing.
 *     Public-facing language is binary: "Verified" / "Action
 *     required" / "Not started".
 *   - Address edits route through the GNAF picker
 *     (AddressPickerDialog).
 *   - Mobile is REQUIRED + AU regex validated.
 *   - Email is read-only in v1.
 */

import { useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  Loader2,
  AlertTriangle,
  X,
  ExternalLink,
  User,
  Settings,
  Users,
  LifeBuoy,
  ShieldCheck,
  Wallet,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  updateNannyAccountSettings,
  deactivateNannyAccount,
} from "@/lib/actions/nanny";
import { requestPasswordChange } from "@/lib/actions/account-security";
import { ChildManagementCard } from "@/components/bapp/ChildManagementCard";
import type { ChildClient } from "@/types/bapp";
import { UpcomingPayoutsView } from "@/components/payments/UpcomingPayoutsView";
import { PayoutHistoryView } from "@/components/payments/PayoutHistoryView";
import { PayoutOnboardingPageClient } from "../payouts/onboarding/PayoutOnboardingPageClient";
import type { PayoutsDashboardData } from "@/lib/payments/queryPayoutsDashboard";
import type { PayoutHistoryRow } from "@/lib/payments/queryPayoutHistory";
import type { PayoutApplicationStatus } from "@/lib/payments/payout-application-status";
import { SettingsShell } from "@/components/settings/SettingsShell";
import { IdentityCard } from "@/components/settings/IdentityCard";
import { SettingsSubsection } from "@/components/settings/SettingsSubsection";
import { SettingsRow } from "@/components/settings/SettingsRow";
import { EditFieldDialog } from "@/components/settings/EditFieldDialog";
import { AddressPickerDialog } from "@/components/settings/AddressPickerDialog";
import { ContactSection } from "@/components/settings/ContactSection";
import {
  formatAuMobile,
  isAuMobile,
  normaliseAuMobile,
} from "@/lib/au-contact";
import type { SettingsNode } from "@/components/settings/tree";

interface Props {
  profile: {
    first_name: string;
    last_name: string;
    email: string;
    mobile_number: string;
    date_of_birth: string;
    suburb: string;
    postcode: string;
  };
  verificationLevel: number;
  wwcc: {
    number: string | null;
    status: string | null;
    expiryDate: string | null;
  } | null;
  managedChildren?: ChildClient[];
  // Pre-fetched payouts data — passed in by the server page so the
  // three Payouts leaves render inline without extra round-trips.
  payoutsDashboard: PayoutsDashboardData | null;
  payoutHistory: PayoutHistoryRow[] | null;
  payoutOnboarding: {
    status: PayoutApplicationStatus;
    email: string | null;
    bankSummary: { last4: string | null; bankName: string | null } | null;
  };
}

function publicIdentityStatus(level: number): {
  label: string;
  tone: "success" | "warning" | "neutral";
  isVerified: boolean;
} {
  if (level >= 2) {
    return { label: "Verified", tone: "success", isVerified: true };
  }
  if (level === 1) {
    return { label: "Action required", tone: "warning", isVerified: false };
  }
  return { label: "Not started", tone: "warning", isVerified: false };
}

function publicWwccStatus(status: string | null): {
  label: string;
  tone: "success" | "warning" | "danger" | "neutral";
} | null {
  if (!status) return null;
  switch (status) {
    case "doc_verified":
      return { label: "Verified", tone: "success" };
    case "pending":
    case "processing":
    case "review":
      return { label: "Pending review", tone: "warning" };
    case "not_started":
      return { label: "Not started", tone: "neutral" };
    case "rejected":
    case "failed":
      return { label: "Action required", tone: "danger" };
    case "expired":
      return { label: "Expired", tone: "danger" };
    default:
      return { label: "Pending review", tone: "warning" };
  }
}

function VerifiedPill({ verified }: { verified: boolean }) {
  if (!verified) return null;
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700">
      <ShieldCheck className="h-2.5 w-2.5" aria-hidden="true" />
      Verified
    </span>
  );
}

function formatDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function buildTree(args: {
  identityStatus: ReturnType<typeof publicIdentityStatus>;
  wwccStatus: ReturnType<typeof publicWwccStatus>;
  childCount: number;
}): SettingsNode[] {
  const { identityStatus, wwccStatus, childCount } = args;
  return [
    { id: "profile", label: "Profile", icon: User },
    {
      id: "account",
      label: "Account",
      icon: Settings,
      children: [
        { id: "contact", label: "Contact details" },
        {
          id: "verification",
          label: "Verification",
          // No status pill on the Verification entry per user
          // feedback (2026-05-07) — the user sees the verification
          // state only after they drill in. Identity / WWCC
          // sub-pages still surface their own statuses inline.
          children: [
            {
              id: "identity",
              label: "Identity",
              status: {
                label: identityStatus.label,
                tone: identityStatus.tone,
              },
            },
            {
              id: "wwcc",
              label: "WWCC",
              status: wwccStatus
                ? { label: wwccStatus.label, tone: wwccStatus.tone }
                : { label: "Not started", tone: "neutral" },
            },
          ],
        },
        { id: "security", label: "Security" },
      ],
    },
    {
      id: "linked-children",
      label: "Linked children",
      icon: Users,
      status:
        childCount > 0
          ? { label: String(childCount), tone: "neutral" }
          : undefined,
    },
    // Multi-level Contributions (Bailey 2026-05-13, relabelled
    // 2026-05-15). Settings is the canonical home for the contributions
    // surfaces — three siblings under a shared Contributions parent.
    // Standalone routes (under /nanny/payouts/) still work; the URLs
    // are intentionally unchanged (backend identifiers stay the same).
    {
      id: "contributions",
      label: "Contributions",
      icon: Wallet,
      children: [
        { id: "upcoming-contributions", label: "Upcoming Contributions" },
        { id: "contribution-history", label: "Contribution History" },
        { id: "contribution-settings", label: "Contribution Settings" },
      ],
    },
    { id: "contact-us", label: "Contact Us", icon: LifeBuoy },
    // Hidden danger leaf — reached only via the small link at the
    // bottom of Account's drill-down menu.
    { id: "close-account", label: "Close account", hidden: true, danger: true },
  ];
}

export function NannySettingsClient({
  profile,
  verificationLevel,
  wwcc,
  managedChildren = [],
  payoutsDashboard,
  payoutHistory,
  payoutOnboarding,
}: Props) {
  const params = useSearchParams();
  const activeId = params.get("s") ?? "";
  const fullName = `${profile.first_name} ${profile.last_name}`.trim();

  const identityStatus = publicIdentityStatus(verificationLevel);
  const wwccStatus = publicWwccStatus(wwcc?.status ?? null);

  const tree = buildTree({
    identityStatus,
    wwccStatus,
    childCount: managedChildren.length,
  });

  return (
    <SettingsShell
      title="Settings"
      basePath="/nanny/settings"
      tree={tree}
      activeId={activeId}
      identityCard={
        <IdentityCard
          fullName={fullName || "Your account"}
          email={profile.email}
          roleLabel="Nanny"
          verificationBadge={
            <VerifiedPill verified={identityStatus.isVerified} />
          }
        />
      }
      pageBottomLink={
        // Only surface "Close account" on the Account drill-down
        // page itself — not on every settings view. Per user spec
        // (2026-05-07): nested within Account, at the very bottom
        // of the page, separate from the rest of the menu.
        activeId === "account"
          ? { label: "Close account", targetId: "close-account" }
          : undefined
      }
      renderLeaf={(node) => {
        switch (node.id) {
          case "profile":
            return (
              <ProfileSection
                profile={profile}
                identityVerified={identityStatus.isVerified}
              />
            );
          case "contact":
            return <ContactDetailsSection profile={profile} />;
          case "identity":
            return (
              <IdentitySection
                profile={profile}
                identityStatus={identityStatus}
              />
            );
          case "wwcc":
            return <WwccSection wwcc={wwcc} wwccStatus={wwccStatus} />;
          case "security":
            return <SecuritySection />;
          case "linked-children":
            return <ChildrenSection items={managedChildren} />;
          case "upcoming-contributions":
            return (
              <UpcomingPayoutsView
                data={payoutsDashboard}
                payoutApplicationStatus={payoutOnboarding.status}
                setupHref="/nanny/settings?s=contribution-settings"
                embedded
              />
            );
          case "contribution-history":
            return <PayoutHistoryView rows={payoutHistory} embedded />;
          case "contribution-settings":
            return (
              <PayoutOnboardingPageClient
                status={payoutOnboarding.status}
                email={payoutOnboarding.email}
                bankSummary={payoutOnboarding.bankSummary}
                embedded
              />
            );
          case "contact-us":
            return <ContactSection />;
          case "close-account":
            return <CloseAccountSection fullName={fullName} />;
          default:
            return null;
        }
      }}
    />
  );
}

// ── Profile (legal name, DOB, address) ────────────────────────

function ProfileSection({
  profile,
  identityVerified,
}: {
  profile: Props["profile"];
  identityVerified: boolean;
}) {
  const router = useRouter();
  const [editingName, setEditingName] = useState(false);
  const [editingDob, setEditingDob] = useState(false);
  const [editingAddress, setEditingAddress] = useState(false);
  const [first, setFirst] = useState(profile.first_name);
  const [last, setLast] = useState(profile.last_name);
  const [dob, setDob] = useState(profile.date_of_birth);

  return (
    <div className="space-y-6">
      <SettingsSubsection header="Personal information">
        <SettingsRow
          label="Full legal name"
          value={
            `${profile.first_name} ${profile.last_name}`.trim() || undefined
          }
          locked={identityVerified}
          badge={
            identityVerified
              ? { label: "Verified", tone: "success" }
              : undefined
          }
          onClick={
            identityVerified
              ? undefined
              : () => {
                  setFirst(profile.first_name);
                  setLast(profile.last_name);
                  setEditingName(true);
                }
          }
        />
        <SettingsRow
          label="Date of birth"
          value={
            profile.date_of_birth
              ? formatDate(profile.date_of_birth)
              : undefined
          }
          locked={identityVerified}
          badge={
            identityVerified
              ? { label: "Verified", tone: "success" }
              : undefined
          }
          isLast
          onClick={
            identityVerified
              ? undefined
              : () => {
                  setDob(profile.date_of_birth);
                  setEditingDob(true);
                }
          }
        />
      </SettingsSubsection>

      <SettingsSubsection header="Address">
        <SettingsRow
          label="Suburb"
          value={profile.suburb}
          onClick={() => setEditingAddress(true)}
        />
        <SettingsRow
          label="Postcode"
          value={profile.postcode}
          isLast
          onClick={() => setEditingAddress(true)}
        />
      </SettingsSubsection>

      <EditFieldDialog
        open={editingName}
        onOpenChange={setEditingName}
        title="Edit your full name"
        canSubmit={first.trim().length > 0 && last.trim().length > 0}
        onSubmit={async () => {
          const r = await updateNannyAccountSettings({
            first_name: first.trim(),
            last_name: last.trim(),
          });
          if (r.success) {
            router.refresh();
            return { success: true };
          }
          return { success: false, error: r.error };
        }}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="edit-first">First name</Label>
            <Input
              id="edit-first"
              value={first}
              onChange={(e) => setFirst(e.target.value)}
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="edit-last">Last name</Label>
            <Input
              id="edit-last"
              value={last}
              onChange={(e) => setLast(e.target.value)}
            />
          </div>
        </div>
      </EditFieldDialog>

      <EditFieldDialog
        open={editingDob}
        onOpenChange={setEditingDob}
        title="Edit your date of birth"
        canSubmit={dob.length > 0}
        onSubmit={async () => {
          const r = await updateNannyAccountSettings({
            date_of_birth: dob || null,
          });
          if (r.success) {
            router.refresh();
            return { success: true };
          }
          return { success: false, error: r.error };
        }}
      >
        <div className="space-y-1.5">
          <Label htmlFor="edit-dob">Date of birth</Label>
          <Input
            id="edit-dob"
            type="date"
            value={dob}
            onChange={(e) => setDob(e.target.value)}
            autoFocus
          />
        </div>
      </EditFieldDialog>

      <AddressPickerDialog
        open={editingAddress}
        onOpenChange={setEditingAddress}
        currentSuburb={profile.suburb}
        currentPostcode={profile.postcode}
        onSubmit={async (address) => {
          const r = await updateNannyAccountSettings({
            suburb: address.suburb,
            postcode: address.postcode,
          });
          if (r.success) {
            router.refresh();
            return { success: true };
          }
          return { success: false, error: r.error };
        }}
      />
    </div>
  );
}

// ── Contact details ────────────────────────────────────────────

function ContactDetailsSection({ profile }: { profile: Props["profile"] }) {
  const router = useRouter();
  const [editingMobile, setEditingMobile] = useState(false);
  const [mobile, setMobile] = useState(profile.mobile_number);

  const trimmed = mobile.trim();
  const mobileValid = trimmed.length > 0 && isAuMobile(trimmed);

  // Email change disabled in v1 — see ParentSettingsClient comment.

  return (
    <div className="space-y-6">
      <SettingsSubsection header="Email">
        <SettingsRow
          label="Email address"
          value={profile.email}
          badge={
            profile.email ? { label: "Verified", tone: "success" } : undefined
          }
          isLast
        />
      </SettingsSubsection>

      <SettingsSubsection header="Phone">
        <SettingsRow
          label="Mobile number"
          value={
            profile.mobile_number
              ? formatAuMobile(profile.mobile_number)
              : undefined
          }
          isLast
          onClick={() => {
            setMobile(profile.mobile_number);
            setEditingMobile(true);
          }}
        />
      </SettingsSubsection>

      <EditFieldDialog
        open={editingMobile}
        onOpenChange={setEditingMobile}
        title="Edit mobile number"
        canSubmit={mobileValid}
        onSubmit={async () => {
          if (!mobileValid) {
            return {
              success: false,
              error: "Enter a valid Australian mobile number.",
            };
          }
          const r = await updateNannyAccountSettings({
            mobile_number: normaliseAuMobile(mobile),
          });
          if (r.success) {
            router.refresh();
            return { success: true };
          }
          return { success: false, error: r.error };
        }}
      >
        <div className="space-y-1.5">
          <Label htmlFor="edit-mobile">Mobile number</Label>
          <Input
            id="edit-mobile"
            type="tel"
            value={mobile}
            onChange={(e) => setMobile(e.target.value)}
            placeholder="04XX XXX XXX"
            autoFocus
            inputMode="tel"
          />
          {trimmed.length > 0 && !mobileValid && (
            <p className="text-xs text-rose-600">
              That doesn&apos;t look like an Australian mobile number. Format:
              04XX XXX XXX.
            </p>
          )}
          {mobileValid && (
            <p className="text-xs text-emerald-600">{formatAuMobile(mobile)}</p>
          )}
          <p className="text-[11px] text-slate-400">
            Required — parents and Baby Bloom rely on this for account-critical
            updates.
          </p>
        </div>
      </EditFieldDialog>
    </div>
  );
}

// ── Verification: Identity ────────────────────────────────────

function IdentitySection({
  profile,
  identityStatus,
}: {
  profile: Props["profile"];
  identityStatus: ReturnType<typeof publicIdentityStatus>;
}) {
  const verified = identityStatus.isVerified;
  return (
    <div className="space-y-6">
      <SettingsSubsection header="Identity status">
        <SettingsRow
          label="Status"
          display={
            <span
              className={
                "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium " +
                (identityStatus.tone === "success"
                  ? "bg-emerald-50 text-emerald-700"
                  : identityStatus.tone === "warning"
                    ? "bg-amber-50 text-amber-700"
                    : "bg-slate-100 text-slate-700")
              }
            >
              {identityStatus.label}
            </span>
          }
          isLast
        />
      </SettingsSubsection>

      <SettingsSubsection header="Confirmed details">
        <SettingsRow
          label="Full legal name"
          value={
            `${profile.first_name} ${profile.last_name}`.trim() || undefined
          }
          locked={verified}
          badge={verified ? { label: "Verified", tone: "success" } : undefined}
        />
        <SettingsRow
          label="Date of birth"
          value={
            profile.date_of_birth
              ? formatDate(profile.date_of_birth)
              : undefined
          }
          locked={verified}
          badge={verified ? { label: "Verified", tone: "success" } : undefined}
          isLast
        />
      </SettingsSubsection>

      {!verified && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
          <p className="text-sm font-medium text-amber-900">
            Identity not yet confirmed
          </p>
          <p className="mt-1 text-xs text-amber-800">
            Submit your government-issued ID to access the full platform.
          </p>
          <Link
            href="/nanny/onboarding-verification"
            className="mt-3 inline-block"
          >
            <Button variant="outline" size="sm" className="gap-1.5">
              Submit ID <ExternalLink className="h-3.5 w-3.5" />
            </Button>
          </Link>
        </div>
      )}
    </div>
  );
}

// ── Verification: WWCC ───────────────────────────────────────

function WwccSection({
  wwcc,
  wwccStatus,
}: {
  wwcc: Props["wwcc"];
  wwccStatus: ReturnType<typeof publicWwccStatus>;
}) {
  if (!wwcc || !wwcc.number) {
    return (
      <SettingsSubsection header="Working With Children Check">
        <div className="px-4 py-6 text-center">
          <p className="text-sm font-medium text-slate-700">
            Not yet submitted
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Submit your WWCC to start receiving match requests.
          </p>
          <Link href="/nanny/verification" className="mt-3 inline-block">
            <Button variant="outline" size="sm" className="gap-1.5">
              Submit WWCC <ExternalLink className="h-3.5 w-3.5" />
            </Button>
          </Link>
        </div>
      </SettingsSubsection>
    );
  }

  return (
    <SettingsSubsection
      header="Working With Children Check"
      footnote={
        <>
          Need to update your WWCC?{" "}
          <Link
            href="/nanny/verification"
            className="text-violet-600 hover:underline"
          >
            Submit a new check
          </Link>
        </>
      }
    >
      <SettingsRow
        label="WWCC number"
        value={wwcc.number}
        mono
        locked
        badge={
          wwccStatus
            ? { label: wwccStatus.label, tone: wwccStatus.tone }
            : undefined
        }
      />
      <SettingsRow
        label="Expiry date"
        value={wwcc.expiryDate ? formatDate(wwcc.expiryDate) : undefined}
        isLast
      />
    </SettingsSubsection>
  );
}

// ── Security ─────────────────────────────────────────────────

function SecuritySection() {
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleClick() {
    setError(null);
    startTransition(async () => {
      const r = await requestPasswordChange();
      if (!r.success) {
        setError(r.error ?? "Couldn't send the password reset email.");
        return;
      }
      setSent(true);
    });
  }

  return (
    <SettingsSubsection header="Password">
      {sent ? (
        <div className="px-4 py-5 text-sm">
          <p className="font-medium text-emerald-700">
            Password reset email sent
          </p>
          <p className="mt-1 text-slate-600">
            Check your inbox for a link to set a new password. The link expires
            after one hour.
          </p>
        </div>
      ) : (
        <div className="px-4 py-5 text-sm">
          {error && (
            <p className="mb-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
              {error}
            </p>
          )}
          <p className="text-slate-600">
            Send a password reset link to your registered email.
          </p>
          <Button
            type="button"
            onClick={handleClick}
            disabled={isPending}
            className="mt-4 bg-violet-600 text-white hover:bg-violet-700"
          >
            {isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Sending…
              </>
            ) : (
              "Send password reset email"
            )}
          </Button>
        </div>
      )}
    </SettingsSubsection>
  );
}

// ── Linked children ───────────────────────────────────────────

function ChildrenSection({ items }: { items: ChildClient[] }) {
  if (items.length === 0) {
    return (
      <SettingsSubsection header="Linked children">
        <div className="px-4 py-6 text-center text-sm text-slate-500">
          No linked children yet.
        </div>
      </SettingsSubsection>
    );
  }
  return (
    <SettingsSubsection header="Linked children">
      <div className="px-4 py-4">
        <ChildManagementCard items={items} role="nanny" />
      </div>
    </SettingsSubsection>
  );
}

// ── Payouts (link to dashboard) ──────────────────────────────
//
// Per UX-FIX-PLAN FIX-4 + FRONTEND/03-build-spec.md line 1114:
// /nanny/payouts is the loss-aversion engine. Surfacing the entry
// point in the settings tree is the spec-mandated way to reach it
// (the dashboard remains a full page at /nanny/payouts, not embedded
// here — this leaf is a link). Copy follows Section 9 of
// system/APP/PAYMENTS/COPY-AND-FRAMING.md (earnings-as-endowment
// framing, not "subscription billing").

function PayoutsLinkSection() {
  return (
    <SettingsSubsection header="Payouts">
      <div className="space-y-3 px-4 py-4">
        <p className="text-sm text-slate-700">
          Your earnings, payout history, and Stripe Connect setup all live on
          your Payouts dashboard.
        </p>
        <Button asChild size="sm" className="bg-violet-600 hover:bg-violet-700">
          <Link href="/nanny/payouts">Open Payouts dashboard</Link>
        </Button>
      </div>
    </SettingsSubsection>
  );
}

// ── Close account (danger leaf) ──────────────────────────────

function CloseAccountSection({ fullName }: { fullName: string }) {
  const router = useRouter();
  const [showModal, setShowModal] = useState(false);
  const [confirmName, setConfirmName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const nameMatches = confirmName.toLowerCase() === fullName.toLowerCase();

  const handleDeactivate = () => {
    setError(null);
    startTransition(async () => {
      const r = await deactivateNannyAccount();
      if (r.success) {
        router.push("/login");
      } else {
        setError(r.error);
      }
    });
  };

  return (
    <>
      <div className="overflow-hidden rounded-xl border border-rose-200 bg-rose-50/40 p-5">
        <div className="flex items-start gap-3">
          <AlertTriangle
            className="mt-0.5 h-5 w-5 shrink-0 text-rose-600"
            aria-hidden="true"
          />
          <div className="flex-1">
            <p className="text-sm font-semibold text-rose-900">
              Closing your account is permanent
            </p>
            <p className="mt-1 text-sm text-rose-700">
              This deactivates your account and hides your profile from all
              families. You will be signed out and will need to contact support
              to reactivate.
            </p>
            <Button
              variant="outline"
              onClick={() => setShowModal(true)}
              className="mt-4 border-rose-300 text-rose-700 hover:bg-rose-100 hover:text-rose-800"
            >
              Close my account
            </Button>
          </div>
        </div>
      </div>

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-2xl">
            <div className="mb-4 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-rose-500" />
                <h3 className="text-lg font-semibold text-slate-900">
                  Close your account
                </h3>
              </div>
              <button
                onClick={() => {
                  setShowModal(false);
                  setConfirmName("");
                  setError(null);
                }}
                className="text-slate-400 hover:text-slate-600"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            {error && (
              <p className="mb-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
                {error}
              </p>
            )}
            <p className="mb-4 text-sm text-slate-600">
              This is permanent. You&apos;ll lose access immediately and need to
              contact support to reactivate.
            </p>
            <div className="mb-2">
              <p className="mb-1 text-xs text-slate-500">
                Type{" "}
                <span className="font-semibold text-slate-700">{fullName}</span>{" "}
                to confirm
              </p>
              <Input
                value={confirmName}
                onChange={(e) => setConfirmName(e.target.value)}
                placeholder="Your full name"
                autoFocus
              />
            </div>
            <div className="mt-4 flex gap-3">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => {
                  setShowModal(false);
                  setConfirmName("");
                }}
                disabled={isPending}
              >
                Cancel
              </Button>
              <Button
                className="flex-1 bg-rose-600 text-white hover:bg-rose-700"
                disabled={!nameMatches || isPending}
                onClick={handleDeactivate}
              >
                {isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Closing…
                  </>
                ) : (
                  "Confirm & close"
                )}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
