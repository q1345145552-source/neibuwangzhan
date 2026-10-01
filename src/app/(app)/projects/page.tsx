"use client";

import { useState, useEffect, useCallback } from "react";
import { fetchWithAuth } from "@/lib/api";
import { useAuth } from "@/components/auth-provider";
import { cn, toThaiTime } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Plus, X } from "lucide-react";

interface Project {
  id: number;
  name: string;
  description: string;
  assignee: string;
  current_phase: string;
  status: string;
  created_by: string;
  created_at: string;
}

const STATUS_CLASS: Record<string, string> = {
  "孵化中": "bg-[color-mix(in_oklch,var(--warning),var(--background)_85%)] text-[oklch(0.40_0.14_85)]",
  "已完成": "bg-[color-mix(in_oklch,var(--success),var(--background)_85%)] text-[oklch(0.38_0.14_155)]",
  "已搁置": "bg-[var(--muted)] text-[var(--muted-foreground)]",
};

export default function ProjectsPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const [projects, setProjects] = useState<Project[]>([]);
  const [employees, setEmployees] = useState<{ id: number; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: "", description: "", assignee: "" });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  const load = useCallback(() => {
    fetchWithAuth("/api/projects", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => setProjects(Array.isArray(d) ? d : []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  // 负责人下拉
  useEffect(() => {
    if (!isAdmin) return;
    fetchWithAuth("/api/employees").then((r) => r.json()).then((d) => setEmployees(Array.isArray(d) ? d : [])).catch(() => {});
  }, [isAdmin]);

  const openForm = () => {
    setForm({ name: "", description: "", assignee: "" });
    setErr("");
    setShowForm(true);
  };

  const handleSubmit = async () => {
    if (!form.name.trim()) { setErr("请填写项目名称"); return; }
    setSaving(true);
    setErr("");
    try {
      const res = await fetchWithAuth("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (res.ok) {
        setShowForm(false);
        load();
      } else {
        const e = await res.json().catch(() => ({}));
        setErr(e.error || "提交失败");
      }
    } catch { setErr("提交失败"); }
    finally { setSaving(false); }
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-light tracking-tight text-[var(--foreground)]">我的项目</h1>
          <p className="mt-1 text-sm text-[var(--muted-foreground)]">我的项目列表</p>
        </div>
        {isAdmin && (
          <Button size="sm" onClick={openForm} className="gap-1.5">
            <Plus className="size-3.5" />新建项目
          </Button>
        )}
      </div>

      {loading ? (
        <div className="py-12 text-center text-sm text-[var(--muted-foreground)]">加载中…</div>
      ) : projects.length === 0 ? (
        <div className="py-12 text-center text-sm text-[var(--muted-foreground)]">暂无项目</div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-[var(--border)]">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--border)] bg-[var(--secondary)]/50">
                <th className="py-3 px-5 text-left text-xs font-medium text-[var(--muted-foreground)]">项目名称</th>
                <th className="py-3 px-4 text-left text-xs font-medium text-[var(--muted-foreground)]">想法描述</th>
                <th className="py-3 px-4 text-left text-xs font-medium text-[var(--muted-foreground)]">负责人</th>
                <th className="py-3 px-4 text-left text-xs font-medium text-[var(--muted-foreground)]">阶段</th>
                <th className="py-3 px-4 text-left text-xs font-medium text-[var(--muted-foreground)]">状态</th>
                <th className="py-3 px-4 text-left text-xs font-medium text-[var(--muted-foreground)]">创建时间</th>
              </tr>
            </thead>
            <tbody>
              {projects.map((p) => (
                <tr key={p.id} className="border-b border-[var(--border)] hover:bg-[var(--secondary)]/30">
                  <td className="py-3 px-5 font-medium text-[var(--foreground)]">{p.name}</td>
                  <td className="py-3 px-4 text-[var(--muted-foreground)] max-w-[240px] truncate">{p.description || "—"}</td>
                  <td className="py-3 px-4 text-[var(--muted-foreground)]">{p.assignee || "—"}</td>
                  <td className="py-3 px-4 text-[var(--muted-foreground)]">{p.current_phase || "—"}</td>
                  <td className="py-3 px-4">
                    <span className={cn("inline-flex rounded-full px-2 py-0.5 text-xs font-medium", STATUS_CLASS[p.status] || "bg-[var(--muted)] text-[var(--muted-foreground)]")}>{p.status}</span>
                  </td>
                  <td className="py-3 px-4 text-xs text-[var(--muted-foreground)]">{toThaiTime(p.created_at) || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* 新建项目弹窗 */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => { if (!saving) setShowForm(false); }}>
          <div className="w-full max-w-md rounded-xl border border-[var(--border)] bg-[var(--background)] p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-[var(--foreground)]">新建项目</h3>
              <button onClick={() => setShowForm(false)} disabled={saving} className="text-[var(--muted-foreground)] hover:text-[var(--foreground)]"><X className="size-5" /></button>
            </div>

            <div className="mt-4 space-y-4">
              <div>
                <label className="mb-1 block text-xs text-[var(--muted-foreground)]">项目名称（必填）</label>
                <input
                  value={form.name}
                  onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
                  placeholder="项目叫什么"
                  className="w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)] outline-none focus:border-[var(--ring)]"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs text-[var(--muted-foreground)]">项目想法描述（选填）</label>
                <textarea
                  value={form.description}
                  onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
                  rows={3}
                  placeholder="这个项目是做什么的"
                  className="w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)] outline-none focus:border-[var(--ring)]"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs text-[var(--muted-foreground)]">负责人</label>
                <select
                  value={form.assignee}
                  onChange={(e) => setForm((p) => ({ ...p, assignee: e.target.value }))}
                  className="w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)] outline-none focus:border-[var(--ring)]"
                >
                  <option value="">请选择负责人</option>
                  {employees.map((e) => <option key={e.id} value={e.name}>{e.name}</option>)}
                </select>
              </div>

              {err && <p className="text-xs text-[var(--destructive)]">{err}</p>}
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setShowForm(false)} disabled={saving}>取消</Button>
              <Button size="sm" onClick={handleSubmit} disabled={saving}>{saving ? "提交中…" : "提交"}</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
