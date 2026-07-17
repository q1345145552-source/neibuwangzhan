export const businessLines = [
  { route: "/company-registration", label: "公司注册", key: "公司注册" },
  { route: "/social-security", label: "社保开户", key: "社保开户" },
  { route: "/trademark", label: "商标", key: "商标" },
  { route: "/fda-certification", label: "FDA认证", key: "FDA产品认证" },
  { route: "/tisi", label: "TISI", key: "TISI" },
  { route: "/dld", label: "DLD", key: "DLD" },
  { route: "/customs-clearance", label: "清关", key: "清关" },
  { route: "/address-certification", label: "地址认证", key: "地址认证" },
  { route: "/mall-store", label: "Mall开店", key: "Mall开店" },
] as const;

export type BusinessLineKey = (typeof businessLines)[number]["key"];

export function getBusinessLineByKey(key: string) {
  return businessLines.find((b) => b.key === key);
}

export function getBusinessLineByRoute(route: string) {
  return businessLines.find((b) => b.route === route);
}
