"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { fetchWithAuth } from "@/lib/api";
import { useAuth } from "@/components/auth-provider";
import { Plus, Trash2, Edit3, ArrowLeft } from "lucide-react";
import Link from "next/link";

interface Template {
  id: number; name: string; type: string; category: string;
  data_json: string; created_by: string; created_at: string;
}

const typeLabels: Record<string, string> = {
  contract: "合同", evaluation: "评估", finance: "费用",
};

export default function TemplatesPage() {
  const { user } = useAuth();
  const [templates, setTemplates] = useState<Template[]>([]);
  const [typeFilter, setTypeFilter] = useState("all");
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState({ name: "", type: "contract", category: "", data_json: "{}" });
  const [err, setErr] = useState("");
  const isAdmin = user?.role === "admin";

  const load = async () => {
    try {
      const url = typeFilter !== "all" ? `/api/templates?type=${typeFilter}` : "/api/templates";
      const res = await fetchWithAuth(url, { cache: "no-store" });
      setTemplates(await res.json());
    } catch {}
  };

  useEffect(() => { load(); }, [typeFilter]);

  const openCreate = () => {
    setEditId(null);
    setForm({ name: "", type: "contract", category: "", data_json: "{}" });
    setErr("");
    setShowForm(true);
  };

  const openEdit = (t: Template) => {
    setEditId(t.id);
    setForm({ name: t.name, type: t.type, category: t.category, data_json: t.data_json });
    setErr("");
    setShowForm(true);
  };

  const handleSave = async () => {
    if (!form.name.trim()) { setErr("请填写模板名称"); return; }
    try {
      if (editId) {
        await fetchWithAuth("/api/templates", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: editId, ...form }),
        });
      } else {
        await fetchWithAuth("/api/templates", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(form),
        });
      }
      setShowForm(false);
      load();
    } catch { setErr("保存失败"); }
  };

  const handleDelete = async (id: number) => {
    if (!confirm("确定删除此模板？")) return;
    await fetchWithAuth(`/api/templates?id=${id}`, { method: "DELETE" });
    load();
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/internal"><Button variant="ghost" size="icon-sm"><ArrowLeft className="size-4" /></Button></Link>
          <div>
            <h1 className="font-display text-2xl font-light tracking-tight text-[var(--foreground)]">模板库</h1>
            <p className="mt-1 text-sm text-[var(--muted-foreground)]">合同 · 评估 · 费用模板</p>
          </div>
        </div>
        {isAdmin && (
          <div className="flex items-center gap-2">
            <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)}
              className="h-8 rounded border border-[var(--border)] px-2 text-xs">
              <option value="all">全部类型</option>
              <option value="contract">合同</option>
              <option value="evaluation">评估</option>
              <option value="finance">费用</option>
            </select>
            <Button size="sm" onClick={openCreate}><Plus className="size-3.5" />新建模板</Button>
          </div>
        )}
      </div>

      {showForm && (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--background)] p-5">
          <h2 className="text-sm font-medium mb-4">{editId ? "编辑模板" : "新建模板"}</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="text-xs font-medium">模板名称</label>
              <input value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
                className="mt-1 w-full h-9 rounded border border-[var(--border)] px-3 text-sm outline-none focus:border-[var(--ring)]" />
            </div>
            <div>
              <label className="text-xs font-medium">类型</label>
              <select value={form.type} onChange={e => setForm(p => ({ ...p, type: e.target.value }))}
                className="mt-1 w-full h-9 rounded border border-[var(--border)] px-3 text-sm">
                <option value="contract">合同</option>
                <option value="evaluation">评估</option>
                <option value="finance">费用</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-medium">分类标签</label>
              <input value={form.category} onChange={e => setForm(p => ({ ...p, category: e.target.value }))}
                placeholder="例如：标准合同"
                className="mt-1 w-full h-9 rounded border border-[var(--border)] px-3 text-sm outline-none focus:border-[var(--ring)]" />
            </div>
            <div>
              <label className="text-xs font-medium">预设字段 (JSON)</label>
              <textarea value={form.data_json} onChange={e => setForm(p => ({ ...p, data_json: e.target.value }))} rows={3}
                className="mt-1 w-full rounded border border-[var(--border)] px-3 py-2 text-sm font-mono outline-none focus:border-[var(--ring)]" />
            </div>
          </div>
          {err && <p className="mt-2 text-xs text-[var(--destructive)]">{err}</p>}
          <div className="mt-3 flex gap-2">
            <Button size="sm" onClick={handleSave}>保存</Button>
            <Button variant="ghost" size="sm" onClick={() => setShowForm(false)}>取消</Button>
          </div>
        </div>
      )}

      <div className="rounded-xl border border-[var(--border)] bg-[var(--background)] overflow-hidden">
        {templates.length === 0 ? (
          <div className="py-12 text-center text-sm text-[var(--muted-foreground)]">暂无模板</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--border)] bg-[var(--muted)]/30">
                <th className="py-2.5 px-5 text-left text-xs font-medium">名称</th>
                <th className="py-2.5 px-4 text-left text-xs font-medium">类型</th>
                <th className="py-2.5 px-4 text-left text-xs font-medium">分类</th>
                <th className="py-2.5 px-4 text-left text-xs font-medium">创建人</th>
                <th className="py-2.5 px-4 text-left text-xs font-medium">创建时间</th>
                {isAdmin && <th className="py-2.5 px-4 text-left text-xs font-medium">操作</th>}
              </tr>
            </thead>
            <tbody>
              {templates.map(t => (
                <tr key={t.id} className="border-b border-[var(--border)] hover:bg-[var(--muted)]/20">
                  <td className="py-2.5 px-5 font-medium">{t.name}</td>
                  <td className="py-2.5 px-4">
                    <span className="text-xs px-1.5 py-0.5 rounded bg-[var(--muted)]">{typeLabels[t.type] || t.type}</span>
                  </td>
                  <td className="py-2.5 px-4 text-[var(--muted-foreground)]">{t.category || "—"}</td>
                  <td className="py-2.5 px-4">{t.created_by}</td>
                  <td className="py-2.5 px-4 text-[var(--muted-foreground)]">{t.created_at?.slice(0, 16)}</td>
                  {isAdmin && (
                    <td className="py-2.5 px-4 flex gap-1.5">
                      <Button size="sm" variant="ghost" className="h-6 text-xs" onClick={() => openEdit(t)}><Edit3 className="size-3" /></Button>
                      <Button size="sm" variant="ghost" className="h-6 text-xs text-red-500" onClick={() => handleDelete(t.id)}><Trash2 className="size-3" /></Button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
