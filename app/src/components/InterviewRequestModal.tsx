"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { NannyCardData } from "./NannyCard";
import { createInterviewRequest } from "@/lib/actions/interview";
import { X, Loader2, Calendar, MapPin, Check } from "lucide-react";

interface InterviewRequestModalProps {
  isOpen: boolean;
  onClose: () => void;
  nanny: NannyCardData;
}

export function InterviewRequestModal({ isOpen, onClose, nanny }: InterviewRequestModalProps) {
  const router = useRouter();
  const [times, setTimes] = useState<string[]>(["", "", ""]);
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleTimeChange = (index: number, value: string) => {
    const newTimes = [...times];
    newTimes[index] = value;
    setTimes(newTimes);
  };

  const validTimes = times.filter((t) => t.trim() !== "");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (validTimes.length < 1) {
      setError("Please propose at least one interview time");
      return;
    }

    setSubmitting(true);
    setError(null);

    const result = await createInterviewRequest(nanny.id, validTimes, message || undefined);

    setSubmitting(false);

    if (result.success) {
      setSuccess(true);
      setTimeout(() => {
        onClose();
        router.refresh();
      }, 1500);
    } else {
      setError(result.error || "Failed to send request");
    }
  };

  const minDateTime = new Date().toISOString().slice(0, 16);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <Card className="w-full max-w-lg">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Request Interview</CardTitle>
              <CardDescription>
                with {nanny.first_name} {nanny.last_name[0]}.
              </CardDescription>
            </div>
            <Button variant="ghost" size="sm" onClick={onClose}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {success ? (
            <div className="flex flex-col items-center py-8">
              <div className="mb-4 rounded-full bg-green-100 p-3">
                <Check className="h-8 w-8 text-green-600" />
              </div>
              <h3 className="text-lg font-semibold text-slate-900">Request Sent!</h3>
              <p className="mt-2 text-center text-slate-500">
                {nanny.first_name} will review your request and respond soon.
              </p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-6">
              {/* Nanny Info */}
              <div className="rounded-lg bg-slate-50 p-4">
                <div className="flex items-center gap-3">
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-violet-100">
                    <span className="text-lg font-semibold text-violet-600">
                      {nanny.first_name[0]}{nanny.last_name[0]}
                    </span>
                  </div>
                  <div>
                    <p className="font-medium">{nanny.first_name} {nanny.last_name[0]}.</p>
                    <p className="flex items-center gap-1 text-sm text-slate-500">
                      <MapPin className="h-3 w-3" />
                      {nanny.suburb}
                    </p>
                  </div>
                  {nanny.hourly_rate_min && (
                    <div className="ml-auto text-right">
                      <p className="font-bold">£{nanny.hourly_rate_min}</p>
                      <p className="text-xs text-slate-500">/hour</p>
                    </div>
                  )}
                </div>
              </div>

              {/* Proposed Times */}
              <div className="space-y-3">
                <Label className="flex items-center gap-2">
                  <Calendar className="h-4 w-4" />
                  Propose Interview Times
                </Label>
                <p className="text-sm text-slate-500">
                  Select up to 3 times that work for you. The nanny will choose one.
                </p>
                {[0, 1, 2].map((index) => (
                  <div key={index} className="flex items-center gap-2">
                    <span className="w-8 text-sm text-slate-500">#{index + 1}</span>
                    <Input
                      type="datetime-local"
                      value={times[index]}
                      onChange={(e) => handleTimeChange(index, e.target.value)}
                      min={minDateTime}
                      className="flex-1"
                    />
                  </div>
                ))}
              </div>

              {/* Message */}
              <div className="space-y-2">
                <Label htmlFor="message">Message (optional)</Label>
                <textarea
                  id="message"
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  rows={3}
                  placeholder="Introduce yourself and share any details about your family..."
                  className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                />
              </div>

              {error && (
                <p className="text-sm text-red-600">{error}</p>
              )}

              {/* Actions */}
              <div className="flex gap-3">
                <Button type="button" variant="outline" className="flex-1" onClick={onClose}>
                  Cancel
                </Button>
                <Button
                  type="submit"
                  className="flex-1 bg-violet-500 hover:bg-violet-600"
                  disabled={submitting || validTimes.length < 1}
                >
                  {submitting ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Sending...
                    </>
                  ) : (
                    "Send Request"
                  )}
                </Button>
              </div>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
