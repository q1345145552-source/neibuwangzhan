"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { getStoredAuthToken } from "@/lib/auth-storage";
import { toThaiDate } from "@/lib/time";
import { NOTICE_PRINT_INSTRUCTION } from "@/lib/notice-rule-print";

interface PrintNotice { title: string; body: string; type: string; published_at: string; employee_name: string; company_name: string }

export default function NoticePrintPage() {
  const { id } = useParams<{ id: string }>();
  const [notice, setNotice] = useState<PrintNotice | null>(null);
  const [error, setError] = useState("");
  const [downloading, setDownloading] = useState(false);
  useEffect(() => {
    let active = true;
    const token = getStoredAuthToken();
    fetch(`/api/notice-rules/${id}/print`, { method: "POST", headers: { Authorization: `Bearer ${token}` } })
      .then(async response => { const data = await response.json(); if (!response.ok) throw new Error(data.error || "加载失败"); return data; })
      .then(data => { if (active) setNotice(data); })
      .catch(e => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [id]);

  async function downloadPdf() {
    setDownloading(true); setError("");
    try {
      const response = await fetch(`/api/notice-rules/${id}/pdf`, { headers: { Authorization: `Bearer ${getStoredAuthToken()}` } });
      if (!response.ok) { const data = await response.json(); throw new Error(data.error || "PDF 下载失败"); }
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a"); link.href = url; link.download = `${notice?.title || "通知规则"}.pdf`;
      document.body.appendChild(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (e) { setError(e instanceof Error ? e.message : "PDF 下载失败"); }
    finally { setDownloading(false); }
  }
  return <div className="notice-print-root">
    <style>{`
      .notice-print-root{min-height:100vh;background:#e9edf3;color:#111827;padding:20px;font-family:Arial,"Noto Sans SC",sans-serif}
      .print-controls{max-width:210mm;margin:0 auto 16px;display:flex;flex-wrap:wrap;gap:12px}
      .print-controls button{min-height:44px;padding:10px 20px;border-radius:8px;background:#1d4ed8;color:white;cursor:pointer;border:0}
      .print-controls button:disabled{opacity:.5;cursor:wait}
      .print-paper{box-sizing:border-box;max-width:210mm;min-height:297mm;margin:auto;padding:20mm;background:white;box-shadow:0 4px 20px #0001}
      .print-company{text-align:center;font-size:28px;font-weight:700;margin:0 0 24px}
      .print-title{text-align:center;font-size:24px;font-weight:700;margin:0 0 20px;overflow-wrap:anywhere}
      .print-meta{display:flex;flex-wrap:wrap;justify-content:space-between;gap:12px;font-size:13px}
      .print-type{padding:3px 10px;border:1px solid #9ca3af;border-radius:4px}
      .print-paper hr{border:0;border-top:1px solid #9ca3af;margin:20px 0}
      .print-body{white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.9;font-size:16px;text-align:left}
      .print-footer{break-inside:avoid;overflow-wrap:anywhere}
      .print-footer p{font-size:15px}.print-footer small{font-size:12px;color:#4b5563}
      .print-error{max-width:210mm;margin:12px auto;color:#b91c1c}
      @media(max-width:600px){.notice-print-root{padding:12px}.print-paper{padding:24px;min-height:0}.print-company{font-size:24px}.print-title{font-size:22px}.print-controls button{flex:1}}
      @page{size:A4 portrait;margin:20mm}
      @media print{.notice-print-root{padding:0;background:white}.print-controls,.print-error{display:none!important}.print-paper{padding:0;max-width:none;min-height:0;box-shadow:none}.print-title{break-after:avoid}.print-body{font-size:12pt}.print-meta{break-after:avoid}}
    `}</style>
    <div className="print-controls"><button disabled={!notice} onClick={() => window.print()}>直接打印</button><button disabled={!notice || downloading} onClick={downloadPdf}>{downloading ? "正在生成 PDF…" : "下载 PDF"}</button></div>
    {error && <p role="alert" className="print-error">{error}</p>}
    {!notice && !error && <p>正在准备打印内容…</p>}
    {notice && <article className="print-paper">
      <div className="print-company">{notice.company_name}</div>
      <h1 className="print-title">{notice.title}</h1>
      <div className="print-meta"><span className="print-type">{notice.type}</span><span>发布日期：{toThaiDate(notice.published_at)}</span></div>
      <hr /><div className="print-body">{notice.body}</div><hr />
      <div className="print-footer"><p>送达员工：{notice.employee_name}</p><small>{NOTICE_PRINT_INSTRUCTION}</small></div>
    </article>}
  </div>;
}
