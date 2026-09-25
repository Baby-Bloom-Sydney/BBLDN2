"use client";

import { Suspense, useState, useEffect } from "react";
import { ShowcaseErrorBoundary } from "../../ErrorBoundary";

// ── Mock data ──
import {
  FALLBACK_NANNY,
  FALLBACK_NANNY_2,
  FALLBACK_NANNY_3,
} from "../../mock-data";
import {
  MOCK_INTERVIEW_REQUESTS,
  MOCK_NANNY_BABYSITTING_JOBS,
  MOCK_INBOX_MESSAGES,
  MOCK_CONNECTION_REQUESTS,
  MOCK_VERIFICATION_DATA,
  MOCK_NANNY_SHARE_DATA,
  MOCK_NANNY_PLACEMENTS,
  MOCK_NANNY_UPCOMING_INTROS,
  MOCK_POSITION_WITH_CHILDREN,
  MOCK_POSITION_SHARE_DATA,
  MOCK_PARENT_BSR_REQUESTS,
  MOCK_DISTRICTS,
  MOCK_BSR_PROFILE,
  MOCK_BSR_SHARE_DATA,
  MOCK_PARENT_VERIFICATION_DATA,
  MOCK_ADMIN_USERS,
  MOCK_ADMIN_USER_STATS,
  MOCK_ADMIN_VERIFICATION_STATS,
  MOCK_ADMIN_IDENTITY_CHECKS,
  MOCK_ADMIN_WWCC_CHECKS,
  MOCK_ADMIN_PARENT_VERIFICATION_STATS,
  MOCK_ADMIN_PARENT_CHECKS,
} from "../../page-client-mocks";
import { MOCK_MATCH_RESULT, MOCK_DFY_STATUS } from "../../mock-data";

// ── Page Client Components ──
import { NannyRegistrationFunnel } from "@/app/nanny/register/NannyRegistrationFunnel";
import { NannyInterviewsClient } from "@/app/nanny/interviews/NannyInterviewsClient";
import { NannyBabysittingClient } from "@/app/nanny/babysitting/NannyBabysittingClient";
import { NannyInboxClient } from "@/app/nanny/inbox/NannyInboxClient";
import { VerificationPageClient } from "@/app/nanny/verification/VerificationPageClient";
import { NannyShareClient } from "@/app/nanny/share/NannyShareClient";
import { NannyPositionsClient } from "@/app/nanny/positions/NannyPositionsClient";

import { ParentInterviewsClient } from "@/app/parent/interviews/ParentInterviewsClient";
import { ParentInboxClient } from "@/app/parent/inbox/ParentInboxClient";
import { PositionPageClient } from "@/app/parent/position/PositionPageClient";
import { MatchResultsClient } from "@/app/parent/matches/MatchResultsClient";
import { PositionShareClient } from "@/app/parent/matches/share/PositionShareClient";
import { ParentBabysittingClient } from "@/app/parent/babysitting/ParentBabysittingClient";
import BsrPaymentClient from "@/app/parent/babysitting/[id]/payment/BsrPaymentClient";
import { BsrShareClient } from "@/app/parent/babysitting/[id]/share/BsrShareClient";
import { ParentConnectionsClient } from "@/app/parent/connections/ParentConnectionsClient";
import { ParentVerificationPageClient } from "@/app/parent/verification/ParentVerificationPageClient";
import { AdminUsersClient } from "@/app/admin/users/AdminUsersClient";

import type { MatchResult } from "@/lib/matching/types";

function ClientOnly({ children }: { children: React.ReactNode }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return <div className="p-4 text-sm text-slate-400">Loading...</div>;
  return <>{children}</>;
}

const matchResult = MOCK_MATCH_RESULT as unknown as MatchResult;

const COMPONENTS: Record<string, { name: string; render: () => React.ReactNode }> = {
  "nanny-registration": {
    name: "NannyRegistrationFunnel",
    render: () => (
      <NannyRegistrationFunnel
        userId="mock-user-001"
        initialData={{ first_name: "Bailey", last_name: "Wright", email: "bailey@example.com" }}
      />
    ),
  },
  "nanny-interviews": {
    name: "NannyInterviewsClient",
    render: () => <NannyInterviewsClient requests={MOCK_INTERVIEW_REQUESTS} />,
  },
  "nanny-babysitting": {
    name: "NannyBabysittingClient",
    render: () => <NannyBabysittingClient jobs={MOCK_NANNY_BABYSITTING_JOBS} banned={false} banUntil={null} />,
  },
  "nanny-inbox": {
    name: "NannyInboxClient",
    render: () => (
      <NannyInboxClient
        pendingRequests={MOCK_CONNECTION_REQUESTS}
        notifications={MOCK_INBOX_MESSAGES}
        pastConnections={[]}
      />
    ),
  },
  "nanny-verification": {
    name: "VerificationPageClient",
    render: () => <VerificationPageClient initialData={MOCK_VERIFICATION_DATA} profileData={null} />,
  },
  "nanny-share": {
    name: "NannyShareClient",
    render: () => <NannyShareClient initialData={MOCK_NANNY_SHARE_DATA} />,
  },
  "nanny-positions": {
    name: "NannyPositionsClient",
    render: () => (
      <ClientOnly>
        <NannyPositionsClient
          placements={MOCK_NANNY_PLACEMENTS as any}
          upcomingIntros={MOCK_NANNY_UPCOMING_INTROS}
        />
      </ClientOnly>
    ),
  },

  "parent-interviews": {
    name: "ParentInterviewsClient",
    render: () => <ParentInterviewsClient requests={MOCK_INTERVIEW_REQUESTS} />,
  },
  "parent-inbox": {
    name: "ParentInboxClient",
    render: () => <ParentInboxClient messages={MOCK_INBOX_MESSAGES} />,
  },
  "position-page": {
    name: "PositionPageClient",
    render: () => (
      <PositionPageClient
        position={MOCK_POSITION_WITH_CHILDREN}
        upcomingIntros={MOCK_NANNY_UPCOMING_INTROS}
      />
    ),
  },
  "match-results": {
    name: "MatchResultsClient",
    render: () => (
      <MatchResultsClient
        matches={[matchResult]}
        stats={{ totalEligible: 45, returned: 1 }}
        dfyStatus={MOCK_DFY_STATUS}
      />
    ),
  },
  "position-share": {
    name: "PositionShareClient",
    render: () => <PositionShareClient initialData={MOCK_POSITION_SHARE_DATA} />,
  },
  "parent-babysitting": {
    name: "ParentBabysittingClient",
    render: () => <ParentBabysittingClient requests={MOCK_PARENT_BSR_REQUESTS} districts={MOCK_DISTRICTS} />,
  },
  "bsr-payment": {
    name: "BsrPaymentClient",
    render: () => <BsrPaymentClient bsr={MOCK_BSR_PROFILE} />,
  },
  "bsr-share": {
    name: "BsrShareClient",
    render: () => <BsrShareClient initialData={MOCK_BSR_SHARE_DATA} />,
  },
  "parent-connections": {
    name: "ParentConnectionsClient",
    render: () => <ParentConnectionsClient requests={MOCK_CONNECTION_REQUESTS} />,
  },
  "parent-verification": {
    name: "ParentVerificationPageClient",
    render: () => <ParentVerificationPageClient initialData={MOCK_PARENT_VERIFICATION_DATA} />,
  },
  "admin-users": {
    name: "AdminUsersClient",
    render: () => (
      <Suspense fallback={<div className="p-4 text-sm text-slate-500">Loading...</div>}>
        <AdminUsersClient
          users={MOCK_ADMIN_USERS}
          userStats={MOCK_ADMIN_USER_STATS}
          verificationStats={MOCK_ADMIN_VERIFICATION_STATS}
          identityChecks={MOCK_ADMIN_IDENTITY_CHECKS}
          wwccChecks={MOCK_ADMIN_WWCC_CHECKS}
          parentVerificationStats={MOCK_ADMIN_PARENT_VERIFICATION_STATS}
          parentChecks={MOCK_ADMIN_PARENT_CHECKS}
        />
      </Suspense>
    ),
  },
};

export function EmbedClient({ slug }: { slug: string }) {
  const entry = COMPONENTS[slug];
  if (!entry) {
    return <p className="text-sm text-red-500">Component not found: {slug}</p>;
  }
  return (
    <ShowcaseErrorBoundary name={entry.name}>
      {entry.render()}
    </ShowcaseErrorBoundary>
  );
}
