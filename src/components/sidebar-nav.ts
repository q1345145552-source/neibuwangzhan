import {
  Search,
  FolderOpen,
  BarChart3,
  Layers,
  LayoutDashboard,
  Building2,
  Tag,
  ShieldCheck,
  FileCheck,
  Car,
  Ship,
  MapPin,
  Store,
  Radio,
  UsersRound,
  Sparkles,
  CheckSquare,
  FileText,
  DollarSign,
  Settings,
  Monitor,
  Star,
  Shield,
  Briefcase,
  Calculator,
  Package,
  Inbox,
  Truck,
  AlertCircle,
  ListTodo,
  Activity,
  FolderKanban,
  MessageSquare,
  MessageSquareText,
  IdCard,
  Ticket,
  Bell,
  BellRing,
  BookOpen,
  ClipboardList,
  CalendarClock,
  Vault,
  Lightbulb,
  Timer,
  Workflow,
  type LucideIcon,
} from "lucide-react";

/**
 * 左边菜单（2026-11-03 老板：「功能栏得优化一下，业务系统有关的单独划出来」）。
 * 只挪位置、分组，名字、地址、谁能看到都和原来一样。新加菜单项放进对应分组；只给管理员的同时写进 ADMIN_ONLY_NAV。
 */
export type NavItem = { name: string; href: string; icon: LucideIcon };
export type NavGroup = { key: string; label: string; items: NavItem[]; defaultOpen?: boolean };

/** 常用：不分组，一直显示 */
export const TOP_NAV: NavItem[] = [
  { name: "全局搜索", href: "/search", icon: Search },
  { name: "仪表盘", href: "/", icon: LayoutDashboard },
  { name: "数据总览", href: "/visualization", icon: BarChart3 },
  { name: "监督看板", href: "/boss-supervision", icon: ShieldCheck },
  { name: "我的待办", href: "/todos", icon: ListTodo },
  { name: "消息", href: "/messages", icon: MessageSquare },
  { name: "消息中心", href: "/notifications", icon: BellRing },
];

export const NAV_GROUPS: NavGroup[] = [
  {
    key: "storefront", label: "业务系统", defaultOpen: true, items: [
      // 2026-10-15：订单总表和待分类领取队列原来只能从首页「总订单」卡片进
      { name: "订单管理", href: "/orders", icon: Package },
      { name: "待分类（待领取）", href: "/orders/unclassified", icon: Inbox },
      // 客户在业务系统给每一步打的分、送特产（2026-10-20）
      { name: "客户评价", href: "/customer-ratings", icon: Star },
      { name: "代理记账", href: "/agent-rebates", icon: DollarSign },
      { name: "流程设置", href: "/workflows", icon: Workflow },
      { name: "办理月报", href: "/internal/handling-report", icon: Timer },
    ],
  },
  {
    key: "business", label: "业务线", items: [
      { name: "公司注册", href: "/company-registration", icon: Building2 },
      { name: "工作签证", href: "/work-visa", icon: Briefcase },
      { name: "社保开户", href: "/social-security", icon: Shield },
      { name: "商标", href: "/trademark", icon: Tag },
      { name: "FDA认证", href: "/fda-certification", icon: ShieldCheck },
      { name: "TISI", href: "/tisi", icon: FileCheck },
      { name: "DLD", href: "/dld", icon: Car },
      { name: "清关", href: "/customs-clearance", icon: Ship },
      { name: "地址认证", href: "/address-certification", icon: MapPin },
      { name: "Mall开店", href: "/mall-store", icon: Store },
      { name: "店铺管理", href: "/internal/shopee", icon: Store },
      { name: "NBTC", href: "/nbtc", icon: Radio },
    ],
  },
  {
    key: "customers", label: "客户", items: [
      { name: "客户管理", href: "/customers", icon: Building2 },
      { name: "问题跟踪", href: "/problems", icon: AlertCircle },
    ],
  },
  {
    key: "finance", label: "财务税务", items: [
      { name: "费用管理", href: "/finance", icon: DollarSign },
      { name: "VAT申报", href: "/vat", icon: Calculator },
      { name: "预扣税申报", href: "/wht", icon: FileText },
    ],
  },
  {
    key: "work", label: "日常工作", items: [
      { name: "工单", href: "/issues", icon: Ticket },
      { name: "任务看板", href: "/tasks", icon: CheckSquare },
      { name: "我的项目", href: "/projects", icon: FolderKanban },
      { name: "工作记录", href: "/work-reports", icon: ClipboardList },
      { name: "周报", href: "/internal/weekly-report", icon: BarChart3 },
      { name: "会议记录", href: "/meetings", icon: CalendarClock },
      { name: "想法记录", href: "/ideas", icon: Lightbulb },
    ],
  },
  {
    key: "notices", label: "通知规则", items: [
      { name: "老板通知", href: "/announcements", icon: Bell },
      { name: "通知/规则", href: "/notice-rules", icon: FileCheck },
      { name: "规则库", href: "/rules", icon: BookOpen },
    ],
  },
  {
    key: "files", label: "文件资料", items: [
      { name: "我的文件夹", href: "/my-folder", icon: FolderOpen },
      { name: "公司档案", href: "/company-archives", icon: Building2 },
      { name: "文档管理", href: "/documents", icon: FileText },
      { name: "模板库", href: "/internal/templates", icon: Layers },
    ],
  },
  {
    key: "internal", label: "内部管理", items: [
      { name: "内部管理", href: "/internal", icon: Monitor },
      { name: "员工档案", href: "/internal/employees", icon: IdCard },
      { name: "请假", href: "/internal/leave", icon: Monitor },
      { name: "奖惩制度", href: "/internal/rewards", icon: Star },
      { name: "员工动态", href: "/activity", icon: Activity },
      { name: "资产台账", href: "/assets", icon: Vault },
    ],
  },
  {
    key: "agency", label: "机构", items: [
      { name: "机构管理", href: "/agency", icon: LayoutDashboard },
      { name: "达人发现", href: "/agency/influencers", icon: UsersRound },
      { name: "签约跟进", href: "/agency/contracts", icon: FileCheck },
      { name: "品牌孵化", href: "/agency/incubation", icon: Sparkles },
    ],
  },
  {
    key: "logistics", label: "物流", items: [
      { name: "轨迹更新", href: "/logistics", icon: Truck },
      { name: "话术模板", href: "/logistics/scripts", icon: MessageSquareText },
    ],
  },
];

/** 放在最下面，不分组 */
export const BOTTOM_NAV: NavItem[] = [{ name: "设置", href: "/settings", icon: Settings }];

/** 只有管理员能看到的菜单项 */
const ADMIN_ONLY_NAV = new Set(["数据总览", "监督看板", "我的项目", "员工动态", "办理月报", "流程设置", "代理记账"]);
/** 客户账号（内部系统的 client 角色）看不到的菜单项 */
const NOT_FOR_CLIENT_NAV = new Set(["全局搜索", "我的文件夹", "公司档案", "通知/规则", "客户评价"]);

export function navForRole(items: NavItem[], role?: string): NavItem[] {
  if (role === "admin") return items;
  return items.filter((n) => !ADMIN_ONLY_NAV.has(n.name) && !(role === "client" && NOT_FOR_CLIENT_NAV.has(n.name)));
}

/** 这个账号看得到的分组：机构业务总开关关了不显示机构，一项都看不到的分组也不显示 */
export function groupsForRole(role: string | undefined, agencyEnabled: boolean): NavGroup[] {
  return NAV_GROUPS
    .filter((g) => g.key !== "agency" || agencyEnabled)
    .map((g) => ({ ...g, items: navForRole(g.items, role) }))
    .filter((g) => g.items.length > 0);
}

export function isActiveRoute(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  if (href === "/orders") return pathname.startsWith("/orders") && !pathname.startsWith("/orders/unclassified");
  if (href === "/agency") return pathname === "/agency";
  if (href === "/logistics") return pathname.startsWith("/logistics") && !pathname.startsWith("/logistics/scripts");
  if (href === "/internal") return pathname === "/internal";
  if (href === "/vat") return pathname.startsWith("/vat");
  if (href === "/customers") return pathname.startsWith("/customers");
  return pathname.startsWith(href);
}

/** 当前页面在哪个分组里（打开页面时这一组自动展开） */
export function groupKeyOf(pathname: string): string | null {
  const key = NAV_GROUPS.find((g) => g.items.some((i) => isActiveRoute(pathname, i.href)))?.key;
  if (key) return key;
  // 不在菜单里、从「内部管理」「机构管理」页点进去的页面（工资单、工厂）
  if (pathname.startsWith("/internal/")) return "internal";
  if (pathname.startsWith("/agency/")) return "agency";
  return null;
}
