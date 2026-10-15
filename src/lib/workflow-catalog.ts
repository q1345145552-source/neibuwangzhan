import type Database from "better-sqlite3";
import { getOrderStepsWithDocs } from "@/lib/db";
import { subServices } from "@/lib/constants";
import { publicStepNames, isReviewedStepTemplate, NEUTRAL_PUBLIC_STEP_NAME } from "@/lib/commerce-fulfillment";
import { isExternalWait } from "@/lib/handling-report";

/**
 * 流程设置只读清单（2026-10-15，第 1 期）：把现在写在程序里的流程原样列出来给老板核对。
 * 只读不改；第 2 期搬进数据库、第 3 期才开放改经办人和天数。
 */

export type CatalogStep = { name: string; publicName: string; assignee: string; docs: string[]; notes: string; external: boolean; locked: boolean };
export type CatalogEntry = {
  key: string;
  business: string;
  services: string[];
  steps: CatalogStep[];
  /** 整套步骤在已审核模板里：客户站/商城给客户看的名字都核对过 */
  reviewed: boolean;
  /** 客户看到的是「办理事项」的步骤数 */
  neutralSteps: number;
  /** 步骤名里写着的员工名 */
  personNames: string[];
  /** 还没配流程（只有「方案确认」+「待定」） */
  unconfigured: boolean;
  /** 现在还在办、用这套流程的单数 */
  inProgress: number;
};

type Combo = { sub: string; addr: string; label: string; hiddenIfMerged?: boolean };
const signature = (tpl: ReturnType<typeof getOrderStepsWithDocs>) => JSON.stringify(tpl.map(s => [s.name, s.assignee, s.docs, s.notes || ""]));

export function buildWorkflowCatalog(db: Database.Database): CatalogEntry[] {
  const bts = db.prepare("SELECT id, name FROM business_types ORDER BY id").all() as { id: number; name: string }[];
  const staff = (db.prepare("SELECT DISTINCT name FROM employees WHERE role IN ('admin','employee') AND length(trim(name)) >= 2").all() as { name: string }[]).map(e => e.name.trim());
  const live = db.prepare(
    "SELECT business_type_id AS bt, COALESCE(sub_service_type,'') AS sub, COALESCE(address_type,'') AS addr, COUNT(*) AS n FROM orders WHERE status NOT IN ('已完成','客户取消') GROUP BY 1,2,3"
  ).all() as { bt: number; sub: string; addr: string; n: number }[];

  const entries: CatalogEntry[] = [];
  for (const bt of bts) {
    let combos: Combo[];
    if (bt.name === "待分类") combos = [{ sub: "storefront-unclassified", addr: "", label: "客户站来的未匹配单" }];
    else if (bt.name === "地址认证") combos = [{ sub: "", addr: "client", label: "客户地址" }, { sub: "", addr: "xiangtai", label: "湘泰地址" }];
    else {
      const subs = subServices[bt.id] || [];
      combos = subs.length
        ? [...subs.map(x => ({ sub: x.key, addr: "", label: x.label })), { sub: "", addr: "", label: "没选具体服务的老单", hiddenIfMerged: true }]
        : [{ sub: "", addr: "", label: bt.name }];
    }

    const own: CatalogEntry[] = [];
    const byTemplate = new Map<string, CatalogEntry>();
    for (const c of combos) {
      const tpl = getOrderStepsWithDocs(bt.id, c.sub || undefined, c.addr || undefined);
      const names = tpl.map(s => s.name);
      const pub = publicStepNames(names);
      const sig = signature(tpl);
      const same = byTemplate.get(sig);
      if (same) {
        if (!c.hiddenIfMerged) same.services.push(c.label);
        continue;
      }
      if (c.hiddenIfMerged && !live.some(r => r.bt === bt.id && signature(getOrderStepsWithDocs(bt.id, r.sub || undefined, r.addr || undefined)) === sig)) continue;
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
        })),
        reviewed: isReviewedStepTemplate(names),
        neutralSteps: pub.filter(p => p === NEUTRAL_PUBLIC_STEP_NAME).length,
        personNames: staff.filter(n => names.some(x => x.includes(n))),
        unconfigured: names.length === 2 && names[1] === "待定",
        inProgress: 0,
      };
      byTemplate.set(sig, entry);
      own.push(entry);
    }
    // 还在办的单按「这张单实际会用哪套流程」归组：客户站、商城来的社保单子服务写的是 social-security，内部建的是空，用的是同一套
    for (const r of live.filter(x => x.bt === bt.id)) {
      const target = byTemplate.get(signature(getOrderStepsWithDocs(bt.id, r.sub || undefined, r.addr || undefined)));
      if (target) target.inProgress += r.n;
    }
    entries.push(...own);
  }
  return entries;
}
