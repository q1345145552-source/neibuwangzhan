#!/usr/bin/env python3
"""
湘泰内部管理系统 —— 一键部署（paramiko 版）

为什么有这个版本：sshpass 在没有伪终端的沙箱里会报
"Failed to get a pseudo terminal"，DeepSeek Harness 这类环境用不了。
paramiko 直接走 SSH 协议、不需要 tty，所以在沙箱里也能用。

用法:
    SSH_PASS='<服务器密码>' Python解释器 scripts/deploy.py

依赖 paramiko。如果报 ModuleNotFoundError，用工作区里的隔离环境:
    python3 -m venv .venv-deploy
    .venv-deploy/bin/pip install paramiko
    SSH_PASS='<服务器密码>' .venv-deploy/bin/python scripts/deploy.py

可选环境变量（都有默认值）:
    SSH_HOST=187.127.108.58     SSH_PORT=22       SSH_USER=root
    APP_DIR=/opt/projects/neibuxitong
    DATA_DIR=/data/neibuxitong  DB_FILE=$DATA_DIR/data.db
    CONTAINER=neibuxitong       SVC=neibuxitong   BRANCH=main
    HEALTH_TIMEOUT=90           SKIP_PUSH=1       SKIP_BACKUP=1

8 个步骤与 deploy.sh 完全一致，任何一步失败立即退出（sys.exit(非0)）:
    1. git push（本地）
    2. integrity_check（停机前只读，记录 orders 基线）
    3. 停容器（只 stop，不 rm）
    4. git pull（远端）
    5. 复查 .env 关键键（只打印长度，绝不打印值）
    6. 清缓存重建镜像并启动
    7. 验证 /login 200、错误凭据 401、orders 不减少、挂载正确、日志无 sqlite 报错
    8. 带时间戳备份数据库 + 部署清单

密码只从环境变量读取，不写文件、不进 git、不出现在命令行参数里。

已在真实服务器（2026-10-15）上验证过的环境事实，改脚本前先看这里：
  * 生产容器里 **没有 curl、没有 python3**（只有 node v22 和 wget）→ 健康检查一律走宿主机 curl，
    不能用 `docker exec ... curl`，否则永远拿不到状态码（会一直等到超时）。
  * 宿主机 **没有 node**，但有 python3 和 sqlite3 → 只读查询优先 python3、回退 sqlite3。
  * 容器内 .env 未设 DB_PATH，数据库真实路径是 /app/data/data.db；
    直接跑 scripts/backup-source.cjs 会去找 /app/data.db 并报 DB_SOURCE_MISSING，
    必须显式传 `docker exec -e DB_PATH=/app/data/data.db`。
  * `docker inspect -f` 的 Go 模板里带 `{"\n"}` 会 template parsing error →
    改用简单模板 + `|` 分隔符，或取 JSON 在本地解析。
"""

from __future__ import annotations

import hashlib
import os
import subprocess
import sys
import time
from datetime import datetime
from io import BytesIO
from pathlib import Path

try:
    import paramiko
except ModuleNotFoundError:  # pragma: no cover - 只影响首跑体验
    sys.stderr.write(
        "[X] 缺少 paramiko，本机系统 Python 装不进去时可以建隔离环境：\n"
        "      python3 -m venv .venv-deploy && .venv-deploy/bin/pip install paramiko\n"
        "      SSH_PASS='...' .venv-deploy/bin/python scripts/deploy.py\n"
    )
    raise

HOST = os.environ.get("SSH_HOST", "187.127.108.58")
PORT = int(os.environ.get("SSH_PORT", "22"))
USER = os.environ.get("SSH_USER", "root")
APP_DIR = os.environ.get("APP_DIR", "/opt/projects/neibuxitong")
DATA_DIR = os.environ.get("DATA_DIR", "/data/neibuxitong")
DB_FILE = os.environ.get("DB_FILE", f"{DATA_DIR}/data.db")
CONTAINER = os.environ.get("CONTAINER", "neibuxitong")
SVC = os.environ.get("SVC", "neibuxitong")
BRANCH = os.environ.get("BRANCH", "main")
HEALTH_TIMEOUT = int(os.environ.get("HEALTH_TIMEOUT", "90"))
SKIP_PUSH = os.environ.get("SKIP_PUSH", "0") == "1"
SKIP_BACKUP = os.environ.get("SKIP_BACKUP", "0") == "1"

REPO_DIR = Path(__file__).resolve().parent.parent

# 每条远端命令都强制 bash + ERR 陷阱，链式命令中间失败也会立刻中止。
REMOTE_PROLOGUE = (
    "set -Eeuo pipefail; "
    'trap \'echo "[远端失败] line $LINENO: $BASH_COMMAND" >&2; exit 1\' ERR; '
)

_env_file = os.environ.get("ENV_FILE", "")


def load_env_file() -> None:
    """可选：从 ENV_FILE（默认仓库下的 .deploy.env）读取配置，该文件名已在 .gitignore 里。"""
    global HOST, PORT, USER, APP_DIR, DATA_DIR, DB_FILE, CONTAINER, SVC, BRANCH
    global HEALTH_TIMEOUT, SKIP_PUSH, SKIP_BACKUP, _env_file
    path = Path(_env_file) if _env_file else REPO_DIR / ".deploy.env"
    if not path.is_file():
        return
    _env_file = str(path)
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, val = line.split("=", 1)
        key, val = key.strip(), val.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = val
    HOST = os.environ.get("SSH_HOST", HOST)
    PORT = int(os.environ.get("SSH_PORT", str(PORT)))
    USER = os.environ.get("SSH_USER", USER)
    APP_DIR = os.environ.get("APP_DIR", APP_DIR)
    DATA_DIR = os.environ.get("DATA_DIR", DATA_DIR)
    DB_FILE = os.environ.get("DB_FILE", f"{DATA_DIR}/data.db")
    CONTAINER = os.environ.get("CONTAINER", CONTAINER)
    SVC = os.environ.get("SVC", SVC)
    BRANCH = os.environ.get("BRANCH", BRANCH)
    HEALTH_TIMEOUT = int(os.environ.get("HEALTH_TIMEOUT", str(HEALTH_TIMEOUT)))
    SKIP_PUSH = os.environ.get("SKIP_PUSH", "0") == "1"
    SKIP_BACKUP = os.environ.get("SKIP_BACKUP", "0") == "1"


def step(n: int, title: str) -> None:
    print(f"\n=============== [{n}/8] {title} ===============")


def ok(msg: str) -> None:
    print(f"[OK] {msg}")


def die(msg: str) -> None:
    sys.stderr.write(f"[X] {msg}\n")
    sys.exit(1)


def local(cmd: list[str], **kw) -> subprocess.CompletedProcess:
    print(f"$ {' '.join(cmd)}")
    return subprocess.run(cmd, cwd=REPO_DIR, text=True, capture_output=True, **kw)


def local_head() -> str:
    r = local(["git", "rev-parse", "--short", "HEAD"])
    if r.returncode != 0:
        die(f"读不到本地 git HEAD：{r.stderr.strip()}")
    return r.stdout.strip()


# ── SSH ──────────────────────────────────────────────────────────────────────
client: paramiko.SSHClient


def run(cmd: str, timeout: int = 120, check: bool = True, quiet: bool = False) -> str:
    """在远端执行一条命令，返回 stdout（stderr 追加在后面）。check=True 时非 0 退出即中止。"""
    full = REMOTE_PROLOGUE + cmd
    if not quiet:
        print(f"  remote$ {cmd[:160]}{'...' if len(cmd) > 160 else ''}")
    _stdin, stdout, stderr = client.exec_command(full, timeout=timeout, get_pty=False)
    chan = stdout.channel
    deadline = time.monotonic() + timeout
    while not chan.exit_status_ready():
        if time.monotonic() > deadline:
            chan.close()
            die(f"远端命令超时（{timeout}s）：{cmd[:120]}")
        if chan.recv_ready():
            chan.recv(65536)
        time.sleep(0.2)
    code = chan.recv_exit_status()
    out = stdout.read().decode("utf-8", "replace")
    err = stderr.read().decode("utf-8", "replace")
    text = (out + ("\n" + err if err.strip() else "")).strip()
    if check and code != 0:
        die(f"远端命令失败（exit {code}）：{cmd[:120]}\n{text}")
    return text


def put_file(remote_path: str, data: bytes) -> None:
    sftp = client.open_sftp()
    try:
        sftp.putfo(BytesIO(data), remote_path)
    finally:
        sftp.close()


def compose_manifest(values: dict[str, str]) -> bytes:
    lines = ["湘泰内部管理系统 部署记录"]
    lines += [f"{k:<16}: {v}" for k, v in values.items()]
    return ("\n".join(lines) + "\n").encode("utf-8")


def css(url: str) -> str:
    """在宿主机上取 HTTP 状态码。

    刻意不用 `docker exec ... curl`：生产容器里没有 curl（也没有 python3），
    实测会报 'executable file not found in $PATH'，健康检查会永远拿不到状态码。
    """
    out = run(
        f"curl -s -o /dev/null -w '%{{http_code}}' --max-time 15 '{url}' || echo 000",
        timeout=60,
        check=False,
        quiet=True,
    )
    for tok in reversed(out.replace("\n", " ").split()):
        if tok.isdigit() and len(tok) == 3:
            return tok
    return "000"


def inspect_container() -> dict[str, str]:
    """一次取回镜像/状态/挂载信息。

    注意：`docker inspect -f` 的模板里不能出现 `{"\\n"}`（Go 模板会解析失败），
    所以这里用 `|` 做分隔符，取回后在本地切分。
    """
    tpl = (
        "image={{.Config.Image}}|digest={{.Image}}|status={{.State.Status}}|"
        "restarts={{.RestartCount}}|mounts={{range .Mounts}}{{.Source}} -> "
        "{{.Destination}}|{{end}}"
    )
    out = run(f"docker inspect -f '{tpl}' {CONTAINER}").strip()
    result: dict[str, str] = {}
    for key in ("image", "digest", "status", "restarts"):
        marker = f"{key}="
        if marker not in out:
            result[key] = "-"
            continue
        result[key] = out.split(marker, 1)[1].split("|", 1)[0]
    result["mounts"] = out.split("mounts=", 1)[1] if "mounts=" in out else ""
    return result


def db_path_in_container() -> str:
    """宿主路径 /data/neibuxitong/data.db -> 容器内 /app/data/data.db。

    $DATA_DIR 挂载到容器的 /app/data，注意拼接时要补回被切掉的那个 '/'。
    """
    if DB_FILE.startswith(DATA_DIR):
        return "/app/data" + DB_FILE[len(DATA_DIR):]
    return DB_FILE


def db_query(prefix: str = "") -> str:
    """只读检查数据库：优先 python3，回退 sqlite3（宿主机上没有 node，策略脚本用不了）。"""
    py = (
        "if command -v python3 >/dev/null 2>&1; then python3 - <<'PY'\n"
        "import hashlib, os, sqlite3, sys\n"
        'p = os.environ["DB_FILE"]\n'
        "if not os.path.exists(p):\n"
        '    print("exists 0"); sys.exit(0)\n'
        'print("exists 1")\n'
        'print("size %d" % os.path.getsize(p))\n'
        'print("md5 " + hashlib.md5(open(p, "rb").read()).hexdigest())\n'
        'con = sqlite3.connect("file:" + p + "?mode=ro", uri=True)\n'
        'print("quick_check " + str(con.execute("PRAGMA quick_check").fetchone()[0]))\n'
        'print("orders %d" % con.execute("SELECT COUNT(*) FROM orders").fetchone()[0])\n'
        "con.close()\n"
        "PY\n"
        "elif command -v sqlite3 >/dev/null 2>&1; then\n"
        '  [ -f "$DB_FILE" ] || { echo "exists 0"; exit 0; }\n'
        '  echo "exists 1"\n'
        '  echo "size $(wc -c < "$DB_FILE" | tr -d \' \')"\n'
        '  echo "md5 $(md5sum "$DB_FILE" | cut -d\' \' -f1)"\n'
        '  echo "quick_check $(sqlite3 "file:$DB_FILE?mode=ro" "PRAGMA quick_check;")"\n'
        '  echo "orders $(sqlite3 "file:$DB_FILE?mode=ro" "SELECT COUNT(*) FROM orders;")"\n'
        "else\n"
        '  echo "同一个服务器上 python3 和 sqlite3 都没有，无法校验，停手" >&2\n'
        "  exit 1\n"
        "fi"
    )
    return run(f'{prefix}export DB_FILE="{DB_FILE}"; {py}')


def parse_db_output(text: str) -> dict[str, str]:
    parsed: dict[str, str] = {}
    for line in text.splitlines():
        parts = line.split(None, 1)
        if len(parts) == 2:
            parsed[parts[0]] = parts[1].strip()
    return parsed


# ── 数据行数基线：5 张核心表，比只看 orders 更能发现数据丢失 ────────────────
COUNT_LABELS = "employees orders issue_tickets attendance leave_requests"
COUNT_SQL = (
    "SELECT (SELECT COUNT(*) FROM employees),(SELECT COUNT(*) FROM orders),"
    "(SELECT COUNT(*) FROM issue_tickets),(SELECT COUNT(*) FROM attendance),"
    "(SELECT COUNT(*) FROM leave_requests);"
)


def counts_now() -> list[int]:
    """取 5 张表的行数。宿主机有 sqlite3（没有 node），所以直接用它。"""
    out = run(f"sqlite3 {DB_FILE} '{COUNT_SQL}'", quiet=True).strip().splitlines()
    raw = out[-1].strip() if out else ""
    parts = raw.split("|")
    if len(parts) != 5 or not all(p.isdigit() for p in parts):
        die(f"数据行数格式异常（期望 5 个数字）：{raw!r}")
    return [int(p) for p in parts]


def counts_guard(before: list[int], after: list[int]) -> None:
    for label, b, a in zip(COUNT_LABELS.split(), before, after):
        if a < b:
            die(f"{label} 行数减少：{b} -> {a}，立刻停手排查，别继续写数据")


# SQLite 日志检查：只认真正的错误关键词。早期版本用宽松的 `grep -i sqlite`，
# 一旦某条正常日志提到 sqlite 就会被误判为失败。
SQLITE_ERR_PATTERN = "sqlite error|SQLITE_ERROR|database is locked|malformed"


def sqlite_error_count() -> int:
    out = run(
        f"docker logs --tail 400 {CONTAINER} 2>&1 | grep -icE '{SQLITE_ERR_PATTERN}' || true",
        check=False, quiet=True,
    ).strip()
    digits = "".join(ch for ch in out if ch.isdigit())
    return int(digits) if digits else 0


def main() -> int:
    if not os.environ.get("SSH_PASS"):
        die("缺少环境变量 SSH_PASS。用法：SSH_PASS='<服务器密码>' python3 scripts/deploy.py")
    password = os.environ["SSH_PASS"]

    load_env_file()
    if _env_file:
        print(f"已加载配置文件：{_env_file}")
    os.chdir(REPO_DIR)

    global client
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    print(f"连接 {USER}@{HOST}:{PORT} ...")
    try:
        client.connect(
            HOST, port=PORT, username=USER, password=password,
            timeout=20, banner_timeout=30, auth_timeout=30,
            allow_agent=False, look_for_keys=False,
        )
    except Exception as exc:  # noqa: BLE001 - 连不上就是致命错误
        die(f"SSH 连接失败：{exc}")
    ok("SSH 已连接（未使用伪终端，因此不受沙箱 tty 限制）")

    order_before = 0
    image_before = "-"
    remote_commit = ""
    login_code = "000"
    auth_code = "000"
    status_out = ""
    run_id = ""
    local_commit = ""

    try:
        # ── 1) git push ──────────────────────────────────────────────────────
        step(1, f"git push（本地 -> origin/{BRANCH}）")
        if SKIP_PUSH:
            print("（SKIP_PUSH=1，跳过）")
        else:
            st = local(["git", "status", "--porcelain"])
            if st.stdout.strip():
                print("警告：工作区有未提交改动，这些改动不会被部署：")
                print(st.stdout.rstrip())
            r = local(["git", "push", "origin", BRANCH])
            sys.stdout.write(r.stdout)
            sys.stderr.write(r.stderr)
            if r.returncode != 0:
                die(
                    "git push 失败。本机若没配 GitHub 凭据（HTTPS token 或 SSH key），"
                    "先配好、或临时用 SKIP_PUSH=1 只跑远端部分。"
                )
            ok(f"已推送 origin/{BRANCH}")
        local_commit = local_head()
        print(f"本地 HEAD: {local_commit}")

        # ── 2) integrity_check ───────────────────────────────────────────────
        step(2, "integrity_check（停机前只读检查数据库）")
        pre = db_query(f"cd {APP_DIR} && ")
        print(pre)
        parsed = parse_db_output(pre)
        if parsed.get("exists") != "1":
            die(f"数据库文件不存在：{DB_FILE}")
        if parsed.get("quick_check") != "ok":
            die(f"数据库完整性检查未通过：{parsed.get('quick_check')}")
        if not parsed.get("orders", "").isdigit():
            die(f"拿不到订单行数：{parsed.get('orders')}")
        order_before = int(parsed["orders"])
        ok(f"数据库可读，orders = {order_before} 行（停机前基线）")

        counts_before = counts_now()
        print(f"  部署前行数: {'|'.join(map(str, counts_before))}   （{COUNT_LABELS}）")

        info = inspect_container()
        image_name = info.get("image", "-") or "-"
        if image_name != "-" and ":" not in image_name.rsplit("/", 1)[-1]:
            image_name += ":latest"  # docker inspect 的 .Config.Image 会省略默认 tag
        image_digest = info.get("digest", "-")
        status_out = f"{info.get('status', 'unknown')} restarts={info.get('restarts', '0')}"

        # ── 3) 停容器 ────────────────────────────────────────────────────────
        step(3, "停容器（只 stop，不 rm，不动数据卷）")
        run(f"docker stop {CONTAINER} >/dev/null 2>&1 || true; echo stopped", quiet=True)
        ok(f"容器 {CONTAINER} 已停止")

        # ── 4) git pull ──────────────────────────────────────────────────────
        step(4, f"git pull（远端 {APP_DIR}）")
        remote_commit = run(
            f"cd {APP_DIR} && git fetch origin {BRANCH} >/dev/null && "
            f"git checkout {BRANCH} >/dev/null && git pull --ff-only origin {BRANCH} && "
            "git rev-parse --short HEAD",
            timeout=300,
        ).strip().splitlines()[-1]
        ok(f"远端已更新到 {remote_commit}")
        if not SKIP_PUSH and remote_commit != local_commit:
            print(f"警告：远端 HEAD ({remote_commit}) 与本地 HEAD ({local_commit}) 不一致")

        # ── 5) 复查 .env ─────────────────────────────────────────────────────
        step(5, "复查 .env 关键键（只输出长度）")
        env_out = run(
            f"cd {APP_DIR} && [ -s .env ] && python3 - <<'PY'\n"
            "keys = ['JWT_SECRET', 'CRON_SECRET', 'CORS_ORIGINS', 'SYNC_SECRET',\n"
            "        'CUSTOMER_SYNC_URL', 'COMMERCE_PILOT_ENABLED', 'ASSET_SECRET']\n"
            "for raw in open('.env', encoding='utf-8', errors='replace').read().splitlines():\n"
            "    s = raw.strip()\n"
            "    if not s or s.startswith('#') or '=' not in s:\n"
            "        continue\n"
            "    k, v = s.split('=', 1)\n"
            "    k = k.strip()\n"
            "    if k in keys:\n"
            "        print('  %-24s 长度=%d' % (k, len(v.strip().strip(chr(34)).strip(chr(39)))))\n"
            "PY"
        )
        print(env_out)
        for key in ("JWT_SECRET", "CRON_SECRET"):
            if key not in env_out:
                die(f".env 缺少必填键 {key}（参考 .env.example，缺了 start.sh 会拒绝启动）")
        ok(".env 存在且必填键齐全（值未打印）")

        # ── 6) 清缓存重建并启动 ──────────────────────────────────────────────
        step(6, "清 .next 缓存，异步重建镜像并启动（这一步比较慢）")
        build_log = "/tmp/neibuxitong-deploy-build.log"
        # 刻意异步：全量构建可能十几分钟，同步等容易被 SSH/客户端超时拖断，
        # 而且构建失败时连接一断就看不到真正的报错。这里改成后台跑 + 轮询日志。
        run(
            f"cd {APP_DIR} && rm -rf .next && rm -f {build_log} && "
            f"(nohup docker compose build --no-cache {SVC} > {build_log} 2>&1 < /dev/null &) && "
            "echo BUILD_STARTED",
            quiet=True,
        )
        print(f"  构建已在后台启动，日志 {build_log}，轮询中...")
        deadline = time.monotonic() + 1800
        built = False
        build_failed = False
        time.sleep(20)  # 给构建一点时间落盘日志
        while time.monotonic() < deadline:
            mark = run(
                f"if grep -qE 'Built|writing image|naming to' {build_log} 2>/dev/null; then echo DONE; "
                f"elif grep -qiE 'failed to solve|^ERROR|error:' {build_log} 2>/dev/null; then echo FAIL; "
                f"elif [ -f {build_log} ]; then echo RUNNING; else echo NOLOG; fi || echo SSHFAIL",
                check=False, quiet=True,
            ).strip().splitlines()
            state = mark[-1].strip() if mark else "SSHFAIL"
            if state == "DONE":
                built = True
                break
            if state == "FAIL":
                build_failed = True
                break
            if state == "SSHFAIL":
                print("  SSH 抖动，继续轮询...")
            else:
                sys.stdout.write(".")
                sys.stdout.flush()
            time.sleep(15)
        print()
        if build_failed:
            print(run(f"tail -30 {build_log} 2>/dev/null || true", check=False, quiet=True))
            die("镜像构建失败（详见上方日志）")
        if not built:
            print(run(f"tail -30 {build_log} 2>/dev/null || true", check=False, quiet=True))
            die("镜像构建超时（1800s）或未出现完成标记")
        ok("镜像构建完成")
        run(f"cd {APP_DIR} && docker compose up -d {SVC} && docker image prune -f >/dev/null", timeout=600)
        ok("容器已启动")

        # ── 7) 验证 ──────────────────────────────────────────────────────────
        step(7, "验证（健康检查）")
        print(f"等待 /login 返回 200（最多 {HEALTH_TIMEOUT}s）...")
        deadline = time.monotonic() + HEALTH_TIMEOUT
        while time.monotonic() < deadline:
            login_code = css("http://127.0.0.1:3000/login")
            if login_code == "200":
                break
            time.sleep(3)
        if login_code != "200":
            die(f"/login 未返回 200（当前 {login_code}），看 docker logs {CONTAINER}")
        ok("/login = 200（宿主机 curl，容器里没有 curl）")

        # 用不存在的邮箱测 401：绝不碰真实账号，避免连续失败 5 次触发 15 分钟锁定
        # 同时校验响应体确实是那个 JSON 错误（光有 401 也可能是网关/代理拦下来的）
        auth_body = "/tmp/neibuxitong-deploy-auth.json"
        auth_raw = run(
            f"curl -s -o {auth_body} -w '%{{http_code}}' --max-time 15 "
            "-X POST http://127.0.0.1:3000/api/auth/login "
            "-H 'Content-Type: application/json' "
            "--data '{\"email\":\"__deploy_check__@invalid.local\","
            "\"password\":\"__not_a_real_password__\"}' || echo 000",
            timeout=60, check=False, quiet=True,
        )
        auth_code = "000"
        for tok in reversed(auth_raw.replace("\n", " ").split()):
            if tok.isdigit() and len(tok) == 3:
                auth_code = tok
                break
        if auth_code != "401":
            die(f"错误凭据登录本应 401，实际 {auth_code}")
        body = run(
            f"grep -q '邮箱或密码错误' {auth_body} && rm -f {auth_body} && echo BODY_OK",
            check=False, quiet=True,
        )
        if "BODY_OK" not in body:
            die("登录接口返回 401 但响应体不是预期的「邮箱或密码错误」JSON，可能不是应用本身在应答")
        ok("错误凭据登录 = 401，响应体 JSON 正常（未触碰任何真实账号）")

        post = db_query()
        print(post)
        post_parsed = parse_db_output(post)
        if post_parsed.get("quick_check") != "ok":
            die(f"部署后数据库完整性检查未通过：{post_parsed.get('quick_check')}")
        if not post_parsed.get("orders", "").isdigit():
            die(f"拿不到部署后订单行数：{post_parsed.get('orders')}")
        order_after = int(post_parsed["orders"])

        # 5 表逐张比对：任何一张减少都立刻停手
        counts_after = counts_now()
        print(f"  部署后行数: {'|'.join(map(str, counts_after))}")
        counts_guard(counts_before, counts_after)
        ok(f"5 张表行数均未减少（{COUNT_LABELS}）")

        info = inspect_container()
        mount_out = info.get("mounts", "")
        print(f"  挂载: {mount_out}")
        if f"{DATA_DIR} -> /app/data" not in mount_out:
            die(f"挂载不对：期望 {DATA_DIR} -> /app/data")
        ok(f"数据挂载正确：{DATA_DIR} -> /app/data")

        status_out = f"{info.get('status', 'unknown')} restarts={info.get('restarts', '0')}"
        print(f"  容器状态: {status_out}")
        if info.get("status") != "running":
            die(f"容器状态不是 running（{info.get('status')}），看 docker logs {CONTAINER}")

        sqlite_err = sqlite_error_count()
        if sqlite_err != 0:
            print(run(
                f"docker logs --tail 400 {CONTAINER} 2>&1 | grep -iE '{SQLITE_ERR_PATTERN}' | tail -10",
                check=False, quiet=True,
            ))
            die(f"容器日志里发现 {sqlite_err} 处 sqlite 报错，先排查再继续")
        ok("日志无 sqlite 报错（精确匹配 sqlite error / SQLITE_ERROR / database is locked / malformed）")

        # ── 8) 带时间戳备份 ─────────────────────────────────────────────────
        step(8, "带时间戳备份数据库 + 部署清单")
        if SKIP_BACKUP:
            print("（SKIP_BACKUP=1，跳过）")
        else:
            run_id = datetime.now().strftime("%Y%m%d_%H%M%S")
            bangkok = subprocess.run(
                ["bash", "-c", "TZ=Asia/Bangkok date '+%Y-%m-%d %H:%M:%S'"],
                text=True, capture_output=True,
            ).stdout.strip() or "-"
            backup_dir = f"{DATA_DIR}/backups/{run_id}"
            # 容器内 .env 没设 DB_PATH，策略脚本默认会去找 /app/data.db（不存在）。
            db_in_container = db_path_in_container()
            manifest = compose_manifest({
                "时间(曼谷)": bangkok,
                "时间(本机)": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                "远端 git commit": remote_commit,
                "本地 git HEAD": local_commit,
                "分支": BRANCH,
                "镜像标签": image_name,
                "镜像 ID（部署前）": image_digest,
                "orders 部署前": str(order_before),
                "orders 部署后": str(order_after),
                "行数基线（前）": "|".join(map(str, counts_before)),
                "行数基线（后）": "|".join(map(str, counts_after)),
                "行数统计表": COUNT_LABELS,
                "数据库完整性": f"{parsed.get('quick_check')} -> {post_parsed.get('quick_check')}",
                "sqlite 报错处数": str(sqlite_err),
                "/login": login_code,
                "错误凭据登录": auth_code,
                "容器状态": status_out,
                "数据库": DB_FILE,
                "容器内数据库路径": db_in_container,
                "挂载": f"{DATA_DIR} -> /app/data",
                "数据库 md5（部署前）": parsed.get("md5", "-"),
                "数据库 md5（部署后）": post_parsed.get("md5", "-"),
            })
            run(f"mkdir -p {backup_dir} && chmod 700 {backup_dir}")
            # 用仓库既有的策略脚本做在线快照（带一致性校验），失败则回退到普通拷贝
            snap = run(
                f"if docker exec -e DB_PATH={db_in_container} {CONTAINER} "
                f"node scripts/backup-source.cjs backup /app/data/data_{run_id}.db "
                ">/dev/null 2>&1; then echo POLICY_SNAPSHOT_OK; "
                "else echo POLICY_SNAPSHOT_FAILED; fi",
                timeout=600, check=False, quiet=True,
            )
            if "POLICY_SNAPSHOT_OK" not in snap:
                print("  注意：策略脚本快照失败，改用普通文件拷贝（数据库未处于写入中的话通常没问题）")
            put_file(f"{backup_dir}/DEPLOY-MANIFEST.txt", manifest)
            run(
                f"if [ -f {DATA_DIR}/data_{run_id}.db ]; then "
                f"mv {DATA_DIR}/data_{run_id}.db {backup_dir}/data.db; "
                f"else cp -a {DB_FILE} {backup_dir}/data.db; fi && "
                f"(cp -a {APP_DIR}/.env {backup_dir}/env.copy 2>/dev/null || true) && "
                f"(cd {APP_DIR} && git rev-parse HEAD > {backup_dir}/git-commit.txt) && "
                f"du -sh {backup_dir} && ls -l {backup_dir} && md5sum {DB_FILE} {backup_dir}/data.db",
                timeout=600,
            )
            ok(f"备份完成：{backup_dir}（含 data.db、env.copy、DEPLOY-MANIFEST.txt）")

        print("\n=============================== 部署完成 ===============================")
        print(f"  远端 commit : {remote_commit}")
        print(f"  orders      : {order_before} -> {order_after}")
        print(f"  /login      : {login_code}    错误凭据: {auth_code}")
        print(f"  容器        : {status_out}")
        if run_id:
            print(f"  备份        : {DATA_DIR}/backups/{run_id}")
        print("=======================================================================")
        return 0
    finally:
        client.close()


if __name__ == "__main__":
    sys.exit(main())
