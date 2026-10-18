import type Database from "better-sqlite3";
import { getDb } from "@/lib/db";
import { bangkokToday } from "@/lib/time";
import { runSupervisionReminders, supervisionSchedule } from "@/lib/supervision-reminders";
import { currentStepTimings } from "@/lib/step-overdue";

/**
 * 订单提醒（2026-10-16 老板定）：
 * 1. 证书快到期：到期前 60 天、30 天各提醒一次这张单的负责人，同时抄送管理员（老板）。已取消的单不提醒，已过期的不提醒。
 * 2. 步骤超时：建单时记下了预计天数的步骤，当前这一步超过设定的工作日就提醒经办人（没写经办人提醒负责人），负责人也抄一份；
 *    都没人（没写或不在岗）就发管理员，写明没人接手。
 * 同一件事只提醒一次（reminder_log 去重）：证书按「证书 + 到期日 + 60/30」，超时按「步骤 + 这一轮开始等的时刻」。
 * 每小时查一次（进程启动 1 分钟后先查一次）。提醒都进消息中心，点开进订单。
 */

const split = (v: string | null | undefined) => (v || "").split(/[\/、,，]/).map((x) => x.trim()).filter(Boolean);

// 在岗：在职、试用期、待离职都算（离职、停薪留职不算）
function activeStaff(db: Database.Database): Map<string, string> {
  const rows = db.prepare("SELECT DISTINCT name FROM employees WHERE role IN ('admin','employee') AND status NOT IN ('离职','停薪留职') AND name <> ''").all() as { name: string }[];
  return new Map(rows.map((r) => [r.name.trim().toLowerCase(), r.name]));
}
function admins(db: Database.Database): string[] {
  return (db.prepare("SELECT DISTINCT name FROM employees WHERE role = 'admin' AND status = '在职' AND name <> ''").all() as { name: string }[]).map((r) => r.name);
}
function claim(db: Database.Database, kind: string, ref: string): boolean {
  return db.prepare("INSERT OR IGNORE INTO reminder_log (kind, ref) VALUES (?, ?)").run(kind, ref).changes > 0;
}
function notify(db: Database.Database, title: string, body: string, recipients: string[], orderId: string): number {
  const insert = db.prepare("INSERT INTO notifications (type,title,body,recipient,related_id,related_type) VALUES ('',?,?,?,?,'order')");
  for (const name of recipients) insert.run(title, body, name, orderId);
  return recipients.length;
}
const dayDiff = (from: string, to: string) => Math.round((Date.parse(to + "T00:00:00Z") - Date.parse(from + "T00:00:00Z")) / 86400000);

export function runCertificateExpiryReminders(db: Database.Database, today = bangkokToday()): number {
  const certs = db.prepare(`
    SELECT c.id, c.order_id, c.certificate_number, c.product_name, c.expiry_date, o.customer_name, o.responsible_person
    FROM certificates c JOIN orders o ON o.id = c.order_id
    WHERE c.expiry_date != '' AND c.expiry_date >= ? AND o.status != '客户取消'`).all(today) as
    { id: number; order_id: string; certificate_number: string; product_name: string; expiry_date: string; customer_name: string; responsible_person: string | null }[];
  if (!certs.length) return 0;
  const staff = activeStaff(db);
  const bosses = admins(db);
  let sent = 0;
  for (const c of certs) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(c.expiry_date)) continue;
    const left = dayDiff(today, c.expiry_date);
    const threshold = left <= 30 ? 30 : left <= 60 ? 60 : null;
    if (threshold == null) continue;
    const send = db.transaction(() => {
      if (!claim(db, "cert", `${c.id}:${c.expiry_date}:${threshold}`)) return 0;
      const written = split(c.responsible_person);
      const owners = written.map((n) => staff.get(n.toLowerCase())).filter((n): n is string => !!n);
      const recipients = [...new Set([...owners, ...bosses])];
      const what = [c.product_name, c.certificate_number ? `编号 ${c.certificate_number}` : ""].filter(Boolean).join("，") || "证书";
      const ownerNote = owners.length ? "" : written.length ? `负责人 ${written.join("、")} 已不在岗，要换人跟进。` : "这张单还没写负责人。";
      const body = `订单 ${c.order_id}（${c.customer_name}）的证书（${what}）${c.expiry_date} 到期，还剩 ${left} 天，记得联系客户续办。${ownerNote}`;
      return notify(db, "证书快到期", body, recipients, c.order_id);
    });
    sent += send();
  }
  return sent;
}

export function runStepOverdueReminders(db: Database.Database, now = new Date()): number {
  const overdue = currentStepTimings(db, now).filter((t) => t.overdue && t.since);
  if (!overdue.length) return 0;
  const staff = activeStaff(db);
  const bosses = admins(db);
  let sent = 0;
  for (const t of overdue) {
    const send = db.transaction(() => {
      // 先算好发给谁再记「已提醒」：经办人（没写算负责人）+ 负责人；都不在岗或没写，改发管理员，写明没人接手
      const handlers = (split(t.assignee).length ? split(t.assignee) : split(t.owner)).map((n) => staff.get(n.toLowerCase())).filter((n): n is string => !!n);
      const owners = split(t.owner).map((n) => staff.get(n.toLowerCase())).filter((n): n is string => !!n);
      let recipients = [...new Set([...handlers, ...owners])];
      const nobody = recipients.length === 0;
      if (nobody) recipients = bosses;
      if (!recipients.length) return 0;
      if (!claim(db, "overdue", `${t.stepId}:${t.since!.toISOString()}`)) return 0;
      const waiting = /^(再次)?等待/.test(t.stepName.trim()) ? "，在等外面，去催一下" : "";
      const body = `订单 ${t.orderId}（${t.customer}）「${t.stepName}」已经办了 ${t.elapsedDays} 个工作日，超过设定的 ${t.expectedDays} 天${waiting}。${nobody ? "这一步没人接手（没写经办人和负责人，或人已不在岗），要派人。" : ""}`;
      return notify(db, "步骤超时", body, recipients, t.orderId);
    });
    sent += send();
  }
  return sent;
}

type ReminderState = { timer?: ReturnType<typeof setInterval>; running?: boolean; ticking?: boolean; lastOrderAt?: number; supervisionSlot?: number; digestDate?: string };
function state(): ReminderState {
  const g = globalThis as typeof globalThis & { __xtOrderReminders?: ReminderState };
  return (g.__xtOrderReminders ??= {});
}

export function runOrderReminders(): void {
  const s = state();
  if (s.running) return;
  s.running = true;
  try {
    const db = getDb();
    runCertificateExpiryReminders(db);
    runStepOverdueReminders(db);
  } catch (error) {
    console.error("[reminders] 订单提醒检查失败，下一轮再试:", error);
  } finally {
    s.running = false;
  }
}

/** 同一提醒worker每分钟调度：订单仍每小时一次，监督每半小时一次，17:30汇总。
 * 每分钟只判断时钟，不会每分钟查询整份监督清单；失败的检查下一分钟重试。
 */
export function runReminderTick(now = Date.now()): void {
  const s = state();
  if (s.ticking) return;
  s.ticking = true;
  try {
    if (s.lastOrderAt === undefined || now - s.lastOrderAt >= 3_600_000) {
      runOrderReminders();
      s.lastOrderAt = now;
    }
    const schedule = supervisionSchedule(now);
    const critical = s.supervisionSlot !== schedule.slot;
    const digest = schedule.digestDue && s.digestDate !== schedule.date;
    if (critical || digest) {
      try {
        runSupervisionReminders(getDb(), now, { critical, digest });
        s.supervisionSlot = schedule.slot;
        if (digest) s.digestDate = schedule.date;
      } catch (error) {
        console.error("[reminders] 老板监督检查失败，下一分钟重试:", error);
      }
    }
  } finally {
    s.ticking = false;
  }
}

/** 复用现有服务启动入口；首次仍在启动一分钟后运行。全局标记防止同一实例重复挂载。 */
export function ensureReminderWorker(): void {
  const s = state();
  if (s.timer) return;
  s.timer = setInterval(runReminderTick, 60_000);
  s.timer.unref?.();
}
