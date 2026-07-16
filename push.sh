#!/bin/bash
set -e
cd "$(dirname "$0")"

MSG="${1:-优化更新}"

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
python3 -c "
import paramiko, sys, time

host = '187.127.108.58'
user = 'root'
password = 'RL2XuiQVsZP/'
vol = '/var/lib/docker/volumes/neibuxitong_app_data/_data'

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())

try:
    ssh.connect(host, username=user, password=password, timeout=15)
except Exception as e:
    print(f'❌ SSH 连接失败: {e}')
    sys.exit(1)

def run(cmd, label=''):
    if label: print(f'  {label}...')
    stdin, stdout, stderr = ssh.exec_command(cmd)
    out = stdout.read().decode().strip()
    err = stderr.read().decode().strip()
    if err and 'WARNING' not in err and 'DEPRECATION' not in err:
        for line in err.split('\n')[:3]:
            if line.strip(): print(f'    ⚠️ {line.strip()[:120]}')
    return out

print('1. 备份数据库...')
run(f'python3 /root/backup_db.py 2>/dev/null || cp {vol}/data.db {vol}/data.db.bak.\$(date +%Y%m%d_%H%M%S)')

print('2. 拉取最新代码...')
run(f'cd {vol} && git fetch origin main && git reset --hard origin/main')

print('3. 停止容器...')
run('docker stop neibuxitong')
time.sleep(2)

print('4. 清除构建缓存...')
run(f'rm -rf {vol}/.next {vol}/node_modules/.cache 2>/dev/null')

print('5. 启动容器（自动执行 npm run build && npm start）...')
run('docker start neibuxitong')

print('6. 等待构建完成...')
for i in range(8):
    time.sleep(5)
    status = run('docker ps --filter name=neibuxitong --format \"{{.Status}}\"')
    if 'Up' in status:
        break

print('7. 验证服务...')
code = run('python3 -c \"import urllib.request; print(urllib.request.urlopen(\\\"http://localhost:3000/\\\").status)\"')
print(f'  HTTP 状态码: {code}')
if code == '200':
    print('  ✅ 网站正常')
else:
    print(f'  ⚠️ 返回 {code}')

# 数据库自动迁移
print('8. 验证数据库表...')
tables = run(f'sqlite3 {vol}/data.db \"SELECT name FROM sqlite_master WHERE type=\\\"table\\\" ORDER BY name;\"')
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
