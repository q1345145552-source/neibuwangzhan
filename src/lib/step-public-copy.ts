import { getLegacyOrderStepsWithDocs } from "./db";
import { orderPublicStepNames, publicStepNames } from "./commerce-fulfillment";
import { COMPANY_REGISTRATION_STEP_COPY } from "./company-registration-step-copy";
import { WORK_VISA_STEP_COPY } from "./work-visa-step-copy";
import { SOCIAL_SECURITY_STEP_COPY } from "./social-security-step-copy";
import { TM_REGISTRATION_STEP_COPY } from "./tm-registration-step-copy";
import { INTERNATIONAL_TRADEMARK_STEP_COPY } from "./international-trademark-step-copy";
import { BUY_R_TRADEMARK_STEP_COPY } from "./buy-r-trademark-step-copy";
import { FDA_STEP_COPY } from "./fda-step-copy";
import { TISI_STEP_COPY } from "./tisi-step-copy";
import { CUSTOMER_ADDRESS_STEP_COPY, XIANGTAI_ADDRESS_STEP_COPY } from "./address-certification-step-copy";
import { MALL_STEP_COPY } from "./mall-store-step-copy";

/**
 * 客户看到的步骤子标题和说明（2026-10-20 老板：「主标题是内部系统，给员工看的，子标题是放到业务系统，给客户看的」，选 1A 2A）。
 * - 文案是各 *-step-copy.ts 里写好的，一套流程一份，跟「程序里的原样流程」逐步对应（哪套用哪份跟订单详情原来的取法一样）。
 * - 订单里每一步按步骤名找文案（同名的按第几次出现），不按第几步：流程设置里加步、删步、调顺序后，说明不会挂到别的步骤下面。
 *   改过名、新加的步骤找不到，照旧用「客户看到的名字」，不带说明。
 * - 流程设置里给这一步另填了客户名字（既不是原来对照表里的名字，也不是子标题）：按填的，不套子标题。
 * - 1A：有子标题的步骤，客户看到的名字就换成子标题，下面带说明；2A：老单、新单一样换（客户站靠重发一次进度，见 progress-sync）。
 * - 客户端规矩（项目 CLAUDE.md）：不自称「我」，「我方」一律写「服务商」——文案里的「我司」在这里换掉，员工页面看到的也是换过的（跟客户看到的一样）。
 */
export type StepCopy = { title: string; description: string };
type Entry = { copy: StepCopy; legacyPublic: string } | null;

const UNCLASSIFIED_SUB = "storefront-unclassified";
const forCustomer = (text: string) => text.replace(/我司|我方|我们/g, "服务商");

/** 哪套流程用哪份文案；skipFirst：文案不含第一步「方案确认」，从第二步开始对 */
function copyListOf(bt: number, sub: string, addr: string): { list: readonly StepCopy[]; skipFirst: boolean } | null {
  if (sub === UNCLASSIFIED_SUB) return null;
  const aligned = (list: readonly StepCopy[] | undefined) => (list ? { list, skipFirst: false } : null);
  const fromSecond = (list: readonly StepCopy[] | undefined) => (list ? { list, skipFirst: true } : null);
  switch (bt) {
    case 1: return sub === "change" ? null : aligned(COMPANY_REGISTRATION_STEP_COPY);
    case 2: return fromSecond(sub === "tm-reg" || !sub ? TM_REGISTRATION_STEP_COPY
      : sub === "international" ? INTERNATIONAL_TRADEMARK_STEP_COPY
      : sub === "buy-r" ? BUY_R_TRADEMARK_STEP_COPY : undefined);
    case 3: return aligned(FDA_STEP_COPY[sub]);
    case 4: return aligned(TISI_STEP_COPY);
    case 7: return aligned(addr === "xiangtai" ? XIANGTAI_ADDRESS_STEP_COPY : !addr || addr === "client" ? CUSTOMER_ADDRESS_STEP_COPY : undefined);
    case 8: return aligned(MALL_STEP_COPY[sub || "shopee"]);
    case 10: return fromSecond(WORK_VISA_STEP_COPY);
    case 11: return fromSecond(SOCIAL_SECURITY_STEP_COPY);
    default: return null;
  }
}

// 程序里的流程和文案都是写死的，按流程算一次就够
const indexCache = new Map<string, Map<string, Entry[]> | null>();
function indexOf(bt: number, sub: string, addr: string): Map<string, Entry[]> | null {
  const key = `${bt}|${sub}|${addr}`;
  if (indexCache.has(key)) return indexCache.get(key)!;
  const source = copyListOf(bt, sub, addr);
  let index: Map<string, Entry[]> | null = null;
  if (source) {
    const names = getLegacyOrderStepsWithDocs(bt, sub || undefined, addr || undefined).map(s => s.name);
    const legacyPublic = publicStepNames(names);
    index = new Map();
    names.forEach((name, i) => {
      const copy = source.skipFirst ? (i === 0 ? undefined : source.list[i - 1]) : source.list[i];
      // 没文案的也占一个位置：同名步骤按第几次出现对，不能错位
      const list = index!.get(name) ?? [];
      list.push(copy ? { copy: { title: forCustomer(copy.title), description: forCustomer(copy.description) }, legacyPublic: legacyPublic[i] } : null);
      index!.set(name, list);
    });
  }
  indexCache.set(key, index);
  return index;
}

type OrderKey = { business_type_id?: unknown; sub_service_type?: unknown; address_type?: unknown };
type StepKey = { step_name: string; public_name?: string | null };

/** 一张单（或一套流程）每一步对应的子标题和说明；没有的是 null */
export function resolveStepCopies(order: OrderKey, steps: readonly StepKey[]): (StepCopy | null)[] {
  const index = indexOf(Number(order.business_type_id), String(order.sub_service_type ?? ""), String(order.address_type ?? ""));
  if (!index) return steps.map(() => null);
  const seen = new Map<string, number>();
  return steps.map(step => {
    const k = seen.get(step.step_name) ?? 0;
    seen.set(step.step_name, k + 1);
    const entry = index.get(step.step_name)?.[k];
    if (!entry) return null;
    const saved = (step.public_name || "").trim();
    if (saved && saved !== entry.legacyPublic && saved !== entry.copy.title) return null;
    return { ...entry.copy };
  });
}

/** 客户看到的每一步：名字（有子标题用子标题）和说明（没有是 null） */
export function customerStepView(order: OrderKey, steps: readonly StepKey[]): { name: string; description: string | null }[] {
  const names = orderPublicStepNames(steps);
  const copies = resolveStepCopies(order, steps);
  return steps.map((_, i) => ({ name: copies[i]?.title ?? names[i], description: copies[i]?.description ?? null }));
}
