import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  // DEV MODE: bypass all auth checks
  if (process.env.NEXT_PUBLIC_DEV_MODE === 'true') {
    return NextResponse.next();
  }

  // Fail CLOSED on missing or malformed Supabase configuration.
  // This guard used to `return NextResponse.next()`, which skipped session
  // management and served the entire application unauthenticated with no
  // error and no log line (LDN2 Stage 0 finding 6, `LEDGER/H1.md` §2).
  // A broken deploy must announce itself: unknown or unconfigured denies.
  const missing: string[] = [];
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL?.startsWith("http")) {
    missing.push("NEXT_PUBLIC_SUPABASE_URL");
  }
  if (!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    missing.push("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  }
  if (missing.length > 0) {
    // Variable names only — never the value of an environment variable.
    console.error(
      `middleware: refusing all requests — missing or malformed Supabase configuration: ${missing.join(", ")}`,
    );
    return new NextResponse("Service unavailable: configuration missing", {
      status: 503,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }

  return await updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - Public assets
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
