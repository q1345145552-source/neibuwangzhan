"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { getStoredAuthToken, storeAuthSession } from "@/lib/auth-storage";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  // 还在用初始密码 123456 的账号，登录后先卡在改密界面，改完才放进系统
  const [mustChange, setMustChange] = useState(false);
  const [changeToken, setChangeToken] = useState("");
  const [newPwd, setNewPwd] = useState("");
  const [confirmPwd, setConfirmPwd] = useState("");

  useEffect(() => {
    const stored = getStoredAuthToken();
    if (stored) router.push("/");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
        body: JSON.stringify({ email, password, remember }),
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "登录失败");
        setLoading(false);
        return;
      }
      const data = await res.json();
      setLoading(false);
      if (data.must_change_password) {
        // 受限凭证只保存在当前页面内；服务端也会拒绝它访问所有业务接口。
        setChangeToken(data.token);
        setMustChange(true);
        return;
      }
      storeAuthSession(data.token, data.user, remember);
      router.push("/");
    } catch {
      setError("网络错误，请重试");
      setLoading(false);
    }
  }

  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (newPwd !== confirmPwd) {
      setError("两次输入的新密码不一致");
      return;
    }
    // 具体的强度规则由后端判定并返回中文提示，这里只挡最基本的
    if (newPwd.length < 8) {
      setError("新密码至少 8 位");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/auth/change-password", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${changeToken}`,
        },
        body: JSON.stringify({ current_password: password, new_password: newPwd }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "修改失败，请重试");
        setLoading(false);
        return;
      }
      setChangeToken("");
      setMustChange(false);
      setPassword("");
      setNewPwd("");
      setConfirmPwd("");
      setError("密码已修改，请使用新密码重新登录");
      setLoading(false);
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
            {mustChange ? "先设一个自己的密码，之后用新密码登录" : "输入账号密码，开始干活"}
          </p>
        </div>

        {/* 还在用初始密码：先改密码，改完才进系统 */}
        {mustChange ? (
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-6 shadow-[0_4px_20px_rgba(0,0,0,0.06)]">
            <form onSubmit={handleChangePassword} className="flex flex-col gap-5">
              <p className="rounded-md bg-[color-mix(in_oklch,var(--accent),var(--background)_85%)] px-3 py-2 text-xs text-[var(--foreground)]">
                你的账号还在用初始密码，为了安全需要先改掉。至少 8 位，不能全是数字。
              </p>

              <div className="flex flex-col gap-2">
                <Label htmlFor="newPwd" className="text-sm font-medium text-[var(--foreground)]">
                  新密码
                </Label>
                <Input
                  id="newPwd"
                  type="password"
                  placeholder="至少 8 位"
                  value={newPwd}
                  onChange={(e) => setNewPwd(e.target.value)}
                  disabled={loading}
                  autoComplete="new-password"
                  className="h-10"
                />
              </div>

              <div className="flex flex-col gap-2">
                <Label htmlFor="confirmPwd" className="text-sm font-medium text-[var(--foreground)]">
                  再输一次
                </Label>
                <Input
                  id="confirmPwd"
                  type="password"
                  placeholder="确认新密码"
                  value={confirmPwd}
                  onChange={(e) => setConfirmPwd(e.target.value)}
                  disabled={loading}
                  autoComplete="new-password"
                  className="h-10"
                />
              </div>

              <div role="alert" aria-live="polite">
                {error && (
                  <p className="rounded-md bg-[color-mix(in_oklch,var(--destructive),var(--background)_90%)] px-3 py-2 text-xs text-[var(--destructive)]">
                    {error}
                  </p>
                )}
              </div>

              <Button type="submit" disabled={loading} size="lg" className="h-10 w-full">
                {loading ? "保存中..." : "设置新密码并进入"}
              </Button>
            </form>
          </div>
        ) : (

        /* Card */
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
                {/* 系统没有接邮件服务，做不了自助重置。
                    原来这里 onClick 只是 console.log，点了完全没反应。 */}
                <button
                  type="button"
                  onClick={() => setError("忘记密码请找管理员重置，重置后用初始密码登录会要求你重新设置")}
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
        )}

        <p className="mt-6 text-center text-xs text-[var(--muted-foreground)]">
          登不上？找 IT 帮忙
        </p>
      </div>
    </div>
  );
}
