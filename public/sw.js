const VERSION = '4.2.3';
const CACHE = `eldervale-app-${VERSION}`;
const ROOT = '/Eldervale/';
const CORE = [
  ROOT,
  `${ROOT}manifest.webmanifest`,
  `${ROOT}crest.svg`,
  `${ROOT}icon-192.png`,
  `${ROOT}icon-512.png`,
  `${ROOT}icon-maskable-512.png`,
  `${ROOT}apple-touch-icon.png`,
  `${ROOT}favicon.ico`,
  `${ROOT}repair.html`,
];

self.addEventListener('install', event => {
  event.waitUntil(cacheApplicationShell());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys
      .filter(key => key.startsWith('eldervale-') && key !== CACHE)
      .map(key => caches.delete(key)));
    await self.clients.claim();
    await cacheApplicationShell();
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of clients) client.postMessage({ type: 'ОФЛАЙН_ГОТОВ', version: VERSION });
  })());
});

self.addEventListener('message', event => {
  if (event.data?.type === 'ПРИМЕНИТЬ_ОБНОВЛЕНИЕ') {
    event.waitUntil(self.skipWaiting());
    return;
  }
  if (event.data?.type === 'ПОДГОТОВИТЬ_ОФЛАЙН') {
    event.waitUntil(cacheApplicationShell());
  }
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin || !url.pathname.startsWith(ROOT)) return;

  if (url.pathname.endsWith('/sw.js')) {
    event.respondWith(fetch(request, { cache: 'no-store' }));
    return;
  }

  if (url.pathname.endsWith('/version.json')) {
    event.respondWith(networkFirst(request, false));
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(networkFirstNavigation(request));
    return;
  }

  if (url.pathname.includes('/assets/') || isIconOrManifest(url.pathname)) {
    event.respondWith(cacheFirst(request));
    return;
  }

  event.respondWith(staleWhileRevalidate(request));
});

async function cacheApplicationShell() {
  const cache = await caches.open(CACHE);
  await Promise.all(CORE.map(async url => {
    try {
      const response = await fetch(url, { cache: 'reload' });
      if (response.ok) await cache.put(url, response.clone());
    } catch {
      // Уже сохранённая копия остаётся рабочей.
    }
  }));

  try {
    const response = await fetch(ROOT, { cache: 'reload' });
    if (!response.ok) return;
    const html = await response.clone().text();
    await cache.put(ROOT, response);
    const assets = extractLocalAssets(html);
    await Promise.all(assets.map(async url => {
      try {
        const asset = await fetch(url, { cache: 'reload' });
        if (asset.ok) await cache.put(url, asset.clone());
      } catch {
        // Один необязательный файл не должен ломать весь офлайн-кэш.
      }
    }));
  } catch {
    // Первый офлайн-запуск возможен только после хотя бы одного онлайн-запуска.
  }
}

function extractLocalAssets(html) {
  const assets = new Set();
  const pattern = /(?:src|href)=["']([^"']+)["']/g;
  for (const match of html.matchAll(pattern)) {
    const value = match[1];
    if (!value || value.startsWith('http') || value.startsWith('data:')) continue;
    assets.add(new URL(value, self.location.origin + ROOT).toString());
  }
  return [...assets];
}

function isIconOrManifest(pathname) {
  return pathname.endsWith('.png') || pathname.endsWith('.svg') || pathname.endsWith('.ico') || pathname.endsWith('.webmanifest');
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) (await caches.open(CACHE)).put(request, response.clone());
  return response;
}

async function staleWhileRevalidate(request) {
  const cached = await caches.match(request);
  const network = fetch(request).then(async response => {
    if (response.ok) await (await caches.open(CACHE)).put(request, response.clone());
    return response;
  }).catch(() => undefined);
  return cached ?? await network ?? new Response('Офлайн-копия недоступна', { status: 503 });
}

async function networkFirst(request, fallbackToRoot = true) {
  try {
    const response = await fetch(request, { cache: 'no-store' });
    if (response.ok) await (await caches.open(CACHE)).put(request, response.clone());
    return response;
  } catch {
    return await caches.match(request) ?? (fallbackToRoot ? await caches.match(ROOT) : undefined) ?? new Response('Сеть недоступна', { status: 503 });
  }
}

async function networkFirstNavigation(request) {
  try {
    const response = await fetch(request, { cache: 'no-store' });
    if (response.ok) await (await caches.open(CACHE)).put(ROOT, response.clone());
    return response;
  } catch {
    return await caches.match(ROOT) ?? new Response('Eldervale ещё не подготовлен для офлайн-запуска', { status: 503 });
  }
}
