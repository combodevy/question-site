/**
 * @file sw.js
 * @description Service Worker for offline cold-start and PWA caching
 */

const CACHE_NAME = 'qs-cache-v2';

const STATIC_PRECACHE = [
    './',
    './index.html',
    './config.js',
    './manifest.json',
    './css/tailwind.css',
    './fonts/inter-var.woff2',
    './js/vendor/pinyin-pro.min.js',
    './js/app.js',
    './js/dom.js',
    './js/prefs.js',
    './js/db.js',
    './js/router.js',
    './js/auth.js',
    './js/utils.js',
    './js/i18n.js',
    './js/data.js',
    './js/quiz.js',
    './js/chart.js',
    './js/ui.js',
    './js/views/dashboard.js',
    './js/views/setup.js',
    './js/views/library.js',
    './js/views/profile.js',
    './js/views/analytics.js',
    './js/views/english.js'
];

self.addEventListener('install', (event) => {
    self.skipWaiting();
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.addAll(STATIC_PRECACHE).catch((err) => {
                console.warn('[SW] Pre-cache partial failure:', err);
            });
        })
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) => {
            return Promise.all(
                keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
            );
        }).then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (event) => {
    const req = event.request;
    if (req.method !== 'GET') return;

    const url = new URL(req.url);

    // 1. API 接口与版本检查永远走网络，不进入 Service Worker 缓存
    if (url.pathname.startsWith('/api/') || url.pathname.endsWith('/version.json')) {
        return;
    }

    // 2. 页面导航请求（离线时回退到缓存的 index.html；管理后台离线不回退主站首页）
    if (req.mode === 'navigate') {
        event.respondWith(
            fetch(req).catch(async () => {
                if (url.pathname.endsWith('/admin.html') || url.pathname === '/admin') {
                    return (await caches.match(req)) || new Response('Offline', {
                        status: 503,
                        headers: { 'Content-Type': 'text/plain; charset=utf-8' }
                    });
                }
                return (await caches.match('./index.html'))
                    || (await caches.match('/index.html'))
                    || new Response('Offline', {
                        status: 503,
                        headers: { 'Content-Type': 'text/plain; charset=utf-8' }
                    });
            })
        );
        return;
    }

    // 3. 静态资源采用 Stale-While-Revalidate（即刻从缓存响应，后台静默拉取更新）
    event.respondWith(
        caches.open(CACHE_NAME).then(async (cache) => {
            const cachedResponse = await cache.match(req);
            const fetchPromise = fetch(req).then((networkResponse) => {
                if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
                    cache.put(req, networkResponse.clone());
                }
                return networkResponse;
            }).catch(() => null);

            return cachedResponse || (await fetchPromise) || new Response('', { status: 504 });
        })
    );
});
