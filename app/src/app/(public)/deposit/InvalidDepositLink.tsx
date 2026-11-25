/**
 * The deposit page's shell and its plain notices (brief 03 §3 parent 8, §7; plan 03 row C1). Mobile first: one card
 * in a 36rem column with a 16 px gutter, so nothing scrolls sideways at 375 px; the subscribe page's violet card.
 *
 * - `InvalidDepositLink`: ONE message for every bad case (malformed, unknown, cancelled, no code, someone else's
 *   session), the `InvalidLinkPage` shape — so it reveals nothing. No login or dashboard link: she has neither.
 * - `DepositTryAgain`: the plain try-again line when the link couldn't be read.
 * - `DepositNotice`: a heading line with anything after it (the done page).
 *
 * No hooks and no `"use client"`: the server pages render these, and the client page reuses them.
 * BB-wave2-231126/03-build, 2026-11-25.
 */

import type { ReactNode } from "react";
import { CheckCircle2, Link2Off } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { PAGE_COPY } from "@/lib/deposit/copy";

/** The page: one column, one card. */
export function DepositShell({ children }: { readonly children: ReactNode }) {
  return (
    <main className="mx-auto w-full max-w-xl px-4 py-10 sm:py-14">
      <Card className="border-violet-200 bg-white shadow-sm">
        <CardContent className="flex flex-col gap-5 p-6 sm:p-8">{children}</CardContent>
      </Card>
    </main>
  );
}

export type NoticeTone = "neutral" | "success";

const TONE_ICON: Readonly<Record<NoticeTone, ReactNode>> = Object.freeze({
  neutral: <Link2Off className="h-6 w-6 text-slate-400" aria-hidden="true" />,
  success: <CheckCircle2 className="h-7 w-7 text-green-600" aria-hidden="true" />,
});

interface NoticeProps {
  readonly heading: string;
  readonly tone?: NoticeTone;
  readonly children?: ReactNode;
}

/** A heading line, its decorative mark, and what follows it. */
export function DepositNotice({ heading, tone = "neutral", children }: NoticeProps) {
  return (
    <DepositShell>
      {TONE_ICON[tone]}
      <h1 className="text-xl font-semibold leading-snug text-slate-900 sm:text-2xl">{heading}</h1>
      {children}
    </DepositShell>
  );
}

export function InvalidDepositLink() {
  return <DepositNotice heading={PAGE_COPY.invalid} />;
}

export function DepositTryAgain() {
  return <DepositNotice heading={PAGE_COPY.tryAgain} />;
}
