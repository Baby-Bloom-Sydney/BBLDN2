"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { StageProps } from "../../FunnelOrchestrator";
import Image from "next/image";
import { Sparkles, Bell, Eye } from "lucide-react";
import { shareLoopEnabled } from "@/lib/features/flags";

export function N5Welcome({ state }: StageProps) {
  const router = useRouter();
  const [showConfirm, setShowConfirm] = useState(false);
  // 5b (P-23): with the share loop hidden, the share CTA, its opt-out and the "Are you sure?" modal are not
  // rendered; one button continues to the dashboard (the modal's own "Skip for now" target).
  const isShareLoopOn = shareLoopEnabled();

  return (
    <div className="flex flex-col items-center gap-6 py-8 text-center animate-in fade-in duration-500">
      <div className="w-16 h-16 bg-violet-100 rounded-full flex items-center justify-center">
        <Sparkles className="w-8 h-8 text-violet-600" />
      </div>

      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold text-slate-800">
          Welcome to Baby Bloom, {state.first_name}!
        </h1>
        <p className="text-lg text-violet-600 font-medium">
          Your profile is live. Families can now find you.
        </p>
      </div>

      {/* Profile thumbnail */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 flex items-center gap-4 max-w-sm w-full">
        {state.about_you.profile_picture_url ? (
          <div className="w-14 h-14 rounded-full overflow-hidden flex-shrink-0 border-2 border-violet-200">
            <Image
              src={state.about_you.profile_picture_url}
              alt="Profile"
              width={56}
              height={56}
              className="object-cover w-full h-full"
            />
          </div>
        ) : (
          <div className="w-14 h-14 rounded-full bg-violet-100 flex items-center justify-center flex-shrink-0 border-2 border-violet-200">
            <span className="text-xl font-bold text-violet-600">
              {state.first_name?.[0]?.toUpperCase() || "?"}
            </span>
          </div>
        )}
        <div className="text-left flex-1 min-w-0">
          <p className="font-semibold text-slate-800 text-sm">
            {state.first_name} {state.last_name}
          </p>
          <p className="text-xs text-slate-500 line-clamp-2">
            {(state.ai_content?.headline as string)
              ?.replace(/<[^>]*>/g, "")
              .trim() || "Professional nanny"}
          </p>
        </div>
      </div>

      {/* Next steps */}
      <div className="flex flex-col gap-3 max-w-sm w-full text-left">
        <p className="text-sm font-semibold text-slate-700">
          Here&apos;s what happens next:
        </p>
        <div className="flex items-start gap-3">
          <Eye className="w-4 h-4 text-violet-500 mt-0.5 flex-shrink-0" />
          <p className="text-sm text-slate-600">
            Parents are now able to find you to connect
          </p>
        </div>
        <div className="flex items-start gap-3">
          <Sparkles className="w-4 h-4 text-violet-500 mt-0.5 flex-shrink-0" />
          <p className="text-sm text-slate-600">
            We&apos;ll start matching you with families based on your
            preferences
          </p>
        </div>
        <div className="flex items-start gap-3">
          <Bell className="w-4 h-4 text-violet-500 mt-0.5 flex-shrink-0" />
          <p className="text-sm text-slate-600">
            You&apos;ll be notified when a family is interested in you
          </p>
        </div>
      </div>

      {!isShareLoopOn && (
        <Button
          onClick={() => router.push("/nanny")}
          className="max-w-sm w-full bg-violet-600 hover:bg-violet-700 text-white h-11 px-6 rounded-lg font-medium text-sm mt-2"
        >
          Go to my dashboard
        </Button>
      )}

      {isShareLoopOn && (
        <>
          {/* Share CTA tile */}
          <div className="max-w-sm w-full rounded-2xl border-2 border-violet-200 bg-gradient-to-br from-violet-50 via-white to-violet-50 p-6 flex flex-col gap-4 mt-2 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-violet-100 flex items-center justify-center flex-shrink-0">
                <Sparkles className="w-5 h-5 text-violet-600" />
              </div>
              <p className="text-sm font-semibold text-slate-800 text-left">
                Get more opportunities
              </p>
            </div>
            <div className="text-sm text-slate-600 text-left leading-relaxed">
              <p>Share your childcare profile to:</p>
              <ul className="mt-1 ml-1 flex flex-col gap-0.5 text-green-600">
                <li>+ Be included in parents&apos; matchmaking results</li>
                <li>+ Receive live babysitting opportunities</li>
              </ul>
            </div>
            <Button
              onClick={() => router.push("/nanny/share")}
              className="w-full bg-violet-600 hover:bg-violet-700 text-white h-11 px-6 rounded-lg font-medium text-sm"
            >
              Share Your Profile
            </Button>
          </div>

          <button
            onClick={() => setShowConfirm(true)}
            className="text-xs text-slate-400 hover:text-slate-500 transition-colors mt-1"
          >
            I don&apos;t want more matches or to babysit
          </button>

          {/* Confirmation modal */}
          {showConfirm && (
            <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4 animate-in fade-in duration-200">
              <div className="bg-white rounded-2xl p-6 max-w-sm w-full flex flex-col gap-4 shadow-xl animate-in zoom-in-95 duration-200">
                <h3 className="text-lg font-semibold text-slate-800">
                  Are you sure?
                </h3>
                <p className="text-sm text-slate-600 leading-relaxed">
                  Nannies who share their profile get up to{" "}
                  <span className="font-semibold text-slate-800">
                    10x more matches
                  </span>{" "}
                  with families. It also helps us bring more families onto the
                  platform, which means more opportunities for you and every
                  nanny on Baby Bloom. You can always do this later from your
                  dashboard.
                </p>
                <div className="flex flex-col gap-2 pt-2">
                  <Button
                    onClick={() => setShowConfirm(false)}
                    className="w-full bg-violet-600 hover:bg-violet-700 text-white h-11 px-6 rounded-lg font-medium text-sm"
                  >
                    Go Back and Share
                  </Button>
                  <button
                    onClick={() => router.push("/nanny")}
                    className="w-full text-sm text-slate-400 hover:text-slate-500 py-2 transition-colors"
                  >
                    Skip for now
                  </button>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
