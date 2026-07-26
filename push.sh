#!/bin/bash
set -e
cd "$(dirname "$0")"

MSG="${1:-优化更新}"

# ── 服务器凭据：从环境变量读，不写在这个文件里 ──
# 这个脚本会提交进 git，写死密码等于把服务器 root 权限公开。
# 在本机 ~/.zshrc（或 ~/.bashrc）里加：
#   export DEPLOY_HOST=187.127.108.58
#   export DEPLOY_USER=root
#   export DEPLOY_PASSWORD='你的密码'
# 更推荐改用 SSH 密钥登录，然后关掉服务器的密码登录。
DEPLOY_HOST="${DEPLOY_HOST:-187.127.108.58}"
DEPLOY_USER="${DEPLOY_USER:-root}"
if [ -z "$DEPLOY_PASSWORD" ]; then
  echo "❌ 未设置 DEPLOY_PASSWORD 环境变量，无法部署。"
  echo "   在 ~/.zshrc 里加一行： export DEPLOY_PASSWORD='服务器密码'"
  echo "   然后执行： source ~/.zshrc"
  echo ""
  echo "   ⚠️ 提醒：这个密码此前明文写在 push.sh 里并已进入 git 历史，"
  echo "      请尽快到服务器上改掉它（passwd），改完再更新这个环境变量。"
  exit 1
fi

echo "📦 正在提交: $MSG"
git add -A
git diff --cached --quiet && echo "⚠️ 没有新改动，跳过提交" && exit 0
git commit -m "$MSG"

echo "🚀 正在推送..."
git push

# ── 部署到服务器 ──
echo ""
echo "📋 部署到服务器..."

# 使用 Python paramiko 部署（更可靠）
# 凭据通过环境变量传给子进程，不经过命令行参数（命令行参数在 ps 里可见）
python3 -c "
import paramiko, sys, time, os

host = os.environ['DEPLOY_HOST']
user = os.environ['DEPLOY_USER']
password = os.environ['DEPLOY_PASSWORD']

# 代码目录和数据目录不是同一个，别混用：
#   CODE = git 检出 + docker-compose.yml + .env
#   DATA = docker-compose 里 '- /data/neibuxitong:/app/data' 挂进去的宿主机目录，
#          data.db 真正在这里（DATA_DIR 会在下面用 docker inspect 自动确认）
CODE = '/var/lib/docker/volumes/neibuxitong_app_data/_data'
DATA = '/data/neibuxitong'

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())

try:
    ssh.connect(host, username=user, password=password, timeout=15)
except Exception as e:
    print(f'❌ SSH 连接失败: {e}')
    sys.exit(1)

def run(cmd, label='', check=False):
    if label: print(f'  {label}...')
    stdin, stdout, stderr = ssh.exec_command(cmd)
    out = stdout.read().decode().strip()
    code = stdout.channel.recv_exit_status()
    err = stderr.read().decode().strip()
    if err and 'WARNING' not in err and 'DEPRECATION' not in err:
        for line in err.split('\n')[:3]:
            if line.strip(): print(f'    ⚠️ {line.strip()[:120]}')
    # check=True 的步骤失败必须中止。以前一律吞掉退出码，
    # 备份失败也只显示一句'备份数据库...'然后继续往下部署。
    if check and code != 0:
        print(f'❌ 步骤失败（退出码 {code}），已中止部署')
        ssh.close(); sys.exit(1)
    return out

# 从 docker inspect 读真实挂载点，避免 DATA 写死后和 compose 改动脱节
mnt = run(\"docker inspect neibuxitong --format '{{range .Mounts}}{{.Source}}:{{.Destination}} {{end}}'\")
for m in mnt.split():
    if m.endswith(':/app/data'):
        DATA = m.rsplit(':', 1)[0]
        break
print(f'  数据目录: {DATA}')
print(f'  代码目录: {CODE}')

print('1. 备份数据库...')
run(f'test -f {DATA}/data.db', check=True)   # 找不到就别往下走了
stamp = run('date +%Y%m%d_%H%M%S')
run(f'cp {DATA}/data.db {DATA}/data.db.bak.{stamp}', check=True)
size = run(f'du -h {DATA}/data.db.bak.{stamp} | cut -f1')
print(f'  ✅ 已备份 data.db.bak.{stamp} ({size})')
run(f'ls -t {DATA}/data.db.bak.* 2>/dev/null | tail -n +11 | xargs -r rm -f')  # 只留最近 10 份

print('2. 拉取最新代码...')
run(f'cd {CODE} && git fetch origin main && git reset --hard origin/main', check=True)

print('3. 清除构建缓存...')
run(f'rm -rf {CODE}/.next {CODE}/node_modules/.cache 2>/dev/null')

print('4. 重建并启动容器...')
# 必须 compose up --force-recreate，不能 docker stop/start：
# stop/start 复用老容器，compose 里的配置改动（env_file、挂载、端口）一概不生效。
run(f'cd {CODE} && docker compose up -d --build --force-recreate', check=True)

print('5. 等待容器就绪...')
for i in range(12):
    time.sleep(5)
    status = run('docker ps --filter name=neibuxitong --format \"{{.Status}}\"')
    if 'Up' in status:
        break
else:
    print('  ❌ 容器未能启动，最近日志：')
    print(run('docker logs neibuxitong --tail 20 2>&1'))
    ssh.close(); sys.exit(1)

# start.sh 会校验密钥，没配好会直接退出——这里确认它真的过了
boot = run('docker logs neibuxitong --tail 40 2>&1')
if 'JWT_SECRET 已配置' not in boot:
    print('  ⚠️ 未看到 JWT_SECRET 校验通过的日志，检查服务器上的 .env')

print('6. 验证服务...')
code = run('python3 -c \"import urllib.request; print(urllib.request.urlopen(\\\"http://localhost:3000/\\\").status)\"')
print(f'  HTTP 状态码: {code}')
if code == '200':
    print('  ✅ 网站正常')
else:
    print(f'  ⚠️ 返回 {code}')

# 数据库自动迁移
print('7. 验证数据库表...')
tables = run(f'sqlite3 {DATA}/data.db \"SELECT name FROM sqlite_master WHERE type=\\\"table\\\" ORDER BY name;\"')
missing = []
for t in ['peer_votes', 'client_feedback', 'feedback_tokens', 'points_records', 'issue_tickets']:
    if t not in tables:
        missing.append(t)
if missing:
    print(f'  ⚠️ 仍然缺少: {missing}')
else:
    print(f'  ✅ 所有关键表存在')

cmd = run('docker logs neibuxitong --tail 5 2>&1')
if 'SQLITE_ERROR' in cmd or 'SyntaxError' in cmd:
    print(f'  ⚠️ 日志有错误: {cmd[-200:]}')
else:
    print(f'  ✅ 日志无错误')

ssh.close()
print()
print('🎉 部署完成！')
print(f'🌐 http://{host}:3000')
" 2>&1

echo ""
echo "✅ 全部完成"
