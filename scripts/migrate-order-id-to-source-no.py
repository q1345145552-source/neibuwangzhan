#!/usr/bin/env python3
"""
老单改编号（2026-10-22 老板：「都改成和业务系统一致的单号，单号必须要对上」「单号不要-」）。

业务系统同步来的单，只建了一张办理单的，把办理单的编号从内部编号（ORD-一长串）改成业务系统单号。
新单建单时已经直接用业务系统单号（src/app/api/sync/orders/route.ts），这个脚本只处理上线前已经有的老单。
一张客户单拆成几张办的不改（同一个号不能给几张单用），页面上照样显示业务系统单号。

做法：在一个事务里，把所有表、所有文字字段里出现的旧编号换成新编号（步骤、文档、费用、同步记录、
聊天卡片、通知链接、积分原因、操作记录……一起换，旧编号是一长串随机码，不会误换别的内容）。
换完自查：旧编号一处都不剩、外键检查不比换之前差、数据库自检 ok，才提交；任何一步不对就整个撤回。
上传的文件名或目录里如果带旧编号（改了数据库文件就找不到了），直接停下不改。

用法（必须先停掉内部网站、先备份）：
  python3 scripts/migrate-order-id-to-source-no.py <data.db> [--uploads <uploads 目录>]          # 演练：只列出要改什么，不写入
  python3 scripts/migrate-order-id-to-source-no.py <data.db> [--uploads <uploads 目录>] --apply  # 真改
"""
import os
import re
import sqlite3
import sys

SAFE = re.compile(r"^[A-Za-z0-9_]{1,64}$")


def stop(msg):
    print(f"[改编号] 停下：{msg}")
    sys.exit(1)


def quote(name):
    return '"' + name.replace('"', '""') + '"'


def main():
    args = sys.argv[1:]
    if not args or args[0].startswith("-"):
        stop("要给数据库文件路径")
    db_path = args[0]
    apply = "--apply" in args
    uploads = args[args.index("--uploads") + 1] if "--uploads" in args else None
    if not os.path.isfile(db_path):
        stop(f"找不到数据库 {db_path}")

    con = sqlite3.connect(db_path, isolation_level=None)
    con.execute("PRAGMA foreign_keys=OFF")  # 主键跟着一起换，换的过程中不让外键拦；换完再整体核对
    con.execute("PRAGMA busy_timeout=5000")

    # 1. 要改哪几张：业务系统一张单只建了一张办理单的
    by_source = {}
    for source, internal in con.execute(
        "SELECT source_order_no, internal_order_id FROM sync_inbox WHERE internal_order_id IS NOT NULL AND internal_order_id <> ''"
    ):
        by_source.setdefault(source, set()).add(internal)
    mapping, notes = {}, []
    for source, ids in sorted(by_source.items()):
        if len(ids) != 1:
            notes.append(f"{source}：拆成 {len(ids)} 张办，不改编号（页面上照样显示 {source}）")
            continue
        old = next(iter(ids))
        if old == source:
            continue
        if not SAFE.match(source):
            notes.append(f"{source}：单号里有特殊字符，不改")
            continue
        if not con.execute("SELECT 1 FROM orders WHERE id=?", (old,)).fetchone():
            notes.append(f"{source}：办理单 {old} 已经不在了，不改")
            continue
        if con.execute("SELECT 1 FROM orders WHERE id=?", (source,)).fetchone():
            stop(f"{source} 已经被别的办理单用了，没法改（什么都没动）")
        mapping[old] = source
    for n in notes:
        print(f"[改编号] {n}")
    if not mapping:
        print("[改编号] 没有要改的老单")
        return
    print(f"[改编号] 要改 {len(mapping)} 张：")
    for old, new in mapping.items():
        print(f"[改编号]   {old} → {new}")

    # 2. 上传的文件名 / 目录里带旧编号的，改了数据库就找不到文件：直接停下
    if uploads:
        if not os.path.isdir(uploads):
            stop(f"找不到上传目录 {uploads}")
        for root, dirs, files in os.walk(uploads):
            for name in dirs + files:
                if any(old in name for old in mapping):
                    stop(f"上传目录里有带旧编号的文件 {os.path.join(root, name)}（什么都没动）")

    tables = [
        name for name, sql in con.execute("SELECT name, sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
        if not (sql or "").upper().startswith("CREATE VIRTUAL")
    ]
    fk_before = len(con.execute("PRAGMA foreign_key_check").fetchall())

    def occurrences():
        found = []
        for t in tables:
            for col in [c[1] for c in con.execute(f"PRAGMA table_info({quote(t)})")]:
                for old in mapping:
                    n = con.execute(
                        f"SELECT COUNT(*) FROM {quote(t)} WHERE typeof({quote(col)})='text' AND instr({quote(col)}, ?) > 0", (old,)
                    ).fetchone()[0]
                    if n:
                        found.append((t, col, old, n))
        return found

    # 3. 一个事务里全换掉，换完自查，不对就撤回
    con.execute("BEGIN IMMEDIATE")
    try:
        changed = {}
        for t in tables:
            for col in [c[1] for c in con.execute(f"PRAGMA table_info({quote(t)})")]:
                for old, new in mapping.items():
                    cur = con.execute(
                        f"UPDATE {quote(t)} SET {quote(col)} = replace({quote(col)}, ?, ?) WHERE typeof({quote(col)})='text' AND instr({quote(col)}, ?) > 0",
                        (old, new, old),
                    )
                    if cur.rowcount:
                        changed[f"{t}.{col}"] = changed.get(f"{t}.{col}", 0) + cur.rowcount
        left = occurrences()
        if left:
            raise RuntimeError("换完还有旧编号：" + "；".join(f"{t}.{c} {n} 处" for t, c, _, n in left[:10]))
        for old, new in mapping.items():
            if not con.execute("SELECT 1 FROM orders WHERE id=?", (new,)).fetchone():
                raise RuntimeError(f"办理单 {new} 没换上")
        fk_after = len(con.execute("PRAGMA foreign_key_check").fetchall())
        if fk_after > fk_before:
            raise RuntimeError(f"外键检查变差了（{fk_before} → {fk_after}）")
        ok = con.execute("PRAGMA integrity_check").fetchone()[0]
        if ok != "ok":
            raise RuntimeError(f"数据库自检不通过：{ok}")
        print("[改编号] 每张表改了几条：")
        for k in sorted(changed):
            print(f"[改编号]   {k}: {changed[k]}")
        if apply:
            con.execute("COMMIT")
            print(f"[改编号] ✅ 已改 {len(mapping)} 张，旧编号一处不剩，外键和数据库自检都正常")
        else:
            con.execute("ROLLBACK")
            print("[改编号] 演练完成（没有写入）；加 --apply 才真改")
    except Exception as e:  # noqa: BLE001 — 任何问题都整个撤回
        con.execute("ROLLBACK")
        stop(f"{e}（已撤回，什么都没动）")
    finally:
        con.close()


if __name__ == "__main__":
    main()
