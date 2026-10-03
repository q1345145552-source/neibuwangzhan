import { randomUUID } from 'node:crypto';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { NextRequest, NextResponse } from 'next/server';
import { readJson } from '@/lib/req';
import { getDb, logOperation } from '@/lib/db';
import { isSyncRequest, syncRateLimited, recordSyncAuthFailure } from '@/lib/sync-auth';
import { notifyCustomerDocuments } from '@/lib/order-alerts';
import { markRequestSubmitted } from '@/lib/delivery-sync';

/**
 * 资料打通（2026-10-03，规则 12）：接收客户站按单批量送来的资料清单。
 * 文件用同一把服务密钥从客户站回拉（不受本站上传大小/代理请求体限制），文字资料随清单带来存成 .txt。
 * 一份资料挂到该客户单拆出的每一份办理单上；同一份重复送来只认一次；客户删除的补充图片保留记录、名称标「（客户已删除）」。
 */
const MAX_FILE = 12 * 1024 * 1024; // 客户站上传上限 10MB，留余量
const FETCH_TIMEOUT_MS = 60_000;
const EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.pdf', '.xlsx', '.xls', '.txt', '.csv', '.doc', '.docx']);
const ID = /^[A-Za-z0-9_-]{1,80}$/;

type Item = { kind: 'submit' | 'withdraw'; submission_id: string; name: string; requirement: string | null; requirement_id?: string; type: 'file' | 'text'; text?: string };
type Result = { submission_id: string; kind: string; status: string; note?: string };
class BadRequest extends Error {}

function text(value: unknown, field: string, max: number, required = true): string {
  if (value === undefined || value === null || value === '') { if (required) throw new BadRequest(`缺少 ${field}`); return ''; }
  if (typeof value !== 'string' || value.length > max) throw new BadRequest(`${field} 格式错误`);
  return value;
}
function parse(body: unknown) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new BadRequest('请求格式错误');
  const b = body as Record<string, unknown>;
  const sourceOrderNo = text(b.source_order_no, 'source_order_no', 64);
  const customer = (b.customer && typeof b.customer === 'object' ? b.customer : {}) as Record<string, unknown>;
  const customerName = text(customer.name, 'customer.name', 100, false);
  if (!Array.isArray(b.items) || b.items.length === 0 || b.items.length > 50) throw new BadRequest('资料清单为空或过长');
  const items: Item[] = b.items.map((raw: unknown) => {
    const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    if (r.kind !== 'submit' && r.kind !== 'withdraw') throw new BadRequest('资料动作无效');
    const submissionId = text(r.submission_id, 'submission_id', 80);
    if (!ID.test(submissionId)) throw new BadRequest('submission_id 格式错误');
    if (r.kind === 'withdraw') return { kind: 'withdraw', submission_id: submissionId, name: '', requirement: null, type: 'file' };
    if (r.type !== 'file' && r.type !== 'text') throw new BadRequest('资料类型无效');
    return { kind: 'submit', submission_id: submissionId, name: text(r.name, 'name', 255), requirement: text(r.requirement, 'requirement', 200, false) || null,
      requirement_id: text(r.requirement_id, 'requirement_id', 120, false) || undefined,
      type: r.type, ...(r.type === 'text' ? { text: text(r.text, 'text', 20_000) } : {}) };
  });
  return { sourceOrderNo, customerName, items };
}

function displayName(item: Item): string {
  const clean = item.name.replace(/^\[supplement\]\s*/, '补充资料 · ');
  return (item.requirement ? `${item.requirement} · ${clean}` : clean).slice(0, 255);
}

async function pullFile(submissionId: string): Promise<Buffer | 'gone'> {
  const base = process.env.CUSTOMER_SYNC_URL, secret = process.env.SYNC_SECRET;
  if (!base || !secret) throw new Error('未配置客户站地址，无法取回资料文件');
  const resp = await fetch(`${base.replace(/\/$/, '')}/api/sync/documents/${encodeURIComponent(submissionId)}/file`, {
    headers: { authorization: `Bearer ${secret}` }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (resp.status === 404) return 'gone';
  if (!resp.ok) throw new Error(`取回资料文件失败 HTTP ${resp.status}`);
  const buffer = Buffer.from(await resp.arrayBuffer());
  if (buffer.length > MAX_FILE) throw new Error('资料文件超过大小上限');
  return buffer;
}

export async function POST(req: NextRequest) {
  if (syncRateLimited(req)) return NextResponse.json({ error: '尝试过于频繁，请稍后再试' }, { status: 429 });
  if (!isSyncRequest(req)) {
    recordSyncAuthFailure(req);
    return NextResponse.json({ error: '未授权' }, { status: 401 });
  }
  let input: ReturnType<typeof parse>;
  try { input = parse(await readJson(req)); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : '请求格式错误' }, { status: 400 }); }
  const { sourceOrderNo, customerName, items } = input;
  const db = getDb();
  if (!db.prepare('SELECT 1 FROM sync_orders WHERE source_order_no=?').get(sourceOrderNo)) {
    return NextResponse.json({ error: '订单尚未接收，稍后重试' }, { status: 409 });
  }
  const orderIds = (db.prepare(`SELECT internal_order_id FROM sync_inbox WHERE source_order_no=? AND internal_order_id IS NOT NULL
    GROUP BY internal_order_id ORDER BY MIN(line_no), MIN(copy_no)`).all(sourceOrderNo) as { internal_order_id: string }[]).map(r => r.internal_order_id);
  const known = db.prepare('SELECT 1 FROM sync_documents WHERE submission_id=? LIMIT 1');
  const dir = path.join(process.cwd(), 'uploads');
  const results: Result[] = [];
  const staged: { item: Item; safeName: string; size: number; ext: string }[] = [];
  const cleanup = () => Promise.all(staged.map(s => unlink(path.join(dir, s.safeName)).catch(() => {})));
  try {
    // 网络和写文件都在事务外；事务失败就删掉这批刚写的文件，客户站会整批重试
    await mkdir(dir, { recursive: true });
    for (const item of items) {
      if (item.kind === 'withdraw') continue;
      if (!orderIds.length) { results.push({ submission_id: item.submission_id, kind: 'submit', status: 'no-fulfillment', note: '这张单没有建办理单（附加费/周期账单），资料不挂单' }); continue; }
      if (known.get(item.submission_id)) { results.push({ submission_id: item.submission_id, kind: 'submit', status: 'duplicate' }); continue; }
      let content: Buffer, ext: string;
      if (item.type === 'text') { content = Buffer.from(item.text || '', 'utf8'); ext = '.txt'; }
      else {
        const pulled = await pullFile(item.submission_id);
        if (pulled === 'gone') { results.push({ submission_id: item.submission_id, kind: 'submit', status: 'gone', note: '客户站已找不到这份文件' }); continue; }
        content = pulled;
        const original = path.extname(item.name).toLowerCase();
        ext = EXTENSIONS.has(original) ? original : '';
      }
      const base = path.basename(item.name, path.extname(item.name)).replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 60) || 'document';
      const safeName = `${randomUUID()}_${base}${ext}`;
      await writeFile(path.join(dir, safeName), content, { flag: 'wx' });
      staged.push({ item, safeName, size: content.length, ext });
    }
  } catch (error) {
    await cleanup();
    console.error('[POST /api/sync/documents] 取回或保存资料失败:', error);
    return NextResponse.json({ error: '取回资料文件失败，稍后重试' }, { status: 502 });
  }
  let created: string[] = [];
  const duplicates: string[] = [];
  try {
    created = db.transaction(() => {
      const names: string[] = [];
      const insertDoc = db.prepare(`INSERT INTO documents (order_id, name, file_type, status, direction, uploaded_by, file_url, client_author_id, publication_verified)
        VALUES (?, ?, ?, '待审核', 'client_to_us', ?, ?, NULL, 0)`);
      const insertLink = db.prepare('INSERT INTO sync_documents (source_order_no, submission_id, internal_order_id, document_id) VALUES (?, ?, ?, ?)');
      const insertUpload = db.prepare("INSERT OR IGNORE INTO file_uploads (filename, uploaded_by_id, uploaded_by_role, mime_type, size) VALUES (?, 0, 'storefront-sync', ?, ?)");
      for (const s of staged) {
        if (known.get(s.item.submission_id)) { duplicates.push(s.safeName); results.push({ submission_id: s.item.submission_id, kind: 'submit', status: 'duplicate' }); continue; }
        insertUpload.run(s.safeName, s.item.type === 'text' ? 'text/plain' : 'application/octet-stream', s.size);
        for (const orderId of orderIds) {
          const doc = insertDoc.run(orderId, displayName(s.item), s.item.type === 'text' ? 'text' : s.ext.replace('.', ''), `客户站：${customerName || '客户'}`, `/api/files/${s.safeName}`);
          insertLink.run(sourceOrderNo, s.item.submission_id, orderId, Number(doc.lastInsertRowid));
        }
        names.push(displayName(s.item));
        markRequestSubmitted(db, s.item.requirement_id); // 客户按本站发的补件要求交的：标记「客户已交」
        results.push({ submission_id: s.item.submission_id, kind: 'submit', status: 'created' });
      }
      for (const item of items.filter(i => i.kind === 'withdraw')) {
        const marked = db.prepare(`UPDATE documents SET name = substr(name, 1, 240) || '（客户已删除）'
          WHERE id IN (SELECT document_id FROM sync_documents WHERE submission_id = ? AND withdrawn = 0)`).run(item.submission_id).changes;
        const linked = db.prepare('UPDATE sync_documents SET withdrawn = 1 WHERE submission_id = ?').run(item.submission_id).changes;
        results.push({ submission_id: item.submission_id, kind: 'withdraw', status: linked || marked ? 'withdrawn' : 'not-found' });
      }
      if (names.length) notifyCustomerDocuments(db, sourceOrderNo,
        `客户站订单 ${sourceOrderNo}（${customerName || '客户'}）提交了 ${names.length} 份资料：${names.slice(0, 5).join('、')}${names.length > 5 ? ' 等' : ''}。请到订单详情审核。`);
      return names;
    }).immediate();
  } catch (error) {
    await cleanup();
    console.error('[POST /api/sync/documents] 保存资料记录失败，已回滚:', error);
    return NextResponse.json({ error: '保存资料失败，稍后重试' }, { status: 500 });
  }
  await Promise.all(duplicates.map(name => unlink(path.join(dir, name)).catch(() => {})));
  logOperation('客户站同步', '接收资料', 'order', sourceOrderNo, JSON.stringify({ created: created.length, results }));
  return NextResponse.json({ received: true, source_order_no: sourceOrderNo, results });
}
