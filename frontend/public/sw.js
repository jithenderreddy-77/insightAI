// public/sw.js - Offline Service Worker for Insight AI PWA

const CACHE_NAME = 'insight-ai-pwa-v1';
const STATIC_ASSETS = [
  '/',
  '/manifest.json',
  '/title.png',
  '/favicon.ico',
];

// 1. Install Service Worker & Cache static assets
self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[PWA SW] Pre-caching static assets for offline use');
      return cache.addAll(STATIC_ASSETS);
    })
  );
});

// 2. Activate Service Worker & Clean old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            console.log('[PWA SW] Removing old cache:', key);
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// 3. Intercept Network Requests with Offline Cache Fallback Strategy
self.addEventListener('fetch', (event) => {
  // Only handle GET requests for offline caching
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);

  // Skip API network calls (like /api/chat or /api/ingest) from static caching
  if (url.pathname.startsWith('/api/')) return;

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        // Return cached asset immediately
        fetch(event.request).then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, networkResponse));
          }
        }).catch(() => {/* Offline fallback */});

        return cachedResponse;
      }

      // Network request with offline cache fallback
      return fetch(event.request)
        .then((response) => {
          if (!response || response.status !== 200 || response.type !== 'basic') {
            return response;
          }
          const responseToCache = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });
          return response;
        })
        .catch(() => {
          // If completely offline and page request, return root cached HTML
          if (event.request.mode === 'navigate') {
            return caches.match('/');
          }
        });
    })
  );
});
