# 部署检查清单

**日期**：2026-07-25
**结论**：还不能直接部署。有 3 件必须先做的事（其中 2 件是安全问题），做完再走正常发布流程。

---

## 🔴 必须先做

### 1. 改掉服务器 root 密码

`push.sh` 里曾明文写着服务器 root 密码（`187.127.108.58`），这个文件在 git 里，
**密码已经进了提交历史**。代码已改成从环境变量读，但历史记录删不掉。

```bash
ssh root@187.127.108.58
passwd            # 设一个新密码
```

改完在本机 `~/.zshrc` 里配置，`push.sh` 会读它：

```bash
export DEPLOY_PASSWORD='新密码'
```

```bash
source ~/.zshrc
```

更稳妥的做法是改用 SSH 密钥登录，然后在服务器上关掉密码登录
（`/etc/ssh/sshd_config` 里 `PasswordAuthentication no`）。

---

### 2. 配置 JWT_SECRET（否则等于没有登录验证）

`start.sh` 里曾写死 `JWT_SECRET=xiangtai-production-jwt-2026`。这个值在仓库里公开，
意味着任何拿到代码的人都能自己签一个 admin 身份的 token 直接登进系统——密码是什么都拦不住。

代码已改成：密钥必须由环境注入，没配、用了示例值、或短于 32 位，容器都会拒绝启动。

**在服务器上操作**（`vol` = `/var/lib/docker/volumes/neibuxitong_app_data/_data`）：

```bash
cd /var/lib/docker/volumes/neibuxitong_app_data/_data
cp .env.example .env
openssl rand -base64 48        # 复制输出，填进 .env 的 JWT_SECRET=
openssl rand -base64 48        # 再生成一个，填进 CRON_SECRET=
nano .env
chmod 600 .env
```

`.env` 在 `.gitignore` 里，`git reset --hard` 不会删掉它，之后每次部署都保留。

> **注意**：换了 JWT_SECRET 之后，所有人当前的登录状态会失效，需要重新登录一次。这是正常的。

---

### 3. 让容器读到 .env —— 必须 recreate，不能只 restart

`docker-compose.yml` 这次新增了 `env_file: .env`。
**`docker start` 不会重读 compose 配置**，老容器起来还是读不到密钥，会直接启动失败。

首次部署必须重建容器：

```bash
cd /var/lib/docker/volumes/neibuxitong_app_data/_data
docker compose up -d --build --force-recreate
docker logs -f neibuxitong        # 看到 "✅ JWT_SECRET 已配置" 才算成功
```

之后再用 `push.sh` 就正常了。

---

## 🟡 上线前建议做

### 默认密码全是 123456

12 个员工账号（含 admin「张三」）初始密码都是 `123456`。
真正开始用之前，让每个人登录后自己改一次密码。

### 本机先验证构建

我这边的沙箱跑不了 `next build`（缺 macOS 的 SWC 二进制），所以构建从未真正验证过。
先在你的电脑上跑一遍，确认没问题再推：

```bash
npm run verify     # 枚举检查 + 链路测试 + 类型检查
npm run build      # 这一步必须在本机验证
```

### 提交代码

`.git/index.lock` 挡着提交（沙箱删不掉，要在你电脑上删）：

```bash
rm -f .git/index.lock
git add -A
git commit -m "修复安全问题与多轮 bug，补集成测试"
```

当前有 108 个文件待提交。

### 备份线上数据库

`push.sh` 第 1 步会自动备份，但重大变更前手动再备一次更保险：

```bash
ssh root@187.127.108.58 'cp /var/lib/docker/volumes/neibuxitong_app_data/_data/data.db ~/data.db.bak'
```

### 配置客户账号可见范围

客户角色（李四 / lisi@client.com）默认按客户名匹配订单。
在「设置 → 客户可见范围」里给每个客户账号指定能看的公司，否则可能看到不该看的订单。

---

## 部署流程

前面三件事做完后，日常发布就是一条命令：

```bash
./push.sh "本次改动说明"
```

它会依次：提交 → 推送 → 服务器备份数据库 → 拉代码 → 重启容器 → 验证 HTTP 200 → 检查关键表 → 看日志报错。

---

## 上线后确认

- [ ] `docker logs neibuxitong` 里有 `✅ JWT_SECRET 已配置`，没有 `SQLITE_ERROR`
- [ ] 用 admin 账号能登录，侧栏各模块都能打开
- [ ] 新建一个测试订单，确认步骤和所需文件清单自动生成了
- [ ] 机构板块：随便点开一个达人，阶段和状态显示正常
- [ ] 导出一次 PDF，确认中文和泰文都不是方块

## 出问题怎么退回

```bash
ssh root@187.127.108.58
cd /var/lib/docker/volumes/neibuxitong_app_data/_data
git log --oneline -5              # 找到上一个正常的提交
git reset --hard <那个提交号>
docker compose up -d --build --force-recreate
```

数据库回退（仅在数据被写坏时用，会丢掉回退点之后的所有数据）：

```bash
docker stop neibuxitong
cp data.db.bak.<时间戳> data.db
docker start neibuxitong
```
