import Database from "better-sqlite3";
import path from "path";
import bcrypt from "bcryptjs";
import { companyRegistrationSteps, tisiSteps, type StepTemplate } from "./business-steps";

const DB_PATH = path.join(process.cwd(), "data.db");

let db: Database.Database;

export function getDb(): Database.Database {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma("journal_mode = DELETE");
    db.pragma("foreign_keys = ON");
    initTables(db);
    seedData(db);
  }
  return db;
}

export function logOperation(actor: string, action: string, targetType: string, targetId: string, detail?: string, oldValue?: string, newValue?: string, fieldName?: string) {
  try {
    const d = getDb();
    d.prepare("INSERT INTO audit_logs (actor, action, target_type, target_id, detail, old_value, new_value, field_name) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(
      actor, action, targetType, targetId, detail || "", oldValue || "", newValue || "", fieldName || ""
    );
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
  10: [
    { name: "Pop收集公司文件（注册证明书+董事身份证/护照+BOJ2+BOJ3+BOJ5+公司地图+PP.01+PP.20+PP.09（如有）+社保缴费记录≥1个月+ภ.ง.ด.1≥1个月）", assignee: "Pop", notes: "📋 新公司只需要一个月的社保和税务记录，老公司需要三个月。公司成立满一年或快满一年的，必须先做好年度财务结算才能申请。泰国员工比例要求：四个泰国人对一个外国人，且社保至少要交过一个月。" },
    { name: "Pop收集外国人文件（护照每一页扫描件+毕业证/工作经历证明）", assignee: "Pop" },
    { name: "Pop安排场地拍照（公司大楼外观+招牌+办公室环境+泰国员工照+外国人与董事/员工合影）", assignee: "Pop" },
    { name: "Pop提交WP3工作证预批申请（前往就业厅一站式服务中心）", assignee: "Pop", notes: "📋 外国人现在持有的旅游签或免签必须剩余至少十五天有效期，推荐二十一天以上。护照每一页都要扫描，不能用复印件。" },
    { name: "等待WP3审批（约3-7个工作日）", assignee: "" },
    { name: "取得WP3批准函，发给外国人前往泰国驻外大使馆申请Non-B签证", assignee: "Pop", notes: "⚠️ 在签证审批期间严禁离境！一旦离境，申请直接作废。" },
    { name: "外国人持Non-B签证入境泰国（获得90天停留期）", assignee: "", notes: "📋 入境之后体检是客户自己去做的，不用公司陪。检查六种法定禁止疾病的医院必须是指定认可的，证明有效期一个月。" },
    { name: "Pop提交工作证申请WP.1（全套文件+体检报告+雇佣合同）", assignee: "Pop", notes: "📋 体检证明要先拿到手才能递交工作证申请，这两个是前后依赖的。" },
    { name: "取得工作证蓝本", assignee: "Pop" },
    { name: "Pop准备一年续签文件（更新公司文件+照片+工作证原件+雇佣合同+工资单+个税单+社保记录）", assignee: "Pop", notes: "📋 续签必须在Non-B签证到期前二十到三十天递交，晚了会被拒。税务文件需最新三个月的：ภ.ง.ด.1、社保缴费记录、ภ.พ.30。" },
    { name: "Pop提交续签申请至移民局", assignee: "Pop" },
    { name: "等待续签审批（约30天）", assignee: "" },
    { name: "取得一年签证章", assignee: "Pop", notes: "📋 工作证有效期可能是一次给一年、六个月或三个月，取决于合同期限和官员判断。拿到工作证后回移民局申请续签一年居留许可。如果初始工作证只给了不到一年，到期前需要再来一轮同样的续签流程。" },
  ],
  11: [
    { name: "收集公司资料（注册证明书、董事身份证复印件、户口本复印件、BOJ5股东名册、BOJ2&3设立文件、公司地址地图、公司实景照片含招牌门牌号、参保雇员身份证复印件带签字）", assignee: "Eve" },
    { name: "准备雇员信息表（Excel整理姓名、工资金额、入职日期）", assignee: "Eve" },
    { name: "填写社保局表格（SPS 1-01雇主登记、SPS 1-02雇主登记、SPS 1-03/1雇员入职申报、雇员名单表、授权委托书）", assignee: "Eve" },
    { name: "签字盖章（所有表格和公司文件复印件每页董事签字加公司公章）", assignee: "Eve" },
    { name: "垫付社保预缴金", assignee: "Pop" },
    { name: "前往社保局提交登记", assignee: "Eve" },
    { name: "当天审核拿雇主登记号", assignee: "Eve" },
    { name: "开通网上业务 e-Service（用雇主登记号申请，社保局发用户名密码到公司邮箱）", assignee: "Eve" },
    { name: "交付客户（收据和社保号码交客户，归档结案）", assignee: "Eve" },
  ],
};

export function getBusinessSteps(businessTypeId: number, subServiceType?: string): StepTemplate[] {
  // 子服务分支必须限定在对应业务线内，避免不同业务线出现同名 key 时拿错模板
  if (businessTypeId === 2 && subServiceType === "international") return internationalTrademarkSteps;
  if (businessTypeId === 2 && subServiceType === "buy-r") return buyRTrademarkSteps;
  // FDA sub-services
  if (businessTypeId === 3 && subServiceType === "cosmetics") return [
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
  if (businessTypeId === 3 && subServiceType === "food") return [
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
  if (businessTypeId === 3 && subServiceType === "hazard") return [
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
  if (businessTypeId === 5 && subServiceType === "site") return [
    { name: "确认存储位置和进口位置分开（有货架+合规标识）", assignee: "" },
    { name: "准备场地平面图", assignee: "" },
    { name: "提交DLD场地检查申请", assignee: "" },
    { name: "等官员上门检查", assignee: "" },
  ];
  // Mall sub-services
  if (businessTypeId === 8 && subServiceType === "tiktok") return [
    { name: "Bam收集客户资料（企业店铺信息+商标资料+法人护照+公司证书不超过6个月+店铺账号密码+其他平台店铺链接），如无企业店铺可代办收500元", assignee: "Bam" },
    { name: "申请品牌认证（TikTok认WIPO商标信息，TM标只能品牌所有者提交不能授权，授权需等R标）", assignee: "Bam" },
    { name: "准备其他平台店铺资料（Instagram主页改品牌信息+上传产品图，粉丝需超1万）", assignee: "Pop" },
    { name: "商品添加品牌（审核通过后给商品打品牌标签，1-2个工作日）", assignee: "Bam" },
    { name: "提交TikTok审核", assignee: "" },
    { name: "审核通过，店铺上线", assignee: "" },
  ];
  if (businessTypeId === 8 && subServiceType === "lazada") return [
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

export interface StepTemplateWithDocs extends StepTemplate {
  docs: string[];
}

/**
 * 订单创建用：返回步骤模板 + 每步所需文件清单。
 * 文件清单先按"基础模板"的步骤序号取，再插入湘泰地址的额外步骤，
 * 保证插入步骤后文件清单不会错位。
 */
export function getOrderStepsWithDocs(businessTypeId: number, subServiceType?: string, addressType?: string): StepTemplateWithDocs[] {
  const base = getBusinessSteps(businessTypeId, subServiceType);
  const docsMap = getStepDocs(businessTypeId, subServiceType);
  const withDocs: StepTemplateWithDocs[] = base.map((s, i) => ({ ...s, docs: docsMap[i + 1] || [] }));
  if (businessTypeId === 7 && addressType === "xiangtai") {
    withDocs.splice(3, 0, { name: "签订租赁合同", assignee: "Pop", docs: ["租赁合同"] });
    withDocs.splice(4, 0, { name: "收取首月租金", assignee: "Ing", docs: ["租金收款凭证"] });
  }
  return withDocs;
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
    { name: "从 Kalodata 拉取数据评估打分", assignee: "Ploy", phase: "discovery" },
    { name: "筛选 A 级达人推送老板审批", assignee: "Prae / Namcha", phase: "discovery" },
    { name: "老板确认联系 or 否决", assignee: "老板", phase: "discovery" },
    // 二、签约跟进 (12 步)
    { name: "联系达人沟通报价方案", assignee: "Prae / Namcha", phase: "contract" },
    { name: "老板审批后开具发票", assignee: "Yuanli", phase: "contract" },
    { name: "确认达人尺码、身高、地址等细节", assignee: "Prae / Namcha", phase: "contract" },
    { name: "客户寄样品并创建 TAP 推广方案", assignee: "Yuanli / Ploy", phase: "contract" },
    { name: "确定佣金比例并指导客户操作", assignee: "Ploy / Yuanli", phase: "contract" },
    { name: "收样检查并登记产品信息", assignee: "Ploy", phase: "contract" },
    { name: "起草合同安排达人线上签署", assignee: "Prae / Namcha", phase: "contract" },
    { name: "寄送样品并催产出", assignee: "Ploy", phase: "contract" },
    { name: "跟进第一期的直播和视频数据", assignee: "Namcha / Ploy", phase: "contract" },
    { name: "向达人支付第一期款项", assignee: "Namcha", phase: "contract" },
    { name: "跟进第二期的直播和视频数据", assignee: "Namcha / Ploy", phase: "contract" },
    { name: "向达人支付第二期款项", assignee: "Namcha", phase: "contract" },
    // 三、品牌孵化 (5 步)
    { name: "从达人池筛选适合做品牌的达人", assignee: "Namcha / Yuanli", phase: "incubation" },
    { name: "趁送样时机口聊品牌合作意向，留联系方式", assignee: "Prae / Namcha", phase: "incubation" },
    { name: "对接中国工厂洽谈低 MOQ 条件", assignee: "Yuanli", phase: "incubation" },
    { name: "打样确认，拿参考品，跟达人一起看实物", assignee: "Yuanli / Namcha", phase: "incubation" },
    { name: "正式下生产单，跟踪生产、质检、物流全过程", assignee: "Yuanli / Namcha", phase: "incubation" },
  ];
}

export function seedInfluencerSteps(db: any, influencerId: number, phase?: string) {
  const allSteps = getInfluencerSteps();
  const steps = phase ? allSteps.filter(s => s.phase === phase) : allSteps;
  const insert = db.prepare(
    "INSERT INTO influencer_steps (influencer_id, step_name, step_order, phase, status, assignee) VALUES (?, ?, ?, ?, '待处理', ?)"
  );
  steps.forEach((step, i) => {
    insert.run(influencerId, step.name, i + 1, step.phase, step.assignee);
  });
}

import { stepRequiredDocs, subServices, getStepDocs, internationalTrademarkSteps, buyRTrademarkSteps } from "./constants";
export { stepRequiredDocs, subServices };

/* ── 动态 UPDATE 的字段白名单（防止请求体字段名拼进 SQL 造成列名注入） ── */

export const INFLUENCER_UPDATABLE_FIELDS = new Set([
  "name", "tiktok_link", "category", "contact", "code", "contact_phone", "line_id",
  "monthly_gmv", "live_stream_ratio", "contact_time", "reply_status", "followers",
  "avg_views", "gmv_range", "notes", "status", "phase", "created_by", "discovery_task_id",
]);

export const FACTORY_UPDATABLE_FIELDS = new Set([
  "name", "category", "moq", "contact", "code", "contact_phone", "address", "notes", "phase",
]);

export const CONTRACT_UPDATABLE_FIELDS = new Set([
  "base_salary", "commission", "live_sessions", "live_duration", "video_count",
  "contract_url", "payment_status", "start_date", "end_date", "notes",
  "actual_live_sessions", "actual_live_duration", "actual_video_count", "phase",
]);

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
      updated_at TEXT DEFAULT (datetime('now')),
      phase TEXT NOT NULL DEFAULT 'discovery' CHECK(phase IN ('discovery','completed_discovery','contract','completed_contract','incubation','completed_incubation'))
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
      started_at TEXT,
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
      old_value TEXT DEFAULT '',
      new_value TEXT DEFAULT '',
      field_name TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS influencers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      tiktok_link TEXT DEFAULT '',
      category TEXT DEFAULT '',
      contact TEXT DEFAULT '',
      code TEXT DEFAULT '',
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
      status TEXT NOT NULL DEFAULT '待评估' CHECK(status IN ('待评估','评估中','已评估','已推荐给老板','已联系','签约中','已签约','品牌孵化中','已完成','已停止','已入池')),
      created_by TEXT DEFAULT '',
      deleted INTEGER DEFAULT 0,
      deleted_at TEXT,
      deleted_by TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      phase TEXT NOT NULL DEFAULT 'discovery' CHECK(phase IN ('discovery','completed_discovery','contract','completed_contract','incubation','completed_incubation'))
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
      code TEXT DEFAULT '',
      contact_phone TEXT DEFAULT '',
      address TEXT DEFAULT '',
      notes TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      phase TEXT NOT NULL DEFAULT 'discovery' CHECK(phase IN ('discovery','completed_discovery','contract','completed_contract','incubation','completed_incubation'))
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
      updated_at TEXT DEFAULT (datetime('now')),
      phase TEXT NOT NULL DEFAULT 'discovery' CHECK(phase IN ('discovery','completed_discovery','contract','completed_contract','incubation','completed_incubation'))
    );
  `);

  try { database.exec("ALTER TABLE contracts ADD COLUMN actual_live_sessions TEXT DEFAULT ''"); } catch {}
  try { database.exec("ALTER TABLE contracts ADD COLUMN actual_live_duration TEXT DEFAULT ''"); } catch {}
  try { database.exec("ALTER TABLE contracts ADD COLUMN actual_video_count TEXT DEFAULT ''"); } catch {}
  try { database.exec("ALTER TABLE contracts ADD COLUMN created_by TEXT DEFAULT ''"); } catch {}
  try { database.exec("ALTER TABLE contracts ADD COLUMN deleted INTEGER DEFAULT 0"); } catch {}
  try { database.exec("ALTER TABLE contracts ADD COLUMN deleted_at TEXT"); } catch {}
  try { database.exec("ALTER TABLE contracts ADD COLUMN deleted_by TEXT DEFAULT ''"); } catch {}

  database.exec(`
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

  // 内部管理 - 问题工单
  database.exec(`
    CREATE TABLE IF NOT EXISTS issue_tickets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ticket_number TEXT DEFAULT '',
      ref_id TEXT DEFAULT '',
      ref_type TEXT DEFAULT '',
      description TEXT NOT NULL,
      priority TEXT DEFAULT 'medium' CHECK(priority IN ('low','medium','high','urgent')),
      status TEXT DEFAULT '待处理' CHECK(status IN ('待处理','处理中','已解决')),
      assignee TEXT DEFAULT '',
      created_by TEXT DEFAULT '',
      resolved_by TEXT DEFAULT '',
      resolved_at TEXT,
      withdrawn_by TEXT DEFAULT '',
      withdrawn_at TEXT,
      images TEXT DEFAULT '[]',
      resolve_screenshot TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
  `);

  // 内部管理 - 考勤打卡
  database.exec(`
    CREATE TABLE IF NOT EXISTS attendance (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_name TEXT NOT NULL,
      date TEXT NOT NULL,
      check_in TEXT DEFAULT '',
      check_out TEXT DEFAULT '',
      work_hours REAL DEFAULT 0,
      type TEXT DEFAULT '正常' CHECK(type IN ('正常','补签','请假')),
      ip_address TEXT DEFAULT '',
      user_agent TEXT DEFAULT '',
      check_in_ip TEXT DEFAULT '',
      check_out_ip TEXT DEFAULT '',
      check_in_photo TEXT DEFAULT '',
      check_out_photo TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);

  // 补卡申请表
  database.exec(`
    CREATE TABLE IF NOT EXISTS attendance_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_name TEXT NOT NULL,
      date TEXT NOT NULL,
      time TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT '补签',
      reason TEXT DEFAULT '',
      photo TEXT DEFAULT '',
      status TEXT NOT NULL DEFAULT '待审批' CHECK(status IN ('待审批','已通过','已驳回')),
      approved_by TEXT DEFAULT '',
      approved_at TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  // 内部管理 - 通知中心
  database.exec(`
    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT DEFAULT '' CHECK(type IN ('','issue_assigned','leave_requested','contract_overdue','eval_done','mention')),
      title TEXT DEFAULT '',
      body TEXT DEFAULT '',
      recipient TEXT DEFAULT '',
      related_id TEXT DEFAULT '',
      related_type TEXT DEFAULT '',
      is_read INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);

  // 模板库
  database.exec(`
    CREATE TABLE IF NOT EXISTS templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('contract','evaluation','finance')),
      category TEXT DEFAULT '',
      data_json TEXT DEFAULT '{}',
      created_by TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  // 内部管理 - 请假
  database.exec(`
    CREATE TABLE IF NOT EXISTS leave_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_name TEXT NOT NULL,
      leave_type TEXT DEFAULT '事假' CHECK(leave_type IN ('事假','病假','年假','其他')),
      start_date TEXT NOT NULL,
      end_date TEXT NOT NULL,
      reason TEXT DEFAULT '',
      status TEXT DEFAULT '待审批' CHECK(status IN ('待审批','已通过','已驳回')),
      approved_by TEXT DEFAULT '',
      approved_at TEXT,
      images TEXT DEFAULT '[]',
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);

  // leave_requests 迁移：补 images 列
  try { database.exec("ALTER TABLE leave_requests ADD COLUMN images TEXT DEFAULT '[]'"); } catch {}

  // 奖惩制度 - 积分规则表
  database.exec(`
    CREATE TABLE IF NOT EXISTS points_rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      rule_name TEXT NOT NULL,
      rule_key TEXT NOT NULL UNIQUE,
      points INTEGER NOT NULL,
      rule_type TEXT DEFAULT 'auto' CHECK(rule_type IN ('auto','manual')),
      description TEXT DEFAULT '',
      is_active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);

  // 奖惩制度 - 积分记录表
  database.exec(`
    CREATE TABLE IF NOT EXISTS points_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_name TEXT NOT NULL,
      points INTEGER NOT NULL,
      reason TEXT NOT NULL,
      rule_key TEXT DEFAULT '',
      ref_id TEXT DEFAULT '',
      ref_type TEXT DEFAULT '',
      is_manual INTEGER DEFAULT 0,
      is_appealed INTEGER DEFAULT 0,
      appeal_reason TEXT DEFAULT '',
      appeal_status TEXT DEFAULT '',
      created_by TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);

  // ── 以下表在开发过程中逐步新增，补充在此确保部署时自动建表 ──
  database.exec(`
    CREATE TABLE IF NOT EXISTS peer_votes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      voter TEXT NOT NULL,
      nominee TEXT NOT NULL,
      reason TEXT DEFAULT '',
      month TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);

  database.exec(`
    CREATE TABLE IF NOT EXISTS client_feedback (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id TEXT NOT NULL,
      responsible_person TEXT DEFAULT '',
      overall INTEGER NOT NULL DEFAULT 3 CHECK(overall BETWEEN 1 AND 5),
      attitude INTEGER NOT NULL DEFAULT 3 CHECK(attitude BETWEEN 1 AND 5),
      speed INTEGER NOT NULL DEFAULT 3 CHECK(speed BETWEEN 1 AND 5),
      professionalism INTEGER NOT NULL DEFAULT 3 CHECK(professionalism BETWEEN 1 AND 5),
      comment TEXT DEFAULT '',
      feedback_type TEXT DEFAULT 'client' CHECK(feedback_type IN ('client','internal')),
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);

  // 迁移旧 client_feedback 表（如果是从旧结构升级）
  try { database.exec("ALTER TABLE client_feedback ADD COLUMN comment TEXT DEFAULT ''"); } catch {}
  try { database.exec("ALTER TABLE client_feedback ADD COLUMN overall INTEGER NOT NULL DEFAULT 3 CHECK(overall BETWEEN 1 AND 5)"); } catch {}
  try { database.exec("ALTER TABLE client_feedback ADD COLUMN attitude INTEGER NOT NULL DEFAULT 3 CHECK(attitude BETWEEN 1 AND 5)"); } catch {}
  try { database.exec("ALTER TABLE client_feedback ADD COLUMN speed INTEGER NOT NULL DEFAULT 3 CHECK(speed BETWEEN 1 AND 5)"); } catch {}
  try { database.exec("ALTER TABLE client_feedback ADD COLUMN professionalism INTEGER NOT NULL DEFAULT 3 CHECK(professionalism BETWEEN 1 AND 5)"); } catch {}

  database.exec(`
    CREATE TABLE IF NOT EXISTS feedback_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      token TEXT NOT NULL UNIQUE,
      order_id TEXT NOT NULL UNIQUE,
      created_at TEXT DEFAULT (datetime('now')),
      submitted INTEGER NOT NULL DEFAULT 0,
      submitted_at TEXT DEFAULT ''
    );
  `);


  database.exec(`
    CREATE TABLE IF NOT EXISTS vat_customers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company_name TEXT NOT NULL,
      tax_id TEXT DEFAULT '',
      contact TEXT DEFAULT '',
      status TEXT NOT NULL DEFAULT '启用' CHECK(status IN ('启用','暂停','已终止')),
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
  `);

  database.exec(`
    CREATE TABLE IF NOT EXISTS vat_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_id INTEGER NOT NULL REFERENCES vat_customers(id),
      year_month TEXT NOT NULL,
      progress TEXT NOT NULL DEFAULT '收资料',
      amount REAL DEFAULT 0,
      assignee TEXT DEFAULT '',
      file_paths TEXT DEFAULT '[]',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
  `);

  database.exec(`
    CREATE TABLE IF NOT EXISTS vat_record_steps (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      record_id INTEGER NOT NULL REFERENCES vat_records(id),
      step_name TEXT NOT NULL,
      step_order INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT '待处理',
      assignee TEXT DEFAULT '',
      notes TEXT DEFAULT '',
      payment_status TEXT DEFAULT '',
      started_at TEXT,
      completed_at TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);

  database.exec(`
    CREATE TABLE IF NOT EXISTS vat_reconciliation (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_id INTEGER NOT NULL REFERENCES vat_customers(id),
      year_month TEXT NOT NULL,
      tax_payable REAL DEFAULT 0,
      tax_paid REAL DEFAULT 0,
      tax_unpaid REAL DEFAULT 0,
      notes TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
  `);

  database.exec(`
    CREATE TABLE IF NOT EXISTS vat_step_notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      record_id INTEGER NOT NULL,
      step_id INTEGER NOT NULL,
      content TEXT NOT NULL,
      created_by TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS vat_step_documents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      step_id INTEGER NOT NULL,
      record_id INTEGER NOT NULL,
      document_name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('uploaded','pending'))
    );

    CREATE TABLE IF NOT EXISTS vat_record_documents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      record_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      file_url TEXT DEFAULT '',
      uploaded_by TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS vat_record_finances (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      record_id INTEGER NOT NULL,
      type TEXT NOT NULL DEFAULT 'income' CHECK(type IN ('income','expense')),
      amount REAL NOT NULL DEFAULT 0,
      description TEXT DEFAULT '',
      payment_method TEXT DEFAULT '',
      slip_number TEXT DEFAULT '',
      slip_file TEXT DEFAULT '',
      status TEXT NOT NULL DEFAULT 'paid' CHECK(status IN ('paid','pending','cancelled')),
      currency TEXT DEFAULT 'CNY',
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);


  // VAT 第二轮迁移
  try { database.exec("ALTER TABLE vat_record_steps ADD COLUMN started_at TEXT"); } catch {}
  try { database.exec("ALTER TABLE vat_record_steps ADD COLUMN payment_status TEXT DEFAULT ''"); } catch {}

  // 触发自动积分规则
  try { seedPointsRulesZ(database); } catch {}


  // Migrations for existing databases
  try { database.exec("ALTER TABLE finances ADD COLUMN payment_method TEXT DEFAULT ''"); } catch {}
  try { database.exec("ALTER TABLE finances ADD COLUMN slip_number TEXT DEFAULT ''"); } catch {}
  try { database.exec("ALTER TABLE documents ADD COLUMN direction TEXT DEFAULT 'client_to_us' CHECK(direction IN ('client_to_us', 'us_to_client'))"); } catch {}
  try { database.exec("ALTER TABLE employees ADD COLUMN email TEXT DEFAULT ''"); } catch {}
  try { database.exec("ALTER TABLE employees ADD COLUMN role TEXT DEFAULT 'employee' CHECK(role IN ('admin','employee','client'))"); } catch {}
  try { database.exec("ALTER TABLE employees ADD COLUMN api_key TEXT DEFAULT ''"); } catch {}
  try { database.exec("ALTER TABLE attendance ADD COLUMN type TEXT DEFAULT '正常' CHECK(type IN ('正常','补签','请假'))"); } catch {}
  try { database.exec("ALTER TABLE attendance ADD COLUMN ip_address TEXT DEFAULT ''"); } catch {}
  try { database.exec("ALTER TABLE attendance ADD COLUMN user_agent TEXT DEFAULT ''"); } catch {}
  try { database.exec("ALTER TABLE attendance ADD COLUMN check_in_ip TEXT DEFAULT ''"); } catch {}
  try { database.exec("ALTER TABLE attendance ADD COLUMN check_out_ip TEXT DEFAULT ''"); } catch {}
  try { database.exec("ALTER TABLE attendance ADD COLUMN check_in_photo TEXT DEFAULT ''"); } catch {}
  try { database.exec("ALTER TABLE attendance ADD COLUMN check_out_photo TEXT DEFAULT ''"); } catch {}
  try { database.exec("ALTER TABLE attendance_requests ADD COLUMN photo TEXT DEFAULT ''"); } catch {}
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
  try { database.exec("ALTER TABLE audit_logs ADD COLUMN old_value TEXT DEFAULT ''"); } catch {}
  try { database.exec("ALTER TABLE audit_logs ADD COLUMN new_value TEXT DEFAULT ''"); } catch {}
  try { database.exec("ALTER TABLE audit_logs ADD COLUMN field_name TEXT DEFAULT ''"); } catch {}
  // Migration: influencer module tables (added 2026-07)
  try { database.exec("CREATE TABLE IF NOT EXISTS influencer_steps (id INTEGER PRIMARY KEY AUTOINCREMENT, influencer_id INTEGER NOT NULL REFERENCES influencers(id), step_name TEXT NOT NULL, step_order INTEGER NOT NULL, phase TEXT DEFAULT 'discovery' CHECK(phase IN ('discovery','contract','incubation')), status TEXT NOT NULL DEFAULT '待处理', assignee TEXT DEFAULT '', notes TEXT DEFAULT '', stop_reason TEXT DEFAULT '', completed_at TEXT, created_at TEXT DEFAULT (datetime('now')))"); } catch {}
  try { database.exec("CREATE TABLE IF NOT EXISTS influencer_step_notes (id INTEGER PRIMARY KEY AUTOINCREMENT, step_id INTEGER NOT NULL REFERENCES influencer_steps(id), influencer_id INTEGER NOT NULL REFERENCES influencers(id), content TEXT NOT NULL, created_by TEXT DEFAULT '', created_at TEXT DEFAULT (datetime('now')))"); } catch {}
  try { database.exec("ALTER TABLE influencer_steps ADD COLUMN stop_reason TEXT DEFAULT ''"); } catch {}
  try { database.exec("ALTER TABLE order_steps ADD COLUMN started_at TEXT"); } catch {}
  try { database.exec("ALTER TABLE influencer_steps ADD COLUMN started_at TEXT"); } catch {}
  try { database.exec("ALTER TABLE influencers ADD COLUMN line_id TEXT DEFAULT ''"); } catch {}
  try { database.exec("ALTER TABLE influencers ADD COLUMN monthly_gmv TEXT DEFAULT ''"); } catch {}
  try { database.exec("ALTER TABLE influencers ADD COLUMN live_stream_ratio TEXT DEFAULT ''"); } catch {}
  try { database.exec("ALTER TABLE influencers ADD COLUMN contact_time TEXT DEFAULT ''"); } catch {}
  try { database.exec("ALTER TABLE influencers ADD COLUMN reply_status TEXT DEFAULT '待联系' CHECK(reply_status IN ('待联系','已联系','已回复','未回复','不回复'))"); } catch {}
  try { database.exec("ALTER TABLE influencers ADD COLUMN phase TEXT DEFAULT 'discovery'"); } catch {}
  try { database.exec("CREATE TABLE IF NOT EXISTS influencer_documents (id INTEGER PRIMARY KEY AUTOINCREMENT, influencer_id INTEGER NOT NULL REFERENCES influencers(id), name TEXT NOT NULL, file_type TEXT DEFAULT '', file_url TEXT DEFAULT '', status TEXT DEFAULT '已审核', uploaded_by TEXT DEFAULT '', created_at TEXT DEFAULT (datetime('now')))"); } catch {}
  try { database.exec("CREATE TABLE IF NOT EXISTS influencer_finances (id INTEGER PRIMARY KEY AUTOINCREMENT, influencer_id INTEGER NOT NULL REFERENCES influencers(id), type TEXT NOT NULL CHECK(type IN ('income','expense')), amount REAL NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'pending', description TEXT DEFAULT '', payment_method TEXT DEFAULT '', slip_number TEXT DEFAULT '', slip_file TEXT DEFAULT '', currency TEXT DEFAULT 'CNY', created_at TEXT DEFAULT (datetime('now')))"); } catch {}
  try { database.exec("CREATE TABLE IF NOT EXISTS influencer_certificates (id INTEGER PRIMARY KEY AUTOINCREMENT, influencer_id INTEGER NOT NULL REFERENCES influencers(id), certificate_number TEXT DEFAULT '', product_name TEXT DEFAULT '', issue_date TEXT DEFAULT '', expiry_date TEXT DEFAULT '', status TEXT DEFAULT 'valid', notes TEXT DEFAULT '', file_url TEXT DEFAULT '', created_at TEXT DEFAULT (datetime('now')))"); } catch {}
  try { database.exec("CREATE TABLE IF NOT EXISTS discovery_tasks (id INTEGER PRIMARY KEY AUTOINCREMENT, task_number TEXT NOT NULL, category TEXT DEFAULT '', creator TEXT DEFAULT '', status TEXT DEFAULT 'active' CHECK(status IN ('active','completed')), created_at TEXT DEFAULT (datetime('now')), completed_at TEXT)"); } catch {}
  try { database.exec("ALTER TABLE influencers ADD COLUMN discovery_task_id INTEGER REFERENCES discovery_tasks(id)"); } catch {}
  try { database.exec("ALTER TABLE influencer_evaluations ADD COLUMN gmv_amount TEXT DEFAULT ''"); } catch {}
  try { database.exec("ALTER TABLE influencer_evaluations ADD COLUMN gmv_tier TEXT DEFAULT ''"); } catch {}
  try { database.exec("ALTER TABLE influencer_evaluations ADD COLUMN gmv_score INTEGER DEFAULT 0"); } catch {}
  try { database.exec("ALTER TABLE influencer_evaluations ADD COLUMN live_duration_tier TEXT DEFAULT ''"); } catch {}
  try { database.exec("ALTER TABLE influencer_evaluations ADD COLUMN live_duration_score INTEGER DEFAULT 0"); } catch {}
  try { database.exec("ALTER TABLE influencer_evaluations ADD COLUMN live_frequency_tier TEXT DEFAULT ''"); } catch {}
  try { database.exec("ALTER TABLE influencer_evaluations ADD COLUMN live_frequency_score INTEGER DEFAULT 0"); } catch {}
  try { database.exec("ALTER TABLE influencer_evaluations ADD COLUMN professionalism_tier TEXT DEFAULT ''"); } catch {}
  try { database.exec("ALTER TABLE influencer_evaluations ADD COLUMN professionalism_score INTEGER DEFAULT 0"); } catch {}
  try { database.exec("ALTER TABLE influencer_evaluations ADD COLUMN total_score INTEGER DEFAULT 0"); } catch {}
  try { database.exec("ALTER TABLE influencer_evaluations ADD COLUMN final_rating TEXT DEFAULT ''"); } catch {}
  try { database.exec("ALTER TABLE influencer_evaluations ADD COLUMN live_gmv TEXT DEFAULT ''"); } catch {}
  try { database.exec("ALTER TABLE influencers ADD COLUMN code TEXT DEFAULT ''"); } catch {}
  try { database.exec("ALTER TABLE points_records ADD COLUMN status TEXT DEFAULT '有效' CHECK(status IN ('有效','已救回','已撤销'))"); } catch {}
  try { database.exec("ALTER TABLE points_records ADD COLUMN undone_by TEXT DEFAULT ''"); } catch {}
  try { database.exec("ALTER TABLE points_records ADD COLUMN undone_at TEXT DEFAULT ''"); } catch {}
  try { database.exec("ALTER TABLE issue_tickets ADD COLUMN resolve_screenshot TEXT DEFAULT ''"); } catch {}
  try { database.exec("ALTER TABLE customers ADD COLUMN claimed_by TEXT DEFAULT ''"); } catch {}

  /* ── 客户管理 ── */
  database.exec(`
    CREATE TABLE IF NOT EXISTS customers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company_name TEXT NOT NULL UNIQUE,
      industry TEXT DEFAULT '',
      company_type TEXT DEFAULT '',
      founded_at TEXT DEFAULT '',
      source_channel TEXT DEFAULT '',
      owner_name TEXT DEFAULT '',
      owner_wechat TEXT DEFAULT '',
      handler_name TEXT DEFAULT '',
      handler_wechat TEXT DEFAULT '',
      willingness TEXT DEFAULT '',
      demand_tags TEXT DEFAULT '',
      status TEXT DEFAULT '潜在' CHECK(status IN ('潜在','跟进中','已合作','沉睡')),
      claimed_by TEXT DEFAULT '',
      total_deal_amount REAL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS customer_follow_ups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_id INTEGER NOT NULL REFERENCES customers(id),
      employee_name TEXT DEFAULT '',
      content TEXT DEFAULT '',
      next_contact_at TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS customer_points (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_name TEXT DEFAULT '',
      point_type TEXT NOT NULL CHECK(point_type IN ('跟进','认领','激活','升级','成交')),
      points INTEGER DEFAULT 0,
      customer_id INTEGER REFERENCES customers(id),
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS point_withdrawals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_name TEXT NOT NULL,
      amount INTEGER NOT NULL,
      status TEXT DEFAULT '待审核' CHECK(status IN ('待审核','已通过','已驳回')),
      reviewed_by TEXT DEFAULT '',
      review_note TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now')),
      reviewed_at TEXT DEFAULT ''
    );
  `);
}

/* ── 积分规则种子 ── */
let pointsRulesSeeded = false;

function seedPointsRulesZ(database: Database.Database) {
  if (pointsRulesSeeded) return;
  const rules = [
    ["迟到扣分", "late", -3, "auto", "迟到一次扣3分"],
    ["缺勤扣分", "absent", -10, "auto", "缺勤一天扣10分"],
    ["请假扣分", "leave", -1, "auto", "请假一天扣1分"],
    ["全勤奖励", "full_attendance", 5, "auto", "当月无迟到奖励5分"],
    ["步骤逾期扣分", "step_overdue", -5, "auto", "订单步骤到期未完成扣5分"],
    ["步骤提前完成加分", "step_early", 2, "auto", "订单步骤提前完成加2分"],
    ["工单超时扣分", "issue_overdue", -3, "auto", "工单超过2天未处理扣3分"],
    ["工单解决加分", "issue_resolved", 3, "auto", "解决一个工单加3分"],
    ["达人A级评估加分", "influencer_a_grade", 5, "auto", "评估出一个A级达人加5分"],
    ["客户跟进加分", "customer_followup", 2, "auto", "写一条客户跟进日志加2分"],
    ["客户认领加分", "customer_claim", 5, "auto", "认领一个客户加5分"],
    ["客户激活加分", "customer_activate", 8, "auto", "激活一个沉睡客户加8分"],
    ["客户升级加分", "customer_upgrade", 10, "auto", "客户从潜在升级到已合作加10分"],
    ["销售成交加分", "customer_deal", 10, "auto", "成交一单关联客户加10分"],
  ];
  const stmt = database.prepare(
    "INSERT OR IGNORE INTO points_rules (rule_name, rule_key, points, rule_type, description) VALUES (?, ?, ?, ?, ?)"
  );
  for (const r of rules) {
    stmt.run(r[0], r[1], r[2], r[3], r[4]);
  }
  pointsRulesSeeded = true;
}

/* ── 种子数据 ── */


function seedData(database: Database.Database) {
  const empCount = database.prepare("SELECT COUNT(*) as c FROM employees").get() as { c: number };
  if (empCount.c === 0) {
    const insert = database.prepare("INSERT INTO employees (name, email, role, password) VALUES (?, ?, ?, ?)");
    const teamEmps: [string, string][] = [
      ["Bam","bam@xiangtai.com"], ["Fern","fern@xiangtai.com"], ["Ing","ing@xiangtai.com"],
      ["Pop","pop@xiangtai.com"], ["Eve","eve@xiangtai.com"],
      ["Ploy","ploy@xiangtai.com"], ["Yuanli","yuanli@xiangtai.com"],
      ["Prae","prae@xiangtai.com"], ["Namcha","namcha@xiangtai.com"]
    ];
    for (const [name, email] of teamEmps) insert.run(name, email, "employee", bcrypt.hashSync("123456", 10));
    insert.run("张三", "zhangsan@xiangtai.com", "admin", bcrypt.hashSync("123456", 10));
    insert.run("李四", "lisi@client.com", "client", bcrypt.hashSync("123456", 10));
  }

  const btCount = database.prepare("SELECT COUNT(*) as c FROM business_types").get() as { c: number };
  if (btCount.c === 0) {
    const insert = database.prepare("INSERT INTO business_types (name) VALUES (?)");
    for (const name of ["公司注册","商标","FDA认证","TISI","DLD","清关","地址认证","Mall开店","NBTC","工作签证","社保开户"]) insert.run(name);
  }

  // 迁移：确保工作签证业务线存在（已有数据的服务器不会走到上面的种子逻辑）
  // 重要：插入顺序必须与种子保持一致 — 工作签证(ID 10), 社保开户(ID 11)
  // 这样 businessSteps[10] 才会对应工作签证、businessSteps[11] 对应社保开户
  try {
    const workVisaExists = database.prepare("SELECT 1 FROM business_types WHERE name = '工作签证'").get();
    if (!workVisaExists) {
      database.prepare("INSERT INTO business_types (name) VALUES ('工作签证')").run();
      console.log("[DB] 已插入工作签证业务线");
    }
  } catch {}

  // 迁移：确保社保开户业务线存在
  try {
    const ssExists = database.prepare("SELECT 1 FROM business_types WHERE name = '社保开户'").get();
    if (!ssExists) {
      database.prepare("INSERT INTO business_types (name) VALUES ('社保开户')").run();
      console.log("[DB] 已插入社保开户业务线");
    }
  } catch {}

  // 迁移：员工名字统一化 — 元丽 → Yuanli
  try {
    const emp = database.prepare("SELECT 1 FROM employees WHERE name = '元丽'").get();
    if (emp) {
      database.prepare("UPDATE employees SET name = 'Yuanli' WHERE name = '元丽'").run();
      // order_steps: assignee 字段可能含 "元丽"（单独或组合如 "元丽 / Namcha"）
      database.prepare("UPDATE order_steps SET assignee = REPLACE(assignee, '元丽', 'Yuanli') WHERE assignee LIKE '%元丽%'").run();
      // influencer_steps
      database.prepare("UPDATE influencer_steps SET assignee = REPLACE(assignee, '元丽', 'Yuanli') WHERE assignee LIKE '%元丽%'").run();
      // influencer_step_notes: created_by
      database.prepare("UPDATE influencer_step_notes SET created_by = 'Yuanli' WHERE created_by = '元丽'").run();
      // influencer_evaluations: evaluated_by
      database.prepare("UPDATE influencer_evaluations SET evaluated_by = 'Yuanli' WHERE evaluated_by = '元丽'").run();
      // influencers: created_by
      database.prepare("UPDATE influencers SET created_by = 'Yuanli' WHERE created_by = '元丽'").run();
      // contracts: created_by
      database.prepare("UPDATE contracts SET created_by = 'Yuanli' WHERE created_by = '元丽'").run();
      // step_notes: created_by
      database.prepare("UPDATE step_notes SET created_by = 'Yuanli' WHERE created_by = '元丽'").run();
      // audit_logs: actor
      database.prepare("UPDATE audit_logs SET actor = 'Yuanli' WHERE actor = '元丽'").run();
      // issue_tickets: created_by, assignee, resolved_by
      database.prepare("UPDATE issue_tickets SET created_by = 'Yuanli' WHERE created_by = '元丽'").run();
      database.prepare("UPDATE issue_tickets SET assignee = REPLACE(assignee, '元丽', 'Yuanli') WHERE assignee LIKE '%元丽%'").run();
      database.prepare("UPDATE issue_tickets SET resolved_by = 'Yuanli' WHERE resolved_by = '元丽'").run();
      // attendance: created_by
      database.prepare("UPDATE attendance SET created_by = 'Yuanli' WHERE created_by = '元丽'").run();
      console.log("[DB] 已将员工 元丽 更新为 Yuanli，并同步所有关联表");
    }
  } catch {}

}
