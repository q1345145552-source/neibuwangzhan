# 商城请求恢复回归

共享边界：`/Users/liuyujiang/neibuwangzhan/src/lib/commerce-pending-request.ts`。发送前持久化完整原请求；已有未决请求必须复用；仅匹配原始serialized才删除。售后与checkout调用同一模块；生命周期与单次锁另行保护UI。异常存储不发新请求、不自动清除。数据库UTC不动，售后展示调用现有toThaiTime。

## 无服务器测试（仅内存夹具）

已有项目依赖用于测试，不自动安装。tsx使用当前客户项目的既有loader：

```sh
cd /Users/liuyujiang/neibuwangzhan
INTERNAL_SOURCE_ROOT="$PWD" node --import /Users/liuyujiang/湘泰业务网站/node_modules/tsx/dist/loader.mjs /Users/liuyujiang/neibuwangzhan/scripts/test-commerce-pending.mts
INTERNAL_SOURCE_ROOT="$PWD" node /Users/liuyujiang/neibuwangzhan/scripts/test-commerce-time.cjs
```

预期10/10组与120/120断言，exit0。时间脚本贯穿最小内存schema、真实ledger、NextResponse和React SSR，不是已鉴权的HTTP或真实浏览器。`MERGE_EVIDENCE`可指定结果目录。

## 完整浏览器回归

先运行既有隔离预览（复制源码/生成合成库/随机测试密码，不在业务库启动）：

```sh
node /Users/liuyujiang/neibuwangzhan/scripts/preview-commerce.cjs
```

使用该进程输出的副本目录、loopback URL与随机密码设置 `INTERNAL_SOURCE_ROOT`、`MERGE_URL`、`MERGE_PASSWORD`，设置 `MERGE_CUSTOMER_EMAIL=customer@example.test`、`MERGE_ADMIN_EMAIL=admin@example.test`；`MERGE_BROWSER_OUT`指定新的证据目录。测试要求COM-001在售，且仅使用合成账号；每次生成随机销售单。Playwright/Chromium使用现有依赖或可选`PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`。

```sh
node /Users/liuyujiang/neibuwangzhan/scripts/test-commerce-recovery-ui.cjs
node /Users/liuyujiang/neibuwangzhan/scripts/test-commerce-checkout-recovery-ui.cjs
```

第一项拦截的是实际后端回包的交付（暂停/丢失），不伪造业务成功：两条迟到200/真实409链，共16检查。第二项6检查含损坏记录、明确禁止新POST、真实提交丢回复、同编号重试及随后新购。每个脚本均exit0才通过；输出目录应分开。不要与旧38链共用同一批测试库，旧脚本有唯一账单标签假设。

本轮精确已执行命令、输入/输出、红绿同SHA记录见 [/Users/liuyujiang/.codex/visualizations/2026/09/13/01a09976-0ebe-7332-b6c2-00be4a981a95/aftercare-source-fix-20260913-160030/verification.json](/Users/liuyujiang/.codex/visualizations/2026/09/13/01a09976-0ebe-7332-b6c2-00be4a981a95/aftercare-source-fix-20260913-160030/verification.json)，没有将示例命令当作执行结果。独立受控fetch矩阵另存外部证据，不与完整HTTP检查混计。
