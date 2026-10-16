import type Database from "better-sqlite3";
import { getLegacyOrderStepsWithDocs, getOrderStepsWithDocs, logOperation, templateSignature } from "@/lib/db";
import { combosOf } from "@/lib/workflow-catalog";

/**
 * 流程设置第 2、3 期（2026-10-16）：导入、发布新版本、退回旧版本。
 * - 导入：把程序里现有的每一套流程原样存成第 1 版；导入完逐个组合核对，系统里读出来的跟程序里的一模一样才提交（行为不变）。
 * - 发布：这一期只能改默认经办人、预计天数（工作日）、备注、所需文件；步骤名和顺序不能动。只影响之后新建的单，已建的单不跟着变。
 * - 退回：把某个旧版本原样再发布一次（版本号继续往上加，历史都留着）。
 * 只有管理员能做（接口里查）。
 */

export class WorkflowEditError extends Error {}
/** 别人刚发布过新版本：页面上的内容已经旧了 */
export class WorkflowConflictError extends WorkflowEditError {}

/** 在岗员工（在职、试用期、待离职）和不在岗的（离职、停薪留职） */
function staffSets(db: Database.Database): { active: Set<string>; gone: Set<string> } {
  const rows = db.prepare("SELECT name, status FROM employees WHERE role IN ('admin','employee') AND name <> ''").all() as { name: string; status: string }[];
  return {
    active: new Set(rows.filter((r) => r.status !== "离职" && r.status !== "停薪留职").map((r) => r.name)),
    gone: new Set(rows.filter((r) => r.status === "离职" || r.status === "停薪留职").map((r) => r.name)),
  };
}
/** 默认经办人里有已不在岗的员工就拦下，要先换人（合作方这类不在员工表里的名字照旧） */
function assertNoGoneAssignee(db: Database.Database, steps: { name: string; assignee: string }[]): void {
  const { active, gone } = staffSets(db);
  for (const s of steps) {
    const names = s.assignee.split(/[\/、,，]/).map((x) => x.trim()).filter(Boolean);
    const bad = names.filter((n) => gone.has(n) && !active.has(n));
    if (bad.length) throw new WorkflowEditError(`「${s.name}」的默认经办人 ${bad.join("、")} 已经不在岗，先换人再发布`);
  }
}

export function isWorkflowImported(db: Database.Database): boolean {
  return ((db.prepare("SELECT COUNT(*) AS c FROM workflow_templates").get() as { c: number }).c) > 0;
}

type Step = { name: string; assignee: string; notes: string; docs: string[]; expected_days: number | null };

function insertVersion(db: Database.Database, templateId: number, steps: Step[], note: string, actor: string): { versionId: number; version: number } {
  const next = ((db.prepare("SELECT MAX(version) AS v FROM workflow_template_versions WHERE template_id = ?").get(templateId) as { v: number | null }).v ?? 0) + 1;
  const versionId = Number(db.prepare("INSERT INTO workflow_template_versions (template_id, version, note, published_by) VALUES (?, ?, ?, ?)")
    .run(templateId, next, note, actor).lastInsertRowid);
  const ins = db.prepare("INSERT INTO workflow_template_steps (version_id, step_order, name, assignee, notes, docs_json, expected_days) VALUES (?, ?, ?, ?, ?, ?, ?)");
  steps.forEach((s, i) => ins.run(versionId, i + 1, s.name, s.assignee, s.notes, JSON.stringify(s.docs), s.expected_days));
  db.prepare("UPDATE workflow_templates SET current_version_id = ? WHERE id = ?").run(versionId, templateId);
  return { versionId, version: next };
}

/** 把程序里的流程导入系统（已导入过的跳过）。返回新导入的流程数。 */
export function importLegacyWorkflows(db: Database.Database, actor: string): { imported: number; total: number } {
  const bts = db.prepare("SELECT id, name FROM business_types ORDER BY id").all() as { id: number; name: string }[];
  // 同一套流程（指纹相同）可能被好几种具体服务共用：合成一条，标题里列出都有谁在用
  const groups = new Map<string, { business: string; labels: string[]; steps: Step[] }>();
  const checks: { btId: number; sub: string; addr: string }[] = [];
  for (const bt of bts) {
    for (const c of combosOf(bt)) {
      const legacy = getLegacyOrderStepsWithDocs(bt.id, c.sub || undefined, c.addr || undefined);
      const sig = templateSignature(legacy);
      checks.push({ btId: bt.id, sub: c.sub, addr: c.addr });
      const g = groups.get(sig);
      if (g) { if (!c.hiddenIfMerged && !g.labels.includes(c.label)) g.labels.push(c.label); continue; }
      groups.set(sig, {
        business: bt.name,
        labels: c.hiddenIfMerged ? [] : [c.label],
        steps: legacy.map((s) => ({ name: s.name, assignee: s.assignee || "", notes: s.notes || "", docs: [...(s.docs || [])], expected_days: null })),
      });
    }
  }
  let imported = 0;
  db.transaction(() => {
    for (const [sig, g] of groups) {
      if (db.prepare("SELECT 1 FROM workflow_templates WHERE legacy_signature = ?").get(sig)) continue;
      const label = g.labels.length && !(g.labels.length === 1 && g.labels[0] === g.business) ? `${g.business}：${g.labels.join("、")}` : g.business;
      const templateId = Number(db.prepare("INSERT INTO workflow_templates (legacy_signature, label) VALUES (?, ?)").run(sig, label).lastInsertRowid);
      // 程序里改过这套流程（指纹变了）：以前导入过、步骤名一样的那套，把设好的天数带过来（天数程序里本来没有）
      const carried = carryDaysFromDrifted(db, g.steps, groups);
      insertVersion(db, templateId, carried.steps, carried.from ? `从程序里重新导入（程序里改过），沿用「${carried.from}」设的天数` : "从程序里导入的原样流程", actor);
      imported++;
    }
    // 核对：每个组合从系统里读出来的，必须跟程序里的一模一样（行为不变），有一个对不上就整个不导入
    for (const c of checks) {
      const legacy = getLegacyOrderStepsWithDocs(c.btId, c.sub || undefined, c.addr || undefined);
      const now = getOrderStepsWithDocs(c.btId, c.sub || undefined, c.addr || undefined);
      if (templateSignature(now) !== templateSignature(legacy)) {
        // 已发布过新版本（改过经办人等）的不算对不上：只核这次新导入的
        const tpl = db.prepare("SELECT t.id, v.version FROM workflow_templates t JOIN workflow_template_versions v ON v.id = t.current_version_id WHERE t.legacy_signature = ?")
          .get(templateSignature(legacy)) as { id: number; version: number } | undefined;
        if (!tpl || tpl.version === 1) throw new WorkflowEditError(`导入后核对不一致（业务线 ${c.btId} ${c.sub || ""} ${c.addr || ""}），已全部撤销`);
      }
    }
  })();
  if (imported) logOperation(actor, "导入流程", "workflow", "", `从程序里导入 ${imported} 套流程`);
  return { imported, total: groups.size };
}

/** 找以前导入过、现在程序里已经对不上（没有组合再用它）、步骤名一模一样的那套流程，沿用它正在用的版本里设的天数 */
function carryDaysFromDrifted(db: Database.Database, steps: Step[], groups: Map<string, unknown>): { steps: Step[]; from: string | null } {
  const names = JSON.stringify(steps.map((s) => s.name));
  const olds = db.prepare("SELECT id, label, legacy_signature, current_version_id FROM workflow_templates WHERE current_version_id IS NOT NULL").all() as { id: number; label: string; legacy_signature: string; current_version_id: number }[];
  for (const t of olds) {
    if (groups.has(t.legacy_signature)) continue; // 还在用的不算
    const rows = db.prepare("SELECT name, expected_days FROM workflow_template_steps WHERE version_id = ? ORDER BY step_order").all(t.current_version_id) as { name: string; expected_days: number | null }[];
    if (JSON.stringify(rows.map((r) => r.name)) !== names || !rows.some((r) => r.expected_days != null)) continue;
    return { steps: steps.map((s, i) => ({ ...s, expected_days: rows[i].expected_days })), from: t.label };
  }
  return { steps, from: null };
}

export type WorkflowEdit = { step_order: number; assignee: string; notes: string; docs: string[]; expected_days: number | null };

/** 发布新版本：只能改默认经办人、预计天数、备注、所需文件。 */
export function publishWorkflowVersion(db: Database.Database, templateId: number, edits: WorkflowEdit[], note: string, actor: string, baseVersionId?: number | null): { version: number } {
  const tpl = db.prepare("SELECT id, label, current_version_id FROM workflow_templates WHERE id = ?").get(templateId) as { id: number; label: string; current_version_id: number | null } | undefined;
  if (!tpl || !tpl.current_version_id) throw new WorkflowEditError("流程不存在");
  // 页面打开时是哪一版：跟现在正在用的不一样，说明别人刚改过，不能拿旧内容盖掉
  if (baseVersionId != null && Number(baseVersionId) !== tpl.current_version_id) throw new WorkflowConflictError("别人刚改过这套流程，请刷新页面看最新的再改");
  const current = db.prepare("SELECT step_order, name, assignee, notes, docs_json, expected_days FROM workflow_template_steps WHERE version_id = ? ORDER BY step_order").all(tpl.current_version_id) as
    { step_order: number; name: string; assignee: string; notes: string; docs_json: string; expected_days: number | null }[];
  if (!Array.isArray(edits) || edits.length !== current.length || edits.some((e, i) => Number(e?.step_order) !== current[i].step_order)) {
    throw new WorkflowEditError("步骤数量或顺序不对：这一期不能增删、调顺序");
  }
  const staff = staffSets(db).active;
  const steps: Step[] = current.map((cur, i) => {
    const e = edits[i];
    const assignee = String(e.assignee ?? "").trim();
    // 经办人：空（算订单负责人）、原来的值（合作方、几个人写在一起的保留），或者在职员工
    if (assignee && assignee !== cur.assignee && !staff.has(assignee)) throw new WorkflowEditError(`「${cur.name}」的经办人只能选在岗员工`);
    const daysRaw = e.expected_days;
    const days = daysRaw === null || daysRaw === undefined || (daysRaw as unknown) === "" ? null : Number(daysRaw);
    if (days !== null && (!Number.isFinite(days) || days <= 0 || days > 365 || Math.round(days * 2) !== days * 2)) {
      throw new WorkflowEditError(`「${cur.name}」的预计天数要填 0.5 到 365 之间、按半天算的数`);
    }
    const notes = String(e.notes ?? "").trim();
    if (notes.length > 500) throw new WorkflowEditError(`「${cur.name}」的备注太长（最多 500 字）`);
    const docs = [...new Set((Array.isArray(e.docs) ? e.docs : []).map((d) => String(d).trim()).filter(Boolean))];
    if (docs.length > 30 || docs.some((d) => d.length > 60)) throw new WorkflowEditError(`「${cur.name}」的所需文件最多 30 项，每项不超过 60 字`);
    if (i === 0 && (assignee !== cur.assignee || JSON.stringify(docs) !== cur.docs_json)) {
      // 第一步「方案确认」经办人、资料不开放（谁都能操作、建单时就有）；备注和天数可以改
      throw new WorkflowEditError("第一步「方案确认」的经办人和资料不能改");
    }
    return { name: cur.name, assignee, notes, docs, expected_days: days };
  });
  assertNoGoneAssignee(db, steps);
  const same = steps.every((s, i) => s.assignee === current[i].assignee && s.notes === current[i].notes && JSON.stringify(s.docs) === current[i].docs_json && s.expected_days === current[i].expected_days);
  if (same) throw new WorkflowEditError("没有改动，不用发布");
  const result = db.transaction(() => insertVersion(db, templateId, steps, String(note || "").trim().slice(0, 200), actor))();
  logOperation(actor, "发布流程", "workflow", String(templateId), `${tpl.label} 第 ${result.version} 版`);
  return { version: result.version };
}

/** 退回：把某个旧版本原样再发布成新版本。 */
export function rollbackWorkflow(db: Database.Database, templateId: number, versionId: number, actor: string, baseVersionId?: number | null): { version: number } {
  const old = db.prepare("SELECT v.id, v.version, t.label FROM workflow_template_versions v JOIN workflow_templates t ON t.id = v.template_id WHERE v.id = ? AND v.template_id = ?")
    .get(versionId, templateId) as { id: number; version: number; label: string } | undefined;
  if (!old) throw new WorkflowEditError("版本不存在");
  const cur = (db.prepare("SELECT current_version_id AS v FROM workflow_templates WHERE id = ?").get(templateId) as { v: number }).v;
  if (baseVersionId != null && Number(baseVersionId) !== cur) throw new WorkflowConflictError("别人刚改过这套流程，请刷新页面看最新的再退回");
  if (cur === versionId) throw new WorkflowEditError("正在用的就是这一版");
  const steps = (db.prepare("SELECT name, assignee, notes, docs_json, expected_days FROM workflow_template_steps WHERE version_id = ? ORDER BY step_order").all(versionId) as
    { name: string; assignee: string; notes: string; docs_json: string; expected_days: number | null }[])
    .map((s) => ({ name: s.name, assignee: s.assignee, notes: s.notes, docs: JSON.parse(s.docs_json || "[]") as string[], expected_days: s.expected_days }));
  assertNoGoneAssignee(db, steps);
  const result = db.transaction(() => insertVersion(db, templateId, steps, `退回到第 ${old.version} 版`, actor))();
  logOperation(actor, "退回流程", "workflow", String(templateId), `${old.label} 退回到第 ${old.version} 版（新第 ${result.version} 版）`);
  return { version: result.version };
}

/** 某套流程的版本历史 */
export function workflowVersions(db: Database.Database, templateId: number) {
  return db.prepare("SELECT id, version, note, published_by, published_at FROM workflow_template_versions WHERE template_id = ? ORDER BY version DESC").all(templateId) as
    { id: number; version: number; note: string; published_by: string; published_at: string }[];
}
