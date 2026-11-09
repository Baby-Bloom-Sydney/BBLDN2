"use client";

/**
 * Contact-us form embedded in the settings page.
 *
 * v2 (2026-05-07): the explicit "reply email" override field +
 * the "Replies go to ..." preface strip were removed. Replies
 * always go to the user's registered email; we simply don't
 * mention it. The subject input no longer carries a placeholder
 * either (per user feedback — placeholders were colloquial).
 */

import { useState, useTransition } from "react";
import { Loader2, Send, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { submitContactRequest } from "@/lib/actions/contact";

const MESSAGE_MIN = 10;
const MESSAGE_MAX = 4000;
const SUBJECT_MAX = 120;

export function ContactSection() {
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [isPending, startTransition] = useTransition();

  const messageTooShort =
    message.trim().length > 0 && message.trim().length < MESSAGE_MIN;
  const canSend =
    subject.trim().length > 0 &&
    message.trim().length >= MESSAGE_MIN &&
    !isPending;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSend) return;
    setError(null);
    startTransition(async () => {
      const result = await submitContactRequest({
        subject: subject.trim(),
        message: message.trim(),
        // No replyEmail override — server falls back to the
        // authenticated user's registered email automatically.
      });
      if (!result.success) {
        setError(result.error ?? "Couldn't send your message.");
        return;
      }
      setSent(true);
      setSubject("");
      setMessage("");
    });
  }

  if (sent) {
    return (
      <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm">
        <div className="flex items-start gap-2.5">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
          <div className="flex-1">
            <p className="font-medium text-emerald-900">Message sent</p>
            <p className="mt-1 text-emerald-700">
              We&apos;ll get back to you within one business day.
            </p>
            <button
              type="button"
              onClick={() => setSent(false)}
              className="mt-2 text-xs font-medium text-emerald-700 underline-offset-2 hover:underline"
            >
              Send another message
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {error && (
        <div
          role="alert"
          className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700"
        >
          {error}
        </div>
      )}

      <div className="space-y-1.5">
        <Label htmlFor="contact-subject">Subject</Label>
        <Input
          id="contact-subject"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          maxLength={SUBJECT_MAX}
          disabled={isPending}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="contact-message">Message</Label>
        <Textarea
          id="contact-message"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          maxLength={MESSAGE_MAX}
          rows={6}
          disabled={isPending}
        />
        <div className="flex items-center justify-between text-xs">
          <span
            className={messageTooShort ? "text-rose-600" : "text-slate-500"}
          >
            {messageTooShort
              ? `At least ${MESSAGE_MIN} characters`
              : `${message.trim().length} / ${MESSAGE_MAX}`}
          </span>
        </div>
      </div>

      <div className="flex justify-end">
        <Button
          type="submit"
          disabled={!canSend}
          className="bg-violet-600 hover:bg-violet-700"
        >
          {isPending ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Sending…
            </>
          ) : (
            <>
              <Send className="mr-2 h-4 w-4" />
              Send message
            </>
          )}
        </Button>
      </div>
    </form>
  );
}
