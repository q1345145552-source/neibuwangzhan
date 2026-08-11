const CACHE_NAME = "xiangtai-v4-" + Date.now();

// API 请求不拦截
function isApiRequest(url) {
  return url.pathname.startsWith("/api/");
}

// 只缓存静态资源文件，不缓存页面 HTML
function isStaticAsset(url) {
  var ext = url.pathname.split(".").pop();
  if (!ext) return false;
  ext = ext.toLowerCase();
  var exts = ["js","css","png","jpg","jpeg","gif","svg","ico","woff","woff2","ttf","eot","webp","avif","mp3","mp4","json","xml"];
  return exts.indexOf(ext) !== -1;
}

self.addEventListener("install", function(event) {
  self.skipWaiting();
});

self.addEventListener("activate", function(event) {
  event.waitUntil(
    caches.keys().then(function(names) {
      return Promise.all(names.map(function(n) { return caches.delete(n); }));
    })
  );
  event.waitUntil(clients.claim());
});

self.addEventListener("fetch", function(event) {
  try {
    var url = new URL(event.request.url);
    if (event.request.method !== "GET") return;
    if (isApiRequest(url)) return;
    // 页面请求直接放行，不做任何拦截
    if (!isStaticAsset(url)) return;

    // 静态资源：网络优先，失败降级缓存
    event.respondWith(
      fetch(event.request).then(function(response) {
        if (response.ok) {
          var clone = response.clone();
          caches.open(CACHE_NAME).then(function(cache) { cache.put(event.request, clone); });
        }
        return response;
      }).catch(function() {
        return caches.match(event.request);
      })
    );
  } catch (e) {
    // SW 内部异常时直接放行，不拦截页面
    return;
  }
});
