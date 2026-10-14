"use client";

/**
 * The nanny sign-up page → `signUp` with role nanny.
 *
 * 3d follow-up (BB-LDN-3dfix-141026, finding 4 — hardening): the form declares `method="post"` and the fixed
 * same-page `action="/signup/nanny"`, so a submit before hydration (no JS yet) never does the browser's default GET
 * with the password in the URL, history or server logs. With JS, `onSubmit` prevents the native submit as before.
 * Never: credentials in a query string; never drop `method`/`action` (guarded by `lib/auth/password-forms.test.ts`).
 */
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
import { AGR02_CHECKPOINTS } from "@/lib/legal/checkpoints";
import { ConsentCheckboxGroup } from "@/components/legal/ConsentCheckboxGroup";
import { INVITE_TOKEN_REGEX } from "@/lib/invite/redirect";
import { ArrowLeft, Loader2 } from "lucide-react";

const nannySignupSchema = z
  .object({
    email: z.string().email("Please enter a valid email address"),
    password: z
      .string()
      .min(8, "Password must be at least 8 characters")
      .regex(/[0-9]/, "Password must include a number")
      .regex(/[^A-Za-z0-9]/, "Password must include a special character"),
    confirmPassword: z.string(),
    firstName: z.string().min(1, "First name is required"),
    lastName: z.string().min(1, "Last name is required"),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

type NannySignupFormData = z.infer<typeof nannySignupSchema>;

function NannySignupForm() {
  const searchParams = useSearchParams();
  const rawInviteToken = searchParams.get("invite");
  const inviteToken =
    rawInviteToken && INVITE_TOKEN_REGEX.test(rawInviteToken)
      ? rawInviteToken
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

  const form = useForm<NannySignupFormData>({
    resolver: zodResolver(nannySignupSchema),
    defaultValues: {
      email: "",
      password: "",
      confirmPassword: "",
      firstName: "",
      lastName: "",
    },
  });

  const allConsentsChecked = AGR02_CHECKPOINTS.every(
    (cp) => consentChecked[cp.id],
  );

  async function onSubmit(data: NannySignupFormData) {
    if (!allConsentsChecked) return;
    setIsLoading(true);
    setError(null);

    try {
      await recordConsent(
        AGR02_CHECKPOINTS.map((cp) => ({
          agreementId: "AGR-02",
          checkpointId: cp.id,
          checkpointText: cp.text,
        })),
      );
    } catch {}

    const formData = new FormData();
    formData.append("email", data.email);
    formData.append("password", data.password);
    formData.append("firstName", data.firstName);
    formData.append("lastName", data.lastName);
    formData.append("role", "nanny");
    if (inviteToken) formData.append("invite_token", inviteToken);

    const result = await signUp(formData);

    if (result.error) {
      setError(result.error);
      setIsLoading(false);
    } else if (result.redirectTo) {
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
          Nanny Registration
        </h1>
        <p className="text-sm text-muted-foreground mt-2">
          Create your account to start connecting with families
        </p>
      </div>

      {error && (
        <div className="bg-destructive/10 border border-destructive/20 text-destructive text-sm p-3 rounded-lg">
          {error}
        </div>
      )}

      <Form {...form}>
        <form method="post" action="/signup/nanny" onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <FormField
              control={form.control}
              name="firstName"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>First Name</FormLabel>
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
              checkpoints={AGR02_CHECKPOINTS}
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

export default function NannySignupPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      }
    >
      <NannySignupForm />
    </Suspense>
  );
}
