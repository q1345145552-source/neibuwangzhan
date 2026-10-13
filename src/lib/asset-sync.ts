import { getDb } from "./db";
import { bangkokToday } from "./time";

// 资产到期提醒同步：
// 到期时间在今天 ~ 未来 7 天之间的资产，给老板发一条系统通知「某某资产 快到期了 X月X日 到期」。
// 在资产相关接口被访问时顺带触发；靠 asset_expiry_reminders 去重，
// 同一资产 + 同一到期时间只提醒一次。

function datePlusDays(dateStr: string, n: number): string {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().split("T")[0];
}

export function syncAssetExpiryReminders(): { notifications: number } {
  const db = getDb();
  const today = bangkokToday();
  const day7 = datePlusDays(today, 7);

  const assets = db.prepare(
    "SELECT id, name, asset_type, expiry_date FROM assets WHERE expiry_date != '' AND expiry_date >= ? AND expiry_date <= ? ORDER BY expiry_date ASC"
  ).all(today, day7) as { id: number; name: string; asset_type: string; expiry_date: string }[];

  const admins = db.prepare(
    "SELECT name FROM employees WHERE role = 'admin' AND status = '在职'"
  ).all() as { name: string }[];

  const insReminder = db.prepare(
    "INSERT OR IGNORE INTO asset_expiry_reminders (asset_id, expiry_date) VALUES (?, ?)"
  );
  const insNotify = db.prepare(
    "INSERT INTO notifications (type, title, body, recipient, related_id, related_type) VALUES ('资产到期提醒', '资产快到期', ?, ?, ?, 'asset')"
  );

  let notifications = 0;
  for (const a of assets) {
    const ins = insReminder.run(a.id, a.expiry_date);
    if (ins.changes === 0) continue; // 已经提醒过，跳过

    const name = a.name || a.asset_type;
    const parts = a.expiry_date.split("-").map(Number);
    const body = `${name} 快到期了 ${parts[1]}月${parts[2]}日 到期`;
    for (const admin of admins) {
      insNotify.run(body, admin.name, String(a.id));
    }
    notifications++;
  }

  return { notifications };
}
