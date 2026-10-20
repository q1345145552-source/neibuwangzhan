import path from "node:path";
import os from "node:os";
import { existsSync } from "node:fs";
import type Database from "better-sqlite3";
import { getLegacyOrderStepsWithDocs, templateSignature } from "./db";
import { uploadsDir } from "./uploads";

/**
 * 订单资料包（2026-10-20 老板 2A）：说明书、资料收集表每种业务固定一份，在流程设置里配（workflow_template_files），
 * 这种业务的订单客户打开就能看到——新单老单都一样，流程设置里换了文件，客户看到的跟着换。
 * 订单认哪套流程：按订单的业务线 + 具体服务 + 地址类型找「程序里的原样流程」的指纹，跟流程设置、建单同一个认法。
 */
export type KitKind = "说明书" | "资料收集表";
export const KIT_KINDS: readonly KitKind[] = ["说明书", "资料收集表"];
export type KitFile = { id: number; kind: KitKind; name: string; ext: string; file_url: string; template_id: number };

type OrderCombo = { business_type_id: number | null; sub_service_type: string | null; address_type: string | null };

export function templateIdForOrder(db: Database.Database, order: OrderCombo): number | null {
  if (!order.business_type_id) return null;
  const sig = templateSignature(getLegacyOrderStepsWithDocs(Number(order.business_type_id), order.sub_service_type || undefined, order.address_type || undefined));
  return (db.prepare("SELECT id FROM workflow_templates WHERE legacy_signature = ?").get(sig) as { id: number } | undefined)?.id ?? null;
}

export function templateFiles(db: Database.Database, templateIds: number[]): KitFile[] {
  if (!templateIds.length) return [];
  const rows = db.prepare(`SELECT id, template_id, kind, name, file_url FROM workflow_template_files
    WHERE deleted_at IS NULL AND template_id IN (${templateIds.map(() => "?").join(",")}) ORDER BY kind, id`).all(...templateIds) as Omit<KitFile, "ext">[];
  return rows.map(r => ({ ...r, ext: path.extname(r.file_url).toLowerCase() }));
}

/** 一张内部办理单客户能看到的资料包 */
export function kitForOrder(db: Database.Database, orderId: string): KitFile[] {
  const order = db.prepare("SELECT business_type_id, sub_service_type, address_type FROM orders WHERE id = ?").get(orderId) as OrderCombo | undefined;
  const templateId = order ? templateIdForOrder(db, order) : null;
  return templateId ? templateFiles(db, [templateId]) : [];
}

/** 一张客户站订单（可能拆成几张办理单、几套流程）的资料包，同一份文件只列一次 */
export function kitForSourceOrder(db: Database.Database, sourceOrderNo: string): KitFile[] {
  const orders = db.prepare(`SELECT o.business_type_id, o.sub_service_type, o.address_type FROM orders o
    WHERE o.id IN (SELECT internal_order_id FROM sync_inbox WHERE source_order_no = ? AND internal_order_id IS NOT NULL) AND o.status <> '客户取消'`).all(sourceOrderNo) as OrderCombo[];
  const ids = [...new Set(orders.map(o => templateIdForOrder(db, o)).filter((id): id is number => id !== null))];
  return templateFiles(db, ids);
}

/** 资料包里这份文件在磁盘上的位置；不属于这张单的资料包、或文件没了，返回 null */
export function kitFilePath(db: Database.Database, sourceOrderNo: string, fileId: number): { file: KitFile; abs: string } | null {
  const file = kitForSourceOrder(db, sourceOrderNo).find(f => f.id === fileId);
  if (!file || !file.file_url.startsWith("/api/files/")) return null;
  // 跟 /api/files 一样：数据目录写不了时上传会落到临时目录
  const name = path.basename(file.file_url);
  const abs = [uploadsDir, path.join(os.tmpdir(), "xiangtai-uploads")].map(dir => path.join(dir, name)).find(existsSync);
  return abs ? { file, abs } : null;
}
