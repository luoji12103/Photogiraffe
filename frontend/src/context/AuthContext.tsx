"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";

export interface AuthUser {
  id: number;
  username: string;
  email: string;
  role: string;
}

interface AuthState {
  user: AuthUser | null;
  accessToken: string | null;
  isLoading: boolean;
}

interface AuthContextValue extends AuthState {
  login: (username: string, password: string) => Promise<void>;
  register: (username: string, email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  /** Fetch wrapper that automatically injects the Bearer token and
   *  retries once after a transparent token refresh on 401. */
  authFetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/** A single pending refresh promise — prevents multiple concurrent refreshes. */
let refreshPromise: Promise<string | null> | null = null;

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>({
    user: null,
    accessToken: null,
    isLoading: true,
  });
  // Keep a ref that is always in sync with the latest token for the fetch helper
  const tokenRef = useRef<string | null>(null);
  tokenRef.current = state.accessToken;

  // ── Restore session on mount via refresh token cookie ────────────────────
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/auth/refresh", { method: "POST" });
        if (res.ok) {
          const { access_token } = await res.json();
          // Fetch user profile with the new token
          const meRes = await fetch("/api/auth/me", {
            headers: { Authorization: `Bearer ${access_token}` },
          });
          const user = meRes.ok ? await meRes.json() : null;
          setState({ user, accessToken: access_token, isLoading: false });
        } else {
          setState({ user: null, accessToken: null, isLoading: false });
        }
      } catch {
        setState({ user: null, accessToken: null, isLoading: false });
      }
    })();
  }, []);

  // ── Transparent token refresh helper ─────────────────────────────────────
  const silentRefresh = useCallback(async (): Promise<string | null> => {
    if (refreshPromise) return refreshPromise; // reuse in-flight promise
    refreshPromise = (async () => {
      try {
        const res = await fetch("/api/auth/refresh", { method: "POST" });
        if (res.ok) {
          const { access_token } = await res.json();
          const meRes = await fetch("/api/auth/me", {
            headers: { Authorization: `Bearer ${access_token}` },
          });
          const user = meRes.ok ? await meRes.json() : null;
          setState({ user, accessToken: access_token, isLoading: false });
          return access_token as string;
        }
      } catch { /* fall through */ }
      setState({ user: null, accessToken: null, isLoading: false });
      return null;
    })().finally(() => { refreshPromise = null; });
    return refreshPromise;
  }, []);

  // ── authFetch — auto-inject Bearer + retry once on 401 ───────────────────
  const authFetch = useCallback(
    async (input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> => {
      const headers = new Headers(init.headers ?? {});
      if (tokenRef.current) headers.set("Authorization", `Bearer ${tokenRef.current}`);

      let res = await fetch(input, { ...init, headers });
      if (res.status === 401) {
        const newToken = await silentRefresh();
        if (newToken) {
          headers.set("Authorization", `Bearer ${newToken}`);
          res = await fetch(input, { ...init, headers });
        }
      }
      return res;
    },
    [silentRefresh]
  );

  // ── login ──────────────────────────────────────────────────────────────────
  const login = useCallback(async (username: string, password: string) => {
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Login failed");
    setState({ user: data.user, accessToken: data.access_token, isLoading: false });
  }, []);

  // ── register ───────────────────────────────────────────────────────────────
  const register = useCallback(
    async (username: string, email: string, password: string) => {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, email, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Registration failed");
      setState({ user: data.user, accessToken: data.access_token, isLoading: false });
    },
    []
  );

  // ── logout ────────────────────────────────────────────────────────────────
  const logout = useCallback(async () => {
    try {
      await authFetch("/api/auth/logout", { method: "POST" });
    } catch { /* ignore errors during logout */ }
    setState({ user: null, accessToken: null, isLoading: false });
  }, [authFetch]);

  return (
    <AuthContext.Provider value={{ ...state, login, register, logout, authFetch }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
