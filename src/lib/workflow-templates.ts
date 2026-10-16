import type Database from "better-sqlite3";
import { getLegacyOrderStepsWithDocs, getOrderStepsWithDocs, logOperation, templateSignature } from "@/lib/db";
import { combosOf } from "@/lib/workflow-catalog";
import { publicStepNames } from "@/lib/commerce-fulfillment";

/**
 * 流程设置第 2、3 期（2026-10-16）：导入、发布新版本、退回旧版本。
 * - 导入：把程序里现有的每一套流程原样存成第 1 版；导入完逐个组合核对，系统里读出来的跟程序里的一模一样才提交（行为不变）。
 * - 发布：改默认经办人、预计天数（工作日）、备注、所需文件（第 3 期）；第 4 期（2026-10-16 老板选 1A）起还能改步骤名、增删步骤、调顺序，
 *   每一步都要填「客户看到的名字」（客户站、商城显示它）。只影响之后新建的单，已建的单（包括客户看到的名字）不跟着变。
 *   锁住的：第一步「方案确认」（名字、位置、经办人、资料）；「待分类」那套整体结构（改派按名字找「确认归属」「办理并交付」）。
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

type Step = { name: string; assignee: string; notes: string; docs: string[]; expected_days: number | null; public_name: string | null };

function insertVersion(db: Database.Database, templateId: number, steps: Step[], note: string, actor: string): { versionId: number; version: number } {
  const next = ((db.prepare("SELECT MAX(version) AS v FROM workflow_template_versions WHERE template_id = ?").get(templateId) as { v: number | null }).v ?? 0) + 1;
  const versionId = Number(db.prepare("INSERT INTO workflow_template_versions (template_id, version, note, published_by) VALUES (?, ?, ?, ?)")
    .run(templateId, next, note, actor).lastInsertRowid);
  const ins = db.prepare("INSERT INTO workflow_template_steps (version_id, step_order, name, assignee, notes, docs_json, expected_days, public_name) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
  steps.forEach((s, i) => ins.run(versionId, i + 1, s.name, s.assignee, s.notes, JSON.stringify(s.docs), s.expected_days, s.public_name));
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
      // 客户看到的名字照现在的对照表原样记下（跟导入前客户看到的一模一样）
      const pub = publicStepNames(legacy.map((s) => s.name));
      groups.set(sig, {
        business: bt.name,
        labels: c.hiddenIfMerged ? [] : [c.label],
        steps: legacy.map((s, i) => ({ name: s.name, assignee: s.assignee || "", notes: s.notes || "", docs: [...(s.docs || [])], expected_days: null, public_name: pub[i] })),
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

/**
 * 页面提交的一步。from = 这一步原来是第几步（新加的步骤为空）；老写法只带 step_order（= from）、不带名字，表示名字不变。
 * 名字、客户看到的名字不带就沿用原来那步的。
 */
export type WorkflowEdit = {
  from?: number | null; step_order?: number;
  name?: string; public_name?: string;
  assignee: string; notes: string; docs: string[]; expected_days: number | null;
};

const MAX_STEPS = 40;
const MAX_NAME = 200;
const MAX_PUBLIC_NAME = 40;

/** 「待分类」那套：改派按名字找「确认归属」「办理并交付」，结构不能动 */
function isUnclassifiedTemplate(db: Database.Database, legacySignature: string): boolean {
  const bt = db.prepare("SELECT id FROM business_types WHERE name = '待分类'").get() as { id: number } | undefined;
  return !!bt && templateSignature(getLegacyOrderStepsWithDocs(bt.id, "storefront-unclassified")) === legacySignature;
}

/** 发布新版本。 */
export function publishWorkflowVersion(db: Database.Database, templateId: number, edits: WorkflowEdit[], note: string, actor: string, baseVersionId?: number | null): { version: number } {
  const tpl = db.prepare("SELECT id, label, legacy_signature, current_version_id FROM workflow_templates WHERE id = ?").get(templateId) as { id: number; label: string; legacy_signature: string; current_version_id: number | null } | undefined;
  if (!tpl || !tpl.current_version_id) throw new WorkflowEditError("流程不存在");
  // 页面打开时是哪一版：跟现在正在用的不一样，说明别人刚改过，不能拿旧内容盖掉
  if (baseVersionId != null && Number(baseVersionId) !== tpl.current_version_id) throw new WorkflowConflictError("别人刚改过这套流程，请刷新页面看最新的再改");
  const rows = db.prepare("SELECT step_order, name, assignee, notes, docs_json, expected_days, public_name FROM workflow_template_steps WHERE version_id = ? ORDER BY step_order").all(tpl.current_version_id) as
    { step_order: number; name: string; assignee: string; notes: string; docs_json: string; expected_days: number | null; public_name: string | null }[];
  // 早先导入、还没记客户名的版本：按现在的对照表补上（就是客户现在看到的）
  const legacyPub = publicStepNames(rows.map((r) => r.name));
  const current = rows.map((r, i) => ({ ...r, public_name: (r.public_name || "").trim() || legacyPub[i] }));
  if (!Array.isArray(edits) || edits.length < 2) throw new WorkflowEditError("至少要有两步");
  if (edits.length > MAX_STEPS) throw new WorkflowEditError(`一套流程最多 ${MAX_STEPS} 步`);

  const staff = staffSets(db).active;
  const used = new Set<number>();
  const froms: (number | null)[] = [];
  const steps: Step[] = edits.map((e, i) => {
    const fromRaw = e?.from ?? e?.step_order ?? null;
    const from = fromRaw === null || fromRaw === undefined || (fromRaw as unknown) === "" ? null : Number(fromRaw);
    if (from !== null && (!Number.isInteger(from) || from < 1 || from > current.length || used.has(from))) throw new WorkflowEditError("步骤对不上，请刷新页面再改");
    if (from !== null) used.add(from);
    froms.push(from);
    const base = from !== null ? current[from - 1] : null;
    if ((e.name != null && typeof e.name !== "string") || (e.public_name != null && typeof e.public_name !== "string")) throw new WorkflowEditError(`第 ${i + 1} 步的名字格式不对`);
    const name = (e.name == null ? base?.name ?? "" : e.name).trim();
    const label = name || `第 ${i + 1} 步`;
    if (!name) throw new WorkflowEditError(`第 ${i + 1} 步还没写步骤名`);
    if (name.length > MAX_NAME) throw new WorkflowEditError(`「${label.slice(0, 20)}…」步骤名太长（最多 ${MAX_NAME} 字）`);
    const publicName = (e.public_name == null ? base?.public_name ?? "" : e.public_name).trim();
    if (!publicName) throw new WorkflowEditError(`「${label}」还没填客户看到的名字`);
    if (publicName.length > MAX_PUBLIC_NAME) throw new WorkflowEditError(`「${label}」客户看到的名字太长（最多 ${MAX_PUBLIC_NAME} 字）`);
    const assignee = String(e.assignee ?? "").trim();
    // 经办人：空（算订单负责人）、原来那步的值（合作方、几个人写在一起的保留），或者在岗员工
    if (assignee && assignee !== base?.assignee && !staff.has(assignee)) throw new WorkflowEditError(`「${label}」的经办人只能选在岗员工`);
    const daysRaw = e.expected_days;
    const days = daysRaw === null || daysRaw === undefined || (daysRaw as unknown) === "" ? null : Number(daysRaw);
    if (days !== null && (!Number.isFinite(days) || days <= 0 || days > 365 || Math.round(days * 2) !== days * 2)) {
      throw new WorkflowEditError(`「${label}」的预计天数要填 0.5 到 365 之间、按半天算的数`);
    }
    const notes = String(e.notes ?? "").trim();
    if (notes.length > 500) throw new WorkflowEditError(`「${label}」的备注太长（最多 500 字）`);
    const docs = [...new Set((Array.isArray(e.docs) ? e.docs : []).map((d) => String(d).trim()).filter(Boolean))];
    if (docs.length > 30 || docs.some((d) => d.length > 60)) throw new WorkflowEditError(`「${label}」的所需文件最多 30 项，每项不超过 60 字`);
    return { name, assignee, notes, docs, expected_days: days, public_name: publicName };
  });

  // 第一步「方案确认」固定：每张单都有、谁都能操作、建单时就有；名字、位置、经办人、资料都不能动（备注和天数可以改）
  const first = current[0];
  if (froms[0] !== 1 || steps[0].name !== first.name || steps[0].public_name !== first.public_name ||
      steps[0].assignee !== first.assignee || JSON.stringify(steps[0].docs) !== first.docs_json) {
    throw new WorkflowEditError(`第一步「${first.name}」固定在最前面，名字、经办人和资料不能改`);
  }
  // 「待分类」那套：只能改经办人、天数、备注、资料，步骤名和顺序不能动
  if (isUnclassifiedTemplate(db, tpl.legacy_signature) &&
      (steps.length !== current.length || steps.some((s, i) => froms[i] !== i + 1 || s.name !== current[i].name || s.public_name !== current[i].public_name))) {
    throw new WorkflowEditError("「待分类」这套流程的步骤名和顺序不能改（改派要按名字找「确认归属」）");
  }
  assertNoGoneAssignee(db, steps);
  const same = steps.length === current.length && steps.every((s, i) => froms[i] === i + 1 && s.name === current[i].name &&
    s.public_name === current[i].public_name && s.assignee === current[i].assignee && s.notes === current[i].notes &&
    JSON.stringify(s.docs) === current[i].docs_json && s.expected_days === current[i].expected_days);
  if (same) throw new WorkflowEditError("没有改动，不用发布");
  const result = db.transaction(() => insertVersion(db, templateId, steps, String(note || "").trim().slice(0, 200), actor))();
  logOperation(actor, "发布流程", "workflow", String(templateId), `${tpl.label} 第 ${result.version} 版（${steps.length} 步）`);
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
  const steps = (db.prepare("SELECT name, assignee, notes, docs_json, expected_days, public_name FROM workflow_template_steps WHERE version_id = ? ORDER BY step_order").all(versionId) as
    { name: string; assignee: string; notes: string; docs_json: string; expected_days: number | null; public_name: string | null }[])
    .map((s) => ({ name: s.name, assignee: s.assignee, notes: s.notes, docs: JSON.parse(s.docs_json || "[]") as string[], expected_days: s.expected_days, public_name: s.public_name }));
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
