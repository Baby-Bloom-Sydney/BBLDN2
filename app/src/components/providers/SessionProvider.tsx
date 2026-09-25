"use client";

import { useEffect, useState, useCallback } from "react";
import { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import { AuthContext } from "@/contexts/AuthContext";
import { UserRole, UserProfile } from "@/lib/auth/types";
import { BRAND } from "@/lib/constants";

const isDevMode = process.env.NEXT_PUBLIC_DEV_MODE === "true";

const DEV_PROFILES: Record<UserRole, UserProfile> = {
  nanny: {
    id: "dev-nanny-profile",
    user_id: "dev-nanny-user",
    first_name: "Emma",
    last_name: "Wilson",
    email: "emma@babybloom.dev",
    suburb: "Clapham",
    postcode: "SW4",
    profile_picture_url: null,
  },
  parent: {
    id: "dev-parent-profile",
    user_id: "dev-parent-user",
    first_name: "James",
    last_name: "Chen",
    email: "james@babybloom.dev",
    suburb: "Islington",
    postcode: "N1",
    profile_picture_url: null,
  },
  admin: {
    id: "dev-admin-profile",
    user_id: "dev-admin-user",
    first_name: "Bailey",
    last_name: "Admin",
    email: "admin@babybloom.dev",
    suburb: BRAND.city,
    postcode: "EC1",
    profile_picture_url: null,
  },
  super_admin: {
    id: "dev-admin-profile",
    user_id: "dev-admin-user",
    first_name: "Bailey",
    last_name: "Admin",
    email: "admin@babybloom.dev",
    suburb: BRAND.city,
    postcode: "EC1",
    profile_picture_url: null,
  },
};

function getDevRole(): UserRole {
  if (typeof window === "undefined") return "nanny";
  return (localStorage.getItem("bb-dev-role") as UserRole) || "nanny";
}

function DevSessionProvider({ children }: { children: React.ReactNode }) {
  const [role, setRole] = useState<UserRole>("nanny");

  useEffect(() => {
    setRole(getDevRole());
  }, []);

  const profile = DEV_PROFILES[role];

  const devUser = {
    id: profile.user_id,
    email: profile.email,
    app_metadata: {},
    user_metadata: {
      first_name: profile.first_name,
      last_name: profile.last_name,
    },
    aud: "authenticated",
    created_at: new Date().toISOString(),
  } as User;

  return (
    <AuthContext.Provider
      value={{
        user: devUser,
        role,
        profile,
        isLoading: false,
        signOut: async () => {
          window.location.href = "/";
        },
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

interface SessionProviderProps {
  children: React.ReactNode;
}

export function SessionProvider({ children }: SessionProviderProps) {
  if (isDevMode) {
    return <DevSessionProvider>{children}</DevSessionProvider>;
  }

  return <RealSessionProvider>{children}</RealSessionProvider>;
}

function RealSessionProvider({ children }: SessionProviderProps) {
  const [user, setUser] = useState<User | null>(null);
  const [role, setRole] = useState<UserRole | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const supabase = createClient();

  const fetchUserData = useCallback(
    async (userId: string) => {
      try {
        // Fetch role
        const { data: roleData, error: roleError } = await supabase
          .from("user_roles")
          .select("role")
          .eq("user_id", userId)
          .single();

        if (roleError) {
          console.error("Error fetching role:", roleError);
        } else if (roleData) {
          // Validate the value at the boundary instead of `as UserRole`
          // casting blindly. A whitespace / casing / unexpected value
          // from the DB would otherwise silently propagate through
          // `dashboardNavRole(...)` as null, suppressing the header +
          // tabs in production with no diagnostic.
          const VALID_ROLES = [
            "nanny",
            "parent",
            "admin",
            "super_admin",
          ] as const;
          const raw =
            typeof roleData.role === "string" ? roleData.role.trim() : "";
          const matched = (VALID_ROLES as readonly string[]).includes(raw)
            ? (raw as UserRole)
            : null;
          if (matched) {
            // eslint-disable-next-line no-console
            console.log("[auth] role set:", matched);
            setRole(matched);
          } else {
            console.error("Invalid role value from user_roles:", roleData.role);
          }
        } else {
          // eslint-disable-next-line no-console
          console.warn("[auth] user_roles returned no row for", userId);
        }

        // Fetch profile
        const { data: profileData, error: profileError } = await supabase
          .from("user_profiles")
          .select("*")
          .eq("user_id", userId)
          .single();

        if (profileError) {
          console.error("Error fetching profile:", profileError);
        } else if (profileData) {
          setProfile(profileData as UserProfile);
        }
      } catch (error) {
        console.error("Error fetching user data:", error);
      }
    },
    [supabase],
  );

  const clearUserData = useCallback(() => {
    setUser(null);
    setRole(null);
    setProfile(null);
  }, []);

  const handleSignOut = useCallback(async () => {
    clearUserData();
    try {
      // Clear server-side cookies first
      await fetch("/api/auth/signout", { method: "POST" });
    } catch {
      // Fallback: try client-side signout
      try {
        await supabase.auth.signOut();
      } catch {
        /* ignore */
      }
    }
    window.location.href = "/login";
  }, [supabase, clearUserData]);

  useEffect(() => {
    // Get initial session via `getSession()` — reads the local
    // cookie store. (We tried switching to `getUser()` to validate
    // the JWT server-side but on Vercel that call returned an
    // error/null silently in production for valid sessions, leaving
    // user state empty and the dashboard chrome unmounted.)
    const bootstrap = async () => {
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();

        // Diagnostic logs — tell us in production console exactly
        // what the auth bootstrap saw. Remove once stable.
        // eslint-disable-next-line no-console
        console.log(
          "[auth] bootstrap session.user:",
          session?.user?.id ?? null,
        );

        if (session?.user) {
          setUser(session.user);
          await fetchUserData(session.user.id);
        }
      } catch (error) {
        console.error("Error getting session:", error);
      } finally {
        setIsLoading(false);
      }
    };

    bootstrap();

    // Listen for auth changes
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === "SIGNED_IN" && session?.user) {
        setUser(session.user);
        await fetchUserData(session.user.id);
      } else if (event === "SIGNED_OUT") {
        clearUserData();
      } else if (event === "TOKEN_REFRESHED" && session?.user) {
        setUser(session.user);
      } else if (event === "USER_UPDATED" && session?.user) {
        setUser(session.user);
        await fetchUserData(session.user.id);
      }
      setIsLoading(false);
    });

    return () => {
      subscription.unsubscribe();
    };
  }, [supabase, fetchUserData, clearUserData]);

  return (
    <AuthContext.Provider
      value={{
        user,
        role,
        profile,
        isLoading,
        signOut: handleSignOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}
