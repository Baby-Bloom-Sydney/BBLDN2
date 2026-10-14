"use client";

/**
 * The sign-in page: email + password → `signIn` (server action), then the invite / safe redirect / role default.
 *
 * 3d follow-up (BB-LDN-3dfix-141026, finding 4 — hardening): the form declares `method="post"` and the fixed
 * same-page `action="/login"`, so a submit before hydration (no JS yet) never does the browser's default GET
 * with the password in the URL, history or server logs. With JS, `onSubmit` prevents the native submit as before.
 * Never: credentials in a query string; never drop `method`/`action` (guarded by `lib/auth/password-forms.test.ts`).
 */
import { useState, useEffect, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
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
import { signIn } from "@/lib/auth/actions";
import {
  resolveInviteRedirect,
  isSafeInternalPath,
} from "@/lib/invite/redirect";
import { Loader2 } from "lucide-react";

const loginSchema = z.object({
  email: z.string().email("Please enter a valid email address"),
  password: z.string().min(1, "Password is required"),
});

type LoginFormData = z.infer<typeof loginSchema>;

function LoginForm() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const redirectTo = searchParams.get("redirect");
  const inviteToken = searchParams.get("invite");
  const [isLoading, setIsLoading] = useState(false);
  const [isRedirecting, setIsRedirecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Clear any stale session when user lands on auth page directly
  // Skip when redirected from another page (e.g. BSR public page)
  useEffect(() => {
    if (!redirectTo) {
      const supabase = createClient();
      supabase.auth.signOut();
    }
  }, [redirectTo]);

  const form = useForm<LoginFormData>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      email: "",
      password: "",
    },
  });

  async function onSubmit(data: LoginFormData) {
    setIsLoading(true);
    setError(null);

    const formData = new FormData();
    formData.append("email", data.email);
    formData.append("password", data.password);

    const result = await signIn(formData);

    if (result.error) {
      setError(result.error);
      setIsLoading(false);
    } else if (result.redirectTo) {
      // Precedence: ?invite=... > validated ?redirect=... > server-action default.
      // BOTH user-supplied params go through validators so an attacker
      // can't bypass the invite-format check by also setting
      // `?redirect=https://evil.com`.
      const inviteDest = resolveInviteRedirect(inviteToken, "");
      const safeRedirect = isSafeInternalPath(redirectTo) ? redirectTo : "";
      const dest = inviteDest || safeRedirect || result.redirectTo;
      setIsRedirecting(true);
      router.push(dest);
    }
  }

  if (isRedirecting) {
    return (
      <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-slate-50">
        <Loader2 className="h-8 w-8 animate-spin text-violet-600 mb-3" />
        <p className="text-sm text-slate-500">Signing you in...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="text-center">
        <h1 className="text-2xl font-bold tracking-tight">Welcome back</h1>
        <p className="text-sm text-muted-foreground mt-2">
          Sign in to your account to continue
        </p>
      </div>

      {error && (
        <div className="bg-destructive/10 border border-destructive/20 text-destructive text-sm p-3 rounded-lg">
          {error}
        </div>
      )}

      <Form {...form}>
        <form method="post" action="/login" onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
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
                <div className="flex items-center justify-between">
                  <FormLabel>Password</FormLabel>
                  <Link
                    href="/forgot-password"
                    className="text-xs text-primary hover:underline"
                  >
                    Forgot password?
                  </Link>
                </div>
                <FormControl>
                  <Input
                    type="password"
                    placeholder="Enter your password"
                    autoComplete="current-password"
                    disabled={isLoading}
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <Button type="submit" className="w-full" disabled={isLoading}>
            {isLoading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Signing in...
              </>
            ) : (
              "Sign in"
            )}
          </Button>
        </form>
      </Form>

      <div className="text-center text-sm">
        <span className="text-muted-foreground">
          Don&apos;t have an account?{" "}
        </span>
        <Link
          href="/signup"
          className="text-primary font-medium hover:underline"
        >
          Sign up
        </Link>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="space-y-6">
          <div className="text-center">
            <h1 className="text-2xl font-bold tracking-tight">Welcome back</h1>
            <p className="text-sm text-muted-foreground mt-2">
              Sign in to your account to continue
            </p>
          </div>
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        </div>
      }
    >
      <LoginForm />
    </Suspense>
  );
}
