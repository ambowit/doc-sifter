import { useState, useEffect, useCallback, useContext, createContext, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { queryClient } from "@/App";
import type { User, Session } from "@supabase/supabase-js";

export type UserRole = "admin" | "senior_lawyer" | "junior_lawyer" | "assistant";

export interface UserProfile {
  id: string;
  email: string;
  fullName: string | null;
  role: UserRole;
  organization: string | null;
  avatarUrl: string | null;
}

interface AuthState {
  user: User | null;
  session: Session | null;
  profile: UserProfile | null;
  isLoading: boolean;
  isAuthenticated: boolean;
}

export interface AuthContextValue extends AuthState {
  signInWithEmail: (email: string, password: string) => Promise<void>;
  signUpWithEmail: (email: string, password: string, fullName: string, organization?: string) => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
  updateProfile: (updates: Partial<Omit<UserProfile, "id" | "email">>) => Promise<void>;
  hasRole: (roles: UserRole | UserRole[]) => boolean;
  refetchProfile: () => void;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [authState, setAuthState] = useState<AuthState>({
    user: null,
    session: null,
    profile: null,
    isLoading: true,
    isAuthenticated: false,
  });

  const fetchProfile = useCallback(async (userId: string): Promise<UserProfile | null> => {
    try {
      const { data, error } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", userId)
        .single();

      if (error) {
        console.error("[AuthProvider] Error fetching profile:", error);
        return null;
      }

      return {
        id: data.id,
        email: data.email,
        fullName: data.full_name,
        role: data.role as UserRole,
        organization: data.organization,
        avatarUrl: data.avatar_url,
      };
    } catch (error) {
      console.error("[AuthProvider] Error in fetchProfile:", error);
      return null;
    }
  }, []);

  // Initialize auth — runs ONCE for the entire app
  useEffect(() => {
    let mounted = true;

    const loadingTimeout = setTimeout(() => {
      if (mounted) {
        setAuthState(prev => {
          if (prev.isLoading) {
            console.log("[AuthProvider] Loading timeout, forcing isLoading=false");
            return { ...prev, isLoading: false };
          }
          return prev;
        });
      }
    }, 5000);

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        console.log("[AuthProvider] Auth event:", event, session?.user?.email);
        if (!mounted) return;

        if ((event === "SIGNED_IN" || event === "INITIAL_SESSION") && session?.user) {
          const userId = session.user.id;
          const currentSession = session;
          // Defer Supabase call to avoid deadlock per docs
          setTimeout(async () => {
            if (!mounted) return;
            try {
              queryClient.invalidateQueries({ queryKey: ["projects"] });
              queryClient.invalidateQueries({ queryKey: ["current-project"] });
            } catch {}
            const profile = await fetchProfile(userId);
            if (mounted) {
              setAuthState({
                user: currentSession.user,
                session: currentSession,
                profile,
                isLoading: false,
                isAuthenticated: true,
              });
            }
          }, 0);
        } else if (event === "INITIAL_SESSION" && !session) {
          console.log("[AuthProvider] No session found");
          setAuthState({
            user: null, session: null, profile: null,
            isLoading: false, isAuthenticated: false,
          });
        } else if (event === "SIGNED_OUT") {
          console.log("[AuthProvider] Signed out");
          setAuthState({
            user: null, session: null, profile: null,
            isLoading: false, isAuthenticated: false,
          });
        } else if (event === "TOKEN_REFRESHED" && session?.user) {
          setAuthState(prev => ({ ...prev, session }));
        }
      }
    );

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (mounted && !session) {
        setAuthState(prev => prev.isLoading ? { ...prev, isLoading: false } : prev);
      }
    });

    return () => {
      mounted = false;
      clearTimeout(loadingTimeout);
      subscription.unsubscribe();
    };
  }, [fetchProfile]);

  const signInWithEmail = useCallback(async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
  }, []);

  const signUpWithEmail = useCallback(async (
    email: string, password: string, fullName: string, organization?: string
  ) => {
    const redirectUrl = `${window.location.origin}/auth/callback`;
    const { data, error } = await supabase.auth.signUp({
      email, password,
      options: { emailRedirectTo: redirectUrl, data: { full_name: fullName } },
    });
    if (error) throw error;
    if (data.user && organization) {
      await supabase.from("profiles").update({ organization }).eq("id", data.user.id);
    }
  }, []);

  const signInWithGoogle = useCallback(async () => {
    const redirectUrl = `${window.location.origin}/auth/callback`;
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: redirectUrl },
    });
    if (error) throw error;
  }, []);

  const signOut = useCallback(async () => {
    console.log("[AuthProvider] Signing out...");
    try { queryClient.clear(); } catch {}
    try {
      const keysToRemove = Object.keys(localStorage).filter(key =>
        key.includes("supabase") || key.includes("sb-") || key.includes("dd-organizer-current")
      );
      keysToRemove.forEach(key => localStorage.removeItem(key));
    } catch {}
    try { await supabase.auth.signOut(); } catch {}
  }, []);

  const updateProfile = useCallback(async (updates: Partial<Omit<UserProfile, "id" | "email">>) => {
    if (!authState.user) throw new Error("No authenticated user");
    const dbUpdates: Record<string, unknown> = {};
    if (updates.fullName !== undefined) dbUpdates.full_name = updates.fullName;
    if (updates.role !== undefined) dbUpdates.role = updates.role;
    if (updates.organization !== undefined) dbUpdates.organization = updates.organization;
    if (updates.avatarUrl !== undefined) dbUpdates.avatar_url = updates.avatarUrl;
    const { error } = await supabase.from("profiles").update(dbUpdates).eq("id", authState.user.id);
    if (error) throw error;
    const profile = await fetchProfile(authState.user.id);
    setAuthState(prev => ({ ...prev, profile }));
  }, [authState.user, fetchProfile]);

  const hasRole = useCallback((roles: UserRole | UserRole[]) => {
    if (!authState.profile) return false;
    const roleArray = Array.isArray(roles) ? roles : [roles];
    return roleArray.includes(authState.profile.role);
  }, [authState.profile]);

  const refetchProfile = useCallback(() => {
    if (authState.user) {
      fetchProfile(authState.user.id).then(profile => {
        setAuthState(prev => ({ ...prev, profile }));
      });
    }
  }, [authState.user, fetchProfile]);

  return (
    <AuthContext.Provider
      value={{
        ...authState,
        signInWithEmail,
        signUpWithEmail,
        signInWithGoogle,
        signOut,
        updateProfile,
        hasRole,
        refetchProfile,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
