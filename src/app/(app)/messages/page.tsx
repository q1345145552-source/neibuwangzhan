import { MessageSquare } from "lucide-react";

export default function MessagesPage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-2xl font-light tracking-tight text-[var(--foreground)]">消息</h1>
        <p className="mt-1 text-sm text-[var(--muted-foreground)]">内部聊天</p>
      </div>

      {/* 空骨架：会话 / 群聊 / 消息内容后续轮次再填充 */}
      <div className="flex min-h-[60vh] flex-col items-center justify-center rounded-xl border border-dashed border-[var(--border)] bg-[var(--card)] p-10 text-center">
        <MessageSquare className="size-10 text-[var(--muted-foreground)]/40" />
        <p className="mt-4 text-sm font-medium text-[var(--foreground)]">聊天功能建设中</p>
        <p className="mt-1 text-xs text-[var(--muted-foreground)]">会话、群聊和消息列表即将上线</p>
      </div>
    </div>
  );
}
