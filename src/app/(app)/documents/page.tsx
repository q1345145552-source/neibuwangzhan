"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Search, Upload, Download, FileText, Trash2, Loader2 } from "lucide-react";
import { fetchAllDocuments, createGlobalDocument, uploadFile, deleteGlobalDocument } from "@/lib/api";
import { cn } from "@/lib/utils";

interface DocItem {
  id: number;
  order_id: string;
  name: string;
  file_type: string;
  status: string;
  uploaded_by: string;
  file_url: string;
  created_at: string;
  customer_name?: string;
  business_line_name?: string;
}

const statusClass: Record<string, string> = {
  "已审核": "bg-[color-mix(in_oklch,var(--success),var(--background)_85%)] text-[oklch(0.38_0.14_155)]",
  "待审核": "bg-[color-mix(in_oklch,var(--warning),var(--background)_85%)] text-[oklch(0.40_0.14_85)]",
  "已驳回": "bg-[color-mix(in_oklch,var(--destructive),var(--background)_92%)] text-[oklch(0.35_0.18_25)]",
};

export default function DocumentsPage() {
  const [search, setSearch] = useState("");
  const [documents, setDocuments] = useState<DocItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadDocuments = async () => {
    try {
      setLoading(true);
      const data = await fetchAllDocuments();
      setDocuments(data);
    } catch (err) {
      console.error("加载文档列表失败:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadDocuments();
  }, []);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadError("");
    setUploading(true);
    try {
      const result = await uploadFile(file);
      await createGlobalDocument({
        name: file.name,
        file_type: file.type || "",
        uploaded_by: "",
        file_url: result.url,
      });
      await loadDocuments();
      setUploadError("");
    } catch (err) {
      console.error("上传失败:", err);
      setUploadError(err instanceof Error ? err.message : "上传失败，请重试");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm("确定要删除此文档吗？")) return;
    try {
      await deleteGlobalDocument(id);
      await loadDocuments();
    } catch (err) {
      console.error("删除失败:", err);
      alert("删除失败，请重试");
    }
  };

  const filtered = useMemo(() => {
    if (!search) return documents;
    const s = search.toLowerCase();
    return documents.filter(
      (d) =>
        d.name.toLowerCase().includes(s) ||
        (d.business_line_name || "").toLowerCase().includes(s) ||
        (d.uploaded_by || "").toLowerCase().includes(s)
    );
  }, [search, documents]);

  const formatSize = (bytes?: number) => {
    if (!bytes) return "-";
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
    return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-display text-2xl font-light tracking-tight text-[var(--foreground)]" style={{ textWrap: "balance" }}>
            文档管理
          </h1>
          <p className="mt-1 text-sm text-[var(--muted-foreground)]">合同、资质、报告都在这儿，别弄丢了</p>
        </div>
        <div className="flex items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            onChange={handleUpload}
            accept=".pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png,.webp,.gif,.zip"
          />
          <Button
            size="sm"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
          >
            {uploading ? (
              <><Loader2 className="size-3.5 animate-spin" aria-hidden="true" />上传中...</>
            ) : (
              <><Upload className="size-3.5" aria-hidden="true" />上传文档</>
            )}
          </Button>
        </div>
      </div>

      {uploadError && (
        <p className="text-sm text-[var(--destructive)]">{uploadError}</p>
      )}

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

      {loading ? (
        <div className="py-12 text-center text-sm text-[var(--muted-foreground)]">加载中...</div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-[var(--border)] bg-[var(--background)]">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--border)]">
                <th className="py-3 px-4 text-left text-xs font-medium text-[var(--muted-foreground)] tracking-wide">文档名称</th>
                <th className="py-3 px-4 text-left text-xs font-medium text-[var(--muted-foreground)] tracking-wide max-md:hidden">类型</th>
                <th className="py-3 px-4 text-left text-xs font-medium text-[var(--muted-foreground)] tracking-wide max-md:hidden">业务线</th>
                <th className="py-3 px-4 text-left text-xs font-medium text-[var(--muted-foreground)] tracking-wide max-md:hidden">上传人</th>
                <th className="py-3 px-4 text-left text-xs font-medium text-[var(--muted-foreground)] tracking-wide max-sm:hidden">日期</th>
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
                  <td className="py-3 px-4 text-[var(--muted-foreground)] max-md:hidden">{doc.file_type || "-"}</td>
                  <td className="py-3 px-4 text-[var(--muted-foreground)] max-md:hidden">{doc.business_line_name || "-"}</td>
                  <td className="py-3 px-4 text-[var(--muted-foreground)] max-md:hidden">{doc.uploaded_by || "-"}</td>
                  <td className="py-3 px-4 font-mono text-xs tabular-nums text-[var(--muted-foreground)] max-sm:hidden">
                    {doc.created_at?.slice(0, 10) || "-"}
                  </td>
                  <td className="py-3 px-4">
                    <span className={cn("inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium", statusClass[doc.status] || statusClass["待审核"])}>
                      {doc.status}
                    </span>
                  </td>
                  <td className="py-3 px-4">
                    <div className="flex items-center gap-1">
                      {doc.file_url && (
                        <a
                          href={doc.file_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center justify-center rounded-md p-1 hover:bg-[var(--secondary)]"
                          aria-label="下载文档"
                        >
                          <Download className="size-3.5" aria-hidden="true" />
                        </a>
                      )}
                      <Button variant="ghost" size="icon-xs" aria-label="删除文档" onClick={() => handleDelete(doc.id)}>
                        <Trash2 className="size-3.5 text-[var(--destructive)]" aria-hidden="true" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {filtered.length === 0 && !loading && (
            <div className="py-12 text-center text-sm text-[var(--muted-foreground)]">没有匹配的文档</div>
          )}
        </div>
      )}
    </div>
  );
}
