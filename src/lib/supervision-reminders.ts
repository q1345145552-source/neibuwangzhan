import type Database from "better-sqlite3";
import { bossSupervisionOverdues, type SupervisionOverdue } from "@/lib/boss-supervision";
import { SUPERVISION_ALERT_TITLES } from "@/lib/notification-types";

const HALF_HOUR = 30 * 60_000;
export function supervisionSchedule(now: number) {
  const local = new Date(now + 7 * 3_600_000).toISOString();
  return { slot: Math.floor(now / HALF_HOUR), date: local.slice(0, 10), digestDue: local.slice(11, 16) >= "17:30" };
}
interface State { item_key: string; fingerprint: string; generation: number; active: number }
interface Pending { item: SupervisionOverdue; generation: number; critical: boolean }

/** 同一个现有提醒worker调用；事务覆盖状态、去重记录和消息，任何一步失败全部回滚。 */
export function runSupervisionReminders(db: Database.Database, now = Date.now(), options: { critical?: boolean; digest?: boolean } = {}) {
  const schedule = supervisionSchedule(now);
  const stamp = new Date(now).toISOString();
  return db.transaction(() => {
    const snapshot = bossSupervisionOverdues(db, now);
    const priorities = new Map((db.prepare("SELECT id, priority FROM todos").all() as { id: number; priority: string }[]).map(row => [row.id, row.priority]));
    // 完成后在两次检查之间重新打开待办，也能借助现有操作日志识别新一轮。
    const reopened = new Map((db.prepare("SELECT target_id, MAX(id) AS revision FROM audit_logs WHERE target_type='todo' AND action='待办恢复未完成' GROUP BY target_id").all() as { target_id: string; revision: number }[]).map(row => [row.target_id, row.revision]));
    const noticeStates = new Map((db.prepare("SELECT notice_id, employee_id, review_status, reviewed_at, submitted_at FROM notice_rule_implementations").all() as { notice_id: number; employee_id: number; review_status: string; reviewed_at: string | null; submitted_at: string | null }[]).map(row => [`${row.notice_id}:${row.employee_id}`, row]));
    const reportStates = new Map((db.prepare("SELECT employee_name, report_date, status, submitted_at FROM work_reports").all() as { employee_name: string; report_date: string; status: string; submitted_at: string }[]).map(row => [`${row.employee_name}:${row.report_date}`, [row.status, row.submitted_at]]));
    const reflectionStates = new Map((db.prepare("SELECT meeting_id, employee_name, MAX(updated_at) AS revision FROM meeting_reflections WHERE status='退回' GROUP BY meeting_id, employee_name").all() as { meeting_id: number; employee_name: string; revision: string }[]).map(row => [`${row.meeting_id}:${row.employee_name}`, row.revision]));
    const oldStates = new Map((db.prepare("SELECT item_key, fingerprint, generation, active FROM supervision_reminder_state").all() as State[]).map(row => [row.item_key, row]));
    db.prepare("UPDATE supervision_reminder_state SET active=0 WHERE active=1").run();
    const saveState = db.prepare(`INSERT INTO supervision_reminder_state(item_key,fingerprint,generation,active,last_seen_at) VALUES (?,?,?,1,?)
      ON CONFLICT(item_key) DO UPDATE SET fingerprint=excluded.fingerprint,generation=excluded.generation,active=1,last_seen_at=excluded.last_seen_at`);
    const pending: Pending[] = snapshot.overdues.map(item => {
      const critical = item.category === "notice" || (item.category === "todo" && priorities.get(Number(item.source_id)) === "紧急");
      const stateDetails = item.category === "todo" ? reopened.get(String(item.source_id)) ?? 0
        : item.category === "notice" ? noticeStates.get(`${item.source_id}:${item.employee_id}`)
        : item.category === "report" ? reportStates.get(`${item.employee_name}:${item.source_id}`) ?? "未提交"
        : reflectionStates.get(`${item.source_id}:${item.employee_name}`) ?? "未提交";
      // 时长增长、重新打印和普通内容编辑不触发重复提醒；退回/重开等状态变化会进入新一轮。
      const fingerprint = JSON.stringify([critical, stateDetails]);
      const old = oldStates.get(item.id);
      const generation = old ? old.generation + (old.active && old.fingerprint === fingerprint ? 0 : 1) : 1;
      saveState.run(item.id, fingerprint, generation, stamp);
      return { item, generation, critical };
    });
    const bosses = db.prepare("SELECT MIN(id) AS id, name FROM employees WHERE role='admin' AND status != '离职' AND name != '' GROUP BY name").all() as { id: number; name: string }[];
    const claim = db.prepare("INSERT OR IGNORE INTO reminder_log(kind,ref,created_at) VALUES (?,?,?)");
    const wasSent = db.prepare("SELECT 1 FROM reminder_log WHERE kind='supervision-item' AND ref=?");
    const insert = db.prepare("INSERT INTO notifications(type,title,body,recipient,related_id,related_type,created_at) VALUES ('',?,?,?,?,'boss_supervision',?)");
    const reference = (boss: number, p: Pending) => JSON.stringify([boss, p.item.id, p.generation]);
    let criticalSent = 0, digestsSent = 0;
    for (const boss of bosses) {
      if (options.critical !== false) {
        for (const p of pending.filter(row => row.critical)) {
          if (!claim.run("supervision-item", reference(boss.id, p), stamp).changes) continue;
          const kind = p.item.category === "notice" ? "通知/规则" : "紧急待办";
          const action = p.item.category === "notice" ? "未落实" : "未完成";
          const body = `${p.item.employee_name}的${kind}『${p.item.title}』已逾期${action}\n逾期时长：${p.item.overdue_duration}\n点击查看监督看板。`;
          insert.run(SUPERVISION_ALERT_TITLES[0], body, boss.name, p.item.id, stamp);
          criticalSent++;
        }
      }
      if (options.digest === false || !schedule.digestDue) continue;
      // 当天即使无新逾期也记下已检查，17:30之后新出现的普通事项留到明天，避免变成即时推送。
      if (!claim.run("supervision-daily", JSON.stringify([boss.id, schedule.date]), stamp).changes) continue;
      const ordinary = pending.filter(p => !p.critical && !wasSent.get(reference(boss.id, p)));
      if (!ordinary.length) continue;
      const people = (category: string) => new Set(ordinary.filter(p => p.item.category === category).map(p => p.item.employee_id)).size;
      const todos = ordinary.filter(p => p.item.category === "todo").length;
      const headline = `今日日报漏交 ${people("report")} 人、普通待办逾期 ${todos} 条、会议未交 ${people("meeting")} 人`;
      const lines = ordinary.map(p => `【${p.item.category_label}】${p.item.employee_name}：${p.item.title}（逾期 ${p.item.overdue_duration}）`);
      for (const p of ordinary) claim.run("supervision-item", reference(boss.id, p), stamp);
      insert.run(SUPERVISION_ALERT_TITLES[1], `${schedule.date} 17:30 汇总（曼谷时间，仅含本轮新增或状态变化的逾期）\n${headline}\n\n${lines.join("\n")}\n\n点击查看监督看板。`, boss.name, schedule.date, stamp);
      digestsSent++;
    }
    return { criticalSent, digestsSent };
  }).immediate();
}
