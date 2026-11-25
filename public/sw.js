// Service Worker for Chathassan Pro (شات حسان برو)
// Strategy: Background Socket & Presence Persistence + Background/Periodic Sync + Notifications

const SW_CACHE_VERSION = 'chathassan-shell-v7';
const SW_MEDIA_CACHE = 'chathassan-media-v5';
const SW_ALLOWED_CACHES = new Set([SW_CACHE_VERSION, SW_MEDIA_CACHE]);
const MAX_SHELL_CACHE_ENTRIES = 40;
const MAX_MEDIA_CACHE_ENTRIES = 60;
const MAX_MEDIA_CACHE_BYTES = 300 * 1024; // 300 KB max per cached avatar/emblem/icon
const MAX_SHELL_CACHE_BYTES = 2 * 1024 * 1024; // 2 MB max per static asset
const IDB_NAME = 'chathassan_sw_db';
const IDB_VERSION = 1;
const IDB_STORE = 'session';
const SESSION_KEY = 'active';
const PRESENCE_SYNC_TAG = 'chathassan-presence-sync';
const PERIODIC_SYNC_TAG = 'chathassan-presence-keepalive';

const swChannel =
  typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('chathassan_sw_channel') : null;

let cachedSession = null;
let activeLeasePromise = null;
let leaseAbortRequested = false;

function openSessionDb() {
  return new Promise((resolve, reject) => {
    try {
      const req = indexedDB.open(IDB_NAME, IDB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(IDB_STORE)) {
          db.createObjectStore(IDB_STORE, { keyPath: 'key' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    } catch (err) {
      reject(err);
    }
  });
}

async function readStoredSession() {
  if (cachedSession && cachedSession.sessionToken) {
    return cachedSession;
  }
  try {
    const db = await openSessionDb();
    return await new Promise((resolve) => {
      const tx = db.transaction(IDB_STORE, 'readonly');
      const store = tx.objectStore(IDB_STORE);
      const req = store.get(SESSION_KEY);
      req.onsuccess = () => {
        const val = req.result || null;
        cachedSession = val;
        resolve(val);
      };
      req.onerror = () => resolve(null);
      tx.oncomplete = () => {
        try {
          db.close();
        } catch {}
      };
    });
  } catch {
    return cachedSession;
  }
}

async function writeStoredSession(patch) {
  const existing = (await readStoredSession()) || {};
  const next = {
    ...existing,
    ...patch,
    key: SESSION_KEY,
    updatedAt: Date.now()
  };
  cachedSession = next;
  try {
    const db = await openSessionDb();
    await new Promise((resolve) => {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      const store = tx.objectStore(IDB_STORE);
      store.put(next);
      tx.oncomplete = () => {
        try {
          db.close();
        } catch {}
        resolve();
      };
      tx.onerror = () => resolve();
    });
  } catch {}
  return next;
}

async function clearStoredSession() {
  cachedSession = null;
  leaseAbortRequested = true;
  try {
    const db = await openSessionDb();
    await new Promise((resolve) => {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      const store = tx.objectStore(IDB_STORE);
      store.delete(SESSION_KEY);
      tx.oncomplete = () => {
        try {
          db.close();
        } catch {}
        resolve();
      };
      tx.onerror = () => resolve();
    });
  } catch {}
}

async function broadcastToClients(message) {
  if (swChannel) {
    try {
      swChannel.postMessage(message);
    } catch {}
  }
  try {
    const clientsList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (let i = 0; i < clientsList.length; i++) {
      try {
        clientsList[i].postMessage(message);
      } catch {}
    }
  } catch {}
}

async function performPresenceHeartbeat(source = 'sw') {
  const session = await readStoredSession();
  if (!session || !session.sessionToken || !session.username) {
    return { ok: false, noSession: true };
  }

  const origin = (session.apiOrigin || self.location.origin || '').replace(/\/$/, '');
  const endpoint = `${origin}/api/presence-heartbeat`;

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      cache: 'no-store',
      keepalive: true,
      body: JSON.stringify({
        sessionToken: session.sessionToken,
        username: session.username,
        room: session.room || 'الغرفة العامة',
        keepOnline: session.keepOnline !== false,
        socketConnected: Boolean(session.socketConnected),
        source
      })
    });

    if (!response.ok) {
      return { ok: false, status: response.status };
    }

    const data = await response.json().catch(() => ({}));
    if (data && data.loggedOut) {
      await clearStoredSession();
      return { ok: false, loggedOut: true };
    }

    await writeStoredSession({ lastHeartbeatAt: Date.now() });

    // If a window client is still open in the background/suspended state and the server
    // reports the socket dropped, wake the client so it immediately reconnects Socket.IO.
    if (data && data.activeSocketAlive === false) {
      await broadcastToClients({
        type: 'SW_RECONNECT_SOCKET',
        source,
        ts: Date.now()
      });
    }

    return { ok: true, ...data };
  } catch {
    // Offline or flaky radio: schedule Background Sync to retry as soon as network returns
    if (self.registration && self.registration.sync) {
      try {
        await self.registration.sync.register(PRESENCE_SYNC_TAG);
      } catch {}
    }
    return { ok: false, networkError: true };
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Maintains an extendable waitUntil lease when the page transitions to background or closes,
 * pulsing /api/presence-heartbeat so the user's 'online' state persists even if the mobile
 * browser suspends the page's timers or disconnects the foreground WebSocket.
 */
function runExtendedBackgroundLease(source = 'sw-lease') {
  if (activeLeasePromise) {
    return activeLeasePromise;
  }
  leaseAbortRequested = false;

  activeLeasePromise = (async () => {
    try {
      const firstResult = await performPresenceHeartbeat(source);
      if (firstResult && firstResult.loggedOut) return;

      // Pulse within OS-permitted SW execution window (up to ~4.5 mins max per wake cycle)
      const maxCycles = 12;
      for (let i = 0; i < maxCycles; i++) {
        if (leaseAbortRequested) break;
        await sleep(20000);
        if (leaseAbortRequested) break;

        const sess = await readStoredSession();
        if (!sess || !sess.sessionToken || sess.keepOnline === false) break;

        // If a visible foreground client already reclaimed control and has a live socket,
        // stop this extra lease loop gracefully (the foreground Web Worker drives pings).
        const clientsList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
        const hasVisibleClient = clientsList.some((c) => c.visibilityState === 'visible');
        if (hasVisibleClient && sess.socketConnected) {
          break;
        }

        const res = await performPresenceHeartbeat(`${source}-tick-${i + 1}`);
        if (res && res.loggedOut) break;
      }
    } finally {
      activeLeasePromise = null;
    }
  })();

  return activeLeasePromise;
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SW_CACHE_VERSION)
      .then((cache) => cache.addAll(['/manifest.webmanifest', '/favicon.svg']).catch(() => {}))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((cacheNames) =>
        Promise.all(
          cacheNames
            .filter((name) => !SW_ALLOWED_CACHES.has(name))
            .map((name) => caches.delete(name))
        )
      )
      .then(() => pruneCacheIfNeeded(SW_CACHE_VERSION, MAX_SHELL_CACHE_ENTRIES))
      .then(() => pruneCacheIfNeeded(SW_MEDIA_CACHE, MAX_MEDIA_CACHE_ENTRIES))
      .then(() => readStoredSession())
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  const data = event.data || {};
  const type = data.type;

  if (type === 'REGISTER_SESSION') {
    leaseAbortRequested = false;
    event.waitUntil(
      writeStoredSession({
        sessionToken: data.sessionToken,
        username: data.username,
        room: data.room || 'الغرفة العامة',
        apiOrigin: data.apiOrigin || self.location.origin,
        keepOnline: data.keepOnline !== false,
        socketConnected: data.socketConnected !== false,
        appVisible: data.appVisible !== false
      }).then(() => performPresenceHeartbeat('register'))
    );
    return;
  }

  if (type === 'UPDATE_SESSION_PRESENCE') {
    event.waitUntil(
      writeStoredSession({
        ...(data.room ? { room: data.room } : {}),
        ...(typeof data.keepOnline === 'boolean' ? { keepOnline: data.keepOnline } : {}),
        ...(typeof data.socketConnected === 'boolean' ? { socketConnected: data.socketConnected } : {}),
        ...(typeof data.appVisible === 'boolean' ? { appVisible: data.appVisible } : {})
      })
    );
    return;
  }

  if (type === 'CLEAR_SESSION') {
    event.waitUntil(clearStoredSession());
    return;
  }

  if (type === 'KEEP_ALIVE_PING') {
    event.waitUntil(
      (async () => {
        if (typeof data.socketConnected === 'boolean' || data.room) {
          await writeStoredSession({
            ...(data.room ? { room: data.room } : {}),
            ...(typeof data.socketConnected === 'boolean' ? { socketConnected: data.socketConnected } : {})
          });
        }
        const result = await performPresenceHeartbeat(data.source || 'keepalive-ping');
        if (event.ports && event.ports[0]) {
          try {
            event.ports[0].postMessage({ ...result, ts: Date.now() });
          } catch {}
        }
      })()
    );
    return;
  }

  if (type === 'APP_BACKGROUNDED' || type === 'APP_CLOSING') {
    const isClosing = type === 'APP_CLOSING';
    event.waitUntil(
      writeStoredSession({
        appVisible: false,
        socketConnected: isClosing ? false : Boolean(data.socketConnected),
        ...(data.room ? { room: data.room } : {})
      }).then(() => runExtendedBackgroundLease(isClosing ? 'sw-closing' : 'sw-background'))
    );
  }
});

if (swChannel) {
  swChannel.onmessage = (event) => {
    const data = event.data || {};
    if (data.type === 'REGISTER_SESSION') {
      writeStoredSession({
        sessionToken: data.sessionToken,
        username: data.username,
        room: data.room || 'الغرفة العامة',
        apiOrigin: data.apiOrigin || self.location.origin,
        keepOnline: data.keepOnline !== false,
        socketConnected: data.socketConnected !== false
      }).then(() => performPresenceHeartbeat('bc-register'));
    } else if (data.type === 'CLEAR_SESSION') {
      clearStoredSession();
    } else if (data.type === 'APP_BACKGROUNDED' || data.type === 'APP_CLOSING') {
      runExtendedBackgroundLease(data.type === 'APP_CLOSING' ? 'bc-closing' : 'bc-background');
    }
  };
}

// Background Sync: Fires when connectivity stabilizes or OS wakes background tasks
self.addEventListener('sync', (event) => {
  if (event.tag === PRESENCE_SYNC_TAG) {
    event.waitUntil(runExtendedBackgroundLease('bg-sync'));
  }
});

// Periodic Background Sync: Fires periodically on installed mobile PWAs even when chat isn't open
self.addEventListener('periodicsync', (event) => {
  if (event.tag === PERIODIC_SYNC_TAG) {
    event.waitUntil(performPresenceHeartbeat('periodic-sync'));
  }
});

async function pruneCacheIfNeeded(cacheName, maxEntries) {
  try {
    const cache = await caches.open(cacheName);
    const keys = await cache.keys();
    if (keys.length > maxEntries) {
      const removeCount = keys.length - maxEntries;
      await Promise.all(keys.slice(0, removeCount).map((key) => cache.delete(key)));
    }
  } catch {}
}

function isSafeCacheableResponse(res, maxBytes) {
  // Never store opaque cross-origin responses (Chrome pads each opaque entry by ~7-14 MB in quota!).
  if (!res || !res.ok || res.status !== 200 || res.type === 'opaque') {
    return false;
  }
  const lenHeader = res.headers && res.headers.get('content-length');
  if (lenHeader) {
    const bytes = Number(lenHeader);
    if (Number.isFinite(bytes) && bytes > maxBytes) {
      return false;
    }
  }
  return true;
}

function isMediaStreamRequest(req, url) {
  if (req.headers.has('range')) return true;
  if (req.destination === 'video' || req.destination === 'audio') return true;
  return /\.(mp4|webm|mov|m4v|3gp|mkv|avi|mp3|m4a|wav|ogg|aac|opus|flac)(\?|#|$)/i.test(url.pathname);
}

function isHashedStaticAsset(url) {
  if (url.origin === self.location.origin) {
    return (
      url.pathname.startsWith('/assets/') ||
      /\.(woff2?|ttf|otf)(\?|#|$)/i.test(url.pathname)
    );
  }
  return (
    url.hostname === 'fonts.gstatic.com' ||
    url.hostname === 'fonts.googleapis.com'
  );
}

function isCacheableImage(req, url) {
  const pathLower = url.pathname.toLowerCase();
  // Never cache animated GIFs or arbitrary chat photo uploads to keep browser storage minimal
  if (/\.gif(\?|#|$)/i.test(pathLower)) return false;

  if (url.origin === self.location.origin) {
    // Only cache essential UI icons, PWA assets, emblems, and small avatar paths
    if (
      pathLower === '/favicon.svg' ||
      pathLower === '/apple-touch-icon.png' ||
      pathLower.startsWith('/pwa-') ||
      pathLower.startsWith('/assets/') ||
      pathLower.startsWith('/icons/') ||
      pathLower.startsWith('/emblems/')
    ) {
      return /\.(png|jpe?g|webp|svg|ico|avif)(\?|#|$)/i.test(pathLower);
    }
    if (pathLower.startsWith('/uploads/')) {
      // Cache only explicit small avatar/emblem/badge/emoji assets on same-origin uploads
      return /(avatar|emblem|emoji|badge|icon|logo)/i.test(pathLower) && /\.(png|jpe?g|webp|svg|avif)(\?|#|$)/i.test(pathLower);
    }
    return false;
  }

  // Only cache small Cloudinary avatar/emblem/badge/emoji assets (skip full chat photos and videos)
  if (url.hostname === 'res.cloudinary.com' && url.pathname.includes('/image/upload/')) {
    return (
      /(avatar|emblem|emoji|badge|icon|logo|w_64|w_80|w_96|w_120|w_128|w_150|w_160|w_180|w_200)/i.test(url.pathname) &&
      !/\.gif(\?|#|$)/i.test(pathLower)
    );
  }
  return false;
}

// Layered Smart Caching:
// 1. Cache-First for same-origin hashed JS/CSS/Font bundles (pruned to MAX_SHELL_CACHE_ENTRIES)
// 2. Strict Cache-First for immutable /uploads/, banners, avatars, emblems, and CORS-safe images
// 3. Network-First for HTML navigation & manifest
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  let url;
  try {
    url = new URL(req.url);
  } catch {
    return;
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;
  if (isMediaStreamRequest(req, url)) return;

  if (url.origin === self.location.origin) {
    if (
      url.pathname.startsWith('/api/') ||
      url.pathname.startsWith('/socket.io/') ||
      url.pathname === '/sw.js'
    ) {
      return;
    }
  } else if (!isHashedStaticAsset(url) && !isCacheableImage(req, url)) {
    return;
  }

  // Strategy A: Cache-First for immutable hashed JS/CSS bundles & CORS Fonts
  if (isHashedStaticAsset(url)) {
    event.respondWith(
      caches.open(SW_CACHE_VERSION).then(async (cache) => {
        const cached = await cache.match(req);
        if (cached) return cached;
        const res = await fetch(req);
        if (isSafeCacheableResponse(res, MAX_SHELL_CACHE_BYTES)) {
          cache
            .put(req, res.clone())
            .then(() => pruneCacheIfNeeded(SW_CACHE_VERSION, MAX_SHELL_CACHE_ENTRIES))
            .catch(() => {});
        }
        return res;
      })
    );
    return;
  }

  // Strategy B: Lightweight Cache for essential small icons, emblems & avatars (<= 300 KB, max 60 entries)
  if (isCacheableImage(req, url)) {
    event.respondWith(
      caches.open(SW_MEDIA_CACHE).then(async (cache) => {
        const cached = await cache.match(req);
        if (cached) {
          return cached;
        }
        try {
          const netRes = await fetch(req);
          if (isSafeCacheableResponse(netRes, MAX_MEDIA_CACHE_BYTES)) {
            const lenHeader = netRes.headers && netRes.headers.get('content-length');
            const knownBytes = lenHeader ? Number(lenHeader) : NaN;
            if (Number.isFinite(knownBytes) && knownBytes > 0 && knownBytes <= MAX_MEDIA_CACHE_BYTES) {
              cache
                .put(req, netRes.clone())
                .then(() => pruneCacheIfNeeded(SW_MEDIA_CACHE, MAX_MEDIA_CACHE_ENTRIES))
                .catch(() => {});
            } else {
              const resForSizeCheck = netRes.clone();
              const cachedStatus = netRes.status;
              const cachedStatusText = netRes.statusText;
              const cachedHeaders = new Headers(netRes.headers);
              resForSizeCheck
                .arrayBuffer()
                .then((buf) => {
                  if (buf.byteLength <= MAX_MEDIA_CACHE_BYTES) {
                    const responseToCache = new Response(buf, {
                      status: cachedStatus,
                      statusText: cachedStatusText,
                      headers: cachedHeaders
                    });
                    return cache
                      .put(req, responseToCache)
                      .then(() => pruneCacheIfNeeded(SW_MEDIA_CACHE, MAX_MEDIA_CACHE_ENTRIES));
                  }
                })
                .catch(() => {});
            }
          }
          return netRes;
        } catch {
          return new Response('', { status: 504, statusText: 'Image Unavailable' });
        }
      })
    );
    return;
  }

  // Strategy C: Network-First only for HTML navigation & manifest
  if (url.origin !== self.location.origin) return;
  const shouldCacheDoc = req.mode === 'navigate' || url.pathname === '/manifest.webmanifest';
  if (!shouldCacheDoc) return;

  event.respondWith(
    fetch(req)
      .then((res) => {
        if (isSafeCacheableResponse(res, MAX_SHELL_CACHE_BYTES) && res.type === 'basic') {
          const clone = res.clone();
          caches
            .open(SW_CACHE_VERSION)
            .then((cache) => cache.put(req, clone))
            .then(() => pruneCacheIfNeeded(SW_CACHE_VERSION, MAX_SHELL_CACHE_ENTRIES))
            .catch(() => {});
        }
        return res;
      })
      .catch(async () => {
        const cached = await caches.match(req);
        if (cached) return cached;
        if (req.mode === 'navigate') {
          const fallbackRoot = await caches.match('/');
          if (fallbackRoot) return fallbackRoot;
        }
        return new Response('Offline', { status: 503, statusText: 'Offline' });
      })
  );
});

self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { body: event.data ? event.data.text() : '' };
  }
  const title = payload.title || 'شات حسان برو 💬';
  const options = {
    body: payload.body || 'لديك رسالة جديدة في الدردشة',
    icon: payload.icon || '/pwa-192x192.png',
    badge: '/pwa-192x192.png',
    tag: payload.tag || `chathassan-push-${Date.now()}`,
    renotify: payload.renotify !== false,
    data: payload.data || { url: '/' }
  };
  event.waitUntil(
    Promise.all([
      performPresenceHeartbeat('push'),
      self.registration.showNotification(title, options)
    ])
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  let targetUrl = data.url || '/';
  try {
    const parsedUrl = new URL(targetUrl, self.location.origin);
    if (data.type) parsedUrl.searchParams.set('notif_type', String(data.type));
    if (data.fromUsername) parsedUrl.searchParams.set('notif_from', String(data.fromUsername));
    if (data.room) parsedUrl.searchParams.set('notif_room', String(data.room));
    targetUrl = parsedUrl.toString();
  } catch {}

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async (clientList) => {
      for (let i = 0; i < clientList.length; i++) {
        const client = clientList[i];
        if ('focus' in client) {
          try {
            await client.focus();
          } catch {}
          try {
            client.postMessage({
              type: 'NOTIFICATION_CLICKED',
              data: data
            });
          } catch {}
          return;
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
    })
  );
});
