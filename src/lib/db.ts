import Database from "better-sqlite3";
import path from "path";

const DB_PATH = path.join(process.cwd(), "data.db");

let db: Database.Database;

export function getDb(): Database.Database {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    initTables(db);
    seedData(db);
  }
  return db;
}

/* ── 业务线步骤模板 ── */

interface StepTemplate {
  name: string;
  assignee: string;
}

const businessSteps: Record<number, StepTemplate[]> = {
  1: [
    { name: "收集客户资料", assignee: "Bam" },
    { name: "DBD名称审核", assignee: "Pop" },
    { name: "制作公司印章", assignee: "Pop" },
    { name: "VAT注册登记", assignee: "Fern" },
    { name: "银行开户", assignee: "Eve" },
    { name: "完成", assignee: "" },
  ],
  2: [
    { name: "确认商标名称", assignee: "Ing" },
    { name: "查重/分类确认", assignee: "Ing" },
    { name: "收费开票", assignee: "Ing" },
    { name: "整理文件（图样+委托书+营业执照）", assignee: "Ing" },
    { name: "提交申请", assignee: "Fern" },
    { name: "缴费", assignee: "Pop" },
    { name: "拿TM标发给客户", assignee: "Ing" },
  ],
  3: [
    { name: "收集资料", assignee: "Ing" },
    { name: "送检", assignee: "Pop" },
    { name: "提交申请", assignee: "Bam" },
    { name: "缴费", assignee: "Eve" },
    { name: "拿证", assignee: "" },
  ],
  4: [
    { name: "客户发产品图+规格书", assignee: "Fern" },
    { name: "Fern发送产品图+规格书给Khun Ja检查是否需要TISI", assignee: "Fern" },
    { name: "Khun Ja确认可做，准备全套文件(ISO/CB/工厂文件/公司证书/PP20/护照)发送Khun Ja", assignee: "Fern" },
    { name: "TISI网站注册登记", assignee: "Fern" },
    { name: "准备授权委托书", assignee: "Fern" },
    { name: "等TISI官员联系补充文件", assignee: "Fern" },
    { name: "审批通过，协调Next获取HS-code准备清关", assignee: "Fern" },
    { name: "NSW系统获取TISI进口单据", assignee: "Fern" },
    { name: "货物清关到达泰国，安排送至TISI", assignee: "Fern" },
    { name: "官员送样品至实验室检测", assignee: "" },
    { name: "等待检测结果，Khun Ja通知下一步", assignee: "" },
    { name: "收到TISI证书，总周期约3-4个月", assignee: "Fern" },
  ],
  5: [
    { name: "收集资料（产品名+标签+ISO+CFS+配方+工序+成分）", assignee: "Ing" },
    { name: "检查文件完整性", assignee: "Ing" },
    { name: "提交DLD官员审批", assignee: "Bam" },
    { name: "审批（需修改则退回，批准则下一步）", assignee: "" },
    { name: "现场检查场地（需货架+合规标识，官员上门）", assignee: "" },
  ],
  6: [
    { name: "收集资料（产品图+规格+公司证书+PP20+护照+地址+Invoice+PL）", assignee: "Fern" },
    { name: "发Next确认是否可进口（限制品需FDA许可）", assignee: "Fern" },
    { name: "确认客户是否需要中国退税", assignee: "Fern" },
    { name: "安排发货至泰国", assignee: "Fern" },
    { name: "泰国清关", assignee: "Next" },
    { name: "货物送达客户指定地址", assignee: "" },
  ],
  7: [
    { name: "收集资料（地契+租赁合同，名字须一致）", assignee: "Fern" },
    { name: "预约核查", assignee: "Fern" },
    { name: "实地核查", assignee: "Pop" },
    { name: "出具认证报告", assignee: "Bam" },
  ],
  8: [
    { name: "收集资料（公司证书+银行账户+PP20+Mall链接）", assignee: "Bam" },
    { name: "检查产品logo是否清晰（不可P图）", assignee: "Bam" },
    { name: "提交Shopee初步审核", assignee: "Fern" },
    { name: "等待Shopee邮件通知", assignee: "" },
    { name: "补充文件（测试+E-tax+合同）", assignee: "Bam" },
    { name: "等Shopee联系（约15工作日）", assignee: "" },
    { name: "确认套餐并缴费（约32,000泰铢）", assignee: "Pop" },
    { name: "周四前5pm完成付款", assignee: "Pop" },
    { name: "店铺上线", assignee: "" },
  ],
  9: [
    { name: "客户发产品图+规格书", assignee: "Fern" },
    { name: "Fern发送产品图+规格书给Khun Ja检查是否需要NBTC", assignee: "Fern" },
    { name: "Khun Ja确认可做，准备全套文件(ISO/CB/工厂文件/公司证书/PP20/护照)发送Khun Ja", assignee: "Fern" },
    { name: "NBTC网站注册登记", assignee: "Fern" },
    { name: "准备授权委托书", assignee: "Fern" },
    { name: "等NBTC官员联系补充文件", assignee: "Fern" },
    { name: "审批通过，协调Next获取HS-code准备清关", assignee: "Fern" },
    { name: "NSW系统获取NBTC进口单据", assignee: "Fern" },
    { name: "货物清关到达泰国，安排送至NBTC", assignee: "Fern" },
    { name: "官员送样品至实验室检测", assignee: "" },
    { name: "等待检测结果，Khun Ja通知下一步", assignee: "" },
    { name: "收到NBTC证书，总周期约3-4个月", assignee: "Fern" },
  ],
};

export function getBusinessSteps(businessTypeId: number, subServiceType?: string): StepTemplate[] {
  if (subServiceType === "international") return [
    { name: "客户沟通确认需求", assignee: "Ing" },
    { name: "查重（检查维普/各国商标库）", assignee: "Ing" },
    { name: "分类确认（与泰国TM标一致）", assignee: "Ing" },
    { name: "收费开票", assignee: "Ing" },
    { name: "文件整理（护照+商标图样+委托书）", assignee: "Ing" },
    { name: "提交安合注册", assignee: "Ing" },
    { name: "缴费(YJ)", assignee: "Pop" },
    { name: "收TM标发给客户", assignee: "Ing" },
  ];
  if (subServiceType === "buy-r") return [
    { name: "客户询盘需求沟通", assignee: "Ing" },
    { name: "匹配可用R标", assignee: "Ing" },
    { name: "确认类别（可加1个类别）", assignee: "Ing" },
    { name: "收费开票", assignee: "Ing" },
    { name: "准备转让文件", assignee: "Ing" },
    { name: "提交变更申请（与Fern一起去商标局）", assignee: "Ing" },
    { name: "缴费(Pop)", assignee: "Pop" },
    { name: "完成转让", assignee: "Ing" },
  ];
  // FDA sub-services
  if (subServiceType === "cosmetics") return [
    { name: "收集资料（ISO/工厂文件+配方+产品图+商标文件）", assignee: "Ing" },
    { name: "检查文件完整性", assignee: "Ing" },
    { name: "收费开票", assignee: "Ing" },
    { name: "提交FDA系统", assignee: "Ing" },
    { name: "缴费100泰铢", assignee: "Pop" },
    { name: "提交审批申请", assignee: "Ing" },
    { name: "等审批（5-7工作日）", assignee: "Ing" },
    { name: "下载收费单缴费拿证", assignee: "Pop" },
  ];
  if (subServiceType === "food") return [
    { name: "收集资料（工厂文件+配方+标签+工序+商标）", assignee: "Ing" },
    { name: "收费开票", assignee: "Ing" },
    { name: "提交FDA咨询（30天）", assignee: "Ing" },
    { name: "等审批结果", assignee: "Ing" },
    { name: "按审批意见提交产品", assignee: "Ing" },
    { name: "缴费", assignee: "Pop" },
    { name: "拿证（5-7天）", assignee: "Ing" },
  ];
  if (subServiceType === "hazard") return [
    { name: "收集资料（CFS+MSDS+配方+工序+中英文标签）", assignee: "Ing" },
    { name: "检查/补充文件", assignee: "Ing" },
    { name: "第一次提交FDA", assignee: "Ing" },
    { name: "按审批意见修改", assignee: "Ing" },
    { name: "第二次提交（最多2次，超次需重缴费）", assignee: "Ing" },
    { name: "缴费", assignee: "Pop" },
    { name: "拿证", assignee: "Ing" },
  ];
  // DLD sub-services
  if (subServiceType === "site") return [
    { name: "确认存储位置和进口位置分开（有货架+合规标识）", assignee: "" },
    { name: "准备场地平面图", assignee: "" },
    { name: "提交DLD场地检查申请", assignee: "" },
    { name: "等官员上门检查", assignee: "" },
  ];
  // Mall sub-services
  if (subServiceType === "tiktok") return [
    { name: "确认客户为法人（必须）", assignee: "Bam" },
    { name: "品牌注册确认（TM标不可委托，R标可委托）", assignee: "Bam" },
    { name: "准备Instagram账号（需1万粉丝+产品图）", assignee: "Pop" },
    { name: "提交TikTok审核", assignee: "" },
    { name: "审核通过，店铺上线", assignee: "" },
  ];
  if (subServiceType === "lazada") return [
    { name: "确认客户为法人（必须）", assignee: "Bam" },
    { name: "收集资料（公司证书+银行账户+PP20）", assignee: "Bam" },
    { name: "提交Lazada系统", assignee: "" },
    { name: "商品需有FDA/TISI认证（检查）", assignee: "" },
    { name: "店铺上线", assignee: "" },
  ];

  return businessSteps[businessTypeId] || [{ name: "待定", assignee: "" }];
}

export function getStepsWithAddressType(businessTypeId: number, subServiceType?: string, addressType?: string): StepTemplate[] {
  const base = getBusinessSteps(businessTypeId, subServiceType);
  if (businessTypeId === 7 && addressType === "xiangtai") {
    const result = [...base];
    result.splice(3, 0, { name: "签订租赁合同", assignee: "Pop" });
    result.splice(4, 0, { name: "收取首月租金", assignee: "Ing" });
    return result;
  }
  return base;
}

import { stepRequiredDocs, stepTimeEstimates, subServices, fdaCosmeticsDocs, fdaFoodDocs, tisiDocs, nbtcDocs, nbtcTimes, dldProductDocs, customsDocs, addressDocs, mallShopeeDocs } from "./constants";
export { stepRequiredDocs, stepTimeEstimates, subServices };

/* ── 建表 ── */

function initTables(database: Database.Database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS employees (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT DEFAULT '',
      role TEXT DEFAULT 'employee' CHECK(role IN ('admin','employee','client')),
      password TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS business_types (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      customer_name TEXT NOT NULL,
      business_type_id INTEGER NOT NULL REFERENCES business_types(id),
      sub_service_type TEXT DEFAULT '',
      address_type TEXT DEFAULT 'client',
      monthly_rent REAL DEFAULT 0,
      status TEXT NOT NULL DEFAULT '待处理',
      responsible_person TEXT DEFAULT '',
      description TEXT DEFAULT '',
      total_amount REAL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS order_steps (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id TEXT NOT NULL REFERENCES orders(id),
      step_name TEXT NOT NULL,
      step_order INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT '待处理',
      assignee TEXT DEFAULT '',
      notes TEXT DEFAULT '',
      approval_status TEXT DEFAULT '',
      submission_count INTEGER DEFAULT 0,
      deadline TEXT DEFAULT '',
      logistics_status TEXT DEFAULT '',
      step_data TEXT DEFAULT '{}',
      completed_at TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS documents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id TEXT NOT NULL REFERENCES orders(id),
      name TEXT NOT NULL,
      file_type TEXT DEFAULT '',
      status TEXT NOT NULL DEFAULT '待审核',
      direction TEXT DEFAULT 'client_to_us' CHECK(direction IN ('client_to_us', 'us_to_client')),
      file_url TEXT DEFAULT '',
      uploaded_by TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS finances (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id TEXT NOT NULL REFERENCES orders(id),
      type TEXT NOT NULL CHECK(type IN ('income','expense')),
      amount REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'pending',
      description TEXT DEFAULT '',
      payment_method TEXT DEFAULT '',
      slip_number TEXT DEFAULT '',
      slip_file TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS step_notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      step_id INTEGER NOT NULL REFERENCES order_steps(id),
      order_id TEXT NOT NULL REFERENCES orders(id),
      content TEXT NOT NULL,
      created_by TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS step_documents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      step_id INTEGER NOT NULL REFERENCES order_steps(id),
      order_id TEXT NOT NULL REFERENCES orders(id),
      document_name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('uploaded','pending')),
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS certificates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id TEXT NOT NULL REFERENCES orders(id),
      certificate_number TEXT DEFAULT '',
      product_name TEXT DEFAULT '',
      issue_date TEXT DEFAULT '',
      expiry_date TEXT DEFAULT '',
      status TEXT NOT NULL DEFAULT 'valid' CHECK(status IN ('valid','expiring','expired')),
      nsw_registration TEXT DEFAULT '',
      nsw_download_status TEXT DEFAULT '',
      notes TEXT DEFAULT '',
      file_url TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);

  // Migrations for existing databases
  try { database.exec("ALTER TABLE finances ADD COLUMN payment_method TEXT DEFAULT ''"); } catch {}
  try { database.exec("ALTER TABLE finances ADD COLUMN slip_number TEXT DEFAULT ''"); } catch {}
  try { database.exec("ALTER TABLE documents ADD COLUMN direction TEXT DEFAULT 'client_to_us' CHECK(direction IN ('client_to_us', 'us_to_client'))"); } catch {}
  try { database.exec("ALTER TABLE employees ADD COLUMN email TEXT DEFAULT ''"); } catch {}
  try { database.exec("ALTER TABLE employees ADD COLUMN role TEXT DEFAULT 'employee' CHECK(role IN ('admin','employee','client'))"); } catch {}
  try { database.exec("ALTER TABLE employees ADD COLUMN password TEXT DEFAULT ''"); } catch {}
  try { database.exec("ALTER TABLE finances ADD COLUMN slip_file TEXT DEFAULT ''"); } catch {}
  try { database.exec("ALTER TABLE documents ADD COLUMN file_url TEXT DEFAULT ''"); } catch {}
  try { database.exec("ALTER TABLE certificates ADD COLUMN file_url TEXT DEFAULT ''"); } catch {}
}

/* ── 种子数据 ── */

function seedData(database: Database.Database) {
  const empCount = database.prepare("SELECT COUNT(*) as c FROM employees").get() as { c: number };
  if (empCount.c === 0) {
    const insert = database.prepare("INSERT INTO employees (name, email, role, password) VALUES (?, ?, ?, ?)");
    for (const [name, email] of [["Bam","bam@xiangtai.com"], ["Fern","fern@xiangtai.com"], ["Ing","ing@xiangtai.com"], ["Pop","pop@xiangtai.com"], ["Eve","eve@xiangtai.com"]]) insert.run(name, email, "employee", "123456");
    insert.run("张三", "zhangsan@xiangtai.com", "admin", "123456");
    insert.run("李四", "lisi@client.com", "client", "123456");
  }

  const btCount = database.prepare("SELECT COUNT(*) as c FROM business_types").get() as { c: number };
  if (btCount.c === 0) {
    const insert = database.prepare("INSERT INTO business_types (name) VALUES (?)");
    for (const name of ["公司注册","商标","FDA认证","TISI","DLD","清关","地址认证","Mall开店","NBTC"]) insert.run(name);
  }

  const orderCount = database.prepare("SELECT COUNT(*) as c FROM orders").get() as { c: number };
  if (orderCount.c === 0) {
    const insertOrder = database.prepare(
      "INSERT INTO orders (id, customer_name, business_type_id, sub_service_type, status, responsible_person, description, total_amount) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    );
    const insertStep = database.prepare(
      "INSERT INTO order_steps (order_id, step_name, step_order, status, assignee) VALUES (?, ?, ?, ?, ?)"
    );

    const mockOrders = [
      { id: "ORD-001", customer: "华夏科技有限公司", bt: 1, status: "进行中", person: "Bam", desc: "有限责任公司注册，注册资本500万", amount: 35000, ss: "" },
      { id: "ORD-002", customer: "创新品牌管理有限公司", bt: 2, status: "进行中", person: "Fern", desc: "第35类、第42类商标申请", amount: 8500, ss: "" },
      { id: "ORD-003", customer: "康健医疗设备有限公司", bt: 3, status: "待处理", person: "Ing", desc: "化妆品FDA认证", amount: 125000, ss: "cosmetics" },
      { id: "ORD-004", customer: "东南亚贸易有限公司", bt: 4, status: "进行中", person: "Pop", desc: "电子产品TISI认证", amount: 28000, ss: "" },
      { id: "ORD-005", customer: "通达汽车配件有限公司", bt: 5, status: "待处理", person: "Eve", desc: "汽车零部件DLD认证", amount: 42000, ss: "" },
      { id: "ORD-006", customer: "环球进出口有限公司", bt: 6, status: "进行中", person: "Bam", desc: "电子产品进口清关", amount: 15000, ss: "" },
      { id: "ORD-007", customer: "新创企业管理有限公司", bt: 7, status: "已完成", person: "Fern", desc: "公司注册地址认证", amount: 5000, ss: "" },
      { id: "ORD-008", customer: "时尚品牌运营有限公司", bt: 8, status: "待处理", person: "Pop", desc: "Lazada/Shopee双平台开店", amount: 68000, ss: "" },
      { id: "ORD-009", customer: "生物医药科技有限公司", bt: 3, status: "进行中", person: "Ing", desc: "食品添加剂FDA认证", amount: 98000, ss: "food" },
      { id: "ORD-010", customer: "科技创业孵化器有限公司", bt: 2, status: "已完成", person: "Eve", desc: "第9类、第38类商标注册", amount: 12000, ss: "" },
    ];

    database.transaction(() => {
      for (const o of mockOrders) {
        insertOrder.run(o.id, o.customer, o.bt, o.ss || "", o.status, o.person, o.desc, o.amount);
        const steps = getBusinessSteps(o.bt, o.ss || "");
        steps.forEach((step, i) => {
          let s = "待处理";
          if (o.status === "已完成") s = "已完成";
          else if (o.status === "进行中" && i === 0) s = "已完成";
          else if (o.status === "待处理" && i === 0) s = "进行中";
          insertStep.run(o.id, step.name, i + 1, s, step.assignee);
        });
      }

      const insertDoc = database.prepare("INSERT INTO documents (order_id, name, file_type, status, uploaded_by) VALUES (?, ?, ?, ?, ?)");
      insertDoc.run("ORD-001", "营业执照副本.pdf", "资质文件", "已审核", "Bam");
      insertDoc.run("ORD-001", "DBD核名确认函.pdf", "审批文件", "已审核", "Pop");
      insertDoc.run("ORD-001", "VAT登记表.docx", "申请文件", "待审核", "Fern");

      const insertFin = database.prepare("INSERT INTO finances (order_id, type, amount, status, description) VALUES (?, ?, ?, ?, ?)");
      insertFin.run("ORD-001", "income", 35000, "paid", "公司注册服务费（首期）");
      insertFin.run("ORD-001", "expense", 5000, "paid", "DBD官方注册费");
      insertFin.run("ORD-001", "income", 15000, "pending", "公司注册尾款");

      // Seed step_notes for ORD-001
      const insertNote = database.prepare("INSERT INTO step_notes (step_id, order_id, content, created_by) VALUES (?, ?, ?, ?)");
      const steps_001 = database.prepare("SELECT id FROM order_steps WHERE order_id = 'ORD-001' ORDER BY step_order").all() as { id: number }[];
      if (steps_001.length > 0) {
        insertNote.run(steps_001[0].id, "ORD-001", "客户已发营业执照扫描件，股东护照今天下午补发", "Bam");
        insertNote.run(steps_001[1].id, "ORD-001", "DBD系统提交完成，等待审核结果", "Pop");
      }

      // Seed step_documents for ORD-001
      const insertStepDoc = database.prepare("INSERT INTO step_documents (step_id, order_id, document_name, status) VALUES (?, ?, ?, ?)");
        const docs_001 = database.prepare("SELECT id FROM order_steps WHERE order_id = 'ORD-001' ORDER BY step_order").all() as { id: number }[];
        const crDocs = stepRequiredDocs[1];
        if (docs_001.length >= 6 && crDocs) {
          for (const [stepIdx, docs] of Object.entries(crDocs)) {
            const si = Number(stepIdx) - 1;
            docs.forEach((doc) => insertStepDoc.run(docs_001[si].id, "ORD-001", doc, doc.includes("营业执照") || doc.includes("护照") ? "uploaded" : "pending"));
          }
        }

        // Seed step_documents for ORD-003 (FDA cosmetics)
        const docs_003 = database.prepare("SELECT id FROM order_steps WHERE order_id = 'ORD-003' ORDER BY step_order").all() as { id: number }[];
        const cosDocs = fdaCosmeticsDocs;
        if (docs_003.length >= 8) {
          for (const [stepIdx, docs] of Object.entries(cosDocs)) {
            const si = Number(stepIdx) - 1;
            docs.forEach((doc) => insertStepDoc.run(docs_003[si].id, "ORD-003", doc, doc.includes("委托书") ? "uploaded" : "pending"));
          }
        }

        // Seed step_documents for ORD-004 (TISI)
        const docs_004 = database.prepare("SELECT id FROM order_steps WHERE order_id = 'ORD-004' ORDER BY step_order").all() as { id: number }[];
        if (docs_004.length >= 12 && tisiDocs) {
          for (const [stepIdx, docs] of Object.entries(tisiDocs)) {
            const si = Number(stepIdx) - 1;
            docs.forEach((doc) => insertStepDoc.run(docs_004[si].id, "ORD-004", doc, "pending"));
          }
        }
        database.prepare("UPDATE order_steps SET deadline = datetime('now', '+45 days') WHERE order_id = 'ORD-004' AND step_order = 11").run();

        // Seed step_documents for ORD-005 (DLD)
        const docs_005 = database.prepare("SELECT id FROM order_steps WHERE order_id = 'ORD-005' ORDER BY step_order").all() as { id: number }[];
        if (docs_005.length >= 5 && dldProductDocs) {
          for (const [stepIdx, docs] of Object.entries(dldProductDocs)) {
            const si = Number(stepIdx) - 1;
            docs.forEach((doc) => insertStepDoc.run(docs_005[si].id, "ORD-005", doc, "pending"));
          }
        }

        // Seed step_documents for ORD-008 (Mall)
        const docs_008 = database.prepare("SELECT id FROM order_steps WHERE order_id = 'ORD-008' ORDER BY step_order").all() as { id: number }[];
        if (docs_008.length >= 9 && mallShopeeDocs) {
          for (const [stepIdx, docs] of Object.entries(mallShopeeDocs)) {
            const si = Number(stepIdx) - 1;
            docs.forEach((doc) => insertStepDoc.run(docs_008[si].id, "ORD-008", doc, "pending"));
          }
        }
        const docs_007 = database.prepare("SELECT id FROM order_steps WHERE order_id = 'ORD-007' ORDER BY step_order").all() as { id: number }[];
        if (docs_007.length >= 4 && addressDocs) {
          for (const [stepIdx, docs] of Object.entries(addressDocs)) {
            const si = Number(stepIdx) - 1;
            docs.forEach((doc) => insertStepDoc.run(docs_007[si].id, "ORD-007", doc, doc.includes("地契") ? "uploaded" : "pending"));
          }
        }
        const docs_006 = database.prepare("SELECT id FROM order_steps WHERE order_id = 'ORD-006' ORDER BY step_order").all() as { id: number }[];
        if (docs_006.length >= 6 && customsDocs) {
          for (const [stepIdx, docs] of Object.entries(customsDocs)) {
            const si = Number(stepIdx) - 1;
            docs.forEach((doc) => insertStepDoc.run(docs_006[si].id, "ORD-006", doc, "pending"));
          }
        }

        // Seed logistics for ORD-004 steps 7-10 (split from original single step 7)
        // Step 7: 协调Next获取HS-code (status: 进行中)
        database.prepare("UPDATE order_steps SET logistics_status = 'active', step_data = ? WHERE order_id = 'ORD-004' AND step_order = 7").run(JSON.stringify({
          contact_next: { name: "Next", role: "清关代理", contact: "next@logistics.com" },
          hs_code: "8517.62.00",
          step_detail: "已从Next获取HS-code，准备清关文件",
        }));
        // Step 8: NSW系统获取进口单据 (status: 待处理)
        database.prepare("UPDATE order_steps SET step_data = ? WHERE order_id = 'ORD-004' AND step_order = 8").run(JSON.stringify({
          nsw_system: "Thailand National Single Window",
          step_detail: "待从TISI NSW系统获取进口电子单据",
        }));
        // Step 9: 货物清关到达泰国 (status: 待处理)
        database.prepare("UPDATE order_steps SET logistics_status = 'transporting', step_data = ? WHERE order_id = 'ORD-004' AND step_order = 9").run(JSON.stringify({
          logistics: [
            { step: "准备清关文件(发票+箱单+委托书)", status: "pending" },
            { step: "样品从中国发货到泰国", status: "pending" },
            { step: "货物清关", status: "pending" },
            { step: "安排送至TISI", status: "pending" },
          ],
        }));
        // Step 10: 官员送检 (status: 待处理)
        database.prepare("UPDATE order_steps SET step_data = ? WHERE order_id = 'ORD-004' AND step_order = 10").run(JSON.stringify({
          step_detail: "等待官员联系安排实验室检测",
        }));
        // Step 2 external check (unchanged)
        database.prepare("UPDATE order_steps SET step_data = ? WHERE order_id = 'ORD-004' AND step_order = 2").run(JSON.stringify({
          external_check: { name: "คุณจ๋า", result: "确认需要TISI认证", date: "2026-07-01" },
        }));

        // Seed certificates for completed orders
        const insertCert = database.prepare("INSERT INTO certificates (order_id, certificate_number, product_name, issue_date, expiry_date, status, notes) VALUES (?, ?, ?, ?, ?, ?, ?)");
        insertCert.run("ORD-007", "CERT-2026-001", "新创企业地址认证", "2026-06-30", "2027-06-30", "valid", "地址认证通过");
        insertCert.run("ORD-010", "TM-2026-042", "第9/38类商标", "2026-06-25", "2026-09-25", "expiring", "TM标即将到期，需提醒客户续展");

        // Seed sample certificate for a FDA food order
        insertCert.run("ORD-009", "FDA-FOOD-2026-015", "食品添加剂认证", "2026-07-15", "2027-07-15", "valid", "FDA食品认证通过");

        // Set deadlines for FDA hazardous steps
        database.prepare("UPDATE order_steps SET deadline = datetime('now', '+2 days') WHERE order_id = 'ORD-003' AND step_order <= 2").run();
        database.prepare("UPDATE order_steps SET deadline = datetime('now', '+7 days') WHERE order_id = 'ORD-003' AND step_order = 7").run();
    })();
  }
}
