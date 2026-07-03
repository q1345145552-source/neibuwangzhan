import Database from "better-sqlite3";
import path from "path";
import bcrypt from "bcryptjs";
import { companyRegistrationSteps, tisiSteps, type StepTemplate } from "./business-steps";

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

const businessSteps: Record<number, StepTemplate[]> = {
  1: companyRegistrationSteps,
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
  4: tisiSteps,
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

export function getBusinessSteps(businessTypeId: number, subServiceType?: string): StepTemplate[] {  if (subServiceType === "international") return [
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
    { name: "Ing协调客户准备资料+检查文件完整性+开票收款", assignee: "Ing" },
    { name: "客户付款后，Ing在FDA系统提交注册", assignee: "Ing" },
    { name: "下载申请费单据，上传飞书给Pop支付100泰铢", assignee: "Ing" },
    { name: "Pop支付完成，Ing提交审批申请，等待官员审核", assignee: "Ing" },
    { name: "审核不通过则协调客户修改文件并重新提交（1次修改机会）", assignee: "Ing" },
    { name: "审核通过后下载缴费单，上传飞书给Pop支付认证费", assignee: "Ing" },
    { name: "等待下发证书", assignee: "Ing" },
    { name: "收到证书后发送给客户", assignee: "Ing" },
  ];
  if (subServiceType === "food") return [
    { name: "Ing协调客户准备资料（工厂文件+配方+标签+工序+商标），检查文件，开票收款", assignee: "Ing" },
    { name: "客户付款后，提交FDA咨询（官员审查约30个工作日）", assignee: "Ing" },
    { name: "官员审查完成后按指示提交产品注册", assignee: "Ing" },
    { name: "等待官员审核，下载FDA缴费单，上传飞书给Pop支付", assignee: "Ing" },
    { name: "文件有误则官员说明问题，Ing协调客户修改并重新提交", assignee: "Ing" },
    { name: "修改提交后等待审核，文件完整则收到证书", assignee: "Ing" },
    { name: "收到证书后发送给客户", assignee: "Ing" },
  ];
  if (subServiceType === "hazard") return [
    { name: "Ing检查Praew之前提交被退回的文件，联系客户补齐需修改的资料", assignee: "Ing" },
    { name: "客户准备修改文件期间，Ing协助客户修改泰语标签", assignee: "Ing" },
    { name: "客户文件齐备后提交给官员审核（第1次）", assignee: "Ing" },
    { name: "官员审核不通过，Ing协调客户再次修改", assignee: "Ing" },
    { name: "提交第2次审核（最多2次，超过需重新全额缴费）", assignee: "Ing" },
    { name: "审核通过后下载缴费单，上传飞书给Pop支付", assignee: "Ing" },
    { name: "收到证书后发送给客户", assignee: "Ing" },
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

import { stepRequiredDocs, stepTimeEstimates, subServices } from "./constants";
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
      currency TEXT DEFAULT 'CNY' CHECK(currency IN ('CNY','THB')),
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

  database.exec(`
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT DEFAULT '',
      assignee TEXT DEFAULT '',
      priority TEXT DEFAULT 'medium' CHECK(priority IN ('low','medium','high')),
      status TEXT DEFAULT 'pending' CHECK(status IN ('pending','in_progress','completed')),
      business_line TEXT DEFAULT '',
      deadline TEXT DEFAULT '',
      order_id TEXT REFERENCES orders(id),
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
    for (const [name, email] of [["Bam","bam@xiangtai.com"], ["Fern","fern@xiangtai.com"], ["Ing","ing@xiangtai.com"], ["Pop","pop@xiangtai.com"], ["Eve","eve@xiangtai.com"]]) insert.run(name, email, "employee", bcrypt.hashSync("123456", 10));
    insert.run("张三", "zhangsan@xiangtai.com", "admin", bcrypt.hashSync("123456", 10));
    insert.run("李四", "lisi@client.com", "client", bcrypt.hashSync("123456", 10));
  }

  const btCount = database.prepare("SELECT COUNT(*) as c FROM business_types").get() as { c: number };
  if (btCount.c === 0) {
    const insert = database.prepare("INSERT INTO business_types (name) VALUES (?)");
    for (const name of ["公司注册","商标","FDA认证","TISI","DLD","清关","地址认证","Mall开店","NBTC"]) insert.run(name);
  }

}

