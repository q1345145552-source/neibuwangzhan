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

export function logOperation(actor: string, action: string, targetType: string, targetId: string, detail?: string) {
  try {
    const d = getDb();
    d.prepare("INSERT INTO audit_logs (actor, action, target_type, target_id, detail) VALUES (?, ?, ?, ?, ?)").run(actor, action, targetType, targetId, detail || "");
  } catch {}
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
    { name: "收集资料", assignee: "Fern" },
    { name: "准备FDA系统开通申请资料", assignee: "Fern" },
    { name: "提交FDA系统开通申请", assignee: "Fern" },
    { name: "等待客户签署授权书和同意书", assignee: "Fern" },
    { name: "FDA系统开通申请通过", assignee: "" },
    { name: "准备场地确认资料（平面图+建筑图+地图等）", assignee: "Fern" },
    { name: "到客户仓库拍照", assignee: "Pop" },
    { name: "整理并收集所有资料", assignee: "Fern" },
    { name: "提交场地确认申请", assignee: "Fern" },
    { name: "等待官方审核", assignee: "" },
    { name: "如需修改资料或补充资料，协调客户处理", assignee: "Fern" },
    { name: "提交修改或补充资料", assignee: "Fern" },
    { name: "官方再次审核", assignee: "" },
    { name: "支付申请费用", assignee: "Pop" },
    { name: "官方到仓库现场检查", assignee: "Pop" },
    { name: "场地确认通过", assignee: "Bam" },
  ],
  8: [
    { name: "Bam收集资料（公司证书不超过6个月+法人护照+商标文件+PP20+银行账号+TK Mall链接+LazMall链接，所有文件法人蓝笔签名+盖章）", assignee: "Bam" },
    { name: "检查产品（每个商品有清晰品牌标识，商品类别与商标注册类别一致，准备产品图片和视频）", assignee: "Bam" },
    { name: "提交初步审核资料（公司邮箱电话+公司文件+商标文件+Mall店链接，提交Shopee）", assignee: "Bam" },
    { name: "等待审核（1-3天，Shopee发结果到邮箱）", assignee: "" },
    { name: "E-Tax审核（5-7个工作日，公司登入帮客户提交E-Tax，信息以PP20为准。合同从系统邮件下载泰英文各一份，公司协助填好发客户签字盖章。测试80分以上，客户可自己考也可公司代考）", assignee: "Bam" },
    { name: "等待Shopee联系（约15个工作日，Shopee打首次提交留的电话通知入驻事项）", assignee: "" },
    { name: "Bam联系K.Fai确认套餐和付款（约32,100泰铢，客户自己充Shopee系统，公司出操作指南协助。付完截图发K.Fai确认。每周三下午5点前付款，周四统一加Mall标签）", assignee: "Bam" },
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
    { name: "Ing收集资料并检查文件完整性", assignee: "Ing" },
    { name: "Ing整理资料", assignee: "Ing" },
    { name: "Ing提交资料给FDA系统", assignee: "Ing" },
    { name: "Pop支付备案申请费100泰铢", assignee: "Pop" },
    { name: "等待官方审核", assignee: "" },
    { name: "如需补资料或修改，Ing协调客户修改后重新提交", assignee: "Ing" },
    { name: "再次等待官方审核", assignee: "" },
    { name: "如果还未通过则重新注册", assignee: "Ing" },
    { name: "Pop再次支付备案申请费", assignee: "Pop" },
    { name: "再次等待官方审核", assignee: "" },
    { name: "审核通过后支付备案证书费", assignee: "Pop" },
    { name: "拿证，发给客户", assignee: "Ing" },
  ];
  if (subServiceType === "food") return [
    { name: "Ing收集资料并检查文件完整性", assignee: "Ing" },
    { name: "Ing整理资料", assignee: "Ing" },
    { name: "把所有资料提交E-consult给官方审查", assignee: "Ing" },
    { name: "等待官方审核（约30个工作日）", assignee: "" },
    { name: "Ing提交资料正式注册FDA", assignee: "Ing" },
    { name: "Pop支付备案申请费", assignee: "Pop" },
    { name: "等待官方审核", assignee: "" },
    { name: "如需补资料、改资料或送测，Ing协调客户处理", assignee: "Ing" },
    { name: "Ing提交补充资料", assignee: "Ing" },
    { name: "再次等待官方审核", assignee: "" },
    { name: "审核通过后支付备案证书费", assignee: "Pop" },
    { name: "拿证，发给客户", assignee: "Ing" },
  ];
  if (subServiceType === "hazard") return [
    { name: "Ing收集资料并检查文件完整性", assignee: "Ing" },
    { name: "Ing整理资料", assignee: "Ing" },
    { name: "把成分信息发给官方检查", assignee: "Ing" },
    { name: "Ing提交资料给FDA", assignee: "Ing" },
    { name: "Pop支付备案申请费", assignee: "Pop" },
    { name: "等待官方审核", assignee: "" },
    { name: "如需补资料、改资料或送测，Ing协调客户处理", assignee: "Ing" },
    { name: "Ing提交补充资料", assignee: "Ing" },
    { name: "再次等待官方审核", assignee: "" },
    { name: "如果还需补资料、改资料或送测，继续处理", assignee: "Ing" },
    { name: "如果还未通过则重新注册", assignee: "Ing" },
    { name: "再次等待官方审核", assignee: "" },
    { name: "审核通过后支付备案证书费", assignee: "Pop" },
    { name: "拿证，发给客户", assignee: "Ing" },
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
    { name: "Bam收集客户资料（企业店铺信息+商标资料+法人护照+公司证书不超过6个月+店铺账号密码+其他平台店铺链接），如无企业店铺可代办收500元", assignee: "Bam" },
    { name: "申请品牌认证（TikTok认WIPO商标信息，TM标只能品牌所有者提交不能授权，授权需等R标）", assignee: "Bam" },
    { name: "准备其他平台店铺资料（Instagram主页改品牌信息+上传产品图，粉丝需超1万）", assignee: "Pop" },
    { name: "商品添加品牌（审核通过后给商品打品牌标签，1-2个工作日）", assignee: "Bam" },
    { name: "提交TikTok审核", assignee: "" },
    { name: "审核通过，店铺上线", assignee: "" },
  ];
  if (subServiceType === "lazada") return [
    { name: "Bam收集客户资料（公司证书不超过6个月+PP20+公司银行账户+法人护照，全部文件法人蓝笔签名+盖章，电话号码+邮箱密码。电器类必须提供自有TISI认证，不能挂靠别人）", assignee: "Bam" },
    { name: "提交公司资料和商标资料给平台审核（所有文件提交Lazada审核系统，5-7个工作日）", assignee: "" },
    { name: "添加仓库地址（以DBD泰国商务发展厅登记信息为准）", assignee: "" },
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


/* ── 达人流程 19 步模板 ── */

export interface InfluencerStepTemplate {
  name: string;
  assignee: string;
  phase: "discovery" | "contract" | "incubation";
}

export function getInfluencerSteps(): InfluencerStepTemplate[] {
  return [
    // 一、达人发现 (5 步)
    { name: "刷 TikTok 直播找达人，录入系统建基础档案", assignee: "全员", phase: "discovery" },
    { name: "无合适人选则 Facebook 发帖或 TikTok 关键词搜索", assignee: "全员", phase: "discovery" },
    { name: "Ploy 从 Kalodata 拉数据评估打分", assignee: "Ploy", phase: "discovery" },
    { name: "Prae/Namcha 筛 A 级达人，每次推 3 位给老板", assignee: "Prae / Namcha", phase: "discovery" },
    { name: "老板确认联系 or 否决", assignee: "老板", phase: "discovery" },
    // 二、签约跟进 (9 步)
    { name: "Prae/Namcha 联系达人聊合作，给出报价方案", assignee: "Prae / Namcha", phase: "contract" },
    { name: "老板审批后元丽开发票，付款方式标全款/部分付款", assignee: "元丽", phase: "contract" },
    { name: "确认达人尺码、身高、地址等细节", assignee: "Prae / Namcha", phase: "contract" },
    { name: "客户寄样品到 Ploy 地址，元丽和 Ploy 建 TAP 推广", assignee: "元丽 / Ploy", phase: "contract" },
    { name: "Ploy 建好 TAP 方案，元丽确定佣金比例教客户操作", assignee: "Ploy / 元丽", phase: "contract" },
    { name: "Ploy 收样检查登记产品信息", assignee: "Ploy", phase: "contract" },
    { name: "Prae/Namcha 起草合同让达人线上签，打印两份", assignee: "Prae / Namcha", phase: "contract" },
    { name: "Ploy 寄样品、更新物流单号、确认达人收到、催产出", assignee: "Ploy", phase: "contract" },
    { name: "持续跟踪直播和视频数据做报表", assignee: "全员", phase: "contract" },
    // 三、品牌孵化 (5 步)
    { name: "Namcha/元丽从达人池筛适合做品牌的", assignee: "Namcha / 元丽", phase: "incubation" },
    { name: "趁送样时机口聊品牌合作意向，留联系方式", assignee: "Prae / Namcha", phase: "incubation" },
    { name: "达人带需求回来，元丽对接中国工厂，谈低 MOQ", assignee: "元丽", phase: "incubation" },
    { name: "打样确认，拿参考品，跟达人一起看实物", assignee: "元丽 / Namcha", phase: "incubation" },
    { name: "正式下生产单，跟踪生产、质检、物流全过程", assignee: "元丽 / Namcha", phase: "incubation" },
  ];
}

export function seedInfluencerSteps(db: any, influencerId: number) {
  const steps = getInfluencerSteps();
  const insert = db.prepare(
    "INSERT INTO influencer_steps (influencer_id, step_name, step_order, phase, status, assignee) VALUES (?, ?, ?, ?, '待处理', ?)"
  );
  steps.forEach((step, i) => {
    insert.run(influencerId, step.name, i + 1, step.phase, step.assignee);
  });
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
      trademark_name TEXT DEFAULT '',
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
      order_id TEXT DEFAULT '',
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
      currency TEXT DEFAULT 'CNY' CHECK(currency IN ('CNY','THB')),
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

  database.exec(`
    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      actor TEXT DEFAULT '',
      action TEXT NOT NULL,
      target_type TEXT NOT NULL,
      target_id TEXT DEFAULT '',
      detail TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS influencers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      tiktok_link TEXT DEFAULT '',
      category TEXT DEFAULT '',
      contact TEXT DEFAULT '',
      contact_phone TEXT DEFAULT '',
      line_id TEXT DEFAULT '',
      monthly_gmv TEXT DEFAULT '',
      live_stream_ratio TEXT DEFAULT '',
      contact_time TEXT DEFAULT '',
      reply_status TEXT DEFAULT '待联系' CHECK(reply_status IN ('待联系','已联系','已回复','未回复','不回复')),
      followers TEXT DEFAULT '',
      avg_views TEXT DEFAULT '',
      gmv_range TEXT DEFAULT '',
      notes TEXT DEFAULT '',
      status TEXT NOT NULL DEFAULT '待评估' CHECK(status IN ('待评估','评估中','已评估','已推荐给老板','已联系','签约中','已签约','品牌孵化中','已完成','已停止')),
      created_by TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS influencer_evaluations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      influencer_id INTEGER NOT NULL REFERENCES influencers(id),
      gmv TEXT DEFAULT '',
      live_stream_ratio TEXT DEFAULT '',
      rating TEXT DEFAULT '' CHECK(rating IN ('','A','B','C','D')),
      content_quality TEXT DEFAULT '',
      brand_fit TEXT DEFAULT '',
      notes TEXT DEFAULT '',
      evaluated_by TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS factories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      category TEXT DEFAULT '',
      moq TEXT DEFAULT '',
      contact TEXT DEFAULT '',
      contact_phone TEXT DEFAULT '',
      address TEXT DEFAULT '',
      notes TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS contracts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      influencer_id INTEGER REFERENCES influencers(id),
      base_salary TEXT DEFAULT '',
      commission TEXT DEFAULT '',
      live_sessions TEXT DEFAULT '',
      live_duration TEXT DEFAULT '',
      video_count TEXT DEFAULT '',
      contract_url TEXT DEFAULT '',
      payment_status TEXT DEFAULT '未付' CHECK(payment_status IN ('未付','部分付','已付')),
      start_date TEXT DEFAULT '',
      end_date TEXT DEFAULT '',
      notes TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS influencer_factories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      influencer_id INTEGER NOT NULL REFERENCES influencers(id),
      factory_id INTEGER NOT NULL REFERENCES factories(id),
      relationship TEXT DEFAULT '合作' CHECK(relationship IN ('合作','考察','已终止')),
      notes TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS influencer_steps (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      influencer_id INTEGER NOT NULL REFERENCES influencers(id),
      step_name TEXT NOT NULL,
      step_order INTEGER NOT NULL,
      phase TEXT DEFAULT 'discovery' CHECK(phase IN ('discovery','contract','incubation')),
      status TEXT NOT NULL DEFAULT '待处理',
      assignee TEXT DEFAULT '',
      notes TEXT DEFAULT '',
      stop_reason TEXT DEFAULT '',
      completed_at TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS influencer_step_notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      step_id INTEGER NOT NULL REFERENCES influencer_steps(id),
      influencer_id INTEGER NOT NULL REFERENCES influencers(id),
      content TEXT NOT NULL,
      created_by TEXT DEFAULT '',
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
  try { database.exec("ALTER TABLE orders ADD COLUMN currency TEXT DEFAULT 'CNY' CHECK(currency IN ('CNY','THB'))"); } catch {}
  try { database.exec("ALTER TABLE finances ADD COLUMN currency TEXT DEFAULT 'CNY' CHECK(currency IN ('CNY','THB'))"); } catch {}
  // Migration: make documents.order_id nullable (drop FK constraint)
  // Only runs once: checks if order_id still has NOT NULL (notnull=1 in PRAGMA table_info)
  try {
    const docsCols = database.prepare("PRAGMA table_info(documents)").all() as { name: string; notnull: number }[];
    const orderIdCol = docsCols.find(c => c.name === "order_id");
    if (orderIdCol && orderIdCol.notnull === 1) {
      database.exec(`
        PRAGMA foreign_keys = OFF;
        CREATE TABLE documents_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          order_id TEXT DEFAULT '',
          name TEXT NOT NULL,
          file_type TEXT DEFAULT '',
          status TEXT NOT NULL DEFAULT '待审核',
          direction TEXT DEFAULT 'client_to_us' CHECK(direction IN ('client_to_us','us_to_client')),
          file_url TEXT DEFAULT '',
          uploaded_by TEXT DEFAULT '',
          created_at TEXT DEFAULT (datetime('now'))
        );
        INSERT INTO documents_new SELECT * FROM documents;
        DROP TABLE documents;
        ALTER TABLE documents_new RENAME TO documents;
        PRAGMA foreign_keys = ON;
      `);
    }
  } catch {}
  try { database.exec("ALTER TABLE orders ADD COLUMN trademark_name TEXT DEFAULT ''"); } catch {}
  try { database.exec("CREATE TABLE IF NOT EXISTS audit_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, actor TEXT DEFAULT '', action TEXT NOT NULL, target_type TEXT NOT NULL, target_id TEXT DEFAULT '', detail TEXT DEFAULT '', created_at TEXT DEFAULT (datetime('now')))"); } catch {}
  // Migration: influencer module tables (added 2026-07)
  try { database.exec("CREATE TABLE IF NOT EXISTS influencer_steps (id INTEGER PRIMARY KEY AUTOINCREMENT, influencer_id INTEGER NOT NULL REFERENCES influencers(id), step_name TEXT NOT NULL, step_order INTEGER NOT NULL, phase TEXT DEFAULT 'discovery' CHECK(phase IN ('discovery','contract','incubation')), status TEXT NOT NULL DEFAULT '待处理', assignee TEXT DEFAULT '', notes TEXT DEFAULT '', stop_reason TEXT DEFAULT '', completed_at TEXT, created_at TEXT DEFAULT (datetime('now')))"); } catch {}
  try { database.exec("CREATE TABLE IF NOT EXISTS influencer_step_notes (id INTEGER PRIMARY KEY AUTOINCREMENT, step_id INTEGER NOT NULL REFERENCES influencer_steps(id), influencer_id INTEGER NOT NULL REFERENCES influencers(id), content TEXT NOT NULL, created_by TEXT DEFAULT '', created_at TEXT DEFAULT (datetime('now')))"); } catch {}
  try { database.exec("ALTER TABLE influencer_steps ADD COLUMN stop_reason TEXT DEFAULT ''"); } catch {}
  try { database.exec("ALTER TABLE influencers ADD COLUMN line_id TEXT DEFAULT ''"); } catch {}
  try { database.exec("ALTER TABLE influencers ADD COLUMN monthly_gmv TEXT DEFAULT ''"); } catch {}
  try { database.exec("ALTER TABLE influencers ADD COLUMN live_stream_ratio TEXT DEFAULT ''"); } catch {}
  try { database.exec("ALTER TABLE influencers ADD COLUMN contact_time TEXT DEFAULT ''"); } catch {}
  try { database.exec("ALTER TABLE influencers ADD COLUMN reply_status TEXT DEFAULT '待联系' CHECK(reply_status IN ('待联系','已联系','已回复','未回复','不回复'))"); } catch {}
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

