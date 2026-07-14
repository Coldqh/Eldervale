const VERSION = '0.3.0';
const CACHE = `eldervale-app-${VERSION}`;
const ROOT = '/Eldervale/';
const CORE = [ROOT, `${ROOT}manifest.webmanifest`, `${ROOT}crest.svg`, `${ROOT}version.json`];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(CORE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key.startsWith('eldervale-') && key !== CACHE).map(key => caches.delete(key)));
    await self.clients.claim();
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of clients) {
      client.postMessage({ type: 'ВЕРСИЯ_АКТИВИРОВАНА', version: VERSION });
      if ('navigate' in client) client.navigate(client.url);
    }
  })());
});

self.addEventListener('message', event => {
  if (event.data?.type === 'ПРИМЕНИТЬ_ОБНОВЛЕНИЕ') self.skipWaiting();
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.endsWith('/version.json')) {
    event.respondWith(fetch(event.request, { cache: 'no-store' }));
    return;
  }
  event.respondWith((async () => {
    try {
      const response = await fetch(event.request, { cache: 'no-cache' });
      if (response.ok) {
        const cache = await caches.open(CACHE);
        await cache.put(event.request, response.clone());
      }
      return response;
    } catch {
      const cached = await caches.match(event.request);
      if (cached) return cached;
      if (event.request.mode === 'navigate') return (await caches.match(ROOT));
      throw new Error('Ресурс недоступен без сети');
    }
  })());
});
