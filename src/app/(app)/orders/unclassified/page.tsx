"use client";

import { OrdersList } from "@/components/orders-list";

/** 侧栏「待分类（待领取）」：客户站、商城送来还没对上业务线的单（2026-10-15） */
export default function UnclassifiedOrdersPage() {
  return <OrdersList unclassifiedOnly />;
}
