// Step templates per subtype
export const WHT_STEPS: Record<string, { name: string; assignee: string; optional?: boolean }[]> = {
  "ภ.ง.ด.1": [
    { name: "收集员工名单和工资信息", assignee: "Eve" },
    { name: "登录客户系统填表申报", assignee: "Eve" },
    { name: "员工工资超过26000需缴税", assignee: "Pop", optional: true },
    { name: "等待回执", assignee: "" },
    { name: "开具发票", assignee: "Pop" },
    { name: "归档", assignee: "Eve" },
  ],
  "ภ.ง.ด.53": [
    { name: "收集发票和收款方公司信息", assignee: "Eve" },
    { name: "登录客户系统填表申报", assignee: "Eve" },
    { name: "客户缴税", assignee: "Pop" },
    { name: "开具50ทวิ证明给收款方", assignee: "Eve" },
    { name: "等待回执", assignee: "" },
    { name: "开具发票", assignee: "Pop" },
    { name: "归档", assignee: "Eve" },
  ],
};

export const WHT_SUBTYPES = Object.keys(WHT_STEPS);

