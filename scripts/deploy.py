#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
湘泰内部管理系统 — 一键安全部署脚本（paramiko 版）

适用场景：在沙箱化的 DeepSeek Harness / 受限终端里，sshpass 因无法分配
伪终端（"Failed to get a pseudo terminal"）而失败时，用本脚本替代
scripts/deploy.sh。逻辑与 deploy.sh 完全一致（同样 8 步）。

用法（密码通过环境变量传入，绝不写死在脚本/仓库里）：
    SSH_PASS='服务器密码' python3 scripts/deploy.py

可选环境变量：
    SSH_HOST   服务器地址     默认 187.127.108.58
    SSH_USER   登录用户       默认 root
    REMOTE_DIR 服务器代码目录  默认 /opt/projects/neibuxitong
    DB_PATH    服务器数据库路径 默认 /data/neibuxitong/data.db

依赖：pip install paramiko
"""
import os
import subprocess
import sys
import time

import paramiko

SSH_HOST = os.environ.get("SSH_HOST", "187.127.108.58")
SSH_USER = os.environ.get("SSH_USER", "root")
SSH_PASS = os.environ.get("SSH_PASS", "")
REMOTE_DIR = os.environ.get("REMOTE_DIR", "/opt/projects/neibuxitong")
DB_PATH = os.environ.get("DB_PATH", "/data/neibuxitong/data.db")

COUNTS_SQL = (
    "SELECT (SELECT COUNT(*) FROM employees),"
    "(SELECT COUNT(*) FROM orders),"
    "(SELECT COUNT(*) FROM issue_tickets),"
    "(SELECT COUNT(*) FROM attendance),"
    "(SELECT COUNT(*) FROM leave_requests);"
)


def say(msg):
    print(f"\n========== {msg} ==========")


def die(msg):
    print(f"\n❌ {msg}", file=sys.stderr)
    sys.exit(1)


def ok(msg):
    print(f"✅ {msg}")


def main():
    if not SSH_PASS:
        die("未设置 SSH_PASS。用法：SSH_PASS='xxx' python3 scripts/deploy.py")

    cli = paramiko.SSHClient()
    cli.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    try:
        cli.connect(
            SSH_HOST,
            username=SSH_USER,
            password=SSH_PASS,
            timeout=20,
            banner_timeout=20,
            auth_timeout=20,
        )
    except Exception as e:
        die(f"SSH 连接失败：{e}")

    def run(cmd, timeout=60):
        stdin, stdout, stderr = cli.exec_command(cmd, timeout=timeout, get_pty=False)
        out = stdout.read().decode("utf-8", "replace")
        err = stderr.read().decode("utf-8", "replace")
        code = stdout.channel.recv_exit_status()
        return code, out, err

    def must(cmd, timeout=60, label=""):
        code, out, err = run(cmd, timeout)
        if code != 0:
            die(f"{label} 执行失败（退出码 {code}）：{err.strip() or out.strip()}")
        return out.strip()

    # ---------- 步骤 1：本地 git 状态 + 推送 ----------
    say("步骤 1：本地 git 状态确认 + 推送")
    if not os.path.isdir(".git"):
        die("请在仓库根目录执行本脚本")
    r = subprocess.run(["git", "status", "--porcelain"], capture_output=True, text=True)
    if r.stdout.strip():
        print(r.stdout)
        die("本地有未提交改动，请先 commit 再部署")
    r = subprocess.run(
        ["git", "push", "git@github.com:q1345145552-source/neibuwangzhan.git", "main"],
        capture_output=True, text=True, timeout=120,
    )
    if r.returncode != 0:
        die(f"git push 失败：{r.stderr.strip() or r.stdout.strip()}")
    ok("代码已推送到 GitHub")

    # ---------- 步骤 2：数据库完整性 ----------
    say("步骤 2：数据库完整性检查")
    integrity = must(f"sqlite3 {DB_PATH} 'PRAGMA integrity_check;'")
    if integrity != "ok":
        die(f"integrity_check 异常：{integrity}")
    ok("integrity_check = ok")

    # ---------- 部署前记录数据行数 ----------
    counts_before = must(f"sqlite3 {DB_PATH} '{COUNTS_SQL}'")
    print(f"部署前数据行数：{counts_before}")

    # ---------- 步骤 3：停止容器 ----------
    say("步骤 3：停止容器（只停不删）")
    must("docker stop neibuxitong", timeout=120)
    ok("容器已停止")

    # ---------- 步骤 4：拉取最新代码 ----------
    say("步骤 4：拉取最新代码")
    must(f"cd {REMOTE_DIR} && git pull", timeout=120)
    ok("代码已更新")

    # ---------- 步骤 5：复查 .env ----------
    say("步骤 5：复查 .env 关键配置")
    env_cmd = (
        f"cd {REMOTE_DIR} && "
        "awk 'NR>=11 && NR<=13 {k=$0; sub(/=.*/,\"\",k); v=$0; sub(/^[^=]*=/,\"\",v); "
        "print k \"=\" length(v)}' .env && "
        "awk '/^ASSET_SECRET=/{v=$0; sub(/^[^=]*=/,\"\",v); "
        "print \"ASSET_SECRET=\" length(v)}' .env"
    )
    env_out = must(env_cmd)
    print(env_out)
    for key in ("SYNC_SECRET", "CUSTOMER_SYNC_URL", "COMMERCE_PILOT_ENABLED", "ASSET_SECRET"):
        if f"{key}=" not in env_out or f"{key}=0" in env_out:
            die(f".env 关键配置缺失或为空：{key}")
    ok(".env 检查通过（值未输出）")

    # ---------- 步骤 6：清理缓存 + 重新构建 ----------
    say("步骤 6：清理缓存并重新构建")
    must(
        f"cd {REMOTE_DIR} && rm -rf .next && "
        "(nohup docker compose build > /tmp/deploy_build.log 2>&1 < /dev/null &) && echo STARTED"
    )
    for _ in range(40):
        code, _, _ = run("pgrep -f 'docker compose build' >/dev/null 2>&1")
        if code != 0:
            break
        time.sleep(15)
    code, out, err = run("tail -4 /tmp/deploy_build.log")
    if "Built" not in out + err:
        code2, out2, err2 = run("tail -30 /tmp/deploy_build.log")
        die(f"镜像构建未成功：\n{out2}{err2}")
    ok("镜像构建完成")

    # ---------- 步骤 6.5：启动容器 ----------
    say("步骤 6.5：启动容器")
    must(f"cd {REMOTE_DIR} && docker compose up -d", timeout=120)
    ok("容器已启动")

    # ---------- 步骤 7：验证 ----------
    say("步骤 7：验证服务")
    time.sleep(15)
    login_code = must("curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/login")
    if login_code != "200":
        die(f"/login 返回 {login_code}，预期 200")
    ok("/login = 200")

    login_http = must(
        "curl -s -o /tmp/deploy_login.json -w '%{http_code}' -X POST "
        "http://localhost:3000/api/auth/login -H 'Content-Type: application/json' "
        "--data-raw '{\"email\":\"deploy-check@test.local\",\"password\":\"wrong123\"}'"
    )
    if login_http != "401":
        die(f"登录接口返回 {login_http}，预期 401")
    code, out, _ = run("grep -q '邮箱或密码错误' /tmp/deploy_login.json")
    if code != 0:
        die("登录接口 401 但响应体异常")
    ok("登录接口 401 JSON 正常")

    counts_after = must(f"sqlite3 {DB_PATH} '{COUNTS_SQL}'")
    print(f"部署后数据行数：{counts_after}")
    if counts_before == counts_after:
        ok(f"数据行数一致：{counts_after}")
    else:
        b = counts_before.split("|")
        a = counts_after.split("|")
        for i, (bv, av) in enumerate(zip(b, a), start=1):
            if int(av) < int(bv):
                die(f"数据行数第 {i} 项减少：{bv} → {av}")
        ok(f"数据行数无减少：{counts_after}（部署前 {counts_before}）")

    mount = must(
        "docker inspect neibuxitong --format "
        "'{{range .Mounts}}{{.Source}} -> {{.Destination}}{{println}}{{end}}'"
    )
    if "/data/neibuxitong -> /app/data" not in mount:
        die(f"数据库挂载异常：{mount}")
    ok("数据库挂载正常")

    sqlite_err = must(
        "docker logs neibuxitong 2>&1 | "
        "grep -icE 'sqlite error|SQLITE_ERROR|database is locked|malformed' || true"
    )
    if sqlite_err != "0":
        die(f"日志发现 sqlite 错误 {sqlite_err} 处")
    ok("日志无 sqlite 报错")

    # ---------- 步骤 8：手动备份 ----------
    say("步骤 8：手动备份数据库")
    ts = must("date +%Y%m%d_%H%M%S")
    must(f'sqlite3 {DB_PATH} ".backup {DB_PATH}.{ts}"')
    must(f"ls -la {DB_PATH}.{ts}")
    ok(f"备份完成：{DB_PATH}.{ts}")

    cli.close()
    say("部署完成 ✅")


if __name__ == "__main__":
    main()
