const CACHE_NAME = "xiangtai-v3-" + Date.now();

// 不缓存任何 API 请求
function isApiRequest(url) {
  return url.pathname.startsWith("/api/");
}

self.addEventListener("install", (event) => {
  // 安装时直接激活，不等待旧 worker 关闭
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  // 清空所有旧缓存
  event.waitUntil(
    caches.keys().then((names) => Promise.all(names.map((n) => caches.delete(n))))
  );
  // 立即接管所有页面
  event.waitUntil(clients.claim());
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET") return;
  if (isApiRequest(url)) return; // API 请求不走缓存

  // 网络优先策略：先走网络，网络失败才用缓存
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.status === 200) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
