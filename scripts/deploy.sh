#!/usr/bin/env bash
set -euo pipefail
# ============================================================================
# 湘泰内部管理系统 — 一键安全部署脚本
#
# 用法（密码通过环境变量传入，绝不写死在脚本/仓库里）：
#   SSH_PASS='服务器密码' ./scripts/deploy.sh
#
# 可选环境变量（不传则用默认值）：
#   SSH_HOST   服务器地址     默认 187.127.108.58
#   SSH_USER   登录用户       默认 root
#   REMOTE_DIR 服务器代码目录  默认 /opt/projects/neibuxitong
#   DB_PATH    服务器数据库路径 默认 /data/neibuxitong/data.db
#
# 依赖：本机需安装 sshpass，并已配置好 GitHub push 权限。
#   macOS 安装 sshpass：brew install hudochenkov/sshpass/sshpass
# ============================================================================

SSH_HOST="${SSH_HOST:-187.127.108.58}"
SSH_USER="${SSH_USER:-root}"
SSH_PASS="${SSH_PASS:-}"
REMOTE_DIR="${REMOTE_DIR:-/opt/projects/neibuxitong}"
DB_PATH="${DB_PATH:-/data/neibuxitong/data.db}"

say() { printf '\n========== %s ==========\n' "$*"; }
die() { printf '\n❌ %s\n' "$*" >&2; exit 1; }
ok()  { printf '✅ %s\n' "$*"; }

[[ -n "$SSH_PASS" ]] || die "未设置 SSH_PASS。用法：SSH_PASS='xxx' ./scripts/deploy.sh"
command -v sshpass >/dev/null 2>&1 || die "未安装 sshpass。macOS：brew install hudochenkov/sshpass/sshpass"

remote() {
  sshpass -p "$SSH_PASS" ssh \
    -o StrictHostKeyChecking=accept-new \
    -o ConnectTimeout=15 \
    "$SSH_USER@$SSH_HOST" "$@"
}

# ---------- 步骤 1：本地 git 状态确认 + 推送 ----------
say "步骤 1：本地 git 状态确认 + 推送"
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || die "请在仓库根目录执行本脚本"
if ! git diff-index --quiet HEAD --; then
  git status --short
  die "本地有未提交改动，请先 commit 再部署"
fi
git push git@github.com:q1345145552-source/neibuwangzhan.git main
ok "代码已推送到 GitHub"

# ---------- 步骤 2：数据库完整性 ----------
say "步骤 2：数据库完整性检查"
INTEGRITY="$(remote "sqlite3 $DB_PATH 'PRAGMA integrity_check;'")"
[[ "$INTEGRITY" == "ok" ]] || die "integrity_check 异常：$INTEGRITY"
ok "integrity_check = ok"

# ---------- 部署前记录数据行数（部署后对比，防丢失） ----------
COUNTS_BEFORE="$(remote "sqlite3 $DB_PATH 'SELECT (SELECT COUNT(*) FROM employees),(SELECT COUNT(*) FROM orders),(SELECT COUNT(*) FROM issue_tickets),(SELECT COUNT(*) FROM attendance),(SELECT COUNT(*) FROM leave_requests);'")"
echo "部署前数据行数：$COUNTS_BEFORE"

# ---------- 步骤 3：停止容器（只停不删） ----------
say "步骤 3：停止容器（只停不删）"
remote "docker stop neibuxitong"
ok "容器已停止"

# ---------- 步骤 4：拉取最新代码 ----------
say "步骤 4：拉取最新代码"
remote "cd $REMOTE_DIR && git pull"
ok "代码已更新"

# ---------- 步骤 5：复查 .env 关键配置 ----------
say "步骤 5：复查 .env 关键配置"
ENV_OUT="$(remote "cd $REMOTE_DIR && awk 'NR>=11 && NR<=13 {k=\$0; sub(/=.*/,\"\",k); v=\$0; sub(/^[^=]*=/,\"\",v); print k \"=\" length(v)}' .env && awk '/^ASSET_SECRET=/{v=\$0; sub(/^[^=]*=/,\"\",v); print \"ASSET_SECRET=\" length(v)}' .env")"
echo "$ENV_OUT"
for k in SYNC_SECRET CUSTOMER_SYNC_URL COMMERCE_PILOT_ENABLED ASSET_SECRET; do
  echo "$ENV_OUT" | grep -qE "^$k=[1-9][0-9]*$" || die ".env 关键配置缺失或为空：$k"
done
ok ".env 检查通过（值未输出）"

# ---------- 步骤 6：清理缓存 + 重新构建 ----------
say "步骤 6：清理缓存并重新构建"
remote "cd $REMOTE_DIR && rm -rf .next && (nohup docker compose build > /tmp/deploy_build.log 2>&1 < /dev/null &) && echo BUILD_STARTED" >/dev/null
for _ in $(seq 1 40); do
  if ! remote "pgrep -f 'docker compose build' >/dev/null 2>&1"; then
    break
  fi
  sleep 15
done
remote "tail -4 /tmp/deploy_build.log" | grep -q "Built" || { remote "tail -30 /tmp/deploy_build.log"; die "镜像构建未成功（详见上方日志）"; }
ok "镜像构建完成"

# ---------- 步骤 6.5：启动容器 ----------
say "步骤 6.5：启动容器"
remote "cd $REMOTE_DIR && docker compose up -d"
ok "容器已启动"

# ---------- 步骤 7：验证 ----------
say "步骤 7：验证服务"
sleep 15
LOGIN_CODE="$(remote "curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/login")"
[[ "$LOGIN_CODE" == "200" ]] || die "/login 返回 $LOGIN_CODE，预期 200"
ok "/login = 200"

LOGIN_HTTP="$(remote "curl -s -o /tmp/deploy_login.json -w '%{http_code}' -X POST http://localhost:3000/api/auth/login -H 'Content-Type: application/json' --data-raw '{\"email\":\"deploy-check@test.local\",\"password\":\"wrong123\"}'")"
[[ "$LOGIN_HTTP" == "401" ]] || die "登录接口返回 $LOGIN_HTTP，预期 401"
remote "grep -q '邮箱或密码错误' /tmp/deploy_login.json" || die "登录接口 401 但响应体异常"
ok "登录接口 401 JSON 正常"

COUNTS_AFTER="$(remote "sqlite3 $DB_PATH 'SELECT (SELECT COUNT(*) FROM employees),(SELECT COUNT(*) FROM orders),(SELECT COUNT(*) FROM issue_tickets),(SELECT COUNT(*) FROM attendance),(SELECT COUNT(*) FROM leave_requests);'")"
echo "部署后数据行数：$COUNTS_AFTER"
if [[ "$COUNTS_BEFORE" == "$COUNTS_AFTER" ]]; then
  ok "数据行数一致：$COUNTS_AFTER"
else
  IFS='|' read -r -a B <<< "$COUNTS_BEFORE"
  IFS='|' read -r -a A <<< "$COUNTS_AFTER"
  for i in "${!A[@]}"; do
    (( ${A[$i]} >= ${B[$i]} )) || die "数据行数第 $((i+1)) 项减少：${B[$i]} → ${A[$i]}"
  done
  ok "数据行数无减少：$COUNTS_AFTER（部署前 $COUNTS_BEFORE）"
fi

MOUNT="$(remote "docker inspect neibuxitong --format '{{range .Mounts}}{{.Source}} -> {{.Destination}}{{println}}{{end}}'")"
echo "$MOUNT" | grep -q "/data/neibuxitong -> /app/data" || die "数据库挂载异常：$MOUNT"
ok "数据库挂载正常"

SQLITE_ERR="$(remote "docker logs neibuxitong 2>&1 | grep -icE 'sqlite error|SQLITE_ERROR|database is locked|malformed' || true")"
[[ "$SQLITE_ERR" == "0" ]] || die "日志发现 sqlite 错误 $SQLITE_ERR 处"
ok "日志无 sqlite 报错"

# ---------- 步骤 8：手动备份 ----------
say "步骤 8：手动备份数据库"
TS="$(remote "date +%Y%m%d_%H%M%S")"
remote "sqlite3 $DB_PATH \".backup $DB_PATH.$TS\""
remote "ls -la $DB_PATH.$TS"
ok "备份完成：$DB_PATH.$TS"

say "部署完成 ✅"
