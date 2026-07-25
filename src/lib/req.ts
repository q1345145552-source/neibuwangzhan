import { NextRequest } from "next/server";

/**
 * 安全读取请求体 JSON。
 *
 * 直接 `await req.json()` 在请求体为空或不是合法 JSON 时会抛异常，
 * Next.js 把它变成一个没有任何说明的 500——客户端很难判断是自己发错了还是服务端挂了。
 * 这里统一返回空对象，让后续的字段校验去给出 400 和具体原因。
 */
// 返回类型保持和原来的 `await req.json()` 一致（any），
// 这样替换调用点时不会引入一堆类型报错；字段校验仍由各路由自己做。
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function readJson(req: NextRequest): Promise<any> {
  try {
    const body = await req.json();
    return body && typeof body === "object" ? body : {};
  } catch {
    return {};
  }
}
