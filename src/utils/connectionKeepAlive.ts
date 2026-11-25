/**
 * Persistent WebSocket & Background Keep-Alive Engine (Native App Grade)
 * ---------------------------------------------------------------------
 * Guarantees continuous Socket.IO connectivity when:
 * 1. Screen is locked / phone goes to sleep
 * 2. User switches to other apps (WhatsApp, calls, etc.)
 * 3. Uploading large videos (via dedicated HTTP binary pipeline)
 *
 * Strategy:
 * - Dual-layer Hidden MediaStream (AudioContext -> MediaStreamAudioDestinationNode -> <audio>)
 *   with 60s silent PCM WAV fallback, integrated cleanly with UnifiedMediaSessionManager
 * - Dedicated Background Web Worker Heartbeat (unthrottled OS thread)
 * - Zombie-Socket Pong Watchdog (detects silent half-open mobile carrier TCP drops within ~18s)
 * - Smart Presence Lifecycle (green -> yellow after 2 mins in background, real-time events uninterrupted)
 */

import { Socket } from 'socket.io-client';
import { mediaSessionManager } from './mediaSessionManager';
import {
  handoffToServiceWorkerBackground,
  pingServiceWorkerKeepAlive,
  updateServiceWorkerPresence
} from './serviceWorkerKeepAlive';
import { compressImageToFile, type ImageUploadCompressionOptions } from './mediaCompressor';

const KEEPALIVE_MEDIA_ID = 'chat-keepalive';
const SILENT_AUDIO_URI =
  'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA';

let silentAudioEl: HTMLAudioElement | null = null;
let streamAudioEl: HTMLAudioElement | null = null;
let mediaStreamDest: MediaStreamAudioDestinationNode | null = null;
let silentOscillator: OscillatorNode | null = null;
let silentGainNode: GainNode | null = null;

let wakeLockSentinel: any = null;
let heartbeatWorker: Worker | null = null;
let fallbackTimer: any = null;
let hiddenPingTimer: ReturnType<typeof setInterval> | null = null;
let webLockAbortController: AbortController | null = null;
let activeSocket: Socket | null = null;
let cachedSilentBlobUrl: string | null = null;
let cachedKeepAliveUrl = '/api/keepalive';

export type KeepAliveStopReason = 'user-toggle' | 'notification-stop' | 'session-end';

let isKeepAliveActive = false;
let isManuallyPaused = false;
let isTransientFocusPaused = false;
let isYouTubeBgStreamActive = false;
let isAppHidden = typeof document !== 'undefined' ? document.visibilityState === 'hidden' : false;
let lastServerActivityAt = Date.now();
let lastZombieReconnectAt = 0;
let zombieProbeSentAt = 0;
let lastTickAt = Date.now();
let lastForcedPingAt = 0;

const keepAliveUiListeners = new Set<
  (state: { enabled: boolean; playing: boolean; reason?: KeepAliveStopReason }) => void
>();

export function subscribeKeepAliveUiState(
  listener: (state: { enabled: boolean; playing: boolean; reason?: KeepAliveStopReason }) => void
): () => void {
  keepAliveUiListeners.add(listener);
  return () => {
    keepAliveUiListeners.delete(listener);
  };
}

function emitKeepAliveUiState(reason?: KeepAliveStopReason): void {
  const snapshot = {
    enabled: isKeepAliveActive,
    playing: isKeepAliveActive && !isManuallyPaused && !isTransientFocusPaused && isKeepAliveAudioPlaying(),
    reason
  };
  keepAliveUiListeners.forEach((fn) => {
    try {
      fn(snapshot);
    } catch {}
  });
}

export function isKeepAliveManuallyPaused(): boolean {
  return isManuallyPaused;
}

const VISIBLE_HEARTBEAT_INTERVAL_MS = 12000;
const HIDDEN_HEARTBEAT_INTERVAL_MS = 10000;
const MIN_FORCED_PING_GAP_MS = 8500;

export interface MediaSessionInfo {
  title?: string;
  artist?: string;
  album?: string;
  artworkUrl?: string;
}

let currentMediaInfo: MediaSessionInfo = {
  title: 'شات حسان برو الصوتي | للجوال',
  artist: 'اتصال مباشر ونشط في الخلفية 🟢 • انقر للعودة',
  album:
    typeof window !== 'undefined' ? window.location.hostname || 'chathassan2031' : 'chathassan2031',
  artworkUrl: '/pwa-192x192.png'
};

/**
 * Generates a valid 60-second silent PCM WAV audio Blob URL as fallback when
 * MediaStreamDestination is unavailable.
 */
function getOrCreateSilentWavBlobUrl(): string {
  if (cachedSilentBlobUrl) return cachedSilentBlobUrl;
  try {
    const sampleRate = 4000;
    const durationSeconds = 12;
    const numChannels = 1;
    const bytesPerSample = 2;
    const totalSamples = sampleRate * durationSeconds;
    const dataSize = totalSamples * bytesPerSample;
    const buffer = new ArrayBuffer(44 + dataSize);
    const view = new DataView(buffer);

    view.setUint8(0, 0x52); view.setUint8(1, 0x49); view.setUint8(2, 0x46); view.setUint8(3, 0x46);
    view.setUint32(4, 36 + dataSize, true);
    view.setUint8(8, 0x57); view.setUint8(9, 0x41); view.setUint8(10, 0x56); view.setUint8(11, 0x45);
    view.setUint8(12, 0x66); view.setUint8(13, 0x6d); view.setUint8(14, 0x74); view.setUint8(15, 0x20);
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * numChannels * bytesPerSample, true);
    view.setUint16(32, numChannels * bytesPerSample, true);
    view.setUint16(34, 16, true);
    view.setUint8(36, 0x64); view.setUint8(37, 0x61); view.setUint8(38, 0x74); view.setUint8(39, 0x61);
    view.setUint32(40, dataSize, true);

    // Write an inaudible 18Hz sub-bass sine wave (peak +/-48 out of 32767) with volume 0.08
    // so post-mixer PCM energy stays strictly non-zero (~3.8 LSB, -78dB) and mobile browsers
    // (Android Chrome / iOS Safari) maintain the active background media exemption instead of
    // freezing JavaScript timers and WebSockets.
    for (let i = 0; i < totalSamples; i++) {
      const sample = Math.round(Math.sin((2 * Math.PI * 18 * i) / sampleRate) * 48);
      view.setInt16(44 + i * 2, sample, true);
    }

    const blob = new Blob([buffer], { type: 'audio/wav' });
    cachedSilentBlobUrl = URL.createObjectURL(blob);
    return cachedSilentBlobUrl;
  } catch {
    return SILENT_AUDIO_URI;
  }
}

let gestureRevivalAttached = false;
function attachPersistentGestureRevival(): void {
  if (gestureRevivalAttached || typeof window === 'undefined') return;
  gestureRevivalAttached = true;

  const reviveOnGesture = () => {
    if (!isKeepAliveActive || isManuallyPaused || isTransientFocusPaused) return;
    const activeKind = mediaSessionManager.getActiveMediaKind();
    if (activeKind && activeKind !== 'keepalive') return;
    const ctx = mediaSessionManager.ensureAudioContext();
    if (ctx && ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }
    if (!isKeepAliveAudioPlaying()) {
      playUnderlyingKeepAliveElements();
    }
  };

  window.addEventListener('pointerdown', reviveOnGesture, { passive: true });
  window.addEventListener('touchstart', reviveOnGesture, { passive: true });
  window.addEventListener('keydown', reviveOnGesture, { passive: true });
}

/**
 * Starts the Hidden MediaStream (AudioContext -> MediaStreamDestination -> <audio>)
 * so mobile OSes maintain an active background media pipeline & detect phone call interruptions.
 */
function ensureHiddenMediaStreamStarted(): boolean {
  try {
    const ctx = mediaSessionManager.ensureAudioContext();
    if (!ctx || typeof ctx.createMediaStreamDestination !== 'function') {
      return false;
    }

    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }

    if (!mediaStreamDest) {
      mediaStreamDest = ctx.createMediaStreamDestination();
      silentOscillator = ctx.createOscillator();
      silentGainNode = ctx.createGain();
      silentOscillator.type = 'sine';
      silentOscillator.frequency.value = 20; // Sub-audible 20Hz carrier
      silentGainNode.gain.value = 0.004; // Inaudible (-48dB before volume), post-volume ~ -70dB non-zero PCM
      silentOscillator.connect(silentGainNode);
      silentGainNode.connect(mediaStreamDest);
      silentOscillator.start();
    }

    if (!streamAudioEl) {
      streamAudioEl = document.createElement('audio');
      streamAudioEl.setAttribute('playsinline', 'true');
      streamAudioEl.setAttribute('webkit-playsinline', 'true');
      streamAudioEl.loop = true;
      streamAudioEl.volume = 0.08;
      streamAudioEl.srcObject = mediaStreamDest.stream;

      streamAudioEl.addEventListener('playing', () => {
        emitKeepAliveUiState();
      });

      streamAudioEl.addEventListener('pause', () => {
        emitKeepAliveUiState();
        if (!isKeepAliveActive || isManuallyPaused || isTransientFocusPaused) return;
        const activeKind = mediaSessionManager.getActiveMediaKind();
        if (activeKind === 'keepalive' || activeKind === 'wall-youtube') {
          mediaSessionManager.notifyUnexpectedElementPause(
            activeKind === 'keepalive' ? KEEPALIVE_MEDIA_ID : mediaSessionManager.getActiveMediaId() || KEEPALIVE_MEDIA_ID
          );
        }
      });
    }

    if (streamAudioEl.paused) {
      streamAudioEl.play().then(() => emitKeepAliveUiState()).catch(() => {});
    }
    return true;
  } catch {
    return false;
  }
}

function ensureSilentWavElementStarted(): boolean {
  try {
    const blobUrl = getOrCreateSilentWavBlobUrl();
    if (!silentAudioEl) {
      silentAudioEl = new Audio(blobUrl);
      silentAudioEl.loop = true;
      silentAudioEl.volume = 0.08;
      (silentAudioEl as any).playsInline = true;
      silentAudioEl.setAttribute('playsinline', 'true');
      silentAudioEl.setAttribute('webkit-playsinline', 'true');
      silentAudioEl.setAttribute('x-webkit-airplay', 'allow');

      silentAudioEl.addEventListener('ended', () => {
        if (isKeepAliveActive && !isManuallyPaused) {
          silentAudioEl?.play().catch(() => {});
        }
      });

      silentAudioEl.addEventListener('playing', () => {
        emitKeepAliveUiState();
      });

      silentAudioEl.addEventListener('pause', () => {
        emitKeepAliveUiState();
        if (!isKeepAliveActive || isManuallyPaused || isTransientFocusPaused) return;
        if (mediaSessionManager.getActiveMediaKind() === 'keepalive') {
          mediaSessionManager.notifyUnexpectedElementPause(KEEPALIVE_MEDIA_ID);
        }
      });
    } else if (silentAudioEl.src !== blobUrl) {
      silentAudioEl.src = blobUrl;
    }

    if (silentAudioEl.paused) {
      silentAudioEl.play().then(() => emitKeepAliveUiState()).catch(() => {
        const playOnGesture = () => {
          if (isKeepAliveActive && !isManuallyPaused && !isTransientFocusPaused) {
            silentAudioEl?.play().then(() => emitKeepAliveUiState()).catch(() => {});
          }
          window.removeEventListener('click', playOnGesture);
          window.removeEventListener('touchstart', playOnGesture);
          window.removeEventListener('pointerdown', playOnGesture);
        };
        window.addEventListener('click', playOnGesture, { once: true });
        window.addEventListener('touchstart', playOnGesture, { once: true });
        window.addEventListener('pointerdown', playOnGesture, { once: true });
      });
    }
    return true;
  } catch {
    return false;
  }
}

function playUnderlyingKeepAliveElements(): void {
  // Prefer hardware-backed HTML5 WAV element so Android screen-lock suspension of WebAudio
  // never kills the keep-alive carrier; also initialize AudioContext purely for call-interrupt detection.
  mediaSessionManager.ensureAudioContext();
  const startedWav = ensureSilentWavElementStarted();
  if (startedWav) {
    if (streamAudioEl && !streamAudioEl.paused && !isYouTubeBgStreamActive) {
      try { streamAudioEl.pause(); } catch {}
    }
    return;
  }
  ensureHiddenMediaStreamStarted();
}

function pauseUnderlyingKeepAliveElements(): void {
  if (silentAudioEl && !silentAudioEl.paused) {
    try {
      silentAudioEl.pause();
    } catch {}
  }
  if (streamAudioEl && !streamAudioEl.paused) {
    try {
      streamAudioEl.pause();
    } catch {}
  }
}

/**
 * 1. Request Screen WakeLock to prevent automatic screen sleeping while visible
 */
export async function requestScreenWakeLock(): Promise<boolean> {
  if (typeof navigator !== 'undefined' && 'wakeLock' in navigator) {
    try {
      if (wakeLockSentinel) return true;
      wakeLockSentinel = await (navigator as any).wakeLock.request('screen');
      wakeLockSentinel.addEventListener('release', () => {
        wakeLockSentinel = null;
      });
      return true;
    } catch {
      return false;
    }
  }
  return false;
}

/**
 * Update Keep-Alive MediaSession metadata without overriding higher-priority media
 * (such as an active Wall Video, YouTube clip, or Voice Note).
 */
export function updateMediaSessionMetadata(info?: Partial<MediaSessionInfo>): void {
  if (info) {
    currentMediaInfo = { ...currentMediaInfo, ...info };
  }
  const siteHost =
    typeof window !== 'undefined' ? window.location.hostname || 'chathassan2031' : 'chathassan2031';

  const title = currentMediaInfo.title || 'شات حسان برو الصوتي | للجوال';
  const artist = currentMediaInfo.artist || 'اتصال مباشر ونشط في الخلفية 🟢 • انقر للعودة';
  const album = currentMediaInfo.album || siteHost;
  const artworkUrl = currentMediaInfo.artworkUrl || '/pwa-192x192.png';

  if (isKeepAliveActive) {
    mediaSessionManager.setKeepAliveDescriptor({
      id: KEEPALIVE_MEDIA_ID,
      kind: 'keepalive',
      title,
      artist,
      album,
      artworkUrl,
      playbackRate: 1,
      isPlaying: !isManuallyPaused,
      onPlay: () => {
        isManuallyPaused = false;
        isTransientFocusPaused = false;
        playUnderlyingKeepAliveElements();
        emitKeepAliveUiState();
      },
      onPause: () => {
        isManuallyPaused = true;
        isTransientFocusPaused = false;
        pauseUnderlyingKeepAliveElements();
        emitKeepAliveUiState();
      },
      onStop: () => {
        stopSilentAudioKeepAlive('notification-stop');
      },
      onInterruptPause: () => {
        isTransientFocusPaused = true;
        pauseUnderlyingKeepAliveElements();
        emitKeepAliveUiState();
      },
      onInterruptResume: () => {
        isTransientFocusPaused = false;
        if (isKeepAliveActive && !isManuallyPaused) {
          playUnderlyingKeepAliveElements();
        }
        emitKeepAliveUiState();
      }
    });
  }
}

export function unlockKeepAliveAudioOnGesture(info?: Partial<MediaSessionInfo>): void {
  try {
    attachPersistentGestureRevival();
    isKeepAliveActive = true;
    isManuallyPaused = false;
    isTransientFocusPaused = false;
    if (info) {
      currentMediaInfo = { ...currentMediaInfo, ...info };
    }
    const ctx = mediaSessionManager.ensureAudioContext();
    if (ctx && ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }
    updateMediaSessionMetadata();
    playUnderlyingKeepAliveElements();
    emitKeepAliveUiState();
  } catch {}
}

/**
 * 2. Start Persistent Background Keep-Alive Audio/MediaStream Loop
 * Keeps WebSocket un-throttled in mobile background while cleanly yielding
 * to phone calls, Wall Videos, and Voice Notes via UnifiedMediaSessionManager.
 */
export function startSilentAudioKeepAlive(info?: Partial<MediaSessionInfo>): void {
  try {
    attachPersistentGestureRevival();
    isKeepAliveActive = true;
    isManuallyPaused = false;
    isTransientFocusPaused = false;
    if (info) {
      currentMediaInfo = { ...currentMediaInfo, ...info };
    }
    updateMediaSessionMetadata();
    playUnderlyingKeepAliveElements();
    emitKeepAliveUiState();
  } catch {}
}

/**
 * Ensures a hidden silent stream/WAV carrier stays running underneath a cross-origin
 * YouTube iframe without altering Keep-Alive enablement or pause preference.
 */
export function ensureBackgroundStreamForYouTube(): void {
  isYouTubeBgStreamActive = true;
  if (!ensureSilentWavElementStarted()) {
    ensureHiddenMediaStreamStarted();
  }
}

export function stopBackgroundStreamForYouTube(): void {
  isYouTubeBgStreamActive = false;
  if (!isKeepAliveActive || isManuallyPaused || isTransientFocusPaused) {
    pauseUnderlyingKeepAliveElements();
  }
}

export function pauseKeepAliveAudio(manual = false): void {
  if (manual) {
    isManuallyPaused = true;
    isTransientFocusPaused = false;
    pauseUnderlyingKeepAliveElements();
    mediaSessionManager.updateMediaState(KEEPALIVE_MEDIA_ID, { isPlaying: false });
    emitKeepAliveUiState();
    return;
  }
  // Transient audio-focus yield (Voice Note, Wall Video, Live Broadcast, Private Call):
  // Pause underlying <audio> elements WITHOUT overwriting keepAliveDescriptor.isPlaying = false,
  // so MediaSessionManager automatically resumes Keep-Alive when that clip/call ends.
  isTransientFocusPaused = true;
  pauseUnderlyingKeepAliveElements();
  emitKeepAliveUiState();
}

export function resumeKeepAliveAudio(manual = false): void {
  if (!isKeepAliveActive) {
    if (manual) {
      startSilentAudioKeepAlive();
    }
    return;
  }
  if (isManuallyPaused && !manual) {
    return;
  }
  isManuallyPaused = false;
  isTransientFocusPaused = false;
  playUnderlyingKeepAliveElements();
  mediaSessionManager.updateMediaState(KEEPALIVE_MEDIA_ID, { isPlaying: true });
  emitKeepAliveUiState();
}

export function isKeepAliveAudioPlaying(): boolean {
  return (
    (!!streamAudioEl && !streamAudioEl.paused) ||
    (!!silentAudioEl && !silentAudioEl.paused)
  );
}

export function stopSilentAudioKeepAlive(reason: KeepAliveStopReason = 'session-end'): void {
  isKeepAliveActive = false;
  isManuallyPaused = false;
  isTransientFocusPaused = false;
  isYouTubeBgStreamActive = false;
  mediaSessionManager.setKeepAliveDescriptor(null);
  emitKeepAliveUiState(reason);

  if (silentAudioEl) {
    try {
      silentAudioEl.pause();
      silentAudioEl.src = '';
    } catch {}
    silentAudioEl = null;
  }

  if (streamAudioEl) {
    try {
      streamAudioEl.pause();
      streamAudioEl.srcObject = null;
    } catch {}
    streamAudioEl = null;
  }

  if (silentOscillator) {
    try {
      silentOscillator.stop();
      silentOscillator.disconnect();
    } catch {}
    silentOscillator = null;
  }

  if (silentGainNode) {
    try {
      silentGainNode.disconnect();
    } catch {}
    silentGainNode = null;
  }
  if (cachedSilentBlobUrl) {
    try {
      URL.revokeObjectURL(cachedSilentBlobUrl);
    } catch {}
    cachedSilentBlobUrl = null;
  }
  mediaStreamDest = null;
}

export let PRESENCE_AWAY_DELAY_MS = 2 * 60 * 1000;
export function setPresenceAwayDelayMs(ms: number): void {
  if (typeof ms === 'number' && ms >= 5000) {
    PRESENCE_AWAY_DELAY_MS = ms;
  }
}
export function getPresenceAwayDelayMs(): number {
  return PRESENCE_AWAY_DELAY_MS;
}

let persistOnlineInBackground = true;
export function setPersistOnlineInBackground(enabled: boolean): void {
  persistOnlineInBackground = enabled;
  updateServiceWorkerPresence({ keepOnline: enabled });
  if (enabled && activeSocket?.connected && typeof document !== 'undefined' && document.hidden) {
    activeSocket.emit('userPresenceChange', { state: 'online' });
  }
}
export function isPersistOnlineInBackground(): boolean {
  return persistOnlineInBackground;
}

let backgroundStartTime: number | null = null;
let hasEmittedAway = false;
let awayTimer: any = null;

/**
 * Call whenever any Socket.IO packet/pong arrives from the server so the
 * Zombie-Socket Watchdog knows the TCP connection is genuinely alive.
 */
export function notifySocketActivity(): void {
  lastServerActivityAt = Date.now();
  zombieProbeSentAt = 0;
}

function getKeepAliveUrl(): string {
  const apiBase = ((import.meta.env.VITE_SERVER_URL as string) || '').replace(/\/$/, '');
  cachedKeepAliveUrl = apiBase
    ? `${apiBase}/api/keepalive`
    : typeof window !== 'undefined'
    ? `${window.location.origin}/api/keepalive`
    : '/api/keepalive';
  return cachedKeepAliveUrl;
}

function acquireBackgroundWebLock(): void {
  if (typeof navigator === 'undefined' || !('locks' in navigator) || webLockAbortController) return;
  try {
    const controller = new AbortController();
    webLockAbortController = controller;
    (navigator as any).locks
      .request(
        'chathassan_bg_keepalive',
        { mode: 'exclusive', signal: controller.signal },
        () =>
          new Promise<void>((resolve) => {
            controller.signal.addEventListener('abort', () => resolve(), { once: true });
          })
      )
      .catch(() => {
        if (webLockAbortController === controller) {
          webLockAbortController = null;
        }
      });
  } catch {
    webLockAbortController = null;
  }
}

function releaseBackgroundWebLock(): void {
  if (webLockAbortController) {
    try {
      webLockAbortController.abort();
    } catch {}
    webLockAbortController = null;
  }
}

/**
 * Forces a Socket.IO keepAlivePing immediately (with optional deduplication floor)
 * and reinforces audio/media background pipelines so aggressive mobile OSes keep the socket alive.
 */
export function forceSocketPing(
  source: 'worker' | 'hidden-timer' | 'visibility' | 'freeze' | 'foreground' = 'worker',
  bypassThrottle = false
): boolean {
  if (!activeSocket) return false;
  const now = Date.now();
  if (!bypassThrottle && now - lastForcedPingAt < MIN_FORCED_PING_GAP_MS) {
    return false;
  }
  lastForcedPingAt = now;
  isAppHidden = typeof document !== 'undefined' ? document.visibilityState === 'hidden' : isAppHidden;

  if (activeSocket.connected) {
    activeSocket.emit('keepAlivePing', {
      timestamp: now,
      background: isAppHidden,
      keepOnline: persistOnlineInBackground,
      visibilityState: typeof document !== 'undefined' ? document.visibilityState : 'unknown',
      source
    });
  } else if (activeSocket.disconnected) {
    if (typeof navigator === 'undefined' || navigator.onLine !== false) {
      activeSocket.connect();
    }
  }

  // Keep Service Worker warm & send /api/presence-heartbeat only when hidden, disconnected, or explicitly forced
  if (isAppHidden || !activeSocket.connected || bypassThrottle) {
    pingServiceWorkerKeepAlive(Boolean(activeSocket.connected), source, bypassThrottle);
  }

  if (isKeepAliveActive && !isManuallyPaused && !isTransientFocusPaused) {
    const ctx = mediaSessionManager.ensureAudioContext();
    if (ctx && ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }
    if (
      mediaSessionManager.getActiveMediaKind() === 'keepalive' &&
      !isKeepAliveAudioPlaying()
    ) {
      playUnderlyingKeepAliveElements();
    }
  }

  return true;
}

function startHiddenPingLoop(): void {
  isAppHidden = true;
  acquireBackgroundWebLock();
  handoffToServiceWorkerBackground('background', Boolean(activeSocket?.connected));
  if (heartbeatWorker) {
    try {
      heartbeatWorker.postMessage({ type: 'visibility', hidden: true });
    } catch {}
  }

  forceSocketPing('visibility', true);

  if (hiddenPingTimer) return;
  hiddenPingTimer = setInterval(() => {
    if (typeof document !== 'undefined' && document.visibilityState !== 'hidden') {
      stopHiddenPingLoop();
      return;
    }
    const pinged = forceSocketPing('hidden-timer', false);
    if (pinged) {
      try {
        fetch(getKeepAliveUrl(), { cache: 'no-store', keepalive: true }).catch(() => {});
      } catch {}
    }
  }, HIDDEN_HEARTBEAT_INTERVAL_MS);
}

function stopHiddenPingLoop(): void {
  isAppHidden = false;
  releaseBackgroundWebLock();
  if (hiddenPingTimer) {
    clearInterval(hiddenPingTimer);
    hiddenPingTimer = null;
  }
  if (heartbeatWorker) {
    try {
      heartbeatWorker.postMessage({ type: 'visibility', hidden: false });
    } catch {}
  }
}

/**
 * 3. Background Web Worker Heartbeat + Hidden-State 10s Ping + Zombie-Socket Watchdog
 * Runs on an independent OS thread so mobile browsers don't throttle it.
 */
export function startHeartbeatWorker(socket: Socket): void {
  activeSocket = socket;
  lastServerActivityAt = Date.now();
  lastTickAt = Date.now();
  zombieProbeSentAt = 0;
  const keepAliveUrl = getKeepAliveUrl();
  isAppHidden = typeof document !== 'undefined' ? document.visibilityState === 'hidden' : false;

  if (isAppHidden) {
    startHiddenPingLoop();
  }

  if (heartbeatWorker) return;

  const workerCode = `
    let timer = null;
    let tickCount = 0;
    let keepAliveUrl = '/api/keepalive';
    let isHidden = false;
    let visibleMs = ${VISIBLE_HEARTBEAT_INTERVAL_MS};
    let hiddenMs = ${HIDDEN_HEARTBEAT_INTERVAL_MS};

    function sendKeepAliveHttp() {
      try {
        fetch(keepAliveUrl, { method: 'GET', cache: 'no-store', keepalive: true }).catch(function(){});
      } catch(e){}
    }

    function scheduleTimer() {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      const intervalMs = isHidden ? hiddenMs : visibleMs;
      timer = setInterval(function() {
        tickCount++;
        self.postMessage({ type: 'tick', hidden: isHidden });
        if (isHidden || tickCount % 2 === 0) {
          sendKeepAliveHttp();
        }
      }, intervalMs);
    }

    self.onmessage = function(e) {
      const data = e.data;
      if (data === 'start' || (data && data.type === 'start')) {
        if (data && data.url) keepAliveUrl = data.url;
        if (data && typeof data.hidden === 'boolean') isHidden = data.hidden;
        scheduleTimer();
        if (isHidden) {
          self.postMessage({ type: 'tick', hidden: true });
          sendKeepAliveHttp();
        }
      } else if (data && data.type === 'visibility') {
        const nextHidden = Boolean(data.hidden);
        if (nextHidden !== isHidden) {
          isHidden = nextHidden;
          scheduleTimer();
          if (isHidden) {
            self.postMessage({ type: 'tick', hidden: true });
            sendKeepAliveHttp();
          }
        }
      } else if (data === 'stop' || (data && data.type === 'stop')) {
        if (timer) {
          clearInterval(timer);
          timer = null;
        }
      }
    };
  `;

  const runTick = () => {
    if (!activeSocket) return;
    const now = Date.now();
    const tickGap = now - lastTickAt;
    lastTickAt = now;
    isAppHidden = typeof document !== 'undefined' ? document.visibilityState === 'hidden' : isAppHidden;

    if (activeSocket.connected) {
      // Force ping every 10s while hidden (and on regular ticks when visible)
      forceSocketPing('worker', isAppHidden);

      // Conservative Zombie-Socket Watchdog:
      // Only recycle an apparently-connected socket if it has had ZERO server traffic
      // for >50s AND fails an explicit probe across >12s while the browser is online.
      // Never kill a socket immediately after OS background timer sleep (tickGap > 15s).
      if (tickGap > 15000) {
        zombieProbeSentAt = now;
        forceSocketPing('worker', true);
      } else if (now - lastServerActivityAt > 50000) {
        if (zombieProbeSentAt === 0) {
          zombieProbeSentAt = now;
          forceSocketPing('worker', true);
        } else if (
          now - zombieProbeSentAt > 12000 &&
          lastServerActivityAt < zombieProbeSentAt &&
          now - lastZombieReconnectAt > 25000 &&
          (typeof navigator === 'undefined' || navigator.onLine !== false)
        ) {
          lastZombieReconnectAt = now;
          zombieProbeSentAt = 0;
          try {
            activeSocket.disconnect();
            activeSocket.connect();
          } catch {}
        }
      }
    } else if (activeSocket.disconnected) {
      if (typeof navigator === 'undefined' || navigator.onLine !== false) {
        activeSocket.connect();
      }
    }

    // Maintain 'online' in background when persistOnlineInBackground is enabled;
    // only transition to 'away' (yellow) if background 'online' persistence is explicitly disabled.
    if (
      !persistOnlineInBackground &&
      typeof document !== 'undefined' &&
      document.hidden &&
      backgroundStartTime !== null &&
      !hasEmittedAway
    ) {
      const elapsed = now - backgroundStartTime;
      if (elapsed >= PRESENCE_AWAY_DELAY_MS) {
        hasEmittedAway = true;
        if (activeSocket.connected) {
          activeSocket.emit('userPresenceChange', { state: 'away' });
        }
      }
    }
  };

  try {
    const blob = new Blob([workerCode], { type: 'application/javascript' });
    const blobUrl = URL.createObjectURL(blob);
    heartbeatWorker = new Worker(blobUrl);
    URL.revokeObjectURL(blobUrl);

    heartbeatWorker.onmessage = (e) => {
      if (e.data === 'tick' || e.data?.type === 'tick') {
        runTick();
      }
    };
    heartbeatWorker.postMessage({ type: 'start', url: keepAliveUrl, hidden: isAppHidden });
  } catch {
    if (fallbackTimer) clearInterval(fallbackTimer);
    fallbackTimer = setInterval(runTick, HIDDEN_HEARTBEAT_INTERVAL_MS);
  }
}

export function stopHeartbeatWorker(): void {
  stopHiddenPingLoop();
  if (heartbeatWorker) {
    try {
      heartbeatWorker.postMessage({ type: 'stop' });
      heartbeatWorker.terminate();
    } catch {}
    heartbeatWorker = null;
  }
  if (fallbackTimer) {
    clearInterval(fallbackTimer);
    fallbackTimer = null;
  }
}

/**
 * 4. Visibility & Screen Unlock Handlers
 * - Keeps WebSocket live & receiving real-time events in background.
 * - Marks presence green -> yellow after PRESENCE_AWAY_DELAY_MS, and back to green immediately on return.
 * - Avoids redundant history reloads if socket never disconnected.
 */
export function setupVisibilityResync(
  socket: Socket,
  onWake?: (wasDisconnected: boolean, elapsedBgSeconds: number) => void
): () => void {
  activeSocket = socket;
  let lastWakeSyncAt = 0;
  let hadDisconnectInBg = false;

  const onSocketDisconnect = () => {
    hadDisconnectInBg = true;
  };
  socket.on('disconnect', onSocketDisconnect);

  let wakeVerifyTimer: ReturnType<typeof setTimeout> | null = null;
  let stallReconnectTimer: ReturnType<typeof setTimeout> | null = null;

  const triggerOnlineForeground = () => {
    stopHiddenPingLoop();

    if (awayTimer) {
      clearTimeout(awayTimer);
      awayTimer = null;
    }
    const elapsedBgSeconds =
      backgroundStartTime !== null
        ? Math.max(0, Math.floor((Date.now() - backgroundStartTime) / 1000))
        : 0;
    backgroundStartTime = null;
    hasEmittedAway = false;

    requestScreenWakeLock().catch(() => {});

    // Keep keep-alive audio context healthy upon foreground return (only if higher-priority media isn't active)
    const activeKind = mediaSessionManager.getActiveMediaKind();
    if (
      isKeepAliveActive &&
      !isManuallyPaused &&
      !isTransientFocusPaused &&
      (!activeKind || activeKind === 'keepalive')
    ) {
      const ctx = mediaSessionManager.ensureAudioContext();
      if (ctx && ctx.state === 'suspended') {
        ctx.resume().catch(() => {});
      }
      if (!isKeepAliveAudioPlaying()) {
        playUnderlyingKeepAliveElements();
      }
    }

    if (activeSocket) {
      const wasDisconnected = !activeSocket.connected || hadDisconnectInBg;
      hadDisconnectInBg = false;

      if (!activeSocket.connected) {
        if (activeSocket.disconnected) {
          activeSocket.connect();
        }
        // If reconnect attempt is stalled on a dead mobile handshake, recycle cleanly after 4s
        if (stallReconnectTimer) clearTimeout(stallReconnectTimer);
        stallReconnectTimer = setTimeout(() => {
          stallReconnectTimer = null;
          if (
            activeSocket &&
            !activeSocket.connected &&
            (typeof navigator === 'undefined' || navigator.onLine !== false)
          ) {
            try {
              activeSocket.disconnect();
              activeSocket.connect();
            } catch {}
          }
        }, 4000);
      } else {
        const nowTs = Date.now();
        lastTickAt = nowTs;
        forceSocketPing('foreground', true);
        activeSocket.emit('userPresenceChange', { state: 'online' });

        // Conservative two-stage half-open TCP probe upon returning from >=10s in background:
        // Do NOT disconnect on a slow mobile radio wake after 3.5s; first re-probe at 4.5s
        // and only recycle at 9s total if zero packets/pongs arrived across both probes.
        if (wakeVerifyTimer) {
          clearTimeout(wakeVerifyTimer);
          wakeVerifyTimer = null;
        }
        if (elapsedBgSeconds >= 10) {
          const probeStartedAt = nowTs;
          wakeVerifyTimer = setTimeout(() => {
            if (
              !activeSocket ||
              !activeSocket.connected ||
              lastServerActivityAt >= probeStartedAt ||
              typeof document === 'undefined' ||
              document.visibilityState !== 'visible'
            ) {
              wakeVerifyTimer = null;
              return;
            }
            forceSocketPing('foreground', true);
            wakeVerifyTimer = setTimeout(() => {
              wakeVerifyTimer = null;
              if (
                activeSocket &&
                activeSocket.connected &&
                lastServerActivityAt < probeStartedAt &&
                (typeof navigator === 'undefined' || navigator.onLine !== false) &&
                typeof document !== 'undefined' &&
                document.visibilityState === 'visible'
              ) {
                try {
                  activeSocket.disconnect();
                  activeSocket.connect();
                } catch {}
              }
            }, 4500);
          }, 4500);
        }
      }

      const now = Date.now();
      if (onWake && now - lastWakeSyncAt > 2500) {
        lastWakeSyncAt = now;
        onWake(wasDisconnected, elapsedBgSeconds);
      }
    }
  };

  const handleVisibilityChange = () => {
    if (document.visibilityState === 'visible') {
      updateServiceWorkerPresence({ appVisible: true, socketConnected: Boolean(activeSocket?.connected) });
      triggerOnlineForeground();
    } else if (document.visibilityState === 'hidden') {
      if (awayTimer) clearTimeout(awayTimer);
      backgroundStartTime = Date.now();
      lastTickAt = Date.now();
      hasEmittedAway = false;
      updateServiceWorkerPresence({ appVisible: false, socketConnected: Boolean(activeSocket?.connected) });

      // Switch heartbeat into aggressive 10-second hidden mode immediately + handoff to Service Worker
      startHiddenPingLoop();

      if (!persistOnlineInBackground) {
        awayTimer = setTimeout(() => {
          if (document.hidden && activeSocket?.connected && !hasEmittedAway) {
            hasEmittedAway = true;
            activeSocket.emit('userPresenceChange', { state: 'away' });
          }
        }, PRESENCE_AWAY_DELAY_MS);
      }
    }
  };

  const handleFreeze = () => {
    forceSocketPing('freeze', true);
    handoffToServiceWorkerBackground('background', Boolean(activeSocket?.connected));
    try {
      const url = getKeepAliveUrl();
      if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
        navigator.sendBeacon(url);
      } else {
        fetch(url, { cache: 'no-store', keepalive: true }).catch(() => {});
      }
    } catch {}
  };

  const handlePageHide = (e: PageTransitionEvent) => {
    handoffToServiceWorkerBackground(e?.persisted ? 'background' : 'closing', Boolean(activeSocket?.connected));
  };

  const handleResume = () => {
    triggerOnlineForeground();
  };

  const handleFocus = () => {
    if (document.visibilityState === 'visible') {
      triggerOnlineForeground();
    }
  };

  const handlePageShow = () => {
    if (document.visibilityState === 'hidden') {
      startHiddenPingLoop();
    } else {
      triggerOnlineForeground();
    }
  };

  const handleOnline = () => {
    hadDisconnectInBg = true;
    triggerOnlineForeground();
  };

  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
    startHiddenPingLoop();
  }

  document.addEventListener('visibilitychange', handleVisibilityChange);
  document.addEventListener('freeze', handleFreeze);
  document.addEventListener('resume', handleResume);
  window.addEventListener('focus', handleFocus);
  window.addEventListener('pageshow', handlePageShow);
  window.addEventListener('pagehide', handlePageHide);
  window.addEventListener('online', handleOnline);

  return () => {
    stopHiddenPingLoop();
    if (awayTimer) {
      clearTimeout(awayTimer);
      awayTimer = null;
    }
    if (wakeVerifyTimer) {
      clearTimeout(wakeVerifyTimer);
      wakeVerifyTimer = null;
    }
    if (stallReconnectTimer) {
      clearTimeout(stallReconnectTimer);
      stallReconnectTimer = null;
    }
    socket.off('disconnect', onSocketDisconnect);
    document.removeEventListener('visibilitychange', handleVisibilityChange);
    document.removeEventListener('freeze', handleFreeze);
    document.removeEventListener('resume', handleResume);
    window.removeEventListener('focus', handleFocus);
    window.removeEventListener('pageshow', handlePageShow);
    window.removeEventListener('pagehide', handlePageHide);
    window.removeEventListener('online', handleOnline);
  };
}

/**
 * 5. Robust Media Upload Pipeline (HTTP Binary Progress Pipeline)
 * Completely bypasses WebSocket frames so Socket.IO heartbeats NEVER stall.
 */
export async function uploadMediaWithProgress(
  file: File,
  onProgress?: (percent: number) => void,
  compressionOptions?: ImageUploadCompressionOptions
): Promise<{ url: string; mediaType: 'image' | 'video' | 'audio'; originalName: string; size: number }> {
  const isVideo = file.type.startsWith('video');
  const isAudio = file.type.startsWith('audio');
  const mediaType: 'image' | 'video' | 'audio' = isVideo ? 'video' : isAudio ? 'audio' : 'image';

  const processedFile =
    mediaType === 'image' && !compressionOptions?.skipCompression
      ? await compressImageToFile(file, compressionOptions)
      : file;

  const apiBase = ((import.meta.env.VITE_SERVER_URL as string) || '').replace(/\/$/, '');

  return new Promise((resolve, reject) => {
    const sessionToken = (() => {
      try {
        return localStorage.getItem('soqoor_session_token') || sessionStorage.getItem('soqoor_session_token') || '';
      } catch {
        return '';
      }
    })();
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${apiBase}/api/upload-media-binary`, true);
    xhr.setRequestHeader('Content-Type', processedFile.type || 'application/octet-stream');
    xhr.setRequestHeader('x-filename', encodeURIComponent(processedFile.name));
    xhr.setRequestHeader('x-mediatype', mediaType);
    if (sessionToken) {
      xhr.setRequestHeader('x-session-token', sessionToken);
    }

    if (xhr.upload && onProgress) {
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable && e.total > 0) {
          const percent = Math.min(99, Math.round((e.loaded / e.total) * 100));
          onProgress(percent);
        }
      };
    }

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const res = JSON.parse(xhr.responseText);
          if (res.success && res.url) {
            if (onProgress) onProgress(100);
            let finalUrl = res.url;
            if (finalUrl && finalUrl.startsWith('/') && apiBase) {
              finalUrl = `${apiBase}${finalUrl}`;
            }
            resolve({
              url: finalUrl,
              mediaType: res.mediaType || mediaType,
              originalName: processedFile.name,
              size: res.size || processedFile.size
            });
            return;
          }
          if (res.error) {
            reject(new Error(res.error));
            return;
          }
        } catch {}
      }

      let serverErrMsg = '';
      try {
        const errJson = JSON.parse(xhr.responseText);
        if (errJson?.error) serverErrMsg = errJson.error;
      } catch {}

      // Do not fall back to base64 JSON for auth errors, 413 payload errors, or files > 7MB (which exceed 10MB JSON limit)
      if (xhr.status === 401 || xhr.status === 400 || xhr.status === 413 || processedFile.size > 7 * 1024 * 1024) {
        reject(new Error(serverErrMsg || `فشل رفع الملف (${xhr.status || 'خطأ في الخادم'})`));
        return;
      }

      fallbackUpload(processedFile, mediaType, onProgress, resolve, reject, apiBase);
    };

    xhr.onerror = () => {
      if (processedFile.size > 7 * 1024 * 1024) {
        reject(new Error('انقطع الاتصال أثناء رفع الفيديو على الخادم'));
        return;
      }
      fallbackUpload(processedFile, mediaType, onProgress, resolve, reject, apiBase);
    };

    xhr.send(processedFile);
  });
}

function fallbackUpload(
  file: File,
  mediaType: 'image' | 'video' | 'audio',
  onProgress?: (percent: number) => void,
  resolve?: (val: any) => void,
  reject?: (err: any) => void,
  apiBase: string = ''
) {
  const reader = new FileReader();
  reader.onerror = () => reject && reject(new Error('فشل قراءة ملف الوسائط'));
  reader.onload = () => {
    const dataUrl = reader.result as string;
    const sessionToken = (() => {
      try {
        return localStorage.getItem('soqoor_session_token') || sessionStorage.getItem('soqoor_session_token') || '';
      } catch {
        return '';
      }
    })();
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${apiBase}/api/upload-media`, true);
    xhr.setRequestHeader('Content-Type', 'application/json');
    if (sessionToken) {
      xhr.setRequestHeader('x-session-token', sessionToken);
    }

    if (xhr.upload && onProgress) {
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          const percent = Math.min(99, Math.round((e.loaded / e.total) * 100));
          onProgress(percent);
        }
      };
    }

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const res = JSON.parse(xhr.responseText);
          if (res.success && res.url) {
            if (onProgress) onProgress(100);
            let finalUrl = res.url;
            if (finalUrl && finalUrl.startsWith('/') && apiBase) {
              finalUrl = `${apiBase}${finalUrl}`;
            }
            resolve &&
              resolve({
                url: finalUrl,
                mediaType: res.mediaType || mediaType,
                originalName: file.name,
                size: res.size || file.size
              });
            return;
          }
          if (res.error) {
            reject && reject(new Error(res.error));
            return;
          }
        } catch {}
      }
      let errMsg = 'فشل رفع الملف على الخادم';
      try {
        const parsed = JSON.parse(xhr.responseText);
        if (parsed?.error) errMsg = parsed.error;
      } catch {}
      reject && reject(new Error(errMsg));
    };

    xhr.onerror = () => reject && reject(new Error('انقطع الاتصال أثناء رفع الوسائط'));

    xhr.send(JSON.stringify({ dataUrl, filename: file.name, mediaType }));
  };
  reader.readAsDataURL(file);
}
