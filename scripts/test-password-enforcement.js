#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */

const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const Database = require("better-sqlite3");
const bcrypt = require("bcryptjs");

const projectRoot = path.resolve(__dirname, "..");
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "internal-auth-test-"));
const dbPath = path.join(tempDir, "data.db");
const port = 33000 + (process.pid % 1000);
const baseUrl = `http://127.0.0.1:${port}`;
const logs = [];

fs.copyFileSync(path.join(projectRoot, "data.db"), dbPath);

const db = new Database(dbPath);
const employeeColumns = db.prepare("PRAGMA table_info(employees)").all().map((column) => column.name);
const resetSql = employeeColumns.includes("auth_version")
  ? "UPDATE employees SET password = ?, must_change_password = 1, auth_version = 0 WHERE email = ?"
  : "UPDATE employees SET password = ?, must_change_password = 1 WHERE email = ?";
const reset = db.prepare(resetSql);
reset.run(bcrypt.hashSync("123456", 10), "zhangsan@xiangtai.com");
reset.run(bcrypt.hashSync("123456", 10), "lisi@client.com");
db.close();

const server = spawn(
  process.execPath,
  ["node_modules/next/dist/bin/next", "dev", "--hostname", "127.0.0.1", "--port", String(port)],
  {
    cwd: projectRoot,
    env: {
      ...process.env,
      DB_PATH: dbPath,
      JWT_SECRET: "password-enforcement-test-secret-that-is-long-enough",
    },
    stdio: ["ignore", "pipe", "pipe"],
  }
);

for (const stream of [server.stdout, server.stderr]) {
  stream.on("data", (chunk) => {
    logs.push(String(chunk));
    if (logs.length > 100) logs.shift();
  });
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
  console.log(`PASS ${message}`);
}

async function jsonRequest(url, options = {}) {
  const response = await fetch(baseUrl + url, options);
  const data = await response.json().catch(() => ({}));
  return { response, data };
}

function bearer(token) {
  return { Authorization: `Bearer ${token}` };
}

function decodeToken(token) {
  return JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
}

async function loginInternal(email, password, remember = false) {
  return jsonRequest("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, remember }),
  });
}

async function loginExternal(email, password, remember = false) {
  return jsonRequest("/api/external/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, remember }),
  });
}

async function waitForServer() {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) throw new Error("测试服务提前退出");
    try {
      const result = await loginInternal("zhangsan@xiangtai.com", "123456");
      if (result.response.status !== 500) return result;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error("等待测试服务启动超时");
}

async function changePassword(token, currentPassword, newPassword) {
  return jsonRequest("/api/auth/change-password", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...bearer(token) },
    body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }),
  });
}

async function run() {
  const mixedPassword = "湘泰-Admin-2026!";
  const firstLogin = await waitForServer();
  assert(firstLogin.response.ok, "内部账号可以用临时密码登录到改密流程");
  assert(firstLogin.data.must_change_password === true, "内部登录返回必须改密标记");
  assert(typeof firstLogin.data.token === "string", "内部登录签发仅供改密的凭证");
  const tokenPayload = decodeToken(firstLogin.data.token);
  assert(Number.isInteger(tokenPayload.authVersion), `内部登录凭证带有版本号（${JSON.stringify(tokenPayload)}）`);

  const blockedInternal = await jsonRequest("/api/orders", { headers: bearer(firstLogin.data.token) });
  assert(!blockedInternal.response.ok, "内部账号改密前无法直接访问业务接口");

  const oversizedChinese = await changePassword(firstLogin.data.token, "123456", "密".repeat(25));
  assert(
    oversizedChinese.response.status === 400 && /72\s*字节/.test(oversizedChinese.data.error || ""),
    "75 字节的中文密码会被明确提示超过 bcrypt 的 72 字节限制"
  );

  const changedInternal = await changePassword(firstLogin.data.token, "123456", mixedPassword);
  assert(changedInternal.response.ok, `内部账号可以完成强制改密（${changedInternal.response.status} ${JSON.stringify(changedInternal.data)}）`);

  const staleInternal = await jsonRequest("/api/orders", { headers: bearer(firstLogin.data.token) });
  assert(!staleInternal.response.ok, "内部账号改密前签发的旧凭证已经失效");

  let freshInternal = await loginInternal("zhangsan@xiangtai.com", mixedPassword);
  assert(freshInternal.response.ok && freshInternal.data.must_change_password === false, "内部账号可以用正常长度的中英文混合密码重新登录");
  const allowedInternal = await jsonRequest("/api/orders", { headers: bearer(freshInternal.data.token) });
  assert(allowedInternal.response.ok, "内部账号改密并重新登录后可以访问业务接口");

  for (let attempt = 1; attempt <= 4; attempt += 1) {
    const wrong = await loginInternal("zhangsan@xiangtai.com", "Wrong-Password!");
    assert(wrong.response.status === 401, `内部账号第 ${attempt} 次输错密码仍返回普通认证失败`);
  }
  const lockedOnFifth = await loginInternal("zhangsan@xiangtai.com", "Wrong-Password!");
  assert(
    lockedOnFifth.response.status === 429 && /稍后再试/.test(lockedOnFifth.data.error || ""),
    "内部账号第 5 次连续输错后被临时锁定并收到明确提示"
  );
  const correctWhileLocked = await loginInternal("zhangsan@xiangtai.com", mixedPassword);
  assert(correctWhileLocked.response.status === 429, "锁定期内即使密码正确也不能登录");

  const unlockDb = new Database(dbPath);
  unlockDb.prepare(
    "UPDATE employees SET locked_until = ? WHERE email = ?"
  ).run(Date.now() - 1, "zhangsan@xiangtai.com");
  unlockDb.close();
  freshInternal = await loginInternal("zhangsan@xiangtai.com", mixedPassword);
  assert(freshInternal.response.ok, "锁定时间结束后可以用正确密码正常登录");

  const sessionPayload = decodeToken(freshInternal.data.token);
  assert(sessionPayload.exp - sessionPayload.iat <= 12 * 60 * 60, "未勾选记住我时签发短期会话凭证");
  const rememberedInternal = await loginInternal("zhangsan@xiangtai.com", mixedPassword, true);
  const rememberedPayload = decodeToken(rememberedInternal.data.token);
  assert(rememberedPayload.exp - rememberedPayload.iat >= 30 * 24 * 60 * 60, "勾选记住我时签发 30 天长期凭证");

  const employees = await jsonRequest("/api/employees", { headers: bearer(freshInternal.data.token) });
  const client = Array.isArray(employees.data)
    ? employees.data.find((employee) => employee.email === "lisi@client.com")
    : null;
  assert(client, "找到用于外部登录验证的客户账号");

  const resetClient = await jsonRequest("/api/employees", {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...bearer(freshInternal.data.token) },
    body: JSON.stringify({ id: client.id, password: "Client-Temp-2026!" }),
  });
  assert(resetClient.response.ok, "管理员可以重置客户密码");

  const externalLogin = await loginExternal("lisi@client.com", "Client-Temp-2026!");
  assert(externalLogin.response.ok, "外部客户可以用重置后的临时密码登录到改密流程");
  assert(externalLogin.data.must_change_password === true, "外部客户登录返回必须改密标记");

  const blockedExternal = await jsonRequest("/api/external/orders", { headers: bearer(externalLogin.data.token) });
  assert(!blockedExternal.response.ok, "外部客户改密前无法访问外部业务接口");

  const changedExternal = await changePassword(externalLogin.data.token, "Client-Temp-2026!", "Client-New-2026!");
  assert(changedExternal.response.ok, "外部客户可以完成强制改密");

  const staleExternal = await jsonRequest("/api/external/orders", { headers: bearer(externalLogin.data.token) });
  assert(!staleExternal.response.ok, "外部客户改密前签发的旧凭证已经失效");

  const freshExternal = await loginExternal("lisi@client.com", "Client-New-2026!");
  assert(freshExternal.response.ok && freshExternal.data.must_change_password === false, "外部客户用新密码重新登录");
  const allowedExternal = await jsonRequest("/api/external/orders", { headers: bearer(freshExternal.data.token) });
  assert(allowedExternal.response.ok, "外部客户改密并重新登录后可以访问外部业务接口");
}

run()
  .catch((error) => {
    console.error(`FAIL ${error.message}`);
    console.error(logs.join("").slice(-6000));
    process.exitCode = 1;
  })
  .finally(() => {
    server.kill("SIGTERM");
    fs.rmSync(tempDir, { recursive: true, force: true });
  });
