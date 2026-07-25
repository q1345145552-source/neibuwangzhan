"use client";

import { useRef, useCallback } from "react";

/**
 * 防止「慢的旧响应覆盖新数据」。
 *
 * 场景：页面上切换筛选（月份、员工、日期区间…）会各发一个请求。如果先发的那个
 * 后返回，它的 setState 会把新筛选的结果覆盖掉——界面显示的还是上一个筛选的数据。
 *
 * 用法：
 *   const latest = useLatestRequest();
 *   const load = useCallback(async () => {
 *     const run = latest();               // 领一个号
 *     const data = await fetchSomething();
 *     if (!run.isLatest()) return;        // 期间又发起了新请求 → 丢弃这次结果
 *     setData(data);
 *   }, [deps]);
 */
export function useLatestRequest() {
  const seqRef = useRef(0);
  return useCallback(() => {
    const mine = ++seqRef.current;
    return { isLatest: () => seqRef.current === mine };
  }, []);
}
