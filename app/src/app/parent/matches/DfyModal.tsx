"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Sparkles, Check } from "lucide-react";
import { legacyTierCheckoutEnabled } from "@/lib/features/flags";

const FEATURES = [
  "We contact your top matched nannies",
  "Interested nannies select their availability",
  "You approve and pick a meet and greet time",
  "All scheduling handled for you",
];

interface DfyModalProps {
  open: boolean;
  onClose: () => void;
}

export function DfyModal({ open, onClose }: DfyModalProps) {
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg">
            <Sparkles className="h-5 w-5 text-violet-600" />
            Activate your matchmaker
          </DialogTitle>
        </DialogHeader>

        <p className="text-sm text-slate-600">
          We&apos;ll contact your best-matched nannies and let interested ones come to you.
        </p>

        <ul className="space-y-2">
          {FEATURES.map((feature) => (
            <li key={feature} className="flex items-start gap-2 text-sm text-slate-700">
              <Check className="w-4 h-4 text-violet-500 shrink-0 mt-0.5" />
              {feature}
            </li>
          ))}
        </ul>

        <div className="flex gap-3 justify-end mt-2">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          {/* 5g (P-23): the tier checkout is hidden unless LEGACY_TIER_CHECKOUT_ENABLED. */}
          {legacyTierCheckoutEnabled() && (
            <Button
              onClick={() => {
                window.location.href = "/parent/matches/checkout";
              }}
              className="bg-violet-600 hover:bg-violet-700"
            >
              <Sparkles className="w-4 h-4 mr-1.5" />
              Get started
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
