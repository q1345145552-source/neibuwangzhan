"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const stored = localStorage.getItem("authToken");
    if (stored) router.push("/");
  }, [router]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (!email.trim() || !password.trim()) {
      setError("请输入邮箱和密码");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "登录失败");
        setLoading(false);
        return;
      }
      const data = await res.json();
      localStorage.setItem("authToken", data.token);
      localStorage.setItem("currentUser", JSON.stringify(data.user));
      setLoading(false);
      router.push("/");
    } catch {
      setError("网络错误，请重试");
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--background)] px-4">
      <div className="w-full max-w-sm">
        {/* Brand mark */}
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-xl bg-[var(--primary)]">
            <span className="font-display text-lg font-medium text-[var(--primary-foreground)] tracking-tight">
              X
            </span>
          </div>
          <h1
            className="font-display text-2xl font-light tracking-tight text-[var(--foreground)]"
            style={{ textWrap: "balance" }}
          >
            湘泰内部管理系统
          </h1>
          <p className="mt-1.5 text-sm text-[var(--muted-foreground)]">
            输入账号密码，开始干活
          </p>
        </div>

        {/* Card */}
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-6 shadow-[0_4px_20px_rgba(0,0,0,0.06)]">
          <form onSubmit={handleSubmit} className="flex flex-col gap-5">
            {/* Email */}
            <div className="flex flex-col gap-2">
              <Label
                htmlFor="email"
                className="text-sm font-medium text-[var(--foreground)]"
              >
                邮箱
              </Label>
              <Input
                id="email"
                type="email"
                placeholder="name@company.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={loading}
                autoComplete="email"
                aria-describedby={error ? "login-error" : undefined}
                className="h-10"
              />
            </div>

            {/* Password */}
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <Label
                  htmlFor="password"
                  className="text-sm font-medium text-[var(--foreground)]"
                >
                  密码
                </Label>
                <button
                  type="button"
                  onClick={() => console.log("忘记密码")}
                  className="text-xs text-[var(--accent-foreground)] transition-colors hover:text-[var(--accent-foreground)]/70 focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:ring-offset-2"
                >
                  忘记密码？
                </button>
              </div>
              <Input
                id="password"
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={loading}
                autoComplete="current-password"
                aria-describedby={error ? "login-error" : undefined}
                className="h-10"
              />
            </div>

            {/* Remember me */}
            <div className="flex items-center gap-2">
              <Checkbox
                id="remember"
                checked={remember}
                onCheckedChange={(v) => setRemember(v === true)}
                disabled={loading}
              />
              <Label htmlFor="remember" className="text-sm text-[var(--muted-foreground)] cursor-pointer">
                记住我
              </Label>
            </div>

            {/* Error */}
            <div role="alert" aria-live="polite">
              {error && (
                <p id="login-error" className="rounded-md bg-[color-mix(in_oklch,var(--destructive),var(--background)_90%)] px-3 py-2 text-xs text-[var(--destructive)]">
                  {error}
                </p>
              )}
            </div>

            {/* Submit */}
            <Button
              type="submit"
              disabled={loading}
              size="lg"
              className="h-10 w-full"
            >
              {loading ? "登录中..." : "登录"}
            </Button>
          </form>
        </div>

        <p className="mt-6 text-center text-xs text-[var(--muted-foreground)]">
          登不上？找 IT 帮忙
        </p>
      </div>
    </div>
  );
}
