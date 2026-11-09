"use client";

/**
 * Anonymous (marketing-site) contact form. Used on the public
 * `/contact` page — collects name + email + subject + message and
 * posts to `submitPublicContactRequest`.
 *
 * Visually consistent with the authed `ContactSection` so the
 * "feel" is one Baby Bloom across surfaces.
 */

import { useState, useTransition } from "react";
import { Loader2, Send, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { submitPublicContactRequest } from "@/lib/actions/contact";

const MESSAGE_MIN = 10;
const MESSAGE_MAX = 4000;
const SUBJECT_MAX = 120;
const NAME_MAX = 80;

export function PublicContactForm() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [isPending, startTransition] = useTransition();

  const messageTooShort =
    message.trim().length > 0 && message.trim().length < MESSAGE_MIN;
  const canSend =
    name.trim().length > 0 &&
    email.trim().length > 0 &&
    subject.trim().length > 0 &&
    message.trim().length >= MESSAGE_MIN &&
    !isPending;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSend) return;
    setError(null);
    startTransition(async () => {
      const result = await submitPublicContactRequest({
        name: name.trim(),
        email: email.trim(),
        subject: subject.trim(),
        message: message.trim(),
      });
      if (!result.success) {
        setError(result.error ?? "Couldn't send your message.");
        return;
      }
      setSent(true);
      setName("");
      setEmail("");
      setSubject("");
      setMessage("");
    });
  }

  if (sent) {
    return (
      <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-6 text-sm">
        <div className="flex items-start gap-3">
          <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
          <div className="flex-1">
            <p className="text-base font-semibold text-emerald-900">
              Message sent
            </p>
            <p className="mt-1 text-emerald-700">
              We&apos;ll come back to you within one business day.
            </p>
            <button
              type="button"
              onClick={() => setSent(false)}
              className="mt-3 text-xs font-medium text-emerald-700 underline-offset-2 hover:underline"
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

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="public-name">Your name</Label>
          <Input
            id="public-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={NAME_MAX}
            disabled={isPending}
            autoComplete="name"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="public-email">Your email</Label>
          <Input
            id="public-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={isPending}
            autoComplete="email"
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="public-subject">Subject</Label>
        <Input
          id="public-subject"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          maxLength={SUBJECT_MAX}
          placeholder="What's this about?"
          disabled={isPending}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="public-message">Message</Label>
        <Textarea
          id="public-message"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          maxLength={MESSAGE_MAX}
          rows={6}
          placeholder="Give us as much detail as you can — we'll come back to you within one business day."
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
