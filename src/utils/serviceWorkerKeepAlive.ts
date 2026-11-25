/**
 * Service Worker Background Persistence & Socket Handoff Bridge
 * -------------------------------------------------------------
 * Coordinates between the main React / Socket.IO runtime and /sw.js so that:
 * 1. User session credentials are persisted inside Service Worker IndexedDB.
 * 2. When mobile devices lock screens, switch apps, or suspend/close the chat tab,
 *    the Service Worker keeps pulsing /api/presence-heartbeat + Background Sync +
 *    Periodic Background Sync to preserve the user's 'online' state.
 * 3. If the Service Worker detects the page's WebSocket dropped while a window client
 *    is still resident in memory, it immediately wakes the client to reconnect.
 */

export interface SwSessionPayload {
  sessionToken: string;
  username: string;
  room: string;
  keepOnline?: boolean;
  socketConnected?: boolean;
}

const PRESENCE_SYNC_TAG = 'chathassan-presence-sync';
const PERIODIC_SYNC_TAG = 'chathassan-presence-keepalive';

let swRegistration: ServiceWorkerRegistration | null = null;
let swChannel: BroadcastChannel | null = null;
let swInitialized = false;
let latestSession: SwSessionPayload | null = null;
let onReconnectCallback: (() => void) | null = null;
let lastSwPingAt = 0;

function getApiOrigin(): string {
  const configured =
    (import.meta.env.VITE_SERVER_URL as string)?.trim() ||
    (import.meta.env.VITE_API_URL as string)?.trim() ||
    '';
  if (configured) return configured.replace(/\/$/, '');
  if (typeof window !== 'undefined' && window.location?.origin) {
    return window.location.origin.replace(/\/$/, '');
  }
  return '';
}

function getSwChannel(): BroadcastChannel | null {
  if (swChannel) return swChannel;
  if (typeof BroadcastChannel !== 'undefined') {
    try {
      swChannel = new BroadcastChannel('chathassan_sw_channel');
    } catch {
      swChannel = null;
    }
  }
  return swChannel;
}

async function getReadyRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
    return null;
  }
  if (swRegistration) return swRegistration;
  try {
    const existing = await navigator.serviceWorker.getRegistration('/');
    if (existing) {
      swRegistration = existing;
      return existing;
    }
    const reg = await navigator.serviceWorker.register('/sw.js', {
      scope: '/',
      updateViaCache: 'none'
    });
    swRegistration = reg;
    return reg;
  } catch {
    return null;
  }
}

function postMessageToSw(payload: Record<string, any>, transfer?: Transferable[]): void {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;

  const target =
    navigator.serviceWorker.controller ||
    swRegistration?.active ||
    swRegistration?.waiting ||
    swRegistration?.installing;

  if (target) {
    try {
      if (transfer && transfer.length > 0) {
        target.postMessage(payload, transfer);
      } else {
        target.postMessage(payload);
      }
      return;
    } catch {}
  }

  // Fallback via BroadcastChannel if controller hasn't claimed yet
  if (!transfer || transfer.length === 0) {
    try {
      getSwChannel()?.postMessage(payload);
    } catch {}
  }
}

async function registerBackgroundSyncTags(reg: ServiceWorkerRegistration | null): Promise<void> {
  if (!reg) return;
  try {
    const syncMgr = (reg as any).sync;
    if (syncMgr && typeof syncMgr.register === 'function') {
      await syncMgr.register(PRESENCE_SYNC_TAG).catch(() => {});
    }
  } catch {}

  try {
    const periodicMgr = (reg as any).periodicSync;
    if (periodicMgr && typeof periodicMgr.register === 'function') {
      let granted = true;
      if (typeof navigator !== 'undefined' && navigator.permissions?.query) {
        try {
          const status = await navigator.permissions.query({
            name: 'periodic-background-sync' as PermissionName
          });
          granted = status.state === 'granted';
        } catch {
          // Some browsers allow register() directly on installed PWAs without permissions.query support
        }
      }
      if (granted) {
        await periodicMgr
          .register(PERIODIC_SYNC_TAG, { minInterval: 60 * 1000 })
          .catch(() => {});
      }
    }
  } catch {}
}

export async function initServiceWorkerKeepAlive(options?: {
  onReconnectRequested?: () => void;
}): Promise<ServiceWorkerRegistration | null> {
  if (options?.onReconnectRequested) {
    onReconnectCallback = options.onReconnectRequested;
  }

  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
    return null;
  }

  if (!swInitialized) {
    swInitialized = true;

    const handleSwSignal = (data: any) => {
      if (!data) return;
      if (data.type === 'SW_RECONNECT_SOCKET' && onReconnectCallback) {
        onReconnectCallback();
      }
    };

    navigator.serviceWorker.addEventListener('message', (event) => {
      handleSwSignal(event.data);
    });

    const bc = getSwChannel();
    if (bc) {
      bc.onmessage = (event) => {
        handleSwSignal(event.data);
      };
    }

    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (latestSession) {
        syncServiceWorkerSession(latestSession).catch(() => {});
      }
    });
  }

  try {
    if ('caches' in window) {
      caches
        .keys()
        .then((names) =>
          Promise.all(
            names
              .filter(
                (n) =>
                  n.startsWith('chathassan-') &&
                  n !== 'chathassan-shell-v5' &&
                  n !== 'chathassan-media-v3'
              )
              .map((n) => caches.delete(n))
          )
        )
        .catch(() => {});
    }
    const reg = await navigator.serviceWorker.register('/sw.js', {
      scope: '/',
      updateViaCache: 'none'
    });
    swRegistration = reg;
    reg.update().catch(() => {});

    if (latestSession) {
      await syncServiceWorkerSession(latestSession);
    }
    return reg;
  } catch {
    return null;
  }
}

export async function syncServiceWorkerSession(session: SwSessionPayload): Promise<void> {
  if (!session?.sessionToken || !session?.username) return;
  latestSession = { ...session };

  const reg = await getReadyRegistration();
  postMessageToSw({
    type: 'REGISTER_SESSION',
    sessionToken: session.sessionToken,
    username: session.username,
    room: session.room || 'الغرفة العامة',
    apiOrigin: getApiOrigin(),
    keepOnline: session.keepOnline !== false,
    socketConnected: session.socketConnected !== false,
    appVisible: typeof document !== 'undefined' ? document.visibilityState === 'visible' : true
  });

  await registerBackgroundSyncTags(reg);
}

export function updateServiceWorkerPresence(patch: {
  room?: string;
  keepOnline?: boolean;
  socketConnected?: boolean;
  appVisible?: boolean;
}): void {
  if (latestSession) {
    latestSession = {
      ...latestSession,
      ...(patch.room ? { room: patch.room } : {}),
      ...(typeof patch.keepOnline === 'boolean' ? { keepOnline: patch.keepOnline } : {}),
      ...(typeof patch.socketConnected === 'boolean' ? { socketConnected: patch.socketConnected } : {})
    };
  }
  postMessageToSw({
    type: 'UPDATE_SESSION_PRESENCE',
    ...patch
  });
}

export function pingServiceWorkerKeepAlive(
  socketConnected: boolean,
  source: string = 'worker',
  bypassThrottle = false
): void {
  const isForegroundVisible =
    typeof document !== 'undefined' && document.visibilityState === 'visible';
  if (!bypassThrottle && isForegroundVisible && socketConnected) return;
  const now = Date.now();
  if (!bypassThrottle && now - lastSwPingAt < 8000) return;
  lastSwPingAt = now;

  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;

  try {
    if (typeof MessageChannel !== 'undefined') {
      const channel = new MessageChannel();
      channel.port1.onmessage = (event) => {
        const res = event.data;
        if (res && res.activeSocketAlive === false && onReconnectCallback) {
          onReconnectCallback();
        }
      };
      postMessageToSw(
        {
          type: 'KEEP_ALIVE_PING',
          socketConnected,
          room: latestSession?.room,
          source,
          ts: now
        },
        [channel.port2]
      );
      return;
    }
  } catch {}

  postMessageToSw({
    type: 'KEEP_ALIVE_PING',
    socketConnected,
    room: latestSession?.room,
    source,
    ts: now
  });
}

export function handoffToServiceWorkerBackground(
  mode: 'background' | 'closing',
  socketConnected: boolean
): void {
  postMessageToSw({
    type: mode === 'closing' ? 'APP_CLOSING' : 'APP_BACKGROUNDED',
    socketConnected,
    room: latestSession?.room
  });

  // Register one-off background sync so OS wakes SW if network pauses during transition
  if (swRegistration) {
    registerBackgroundSyncTags(swRegistration).catch(() => {});
  }

  // Zero-latency sendBeacon fallback so server keeps 'online' state even if OS kills tab immediately
  if (latestSession?.sessionToken && latestSession?.username) {
    const apiOrigin = getApiOrigin();
    const url = apiOrigin ? `${apiOrigin}/api/presence-heartbeat` : '/api/presence-heartbeat';
    const body = JSON.stringify({
      sessionToken: latestSession.sessionToken,
      username: latestSession.username,
      room: latestSession.room || 'الغرفة العامة',
      keepOnline: latestSession.keepOnline !== false,
      socketConnected,
      source: mode === 'closing' ? 'beacon-closing' : 'beacon-background'
    });

    if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
      try {
        const blob = new Blob([body], { type: 'application/json' });
        navigator.sendBeacon(url, blob);
        return;
      } catch {}
    }

    try {
      fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        keepalive: true,
        cache: 'no-store',
        body
      }).catch(() => {});
    } catch {}
  }
}

export function clearServiceWorkerSession(): void {
  latestSession = null;
  postMessageToSw({ type: 'CLEAR_SESSION' });
}
