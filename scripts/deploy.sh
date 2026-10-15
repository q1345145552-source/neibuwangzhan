#!/usr/bin/env bash
#
# 湘泰内部管理系统 —— 一键部署（sshpass 版）
#
# 用法:
#   SSH_PASS='<服务器密码>' ./scripts/deploy.sh
#
# 可选环境变量（都有默认值）:
#   SSH_HOST=187.127.108.58     服务器地址
#   SSH_PORT=22                 SSH 端口
#   SSH_USER=root               SSH 用户
#   APP_DIR=/opt/projects/neibuxitong   远端项目目录
#   DATA_DIR=/data/neibuxitong  远端数据目录（挂载到容器的 /app/data）
#   DB_FILE=$DATA_DIR/data.db   数据库文件
#   CONTAINER=neibuxitong       容器名
#   SVC=neibuxitong             compose 服务名
#   BRANCH=main                 要部署的分支
#   HEALTH_TIMEOUT=90           等待 /login 返回 200 的最大秒数
#   SKIP_PUSH=1                 跳过第 1 步 git push（临时用）
#   SKIP_BACKUP=1               跳过第 8 步备份（不推荐）
#
# 8 个步骤（任何一步失败立即停止，不会带着半成品继续跑）:
#   1. git push（本地）
#   2. integrity_check —— 停机前先确认数据库可读，并记录 5 张表的行数基线
#   3. 停容器（只 stop，不 rm，不动数据卷）
#   4. git pull（远端）
#   5. 复查 .env 关键键（按 key 名匹配，只打印长度）
#   6. 清 .next 缓存，异步重建镜像并启动（避免长构建把 SSH 连接拖断）
#   7. 验证：/login 200、错误凭据 401（含响应体）、5 表行数不减、挂载正确、日志无 sqlite 报错
#   8. 带时间戳备份数据库（sqlite3 .backup 在线快照）+ 部署清单
#
# 说明：密码只从环境变量读取，不写入任何文件、不进 git。
#      -e 传参避免密码出现在进程命令行里。建议前面加空格，避免进 shell 历史。
#
# 普通终端用本脚本；沙箱化的 Harness（sshpass 报 "Failed to get a pseudo terminal"）用 deploy.py。
#
# 已在真实服务器（2026-10-15）上验证过的环境事实，改脚本前先看这里：
#   * 生产容器里 **没有 curl、没有 python3**（只有 node v22 和 wget）→ 健康检查一律走宿主机 curl，
#     不能用 `docker exec ... curl`，否则永远拿不到状态码。
#   * 宿主机 **没有 node**，但有 python3 和 sqlite3 → 只读查询优先 python3、回退 sqlite3。
#   * 容器内 .env 未设 DB_PATH，数据库真实路径是 /app/data/data.db；
#     直接跑 scripts/backup-source.cjs 会去找 /app/data.db 并报 DB_SOURCE_MISSING，
#     必须显式传 -e DB_PATH=/app/data/data.db。
#   * `docker inspect -f` 的 Go 模板里带 `{"\n"}` 会解析失败 → 简单模板可用，但不能带转义换行。
#   * .env 检查**绝不能按行号**（早期版本用 awk 'NR>=11 && NR<=13'，在真实 .env 上就取错了键，
#     只因为恰好都有值才没暴露）→ 一律按 key 名匹配。

set -euo pipefail

SSH_HOST="${SSH_HOST:-187.127.108.58}"
SSH_PORT="${SSH_PORT:-22}"
SSH_USER="${SSH_USER:-root}"
APP_DIR="${APP_DIR:-/opt/projects/neibuxitong}"
DATA_DIR="${DATA_DIR:-/data/neibuxitong}"
DB_FILE="${DB_FILE:-$DATA_DIR/data.db}"
CONTAINER="${CONTAINER:-neibuxitong}"
SVC="${SVC:-neibuxitong}"
BRANCH="${BRANCH:-main}"
HEALTH_TIMEOUT="${HEALTH_TIMEOUT:-90}"
SKIP_PUSH="${SKIP_PUSH:-0}"
SKIP_BACKUP="${SKIP_BACKUP:-0}"

if [ -z "${SSH_PASS:-}" ]; then
  echo "[X] 缺少环境变量 SSH_PASS" >&2
  echo "    用法: SSH_PASS='<服务器密码>' $0" >&2
  exit 2
fi

command -v sshpass >/dev/null 2>&1 || {
  echo "[X] 未找到 sshpass。macOS 安装： brew install hudochenkov/sshpass/sshpass" >&2
  echo "    或用 paramiko 版： SSH_PASS='...' python3 $APP_DIR/scripts/deploy.py" >&2
  exit 2
}

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_DIR"

# 每条远端命令都强制 bash + ERR 陷阱，保证链式命令中间失败也会立刻中止。
REMOTE_PROLOGUE="set -Eeuo pipefail; trap 'echo \"[远端失败] line \$LINENO: \$BASH_COMMAND\" >&2; exit 1' ERR;"

ssh_exec() {
  SSHPASS="$SSH_PASS" sshpass -e ssh \
    -o StrictHostKeyChecking=accept-new \
    -o ConnectTimeout=15 \
    -o ServerAliveInterval=15 \
    -p "$SSH_PORT" "$SSH_USER@$SSH_HOST" "$REMOTE_PROLOGUE $1"
}

# 把本地 stdin（base64）落到远端文件，避免一切引号/换行转义问题。
ssh_put_base64() { # $1=远端绝对路径
  ssh_exec "base64 -d > '$1'"
}

step() { echo; echo "=============== [$1/8] $2 ==============="; }
ok()   { echo "[OK] $1"; }
die()  { echo "[X] $1" >&2; exit 1; }

# 非负整数校验。
# 注意：**不能**用 `case "$v" in *[!0-9]*) ...` 判非数字——在 bash 3.2（macOS 自带）
# 下空串不匹配 `*[!0-9]*`，会漏过校验，掉进算术比较报 "integer expression expected"。
is_uint() {
  [ -n "$1" ] || return 1
  case "$1" in *[!0-9]*) return 1 ;; esac
  return 0
}

# 5 段「数字|数字|数字|数字|数字」格式校验。
# 必须按索引逐字段取值校验：用 `tr '|' ' '` 再词分割会把空字段直接吞掉
# （"15|110|101|646|" 和 "|110|..." 都会漏检），`case` 正则同样漏（见 is_uint 注释）。
is_uint_counts() {
  local i v
  [ "$(printf '%s' "$1" | awk -F'|' '{print NF}')" = "5" ] || return 1
  i=1
  while [ "$i" -le 5 ]; do
    v="$(printf '%s' "$1" | cut -d'|' -f"$i")"
    is_uint "$v" || return 1
    i=$((i + 1))
  done
  return 0
}

# ── 数据行数基线：5 张核心表，维度比只看 orders 更全 ──────────────────────
COUNT_LABELS="employees orders issue_tickets attendance leave_requests"
COUNT_SQL="SELECT (SELECT COUNT(*) FROM employees),(SELECT COUNT(*) FROM orders),(SELECT COUNT(*) FROM issue_tickets),(SELECT COUNT(*) FROM attendance),(SELECT COUNT(*) FROM leave_requests);"

counts_now() { ssh_exec "export CSQL=\"$COUNT_SQL\"; if command -v sqlite3 >/dev/null 2>&1; then sqlite3 \"$DB_FILE\" \"\$CSQL\"; else exit 1; fi"; }

# 逐张表比对；少了就死。字符串比较避免算术展开被注入/畸形值打崩。
counts_guard() { # $1=部署前 $2=部署后
  local i=1 b a label
  for label in $COUNT_LABELS; do
    b="$(printf '%s' "$1" | cut -d'|' -f"$i")"
    a="$(printf '%s' "$2" | cut -d'|' -f"$i")"
    is_uint "$b" && is_uint "$a" \
      || die "行数与预期不符：$label 部署前='$b' 部署后='$a'（期望各 5 个纯数字）"
    [ "$a" -ge "$b" ] || die "$label 行数减少：$b -> $a，立刻停手排查，别继续写数据"
    i=$((i + 1))
  done
}

# SQLite 日志检查：只认真正的错误关键词。
# 早期版本用宽松的 `grep -i sqlite`，一旦某条正常日志提到 sqlite 就会误判为失败。
sqlite_error_count() {
  ssh_exec "docker logs --tail 400 '$CONTAINER' 2>&1 | grep -icE 'sqlite error|SQLITE_ERROR|database is locked|malformed' || true" \
    | tr -dc '0-9'
}

ORDER_COUNT_BEFORE=""
ORDER_COUNT_AFTER=""
COUNTS_BEFORE=""
COUNTS_AFTER=""
SQLITE_ERR="0"
IMAGE_BEFORE="-"
IMAGE_NAME_BEFORE="-"
CONTAINER_STATUS="unknown"
RESTART_COUNT="0"
STATUS_OUT=""
LOGIN_CODE="000"
AUTH_CODE="000"
GIT_COMMIT=""
RUN_ID=""

# ─────────────────────────────────────────────────────────────
# 1) git push
# ─────────────────────────────────────────────────────────────
step 1 "git push（本地 -> origin/$BRANCH）"
if [ "$SKIP_PUSH" = "1" ]; then
  echo "（SKIP_PUSH=1，跳过）"
else
  if [ -n "$(git status --porcelain)" ]; then
    echo "警告：工作区有未提交改动，这些改动不会被部署："
    git status --short
  fi
  git push origin "$BRANCH"
  ok "已推送 origin/$BRANCH"
fi
LOCAL_HEAD="$(git rev-parse --short HEAD)"
echo "本地 HEAD: $LOCAL_HEAD"

# ─────────────────────────────────────────────────────────────
# 2) integrity_check（停机前只读检查）
# ─────────────────────────────────────────────────────────────
step 2 "integrity_check（停机前只读检查数据库）"
DB_QUERY='export DB_FILE="'"$DB_FILE"'"; if command -v python3 >/dev/null 2>&1; then python3 - <<'"'"'PY'"'"'
import hashlib, os, sqlite3, sys
p = os.environ["DB_FILE"]
if not os.path.exists(p):
    print("exists 0"); sys.exit(0)
print("exists 1")
print("size %d" % os.path.getsize(p))
print("md5 " + hashlib.md5(open(p, "rb").read()).hexdigest())
con = sqlite3.connect("file:" + p + "?mode=ro", uri=True)
print("quick_check " + str(con.execute("PRAGMA quick_check").fetchone()[0]))
print("orders %d" % con.execute("SELECT COUNT(*) FROM orders").fetchone()[0])
con.close()
PY
elif command -v sqlite3 >/dev/null 2>&1; then
  [ -f "$DB_FILE" ] || { echo "exists 0"; exit 0; }
  echo "exists 1"
  echo "size $(wc -c < "$DB_FILE" | tr -d " ")"
  echo "md5 $(md5sum "$DB_FILE" | cut -d" " -f1)"
  echo "quick_check $(sqlite3 "file:$DB_FILE?mode=ro" "PRAGMA quick_check;")"
  echo "orders $(sqlite3 "file:$DB_FILE?mode=ro" "SELECT COUNT(*) FROM orders;")"
else
  echo "同一个服务器上 python3 和 sqlite3 都没有，无法校验，停手" >&2
  exit 1
fi'
PRE_OUT="$(ssh_exec "$DB_QUERY")" || die "integrity_check 执行失败"
printf '%s\n' "$PRE_OUT"
case "$PRE_OUT" in
  *"exists 0"*) die "数据库文件不存在：$DB_FILE" ;;
esac
DB_CHECK="$(printf '%s\n' "$PRE_OUT" | awk '$1=="quick_check"{print $2}')"
[ "$DB_CHECK" = "ok" ] || die "数据库完整性检查未通过：$DB_CHECK"
ORDER_COUNT_BEFORE="$(printf '%s\n' "$PRE_OUT" | awk '$1=="orders"{print $2}')"
is_uint "$ORDER_COUNT_BEFORE" || die "拿不到订单行数：'$ORDER_COUNT_BEFORE'"
ok "数据库可读，orders = $ORDER_COUNT_BEFORE 行（停机前基线）"

# 5 张核心表的行数基线（比只看 orders 更能发现数据丢失）
COUNTS_BEFORE="$(counts_now)" || die "拿不到部署前数据行数"
is_uint_counts "$COUNTS_BEFORE" || die "部署前行数格式异常：'$COUNTS_BEFORE'"
echo "  部署前行数: $COUNTS_BEFORE   （$COUNT_LABELS）"

# docker inspect：简单 Go 模板可用，但**不能**在模板里放 "\n"（会 template parsing error）。
# 所以用 `|` 当分隔符，一次取回后在本地切分。
INSPECT_OUT="$(ssh_exec "docker inspect -f 'image={{.Config.Image}}|digest={{.Image}}|status={{.State.Status}}|restarts={{.RestartCount}}|mounts={{range .Mounts}}{{.Source}} -> {{.Destination}}|{{end}}' '$CONTAINER'")" \
  || die "docker inspect 失败"
inspect_val() { printf '%s' "$INSPECT_OUT" | sed -n "s/.*$1=\([^|]*\)|.*/\1/p"; }
IMAGE_NAME_BEFORE="$(inspect_val image)";   [ -n "$IMAGE_NAME_BEFORE" ] || IMAGE_NAME_BEFORE="-"
case "$IMAGE_NAME_BEFORE" in
  *:*) ;;                                     # 已带 tag
  -)   ;;
  *)   IMAGE_NAME_BEFORE="$IMAGE_NAME_BEFORE:latest" ;;  # .Config.Image 会省略默认 tag
esac
IMAGE_BEFORE="$(inspect_val digest)";       [ -n "$IMAGE_BEFORE" ] || IMAGE_BEFORE="-"
CONTAINER_STATUS="$(inspect_val status)";   [ -n "$CONTAINER_STATUS" ] || CONTAINER_STATUS="unknown"
RESTART_COUNT="$(inspect_val restarts)";    [ -n "$RESTART_COUNT" ] || RESTART_COUNT="0"

# ─────────────────────────────────────────────────────────────
# 3) 停容器
# ─────────────────────────────────────────────────────────────
step 3 "停容器（只 stop，不 rm，不动数据卷）"
ssh_exec "docker stop '$CONTAINER' >/dev/null 2>&1 || true; echo stopped" >/dev/null
ok "容器 $CONTAINER 已停止"

# ─────────────────────────────────────────────────────────────
# 4) git pull
# ─────────────────────────────────────────────────────────────
step 4 "git pull（远端 $APP_DIR）"
GIT_COMMIT="$(ssh_exec "cd '$APP_DIR' && git fetch origin '$BRANCH' >/dev/null && git checkout '$BRANCH' >/dev/null && git pull --ff-only origin '$BRANCH' && git rev-parse --short HEAD")" \
  || die "远端 git pull 失败"
ok "远端已更新到 $GIT_COMMIT"
if [ "$GIT_COMMIT" != "$LOCAL_HEAD" ] && [ "$SKIP_PUSH" != "1" ]; then
  echo "警告：远端 HEAD ($GIT_COMMIT) 与本地 HEAD ($LOCAL_HEAD) 不一致"
fi

# ─────────────────────────────────────────────────────────────
# 5) 复查 .env（只打印长度）
# ─────────────────────────────────────────────────────────────
step 5 "复查 .env 关键键（只输出长度）"
ENV_OUT="$(ssh_exec "cd '$APP_DIR' && [ -s .env ] && python3 - <<'PY'
import os
keys = ['JWT_SECRET', 'CRON_SECRET', 'CORS_ORIGINS', 'SYNC_SECRET',
        'CUSTOMER_SYNC_URL', 'COMMERCE_PILOT_ENABLED', 'ASSET_SECRET']
for raw in open('.env', encoding='utf-8', errors='replace').read().splitlines():
    s = raw.strip()
    if not s or s.startswith('#') or '=' not in s:
        continue
    k, v = s.split('=', 1)
    k = k.strip()
    if k in keys:
        print('  %-24s 长度=%d' % (k, len(v.strip().strip(chr(34)).strip(chr(39)))))
" )" || die ".env 不存在或读取失败"
echo "$ENV_OUT"
for k in JWT_SECRET CRON_SECRET; do
  printf '%s\n' "$ENV_OUT" | grep -q "$k" \
    || die ".env 缺少必填键 $k（参考 .env.example，缺了 start.sh 会拒绝启动）"
done
ok ".env 存在且必填键齐全（值未打印）"

# ─────────────────────────────────────────────────────────────
# 6) 清缓存重建镜像并启动
# ─────────────────────────────────────────────────────────────
step 6 "清 .next 缓存，异步重建镜像并启动（这一步比较慢）"
BUILD_LOG=/tmp/neibuxitong-deploy-build.log
# 刻意异步：全量构建可能十几分钟，同步等容易被 SSH/客户端超时拖断，
# 而且构建失败时连接一断就看不到真正的报错。这里改成后台跑 + 轮询日志。
ssh_exec "cd '$APP_DIR' && rm -rf .next && rm -f '$BUILD_LOG' && (nohup docker compose build --no-cache '$SVC' > '$BUILD_LOG' 2>&1 < /dev/null &) && echo BUILD_STARTED" >/dev/null
echo "  构建已在后台启动，日志 $BUILD_LOG，轮询中..."
deadline=$((SECONDS + 1800))
BUILT=0
BUILD_FAILED=0
sleep 20   # 给构建一点时间落盘日志（docker 挂 buildkit 时日志会晚几秒出现）
while [ "$SECONDS" -lt "$deadline" ]; do
  MARK="$(ssh_exec "if grep -qE 'Built|writing image|naming to' '$BUILD_LOG' 2>/dev/null; then echo DONE; elif grep -qiE 'failed to solve|^ERROR|error:' '$BUILD_LOG' 2>/dev/null; then echo FAIL; elif [ -f '$BUILD_LOG' ]; then echo RUNNING; else echo NOLOG; fi" || echo SSHFAIL)"
  case "$MARK" in
    DONE)    BUILT=1; break ;;
    FAIL)    BUILD_FAILED=1; break ;;
    SSHFAIL) echo "  SSH 抖动，继续轮询..." ;;
    *)       printf '.' ;;
  esac
  sleep 15
done
echo
if [ "$BUILD_FAILED" = "1" ]; then
  ssh_exec "tail -30 '$BUILD_LOG' 2>/dev/null" || true
  die "镜像构建失败（详见上方日志）"
fi
[ "$BUILT" = "1" ] || { ssh_exec "tail -30 '$BUILD_LOG' 2>/dev/null" || true; die "镜像构建超时（1800s）或未出现完成标记"; }
ok "镜像构建完成"
ssh_exec "cd '$APP_DIR' && docker compose up -d '$SVC' && docker image prune -f >/dev/null" \
  || die "容器启动失败，请上去看 docker compose logs"
ok "容器已启动"

# ─────────────────────────────────────────────────────────────
# 7) 验证
# ─────────────────────────────────────────────────────────────
step 7 "验证（健康检查）"
# 生产容器里没有 curl（只有 node/wget），所以健康检查必须走宿主机 curl 打已发布的 3000 端口。
# 容器内 `docker exec ... curl` 在 2026-10-15 实测会报 "executable file not found"。
command -v curl >/dev/null 2>&1 || die "本机没有 curl，无法做健康检查"
css() { # 宿主机取状态码
  ssh_exec "curl -s -o /dev/null -w '%{http_code}' --max-time 15 '$1' || echo 000" | sed -n 's/.*\b[0-9][0-9][0-9]\b.*/&/p' | grep -oE '[0-9]{3}' | tail -1
}

echo "等待 /login 返回 200（最多 ${HEALTH_TIMEOUT}s）..."
deadline=$((SECONDS + HEALTH_TIMEOUT))
LOGIN_CODE=000
while [ "$SECONDS" -lt "$deadline" ]; do
  LOGIN_CODE="$(css http://127.0.0.1:3000/login)"
  case "$LOGIN_CODE" in ''|*[!0-9]*) LOGIN_CODE=000 ;; esac
  [ "$LOGIN_CODE" = "200" ] && break
  sleep 3
done
[ "$LOGIN_CODE" = "200" ] || die "/login 未返回 200（当前 $LOGIN_CODE），看 docker logs $CONTAINER"
ok "/login = 200 （宿主机 curl，容器里没有 curl）"

# 用不存在的邮箱测 401：绝不碰真实账号，避免连续失败 5 次触发 15 分钟锁定
# 同时校验响应体确实是那个 JSON 错误（光有 401 也可能是网关/代理拦下来的）
AUTH_BODY=/tmp/neibuxitong-deploy-auth.json
AUTH_CODE="$(ssh_exec "curl -s -o '$AUTH_BODY' -w '%{http_code}' --max-time 15 -X POST http://127.0.0.1:3000/api/auth/login -H 'Content-Type: application/json' --data '{\"email\":\"__deploy_check__@invalid.local\",\"password\":\"__not_a_real_password__\"}' || echo 000")"
AUTH_CODE="$(printf '%s' "$AUTH_CODE" | grep -oE '[0-9]{3}' | tail -1)"
[ "$AUTH_CODE" = "401" ] || die "错误凭据登录本应 401，实际 ${AUTH_CODE:-无输出}"
ssh_exec "grep -q '邮箱或密码错误' '$AUTH_BODY' && rm -f '$AUTH_BODY'" \
  || die "登录接口返回 401 但响应体不是预期的「邮箱或密码错误」JSON，可能不是应用本身在应答"
ok "错误凭据登录 = 401，响应体 JSON 正常（未触碰任何真实账号）"

POST_OUT="$(ssh_exec "$DB_QUERY")" || die "部署后数据库复查失败"
printf '%s\n' "$POST_OUT"
DB_CHECK2="$(printf '%s\n' "$POST_OUT" | awk '$1=="quick_check"{print $2}')"
[ "$DB_CHECK2" = "ok" ] || die "部署后数据库完整性检查未通过：$DB_CHECK2"

# 5 表逐张比对：任何一张减少都立刻停手
COUNTS_AFTER="$(counts_now)" || die "拿不到部署后数据行数"
is_uint_counts "$COUNTS_AFTER" || die "部署后行数格式异常：'$COUNTS_AFTER'"
echo "  部署后行数: $COUNTS_AFTER"
counts_guard "$COUNTS_BEFORE" "$COUNTS_AFTER"
ORDER_COUNT_AFTER="$(printf '%s' "$COUNTS_AFTER" | cut -d'|' -f2)"
ok "5 张表行数均未减少（$COUNT_LABELS）"

# 重新 inspect 一次（容器刚重建，部署前的值已经不准了）
INSPECT_OUT="$(ssh_exec "docker inspect -f 'image={{.Config.Image}}|digest={{.Image}}|status={{.State.Status}}|restarts={{.RestartCount}}|mounts={{range .Mounts}}{{.Source}} -> {{.Destination}}|{{end}}' '$CONTAINER'")" \
  || die "读取容器信息失败"
MOUNT_OUT="$(printf '%s' "$INSPECT_OUT" | sed -n 's/.*mounts=\(.*\)|$/\1/p')"
echo "  挂载: $MOUNT_OUT"
printf '%s' "$MOUNT_OUT" | grep -q "$DATA_DIR -> /app/data" \
  || die "挂载不对：期望 $DATA_DIR -> /app/data"
ok "数据挂载正确：$DATA_DIR -> /app/data"

CONTAINER_STATUS="$(printf '%s' "$INSPECT_OUT" | sed -n 's/.*status=\([^|]*\)|.*/\1/p')"
RESTART_COUNT="$(printf '%s' "$INSPECT_OUT" | sed -n 's/.*restarts=\([^|]*\)|.*/\1/p')"
[ -n "$CONTAINER_STATUS" ] || CONTAINER_STATUS="unknown"
[ -n "$RESTART_COUNT" ] || RESTART_COUNT="0"
STATUS_OUT="$CONTAINER_STATUS restarts=$RESTART_COUNT"
echo "  容器状态: $STATUS_OUT"
[ "$CONTAINER_STATUS" = "running" ] || die "容器状态不是 running（$CONTAINER_STATUS），看 docker logs $CONTAINER"

SQLITE_ERR="$(sqlite_error_count)"
if [ "${SQLITE_ERR:-0}" != "0" ]; then
  ssh_exec "docker logs --tail 400 '$CONTAINER' 2>&1 | grep -iE 'sqlite error|SQLITE_ERROR|database is locked|malformed' | tail -10" | sed 's/^/  /'
  die "容器日志里发现 $SQLITE_ERR 处 sqlite 报错，先排查再继续"
fi
ok "日志无 sqlite 报错（精确匹配 sqlite error / SQLITE_ERROR / database is locked / malformed）"

# ─────────────────────────────────────────────────────────────
# 8) 带时间戳备份
# ─────────────────────────────────────────────────────────────
step 8 "带时间戳备份数据库 + 部署清单"
if [ "$SKIP_BACKUP" = "1" ]; then
  echo "（SKIP_BACKUP=1，跳过）"
else
  RUN_ID="$(date +%Y%m%d_%H%M%S)"
  BK="$DATA_DIR/backups/$RUN_ID"
  # 容器内 .env 没设 DB_PATH，策略脚本默认会去找 /app/data.db（不存在）。
  # $DATA_DIR 挂到容器的 /app/data，注意补回被切掉的那个 '/'。
  DB_IN_CONTAINER="/app/data${DB_FILE#"$DATA_DIR"}"
  MANIFEST_FILE="$(mktemp)"
  cat > "$MANIFEST_FILE" <<EOF
湘泰内部管理系统 部署记录
时间(曼谷)        : $(TZ=Asia/Bangkok date '+%Y-%m-%d %H:%M:%S')
时间(本机)        : $(date '+%Y-%m-%d %H:%M:%S %Z')
远端 git commit   : $GIT_COMMIT
本地 git HEAD     : $LOCAL_HEAD
分支              : $BRANCH
镜像标签          : $IMAGE_NAME_BEFORE
镜像 ID（部署前） : $IMAGE_BEFORE
orders 部署前     : $ORDER_COUNT_BEFORE
orders 部署后     : $ORDER_COUNT_AFTER
行数基线（前）    : $COUNTS_BEFORE
行数基线（后）    : $COUNTS_AFTER
行数统计表        : $COUNT_LABELS
数据库完整性      : $DB_CHECK -> $DB_CHECK2
sqlite 报错处数   : $SQLITE_ERR
/login            : $LOGIN_CODE
错误凭据登录      : $AUTH_CODE
容器状态          : $STATUS_OUT
数据库            : $DB_FILE
容器内数据库路径  : $DB_IN_CONTAINER
挂载              : $DATA_DIR -> /app/data
EOF
  ssh_exec "mkdir -p '$BK' && chmod 700 '$BK'" || die "备份目录创建失败：$BK"
  # 用仓库既有的策略脚本做在线快照（它带一致性校验），失败则回退到普通拷贝
  ssh_exec "if docker exec -e DB_PATH='$DB_IN_CONTAINER' '$CONTAINER' node scripts/backup-source.cjs backup '/app/data/data_$RUN_ID.db' >/dev/null 2>&1; then echo POLICY_SNAPSHOT_OK; else echo POLICY_SNAPSHOT_FAILED; fi" \
    | grep -q POLICY_SNAPSHOT_OK \
    || echo "  注意：策略脚本快照失败，改用普通文件拷贝（数据库未处于写入中的话通常没问题）"
  ssh_put_base64 "$BK/DEPLOY-MANIFEST.txt" < "$MANIFEST_FILE" || die "清单写入失败"
  rm -f "$MANIFEST_FILE"
  ssh_exec "if [ -f '$DATA_DIR/data_$RUN_ID.db' ]; then mv '$DATA_DIR/data_$RUN_ID.db' '$BK/data.db'; else cp -a '$DB_FILE' '$BK/data.db'; fi && (cp -a '$APP_DIR/.env' '$BK/env.copy' 2>/dev/null || true) && (cd '$APP_DIR' && git rev-parse HEAD > '$BK/git-commit.txt') && du -sh '$BK' && ls -l '$BK' && md5sum '$DB_FILE' '$BK/data.db'" \
    || die "备份写入失败，请上去手工核对 $BK"
  ok "备份完成：$BK（含 data.db、env.copy、DEPLOY-MANIFEST.txt）"
fi

echo
echo "=============================== 部署完成 ==============================="
echo "  远端 commit : $GIT_COMMIT"
echo "  orders      : $ORDER_COUNT_BEFORE -> $ORDER_COUNT_AFTER"
echo "  /login      : $LOGIN_CODE    错误凭据: $AUTH_CODE"
echo "  容器        : $STATUS_OUT"
[ -n "$RUN_ID" ] && echo "  备份        : $DATA_DIR/backups/$RUN_ID"
echo "======================================================================="
