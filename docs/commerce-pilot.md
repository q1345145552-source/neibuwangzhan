# 2026-09-13 请求恢复与时间修复

售后及下单恢复共用完整原输入租约，迟到响应只结清自己的记录；不明结果保持原编号，损坏记录不静默清除。售后记录只在展示层转曼谷时间。新增回归和本地运行方式见 [commerce-request-recovery.md](/Users/liuyujiang/neibuwangzhan/docs/commerce-request-recovery.md)。原账本/事务/金额/UTC数据规则不变，以下为既有功能说明。

# 当前连续增量：取消与账本

客户 `/shop` 按办理份数申请；管理员 `/commerce` 审批、明确减免/净额收款/实际退款，原成交保留，原办理已取消状态锁定；总费用与成本分开。新 UI 用 `/api/commerce/orders/page`，深链接可查历史购买。隔离预览先做 webpack 构建及独立类型检查再启动，首次等待稍长；校验失败不展示可用服务。当前应收/已退依据 `sale.billing`，不要只看原 `invoice.total_cents/status`。

[本轮说明、验证及源码回退](/Users/liuyujiang/湘泰业务网站/docs/系统合并-取消账单与统一入口-2026-09-13.md)。本轮仍默认关闭且只测合成库。原周期账单执行方不变，退款仅登记实际结果。后文保留前三片的历史操作说明，涉及金额以本段及本轮报告为准。

# 同库商城首片

> 当前第三片：增加泰国商标 1大类1～5小项五规格，与公司注册混合购买、一账单，各份原办理。预览自带两个合成商品；[第三片范围/验证/回退](/Users/liuyujiang/湘泰业务网站/docs/系统合并第三片-商标规格与多业务合单-2026-09-13.md)。下文保留首片和第二片历史说明。

> 2026-09-13 更新：已增加按账号持久购物车、版本冲突、同事务消费与成交权益快照；具体边界见[第二片报告](/Users/liuyujiang/湘泰业务网站/docs/系统合并第二片-商品权益与购物车-2026-09-13.md)。旧单缺权益不回填，四种注册以外的计量/附加费用未开放。下文保留首片范围。

默认不开启；原业务站仍保留。客户 /shop、员工 /commerce，所有新业务数据同在内部 SQLite；不调用旧 Express，同步只是旧站过渡通道。

运行隔离预览：

```sh
node /Users/liuyujiang/neibuwangzhan/scripts/preview-commerce.cjs
```

脚本复制源码到临时目录、随机测试密码、合成客户/员工/商品、只监听本机；不读业务库/.env/生产资料。既有 Node 依赖需已安装。停止后保留临时数据方便复查。--prepare-only 仅准备副本。字体采用离线替代，其余为实际应用逻辑。

关键文件：
- 领域行为：/Users/liuyujiang/neibuwangzhan/src/lib/commerce.ts
- 增量表及精确资料归属：/Users/liuyujiang/neibuwangzhan/src/lib/commerce-schema.ts
- 请求/鉴权封装：/Users/liuyujiang/neibuwangzhan/src/lib/commerce-api.ts
- 客户/管理员 UI：/Users/liuyujiang/neibuwangzhan/src/components/commerce-portal.tsx
- 回归脚本：/Users/liuyujiang/neibuwangzhan/scripts/test-commerce.mts

只接公司注册四个 SKU，不种正式价格。现有 client 登录 ID 绑定购买，客户账号迁移/完整购物车/现货/税务/附加费/订阅/评估/通知/取消退款后续。列表暂取最近 100 笔。原模板是办理核对清单，不自动扩充所购权益或订阅。

首购自动未收款账单，与管理员实际收款分开；重复请求不重建，失败全事务回滚，改价不动历史。客户资料按 ID 授权、员工明确公开，公开步骤使用短名称。商城单旧收入/改价/取消/删除旁路保持阻断，即使试点关闭；成本仍按原币种，不自动换汇。

原订阅自动出账任务本轮完全未改，最终唯一执行方切换另行演练。全仓历史静态债务及真实环境恢复/对账未完成，测试通过不是部署许可。

完整模块清单与四类交付物见[统一报告](/Users/liuyujiang/湘泰业务网站/docs/系统合并迁移清单与首条闭环-2026-09-12.md)。
