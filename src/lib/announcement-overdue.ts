import { getDb, logOperation } from "./db";

// 通知逾期闭环：
// 员工接收记录过了截止时间还没复述（状态仍是 待读/已读待复述/需重述）就算逾期，
// 自动给管理员生成一条待办；同一员工 + 同一通知只生成一次。
// 员工补复述（状态离开逾期集合）后，对应待办自动删除。

const OVERDUE_STATUSES = ["待读", "已读待复述", "需重述"];

/** 曼谷时区当前时间（精确到分钟），与通知截止时间同一格式比较 */
function bangkokNowMinute(): string {
  return new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 16).replace("T", " ");
}

/**
 * 同步逾期待办：给新逾期的员工生成待办，清理已补复述/已确认的旧待办。
 * 返回 { created, removed } 供调试/日志。
 */
export function syncAnnouncementOverdueTodos(adminName: string): { created: number; removed: number } {
  const db = getDb();
  const nowStr = bangkokNowMinute();

  // 所有接收记录 + 通知标题/截止时间
  const rows = db.prepare(
    `SELECT r.announcement_id, r.employee_name, r.status,
            a.title, a.deadline
     FROM announcement_recipients r
     JOIN announcements a ON a.id = r.announcement_id`
  ).all() as any[];

  // 当前逾期集合（key = announcement_id|employee_name）
  const overdue = new Map<string, { announcementId: number; employeeName: string; title: string; deadline: string }>();
  for (const r of rows) {
    if (!OVERDUE_STATUSES.includes(r.status)) continue;
    const dl = String(r.deadline || "").replace("T", " ");
    if (!dl || dl >= nowStr) continue;
    const key = `${r.announcement_id}|${r.employee_name}`;
    overdue.set(key, {
      announcementId: r.announcement_id,
      employeeName: r.employee_name,
      title: String(r.title || ""),
      deadline: dl,
    });
  }

  // 已有映射
  const existing = db.prepare("SELECT * FROM announcement_overdue_todos").all() as any[];
  const existingByKey = new Map(existing.map((m) => [`${m.announcement_id}|${m.employee_name}`, m]));

  let created = 0;
  let removed = 0;

  // 清理：映射还在、但员工已不再逾期（补复述/已确认等）→ 删待办 + 删映射
  const delFollowUps = db.prepare("DELETE FROM todo_follow_ups WHERE todo_id = ?");
  const delImages = db.prepare("DELETE FROM todo_images WHERE todo_id = ?");
  const delTodo = db.prepare("DELETE FROM todos WHERE id = ?");
  const delMap = db.prepare("DELETE FROM announcement_overdue_todos WHERE id = ?");
  for (const m of existing) {
    const key = `${m.announcement_id}|${m.employee_name}`;
    if (overdue.has(key)) continue;
    db.transaction(() => {
      delFollowUps.run(m.todo_id);
      delImages.run(m.todo_id);
      delTodo.run(m.todo_id);
      delMap.run(m.id);
    })();
    removed++;
  }

  // 生成：新逾期的员工 → 建待办 + 映射（UNIQUE 保证不重复）
  const insTodo = db.prepare(
    "INSERT INTO todos (content, assignee, priority, status, created_by) VALUES (?, ?, '紧急', '未完成', ?)"
  );
  const insMap = db.prepare(
    "INSERT INTO announcement_overdue_todos (announcement_id, employee_name, todo_id) VALUES (?, ?, ?)"
  );
  for (const [key, info] of overdue) {
    if (existingByKey.has(key)) continue;
    const content = `员工「${info.employeeName}」未复述通知「${info.title}」，截止时间 ${info.deadline}`;
    const r = insTodo.run(content, adminName, adminName);
    const todoId = Number(r.lastInsertRowid);
    insMap.run(info.announcementId, info.employeeName, todoId);
    logOperation(adminName, "通知逾期待办", "todo", String(todoId), content);
    created++;
  }

  return { created, removed };
}
