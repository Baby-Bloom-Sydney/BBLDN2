"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import { QuestionShell } from "./QuestionShell";
import {
  TypeformFormData,
  INITIAL_FORM_DATA,
  QUESTIONS,
} from "./questions";
import { SingleSelect } from "./renderers/SingleSelect";
import { MultiSelect } from "./renderers/MultiSelect";
import { TextInput } from "./renderers/TextInput";
import { ChildrenCompound } from "./renderers/ChildrenCompound";
import { SuburbAutocomplete } from "./renderers/SuburbAutocomplete";
import { DaysTimesCompound } from "./renderers/DaysTimesCompound";
import { saveTypeformPosition } from "@/lib/actions/parent";
import { Button } from "@/components/ui/button";
import { Interstitial } from "./Interstitial";
import { PositionIntro } from "./PositionIntro";

/**
 * `callAt` (04b rework W11): the call time she picked before she had a position; booked once it is saved. With it the
 * flow opens on an intro, then question 1 (W15); without it, today's flow.
 */
export function TypeformFlow({ callAt }: { callAt?: string } = {}) {
  const router = useRouter();
  const [intro, setIntro] = useState(callAt !== undefined);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [formData, setFormData] = useState<Partial<TypeformFormData>>(
    INITIAL_FORM_DATA
  );
  const [isExiting, setIsExiting] = useState(false);
  const [showConditional, setShowConditional] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  // F-7: bumped by "Try again" so the save effect runs again (its other deps don't change on a retry).
  const [saveAttempt, setSaveAttempt] = useState(0);

  // Always-current formData ref — fixes stale closure bugs
  const formDataRef = useRef(formData);
  formDataRef.current = formData;

  // Track direction for interstitial skip logic
  const isGoingForward = useRef(true);

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const interstitialTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  );
  const autoAdvanceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  );

  const updateData = useCallback((d: Partial<TypeformFormData>) => {
    setFormData((prev) => ({ ...prev, ...d }));
  }, []);

  // Find the next valid index (skip questions where skip() returns true)
  const findNextIndex = useCallback(
    (from: number, dir: "forward" | "backward"): number => {
      let idx = dir === "forward" ? from + 1 : from - 1;
      while (idx >= 0 && idx < QUESTIONS.length) {
        const q = QUESTIONS[idx];
        if (dir === "backward" && q.type === "interstitial") {
          idx = idx - 1;
          continue;
        }
        if (q.skip && q.skip(formDataRef.current)) {
          idx = dir === "forward" ? idx + 1 : idx - 1;
          continue;
        }
        break;
      }
      return Math.max(0, Math.min(idx, QUESTIONS.length - 1));
    },
    []
  );

  const transitionTo = useCallback((nextIndex: number) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (interstitialTimerRef.current)
      clearTimeout(interstitialTimerRef.current);
    if (autoAdvanceTimerRef.current)
      clearTimeout(autoAdvanceTimerRef.current);

    setIsExiting(true);

    timerRef.current = setTimeout(() => {
      setCurrentIndex(nextIndex);
      setShowConditional(false);
      setIsExiting(false);
    }, 200);
  }, []);

  // Try to advance — if at end, mark form as complete
  const advanceOrComplete = useCallback(
    (fromIndex: number) => {
      isGoingForward.current = true;
      const nextIndex = findNextIndex(fromIndex, "forward");
      if (nextIndex !== fromIndex) {
        transitionTo(nextIndex);
      } else {
        setCompleted(true);
      }
    },
    [findNextIndex, transitionTo]
  );

  const goNext = useCallback(() => {
    const currentQ = QUESTIONS[currentIndex];

    if (
      currentQ.conditional &&
      !showConditional &&
      currentQ.conditional.showWhen(formDataRef.current)
    ) {
      setShowConditional(true);
      return;
    }

    advanceOrComplete(currentIndex);
  }, [currentIndex, showConditional, advanceOrComplete]);

  const goBack = useCallback(() => {
    if (showConditional) {
      setShowConditional(false);
      return;
    }
    isGoingForward.current = false;
    const prevIndex = findNextIndex(currentIndex, "backward");
    if (prevIndex !== currentIndex) {
      transitionTo(prevIndex);
    }
  }, [currentIndex, showConditional, findNextIndex, transitionTo]);

  // Centralized selection handler
  const handleSelection = useCallback(
    (field: keyof TypeformFormData, value: string | null) => {
      if (autoAdvanceTimerRef.current)
        clearTimeout(autoAdvanceTimerRef.current);

      updateData({ [field]: value });

      if (value === null) {
        const currentQ = QUESTIONS[currentIndex];
        if (showConditional && currentQ.conditional) {
          setShowConditional(false);
          updateData({ [currentQ.conditional.subField]: null });
        }
        return;
      }

      const nextData = { ...formDataRef.current, [field]: value };
      formDataRef.current = nextData;

      const currentQ = QUESTIONS[currentIndex];

      if (currentQ.conditional && currentQ.conditional.showWhen(nextData)) {
        setShowConditional(true);
        return;
      }

      if (showConditional) {
        setShowConditional(false);
      }

      autoAdvanceTimerRef.current = setTimeout(() => {
        advanceOrComplete(currentIndex);
      }, 300);
    },
    [currentIndex, showConditional, updateData, advanceOrComplete]
  );

  // Handle interstitial auto-advance
  const currentQ = QUESTIONS[currentIndex];
  useEffect(() => {
    if (
      currentQ?.type === "interstitial" &&
      !isExiting &&
      isGoingForward.current
    ) {
      interstitialTimerRef.current = setTimeout(() => {
        advanceOrComplete(currentIndex);
      }, currentQ.interstitialDuration ?? 2000);

      return () => {
        if (interstitialTimerRef.current)
          clearTimeout(interstitialTimerRef.current);
      };
    }
  }, [currentIndex, currentQ, isExiting, advanceOrComplete]);

  // When driver's licence is set to "No", default car to "No"
  useEffect(() => {
    if (formData.drivers_license_required === "No") {
      setFormData((prev) => ({ ...prev, car_required: "No" }));
    }
  }, [formData.drivers_license_required]);

  // Auto-save when form completes
  const hasSaved = useRef(false);
  useEffect(() => {
    if (completed && !hasSaved.current) {
      hasSaved.current = true;
      saveTypeformPosition(formData, { callAt }).then(
        (result) => {
          if (result.success) {
            // Brief 04 §0a.3 (04b rework W8): the server decides (the call popup over her Childcare tab, or today's).
            router.push(result.redirectTo ?? "/parent");
          } else {
            setSubmitError(result.error);
          }
        },
        // F-7: only a rejected save (a network drop) shows the error and Try again, not an endless spinner; a throw
        // after a save that worked isn't reported as a failed save.
        () => setSubmitError("Failed to save position"),
      );
    }
  }, [completed, formData, router, callAt, saveAttempt]);

  if (intro) return <PositionIntro onDone={() => setIntro(false)} />;

  // Form complete — show finalizing spinner
  if (completed) {
    return (
      <div className="flex flex-col items-center justify-center h-[calc(100vh-10rem)] gap-6">
        {submitError ? (
          <div className="text-center space-y-3">
            <p className="text-red-600 text-sm">{submitError}</p>
            <button
              type="button"
              onClick={() => { hasSaved.current = false; setSubmitError(null); setSaveAttempt((n) => n + 1); }}
              className="px-5 py-2 rounded-lg bg-violet-600 text-white text-sm font-medium hover:bg-violet-700 transition-colors"
            >
              Try again
            </button>
          </div>
        ) : (
          <>
            <div className="h-10 w-10 rounded-full border-4 border-violet-200 border-t-violet-600 animate-spin" />
            <p className="text-lg font-semibold text-slate-700">
              Finalizing your childcare position...
            </p>
          </>
        )}
      </div>
    );
  }

  const progress = ((currentIndex + 1) / QUESTIONS.length) * 100;

  // Render conditional content (appears BELOW the options)
  const renderConditional = (
    cond: NonNullable<(typeof QUESTIONS)[number]["conditional"]>
  ) => {
    if (cond.subType === "textarea") {
      return (
        <div className="flex flex-col gap-3">
          {cond.subLabel && (
            <p className="text-sm font-medium text-slate-600">
              {cond.subLabel}
            </p>
          )}
          <textarea
            value={(formData[cond.subField] as string) ?? ""}
            onChange={(e) =>
              updateData({ [cond.subField]: e.target.value || null })
            }
            placeholder={cond.subPlaceholder}
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800 focus:border-violet-500 focus:ring-1 focus:ring-violet-500 outline-none min-h-[80px] resize-y"
            autoFocus
          />
          <div className="flex items-center gap-3">
            <Button
              onClick={goNext}
              className="bg-violet-600 hover:bg-violet-700 text-white py-2.5 px-6 rounded-lg font-medium text-sm"
            >
              Continue
            </Button>
            {cond.subOptOut && (
              <button
                type="button"
                onClick={() => {
                  updateData({ [cond.subField]: cond.subOptOut!.value });
                  setTimeout(() => goNext(), 300);
                }}
                className="text-sm text-slate-400 hover:text-slate-600 transition-colors"
              >
                {cond.subOptOut.label}
              </button>
            )}
          </div>
        </div>
      );
    }

    if (cond.subType === "date-input") {
      const today = new Date().toISOString().split("T")[0];
      return (
        <div className="flex flex-col gap-3">
          {cond.subLabel && (
            <p className="text-sm font-medium text-slate-600">
              {cond.subLabel}
            </p>
          )}
          <input
            type="date"
            min={today}
            value={(formData[cond.subField] as string) ?? ""}
            onChange={(e) =>
              updateData({ [cond.subField]: e.target.value || null })
            }
            className="w-full py-2.5 px-3 rounded-lg border border-slate-200 text-sm text-slate-800 focus:border-violet-500 focus:ring-1 focus:ring-violet-500 outline-none"
          />
          {(formData[cond.subField] as string) && (
            <Button
              onClick={goNext}
              className="bg-violet-600 hover:bg-violet-700 text-white py-2.5 px-6 rounded-lg font-medium text-sm"
            >
              Continue
            </Button>
          )}
        </div>
      );
    }

    if (cond.subType === "grid-select") {
      return (
        <div className="flex flex-col gap-3">
          {cond.subLabel && (
            <p className="text-sm font-medium text-slate-600">
              {cond.subLabel}
            </p>
          )}
          <div className="grid grid-cols-2 gap-2">
            {(cond.subOptions ?? []).map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => {
                  updateData({ [cond.subField]: opt.value });
                  setTimeout(() => goNext(), 300);
                }}
                className={`px-3 py-2.5 rounded-lg border text-sm font-medium text-center cursor-pointer transition-all duration-150 ${
                  (formData[cond.subField] as string) === opt.value
                    ? "bg-violet-500 text-white border-violet-500"
                    : "bg-white text-slate-600 border-slate-200 hover:bg-slate-100 hover:text-slate-900"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      );
    }

    // text-input conditional
    return (
      <TextInput
        value={(formData[cond.subField] as string) ?? ""}
        onChange={(val) => updateData({ [cond.subField]: val || null })}
        onAdvance={goNext}
        label={cond.subLabel}
        placeholder={cond.subPlaceholder}
      />
    );
  };

  // Render the current question's content
  const renderQuestion = () => {
    switch (currentQ.type) {
      case "single-select":
      case "boolean":
        return (
          <div className="flex flex-col gap-3">
            <SingleSelect
              options={currentQ.options ?? []}
              selected={
                currentQ.field
                  ? (formData[currentQ.field] as string | null) ?? null
                  : null
              }
              onSelect={(val) => {
                if (currentQ.field) {
                  handleSelection(currentQ.field, val);
                }
              }}
              columns={currentQ.columns}
            />
            {showConditional && currentQ.conditional && (
              <div className="transition-all duration-300 ease-out">
                {renderConditional(currentQ.conditional)}
              </div>
            )}
          </div>
        );

      case "multi-select":
        return (
          <MultiSelect
            options={currentQ.options ?? []}
            selected={[]}
            onToggle={() => {}}
            onAdvance={goNext}
          />
        );

      case "compound-children":
        return (
          <ChildrenCompound
            data={formData}
            updateData={updateData}
            onAdvance={goNext}
          />
        );

      case "suburb-autocomplete":
        return (
          <SuburbAutocomplete
            data={formData}
            updateData={updateData}
            onAdvance={goNext}
          />
        );

      case "compound-days-times":
        return (
          <DaysTimesCompound
            data={formData}
            updateData={updateData}
            onAdvance={goNext}
          />
        );

      default:
        return null;
    }
  };

  // Interstitial screen
  if (currentQ.type === "interstitial") {
    return <Interstitial text={currentQ.interstitialText ?? ""} progress={progress} exiting={isExiting} />;
  }

  // Compound questions — top-down flow
  if (
    currentQ.type === "compound-children" ||
    currentQ.type === "compound-days-times"
  ) {
    return (
      <div
        className={`relative flex flex-col min-h-[calc(100vh-10rem)] transition-opacity duration-200 ${
          isExiting ? "opacity-0" : "opacity-100"
        }`}
      >
        <div className="-mx-4 -mt-4 lg:-mx-6 lg:-mt-6">
          <div className="h-1 bg-slate-100">
            <div
              className="h-full bg-violet-600 transition-all duration-500 ease-out rounded-r-full"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>

        {currentIndex > 0 && (
          <button
            type="button"
            onClick={goBack}
            className="absolute top-3 left-0 p-1.5 text-slate-400 hover:text-slate-600 transition-colors z-10"
          >
            <svg
              className="h-5 w-5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M15 19l-7-7 7-7"
              />
            </svg>
          </button>
        )}

        <div className="text-center pt-8 pb-4 px-4">
          <h2 className="text-xl sm:text-2xl font-semibold text-slate-800 leading-snug">
            {currentQ.question}
          </h2>
        </div>

        {/* Content — top-down flow, options at top, expand below */}
        <div className="flex-1 px-2 pb-6">
          {renderQuestion()}
        </div>
      </div>
    );
  }

  // Standard question — QuestionShell
  return (
    <div
      className={`transition-opacity duration-200 ${
        isExiting ? "opacity-0" : "opacity-100"
      }`}
    >
      <QuestionShell
        key={currentIndex}
        question={currentQ.question}
        subtitle={currentQ.subtitle}
        progress={progress}
        showBack={currentIndex > 0}
        onBack={goBack}
      >
        {renderQuestion()}
      </QuestionShell>
    </div>
  );
}
