"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { InterviewRequestWithDetails, cancelInterviewRequest } from "@/lib/actions/interview";
import { MapPin, PoundSterling, Clock, X, Loader2 } from "lucide-react";

interface ParentInterviewsClientProps {
  requests: InterviewRequestWithDetails[];
}

export function ParentInterviewsClient({ requests }: ParentInterviewsClientProps) {
  const router = useRouter();
  const [cancellingId, setCancellingId] = useState<string | null>(null);

  const handleCancel = async (requestId: string) => {
    setCancellingId(requestId);
    const result = await cancelInterviewRequest(requestId);
    setCancellingId(null);

    if (result.success) {
      router.refresh();
    }
  };

  return (
    <div className="grid gap-4">
      {requests.map((request) => (
        <Card key={request.id} className="border-yellow-200">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">
                {request.nanny?.first_name} {request.nanny?.last_name[0]}.
              </CardTitle>
              <span className="rounded-full bg-yellow-100 px-2.5 py-0.5 text-xs font-medium text-yellow-800">
                Pending
              </span>
            </div>
            <CardDescription className="flex items-center gap-3">
              <span className="flex items-center gap-1">
                <MapPin className="h-3 w-3" />
                {request.nanny?.suburb}
              </span>
              {request.nanny?.hourly_rate_min && (
                <span className="flex items-center gap-1">
                  <PoundSterling className="h-3 w-3" />
                  £{request.nanny.hourly_rate_min}/hr
                </span>
              )}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <p className="flex items-center gap-2 text-sm font-medium text-slate-700 mb-2">
                <Clock className="h-4 w-4" />
                Proposed Times
              </p>
              <div className="space-y-1">
                {request.proposed_times.map((time, index) => (
                  <p key={index} className="text-sm text-slate-600">
                    {new Date(time).toLocaleString("en-GB", {
                      weekday: "short",
                      day: "numeric",
                      month: "short",
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                  </p>
                ))}
              </div>
            </div>

            {request.message && (
              <div className="rounded-lg bg-slate-50 p-3">
                <p className="text-xs font-medium text-slate-500 mb-1">Your message</p>
                <p className="text-sm text-slate-700">{request.message}</p>
              </div>
            )}

            <div className="flex justify-between items-center pt-2">
              <p className="text-xs text-slate-400">
                Sent {new Date(request.created_at).toLocaleDateString("en-GB")}
              </p>
              <Button
                variant="outline"
                size="sm"
                className="text-red-600 hover:bg-red-50 hover:text-red-700"
                onClick={() => handleCancel(request.id)}
                disabled={cancellingId === request.id}
              >
                {cancellingId === request.id ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <X className="mr-2 h-4 w-4" />
                )}
                Cancel Request
              </Button>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
