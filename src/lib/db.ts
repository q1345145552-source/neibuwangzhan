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
    { name: "确认名称", assignee: "Fern" },
    { name: "分类确认", assignee: "Fern" },
    { name: "收费", assignee: "Ing" },
    { name: "文件整理", assignee: "Bam" },
    { name: "提交申请", assignee: "Pop" },
    { name: "缴费", assignee: "Eve" },
    { name: "拿TM标", assignee: "" },
  ],
  3: [
    { name: "收集资料", assignee: "Ing" },
    { name: "送检", assignee: "Pop" },
    { name: "提交申请", assignee: "Bam" },
    { name: "缴费", assignee: "Eve" },
    { name: "拿证", assignee: "" },
  ],
  4: [
    { name: "准备样品", assignee: "Pop" },
    { name: "送检", assignee: "Ing" },
    { name: "提交申请", assignee: "Bam" },
    { name: "等待审核", assignee: "Eve" },
    { name: "拿证", assignee: "" },
  ],
  5: [
    { name: "准备检测清单", assignee: "Eve" },
    { name: "提交文件", assignee: "Bam" },
    { name: "等待审核", assignee: "Pop" },
    { name: "完成", assignee: "" },
  ],
  6: [
    { name: "报关", assignee: "Bam" },
    { name: "商检", assignee: "Pop" },
    { name: "缴税", assignee: "Fern" },
    { name: "放行", assignee: "" },
  ],
  7: [
    { name: "预约核查", assignee: "Fern" },
    { name: "实地核查", assignee: "Pop" },
    { name: "出具报告", assignee: "Bam" },
    { name: "完成", assignee: "" },
  ],
  8: [
    { name: "平台注册", assignee: "Pop" },
    { name: "品牌备案", assignee: "Fern" },
    { name: "店铺装修", assignee: "Ing" },
    { name: "产品上架", assignee: "Eve" },
    { name: "运营指导", assignee: "Bam" },
  ],
};

export function getBusinessSteps(businessTypeId: number): StepTemplate[] {
  return businessSteps[businessTypeId] || [{ name: "待定", assignee: "" }];
}

import { stepRequiredDocs, stepTimeEstimates, subServices } from "./constants";
export { stepRequiredDocs, stepTimeEstimates, subServices };

/* ── 建表 ── */

function initTables(database: Database.Database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS employees (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
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
      completed_at TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS documents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id TEXT NOT NULL REFERENCES orders(id),
      name TEXT NOT NULL,
      file_type TEXT DEFAULT '',
      status TEXT NOT NULL DEFAULT '待审核',
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
  `);
}

/* ── 种子数据 ── */

function seedData(database: Database.Database) {
  const empCount = database.prepare("SELECT COUNT(*) as c FROM employees").get() as { c: number };
  if (empCount.c === 0) {
    const insert = database.prepare("INSERT INTO employees (name) VALUES (?)");
    for (const name of ["Bam", "Fern", "Ing", "Pop", "Eve"]) insert.run(name);
  }

  const btCount = database.prepare("SELECT COUNT(*) as c FROM business_types").get() as { c: number };
  if (btCount.c === 0) {
    const insert = database.prepare("INSERT INTO business_types (name) VALUES (?)");
    for (const name of ["公司注册","商标","FDA认证","TISI","DLD","清关","地址认证","Mall开店"]) insert.run(name);
  }

  const orderCount = database.prepare("SELECT COUNT(*) as c FROM orders").get() as { c: number };
  if (orderCount.c === 0) {
    const insertOrder = database.prepare(
      "INSERT INTO orders (id, customer_name, business_type_id, status, responsible_person, description, total_amount) VALUES (?, ?, ?, ?, ?, ?, ?)"
    );
    const insertStep = database.prepare(
      "INSERT INTO order_steps (order_id, step_name, step_order, status, assignee) VALUES (?, ?, ?, ?, ?)"
    );

    const mockOrders = [
      { id: "ORD-001", customer: "华夏科技有限公司", bt: 1, status: "进行中", person: "Bam", desc: "有限责任公司注册，注册资本500万", amount: 35000 },
      { id: "ORD-002", customer: "创新品牌管理有限公司", bt: 2, status: "进行中", person: "Fern", desc: "第35类、第42类商标申请", amount: 8500 },
      { id: "ORD-003", customer: "康健医疗设备有限公司", bt: 3, status: "待处理", person: "Ing", desc: "II类医疗器械510(k)认证", amount: 125000 },
      { id: "ORD-004", customer: "东南亚贸易有限公司", bt: 4, status: "进行中", person: "Pop", desc: "电子产品TISI认证", amount: 28000 },
      { id: "ORD-005", customer: "通达汽车配件有限公司", bt: 5, status: "待处理", person: "Eve", desc: "汽车零部件DLD认证", amount: 42000 },
      { id: "ORD-006", customer: "环球进出口有限公司", bt: 6, status: "进行中", person: "Bam", desc: "电子产品进口清关", amount: 15000 },
      { id: "ORD-007", customer: "新创企业管理有限公司", bt: 7, status: "已完成", person: "Fern", desc: "公司注册地址认证", amount: 5000 },
      { id: "ORD-008", customer: "时尚品牌运营有限公司", bt: 8, status: "待处理", person: "Pop", desc: "Lazada/Shopee双平台开店", amount: 68000 },
      { id: "ORD-009", customer: "生物医药科技有限公司", bt: 3, status: "进行中", person: "Ing", desc: "I类医疗器械FDA列名", amount: 98000 },
      { id: "ORD-010", customer: "科技创业孵化器有限公司", bt: 2, status: "已完成", person: "Eve", desc: "第9类、第38类商标注册", amount: 12000 },
    ];

    database.transaction(() => {
      for (const o of mockOrders) {
        insertOrder.run(o.id, o.customer, o.bt, o.status, o.person, o.desc, o.amount);
        const steps = businessSteps[o.bt] || [{ name: "待定", assignee: "" }];
        steps.forEach((step, i) => {
          let s = "待处理";
          if (o.status === "已完成") s = "已完成";
          else if (o.status === "进行中" && i === 0) s = "已完成";
          else if (o.status === "進行中" && i === 1) s = "进行中";
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
      if (docs_001.length >= 6) {
        stepRequiredDocs[1]?.forEach((doc) => insertStepDoc.run(docs_001[0].id, "ORD-001", doc, doc.includes("营业执照") || doc.includes("护照") ? "uploaded" : "pending"));
        stepRequiredDocs[2]?.forEach((doc) => insertStepDoc.run(docs_001[1].id, "ORD-001", doc, doc.includes("预审表") ? "uploaded" : "pending"));
        stepRequiredDocs[3]?.forEach((doc) => insertStepDoc.run(docs_001[2].id, "ORD-001", doc, "pending"));
        stepRequiredDocs[4]?.forEach((doc) => insertStepDoc.run(docs_001[3].id, "ORD-001", doc, "pending"));
        stepRequiredDocs[5]?.forEach((doc) => insertStepDoc.run(docs_001[4].id, "ORD-001", doc, "pending"));
        stepRequiredDocs[6]?.forEach((doc) => insertStepDoc.run(docs_001[5].id, "ORD-001", doc, "pending"));
      }
    })();
  }
}
