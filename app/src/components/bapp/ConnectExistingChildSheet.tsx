"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2 } from "lucide-react";
import { extractInviteToken } from "@/lib/invite/extract-token";
import { SITE_URL } from "@/lib/constants";

interface ConnectExistingChildSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  role: "nanny" | "parent";
}

const VALIDATION_ERROR =
  "That doesn't look like a Baby Bloom invite link. Make sure you've copied the entire link.";

export function ConnectExistingChildSheet({
  open,
  onOpenChange,
  role,
}: ConnectExistingChildSheetProps) {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function reset() {
    setUrl("");
    setError(null);
    setBusy(false);
  }

  function handleContinue() {
    const token = extractInviteToken(url);
    if (!token) {
      setError(VALIDATION_ERROR);
      return;
    }
    setBusy(true);
    // Route into the public landing — the recipient becomes "signed in,
    // right role" there and sees the Connect/Decline buttons.
    router.push(`/invite/${token}`);
  }

  const otherParty = role === "parent" ? "nanny" : "parent";

  return (
    <Sheet
      open={open}
      onOpenChange={(val) => {
        if (!val) reset();
        onOpenChange(val);
      }}
    >
      <SheetContent side="bottom" className="rounded-t-2xl">
        <SheetHeader>
          <SheetTitle>Connect a child</SheetTitle>
        </SheetHeader>
        <div className="mt-4 space-y-4">
          <p className="text-sm text-slate-600">
            Paste the invite link your {otherParty} sent you below.
          </p>
          <div className="space-y-2">
            <Label htmlFor="invite-url">Invite link</Label>
            <Input
              id="invite-url"
              type="url"
              inputMode="url"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              placeholder={`${SITE_URL}/invite/...`}
              value={url}
              onChange={(e) => {
                setUrl(e.target.value);
                if (error) setError(null);
              }}
              className="font-mono text-xs"
            />
            {error && (
              <p
                className="text-sm text-red-600"
                role="alert"
                aria-live="polite"
              >
                {error}
              </p>
            )}
          </div>
          <Button
            type="button"
            onClick={handleContinue}
            disabled={busy || url.trim().length === 0}
            className="w-full"
          >
            {busy ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Opening...
              </>
            ) : (
              "Continue"
            )}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
