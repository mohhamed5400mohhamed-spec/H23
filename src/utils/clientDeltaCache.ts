import type { ChatShortcut } from './chatShortcuts';
import type { EmblemsConfig } from './emblemsSystem';
import type { MembershipDesignCatalog } from '../constants/membershipDesigns';
import type {
  ChatQualitySettings,
  ChatRoom,
  LikesThresholdSettings,
  MessageRetentionLimits,
  RoleDefinition,
  RoomStatData,
  ServerSecuritySettings,
  StoryItem,
  WallPost
} from '../types/chat';

const LEGACY_DELTA_CACHE_STORAGE_KEY = 'chathassan_delta_cache_v1';
const DELTA_VERSIONS_META_KEY = 'chathassan_delta_versions_v1';
const IDB_DELTA_DB_NAME = 'chathassan_cache_db';
const IDB_DELTA_STORE = 'delta_cache';
const IDB_DELTA_KEY = 'state';

const LEGACY_BLOATED_LS_KEYS = [
  LEGACY_DELTA_CACHE_STORAGE_KEY,
  'falcon_chat_banner',
  'falcon_avatar_icon',
  'soqoor_custom_themes'
];

export interface ClientConfigVersions {
  emblems?: string;
  shortcuts?: string;
  roles?: string;
  appearance?: string;
  wall?: string;
  stories?: string;
  membershipCatalog?: string;
  rooms?: string;
  roomStats?: string;
  serverSecurity?: string;
  recentLogins?: string;
  retentionLimits?: string;
  quality?: string;
}

export interface ClientCachedAppearance {
  theme?: string;
  fontFamily?: string;
  fontWeight?: 'thin' | 'normal' | 'default' | 'bold' | 'black';
  wallpaper?: string;
  bubbleStyle?: string;
  bannerUrl?: string;
  logoUrl?: string;
  customThemes?: any[];
}

export interface ClientDeltaCacheState {
  versions: ClientConfigVersions;
  data: {
    emblemsConfig?: EmblemsConfig;
    shortcuts?: ChatShortcut[];
    rolesConfig?: RoleDefinition[];
    rolePermissions?: Record<string, any>;
    globalAppearance?: ClientCachedAppearance;
    generalWelcome?: { enabled: boolean; message: string; title: string };
    likesSettings?: LikesThresholdSettings | any;
    wallPosts?: WallPost[];
    stories?: StoryItem[];
    membershipDesignCatalog?: MembershipDesignCatalog;
    rooms?: ChatRoom[];
    roomStats?: RoomStatData[];
    serverSecurity?: Partial<ServerSecuritySettings>;
    recentLogins?: any[];
    messageRetentionLimits?: MessageRetentionLimits;
    chatQualitySettings?: ChatQualitySettings;
  };
  updatedAt: number;
}

let inMemoryDeltaCache: ClientDeltaCacheState | null = null;
let pendingIdbWriteTimer: ReturnType<typeof setTimeout> | null = null;
let didCleanupLegacyLs = false;
let lastSavedVersionsMetaJson = '';

const MAX_INLINE_DATA_URI_LEN = 0;

function stripLargeDataUri(url?: string): string | undefined {
  if (!url || typeof url !== 'string') return url;
  if (url.startsWith('data:') && url.length > MAX_INLINE_DATA_URI_LEN) {
    return undefined;
  }
  return url;
}

function sanitizeWallPostsForCache(posts: WallPost[], limit = 25): WallPost[] {
  return posts.slice(0, Math.max(1, limit)).map((post) => ({
    ...post,
    mediaUrl: stripLargeDataUri(post.mediaUrl),
    userAvatar: stripLargeDataUri((post as any).userAvatar)
  }));
}

function sanitizeStoriesForCache(stories: StoryItem[], limit = 10): StoryItem[] {
  return stories.slice(0, Math.max(1, limit)).map((story) => ({
    ...story,
    mediaUrl: stripLargeDataUri(story.mediaUrl) || '',
    avatarUrl: stripLargeDataUri(story.avatarUrl)
  }));
}

function buildCompactStorageCopy(state: ClientDeltaCacheState): ClientDeltaCacheState {
  const safeAppearance = state.data.globalAppearance
    ? {
        ...state.data.globalAppearance,
        wallpaper: stripLargeDataUri(state.data.globalAppearance.wallpaper),
        bannerUrl: stripLargeDataUri(state.data.globalAppearance.bannerUrl),
        logoUrl: stripLargeDataUri(state.data.globalAppearance.logoUrl)
      }
    : undefined;

  const safeEmblems = state.data.emblemsConfig
    ? {
        ...state.data.emblemsConfig,
        falconChatBanner: stripLargeDataUri(state.data.emblemsConfig.falconChatBanner),
        falconAvatarIcon: stripLargeDataUri(state.data.emblemsConfig.falconAvatarIcon),
        items: Array.isArray(state.data.emblemsConfig.items)
          ? state.data.emblemsConfig.items.map((item) => ({
              ...item,
              imageUrl: stripLargeDataUri(item.imageUrl) || ''
            }))
          : []
      }
    : undefined;

  const safeMembershipCatalog = state.data.membershipDesignCatalog
    ? {
        customFrames: Array.isArray(state.data.membershipDesignCatalog.customFrames)
          ? state.data.membershipDesignCatalog.customFrames
              .map((item) => ({ ...item, imageUrl: stripLargeDataUri(item.imageUrl) || '' }))
              .filter((item) => Boolean(item.imageUrl))
          : [],
        customBgs: Array.isArray(state.data.membershipDesignCatalog.customBgs)
          ? state.data.membershipDesignCatalog.customBgs
              .map((item) => ({ ...item, imageUrl: stripLargeDataUri(item.imageUrl) || '' }))
              .filter((item) => Boolean(item.imageUrl))
          : [],
        deletedPresetFrameIds: Array.isArray(state.data.membershipDesignCatalog.deletedPresetFrameIds)
          ? state.data.membershipDesignCatalog.deletedPresetFrameIds
          : [],
        deletedPresetBgIds: Array.isArray(state.data.membershipDesignCatalog.deletedPresetBgIds)
          ? state.data.membershipDesignCatalog.deletedPresetBgIds
          : []
      }
    : undefined;

  const wallCacheCap = Math.min(25, Math.max(1, state.data.messageRetentionLimits?.wallMaxPosts || 25));

  return {
    ...state,
    data: {
      ...state.data,
      globalAppearance: safeAppearance,
      emblemsConfig: safeEmblems,
      membershipDesignCatalog: safeMembershipCatalog,
      wallPosts: state.data.wallPosts ? sanitizeWallPostsForCache(state.data.wallPosts, wallCacheCap) : undefined,
      stories: state.data.stories ? sanitizeStoriesForCache(state.data.stories, 10) : undefined
    }
  };
}

function openDeltaIdb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    try {
      if (typeof indexedDB === 'undefined') {
        reject(new Error('IndexedDB unavailable'));
        return;
      }
      const req = indexedDB.open(IDB_DELTA_DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(IDB_DELTA_STORE)) {
          db.createObjectStore(IDB_DELTA_STORE);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    } catch (err) {
      reject(err);
    }
  });
}

async function readFromIdb(): Promise<ClientDeltaCacheState | null> {
  try {
    const db = await openDeltaIdb();
    return await new Promise<ClientDeltaCacheState | null>((resolve) => {
      try {
        const tx = db.transaction(IDB_DELTA_STORE, 'readonly');
        const store = tx.objectStore(IDB_DELTA_STORE);
        const req = store.get(IDB_DELTA_KEY);
        req.onsuccess = () => resolve((req.result as ClientDeltaCacheState) || null);
        req.onerror = () => resolve(null);
        tx.oncomplete = () => {
          try { db.close(); } catch {}
        };
      } catch {
        try { db.close(); } catch {}
        resolve(null);
      }
    });
  } catch {
    return null;
  }
}

async function writeToIdb(state: ClientDeltaCacheState): Promise<void> {
  try {
    const db = await openDeltaIdb();
    await new Promise<void>((resolve) => {
      try {
        const tx = db.transaction(IDB_DELTA_STORE, 'readwrite');
        const store = tx.objectStore(IDB_DELTA_STORE);
        store.put(state, IDB_DELTA_KEY);
        tx.oncomplete = () => {
          try { db.close(); } catch {}
          resolve();
        };
        tx.onerror = () => {
          try { db.close(); } catch {}
          resolve();
        };
      } catch {
        try { db.close(); } catch {}
        resolve();
      }
    });
  } catch {}
}

function cleanupLegacyBloatedLocalStorage(): void {
  if (didCleanupLegacyLs || typeof window === 'undefined') return;
  didCleanupLegacyLs = true;
  try {
    for (const k of LEGACY_BLOATED_LS_KEYS) {
      localStorage.removeItem(k);
    }
  } catch {}
}

/**
 * Hydrates in-memory delta cache from IndexedDB before initial React render
 * (migrating and deleting any legacy bloated localStorage keys).
 */
export async function hydrateDeltaCacheFromIndexedDb(timeoutMs = 150): Promise<ClientDeltaCacheState> {
  const empty: ClientDeltaCacheState = { versions: {}, data: {}, updatedAt: 0 };
  if (typeof window === 'undefined') {
    inMemoryDeltaCache = empty;
    return empty;
  }

  let loaded: ClientDeltaCacheState | null = null;
  let loadedFromLegacy = false;
  try {
    loaded = await Promise.race<ClientDeltaCacheState | null>([
      readFromIdb(),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs))
    ]);
  } catch {
    loaded = null;
  }

  // One-time migration from legacy bloated localStorage key to IndexedDB
  if (!loaded) {
    try {
      const legacyRaw = localStorage.getItem(LEGACY_DELTA_CACHE_STORAGE_KEY);
      if (legacyRaw) {
        const parsed = JSON.parse(legacyRaw);
        if (parsed && typeof parsed === 'object') {
          loaded = {
            versions: parsed.versions && typeof parsed.versions === 'object' ? parsed.versions : {},
            data: parsed.data && typeof parsed.data === 'object' ? parsed.data : {},
            updatedAt: typeof parsed.updatedAt === 'number' ? parsed.updatedAt : Date.now()
          };
          loadedFromLegacy = true;
        }
      }
    } catch {}
  }

  cleanupLegacyBloatedLocalStorage();

  if (loaded && typeof loaded === 'object') {
    const compacted = buildCompactStorageCopy({
      versions: loaded.versions && typeof loaded.versions === 'object' ? loaded.versions : {},
      data: loaded.data && typeof loaded.data === 'object' ? loaded.data : {},
      updatedAt: typeof loaded.updatedAt === 'number' ? loaded.updatedAt : Date.now()
    });
    inMemoryDeltaCache = compacted;
    if (loadedFromLegacy) {
      void writeToIdb(compacted);
    }
    try {
      const metaJson = JSON.stringify({ versions: inMemoryDeltaCache.versions, updatedAt: inMemoryDeltaCache.updatedAt });
      if (metaJson !== lastSavedVersionsMetaJson) {
        lastSavedVersionsMetaJson = metaJson;
        localStorage.setItem(DELTA_VERSIONS_META_KEY, metaJson);
      }
    } catch {}
    return inMemoryDeltaCache;
  }

  inMemoryDeltaCache = empty;
  return empty;
}

export function readDeltaCache(): ClientDeltaCacheState {
  if (inMemoryDeltaCache) return inMemoryDeltaCache;
  const empty: ClientDeltaCacheState = { versions: {}, data: {}, updatedAt: 0 };
  if (typeof window === 'undefined') return empty;
  // Synchronous fallback if read before hydrate completes: only read tiny versions manifest if legacy absent
  try {
    const legacyRaw = localStorage.getItem(LEGACY_DELTA_CACHE_STORAGE_KEY);
    if (legacyRaw) {
      const parsed = JSON.parse(legacyRaw);
      if (parsed && typeof parsed === 'object') {
        inMemoryDeltaCache = {
          versions: parsed.versions && typeof parsed.versions === 'object' ? parsed.versions : {},
          data: parsed.data && typeof parsed.data === 'object' ? parsed.data : {},
          updatedAt: typeof parsed.updatedAt === 'number' ? parsed.updatedAt : Date.now()
        };
        return inMemoryDeltaCache;
      }
    }
  } catch {}
  inMemoryDeltaCache = empty;
  return empty;
}

export function getCachedVersions(): ClientConfigVersions {
  const cache = readDeltaCache();
  // Guard: never claim we have a cached version if the underlying IndexedDB data payload is empty
  if (!cache.data || Object.keys(cache.data).length === 0) {
    return {};
  }
  const v = cache.versions;
  return {
    ...(v.emblems && cache.data.emblemsConfig ? { emblems: v.emblems } : {}),
    ...(v.shortcuts && cache.data.shortcuts ? { shortcuts: v.shortcuts } : {}),
    ...(v.roles && cache.data.rolesConfig ? { roles: v.roles } : {}),
    ...(v.appearance && cache.data.globalAppearance ? { appearance: v.appearance } : {}),
    ...(v.wall && cache.data.wallPosts ? { wall: v.wall } : {}),
    ...(v.stories && cache.data.stories ? { stories: v.stories } : {}),
    ...(v.membershipCatalog && cache.data.membershipDesignCatalog ? { membershipCatalog: v.membershipCatalog } : {}),
    ...(v.rooms && cache.data.rooms ? { rooms: v.rooms } : {}),
    ...(v.roomStats && cache.data.roomStats ? { roomStats: v.roomStats } : {}),
    ...(v.serverSecurity && cache.data.serverSecurity ? { serverSecurity: v.serverSecurity } : {}),
    ...(v.recentLogins && cache.data.recentLogins ? { recentLogins: v.recentLogins } : {}),
    ...(v.retentionLimits && cache.data.messageRetentionLimits ? { retentionLimits: v.retentionLimits } : {}),
    ...(v.quality && cache.data.chatQualitySettings ? { quality: v.quality } : {})
  };
}

export function saveDeltaCachePatch(patch: {
  versions?: Partial<ClientConfigVersions>;
  data?: Partial<ClientDeltaCacheState['data']>;
}): ClientDeltaCacheState {
  const current = readDeltaCache();
  const nextData: ClientDeltaCacheState['data'] = {
    ...current.data,
    ...(patch.data || {})
  };
  const wallCacheCap = Math.min(25, Math.max(1, nextData.messageRetentionLimits?.wallMaxPosts || 25));
  if (patch.data?.wallPosts || (patch.data?.messageRetentionLimits && Array.isArray(nextData.wallPosts))) {
    nextData.wallPosts = sanitizeWallPostsForCache(nextData.wallPosts || [], wallCacheCap);
  }
  if (patch.data?.stories) {
    nextData.stories = sanitizeStoriesForCache(patch.data.stories, 10);
  }
  const next: ClientDeltaCacheState = {
    versions: {
      ...current.versions,
      ...(patch.versions || {})
    },
    data: nextData,
    updatedAt: Date.now()
  };
  inMemoryDeltaCache = next;

  if (typeof window !== 'undefined') {
    try {
      const metaJson = JSON.stringify({ versions: next.versions, updatedAt: next.updatedAt });
      if (metaJson !== lastSavedVersionsMetaJson) {
        lastSavedVersionsMetaJson = metaJson;
        localStorage.setItem(DELTA_VERSIONS_META_KEY, metaJson);
      }
      cleanupLegacyBloatedLocalStorage();
    } catch {}

    const persistable = buildCompactStorageCopy(next);
    if (pendingIdbWriteTimer) {
      clearTimeout(pendingIdbWriteTimer);
    }
    pendingIdbWriteTimer = setTimeout(() => {
      pendingIdbWriteTimer = null;
      void writeToIdb(persistable);
    }, 60);
  }
  return next;
}
