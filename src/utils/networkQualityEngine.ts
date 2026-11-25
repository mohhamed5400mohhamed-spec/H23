import type { ChatQualitySettings, QualityPresetMode } from '../types/chat';

export const DEFAULT_CHAT_QUALITY_SETTINGS: ChatQualitySettings = {
  preset: 'auto',
  autoAdaptWeakNet: true,
  imageMaxDim: 1200,
  imageQuality: 0.78,
  cloudinaryDeliveryMode: 'auto',
  micAudioBitrateKbps: 24,
  musicBitrateKbps: 44,
  liveVideoWidth: 320,
  liveVideoMaxFps: 10,
  liveVideoQuality: 0.56,
  privateCallAudioBitrateKbps: 24,
  privateCallVideoMaxKbps: 420,
  privateCallMaxWidth: 480,
  privateCallMaxFps: 18,
  broadcastThrottleMs: 100,
  dbBatchWriteMs: 1200
};

export const QUALITY_PRESET_TEMPLATES: Record<QualityPresetMode, Omit<ChatQualitySettings, 'updatedAt' | 'updatedBy'>> = {
  auto: { ...DEFAULT_CHAT_QUALITY_SETTINGS, preset: 'auto', autoAdaptWeakNet: true, cloudinaryDeliveryMode: 'auto' },
  high: {
    preset: 'high',
    autoAdaptWeakNet: false,
    imageMaxDim: 1500,
    imageQuality: 0.86,
    cloudinaryDeliveryMode: 'best',
    micAudioBitrateKbps: 40,
    musicBitrateKbps: 64,
    liveVideoWidth: 426,
    liveVideoMaxFps: 12,
    liveVideoQuality: 0.68,
    privateCallAudioBitrateKbps: 36,
    privateCallVideoMaxKbps: 720,
    privateCallMaxWidth: 640,
    privateCallMaxFps: 24,
    broadcastThrottleMs: 60,
    dbBatchWriteMs: 600
  },
  balanced: {
    preset: 'balanced',
    autoAdaptWeakNet: true,
    imageMaxDim: 1200,
    imageQuality: 0.78,
    cloudinaryDeliveryMode: 'good',
    micAudioBitrateKbps: 24,
    musicBitrateKbps: 44,
    liveVideoWidth: 320,
    liveVideoMaxFps: 9,
    liveVideoQuality: 0.55,
    privateCallAudioBitrateKbps: 24,
    privateCallVideoMaxKbps: 420,
    privateCallMaxWidth: 480,
    privateCallMaxFps: 18,
    broadcastThrottleMs: 100,
    dbBatchWriteMs: 1200
  },
  weak: {
    preset: 'weak',
    autoAdaptWeakNet: true,
    imageMaxDim: 800,
    imageQuality: 0.6,
    cloudinaryDeliveryMode: 'eco',
    micAudioBitrateKbps: 14,
    musicBitrateKbps: 26,
    liveVideoWidth: 224,
    liveVideoMaxFps: 4,
    liveVideoQuality: 0.42,
    privateCallAudioBitrateKbps: 14,
    privateCallVideoMaxKbps: 160,
    privateCallMaxWidth: 320,
    privateCallMaxFps: 12,
    broadcastThrottleMs: 160,
    dbBatchWriteMs: 1800
  }
};

export function clampNum(val: unknown, min: number, max: number, fallback: number): number {
  const num = Number(val);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(min, Math.min(max, num));
}

export function clampChatQualitySettings(input: Partial<ChatQualitySettings> | undefined | null, base: ChatQualitySettings = DEFAULT_CHAT_QUALITY_SETTINGS): ChatQualitySettings {
  const raw = input && typeof input === 'object' ? input : {};
  const presetRaw = String(raw.preset ?? base.preset);
  const preset: QualityPresetMode =
    presetRaw === 'high' || presetRaw === 'balanced' || presetRaw === 'weak' || presetRaw === 'auto'
      ? presetRaw
      : base.preset;
  const cdRaw = String(raw.cloudinaryDeliveryMode ?? base.cloudinaryDeliveryMode);
  const cloudinaryDeliveryMode: ChatQualitySettings['cloudinaryDeliveryMode'] =
    cdRaw === 'auto' || cdRaw === 'eco' || cdRaw === 'good' || cdRaw === 'best'
      ? cdRaw
      : base.cloudinaryDeliveryMode;

  return {
    preset,
    autoAdaptWeakNet: typeof raw.autoAdaptWeakNet === 'boolean' ? raw.autoAdaptWeakNet : base.autoAdaptWeakNet,
    imageMaxDim: Math.round(clampNum(raw.imageMaxDim, 640, 1600, base.imageMaxDim)),
    imageQuality: Number(clampNum(raw.imageQuality, 0.5, 0.92, base.imageQuality).toFixed(2)),
    cloudinaryDeliveryMode,
    micAudioBitrateKbps: Math.round(clampNum(raw.micAudioBitrateKbps, 12, 64, base.micAudioBitrateKbps)),
    musicBitrateKbps: Math.round(clampNum(raw.musicBitrateKbps, 20, 96, base.musicBitrateKbps)),
    liveVideoWidth: Math.round(clampNum(raw.liveVideoWidth, 160, 480, base.liveVideoWidth)),
    liveVideoMaxFps: Math.round(clampNum(raw.liveVideoMaxFps, 2, 15, base.liveVideoMaxFps)),
    liveVideoQuality: Number(clampNum(raw.liveVideoQuality, 0.3, 0.85, base.liveVideoQuality).toFixed(2)),
    privateCallAudioBitrateKbps: Math.round(clampNum(raw.privateCallAudioBitrateKbps, 12, 48, base.privateCallAudioBitrateKbps)),
    privateCallVideoMaxKbps: Math.round(clampNum(raw.privateCallVideoMaxKbps, 100, 950, base.privateCallVideoMaxKbps)),
    privateCallMaxWidth: Math.round(clampNum(raw.privateCallMaxWidth, 240, 720, base.privateCallMaxWidth)),
    privateCallMaxFps: Math.round(clampNum(raw.privateCallMaxFps, 8, 24, base.privateCallMaxFps)),
    broadcastThrottleMs: Math.round(clampNum(raw.broadcastThrottleMs, 0, 300, base.broadcastThrottleMs)),
    dbBatchWriteMs: Math.round(clampNum(raw.dbBatchWriteMs, 300, 3000, base.dbBatchWriteMs)),
    ...(typeof raw.updatedAt === 'number' ? { updatedAt: raw.updatedAt } : base.updatedAt ? { updatedAt: base.updatedAt } : {}),
    ...(typeof raw.updatedBy === 'string' ? { updatedBy: raw.updatedBy } : base.updatedBy ? { updatedBy: base.updatedBy } : {})
  };
}

export interface NetworkConnectionSnapshot {
  effectiveType: 'slow-2g' | '2g' | '3g' | '4g' | 'unknown';
  downlinkMbps: number | null;
  rttMs: number | null;
  saveData: boolean;
  tier: 'fast' | 'medium' | 'slow';
}

export interface EffectiveQualityProfile {
  effectiveMode: 'high' | 'balanced' | 'weak';
  preset: QualityPresetMode;
  network: NetworkConnectionSnapshot;
  userLocalOverride: 'inherit' | 'weak';
  imageMaxDim: number;
  imageQuality: number;
  cloudinaryQualityToken: 'q_auto:eco' | 'q_auto:good' | 'q_auto:best';
  cloudinaryImageMaxWidth: number;
  cloudinaryAvatarMaxWidth: number;
  micAudioBitrateKbps: number;
  musicBitrateKbps: number;
  pcmFallbackSampleRate: number;
  pcmFallbackChunkMs: number;
  liveVideoWidth: number;
  liveVideoHeight: number;
  liveVideoMaxFps: number;
  liveVideoQuality: number;
  privateCallAudioBitrateKbps: number;
  privateCallVideoMaxKbps: number;
  privateCallMaxWidth: number;
  privateCallMaxHeight: number;
  privateCallMaxFps: number;
}

const LOCAL_OVERRIDE_STORAGE_KEY = 'hassan_local_weak_net_mode';

let serverQualitySettings: ChatQualitySettings = { ...DEFAULT_CHAT_QUALITY_SETTINGS };
let userLocalOverride: 'inherit' | 'weak' = (() => {
  if (typeof window === 'undefined') return 'inherit';
  try {
    return localStorage.getItem(LOCAL_OVERRIDE_STORAGE_KEY) === 'weak' ? 'weak' : 'inherit';
  } catch {
    return 'inherit';
  }
})();

// Dynamic runtime telemetry feedback reported by WebRTC connections & Socket RTT pings
let telemetryWeakUntil = 0;
let telemetryModerateUntil = 0;
let lastMeasuredSocketRttMs: number | null = null;
let networkListenerAttached = false;
const subscribers = new Set<(profile: EffectiveQualityProfile) => void>();

export function getNetworkConnectionSnapshot(): NetworkConnectionSnapshot {
  if (typeof navigator === 'undefined') {
    return { effectiveType: 'unknown', downlinkMbps: null, rttMs: lastMeasuredSocketRttMs, saveData: false, tier: 'medium' };
  }
  const conn = (navigator as any).connection || (navigator as any).mozConnection || (navigator as any).webkitConnection;
  if (!conn) {
    // Browsers without Network Information API (e.g., iOS Safari, Firefox): avoid assuming 4g fast blindly; adapt via live RTT telemetry
    let tier: 'fast' | 'medium' | 'slow' = 'medium';
    if (lastMeasuredSocketRttMs !== null) {
      if (lastMeasuredSocketRttMs >= 320) tier = 'slow';
      else if (lastMeasuredSocketRttMs >= 160) tier = 'medium';
      else tier = 'fast';
    }
    return { effectiveType: 'unknown', downlinkMbps: null, rttMs: lastMeasuredSocketRttMs, saveData: false, tier };
  }

  const effectiveTypeRaw = String(conn.effectiveType || 'unknown').toLowerCase();
  const effectiveType: NetworkConnectionSnapshot['effectiveType'] =
    effectiveTypeRaw === 'slow-2g' || effectiveTypeRaw === '2g' || effectiveTypeRaw === '3g' || effectiveTypeRaw === '4g'
      ? effectiveTypeRaw
      : 'unknown';
  const downlinkMbps = typeof conn.downlink === 'number' && Number.isFinite(conn.downlink) ? conn.downlink : null;
  const connRtt = typeof conn.rtt === 'number' && Number.isFinite(conn.rtt) && conn.rtt > 0 ? conn.rtt : null;
  const rttMs = connRtt ?? lastMeasuredSocketRttMs;
  const saveData = Boolean(conn.saveData);

  let tier: 'fast' | 'medium' | 'slow' = 'fast';
  if (
    saveData ||
    effectiveType === 'slow-2g' ||
    effectiveType === '2g' ||
    (downlinkMbps !== null && downlinkMbps < 1.1) ||
    (rttMs !== null && rttMs >= 320)
  ) {
    tier = 'slow';
  } else if (
    effectiveType === '3g' ||
    (downlinkMbps !== null && downlinkMbps < 3.0) ||
    (rttMs !== null && rttMs >= 160)
  ) {
    tier = 'medium';
  }

  return { effectiveType, downlinkMbps, rttMs, saveData, tier };
}

function attachNetworkListenerOnce() {
  if (networkListenerAttached || typeof navigator === 'undefined') return;
  networkListenerAttached = true;
  const conn = (navigator as any).connection || (navigator as any).mozConnection || (navigator as any).webkitConnection;
  if (conn && typeof conn.addEventListener === 'function') {
    conn.addEventListener('change', () => notifyQualitySubscribers());
  }
}

export function getServerChatQualitySettings(): ChatQualitySettings {
  return serverQualitySettings;
}

export function setServerChatQualitySettings(next: Partial<ChatQualitySettings> | undefined | null): ChatQualitySettings {
  serverQualitySettings = clampChatQualitySettings(next, DEFAULT_CHAT_QUALITY_SETTINGS);
  notifyQualitySubscribers();
  return serverQualitySettings;
}

export function getUserLocalWeakNetOverride(): 'inherit' | 'weak' {
  return userLocalOverride;
}

export function setUserLocalWeakNetOverride(mode: 'inherit' | 'weak'): void {
  userLocalOverride = mode === 'weak' ? 'weak' : 'inherit';
  if (typeof window !== 'undefined') {
    try {
      if (userLocalOverride === 'weak') {
        localStorage.setItem(LOCAL_OVERRIDE_STORAGE_KEY, 'weak');
      } else {
        localStorage.removeItem(LOCAL_OVERRIDE_STORAGE_KEY);
      }
    } catch {}
  }
  notifyQualitySubscribers();
}

export function reportSocketRttLatency(rttMs: number): void {
  if (!Number.isFinite(rttMs) || rttMs <= 0) return;
  const prevTier = getNetworkConnectionSnapshot().tier;
  lastMeasuredSocketRttMs = Math.round(rttMs);
  const now = Date.now();
  const prevWeak = now < telemetryWeakUntil;
  const prevMod = now < telemetryModerateUntil;

  if (rttMs >= 380) {
    telemetryWeakUntil = now + 20000;
  } else if (rttMs >= 180) {
    telemetryModerateUntil = now + 15000;
  }

  const nextTier = getNetworkConnectionSnapshot().tier;
  const nextWeak = Date.now() < telemetryWeakUntil;
  const nextMod = Date.now() < telemetryModerateUntil;
  if (nextTier !== prevTier || nextWeak !== prevWeak || nextMod !== prevMod) {
    notifyQualitySubscribers();
  }
}

export function reportLiveFrameBackpressure(highCongestion: boolean): void {
  if (!highCongestion) return;
  const now = Date.now();
  const prevWeak = now < telemetryWeakUntil;
  telemetryWeakUntil = now + 15000;
  if (!prevWeak) {
    notifyQualitySubscribers();
  }
}

export function reportWebRtcNetworkHealth(stats: { packetLossPct?: number | null; rttMs?: number | null }): void {
  const now = Date.now();
  const loss = typeof stats.packetLossPct === 'number' ? stats.packetLossPct : 0;
  const rtt = typeof stats.rttMs === 'number' ? stats.rttMs : 0;
  const prevWeak = now < telemetryWeakUntil;
  const prevMod = now < telemetryModerateUntil;

  if (loss >= 5 || rtt >= 360) {
    telemetryWeakUntil = now + 20000;
  } else if (loss >= 2.2 || rtt >= 200) {
    telemetryModerateUntil = now + 15000;
  }

  const nextWeak = Date.now() < telemetryWeakUntil;
  const nextMod = Date.now() < telemetryModerateUntil;
  if (nextWeak !== prevWeak || nextMod !== prevMod) {
    notifyQualitySubscribers();
  }
}

export function getEffectiveQualityProfile(): EffectiveQualityProfile {
  attachNetworkListenerOnce();
  const net = getNetworkConnectionSnapshot();
  const now = Date.now();
  const cfg = serverQualitySettings;

  let effectiveMode: 'high' | 'balanced' | 'weak' = 'balanced';
  if (userLocalOverride === 'weak' || cfg.preset === 'weak') {
    effectiveMode = 'weak';
  } else if (cfg.preset === 'high') {
    effectiveMode = cfg.autoAdaptWeakNet && (net.tier === 'slow' || now < telemetryWeakUntil) ? 'weak' : 'high';
  } else if (cfg.preset === 'balanced') {
    effectiveMode = cfg.autoAdaptWeakNet && (net.tier === 'slow' || now < telemetryWeakUntil) ? 'weak' : 'balanced';
  } else {
    // 'auto'
    if (net.tier === 'slow' || now < telemetryWeakUntil) {
      effectiveMode = 'weak';
    } else if (net.tier === 'medium' || now < telemetryModerateUntil) {
      effectiveMode = 'balanced';
    } else {
      effectiveMode = 'high';
    }
  }

  const weakRef = QUALITY_PRESET_TEMPLATES.weak;
  const balRef = QUALITY_PRESET_TEMPLATES.balanced;
  const highRef = QUALITY_PRESET_TEMPLATES.high;

  const pick = (serverVal: number, weakCap: number, highFloor?: number): number => {
    if (effectiveMode === 'weak') return Math.min(serverVal, weakCap);
    if (effectiveMode === 'high' && typeof highFloor === 'number') return Math.max(serverVal, highFloor);
    return serverVal;
  };

  // In explicit 'auto' preset, start from preset matching live network tier while honoring custom server bounds
  const baseCfg =
    cfg.preset === 'auto'
      ? effectiveMode === 'weak'
        ? {
            ...cfg,
            imageMaxDim: Math.min(cfg.imageMaxDim, weakRef.imageMaxDim),
            imageQuality: Math.min(cfg.imageQuality, weakRef.imageQuality),
            micAudioBitrateKbps: Math.min(cfg.micAudioBitrateKbps, weakRef.micAudioBitrateKbps),
            musicBitrateKbps: Math.min(cfg.musicBitrateKbps, weakRef.musicBitrateKbps),
            liveVideoWidth: Math.min(cfg.liveVideoWidth, weakRef.liveVideoWidth),
            liveVideoMaxFps: Math.min(cfg.liveVideoMaxFps, weakRef.liveVideoMaxFps),
            liveVideoQuality: Math.min(cfg.liveVideoQuality, weakRef.liveVideoQuality),
            privateCallAudioBitrateKbps: Math.min(cfg.privateCallAudioBitrateKbps, weakRef.privateCallAudioBitrateKbps),
            privateCallVideoMaxKbps: Math.min(cfg.privateCallVideoMaxKbps, weakRef.privateCallVideoMaxKbps),
            privateCallMaxWidth: Math.min(cfg.privateCallMaxWidth, weakRef.privateCallMaxWidth),
            privateCallMaxFps: Math.min(cfg.privateCallMaxFps, weakRef.privateCallMaxFps)
          }
        : effectiveMode === 'high'
          ? {
              ...cfg,
              imageMaxDim: Math.max(cfg.imageMaxDim, highRef.imageMaxDim),
              imageQuality: Math.max(cfg.imageQuality, highRef.imageQuality),
              micAudioBitrateKbps: Math.max(cfg.micAudioBitrateKbps, 32),
              musicBitrateKbps: Math.max(cfg.musicBitrateKbps, 56),
              liveVideoWidth: Math.max(cfg.liveVideoWidth, 360),
              liveVideoMaxFps: Math.max(cfg.liveVideoMaxFps, 10),
              liveVideoQuality: Math.max(cfg.liveVideoQuality, 0.62),
              privateCallAudioBitrateKbps: Math.max(cfg.privateCallAudioBitrateKbps, 30),
              privateCallVideoMaxKbps: Math.max(cfg.privateCallVideoMaxKbps, 550),
              privateCallMaxWidth: Math.max(cfg.privateCallMaxWidth, 560),
              privateCallMaxFps: Math.max(cfg.privateCallMaxFps, 20)
            }
          : balRef
      : cfg;

  const liveVideoWidth = pick(baseCfg.liveVideoWidth, 240);
  const liveVideoHeight = Math.round((liveVideoWidth * 3) / 4);
  const privateCallMaxWidth = pick(baseCfg.privateCallMaxWidth, 320);
  const privateCallMaxHeight = Math.round((privateCallMaxWidth * 3) / 4);

  let cloudinaryQualityToken: EffectiveQualityProfile['cloudinaryQualityToken'] = 'q_auto:good';
  if (cfg.cloudinaryDeliveryMode === 'eco' || effectiveMode === 'weak') {
    cloudinaryQualityToken = 'q_auto:eco';
  } else if (cfg.cloudinaryDeliveryMode === 'best' || (cfg.cloudinaryDeliveryMode === 'auto' && effectiveMode === 'high')) {
    cloudinaryQualityToken = 'q_auto:best';
  }

  return {
    effectiveMode,
    preset: cfg.preset,
    network: net,
    userLocalOverride,
    imageMaxDim: pick(baseCfg.imageMaxDim, 850),
    imageQuality: Number(pick(baseCfg.imageQuality, 0.62).toFixed(2)),
    cloudinaryQualityToken,
    cloudinaryImageMaxWidth: effectiveMode === 'weak' ? 800 : effectiveMode === 'balanced' ? 1200 : 1600,
    cloudinaryAvatarMaxWidth: effectiveMode === 'weak' ? 192 : effectiveMode === 'balanced' ? 280 : 360,
    micAudioBitrateKbps: pick(baseCfg.micAudioBitrateKbps, 14),
    musicBitrateKbps: pick(baseCfg.musicBitrateKbps, 28),
    pcmFallbackSampleRate: effectiveMode === 'weak' ? 11025 : 16000,
    pcmFallbackChunkMs: effectiveMode === 'weak' ? 420 : 340,
    liveVideoWidth,
    liveVideoHeight,
    liveVideoMaxFps: pick(baseCfg.liveVideoMaxFps, 4),
    liveVideoQuality: Number(pick(baseCfg.liveVideoQuality, 0.44).toFixed(2)),
    privateCallAudioBitrateKbps: pick(baseCfg.privateCallAudioBitrateKbps, 14),
    privateCallVideoMaxKbps: pick(baseCfg.privateCallVideoMaxKbps, 180),
    privateCallMaxWidth,
    privateCallMaxHeight,
    privateCallMaxFps: pick(baseCfg.privateCallMaxFps, 12)
  };
}

export function subscribeQualityProfile(cb: (profile: EffectiveQualityProfile) => void): () => void {
  attachNetworkListenerOnce();
  subscribers.add(cb);
  return () => {
    subscribers.delete(cb);
  };
}

export function notifyQualitySubscribers(): void {
  const profile = getEffectiveQualityProfile();
  subscribers.forEach((cb) => {
    try {
      cb(profile);
    } catch {}
  });
}
