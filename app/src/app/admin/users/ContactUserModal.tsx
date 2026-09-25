"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { adminSendEmail } from "@/lib/actions/admin";
import { ADMIN_FROM_ADDRESSES } from "@/lib/constants";
import { Loader2, CheckCircle2, AlertCircle } from "lucide-react";

// The server validates `fromAddress` against the same list (adminSendEmail);
// one source is what keeps the picker's value acceptable to it.
const FROM_OPTIONS: ReadonlyArray<{ value: string; label: string }> =
  ADMIN_FROM_ADDRESSES.map((value) => ({
    value,
    label: `${value.split("@")[0]}@`,
  }));

interface ContactUserModalProps {
  userEmail: string;
  userName: string;
  userId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ContactUserModal({
  userEmail,
  userName,
  userId,
  open,
  onOpenChange,
}: ContactUserModalProps) {
  const [fromAddress, setFromAddress] = useState(FROM_OPTIONS[0].value);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setSubject("");
    setBody("");
    setFromAddress(FROM_OPTIONS[0].value);
    setStatus("idle");
    setError(null);
  }

  function handleOpenChange(open: boolean) {
    if (!open) reset();
    onOpenChange(open);
  }

  async function handleSend() {
    if (!subject.trim() || !body.trim()) return;

    setStatus("sending");
    setError(null);

    const result = await adminSendEmail({
      toEmail: userEmail,
      toUserId: userId,
      fromAddress,
      subject: subject.trim(),
      body: body.trim(),
    });

    if (result.success) {
      setStatus("sent");
      setTimeout(() => handleOpenChange(false), 1500);
    } else {
      setStatus("error");
      setError(result.error || "Failed to send email");
    }
  }

  const canSend = subject.trim().length > 0 && body.trim().length > 0 && status === "idle";

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Contact User</DialogTitle>
          <DialogDescription>Send an email to {userName}</DialogDescription>
        </DialogHeader>

        {status === "sent" ? (
          <div className="flex flex-col items-center gap-3 py-8">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-green-100">
              <CheckCircle2 className="h-6 w-6 text-green-600" />
            </div>
            <p className="text-sm font-medium text-green-700">Email sent!</p>
          </div>
        ) : (
          <div className="space-y-4 mt-2">
            {/* From */}
            <div>
              <label className="text-sm font-medium text-slate-700 mb-1.5 block">From</label>
              <select
                value={fromAddress}
                onChange={(e) => setFromAddress(e.target.value)}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent"
              >
                {FROM_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.value}
                  </option>
                ))}
              </select>
            </div>

            {/* To */}
            <div>
              <label className="text-sm font-medium text-slate-700 mb-1.5 block">To</label>
              <Input value={userEmail} disabled className="text-sm bg-slate-50" />
            </div>

            {/* Subject */}
            <div>
              <label className="text-sm font-medium text-slate-700 mb-1.5 block">Subject</label>
              <Input
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="Email subject..."
                className="text-sm"
              />
            </div>

            {/* Body */}
            <div>
              <label className="text-sm font-medium text-slate-700 mb-1.5 block">Message</label>
              <Textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder="Type your message..."
                rows={6}
                className="text-sm resize-none"
              />
            </div>

            {/* Error */}
            {status === "error" && error && (
              <div className="flex items-center gap-2 rounded-lg bg-red-50 border border-red-200 px-3 py-2">
                <AlertCircle className="h-4 w-4 text-red-500 shrink-0" />
                <p className="text-sm text-red-700">{error}</p>
              </div>
            )}

            {/* Actions */}
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="ghost" size="sm" onClick={() => handleOpenChange(false)}>
                Cancel
              </Button>
              <Button
                size="sm"
                className="bg-violet-600 hover:bg-violet-700 text-white"
                disabled={!canSend}
                onClick={handleSend}
              >
                {status === "sending" ? (
                  <>
                    <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                    Sending...
                  </>
                ) : (
                  "Send Email"
                )}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
