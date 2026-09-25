"use client";

import { useState, useEffect, Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { signUp } from "@/lib/auth/actions";
import { createClient } from "@/lib/supabase/client";
import { recordConsent } from "@/lib/legal/record-consent";
import { AGR01_CHECKPOINTS } from "@/lib/legal/checkpoints";
import { ConsentCheckboxGroup } from "@/components/legal/ConsentCheckboxGroup";
import {
  parseFunnelSource,
  funnelSourceToSignupSource,
} from "@/lib/funnel/source";
import {
  Loader2,
  ShieldCheck,
  CheckCircle,
  ArrowRight,
  Check,
} from "lucide-react";
import { formatUkMobile, isUkMobile } from "@/lib/uk-contact";

const signupSchema = z
  .object({
    firstName: z.string().min(1, "First name is required"),
    lastName: z.string().min(1, "Last name is required"),
    email: z.string().email("Please enter a valid email address"),
    mobile: z
      .string()
      .min(1, "Mobile number is required")
      .refine((v) => isUkMobile(v), {
        message: "Please enter a valid UK mobile (07XXX XXX XXX)",
      }),
    password: z
      .string()
      .min(8, "Password must be at least 8 characters")
      .regex(/[0-9]/, "Password must include a number")
      .regex(/[^A-Za-z0-9]/, "Password must include a special character"),
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

type SignupFormData = z.infer<typeof signupSchema>;

function SignupForm() {
  const searchParams = useSearchParams();
  // T-039 Slice E-prime: URL ?src wins over referrer for attribution.
  // 'std' / 'adv' map via the canonical helper in lib/funnel/source.ts.
  // Otherwise fall back to the existing document.referrer heuristic below.
  const funnelSource = parseFunnelSource(searchParams.get("src"));
  const signupSourceFromUrl = funnelSource
    ? funnelSourceToSignupSource(funnelSource)
    : null;

  const [isLoading, setIsLoading] = useState(false);
  const [isRedirecting, setIsRedirecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [consentChecked, setConsentChecked] = useState<Record<string, boolean>>(
    {},
  );

  const allConsentsChecked = AGR01_CHECKPOINTS.every(
    (cp) => consentChecked[cp.id],
  );

  // Clear any stale session when user lands on auth page
  useEffect(() => {
    const supabase = createClient();
    supabase.auth.signOut();
  }, []);

  const form = useForm<SignupFormData>({
    resolver: zodResolver(signupSchema),
    defaultValues: {
      firstName: "",
      lastName: "",
      email: "",
      mobile: "",
      password: "",
      confirmPassword: "",
    },
  });

  async function onSubmit(data: SignupFormData) {
    if (!allConsentsChecked) return;
    setIsLoading(true);
    setError(null);

    const formData = new FormData();
    formData.append("email", data.email);
    formData.append("password", data.password);
    formData.append("firstName", data.firstName);
    formData.append("lastName", data.lastName);
    // Send raw user input — server is the canonical normalisation point
    // (signUp() calls normaliseUkMobile + isUkMobile defence-in-depth).
    formData.append("mobile_number", data.mobile);
    formData.append("role", "parent");

    // Determine signup source — URL ?src wins, else fall back to referrer.
    let source = signupSourceFromUrl;
    if (!source) {
      const ref = document.referrer || "";
      source = "direct";
      if (/\/nannies\/[^/]+/.test(ref)) source = "profile";
      else if (ref.includes("/nannies")) source = "browse";
      else if (ref.includes("/matchmaking/results")) source = "quick_match";
      else if (ref.includes("/matchmaking")) source = "advanced_match";
      else if (ref.includes("/babysitting/")) source = "bsr";
      else if (ref.includes("/position/")) source = "position";
      else if (ref.includes("/pricing")) source = "pricing";
    }
    formData.append("signupSource", source);

    const result = await signUp(formData);

    if (result.error) {
      setError(result.error);
      setIsLoading(false);
      return;
    }

    // Record AGR-01 consent AFTER signUp so the auth session exists —
    // recordConsent requires an authenticated user, so calling it before
    // signUp silently no-ops ("Not authenticated") and nothing lands in
    // consent_records. Fail-soft: the UI gate already enforced consent; a
    // record-write failure must not block the now-created account.
    try {
      await recordConsent(
        AGR01_CHECKPOINTS.map((cp) => ({
          agreementId: "AGR-01",
          checkpointId: cp.id,
          checkpointText: cp.text,
        })),
      );
    } catch {
      // non-blocking — consent record only
    }

    if (result.redirectTo) {
      setIsRedirecting(true);
      window.location.href = result.redirectTo;
    }
  }

  if (isRedirecting) {
    return (
      <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-white">
        <Loader2 className="h-8 w-8 animate-spin text-violet-500 mb-3" />
        <p className="text-sm text-slate-500">Setting up your account...</p>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-40 min-h-[100dvh] flex flex-col bg-white overflow-auto">
      {/* Decorative blobs */}
      <div className="absolute top-[-60px] right-[-40px] w-64 h-64 bg-violet-100 rounded-full blur-3xl opacity-50 pointer-events-none" />
      <div className="absolute bottom-[10%] left-[-60px] w-48 h-48 bg-violet-200 rounded-full blur-3xl opacity-30 pointer-events-none" />

      <div className="relative flex-1 flex flex-col items-center justify-center px-4 py-8">
        <div className="w-full max-w-md">
          {/* Form card */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
            <h2 className="text-xl font-bold text-slate-900 text-center mb-1">
              Create your parent account
            </h2>
            <p className="text-sm text-slate-400 text-center mb-5">
              Sign up to find the best childcare for your family
            </p>

            {error && (
              <div className="bg-red-50 border border-red-200 text-red-600 text-sm p-3 rounded-lg mb-4">
                {error}
              </div>
            )}

            <Form {...form}>
              <form
                onSubmit={form.handleSubmit(onSubmit)}
                className="space-y-3.5"
              >
                <div className="grid grid-cols-2 gap-3">
                  <FormField
                    control={form.control}
                    name="firstName"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs text-slate-500">
                          First name
                        </FormLabel>
                        <FormControl>
                          <Input
                            placeholder="Jane"
                            autoComplete="given-name"
                            disabled={isLoading}
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="lastName"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs text-slate-500">
                          Last name
                        </FormLabel>
                        <FormControl>
                          <Input
                            placeholder="Smith"
                            autoComplete="family-name"
                            disabled={isLoading}
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <FormField
                  control={form.control}
                  name="email"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs text-slate-500">
                        Email
                      </FormLabel>
                      <FormControl>
                        <Input
                          type="email"
                          placeholder="you@example.com"
                          autoComplete="email"
                          disabled={isLoading}
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="mobile"
                  render={({ field, fieldState }) => {
                    const valid = isUkMobile(field.value);
                    return (
                      <FormItem>
                        <FormLabel className="text-xs text-slate-500">
                          Mobile number
                        </FormLabel>
                        <div className="flex gap-2">
                          <div
                            aria-hidden="true"
                            className="flex h-10 flex-shrink-0 items-center rounded-md border border-slate-200 bg-slate-50 px-3 text-sm text-slate-700"
                          >
                            +44
                          </div>
                          <FormControl>
                            <Input
                              type="tel"
                              inputMode="numeric"
                              autoComplete="tel-national"
                              placeholder="07XXX XXX XXX"
                              maxLength={13}
                              disabled={isLoading}
                              aria-invalid={fieldState.invalid}
                              {...field}
                              onChange={(e) => {
                                const cleaned = e.target.value.replace(
                                  /[^0-9 ]/g,
                                  "",
                                );
                                field.onChange(cleaned);
                              }}
                            />
                          </FormControl>
                        </div>
                        {valid && (
                          <p
                            className="flex items-center gap-1 text-xs font-medium text-green-700"
                            role="status"
                            aria-live="polite"
                          >
                            {formatUkMobile(field.value)}
                            <span className="sr-only">
                              {" "}
                              is a valid mobile number
                            </span>
                            <Check className="h-3 w-3" aria-hidden="true" />
                          </p>
                        )}
                        <FormMessage />
                      </FormItem>
                    );
                  }}
                />

                <FormField
                  control={form.control}
                  name="password"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs text-slate-500">
                        Password
                      </FormLabel>
                      <FormControl>
                        <Input
                          type="password"
                          placeholder="Create your password"
                          autoComplete="new-password"
                          disabled={isLoading}
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="confirmPassword"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs text-slate-500">
                        Confirm password
                      </FormLabel>
                      <FormControl>
                        <Input
                          type="password"
                          placeholder="Confirm your password"
                          autoComplete="new-password"
                          disabled={isLoading}
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <div className="pt-2">
                  <ConsentCheckboxGroup
                    checkpoints={AGR01_CHECKPOINTS}
                    checked={consentChecked}
                    onChange={(id, checked) =>
                      setConsentChecked((prev) => ({ ...prev, [id]: checked }))
                    }
                  />
                </div>

                <Button
                  type="submit"
                  className="w-full h-12 bg-violet-500 hover:bg-violet-600 text-white font-semibold shadow-md shadow-violet-200"
                  disabled={isLoading || !allConsentsChecked}
                >
                  {isLoading ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Creating account...
                    </>
                  ) : (
                    <>
                      Create account
                      <ArrowRight className="ml-2 w-4 h-4" />
                    </>
                  )}
                </Button>
              </form>
            </Form>

            {/* Trust signals */}
            <div className="flex items-center justify-center gap-4 mt-6">
              <span className="inline-flex items-center gap-1 text-xs text-slate-400">
                <ShieldCheck className="w-3.5 h-3.5 text-green-500" />
                Vetted nannies
              </span>
              <span className="inline-flex items-center gap-1 text-xs text-slate-400">
                <CheckCircle className="w-3.5 h-3.5 text-violet-500" />
                Education-focused
              </span>
            </div>

            {/* Sign in link */}
            <p className="text-center text-sm mt-4">
              <span className="text-slate-400">Already have an account? </span>
              <Link
                href="/login"
                className="text-violet-500 font-medium hover:underline"
              >
                Sign in
              </Link>
            </p>

            {/* Nanny application link */}
            <p className="text-center text-sm mt-3">
              <span className="text-slate-400">Childcare Professional? </span>
              <Link
                href="/apply"
                className="text-violet-500 font-medium hover:underline"
              >
                Apply
              </Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function SignupPage() {
  return (
    <Suspense
      fallback={
        <div className="fixed inset-0 z-40 min-h-[100dvh] flex items-center justify-center bg-white">
          <Loader2 className="h-6 w-6 animate-spin text-violet-500" />
        </div>
      }
    >
      <SignupForm />
    </Suspense>
  );
}
