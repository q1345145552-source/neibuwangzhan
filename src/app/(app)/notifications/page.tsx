"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { fetchWithAuth } from "@/lib/api";
import { useAuth } from "@/components/auth-provider";
import { cn, toThaiTime } from "@/lib/utils";
import { Ticket, ListTodo, BookOpen, Bell, EyeOff, ShoppingCart, FileText, XCircle } from "lucide-react";
import { NOTIFICATION_TABS, notificationCategory, type NotificationTab, isSupervisionAlert, bossSubmissionNoticeHref, announcementFeedbackHref, isAnnouncementRetellFeedback, leaveReviewNoticeHref, isLeaveReviewFeedback, attendanceReviewNoticeHref, isAttendanceReviewFeedback, meetingReflectionReviewHref, isMeetingReflectionReview, workReportNoticeHref, isWorkReportNotice, ideaReviewNoticeHref, isIdeaReviewFeedback, withdrawalReviewNoticeHref, isWithdrawalReviewFeedback, payslipNoticeHref, isPayslipNotice, issueNoticeHref } from "@/lib/notification-types";
import type { CUSTOMER_SITE_ALERT_TITLES } from "@/lib/notification-types";
import { SubmissionNoticeDialog } from "@/components/submission-notice-dialog";

interface Notice {
  id: number;
  type: string;
  title: string;
  body: string;
  related_id: string;
  related_type: string;
  is_read: number;
  created_at: string;
  /** 客户站订单提醒：后端换算好的内部办理单号（找不到为 null） */
  order_id?: string | null;
}

// 消息中心几类通知的图标与跳转目标
const TYPE_META: Record<string, { label: string; icon: typeof Ticket; href: (n: Notice) => string }> = {
  工单指派: { label: "工单", icon: Ticket, href: (n) => `/issues?open=${n.related_id}` },
  工单完成: { label: "工单", icon: Ticket, href: (n) => `/issues?open=${n.related_id}` },
  待办指派: { label: "待办", icon: ListTodo, href: (n) => `/todos?todo=${n.related_id}` },
  待办完成: { label: "待办", icon: ListTodo, href: (n) => `/todos?todo=${n.related_id}` },
  problem_assigned: { label: "问题", icon: Ticket, href: n => `/problems/${n.related_id}` },
  problem_followup: { label: "问题", icon: Ticket, href: n => `/problems/${n.related_id}` },
  problem_accepted: { label: "问题", icon: Ticket, href: n => `/problems/${n.related_id}` },
  problem_rejected: { label: "问题", icon: Ticket, href: n => `/problems/${n.related_id}` },
  日报提醒: { label: "日报", icon: FileText, href: () => "/work-reports" },
  日报风险: { label: "日报", icon: FileText, href: n => `/work-reports?report=${n.related_id}` },
  会议提醒: { label: "会议", icon: Bell, href: () => "/meetings" },
  规则更新: { label: "规则", icon: BookOpen, href: () => `/rules` },
  老板通知: { label: "老板通知", icon: Bell, href: () => `/announcements` },
};

// 客户站同步来的订单提醒（type 为空，按标题认，见 lib/notification-types.ts）：点开进对应订单，找不到单就进订单列表
const orderHref = (n: Notice) => (n.order_id ? `/orders/${n.order_id}` : "/orders");
// 键用 CUSTOMER_SITE_ALERT_TITLES 的类型：以后加了新提醒标题忘了配这里，类型检查直接报错（10-15 漏过一次）
const CUSTOMER_SITE_META: Record<(typeof CUSTOMER_SITE_ALERT_TITLES)[number], { label: string; icon: typeof Ticket; href: (n: Notice) => string }> = {
  客户站新订单: { label: "客户站", icon: ShoppingCart, href: orderHref },
  待分类订单待领取: { label: "客户站", icon: ShoppingCart, href: orderHref },
  客户提交了资料: { label: "客户站", icon: FileText, href: orderHref },
  客户申请取消: { label: "客户站", icon: XCircle, href: orderHref },
  商城新订单: { label: "商城", icon: ShoppingCart, href: orderHref },
  客户站同步失败: { label: "客户站", icon: XCircle, href: orderHref },
  轮到你了: { label: "订单", icon: ListTodo, href: orderHref },
  证书快到期: { label: "证书", icon: FileText, href: orderHref },
  步骤超时: { label: "订单", icon: XCircle, href: orderHref },
  收入未到账: { label: "收款", icon: XCircle, href: orderHref },
};
const metaOf = (n: Notice) =>
  (issueNoticeHref(n) ? { label: "工单", icon: Ticket, href: () => issueNoticeHref(n)! } : undefined) || (payslipNoticeHref(n) ? { label: "工资单", icon: FileText, href: () => payslipNoticeHref(n)! } : undefined) || (withdrawalReviewNoticeHref(n) ? { label: "提现审批", icon: Bell, href: () => withdrawalReviewNoticeHref(n)! } : undefined) || (ideaReviewNoticeHref(n) ? { label: "想法反馈", icon: Bell, href: () => ideaReviewNoticeHref(n)! } : undefined) || (workReportNoticeHref(n) ? { label: n.type === "日报点评" ? "日报点评" : "日报退回", icon: FileText, href: () => workReportNoticeHref(n)! } : undefined) || (meetingReflectionReviewHref(n) ? { label: "会议心得", icon: Bell, href: () => meetingReflectionReviewHref(n)! } : undefined) || (attendanceReviewNoticeHref(n) ? { label: "补签审批", icon: Bell, href: () => attendanceReviewNoticeHref(n)! } : undefined) || (leaveReviewNoticeHref(n) ? { label: "请假审批", icon: Bell, href: () => leaveReviewNoticeHref(n)! } : undefined) || (announcementFeedbackHref(n) ? { label: "复述反馈", icon: Bell, href: () => announcementFeedbackHref(n)! } : undefined) || (bossSubmissionNoticeHref(n) ? { label: "待处理", icon: Bell, href: () => bossSubmissionNoticeHref(n)! } : undefined) || (isSupervisionAlert(n) ? { label: "老板监督", icon: Bell, href: () => "/boss-supervision" } : undefined) || TYPE_META[n.type] || (n.type === "" && n.related_type === "order" ? CUSTOMER_SITE_META[n.title as keyof typeof CUSTOMER_SITE_META] : undefined);

export default function NotificationsPage() {
  const { user } = useAuth();
  const router = useRouter();
  const [items, setItems] = useState<Notice[]>([]);
  const [activeTab, setActiveTab] = useState<NotificationTab>("全部");
  const [loading, setLoading] = useState(true);
  const [submission, setSubmission] = useState<Notice | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchWithAuth("/api/notifications?all=1", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => { if (!cancelled) setItems(Array.isArray(d) ? d : []); })
      .catch(() => { if (!cancelled) setItems([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [user?.name]);

  const handleClick = (n: Notice) => {
    if (user?.role === "admin" && bossSubmissionNoticeHref(n)) {
      setSubmission(n);
      return;
    }
    // 点哪条标哪条已读
    if (!n.is_read) {
      fetchWithAuth("/api/notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: n.id }),
      }).catch(() => {});
      setItems((prev) => prev.map((x) => (x.id === n.id ? { ...x, is_read: 1 } : x)));
    }
    const meta = metaOf(n);
    if (meta) router.push(meta.href(n));
  };

  const handleHide = (e: React.MouseEvent, n: Notice) => {
    e.stopPropagation();
    fetchWithAuth("/api/notifications", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: n.id, hide: true }),
    })
      .then((r) => { if (r.ok) setItems((prev) => prev.filter((x) => x.id !== n.id)); })
      .catch(() => {});
  };

  const visibleItems = activeTab === "全部" ? items : items.filter(n => notificationCategory(n) === activeTab);
  const unreadCounts = new Map<NotificationTab, number>();
  for (const item of items) {
    if (item.is_read) continue;
    const category = notificationCategory(item);
    unreadCounts.set(category, (unreadCounts.get(category) || 0) + 1);
    unreadCounts.set("全部", (unreadCounts.get("全部") || 0) + 1);
  }

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <div>
        <h1 className="font-display text-2xl font-light tracking-tight text-[var(--foreground)]">消息中心</h1>
        <p className="mt-1 text-sm text-[var(--muted-foreground)]">按业务分类查看系统提醒，点击分类切换通知</p>
      </div>

      <div role="group" aria-label="通知业务分类" className="flex w-full min-w-0 gap-1 overflow-x-auto border-b border-[var(--border)] pb-2">
        {NOTIFICATION_TABS.map(tab => {
          const count = unreadCounts.get(tab) || 0;
          return (
            <button key={tab} type="button" aria-pressed={activeTab === tab} aria-controls="notification-list"
              onClick={() => setActiveTab(tab)}
              className={cn("flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-2 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-[var(--primary)]",
                activeTab === tab ? "bg-[var(--primary)] text-[var(--primary-foreground)]" : "text-[var(--muted-foreground)] hover:bg-[var(--muted)]")}>
              {tab}
              {count > 0 && <span aria-label={`${count} 条未读`} className="min-w-5 rounded-full bg-red-500 px-1.5 py-0.5 text-center text-xs leading-4 text-white">{count}</span>}
            </button>
          );
        })}
      </div>

      <div id="notification-list" aria-busy={loading}>
      {loading ? (
        <p className="py-12 text-center text-sm text-[var(--muted-foreground)]">加载中…</p>
      ) : visibleItems.length === 0 ? (
        <p className="py-12 text-center text-sm text-[var(--muted-foreground)]">{activeTab === "全部" ? "暂无通知" : `暂无${activeTab}通知`}</p>
      ) : (
        <div className="flex flex-col gap-2">
          {visibleItems.map((n) => {
            const meta = metaOf(n);
            const Icon = meta?.icon || Bell;
            const unread = !n.is_read;
            return (
              <div
                key={n.id}
                className={cn(
                  "group rounded-xl border border-[var(--border)] bg-[var(--background)] transition-colors hover:border-[var(--primary)]",
                  unread && "border-[var(--primary)]/40 bg-[color-mix(in_oklch,var(--primary),var(--background)_92%)]"
                )}
              >
                <div className="flex items-stretch">
                  <button onClick={() => handleClick(n)} className="flex min-w-0 flex-1 items-start gap-3 p-4 text-left">
                    <span className={cn("mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md", unread ? "bg-[var(--primary)]/15 text-[var(--primary)]" : "bg-[var(--muted)]/40 text-[var(--muted-foreground)]")}>
                      <Icon className="size-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className="text-xs text-[var(--muted-foreground)]">{meta?.label || n.type}</span>
                        {unread && <span className="size-1.5 rounded-full bg-red-500" />}
                        {bossSubmissionNoticeHref(n) && <span className={cn("text-xs", unread ? "text-red-600" : "text-emerald-600")}>{unread ? "未观看" : "已观看"}</span>}
                      </span>
                      <span className={cn("mt-0.5 block truncate text-sm text-[var(--foreground)]", unread && "font-semibold")}>{n.title}</span>
                      {n.body && <span className={cn("mt-0.5 block text-xs text-[var(--muted-foreground)]", isSupervisionAlert(n) || bossSubmissionNoticeHref(n) || isAnnouncementRetellFeedback(n) || isLeaveReviewFeedback(n) || isAttendanceReviewFeedback(n) || isMeetingReflectionReview(n) || isWorkReportNotice(n) || isIdeaReviewFeedback(n) || isWithdrawalReviewFeedback(n) || isPayslipNotice(n) || issueNoticeHref(n) ? "whitespace-pre-wrap [overflow-wrap:anywhere]" : "truncate")}>{n.body}</span>}
                      <span className="mt-1 block text-xs text-[var(--muted-foreground)]/70">{toThaiTime(n.created_at)}</span>
                    </span>
                  </button>
                  <button
                    onClick={(e) => handleHide(e, n)}
                    title="隐藏"
                    className="shrink-0 px-3 text-[var(--muted-foreground)] opacity-0 transition-opacity hover:text-[var(--foreground)] group-hover:opacity-100"
                  >
                    <EyeOff className="size-4" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
      </div>
      {user?.role === "admin" && submission && bossSubmissionNoticeHref(submission) && <SubmissionNoticeDialog key={submission.id}
        notice={submission} href={bossSubmissionNoticeHref(submission)!} onClose={() => setSubmission(null)}
        onConfirmed={id => {
          setItems(previous => previous.map(item => item.id === id ? { ...item, is_read: 1 } : item));
          setSubmission(previous => previous?.id === id ? { ...previous, is_read: 1 } : previous);
        }} />}
    </div>
  );
}
