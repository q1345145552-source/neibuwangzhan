import type Database from "better-sqlite3";

/**
 * 客户给每一步打分（2026-10-20 老板 3A 4A）。客户在业务系统那一步办完后打 1～5 星、可写一句话，客户站送过来记在这里：
 * - 4A：按那一步的经办人加减积分，跟「评价链接」一样：≥4 星 +3、≤2 星 -3、3 星 0；经办人写了几个人的每人都算；
 *   这一步没写经办人，算订单负责人的。
 * - 3A：一张客户单（拆成几张办理单的都算）每一步都评完——取消的份不算、跳过的步骤不算——送一份泰国特产，
 *   记进 rating_gifts，通知管理员；员工送了在「客户评价」里点「已送出」。
 * 同一步只认第一次（客户站重发、乱序都按评价编号去重）。
 */
export type RatingInput = {
  id: string; source_order_no: string; line_no: number; copy_no: number; step_order: number;
  step_name: string; stars: number; comment: string; rated_at: string;
};
export type RatingResult = { id: string; status: "created" | "duplicate"; points: number; gift: boolean };

export function ratingPoints(stars: number): number {
  return stars >= 4 ? 3 : stars <= 2 ? -3 : 0;
}

const stars = (n: number) => "★".repeat(n) + "☆".repeat(5 - n);

export function recordStepRating(db: Database.Database, input: RatingInput, customerName: string): RatingResult {
  return db.transaction((): RatingResult => {
    if (db.prepare("SELECT 1 FROM step_ratings WHERE id = ?").get(input.id) ||
      db.prepare("SELECT 1 FROM step_ratings WHERE source_order_no = ? AND line_no = ? AND copy_no = ? AND step_order = ?")
        .get(input.source_order_no, input.line_no, input.copy_no, input.step_order)) {
      return { id: input.id, status: "duplicate", points: 0, gift: false };
    }
    const inbox = db.prepare("SELECT internal_order_id FROM sync_inbox WHERE source_order_no = ? AND line_no = ? AND copy_no = ?")
      .get(input.source_order_no, input.line_no, input.copy_no) as { internal_order_id: string | null } | undefined;
    const orderId = inbox?.internal_order_id || null;
    const step = orderId ? db.prepare("SELECT id, step_name, assignee FROM order_steps WHERE order_id = ? AND step_order = ?")
      .get(orderId, input.step_order) as { id: number; step_name: string; assignee: string } | undefined : undefined;
    const responsible = orderId ? (db.prepare("SELECT responsible_person FROM orders WHERE id = ?").get(orderId) as { responsible_person: string | null } | undefined)?.responsible_person || "" : "";
    const assignee = (step?.assignee || "").trim() || responsible.trim();
    const names = [...new Set(assignee.split(/[\/、,，]/).map(n => n.trim()).filter(Boolean))];
    const points = ratingPoints(input.stars);
    db.prepare(`INSERT INTO step_ratings (id, source_order_no, line_no, copy_no, step_order, internal_order_id, step_id, step_name, public_name, assignee, stars, comment, points, customer_name, rated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(input.id, input.source_order_no, input.line_no, input.copy_no, input.step_order, orderId, step?.id ?? null, step?.step_name ?? "",
        input.step_name, names.join("、"), input.stars, input.comment, names.length ? points : 0, customerName, input.rated_at);
    if (orderId && names.length) {
      const reason = `客户评价: 订单 ${orderId} 第${input.step_order}步「${input.step_name}」${stars(input.stars)}，${points > 0 ? `+${points}` : points}分`;
      // 积分记在客户打分的时间（客户站带来的 UTC 时间），不记送到内部的时间：同步晚到跨了月也算进打分那个月
      const insert = db.prepare("INSERT INTO points_records (employee_name, points, reason, rule_key, ref_id, ref_type, status, created_at) VALUES (?, ?, ?, 'client_step_rating', ?, 'order', '有效', ?)");
      for (const name of names) insert.run(name, points, reason, orderId, input.rated_at);
    }
    const gift = checkRatingGift(db, input.source_order_no, customerName);
    return { id: input.id, status: "created", points: names.length ? points : 0, gift };
  })();
}

/** 这张客户单每一步都评完了，还没登记过特产：登记并通知管理员，返回 true */
export function checkRatingGift(db: Database.Database, sourceOrderNo: string, customerName: string): boolean {
  if (db.prepare("SELECT 1 FROM rating_gifts WHERE source_order_no = ?").get(sourceOrderNo)) return false;
  const copies = db.prepare(`SELECT i.line_no, i.copy_no, i.internal_order_id FROM sync_inbox i JOIN orders o ON o.id = i.internal_order_id
    WHERE i.source_order_no = ? AND o.status <> '客户取消'`).all(sourceOrderNo) as { line_no: number; copy_no: number; internal_order_id: string }[];
  if (!copies.length) return false;
  const rated = db.prepare("SELECT 1 FROM step_ratings WHERE source_order_no = ? AND line_no = ? AND copy_no = ? AND step_order = ?");
  for (const copy of copies) {
    const steps = db.prepare("SELECT step_order, status FROM order_steps WHERE order_id = ? AND status <> '已跳过'").all(copy.internal_order_id) as { step_order: number; status: string }[];
    if (!steps.length) return false;
    for (const s of steps) if (s.status !== "已完成" || !rated.get(sourceOrderNo, copy.line_no, copy.copy_no, s.step_order)) return false;
  }
  if (!db.prepare("INSERT OR IGNORE INTO rating_gifts (source_order_no, customer_name) VALUES (?, ?)").run(sourceOrderNo, customerName).changes) return false;
  const admins = db.prepare("SELECT DISTINCT name FROM employees WHERE role = 'admin' AND status = '在职' AND name <> ''").all() as { name: string }[];
  const notify = db.prepare("INSERT INTO notifications (type,title,body,recipient,related_id,related_type) VALUES ('',?,?,?,?,'order')");
  for (const { name } of admins) notify.run("客户评价送特产", `客户 ${customerName || ""}（客户站单号 ${sourceOrderNo}）每一步都评价完了，要送一份泰国特产。送了请到「客户评价」→「特产待送」点「已送出」。`, name, copies[0].internal_order_id);
  return true;
}
