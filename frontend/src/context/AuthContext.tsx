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
  id: string; // UUID v4 — the public identifier (never the sequential integer PK)
  username: string;
  email: string;
  role: string;
}

interface AuthState {
  user: AuthUser | null;
  accessToken: string | null;
  csrfToken: string | null;
  isLoading: boolean;
}

interface AuthContextValue extends AuthState {
  login: (username: string, password: string) => Promise<void>;
  register: (username: string, email: string, password: string, inviteCode?: string) => Promise<void>;
  logout: () => Promise<void>;
  authFetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

let refreshPromise: Promise<string | null> | null = null;

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>({
    user: null,
    accessToken: null,
    csrfToken: null,
    isLoading: true,
  });
  const tokenRef = useRef<string | null>(state.accessToken);
  const csrfTokenRef = useRef<string | null>(state.csrfToken);

  useEffect(() => {
    tokenRef.current = state.accessToken;
    csrfTokenRef.current = state.csrfToken;
  }, [state.accessToken, state.csrfToken]);

  const fetchCsrfToken = useCallback(async (accessToken: string): Promise<string | null> => {
    try {
      const res = await fetch("/api/auth/csrf-token", {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!res.ok) return null;
      const data = await res.json();
      return typeof data.csrf_token === "string" ? data.csrf_token : null;
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/auth/refresh", { method: "POST" });
        if (res.ok) {
          const { access_token } = await res.json();
          const meRes = await fetch("/api/auth/me", {
            headers: { Authorization: `Bearer ${access_token}` },
          });
          const user = meRes.ok ? await meRes.json() : null;
          const csrfToken = user?.csrf_token || await fetchCsrfToken(access_token);
          setState({ user, accessToken: access_token, csrfToken, isLoading: false });
        } else {
          setState({ user: null, accessToken: null, csrfToken: null, isLoading: false });
        }
      } catch {
        setState({ user: null, accessToken: null, csrfToken: null, isLoading: false });
      }
    })();
  }, [fetchCsrfToken]);

  const silentRefresh = useCallback(async (): Promise<string | null> => {
    if (refreshPromise) return refreshPromise;
    refreshPromise = (async () => {
      try {
        const res = await fetch("/api/auth/refresh", { method: "POST" });
        if (res.ok) {
          const { access_token, csrf_token } = await res.json();
          const meRes = await fetch("/api/auth/me", {
            headers: { Authorization: `Bearer ${access_token}` },
          });
          const user = meRes.ok ? await meRes.json() : null;
          const nextCsrf = csrf_token || user?.csrf_token || await fetchCsrfToken(access_token);
          setState({ user, accessToken: access_token, csrfToken: nextCsrf, isLoading: false });
          return access_token as string;
        }
      } catch {
      }
      setState({ user: null, accessToken: null, csrfToken: null, isLoading: false });
      return null;
    })().finally(() => {
      refreshPromise = null;
    });
    return refreshPromise;
  }, [fetchCsrfToken]);

  const authFetch = useCallback(
    async (input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> => {
      const headers = new Headers(init.headers ?? {});
      if (tokenRef.current) headers.set("Authorization", `Bearer ${tokenRef.current}`);
      const method = (init.method ?? "GET").toUpperCase();
      const needsCsrf = method === "POST" || method === "PUT" || method === "PATCH" || method === "DELETE";
      if (needsCsrf && csrfTokenRef.current) {
        headers.set("X-Csrf-Token", csrfTokenRef.current);
      }

      let res = await fetch(input, { ...init, headers });
      if (res.status === 401) {
        const newToken = await silentRefresh();
        if (newToken) {
          headers.set("Authorization", `Bearer ${newToken}`);
          if (csrfTokenRef.current && needsCsrf) {
            headers.set("X-Csrf-Token", csrfTokenRef.current);
          }
          res = await fetch(input, { ...init, headers });
        }
      }
      return res;
    },
    [silentRefresh]
  );

  const login = useCallback(async (username: string, password: string) => {
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Login failed");
    const csrfToken = data.csrf_token || await fetchCsrfToken(data.access_token);
    setState({ user: data.user, accessToken: data.access_token, csrfToken, isLoading: false });
  }, [fetchCsrfToken]);

  const register = useCallback(
    async (username: string, email: string, password: string, inviteCode?: string) => {
      const body: Record<string, string> = { username, email, password };
      if (inviteCode) body.invite_code = inviteCode;
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Registration failed");
      const csrfToken = data.csrf_token || await fetchCsrfToken(data.access_token);
      setState({ user: data.user, accessToken: data.access_token, csrfToken, isLoading: false });
    },
    [fetchCsrfToken]
  );

  const logout = useCallback(async () => {
    try {
      await authFetch("/api/auth/logout", { method: "POST" });
    } catch {
    }
    setState({ user: null, accessToken: null, csrfToken: null, isLoading: false });
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
