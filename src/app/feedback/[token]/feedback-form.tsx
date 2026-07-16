"use client";

import { useState, useEffect, useCallback } from "react";

interface FeedbackData {
  token: string;
  order_id: string;
  submitted: boolean;
  submitted_at?: string;
  overall?: number;
  attitude?: number;
  speed?: number;
  professionalism?: number;
  comment?: string;
}

const dimensions = [
  { key: "overall", label: "总体评价" },
  { key: "attitude", label: "服务态度" },
  { key: "speed", label: "办理速度" },
  { key: "professionalism", label: "专业程度" },
] as const;

function StarRating({ value, onChange, disabled }: { value: number; onChange: (v: number) => void; disabled: boolean }) {
  const [hover, setHover] = useState(0);
  return (
    <div style={{ display: "flex", gap: 8, justifyContent: "center" }} onMouseLeave={() => setHover(0)}>
      {[1, 2, 3, 4, 5].map(i => {
        const filled = i <= (hover || value);
        return (
          <button
            key={i}
            type="button"
            disabled={disabled}
            onClick={() => onChange(i)}
            onMouseEnter={() => setHover(i)}
            style={{
              background: "none",
              border: "none",
              cursor: disabled ? "default" : "pointer",
              padding: 0,
              fontSize: 36,
              lineHeight: 1,
              color: filled ? "#f59e0b" : "#d1d5db",
              transition: "transform 0.1s, color 0.1s",
              transform: hover === i ? "scale(1.15)" : "scale(1)",
            }}
            aria-label={`${i} 星`}
          >
            ★
          </button>
        );
      })}
    </div>
  );
}

export function FeedbackForm({ token }: { token: string }) {
  const [data, setData] = useState<FeedbackData | null>(null);
  const [loading, setLoading] = useState(true);
  const [scores, setScores] = useState({ overall: 0, attitude: 0, speed: 0, professionalism: 0 });
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  useEffect(() => {
    fetch(`/api/client-feedback/public?token=${encodeURIComponent(token)}`)
      .then(r => r.json())
      .then(d => {
        setData(d);
        if (d.submitted) setDone(true);
      })
      .catch(() => setError("无法加载，请重试"))
      .finally(() => setLoading(false));
  }, [token]);

  const handleSubmit = async () => {
    const all = scores.overall && scores.attitude && scores.speed && scores.professionalism;
    if (!all) { setError("请完成所有评分"); return; }
    setSubmitting(true);
    setError("");
    try {
      const res = await fetch("/api/client-feedback/public", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, ...scores, comment: comment.trim() }),
      });
      const d = await res.json();
      if (!res.ok) { setError(d.error || "提交失败，请重试"); return; }
      setDone(true);
    } catch { setError("网络错误，请重试"); }
    setSubmitting(false);
  };

  if (loading) {
    return (
      <div style={s.container}>
        <div style={s.card}>
          <p style={{ color: "#9ca3af", fontSize: 15 }}>加载中...</p>
        </div>
      </div>
    );
  }

  if (done) {
    return (
      <div style={s.container}>
        <div style={s.card}>
          <div style={s.checkmark}>✓</div>
          <h2 style={s.companyName}>湘泰</h2>
          <h1 style={s.title}>感谢您的评价</h1>
          <p style={s.orderText}>订单 {data?.order_id || ""}</p>
          {data?.overall ? (
            <div style={{ margin: "20px 0" }}>
              <p style={{ fontSize: 14, color: "#6b7280", marginBottom: 12 }}>您的评分</p>
              {dimensions.map(dim => {
                const val = data?.[dim.key as keyof typeof data] as number || 0;
                return (
                  <div key={dim.key} style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, marginBottom: 4 }}>
                    <span style={{ fontSize: 13, color: "#6b7280", width: 80, textAlign: "right" }}>{dim.label}</span>
                    <span style={{ color: "#f59e0b", fontSize: 18 }}>{'★'.repeat(val)}{'☆'.repeat(5 - val)}</span>
                  </div>
                );
              })}
            </div>
          ) : null}
          <p style={{ fontSize: 13, color: "#9ca3af", marginTop: 16 }}>本链接已失效，如有疑问请联系我们</p>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div style={s.container}>
        <div style={s.card}>
          <div style={{ fontSize: 40, marginBottom: 16 }}>✕</div>
          <h1 style={s.title}>链接无效</h1>
          <p style={{ color: "#9ca3af", fontSize: 14 }}>{error || "评价链接不存在或已过期"}</p>
        </div>
      </div>
    );
  }

  return (
    <div style={s.container}>
      <div style={s.card}>
        <h2 style={s.companyName}>湘泰</h2>
        <h1 style={s.title}>服务评价</h1>
        <p style={s.orderText}>订单 {data.order_id}</p>
        <p style={s.subtitle}>请为本次服务打分</p>

        {dimensions.map(dim => (
          <div key={dim.key} style={{ marginBottom: 24 }}>
            <p style={s.dimLabel}>{dim.label}</p>
            <StarRating
              value={scores[dim.key]}
              onChange={v => setScores(prev => ({ ...prev, [dim.key]: v }))}
              disabled={submitting}
            />
          </div>
        ))}

        <div style={{ textAlign: "left", marginBottom: 20 }}>
          <p style={s.label}>意见或建议（选填）</p>
          <textarea
            value={comment}
            onChange={e => setComment(e.target.value)}
            placeholder="有什么想对我们说的..."
            rows={4}
            style={s.textarea}
          />
        </div>

        {error && <p style={{ color: "#dc2626", fontSize: 13, marginBottom: 12 }}>{error}</p>}

        <button
          onClick={handleSubmit}
          disabled={submitting}
          style={{
            ...s.submitBtn,
            ...(submitting ? { opacity: 0.6, cursor: "not-allowed" } : {}),
          }}
        >
          {submitting ? "提交中..." : "提交评价"}
        </button>
      </div>
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  container: {
    minHeight: "100vh",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "20px 16px",
    background: "linear-gradient(160deg, #f0f4f8 0%, #e2e8f0 40%, #cbd5e1 100%)",
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", sans-serif',
  },
  card: {
    background: "#fff",
    borderRadius: 20,
    padding: "36px 28px 32px",
    maxWidth: 420,
    width: "100%",
    boxShadow: "0 8px 40px rgba(0,0,0,0.08), 0 2px 8px rgba(0,0,0,0.04)",
    textAlign: "center" as const,
  },
  checkmark: {
    width: 56,
    height: 56,
    borderRadius: "50%",
    background: "linear-gradient(135deg, #059669, #10b981)",
    color: "#fff",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 28,
    fontWeight: 700,
    marginBottom: 16,
  },
  companyName: {
    fontSize: 18,
    fontWeight: 700,
    color: "#1e293b",
    margin: "0 0 4px",
    letterSpacing: 1,
  },
  title: {
    fontSize: 24,
    fontWeight: 700,
    color: "#0f172a",
    margin: "0 0 4px",
  },
  orderText: {
    fontSize: 14,
    color: "#94a3b8",
    margin: "0 0 4px",
    fontFamily: "monospace",
  },
  subtitle: {
    fontSize: 15,
    color: "#64748b",
    margin: "8px 0 16px",
  },
  dimLabel: {
    fontSize: 14,
    fontWeight: 600,
    color: "#334155",
    margin: "0 0 10px",
    letterSpacing: 0.5,
  },
  label: {
    fontSize: 13,
    color: "#64748b",
    display: "block",
    marginBottom: 8,
  },
  textarea: {
    width: "100%",
    padding: "12px 14px",
    borderRadius: 10,
    border: "1px solid #e2e8f0",
    fontSize: 14,
    resize: "vertical" as const,
    outline: "none",
    boxSizing: "border-box" as const,
    fontFamily: "inherit",
    background: "#f8fafc",
    transition: "border-color 0.2s",
  },
  submitBtn: {
    width: "100%",
    padding: "14px",
    borderRadius: 12,
    background: "linear-gradient(135deg, #1e293b, #334155)",
    color: "#fff",
    border: "none",
    fontSize: 16,
    fontWeight: 600,
    cursor: "pointer",
    transition: "opacity 0.2s, transform 0.1s",
    letterSpacing: 1,
  },
};
