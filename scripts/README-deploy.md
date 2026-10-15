# 部署脚本说明

两个一键部署脚本，功能对等，选一个用就行。**任何一步失败立即停止**，不会带着半成品继续跑。

| 文件 | 认证方式 | 适用环境 |
|---|---|---|
| `deploy.sh` | `sshpass` | 普通 Mac / Linux 终端 |
| `deploy.py` | `paramiko` | 沙箱化环境（如 DeepSeek Harness） |

> **怎么选**：如果跑 `sshpass` 报 `Failed to get a pseudo terminal`，说明当前环境不给伪终端（沙箱常见），换 `deploy.py`。

## 用法

```bash
# sshpass 版
SSH_PASS='<服务器密码>' ./scripts/deploy.sh

# paramiko 版（依赖 pip install paramiko）
SSH_PASS='<服务器密码>' python3 scripts/deploy.py
```

密码只从环境变量读取，不落盘、不进 git、不出现在命令行参数里（`sshpass -e`）。
建议命令前加一个空格，避免密码进入 shell 历史。

`deploy.py` 还支持一个被 gitignore 的配置文件 `.deploy.env`（键值对），用来固化主机名/分支等非敏感配置——**不要把密码写进去**。

## 8 个步骤

| 步 | 动作 | 失败后果 |
|---|---|---|
| 1 | `git push`（本地 → origin） | 停止；可用 `SKIP_PUSH=1` 跳过，只跑远端 |
| 2 | `integrity_check` + 记录 **5 张表**行数基线（**停机前只读**） | 停止，不碰容器 |
| 3 | 停容器（只 `stop`，不 `rm`，不动数据卷） | 停止 |
| 4 | 远端 `git pull --ff-only` | 停止 |
| 5 | 复查 `.env` 关键键（**按 key 名匹配**，只打印长度） | 停止，不重建镜像 |
| 6 | 清 `.next` 缓存，**异步**重建镜像并启动 | 停止 |
| 7 | 验证：`/login` 200、错误凭据 401 **+ 响应体**、5 表行数不减、挂载、无 sqlite 报错 | 停止 |
| 8 | 带时间戳备份数据库（`sqlite3 .backup` 在线快照）+ 部署清单 | 停止 |

第 2/7 步的 5 张表：`employees`、`orders`、`issue_tickets`、`attendance`、`leave_requests`——逐张比对，任何一张减少立刻停止。

第 7 步的 401 检查用的是**不存在的邮箱**（`__deploy_check__@invalid.local`），不会触碰任何真实账号，也就不会因为连续失败 5 次触发 15 分钟锁定。同时校验响应体确实是 `邮箱或密码错误` JSON——光有 401 也可能是网关/代理拦下来的，那不算验证通过。

第 6 步刻意**异步构建**：全量 `build --no-cache` 可能十几分钟，同步等容易被 SSH/客户端超时拖断，而且构建失败时连接一断就看不到真正的报错。现在改成后台写日志 + 轮询 `Built`/`failed to solve` 标记。

## 可调环境变量

| 变量 | 默认值 |
|---|---|
| `SSH_HOST` / `SSH_PORT` / `SSH_USER` | `187.127.108.58` / `22` / `root` |
| `APP_DIR` | `/opt/projects/neibuxitong` |
| `DATA_DIR` | `/data/neibuxitong` |
| `DB_FILE` | `$DATA_DIR/data.db` |
| `CONTAINER` / `SVC` | `neibuxitong` / `neibuxitong` |
| `BRANCH` | `main` |
| `HEALTH_TIMEOUT` | `90`（秒） |
| `SKIP_PUSH` / `SKIP_BACKUP` | `0`（设 `1` 跳过） |

## 改脚本前必读：生产环境实测结论（2026-10-15）

这几条都是**在真实服务器上踩出来的**，新环境若不同需要重新确认：

1. **容器里没有 `curl`，也没有 `python3`**，只有 `node`(v22) 和 `wget`。
   所以健康检查走**宿主机 curl** 打已发布的 `127.0.0.1:3000`；
   `docker exec <容器> curl ...` 会报 `executable file not found in $PATH`，拿不到状态码。
2. **宿主机没有 `node`**，但有 `python3` 和 `sqlite3`。
   所以只读查询优先 `python3`，回退 `sqlite3`；不能指望在宿主机跑 `scripts/backup-source.cjs`。
3. **容器内 `.env` 没设 `DB_PATH`**，数据库真实路径是 `/app/data/data.db`。
   直接跑 `scripts/backup-source.cjs` 会去找 `/app/data.db` 并报
   `DB_SOURCE_MISSING`，必须显式传 `docker exec -e DB_PATH=/app/data/data.db`。
   注意宿主机是 `/data/neibuxitong/data.db` → 容器内 `/app/data/data.db`（拼接时别丢掉那个 `/`）。
4. **`docker inspect -f` 的 Go 模板里不能放 `{"\n"}`**，会 `template parsing error`。
   用简单模板 + `|` 当分隔符，或在本地解析 `docker inspect` 的 JSON。
5. **`.env` 一律按 key 名检查，不要按行号**。
   曾经误以为行号检查"当前就已经取错了"——那是拿**自己构造的模拟 `.env`**测出来的错误结论。
   2026-10-16 对**真实** `.env` 复核：文件共 14 行，第 11-13 行恰好就是
   `SYNC_SECRET` / `CUSTOMER_SYNC_URL` / `COMMERCE_PILOT_ENABLED`，`ASSET_SECRET` 在第 14 行，
   所以行号检查当时是"对的"。但它**依赖文件行数不变**：开头加一行注释就整体错位，
   要么误报挡住部署，要么放行没被检查的配置。按 key 名匹配没有这个隐患，所以仍改掉。
6. **bash 3.2（macOS 自带）下 `case "$v" in *[!0-9]*)` 不匹配空串**。
   如果拿它校验「是否纯数字」，空字段会**漏过校验**掉进算术比较，报
   `integer expression expected`。判数字一律用脚本里的 `is_uint()`；判 5 段数字用
   `is_uint_counts()`（按字段索引逐个判，不能用 `tr '|' ' '` 后词分割——那会把空字段直接吞掉）。
7. **解析远端 commit 不能用「取输出最后一行」**。`git fetch` 的进度行
   （`* branch main -> FETCH_HEAD`）走 **stderr**，而封装函数把 stderr 追加在 stdout 之后，
   于是「最后一行」取到的是进度行而不是 SHA —— 2026-10-16 实际发生，备份清单里的
   `远端 git commit` 被写成了 `* branch main -> FETCH_HEAD`。改用唯一标记
   `REMOTE_COMMIT=<sha>` 正则提取。（已更正该次清单，并在备份里留了 `.bak` 副本。）
8. **判断异步构建是否完成，读退出码比 grep 日志标记可靠**。`docker compose build` 在
   buildkit 与 classic builder 下的成功输出不同（`writing image sha256:...` vs
   `Successfully built ...`），grep 标记容易误判超时。现在让后台任务把 `$?` 写进 `.exit`
   文件、轮询读退出码，与构建器无关。

## 备份产物

```
/data/neibuxitong/backups/<时间戳>/
├── data.db                 # 在线一致性快照（sqlite3 .backup；容器内策略脚本可用时优先它）
├── env.copy                # 当次 .env 副本
├── DEPLOY-MANIFEST.txt     # 时间、commit、镜像、5 表行数前后、健康检查结果
└── git-commit.txt          # 部署后的完整 commit SHA
```

数据盘上还保留着历史 `backups/data_YYYYMMDD_HHMMSS.db`（`scripts/backup.sh` 产生的既有约定），本脚本不覆盖它们。

## 相关文件

- `docker-compose.yml` **只存在于服务器** `/opt/projects/neibuxitong/`，仓库里没有；容器名 `neibuxitong`，镜像 `neibuxitong-neibuxitong`。
- `.env` 也不在仓库里（`.gitignore` 忽略），首次部署参考 `.env.example`。
- 同一台服务器还跑着 `shuiwuxitong`、`zijianzhan`、`postiz-*` 等容器，本脚本只动 `neibuxitong`。
