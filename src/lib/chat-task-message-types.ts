export const TASK_MESSAGE_TYPES = ["leave", "attendance", "notice", "report", "meeting", "todo", "problem", "issue"] as const;
export type TaskMessageType = typeof TASK_MESSAGE_TYPES[number];
export interface TaskMessageResult {
  key: string;
  name: string;
  status: "sent" | "failed";
  messageId?: number;
  error?: string;
}
export interface TaskMessageResponse { results: TaskMessageResult[]; multiple: boolean; }
