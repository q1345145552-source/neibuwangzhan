"use client";

import { useState, useMemo, useEffect, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Search, Upload, Download, FileText, ArrowLeft } from "lucide-react";
import { fetchAllDocuments, uploadGlobalDocument, fetchOrders, fetchBusinessTypes } from "@/lib/api";
import type { Order } from "@/lib/api";
import { cn, fileUrl } from "@/lib/utils";

const statusClass: Record<string, string> = {
  approved: "bg-[color-mix(in_oklch,var(--success),var(--background)_85%)] text-[oklch(0.38_0.14_155)]",
  pending: "bg-[color-mix(in_oklch,var(--warning),var(--background)_85%)] text-[oklch(0.40_0.14_85)]",
  rejected: "bg-[color-mix(in_oklch,var(--destructive),var(--background)_92%)] text-[oklch(0.35_0.18_25)]",
};

const statusLabel: Record<string, string> = {
  approved: "已审核",
  pending: "待审核",
  rejected: "已驳回",
};


interface DocRecord {
  id?: number;
  document_name?: string;
  name?: string;
  status?: string;
  created_at?: string;
  order_id?: string;
  customer_name?: string;
  business_line?: string;
  direction?: string;
  file_type?: string;
  type?: string;
  uploaded_by?: string;
  uploadBy?: string;
  uploadDate?: string;
  size?: string;
  file_url?: string;
}

export default function DocumentsPage() {
  const [search, setSearch] = useState("");
  const router = useRouter();
  const searchParams = useSearchParams();
  const businessFilter = searchParams.get("biz");
  const [allDocs, setAllDocs] = useState<DocRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [orders, setOrders] = useState<Order[]>([]);
  const [selectedOrderId, setSelectedOrderId] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    async function load() {
      try {
        const data = await fetchAllDocuments();
        setAllDocs(data);
      } catch (err) {
        console.error("Docs load error:", err);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  // 加载订单列表，供"上传文档"时选择归属订单；如果当前是按业务线筛选进来的，只列该业务线下的订单
  useEffect(() => {
    async function loadOrders() {
      try {
        const types = await fetchBusinessTypes();
        const bt = businessFilter ? types.find((t) => t.name === businessFilter) : undefined;
        const data = await fetchOrders(bt ? { business_type_id: bt.id } : undefined);
        setOrders(data);
      } catch (err) {
        console.error("Orders load error:", err);
      }
    }
    loadOrders();
  }, [businessFilter]);

  const reload = () => {
    fetchAllDocuments().then(setAllDocs).catch((err) => console.error("Reload docs error:", err));
  };

  const handleUpload = async () => {
    const file = fileInputRef.current?.files?.[0];
    if (!file) {
      setUploadError("请选择文件");
      return;
    }
    setUploading(true);
    setUploadError("");
    try {
      // 1. Upload file
      const formData = new FormData();
      formData.append("file", file);
      const uploadRes = await fetch("/api/upload", {
        method: "POST",
        headers: { Authorization: `Bearer ${localStorage.getItem("authToken")}` },
        body: formData,
      });
      const uploadData = await uploadRes.json();
      if (!uploadRes.ok) throw new Error(uploadData.error || "文件上传失败");

      // 2. Create document record，关联到选中的订单（可不选）
      await uploadGlobalDocument({
        name: file.name,
        file_type: file.type,
        file_url: uploadData.url,
        order_id: selectedOrderId || undefined,
      });

      // 3. Reset and reload
      if (fileInputRef.current) fileInputRef.current.value = "";
      reload();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "上传失败，请重试";
      console.error("[上传文档] 失败:", msg, err);
      setUploadError(msg);
    } finally {
      setUploading(false);
    }
  };

  const filtered = useMemo(() => {
    let result = allDocs;
    if (businessFilter) {
      result = result.filter((d) => d.business_line === businessFilter);
    }
    if (search) {
      const s = search.toLowerCase();
      result = result.filter(
        (d) =>
          (d.name || '').toLowerCase().includes(s) ||
          (d.customer_name || '').toLowerCase().includes(s) ||
          (d.business_line || '').toLowerCase().includes(s) ||
          (d.uploaded_by || d.uploadBy || "").toLowerCase().includes(s)
      );
    }
    return result;
  }, [search, businessFilter, allDocs]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          {businessFilter && (
            <Button variant="ghost" size="icon-sm" onClick={() => router.back()} aria-label="返回"><ArrowLeft className="size-4" /></Button>
          )}
          <div>
            <h1 className="font-display text-2xl font-light tracking-tight text-[var(--foreground)]">
              {businessFilter ? businessFilter + " · 文档" : "文档管理"}
            </h1>
            <p className="mt-1 text-sm text-[var(--muted-foreground)]">合同、资质、报告都在这儿，别弄丢了</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={selectedOrderId}
            onChange={(e) => setSelectedOrderId(e.target.value)}
            aria-label="关联订单"
            className="h-9 max-w-[220px] rounded-md border border-[var(--border)] bg-[var(--background)] px-2 text-xs text-[var(--foreground)] outline-none focus:border-[var(--ring)] focus:ring-2 focus:ring-[var(--ring)]/20"
          >
            <option value="">不关联订单（可选）</option>
            {orders.map((o) => <option key={o.id} value={o.id}>{o.id} · {o.customer_name}</option>)}
          </select>
          <input ref={fileInputRef} type="file" className="hidden" onChange={handleUpload} />
          <Button size="sm" onClick={() => fileInputRef.current?.click()} disabled={uploading}>
            <Upload className="size-3.5" aria-hidden="true" />
            {uploading ? "上传中..." : "上传文档"}
          </Button>
        </div>
      </div>
      {uploadError && <div role="alert" className="rounded-md bg-[color-mix(in_oklch,var(--destructive),var(--background)_90%)] px-4 py-3 text-sm text-[var(--destructive)]">{uploadError}</div>}

      <div className="relative max-w-sm">
        <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-[var(--muted-foreground)]" />
        <Input
          placeholder="搜索文档名、业务线..."
          aria-label="搜索文档"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-9 pl-8 text-sm"
        />
      </div>

      <div className="overflow-x-auto rounded-xl border border-[var(--border)] bg-[var(--background)]">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--border)]">
              <th className="py-3 px-4 text-left text-xs font-medium text-[var(--muted-foreground)] tracking-wide">文档名称</th>
              <th className="py-3 px-4 text-left text-xs font-medium text-[var(--muted-foreground)] tracking-wide max-md:hidden">类型</th>
              <th className="py-3 px-4 text-left text-xs font-medium text-[var(--muted-foreground)] tracking-wide max-md:hidden">业务线</th>
              <th className="py-3 px-4 text-left text-xs font-medium text-[var(--muted-foreground)] tracking-wide max-md:hidden">上传人</th>
              <th className="py-3 px-4 text-left text-xs font-medium text-[var(--muted-foreground)] tracking-wide max-sm:hidden">日期</th>
              <th className="py-3 px-4 text-right text-xs font-medium text-[var(--muted-foreground)] tracking-wide max-sm:hidden">大小</th>
              <th className="py-3 px-4 text-left text-xs font-medium text-[var(--muted-foreground)] tracking-wide">状态</th>
              <th className="py-3 px-4 text-left text-xs font-medium text-[var(--muted-foreground)] tracking-wide w-16"></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((doc) => (
              <tr key={doc.id} className="border-b border-[var(--border)] transition-colors hover:bg-[var(--secondary)]">
                <td className="py-3 px-4">
                  <div className="flex items-center gap-2">
                    <FileText className="size-3.5 shrink-0 text-[var(--muted-foreground)]" />
                    <span className="truncate font-medium text-[var(--foreground)]">{doc.name}</span>
                  </div>
                </td>
                <td className="py-3 px-4 text-[var(--muted-foreground)] max-md:hidden">{doc.file_type || doc.type || ""}</td>
                <td className="py-3 px-4 text-[var(--muted-foreground)] max-md:hidden">{doc.business_line || ""}</td>
                <td className="py-3 px-4 text-[var(--muted-foreground)] max-md:hidden">{doc.uploaded_by || doc.uploadBy || ""}</td>
                <td className="py-3 px-4 font-mono text-xs tabular-nums text-[var(--muted-foreground)] max-sm:hidden">{doc.created_at?.slice(0, 10) || doc.uploadDate || ""}</td>
                <td className="py-3 px-4 text-right font-mono text-xs tabular-nums text-[var(--muted-foreground)] max-sm:hidden">{doc.size || ""}</td>
                <td className="py-3 px-4">
                  <span className={cn("inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium", statusClass[doc.status ?? ""])}>
                    {statusLabel[doc.status ?? ""]}
                  </span>
                </td>
                <td className="py-3 px-4">
                  <Button variant="ghost" size="icon-xs" aria-label="下载文档" onClick={() => { if (doc.file_url) window.open(fileUrl(doc.file_url), "_blank"); else setUploadError("该文档无可下载文件"); }}>
                    <Download className="size-3.5" aria-hidden="true" />
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && (
          <div className="py-12 text-center text-sm text-[var(--muted-foreground)]">没有匹配的文档</div>
        )}
      </div>
    </div>
  );
}
