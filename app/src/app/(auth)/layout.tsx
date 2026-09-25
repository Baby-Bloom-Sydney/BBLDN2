import type { Metadata } from "next";
import Link from "next/link";
import { BRAND } from "@/lib/constants";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
  // `?invite={token}` is intentionally carried through login + signup
  // URLs so the recipient lands back at /invite/{token} after auth.
  // Without no-referrer set here, an outbound click from these pages
  // (e.g. "Forgot password?") would put the token-bearing URL in the
  // Referer header. Mirror the policy the public landing page sets.
  // (security-reviewer M2, 2026-05-05.)
  referrer: "no-referrer",
};

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-br from-violet-50 via-white to-fuchsia-50">
      <div className="w-full max-w-md px-4">
        {/* Logo */}
        <div className="text-center mb-8">
          <Link href="/" className="inline-flex flex-col items-center">
            <div className="flex items-center gap-0.5 text-4xl font-bold tracking-tight">
              <span className="text-slate-900">Baby</span>
              <span className="text-violet-500">Bloom</span>
            </div>
            <p className="text-sm text-slate-500 mt-1">{BRAND.city}</p>
          </Link>
        </div>

        {/* Auth Card */}
        <div className="bg-white rounded-2xl shadow-xl shadow-violet-100/50 border border-violet-100 p-8">
          {children}
        </div>

        {/* Footer */}
        <p className="text-center text-xs text-muted-foreground mt-8">
          By continuing, you agree to our{" "}
          <Link href="/terms" className="text-primary hover:underline">
            Terms of Service
          </Link>{" "}
          and{" "}
          <Link href="/privacy" className="text-primary hover:underline">
            Privacy Policy
          </Link>
        </p>
      </div>
    </div>
  );
}
