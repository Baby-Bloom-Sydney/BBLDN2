"use client";

import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { babysittingEnabled } from "@/lib/features/flags";

// Why: this modal was previously inlined at three+ sites (NannyHubClient
// tab-locked Dialog, /position/[id] Apply button error states). Lifting it
// keeps copy + a11y posture consistent and lets new gate points reuse it
// without duplicating Dialog wiring.

interface VerificationRequiredModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Title above the body. Default: "Verify your account". */
  title?: string;
  /** Body copy. Default mirrors the legacy tab-locked Dialog. */
  message?: string;
  /** CTA button label. Default: "Verify Now". */
  ctaLabel?: string;
  /** CTA target. Default: "/nanny/verification". */
  ctaHref?: string;
}

const DEFAULT_TITLE = "Verify your account";
/** Brief 12 B7: the default names babysitting only while it is live (P-23); read at render. */
const defaultMessage = (): string =>
  babysittingEnabled()
    ? "Complete verification to access your nannying and babysitting dashboard."
    : "Complete verification to access your nannying dashboard.";
const DEFAULT_CTA = "Verify Now";
const DEFAULT_HREF = "/nanny/verification";

export function VerificationRequiredModal({
  open,
  onOpenChange,
  title = DEFAULT_TITLE,
  message = defaultMessage(),
  ctaLabel = DEFAULT_CTA,
  ctaHref = DEFAULT_HREF,
}: VerificationRequiredModalProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* Keep the Radix close X visible — sighted keyboard-only users need a
          discoverable dismiss affordance beyond ESC. a11y-architect 2026-05-19. */}
      <DialogContent className="max-w-[calc(100vw-2rem)] sm:max-w-sm">
        <div className="flex flex-col items-center gap-4 py-2 text-center">
          <div
            aria-hidden="true"
            className="flex h-14 w-14 items-center justify-center rounded-full bg-green-50 ring-1 ring-green-200"
          >
            <ShieldCheck className="h-6 w-6 text-green-600" />
          </div>
          <div>
            <DialogTitle className="text-lg font-semibold text-slate-900">
              {title}
            </DialogTitle>
            <DialogDescription className="mt-1.5 text-sm leading-relaxed text-slate-500">
              {message}
            </DialogDescription>
          </div>
          <Button
            asChild
            className="mt-1 w-full bg-violet-600 hover:bg-violet-700"
          >
            <Link href={ctaHref}>
              <ShieldCheck className="mr-1.5 h-4 w-4" aria-hidden="true" />
              {ctaLabel}
            </Link>
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
