// 麻將訓練 PWA service worker。
// 靜態資源(牌面圖/頭像/圖示)用 cache-first(很少變動,離線也能用);
// 網頁本身跟程式碼(index.html/*.js)用 network-first,連得到網路優先抓新版,
// 抓不到才退回快取版本 —— 這樣改版後大部分時候都能拿到最新版,離線時仍然堪用。
// CACHE_VERSION 改版時要記得手動 +1,才會清掉舊快取、避免卡在舊版本。
const CACHE_VERSION = 'v1';
const CACHE_NAME = `majhong-trainer-${CACHE_VERSION}`;

const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './web/style.css',
  './web/app.js',
  './web/play.js',
  './web/match.js',
  './web/practice.js',
  './web/questions.js',
  './src/efficiency.js',
  './src/game.js',
  './src/handNotation.js',
  './src/scoring.js',
  './src/scoringRules.js',
  './src/shanten.js',
  './src/tiles.js',
  './src/tingCheck.js',
  './src/winCheck.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) => Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

function isStaticAsset(url) {
  return /\.(svg|png|jpg|jpeg)$/i.test(url.pathname);
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // 外部資源(字型等)不攔截,交給瀏覽器正常處理

  if (isStaticAsset(url)) {
    // 牌面圖/頭像/圖示:cache-first
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ||
          fetch(request).then((res) => {
            const copy = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
            return res;
          })
      )
    );
    return;
  }

  // 網頁/程式碼:network-first,連得到就用最新的,順便更新快取
  event.respondWith(
    fetch(request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        return res;
      })
      .catch(() => caches.match(request))
  );
});
