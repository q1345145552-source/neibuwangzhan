import { useEffect } from "react";

/** 弹框里有还没交给客户的初始密码时，刷新、关网页前浏览器先问一句（2026-10-26，Codex：只拦弹框自己的关闭不够） */
export function useLeaveGuard(active: boolean) {
  useEffect(() => {
    if (!active) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [active]);
}
