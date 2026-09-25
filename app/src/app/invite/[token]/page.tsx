import type { Metadata } from "next";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import {
  getInvitePreview,
  getSwitchContextForInvite,
} from "@/lib/actions/bapp/child-invites";
import { invitesDisabled } from "@/lib/invite/flags";
import { getUserRole } from "@/lib/auth/actions";
import { InviteLandingClient } from "./InviteLandingClient";
import { BRAND } from "@/lib/constants";

// Prevent token leakage via Referer headers when navigating away from
// this page. Pair with `noindex` so search engines never crawl tokens.
export const metadata: Metadata = {
  referrer: "no-referrer",
  robots: { index: false, follow: false },
};

export default async function InvitePage({
  params,
}: {
  params: { token: string };
}) {
  if (invitesDisabled()) {
    return (
      <Shell>
        <div className="space-y-3 text-center">
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            Invites are paused
          </h1>
          <p className="text-sm text-slate-600">
            We&apos;ve temporarily paused invite links. Please check back soon.
          </p>
        </div>
      </Shell>
    );
  }

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const userRole = user ? await getUserRole(user.id) : null;

  // getInvitePreview is anonymous-safe and validates token format before
  // hitting Postgres. Errors are surfaced as discriminated states by the
  // client; we don't 404 the route because the not-found branch wants
  // its own copy + sign-up CTA.
  //
  // getSwitchContextForInvite default-denies (returns isSwitching=false)
  // for every case where the gate is unnecessary — anon, non-parent,
  // no existing placement, same-nanny invite, malformed token. Safe to
  // run unconditionally.
  const [preview, switchContextResult] = await Promise.all([
    getInvitePreview(params.token),
    getSwitchContextForInvite(params.token),
  ]);

  return (
    <Shell>
      <InviteLandingClient
        token={params.token}
        preview={preview.data}
        previewError={preview.error}
        currentUserId={user?.id ?? null}
        currentUserRole={userRole}
        switchContext={switchContextResult.data}
      />
    </Shell>
  );
}

/**
 * Visual shell mirrors `(auth)/layout.tsx` so the invite landing feels
 * native to the rest of the auth-adjacent surfaces — same gradient
 * background, same Baby Bloom logo, same card chrome. We don't reuse
 * the auth layout outright because the invite route lives outside the
 * `(auth)` group (token paths can't be auth-gated).
 */
function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-br from-violet-50 via-white to-fuchsia-50">
      <div className="w-full max-w-md px-4">
        <div className="text-center mb-8">
          <Link href="/" className="inline-flex flex-col items-center">
            <div className="flex items-center gap-0.5 text-4xl font-bold tracking-tight">
              <span className="text-slate-900">Baby</span>
              <span className="text-violet-500">Bloom</span>
            </div>
            <p className="text-sm text-slate-500 mt-1">{BRAND.city}</p>
          </Link>
        </div>
        <div className="bg-white rounded-2xl shadow-xl shadow-violet-100/50 border border-violet-100 p-8">
          {children}
        </div>
      </div>
    </div>
  );
}
