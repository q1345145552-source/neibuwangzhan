import { productTerms, readLineTerms, LEGACY_TERMS_VERSION } from "./commerce-terms";
import type { CommerceCart } from "./commerce-types";
import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import type { TokenPayload } from "./auth";
import { commerceWorkflow, CommerceTemplateError } from "./commerce-fulfillment";
import { COMMERCE_MAX_LINES } from "./commerce-catalog";
import { notifyUnclassifiedOrder } from "./order-alerts";
import type { CommerceProduct, CommerceQuote, CommerceSale, CommerceSelection } from "./commerce-types";

import { readBilling, readCancellations, expectRevision, advanceRevision } from "./commerce-ledger";
import { CommerceError, recordBody, fail, only, boundedText, audit } from "./commerce-validation";
export { CommerceError, recordBody };
function withTerms(product: CommerceProduct): CommerceProduct {
  const terms = productTerms(product.sku);
  if (!terms) return fail(409,"TERMS_REVIEW_REQUIRED","商品权益尚未核对");
  return { ...product, terms };
}
export function listProducts(db: Database.Database, actor: TokenPayload): CommerceProduct[] {
  return (db.prepare(`SELECT id,sku,name,price_cents,currency,revision,active FROM commerce_products
    ${actor.role === "admin" ? "" : "WHERE active=1"} ORDER BY sku`).all() as CommerceProduct[]).map(withTerms);
}
export function saveProduct(db: Database.Database, actor: TokenPayload, input: unknown): CommerceProduct {
  if (actor.role !== "admin") return fail(403, "ADMIN_REQUIRED", "商品售价由管理员维护");
  const body = recordBody(input);
  only(body, ["id", "sku", "name", "price_cents", "active", "revision"]);
  const sku = boundedText(body.sku, 30, "商品编号");
  if (!productTerms(sku)) return fail(400, "PILOT_PRODUCT_ONLY", "仅可维护已接入下单目录（83 项快照清单）内的商品");
  const name = boundedText(body.name, 120, "商品名称");
  if (typeof body.price_cents !== "number" || !Number.isSafeInteger(body.price_cents) || body.price_cents < 1 || body.price_cents > 100_000_000) return fail(400, "INVALID_PRICE", "售价请按整数分填写，范围 1 分至 100 万元");
  if (typeof body.active !== "boolean") return fail(400, "INVALID_INPUT", "请明确商品上架状态");
  const id = body.id === undefined ? randomUUID() : boundedText(body.id, 64, "商品 ID");
  return db.transaction(() => {
    const previous = db.prepare("SELECT * FROM commerce_products WHERE id=?").get(id) as CommerceProduct | undefined;
    if (body.id !== undefined && !previous) return fail(404, "NOT_FOUND", "商品不存在");
    if (previous && (body.revision !== previous.revision || sku !== previous.sku)) return fail(409, "PRODUCT_CONFLICT", "商品已更新，或尝试改变固定商品编号，请重新加载");
    const duplicate = db.prepare("SELECT 1 FROM commerce_products WHERE sku=? AND id<>?").get(sku,id);
    if (duplicate) return fail(409, "DUPLICATE_SKU", "该商品编号已存在");
    if (previous) db.prepare("UPDATE commerce_products SET name=?,price_cents=?,active=?,revision=revision+1,updated_at=datetime('now') WHERE id=?")
      .run(name,body.price_cents,body.active ? 1 : 0,id);
    else db.prepare("INSERT INTO commerce_products(id,sku,name,price_cents,active) VALUES (?,?,?,?,?)")
      .run(id,sku,name,body.price_cents,body.active ? 1 : 0);
    audit(db,actor,"维护商城商品",id,JSON.stringify({ previous: previous || null, name, price_cents: body.price_cents, active: body.active }));
    return withTerms(db.prepare("SELECT id,sku,name,price_cents,currency,revision,active FROM commerce_products WHERE id=?").get(id) as CommerceProduct);
  }).immediate();
}

function selections(value: unknown, allowEmpty = false): CommerceSelection[] {
  if (!Array.isArray(value) || value.length < (allowEmpty ? 0 : 1) || value.length > COMMERCE_MAX_LINES) return fail(400, "INVALID_CART", "请选择 1 至 " + COMMERCE_MAX_LINES + " 种服务");
  const result = value.map(item => {
    const line = recordBody(item); only(line, ["product_id", "quantity", "revision", "terms_version", "offer_cents"]);
    const product_id = boundedText(line.product_id,64,"商品 ID");
    const { quantity, revision } = line;
    if (typeof quantity !== "number" || !Number.isInteger(quantity) || quantity < 1 || quantity > 10) return fail(400,"INVALID_QUANTITY","每种服务限 1 至 10 份");
    if (typeof revision !== "number" || !Number.isSafeInteger(revision) || revision < 1) return fail(400,"INVALID_REVISION","请重新获取报价");
    const terms_version = line.terms_version === undefined ? undefined : boundedText(line.terms_version,80,"权益版本");
    // offer_cents 仅面议商品有效（范围在 quoteLines 按 terms 判定）；此处仅透传保持原始请求参与幂等指纹
    const offer_cents = line.offer_cents;
    if (offer_cents !== undefined && (typeof offer_cents !== "number" || !Number.isSafeInteger(offer_cents)))
      return fail(400,"INVALID_OFFER","报价请填写整数金额（单位：分）");
    return { product_id, quantity, revision, ...(terms_version === undefined ? {} : { terms_version }), ...(offer_cents === undefined ? {} : { offer_cents }) };
  });
  if (new Set(result.map(line => line.product_id)).size !== result.length) return fail(400,"DUPLICATE_LINE","同种服务请合并数量");
  return result.sort((a,b) => a.product_id.localeCompare(b.product_id));
}
function quoteLines(db: Database.Database, lines: CommerceSelection[]): CommerceQuote {
  let total = 0;
  const current = lines.map(line => {
    const product = db.prepare("SELECT * FROM commerce_products WHERE id=?").get(line.product_id) as CommerceProduct | undefined;
    if (!product || !product.active || product.revision !== line.revision) return fail(409,"QUOTE_CHANGED","商品报价或上架状态已变化，请重新加载并确认后下单");
    if (product.currency !== "CNY") return fail(409,"INVALID_CURRENCY","商品币种待管理员核对");
    const terms = withTerms(product).terms;
    // 附加费用不构成独立服务：报价/下单入口拦截单独购买（随主服务一并收取）
    if (terms.quantity_basis === "attachment") return fail(409, "ATTACHMENT_ONLY", "该项为附加费用，随对应主服务一并收取，不能单独购买");
    // 面议商品（如 TISI）：成交价=客户报价快照，必须提供且在合理范围；
    // 非面议商品绝不接受 offer_cents——堵死"自填低价绕过服务端定价"的口子
    const negotiable = "negotiable" in terms && terms.negotiable === true;
    if (negotiable) {
      if (line.offer_cents === undefined || line.offer_cents <= 0 || line.offer_cents > 1_000_000_000)
        return fail(400, "OFFER_REQUIRED", "该项为面议服务，请填写与服务商协商后的报价（1 分至 1000 万元）");
    } else if (line.offer_cents !== undefined) {
      return fail(400, "OFFER_NOT_ALLOWED", "该商品为固定售价，不接受自定义报价");
    }
    const unit_cents = negotiable ? line.offer_cents as number : product.price_cents;
    if ((line.terms_version ?? LEGACY_TERMS_VERSION) !== terms.version) return fail(409,"QUOTE_CHANGED","服务权益版本已变化，请重新核对报价和服务内容");
    const amount = unit_cents * line.quantity;
    total += amount;
    return { ...line, sku: product.sku, name: product.name, unit_cents, total_cents: amount, terms };
  });
  if (!Number.isSafeInteger(total) || total <= 0 || total > 1_000_000_000) return fail(400,"AMOUNT_LIMIT","订单金额超出首批测试范围");
  return { lines: current, total_cents: total, currency: "CNY" };
}
export function quote(db: Database.Database, input: unknown): CommerceQuote {
  const body = recordBody(input); only(body,["lines"]);
  return quoteLines(db,selections(body.lines));
}

function cartRevision(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value >= 1_000_000_000) return fail(400,"INVALID_CART_REVISION","请重新加载购物车版本");
  return value;
}
function requireCustomer(actor: TokenPayload) {
  if (actor.role !== "client") return fail(403,"CUSTOMER_REQUIRED","请使用客户账号管理购物车");
}
export function readCart(db: Database.Database, actor: TokenPayload): CommerceCart {
  requireCustomer(actor);
  const row = db.prepare("SELECT revision,lines_json FROM commerce_carts WHERE buyer_account_id=?").get(actor.id) as { revision: number; lines_json: string } | undefined;
  return row ? { revision: row.revision, lines: JSON.parse(row.lines_json) as CommerceSelection[] } : { revision: 0, lines: [] };
}
export function saveCart(db: Database.Database, actor: TokenPayload, input: unknown): CommerceCart {
  requireCustomer(actor);
  const body = recordBody(input); only(body,["revision","lines"]);
  const revision = cartRevision(body.revision), lines = selections(body.lines,true);
  return db.transaction(() => {
    const current = readCart(db,actor);
    if (current.revision !== revision) return fail(409,"CART_CHANGED","购物车已在另一页面更新，请重新加载后选择");
    // Stale/delisted selections may remain until explicit quote or removal; never reprice on save.
    for (const line of lines) if (!db.prepare("SELECT 1 FROM commerce_products WHERE id=?").get(line.product_id)) return fail(400,"INVALID_PRODUCT","购物车包含未知商品");
    db.prepare(`INSERT INTO commerce_carts(buyer_account_id,revision,lines_json) VALUES (?,?,?)
      ON CONFLICT(buyer_account_id) DO UPDATE SET revision=excluded.revision,lines_json=excluded.lines_json,updated_at=datetime('now')`)
      .run(actor.id,revision+1,JSON.stringify(lines));
    return { revision: revision+1, lines };
  }).immediate();
}

export function checkout(db: Database.Database, actor: TokenPayload, input: unknown): { sale: CommerceSale; duplicate: boolean } {
  if (actor.role !== "client") return fail(403,"CUSTOMER_REQUIRED","请使用客户账号下单");
  const body = recordBody(input); only(body,["request_id","lines","cart_revision"]);
  const requestId = boundedText(body.request_id,80,"下单请求编号");
  if (!/^[A-Za-z0-9_-]{16,80}$/.test(requestId)) return fail(400,"INVALID_REQUEST_ID","下单请求编号格式有误");
  const lines = selections(body.lines);
  const revision = body.cart_revision === undefined ? undefined : cartRevision(body.cart_revision);
  // Legacy request identity stays byte-for-byte compatible with first-slice replay.
  const identity = revision === undefined ? JSON.stringify(lines) : JSON.stringify({ cart_revision: revision, lines });
  return db.transaction(() => {
    const old = db.prepare("SELECT id,request_json FROM commerce_sales WHERE buyer_account_id=? AND request_id=?")
      .get(actor.id,requestId) as { id: string; request_json: string } | undefined;
    if (old) {
      if (old.request_json !== identity) return fail(409,"REQUEST_CONFLICT","同一次下单请求的内容已改变，请先检查已有订单");
      return { sale: readSale(db,actor,old.id), duplicate: true };
    }
    if (revision !== undefined) {
      const cart = readCart(db,actor);
      if (cart.revision !== revision || JSON.stringify(cart.lines) !== JSON.stringify(lines)) return fail(409,"CART_CHANGED","购物车已变化或已结算，请重新加载后核对已有订单");
    }
    const current = quoteLines(db,lines);
    // Validate every selected family's original template BEFORE any sale is inserted.
    let workflows: ReturnType<typeof commerceWorkflow>[];
    try { workflows = current.lines.map(line => commerceWorkflow(db,line.terms)); }
    catch (error) {
      if (error instanceof CommerceTemplateError) return fail(409,"TEMPLATE_REVIEW_REQUIRED",error.message);
      throw error;
    }
    const saleId = "SALE-" + randomUUID();
    db.prepare("INSERT INTO commerce_sales(id,buyer_account_id,buyer_name,request_id,request_json,total_cents) VALUES (?,?,?,?,?,?)")
      .run(saleId,actor.id,actor.name,requestId,identity,current.total_cents);
    for (const [index,line] of current.lines.entries()) {
      const lineId = randomUUID();
      const workflow = workflows[index];
      db.prepare(`INSERT INTO commerce_lines(id,sale_id,line_no,product_id,sku,name,product_revision,unit_cents,quantity,total_cents,template_key)
        VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
        .run(lineId,saleId,index+1,line.product_id,line.sku,line.name,line.revision,line.unit_cents,line.quantity,line.total_cents,workflow.key);
      db.prepare("INSERT INTO commerce_line_terms(line_id,terms_json) VALUES (?,?)").run(lineId,JSON.stringify(line.terms));
      for (let copy = 1; copy <= line.quantity; copy++) {
        const orderId = "ORD-" + randomUUID();
        db.prepare(`INSERT INTO orders(id,customer_name,business_type_id,sub_service_type,address_type,total_amount,currency,source_system,source_customer_id,description)
          VALUES (?,?,?,?,?,?,'CNY','commerce',?,?)`)
          .run(orderId,actor.name,workflow.businessId,workflow.subService,workflow.addressType,line.unit_cents/100,String(actor.id),"商城购买单 " + saleId + " / " + line.sku + " / 第 " + copy + " 份");
        db.prepare("INSERT INTO commerce_fulfillments(line_id,copy_no,order_id,allocated_cents) VALUES (?,?,?,?)")
          .run(lineId,copy,orderId,line.unit_cents);
        for (const [stepIndex,step] of workflow.steps.entries()) {
          const result = db.prepare("INSERT INTO order_steps(order_id,step_name,step_order,assignee,notes) VALUES (?,?,?,?,?)")
            .run(orderId,step.name,stepIndex+1,step.assignee,step.notes || "");
          db.prepare("INSERT INTO commerce_public_steps(step_id,public_name) VALUES (?,?)").run(result.lastInsertRowid,workflow.publicNames[stepIndex]);
          for (const name of step.docs) db.prepare("INSERT INTO step_documents(step_id,order_id,document_name) VALUES (?,?,?)").run(result.lastInsertRowid,orderId,name);
        }
      }
    }
    db.prepare("INSERT INTO commerce_invoices(id,sale_id,total_cents) VALUES (?,?,?)").run("INV-" + randomUUID(),saleId,current.total_cents);
    // 待分类提醒（规则 6）：本单含未归类办理项时广播给全员，谁看到谁领取（填负责人=认领，改业务线=归类）
    const unclassifiedSkus = current.lines.filter((line, i) => workflows[i].key === "unclassified-v1").map(line => line.sku);
    if (unclassifiedSkus.length)
      notifyUnclassifiedOrder(db, saleId, `商城单 ${saleId}（客户 ${actor.name}）含待确认归属的服务：${unclassifiedSkus.join("、")}。请在订单列表「待分类」业务线中认领并归类。`);
    if (revision !== undefined) {
      const consumed = db.prepare("UPDATE commerce_carts SET revision=revision+1,lines_json='[]',updated_at=datetime('now') WHERE buyer_account_id=? AND revision=?").run(actor.id,revision);
      if (consumed.changes !== 1) return fail(409,"CART_CHANGED","购物车已变化，请重新加载");
    }
    audit(db,actor,"商城下单",saleId,"主单、账单与办理单同事务；账单尚未收款");
    return { sale: readSale(db,actor,saleId), duplicate: false };
  }).immediate();
}

export function readSale(db: Database.Database, actor: TokenPayload, saleId: string): CommerceSale {
  return db.transaction(()=>readSaleSnapshot(db,actor,saleId))();
}
function readSaleSnapshot(db: Database.Database, actor: TokenPayload, saleId: string): CommerceSale {
  const sale = db.prepare(`SELECT id,buyer_account_id,buyer_name,total_cents,currency,created_at FROM commerce_sales
    WHERE id=? ${actor.role === "client" ? "AND buyer_account_id=?" : ""}`)
    .get(...(actor.role === "client" ? [saleId,actor.id] : [saleId])) as Omit<CommerceSale,"invoice"|"lines"> | undefined;
  if (!sale) return fail(404,"NOT_FOUND","订单不存在");
  const invoice = db.prepare("SELECT id,total_cents,currency,status,paid_at FROM commerce_invoices WHERE sale_id=?").get(saleId) as CommerceSale["invoice"];
  const lines = db.prepare("SELECT id,sku,name,unit_cents,quantity,total_cents FROM commerce_lines WHERE sale_id=? ORDER BY line_no")
    .all(saleId) as Omit<CommerceSale["lines"][number],"fulfillments">[];
  return { ...sale, invoice, billing:readBilling(db,saleId), cancellations:readCancellations(db,saleId), lines: lines.map(line => ({
    ...line, terms: readLineTerms(db,line.id),
    fulfillments: (db.prepare(`SELECT f.order_id,f.copy_no,f.allocated_cents,o.status
      FROM commerce_fulfillments f JOIN orders o ON o.id=f.order_id WHERE f.line_id=? ORDER BY f.copy_no`)
      .all(line.id) as Omit<CommerceSale["lines"][number]["fulfillments"][number],"steps"|"documents">[]).map(item => ({
        ...item,
        steps: db.prepare(`SELECT s.id,s.step_order,p.public_name AS name,s.status FROM order_steps s
          JOIN commerce_public_steps p ON p.step_id=s.id WHERE s.order_id=? ORDER BY s.step_order`).all(item.order_id) as CommerceSale["lines"][number]["fulfillments"][number]["steps"],
        documents: db.prepare(`SELECT id,name,status,direction,file_url FROM documents WHERE order_id=?
          AND (client_author_id=? OR (direction='us_to_client' AND status='已审核' AND publication_verified=1)) ORDER BY id`)
          .all(item.order_id,sale.buyer_account_id) as CommerceSale["lines"][number]["fulfillments"][number]["documents"],
      })),
  })) };
}
export function listSales(db: Database.Database, actor: TokenPayload): CommerceSale[] {
  const ids = db.prepare(`SELECT id FROM commerce_sales ${actor.role === "client" ? "WHERE buyer_account_id=?" : ""} ORDER BY created_at DESC,id DESC LIMIT 100`)
    .all(...(actor.role === "client" ? [actor.id] : [])) as { id: string }[];
  return ids.map(row => readSale(db,actor,row.id));
}
export function confirmPayment(db: Database.Database, actor: TokenPayload, saleId: string, input: unknown): CommerceSale {
  if (actor.role !== "admin") return fail(403,"ADMIN_REQUIRED","收款由管理员核实");
  const body = recordBody(input); only(body,["payment_reference","revision"]);
  const reference = boundedText(body.payment_reference,120,"收款凭证编号");
  return db.transaction(() => {
    const sale = readSale(db,actor,saleId);
    const existing = db.prepare("SELECT status,payment_reference FROM commerce_invoices WHERE sale_id=?").get(saleId) as { status: string; payment_reference: string };
    if (existing.status === "paid") {
      if (existing.payment_reference !== reference) return fail(409,"PAYMENT_CONFLICT","此账单已收款，请核对原记录");
      return sale;
    }
    expectRevision(db,saleId,body.revision,true);
    if(sale.billing.balance_due_cents===0) return fail(409,"NO_BALANCE","当前账单没有待收金额，请核对减免记录");
    for (const f of sale.billing.allocations) {
      if(f.adjusted_cents===0) continue;
      const result = db.prepare(`INSERT INTO finances(order_id,type,amount,status,currency,description,slip_number)
        VALUES (?,'income',?,'paid','CNY',?,?)`).run(f.order_id,f.adjusted_cents/100,"商城账单 " + sale.invoice.id,reference);
      db.prepare("INSERT INTO commerce_receipt_finances(invoice_id,order_id,finance_id) VALUES (?,?,?)")
        .run(sale.invoice.id,f.order_id,result.lastInsertRowid);
    }
    db.prepare("UPDATE commerce_invoices SET status='paid',payment_reference=?,paid_by=?,paid_at=datetime('now') WHERE sale_id=?")
      .run(reference,actor.id,saleId);
    advanceRevision(db,saleId);
    audit(db,actor,"确认商城收款",saleId,reference);
    return readSale(db,actor,saleId);
  }).immediate();
}
