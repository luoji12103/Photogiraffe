// Photogiraffe Service Worker — v6.2
// Strategy:
//   - Static assets (/_next/static, /icons): Cache First (immutable)
//   - Proxy images (/api/image): Cache First with 7-day TTL
//   - Auth endpoints (/api/auth): Network Only (never cache)
//   - Other API calls: Network First, fall back to cache
//   - Navigation: Network First, fall back to cached offline page

const CACHE_VERSION = "v6.2";
const STATIC_CACHE = `pg-static-${CACHE_VERSION}`;
const IMAGE_CACHE = `pg-images-${CACHE_VERSION}`;
const API_CACHE = `pg-api-${CACHE_VERSION}`;

const STATIC_ASSETS = [
  "/",
  "/manifest.json",
  "/icons/icon.svg",
];

// ── Install ──────────────────────────────────────────────────────────────────
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) =>
      cache.addAll(STATIC_ASSETS).catch(() => {
        // Non-critical: don't fail install if offline during first install
      })
    )
  );
  self.skipWaiting();
});

// ── Activate ─────────────────────────────────────────────────────────────────
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k.startsWith("pg-") && ![STATIC_CACHE, IMAGE_CACHE, API_CACHE].includes(k))
          .map((k) => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

// ── Fetch ─────────────────────────────────────────────────────────────────────
self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET or chrome-extension
  if (request.method !== "GET" || url.protocol === "chrome-extension:") return;

  // Never cache auth endpoints
  if (url.pathname.startsWith("/api/auth/")) {
    return; // pass through
  }

  // Proxy images — Cache First (long-lived MinIO presigned URLs)
  if (url.pathname.startsWith("/api/image")) {
    event.respondWith(cacheFirst(request, IMAGE_CACHE, 7 * 24 * 60 * 60));
    return;
  }

  // Next.js static assets — Cache First (immutable hashed filenames)
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(cacheFirst(request, STATIC_CACHE));
    return;
  }

  // Other API calls — Network First
  if (url.pathname.startsWith("/api/")) {
    event.respondWith(networkFirst(request, API_CACHE));
    return;
  }

  // Navigation / HTML — Network First
  if (request.mode === "navigate") {
    event.respondWith(networkFirst(request, STATIC_CACHE));
    return;
  }
});

// ── Strategies ────────────────────────────────────────────────────────────────

async function cacheFirst(request, cacheName, ttlSeconds) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) {
    // Check TTL if set
    if (ttlSeconds) {
      const cachedDate = cached.headers.get("sw-cached-at");
      if (cachedDate) {
        const age = (Date.now() - Number(cachedDate)) / 1000;
        if (age > ttlSeconds) {
          // Stale — revalidate in background
          fetchAndCache(request, cache).catch(() => {});
        }
      }
    }
    return cached;
  }
  return fetchAndCache(request, cache);
}

async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    if (response.ok) {
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await cache.match(request);
    if (cached) return cached;
    // Offline fallback for navigation
    if (request.mode === "navigate") {
      const offlinePage = await cache.match("/");
      if (offlinePage) return offlinePage;
    }
    throw new Error("Network error and no cache available");
  }
}

async function fetchAndCache(request, cache) {
  const response = await fetch(request);
  if (response.ok) {
    // Add timestamp header for TTL tracking
    const headers = new Headers(response.headers);
    headers.set("sw-cached-at", String(Date.now()));
    const cloned = new Response(await response.clone().arrayBuffer(), {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
    cache.put(request, cloned);
  }
  return response;
}
