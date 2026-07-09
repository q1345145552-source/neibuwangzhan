"use client";

import { createContext, useContext, useState, useEffect, useCallback } from "react";

export interface AuthUser {
  id: number;
  name: string;
  email: string;
  role: "admin" | "employee" | "client";
}

interface AuthContextValue {
  user: AuthUser | null;
  setUser: (u: AuthUser | null) => void;
  logout: () => void;
  token: string | null;
}

const AuthContext = createContext<AuthContextValue>({ user: null, setUser: () => {}, logout: () => {}, token: null });

export function useAuth() {
  return useContext(AuthContext);
}

export function getAuthToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("authToken");
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUserState] = useState<AuthUser | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // 启动时用 token 验证登录态
  useEffect(() => {
    const storedToken = localStorage.getItem("authToken");
    if (!storedToken) {
      Promise.resolve().then(() => setLoading(false));
      return;
    }
    fetch("/api/auth/me", {
      headers: { Authorization: `Bearer ${storedToken}` },
    })
      .then((res) => {
        if (!res.ok) throw new Error("invalid");
        return res.json();
      })
      .then((userData) => {
        setToken(storedToken);
        setUserState(userData);
        // 同步存一份用户信息方便读取（不敏感）
        localStorage.setItem("currentUser", JSON.stringify(userData));
      })
      .catch(() => {
        localStorage.removeItem("authToken");
        localStorage.removeItem("currentUser");
        setToken(null);
      })
      .finally(() => setLoading(false));
  }, []);

  const setUser = useCallback((u: AuthUser | null) => {
    setUserState(u);
    if (u) localStorage.setItem("currentUser", JSON.stringify(u));
    else localStorage.removeItem("currentUser");
  }, []);

  const logout = useCallback(() => {
    setUserState(null);
    setToken(null);
    localStorage.removeItem("authToken");
    localStorage.removeItem("currentUser");
  }, []);

  if (loading) return null;

  return (
    <AuthContext.Provider value={{ user, setUser, logout, token }}>
      {children}
    </AuthContext.Provider>
  );
}
