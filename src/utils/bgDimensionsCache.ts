import { MEMBER_BG_PRESETS } from '../constants/membershipDesigns';

const STORAGE_KEY = 'hassan_member_bg_aspect_v1';
const MAX_CACHED_ENTRIES = 250;
const PRESET_ASPECT_RATIO = 600 / 180;

const memoryCache = new Map<string, number>();
let hydratedFromStorage = false;
let persistTimer: ReturnType<typeof setTimeout> | null = null;

function clampAspect(value: number): number | undefined {
  if (!Number.isFinite(value) || value <= 0) return undefined;
  return Number(Math.max(0.25, Math.min(12, value)).toFixed(4));
}

function hydrateCacheOnce(): void {
  if (hydratedFromStorage) return;
  hydratedFromStorage = true;
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      for (const [key, val] of Object.entries(parsed)) {
        const aspect = clampAspect(Number(val));
        if (key && aspect !== undefined) {
          memoryCache.set(key, aspect);
        }
      }
    }
  } catch {
    // Ignore storage read errors
  }
}

function schedulePersist(): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  if (persistTimer) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    try {
      while (memoryCache.size > MAX_CACHED_ENTRIES) {
        const oldestKey = memoryCache.keys().next().value;
        if (!oldestKey) break;
        memoryCache.delete(oldestKey);
      }
      const obj: Record<string, number> = {};
      memoryCache.forEach((v, k) => {
        obj[k] = v;
      });
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(obj));
    } catch {
      // Ignore storage quota errors
    }
  }, 200);
}

export function getCachedBgAspect(url?: string, explicitAspect?: number): number | undefined {
  hydrateCacheOnce();
  if (typeof explicitAspect === 'number') {
    const valid = clampAspect(explicitAspect);
    if (valid !== undefined) {
      if (url) {
        memoryCache.set(url, valid);
        schedulePersist();
      }
      return valid;
    }
  }
  if (!url) return undefined;
  if (url.startsWith('bg:')) {
    return PRESET_ASPECT_RATIO;
  }
  if (MEMBER_BG_PRESETS.some((p) => p.previewImage === url)) {
    return PRESET_ASPECT_RATIO;
  }
  return memoryCache.get(url);
}

export function seedBgAspect(url?: string, aspect?: number): void {
  if (!url || typeof aspect !== 'number') return;
  hydrateCacheOnce();
  const valid = clampAspect(aspect);
  if (valid === undefined) return;
  if (memoryCache.get(url) !== valid) {
    memoryCache.set(url, valid);
    schedulePersist();
  }
}

export function recordBgDimensions(url: string, width: number, height: number): number | undefined {
  if (!url || !Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return undefined;
  }
  hydrateCacheOnce();
  const valid = clampAspect(width / height);
  if (valid === undefined) return undefined;
  if (memoryCache.get(url) !== valid) {
    memoryCache.set(url, valid);
    schedulePersist();
  }
  return valid;
}

export function measureImageAspect(url: string): Promise<number | undefined> {
  if (!url) return Promise.resolve(undefined);
  const cached = getCachedBgAspect(url);
  if (cached !== undefined) return Promise.resolve(cached);
  if (typeof window === 'undefined' || typeof Image === 'undefined') {
    return Promise.resolve(undefined);
  }
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const aspect = recordBgDimensions(url, img.naturalWidth, img.naturalHeight);
      resolve(aspect);
    };
    img.onerror = () => resolve(undefined);
    img.src = url;
  });
}
