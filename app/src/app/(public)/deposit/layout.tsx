import type { Metadata } from "next";
import type { ReactNode } from "react";

/**
 * `/deposit/*` (plan 03 row C1, D3, §10). The page sits under the (public) layout — `LandingHeader`, white — so the URL
 * stays `/deposit/<code>`. The code is in that URL, so no page here sends a referrer (an outbound click would carry
 * it) and none is indexed or followed; `robots.ts` disallows the path too (C2). Nothing else is added: no script.
 *
 * BB-wave2-231126/03-build, 2026-11-25.
 */
export const metadata: Metadata = {
  referrer: "no-referrer",
  robots: { index: false, follow: false },
};

export default function DepositLayout({ children }: { readonly children: ReactNode }) {
  return <>{children}</>;
}
