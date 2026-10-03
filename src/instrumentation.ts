/** Next.js 每个服务实例启动时执行；Edge 与生产构建阶段不加载 SQLite/worker。 */
export async function register() {
  // 保持独立的正向 runtime 分支，让 Edge 编译剔除 Node/SQLite 依赖。
  if (process.env.NEXT_RUNTIME === "nodejs") {
    if (process.env.NEXT_PHASE === "phase-production-build") return;
    const { ensureProgressWorker } = await import("./lib/progress-sync");
    ensureProgressWorker();
  }
}
