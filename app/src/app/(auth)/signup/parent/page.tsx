"use client";

import { useState, useEffect, Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { createClient } from "@/lib/supabase/client";
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
import { recordConsent } from "@/lib/legal/record-consent";
import { AGR01_CHECKPOINTS } from "@/lib/legal/checkpoints";
import { ConsentCheckboxGroup } from "@/components/legal/ConsentCheckboxGroup";
import { INVITE_TOKEN_REGEX } from "@/lib/invite/redirect";
import {
  parseFunnelSource,
  funnelSourceToSignupSource,
} from "@/lib/funnel/source";
import { ArrowLeft, Check, Loader2 } from "lucide-react";
import { formatUkMobile, isUkMobile } from "@/lib/uk-contact";

const parentSignupSchema = z
  .object({
    email: z.string().email("Please enter a valid email address"),
    mobile: z
      .string()
      .min(1, "Mobile number is required")
      .refine((v) => isUkMobile(v), {
        message: "Please enter a valid UK mobile (07XXX XXX XXX)",
      }),
    password: z.string().min(8, "Password must be at least 8 characters"),
    confirmPassword: z.string(),
    firstName: z.string().min(1, "First name is required"),
    lastName: z.string().min(1, "Last name is required"),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

type ParentSignupFormData = z.infer<typeof parentSignupSchema>;

function ParentSignupForm() {
  const searchParams = useSearchParams();
  const rawInviteToken = searchParams.get("invite");
  // Only carry the token forward if it matches the canonical XXXX-XXXX
  // shape — never echo arbitrary `?invite=` content into FormData or
  // the Sign-in pivot href.
  const inviteToken =
    rawInviteToken && INVITE_TOKEN_REGEX.test(rawInviteToken)
      ? rawInviteToken
      : null;
  // T-039 Slice E-prime: URL ?src writes signupSource for attribution.
  // 'std' / 'adv' map via the canonical helper in lib/funnel/source.ts.
  // Otherwise null (this form leaves signupSource unset, matching prior
  // behaviour — referrer fallback for this route is a separate follow-up).
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

  // Clear any stale session when user lands on auth page
  useEffect(() => {
    const supabase = createClient();
    supabase.auth.signOut();
  }, []);

  const form = useForm<ParentSignupFormData>({
    resolver: zodResolver(parentSignupSchema),
    defaultValues: {
      email: "",
      mobile: "",
      password: "",
      confirmPassword: "",
      firstName: "",
      lastName: "",
    },
  });

  const allConsentsChecked = AGR01_CHECKPOINTS.every(
    (cp) => consentChecked[cp.id],
  );

  async function onSubmit(data: ParentSignupFormData) {
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
    if (inviteToken) formData.append("invite_token", inviteToken);
    if (signupSourceFromUrl)
      formData.append("signupSource", signupSourceFromUrl);

    const result = await signUp(formData);

    if (result.error) {
      setError(result.error);
      setIsLoading(false);
      return;
    }

    // Record AGR-01 consent AFTER signUp so the auth session exists (fail-soft;
    // the UI gate already enforced consent — see /signup for the full rationale).
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
      <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-slate-50">
        <Loader2 className="h-8 w-8 animate-spin text-violet-600 mb-3" />
        <p className="text-sm text-slate-500">Setting up your account...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/signup"
          className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground mb-4"
        >
          <ArrowLeft className="w-4 h-4 mr-1" />
          Back
        </Link>
        <h1 className="text-2xl font-bold tracking-tight">
          Parent Registration
        </h1>
        <p className="text-sm text-muted-foreground mt-2">
          Create your account to find the perfect nanny
        </p>
      </div>

      {error && (
        <div className="bg-destructive/10 border border-destructive/20 text-destructive text-sm p-3 rounded-lg">
          {error}
        </div>
      )}

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <FormField
              control={form.control}
              name="firstName"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>First Name</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="John"
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
                  <FormLabel>Last Name</FormLabel>
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
                <FormLabel>Email</FormLabel>
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
                  <FormLabel>Mobile number</FormLabel>
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
                      <span className="sr-only"> is a valid mobile number</span>
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
                <FormLabel>Password</FormLabel>
                <FormControl>
                  <Input
                    type="password"
                    placeholder="Minimum 8 characters"
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
                <FormLabel>Confirm Password</FormLabel>
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

          <div>
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
            className="w-full"
            disabled={isLoading || !allConsentsChecked}
          >
            {isLoading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Creating account...
              </>
            ) : (
              "Create Account"
            )}
          </Button>
        </form>
      </Form>

      <div className="text-center text-sm">
        <span className="text-muted-foreground">Already have an account? </span>
        <Link
          href={
            // Token already validated above against INVITE_TOKEN_REGEX,
            // so we know it's URL-safe — no need to encodeURIComponent.
            inviteToken ? `/login?invite=${inviteToken}` : "/login"
          }
          className="text-primary font-medium hover:underline"
        >
          Sign in
        </Link>
      </div>
    </div>
  );
}

export default function ParentSignupPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      }
    >
      <ParentSignupForm />
    </Suspense>
  );
}
