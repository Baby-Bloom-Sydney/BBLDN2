import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { UserRole } from "@/lib/auth/types";

/**
 * The six demo/test roots answer only to an admin (5a, R-1). Matched as the
 * root itself or the root followed by "/" — `/test` and `/test/x`, never
 * `/testimonials`. Checked before the hub prefixes below, so
 * `/nanny/profiletest` is decided here and not by `/nanny`.
 */
const ADMIN_ONLY_DEMO_ROOTS = [
  "/nanny/profiletest",
  "/ui",
  "/ui2",
  "/brandkit1",
  "/test",
  "/bb/test",
] as const;

const ADMIN_ROLES: UserRole[] = ["admin", "super_admin"];

/** Hub prefixes; matched with `startsWith` (unchanged behaviour). */
const PROTECTED_ROUTES: Record<string, UserRole[]> = {
  "/nanny": ["nanny"],
  "/parent": ["parent"],
  "/admin": ADMIN_ROLES,
};

const AUTH_ROUTES = [
  "/login",
  "/signup",
  "/forgot-password",
  "/reset-password",
];

const ROLE_DASHBOARDS: Record<UserRole, string> = {
  nanny: "/nanny",
  parent: "/parent",
  admin: "/admin/dashboard",
  super_admin: "/admin/dashboard",
};

function isUnderRoot(pathname: string, root: string): boolean {
  return pathname === root || pathname.startsWith(`${root}/`);
}

function getRequiredRolesForPath(pathname: string): UserRole[] | null {
  if (ADMIN_ONLY_DEMO_ROOTS.some((root) => isUnderRoot(pathname, root))) {
    return ADMIN_ROLES;
  }
  for (const [route, roles] of Object.entries(PROTECTED_ROUTES)) {
    if (pathname.startsWith(route)) {
      return roles;
    }
  }
  return null;
}

function isAuthRoute(pathname: string): boolean {
  return AUTH_ROUTES.some((route) => pathname.startsWith(route));
}

async function getUserRole(
  supabase: ReturnType<typeof createServerClient>,
  userId: string,
): Promise<UserRole | null> {
  try {
    const { data, error } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", userId)
      .single();

    if (error || !data?.role) return null;
    return data.role as UserRole;
  } catch {
    return null;
  }
}

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({
    request,
  });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          supabaseResponse = NextResponse.next({
            request,
          });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // Refresh session - wrapped in try/catch to prevent middleware crashes
  let user = null;
  try {
    const { data } = await supabase.auth.getUser();
    user = data?.user ?? null;
  } catch {
    // Auth failed - treat as unauthenticated
    return supabaseResponse;
  }

  const pathname = request.nextUrl.pathname;
  const requiredRoles = getRequiredRolesForPath(pathname);
  const isAuth = isAuthRoute(pathname);

  // Protected route - no session → redirect to login
  if (requiredRoles && !user) {
    const redirectUrl = new URL("/login", request.url);
    redirectUrl.searchParams.set("redirect", pathname);
    return NextResponse.redirect(redirectUrl);
  }

  // Auth route with existing session → redirect to dashboard
  // Exceptions: /reset-password needs a session, /signup clears session itself
  if (
    isAuth &&
    user &&
    !pathname.startsWith("/reset-password") &&
    !pathname.startsWith("/signup")
  ) {
    const role = await getUserRole(supabase, user.id);
    if (role) {
      return NextResponse.redirect(new URL(ROLE_DASHBOARDS[role], request.url));
    }
  }

  // Narrow predicate: only `/` exactly — other public routes (/about,
  // /babysitting/[id], etc.) intentionally remain viewable when logged in.
  if (pathname === "/" && user) {
    const role = await getUserRole(supabase, user.id);
    // Guard the lookup against role strings outside the UserRole union
    // (dirty DB value would otherwise yield `new URL(undefined, ...)`
    // and a 307 to /undefined). Fall through on any unmappable value —
    // same fail-soft posture as the getUser() try/catch above.
    const dashboard = role ? ROLE_DASHBOARDS[role] : null;
    if (dashboard) {
      return NextResponse.redirect(new URL(dashboard, request.url));
    }
  }

  // Protected route with session → check role
  if (requiredRoles && user) {
    const role = await getUserRole(supabase, user.id);
    if (!role || !requiredRoles.includes(role)) {
      const dashboardPath = role ? ROLE_DASHBOARDS[role] : "/login";
      return NextResponse.redirect(new URL(dashboardPath, request.url));
    }
  }

  return supabaseResponse;
}
