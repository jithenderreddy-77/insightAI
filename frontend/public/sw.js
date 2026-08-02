// public/sw.js - Production Service Worker for Insight AI PWA
// Provides reliable auto-updates on Vercel redeployment & offline fallback for app shell

const CACHE_NAME = 'insight-ai-pwa-v2';

// 1. Service Worker Installation & Immediate Activation Setup
self.addEventListener('install', (event) => {
  console.log('[PWA SW] Service worker installed.');
  // Activate immediately without waiting for existing tabs to close
  self.skipWaiting();
});

// 2. Service Worker Activation & Old Cache Purging
self.addEventListener('activate', (event) => {
  console.log('[PWA SW] Service worker activating...');
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            console.log('[PWA SW] Purging outdated cache:', key);
            return caches.delete(key);
          }
        })
      );
    }).then(() => {
      console.log('[PWA SW] Claiming clients for instant control.');
      return self.clients.claim();
    })
  );
});

// 3. Skip Waiting Message Listener (for clean user-triggered refresh)
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    console.log('[PWA SW] SKIP_WAITING received — activating new worker');
    self.skipWaiting();
  }
});

// 4. Fetch Event Handler with Network-First Strategy for App Shell
// EXPLICIT SECURITY GUARANTEE: /api/ routes are NEVER cached!
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);

  // CRITICAL EXCLUSION: Skip all API endpoints from service worker caching
  if (url.pathname.startsWith('/api/')) {
    return; // Pass through directly to live network
  }

  // Network-First strategy for app shell assets (HTML, JS, CSS)
  event.respondWith(
    fetch(event.request)
      .then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });
        }
        return networkResponse;
      })
      .catch(async () => {
        // Fallback to cache if completely offline
        const cachedResponse = await caches.match(event.request);
        if (cachedResponse) {
          return cachedResponse;
        }
        // Navigation fallback for root HTML
        if (event.request.mode === 'navigate') {
          return caches.match('/');
        }
        return new Response('Network error', { status: 480, statusText: 'Offline' });
      })
  );
});
