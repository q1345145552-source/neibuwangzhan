// 跨组件「打开某个聊天」的轻量信号：
// 消息提醒气泡 / 浏览器系统通知被点击后，无论用户当前在哪个页面，
// 都要跳到 /messages 并打开对应会话。这里用「订阅 + 暂存」两段式：
// - 已经挂载在消息页时，立即通过订阅回调切过去；
// - 还没挂载时，暂存目标，等消息页挂载后取走并打开。

export type ChatOpenTarget =
  | { kind: "direct"; name: string }
  | { kind: "group"; id: number; name: string };

let pendingTarget: ChatOpenTarget | null = null;
const listeners = new Set<(t: ChatOpenTarget) => void>();

/** 请求打开某个会话：立即通知已挂载的消息页，并暂存一份供「跳转后新挂载」的消息页消费 */
export function notifyOpenChat(target: ChatOpenTarget): void {
  pendingTarget = target;
  for (const l of listeners) l(target);
}

/** 消息页挂载时取走暂存的打开目标（取一次即清空） */
export function takePendingChatTarget(): ChatOpenTarget | null {
  const t = pendingTarget;
  pendingTarget = null;
  return t;
}

/** 消息页订阅「打开会话」信号（用于已经在消息页时直接切换） */
export function subscribeOpenChat(listener: (t: ChatOpenTarget) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
