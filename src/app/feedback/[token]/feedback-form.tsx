"use client";

import { useState, useEffect } from "react";

interface FeedbackData {
  token: string;
  order_id: string;
  submitted: boolean;
  submitted_at?: string;
  score?: string;
  comment?: string;
}

export function FeedbackForm({ token }: { token: string }) {
  const [data, setData] = useState<FeedbackData | null>(null);
  const [loading, setLoading] = useState(true);
  const [score, setScore] = useState("");
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
    if (!score) { setError("请选择满意或不满意"); return; }
    setSubmitting(true);
    setError("");
    try {
      const res = await fetch("/api/client-feedback/public", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, score, comment: comment.trim() }),
      });
      const d = await res.json();
      if (!res.ok) { setError(d.error || "提交失败，请重试"); return; }
      setDone(true);
    } catch { setError("网络错误，请重试"); }
    setSubmitting(false);
  };

  if (loading) {
    return (
      <div style={style.container}>
        <div style={style.card}>
          <p style={style.loading}>加载中...</p>
        </div>
      </div>
    );
  }

  if (done) {
    return (
      <div style={style.container}>
        <div style={style.card}>
          <div style={style.icon}>✓</div>
          <h1 style={style.title}>感谢您的评价</h1>
          <p style={style.subtitle}>订单 {data?.order_id || ""} 已收到您的反馈</p>
          {data?.score && <p style={style.result}>{data.score === "满意" ? "😊 满意" : "😞 不满意"}</p>}
          <p style={style.footer}>本链接已失效，如有疑问请联系我们</p>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div style={style.container}>
        <div style={style.card}>
          <div style={style.icon}>✕</div>
          <h1 style={style.title}>链接无效</h1>
          <p style={style.subtitle}>{error || "评价链接不存在或已过期"}</p>
        </div>
      </div>
    );
  }

  return (
    <div style={style.container}>
      <div style={style.card}>
        <h1 style={style.title}>服务评价</h1>
        <p style={style.subtitle}>订单 {data.order_id}</p>
        <p style={style.question}>您对我们的服务满意吗？</p>

        <div style={style.buttons}>
          <button
            onClick={() => setScore("满意")}
            style={{ ...style.btn, ...(score === "满意" ? style.btnActiveGood : style.btnDefault) }}
          >
            <span style={style.emoji}>😊</span> 满意
          </button>
          <button
            onClick={() => setScore("不满意")}
            style={{ ...style.btn, ...(score === "不满意" ? style.btnActiveBad : style.btnDefault) }}
          >
            <span style={style.emoji}>😞</span> 不满意
          </button>
        </div>

        <div style={style.commentArea}>
          <label style={style.label}>意见或建议（选填）</label>
          <textarea
            value={comment}
            onChange={e => setComment(e.target.value)}
            placeholder="有什么想对我们说的..."
            rows={4}
            style={style.textarea}
          />
        </div>

        {error && <p style={style.error}>{error}</p>}

        <button
          onClick={handleSubmit}
          disabled={submitting || !score}
          style={{
            ...style.submitBtn,
            ...(submitting || !score ? style.submitBtnDisabled : {}),
          }}
        >
          {submitting ? "提交中..." : "提交评价"}
        </button>
      </div>
    </div>
  );
}

// ── Inline styles (no Tailwind dependency, self-contained) ──
const style: Record<string, React.CSSProperties> = {
  container: {
    minHeight: "100vh",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "24px 16px",
    background: "linear-gradient(135deg, #f5f7fa 0%, #c3cfe2 100%)",
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  },
  card: {
    background: "#fff",
    borderRadius: 16,
    padding: "40px 32px",
    maxWidth: 420,
    width: "100%",
    boxShadow: "0 4px 24px rgba(0,0,0,0.08)",
    textAlign: "center" as const,
  },
  icon: {
    width: 64,
    height: 64,
    borderRadius: "50%",
    background: "#ecfdf5",
    color: "#059669",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 28,
    fontWeight: 700,
    marginBottom: 16,
  },
  title: {
    fontSize: 22,
    fontWeight: 700,
    color: "#1a1a2e",
    margin: "0 0 8px",
  },
  subtitle: {
    fontSize: 14,
    color: "#6b7280",
    margin: "0 0 24px",
  },
  question: {
    fontSize: 16,
    color: "#374151",
    margin: "0 0 16px",
    fontWeight: 500,
  },
  buttons: {
    display: "flex",
    gap: 12,
    justifyContent: "center",
    marginBottom: 24,
  },
  btn: {
    flex: 1,
    padding: "14px 16px",
    borderRadius: 12,
    border: "2px solid #e5e7eb",
    fontSize: 16,
    fontWeight: 600,
    cursor: "pointer",
    transition: "all 0.2s",
    background: "#fff",
    display: "flex",
    flexDirection: "column" as const,
    alignItems: "center",
    gap: 6,
  },
  btnActiveGood: {
    borderColor: "#059669",
    background: "#ecfdf5",
    color: "#059669",
    transform: "scale(1.02)",
  },
  btnActiveBad: {
    borderColor: "#dc2626",
    background: "#fef2f2",
    color: "#dc2626",
    transform: "scale(1.02)",
  },
  btnDefault: {
    color: "#374151",
  },
  emoji: {
    fontSize: 28,
  },
  commentArea: {
    textAlign: "left" as const,
    marginBottom: 16,
  },
  label: {
    fontSize: 13,
    color: "#6b7280",
    display: "block",
    marginBottom: 6,
  },
  textarea: {
    width: "100%",
    padding: "10px 12px",
    borderRadius: 8,
    border: "1px solid #d1d5db",
    fontSize: 14,
    resize: "vertical" as const,
    outline: "none",
    boxSizing: "border-box" as const,
  },
  error: {
    color: "#dc2626",
    fontSize: 13,
    margin: "0 0 12px",
  },
  submitBtn: {
    width: "100%",
    padding: "14px",
    borderRadius: 10,
    background: "#1a1a2e",
    color: "#fff",
    border: "none",
    fontSize: 16,
    fontWeight: 600,
    cursor: "pointer",
    transition: "opacity 0.2s",
  },
  submitBtnDisabled: {
    opacity: 0.5,
    cursor: "not-allowed",
  },
  result: {
    fontSize: 20,
    fontWeight: 600,
    color: "#1a1a2e",
    margin: "0 0 8px",
  },
  footer: {
    fontSize: 12,
    color: "#9ca3af",
    margin: "16px 0 0",
  },
  loading: {
    fontSize: 16,
    color: "#6b7280",
  },
};
