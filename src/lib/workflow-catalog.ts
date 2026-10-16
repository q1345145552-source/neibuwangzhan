import type Database from "better-sqlite3";
import { getOrderStepsWithDocs, getLegacyOrderStepsWithDocs, templateSignature } from "@/lib/db";
import { subServices } from "@/lib/constants";
import { publicStepNames, isReviewedStepTemplate, NEUTRAL_PUBLIC_STEP_NAME } from "@/lib/commerce-fulfillment";
import { isExternalWait } from "@/lib/handling-report";

/**
 * 流程设置只读清单（2026-10-15，第 1 期）：把现在写在程序里的流程原样列出来给老板核对。
 * 第 2 期搬进数据库、第 3 期开放改经办人和天数、第 4 期（2026-10-16）开放改名/增删/调顺序和「客户看到的名字」。
 */

export type CatalogStep = { name: string; publicName: string; assignee: string; docs: string[]; notes: string; external: boolean; locked: boolean; expectedDays: number | null };
export type CatalogEntry = {
  key: string;
  business: string;
  services: string[];
  steps: CatalogStep[];
  /** 整套步骤在已审核模板里：客户站/商城给客户看的名字都核对过 */
  reviewed: boolean;
  /** 客户看到的名字在流程设置里改过（跟原来对照表算出来的不一样） */
  customPublicNames: boolean;
  /** 步骤名和顺序不能改（「待分类」那套：改派按名字找步骤） */
  structureLocked: boolean;
  /** 客户看到的是「办理事项」的步骤数 */
  neutralSteps: number;
  /** 步骤名里写着的员工名 */
  personNames: string[];
  /** 还没配流程（只有「方案确认」+「待定」） */
  unconfigured: boolean;
  /** 现在还在办、用这套流程的单数 */
  inProgress: number;
  /** 已导入系统：对应的流程编号、正在用的版本号（第 2 期，2026-10-16）；没导入是 null */
  templateId: number | null;
  version: number | null;
  /** 正在用的版本的编号（发布、退回时带上，防止两个人同时改互相盖掉） */
  versionId: number | null;
};

export type Combo = { sub: string; addr: string; label: string; hiddenIfMerged?: boolean };

/** 一条业务线有哪些流程组合（具体服务 × 地址类型）；流程清单和导入流程共用 */
export function combosOf(bt: { id: number; name: string }): Combo[] {
  if (bt.name === "待分类") return [{ sub: "storefront-unclassified", addr: "", label: "客户站来的未匹配单" }];
  if (bt.name === "地址认证") return [{ sub: "", addr: "client", label: "客户地址" }, { sub: "", addr: "xiangtai", label: "湘泰地址" }];
  const subs = subServices[bt.id] || [];
  return subs.length
    ? [...subs.map(x => ({ sub: x.key, addr: "", label: x.label })), { sub: "", addr: "", label: "没选具体服务的老单", hiddenIfMerged: true }]
    : [{ sub: "", addr: "", label: bt.name }];
}
// 按「程序里的原样流程」分组：系统里的流程就是按它认的，改过经办人/天数也还是同一套
const legacySig = (btId: number, sub: string, addr: string) => templateSignature(getLegacyOrderStepsWithDocs(btId, sub || undefined, addr || undefined));

export function buildWorkflowCatalog(db: Database.Database): CatalogEntry[] {
  const bts = db.prepare("SELECT id, name FROM business_types ORDER BY id").all() as { id: number; name: string }[];
  const staff = (db.prepare("SELECT DISTINCT name FROM employees WHERE role IN ('admin','employee') AND length(trim(name)) >= 2").all() as { name: string }[]).map(e => e.name.trim());
  const live = db.prepare(
    "SELECT business_type_id AS bt, COALESCE(sub_service_type,'') AS sub, COALESCE(address_type,'') AS addr, COUNT(*) AS n FROM orders WHERE status NOT IN ('已完成','客户取消') GROUP BY 1,2,3"
  ).all() as { bt: number; sub: string; addr: string; n: number }[];
  const templateOf = new Map((db.prepare(
    "SELECT t.id, t.legacy_signature AS sig, v.version, t.current_version_id AS versionId FROM workflow_templates t LEFT JOIN workflow_template_versions v ON v.id = t.current_version_id"
  ).all() as { id: number; sig: string; version: number | null; versionId: number | null }[]).map(t => [t.sig, t]));

  const entries: CatalogEntry[] = [];
  for (const bt of bts) {
    const combos = combosOf(bt);

    const own: CatalogEntry[] = [];
    const byTemplate = new Map<string, CatalogEntry>();
    for (const c of combos) {
      const tpl = getOrderStepsWithDocs(bt.id, c.sub || undefined, c.addr || undefined);
      const names = tpl.map(s => s.name);
      // 客户看到的名字：系统里这一版记下的；没记的（程序里的原样流程、早先导入的）按对照表算，跟客户现在看到的一样
      const legacyPub = publicStepNames(names);
      const pub = tpl.map((s, i) => (s.public_name || "").trim() || legacyPub[i]);
      // 步骤名、步骤数跟程序里的原样流程不一样：在流程设置里改过
      const renamed = JSON.stringify(names) !== JSON.stringify(getLegacyOrderStepsWithDocs(bt.id, c.sub || undefined, c.addr || undefined).map(s => s.name));
      const sig = legacySig(bt.id, c.sub, c.addr);
      const same = byTemplate.get(sig);
      if (same) {
        if (!c.hiddenIfMerged) same.services.push(c.label);
        continue;
      }
      if (c.hiddenIfMerged && !live.some(r => r.bt === bt.id && legacySig(bt.id, r.sub, r.addr) === sig)) continue;
      const template = templateOf.get(sig);
      const entry: CatalogEntry = {
        key: `${bt.id}:${c.sub}:${c.addr}`,
        business: bt.name,
        services: [c.label],
        steps: tpl.map((s, i) => ({
          name: s.name,
          publicName: pub[i],
          assignee: s.assignee || "",
          docs: s.docs || [],
          notes: s.notes || "",
          external: isExternalWait(s.name),
          locked: i === 0 || bt.name === "待分类",
          expectedDays: s.expected_days ?? null,
        })),
        reviewed: isReviewedStepTemplate(names) && pub.every((p, i) => p === legacyPub[i]),
        customPublicNames: tpl.some(s => !!s.public_name) && (renamed || pub.some((p, i) => p !== legacyPub[i])),
        structureLocked: bt.name === "待分类",
        neutralSteps: pub.filter(p => p === NEUTRAL_PUBLIC_STEP_NAME).length,
        personNames: staff.filter(n => names.some(x => x.includes(n))),
        unconfigured: names.length === 2 && names[1] === "待定",
        inProgress: 0,
        templateId: template?.id ?? null,
        version: template?.version ?? null,
        versionId: template?.versionId ?? null,
      };
      byTemplate.set(sig, entry);
      own.push(entry);
    }
    // 还在办的单按「这张单实际会用哪套流程」归组：客户站、商城来的社保单子服务写的是 social-security，内部建的是空，用的是同一套
    for (const r of live.filter(x => x.bt === bt.id)) {
      const target = byTemplate.get(legacySig(bt.id, r.sub, r.addr));
      if (target) target.inProgress += r.n;
    }
    entries.push(...own);
  }
  return entries;
}
