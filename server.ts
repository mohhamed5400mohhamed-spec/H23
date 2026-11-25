import 'dotenv/config';
import express from 'express';
import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import zlib from 'zlib';
import { fileURLToPath } from 'url';
import bcrypt from 'bcryptjs';
import { dataManager } from './server/data/dataAdapter.ts';
import { storageManager, validateMediaMagicBytes } from './server/storage/storageAdapter.ts';
import {
  DEFAULT_EMBLEMS,
  DEFAULT_FALCON_CHAT_BANNER,
  DEFAULT_FALCON_AVATAR_ICON
} from './src/utils/emblemsSystem.ts';
import type {
  EmblemItem,
  EmblemType,
  EmblemsConfig,
  EmojiSizeSetting
} from './src/utils/emblemsSystem.ts';
import type { ChatQualitySettings } from './src/types/chat.ts';
import {
  DEFAULT_CHAT_QUALITY_SETTINGS,
  clampChatQualitySettings
} from './src/utils/networkQualityEngine.ts';
import { extractYouTubeVideoId } from './src/utils/youtube.ts';
import { YouTube as YouTubeSR } from 'youtube-sr';
import { socketFloodGuard } from './server/security/floodGuard.ts';
import { createBotEngine } from './bot.js';
import { registerBotController } from './botController.js';


const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.set('trust proxy', 1);

// Production, Security, and Cross-Origin Headers
const allowedOrigins = new Set(
  [
    process.env.CORS_ORIGIN,
    process.env.FRONTEND_URL,
    process.env.APP_URL,
    process.env.PUBLIC_SERVER_URL,
    process.env.SERVER_PUBLIC_URL,
    process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : undefined
  ]
    .filter((origin): origin is string => Boolean(origin))
    .map((origin) => origin.trim().replace(/\/$/, ''))
);

function isOriginAllowed(origin: string | undefined, hostHeader?: string): boolean {
  if (!origin) return true;
  const normalized = origin.trim().replace(/\/$/, '');
  if (allowedOrigins.has(normalized)) return true;
  try {
    const parsed = new URL(normalized);
    if (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1') return true;
    if (hostHeader) {
      const candidateHosts = hostHeader
        .split(',')
        .map((h) => h.trim().toLowerCase())
        .filter(Boolean);
      if (candidateHosts.includes(parsed.host.toLowerCase())) return true;
    }
    if (process.env.NODE_ENV !== 'production') return true;
  } catch {
    return false;
  }
  return false;
}

app.use((req, res, next) => {
  const requestOrigin = req.headers.origin;
  const hostHeader = (req.headers['x-forwarded-host'] as string) || req.headers.host;
  if (requestOrigin) {
    if (isOriginAllowed(requestOrigin, hostHeader)) {
      res.setHeader('Access-Control-Allow-Origin', requestOrigin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Credentials', 'true');
    } else if (req.method === 'OPTIONS') {
      return res.sendStatus(403);
    }
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-session-token, x-filename, x-mime-type, x-mediatype');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }
  next();
});

const httpServer = createServer(app);

// Keep-Alive connection tuning for reverse proxy and WebSocket persistence (up to 5+ minutes continuous persistence)
httpServer.keepAliveTimeout = 310000;
httpServer.headersTimeout = 320000;

const io = new SocketIOServer(httpServer, {
  cors: (req, callback) => {
    const origin = req.headers.origin;
    const hostHeader = (req.headers['x-forwarded-host'] as string) || req.headers.host;
    if (isOriginAllowed(origin, hostHeader)) {
      return callback(null, { origin: true, methods: ['GET', 'POST'], credentials: true });
    }
    return callback(new Error('Origin not allowed by CORS'), { origin: false });
  },
  allowRequest: (req, callback) => {
    const origin = req.headers.origin;
    const hostHeader = (req.headers['x-forwarded-host'] as string) || req.headers.host;
    if (isOriginAllowed(origin, hostHeader)) {
      return callback(null, true);
    }
    return callback('Origin not allowed by CORS', false);
  },
  maxHttpBufferSize: 50 * 1024 * 1024, // 50MB buffer
  pingTimeout: 120000, // 120s high-tolerance timeout for mobile OS background sleep
  pingInterval: 10000, // 10s heartbeat to prevent mobile carrier NAT / reverse proxy drops
  connectTimeout: 45000,
  upgradeTimeout: 30000,
  allowUpgrades: true,
  perMessageDeflate: { threshold: 1024 }, // Compress large JSON payloads (>1KB) without adding overhead to tiny chat messages
  httpCompression: true,
  allowEIO3: true,
  transports: ['websocket', 'polling']
});

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

// Lightweight gzip compression for JSON /api/* responses (reduces mobile payload overhead without interfering with Vite/binary streams)
app.use('/api', (req, res, next) => {
  if (req.path === '/keepalive') return next();
  const acceptEncoding = String(req.headers['accept-encoding'] || '');
  if (!/\bgzip\b/i.test(acceptEncoding)) return next();

  const originalJson = res.json.bind(res);
  (res as any).json = (body: any) => {
    if (res.headersSent) return originalJson(body);
    try {
      const jsonStr = JSON.stringify(body);
      if (!jsonStr || jsonStr.length < 512) {
        return originalJson(body);
      }
      zlib.gzip(Buffer.from(jsonStr, 'utf8'), { level: 5 }, (err, compressed) => {
        if (err || !compressed || res.headersSent) {
          return originalJson(body);
        }
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Content-Encoding', 'gzip');
        res.setHeader('Vary', 'Accept-Encoding');
        res.removeHeader('Content-Length');
        return res.send(compressed);
      });
      return res;
    } catch {
      return originalJson(body);
    }
  };
  next();
});

  // Serve media from the same persistent directory used by StorageManager.
  const uploadsDir = process.env.UPLOADS_DIR || process.env.RAILWAY_VOLUME_MOUNT_PATH
    || path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}
app.use(
  '/uploads',
  express.static(uploadsDir, {
    maxAge: '365d',
    immutable: true,
    etag: true,
    setHeaders: (res, filePath) => {
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      if (/\.(svg|html?|xml|js|mjs)$/i.test(filePath)) {
        res.setHeader('Content-Disposition', 'attachment');
      }
    }
  })
);

function toPublicMediaUrl(url: string, req?: express.Request): string {
  if (!url) return url;
  if (url.includes('localhost:3000') || url.includes('127.0.0.1:3000')) {
    url = url.replace(/^https?:\/\/(localhost|127\.0\.0\.1):3000/i, '');
  }
  if (/^https?:\/\//i.test(url)) return url;
  const configuredOrigin = process.env.PUBLIC_SERVER_URL || process.env.SERVER_PUBLIC_URL || process.env.STORAGE_PUBLIC_URL_PREFIX;
  if (configuredOrigin) {
    const origin = configuredOrigin.replace(/\/$/, '');
    return `${origin}${url.startsWith('/') ? url : `/${url}`}`;
  }
  return url.startsWith('/') ? url : `/${url}`;
}

// Ultra-lightweight keepalive endpoint for background Web Worker to keep mobile TCP radio alive
app.get('/api/keepalive', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.setHeader('Connection', 'keep-alive');
  res.status(200).json({ ok: true, ts: Date.now() });
});

// Runtime ICE / STUN / TURN configuration endpoint (ensures runtime Render/Cloud env vars apply without rebuild)
app.get('/api/ice-servers', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const turnUrl = (process.env.TURN_SERVER_URL || process.env.VITE_TURN_SERVER_URL || '').trim();
  const turnUser = (process.env.TURN_USERNAME || process.env.VITE_TURN_USERNAME || '').trim();
  const turnPass = (process.env.TURN_CREDENTIAL || process.env.VITE_TURN_CREDENTIAL || '').trim();

  const iceServers: Array<{ urls: string | string[]; username?: string; credential?: string }> = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:global.stun.twilio.com:3478' },
    {
      urls: [
        'turns:openrelay.metered.ca:443?transport=tcp',
        'turn:openrelay.metered.ca:443?transport=tcp',
        'turn:openrelay.metered.ca:80',
        'turn:openrelay.metered.ca:443'
      ],
      username: 'openrelayproject',
      credential: 'openrelayproject'
    }
  ];

  if (turnUrl) {
    iceServers.unshift({
      urls: turnUrl.split(',').map((u) => u.trim()).filter(Boolean),
      ...(turnUser ? { username: turnUser } : {}),
      ...(turnPass ? { credential: turnPass } : {})
    });
  }

  res.status(200).json({ iceServers });
});

const httpRateLimitMap = new Map<string, { count: number; resetAt: number }>();
const hourlyPointsRewardMap = new Map<string, { total: number; resetAt: number }>();
function checkHttpRateLimit(bucket: string, key: string, maxRequests: number, windowMs: number): boolean {
  const now = Date.now();
  const composite = `${bucket}:${key}`;
  const entry = httpRateLimitMap.get(composite);
  if (entry && entry.resetAt > now) {
    if (entry.count >= maxRequests) return false;
    entry.count += 1;
    return true;
  }
  if (httpRateLimitMap.size >= 5000) {
    for (const [k, v] of httpRateLimitMap.entries()) {
      if (v.resetAt <= now) httpRateLimitMap.delete(k);
    }
  }
  httpRateLimitMap.set(composite, { count: 1, resetAt: now + windowMs });
  return true;
}

function getRequestClientIp(req: express.Request): string {
  const cfRay = Boolean(req.headers['cf-ray']);
  return ((cfRay ? (req.headers['cf-connecting-ip'] as string) : undefined) || req.ip || 'unknown').trim();
}

function resolveVerifiedHttpSession(token: string, expectedUsername?: string): UserSession | null {
  if (!token || typeof token !== 'string') return null;
  const sess = activeSessions.get(token);
  if (!sess || sess.isExplicitlyLoggedOut || !sess.user?.username) return null;
  if (expectedUsername && sess.user.username.toLowerCase() !== expectedUsername.trim().toLowerCase()) {
    return null;
  }
  const effectiveRole = getRegisteredMember(sess.user.username)?.member.role || sess.user.role;
  if (!isSupremeHassan(effectiveRole) && bannedUsers.has(sess.user.username.toLowerCase())) return null;
  const verified = verifySignedSessionTokenPayload(token, sess.user.username);
  if (!verified) return null;
  return sess;
}

// Storage & Database Health / Status Endpoint
app.get('/api/system/storage-status', (req, res) => {
  const token = extractUploadSessionToken(req);
  const sess = resolveVerifiedHttpSession(token);
  const isAuthorizedStaff = Boolean(sess && isStaffUser(sess.user));
  const dataStatus = dataManager.getStatus();

  if (!isAuthorizedStaff) {
    return res.json({
      success: true,
      data: {
        driver: dataStatus.driver,
        isCloudConnected: dataStatus.isCloudConnected
      },
      storage: {
        provider: storageManager.getProviderName(),
        isExternal: storageManager.isExternal()
      }
    });
  }

  return res.json({
    success: true,
    data: dataStatus,
    storage: {
      provider: storageManager.getProviderName(),
      isExternal: storageManager.isExternal(),
      endpoint: storageManager.getConfig().endpoint || 'local filesystem',
      bucket: storageManager.getConfig().bucket || 'uploads'
    }
  });
});

// Standalone Admin Panel Session Verification Endpoint
app.get('/api/admin/verify-session', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const token = extractUploadSessionToken(req);
  if (!token) {
    return res.status(401).json({ ok: false, authorized: false, reason: 'missing_token' });
  }
  const sess = resolveVerifiedHttpSession(token);
  if (!sess) {
    return res.status(401).json({ ok: false, authorized: false, reason: 'invalid_session' });
  }
  const authorized = isStaffUser(sess.user);
  if (!authorized) {
    return res.status(403).json({ ok: false, authorized: false, reason: 'insufficient_role' });
  }
  return res.json({
    ok: true,
    authorized: true,
    username: sess.user.username,
    role: sess.user.role
  });
});

// First-run Supreme Admin Bootstrap Status & One-Time Claim Endpoints
app.get('/api/auth/admin-bootstrap-status', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  return res.json({ ok: true, needsAdminSetup: isAdminClaimRequired() });
});

app.post('/api/auth/claim-admin', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const reqIp = getRequestClientIp(req);
  if (!checkHttpRateLimit('claim-admin', reqIp, 5, 15 * 60_000)) {
    return res.status(429).json({
      ok: false,
      error: 'تم تجاوز عدد محاولات التهيئة المسموح بها، يرجى الانتظار 15 دقيقة.'
    });
  }
  if (!isAdminClaimRequired()) {
    return res.status(403).json({
      ok: false,
      error: 'تم تعيين كلمة مرور الإدارة العليا مسبقاً أو تم ضبطها عبر متغيرات البيئة.'
    });
  }
  const rawPassword = typeof req.body?.password === 'string' ? req.body.password.trim() : '';
  if (rawPassword.length < 6) {
    return res.status(400).json({
      ok: false,
      error: 'يجب أن تتكون كلمة مرور الإدارة العليا من 6 أحرف أو أرقام على الأقل.'
    });
  }
  if (rawPassword === '123456' || rawPassword === 'password' || rawPassword === 'admin123') {
    return res.status(400).json({
      ok: false,
      error: 'يرجى اختيار كلمة مرور أقوى وغير شائعة لحماية حساب الإدارة العليا.'
    });
  }

  if (!registeredMembers['admin']) {
    registeredMembers['admin'] = {
      password: '',
      role: 'hassan',
      flag: '👑',
      statusQuote: 'مدير عام شات حسان برو 🦅',
      avatarUrl: '',
      likes: 10000,
      points: 2000000,
      honorBadge: '👑 المدير التنفيذي',
      nameBannerUrl: '',
      giftBadges: [],
      tokenVersion: 1
    };
  }
  registeredMembers['admin'].role = 'hassan';
  registeredMembers['admin'].password = hashPassword(rawPassword);
  registeredMembers['admin'].tokenVersion = Math.max(1, registeredMembers['admin'].tokenVersion || 1) + 1;
  saveMembers();
  io.emit('adminBootstrapStatus', { needsAdminSetup: false });
  return res.json({ ok: true });
});

const ytSearchRateLimitMap = new Map<string, { count: number; resetAt: number }>();
const ytSearchCache = new Map<string, { ts: number; results: any[] }>();
const YT_CACHE_TTL_MS = 5 * 60 * 1000;

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs = 4500): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function withPromiseTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), timeoutMs);
    promise.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      }
    );
  });
}

// YouTube Search API Endpoint (البحث المباشر في يوتيوب مع كاش فوري ومصادر احتياطية متوازية)
app.get('/api/youtube-search', async (req, res) => {
  const cfRay = Boolean(req.headers['cf-ray']);
  const reqIp = ((cfRay ? (req.headers['cf-connecting-ip'] as string) : undefined) || req.ip || 'unknown').trim();
  const nowTs = Date.now();
  const rl = ytSearchRateLimitMap.get(reqIp);
  if (rl && rl.resetAt > nowTs) {
    if (rl.count >= 20) {
      return res.status(429).json({ success: false, results: [], error: 'تم تجاوز حد طلبات البحث المؤقت، يرجى الانتظار دقيقة.' });
    }
    rl.count += 1;
  } else {
    ytSearchRateLimitMap.set(reqIp, { count: 1, resetAt: nowTs + 60_000 });
  }

  const query = (req.query.q as string)?.trim();
  if (!query) {
    return res.status(400).json({ success: false, results: [], error: 'يرجى إدخال كلمة البحث' });
  }

  const cacheKey = query.toLowerCase();
  const cached = ytSearchCache.get(cacheKey);
  if (cached && nowTs - cached.ts < YT_CACHE_TTL_MS) {
    return res.json({ success: true, results: cached.results });
  }

  const cacheAndRespond = (results: any[]) => {
    if (ytSearchCache.size >= 100) {
      const oldestKey = ytSearchCache.keys().next().value;
      if (oldestKey !== undefined) ytSearchCache.delete(oldestKey);
    }
    ytSearchCache.set(cacheKey, { ts: Date.now(), results });
    return res.json({ success: true, results });
  };

  try {
    // Primary Engine: YouTube InnerTube API (JSON-only, fast 3.5s budget)
    try {
      const ytResponse = await fetchWithTimeout('https://www.youtube.com/youtubei/v1/search?prettyPrint=false', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
        },
        body: JSON.stringify({
          context: {
            client: {
              clientName: 'WEB',
              clientVersion: '2.20240201.00.00',
              hl: 'ar',
              gl: 'SA'
            }
          },
          query
        })
      }, 3500);

      if (ytResponse.ok) {
        const data = (await ytResponse.json()) as any;
        const sections = data.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer?.contents || [];
        const formatted: Array<{
          id: string;
          title: string;
          thumbnail: string;
          duration: string;
          channelTitle: string;
          views: string;
          uploadedAt: string;
          url: string;
        }> = [];

        for (const sec of sections) {
          const items = sec.itemSectionRenderer?.contents || [];
          for (const item of items) {
            if (item.videoRenderer) {
              const v = item.videoRenderer;
              const videoId = v.videoId;
              if (videoId && typeof videoId === 'string') {
                const title =
                  v.title?.runs?.map((r: any) => r.text).join('') ||
                  v.title?.simpleText ||
                  query;
                const thumbnail =
                  v.thumbnail?.thumbnails?.slice(-1)[0]?.url ||
                  `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;
                const duration = v.lengthText?.simpleText || '';
                const channelTitle =
                  v.ownerText?.runs?.map((r: any) => r.text).join('') ||
                  'قناة يوتيوب';
                const views =
                  v.viewCountText?.simpleText ||
                  (v.viewCountText?.runs ? v.viewCountText.runs.map((r: any) => r.text).join('') : '');
                const uploadedAt = v.publishedTimeText?.simpleText || '';

                formatted.push({
                  id: videoId,
                  title,
                  thumbnail,
                  duration,
                  channelTitle,
                  views,
                  uploadedAt,
                  url: `https://www.youtube.com/watch?v=${videoId}`
                });
              }
            }
          }
        }

        if (formatted.length > 0) {
          return cacheAndRespond(formatted.slice(0, 25));
        }
      }
    } catch {}

    // Parallel Fallbacks: youtube-sr & Invidious race concurrently so user never waits sequentially
    const searchWithSr = async () => {
      const srResults = await withPromiseTimeout(
        YouTubeSR.search(query, { limit: 20, type: 'video', safeSearch: true }),
        4000
      );
      if (!Array.isArray(srResults) || srResults.length === 0) throw new Error('empty');
      const mapped = srResults
        .filter((v) => Boolean(v?.id))
        .map((v) => ({
          id: v.id || '',
          title: v.title || query,
          thumbnail: v.thumbnail?.url || `https://img.youtube.com/vi/${v.id}/hqdefault.jpg`,
          duration: v.durationFormatted || '',
          channelTitle: v.channel?.name || 'قناة يوتيوب',
          views: v.views ? `${Number(v.views).toLocaleString()} مشاهدة` : '',
          uploadedAt: v.uploadedAt || '',
          url: `https://www.youtube.com/watch?v=${v.id}`
        }));
      if (mapped.length === 0) throw new Error('empty');
      return mapped;
    };

    const searchWithInvidious = async () => {
      const invidiousRes = await fetchWithTimeout(`https://inv.tux.pizza/api/v1/search?q=${encodeURIComponent(query)}&type=video`, {
        headers: { 'Accept': 'application/json' }
      }, 4000);
      if (!invidiousRes.ok) throw new Error('http_error');
      const invData = (await invidiousRes.json()) as any[];
      if (!Array.isArray(invData) || invData.length === 0) throw new Error('empty');
      const invResults = invData
        .slice(0, 20)
        .map((v) => ({
          id: v.videoId || '',
          title: v.title || query,
          thumbnail: v.videoThumbnails?.[0]?.url || `https://img.youtube.com/vi/${v.videoId}/hqdefault.jpg`,
          duration: v.lengthSeconds ? `${Math.floor(v.lengthSeconds / 60)}:${String(v.lengthSeconds % 60).padStart(2, '0')}` : '',
          channelTitle: v.author || 'قناة يوتيوب',
          views: v.viewCount ? `${v.viewCount.toLocaleString()} مشاهدة` : '',
          uploadedAt: v.publishedText || '',
          url: `https://www.youtube.com/watch?v=${v.videoId}`
        }))
        .filter((v) => Boolean(v.id));
      if (invResults.length === 0) throw new Error('empty');
      return invResults;
    };

    try {
      const fastFallback = await Promise.any([searchWithSr(), searchWithInvidious()]);
      return cacheAndRespond(fastFallback);
    } catch {}

    return res.json({ success: true, results: [] });
  } catch (err: any) {
    console.error('[YouTube Search] Search error handled safely:', err?.message);
    return res.json({
      success: true,
      results: [],
      warning: 'تعذر الاتصال بخدمة البحث مؤقتاً، يمكنك لصق رابط الفيديو مباشرة في الحائط.'
    });
  }
});

function extractUploadSessionToken(req: express.Request): string {
  const headerToken = (req.headers['x-session-token'] as string) || '';
  const authHeader = (req.headers['authorization'] as string) || '';
  const bearer = authHeader.toLowerCase().startsWith('bearer ') ? authHeader.slice(7).trim() : '';
  return (headerToken || bearer).trim();
}

function getAuthorizedUploadSession(req: express.Request): UserSession | null {
  const token = extractUploadSessionToken(req);
  const sess = resolveVerifiedHttpSession(token);
  if (!sess || sess.user.isJailed) return null;
  return sess;
}

// HTTP Media Upload Endpoint: Bypasses WebSocket frames to prevent socket freeze/disconnect
app.post('/api/upload-media-binary', async (req, res) => {
  try {
    const uploadSess = getAuthorizedUploadSession(req);
    if (!uploadSess) {
      return res.status(401).json({ success: false, error: 'يجب تسجيل الدخول أولاً لرفع الملفات.' });
    }
    const reqKey = `${getRequestClientIp(req)}:${uploadSess.user.username.toLowerCase()}`;
    if (!checkHttpRateLimit('upload-media', reqKey, 25, 60_000)) {
      return res.status(429).json({ success: false, error: 'تم تجاوز الحد المسموح لرفع الملفات، يرجى الانتظار دقيقة.' });
    }
    let rawFilename = 'file';
    try {
      rawFilename = req.headers['x-filename'] ? decodeURIComponent(req.headers['x-filename'] as string) : 'file';
    } catch {
      return res.status(400).json({ success: false, error: 'اسم الملف في الترويسة غير صالح.' });
    }
    const mime = (req.headers['content-type'] || '').toLowerCase();
    if (
      mime.includes('svg') ||
      mime.includes('html') ||
      mime.includes('javascript') ||
      /\.(svg|html?|xhtml|js|mjs)$/i.test(rawFilename)
    ) {
      return res.status(400).json({ success: false, error: 'صيغة الملف غير مسموح برفعها لأسباب أمنية.' });
    }

    const uploadResult = await storageManager.saveStream(req, rawFilename, mime);
    if (!uploadResult.success || !uploadResult.url) {
      const isBadMedia = typeof uploadResult.error === 'string' && (uploadResult.error.includes('غير مسموح') || uploadResult.error.includes('لا يتطابق'));
      return res.status(isBadMedia ? 400 : 500).json({
        success: false,
        error: uploadResult.error || 'فشل حفظ الملف على الخادم أو التخزين السحابي'
      });
    }

    return res.json({
      success: true,
      url: toPublicMediaUrl(uploadResult.url, req),
      mediaType: uploadResult.mediaType,
      size: uploadResult.size,
      filename: uploadResult.filename,
      provider: uploadResult.provider
    });
  } catch (err: any) {
    console.error('Error in binary upload:', err);
    const isTooLarge = typeof err?.message === 'string' && err.message.includes('يتجاوز الحد الأقصى');
    const isInvalidType = typeof err?.message === 'string' && (err.message.includes('غير مسموح') || err.message.includes('لا يتطابق'));
    return res.status(isTooLarge ? 413 : isInvalidType ? 400 : 500).json({
      success: false,
      error: err?.message || 'فشل حفظ الملف على الخادم أو التخزين السحابي'
    });
  }
});

app.post('/api/upload-media', express.json({ limit: '50mb' }), async (req, res) => {
  try {
    const uploadSess = getAuthorizedUploadSession(req);
    if (!uploadSess) {
      return res.status(401).json({ success: false, error: 'يجب تسجيل الدخول أولاً لرفع الملفات.' });
    }
    const reqKey = `${getRequestClientIp(req)}:${uploadSess.user.username.toLowerCase()}`;
    if (!checkHttpRateLimit('upload-media', reqKey, 25, 60_000)) {
      return res.status(429).json({ success: false, error: 'تم تجاوز الحد المسموح لرفع الملفات، يرجى الانتظار دقيقة.' });
    }
    const { dataUrl, filename, mediaType } = req.body || {};
    if (!dataUrl || typeof dataUrl !== 'string') {
      return res.status(400).json({ success: false, error: 'بيانات الملف مفقودة' });
    }
    if (dataUrl.length > 70 * 1024 * 1024) {
      return res.status(413).json({ success: false, error: 'حجم الملف يتجاوز 50 ميجابايت.' });
    }

    const matches = dataUrl.match(/^data:([A-Za-z0-9-+\/]+)(?:;[^,]*)?;base64,(.+)$/);
    if (!matches || matches.length !== 3) {
      return res.status(400).json({ success: false, error: 'صيغة البيانات المرسلة غير صالحة.' });
    }

    const mime = matches[1].toLowerCase();
    const originalFilename = typeof filename === 'string' && filename.trim() ? filename.trim().slice(0, 120) : `file_${Date.now()}`;
    if (
      mime.includes('svg') ||
      mime.includes('html') ||
      mime.includes('javascript') ||
      /\.(svg|html?|xhtml|js|mjs)$/i.test(originalFilename)
    ) {
      return res.status(400).json({ success: false, error: 'صيغة الملف غير مسموح برفعها لأسباب أمنية.' });
    }
    const buffer = Buffer.from(matches[2], 'base64');
    if (buffer.length > 50 * 1024 * 1024) {
      return res.status(413).json({ success: false, error: 'حجم الملف يتجاوز 50 ميجابايت.' });
    }
    if (!validateMediaMagicBytes(buffer)) {
      return res.status(400).json({ success: false, error: 'محتوى الملف لا يتطابق مع صيغة وسائط صالحة.' });
    }

    const uploadResult = await storageManager.saveBuffer(buffer, originalFilename, mime);

    return res.json({
      success: uploadResult.success,
      url: toPublicMediaUrl(uploadResult.url, req),
      mediaType: mediaType || uploadResult.mediaType,
      size: uploadResult.size,
      filename: uploadResult.filename,
      provider: uploadResult.provider
    });
  } catch (err: any) {
    console.error('Error saving uploaded media:', err);
    const isBadMedia = typeof err?.message === 'string' && (err.message.includes('غير مسموح') || err.message.includes('لا يتطابق'));
    return res.status(isBadMedia ? 400 : 500).json({ success: false, error: isBadMedia ? err.message : 'فشل حفظ الملف على الخادم أو التخزين السحابي' });
  }
});

/**
 * Server-side security & payload minimization:
 * Automatically decodes and converts any incoming data: URL / Base64 into a local /uploads file,
 * strictly guaranteeing that Socket.IO message payloads contain only tiny URL strings (<1KB).
 */
export async function ensureMediaUrlNotBase64(url: string | undefined): Promise<string | undefined> {
  if (!url || typeof url !== 'string') return url;
  if (!url.startsWith('data:')) {
    const clean = sanitizeUrl(url);
    return clean || undefined;
  }

  try {
    if (url.length > 70 * 1024 * 1024) return undefined;
    const matches = url.match(/^data:([A-Za-z0-9-+\/;=,\s]+);base64,(.+)$/);
    if (!matches || matches.length !== 3) return undefined;

    const mime = matches[1].split(';')[0].trim().toLowerCase();
    if (mime.includes('svg') || mime.includes('html') || mime.includes('javascript') || mime.includes('xml')) {
      return undefined;
    }
    const base64Data = matches[2];
    const buffer = Buffer.from(base64Data, 'base64');
    if (!buffer || buffer.length === 0 || buffer.length > 50 * 1024 * 1024) return undefined;

    let ext = '';
    if (mime.includes('png')) ext = 'png';
    else if (mime.includes('jpeg') || mime.includes('jpg')) ext = 'jpg';
    else if (mime.includes('gif')) ext = 'gif';
    else if (mime.includes('webp')) ext = 'webp';
    else if (mime.includes('webm')) ext = 'webm';
    else if (mime.includes('mp4')) ext = 'mp4';
    else if (mime.includes('mpeg') || mime.includes('mp3')) ext = 'mp3';
    else if (mime.includes('aac') || mime.includes('m4a')) ext = 'm4a';
    else if (mime.includes('ogg') || mime.includes('audio') || mime.includes('wav')) ext = 'wav';

    if (!ext) return undefined;
    if (!validateMediaMagicBytes(buffer, ext)) return undefined;

    const filename = `media_${Date.now()}_${Math.random().toString(36).substring(2, 6)}.${ext}`;

    // Upload via storageManager (which uses Cloudinary when configured)
    const uploadResult = await storageManager.saveBuffer(buffer, filename, mime);
    if (uploadResult && uploadResult.success && uploadResult.url) {
      return uploadResult.url;
    }

    // Fallback: only if external cloud storage failed or unconfigured, write locally
    const filePath = path.join(uploadsDir, filename);
    fs.writeFileSync(filePath, buffer);
    return `/uploads/${filename}`;
  } catch (err) {
    console.warn('Failed to sanitize base64 media to storage:', err);
    return undefined;
  }
}

// Plain-text sanitizer: strips null/control chars and trims without HTML-entity mangling (&quot;/&#39;)
function sanitizeText(str?: string | null): string {
  if (!str) return '';
  return String(str)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .trim();
}

/**
 * URL Sanitizer to prevent malicious URI execution (javascript:, vbscript:, data:text/html, data:image/svg+xml)
 */
export function sanitizeUrl(url?: string | null): string {
  if (!url || typeof url !== 'string') return '';
  const trimmed = url.trim();
  if (!trimmed) return '';
  if (/^(javascript|vbscript|file):/i.test(trimmed)) {
    return '';
  }
  if (/^\/(?!\/)/.test(trimmed) || /^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }
  if (/^data:(?:image\/(?:png|jpeg|jpg|webp|gif)|audio\/(?:mpeg|mp3|ogg|opus|wav|webm|aac|mp4|m4a)|video\/(?:mp4|webm|quicktime|mov));base64,/i.test(trimmed)) {
    return trimmed;
  }
  return '';
}

function sanitizeSafeGiftOrEmblemUrl(url?: string | null, fallbackIcon?: string): string {
  const std = sanitizeUrl(url);
  if (std) return std;
  if (typeof url === 'string') {
    const trimmed = url.trim();
    if (trimmed.length > 0 && trimmed.length <= 32768 && /^data:image\/svg\+xml/i.test(trimmed)) {
      try {
        const commaIdx = trimmed.indexOf(',');
        if (commaIdx !== -1) {
          const meta = trimmed.slice(0, commaIdx).toLowerCase();
          const payload = trimmed.slice(commaIdx + 1);
          const decoded = meta.includes(';base64')
            ? Buffer.from(payload, 'base64').toString('utf8')
            : decodeURIComponent(payload);
          const norm = decoded.trim();
          const startsSvg = norm.startsWith('<svg') || /^<\?xml[\s\S]*?<svg/i.test(norm);
          const hasDangerous =
            /<script/i.test(norm) ||
            /<foreignObject/i.test(norm) ||
            /<iframe/i.test(norm) ||
            /<object/i.test(norm) ||
            /<embed/i.test(norm) ||
            /\son[a-z]+\s*=/i.test(norm) ||
            /javascript:|vbscript:/i.test(norm) ||
            /(?:xlink:)?href\s*=\s*["']\s*(?:https?:|data:|\/\/)/i.test(norm);
          if (startsSvg && !hasDangerous) {
            return trimmed;
          }
        }
      } catch {}
    }
  }
  const cleanIcon = typeof fallbackIcon === 'string' ? sanitizeText(fallbackIcon).slice(0, 8).trim() : '';
  if (cleanIcon) {
    const escaped = cleanIcon.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 60 60" width="60" height="60"><circle cx="30" cy="30" r="26" fill="#0f172a" stroke="#fbbf24" stroke-width="2.5"/><text x="30" y="37" font-size="26" text-anchor="middle" dominant-baseline="central">${escaped}</text></svg>`;
    return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
  }
  return '';
}

function sanitizeCssColor(val?: string | null): string | undefined {
  if (!val || typeof val !== 'string') return undefined;
  const trimmed = val.trim();
  if (!trimmed) return '';
  if (
    /^#[0-9a-fA-F]{3,8}$/.test(trimmed) ||
    /^(?:rgb|hsl)a?\(\s*[0-9.%\s,/]+\)$/i.test(trimmed) ||
    /^(?:transparent|inherit|currentColor|[a-zA-Z]{3,24})$/i.test(trimmed)
  ) {
    return trimmed;
  }
  return undefined;
}

function sanitizeCssValue(val?: string | null): string | undefined {
  if (!val || typeof val !== 'string') return undefined;
  const trimmed = val.trim();
  if (!trimmed) return '';
  if (/(expression\s*\(|javascript:|vbscript:|<\/?\s*script|@import|behavior\s*:)/i.test(trimmed)) {
    return undefined;
  }
  if (trimmed.length > 500) return undefined;
  return trimmed.replace(/[\u0000-\u001F\u007F;{}]/g, '');
}

/**
 * Robust Password Hashing and Verification using bcrypt (10 salt rounds)
 * With zero-downtime backwards compatibility and automated migration for legacy plain text passwords.
 */
export function hashPassword(plainPassword: string): string {
  if (!plainPassword) return '';
  // Avoid re-hashing if already a bcrypt hash
  if (plainPassword.startsWith('$2a$') || plainPassword.startsWith('$2b$')) {
    return plainPassword;
  }
  const salt = bcrypt.genSaltSync(10);
  return bcrypt.hashSync(plainPassword, salt);
}

export function verifyPassword(plainPassword: string, storedHashOrPlain: string): boolean {
  if (!plainPassword || !storedHashOrPlain) return false;
  // If stored credential is a standard bcrypt hash
  if (storedHashOrPlain.startsWith('$2a$') || storedHashOrPlain.startsWith('$2b$')) {
    try {
      return bcrypt.compareSync(plainPassword, storedHashOrPlain);
    } catch {
      return false;
    }
  }
  // Graceful fallback for legacy passwords (e.g. initial '123')
  return plainPassword === storedHashOrPlain;
}

export interface StoredMessage {
  id: string;
  room: string;
  username: string;
  displayName?: string;
  avatarUrl?: string;
  nameBannerUrl?: string;
  flag?: string;
  badge?: string;
  badgeColor?: string;
  text: string;
  mediaUrl?: string;
  mediaType?: 'image' | 'video' | 'sticker' | 'audio';
  voiceNote?: {
    audioUrl: string;
    duration: number;
  };
  replyTo?: {
    id: string;
    username: string;
    displayName?: string;
    text: string;
    mediaUrl?: string;
  };
  time: string;
  timestamp: number;
  reactions?: Record<string, number>;
  nameColor?: string;
  textColor?: string;
  nameGradient?: string;
  giftBadges?: string[];
  isGiftAnnouncement?: boolean;
  giftInfo?: {
    fromUsername: string;
    toUsername: string;
    giftTitle: string;
    giftUrl: string;
    giftMessage?: string;
  };
  isEdited?: boolean;
  isDeleted?: boolean;
  deletedBy?: string;
  deletedByRole?: string;
  clientTempId?: string;
}

export interface ConnectedUser {
  id: string;
  username: string;
  displayName?: string;
  room: string;
  avatarSeed: string;
  avatarUrl?: string;
  avatarFrame?: string;
  statusQuote: string;
  flag: string;
  role: 'hassan' | 'admin' | 'super' | 'member' | 'guest' | string;
  likes: number;
  points: number;
  isVoice: boolean;
  micSlot: number | null; // 1 to 5, or null
  isMuted: boolean;
  isTextMuted: boolean;
  isVoiceMutedByAdmin?: boolean;
  isSpeaking: boolean;
  isSharingMusic?: boolean;
  presenceState?: 'online' | 'away' | 'offline'; // Green dot (online), Yellow dot (away/background), Gray dot (offline)
  ipAddress?: string;
  ip?: string;
  deviceInfo?: string;
  deviceFingerprint?: string;
  honorBadge?: string;
  nameColor?: string;
  textColor?: string;
  nameGradient?: string;
  profileBg?: string;
  memberBg?: string;
  theme?: string;
  fontFamily?: string;
  wallpaper?: string;
  bubbleStyle?: string;
  fontSize?: string;
  nameBannerUrl?: string; // رابط البنر / السوابر المصور للعضو بمقاس 500x50 كبديل لاسمه
  giftBadges?: string[]; // قائمة أيقونات الهدايا والأوسمة التكريمية بجانب الاسم
  isPmDisabled?: boolean;
  isGhost?: boolean; // حالة الدخول المخفي / المتخفي
  isIncognito?: boolean; // وضع التصفح المتخفي
  isJailed?: boolean;
  isBot?: boolean;
  flagNumber?: number;
  joinedAt: number;
  sessionToken?: string;
  lastActiveTime?: number;
  engagement?: MemberEngagement;
}

export interface MemberEngagement {
  activeTimeMinutes: number;
  messagesSent: number;
  wallPostsCount: number;
  micTimeMinutes: number;
  starsLevel: number; // 0 to 5
  progressPercent: number; // 0 to 100
}

export function getDefaultEngagement(): MemberEngagement {
  return {
    activeTimeMinutes: 0,
    messagesSent: 0,
    wallPostsCount: 0,
    micTimeMinutes: 0,
    starsLevel: 0,
    progressPercent: 0
  };
}

export function calculateEngagementStars(eng: MemberEngagement): { starsLevel: number; progressPercent: number } {
  const score = (eng.activeTimeMinutes * 0.5) + (eng.messagesSent * 2) + (eng.wallPostsCount * 8) + (eng.micTimeMinutes * 3);
  let level = 0;
  let progress = 0;
  if (score < 30) {
    level = score / 30;
    progress = Math.min(100, Math.round((score / 30) * 100));
  } else if (score < 100) {
    level = 1 + (score - 30) / 70;
    progress = Math.min(100, Math.round(((score - 30) / 70) * 100));
  } else if (score < 250) {
    level = 2 + (score - 100) / 150;
    progress = Math.min(100, Math.round(((score - 100) / 150) * 100));
  } else if (score < 500) {
    level = 3 + (score - 250) / 250;
    progress = Math.min(100, Math.round(((score - 250) / 250) * 100));
  } else if (score < 1000) {
    level = 4 + (score - 500) / 500;
    progress = Math.min(100, Math.round(((score - 500) / 500) * 100));
  } else {
    level = 5;
    progress = 100;
  }
  return {
    starsLevel: Math.min(5, Math.max(0, Math.round(level * 10) / 10)),
    progressPercent: progress
  };
}

export interface StoryComment {
  id: string;
  username: string;
  displayName?: string;
  avatarUrl?: string;
  nameBannerUrl?: string;
  text: string;
  time: string;
  timestamp: number;
}

export interface StoryItem {
  id: string;
  username: string;
  displayName?: string;
  avatarUrl?: string;
  nameBannerUrl?: string;
  flag?: string;
  mediaUrl: string;
  mediaType: 'image' | 'video';
  caption?: string;
  createdAt: number;
  time: string;
  likes: number;
  likedUsers?: string[];
  comments?: StoryComment[];
}

export interface UserSession {
  sessionToken: string;
  user: ConnectedUser;
  currentSocketId: string;
  lastActiveTime: number;
  isExplicitlyLoggedOut: boolean;
  tokenVersion?: number;
}

export interface RecentLoginEntry {
  username: string;
  displayName?: string;
  avatarUrl?: string;
  avatar?: string;
  nameBannerUrl?: string;
  statusQuote?: string;
  flag: string;
  flagNumber?: number;
  room: string;
  role: string;
  timestamp: number;
  time: string;
}

let recentLogins: RecentLoginEntry[] = [];

function saveRecentLogins() {
  try {
    dataManager.saveRecentLogins(recentLogins);
  } catch (err) {
    console.error('[Data Layer] Error saving recent logins:', err);
  }
}

function loadRecentLogins() {
  try {
    const data = dataManager.loadRecentLoginsSync<RecentLoginEntry[]>([]);
    if (Array.isArray(data) && data.length > 0) {
      recentLogins = data.slice(0, 10);
    }
  } catch (err) {
    console.error('[Data Layer] Error loading recent logins:', err);
  }
}
loadRecentLogins();

const LEGACY_RANK_STATUS_QUOTES = new Set([
  '🦅 إدارة عليا • شات حسان برو',
  '👑 مدير النظام • الإدارة العامة',
  '👑 مدير عام شات حسان برو',
  '🛡️ مشرف سوبر • طاقم الإشراف',
  '🎖️ عضو معتمد في حسان برو',
  '👤 زائر في شات حسان برو'
]);

function isCustomStatusQuote(rawQuote?: string): boolean {
  const q = (rawQuote || '').trim();
  return Boolean(q && q !== 'عضو جديد' && q !== '..' && !LEGACY_RANK_STATUS_QUOTES.has(q));
}

function getDefaultStatusByRole(_role?: string): string {
  return 'متواجد في شات حسان برو';
}

function recordRecentLogin(entry: RecentLoginEntry) {
  const member = getRegisteredMember(entry.username)?.member;
  const user = users.find((u) => u.username.toLowerCase() === entry.username.toLowerCase());
  const resolvedRole = entry.role || user?.role || member?.role || 'member';
  const rawQuote = entry.statusQuote || user?.statusQuote || member?.statusQuote;
  const resolvedQuote = isCustomStatusQuote(rawQuote)
    ? rawQuote!.trim()
    : getDefaultStatusByRole(resolvedRole);

  const enrichedEntry: RecentLoginEntry = {
    ...entry,
    displayName: entry.displayName || user?.displayName || member?.displayName || entry.username,
    avatarUrl: entry.avatarUrl || entry.avatar || user?.avatarUrl || member?.avatarUrl,
    avatar: entry.avatar || entry.avatarUrl || user?.avatarUrl || member?.avatarUrl,
    nameBannerUrl: entry.nameBannerUrl || user?.nameBannerUrl || member?.nameBannerUrl,
    statusQuote: resolvedQuote,
    flag: entry.flag || user?.flag || member?.flag || '🇾🇪',
    flagNumber: entry.flagNumber || user?.flagNumber || member?.flagNumber,
    role: resolvedRole
  };
  recentLogins = [
    enrichedEntry,
    ...recentLogins.filter((e) => e.username.toLowerCase() !== entry.username.toLowerCase())
  ].slice(0, 10);
  saveRecentLogins();
  io.emit('recentLoginsUpdated', getRecentLogins());
}

function getRecentLogins(): RecentLoginEntry[] {
  if (recentLogins.length > 0) {
    return recentLogins.map((e) => {
      const onlineUser = users.find((u) => u.username.toLowerCase() === e.username.toLowerCase());
      const member = getRegisteredMember(e.username)?.member;
      const resolvedRole = onlineUser?.role || member?.role || e.role || 'member';
      const rawQuote = onlineUser?.statusQuote || member?.statusQuote || e.statusQuote;
      const resolvedQuote = isCustomStatusQuote(rawQuote)
        ? rawQuote!.trim()
        : getDefaultStatusByRole(resolvedRole);
      return {
        ...e,
        displayName: onlineUser?.displayName || member?.displayName || e.displayName || e.username,
        avatarUrl: onlineUser?.avatarUrl || member?.avatarUrl || e.avatarUrl || e.avatar,
        avatar: onlineUser?.avatarUrl || member?.avatarUrl || e.avatar || e.avatarUrl,
        nameBannerUrl: onlineUser?.nameBannerUrl ?? member?.nameBannerUrl ?? e.nameBannerUrl,
        statusQuote: resolvedQuote,
        flagNumber: onlineUser?.flagNumber || member?.flagNumber || e.flagNumber,
        role: resolvedRole
      };
    });
  }
  const entries: RecentLoginEntry[] = [];
  const sortedSessions = Array.from(activeSessions.values())
    .filter((s) => s.user && !s.isExplicitlyLoggedOut)
    .sort((a, b) => (b.lastActiveTime || 0) - (a.lastActiveTime || 0));
  for (const session of sortedSessions) {
    const member = getRegisteredMember(session.user.username)?.member;
    const resolvedRole = session.user.role || member?.role || 'member';
    const rawQuote = session.user.statusQuote || member?.statusQuote;
    const resolvedQuote = (rawQuote && rawQuote.trim() && rawQuote.trim() !== 'عضو جديد' && rawQuote.trim() !== '..')
      ? rawQuote.trim()
      : getDefaultStatusByRole(resolvedRole);
    entries.push({
      username: session.user.username,
      displayName: session.user.displayName || member?.displayName || session.user.username,
      avatarUrl: session.user.avatarUrl || member?.avatarUrl,
      avatar: session.user.avatarUrl || member?.avatarUrl,
      nameBannerUrl: session.user.nameBannerUrl || member?.nameBannerUrl,
      statusQuote: resolvedQuote,
      flag: session.user.flag || '🇾🇪',
      flagNumber: session.user.flagNumber || member?.flagNumber,
      room: session.user.room || 'الغرفة العامة',
      role: resolvedRole,
      timestamp: session.lastActiveTime || Date.now(),
      time: getCurrentTimeString()
    });
    if (entries.length >= 10) break;
  }
  return entries;
}

const activeSessions = new Map<string, UserSession>(); // key: sessionToken
const usernameToSessionMap = new Map<string, string>(); // key: username.toLowerCase() -> sessionToken (internal cleanup index only)
const revokedSessionTokens = new Map<string, number>(); // key: sessionToken -> expiry timestamp
const revokedUsernameBeforeIat = new Map<string, number>(); // key: username.toLowerCase() -> revocation cutoff ms
const pendingAwayTimers = new Map<string, NodeJS.Timeout>(); // key: username.toLowerCase() -> 2-min presence away timer
const pendingMicGraceTimers = new Map<string, NodeJS.Timeout>(); // key: username.toLowerCase() -> mic preservation grace timer

let sessionSigningSecret = (process.env.SESSION_SECRET || process.env.SESSION_SIGNING_SECRET || '').trim();
if (!sessionSigningSecret) {
  sessionSigningSecret = crypto.randomBytes(32).toString('hex');
}

function pruneRevokedTokens() {
  const now = Date.now();
  for (const [tok, exp] of revokedSessionTokens.entries()) {
    if (exp <= now) revokedSessionTokens.delete(tok);
  }
  if (revokedSessionTokens.size > 5000) {
    const excess = revokedSessionTokens.size - 5000;
    let removed = 0;
    for (const key of revokedSessionTokens.keys()) {
      revokedSessionTokens.delete(key);
      removed += 1;
      if (removed >= excess) break;
    }
  }
}

function getMemberTokenVersion(username?: string): number {
  if (!username) return 1;
  const reg = getRegisteredMember(username);
  return Math.max(1, reg?.member.tokenVersion || 1);
}

function bumpMemberTokenVersion(username?: string): number {
  if (!username) return 1;
  const reg = getRegisteredMember(username);
  if (!reg) return 1;
  const nextVer = Math.max(1, reg.member.tokenVersion || 1) + 1;
  reg.member.tokenVersion = nextVer;
  saveMembers();
  return nextVer;
}

function revokeUserSessionTokens(options: {
  sessionToken?: string;
  username?: string;
  bumpVersion?: boolean;
  excludeToken?: string;
}) {
  const { sessionToken, username, bumpVersion = false, excludeToken } = options;
  pruneRevokedTokens();
  const expiry = Date.now() + 7 * 24 * 60 * 60 * 1000;

  if (sessionToken && sessionToken !== excludeToken) {
    const existing = activeSessions.get(sessionToken);
    if (existing) {
      existing.isExplicitlyLoggedOut = true;
      activeSessions.delete(sessionToken);
    }
    revokedSessionTokens.set(sessionToken, expiry);
  }

  if (username) {
    const lower = username.trim().toLowerCase();
    for (const [tok, sess] of activeSessions.entries()) {
      if (tok !== excludeToken && sess.user?.username?.toLowerCase() === lower) {
        sess.isExplicitlyLoggedOut = true;
        activeSessions.delete(tok);
        revokedSessionTokens.set(tok, expiry);
      }
    }
    if (!excludeToken) {
      usernameToSessionMap.delete(lower);
    }
    revokedUsernameBeforeIat.set(lower, Date.now());
    if (bumpVersion) {
      bumpMemberTokenVersion(username);
    }
  }
  persistActiveSessions();
}

function signSessionToken(username: string, tokenVersion?: number): string {
  const v = typeof tokenVersion === 'number' && tokenVersion >= 1 ? tokenVersion : getMemberTokenVersion(username);
  const payloadObj = {
    u: username.trim().toLowerCase(),
    v,
    iat: Date.now(),
    n: crypto.randomBytes(8).toString('hex')
  };
  const payloadB64 = Buffer.from(JSON.stringify(payloadObj), 'utf8').toString('base64url');
  const sigHex = crypto.createHmac('sha256', sessionSigningSecret).update(payloadB64).digest('hex');
  return `tok_${payloadB64}.${sigHex}`;
}

function verifySignedSessionTokenPayload(
  token: string,
  expectedUsername?: string
): { username: string; version: number; iat: number } | null {
  if (!token || typeof token !== 'string' || !token.startsWith('tok_')) return null;
  if (revokedSessionTokens.has(token)) return null;
  const raw = token.slice(4);
  const dotIdx = raw.indexOf('.');
  if (dotIdx <= 0) return null;
  const payloadB64 = raw.slice(0, dotIdx);
  const sigHex = raw.slice(dotIdx + 1);
  if (!/^[a-f0-9]{64}$/i.test(sigHex)) return null;
  try {
    const expectedSig = crypto.createHmac('sha256', sessionSigningSecret).update(payloadB64).digest('hex');
    const a = Buffer.from(sigHex, 'hex');
    const b = Buffer.from(expectedSig, 'hex');
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    const parsed = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8')) as {
      u?: string;
      v?: number;
      iat?: number;
    };
    if (!parsed?.u || typeof parsed.u !== 'string') return null;
    const lowerU = parsed.u.toLowerCase();
    if (expectedUsername && lowerU !== expectedUsername.trim().toLowerCase()) {
      return null;
    }
    const tokenIat = typeof parsed.iat === 'number' ? parsed.iat : 0;
    const cutoff = revokedUsernameBeforeIat.get(lowerU);
    if (cutoff && tokenIat <= cutoff) {
      return null;
    }
    const tokenVer = typeof parsed.v === 'number' && parsed.v >= 1 ? parsed.v : 1;
    const minVer = getMemberTokenVersion(lowerU);
    if (tokenVer < minVer) {
      return null;
    }
    return { username: lowerU, version: tokenVer, iat: tokenIat };
  } catch {
    return null;
  }
}

function verifySignedSessionToken(token: string, expectedUsername?: string): string | null {
  return verifySignedSessionTokenPayload(token, expectedUsername)?.username || null;
}

function getOpaqueSessionId(token: string): string {
  return crypto.createHmac('sha256', sessionSigningSecret).update(`sid:${token}`).digest('hex').slice(0, 24);
}

// Hydrate existing sessions from Data Layer
try {
  const loadedSessions = dataManager.loadSessionsSync<Record<string, UserSession>>({});
  if (loadedSessions && typeof loadedSessions === 'object') {
    (Object.values(loadedSessions) as UserSession[]).forEach((sess) => {
      if (sess && sess.sessionToken && sess.user && !sess.isExplicitlyLoggedOut) {
        activeSessions.set(sess.sessionToken, sess);
        usernameToSessionMap.set(sess.user.username.toLowerCase(), sess.sessionToken);
      }
    });
  }
} catch (err) {
  console.error('[Data Layer] Error hydrating active sessions:', err);
}

let persistSessionsTimer: NodeJS.Timeout | null = null;
function persistActiveSessions() {
  if (persistSessionsTimer) return;
  persistSessionsTimer = setTimeout(() => {
    persistSessionsTimer = null;
    try {
      const obj: Record<string, UserSession> = {};
      for (const [token, sess] of activeSessions.entries()) {
        if (!sess.isExplicitlyLoggedOut) {
          obj[token] = sess;
        }
      }
      dataManager.saveSessions(obj);
    } catch (err) {
      console.error('[Data Layer] Error persisting active sessions:', err);
    }
  }, 400);
}

export interface WallComment {
  id: string;
  username: string;
  displayName?: string;
  avatarUrl?: string;
  nameBannerUrl?: string;
  text: string;
  time: string;
  timestamp: number;
}

export interface WallPost {
  id: string;
  username: string;
  displayName?: string;
  avatarUrl?: string;
  nameBannerUrl?: string;
  flag?: string;
  text: string;
  mediaUrl?: string;
  mediaType?: 'image' | 'video' | 'audio';
  audioDuration?: number;
  category?: 'posts' | 'quick'; // تبويب الحائط: المنشورات أو الدردشة السريعة
  youtubeVideo?: {
    id: string;
    title: string;
    thumbnail?: string;
    channelTitle?: string;
    duration?: string;
    views?: string;
    uploadedAt?: string;
    url?: string;
  };
  time: string;
  likes: number;
  likedUsers?: string[];
  commentsCount: number;
  comments?: WallComment[];
  timestamp: number;
  updatedAt?: number;
  isEdited?: boolean;
  clientTempId?: string;
}

export interface PrivateMessage {
  id: string;
  fromId: string;
  fromUsername: string;
  fromDisplayName?: string;
  fromAvatar?: string;
  fromNameBannerUrl?: string;
  toId: string;
  toUsername: string;
  toDisplayName?: string;
  toNameBannerUrl?: string;
  text: string;
  mediaUrl?: string;
  voiceNote?: {
    audioUrl: string;
    duration: number;
  };
  replyTo?: {
    id: string;
    username: string;
    text: string;
  };
  isCallNotification?: boolean;
  time: string;
  timestamp: number;
  isEdited?: boolean;
  // Read Receipts:
  status?: 'sent' | 'delivered' | 'read';
  readAt?: number;
  // Self-Destructing:
  selfDestructSeconds?: number;
  selfDestructAt?: number;
  clientTempId?: string;
}

export interface ChatRoom {
  id: string;
  name: string;
  desc: string;
  isPasswordProtected: boolean;
  password?: string;
  bannerUrl?: string;
  voiceLimit: number;
  activeVoiceCount: number;
}

export interface MonitorEvent {
  id: string;
  type: 'join' | 'leave' | 'mic_take' | 'mic_drop' | 'mic_pull' | 'warn' | 'kick' | 'ban' | 'mute' | 'likes' | 'role' | 'word_filter' | 'security' | 'room' | 'siren' | 'jail';
  description: string;
  actor: string;
  target?: string;
  time: string;
  timestamp: number;
}

// User Role Definition & Hierarchy
export type UserRole = 'hassan' | 'admin' | 'super' | 'member' | 'guest' | string;

export interface RoleDefinition {
  id: string;
  name: string;
  level: number;
  badgeColor?: string;
  isSystem?: boolean;
}

export const DEFAULT_ROLES_CONFIG: RoleDefinition[] = [
  { id: 'hassan', name: '🦅 إدارة عليا (hassan)', level: 100000, badgeColor: 'bg-gradient-to-r from-amber-500 via-yellow-400 to-amber-600 text-black font-black shadow-lg', isSystem: true },
  { id: 'admin', name: '👑 مدير النظام (Admin)', level: 100, badgeColor: 'bg-red-600 text-white', isSystem: true },
  { id: 'super', name: '🛡️ سوبر إداري (Super)', level: 75, badgeColor: 'bg-amber-600 text-white', isSystem: true },
  { id: 'member', name: '🎖️ عضو معتمد (Member)', level: 50, badgeColor: 'bg-indigo-600 text-white', isSystem: true },
  { id: 'guest', name: '👤 زائر (Guest)', level: 10, badgeColor: 'bg-slate-600 text-white', isSystem: true }
];

export let rolesConfig: RoleDefinition[] = [...DEFAULT_ROLES_CONFIG];

export function getRoleLevel(roleId?: string): number {
  if (!roleId) return 0;
  const clean = roleId.trim().toLowerCase();
  const found = rolesConfig.find((r) => r.id.toLowerCase() === clean);
  if (found) return found.level;
  if (clean === 'hassan') return 100000;
  if (clean === 'admin') return 100;
  if (clean === 'super') return 75;
  if (clean === 'member') return 50;
  if (clean === 'guest') return 10;
  return 20;
}

export function isSupremeHassan(userOrRole?: { role?: string } | string | null): boolean {
  if (!userOrRole) return false;
  const r = typeof userOrRole === 'string' ? userOrRole : userOrRole.role;
  return typeof r === 'string' && r.trim().toLowerCase() === 'hassan';
}

export function isUsernameSupremeHassan(username?: string | null): boolean {
  if (!username || typeof username !== 'string') return false;
  const reg = getRegisteredMember(username.trim())?.member;
  return isSupremeHassan(reg?.role);
}

export function isStaffUser(user?: { role?: string } | null): boolean {
  if (!user) return false;
  return (
    isSupremeHassan(user) ||
    user.role === 'admin' ||
    user.role === 'super' ||
    getRoleLevel(user.role) >= 75 ||
    hasPermission(user.role, 'canAccessControlPanel')
  );
}

export function emitToAuthorizedStaff(event: string, payload: unknown, requiredPerm?: string) {
  for (const u of users) {
    if (isStaffUser(u) || (requiredPerm && hasPermission(u.role, requiredPerm))) {
      io.to(u.id).emit(event, payload);
    }
  }
  for (const [adminSocketId, u] of adminPanelUsers.entries()) {
    if (isStaffUser(u) || (requiredPerm && hasPermission(u.role, requiredPerm))) {
      io.to(adminSocketId).emit(event, payload);
    }
  }
}

export function getRoleDefinition(roleId?: string): RoleDefinition {
  const clean = (roleId || '').trim().toLowerCase();
  const found = rolesConfig.find((r) => r.id.toLowerCase() === clean);
  if (found) return found;
  return { id: roleId || 'guest', name: roleId || 'عضو', level: 10, badgeColor: 'bg-slate-600 text-white' };
}

export function saveRolesConfig() {
  try {
    const mergedMap = new Map<string, RoleDefinition>();
    DEFAULT_ROLES_CONFIG.forEach((r) => mergedMap.set(r.id.toLowerCase(), { ...r }));
    rolesConfig.forEach((r) => {
      if (r && r.id) mergedMap.set(r.id.toLowerCase(), r);
    });
    rolesConfig = Array.from(mergedMap.values()).sort((a, b) => b.level - a.level);

    dataManager.saveRolesConfig(rolesConfig);
    dataManager.save('roles_config', rolesConfig);
    invalidateConfigVersionCache('roles');
    const localDir = process.env.DATA_DIR || process.env.RAILWAY_VOLUME_MOUNT_PATH || path.join(__dirname);
    const localFile = path.join(localDir, 'roles_config.json');
    fs.writeFileSync(localFile, JSON.stringify(rolesConfig, null, 2), 'utf8');
  } catch (err) {
    console.error('Error saving roles config:', err);
  }
}

export function loadRolesConfig() {
  try {
    const parsed = dataManager.loadRolesConfigSync<RoleDefinition[]>([]);
    let sourceList: RoleDefinition[] = [];
    if (Array.isArray(parsed) && parsed.length > 0) {
      sourceList = parsed;
    } else {
      const localDir = process.env.DATA_DIR || process.env.RAILWAY_VOLUME_MOUNT_PATH || path.join(__dirname);
      const localFile = path.join(localDir, 'roles_config.json');
      if (fs.existsSync(localFile)) {
        const raw = fs.readFileSync(localFile, 'utf8');
        const data = JSON.parse(raw);
        if (Array.isArray(data) && data.length > 0) {
          sourceList = data;
        }
      }
    }

    const mergedMap = new Map<string, RoleDefinition>();
    DEFAULT_ROLES_CONFIG.forEach((r) => mergedMap.set(r.id.toLowerCase(), { ...r }));
    sourceList.forEach((r) => {
      if (r && r.id) {
        const cleanId = r.id.toLowerCase();
        const existingDefault = mergedMap.get(cleanId);
        if (existingDefault && existingDefault.isSystem) {
          mergedMap.set(cleanId, {
            ...existingDefault,
            ...r,
            id: cleanId,
            isSystem: true
          });
        } else {
          mergedMap.set(cleanId, {
            ...r,
            id: cleanId,
            level: typeof r.level === 'number' ? r.level : parseInt(String(r.level)) || 20
          });
        }
      }
    });

    rolesConfig = Array.from(mergedMap.values()).sort((a, b) => b.level - a.level);
  } catch (err) {
    console.error('Error loading roles config:', err);
  }
}

function canPerformModeration(
  actor: ConnectedUser,
  target: { id?: string; username: string; role: string } | undefined,
  action: string
): { allowed: boolean; reason?: string } {
  if (isSupremeHassan(actor)) {
    return { allowed: true };
  }
  const actorLevel = getRoleLevel(actor.role);

  // 1. Self-penalty & Strict Numeric Hierarchy checks (الأعلى رقماً يتحكم في كل من تحته حتى لو كان admin)
  if (target) {
    if (target.id && target.id === actor.id && (action === 'kick' || action === 'ban' || action === 'mute' || action === 'muteVoice' || action === 'deleteAvatar' || action === 'jailUser' || action === 'deleteAccount')) {
      return { allowed: false, reason: 'لا يمكنك تطبيق العقوبات على نفسك.' };
    }
    if (target.username.toLowerCase() === actor.username.toLowerCase() && (action === 'kick' || action === 'ban' || action === 'jailUser' || action === 'deleteAccount')) {
      return { allowed: false, reason: 'لا يمكنك تطبيق هذا الإجراء على حسابك الشخصي.' };
    }

    const targetLevel = getRoleLevel(target.role);

    // Rule: Strict hierarchy protection (لا يمكن التحكم أو تطبيق إجراء على رتبة مساوية أو أعلى منك)
    if (targetLevel >= actorLevel) {
      return {
        allowed: false,
        reason: `لا تملك صلاحية التحكم برتبة مساوية أو أعلى منك (رقم رتبتك: ${actorLevel}، ورقم رتبة المستهدف: ${targetLevel}). يستطيع العضو فقط التحكم بمن هم أقل منه رقماً.`
      };
    }
  }

  // 2. Action-specific permission mapping (Granular permissions system)
  const actionPermissionMap: Record<string, string> = {
    ban: 'canBan',
    unban: 'canUnban',
    kick: 'canKick',
    mute: 'canMute',
    unmute: 'canMute',
    unmuteText: 'canMute',
    getMutedList: 'canMute',
    muteVoice: 'canMuteVoice',
    unmuteVoice: 'canMuteVoice',
    pullMic: 'canPullMic',
    warn: 'canWarn',
    jailUser: 'canJail',
    unjailUser: 'canUnjail',
    deleteAvatar: 'canDeleteAvatar',
    updateAvatar: 'canEditMemberProfile',
    updateQuote: 'canEditMemberProfile',
    updateUsername: 'canEditMemberProfile',
    updateDisplayName: 'canEditMemberProfile',
    updateLikes: 'canEditLikes',
    updatePoints: 'canEditPoints',
    updateRole: 'canChangeRoles',
    updatePassword: 'canChangeMemberPassword',
    moveRoom: 'canMoveUsers',
    pullAllUsers: 'canMoveUsers',
    lockRoomChat: 'canLockRoom',
    setSlowMode: 'canSetSlowMode',
    lockRoomVoice: 'canLockVoice',
    setRoomPassword: 'canLockRoom',
    createRoom: 'canChangeRoomSettings',
    editRoom: 'canChangeRoomSettings',
    deleteRoom: 'canChangeRoomSettings',
    globalClearChat: 'canClearRoomChat',
    globalBroadcast: 'canBroadcast',
    adminSiren: 'canBroadcast',
    deleteAccount: 'canDeleteAccounts',
    revealNicks: 'canRevealNicks',
    resetName: 'canEditMemberProfile',
    broadcastMessage: 'canBroadcast'
  };

  const requiredPerm = actionPermissionMap[action];
  if (requiredPerm) {
    if (!hasPermission(actor.role, requiredPerm)) {
      return {
        allowed: false,
        reason: `عفواً، رتبتك لا تملك الصلاحية المطلوبة (${requiredPerm}) لتنفيذ هذا الإجراء.`
      };
    }
  } else if (actorLevel < 75 && !hasPermission(actor.role, 'canKick') && !hasPermission(actor.role, 'canMute')) {
    return { allowed: false, reason: 'عفواً، ليست لديك أي صلاحيات إدارية لتنفيذ هذا الإجراء.' };
  }

  return { allowed: true };
}

// Banned record structure
export interface BannedRecord {
  username: string;
  ip?: string;
  deviceFingerprint?: string;
  deviceFingerprints?: string[];
  reason: string;
  bannedBy: string;
  timestamp: number;
  expiresAt?: number;
  banDurationMinutes?: number;
  banType?: 'auto_filter' | 'manual';
}

// Country flag to ISO alpha-2 mapping for geo-restriction checks
const flagToCodeMap: Record<string, string> = {
  '🇸🇦': 'SA', '🇪🇬': 'EG', '🇾🇪': 'YE', '🇮🇶': 'IQ', '🇸🇾': 'SY',
  '🇩🇿': 'DZ', '🇲🇦': 'MA', '🇦🇪': 'AE', '🇰🇼': 'KW', '🇯🇴': 'JO',
  '🇴🇲': 'OM', '🇶🇦': 'QA', '🇧🇭': 'BH', '🇹🇳': 'TN', '🇱🇾': 'LY',
  '🇸🇩': 'SD', '🇱🇧': 'LB', '🇵🇸': 'PS', '🇹🇷': 'TR', '🇬🇧': 'GB',
  '🇺🇸': 'US', '🇩🇪': 'DE', '🇫🇷': 'FR', '🇨🇦': 'CA'
};

// Filter violations entry and IP tracking map for automated IP bans
interface FilterViolationEntry {
  timestamp: number;
  word: string;
  username: string;
}
const ipFilterViolationsMap = new Map<string, FilterViolationEntry[]>();

// Jailed record structure
export interface JailedRecord {
  username: string;
  ip?: string;
  reason: string;
  jailedBy: string;
  timestamp: number;
}

// Muted record structure (persistent device/IP/account mute)
export interface MutedRecord {
  username: string;
  ip?: string;
  ips?: string[];
  deviceFingerprint?: string;
  deviceFingerprints?: string[];
  muteText: boolean;
  muteVoice: boolean;
  reason: string;
  mutedBy: string;
  timestamp: number;
}

// Banned usernames, IPs, device fingerprints and structured records
const bannedUsers = new Set<string>();
const bannedIps = new Set<string>();
const bannedDeviceFingerprints = new Set<string>();
const bannedRecords: Map<string, BannedRecord> = new Map();

// Muted usernames, IPs, device fingerprints and structured records
const mutedUsers = new Set<string>();
const mutedIps = new Set<string>();
const mutedDeviceFingerprints = new Set<string>();
const mutedRecords: Map<string, MutedRecord> = new Map();

// Normalize any incoming deviceFingerprint (string or legacy object) safely to a trimmed string
export function normalizeDeviceFingerprint(fp: unknown): string {
  if (typeof fp === 'string') return fp.trim();
  if (fp && typeof fp === 'object' && typeof (fp as { fingerprintId?: unknown }).fingerprintId === 'string') {
    return String((fp as { fingerprintId: string }).fingerprintId).trim();
  }
  return '';
}

// Extract persistent UID from fingerprint (e.g. '332b64ac' from '...1l301n7|332b64ac.Chrome')
// Remains identical when a user switches between Mobile Browser and Desktop Site on the same device.
export function getPersistentUid(fp?: unknown): string {
  const trimmed = normalizeDeviceFingerprint(fp);
  if (!trimmed || trimmed === 'FP-DEV-STANDARD' || !trimmed.includes('||')) return '';
  const lastPipe = trimmed.lastIndexOf('|');
  if (lastPipe === -1) return '';
  const tail = trimmed.slice(lastPipe + 1);
  const dotIdx = tail.indexOf('.');
  const uid = dotIdx !== -1 ? tail.slice(0, dotIdx) : tail;
  return uid.length >= 6 ? uid : '';
}

// Extract hardware-only core prefix from a device fingerprint (everything before the last '|')
export function getHardwareCore(fp?: unknown): string {
  const trimmed = normalizeDeviceFingerprint(fp);
  if (!trimmed || trimmed === 'FP-DEV-STANDARD') return '';
  if (trimmed.includes('||')) {
    const lastPipe = trimmed.lastIndexOf('|');
    if (lastPipe > 0) {
      return trimmed.slice(0, lastPipe);
    }
  }
  return trimmed;
}

// Extract pure Cross-Browser Hardware & OS Signature (GPU + WebGL Limits + Screen + CPU + Timezone + OS Fonts)
export function getCrossBrowserHwId(fp?: unknown): string {
  const trimmed = normalizeDeviceFingerprint(fp);
  if (!trimmed) return '';
  const dblPipe = trimmed.indexOf('||');
  if (dblPipe === -1) return '';
  const after = trimmed.slice(dblPipe + 2);
  const parts = after.split('|');
  // Format A: canvas|webgl|audio|localeFonts|screen|crossBrowserHw|uid.browser -> parts.length >= 7
  if (parts.length >= 7 && parts[5] && parts[5].length >= 5 && parts[5] !== 'hwerr') {
    return parts[5];
  }
  // Format B: standard 5-hash format from other chats (canvas|webgl|audio|localeFonts|screen|uid.browser)
  if (parts.length >= 6 && parts[1] && parts[4] && parts[1] !== 'wglerr') {
    return `${parts[1]}_${parts[4]}`;
  }
  return '';
}

export interface FingerprintComponents {
  os: string;
  cores: string;
  canvasHash: string;
  webglHash: string;
  audioHash: string;
  localeFontsHash: string;
  screenHash: string;
  crossBrowserHw: string;
  uid: string;
  browser: string;
}

export function parseFingerprintComponents(fp?: unknown): FingerprintComponents | null {
  const trimmed = normalizeDeviceFingerprint(fp);
  if (!trimmed || trimmed === 'FP-DEV-STANDARD') return null;
  const dblPipe = trimmed.indexOf('||');
  if (dblPipe === -1) return null;

  const prefix = trimmed.slice(0, dblPipe);
  const prefixParts = prefix.split('|');
  const os = prefixParts[0] || 'Unknown';
  const cores = prefixParts[1] || '4';

  const after = trimmed.slice(dblPipe + 2);
  const parts = after.split('|');
  if (parts.length < 5) return null;

  const canvasHash = parts[0] || '';
  const webglHash = parts[1] || '';
  const audioHash = parts[2] || '';
  let localeFontsHash = '';
  let screenHash = '';
  let crossBrowserHw = '';
  let lastPart = '';

  if (parts.length >= 7) {
    localeFontsHash = parts[3] || '';
    screenHash = parts[4] || '';
    crossBrowserHw = parts[5] || '';
    lastPart = parts[6] || '';
  } else if (parts.length === 6) {
    screenHash = parts[3] || '';
    crossBrowserHw = parts[4] || '';
    lastPart = parts[5] || '';
  } else {
    lastPart = parts[parts.length - 1] || '';
  }

  const dotIdx = lastPart.indexOf('.');
  const uid = dotIdx !== -1 ? lastPart.slice(0, dotIdx) : lastPart;
  const browser = dotIdx !== -1 ? lastPart.slice(dotIdx + 1) : '';

  return {
    os,
    cores,
    canvasHash,
    webglHash,
    audioHash,
    localeFontsHash,
    screenHash,
    crossBrowserHw,
    uid,
    browser
  };
}

export function areFingerprintsFromSameDevice(fpA?: string, fpB?: string): { match: boolean; confidence: number; reason: string } {
  if (!fpA || !fpB) return { match: false, confidence: 0, reason: '' };
  const a = fpA.trim();
  const b = fpB.trim();
  if (a === 'FP-DEV-STANDARD' || b === 'FP-DEV-STANDARD' || !a || !b) {
    return { match: false, confidence: 0, reason: '' };
  }
  if (a === b) {
    return { match: true, confidence: 100, reason: 'بصمة الجهاز والعتاد متطابقة 100%' };
  }

  const uidA = getPersistentUid(a);
  const uidB = getPersistentUid(b);
  if (uidA && uidB && uidA === uidB) {
    return { match: true, confidence: 100, reason: 'المعرف المادي للهاتف (Device UID) متطابق 100%' };
  }

  const coreA = getHardwareCore(a);
  const coreB = getHardwareCore(b);
  if (coreA && coreB && coreA === coreB) {
    return { match: true, confidence: 100, reason: 'عتاد الهاتف الداخلي متطابق بالكامل (Hardware Core)' };
  }

  const hwA = getCrossBrowserHwId(a);
  const hwB = getCrossBrowserHwId(b);
  if (hwA && hwB && hwA === hwB && hwA !== 'hwerr') {
    return { match: true, confidence: 99, reason: 'بصمة العتاد العابرة للمتصفحات (Cross-Browser HW) متطابقة' };
  }

  const compA = parseFingerprintComponents(a);
  const compB = parseFingerprintComponents(b);
  if (compA && compB) {
    const sameOs = compA.os.toLowerCase() === compB.os.toLowerCase();
    const sameCores = compA.cores === compB.cores;

    if (sameOs && sameCores) {
      const sameGpu = Boolean(compA.webglHash && compB.webglHash && compA.webglHash === compB.webglHash && compA.webglHash !== 'wglerr' && compA.webglHash !== 'nowgl');
      const sameAudio = Boolean(compA.audioHash && compB.audioHash && compA.audioHash === compB.audioHash && compA.audioHash !== 'auderr' && compA.audioHash !== 'noaud');
      const sameScreen = Boolean(compA.screenHash && compB.screenHash && compA.screenHash === compB.screenHash);
      const sameCanvas = Boolean(compA.canvasHash && compB.canvasHash && compA.canvasHash === compB.canvasHash && compA.canvasHash !== 'cnverr');

      if (sameGpu && sameAudio) {
        return { match: true, confidence: 98, reason: 'تطابق كامل لمعالج الرسوميات (GPU) وبطاقة الصوت وعدد الأنوية' };
      }
      if (sameGpu && sameScreen) {
        return { match: true, confidence: 96, reason: 'تطابق كامل لمعالج الرسوميات (GPU) وأبعاد شاشة الهاتف' };
      }
      if (sameAudio && sameScreen) {
        return { match: true, confidence: 95, reason: 'تطابق بطاقة الصوت وشاشة الهاتف ونظام التشغيل' };
      }
      if (sameCanvas && sameGpu) {
        return { match: true, confidence: 97, reason: 'تطابق محرك الرسوميات (Canvas & WebGL GPU)' };
      }
    }
  }

  return { match: false, confidence: 0, reason: '' };
}

function addFingerprintToBanSet(fp?: string) {
  if (!fp) return;
  const trimmed = fp.trim();
  if (!trimmed || trimmed === 'FP-DEV-STANDARD') return;
  bannedDeviceFingerprints.add(trimmed);
  const uid = getPersistentUid(trimmed);
  if (uid) {
    bannedDeviceFingerprints.add(`UID:${uid}`);
  }
  const core = getHardwareCore(trimmed);
  if (core) {
    bannedDeviceFingerprints.add(core);
  }
  const crossHw = getCrossBrowserHwId(trimmed);
  if (crossHw) {
    bannedDeviceFingerprints.add(`HW:${crossHw}`);
  }
}

function getAllRecordFingerprints(r: BannedRecord): string[] {
  const list = new Set<string>();
  if (r.deviceFingerprint) list.add(r.deviceFingerprint);
  if (Array.isArray(r.deviceFingerprints)) {
    r.deviceFingerprints.forEach((f) => {
      if (f) list.add(f);
    });
  }
  return Array.from(list);
}

function removeFingerprintFromBanSet(fp?: string) {
  if (!fp) return;
  const trimmed = fp.trim();
  if (!trimmed) return;
  const uid = getPersistentUid(trimmed);
  const core = getHardwareCore(trimmed);
  const crossHw = getCrossBrowserHwId(trimmed);
  const allActiveFps = Array.from(bannedRecords.values()).flatMap((r) => getAllRecordFingerprints(r));
  if (!allActiveFps.includes(trimmed)) {
    bannedDeviceFingerprints.delete(trimmed);
  }
  if (uid && !allActiveFps.some((f) => getPersistentUid(f) === uid)) {
    bannedDeviceFingerprints.delete(`UID:${uid}`);
  }
  if (core && !allActiveFps.some((f) => getHardwareCore(f) === core)) {
    bannedDeviceFingerprints.delete(core);
  }
  if (crossHw && !allActiveFps.some((f) => getCrossBrowserHwId(f) === crossHw)) {
    bannedDeviceFingerprints.delete(`HW:${crossHw}`);
  }
}

// Helper to clean expired temporary bans
function cleanExpiredBans(): boolean {
  const now = Date.now();
  let changed = false;
  for (const [key, record] of bannedRecords.entries()) {
    if (record.expiresAt && record.expiresAt > 0 && record.expiresAt <= now) {
      bannedRecords.delete(key);
      bannedUsers.delete(record.username.toLowerCase());
      if (record.ip) {
        const otherUsesIp = Array.from(bannedRecords.values()).some((r) => r.ip === record.ip);
        if (!otherUsesIp) {
          bannedIps.delete(record.ip);
        }
      }
      getAllRecordFingerprints(record).forEach((fpItem) => {
        removeFingerprintFromBanSet(fpItem);
      });
      changed = true;
      logMonitorEvent('ban', `انتهت مدة الحظر المؤقت تلقائياً للمستخدم [${record.username}] (${record.ip || 'بدون IP'})`, 'النظام الأمني');
    }
  }
  if (changed) {
    saveBans();
    emitToAuthorizedStaff('bannedListUpdated', Array.from(bannedRecords.values()), 'canUnban');
  }
  return changed;
}

// Jailed usernames, IPs and structured records
const jailedUsernames = new Set<string>();
const jailedIps = new Set<string>();
const jailedRecords: Map<string, JailedRecord> = new Map();

// Save / Load Bans via Data Layer
function saveBans() {
  try {
    const data = {
      records: Array.from(bannedRecords.values()),
      ips: Array.from(bannedIps),
      deviceFingerprints: Array.from(bannedDeviceFingerprints)
    };
    dataManager.saveBans(data);
  } catch (err) {
    console.error('Error saving bans:', err);
  }
}

function loadBans() {
  try {
    const seed = {
      records: [
        {
          username: 'spammer_bot',
          ip: '192.168.1.105',
          reason: 'إرسال روابط دعائية مخالفة وإزعاج الأعضاء',
          bannedBy: 'admin',
          timestamp: Date.now() - 3600000
        },
        {
          username: 'bad_user_99',
          ip: '10.0.0.44',
          reason: 'تلفظ بكلمات خادشة للحياء والآداب العامة',
          bannedBy: 'Sajan',
          timestamp: Date.now() - 7200000
        }
      ],
      ips: ['192.168.1.105', '10.0.0.44'],
      deviceFingerprints: []
    };
    const parsed = dataManager.loadBansSync(seed);
    if (parsed && Array.isArray(parsed.records)) {
      parsed.records.forEach((r: BannedRecord) => {
        bannedRecords.set(r.username.toLowerCase(), r);
        bannedUsers.add(r.username.toLowerCase());
        if (r.ip) bannedIps.add(r.ip);
        if (r.deviceFingerprint) addFingerprintToBanSet(r.deviceFingerprint);
      });
    }
    if (parsed && Array.isArray(parsed.ips)) {
      parsed.ips.forEach((ip: string) => bannedIps.add(ip));
    }
    if (parsed && Array.isArray(parsed.deviceFingerprints)) {
      parsed.deviceFingerprints.forEach((fp: string) => addFingerprintToBanSet(fp));
    }
  } catch (err) {
    console.error('Error loading bans:', err);
  }
}
loadBans();

// Save / Load Jailed via Data Layer
function saveJailed() {
  try {
    const data = {
      records: Array.from(jailedRecords.values()),
      ips: Array.from(jailedIps)
    };
    dataManager.saveJailed(data);
  } catch (err) {
    console.error('Error saving jailed records:', err);
  }
}

function loadJailed() {
  try {
    const parsed = dataManager.loadJailedSync<{ records: JailedRecord[]; ips: string[] }>({ records: [], ips: [] });
    if (parsed && Array.isArray(parsed.records)) {
      parsed.records.forEach((r: JailedRecord) => {
        jailedRecords.set(r.username.toLowerCase(), r);
        jailedUsernames.add(r.username.toLowerCase());
        if (r.ip) jailedIps.add(r.ip);
      });
    }
    if (parsed && Array.isArray(parsed.ips)) {
      parsed.ips.forEach((ip: string) => jailedIps.add(ip));
    }
  } catch (err) {
    console.error('Error loading jailed records:', err);
  }
}
loadJailed();

function getAllMuteRecordFingerprints(r: MutedRecord): string[] {
  const list = new Set<string>();
  if (r.deviceFingerprint) list.add(r.deviceFingerprint);
  if (Array.isArray(r.deviceFingerprints)) {
    r.deviceFingerprints.forEach((f) => {
      if (f) list.add(f);
    });
  }
  return Array.from(list);
}

function getAllMuteRecordIps(r: MutedRecord): string[] {
  const list = new Set<string>();
  if (r.ip && isBannableIp(r.ip)) list.add(r.ip);
  if (Array.isArray(r.ips)) {
    r.ips.forEach((ip) => {
      if (ip && isBannableIp(ip)) list.add(ip);
    });
  }
  return Array.from(list);
}

function addFingerprintToMuteSet(fp?: string) {
  if (!fp) return;
  const trimmed = fp.trim();
  if (!trimmed || trimmed === 'FP-DEV-STANDARD') return;
  mutedDeviceFingerprints.add(trimmed);
  const uid = getPersistentUid(trimmed);
  if (uid) {
    mutedDeviceFingerprints.add(`UID:${uid}`);
  }
  const core = getHardwareCore(trimmed);
  if (core) {
    mutedDeviceFingerprints.add(core);
  }
  const crossHw = getCrossBrowserHwId(trimmed);
  if (crossHw) {
    mutedDeviceFingerprints.add(`HW:${crossHw}`);
  }
}

function removeFingerprintFromMuteSet(fp?: string) {
  if (!fp) return;
  const trimmed = fp.trim();
  if (!trimmed) return;
  const uid = getPersistentUid(trimmed);
  const core = getHardwareCore(trimmed);
  const crossHw = getCrossBrowserHwId(trimmed);
  const allActiveFps = Array.from(mutedRecords.values()).flatMap((r) => getAllMuteRecordFingerprints(r));
  if (!allActiveFps.includes(trimmed)) {
    mutedDeviceFingerprints.delete(trimmed);
  }
  if (uid && !allActiveFps.some((f) => getPersistentUid(f) === uid)) {
    mutedDeviceFingerprints.delete(`UID:${uid}`);
  }
  if (core && !allActiveFps.some((f) => getHardwareCore(f) === core)) {
    mutedDeviceFingerprints.delete(core);
  }
  if (crossHw && !allActiveFps.some((f) => getCrossBrowserHwId(f) === crossHw)) {
    mutedDeviceFingerprints.delete(`HW:${crossHw}`);
  }
}

function saveMutes() {
  try {
    const data = {
      records: Array.from(mutedRecords.values()),
      ips: Array.from(mutedIps),
      deviceFingerprints: Array.from(mutedDeviceFingerprints)
    };
    dataManager.saveMuted(data);
  } catch (err) {
    console.error('Error saving muted records:', err);
  }
}

function loadMutes() {
  try {
    mutedRecords.clear();
    mutedUsers.clear();
    mutedIps.clear();
    mutedDeviceFingerprints.clear();
    const parsed = dataManager.loadMutedSync<{ records: MutedRecord[]; ips: string[]; deviceFingerprints?: string[] }>({
      records: [],
      ips: [],
      deviceFingerprints: []
    });
    if (parsed && Array.isArray(parsed.records)) {
      parsed.records.forEach((r: MutedRecord) => {
        if (!r || !r.username) return;
        const normalized: MutedRecord = {
          ...r,
          muteText: Boolean(r.muteText),
          muteVoice: Boolean(r.muteVoice)
        };
        if (!normalized.muteText && !normalized.muteVoice) return;
        mutedRecords.set(normalized.username.toLowerCase(), normalized);
        mutedUsers.add(normalized.username.toLowerCase());
        getAllMuteRecordIps(normalized).forEach((ip) => mutedIps.add(ip));
        getAllMuteRecordFingerprints(normalized).forEach((fp) => addFingerprintToMuteSet(fp));
      });
    }
    if (parsed && Array.isArray(parsed.ips)) {
      parsed.ips.forEach((ip: string) => {
        if (isBannableIp(ip)) mutedIps.add(ip);
      });
    }
    if (parsed && Array.isArray(parsed.deviceFingerprints)) {
      parsed.deviceFingerprints.forEach((fp: string) => addFingerprintToMuteSet(fp));
    }
  } catch (err) {
    console.error('Error loading muted records:', err);
  }
}
loadMutes();

interface ActiveMuteMatchResult {
  isMuted: boolean;
  muteText: boolean;
  muteVoice: boolean;
  matchedRecord?: MutedRecord;
}

function findActiveMuteMatch(username?: string, clientIp?: string, rawFp?: unknown): ActiveMuteMatchResult {
  const cleanName = (username || '').trim();
  const lowerName = cleanName.toLowerCase();
  if (lowerName) {
    if (isSupremeHassan(lowerName) || botEngine.isBotUsername(cleanName)) {
      return { isMuted: false, muteText: false, muteVoice: false };
    }
    const reg = getRegisteredMember(cleanName)?.member;
    if (reg && isSupremeHassan(reg.role)) {
      return { isMuted: false, muteText: false, muteVoice: false };
    }
  }

  const incomingFp = normalizeDeviceFingerprint(rawFp);
  const incomingUid = getPersistentUid(incomingFp);
  const incomingCore = getHardwareCore(incomingFp);
  const incomingCrossHw = getCrossBrowserHwId(incomingFp);
  const coreAccounts = incomingCore ? fingerprintToAccountsMap.get(incomingCore) : undefined;
  const isCoreSharedWithInnocent = coreAccounts
    ? Array.from(coreAccounts).some((acc) => !mutedUsers.has(acc.toLowerCase()))
    : false;
  const crossHwAccounts = incomingCrossHw ? fingerprintToAccountsMap.get(`HW:${incomingCrossHw}`) : undefined;
  const isCrossHwSharedWithInnocent = crossHwAccounts
    ? Array.from(crossHwAccounts).some((acc) => !mutedUsers.has(acc.toLowerCase()))
    : false;
  const hasBannableIp = Boolean(clientIp && isBannableIp(clientIp));

  const matchedRecordsList: MutedRecord[] = [];
  for (const r of mutedRecords.values()) {
    const recIps = getAllMuteRecordIps(r);
    const nameHit = Boolean(lowerName && r.username.toLowerCase() === lowerName);
    const ipHit = Boolean(hasBannableIp && ((r.ip && isBannableIp(r.ip) && r.ip === clientIp) || recIps.includes(clientIp!)));
    let fpHit = false;
    if (incomingFp) {
      const recFps = getAllMuteRecordFingerprints(r);
      fpHit = recFps.some(
        (rfp) =>
          rfp === incomingFp ||
          (incomingUid && getPersistentUid(rfp) === incomingUid) ||
          (!isCoreSharedWithInnocent && incomingCore && getHardwareCore(rfp) === incomingCore) ||
          (!isCrossHwSharedWithInnocent && incomingCrossHw && getCrossBrowserHwId(rfp) === incomingCrossHw) ||
          areFingerprintsFromSameDevice(incomingFp, rfp).match
      );
    }
    if (nameHit || ipHit || fpHit) {
      matchedRecordsList.push(r);
    }
  }

  let muteText = matchedRecordsList.some((r) => r.muteText);
  let muteVoice = matchedRecordsList.some((r) => r.muteVoice);
  let primaryMatch: MutedRecord | undefined = matchedRecordsList[0];

  const isNameMuted = Boolean(lowerName && mutedUsers.has(lowerName));
  const isIpMuted = Boolean(hasBannableIp && mutedIps.has(clientIp!));
  const accountsForIp = hasBannableIp ? ipToAccountsMap.get(clientIp!) : undefined;
  const isIpAssociatedWithMuted = accountsForIp
    ? Array.from(accountsForIp).some((acc) => mutedUsers.has(acc.toLowerCase()))
    : false;
  const isFpMuted = Boolean(
    (incomingFp && mutedDeviceFingerprints.has(incomingFp)) ||
      (incomingUid && mutedDeviceFingerprints.has(`UID:${incomingUid}`)) ||
      (!isCoreSharedWithInnocent && incomingCore && mutedDeviceFingerprints.has(incomingCore)) ||
      (!isCrossHwSharedWithInnocent && incomingCrossHw && mutedDeviceFingerprints.has(`HW:${incomingCrossHw}`))
  );
  const accountsForFp =
    (incomingFp ? fingerprintToAccountsMap.get(incomingFp) : undefined) ||
    (!isCoreSharedWithInnocent && incomingCore ? fingerprintToAccountsMap.get(incomingCore) : undefined);
  const isFpAssociatedWithMuted = accountsForFp
    ? Array.from(accountsForFp).some((acc) => mutedUsers.has(acc.toLowerCase()))
    : false;

  if (matchedRecordsList.length === 0 && (isNameMuted || isIpMuted || isIpAssociatedWithMuted || isFpMuted || isFpAssociatedWithMuted)) {
    const associatedAccounts = new Set<string>();
    if (lowerName) associatedAccounts.add(lowerName);
    accountsForIp?.forEach((a) => associatedAccounts.add(a.toLowerCase()));
    accountsForFp?.forEach((a) => associatedAccounts.add(a.toLowerCase()));
    for (const acc of associatedAccounts) {
      const rec = mutedRecords.get(acc);
      if (rec) {
        matchedRecordsList.push(rec);
        if (rec.muteText) muteText = true;
        if (rec.muteVoice) muteVoice = true;
      }
    }
    primaryMatch = matchedRecordsList[0];
    if (!primaryMatch) {
      muteText = true;
      muteVoice = true;
    }
  }

  return {
    isMuted: Boolean(muteText || muteVoice),
    muteText,
    muteVoice,
    matchedRecord: primaryMatch
  };
}

function syncMuteRecordOnReentry(username: string, clientIp: string, incomingFp: string, match: ActiveMuteMatchResult) {
  if (!match.isMuted) return;
  const clean = username.trim();
  const lower = clean.toLowerCase();
  if (!lower || isSupremeHassan(lower) || botEngine.isBotUsername(clean)) return;

  let changed = false;
  if (!mutedUsers.has(lower)) {
    mutedUsers.add(lower);
    changed = true;
  }
  if (isBannableIp(clientIp) && !mutedIps.has(clientIp)) {
    mutedIps.add(clientIp);
    changed = true;
  }
  if (incomingFp && incomingFp !== 'FP-DEV-STANDARD' && !mutedDeviceFingerprints.has(incomingFp)) {
    addFingerprintToMuteSet(incomingFp);
    changed = true;
  }

  const rec = match.matchedRecord;
  if (rec) {
    if (isBannableIp(clientIp)) {
      if (!rec.ip) rec.ip = clientIp;
      if (!Array.isArray(rec.ips)) rec.ips = rec.ip && isBannableIp(rec.ip) ? [rec.ip] : [];
      if (!rec.ips.includes(clientIp)) {
        rec.ips.push(clientIp);
        changed = true;
      }
    }
    if (incomingFp && incomingFp !== 'FP-DEV-STANDARD') {
      if (!rec.deviceFingerprint) rec.deviceFingerprint = incomingFp;
      if (!Array.isArray(rec.deviceFingerprints)) {
        rec.deviceFingerprints = rec.deviceFingerprint ? [rec.deviceFingerprint] : [];
      }
      if (!rec.deviceFingerprints.includes(incomingFp)) {
        rec.deviceFingerprints.push(incomingFp);
        changed = true;
      }
    }
    if (rec.username.toLowerCase() !== lower) {
      logMonitorEvent(
        'mute',
        `🔇 رصد وتطبيق الإسكات المستمر تلقائياً على [${clean}] (يطابق بصمة/IP العضو المسكت [${rec.username}] - IP: ${clientIp})`,
        'النظام الأمني',
        clean
      );
    }
  }
  if (changed) {
    saveMutes();
  }
}

function applyPersistentMute(
  targetUsernameInput: string,
  options: { muteText: boolean; muteVoice: boolean; reason?: string; actorName: string }
): { ok: boolean; error?: string; record?: MutedRecord } {
  const cleanInput = targetUsernameInput.trim();
  if (!cleanInput) return { ok: false, error: 'لم يتم تحديد اسم العضو.' };

  const liveTarget = users.find((u) => u.username.toLowerCase() === cleanInput.toLowerCase());
  const regResult = getRegisteredMember(cleanInput);
  const regTarget = regResult?.member;
  const uName = regResult?.key || liveTarget?.username || cleanInput;
  const lowerUName = uName.toLowerCase();

  if (
    isSupremeHassan(lowerUName) ||
    (liveTarget && isSupremeHassan(liveTarget)) ||
    (regTarget && isSupremeHassan(regTarget.role))
  ) {
    return { ok: false, error: 'لا يمكن إسكات الإدارة العليا.' };
  }
  if (liveTarget?.isBot || botEngine.isBotUsername(uName)) {
    return { ok: false, error: 'لا يمكن تطبيق الإسكات الدائم على البوتات.' };
  }

  const allTargetIps = new Set<string>();
  const addIpIfValid = (ip?: string) => {
    if (ip && isBannableIp(ip)) allTargetIps.add(ip.trim());
  };
  addIpIfValid(liveTarget?.ipAddress);
  addIpIfValid(regTarget?.ipAddress);
  if (Array.isArray(regTarget?.ipHistory)) {
    regTarget.ipHistory.forEach((ip) => addIpIfValid(ip));
  }
  for (const [ip, nicks] of ipToAccountsMap.entries()) {
    if (Array.from(nicks).some((n) => n.toLowerCase() === lowerUName)) {
      addIpIfValid(ip);
    }
  }
  for (const sObj of activeSessions.values()) {
    if (sObj.user?.username?.toLowerCase() === lowerUName) {
      addIpIfValid(sObj.user.ipAddress);
    }
  }

  const existingRecord = mutedRecords.get(lowerUName);
  if (existingRecord) {
    getAllMuteRecordIps(existingRecord).forEach((ip) => allTargetIps.add(ip));
  }
  const targetIpsList = Array.from(allTargetIps);
  const primaryIp = targetIpsList[0];

  const allTargetFps = new Set<string>();
  const addFpIfValid = (fp?: unknown) => {
    const norm = normalizeDeviceFingerprint(fp);
    if (norm && norm !== 'FP-DEV-STANDARD') allTargetFps.add(norm);
  };
  addFpIfValid(liveTarget?.deviceFingerprint);
  addFpIfValid(regTarget?.deviceFingerprint);
  if (Array.isArray(regTarget?.fingerprintHistory)) {
    regTarget.fingerprintHistory.forEach((f) => addFpIfValid(f));
  }
  targetIpsList.forEach((ip) => {
    if (ipToFingerprintMap.has(ip)) addFpIfValid(ipToFingerprintMap.get(ip));
  });
  for (const sObj of activeSessions.values()) {
    if (sObj.user?.username?.toLowerCase() === lowerUName) {
      addFpIfValid(sObj.user.deviceFingerprint);
    }
  }
  if (existingRecord) {
    getAllMuteRecordFingerprints(existingRecord).forEach((f) => addFpIfValid(f));
  }
  const targetFingerprintsList = Array.from(allTargetFps);
  const primaryFingerprint = targetFingerprintsList[0];

  const canMuteAccount = (acc: string) => {
    const cleanAcc = acc.trim();
    const low = cleanAcc.toLowerCase();
    if (!low || isSupremeHassan(low) || botEngine.isBotUsername(cleanAcc)) return false;
    const r = getRegisteredMember(cleanAcc)?.member;
    if (r && isSupremeHassan(r.role)) return false;
    return true;
  };

  if (canMuteAccount(uName)) mutedUsers.add(lowerUName);
  targetIpsList.forEach((ip) => mutedIps.add(ip));
  targetFingerprintsList.forEach((fpItem) => {
    addFingerprintToMuteSet(fpItem);
    const accs = fingerprintToAccountsMap.get(fpItem);
    if (accs) accs.forEach((acc) => { if (canMuteAccount(acc)) mutedUsers.add(acc.toLowerCase()); });
    const uid = getPersistentUid(fpItem);
    const uidAccs = uid ? fingerprintToAccountsMap.get(`UID:${uid}`) : undefined;
    if (uidAccs) uidAccs.forEach((acc) => { if (canMuteAccount(acc)) mutedUsers.add(acc.toLowerCase()); });
    const c = getHardwareCore(fpItem);
    const cAccs = c ? fingerprintToAccountsMap.get(c) : undefined;
    if (cAccs) cAccs.forEach((acc) => { if (canMuteAccount(acc)) mutedUsers.add(acc.toLowerCase()); });
  });
  targetIpsList.forEach((ip) => {
    if (ipToAccountsMap.has(ip)) {
      ipToAccountsMap.get(ip)!.forEach((acc) => {
        if (canMuteAccount(acc)) mutedUsers.add(acc.toLowerCase());
      });
    }
  });

  const record: MutedRecord = {
    username: uName,
    ip: primaryIp,
    ips: targetIpsList,
    deviceFingerprint: primaryFingerprint,
    deviceFingerprints: targetFingerprintsList,
    muteText: Boolean(existingRecord?.muteText || options.muteText),
    muteVoice: Boolean(existingRecord?.muteVoice || options.muteVoice),
    reason: (options.reason || existingRecord?.reason || 'إسكات إداري دائم').trim(),
    mutedBy: options.actorName,
    timestamp: Date.now()
  };
  mutedRecords.set(lowerUName, record);
  saveMutes();

  const matchesTargetIdentity = (u?: ConnectedUser): boolean => {
    if (!u || u.isBot || isSupremeHassan(u) || botEngine.isBotUsername(u.username)) return false;
    if (u.username.toLowerCase() === lowerUName || mutedUsers.has(u.username.toLowerCase())) return true;
    if (u.ipAddress && isBannableIp(u.ipAddress) && targetIpsList.includes(u.ipAddress)) return true;
    const uFp = normalizeDeviceFingerprint(u.deviceFingerprint);
    if (uFp && targetFingerprintsList.length > 0) {
      const uUid = getPersistentUid(uFp);
      const uCore = getHardwareCore(uFp);
      return targetFingerprintsList.some(
        (tfp) =>
          tfp === uFp ||
          (uUid && getPersistentUid(tfp) === uUid) ||
          (uCore && getHardwareCore(tfp) === uCore) ||
          areFingerprintsFromSameDevice(uFp, tfp).match
      );
    }
    return false;
  };

  for (const sObj of activeSessions.values()) {
    if (matchesTargetIdentity(sObj.user)) {
      sObj.user.isTextMuted = Boolean(sObj.user.isJailed || record.muteText);
      sObj.user.isVoiceMutedByAdmin = Boolean(sObj.user.isJailed || record.muteVoice);
      sObj.user.isMuted = Boolean(sObj.user.isTextMuted || sObj.user.isVoiceMutedByAdmin);
      if (sObj.user.isMuted) {
        sObj.user.isSpeaking = false;
        sObj.user.isSharingMusic = false;
      }
    }
  }
  persistActiveSessions();

  const affectedRooms = new Set<string>();
  users.forEach((u) => {
    if (matchesTargetIdentity(u)) {
      u.isTextMuted = Boolean(u.isJailed || record.muteText);
      u.isVoiceMutedByAdmin = Boolean(u.isJailed || record.muteVoice);
      u.isMuted = Boolean(u.isTextMuted || u.isVoiceMutedByAdmin);
      if (u.isMuted) {
        u.isSpeaking = false;
        u.isSharingMusic = false;
      }
      io.to(u.id).emit('forceVoiceMuteState', {
        muted: Boolean(u.isVoiceMutedByAdmin || u.isTextMuted),
        textMuted: u.isTextMuted,
        voiceMuted: u.isVoiceMutedByAdmin,
        by: options.actorName
      });
      if (u.micSlot !== null || u.isVoice) {
        io.to(u.room).emit('micSlotsUpdated', getPublicMicSlotsForRoom(u.room));
        io.to(u.room).emit('userVoiceStateChanged', {
          userId: u.id,
          isMuted: u.isMuted,
          isSpeaking: u.isSpeaking
        });
      }
      if (u.room && u.room !== 'خارج الغرف') {
        affectedRooms.add(u.room);
      }
    }
  });
  affectedRooms.forEach((r) => broadcastRoomUsers(r));

  emitToAuthorizedStaff('mutedListUpdated', Array.from(mutedRecords.values()), 'canMute');
  broadcastAllRegisteredMembers();
  return { ok: true, record };
}

function clearPersistentMute(
  targetIdentifier: string,
  options: { clearText: boolean; clearVoice: boolean; actorName: string }
): { ok: boolean; resolvedUsername: string; remainingTextMuted: boolean; remainingVoiceMuted: boolean } {
  const cleanId = targetIdentifier.trim();
  const lowerId = cleanId.toLowerCase();

  let rec = mutedRecords.get(lowerId);
  if (!rec) {
    for (const [, v] of mutedRecords.entries()) {
      const vIps = getAllMuteRecordIps(v);
      const vFps = getAllMuteRecordFingerprints(v);
      if (v.username.toLowerCase() === lowerId || v.ip === cleanId || vIps.includes(cleanId) || vFps.includes(cleanId)) {
        rec = v;
        break;
      }
    }
  }

  const resolvedUsername = rec?.username || cleanId;
  const affectedAccounts = new Set<string>([lowerId, resolvedUsername.toLowerCase()]);
  const affectedIps = new Set<string>();
  const affectedFps = new Set<string>();

  if (rec) {
    getAllMuteRecordIps(rec).forEach((ip) => affectedIps.add(ip));
    getAllMuteRecordFingerprints(rec).forEach((fp) => affectedFps.add(fp));

    if (options.clearText) rec.muteText = false;
    if (options.clearVoice) rec.muteVoice = false;

    if (!rec.muteText && !rec.muteVoice) {
      mutedRecords.delete(rec.username.toLowerCase());

      affectedIps.forEach((ip) => {
        const otherUsesIp = Array.from(mutedRecords.values()).some((r) => getAllMuteRecordIps(r).includes(ip));
        if (!otherUsesIp) mutedIps.delete(ip);
        ipToAccountsMap.get(ip)?.forEach((acc) => affectedAccounts.add(acc.toLowerCase()));
      });

      affectedFps.forEach((fpItem) => {
        removeFingerprintFromMuteSet(fpItem);
        fingerprintToAccountsMap.get(fpItem)?.forEach((acc) => affectedAccounts.add(acc.toLowerCase()));
        const uid = getPersistentUid(fpItem);
        if (uid) fingerprintToAccountsMap.get(`UID:${uid}`)?.forEach((acc) => affectedAccounts.add(acc.toLowerCase()));
        const core = getHardwareCore(fpItem);
        if (core) fingerprintToAccountsMap.get(core)?.forEach((acc) => affectedAccounts.add(acc.toLowerCase()));
      });

      affectedAccounts.forEach((accLower) => {
        if (!mutedRecords.has(accLower)) {
          mutedUsers.delete(accLower);
        }
      });
    } else {
      mutedRecords.set(rec.username.toLowerCase(), rec);
    }
  } else {
    if (options.clearText && options.clearVoice) {
      mutedUsers.delete(lowerId);
      mutedIps.delete(cleanId);
    }
  }

  saveMutes();

  const matchesClearedIdentity = (u?: ConnectedUser): boolean => {
    if (!u) return false;
    if (affectedAccounts.has(u.username.toLowerCase())) return true;
    if (u.ipAddress && isBannableIp(u.ipAddress) && affectedIps.has(u.ipAddress)) return true;
    const uFp = normalizeDeviceFingerprint(u.deviceFingerprint);
    if (uFp && affectedFps.size > 0) {
      const uUid = getPersistentUid(uFp);
      const uCore = getHardwareCore(uFp);
      return Array.from(affectedFps).some(
        (afp) =>
          afp === uFp ||
          (uUid && getPersistentUid(afp) === uUid) ||
          (uCore && getHardwareCore(afp) === uCore) ||
          areFingerprintsFromSameDevice(uFp, afp).match
      );
    }
    return false;
  };

  for (const sObj of activeSessions.values()) {
    if (matchesClearedIdentity(sObj.user)) {
      const m = findActiveMuteMatch(sObj.user.username, sObj.user.ipAddress, sObj.user.deviceFingerprint);
      sObj.user.isTextMuted = Boolean(sObj.user.isJailed || (options.clearText ? m.muteText : (sObj.user.isTextMuted && m.muteText)));
      sObj.user.isVoiceMutedByAdmin = Boolean(sObj.user.isJailed || (options.clearVoice ? m.muteVoice : (sObj.user.isVoiceMutedByAdmin && m.muteVoice)));
      sObj.user.isMuted = Boolean(sObj.user.isTextMuted || sObj.user.isVoiceMutedByAdmin);
    }
  }
  persistActiveSessions();

  const affectedRooms = new Set<string>();
  users.forEach((u) => {
    if (matchesClearedIdentity(u)) {
      const m = findActiveMuteMatch(u.username, u.ipAddress, u.deviceFingerprint);
      u.isTextMuted = Boolean(u.isJailed || (options.clearText ? m.muteText : (u.isTextMuted && m.muteText)));
      u.isVoiceMutedByAdmin = Boolean(u.isJailed || (options.clearVoice ? m.muteVoice : (u.isVoiceMutedByAdmin && m.muteVoice)));
      u.isMuted = Boolean(u.isTextMuted || u.isVoiceMutedByAdmin);

      io.to(u.id).emit('forceVoiceMuteState', {
        muted: Boolean(u.isVoiceMutedByAdmin || u.isTextMuted),
        textMuted: u.isTextMuted,
        voiceMuted: u.isVoiceMutedByAdmin,
        by: options.actorName
      });
      if (u.micSlot !== null || u.isVoice) {
        io.to(u.room).emit('micSlotsUpdated', getPublicMicSlotsForRoom(u.room));
        io.to(u.room).emit('userVoiceStateChanged', {
          userId: u.id,
          isMuted: u.isMuted,
          isSpeaking: u.isSpeaking
        });
      }
      if (u.room && u.room !== 'خارج الغرف') {
        affectedRooms.add(u.room);
      }
    }
  });
  affectedRooms.forEach((r) => broadcastRoomUsers(r));

  emitToAuthorizedStaff('mutedListUpdated', Array.from(mutedRecords.values()), 'canMute');
  broadcastAllRegisteredMembers();
  return {
    ok: true,
    resolvedUsername,
    remainingTextMuted: Boolean(rec?.muteText),
    remainingVoiceMuted: Boolean(rec?.muteVoice)
  };
}

// Chat Shortcuts Structure & Persistence (قائمة الاختصارات الذكية للشات)
export interface ChatShortcut {
  id: string;
  trigger: string;
  replacement: string;
  createdBy?: string;
  createdAt: number;
}

let chatShortcuts: ChatShortcut[] = [];

const DEFAULT_SEED_SHORTCUTS: ChatShortcut[] = [
  {
    id: 'sc-1',
    trigger: 'نورت',
    replacement: 'نورت الشات بطلتك الحلوه 🌹',
    createdBy: 'إدارة حسان برو',
    createdAt: Date.now() - 3600000
  },
  {
    id: 'sc-2',
    trigger: 'ن',
    replacement: 'نورتو يالي دخلتو 🌟',
    createdBy: 'إدارة حسان برو',
    createdAt: Date.now() - 3600000
  },
  {
    id: 'sc-3',
    trigger: 'سلام',
    replacement: 'السلام عليكم ورحمة الله وبركاته 🌹',
    createdBy: 'إدارة حصن برو',
    createdAt: Date.now() - 3600000
  },
  {
    id: 'sc-4',
    trigger: 'برب',
    replacement: 'برب دقائق وراجع بإذن الله ☕',
    createdBy: 'إدارة حسان برو',
    createdAt: Date.now() - 3600000
  },
  {
    id: 'sc-5',
    trigger: 'باك',
    replacement: 'باك أسعد الله أوقاتكم جميعاً 🤍',
    createdBy: 'إدارة حسان برو',
    createdAt: Date.now() - 3600000
  },
  {
    id: 'sc-6',
    trigger: 'منور',
    replacement: 'منور الدنيا كلها وحسان برو 🦅',
    createdBy: 'إدارة حسان برو',
    createdAt: Date.now() - 3600000
  }
];

interface CompiledChatShortcut {
  trigger: string;
  replacement: string;
  regex: RegExp | null;
}

let compiledShortcuts: CompiledChatShortcut[] = [];

function rebuildCompiledShortcuts() {
  const sorted = [...chatShortcuts].sort((a, b) => (b.trigger?.length || 0) - (a.trigger?.length || 0));
  const next: CompiledChatShortcut[] = [];
  for (const sc of sorted) {
    const trigger = sc.trigger?.trim();
    if (!trigger || !sc.replacement) continue;
    let regex: RegExp | null = null;
    try {
      const escaped = trigger.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      regex = new RegExp(`(^|[\\s،,.:;!؟?\\-_"'\`()[\\]{}«»])(${escaped})($|[\\s،,.:;!؟?\\-_"'\`()[\\]{}«»])`, 'g');
    } catch {
      regex = null;
    }
    next.push({ trigger, replacement: sc.replacement, regex });
  }
  compiledShortcuts = next;
}

function saveShortcuts() {
  rebuildCompiledShortcuts();
  invalidateConfigVersionCache('shortcuts');
  try {
    dataManager.saveShortcuts(chatShortcuts);
  } catch (err) {
    console.error('Error saving shortcuts:', err);
  }
}

function loadShortcuts() {
  try {
    const parsed = dataManager.loadShortcutsSync<ChatShortcut[]>(DEFAULT_SEED_SHORTCUTS);
    if (Array.isArray(parsed) && parsed.length > 0) {
      chatShortcuts = parsed;
      rebuildCompiledShortcuts();
      return;
    }
  } catch (err) {
    console.error('Error loading shortcuts:', err);
  }
  chatShortcuts = DEFAULT_SEED_SHORTCUTS;
  saveShortcuts();
}
loadShortcuts();

// Function to expand chat shortcuts in any message (uses pre-compiled regex map)
export function expandShortcuts(rawText: string): string {
  if (!rawText || compiledShortcuts.length === 0) return rawText;
  let result = rawText;

  for (let i = 0; i < compiledShortcuts.length; i++) {
    const sc = compiledShortcuts[i];
    if (result.trim() === sc.trigger) {
      result = sc.replacement;
      continue;
    }
    if (sc.regex) {
      sc.regex.lastIndex = 0;
      result = result.replace(sc.regex, `$1${sc.replacement}$3`);
    } else if (result.includes(sc.trigger)) {
      result = result.split(sc.trigger).join(sc.replacement);
    }
  }

  return result;
}

// Dynamic Room Settings (Chat lock, Slow mode, Voice lock, Room Pinned Topic, Welcome Message)
export interface RoomSettings {
  isChatLocked: boolean;
  slowModeSeconds: number; // 0 = off, 5, 10, 30
  isVoiceLocked: boolean;
  showDeletedNotice?: boolean;
  pinnedTopic?: string;
  welcomeMessage?: string;
  welcomeEnabled?: boolean;
  wallpaper?: string;
}
const roomSettingsMap: Record<string, RoomSettings> = {};
export function getRoomSettings(roomId: string): RoomSettings {
  if (!roomSettingsMap[roomId]) {
    roomSettingsMap[roomId] = {
      isChatLocked: false,
      slowModeSeconds: 0,
      isVoiceLocked: false,
      showDeletedNotice: false,
      pinnedTopic: '',
      welcomeMessage: '',
      welcomeEnabled: true,
      wallpaper: 'default'
    };
  }
  return roomSettingsMap[roomId];
}

// Rate limit tracker for slow mode
const userLastMessageTime: Record<string, number> = {};

// Pinned messages per room
const roomPinnedMessages: Record<string, { id: string; username: string; text: string } | null> = {};

// Dynamic Filter Monitored Words (الكلمات المراقبة في الفلتر)
let monitoredWords: string[] = [
  'سب', 'شتم', 'قذف', 'لعن', 'طرد', 'كود', 'هكر', 'اخترق', 'سكس', 'اباحي',
  'قحبة', 'منيوك', 'كس', 'طيز', 'كلب', 'حمار', 'وسخ', 'حقير', 'تفو'
];

// Likes Threshold Limits per Feature (شروط عدد اللايكات المطلوبة للإرسال)
export interface LikesThresholdSettings {
  roomTextLikes: number;    // لايكات إرسال نص بالغرفة
  roomMediaLikes: number;   // لايكات إرسال وسائط بالغرفة
  wallTextLikes: number;    // لايكات إرسال نص بالحائط
  wallMediaLikes: number;   // لايكات إرسال وسائط بالحائط
  pmTextLikes: number;      // لايكات إرسال نص بالخاص
  pmMediaLikes: number;     // لايكات إرسال وسائط بالخاص
  micLikes: number;         // لايكات الصعود للمايك
  callLikes: number;        // لايكات الاتصال في الخاص
}

let likesSettings: LikesThresholdSettings = {
  roomTextLikes: 0,
  roomMediaLikes: 0,
  wallTextLikes: 0,
  wallMediaLikes: 0,
  pmTextLikes: 0,
  pmMediaLikes: 0,
  micLikes: 0,
  callLikes: 0
};

// Message Retention Limits (سقف وحدود الرسائل مع الحذف التلقائي للأقدم)
export interface MessageRetentionLimits {
  roomMaxMessages: number;     // سقف رسائل الغرفة الواحدة (حذف تلقائي للأقدم)
  wallMaxPosts: number;        // سقف منشورات الحائط (حذف تلقائي للأقدم)
  privateMaxMessages: number;   // سقف رسائل المحادثة الخاصة الواحدة (حذف تلقائي للأقدم)
}

export let messageRetentionLimits: MessageRetentionLimits = {
  roomMaxMessages: 200,
  wallMaxPosts: 100,
  privateMaxMessages: 100
};

export function saveMessageRetentionLimits() {
  invalidateConfigVersionCache('retentionLimits');
  try {
    dataManager.save('message_retention_limits', messageRetentionLimits);
    if (!dataManager.isCloudConnected()) {
      const localDir = process.env.DATA_DIR || process.env.RAILWAY_VOLUME_MOUNT_PATH || path.join(__dirname);
      const localFile = path.join(localDir, 'message_retention_limits.json');
      fs.writeFileSync(localFile, JSON.stringify(messageRetentionLimits, null, 2), 'utf8');
    }
  } catch (err) {
    console.error('Error saving message retention limits:', err);
  }
}

export function loadMessageRetentionLimits() {
  try {
    const parsed = dataManager.loadSync<Partial<MessageRetentionLimits>>('message_retention_limits', messageRetentionLimits);
    if (parsed && typeof parsed === 'object') {
      messageRetentionLimits = {
        roomMaxMessages: Number(parsed.roomMaxMessages) > 0 ? Number(parsed.roomMaxMessages) : 200,
        wallMaxPosts: Number(parsed.wallMaxPosts) > 0 ? Number(parsed.wallMaxPosts) : 100,
        privateMaxMessages: Number(parsed.privateMaxMessages) > 0 ? Number(parsed.privateMaxMessages) : 100
      };
    }
  } catch (err) {
    console.error('Error loading message retention limits:', err);
  }
}

// Dynamic Role Permissions Management (إدارة محتوى وصلاحيات كل رتبة بالـ Checkboxes)
export interface RolePermissions {
  // 1. Chat & Rooms (الدردشة العامة والغرف)
  canSendText?: boolean;
  canSendMedia?: boolean;
  canSendVoiceNotes?: boolean;
  canDeleteMessage?: boolean;
  canDeleteMessages?: boolean;
  canPinMessage?: boolean;
  canClearRoomChat?: boolean;
  canLockRoom?: boolean;
  canSetSlowMode?: boolean;
  canChangeRoomSettings?: boolean;
  canEditRoomBanner?: boolean;

  // 2. Microphone & Audio (المايكروفون والصوتيات)
  canTakeMic?: boolean;
  canPullMic?: boolean;
  canMuteVoice?: boolean;
  canLockVoice?: boolean;
  canStartLive?: boolean;

  // 3. Moderation & Penalties (العقوبات والضبط الإداري)
  canWarn?: boolean;
  canMute?: boolean;
  canMuteText?: boolean;
  canKick?: boolean;
  canTempBan?: boolean;
  canBan?: boolean;
  canUnban?: boolean;
  canJail?: boolean;
  canUnjail?: boolean;

  // 4. Members & Profiles (إدارة الأعضاء والملفات الشخصية)
  canEditMemberProfile?: boolean;
  canEditMemberData?: boolean;
  canDeleteAvatar?: boolean;
  canEditLikes?: boolean;
  canEditPoints?: boolean;
  canAssignBanner?: boolean;
  canAssignBadge?: boolean;
  canUseAvatarFrame?: boolean;
  canUseMemberBg?: boolean;
  canManageMembershipCatalog?: boolean;
  canChangeMemberPassword?: boolean;
  canMoveUsers?: boolean;
  canChangeRoles?: boolean;
  canManagePermissions?: boolean;

  // 5. Security, Filter & Logs (الرقابة والأمان ولوحة التحكم)
  canAccessControlPanel?: boolean;
  canFilter?: boolean;
  canManageFilterWords?: boolean;
  canRevealNicks?: boolean;
  canViewAuditLogs?: boolean;
  canClearAuditLogs?: boolean;

  // 6. Features, Wall & PM (الميزات العامة والحائط والخاص)
  canBroadcast?: boolean;
  canGhostLogin?: boolean;
  canManageShortcuts?: boolean;
  canChangeGlobalTheme?: boolean;
  canPostWall?: boolean;
  canDeleteWallPost?: boolean;
  canPrivateChat?: boolean;
  canPrivateCall?: boolean;

  [key: string]: boolean | undefined;
}

export let rolePermissions: Record<string, RolePermissions> = {
  hassan: {
    canSendText: true,
    canSendMedia: true,
    canSendVoiceNotes: true,
    canDeleteMessage: true,
    canDeleteMessages: true,
    canPinMessage: true,
    canClearRoomChat: true,
    canLockRoom: true,
    canSetSlowMode: true,
    canChangeRoomSettings: true,
    canEditRoomBanner: true,
    canTakeMic: true,
    canPullMic: true,
    canMuteVoice: true,
    canLockVoice: true,
    canStartLive: true,
    canWarn: true,
    canMute: true,
    canMuteText: true,
    canKick: true,
    canTempBan: true,
    canBan: true,
    canUnban: true,
    canJail: true,
    canUnjail: true,
    canEditMemberProfile: true,
    canEditMemberData: true,
    canDeleteAvatar: true,
    canEditLikes: true,
    canEditPoints: true,
    canAssignBanner: true,
    canAssignBadge: true,
    canUseAvatarFrame: true,
    canUseMemberBg: true,
    canManageMembershipCatalog: true,
    canChangeMemberPassword: true,
    canMoveUsers: true,
    canChangeRoles: true,
    canManagePermissions: true,
    canAccessControlPanel: true,
    canFilter: true,
    canManageFilterWords: true,
    canRevealNicks: true,
    canViewAuditLogs: true,
    canClearAuditLogs: true,
    canBroadcast: true,
    canGhostLogin: true,
    canManageShortcuts: true,
    canChangeGlobalTheme: true,
    canPostWall: true,
    canDeleteWallPost: true,
    canPrivateChat: true,
    canPrivateCall: true
  },
  admin: {
    canSendText: true,
    canSendMedia: true,
    canSendVoiceNotes: true,
    canDeleteMessage: true,
    canDeleteMessages: true,
    canPinMessage: true,
    canClearRoomChat: true,
    canLockRoom: true,
    canSetSlowMode: true,
    canChangeRoomSettings: true,
    canEditRoomBanner: true,
    canTakeMic: true,
    canPullMic: true,
    canMuteVoice: true,
    canLockVoice: true,
    canStartLive: true,
    canWarn: true,
    canMute: true,
    canMuteText: true,
    canKick: true,
    canTempBan: true,
    canBan: true,
    canUnban: true,
    canJail: true,
    canUnjail: true,
    canEditMemberProfile: true,
    canEditMemberData: true,
    canDeleteAvatar: true,
    canEditLikes: true,
    canEditPoints: true,
    canAssignBanner: true,
    canAssignBadge: true,
    canUseAvatarFrame: true,
    canUseMemberBg: true,
    canManageMembershipCatalog: true,
    canChangeMemberPassword: true,
    canMoveUsers: true,
    canChangeRoles: true,
    canManagePermissions: true,
    canAccessControlPanel: true,
    canFilter: true,
    canManageFilterWords: true,
    canRevealNicks: true,
    canViewAuditLogs: true,
    canClearAuditLogs: true,
    canBroadcast: true,
    canGhostLogin: true,
    canManageShortcuts: true,
    canChangeGlobalTheme: true,
    canPostWall: true,
    canDeleteWallPost: true,
    canPrivateChat: true,
    canPrivateCall: true
  },
  super: {
    canSendText: true,
    canSendMedia: true,
    canSendVoiceNotes: true,
    canDeleteMessage: true,
    canDeleteMessages: true,
    canPinMessage: true,
    canClearRoomChat: true,
    canLockRoom: true,
    canSetSlowMode: true,
    canChangeRoomSettings: true,
    canEditRoomBanner: true,
    canTakeMic: true,
    canPullMic: true,
    canMuteVoice: true,
    canLockVoice: true,
    canStartLive: true,
    canWarn: true,
    canMute: true,
    canMuteText: true,
    canKick: true,
    canTempBan: true,
    canBan: false,
    canUnban: false,
    canJail: true,
    canUnjail: true,
    canEditMemberProfile: true,
    canEditMemberData: false,
    canDeleteAvatar: true,
    canEditLikes: false,
    canEditPoints: false,
    canAssignBanner: true,
    canAssignBadge: true,
    canUseAvatarFrame: true,
    canUseMemberBg: true,
    canManageMembershipCatalog: true,
    canChangeMemberPassword: false,
    canMoveUsers: true,
    canChangeRoles: false,
    canManagePermissions: true,
    canAccessControlPanel: true,
    canFilter: true,
    canManageFilterWords: false,
    canRevealNicks: true,
    canViewAuditLogs: true,
    canClearAuditLogs: false,
    canBroadcast: true,
    canGhostLogin: true,
    canManageShortcuts: true,
    canChangeGlobalTheme: true,
    canPostWall: true,
    canDeleteWallPost: true,
    canPrivateChat: true,
    canPrivateCall: true
  },
  member: {
    canSendText: true,
    canSendMedia: true,
    canSendVoiceNotes: true,
    canDeleteMessage: false,
    canDeleteMessages: false,
    canPinMessage: false,
    canClearRoomChat: false,
    canLockRoom: false,
    canSetSlowMode: false,
    canChangeRoomSettings: false,
    canEditRoomBanner: false,
    canTakeMic: true,
    canPullMic: false,
    canMuteVoice: false,
    canLockVoice: false,
    canStartLive: false,
    canWarn: false,
    canMute: false,
    canMuteText: false,
    canKick: false,
    canTempBan: false,
    canBan: false,
    canUnban: false,
    canJail: false,
    canUnjail: false,
    canEditMemberProfile: false,
    canEditMemberData: false,
    canDeleteAvatar: false,
    canEditLikes: false,
    canEditPoints: false,
    canAssignBanner: false,
    canAssignBadge: false,
    canUseAvatarFrame: false,
    canUseMemberBg: false,
    canManageMembershipCatalog: false,
    canChangeMemberPassword: false,
    canMoveUsers: false,
    canChangeRoles: false,
    canManagePermissions: false,
    canAccessControlPanel: false,
    canFilter: false,
    canManageFilterWords: false,
    canRevealNicks: false,
    canViewAuditLogs: false,
    canClearAuditLogs: false,
    canBroadcast: false,
    canGhostLogin: false,
    canManageShortcuts: false,
    canChangeGlobalTheme: false,
    canPostWall: true,
    canDeleteWallPost: false,
    canPrivateChat: true,
    canPrivateCall: true
  },
  guest: {
    canSendText: true,
    canSendMedia: false,
    canSendVoiceNotes: false,
    canDeleteMessage: false,
    canDeleteMessages: false,
    canPinMessage: false,
    canClearRoomChat: false,
    canLockRoom: false,
    canSetSlowMode: false,
    canChangeRoomSettings: false,
    canEditRoomBanner: false,
    canTakeMic: false,
    canPullMic: false,
    canMuteVoice: false,
    canLockVoice: false,
    canStartLive: false,
    canWarn: false,
    canMute: false,
    canMuteText: false,
    canKick: false,
    canTempBan: false,
    canBan: false,
    canUnban: false,
    canJail: false,
    canUnjail: false,
    canEditMemberProfile: false,
    canEditMemberData: false,
    canDeleteAvatar: false,
    canEditLikes: false,
    canEditPoints: false,
    canAssignBanner: false,
    canAssignBadge: false,
    canUseAvatarFrame: false,
    canUseMemberBg: false,
    canManageMembershipCatalog: false,
    canChangeMemberPassword: false,
    canMoveUsers: false,
    canChangeRoles: false,
    canManagePermissions: false,
    canAccessControlPanel: false,
    canFilter: false,
    canManageFilterWords: false,
    canRevealNicks: false,
    canViewAuditLogs: false,
    canClearAuditLogs: false,
    canBroadcast: false,
    canGhostLogin: false,
    canManageShortcuts: false,
    canChangeGlobalTheme: false,
    canPostWall: false,
    canDeleteWallPost: false,
    canPrivateChat: false,
    canPrivateCall: false
  }
};

export function hasPermission(roleId?: string, permKey?: string): boolean {
  if (!roleId || !permKey) return false;
  const cleanRole = roleId.trim().toLowerCase();
  if (cleanRole === 'hassan' || cleanRole === 'admin' || getRoleLevel(cleanRole) >= getRoleLevel('admin')) return true;

  const perms = rolePermissions[cleanRole];
  if (perms) {
    if (perms[permKey] !== undefined) return Boolean(perms[permKey]);
    // Aliases
    if (permKey === 'canDeleteMessage' && perms.canDeleteMessages !== undefined) return Boolean(perms.canDeleteMessages);
    if (permKey === 'canDeleteMessages' && perms.canDeleteMessage !== undefined) return Boolean(perms.canDeleteMessage);
    if (permKey === 'canMute' && perms.canMuteText !== undefined) return Boolean(perms.canMuteText);
    if (permKey === 'canMuteText' && perms.canMute !== undefined) return Boolean(perms.canMute);
    if (permKey === 'canEditMemberProfile' && perms.canEditMemberData !== undefined) return Boolean(perms.canEditMemberData);
    if (permKey === 'canEditMemberData' && perms.canEditMemberProfile !== undefined) return Boolean(perms.canEditMemberProfile);
    if (permKey === 'canManagePermissions' && perms.canManageRoles !== undefined) return Boolean(perms.canManageRoles);
    if (permKey === 'canManageRoles' && perms.canManagePermissions !== undefined) return Boolean(perms.canManagePermissions);
    if (permKey === 'canDeleteAccounts' && perms.canDeleteAccount !== undefined) return Boolean(perms.canDeleteAccount);
    if (permKey === 'canDeleteAccount' && perms.canDeleteAccounts !== undefined) return Boolean(perms.canDeleteAccounts);
    if (permKey === 'canUnjail' && perms.canJail !== undefined) return Boolean(perms.canJail);
    if (permKey === 'canUnban' && perms.canBan !== undefined) return Boolean(perms.canBan);
    if (permKey === 'canLockVoice' && perms.canMuteVoice !== undefined) return Boolean(perms.canMuteVoice);
  }

  // Fallbacks for standard system roles
  if (cleanRole === 'super') {
    const superDefaults = new Set([
      'canSendText', 'canSendMedia', 'canSendVoiceNotes', 'canDeleteMessage', 'canDeleteMessages',
      'canPinMessage', 'canClearRoomChat', 'canLockRoom', 'canSetSlowMode', 'canChangeRoomSettings', 'canEditRoomBanner',
      'canTakeMic', 'canPullMic', 'canMuteVoice', 'canLockVoice', 'canStartLive',
      'canWarn', 'canMute', 'canMuteText', 'canKick', 'canTempBan', 'canBan', 'canUnban', 'canJail', 'canUnjail',
      'canEditMemberProfile', 'canEditMemberData', 'canDeleteAvatar', 'canAssignBanner', 'canAssignBadge',
      'canUseAvatarFrame', 'canUseMemberBg', 'canManageMembershipCatalog',
      'canMoveUsers', 'canAccessControlPanel', 'canFilter', 'canRevealNicks', 'canViewAuditLogs',
      'canBroadcast', 'canGhostLogin', 'canManageShortcuts', 'canChangeGlobalTheme', 'canPostWall',
      'canDeleteWallPost', 'canPrivateChat', 'canPrivateCall', 'canDeleteAccounts', 'canDeleteAccount'
    ]);
    return superDefaults.has(permKey);
  }

  if (cleanRole === 'member') {
    const memberDefaults = new Set([
      'canSendText', 'canSendMedia', 'canSendVoiceNotes', 'canTakeMic', 'canPostWall', 'canPrivateChat', 'canPrivateCall'
    ]);
    return memberDefaults.has(permKey);
  }

  if (cleanRole === 'guest') {
    return permKey === 'canSendText';
  }

  return false;
}

export function saveRolePermissions() {
  invalidateConfigVersionCache('roles');
  try {
    dataManager.saveRolePermissions(rolePermissions);
  } catch (err) {
    console.error('Error saving role permissions:', err);
  }
}

export function loadRolePermissions() {
  try {
    const parsed = dataManager.loadRolePermissionsSync<Record<string, RolePermissions>>(rolePermissions);
    if (parsed && typeof parsed === 'object') {
      Object.assign(rolePermissions, parsed);
      for (const r of ['hassan', 'admin', 'super', 'member', 'guest']) {
        if (rolePermissions[r]) {
          const isStaff = r === 'hassan' || r === 'admin' || r === 'super';
          if (rolePermissions[r].canGhostLogin === undefined) {
            rolePermissions[r].canGhostLogin = isStaff;
          }
          if (rolePermissions[r].canUseAvatarFrame === undefined) {
            rolePermissions[r].canUseAvatarFrame = isStaff;
          }
          if (rolePermissions[r].canUseMemberBg === undefined) {
            rolePermissions[r].canUseMemberBg = isStaff;
          }
          if (rolePermissions[r].canEditRoomBanner === undefined) {
            rolePermissions[r].canEditRoomBanner = isStaff;
          }
          if (rolePermissions[r].canManageMembershipCatalog === undefined) {
            rolePermissions[r].canManageMembershipCatalog = isStaff;
          }
        }
      }
    }
  } catch (err) {
    console.error('Error loading role permissions:', err);
  }
}

// Initialize and hydrate role configs and permissions from database / local storage
loadRolesConfig();
loadRolePermissions();

export interface GlobalAppearance {
  theme: string;
  fontFamily: string;
  fontWeight?: 'thin' | 'normal' | 'default' | 'bold' | 'black';
  wallpaper: string;
  bubbleStyle: string;
  bannerUrl?: string;
  logoUrl?: string;
  customThemes?: Array<{
    id: string;
    name: string;
    colors: Record<string, string>;
    createdBy?: string;
    createdAt: number;
  }>;
}

export let globalAppearance: GlobalAppearance = {
  theme: 'pearl-gray-calm',
  fontFamily: 'Cairo',
  fontWeight: 'default',
  wallpaper: 'default',
  bubbleStyle: 'modern',
  bannerUrl: '',
  logoUrl: '',
  customThemes: []
};

export let emblemsConfig: EmblemsConfig = {
  items: DEFAULT_EMBLEMS,
  emojiSize: 'default',
  falconChatBanner: DEFAULT_FALCON_CHAT_BANNER,
  falconAvatarIcon: DEFAULT_FALCON_AVATAR_ICON
};

export async function saveEmblems(): Promise<void> {
  invalidateConfigVersionCache('emblems');
  try {
    await dataManager.saveEmblems(emblemsConfig);
  } catch (err) {
    console.error('Error saving emblems:', err);
    throw err;
  }
}

export function loadEmblems() {
  try {
    const parsed = dataManager.loadEmblemsSync<EmblemsConfig>({
      items: DEFAULT_EMBLEMS,
      emojiSize: 'default',
      falconChatBanner: DEFAULT_FALCON_CHAT_BANNER,
      falconAvatarIcon: DEFAULT_FALCON_AVATAR_ICON
    });
    if (parsed && Array.isArray(parsed.items) && parsed.items.length > 0) {
      emblemsConfig = {
        items: parsed.items,
        emojiSize: parsed.emojiSize || 'default',
        falconChatBanner: parsed.falconChatBanner || DEFAULT_FALCON_CHAT_BANNER,
        falconAvatarIcon: parsed.falconAvatarIcon || DEFAULT_FALCON_AVATAR_ICON
      };
      if (emblemsConfig.falconChatBanner && !globalAppearance.bannerUrl) {
        globalAppearance.bannerUrl = emblemsConfig.falconChatBanner;
      }
      return;
    }
  } catch (err) {
    console.error('Error loading emblems:', err);
  }
  emblemsConfig = {
    items: DEFAULT_EMBLEMS,
    emojiSize: 'default',
    falconChatBanner: DEFAULT_FALCON_CHAT_BANNER,
    falconAvatarIcon: DEFAULT_FALCON_AVATAR_ICON
  };
  saveEmblems();
}

export interface GeneralWelcomeSettings {
  enabled: boolean;
  message: string;
  title: string;
}

export let generalWelcomeSettings: GeneralWelcomeSettings = {
  enabled: true,
  message: 'نحن سعداء بتشريفك فأهلاً بك عطراً فوّاحاً ينثرُ شذاه في كلّ الأرجاء .. نتمنى لك وقتاً ممتعاً 🌹',
  title: 'إدارة حسان برو'
};

export function saveGeneralWelcome() {
  invalidateConfigVersionCache('appearance');
  try {
    dataManager.saveGeneralWelcome(generalWelcomeSettings);
  } catch (err) {
    console.error('Error saving general welcome:', err);
  }
}

export function loadGeneralWelcome() {
  try {
    const parsed = dataManager.loadGeneralWelcomeSync<Partial<GeneralWelcomeSettings>>(generalWelcomeSettings);
    if (parsed && typeof parsed === 'object') {
      generalWelcomeSettings = { ...generalWelcomeSettings, ...parsed };
    }
  } catch (err) {
    console.error('Error loading general welcome:', err);
  }
}


export async function saveGlobalAppearance(): Promise<void> {
  invalidateConfigVersionCache('appearance');
  try {
    await dataManager.saveGlobalAppearance(globalAppearance);
  } catch (err) {
    console.error('Error saving global appearance:', err);
    throw err;
  }
}

export function loadGlobalAppearance() {
  try {
    const parsed = dataManager.loadGlobalAppearanceSync<Partial<GlobalAppearance>>(globalAppearance);
    if (parsed && typeof parsed === 'object') {
      globalAppearance = { ...globalAppearance, ...parsed };
      if (globalAppearance.bannerUrl && globalAppearance.bannerUrl.includes('localhost:3000')) {
        globalAppearance.bannerUrl = globalAppearance.bannerUrl.replace(/^https?:\/\/localhost:3000/i, '');
      }
    }
  } catch (err) {
    console.error('Error loading global appearance:', err);
  }
}

export interface CustomCatalogFrame {
  id: string;
  name: string;
  imageUrl: string;
  animated?: boolean;
  createdBy: string;
  createdAt: number;
}

export interface CustomCatalogBg {
  id: string;
  name: string;
  imageUrl: string;
  createdBy: string;
  createdAt: number;
}

export interface MembershipDesignCatalog {
  customFrames: CustomCatalogFrame[];
  customBgs: CustomCatalogBg[];
  deletedPresetFrameIds: string[];
  deletedPresetBgIds: string[];
}

export let membershipDesignCatalog: MembershipDesignCatalog = {
  customFrames: [],
  customBgs: [],
  deletedPresetFrameIds: [],
  deletedPresetBgIds: []
};

export async function saveMembershipDesignCatalog(): Promise<void> {
  invalidateConfigVersionCache('membershipCatalog');
  try {
    await dataManager.save('membership_design_catalog', membershipDesignCatalog);
  } catch (err) {
    console.error('Error saving membership design catalog:', err);
    throw err;
  }
}

export function loadMembershipDesignCatalog() {
  try {
    const parsed = dataManager.loadSync<Partial<MembershipDesignCatalog>>('membership_design_catalog', membershipDesignCatalog);
    if (parsed && typeof parsed === 'object') {
      membershipDesignCatalog = {
        customFrames: Array.isArray(parsed.customFrames) ? parsed.customFrames : [],
        customBgs: Array.isArray(parsed.customBgs) ? parsed.customBgs : [],
        deletedPresetFrameIds: Array.isArray(parsed.deletedPresetFrameIds) ? parsed.deletedPresetFrameIds : [],
        deletedPresetBgIds: Array.isArray(parsed.deletedPresetBgIds) ? parsed.deletedPresetBgIds : []
      };
    }
  } catch (err) {
    console.error('Error loading membership design catalog:', err);
  }
}
loadMembershipDesignCatalog();

function unlinkCatalogUploadIfUnused(url?: string) {
  if (!url || typeof url !== 'string' || !url.startsWith('/uploads/')) return;
  const stillReferencedInCatalog =
    membershipDesignCatalog.customFrames.some((f) => f.imageUrl === url) ||
    membershipDesignCatalog.customBgs.some((b) => b.imageUrl === url);
  if (stillReferencedInCatalog) return;
  const resolvedUploadsDir = path.resolve(uploadsDir);
  const safePath = path.resolve(resolvedUploadsDir, path.basename(url));
  if (safePath.startsWith(resolvedUploadsDir + path.sep) && fs.existsSync(safePath)) {
    try {
      fs.unlinkSync(safePath);
    } catch {}
  }
}

// Unified Chat Quality & Weak-Internet Adaptation Settings (إعدادات الجودة والتكيّف مع الإنترنت الضعيف)
export let chatQualitySettings: ChatQualitySettings = { ...DEFAULT_CHAT_QUALITY_SETTINGS };

export async function saveChatQualitySettings(): Promise<void> {
  invalidateConfigVersionCache('quality');
  try {
    await dataManager.save('chat_quality_settings', chatQualitySettings);
  } catch (err) {
    console.error('Error saving chat quality settings:', err);
  }
}

export function loadChatQualitySettings() {
  try {
    const parsed = dataManager.loadSync<Partial<ChatQualitySettings>>('chat_quality_settings', chatQualitySettings);
    if (parsed && typeof parsed === 'object') {
      chatQualitySettings = clampChatQualitySettings(parsed, DEFAULT_CHAT_QUALITY_SETTINGS);
      dataManager.setBatchWriteIntervalMs(chatQualitySettings.dbBatchWriteMs);
    }
  } catch (err) {
    console.error('Error loading chat quality settings:', err);
  }
}
loadChatQualitySettings();

// Ultra-Fast Initial Appearance Endpoint: Delivers approved banner, logo, wallpaper and theme instantly on page boot
app.get('/api/initial-appearance', (_req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=15, stale-while-revalidate=60');
  const banner = globalAppearance.bannerUrl || emblemsConfig.falconChatBanner || DEFAULT_FALCON_CHAT_BANNER;
  const logo = globalAppearance.logoUrl || emblemsConfig.falconAvatarIcon || DEFAULT_FALCON_AVATAR_ICON;
  res.json({
    success: true,
    bannerUrl: banner,
    logoUrl: logo,
    theme: globalAppearance.theme || 'dark-gold',
    fontFamily: globalAppearance.fontFamily || 'Cairo',
    fontWeight: globalAppearance.fontWeight || 'default',
    wallpaper: globalAppearance.wallpaper || 'default',
    bubbleStyle: globalAppearance.bubbleStyle || 'modern',
    generalWelcome: generalWelcomeSettings,
    marqueeTicker: serverSecurity.marqueeTicker,
    rolesConfig: rolesConfig,
    rolePermissions: rolePermissions,
    likesSettings: likesSettings,
    chatQualitySettings
  });
});

// Save / Load Functions
export function saveMonitoredWords() {
  try {
    dataManager.saveMonitoredWords(monitoredWords);
    if (!dataManager.isCloudConnected()) {
      const localDir = process.env.DATA_DIR || process.env.RAILWAY_VOLUME_MOUNT_PATH || path.join(__dirname);
      const localFile = path.join(localDir, 'monitored_words.json');
      fs.writeFileSync(localFile, JSON.stringify(monitoredWords, null, 2), 'utf8');
    }
  } catch (err) {
    console.error('Error saving monitored words:', err);
  }
}

export function loadMonitoredWords() {
  try {
    const parsed = dataManager.loadMonitoredWordsSync<string[]>(monitoredWords);
    if (Array.isArray(parsed) && parsed.length > 0) {
      // Merge unique words while preserving custom admin additions
      const set = new Set([...monitoredWords, ...parsed]);
      monitoredWords = Array.from(set);
    }
  } catch (err) {
    console.error('Error loading monitored words:', err);
  }
}

export function saveServerSecurity() {
  invalidateConfigVersionCache('serverSecurity');
  try {
    dataManager.saveServerSecurity(serverSecurity);
  } catch (err) {
    console.error('Error saving server security:', err);
  }
}

export function loadServerSecurity() {
  try {
    const parsed = dataManager.loadServerSecuritySync<Partial<ServerSecuritySettings>>(serverSecurity);
    if (parsed && typeof parsed === 'object') {
      serverSecurity = { ...serverSecurity, ...parsed };
    }
  } catch (err) {
    console.error('Error loading server security:', err);
  }
}

export function saveLikesSettings() {
  invalidateConfigVersionCache('appearance');
  try {
    dataManager.saveLikesSettings(likesSettings);
  } catch (err) {
    console.error('Error saving likes settings:', err);
  }
}

export function loadLikesSettings() {
  try {
    const parsed = dataManager.loadLikesSettingsSync<Partial<LikesThresholdSettings>>(likesSettings);
    if (parsed && typeof parsed === 'object') {
      likesSettings = { ...likesSettings, ...parsed };
    }
  } catch (err) {
    console.error('Error loading likes settings:', err);
  }
}

export function saveStaffMemos() {
  try {
    dataManager.saveStaffMemos(staffMemos);
  } catch (err) {
    console.error('Error saving staff memos:', err);
  }
}

export function loadStaffMemos() {
  try {
    const parsed = dataManager.loadStaffMemosSync<StaffMemo[]>(staffMemos);
    if (Array.isArray(parsed) && parsed.length > 0) {
      staffMemos = parsed;
    }
  } catch (err) {
    console.error('Error loading staff memos:', err);
  }
}

// Rooms list (Matching Screenshot 3 + Jail Room)
let chatRooms: ChatRoom[] = [
  { id: 'الغرفة العامة', name: 'الغرفة العامة Room (الرئيسية)', desc: 'ملتقى جميع الأعضاء والزوار', isPasswordProtected: false, voiceLimit: 33, activeVoiceCount: 0 },
  { id: 'السعودية', name: 'Room | السعودية', desc: 'فديتك ياااا السعودية 🇸🇦', isPasswordProtected: false, voiceLimit: 33, activeVoiceCount: 0 },
  { id: 'العراق', name: 'Room | العراق', desc: 'حياكم روم العراق 🇮🇶', isPasswordProtected: false, voiceLimit: 20, activeVoiceCount: 0 },
  { id: 'المسابقات', name: 'Room | المسابقات', desc: 'اكتب مسابقات وابدأ اللعب 🎯🔥', isPasswordProtected: false, voiceLimit: 40, activeVoiceCount: 0 },
  { id: 'خاص vip', name: 'غرفة VIP خاصة 🔒', desc: 'غرفة خاصة لكبار الشخصيات', isPasswordProtected: true, password: 'vip', voiceLimit: 10, activeVoiceCount: 0 },
  { id: 'صوت حسان برو', name: 'مجلس الصوت المباشر 🎙️', desc: 'صوت جماعي عالي النقاء', isPasswordProtected: false, voiceLimit: 30, activeVoiceCount: 0 },
  { id: 'سجن حسان برو', name: '🚔 سجن واحتجاز حسان برو', desc: 'غرفة توقيف المخالفين بقرار إداري صارم', isPasswordProtected: true, password: 'jail', voiceLimit: 50, activeVoiceCount: 0 }
];

export function saveChatRooms() {
  try {
    dataManager.saveChatRooms(chatRooms);
  } catch (err) {
    console.error('Error saving chat rooms:', err);
  }
}

export function loadChatRooms() {
  try {
    const parsed = dataManager.loadChatRoomsSync<ChatRoom[]>(chatRooms);
    if (Array.isArray(parsed) && parsed.length > 0) {
      chatRooms = parsed;
    }
  } catch (err) {
    console.error('Error loading chat rooms:', err);
  }
}

export function saveRoomSettings() {
  try {
    dataManager.saveRoomSettings(roomSettingsMap);
  } catch (err) {
    console.error('Error saving room settings:', err);
  }
}

export function loadRoomSettings() {
  try {
    const parsed = dataManager.loadRoomSettingsSync<Record<string, RoomSettings>>(roomSettingsMap);
    if (parsed && typeof parsed === 'object') {
      Object.assign(roomSettingsMap, parsed);
    }
  } catch (err) {
    console.error('Error loading room settings:', err);
  }
}

export function findRoomDefinition(roomInput?: string): ChatRoom | undefined {
  const clean = typeof roomInput === 'string' ? sanitizeText(roomInput) : '';
  if (!clean) return undefined;
  const lower = clean.toLowerCase();
  return (
    chatRooms.find((r) => r.id === clean) ||
    chatRooms.find((r) => r.id.trim().toLowerCase() === lower) ||
    chatRooms.find((r) => r.name.trim().toLowerCase() === lower)
  );
}

export function resolveCanonicalRoomId(roomInput?: string): string | null {
  const clean = typeof roomInput === 'string' ? sanitizeText(roomInput) : '';
  if (!clean) return null;
  if (clean === 'خارج الغرف') return 'خارج الغرف';
  const found = findRoomDefinition(clean);
  return found ? found.id : null;
}

// Server Security & Anti-Raid System
export interface ServerSecuritySettings {
  emergencyLockdown: boolean;
  guestsAllowed: boolean;
  blockExternalLinks: boolean;
  floodControlRate: number; // Max messages per 5 seconds
  marqueeTicker: string;
  // Automated IP Ban based on Filter Violations
  autoIpBanEnabled: boolean;
  autoIpBanThreshold: number; // e.g. 3 violations
  autoIpBanWindowMinutes: number; // e.g. within 10 minutes
  autoIpBanDurationMinutes: number; // 0 = permanent, 15, 60, 360, 1440, 10080 minutes
  // Geographic Access Restrictions
  geoRestrictionEnabled: boolean;
  geoRestrictionMode: 'blacklist' | 'whitelist';
  geoRestrictedCountries: string[]; // List of ISO country codes (e.g. ['YE', 'EG', 'SA']) or flag emojis
  geoBlockedCustomMessage: string;
  // Configurable Timeouts & Grace Periods (إعدادات المهلات وأوقات الانتظار)
  offlineGraceSeconds?: number; // مهلة انقطاع النت قبل اعتبار العضو غير متصل (نقطة رمادية)
  micGraceSeconds?: number; // مهلة الاحتفاظ بمقعد المايك عند انقطاع الاتصال
  awayDelaySeconds?: number; // مهلة التحول للحالة الصفراء (غائب) عند التشغيل في الخلفية
  reconnectBannerDelaySeconds?: number; // مهلة الانتظار قبل إظهار شريط إعادة الاتصال
  likeCooldownSeconds?: number; // مهلة الانتظار بين الإعجابات للعضو الواحد
}

let serverSecurity: ServerSecuritySettings = {
  emergencyLockdown: false,
  guestsAllowed: true,
  blockExternalLinks: true,
  floodControlRate: 3,
  marqueeTicker: '🦅 مرحباً بكم في حسان برو | شات العرب الصوتي والكتابي الأرقى | أهلاً وسهلاً بجميع الإخوة والأخوات 🌹',
  autoIpBanEnabled: true,
  autoIpBanThreshold: 3,
  autoIpBanWindowMinutes: 10,
  autoIpBanDurationMinutes: 60,
  geoRestrictionEnabled: false,
  geoRestrictionMode: 'blacklist',
  geoRestrictedCountries: [],
  geoBlockedCustomMessage: '🚫 نعتذر، الدخول غير متاح حالياً من منطقتك الجغرافية وفقاً لسياسة الأمان المتبعة في الدردشة.',
  offlineGraceSeconds: 300,
  micGraceSeconds: 90,
  awayDelaySeconds: 120,
  reconnectBannerDelaySeconds: 10,
  likeCooldownSeconds: 60
};

function getPublicServerSecurity(sec: ServerSecuritySettings) {
  return {
    marqueeTicker: sec.marqueeTicker,
    guestsAllowed: sec.guestsAllowed,
    emergencyLockdown: sec.emergencyLockdown,
    blockExternalLinks: sec.blockExternalLinks,
    awayDelaySeconds: sec.awayDelaySeconds,
    reconnectBannerDelaySeconds: sec.reconnectBannerDelaySeconds
  };
}

// Staff Internal Memos & Notice Board
export interface StaffMemo {
  id: string;
  author: string;
  role: string;
  text: string;
  priority: 'low' | 'normal' | 'urgent';
  timestamp: number;
  timeFormatted: string;
}

let staffMemos: StaffMemo[] = [
  {
    id: 'memo-1',
    author: 'المدير العام',
    role: 'admin',
    text: 'الرجاء مراقبة غرفة المسابقات الليلة الساعة 9:00 مساءً لوجود فعاليات وتوزيع جوائز ومكافآت.',
    priority: 'urgent',
    timestamp: Date.now() - 3600000,
    timeFormatted: 'اليوم 08:30 م'
  },
  {
    id: 'memo-2',
    author: '★ ﺟﻨﺘﻞ ★',
    role: 'admin',
    text: 'تم حظر مستخدم كان يكرر نشر روابط إعلانات مخالفة على الخاص والتأكد من هدوء الغرف.',
    priority: 'normal',
    timestamp: Date.now() - 7200000,
    timeFormatted: 'اليوم 06:15 م'
  }
];

// Initialize all loaded configurations from Data Layer
loadMonitoredWords();
loadServerSecurity();
loadLikesSettings();
loadMessageRetentionLimits();
loadStaffMemos();
loadChatRooms();
loadRoomSettings();
loadRolePermissions();
loadGlobalAppearance();
loadGeneralWelcome();
loadEmblems();


// Note: Hydration of all collections is managed centrally via dataManager.onHydrated()


// Monitoring events buffer & persistent audit log via Data Layer (تظل محفوظة بشكل دائم حتى المسح اليدوي من الإدارة)
let monitorLogs: MonitorEvent[] = [];
let auditSaveTimer: NodeJS.Timeout | null = null;
function saveAuditLogs(immediate = false) {
  if (immediate) {
    if (auditSaveTimer) {
      clearTimeout(auditSaveTimer);
      auditSaveTimer = null;
    }
    try {
      dataManager.saveAuditLogs(monitorLogs.slice(0, 10000));
      if (!dataManager.isCloudConnected()) {
        const localDir = process.env.DATA_DIR || process.env.RAILWAY_VOLUME_MOUNT_PATH || path.join(__dirname);
        const localFile = path.join(localDir, 'admin_audit_logs.json');
        fs.writeFileSync(localFile, JSON.stringify(monitorLogs.slice(0, 10000), null, 2), 'utf8');
      }
    } catch (err) {
      console.error('Error saving persistent audit logs immediately:', err);
    }
    return;
  }
  if (auditSaveTimer) return;
  auditSaveTimer = setTimeout(() => {
    auditSaveTimer = null;
    try {
      dataManager.saveAuditLogs(monitorLogs.slice(0, 10000));
      if (!dataManager.isCloudConnected()) {
        const localDir = process.env.DATA_DIR || process.env.RAILWAY_VOLUME_MOUNT_PATH || path.join(__dirname);
        const localFile = path.join(localDir, 'admin_audit_logs.json');
        fs.writeFileSync(localFile, JSON.stringify(monitorLogs.slice(0, 10000), null, 2), 'utf8');
      }
    } catch (err) {
      console.error('Error saving persistent audit logs:', err);
    }
  }, 1000);
}

function loadAuditLogs() {
  try {
    const data = dataManager.loadAuditLogsSync<MonitorEvent[]>([]);
    if (Array.isArray(data)) {
      monitorLogs = data.slice(0, 10000);
      return;
    }
  } catch (err) {
    console.error('Error loading persistent audit logs:', err);
  }
  monitorLogs = [];
}
loadAuditLogs();

function logMonitorEvent(type: MonitorEvent['type'], description: string, actor: string, target?: string) {
  const event: MonitorEvent = {
    id: `log-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
    type,
    description,
    actor,
    target,
    time: new Date().toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    timestamp: Date.now()
  };
  monitorLogs.unshift(event);
  if (monitorLogs.length > 10000) monitorLogs.pop();
  saveAuditLogs();

  // Optimized Socket Payload: Only stream live audit logs to active admin/super/hassan staff
  users.forEach((u) => {
    if (isStaffUser(u)) {
      io.to(u.id).emit('monitorEvent', event);
    }
  });
}

// Profile Visitor Record structure (من نقر على صورتي وشاهد ملفي الشخصي وعدد المرات)
export interface ProfileVisitorRecord {
  username: string;
  displayName?: string;
  avatarUrl?: string;
  flag?: string;
  visitCount: number;
  lastVisitTime: number;
}

// Live Video Broadcast Session Structure (بث مباشر فيديو وصوت حقيقي للغرفة)
export interface RoomLiveBroadcast {
  broadcasterId: string;
  broadcasterUsername: string;
  broadcasterDisplayName?: string;
  broadcasterAvatar?: string;
  broadcasterFlag?: string;
  room: string;
  title: string;
  startedAt: number;
  viewers: string[];
}

// Global Active Live Broadcasts Map by room
const activeLiveBroadcasts: Map<string, RoomLiveBroadcast> = new Map();

function serializeLiveBroadcast(live: RoomLiveBroadcast | undefined) {
  if (!live) return null;
  return {
    broadcasterId: live.broadcasterId,
    broadcasterUsername: live.broadcasterUsername,
    broadcasterDisplayName: live.broadcasterDisplayName || live.broadcasterUsername,
    broadcasterAvatar: live.broadcasterAvatar,
    broadcasterFlag: live.broadcasterFlag,
    room: live.room,
    title: live.title,
    startedAt: live.startedAt,
    viewersCount: live.viewers.length
  };
}

function cleanupUserLiveState(socketId: string, onlyRoom?: string) {
  if (!socketId) return;
  for (const [rId, live] of Array.from(activeLiveBroadcasts.entries())) {
    if (onlyRoom && rId !== onlyRoom) continue;
    if (live.broadcasterId === socketId) {
      activeLiveBroadcasts.delete(rId);
      io.to(rId).emit('liveBroadcastEnded', {
        room: rId,
        broadcasterUsername: live.broadcasterUsername
      });
    } else if (live.viewers.includes(socketId)) {
      live.viewers = live.viewers.filter((id) => id !== socketId);
      io.to(rId).emit('liveViewerCountUpdated', {
        room: rId,
        count: live.viewers.length
      });
      if (live.broadcasterId) {
        io.to(live.broadcasterId).emit('liveViewerLeft', { viewerId: socketId });
      }
    }
  }
}

// Registered members store structure
export interface RegisteredMemberInfo {
  password: string;
  originalUsername?: string; // الاسم الأصلي الذي سجّل به العضو العضوية أول مرة (ثابت حتى لو تغيّر الاسم أو الزخرفة)
  registeredAt?: number; // وقت تسجيل العضوية لأول مرة لتمييز العضوية الأصلية الأقدم
  displayName?: string; // الزخرفة واسم العرض القابل للتعديل من الضبط بينما يبقى اسم التسجيل الأصلي ثابتاً للدخول
  role: 'hassan' | 'admin' | 'super' | 'member' | 'guest' | string;
  flag: string;
  flagNumber?: number;
  flagNumbersByFlag?: Record<string, number>;
  statusQuote: string;
  avatarUrl?: string;
  avatarFrame?: string;
  likes: number;
  points: number;
  honorBadge?: string;
  ipAddress?: string;
  ipHistory?: string[]; // All real IPs this member has logged in with (سجل جميع الايبيهات الحقيقية)
  deviceInfo?: string;
  deviceHistory?: string[]; // All devices used by this member
  deviceFingerprint?: string;
  fingerprintHistory?: string[]; // All device fingerprints associated with this account (e.g. mobile + desktop mode)
  nameColor?: string;
  textColor?: string;
  nameGradient?: string;
  profileBg?: string;
  memberBg?: string;
  theme?: string;
  fontFamily?: string;
  wallpaper?: string;
  bubbleStyle?: string;
  nameBannerUrl?: string; // رابط البنر / السوابر المصور للعضو بمقاس 500x50
  giftBadges?: string[]; // قائمة أيقونات الهدايا والأوسمة التكريمية بجانب الاسم
  isPmDisabled?: boolean;
  isIncognito?: boolean;
  isJailed?: boolean;
  isBot?: boolean;
  lastSeen?: number;
  visitors?: ProfileVisitorRecord[];
  engagement?: MemberEngagement;
  // Permanent user state synced with MongoDB
  ignoredUsers?: string[];
  starredMessages?: Array<{ id: string; username: string; text: string; time: string }>;
  friends?: string[];
  tokenVersion?: number;
}

function getEnvAdminPassword(): string {
  return (process.env.ADMIN_PASSWORD || '').trim();
}

const initialEnvAdminPass = getEnvAdminPassword();
const registeredMembers: Record<string, RegisteredMemberInfo> = {
  'admin': {
    password: initialEnvAdminPass ? hashPassword(initialEnvAdminPass) : '',
    role: 'hassan',
    flag: '👑',
    statusQuote: 'مدير عام شات حسان برو 🦅',
    avatarUrl: '',
    likes: 10000,
    points: 2000000,
    honorBadge: '👑 المدير التنفيذي',
    nameBannerUrl: '',
    giftBadges: [],
    ipAddress: '127.0.0.1',
    deviceInfo: 'كمبيوتر / هاتف ذكي',
    deviceFingerprint: 'FP-ADMIN-ORIGIN',
    tokenVersion: 1,
    engagement: {
      activeTimeMinutes: 120,
      messagesSent: 50,
      wallPostsCount: 10,
      micTimeMinutes: 45,
      starsLevel: 5,
      progressPercent: 100
    }
  }
};

function syncAdminEnvPassword() {
  const envPass = getEnvAdminPassword();
  if (registeredMembers['admin']) {
    registeredMembers['admin'].role = 'hassan';
    if (envPass) {
      registeredMembers['admin'].password = hashPassword(envPass);
    }
  }
}

function isAdminClaimRequired(): boolean {
  if (getEnvAdminPassword().length > 0) return false;
  const adminEntry = getRegisteredMember('admin')?.member;
  return !adminEntry || !adminEntry.password;
}

// Self-healing O(1) lowercase index for registeredMembers
const regMemberLowerKeyMap = new Map<string, string>();

export function getRegisteredMember(username?: string): { key: string; member: RegisteredMemberInfo } | null {
  if (!username) return null;
  const clean = username.trim();
  if (registeredMembers[clean]) {
    regMemberLowerKeyMap.set(clean.toLowerCase(), clean);
    return { key: clean, member: registeredMembers[clean] };
  }
  const lower = clean.toLowerCase();
  const cachedKey = regMemberLowerKeyMap.get(lower);
  if (cachedKey && registeredMembers[cachedKey]) {
    return { key: cachedKey, member: registeredMembers[cachedKey] };
  }
  for (const k of Object.keys(registeredMembers)) {
    if (k.toLowerCase() === lower) {
      regMemberLowerKeyMap.set(lower, k);
      return { key: k, member: registeredMembers[k] };
    }
  }
  regMemberLowerKeyMap.delete(lower);
  return null;
}

export function getRegisteredMemberByDisplayName(displayName?: string): { key: string; member: RegisteredMemberInfo } | null {
  if (!displayName) return null;
  const lower = displayName.trim().toLowerCase();
  if (!lower) return null;
  for (const [k, member] of Object.entries(registeredMembers)) {
    if (member.displayName && member.displayName.trim().toLowerCase() === lower && k.toLowerCase() !== lower) {
      return { key: k, member };
    }
  }
  return null;
}

export function getRegisteredMemberByOriginalUsername(originalName?: string): { key: string; member: RegisteredMemberInfo } | null {
  if (!originalName) return null;
  const lower = originalName.trim().toLowerCase();
  if (!lower) return null;
  for (const [k, member] of Object.entries(registeredMembers)) {
    if (member.originalUsername && member.originalUsername.trim().toLowerCase() === lower) {
      return { key: k, member };
    }
  }
  return null;
}

export function resolveUserDisplayName(username?: string, fallbackDisplayName?: string): string {
  if (!username) return fallbackDisplayName || '';
  const lower = username.trim().toLowerCase();
  const live = users.find((u) => u.username.toLowerCase() === lower);
  const reg = getRegisteredMember(username)?.member;
  return live?.displayName || reg?.displayName || fallbackDisplayName || username;
}

function getPresenceSnapshot(): ConnectedUser[] {
  const byUsername = new Map<string, ConnectedUser>();
  for (const user of users) {
    const key = user.username.trim().toLowerCase();
    const existing = byUsername.get(key);
    if (!existing || (user.lastActiveTime || 0) >= (existing.lastActiveTime || 0)) {
      byUsername.set(key, user);
    }
  }
  return Array.from(byUsername.values());
}

export function getAllRegisteredMembersPayload(
  viewerLevel: number = 0,
  viewerSocketId?: string,
  viewerRole?: string,
  precomputedPresenceMap?: Map<string, ConnectedUser>
) {
  if (viewerLevel <= 0 && !viewerSocketId) return [];
  const recipientUser = viewerSocketId ? findSocketUser(viewerSocketId) : undefined;
  const effectiveLevel = recipientUser ? getRoleLevel(recipientUser.role) : viewerLevel;
  const effectiveRole = recipientUser?.role || viewerRole || '';
  if (!recipientUser && effectiveLevel <= 0) return [];

  const canViewSensitivePii = Boolean(
    effectiveLevel >= 75 ||
    (effectiveRole && (
      effectiveRole === 'hassan' ||
      effectiveRole === 'admin' ||
      effectiveRole === 'super' ||
      hasPermission(effectiveRole, 'canAccessControlPanel') ||
      hasPermission(effectiveRole, 'canRevealNicks')
    ))
  );

  // Build O(1) presence lookup map once per call instead of O(R * C) linear scans
  let presenceByLower = precomputedPresenceMap;
  if (!presenceByLower) {
    presenceByLower = new Map<string, ConnectedUser>();
    for (const u of getPresenceSnapshot()) {
      presenceByLower.set(u.username.trim().toLowerCase(), u);
    }
  }

  const recipientLower = recipientUser ? recipientUser.username.trim().toLowerCase() : '';
  const nowTs = Date.now();
  const entries = Object.entries(registeredMembers);
  const result = new Array(entries.length);

  for (let i = 0; i < entries.length; i++) {
    const [username, m] = entries[i];
    const lowerName = username.trim().toLowerCase();
    const onlineUser = presenceByLower.get(lowerName);
    const isSelf = Boolean(
      (onlineUser && viewerSocketId && onlineUser.id === viewerSocketId) ||
      (recipientLower && recipientLower === lowerName)
    );
    const isGhostTarget = Boolean(onlineUser?.isGhost);
    const ghostLevel = onlineUser ? getRoleLevel(onlineUser.role) : getRoleLevel(m.role);
    const canSeeGhost = isSelf || effectiveLevel >= ghostLevel;
    const isVisibleOnline = Boolean(onlineUser && (!isGhostTarget || canSeeGhost));

    const presenceState: 'online' | 'away' | 'offline' = isVisibleOnline ? (onlineUser!.presenceState || 'online') : 'offline';
    const includePii = canViewSensitivePii || isSelf;
    const allIps = includePii
      ? Array.from(new Set([
          ...(onlineUser?.ipAddress && onlineUser.ipAddress !== '192.168.1.100' ? [onlineUser.ipAddress] : []),
          ...(m.ipAddress && m.ipAddress !== '192.168.1.100' ? [m.ipAddress] : []),
          ...(Array.isArray(m.ipHistory) ? m.ipHistory.filter((ip) => ip && ip !== '192.168.1.100') : [])
        ]))
      : [];

    const primaryIp = onlineUser?.ipAddress || m.ipAddress || allIps[0] || '';
    const primaryFp = onlineUser?.deviceFingerprint || m.deviceFingerprint || '';
    const mStatus = findActiveMuteMatch(username, primaryIp, primaryFp);

    result[i] = {
      username,
      displayName: onlineUser?.displayName || m.displayName || username,
      role: m.role,
      flag: m.flag,
      flagNumber: onlineUser?.flagNumber || m.flagNumber || m.flagNumbersByFlag?.[m.flag || '🇾🇪'] || assignOrGetFlagNumber(username, m.flag || '🇾🇪'),
      statusQuote: m.statusQuote || 'عضو في حسان برو',
      avatarUrl: onlineUser?.avatarUrl ?? m.avatarUrl,
      avatarFrame: onlineUser?.avatarFrame ?? m.avatarFrame ?? '',
      memberBg: onlineUser?.memberBg ?? m.memberBg ?? onlineUser?.profileBg ?? m.profileBg ?? '',
      profileBg: onlineUser?.profileBg ?? m.profileBg ?? m.memberBg ?? '',
      likes: m.likes || 0,
      points: m.points || 0,
      honorBadge: m.honorBadge,
      nameBannerUrl: onlineUser?.nameBannerUrl || m.nameBannerUrl || '',
      giftBadges: onlineUser?.giftBadges || m.giftBadges || [],
      ...(includePii ? {
        ipAddress: primaryIp || 'غير متوفر',
        ipHistory: allIps,
        deviceInfo: onlineUser?.deviceInfo || m.deviceInfo || 'جهاز ذكي',
        deviceFingerprint: primaryFp || 'FP-DEV-DEFAULT'
      } : {
        ipHistory: [] as string[]
      }),
      isTextMuted: Boolean(onlineUser?.isTextMuted || m.isJailed || mStatus.muteText),
      isVoiceMutedByAdmin: Boolean(onlineUser?.isVoiceMutedByAdmin || m.isJailed || mStatus.muteVoice),
      isJailed: Boolean(m.isJailed || jailedUsernames.has(lowerName)),
      isPmDisabled: Boolean(onlineUser?.isPmDisabled ?? m.isPmDisabled),
      isOnline: Boolean(isVisibleOnline && presenceState !== 'offline'),
      isGhost: isVisibleOnline && isGhostTarget ? true : undefined,
      presenceState,
      currentRoom: isVisibleOnline ? onlineUser!.room : 'خارج الغرف',
      lastSeen: isVisibleOnline ? nowTs : (m.lastSeen || nowTs - 3600000),
      engagement: m.engagement || getDefaultEngagement()
    };
  }
  return result;
}

let pendingRegMembersTimer: NodeJS.Timeout | null = null;
function executeBroadcastAllRegisteredMembers() {
  const allPresence = getPresenceSnapshot();
  const presenceMap = new Map<string, ConnectedUser>();
  for (const u of allPresence) {
    presenceMap.set(u.username.trim().toLowerCase(), u);
  }
  const socketToUser = new Map<string, ConnectedUser>();
  for (const u of users) socketToUser.set(u.id, u);
  for (const [sid, au] of adminPanelUsers.entries()) socketToUser.set(sid, au);

  const sharedPublicMembers = getAllRegisteredMembersPayload(10, undefined, 'member', presenceMap);
  const sharedStaffMembers = getAllRegisteredMembersPayload(100, undefined, 'admin', presenceMap);
  const sharedPublicSig = computeVersionHash(sharedPublicMembers);
  const sharedStaffSig = computeVersionHash(sharedStaffMembers);

  for (const [socketId, s] of io.sockets.sockets.entries()) {
    const recipient = socketToUser.get(socketId);
    if (!recipient) continue;
    const viewerLevel = getRoleLevel(recipient.role);
    const canSeeStaffPii = Boolean(
      viewerLevel >= 75 ||
      recipient.role === 'hassan' ||
      recipient.role === 'admin' ||
      recipient.role === 'super' ||
      hasPermission(recipient.role, 'canAccessControlPanel') ||
      hasPermission(recipient.role, 'canRevealNicks')
    );
    const hasGhostVisible = Boolean(recipient.isGhost && presenceMap.get(recipient.username.trim().toLowerCase())?.id === socketId);
    if (hasGhostVisible) {
      const customPayload = getAllRegisteredMembersPayload(viewerLevel, socketId, recipient.role, presenceMap);
      const customSig = computeVersionHash(customPayload);
      if (lastRegMembersSigBySocket.get(s) !== customSig) {
        lastRegMembersSigBySocket.set(s, customSig);
        s.emit('allRegisteredMembers', customPayload);
      }
    } else {
      const sig = canSeeStaffPii ? sharedStaffSig : sharedPublicSig;
      if (lastRegMembersSigBySocket.get(s) !== sig) {
        lastRegMembersSigBySocket.set(s, sig);
        s.emit('allRegisteredMembers', canSeeStaffPii ? sharedStaffMembers : sharedPublicMembers);
      }
    }
  }
}

export function broadcastAllRegisteredMembers() {
  const delayMs = Math.max(0, Math.min(300, chatQualitySettings.broadcastThrottleMs || 0));
  if (delayMs === 0) {
    executeBroadcastAllRegisteredMembers();
    return;
  }
  if (pendingRegMembersTimer) return;
  pendingRegMembersTimer = setTimeout(() => {
    pendingRegMembersTimer = null;
    executeBroadcastAllRegisteredMembers();
  }, delayMs);
}

// Connected live users store (الأعضاء الفعليون المتواجدون فقط بدون وهمي)
const users: ConnectedUser[] = [];
// Auxiliary sockets opened in standalone /admin tabs so they never displace active chat tabs
const adminPanelUsers = new Map<string, ConnectedUser>();

export function findSocketUser(socketId: string): ConnectedUser | undefined {
  return users.find((u) => u.id === socketId) || adminPanelUsers.get(socketId);
}

// Strip sensitive auth token & private device PII before broadcasting user lists
function toPublicConnectedUser(
  u: ConnectedUser,
  options: { includePii?: boolean; includeSelfToken?: boolean } = {}
): ConnectedUser {
  const { includePii = false, includeSelfToken = false } = options;
  const {
    sessionToken,
    ipAddress,
    ip,
    deviceInfo,
    deviceFingerprint,
    ...publicFields
  } = u;
  return {
    ...publicFields,
    ...(includeSelfToken && sessionToken ? { sessionToken } : {}),
    ...(includePii
      ? {
          ...(ipAddress ? { ipAddress } : {}),
          ...(ip ? { ip } : {}),
          ...(deviceInfo ? { deviceInfo } : {}),
          ...(deviceFingerprint ? { deviceFingerprint } : {})
        }
      : {})
  };
}

const pendingRoomBroadcastTimers = new Map<string, NodeJS.Timeout>();
let pendingAllUsersTimer: NodeJS.Timeout | null = null;
const lastRegMembersSigBySocket = new WeakMap<any, string>();
const lastAllUsersSigBySocket = new WeakMap<any, string>();
const lastOnlineCountBySocket = new WeakMap<any, number>();

function executeBroadcastRoomUsers(room: string) {
  if (!room) return;
  const roomUsersList = users.filter((u) => u.room === room);
  const socketsInRoom = io.sockets.adapter.rooms.get(room);
  if (!socketsInRoom) return;

  const roomUserById = new Map<string, ConnectedUser>();
  for (const u of roomUsersList) {
    roomUserById.set(u.id, u);
  }

  for (const socketId of socketsInRoom) {
    const s = io.sockets.sockets.get(socketId);
    if (!s) continue;
    const recipient = roomUserById.get(socketId) || findSocketUser(socketId);
    const viewerLevel = recipient ? getRoleLevel(recipient.role) : 0;
    const viewerIsStaff = Boolean(recipient && isStaffUser(recipient));
    const filtered = roomUsersList
      .filter((u) => {
        if (!u.isGhost) return true;
        if (u.id === socketId) return true; // Self can always see themselves
        const targetGhostLevel = getRoleLevel(u.role);
        return viewerLevel >= targetGhostLevel;
      })
      .map((u) => toPublicConnectedUser(u, { includePii: viewerIsStaff || u.id === socketId }));
    s.emit('roomUsers', {
      room,
      users: filtered
    });
  }
}

// Broadcast room users with Ghost login privacy filtering, PII sanitization, & burst coalescing:
export function broadcastRoomUsers(room: string) {
  if (!room) return;
  const delayMs = Math.max(0, Math.min(300, chatQualitySettings.broadcastThrottleMs || 0));
  if (delayMs === 0) {
    executeBroadcastRoomUsers(room);
    return;
  }
  if (pendingRoomBroadcastTimers.has(room)) return;
  const timer = setTimeout(() => {
    pendingRoomBroadcastTimers.delete(room);
    executeBroadcastRoomUsers(room);
  }, delayMs);
  pendingRoomBroadcastTimers.set(room, timer);
}

function executeBroadcastAllUsers() {
  const allPresence = getPresenceSnapshot();
  const presenceMap = new Map<string, ConnectedUser>();
  for (const u of allPresence) {
    presenceMap.set(u.username.trim().toLowerCase(), u);
  }
  const socketToUser = new Map<string, ConnectedUser>();
  for (const u of users) socketToUser.set(u.id, u);
  for (const [sid, au] of adminPanelUsers.entries()) socketToUser.set(sid, au);

  // Precompute shared public/staff member list snapshots once per broadcast tick to avoid O(N^2) allocations
  const sharedPublicMembers = getAllRegisteredMembersPayload(10, undefined, 'member', presenceMap);
  const sharedStaffMembers = getAllRegisteredMembersPayload(100, undefined, 'admin', presenceMap);
  const sharedPublicSig = computeVersionHash(sharedPublicMembers);
  const sharedStaffSig = computeVersionHash(sharedStaffMembers);

  for (const [socketId, s] of io.sockets.sockets.entries()) {
    const recipient = socketToUser.get(socketId);
    const viewerLevel = recipient ? getRoleLevel(recipient.role) : 0;
    const viewerIsStaff = Boolean(recipient && isStaffUser(recipient));
    const filtered = allPresence
      .filter((u) => {
        if (!u.isGhost) return true;
        if (u.id === socketId) return true; // Self can always see themselves
        const targetGhostLevel = getRoleLevel(u.role);
        return viewerLevel >= targetGhostLevel;
      })
      .map((u) => toPublicConnectedUser(u, { includePii: viewerIsStaff || u.id === socketId }));

    const allUsersSig = computeVersionHash(filtered);
    if (lastAllUsersSigBySocket.get(s) !== allUsersSig) {
      lastAllUsersSigBySocket.set(s, allUsersSig);
      s.emit('allUsers', filtered);
    }

    const onlineCount = filtered.filter((u) => u.presenceState !== 'offline').length;
    if (lastOnlineCountBySocket.get(s) !== onlineCount) {
      lastOnlineCountBySocket.set(s, onlineCount);
      s.emit('onlineCountUpdated', onlineCount);
    }

    if (recipient) {
      const canSeeStaffPii = Boolean(
        viewerLevel >= 75 ||
        recipient.role === 'hassan' ||
        recipient.role === 'admin' ||
        recipient.role === 'super' ||
        hasPermission(recipient.role, 'canAccessControlPanel') ||
        hasPermission(recipient.role, 'canRevealNicks')
      );
      const hasGhostVisible = Boolean(recipient.isGhost && presenceMap.get(recipient.username.trim().toLowerCase())?.id === socketId);
      if (hasGhostVisible) {
        const customPayload = getAllRegisteredMembersPayload(viewerLevel, socketId, recipient.role, presenceMap);
        const customSig = computeVersionHash(customPayload);
        if (lastRegMembersSigBySocket.get(s) !== customSig) {
          lastRegMembersSigBySocket.set(s, customSig);
          s.emit('allRegisteredMembers', customPayload);
        }
      } else {
        const sig = canSeeStaffPii ? sharedStaffSig : sharedPublicSig;
        if (lastRegMembersSigBySocket.get(s) !== sig) {
          lastRegMembersSigBySocket.set(s, sig);
          s.emit('allRegisteredMembers', canSeeStaffPii ? sharedStaffMembers : sharedPublicMembers);
        }
      }
    }
  }
}

// Broadcast global presence snapshot with Ghost login privacy filtering, PII sanitization, coalescing, & hash deduplication
export function broadcastAllUsers() {
  const delayMs = Math.max(0, Math.min(300, chatQualitySettings.broadcastThrottleMs || 0));
  if (delayMs === 0) {
    executeBroadcastAllUsers();
    return;
  }
  if (pendingAllUsersTimer) return;
  pendingAllUsersTimer = setTimeout(() => {
    pendingAllUsersTimer = null;
    executeBroadcastAllUsers();
  }, delayMs);
}

// IP Address & Device Fingerprint to accounts / nicknames mapping (كشف النكات والآي بي وبصمة الجهاز)
const ipToAccountsMap: Map<string, Set<string>> = new Map();
const ipToDeviceMap: Map<string, string> = new Map();
const ipToCountryMap: Map<string, string> = new Map();
const ipToFingerprintMap: Map<string, string> = new Map();
const fingerprintToAccountsMap: Map<string, Set<string>> = new Map();

function indexFingerprintAccount(fp: string | undefined, accountName: string) {
  if (!fp || fp === 'FP-DEV-STANDARD' || !accountName) return;
  const trimmed = fp.trim();
  if (!trimmed) return;
  const cleanName = accountName.trim();
  if (!cleanName) return;

  const addMapping = (key: string) => {
    if (!key || key.length < 3) return;
    if (!fingerprintToAccountsMap.has(key)) {
      fingerprintToAccountsMap.set(key, new Set<string>());
    }
    fingerprintToAccountsMap.get(key)!.add(cleanName);
  };

  addMapping(trimmed);

  const uid = getPersistentUid(trimmed);
  if (uid) {
    addMapping(`UID:${uid}`);
  }

  const core = getHardwareCore(trimmed);
  if (core) {
    addMapping(`CORE:${core}`);
    addMapping(core);
  }

  const crossHw = getCrossBrowserHwId(trimmed);
  if (crossHw && crossHw !== 'hwerr') {
    addMapping(`HW:${crossHw}`);
  }

  const comps = parseFingerprintComponents(trimmed);
  if (comps) {
    if (comps.webglHash && comps.audioHash && comps.webglHash !== 'wglerr' && comps.audioHash !== 'auderr') {
      addMapping(`HARDWARE:${comps.os}_${comps.cores}_${comps.webglHash}_${comps.audioHash}`);
    }
    if (comps.webglHash && comps.webglHash !== 'wglerr' && comps.webglHash !== 'nowgl') {
      addMapping(`GPU:${comps.os}_${comps.webglHash}`);
    }
  }
}

export function isBannableIp(ip?: string): boolean {
  if (!ip) return false;
  const clean = ip.trim().toLowerCase();
  if (!clean) return false;
  return (
    clean !== '127.0.0.1' &&
    clean !== '::1' &&
    clean !== 'localhost' &&
    clean !== '0.0.0.0' &&
    clean !== '192.168.1.100' &&
    clean !== '192.168.1.1'
  );
}

// Helper to extract true client IP across verified Cloudflare, reverse proxies, and direct sockets
export function getRealClientIp(socket: any): string {
  if (!socket) return '127.0.0.1';
  const headers = socket.handshake?.headers || {};
  const hasCfRay = Boolean(headers['cf-ray']) || process.env.TRUST_CF_HEADER === 'true';
  const cfConnecting = hasCfRay ? (headers['cf-connecting-ip'] as string)?.trim() : '';
  const xForwardedRaw = (headers['x-forwarded-for'] as string) || '';
  const xForwardedParts = xForwardedRaw
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);
  const proxyForwardedIp = xForwardedParts.length > 0 ? xForwardedParts[xForwardedParts.length - 1] : '';
  const rawAddr = (socket.handshake?.address as string) || '';
  let ip = cfConnecting || rawAddr || proxyForwardedIp || '127.0.0.1';
  if ((ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1') && proxyForwardedIp) {
    ip = proxyForwardedIp;
  }
  if (ip.startsWith('::ffff:')) {
    ip = ip.substring(7);
  }
  return ip.trim() || '127.0.0.1';
}

// Record and persist member connection audit details (IP, IP history, device, fingerprint)
export function recordMemberAuditConnection(username: string, clientIp: string, deviceInfo: string, flag: string, fingerprint?: string) {
  if (!username) return;
  const clean = username.trim();
  const lower = clean.toLowerCase();

  // Case-insensitive key lookup in registeredMembers
  const foundKey = Object.keys(registeredMembers).find((k) => k.toLowerCase() === lower) || clean;
  if (!registeredMembers[foundKey]) {
    registeredMembers[foundKey] = {
      password: hashPassword(crypto.randomBytes(16).toString('hex')),
      originalUsername: clean,
      registeredAt: Date.now(),
      role: 'guest',
      flag: flag || '🇾🇪',
      statusQuote: 'زائر',
      likes: 100,
      points: 500,
      ipAddress: clientIp,
      ipHistory: (clientIp && clientIp !== '192.168.1.100') ? [clientIp] : [],
      deviceInfo,
      deviceHistory: deviceInfo ? [deviceInfo] : [],
      deviceFingerprint: fingerprint,
      fingerprintHistory: fingerprint ? [fingerprint] : [],
      lastSeen: Date.now()
    };
  } else {
    const m = registeredMembers[foundKey];
    if (!m.originalUsername) m.originalUsername = foundKey;
    if (clientIp && clientIp !== '192.168.1.100') {
      m.ipAddress = clientIp;
      if (!Array.isArray(m.ipHistory)) m.ipHistory = [];
      if (!m.ipHistory.includes(clientIp)) {
        m.ipHistory.push(clientIp);
        if (m.ipHistory.length > 30) m.ipHistory.shift();
      }
    }
    if (deviceInfo) {
      m.deviceInfo = deviceInfo;
      if (!Array.isArray(m.deviceHistory)) m.deviceHistory = [];
      if (!m.deviceHistory.includes(deviceInfo)) {
        m.deviceHistory.push(deviceInfo);
        if (m.deviceHistory.length > 10) m.deviceHistory.shift();
      }
    }
    if (fingerprint) {
      m.deviceFingerprint = fingerprint;
      if (!Array.isArray(m.fingerprintHistory)) m.fingerprintHistory = [];
      if (!m.fingerprintHistory.includes(fingerprint)) {
        m.fingerprintHistory.push(fingerprint);
        if (m.fingerprintHistory.length > 15) m.fingerprintHistory.shift();
      }
    }
    m.lastSeen = Date.now();
  }

  // Cross-reference index in memory
  if (isBannableIp(clientIp)) {
    if (!ipToAccountsMap.has(clientIp)) {
      ipToAccountsMap.set(clientIp, new Set<string>());
    }
    ipToAccountsMap.get(clientIp)!.add(foundKey);
    if (deviceInfo) ipToDeviceMap.set(clientIp, deviceInfo);
    if (flag) ipToCountryMap.set(clientIp, flag);
    if (fingerprint) ipToFingerprintMap.set(clientIp, fingerprint);
  }
  if (fingerprint) {
    indexFingerprintAccount(fingerprint, foundKey);
  }

  saveMembers();
}

// Helper to parse human-readable device name from User-Agent
export function parseDeviceInfo(ua?: string): string {
  if (!ua) return 'هاتف ذكي (Android/iOS)';
  const lower = ua.toLowerCase();
  if (lower.includes('iphone')) return 'iPhone (Apple iOS)';
  if (lower.includes('ipad')) return 'iPad (Apple iPadOS)';
  if (lower.includes('android')) {
    if (lower.includes('samsung')) return 'Samsung Galaxy (Android)';
    if (lower.includes('xiaomi') || lower.includes('redmi')) return 'Xiaomi (Android)';
    if (lower.includes('huawei') || lower.includes('honor')) return 'Huawei (Android)';
    if (lower.includes('pixel')) return 'Google Pixel (Android)';
    return 'هاتف أندرويد (Android)';
  }
  if (lower.includes('windows')) return 'كمبيوتر (Windows PC)';
  if (lower.includes('macintosh') || lower.includes('mac os')) return 'كمبيوتر (Apple Mac)';
  if (lower.includes('linux')) return 'جهاز لينكس (Linux)';
  return 'متصفح هاتف ذكي';
}

// Filter Alerts Log structure (سجل تنبيهات الفلتر مع الرسالة الكاملة واسم العضو ولماذا أرسلت ووقتها)
export interface FilterAlert {
  id: string;
  username: string;
  avatarUrl?: string;
  flag?: string;
  room: string;
  targetUser?: string; // لمن أرسلت (العضو المستلم في الخاص، أو الغرفة، أو الحائط)
  contextType?: 'room' | 'pm' | 'wall_post' | 'wall_comment';
  matchedWords: string[];
  fullMessage: string;
  timestamp: number;
  time: string;
}

const filterAlerts: FilterAlert[] = [];

// Rate limit cooldown map for liking member profiles (1 like per minute per target member)
const userLikeCooldownMap = new Map<string, number>();

// Brute-force protection for login credentials (max 5 failed attempts within 5 minutes)
const loginAttemptsMap = new Map<string, { count: number; lockedUntil: number }>();

// Temporary kick cooldown map (2-minute temporary room exit enforcement)
const kickedCooldownMap = new Map<string, number>();

// Persistent Queue for offline private messages (MongoDB backed)
const offlinePrivateMessages = new Map<string, PrivateMessage[]>();
// Persistent Archive for private conversations (MongoDB backed)
const privateChatHistory = new Map<string, PrivateMessage[]>();

export function getPmPairKey(u1: string, u2: string): string {
  return [u1.trim().toLowerCase(), u2.trim().toLowerCase()].sort().join(':::');
}

export function loadOfflinePrivateMessages() {
  try {
    const data = dataManager.loadOfflinePrivateMessagesSync<Record<string, PrivateMessage[]>>({});
    if (data && typeof data === 'object') {
      offlinePrivateMessages.clear();
      for (const [key, msgs] of Object.entries(data)) {
        if (Array.isArray(msgs)) {
          offlinePrivateMessages.set(key.toLowerCase(), msgs);
        }
      }
    }
  } catch (err) {
    console.error('Error loading offline private messages:', err);
  }
}

let saveOfflinePmTimer: NodeJS.Timeout | null = null;
export function saveOfflinePrivateMessages() {
  if (saveOfflinePmTimer) clearTimeout(saveOfflinePmTimer);
  saveOfflinePmTimer = setTimeout(() => {
    saveOfflinePmTimer = null;
    try {
      const obj: Record<string, PrivateMessage[]> = {};
      for (const [key, msgs] of offlinePrivateMessages.entries()) {
        if (msgs && msgs.length > 0) {
          obj[key] = msgs;
        }
      }
      dataManager.saveOfflinePrivateMessages(obj);
    } catch (err) {
      console.error('Error saving offline private messages:', err);
    }
  }, 300);
}

export function loadPrivateChatHistory() {
  try {
    const data = dataManager.loadPrivateChatHistorySync<Record<string, PrivateMessage[]>>({});
    if (data && typeof data === 'object') {
      privateChatHistory.clear();
      for (const [pairKey, msgs] of Object.entries(data)) {
        if (Array.isArray(msgs)) {
          privateChatHistory.set(pairKey, msgs);
        }
      }
    }
  } catch (err) {
    console.error('Error loading private chat history:', err);
  }
}

export function prunePrivateChatHistory(pairKey?: string) {
  const maxRetention = Math.max(1, messageRetentionLimits.privateMaxMessages || 100);
  if (pairKey) {
    const list = privateChatHistory.get(pairKey);
    if (list && list.length > maxRetention) {
      privateChatHistory.set(pairKey, list.slice(-maxRetention));
    }
    return;
  }
  for (const [k, msgs] of privateChatHistory.entries()) {
    if (Array.isArray(msgs) && msgs.length > maxRetention) {
      privateChatHistory.set(k, msgs.slice(-maxRetention));
    }
  }
}

let savePrivateChatHistoryTimer: NodeJS.Timeout | null = null;
export function savePrivateChatHistory() {
  if (savePrivateChatHistoryTimer) clearTimeout(savePrivateChatHistoryTimer);
  savePrivateChatHistoryTimer = setTimeout(() => {
    savePrivateChatHistoryTimer = null;
    try {
      const obj: Record<string, PrivateMessage[]> = {};
      const maxRetention = Math.max(1, messageRetentionLimits.privateMaxMessages || 100);
      for (const [pairKey, msgs] of privateChatHistory.entries()) {
        if (msgs && msgs.length > 0) {
          obj[pairKey] = msgs.slice(-maxRetention);
        }
      }
      dataManager.savePrivateChatHistory(obj);
    } catch (err) {
      console.error('Error saving private chat history:', err);
    }
  }, 400);
}

// Comprehensive Filter Detection across Room, Private Messages & Wall
function checkAndLogMonitoredWords(
  text: string | undefined | null,
  sender: ConnectedUser,
  context: {
    type: 'room' | 'pm' | 'wall_post' | 'wall_comment';
    targetName?: string;
  }
) {
  if (!text) return;
  const clean = sanitizeText(text);
  if (!clean) return;
  const lower = clean.toLowerCase();
  const detectedBadWords = monitoredWords.filter((w) => lower.includes(w.toLowerCase()));
  if (detectedBadWords.length > 0) {
    const alertObj: FilterAlert = {
      id: `fa-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      username: sender.username,
      avatarUrl: sender.avatarUrl,
      flag: sender.flag,
      room:
        context.type === 'pm'
          ? `الخاص (إلى: @${context.targetName || 'مستلم'})`
          : context.type === 'wall_post'
          ? 'منشور في الحائط'
          : context.type === 'wall_comment'
          ? `تعليق بالحائط (${context.targetName || 'منشور'})`
          : `غرفة: ${context.targetName || sender.room || 'العامة'}`,
      targetUser: context.targetName,
      contextType: context.type,
      matchedWords: detectedBadWords,
      fullMessage: clean,
      timestamp: Date.now(),
      time: new Date().toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    };

    filterAlerts.unshift(alertObj);
    if (filterAlerts.length > 100) filterAlerts.pop();

    users.forEach((u) => {
      if (isStaffUser(u)) {
        io.to(u.id).emit('newFilterAlert', alertObj);
      }
    });

    // Note: Filter detections are recorded in filterAlerts (سجل تنبيهات الفلتر) and not in the main administrative events log
    // Automated IP Ban Trigger based on Filter Violations Frequency
    if (serverSecurity.autoIpBanEnabled && !isSupremeHassan(sender) && sender.role !== 'admin' && sender.role !== 'super') {
      const senderIp = sender.ipAddress || sender.ip;
      if (senderIp) {
        const now = Date.now();
        const windowMs = (serverSecurity.autoIpBanWindowMinutes || 10) * 60 * 1000;
        const currentViolations = ipFilterViolationsMap.get(senderIp) || [];
        // Keep only violations within the rolling time window
        const recentViolations = currentViolations.filter((v) => now - v.timestamp < windowMs);
        recentViolations.push({
          timestamp: now,
          word: detectedBadWords.join(', '),
          username: sender.username
        });
        ipFilterViolationsMap.set(senderIp, recentViolations);

        const threshold = serverSecurity.autoIpBanThreshold || 3;
        if (recentViolations.length >= threshold) {
          const durationMins = serverSecurity.autoIpBanDurationMinutes ?? 60;
          const isPermanent = durationMins <= 0;
          const expiresAt = isPermanent ? undefined : now + durationMins * 60 * 1000;
          const durationLabel = isPermanent
            ? 'باند نهائي'
            : `لمدة ${durationMins >= 60 ? Math.floor(durationMins / 60) + ' ساعة' : durationMins + ' دقيقة'}`;
          const banReason = `حظر IP تلقائي: تكرار مخالفة فلتر الكلمات (${recentViolations.length} مخالفات خلال ${serverSecurity.autoIpBanWindowMinutes} دقيقة) [${durationLabel}]`;

          // Add to banned sets & records (including device fingerprint)
          const senderFp = sender.deviceFingerprint || getRegisteredMember(sender.username)?.member.deviceFingerprint || ipToFingerprintMap.get(senderIp);
          if (isBannableIp(senderIp)) bannedIps.add(senderIp);
          bannedUsers.add(sender.username.toLowerCase());
          addFingerprintToBanSet(senderFp);
          bannedRecords.set(sender.username.toLowerCase(), {
            username: sender.username,
            ip: senderIp,
            deviceFingerprint: senderFp,
            reason: banReason,
            bannedBy: '🛡️ نظام الحظر التلقائي (Auto IP-Ban)',
            timestamp: now,
            expiresAt,
            banDurationMinutes: durationMins,
            banType: 'auto_filter'
          });
          saveBans();
          emitToAuthorizedStaff('bannedListUpdated', Array.from(bannedRecords.values()), 'canUnban');

          logMonitorEvent(
            'ban',
            `🚨 حظر IP تلقائي: تم حظر [${sender.username}] وعنوان IP [${senderIp}] ${durationLabel} لتكرار مخالفات الفلتر`,
            'النظام الأمني',
            sender.username
          );

          // Alert admins in real-time
          users.forEach((u) => {
            if (isStaffUser(u)) {
              io.to(u.id).emit('systemAlert', `🚨 تم تطبيق حظر IP تلقائي على العضو [${sender.username}] (${durationLabel}) لتكرار مخالفات الفلتر.`);
            }
          });

          // Disconnect all sockets associated with this IP or user (exempt supreme 'hassan' rank)
          users.forEach((u) => {
            if (isSupremeHassan(u) || isUsernameSupremeHassan(u.username)) return;
            const userIp = u.ipAddress || u.ip;
            if ((userIp && userIp === senderIp) || u.username.toLowerCase() === sender.username.toLowerCase()) {
              const clientSocket = io.sockets.sockets.get(u.id);
              if (clientSocket) {
                clientSocket.emit('forceLogout', `🚫 تم حظر عنوان جهازك (IP) تلقائياً ${durationLabel} بسبب تكرار مخالفات فلتر الكلمات المحظورة.`);
                clientSocket.disconnect(true);
              }
            }
          });

          // Reset violations for this IP
          ipFilterViolationsMap.delete(senderIp);
        }
      }
    }
  }
}

// Helper to extract country flag from headers or country code
function getFlagFromCountryCode(code?: string): string {
  if (!code || code.length !== 2) return '';
  const codePoints = code
    .toUpperCase()
    .split('')
    .map((char) => 127397 + char.charCodeAt(0));
  return String.fromCodePoint(...codePoints);
}

// Self-contained Geo Flag API (inspects verified cloud headers only)
app.get('/api/geo-flag', (req, res) => {
  const hasVerifiedCloud = Boolean(req.headers['cf-ray'] || req.headers['x-appengine-country'] || process.env.TRUST_CF_HEADER === 'true');
  const rawCountry = hasVerifiedCloud
    ? ((req.headers['cf-ipcountry'] || req.headers['x-appengine-country'] || req.headers['x-country-code']) as string) || ''
    : '';
  const cfCountry = rawCountry && rawCountry !== 'XX' && rawCountry !== 'T1' ? rawCountry : '';
  const flag = cfCountry ? getFlagFromCountryCode(cfCountry) : null;
  res.json({
    countryCode: cfCountry || null,
    flag: flag || null
  });
});

// Calculate real-time room statistics for pie chart based on real users (single-pass O(C) grouping)
export function getRoomStatistics() {
  const total = users.length;
  const usersByRoom = new Map<string, ConnectedUser[]>();
  for (const u of users) {
    const key = u.room.trim().toLowerCase();
    let list = usersByRoom.get(key);
    if (!list) {
      list = [];
      usersByRoom.set(key, list);
    }
    list.push(u);
  }
  return chatRooms.map((r) => {
    const roomUsers = usersByRoom.get(r.id.trim().toLowerCase()) || [];
    const count = roomUsers.length;
    const percentage = total > 0 ? Math.round((count / total) * 100) : (total === 0 && r.id === 'الغرفة العامة' ? 100 : 0);
    let voiceCount = 0;
    for (const u of roomUsers) {
      if (u.micSlot !== null) voiceCount += 1;
    }
    return {
      id: r.id,
      roomId: r.id,
      name: r.name,
      roomName: r.name,
      desc: r.desc,
      isPasswordProtected: r.isPasswordProtected,
      voiceLimit: r.voiceLimit,
      count,
      percentage,
      voiceCount,
      users: roomUsers.map((u) => ({
        id: u.id,
        username: u.username,
        role: u.role,
        flag: u.flag,
        avatarUrl: u.avatarUrl,
        isVoice: u.isVoice,
        micSlot: u.micSlot
      }))
    };
  });
}

// Mic slots (5 slots per room: 1 to 5)
const roomMicSlots: Record<string, Array<{ slotNumber: number; user: ConnectedUser | null }>> = {};

function getMicSlotsForRoom(room: string) {
  if (!roomMicSlots[room]) {
    roomMicSlots[room] = [1, 2, 3, 4, 5].map((slotNumber) => ({
      slotNumber,
      user: null
    }));
  }
  return roomMicSlots[room];
}

function getPublicMicSlotsForRoom(room: string) {
  return getMicSlotsForRoom(room).map((slot) => {
    if (!slot.user) return { slotNumber: slot.slotNumber, user: null };
    const liveUser = users.find(
      (u) => u.id === slot.user!.id || u.username.toLowerCase() === slot.user!.username.toLowerCase()
    );
    return {
      slotNumber: slot.slotNumber,
      user: toPublicConnectedUser(liveUser || slot.user)
    };
  });
}

function releaseUserMic(user: ConnectedUser, roomId?: string): number | null {
  const targetRoom = roomId || user.room;
  const hadVoice = user.micSlot !== null || user.isVoice;
  let releasedNumber: number | null = user.micSlot;

  if (targetRoom) {
    const slots = getMicSlotsForRoom(targetRoom);
    slots.forEach((s) => {
      if (
        s.user &&
        (s.user.id === user.id ||
          s.user.username.toLowerCase() === user.username.toLowerCase() ||
          (user.micSlot !== null && s.slotNumber === user.micSlot))
      ) {
        if (releasedNumber === null) releasedNumber = s.slotNumber;
        s.user = null;
      }
    });
    if (hadVoice && targetRoom !== 'خارج الغرف') {
      io.to(targetRoom).emit('micSlotsUpdated', getPublicMicSlotsForRoom(targetRoom));
      io.to(targetRoom).emit('userLeftVoice', { userId: user.id, username: user.username });
    }
  }

  user.micSlot = null;
  user.isVoice = false;
  user.isSpeaking = false;
  user.isSharingMusic = false;
  user.isMuted = Boolean(user.isTextMuted || user.isVoiceMutedByAdmin);

  for (const sess of activeSessions.values()) {
    if (sess.user && sess.user.username.toLowerCase() === user.username.toLowerCase()) {
      sess.user.micSlot = null;
      sess.user.isVoice = false;
      sess.user.isSpeaking = false;
      sess.user.isSharingMusic = false;
      sess.user.isMuted = user.isMuted;
    }
  }

  if (hadVoice) {
    broadcastRoomsUpdate();
  }
  return releasedNumber;
}

export function getActiveVoiceCountForRoom(roomId: string): number {
  const slots = roomMicSlots[roomId];
  if (slots && Array.isArray(slots)) {
    let c = 0;
    for (let i = 0; i < slots.length; i++) {
      if (slots[i] && slots[i].user) c++;
    }
    return c;
  }
  const lowerRoom = roomId.trim().toLowerCase();
  let count = 0;
  for (const u of users) {
    if ((u.room.trim().toLowerCase() === lowerRoom || u.room === roomId) && u.micSlot !== null && u.micSlot !== undefined) {
      count++;
    }
  }
  return count;
}

export function getChatRoomsWithLiveCounts(): ChatRoom[] {
  return chatRooms.map((r) => {
    const { password: _omittedPassword, ...safeRoom } = r;
    return {
      ...safeRoom,
      activeVoiceCount: getActiveVoiceCountForRoom(r.id)
    };
  });
}

let pendingRoomsUpdateTimer: NodeJS.Timeout | null = null;
export function broadcastRoomsUpdate() {
  if (pendingRoomsUpdateTimer) return;
  pendingRoomsUpdateTimer = setTimeout(() => {
    pendingRoomsUpdateTimer = null;
    io.emit('roomsUpdated', getChatRoomsWithLiveCounts());
    io.emit('roomStatsUpdated', getRoomStatistics());
  }, 80);
}

// Chat History Database via Data Layer
let chatHistory: StoredMessage[] = [];

try {
  chatHistory = dataManager.loadChatHistorySync<StoredMessage[]>([]);
} catch (err) {
  console.error('[Data Layer] Error loading chat history:', err);
  chatHistory = [];
}

// Persistent members data via Data Layer
try {
  const loadedMembers = dataManager.loadMembersSync<Record<string, RegisteredMemberInfo>>(registeredMembers);
  if (loadedMembers && typeof loadedMembers === 'object') {
    Object.assign(registeredMembers, loadedMembers);
  }

  // Automated migration: transparently hash any plain text passwords loaded from storage
  let needsUpgrade = false;
  for (const m of Object.values(registeredMembers)) {
    if (m && m.password && !m.password.startsWith('$2a$') && !m.password.startsWith('$2b$')) {
      m.password = hashPassword(m.password);
      needsUpgrade = true;
    }
  }
  if (needsUpgrade) {
    saveMembers();
    console.log('[Security] ✅ Automated migration: Upgraded stored passwords to secure bcrypt hashes.');
  }

  rebuildAuditMapsFromMembers();
} catch (err) {
  console.error('[Data Layer] Error loading members from data layer:', err);
}

function rebuildAuditMapsFromMembers() {
  for (const [username, m] of Object.entries(registeredMembers)) {
    if (!m) continue;
    if (!m.originalUsername) {
      m.originalUsername = username;
    }
    const allMemberIps = new Set<string>();
    if (m.ipAddress && m.ipAddress !== '127.0.0.1' && m.ipAddress !== '192.168.1.100') {
      allMemberIps.add(m.ipAddress);
    }
    if (Array.isArray(m.ipHistory)) {
      m.ipHistory.forEach((ip) => {
        if (ip && ip !== '127.0.0.1' && ip !== '192.168.1.100') allMemberIps.add(ip);
      });
    }
    allMemberIps.forEach((ip) => {
      if (!ipToAccountsMap.has(ip)) {
        ipToAccountsMap.set(ip, new Set<string>());
      }
      ipToAccountsMap.get(ip)!.add(username);
      if (m.deviceInfo) ipToDeviceMap.set(ip, m.deviceInfo);
      if (m.flag) ipToCountryMap.set(ip, m.flag);
      if (m.deviceFingerprint) ipToFingerprintMap.set(ip, m.deviceFingerprint);
    });
    if (m.deviceFingerprint) {
      indexFingerprintAccount(m.deviceFingerprint, username);
    }
    if (Array.isArray(m.fingerprintHistory)) {
      m.fingerprintHistory.forEach((fp) => indexFingerprintAccount(fp, username));
    }
  }
}

function getCurrentTimeString(): string {
  try {
    return new Date().toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' });
  } catch {
    return new Date().toLocaleTimeString();
  }
}

let saveMembersTimer: NodeJS.Timeout | null = null;
let engagementMembersSaveTimer: NodeJS.Timeout | null = null;
function saveMembers() {
  if (engagementMembersSaveTimer) {
    clearTimeout(engagementMembersSaveTimer);
    engagementMembersSaveTimer = null;
  }
  if (saveMembersTimer) return;
  saveMembersTimer = setTimeout(async () => {
    saveMembersTimer = null;
    try {
      await dataManager.saveMembers(registeredMembers);
    } catch (err) {
      console.error('[Data Layer] Error saving members:', err);
    }
  }, 1000);
}

// Batched low-frequency save for message/wall engagement counters so messaging never triggers per-message JSON serialization
function scheduleEngagementMembersSave() {
  if (saveMembersTimer || engagementMembersSaveTimer) return;
  engagementMembersSaveTimer = setTimeout(() => {
    engagementMembersSaveTimer = null;
    saveMembers();
  }, 25000);
}

// Persistent non-repeating per-flag member numbering (#1, #2, #3... unique per flag)
let flagCounters: Record<string, number> = {};
try {
  const loadedCounters = dataManager.loadSync<Record<string, number>>('flag_counters', {});
  if (loadedCounters && typeof loadedCounters === 'object') {
    flagCounters = loadedCounters;
  }
} catch (err) {
  console.error('[Data Layer] Error loading flag_counters:', err);
}

let saveFlagCountersTimer: NodeJS.Timeout | null = null;
function saveFlagCounters() {
  if (saveFlagCountersTimer) return;
  saveFlagCountersTimer = setTimeout(async () => {
    saveFlagCountersTimer = null;
    try {
      await dataManager.save('flag_counters', flagCounters);
    } catch (err) {
      console.error('[Data Layer] Error saving flag_counters:', err);
    }
  }, 800);
}

function getUsedFlagNumbersForFlag(cleanFlag: string, excludeUsernameLower?: string): Set<number> {
  const used = new Set<number>();
  for (const [uname, m] of Object.entries(registeredMembers)) {
    if (!m) continue;
    if (excludeUsernameLower && uname.trim().toLowerCase() === excludeUsernameLower) continue;
    if (m.flag === cleanFlag && typeof m.flagNumber === 'number' && m.flagNumber > 0) {
      used.add(m.flagNumber);
    }
    const mapped = m.flagNumbersByFlag?.[cleanFlag];
    if (typeof mapped === 'number' && mapped > 0) {
      used.add(mapped);
    }
  }
  for (const u of users) {
    if (excludeUsernameLower && u.username.trim().toLowerCase() === excludeUsernameLower) continue;
    if (u.flag === cleanFlag && typeof u.flagNumber === 'number' && u.flagNumber > 0) {
      used.add(u.flagNumber);
    }
  }
  return used;
}

export function assignOrGetFlagNumber(username: string, rawFlag?: string): number {
  const cleanFlag = String(rawFlag || '').trim() || '🇾🇪';
  const cleanUser = String(username || '').trim();
  const lowerUser = cleanUser.toLowerCase();
  const regFound = cleanUser ? getRegisteredMember(cleanUser) : null;
  const usedByOthers = getUsedFlagNumbersForFlag(cleanFlag, lowerUser);

  if (regFound) {
    const m = regFound.member;
    const candidate =
      (m.flagNumbersByFlag && typeof m.flagNumbersByFlag[cleanFlag] === 'number' ? m.flagNumbersByFlag[cleanFlag] : undefined) ??
      (m.flag === cleanFlag && typeof m.flagNumber === 'number' ? m.flagNumber : undefined);

    if (typeof candidate === 'number' && candidate > 0 && !usedByOthers.has(candidate)) {
      let dirty = false;
      if (!m.flagNumbersByFlag) {
        m.flagNumbersByFlag = {};
        dirty = true;
      }
      if (m.flagNumbersByFlag[cleanFlag] !== candidate) {
        m.flagNumbersByFlag[cleanFlag] = candidate;
        dirty = true;
      }
      if ((m.flag === cleanFlag || !m.flag) && m.flagNumber !== candidate) {
        m.flagNumber = candidate;
        dirty = true;
      }
      if ((flagCounters[cleanFlag] || 0) < candidate) {
        flagCounters[cleanFlag] = candidate;
        saveFlagCounters();
      }
      if (dirty) saveMembers();
      return candidate;
    }
  }

  let maxUsed = Number(flagCounters[cleanFlag]) || 0;
  for (const n of usedByOthers) {
    if (n > maxUsed) maxUsed = n;
  }
  const nextNum = maxUsed + 1;
  flagCounters[cleanFlag] = nextNum;
  saveFlagCounters();

  if (regFound) {
    if (!regFound.member.flagNumbersByFlag) regFound.member.flagNumbersByFlag = {};
    regFound.member.flagNumbersByFlag[cleanFlag] = nextNum;
    if (!regFound.member.flag || regFound.member.flag === cleanFlag) {
      regFound.member.flag = cleanFlag;
      regFound.member.flagNumber = nextNum;
    }
    saveMembers();
  }

  return nextNum;
}

function ensureAllFlagNumbers() {
  try {
    const loadedCounters = dataManager.loadSync<Record<string, number>>('flag_counters', {});
    if (loadedCounters && typeof loadedCounters === 'object') {
      for (const [fl, val] of Object.entries(loadedCounters)) {
        const num = Number(val) || 0;
        if (num > (flagCounters[fl] || 0)) {
          flagCounters[fl] = num;
        }
      }
    }
  } catch {}

  const claimedByFlag = new Map<string, Set<number>>();
  const entries = Object.entries(registeredMembers).sort(([aName, a], [bName, b]) => {
    if (aName.toLowerCase() === 'admin') return -1;
    if (bName.toLowerCase() === 'admin') return 1;
    const tA = a?.lastSeen || 0;
    const tB = b?.lastSeen || 0;
    if (tA !== tB) return tA - tB;
    return aName.localeCompare(bName);
  });

  let membersDirty = false;
  let countersDirty = false;

  // Pass 1: preserve valid unique numbers already assigned
  for (const [, m] of entries) {
    if (!m) continue;
    const fl = String(m.flag || '').trim() || '🇾🇪';
    if (!claimedByFlag.has(fl)) claimedByFlag.set(fl, new Set<number>());
    const claimed = claimedByFlag.get(fl)!;

    const existingNum =
      (m.flagNumbersByFlag && typeof m.flagNumbersByFlag[fl] === 'number' ? m.flagNumbersByFlag[fl] : undefined) ??
      (typeof m.flagNumber === 'number' ? m.flagNumber : undefined);

    if (typeof existingNum === 'number' && existingNum > 0 && !claimed.has(existingNum)) {
      claimed.add(existingNum);
      if (m.flagNumber !== existingNum) {
        m.flagNumber = existingNum;
        membersDirty = true;
      }
      if (!m.flagNumbersByFlag) {
        m.flagNumbersByFlag = {};
        membersDirty = true;
      }
      if (m.flagNumbersByFlag[fl] !== existingNum) {
        m.flagNumbersByFlag[fl] = existingNum;
        membersDirty = true;
      }
      if ((flagCounters[fl] || 0) < existingNum) {
        flagCounters[fl] = existingNum;
        countersDirty = true;
      }
    } else if (typeof existingNum === 'number' && claimed.has(existingNum)) {
      // Duplicate detected -> clear so Pass 2 gives a unique number
      m.flagNumber = undefined;
      if (m.flagNumbersByFlag) delete m.flagNumbersByFlag[fl];
      membersDirty = true;
    }
  }

  // Pass 2: assign sequential unique numbers to any members without one
  for (const [, m] of entries) {
    if (!m) continue;
    const fl = String(m.flag || '').trim() || '🇾🇪';
    if (!claimedByFlag.has(fl)) claimedByFlag.set(fl, new Set<number>());
    const claimed = claimedByFlag.get(fl)!;

    if (typeof m.flagNumber === 'number' && m.flagNumber > 0 && claimed.has(m.flagNumber)) {
      continue;
    }
    let next = Math.max(flagCounters[fl] || 0, ...Array.from(claimed), 0) + 1;
    while (claimed.has(next)) next++;
    claimed.add(next);
    flagCounters[fl] = next;
    m.flag = fl;
    m.flagNumber = next;
    if (!m.flagNumbersByFlag) m.flagNumbersByFlag = {};
    m.flagNumbersByFlag[fl] = next;
    membersDirty = true;
    countersDirty = true;
  }

  // Pass 3: sync to live users, sessions, and recentLogins
  for (const u of users) {
    const fl = String(u.flag || '').trim() || '🇾🇪';
    u.flagNumber = assignOrGetFlagNumber(u.username, fl);
  }
  for (const sess of activeSessions.values()) {
    if (sess?.user) {
      const fl = String(sess.user.flag || '').trim() || '🇾🇪';
      sess.user.flagNumber = assignOrGetFlagNumber(sess.user.username, fl);
    }
  }
  for (const entry of recentLogins) {
    const fl = String(entry.flag || '').trim() || '🇾🇪';
    entry.flagNumber = assignOrGetFlagNumber(entry.username, fl);
  }

  if (membersDirty) saveMembers();
  if (countersDirty) saveFlagCounters();
}

ensureAllFlagNumbers();

// Handled centrally via dataManager.onHydrated() callback below

export function pruneRoomChatHistory(roomId?: string) {
  const limit = Math.max(1, messageRetentionLimits.roomMaxMessages || 200);
  if (roomId) {
    const roomMsgs = chatHistory.filter((m) => m.room === roomId);
    if (roomMsgs.length > limit) {
      const excess = roomMsgs.length - limit;
      const idsToRemove = new Set(roomMsgs.slice(0, excess).map((m) => m.id));
      for (let i = chatHistory.length - 1; i >= 0; i--) {
        if (idsToRemove.has(chatHistory[i].id)) {
          chatHistory.splice(i, 1);
        }
      }
    }
  } else {
    const countByRoom: Record<string, number> = {};
    const toRemove = new Set<string>();
    for (let i = chatHistory.length - 1; i >= 0; i--) {
      const r = chatHistory[i].room;
      countByRoom[r] = (countByRoom[r] || 0) + 1;
      if (countByRoom[r] > limit) {
        toRemove.add(chatHistory[i].id);
      }
    }
    if (toRemove.size > 0) {
      for (let i = chatHistory.length - 1; i >= 0; i--) {
        if (toRemove.has(chatHistory[i].id)) {
          chatHistory.splice(i, 1);
        }
      }
    }
  }
}

export function pruneWallPosts() {
  const limit = Math.max(1, messageRetentionLimits.wallMaxPosts || 100);
  if (wallPosts.length > limit) {
    wallPosts = wallPosts.slice(0, limit);
  }
}

let saveHistoryTimer: NodeJS.Timeout | null = null;
function saveHistory() {
  if (saveHistoryTimer) return;
  saveHistoryTimer = setTimeout(async () => {
    saveHistoryTimer = null;
    try {
      await dataManager.saveChatHistory(chatHistory);
    } catch (err) {
      console.error('[Data Layer] Error saving history:', err);
    }
  }, 800);
}

function emitRoomContextSync(targetSocket: any, roomId: string) {
  if (!targetSocket || !roomId || roomId === 'خارج الغرف') return;
  const settings = getRoomSettings(roomId);
  targetSocket.emit('roomSettingsUpdated', { room: roomId, settings });
  targetSocket.emit('pinnedTopic', settings.pinnedTopic || '');
  targetSocket.emit('roomPinnedMessageUpdated', roomPinnedMessages[roomId] ?? null);
  targetSocket.emit('micSlotsUpdated', getPublicMicSlotsForRoom(roomId));
  targetSocket.emit('currentLiveBroadcast', serializeLiveBroadcast(activeLiveBroadcasts.get(roomId)));
}

// Unified helper to move a connected user cleanly between rooms (moves Socket.IO room, frees mic, notifies audio speakers, and broadcasts messages in both rooms)
function moveConnectedUserToRoom(
  target: ConnectedUser,
  targetRoomId: string,
  options?: {
    actorUsername?: string;
    announceRooms?: boolean;
    customOldRoomText?: string;
    customNewRoomText?: string;
  }
) {
  if (!target || !targetRoomId) return;
  const resolvedTargetRoomId = resolveCanonicalRoomId(targetRoomId);
  if (!resolvedTargetRoomId) return;
  const oldRoom = target.room;
  if (oldRoom === resolvedTargetRoomId) return;

  // Release mic & live broadcast state in old room
  if (target.micSlot !== null || target.isVoice) {
    releaseUserMic(target, oldRoom);
  }
  cleanupUserLiveState(target.id, oldRoom);

  target.room = resolvedTargetRoomId;

  // Persist room change in active session if present
  for (const sess of activeSessions.values()) {
    if (sess.user && sess.user.username.toLowerCase() === target.username.toLowerCase()) {
      sess.user.room = resolvedTargetRoomId;
      sess.user.micSlot = null;
      sess.user.isVoice = false;
    }
  }
  persistActiveSessions();

  const targetSocket = io.sockets.sockets.get(target.id);
  if (targetSocket) {
    if (oldRoom && oldRoom !== 'خارج الغرف') {
      targetSocket.leave(oldRoom);
      io.to(oldRoom).emit('userTyping', {
        userId: target.id,
        username: target.username,
        room: oldRoom,
        isTyping: false,
        timestamp: Date.now()
      });
    }
    if (resolvedTargetRoomId && resolvedTargetRoomId !== 'خارج الغرف') {
      targetSocket.join(resolvedTargetRoomId);
    }
    targetSocket.emit('forceMoveRoom', { room: resolvedTargetRoomId });
    targetSocket.emit('roomJoined', { user: target });
    emitRoomContextSync(targetSocket, resolvedTargetRoomId);
  } else {
    io.to(target.id).emit('forceMoveRoom', { room: resolvedTargetRoomId });
  }

  // Notify active mic speakers in the destination room so the moved member hears room audio
  if (resolvedTargetRoomId && resolvedTargetRoomId !== 'خارج الغرف') {
    users
      .filter((u) => u.room === resolvedTargetRoomId && u.isVoice && u.id !== target.id)
      .forEach((speaker) => {
        io.to(speaker.id).emit('voiceNewListener', {
          id: target.id,
          username: target.username
        });
      });
  }

  // Broadcast messages in BOTH source room and destination room (unless ghost user or suppressed)
  const shouldAnnounce = options?.announceRooms !== false && !target.isGhost;
  if (shouldAnnounce) {
    const newRoomObj = chatRooms.find((r) => r.id === resolvedTargetRoomId);
    const newRoomTitle = newRoomObj?.name || resolvedTargetRoomId;
    const actorSuffix = options?.actorUsername ? ` بواسطة ${options.actorUsername}` : '';
    const nowTs = Date.now();
    const nowTime = getCurrentTimeString();

    if (oldRoom && oldRoom !== 'خارج الغرف') {
      const leaveTransferMsg: StoredMessage = {
        id: `move-out-${nowTs}-${Math.random().toString(36).substring(2, 6)}`,
        room: oldRoom,
        username: target.username,
        displayName: target.displayName || target.username,
        avatarUrl: target.avatarUrl,
        nameBannerUrl: target.nameBannerUrl,
        flag: target.flag,
        badge: `${newRoomTitle} | نُقل إلى`,
        badgeColor: 'text-amber-400',
        text:
          options?.customOldRoomText ||
          `تم نقل ${target.username} من هذه الغرفة إلى [${newRoomTitle}]${actorSuffix} 🚪`,
        time: nowTime,
        timestamp: nowTs
      };
      chatHistory.push(leaveTransferMsg);
      pruneRoomChatHistory(oldRoom);
      io.to(oldRoom).emit('message', leaveTransferMsg);
    }

    if (resolvedTargetRoomId && resolvedTargetRoomId !== 'خارج الغرف') {
      const enterTransferMsg: StoredMessage = {
        id: `move-in-${nowTs}-${Math.random().toString(36).substring(2, 6)}`,
        room: resolvedTargetRoomId,
        username: target.username,
        displayName: target.displayName || target.username,
        avatarUrl: target.avatarUrl,
        nameBannerUrl: target.nameBannerUrl,
        flag: target.flag,
        badge: `${newRoomTitle} | نُقل إلى`,
        badgeColor: 'text-emerald-400',
        text:
          options?.customNewRoomText ||
          `تم نقل ${target.username} إلى ${newRoomTitle}${actorSuffix} أهلاً وسهلاً 🦅`,
        time: nowTime,
        timestamp: nowTs + 1
      };
      chatHistory.push(enterTransferMsg);
      pruneRoomChatHistory(resolvedTargetRoomId);
      io.to(resolvedTargetRoomId).emit('message', enterTransferMsg);
    }

    saveHistory();
  }

  if (oldRoom && oldRoom !== 'خارج الغرف') {
    broadcastRoomUsers(oldRoom);
  }
  if (resolvedTargetRoomId && resolvedTargetRoomId !== 'خارج الغرف') {
    broadcastRoomUsers(resolvedTargetRoomId);
  }
  broadcastAllUsers();
  broadcastRoomsUpdate();
}

// Wall Posts Persistence via Data Layer (الحائط - حفظ دائم للمنشورات مع سقف الحذف التلقائي)
let wallPosts: WallPost[] = [];
let wallVersionCounter = 1;

function bumpWallVersion() {
  wallVersionCounter += 1;
}

function getWallVersionString(): string {
  const topId = wallPosts[0]?.id || 'empty';
  return `${wallPosts.length}:${wallVersionCounter}:${topId}`;
}

function computeVersionHash(payload: unknown): string {
  try {
    return crypto.createHash('sha1').update(JSON.stringify(payload ?? null)).digest('hex').slice(0, 12);
  } catch {
    return String(Date.now());
  }
}

const cachedConfigVersionHashes: Record<string, string> = {};

function invalidateConfigVersionCache(key?: string) {
  if (!key) {
    for (const k of Object.keys(cachedConfigVersionHashes)) {
      delete cachedConfigVersionHashes[k];
    }
    return;
  }
  delete cachedConfigVersionHashes[key];
}

function getOrComputeCachedVersionHash(key: string, computePayload: () => unknown): string {
  if (!cachedConfigVersionHashes[key]) {
    cachedConfigVersionHashes[key] = computeVersionHash(computePayload());
  }
  return cachedConfigVersionHashes[key];
}

function getConfigVersionsSnapshot() {
  const roomsLive = getChatRoomsWithLiveCounts();
  const roomStats = getRoomStatistics();
  const recent = getRecentLogins();
  const publicSec = {
    marqueeTicker: serverSecurity.marqueeTicker,
    guestsAllowed: serverSecurity.guestsAllowed,
    emergencyLockdown: serverSecurity.emergencyLockdown,
    blockExternalLinks: serverSecurity.blockExternalLinks,
    awayDelaySeconds: serverSecurity.awayDelaySeconds,
    reconnectBannerDelaySeconds: serverSecurity.reconnectBannerDelaySeconds
  };
  return {
    emblems: getOrComputeCachedVersionHash('emblems', () => emblemsConfig),
    membershipCatalog: getOrComputeCachedVersionHash('membershipCatalog', () => membershipDesignCatalog),
    shortcuts: getOrComputeCachedVersionHash('shortcuts', () => chatShortcuts),
    roles: getOrComputeCachedVersionHash('roles', () => ({ rolesConfig, rolePermissions })),
    appearance: getOrComputeCachedVersionHash('appearance', () => ({ globalAppearance, generalWelcomeSettings, likesSettings })),
    quality: getOrComputeCachedVersionHash('quality', () => chatQualitySettings),
    rooms: computeVersionHash(roomsLive.map((r) => ({ id: r.id, name: r.name, desc: r.desc, bannerUrl: r.bannerUrl, isPasswordProtected: r.isPasswordProtected, activeVoiceCount: r.activeVoiceCount }))),
    roomStats: computeVersionHash(roomStats.map((rs) => ({ id: rs.id, count: rs.count, voiceCount: rs.voiceCount }))),
    serverSecurity: getOrComputeCachedVersionHash('serverSecurity', () => publicSec),
    recentLogins: computeVersionHash(recent.map((r) => `${r.username}:${r.timestamp}`)),
    retentionLimits: getOrComputeCachedVersionHash('retentionLimits', () => messageRetentionLimits),
    wall: getWallVersionString(),
    stories: computeVersionHash(
      getActiveStories().map((s) => ({
        id: s.id,
        likes: s.likes,
        commentsCount: s.comments?.length || 0
      }))
    )
  };
}

function serializeWallPostForClient(post: WallPost): WallPost {
  if (!post || !('flag' in post)) return post;
  const { flag: _omitFlag, ...rest } = post;
  return rest;
}

function saveWallPosts() {
  pruneWallPosts();
  bumpWallVersion();
  try {
    dataManager.saveWallPosts(wallPosts);
  } catch (err) {
    console.error('[Data Layer] Error saving wall posts:', err);
  }
}

function loadWallPosts() {
  try {
    const data = dataManager.loadWallPostsSync<WallPost[]>([]);
    if (Array.isArray(data)) {
      wallPosts = data.map((p) => {
        let ts = p.timestamp;
        if (!ts && p.id?.startsWith('post-')) {
          const parsed = Number(p.id.replace('post-', ''));
          if (parsed && !isNaN(parsed)) ts = parsed;
        }
        const { flag: _omitFlag, ...postRest } = p;
        return {
          ...postRest,
          timestamp: ts || Date.now(),
          updatedAt: p.updatedAt || ts || Date.now(),
          time: p.time && p.time !== 'الآن' ? p.time : getCurrentTimeString()
        };
      });
      bumpWallVersion();
      return;
    }
  } catch (err) {
    console.error('[Data Layer] Error loading wall posts:', err);
  }
  wallPosts = [];
}
loadWallPosts();

// 24-Hour Stories / Khwater Persistence via Data Layer (نظام الخواطر والحالات - حذف تلقائي بعد 24 ساعة)
let storiesList: StoryItem[] = [];

function getActiveStories(): StoryItem[] {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  return storiesList
    .filter((s) => s.createdAt > cutoff)
    .map((s) => {
      if (!('flag' in s)) return s;
      const { flag: _omitFlag, ...rest } = s;
      return rest;
    });
}

function saveStories() {
  try {
    dataManager.saveStories(getActiveStories());
  } catch (err) {
    console.error('[Data Layer] Error saving stories:', err);
  }
}

function loadStories() {
  try {
    const data = dataManager.loadStoriesSync<StoryItem[]>([]);
    if (Array.isArray(data)) {
      const cutoff = Date.now() - 24 * 60 * 60 * 1000;
      storiesList = data.filter((s: StoryItem) => s.createdAt > cutoff);
      return;
    }
  } catch (err) {
    console.error('[Data Layer] Error loading stories:', err);
  }
  storiesList = [];
}
loadStories();

/**
 * Comprehensive collection hydration from Data Layer / Cloud / MongoDB storage.
 * Ensures in-memory state matches persistent database state whenever connection
 * warms up or reconnects, without risk of wiping existing data with blank defaults.
 */
export function hydrateAllCollectionsFromStorage(isRehydration = false) {
  try {
    loadRolesConfig();
    loadRolePermissions();
    loadOfflinePrivateMessages();
    loadPrivateChatHistory();
    loadMonitoredWords();
    loadAuditLogs();
    loadMessageRetentionLimits();
    loadServerSecurity();
    loadLikesSettings();
    loadStaffMemos();
    loadChatRooms();
    loadRoomSettings();
    loadGlobalAppearance();
    loadChatQualitySettings();
    loadMembershipDesignCatalog();
    loadGeneralWelcome();
    loadEmblems();
    loadShortcuts();
    loadWallPosts();
    loadStories();
    loadRecentLogins();
    loadBans();
    loadJailed();
    loadMutes();

    // Rehydrate registered members
    const loadedMembers = dataManager.loadMembersSync<Record<string, RegisteredMemberInfo>>({});
    if (loadedMembers && typeof loadedMembers === 'object' && Object.keys(loadedMembers).length > 0) {
      Object.assign(registeredMembers, loadedMembers);
      for (const m of Object.values(registeredMembers)) {
        if (m && m.password && !m.password.startsWith('$2a$') && !m.password.startsWith('$2b$')) {
          m.password = hashPassword(m.password);
        }
      }
    }

    // Ensure primary admin account always possesses supreme role 'hassan' and honors ADMIN_PASSWORD env var if configured
    syncAdminEnvPassword();

    // Rehydrate active user sessions (dropping stale/revoked token versions)
    const loadedSessions = dataManager.loadSessionsSync<Record<string, UserSession>>({});
    if (loadedSessions && typeof loadedSessions === 'object') {
      (Object.values(loadedSessions) as UserSession[]).forEach((sess) => {
        if (sess && sess.sessionToken && sess.user && !sess.isExplicitlyLoggedOut) {
          if (sess.user.username.toLowerCase() === 'admin') {
            sess.user.role = 'hassan';
          }
          const minVer = getMemberTokenVersion(sess.user.username);
          const sessVer = typeof sess.tokenVersion === 'number' && sess.tokenVersion >= 1 ? sess.tokenVersion : 1;
          if (sessVer >= minVer && !revokedSessionTokens.has(sess.sessionToken)) {
            activeSessions.set(sess.sessionToken, sess);
            usernameToSessionMap.set(sess.user.username.toLowerCase(), sess.sessionToken);
          }
        }
      });
    }

    // Rehydrate recent chat history in-place so botEngine keeps the live reference
    const historyData = dataManager.loadChatHistorySync<StoredMessage[]>([]);
    if (Array.isArray(historyData) && historyData.length > 0) {
      chatHistory.splice(0, chatHistory.length, ...historyData);
    }

    invalidateConfigVersionCache();
    regMemberLowerKeyMap.clear();

    if (isRehydration) {
      rebuildAuditMapsFromMembers();
      ensureAllFlagNumbers();
      if (typeof botEngine !== 'undefined') {
        botEngine.rehydrateFromStorage(false);
      }
      console.log('🔄 [Data Layer] Re-hydrated all collections from persistent/cloud storage.');
      io.emit('rolesConfigUpdated', rolesConfig);
      io.emit('rolePermissionsUpdated', rolePermissions);
      io.emit('roomsUpdated', getChatRoomsWithLiveCounts());
      io.emit('roomStatsUpdated', getRoomStatistics());
      io.emit(
        'wallPosts',
        wallPosts.slice(0, Math.max(1, messageRetentionLimits.wallMaxPosts || 100)).map(serializeWallPostForClient)
      );
      io.emit('storiesUpdated', getActiveStories());
      io.emit('shortcutsUpdated', chatShortcuts);
      io.emit('emblemsUpdated', emblemsConfig);
      io.emit('membershipDesignCatalogUpdated', membershipDesignCatalog);
      io.emit('falconAssetsUpdated', {
        falconChatBanner: emblemsConfig.falconChatBanner,
        falconAvatarIcon: emblemsConfig.falconAvatarIcon
      });
      io.emit('globalAppearanceUpdated', globalAppearance);
      io.emit('chatQualityUpdated', chatQualitySettings);
      broadcastAllRegisteredMembers();
      emitToAuthorizedStaff('monitoredWordsUpdated', monitoredWords);
      io.emit('messageRetentionLimitsUpdated', messageRetentionLimits);
      io.emit('recentLoginsUpdated', getRecentLogins());
    }
  } catch (err) {
    console.error('Error during hydrateAllCollectionsFromStorage:', err);
  }
}

// Initialize Bot System Engine & Controller (bot.js & botController.js)
const botEngine = createBotEngine({
  io,
  dataManager,
  users,
  registeredMembers,
  chatRooms,
  chatHistory,
  getCurrentTimeString,
  saveHistory,
  pruneRoomChatHistory,
  saveMembers,
  broadcastRoomUsers,
  broadcastAllUsers,
  broadcastAllRegisteredMembers,
  broadcastRoomsUpdate,
  logMonitorEvent,
  hashPassword,
  privateChatHistory,
  getPmPairKey,
  savePrivateChatHistory,
  offlinePrivateMessages,
  saveOfflinePrivateMessages,
  assignOrGetFlagNumber
});

const botController = registerBotController({
  io,
  botEngine,
  users,
  findSocketUser,
  logMonitorEvent
});

// Hook into DataManager hydration event whenever MongoDB / Cloud storage completes cache warmup
dataManager.onHydrated(() => {
  hydrateAllCollectionsFromStorage(true);
});

// 24-Hour Auto-cleanup Interval: deletes stories older than 24 hours automatically and unlinks local files
setInterval(() => {
  const prevCount = storiesList.length;
  const now = Date.now();
  const cutoff = now - 24 * 60 * 60 * 1000;
  
  // Unlink local media files for expired stories to keep disk storage lean
  storiesList.forEach((s) => {
    if (s.createdAt <= cutoff && s.mediaUrl && s.mediaUrl.startsWith('/uploads/')) {
      const filename = path.basename(s.mediaUrl);
      const filePath = path.join(uploadsDir, filename);
      if (fs.existsSync(filePath)) {
        try { fs.unlinkSync(filePath); } catch {}
      }
    }
  });

  const cleaned = getActiveStories();
  if (cleaned.length !== prevCount) {
    storiesList = cleaned;
    saveStories();
    io.emit('storiesUpdated', storiesList);
  }
}, 5 * 60 * 1000);

// Active Engagement Ticker (حساب التفاعل تلقائياً كل دقيقة للتواجد والمايك)
setInterval(() => {
  let hasChanges = false;
  users.forEach((u) => {
    const reg = getRegisteredMember(u.username)?.member;
    if (reg) {
      if (!reg.engagement) {
        reg.engagement = getDefaultEngagement();
      }
      reg.engagement.activeTimeMinutes += 1;
      if (u.micSlot !== null || u.isSpeaking) {
        reg.engagement.micTimeMinutes += 1;
      }
      const updated = calculateEngagementStars(reg.engagement);
      reg.engagement.starsLevel = updated.starsLevel;
      reg.engagement.progressPercent = updated.progressPercent;
      u.engagement = reg.engagement;
      hasChanges = true;
    }
  });

  if (hasChanges) {
    saveMembers();
  }
}, 60000);

// Shared server-wide map for emoji reactions deduplication across all sockets
const messageReactionsUsersMap = new Map<string, Record<string, string[]>>();

// Server-wide deduplication cache for clientTempId retries across momentary socket reconnects
const recentClientTempIds = new Map<string, { id: string; ts: number }>();
const registerClientTempId = (key: string, id: string) => {
  const now = Date.now();
  recentClientTempIds.set(key, { id, ts: now });
  if (recentClientTempIds.size > 500) {
    for (const [k, v] of recentClientTempIds.entries()) {
      if (now - v.ts > 60000 || recentClientTempIds.size > 350) {
        recentClientTempIds.delete(k);
      }
      if (recentClientTempIds.size <= 350) break;
    }
  }
};

// Periodic Server Memory Cleanup & Rate Limiter Pruning (every 10 minutes)
setInterval(() => {
  try {
    const now = Date.now();
    // 1. Prune userLikeCooldownMap (entries older than 2 minutes)
    for (const [key, timestamp] of userLikeCooldownMap.entries()) {
      if (now - timestamp > 2 * 60 * 1000) {
        userLikeCooldownMap.delete(key);
      }
    }

    // 2. Prune userLastMessageTime (entries older than 5 minutes)
    for (const username of Object.keys(userLastMessageTime)) {
      if (now - userLastMessageTime[username] > 5 * 60 * 1000) {
        delete userLastMessageTime[username];
      }
    }

    // 3. Cap in-memory filterAlerts to latest 200 items to avoid swelling
    if (filterAlerts.length > 200) {
      filterAlerts.splice(0, filterAlerts.length - 200);
    }

    // 4. Preserve monitorLogs permanently until manually cleared by admin (cap only if exceeding 10,000)
    if (monitorLogs.length > 10000) {
      monitorLogs.splice(10000);
    }

    // 5. Cap ipToAccountsMap if it grows beyond 2000 entries
    if (ipToAccountsMap.size > 2000) {
      const keysToDelete = Array.from(ipToAccountsMap.keys()).slice(0, 500);
      keysToDelete.forEach((k) => {
        ipToAccountsMap.delete(k);
        ipToDeviceMap.delete(k);
        ipToCountryMap.delete(k);
        ipToFingerprintMap.delete(k);
      });
    }

    // 6. Prune expired rate-limiter & security maps
    const filterWindowMs = (serverSecurity.autoIpBanWindowMinutes || 10) * 60 * 1000;
    for (const [ipKey, entries] of ipFilterViolationsMap.entries()) {
      const fresh = entries.filter((v) => now - v.timestamp < filterWindowMs);
      if (fresh.length === 0) ipFilterViolationsMap.delete(ipKey);
      else ipFilterViolationsMap.set(ipKey, fresh);
    }
    for (const [key, entry] of loginAttemptsMap.entries()) {
      if (entry.lockedUntil <= now && now - entry.lockedUntil > 15 * 60 * 1000) {
        loginAttemptsMap.delete(key);
      }
    }
    for (const [key, expiry] of kickedCooldownMap.entries()) {
      if (expiry <= now) kickedCooldownMap.delete(key);
    }
    for (const [key, rl] of ytSearchRateLimitMap.entries()) {
      if (rl.resetAt <= now) ytSearchRateLimitMap.delete(key);
    }
    for (const [key, rl] of httpRateLimitMap.entries()) {
      if (rl.resetAt <= now) httpRateLimitMap.delete(key);
    }
    for (const [key, bucket] of hourlyPointsRewardMap.entries()) {
      if (bucket.resetAt <= now) hourlyPointsRewardMap.delete(key);
    }
    for (const [key, entry] of ytSearchCache.entries()) {
      if (now - entry.ts >= YT_CACHE_TTL_MS) ytSearchCache.delete(key);
    }
    for (const [key, entry] of recentClientTempIds.entries()) {
      if (now - entry.ts > 60_000) recentClientTempIds.delete(key);
    }
    if (messageReactionsUsersMap.size > 500) {
      const activeIds = new Set(chatHistory.map((m) => m.id));
      for (const msgId of messageReactionsUsersMap.keys()) {
        if (!activeIds.has(msgId)) {
          messageReactionsUsersMap.delete(msgId);
        }
      }
    }
  } catch (err) {
    console.warn('[Server Maintenance] Pruning warning:', err);
  }
}, 10 * 60 * 1000);

// Socket connection
io.on('connection', (socket) => {
  // High-performance socket anti-flood & rate limiter middleware
  socket.use(([event], next) => {
    // Whitelist heartbeats, latency pongs, background presence, and critical system hooks
    if (
      event === 'keepAlivePing' ||
      event === 'keepAlivePong' ||
      event === 'userPresenceChange' ||
      event === 'restoreSession' ||
      event === 'syncRoomMessages' ||
      event === 'getBotsAdminState' ||
      event === 'disconnect'
    ) {
      return next();
    }
    const user = findSocketUser(socket.id);
    const isExempt = user && (isSupremeHassan(user) || user.role === 'admin' || user.role === 'super');
    if (!socketFloodGuard.isAllowed(socket.id, Boolean(isExempt))) {
      socket.emit('systemAlert', '⚠️ تم رصد إرسال فائق السرعة (Anti-Flood Guard). يرجى التمهل لثوانٍ قليلة.');
      return;
    }
    next();
  });

  // Attach Bot Management Socket Handlers
  botController.attachSocketHandlers(socket);

  // Determine real client IP and verified country flag across Cloudflare / proxies / direct
  const clientIp = getRealClientIp(socket);
  const hasVerifiedCloudGeo = Boolean(socket.handshake.headers['cf-ray'] || socket.handshake.headers['x-appengine-country'] || process.env.TRUST_CF_HEADER === 'true');
  const cfCountry = hasVerifiedCloudGeo
    ? (((socket.handshake.headers['cf-ipcountry'] || socket.handshake.headers['x-appengine-country']) as string) || '')
    : '';
  const detectedRealFlag = cfCountry && cfCountry !== 'XX' && cfCountry !== 'T1' ? getFlagFromCountryCode(cfCountry) : '';

  const onlineUsersSnapshot = getPresenceSnapshot()
    .filter((u) => (u.presenceState !== 'offline' || u.isBot) && !u.isGhost)
    .map((u) => toPublicConnectedUser(u));
  const currentConnectedCount = onlineUsersSnapshot.filter((u) => u.presenceState !== 'offline').length;
  io.emit('onlineCountUpdated', currentConnectedCount);

  const clientVersions =
    socket.handshake.auth &&
    typeof socket.handshake.auth === 'object' &&
    socket.handshake.auth.cachedVersions &&
    typeof socket.handshake.auth.cachedVersions === 'object'
      ? (socket.handshake.auth.cachedVersions as Record<string, string>)
      : {};
  const srvVersions = getConfigVersionsSnapshot();

  // Send initial configuration payload cleanly, omitting unchanged large config blocks when client cache matches
  socket.emit('initialRoster', {
    onlineCount: currentConnectedCount,
    users: onlineUsersSnapshot,
    needsAdminSetup: isAdminClaimRequired(),
    ...(clientVersions.rooms !== srvVersions.rooms ? { rooms: getChatRoomsWithLiveCounts() } : {}),
    ...(clientVersions.roomStats !== srvVersions.roomStats ? { roomStats: getRoomStatistics() } : {}),
    marqueeTicker: serverSecurity.marqueeTicker,
    ...(clientVersions.recentLogins !== srvVersions.recentLogins ? { recentLogins: getRecentLogins() } : {}),
    ...(clientVersions.retentionLimits !== srvVersions.retentionLimits ? { messageRetentionLimits } : {}),
    versions: srvVersions,
    ...(clientVersions.shortcuts !== srvVersions.shortcuts ? { shortcuts: chatShortcuts } : {}),
    ...(clientVersions.appearance !== srvVersions.appearance
      ? {
          likesSettings,
          globalAppearance,
          generalWelcome: generalWelcomeSettings
        }
      : {}),
    ...(clientVersions.emblems !== srvVersions.emblems ? { emblemsConfig } : {}),
    ...(clientVersions.membershipCatalog !== srvVersions.membershipCatalog ? { membershipDesignCatalog } : {}),
    ...(clientVersions.roles !== srvVersions.roles
      ? {
          rolesConfig,
          rolePermissions
        }
      : {}),
    ...(clientVersions.stories !== srvVersions.stories ? { stories: getActiveStories() } : {}),
    ...(clientVersions.wall !== srvVersions.wall
      ? { wallPosts: wallPosts.slice(0, Math.max(1, messageRetentionLimits.wallMaxPosts || 100)).map(serializeWallPostForClient) }
      : {}),
    ...(clientVersions.serverSecurity !== srvVersions.serverSecurity
      ? {
          serverSecurity: {
            marqueeTicker: serverSecurity.marqueeTicker,
            guestsAllowed: serverSecurity.guestsAllowed,
            emergencyLockdown: serverSecurity.emergencyLockdown,
            blockExternalLinks: serverSecurity.blockExternalLinks,
            awayDelaySeconds: serverSecurity.awayDelaySeconds,
            reconnectBannerDelaySeconds: serverSecurity.reconnectBannerDelaySeconds
          }
        }
      : {}),
    ...(clientVersions.quality !== srvVersions.quality ? { chatQualitySettings } : {})
  });

  const allPublicPresence = getPresenceSnapshot().filter((u) => !u.isGhost).map((u) => toPublicConnectedUser(u));
  if (allPublicPresence.length !== onlineUsersSnapshot.length) {
    socket.emit('allUsers', allPublicPresence);
  }
  socket.emit('allRegisteredMembers', []);

  socket.on('getRecentLogins', () => {
    socket.emit('recentLoginsUpdated', getRecentLogins());
  });

  socket.on('requestRecentLogins', () => {
    socket.emit('recentLoginsUpdated', getRecentLogins());
  });

  socket.on('getMessageRetentionLimits', () => {
    socket.emit('messageRetentionLimitsUpdated', messageRetentionLimits);
  });

  socket.on(
    'syncChatConfig',
    ({
      roomId,
      cachedVersions: syncVersions
    }: { roomId?: string; cachedVersions?: Record<string, string> } = {}) => {
      const user = findSocketUser(socket.id);
      const targetRoomId = roomId || user?.room || 'الغرفة العامة';
      const currentRoomSettings = roomSettingsMap[targetRoomId] || { isChatLocked: false, slowModeSeconds: 0, isVoiceLocked: false };
      const reqVer = syncVersions && typeof syncVersions === 'object' ? syncVersions : {};
      const currentVer = getConfigVersionsSnapshot();
      socket.emit('chatConfigSync', {
        ...(reqVer.rooms !== currentVer.rooms ? { rooms: getChatRoomsWithLiveCounts() } : {}),
        roomSettings: currentRoomSettings,
        ...(reqVer.retentionLimits !== currentVer.retentionLimits ? { messageRetentionLimits } : {}),
        ...(reqVer.recentLogins !== currentVer.recentLogins ? { recentLogins: getRecentLogins() } : {}),
        versions: currentVer,
        ...(reqVer.appearance !== currentVer.appearance
          ? {
              globalAppearance,
              generalWelcome: generalWelcomeSettings,
              likesSettings
            }
          : {}),
        ...(reqVer.emblems !== currentVer.emblems ? { emblemsConfig } : {}),
        ...(reqVer.membershipCatalog !== currentVer.membershipCatalog ? { membershipDesignCatalog } : {}),
        ...(reqVer.roles !== currentVer.roles
          ? {
              rolesConfig,
              rolePermissions
            }
          : {}),
        ...(reqVer.shortcuts !== currentVer.shortcuts ? { shortcuts: chatShortcuts } : {}),
        ...(reqVer.serverSecurity !== currentVer.serverSecurity
          ? {
              serverSecurity: {
                marqueeTicker: serverSecurity.marqueeTicker,
                guestsAllowed: serverSecurity.guestsAllowed,
                emergencyLockdown: serverSecurity.emergencyLockdown,
                blockExternalLinks: serverSecurity.blockExternalLinks,
                awayDelaySeconds: serverSecurity.awayDelaySeconds,
                reconnectBannerDelaySeconds: serverSecurity.reconnectBannerDelaySeconds
              }
            }
          : {}),
        ...(reqVer.quality !== currentVer.quality ? { chatQualitySettings } : {})
      });
      socket.emit('currentLiveBroadcast', serializeLiveBroadcast(activeLiveBroadcasts.get(targetRoomId)));
    }
  );

  // Admin Data on-demand (sent to authorized admin and staff roles with control panel permissions)
  socket.on('getAdminData', () => {
    const admin = findSocketUser(socket.id);
    if (admin && isStaffUser(admin)) {
      socket.emit('adminInitialData', {
        bannedList: Array.from(bannedRecords.values()),
        mutedList: Array.from(mutedRecords.values()),
        staffMemos,
        filterAlerts,
        monitoredWords,
        rolePermissions,
        serverSecurity
      });
      socket.emit('allRegisteredMembers', getAllRegisteredMembersPayload(getRoleLevel(admin.role), socket.id, admin.role));
    }
  });

  socket.on('getRegisteredMembers', () => {
    const admin = findSocketUser(socket.id);
    if (admin && isStaffUser(admin)) {
      socket.emit('allRegisteredMembers', getAllRegisteredMembersPayload(getRoleLevel(admin.role), socket.id, admin.role));
    }
  });

  // Emblems & Custom Emojis Listeners (إدارة وعرض الرموز، السوابر، الهدايا، الستيكرات والفيسات)
  socket.on('getEmblems', () => {
    socket.emit('emblemsUpdated', emblemsConfig);
  });

  socket.on('addEmblem', async ({
    type,
    title,
    imageUrl,
    targetMember,
    requiredRole
  }: {
    type: EmblemType;
    title: string;
    imageUrl: string;
    targetMember?: string;
    requiredRole?: string;
  }) => {
    const admin = findSocketUser(socket.id);
    if (!admin || (!isSupremeHassan(admin) && admin.role !== 'admin' && admin.role !== 'super')) {
      socket.emit('systemAlert', 'إدارة وإضافة الرموز والألقاب محصورة بطاقم الإدارة.');
      return;
    }
    const safeImageUrl = sanitizeUrl(imageUrl);
    if (!safeImageUrl || !type) {
      socket.emit('systemAlert', 'بيانات الرمز أو رابط الصورة غير صالح.');
      return;
    }

    let shortcut: string | undefined = undefined;
    let codeNumber: number | undefined = undefined;

    if (type === 'emoji') {
      // الترقيم التسلسلي التلقائي للفيسات بدءاً من ف1 تصاعدياً
      let maxNum = 0;
      emblemsConfig.items.forEach((item) => {
        if (item.type === 'emoji' && item.shortcut) {
          const match = item.shortcut.match(/^ف(\d+)$/);
          if (match) {
            const n = parseInt(match[1], 10);
            if (!isNaN(n) && n > maxNum) maxNum = n;
          }
        }
      });
      const nextNum = maxNum + 1;
      shortcut = `ف${nextNum}`;
      codeNumber = nextNum;
    }

    const newItem: EmblemItem = {
      id: `emblem-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      type,
      title: sanitizeText(title) || (type === 'emoji' ? `فيس ${shortcut}` : type === 'banner' ? 'لقب مصور' : 'رمز'),
      imageUrl: safeImageUrl,
      shortcut,
      codeNumber,
      targetMember: targetMember ? sanitizeText(targetMember) : undefined,
      requiredRole: requiredRole || 'all',
      createdAt: Date.now(),
      createdBy: admin.username
    };

    emblemsConfig.items.unshift(newItem);
    try {
      await saveEmblems();
    } catch {
      emblemsConfig.items.shift();
      socket.emit('systemAlert', 'تعذر حفظ الرمز في قاعدة البيانات. لم يتم اعتماد التغيير.');
      return;
    }
    io.emit('emblemsUpdated', emblemsConfig);
    logMonitorEvent(
      'security',
      `إضافة أصل جديد في قسم الرموز [${type}] ${shortcut ? `(الكود: ${shortcut})` : ''} بواسطة [${admin.username}]`,
      admin.username
    );
    socket.emit('systemAlert', `تمت إضافة ${type === 'emoji' ? `الفيس بنجاح بالكود التلقائي (${shortcut})` : 'الرمز بنجاح'} ✅`);
  });

  socket.on('deleteEmblem', async ({ id }: { id: string }) => {
    const admin = findSocketUser(socket.id);
    if (!admin || (!isSupremeHassan(admin) && admin.role !== 'admin' && admin.role !== 'super')) {
      socket.emit('systemAlert', 'حذف الرموز محصور بطاقم الإدارة.');
      return;
    }
    const previousItems = emblemsConfig.items;
    emblemsConfig.items = previousItems.filter((item) => item.id !== id);
    if (emblemsConfig.items.length !== previousItems.length) {
      try {
        await saveEmblems();
      } catch {
        emblemsConfig.items = previousItems;
        socket.emit('systemAlert', 'تعذر حفظ حذف الرمز في قاعدة البيانات.');
        return;
      }
      io.emit('emblemsUpdated', emblemsConfig);
      logMonitorEvent('security', `حذف رمز بواسطة [${admin.username}]`, admin.username);
      socket.emit('systemAlert', 'تم حذف الرمز بنجاح 🗑️');
    }
  });

  socket.on('updateEmblemEmojiSize', async ({ emojiSize }: { emojiSize: EmojiSizeSetting }) => {
    const admin = findSocketUser(socket.id);
    if (!admin || (!isSupremeHassan(admin) && admin.role !== 'admin' && admin.role !== 'super')) {
      socket.emit('systemAlert', 'تعديل حجم الفيسات محصور بالإدارة.');
      return;
    }
    if (['small', 'default', 'large'].includes(emojiSize)) {
      const previousEmojiSize = emblemsConfig.emojiSize;
      emblemsConfig.emojiSize = emojiSize;
      try {
        await saveEmblems();
      } catch {
        emblemsConfig.emojiSize = previousEmojiSize;
        socket.emit('systemAlert', 'تعذر حفظ حجم الرموز في قاعدة البيانات.');
        return;
      }
      io.emit('emblemsUpdated', emblemsConfig);
      logMonitorEvent('security', `تعديل حجم عرض الفيسات إلى [${emojiSize}] بواسطة [${admin.username}]`, admin.username);
      socket.emit('systemAlert', `تم ضبط حجم الفيسات الافتراضي إلى (${emojiSize === 'small' ? 'صغير' : emojiSize === 'large' ? 'كبير' : 'افتراضي'}) بنجاح 📏`);
    }
  });

  // تحديث بنر الشات falcon_chat_banner وأيقونة الصقر falcon_avatar_icon
  socket.on(
    'updateFalconAssets',
    async ({
      falconChatBanner,
      falconAvatarIcon
    }: {
      falconChatBanner?: string;
      falconAvatarIcon?: string;
    }) => {
      const admin = findSocketUser(socket.id);
      if (!admin || (!isSupremeHassan(admin) && admin.role !== 'admin' && admin.role !== 'super')) {
        socket.emit('systemAlert', 'تعديل بنر الشات وأيقونة الصقر محصور بطاقم الإدارة.');
        return;
      }

      // Persist uploaded assets on the backend/storage provider, never as browser-only data URLs or unsafe URIs.
      const persistFalconAsset = async (value: string | undefined, fallback: string, filename: string) => {
        if (!value || typeof value !== 'string') return fallback;
        const trimmed = value.trim();
        if (!trimmed) return fallback;
        if (trimmed.startsWith('data:')) {
          if (trimmed.length > 14 * 1024 * 1024) return fallback;
          const match = trimmed.match(/^data:([^;]+);base64,(.+)$/);
          if (match) {
            const mime = match[1].trim().toLowerCase();
            if (!/^image\/(?:png|jpeg|jpg|webp|gif)$/i.test(mime)) {
              return fallback;
            }
            const rawBuffer = Buffer.from(match[2], 'base64');
            if (!rawBuffer.length || rawBuffer.length > 10 * 1024 * 1024 || !validateMediaMagicBytes(rawBuffer)) {
              return fallback;
            }

            // Railway's local filesystem is ephemeral. If no external media store is
            // configured, keep the small branding asset in MongoDB as a data URL so
            // every instance and every device can load the same image after restart.
            if (!storageManager.isExternal()) {
              return trimmed;
            }

            const uploaded = await storageManager.saveBuffer(rawBuffer, filename, mime, 'falcon-assets');
            const configuredOrigin = process.env.PUBLIC_SERVER_URL || process.env.SERVER_PUBLIC_URL || process.env.STORAGE_PUBLIC_URL_PREFIX;
            const socketOrigin = configuredOrigin || `https://${socket.handshake.headers.host || 'localhost'}`;
            return /^https?:\/\//i.test(uploaded.url)
              ? uploaded.url
              : `${socketOrigin.replace(/\/$/, '')}${uploaded.url.startsWith('/') ? uploaded.url : `/${uploaded.url}`}`;
          }
          return fallback;
        }
        return sanitizeUrl(trimmed) || fallback;
      };

      let changed = false;
      if (falconChatBanner !== undefined) {
        emblemsConfig.falconChatBanner = await persistFalconAsset(
          falconChatBanner,
          DEFAULT_FALCON_CHAT_BANNER,
          'falcon-chat-banner.png'
        );
        globalAppearance.bannerUrl = emblemsConfig.falconChatBanner;
        changed = true;
      }
      if (falconAvatarIcon !== undefined) {
        emblemsConfig.falconAvatarIcon = await persistFalconAsset(
          falconAvatarIcon,
          DEFAULT_FALCON_AVATAR_ICON,
          'falcon-avatar-icon.png'
        );
        globalAppearance.logoUrl = emblemsConfig.falconAvatarIcon;
        changed = true;
      }

      if (changed) {
        try {
          await Promise.all([saveEmblems(), saveGlobalAppearance()]);
        } catch {
          socket.emit('systemAlert', 'تعذر حفظ الصور وإعدادات المظهر في قاعدة البيانات. لم يتم اعتماد التغيير.');
          return;
        }
        io.emit('emblemsUpdated', emblemsConfig);
        io.emit('falconAssetsUpdated', {
          falconChatBanner: emblemsConfig.falconChatBanner,
          falconAvatarIcon: emblemsConfig.falconAvatarIcon
        });
        io.emit('globalAppearanceUpdated', globalAppearance);
        logMonitorEvent(
          'security',
          `تحديث بنر الشات أو أيقونة صقر حسان برو الرسمية بواسطة [${admin.username}]`,
          admin.username
        );
        socket.emit('systemAlert', 'تم حفظ وتطبيق بنر الشات وأيقونة الصقر بنجاح على كامل النظام 🦅✨');
      }
    }
  );

  // تعيين السوابر / البنر المصور للعضو
  socket.on('assignMemberBanner', async ({ username, bannerUrl }: { username: string; bannerUrl?: string }) => {
    const actor = users.find((u) => u.id === socket.id);
    if (!actor || actor.role === 'guest') return;
    if (actor.isJailed || actor.isTextMuted) {
      socket.emit('systemAlert', 'لا يمكنك تعديل البنر أثناء التقييد الإداري.');
      return;
    }
    const cleanUser = sanitizeText(username)?.trim();
    if (!cleanUser) return;

    const canAssign = isSupremeHassan(actor) || actor.role === 'admin' || actor.role === 'super' || hasPermission(actor.role, 'canAssignBanner') || getRoleLevel(actor.role) >= 75;

    if (!canAssign) {
      socket.emit('systemAlert', 'تعيين البنر محصور بطاقم الإدارة أو الرتب الممنوحة هذه الصلاحية.');
      return;
    }
    if (!checkHttpRateLimit('assignBanner', actor.username.toLowerCase(), 6, 60_000)) {
      socket.emit('systemAlert', '⏳ يرجى الانتظار قليلاً قبل تحديث بنر عضو آخر.');
      return;
    }

    const rawBanner = typeof bannerUrl === 'string' ? bannerUrl.trim() : '';
    let cleanBannerUrl: string | undefined;
    if (rawBanner) {
      const persisted = await ensureMediaUrlNotBase64(rawBanner);
      if (!persisted) {
        socket.emit('systemAlert', 'رابط البنر غير صالح أو غير آمن.');
        return;
      }
      cleanBannerUrl = persisted;
    }

    users.forEach((u) => {
      if (u.username.toLowerCase() === cleanUser.toLowerCase()) {
        u.nameBannerUrl = cleanBannerUrl;
      }
    });

    const regFoundBanner = getRegisteredMember(cleanUser);
    if (regFoundBanner) {
      regFoundBanner.member.nameBannerUrl = cleanBannerUrl;
      saveMembers();
    }

    // Update nameBannerUrl across historical messages in chat and wall posts
    chatHistory.forEach((msg) => {
      if (msg.username.toLowerCase() === cleanUser.toLowerCase()) {
        msg.nameBannerUrl = cleanBannerUrl;
      }
    });
    saveHistory();

    wallPosts.forEach((post) => {
      let modified = false;
      if (post.username.toLowerCase() === cleanUser.toLowerCase()) {
        post.nameBannerUrl = cleanBannerUrl;
        modified = true;
      }
      if (post.comments) {
        post.comments.forEach((cm) => {
          if (cm.username.toLowerCase() === cleanUser.toLowerCase()) {
            cm.nameBannerUrl = cleanBannerUrl;
            modified = true;
          }
        });
      }
      if (modified) {
        post.updatedAt = Date.now();
      }
    });
    saveWallPosts();

    io.emit('userStyleUpdated', {
      username: cleanUser,
      nameBannerUrl: cleanBannerUrl
    });

    const targetUser = users.find((u) => u.username.toLowerCase() === cleanUser.toLowerCase());
    if (targetUser?.room) {
      broadcastRoomUsers(targetUser.room);
    }

    logMonitorEvent(
      'role',
      `${cleanBannerUrl ? 'تثبيت بنر مصور' : 'إزالة البنر المصور'} لـ [${cleanUser}] بواسطة [${actor.username}]`,
      actor.username,
      cleanUser
    );
    socket.emit('systemAlert', cleanBannerUrl ? `تم تثبيت البنر المصور لـ [${cleanUser}] بنجاح 🌟` : `تمت إزالة البنر المصور لـ [${cleanUser}] والعودة للاسم النصي.`);
  });

  // منح أيقونة هدية أو وسام للعضو يظهر بجانب اسمه في المتواجدين
  socket.on('grantMemberGift', ({ username, giftUrl, giftTitle }: { username: string; giftUrl: string; giftTitle?: string }) => {
    const actor = users.find((u) => u.id === socket.id);
    if (!actor || (!isSupremeHassan(actor) && !hasPermission(actor.role, 'canAssignBadge') && actor.role !== 'admin' && actor.role !== 'super' && getRoleLevel(actor.role) < 75)) {
      socket.emit('systemAlert', 'منح الأوسمة والهدايا للأعضاء محصور بطاقم الإدارة أو الرتب الممنوحة هذه الصلاحية.');
      return;
    }
    const cleanUser = sanitizeText(username)?.trim();
    if (!cleanUser || !giftUrl) return;
    const cleanGiftUrl = sanitizeSafeGiftOrEmblemUrl(giftUrl);
    if (!cleanGiftUrl) {
      socket.emit('systemAlert', 'رابط الوسام أو الهدية غير صالح.');
      return;
    }

    const regGiftFound = getRegisteredMember(cleanUser);
    const liveGiftMatches = users.filter((u) => u.username.toLowerCase() === cleanUser.toLowerCase());
    if (!regGiftFound && liveGiftMatches.length === 0) {
      socket.emit('systemAlert', 'لم يتم العثور على هذا العضو.');
      return;
    }

    liveGiftMatches.forEach((u) => {
      if (!u.giftBadges) u.giftBadges = [];
      if (!u.giftBadges.includes(cleanGiftUrl)) {
        u.giftBadges.push(cleanGiftUrl);
      }
    });

    if (regGiftFound) {
      if (!regGiftFound.member.giftBadges) regGiftFound.member.giftBadges = [];
      if (!regGiftFound.member.giftBadges.includes(cleanGiftUrl)) {
        regGiftFound.member.giftBadges.push(cleanGiftUrl);
      }
      saveMembers();
    }

    const updatedGiftBadges = regGiftFound?.member.giftBadges || liveGiftMatches[0]?.giftBadges || [cleanGiftUrl];
    io.emit('userStyleUpdated', {
      username: regGiftFound?.key || cleanUser,
      giftBadges: updatedGiftBadges
    });
    const targetUser = liveGiftMatches[0];
    if (targetUser?.room) {
      broadcastRoomUsers(targetUser.room);
    }

    logMonitorEvent('likes', `منح هدية/وسام شرفي [${giftTitle || 'وسام'}] لـ [${cleanUser}] بواسطة [${actor.username}]`, actor.username, cleanUser);
    socket.emit('systemAlert', `تم منح الوسام الشرفي لـ [${cleanUser}] بنجاح 🎖️`);
  });

  // إزالة أيقونة هدية أو وسام من العضو
  socket.on('removeMemberGift', ({ username, giftUrl }: { username: string; giftUrl: string }) => {
    const actor = users.find((u) => u.id === socket.id);
    if (!actor || (!isSupremeHassan(actor) && actor.role !== 'admin' && actor.role !== 'super')) {
      socket.emit('systemAlert', 'حذف أوسمة الأعضاء محصور بطاقم الإدارة.');
      return;
    }
    const cleanUser = sanitizeText(username)?.trim();
    if (!cleanUser || !giftUrl) return;

    users.forEach((u) => {
      if (u.username.toLowerCase() === cleanUser.toLowerCase() && u.giftBadges) {
        u.giftBadges = u.giftBadges.filter((g) => g !== giftUrl);
      }
    });

    const regRemoveFound = getRegisteredMember(cleanUser);
    if (regRemoveFound?.member.giftBadges) {
      regRemoveFound.member.giftBadges = regRemoveFound.member.giftBadges.filter((g) => g !== giftUrl);
      saveMembers();
    }

    io.emit('userStyleUpdated', {
      username: regRemoveFound?.key || cleanUser,
      giftBadges: regRemoveFound?.member.giftBadges || []
    });
    const targetUser = users.find((u) => u.username.toLowerCase() === cleanUser.toLowerCase());
    if (targetUser?.room) {
      broadcastRoomUsers(targetUser.room);
    }

    socket.emit('systemAlert', `تمت إزالة الوسام الشرفي من [${cleanUser}].`);
  });

  // إهداء هدية فاخرة من عضو لآخر مع خصم النقاط والتحقق وحفظها والظهور الدائم بجانب اسمه
  socket.on('sendMemberGift', ({
    targetUsername,
    giftUrl,
    giftTitle,
    giftName,
    giftIcon,
    giftMessage,
    giftCost
  }: {
    targetUsername: string;
    giftUrl?: string;
    giftTitle?: string;
    giftName?: string;
    giftIcon?: string;
    giftMessage?: string;
    giftCost?: number;
  }) => {
    const actor = users.find((u) => u.id === socket.id);
    if (!actor || actor.isJailed) return;
    const nowGift = Date.now();
    const lastGiftAt = ((actor as any)._lastGiftSentAt as number) || 0;
    if (nowGift - lastGiftAt < 2000) {
      socket.emit('systemAlert', '⏳ يرجى الانتظار ثانيتين بين إرسال الهدايا.');
      return;
    }
    const cleanTarget = sanitizeText(targetUsername)?.trim();
    const resolvedTitle = giftTitle || giftName || 'هدية فاخرة';
    const cleanGiftUrl = sanitizeSafeGiftOrEmblemUrl(giftUrl, giftIcon || '🎁');
    if (!cleanTarget || !cleanGiftUrl) {
      socket.emit('systemAlert', 'بيانات الهدية أو الرابط غير صالحة.');
      return;
    }

    const targetOnline = users.find((u) => u.username.toLowerCase() === cleanTarget.toLowerCase());
    const regFound = getRegisteredMember(cleanTarget);
    if (!targetOnline && !regFound) {
      socket.emit('systemAlert', 'المستخدم المستهدف غير موجود.');
      return;
    }
    const resolvedTargetName = regFound?.key || targetOnline?.username || cleanTarget;

    const parsedCost = Number.isFinite(Number(giftCost)) ? Math.min(10000000, Math.max(0, Math.floor(Number(giftCost)))) : 0;
    if (parsedCost > 0) {
      if ((actor.points || 0) < parsedCost) {
        socket.emit('systemAlert', `رصيد نقاطك (${actor.points || 0}) غير كافٍ لإرسال هذه الهدية (تكلفتها ${parsedCost} نقطة).`);
        return;
      }
      actor.points = (actor.points || 0) - parsedCost;
      const regActor = getRegisteredMember(actor.username)?.member;
      if (regActor) {
        regActor.points = actor.points;
        saveMembers();
      }
      socket.emit('userPointsUpdated', { points: actor.points, reason: `إهداء ${(sanitizeText(resolvedTitle) || 'هدية').slice(0, 60)}`, added: -parsedCost });
    }
    (actor as any)._lastGiftSentAt = nowGift;

    // 1. Update online user records (capped to 30 badges)
    users.forEach((u) => {
      if (u.username.toLowerCase() === resolvedTargetName.toLowerCase()) {
        if (!u.giftBadges) u.giftBadges = [];
        u.giftBadges = [cleanGiftUrl, ...u.giftBadges.filter((g) => g !== cleanGiftUrl)].slice(0, 30);
      }
    });

    // 2. Persist in existing registered members database
    if (regFound) {
      if (!regFound.member.giftBadges) regFound.member.giftBadges = [];
      regFound.member.giftBadges = [cleanGiftUrl, ...regFound.member.giftBadges.filter((g) => g !== cleanGiftUrl)].slice(0, 30);
      saveMembers();
    }

    // 3. Broadcast updated giftBadges across all clients
    const finalGifts = regFound?.member.giftBadges || targetOnline?.giftBadges || [cleanGiftUrl];
    io.emit('userStyleUpdated', {
      username: resolvedTargetName,
      giftBadges: finalGifts
    });

    if (targetOnline?.room) {
      broadcastRoomUsers(targetOnline.room);
    }
    broadcastAllUsers();

    const cleanTitle = (sanitizeText(resolvedTitle) || 'هدية فاخرة').slice(0, 60);
    const cleanMsg = giftMessage ? (sanitizeText(giftMessage)?.trim() || '').slice(0, 200) : '';

    // 4. Send direct real-time alert to recipient socket
    for (const s of io.sockets.sockets.values()) {
      const sUser = users.find((u) => u.id === s.id);
      if (sUser && sUser.username.toLowerCase() === resolvedTargetName.toLowerCase()) {
        s.emit('giftReceivedAlert', {
          fromUsername: actor.username,
          fromAvatar: actor.avatarUrl,
          giftTitle: cleanTitle,
          giftUrl: cleanGiftUrl,
          giftMessage: cleanMsg || 'مع خالص التقدير والمودة 🌹'
        });
      }
    }

    // 5. Broadcast celebratory announcement in the room
    const targetRoom = actor.room || targetOnline?.room || 'الغرفة العامة';
    const giftAnnouncementText = `🎁✨ أهدى [${actor.username}] هدية فاخرة [${cleanTitle}] إلى صاحب الحساب المحترم [${resolvedTargetName}]!${cleanMsg ? `\n💌 الإهداء: "${cleanMsg}"` : ''}`;

    const announcementMsg: StoredMessage = {
      id: `gift-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      room: targetRoom,
      username: 'نظام الهدايا 🎁',
      avatarUrl: cleanGiftUrl,
      text: giftAnnouncementText,
      time: getCurrentTimeString(),
      timestamp: Date.now(),
      badge: 'إهداء هدية 🎁',
      badgeColor: 'bg-gradient-to-r from-amber-500 via-rose-500 to-amber-600 text-white shadow-xs',
      nameColor: '#d97706',
      isGiftAnnouncement: true,
      giftBadges: [cleanGiftUrl],
      giftInfo: {
        fromUsername: actor.username,
        toUsername: resolvedTargetName,
        giftTitle: cleanTitle,
        giftUrl: cleanGiftUrl,
        giftMessage: cleanMsg
      }
    };

    chatHistory.push(announcementMsg);
    pruneRoomChatHistory(targetRoom);
    saveHistory();

    io.to(targetRoom).emit('message', announcementMsg);

    logMonitorEvent('likes', `أهدى [${actor.username}] هدية [${cleanTitle}] إلى [${resolvedTargetName}]`, actor.username, resolvedTargetName);
    socket.emit('systemAlert', `تم إهداء وتثبيت [${cleanTitle}] لـ [${resolvedTargetName}] بنجاح 🎁✨`);
  });

  // تعيين الهدية النشطة المرافقة للاسم من قائمة الهدايا المستلمة
  socket.on('setActiveMemberGift', ({ username, giftUrl }: { username: string; giftUrl: string }) => {
    const actor = users.find((u) => u.id === socket.id);
    if (!actor) return;
    const cleanUser = sanitizeText(username)?.trim();
    const cleanGiftUrl = sanitizeSafeGiftOrEmblemUrl(giftUrl);
    if (!cleanUser || !cleanGiftUrl) return;
    const isAdminActor = isSupremeHassan(actor) || actor.role === 'admin' || actor.role === 'super';
    if (actor.username.toLowerCase() !== cleanUser.toLowerCase() && !isAdminActor) {
      return;
    }

    const regPinFound = getRegisteredMember(cleanUser);
    if (!isAdminActor) {
      const ownedBadges = [
        ...(Array.isArray(actor.giftBadges) ? actor.giftBadges : []),
        ...(Array.isArray(regPinFound?.member.giftBadges) ? regPinFound!.member.giftBadges : [])
      ];
      if (!ownedBadges.includes(cleanGiftUrl)) {
        socket.emit('systemAlert', 'لا يمكنك تثبيت هدية غير موجودة في قائمة هداياك المستلمة.');
        return;
      }
    }

    users.forEach((u) => {
      if (u.username.toLowerCase() === cleanUser.toLowerCase()) {
        if (!u.giftBadges) u.giftBadges = [];
        u.giftBadges = [cleanGiftUrl, ...u.giftBadges.filter((g) => g !== cleanGiftUrl)].slice(0, 30);
      }
    });

    if (regPinFound?.member.giftBadges) {
      regPinFound.member.giftBadges = [cleanGiftUrl, ...regPinFound.member.giftBadges.filter((g) => g !== cleanGiftUrl)].slice(0, 30);
      saveMembers();
    }

    io.emit('userStyleUpdated', {
      username: regPinFound?.key || cleanUser,
      giftBadges: regPinFound?.member.giftBadges || [cleanGiftUrl]
    });
    broadcastAllUsers();
    socket.emit('systemAlert', 'تم تثبيت هديتك المرافقة لاسمك بنجاح 🎁✨');
  });

  // General Welcome Settings Listeners (إدارة الرسائل الترحيبية العامة للشات من لوحة التحكم)
  socket.on('getGeneralWelcome', () => {
    socket.emit('generalWelcomeUpdated', generalWelcomeSettings);
  });

  socket.on('updateGeneralWelcome', ({ enabled, message, title }: Partial<GeneralWelcomeSettings>) => {
    const admin = findSocketUser(socket.id);
    if (!admin || (!isSupremeHassan(admin) && admin.role !== 'admin' && admin.role !== 'super')) {
      socket.emit('systemAlert', 'تعديل رسائل الترحيب العامة محصور بطاقم الإدارة.');
      return;
    }
    if (enabled !== undefined) generalWelcomeSettings.enabled = Boolean(enabled);
    if (message !== undefined) generalWelcomeSettings.message = sanitizeText(message);
    if (title !== undefined) generalWelcomeSettings.title = sanitizeText(title);
    saveGeneralWelcome();
    io.emit('generalWelcomeUpdated', generalWelcomeSettings);
    logMonitorEvent('security', `تحديث رسالة الترحيب العامة للشات بواسطة ${admin.username}`, admin.username);
    socket.emit('systemAlert', 'تم حفظ وتحديث الرسالة الترحيبية العامة بنجاح ✅');
  });

  // Role Config & Permissions Listeners (إدارة وتعديل وإضافة الرتب والصلاحيات ديناميكياً)
  socket.on('getRolesConfig', () => {
    socket.emit('rolesConfigUpdated', rolesConfig);
    socket.emit('rolePermissionsUpdated', rolePermissions);
  });

  socket.on('saveRole', ({ role, permissions }: { role: RoleDefinition; permissions?: Partial<RolePermissions> }) => {
    const admin = findSocketUser(socket.id);
    if (!admin) {
      socket.emit('systemAlert', 'يجب تسجيل الدخول أولاً لإدارة الرتب.');
      return;
    }

    const actorLevel = getRoleLevel(admin.role);
    const adminBaseLevel = getRoleLevel('admin');
    const isTopAdminOrAbove = admin.role === 'admin' || admin.role === 'hassan' || actorLevel >= adminBaseLevel;

    if (!isTopAdminOrAbove && !hasPermission(admin.role, 'canManagePermissions') && !hasPermission(admin.role, 'canManageRoles')) {
      socket.emit('systemAlert', 'عفواً، ليست لديك صلاحية إدارة وتعديل الرتب.');
      return;
    }

    if (!role || !role.id || !role.name) {
      socket.emit('systemAlert', 'يرجى إدخال اسم الرتبة ورقمها كاملاً.');
      return;
    }

    const cleanId = role.id.trim().toLowerCase();
    const cleanName = sanitizeText(role.name.trim());
    const cleanLevel = typeof role.level === 'number' ? role.level : parseInt(String(role.level)) || 10;

    // Strict Hierarchy Check: Cannot edit own role or equal/higher roles (exempt for supreme 'hassan' role)
    const existing = rolesConfig.find((r) => r.id === cleanId);
    if (!isSupremeHassan(admin)) {
      if (cleanId === admin.role.toLowerCase()) {
        socket.emit('systemAlert', '🚫 حماية الرتب: لا يمكنك تعديل بيانات أو رقم رتبتك الخاصة! يستطيع ذلك فقط من هو أعلى منك رتبة.');
        return;
      }
      if (existing && existing.level >= actorLevel) {
        socket.emit('systemAlert', `🚫 حماية الرتب: لا يمكنك تعديل رتبة مساوية لك أو أعلى منك في المستوى (مستواها: ${existing.level}، مستواك: ${actorLevel})!`);
        return;
      }
      if (cleanLevel >= actorLevel) {
        socket.emit('systemAlert', `🚫 حماية الرتب: لا يمكنك تعيين رقم رتبة (${cleanLevel}) مساوٍ أو أعلى من رقم رتبتك (${actorLevel})! يجب أن يكون أقل منك.`);
        return;
      }
    }

    const safePermKeys = new Set([
      'canSendText', 'canSendMedia', 'canSendVoiceNotes', 'canDeleteMessage', 'canDeleteMessages',
      'canPinMessage', 'canClearRoomChat', 'canLockRoom', 'canSetSlowMode', 'canChangeRoomSettings',
      'canEditRoomBanner', 'canTakeMic', 'canPullMic', 'canMuteVoice', 'canLockVoice', 'canStartLive',
      'canWarn', 'canMute', 'canMuteText', 'canKick', 'canTempBan', 'canBan', 'canUnban', 'canJail',
      'canUnjail', 'canEditMemberProfile', 'canEditMemberData', 'canDeleteAvatar', 'canEditLikes',
      'canEditPoints', 'canAssignBanner', 'canAssignBadge', 'canUseAvatarFrame', 'canUseMemberBg',
      'canManageMembershipCatalog', 'canChangeMemberPassword', 'canMoveUsers', 'canChangeRoles',
      'canManagePermissions', 'canManageRoles', 'canDeleteAccounts', 'canDeleteAccount',
      'canAccessControlPanel', 'canFilter', 'canManageFilterWords', 'canRevealNicks',
      'canViewAuditLogs', 'canClearAuditLogs', 'canBroadcast', 'canGhostLogin',
      'canManageShortcuts', 'canChangeGlobalTheme', 'canPostWall', 'canDeleteWallPost',
      'canPrivateChat', 'canPrivateCall', 'canManageRooms', 'canCreateRooms'
    ]);
    const sanitizePermissionPatch = (rawPerms?: Partial<RolePermissions>): Partial<RolePermissions> => {
      const cleaned: Partial<RolePermissions> = {};
      if (!rawPerms || typeof rawPerms !== 'object') return cleaned;
      for (const [k, v] of Object.entries(rawPerms)) {
        if (safePermKeys.has(k) && typeof v === 'boolean') {
          cleaned[k] = v;
        }
      }
      return cleaned;
    };

    const existingIdx = rolesConfig.findIndex((r) => r.id === cleanId);
    if (existingIdx !== -1) {
      rolesConfig[existingIdx].name = cleanName;
      rolesConfig[existingIdx].level = cleanLevel;
      if (role.badgeColor) rolesConfig[existingIdx].badgeColor = sanitizeText(role.badgeColor).slice(0, 120);
    } else {
      rolesConfig.push({
        id: cleanId,
        name: cleanName,
        level: cleanLevel,
        badgeColor: (role.badgeColor ? sanitizeText(role.badgeColor).slice(0, 120) : '') || 'bg-amber-600 text-white',
        isSystem: false
      });
    }

    // Sort roles descending by level so higher numbers are always at top
    rolesConfig.sort((a, b) => b.level - a.level);
    saveRolesConfig();

    if (!rolePermissions[cleanId]) {
      rolePermissions[cleanId] = {
        canSendText: true,
        canSendMedia: true,
        canSendVoiceNotes: true,
        canTakeMic: true,
        canPostWall: true,
        canPrivateChat: true,
        canPrivateCall: true,
        canFilter: false,
        canDeleteMessage: false,
        canDeleteMessages: false,
        canPinMessage: false,
        canClearRoomChat: false,
        canLockRoom: false,
        canSetSlowMode: false,
        canChangeRoomSettings: false,
        canPullMic: false,
        canMuteVoice: false,
        canLockVoice: false,
        canStartLive: false,
        canWarn: false,
        canMute: false,
        canMuteText: false,
        canKick: false,
        canTempBan: false,
        canBan: false,
        canUnban: false,
        canJail: false,
        canUnjail: false,
        canEditMemberProfile: false,
        canEditMemberData: false,
        canDeleteAvatar: false,
        canEditLikes: false,
        canEditPoints: false,
        canAssignBanner: false,
        canAssignBadge: false,
        canChangeMemberPassword: false,
        canMoveUsers: false,
        canChangeRoles: false,
        canManagePermissions: false,
        canManageRoles: false,
        canDeleteAccounts: false,
        canDeleteAccount: false,
        canAccessControlPanel: false,
        canManageFilterWords: false,
        canRevealNicks: false,
        canViewAuditLogs: false,
        canClearAuditLogs: false,
        canBroadcast: false,
        canGhostLogin: false,
        canManageShortcuts: false,
        canChangeGlobalTheme: false,
        canDeleteWallPost: false
      };
    }

    if (permissions) {
      const cleanPerms = sanitizePermissionPatch(permissions);
      rolePermissions[cleanId] = {
        ...rolePermissions[cleanId],
        ...cleanPerms
      };
      saveRolePermissions();
    }

    io.emit('rolesConfigUpdated', rolesConfig);
    io.emit('rolePermissionsUpdated', rolePermissions);
    logMonitorEvent('role', `تم حفظ وتعديل الرتبة [${cleanName}] (الرقم: ${cleanLevel}) بواسطة ${admin.username}`, admin.username);
    socket.emit('systemAlert', `تم حفظ وتحديث الرتبة [${cleanName}] بنجاح ✅`);
    broadcastAllUsers();
    for (const r of chatRooms) {
      broadcastRoomUsers(r.id);
    }
  });

  socket.on('deleteRole', ({ roleId }: { roleId: string }) => {
    const admin = findSocketUser(socket.id);
    if (!admin) {
      socket.emit('systemAlert', 'يجب تسجيل الدخول أولاً.');
      return;
    }
    const cleanId = (roleId || '').trim().toLowerCase();
    const targetRole = rolesConfig.find((r) => r.id === cleanId);
    if (!targetRole) {
      socket.emit('systemAlert', 'الرتبة غير موجودة.');
      return;
    }
    if (targetRole.isSystem || ['hassan', 'admin', 'super', 'member', 'guest'].includes(cleanId)) {
      socket.emit('systemAlert', 'لا يمكن حذف الرتب الأساسية للنظام.');
      return;
    }

    const actorLevel = getRoleLevel(admin.role);
    const isTopAdminOrAbove = admin.role === 'admin' || admin.role === 'hassan' || actorLevel >= getRoleLevel('admin');

    if (!isTopAdminOrAbove && !hasPermission(admin.role, 'canManagePermissions') && !hasPermission(admin.role, 'canManageRoles')) {
      socket.emit('systemAlert', 'عفواً، ليست لديك صلاحية حذف الرتب.');
      return;
    }
    if (!isSupremeHassan(admin) && (cleanId === admin.role.toLowerCase() || targetRole.level >= actorLevel)) {
      socket.emit('systemAlert', `🚫 حماية الرتب: لا يمكنك حذف رتبتك الخاصة أو رتبة مساوية أو أعلى منك (مستواها: ${targetRole.level}، مستواك: ${actorLevel})!`);
      return;
    }

    rolesConfig = rolesConfig.filter((r) => r.id !== cleanId);
    delete rolePermissions[cleanId];
    saveRolesConfig();
    saveRolePermissions();

    // Reassign all active and registered users with the deleted role to default 'member' role
    let membersReassigned = 0;
    for (const [uname, m] of Object.entries(registeredMembers)) {
      if (m.role?.toLowerCase() === cleanId) {
        m.role = 'member';
        membersReassigned++;
      }
    }
    if (membersReassigned > 0) saveMembers();

    for (const u of users) {
      if (u.role?.toLowerCase() === cleanId) {
        u.role = 'member';
        io.to(u.id).emit('userRoleUpdated', { role: 'member' });
      }
    }
    for (const sess of activeSessions.values()) {
      if (sess.user && sess.user.role?.toLowerCase() === cleanId) {
        sess.user.role = 'member';
      }
    }
    persistActiveSessions();

    io.emit('rolesConfigUpdated', rolesConfig);
    io.emit('rolePermissionsUpdated', rolePermissions);
    broadcastAllRegisteredMembers();
    logMonitorEvent('role', `حذف الرتبة [${targetRole.name}] بواسطة ${admin.username}`, admin.username);
    socket.emit('systemAlert', `تم حذف الرتبة [${targetRole.name}] بنجاح 🗑️`);
    broadcastAllUsers();
    for (const r of chatRooms) {
      broadcastRoomUsers(r.id);
    }
  });

  socket.on('getRolePermissions', () => {
    socket.emit('rolesConfigUpdated', rolesConfig);
    socket.emit('rolePermissionsUpdated', rolePermissions);
  });

  socket.on('updateRolePermissions', ({ role, permissions }: { role: string; permissions: Partial<RolePermissions> }) => {
    const admin = findSocketUser(socket.id);
    if (!admin) {
      socket.emit('systemAlert', 'يجب تسجيل الدخول أولاً لتعديل الصلاحيات.');
      return;
    }

    const cleanRole = typeof role === 'string' ? role.trim().toLowerCase() : '';
    if (!cleanRole || cleanRole === '__proto__' || cleanRole === 'constructor' || cleanRole === 'prototype') {
      socket.emit('systemAlert', 'اسم الرتبة غير صالح.');
      return;
    }
    const existingRoleEntry = rolesConfig.find((r) => r.id.toLowerCase() === cleanRole);
    const canonicalRoleKey = existingRoleEntry?.id || (rolePermissions[cleanRole] ? cleanRole : '');
    if (!canonicalRoleKey) {
      socket.emit('systemAlert', 'الرتبة المطلوبة غير موجودة.');
      return;
    }

    const actorLevel = getRoleLevel(admin.role);
    const targetRoleLevel = getRoleLevel(canonicalRoleKey);
    const isTopAdminOrAbove = admin.role === 'admin' || admin.role === 'hassan' || actorLevel >= getRoleLevel('admin');

    // Strict Hierarchy Check
    if (!isTopAdminOrAbove && !hasPermission(admin.role, 'canManagePermissions') && !hasPermission(admin.role, 'canManageRoles')) {
      socket.emit('systemAlert', 'عفواً، ليست لديك صلاحية إدارة وتعديل جدول الصلاحيات.');
      return;
    }
    if (!isSupremeHassan(admin)) {
      if (canonicalRoleKey.toLowerCase() === admin.role.trim().toLowerCase()) {
        socket.emit('systemAlert', '🚫 حماية الرتب الصارمة: لا يمكنك إطلاقاً تعديل أو منح أو سحب صلاحيات رتبتك الحالية! يستطيع ذلك فقط من هو أعلى منك رتبة.');
        return;
      }
      if (targetRoleLevel >= actorLevel) {
        socket.emit('systemAlert', `🚫 حماية الرتب الصارمة: لا تملك صلاحية تعديل صلاحيات رتبة مساوية لك أو أعلى منك في المستوى (مستواها: ${targetRoleLevel}، مستواك: ${actorLevel})! يستطيع ذلك فقط من هو أعلى منها رقماً.`);
        return;
      }
    }

    if (!rolePermissions[canonicalRoleKey]) {
      rolePermissions[canonicalRoleKey] = {
        canSendText: true,
        canSendMedia: true,
        canSendVoiceNotes: true,
        canTakeMic: true,
        canPostWall: true,
        canPrivateChat: true,
        canPrivateCall: true,
        canFilter: false,
        canDeleteMessage: false,
        canDeleteMessages: false,
        canPinMessage: false,
        canClearRoomChat: false,
        canLockRoom: false,
        canSetSlowMode: false,
        canChangeRoomSettings: false,
        canPullMic: false,
        canMuteVoice: false,
        canLockVoice: false,
        canStartLive: false,
        canMute: false,
        canMuteText: false,
        canKick: false,
        canBan: false,
        canUnban: false,
        canJail: false,
        canUnjail: false,
        canBroadcast: false,
        canManageShortcuts: false,
        canChangeGlobalTheme: false,
        canRevealNicks: false,
        canEditMemberData: false,
        canEditMemberProfile: false,
        canGhostLogin: false,
        canAccessControlPanel: false,
        canManageRoles: false,
        canManagePermissions: false,
        canChangeMemberPassword: false,
        canEditLikes: false,
        canEditPoints: false,
        canChangeRoles: false,
        canMoveUsers: false,
        canDeleteAvatar: false,
        canWarn: false,
        canDeleteAccounts: false,
        canDeleteAccount: false,
        canManageRooms: false,
        canCreateRooms: false,
        canDeleteWallPost: false,
        canAssignBanner: false,
        canAssignBadge: false
      };
    }

    const sanitizedPatch: Partial<RolePermissions> = {};
    if (permissions && typeof permissions === 'object') {
      for (const [k, v] of Object.entries(permissions)) {
        if (k !== '__proto__' && k !== 'constructor' && k !== 'prototype' && /^can[A-Z][a-zA-Z0-9]{1,40}$/.test(k) && typeof v === 'boolean') {
          sanitizedPatch[k] = v;
        }
      }
    }
    rolePermissions[canonicalRoleKey] = { ...rolePermissions[canonicalRoleKey], ...sanitizedPatch };
    saveRolePermissions();
    io.emit('rolePermissionsUpdated', rolePermissions);
    logMonitorEvent('role', `تعديل جدول صلاحيات رتبة [${canonicalRoleKey.toUpperCase()}] بواسطة ${admin.username}`, admin.username);
    socket.emit('systemAlert', `تم حفظ وتثبيت صلاحيات رتبة [${canonicalRoleKey}] بنجاح ✅`);
  });

  // Check Ghost Login Permission for login screen (فحص صلاحية الدخول المخفي للاسم قبل الدخول)
  socket.on('checkGhostPermission', ({ username }: { username: string }, callback?: (res: { allowed: boolean }) => void) => {
    const clean = sanitizeText(username || '').trim();
    if (!clean || clean.length < 2 || clean.length > 64 || !checkHttpRateLimit('ghostCheck', clientIp, 6, 60_000)) {
      if (typeof callback === 'function') callback({ allowed: false });
      socket.emit('ghostPermissionResult', { username: clean || '', allowed: false });
      return;
    }
    const reg = getRegisteredMember(clean)?.member;
    let role = 'member';
    if (reg) {
      role = reg.role;
    }
    const allowed = Boolean(rolePermissions[role]?.canGhostLogin);
    if (typeof callback === 'function') callback({ allowed });
    socket.emit('ghostPermissionResult', { username: clean, allowed });
  });

  // Global Appearance Listeners (التطبيق العام للثيم والخط والخلفية)
  socket.on('getGlobalAppearance', () => {
    socket.emit('globalAppearanceUpdated', globalAppearance);
  });

  socket.on('updateGlobalAppearance', async ({ theme, fontFamily, fontWeight, wallpaper, bubbleStyle, bannerUrl, logoUrl }: Partial<GlobalAppearance>) => {
    const admin = findSocketUser(socket.id);
    if (!admin || (!isSupremeHassan(admin) && admin.role !== 'admin' && admin.role !== 'super')) {
      socket.emit('systemAlert', 'تعميم الثيم والخط للعام محصور بطاقم الإدارة.');
      return;
    }
    if (typeof theme === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(theme.trim())) {
      globalAppearance.theme = theme.trim();
    }
    if (typeof fontFamily === 'string') {
      const cleanFont = sanitizeCssValue(fontFamily);
      if (cleanFont) globalAppearance.fontFamily = cleanFont.slice(0, 64);
    }
    const allowedFontWeights = ['default', 'thin', 'normal', 'bold', 'black'] as const;
    if (typeof fontWeight === 'string' && (allowedFontWeights as readonly string[]).includes(fontWeight.trim())) {
      globalAppearance.fontWeight = fontWeight.trim() as typeof allowedFontWeights[number];
    }
    if (typeof wallpaper === 'string') {
      const cleanWall = wallpaper.trim().startsWith('http') || wallpaper.trim().startsWith('/') || wallpaper.trim().startsWith('data:')
        ? sanitizeUrl(wallpaper)
        : sanitizeCssValue(wallpaper);
      if (cleanWall !== undefined) globalAppearance.wallpaper = cleanWall;
    }
    if (typeof bubbleStyle === 'string' && /^[a-zA-Z0-9_-]{1,40}$/.test(bubbleStyle.trim())) {
      globalAppearance.bubbleStyle = bubbleStyle.trim();
    }
    if (bannerUrl !== undefined) {
      globalAppearance.bannerUrl = bannerUrl ? (sanitizeUrl(bannerUrl) || '') : '';
    }
    if (logoUrl !== undefined) {
      globalAppearance.logoUrl = logoUrl ? (sanitizeUrl(logoUrl) || '') : '';
    }
  try {
    await saveGlobalAppearance();
  } catch {
    socket.emit('systemAlert', 'تعذر حفظ إعدادات المظهر في قاعدة البيانات. لم يتم اعتماد التغيير.');
    return;
  }
    io.emit('globalAppearanceUpdated', globalAppearance);
    logMonitorEvent('role', `تعميم مظهر الشات (ثيم: ${globalAppearance.theme}، خط: ${globalAppearance.fontFamily}) بواسطة ${admin.username}`, admin.username);
    socket.emit('systemAlert', 'تم تعميم وتحديث مظهر الشات على كافة الأعضاء بنجاح 📢');
  });

  // Save / Update Custom Theme Preset (حفظ قالب ألوان مخصص وإضافته للثيمات)
  socket.on('saveCustomTheme', async (preset: { id?: string; name: string; colors: Record<string, string>; applyNow?: boolean }) => {
    const admin = findSocketUser(socket.id);
    if (!admin || (!isSupremeHassan(admin) && admin.role !== 'admin' && admin.role !== 'super')) {
      socket.emit('systemAlert', 'حفظ قوالب الألوان المخصصة محصور بطاقم الإدارة.');
      return;
    }
    const cleanName = sanitizeText(preset?.name || '').trim();
    if (!cleanName || !preset?.colors || typeof preset.colors !== 'object') {
      socket.emit('systemAlert', 'يرجى إدخال اسم صالح لقالب الألوان.');
      return;
    }
    const safeColors: Record<string, string> = {};
    for (const [k, v] of Object.entries(preset.colors)) {
      if (!/^[a-zA-Z0-9_-]{1,32}$/.test(k) || typeof v !== 'string') continue;
      const safeVal = sanitizeCssColor(v);
      if (safeVal) safeColors[k] = safeVal;
    }
    if (Object.keys(safeColors).length === 0) {
      socket.emit('systemAlert', 'قيم الألوان المدخلة غير صالحة.');
      return;
    }
    if (!Array.isArray(globalAppearance.customThemes)) {
      globalAppearance.customThemes = [];
    }
    const rawId = preset.id ? preset.id.trim() : '';
    const themeId = /^[a-zA-Z0-9_-]{1,64}$/.test(rawId) ? rawId : `custom-theme-${Date.now()}`;
    const newPreset = {
      id: themeId,
      name: cleanName,
      colors: safeColors,
      createdBy: admin.username,
      createdAt: Date.now()
    };
    const existingIdx = globalAppearance.customThemes.findIndex((t) => t.id === themeId);
    if (existingIdx !== -1) {
      globalAppearance.customThemes[existingIdx] = newPreset;
    } else {
      globalAppearance.customThemes.unshift(newPreset);
      if (globalAppearance.customThemes.length > 30) {
        globalAppearance.customThemes.pop();
      }
    }
    if (preset.applyNow) {
      globalAppearance.theme = themeId;
    }
    try {
      await saveGlobalAppearance();
    } catch {
      socket.emit('systemAlert', 'تعذر حفظ القالب المخصص في قاعدة البيانات.');
      return;
    }
    io.emit('globalAppearanceUpdated', globalAppearance);
    logMonitorEvent('role', `حفظ قالب ألوان مخصص [${cleanName}] بواسطة ${admin.username}`, admin.username);
    socket.emit('systemAlert', `تم حفظ القالب [${cleanName}] وإضافته إلى قائمة الاستايل والثيمات بنجاح 🎨✨`);
  });

  // Delete Custom Theme Preset
  socket.on('deleteCustomTheme', async ({ themeId }: { themeId: string }) => {
    const admin = findSocketUser(socket.id);
    if (!admin || (!isSupremeHassan(admin) && admin.role !== 'admin' && admin.role !== 'super')) {
      socket.emit('systemAlert', 'حذف قوالب الألوان المخصصة محصور بطاقم الإدارة.');
      return;
    }
    if (!Array.isArray(globalAppearance.customThemes)) return;
    globalAppearance.customThemes = globalAppearance.customThemes.filter((t) => t.id !== themeId);
    if (globalAppearance.theme === themeId) {
      globalAppearance.theme = 'pearl-gray-calm';
    }
    try {
      await saveGlobalAppearance();
    } catch {}
    io.emit('globalAppearanceUpdated', globalAppearance);
    socket.emit('systemAlert', 'تم حذف القالب المخصص بنجاح.');
  });

  // User Style Updates (تحديث لون الاسم ولون خط الرسائل واستدامته فوراً للجميع)
  socket.on('updateUserStyle', ({
    nameColor,
    textColor,
    nameGradient,
    profileBg
  }: {
    nameColor?: string;
    textColor?: string;
    nameGradient?: string;
    profileBg?: string;
  }) => {
    const user = users.find((u) => u.id === socket.id);
    if (!user) return;
    if (profileBg !== undefined && !isSupremeHassan(user) && user.role !== 'admin' && getRoleLevel(user.role) < getRoleLevel('admin') && !hasPermission(user.role, 'canUseMemberBg')) {
      socket.emit('systemAlert', 'ليس لديك صلاحية استخدام أو تغيير خلفية العضوية 🔒');
      return;
    }
    const safeNameColor = nameColor !== undefined ? sanitizeCssColor(nameColor) : undefined;
    const safeTextColor = textColor !== undefined ? sanitizeCssColor(textColor) : undefined;
    const safeNameGradient = nameGradient !== undefined ? sanitizeCssValue(nameGradient) : undefined;
    const safeProfileBg = profileBg !== undefined
      ? (!profileBg ? '' : (profileBg.startsWith('bg:') ? sanitizeCssValue(profileBg) : sanitizeUrl(profileBg)))
      : undefined;

    if (safeNameColor !== undefined) user.nameColor = safeNameColor || undefined;
    if (safeTextColor !== undefined) user.textColor = safeTextColor || undefined;
    if (safeNameGradient !== undefined) user.nameGradient = safeNameGradient || undefined;
    if (safeProfileBg !== undefined) {
      user.profileBg = safeProfileBg || undefined;
      user.memberBg = safeProfileBg || undefined;
    }

    const regStyleFound = getRegisteredMember(user.username);
    if (regStyleFound) {
      if (safeNameColor !== undefined) (regStyleFound.member as any).nameColor = safeNameColor || undefined;
      if (safeTextColor !== undefined) (regStyleFound.member as any).textColor = safeTextColor || undefined;
      if (safeNameGradient !== undefined) (regStyleFound.member as any).nameGradient = safeNameGradient || undefined;
      if (safeProfileBg !== undefined) {
        (regStyleFound.member as any).profileBg = safeProfileBg || undefined;
        (regStyleFound.member as any).memberBg = safeProfileBg || undefined;
      }
      saveMembers();
    }

    io.emit('userStyleUpdated', {
      username: user.username,
      displayName: user.displayName || user.username,
      nameColor: user.nameColor,
      textColor: user.textColor,
      nameGradient: user.nameGradient,
      profileBg: user.profileBg,
      memberBg: user.memberBg,
      avatarFrame: user.avatarFrame
    });

    if (user.room) {
      broadcastRoomUsers(user.room);
    }
    broadcastAllUsers();
    socket.emit('systemAlert', 'تم حفظ وتحديث تنسيق اسمك ولون خطك للجميع بنجاح ✨');
  });

  // Membership Design Updates (تصميم العضوية: إطار الصورة الشخصية + خلفية العضوية والبروفايل)
  socket.on('updateMembershipDesign', async ({
    avatarFrame,
    memberBg
  }: {
    avatarFrame?: string;
    memberBg?: string;
  }) => {
    const user = users.find((u) => u.id === socket.id);
    if (!user) return;

    const isPrivilegedAdmin = isSupremeHassan(user) || user.role === 'admin' || getRoleLevel(user.role) >= getRoleLevel('admin');

    if (avatarFrame !== undefined && !isPrivilegedAdmin && !hasPermission(user.role, 'canUseAvatarFrame')) {
      socket.emit('systemAlert', 'ليس لديك صلاحية استخدام أو تغيير إطار الصورة الشخصية 🔒');
      return;
    }

    if (memberBg !== undefined && !isPrivilegedAdmin && !hasPermission(user.role, 'canUseMemberBg')) {
      socket.emit('systemAlert', 'ليس لديك صلاحية استخدام أو تغيير خلفية العضوية والبروفايل 🔒');
      return;
    }

    let nextFrame: string | undefined = user.avatarFrame;
    if (avatarFrame !== undefined) {
      const trimmedFrame = String(avatarFrame || '').trim();
      if (!trimmedFrame) {
        nextFrame = undefined;
      } else if (trimmedFrame.startsWith('frame:')) {
        nextFrame = sanitizeText(trimmedFrame).slice(0, 120);
      } else {
        const persisted = await ensureMediaUrlNotBase64(trimmedFrame);
        if (!persisted) {
          socket.emit('systemAlert', 'رابط أو ملف إطار الصورة الشخصية غير صالح.');
          return;
        }
        nextFrame = persisted;
      }
      user.avatarFrame = nextFrame;
    }

    let nextBg: string | undefined = user.memberBg ?? user.profileBg;
    if (memberBg !== undefined) {
      const trimmedBg = String(memberBg || '').trim();
      if (!trimmedBg) {
        nextBg = undefined;
      } else if (trimmedBg.startsWith('bg:')) {
        nextBg = sanitizeText(trimmedBg).slice(0, 120);
      } else {
        const persisted = await ensureMediaUrlNotBase64(trimmedBg);
        if (!persisted) {
          socket.emit('systemAlert', 'رابط أو ملف خلفية العضوية غير صالح.');
          return;
        }
        nextBg = persisted;
      }
      user.memberBg = nextBg;
      user.profileBg = nextBg;
    }

    const regMember = getRegisteredMember(user.username);
    if (regMember) {
      if (avatarFrame !== undefined) regMember.member.avatarFrame = nextFrame;
      if (memberBg !== undefined) {
        regMember.member.memberBg = nextBg;
        regMember.member.profileBg = nextBg;
      }
      saveMembers();
    }

    if (user.sessionToken && activeSessions.has(user.sessionToken)) {
      const sess = activeSessions.get(user.sessionToken)!;
      if (avatarFrame !== undefined) sess.user.avatarFrame = nextFrame;
      if (memberBg !== undefined) {
        sess.user.memberBg = nextBg;
        sess.user.profileBg = nextBg;
      }
      persistActiveSessions();
    }

    io.emit('userStyleUpdated', {
      username: user.username,
      displayName: user.displayName || user.username,
      avatarFrame: user.avatarFrame || '',
      memberBg: user.memberBg || '',
      profileBg: user.profileBg || ''
    });

    if (user.room) {
      broadcastRoomUsers(user.room);
    }
    broadcastAllUsers();
    socket.emit('profileUpdated', { user });

    if (avatarFrame !== undefined && memberBg === undefined) {
      socket.emit('systemAlert', nextFrame ? 'تم تطبيق إطار العضوية وتحديثه للجميع ✨' : 'تمت إزالة إطار الصورة الشخصية ✓');
    } else if (memberBg !== undefined && avatarFrame === undefined) {
      socket.emit('systemAlert', nextBg ? 'تم تطبيق خلفية العضوية والبروفايل للجميع 🖼️✨' : 'تمت إزالة خلفية العضوية ✓');
    } else {
      socket.emit('systemAlert', 'تم حفظ تصميم عضويتك ومزامنته للجميع بنجاح ✨');
    }
  });

  // Membership Design Shared Catalog (رفع وحذف إطارات وخلفيات العضوية للجميع حسب الصلاحية)
  socket.on('getMembershipDesignCatalog', () => {
    socket.emit('membershipDesignCatalogUpdated', membershipDesignCatalog);
  });

  socket.on('addCatalogFrame', async ({
    name,
    imageUrl,
    applyToSelf
  }: {
    name?: string;
    imageUrl: string;
    applyToSelf?: boolean;
  }) => {
    const actor = users.find((u) => u.id === socket.id);
    if (!actor || actor.role === 'guest') {
      socket.emit('systemAlert', 'يجب تسجيل الدخول بحساب مسجل لإضافة الإطارات.');
      return;
    }
    const isPrivilegedAdmin = isSupremeHassan(actor) || actor.role === 'admin' || getRoleLevel(actor.role) >= getRoleLevel('admin');
    if (!isPrivilegedAdmin && !hasPermission(actor.role, 'canManageMembershipCatalog')) {
      socket.emit('systemAlert', 'ليس لديك صلاحية رفع إطارات للمكتبة العامة 🔒');
      return;
    }

    const rawUrl = String(imageUrl || '').trim();
    const persistedUrl = await ensureMediaUrlNotBase64(rawUrl);
    if (!persistedUrl) {
      socket.emit('systemAlert', 'تعذر حفظ صورة الإطار — تأكد من صيغة الصورة.');
      return;
    }

    const cleanName = sanitizeText(name) || `إطار مخصص #${membershipDesignCatalog.customFrames.length + 1}`;
    const newItem: CustomCatalogFrame = {
      id: `custom-frame:${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      name: cleanName.slice(0, 60),
      imageUrl: persistedUrl,
      animated: /\.gif(\?|$)/i.test(persistedUrl) || /\.webp(\?|$)/i.test(persistedUrl),
      createdBy: actor.username,
      createdAt: Date.now()
    };

    membershipDesignCatalog.customFrames.unshift(newItem);
    try {
      await saveMembershipDesignCatalog();
    } catch {
      membershipDesignCatalog.customFrames.shift();
      socket.emit('systemAlert', 'تعذر حفظ الإطار في قاعدة البيانات.');
      return;
    }

    io.emit('membershipDesignCatalogUpdated', membershipDesignCatalog);
    logMonitorEvent('security', `رفع إطار عضوية جديد [${newItem.name}] للمكتبة العامة بواسطة [${actor.username}]`, actor.username);

    if (applyToSelf && (isPrivilegedAdmin || hasPermission(actor.role, 'canUseAvatarFrame'))) {
      actor.avatarFrame = persistedUrl;
      const regMember = getRegisteredMember(actor.username);
      if (regMember) {
        regMember.member.avatarFrame = persistedUrl;
        saveMembers();
      }
      if (actor.sessionToken && activeSessions.has(actor.sessionToken)) {
        activeSessions.get(actor.sessionToken)!.user.avatarFrame = persistedUrl;
        persistActiveSessions();
      }
      io.emit('userStyleUpdated', {
        username: actor.username,
        displayName: actor.displayName || actor.username,
        avatarFrame: persistedUrl
      });
      if (actor.room) broadcastRoomUsers(actor.room);
      broadcastAllUsers();
      socket.emit('profileUpdated', { user: actor });
    }

    socket.emit('systemAlert', `تم رفع الإطار "${newItem.name}" وإتاحته لجميع الأعضاء في نافذة تصميم العضوية ✨`);
  });

  socket.on('addCatalogBg', async ({
    name,
    imageUrl,
    applyToSelf
  }: {
    name?: string;
    imageUrl: string;
    applyToSelf?: boolean;
  }) => {
    const actor = users.find((u) => u.id === socket.id);
    if (!actor || actor.role === 'guest') {
      socket.emit('systemAlert', 'يجب تسجيل الدخول بحساب مسجل لإضافة الخلفيات.');
      return;
    }
    const isPrivilegedAdmin = isSupremeHassan(actor) || actor.role === 'admin' || getRoleLevel(actor.role) >= getRoleLevel('admin');
    if (!isPrivilegedAdmin && !hasPermission(actor.role, 'canManageMembershipCatalog')) {
      socket.emit('systemAlert', 'ليس لديك صلاحية رفع خلفيات للمكتبة العامة 🔒');
      return;
    }

    const rawUrl = String(imageUrl || '').trim();
    const persistedUrl = await ensureMediaUrlNotBase64(rawUrl);
    if (!persistedUrl) {
      socket.emit('systemAlert', 'تعذر حفظ صورة الخلفية — تأكد من صيغة الصورة.');
      return;
    }

    const cleanName = sanitizeText(name) || `خلفية مخصصة #${membershipDesignCatalog.customBgs.length + 1}`;
    const newItem: CustomCatalogBg = {
      id: `custom-bg:${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      name: cleanName.slice(0, 60),
      imageUrl: persistedUrl,
      createdBy: actor.username,
      createdAt: Date.now()
    };

    membershipDesignCatalog.customBgs.unshift(newItem);
    try {
      await saveMembershipDesignCatalog();
    } catch {
      membershipDesignCatalog.customBgs.shift();
      socket.emit('systemAlert', 'تعذر حفظ الخلفية في قاعدة البيانات.');
      return;
    }

    io.emit('membershipDesignCatalogUpdated', membershipDesignCatalog);
    logMonitorEvent('security', `رفع خلفية عضوية جديدة [${newItem.name}] للمكتبة العامة بواسطة [${actor.username}]`, actor.username);

    if (applyToSelf && (isPrivilegedAdmin || hasPermission(actor.role, 'canUseMemberBg'))) {
      actor.memberBg = persistedUrl;
      actor.profileBg = persistedUrl;
      const regMember = getRegisteredMember(actor.username);
      if (regMember) {
        regMember.member.memberBg = persistedUrl;
        regMember.member.profileBg = persistedUrl;
        saveMembers();
      }
      if (actor.sessionToken && activeSessions.has(actor.sessionToken)) {
        const sess = activeSessions.get(actor.sessionToken)!;
        sess.user.memberBg = persistedUrl;
        sess.user.profileBg = persistedUrl;
        persistActiveSessions();
      }
      io.emit('userStyleUpdated', {
        username: actor.username,
        displayName: actor.displayName || actor.username,
        memberBg: persistedUrl,
        profileBg: persistedUrl
      });
      if (actor.room) broadcastRoomUsers(actor.room);
      broadcastAllUsers();
      socket.emit('profileUpdated', { user: actor });
    }

    socket.emit('systemAlert', `تم رفع الخلفية "${newItem.name}" وإتاحتها لجميع الأعضاء في نافذة تصميم العضوية 🖼️✨`);
  });

  socket.on('deleteCatalogFrame', async ({ id }: { id: string }) => {
    const actor = users.find((u) => u.id === socket.id);
    if (!actor || actor.role === 'guest') return;
    const isPrivilegedAdmin = isSupremeHassan(actor) || actor.role === 'admin' || getRoleLevel(actor.role) >= getRoleLevel('admin');
    if (!isPrivilegedAdmin && !hasPermission(actor.role, 'canManageMembershipCatalog')) {
      socket.emit('systemAlert', 'ليس لديك صلاحية حذف الإطارات من المكتبة 🔒');
      return;
    }

    const cleanId = String(id || '').trim();
    if (!cleanId) return;

    const customMatch = membershipDesignCatalog.customFrames.find((f) => f.id === cleanId || f.imageUrl === cleanId);
    const valuesToClear = new Set<string>([cleanId]);
    let changed = false;

    if (customMatch) {
      valuesToClear.add(customMatch.id);
      valuesToClear.add(customMatch.imageUrl);
      membershipDesignCatalog.customFrames = membershipDesignCatalog.customFrames.filter((f) => f.id !== customMatch.id);
      changed = true;
    } else if (cleanId.startsWith('frame:') && !membershipDesignCatalog.deletedPresetFrameIds.includes(cleanId)) {
      membershipDesignCatalog.deletedPresetFrameIds.push(cleanId);
      changed = true;
    }

    if (!changed) return;

    try {
      await saveMembershipDesignCatalog();
    } catch {
      socket.emit('systemAlert', 'تعذر حفظ حذف الإطار في قاعدة البيانات.');
      return;
    }

    // Clear deleted frame from any user currently wearing it so no stale or broken frame remains
    let membersDirty = false;
    let sessionsDirty = false;
    const affectedRooms = new Set<string>();
    const clearedUsernames = new Set<string>();

    users.forEach((u) => {
      if (u.avatarFrame && valuesToClear.has(u.avatarFrame)) {
        u.avatarFrame = undefined;
        if (u.room) affectedRooms.add(u.room);
        clearedUsernames.add(u.username);
        io.emit('userStyleUpdated', {
          username: u.username,
          displayName: u.displayName || u.username,
          avatarFrame: ''
        });
      }
    });

    Object.entries(registeredMembers).forEach(([memberKey, reg]) => {
      if (reg?.avatarFrame && valuesToClear.has(reg.avatarFrame)) {
        reg.avatarFrame = undefined;
        membersDirty = true;
        const uname = reg.originalUsername || memberKey;
        if (!clearedUsernames.has(uname) && !clearedUsernames.has(memberKey)) {
          io.emit('userStyleUpdated', {
            username: uname,
            displayName: reg.displayName || uname,
            avatarFrame: ''
          });
        }
      }
    });

    activeSessions.forEach((sess) => {
      if (sess?.user?.avatarFrame && valuesToClear.has(sess.user.avatarFrame)) {
        sess.user.avatarFrame = undefined;
        sessionsDirty = true;
      }
    });

    if (membersDirty) saveMembers();
    if (sessionsDirty) persistActiveSessions();
    affectedRooms.forEach((roomName) => broadcastRoomUsers(roomName));
    if (affectedRooms.size > 0 || membersDirty) {
      broadcastAllUsers();
    }

    if (customMatch) {
      unlinkCatalogUploadIfUnused(customMatch.imageUrl);
    }

    io.emit('membershipDesignCatalogUpdated', membershipDesignCatalog);
    logMonitorEvent('security', `حذف إطار عضوية [${customMatch?.name || cleanId}] بواسطة [${actor.username}]`, actor.username);
    socket.emit('systemAlert', 'تم حذف الإطار بنجاح 🗑️');
  });

  socket.on('deleteCatalogBg', async ({ id }: { id: string }) => {
    const actor = users.find((u) => u.id === socket.id);
    if (!actor || actor.role === 'guest') return;
    const isPrivilegedAdmin = isSupremeHassan(actor) || actor.role === 'admin' || getRoleLevel(actor.role) >= getRoleLevel('admin');
    if (!isPrivilegedAdmin && !hasPermission(actor.role, 'canManageMembershipCatalog')) {
      socket.emit('systemAlert', 'ليس لديك صلاحية حذف الخلفيات من المكتبة 🔒');
      return;
    }

    const cleanId = String(id || '').trim();
    if (!cleanId) return;

    const customMatch = membershipDesignCatalog.customBgs.find((b) => b.id === cleanId || b.imageUrl === cleanId);
    const valuesToClear = new Set<string>([cleanId]);
    let changed = false;

    if (customMatch) {
      valuesToClear.add(customMatch.id);
      valuesToClear.add(customMatch.imageUrl);
      membershipDesignCatalog.customBgs = membershipDesignCatalog.customBgs.filter((b) => b.id !== customMatch.id);
      changed = true;
    } else if (cleanId.startsWith('bg:') && !membershipDesignCatalog.deletedPresetBgIds.includes(cleanId)) {
      membershipDesignCatalog.deletedPresetBgIds.push(cleanId);
      changed = true;
    }

    if (!changed) return;

    try {
      await saveMembershipDesignCatalog();
    } catch {
      socket.emit('systemAlert', 'تعذر حفظ حذف الخلفية في قاعدة البيانات.');
      return;
    }

    let membersDirty = false;
    let sessionsDirty = false;
    const affectedRooms = new Set<string>();
    const clearedUsernames = new Set<string>();

    users.forEach((u) => {
      const current = u.memberBg || u.profileBg;
      if (current && valuesToClear.has(current)) {
        u.memberBg = undefined;
        u.profileBg = undefined;
        if (u.room) affectedRooms.add(u.room);
        clearedUsernames.add(u.username);
        io.emit('userStyleUpdated', {
          username: u.username,
          displayName: u.displayName || u.username,
          memberBg: '',
          profileBg: ''
        });
      }
    });

    Object.entries(registeredMembers).forEach(([memberKey, reg]) => {
      const current = reg?.memberBg || reg?.profileBg;
      if (current && valuesToClear.has(current)) {
        reg.memberBg = undefined;
        reg.profileBg = undefined;
        membersDirty = true;
        const uname = reg.originalUsername || memberKey;
        if (!clearedUsernames.has(uname) && !clearedUsernames.has(memberKey)) {
          io.emit('userStyleUpdated', {
            username: uname,
            displayName: reg.displayName || uname,
            memberBg: '',
            profileBg: ''
          });
        }
      }
    });

    activeSessions.forEach((sess) => {
      const current = sess?.user?.memberBg || sess?.user?.profileBg;
      if (current && valuesToClear.has(current)) {
        sess.user.memberBg = undefined;
        sess.user.profileBg = undefined;
        sessionsDirty = true;
      }
    });

    if (membersDirty) saveMembers();
    if (sessionsDirty) persistActiveSessions();
    affectedRooms.forEach((roomName) => broadcastRoomUsers(roomName));
    if (affectedRooms.size > 0 || membersDirty) {
      broadcastAllUsers();
    }

    if (customMatch) {
      unlinkCatalogUploadIfUnused(customMatch.imageUrl);
    }

    io.emit('membershipDesignCatalogUpdated', membershipDesignCatalog);
    logMonitorEvent('security', `حذف خلفية عضوية [${customMatch?.name || cleanId}] بواسطة [${actor.username}]`, actor.username);
    socket.emit('systemAlert', 'تم حذف الخلفية بنجاح 🗑️');
  });

  socket.on('restoreDefaultCatalogPresets', async ({ kind }: { kind?: 'frames' | 'bgs' | 'all' } = {}) => {
    const actor = users.find((u) => u.id === socket.id);
    if (!actor || actor.role === 'guest') return;
    const isPrivilegedAdmin = isSupremeHassan(actor) || actor.role === 'admin' || getRoleLevel(actor.role) >= getRoleLevel('admin');
    if (!isPrivilegedAdmin && !hasPermission(actor.role, 'canManageMembershipCatalog')) {
      socket.emit('systemAlert', 'ليس لديك صلاحية استعادة الإطارات والخلفيات الافتراضية 🔒');
      return;
    }

    if (kind === 'frames' || !kind || kind === 'all') {
      membershipDesignCatalog.deletedPresetFrameIds = [];
    }
    if (kind === 'bgs' || !kind || kind === 'all') {
      membershipDesignCatalog.deletedPresetBgIds = [];
    }

    try {
      await saveMembershipDesignCatalog();
      io.emit('membershipDesignCatalogUpdated', membershipDesignCatalog);
      socket.emit('systemAlert', 'تمت استعادة العناصر الافتراضية بنجاح ✨');
    } catch {
      socket.emit('systemAlert', 'تعذر حفظ التغييرات.');
    }
  });

  // Personal User Appearance Preferences (تحديث وحفظ تفضيلات المظهر الشخصي للمستخدم فقط في حسابه بقاعدة البيانات)
  socket.on('updateUserPreferences', ({
    theme,
    fontFamily,
    wallpaper,
    bubbleStyle,
    fontSize,
    nameColor,
    textColor
  }: {
    theme?: string;
    fontFamily?: string;
    wallpaper?: string;
    bubbleStyle?: string;
    fontSize?: string;
    nameColor?: string;
    textColor?: string;
  }) => {
    const user = users.find((u) => u.id === socket.id);
    if (!user) return;

    const cleanFontSize = typeof fontSize === 'string' && /^[a-zA-Z0-9_-]{1,20}$/.test(fontSize.trim()) ? fontSize.trim() : undefined;
    const safeNameColor = nameColor !== undefined ? sanitizeCssColor(nameColor) : undefined;
    const safeTextColor = textColor !== undefined ? sanitizeCssColor(textColor) : undefined;
    const cleanTheme = typeof theme === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(theme.trim()) ? theme.trim() : undefined;
    const cleanFontFamily = typeof fontFamily === 'string' ? sanitizeCssValue(fontFamily)?.slice(0, 64) : undefined;
    const cleanWallpaper = typeof wallpaper === 'string'
      ? (wallpaper.trim().startsWith('http') || wallpaper.trim().startsWith('/') || wallpaper.trim().startsWith('data:')
          ? sanitizeUrl(wallpaper)
          : sanitizeCssValue(wallpaper))
      : undefined;
    const cleanBubbleStyle = typeof bubbleStyle === 'string' && /^[a-zA-Z0-9_-]{1,40}$/.test(bubbleStyle.trim()) ? bubbleStyle.trim() : undefined;

    // Global appearance defaults are managed by admins, while personal preferences persist to this member's account.
    if (cleanTheme) (user as any).theme = cleanTheme;
    if (cleanFontFamily) (user as any).fontFamily = cleanFontFamily;
    if (cleanWallpaper !== undefined) (user as any).wallpaper = cleanWallpaper || undefined;
    if (cleanBubbleStyle) (user as any).bubbleStyle = cleanBubbleStyle;
    if (cleanFontSize) (user as any).fontSize = cleanFontSize;
    if (safeNameColor !== undefined) user.nameColor = safeNameColor || undefined;
    if (safeTextColor !== undefined) user.textColor = safeTextColor || undefined;

    const regPrefFound = getRegisteredMember(user.username);
    if (regPrefFound) {
      if (cleanTheme) regPrefFound.member.theme = cleanTheme;
      if (cleanFontFamily) regPrefFound.member.fontFamily = cleanFontFamily;
      if (cleanWallpaper !== undefined) regPrefFound.member.wallpaper = cleanWallpaper || undefined;
      if (cleanBubbleStyle) regPrefFound.member.bubbleStyle = cleanBubbleStyle;
      if (cleanFontSize) (regPrefFound.member as any).fontSize = cleanFontSize;
      if (safeNameColor !== undefined) (regPrefFound.member as any).nameColor = safeNameColor || undefined;
      if (safeTextColor !== undefined) (regPrefFound.member as any).textColor = safeTextColor || undefined;
      saveMembers();
    }

    const sessionToken = user.sessionToken;
    if (sessionToken && activeSessions.has(sessionToken)) {
      const sess = activeSessions.get(sessionToken)!;
      if (cleanTheme) (sess.user as any).theme = cleanTheme;
      if (cleanFontFamily) (sess.user as any).fontFamily = cleanFontFamily;
      if (cleanWallpaper !== undefined) (sess.user as any).wallpaper = cleanWallpaper || undefined;
      if (cleanBubbleStyle) (sess.user as any).bubbleStyle = cleanBubbleStyle;
      if (cleanFontSize) (sess.user as any).fontSize = cleanFontSize;
      if (safeNameColor !== undefined) sess.user.nameColor = safeNameColor || undefined;
      if (safeTextColor !== undefined) sess.user.textColor = safeTextColor || undefined;
      persistActiveSessions();
    }

    // Acknowledge back to user only - does NOT broadcast to other members!
    socket.emit('preferencesSaved', {
      theme: cleanTheme,
      fontFamily: cleanFontFamily,
      wallpaper: cleanWallpaper,
      bubbleStyle: cleanBubbleStyle,
      fontSize: cleanFontSize,
      nameColor: safeNameColor,
      textColor: safeTextColor
    });
  });

  // Leave Room (الخروج من الغرفة الحالية فقط دون تسجيل الخروج من الشات)
  socket.on('leaveRoom', ({ room }: { room?: string } = {}) => {
    const user = users.find((u) => u.id === socket.id);
    if (!user) return;
    const isJailed = Boolean(
      user.isJailed ||
      user.room === 'سجن حسان برو' ||
      jailedUsernames.has(user.username.toLowerCase()) ||
      jailedIps.has(clientIp) ||
      getRegisteredMember(user.username)?.member.isJailed
    );
    if (isJailed) {
      socket.emit('systemAlert', '🚔 لا يمكنك مغادرة غرفة السجن! أنت محتجز وموقوف بقرار إداري ولا يمكنك الخروج إلا بإفراج رسمي من الإدارة.');
      return;
    }
    const currentRoom = user.room || room || 'الغرفة العامة';
    if (user.micSlot !== null || user.isVoice) {
      releaseUserMic(user, currentRoom);
    }
    cleanupUserLiveState(socket.id, currentRoom);
    socket.emit('currentLiveBroadcast', null);
    if (currentRoom && currentRoom !== 'خارج الغرف') {
      socket.leave(currentRoom);
    }
    user.room = 'خارج الغرف';
    user.presenceState = user.presenceState || 'online';
    user.lastActiveTime = Date.now();
    for (const sess of activeSessions.values()) {
      if (sess.user && sess.user.username.toLowerCase() === user.username.toLowerCase()) {
        sess.user.room = 'خارج الغرف';
        sess.user.presenceState = user.presenceState;
        sess.user.micSlot = null;
        sess.user.isVoice = false;
        sess.lastActiveTime = Date.now();
      }
    }
    persistActiveSessions();
    if (currentRoom && currentRoom !== 'خارج الغرف' && !user.isGhost) {
      const leaveNotice: StoredMessage = {
        id: `leave-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        room: currentRoom,
        username: user.username,
        avatarUrl: user.avatarUrl,
        nameBannerUrl: user.nameBannerUrl,
        flag: user.flag,
        badge: 'مغادرة 🚪',
        badgeColor: 'text-amber-400',
        text: `غادر ${user.username} وانتقل إلى بهو الدردشة 🚪`,
        time: getCurrentTimeString(),
        timestamp: Date.now()
      };
      chatHistory.push(leaveNotice);
      pruneRoomChatHistory(currentRoom);
      saveHistory();
      io.to(currentRoom).emit('message', leaveNotice);
    }
    if (currentRoom && currentRoom !== 'خارج الغرف') {
      io.to(currentRoom).emit('userTyping', {
        userId: user.id,
        username: user.username,
        room: currentRoom,
        isTyping: false,
        timestamp: Date.now()
      });
      broadcastRoomUsers(currentRoom);
    }
    socket.emit('roomUsers', { room: 'خارج الغرف', users: [] });
    // Room membership is presence data: publish authoritative snapshots after leaving.
    broadcastAllUsers();
    broadcastRoomsUpdate();
    socket.emit('leftRoomSuccess', { room: currentRoom });
  });

  // Chat Shortcuts Listeners (إدارة واستعلام اختصارات الشات الذكية)
  socket.on('getShortcuts', () => {
    socket.emit('shortcutsUpdated', chatShortcuts);
  });

  socket.on('addShortcut', ({ trigger, replacement }: { trigger: string; replacement: string }) => {
    const admin = findSocketUser(socket.id);
    if (!admin || (!isSupremeHassan(admin) && admin.role !== 'admin' && admin.role !== 'super' && !hasPermission(admin.role, 'canManageShortcuts'))) {
      socket.emit('systemAlert', 'إدارة وتعديل الاختصارات محصورة بطاقم الإدارة أو الرتب المصرح لها.');
      return;
    }

    const cleanTrigger = sanitizeText(trigger)?.trim().slice(0, 32);
    const cleanReplacement = sanitizeText(replacement)?.trim().slice(0, 300);

    if (!cleanTrigger || !cleanReplacement) {
      socket.emit('systemAlert', 'يرجى إدخال رمز الاختصار والجملة البديلة كاملة.');
      return;
    }

    const existingIndex = chatShortcuts.findIndex(
      (s) => s.trigger.toLowerCase() === cleanTrigger.toLowerCase()
    );

    if (existingIndex !== -1) {
      chatShortcuts[existingIndex].replacement = cleanReplacement;
      chatShortcuts[existingIndex].createdBy = admin.username;
      chatShortcuts[existingIndex].createdAt = Date.now();
    } else {
      if (chatShortcuts.length >= 250) {
        socket.emit('systemAlert', 'تم بلوغ الحد الأقصى لعدد الاختصارات (250 اختصاراً).');
        return;
      }
      const newShortcut: ChatShortcut = {
        id: `sc-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        trigger: cleanTrigger,
        replacement: cleanReplacement,
        createdBy: admin.username,
        createdAt: Date.now()
      };
      chatShortcuts.unshift(newShortcut);
    }

    saveShortcuts();
    io.emit('shortcutsUpdated', chatShortcuts);
    logMonitorEvent(
      'security',
      `أضاف المشرف [${admin.username}] اختصاراً جديداً: [${cleanTrigger}] ➔ "${cleanReplacement}"`,
      admin.username
    );
    socket.emit('systemAlert', `تم حفظ وتفعيل الاختصار [${cleanTrigger}] بنجاح ⚡`);
  });

  socket.on('deleteShortcut', ({ shortcutId }: { shortcutId: string }) => {
    const admin = findSocketUser(socket.id);
    if (!admin || (!isSupremeHassan(admin) && admin.role !== 'admin' && admin.role !== 'super' && !hasPermission(admin.role, 'canManageShortcuts'))) {
      socket.emit('systemAlert', 'إدارة الاختصارات محصورة بطاقم الإدارة أو الرتب المصرح لها.');
      return;
    }

    const item = chatShortcuts.find((s) => s.id === shortcutId);
    if (item) {
      chatShortcuts = chatShortcuts.filter((s) => s.id !== shortcutId);
      saveShortcuts();
      io.emit('shortcutsUpdated', chatShortcuts);
      logMonitorEvent('security', `حذف المشرف [${admin.username}] الاختصار: [${item.trigger}]`, admin.username);
      socket.emit('systemAlert', `تم حذف الاختصار [${item.trigger}] بنجاح.`);
    }
  });

  socket.on('updateShortcut', ({ id, trigger, replacement }: { id: string; trigger: string; replacement: string }) => {
    const admin = findSocketUser(socket.id);
    if (!admin || (!isSupremeHassan(admin) && admin.role !== 'admin' && admin.role !== 'super' && !hasPermission(admin.role, 'canManageShortcuts'))) {
      socket.emit('systemAlert', 'إدارة وتعديل الاختصارات محصورة بطاقم الإدارة أو الرتب المصرح لها.');
      return;
    }

    const cleanTrigger = sanitizeText(trigger)?.trim().slice(0, 32);
    const cleanReplacement = sanitizeText(replacement)?.trim().slice(0, 300);

    if (!cleanTrigger || !cleanReplacement) {
      socket.emit('systemAlert', 'يرجى إدخال رمز الاختصار والجملة البديلة كاملة.');
      return;
    }

    const item = chatShortcuts.find((s) => s.id === id);
    if (item) {
      item.trigger = cleanTrigger;
      item.replacement = cleanReplacement;
      item.createdBy = admin.username;
      item.createdAt = Date.now();
      saveShortcuts();
      io.emit('shortcutsUpdated', chatShortcuts);
      logMonitorEvent('security', `عدل المشرف [${admin.username}] الاختصار: [${cleanTrigger}] ➔ "${cleanReplacement}"`, admin.username);
      socket.emit('systemAlert', `تم تعديل الاختصار [${cleanTrigger}] بنجاح ⚡`);
    }
  });

  // Keep-Alive Heartbeat Responder (يضمن بقاء الاتصال حياً وحساب سرعة الاستجابة Ping)
  socket.on('keepAlivePing', (data?: { timestamp?: number; background?: boolean; keepOnline?: boolean; visibilityState?: string; source?: string }) => {
    const now = Date.now();
    for (const s of activeSessions.values()) {
      if (s.currentSocketId === socket.id) {
        s.lastActiveTime = now;
        break;
      }
    }
    const activeU = users.find((u) => u.id === socket.id);
    if (activeU) {
      activeU.lastActiveTime = now;
      if (pendingAwayTimers.has(activeU.username.toLowerCase())) {
        clearTimeout(pendingAwayTimers.get(activeU.username.toLowerCase())!);
        pendingAwayTimers.delete(activeU.username.toLowerCase());
      }
      const wantsOnline = data?.keepOnline !== false;
      if (activeU.presenceState === 'offline' || (wantsOnline && activeU.presenceState !== 'online')) {
        const nextState: 'online' | 'away' = wantsOnline ? 'online' : (data?.background ? 'away' : 'online');
        if (activeU.presenceState !== nextState) {
          activeU.presenceState = nextState;
          io.emit('userPresenceUpdated', { userId: activeU.id, username: activeU.username, state: nextState });
          broadcastRoomUsers(activeU.room);
          broadcastAllUsers();
        }
      }
    }
    socket.emit('keepAlivePong', {
      timestamp: now,
      clientTimestamp: data?.timestamp,
      background: Boolean(data?.background)
    });
  });

  // Restore Session without disconnect (استعادة الجلسة الفورية بتوقيع جلسة موثق لمنع انتحال الحسابات)
  socket.on('restoreSession', ({ sessionToken, username, room, deviceFingerprint, isIncognito, presenceState, cachedVersions, isAdminPanel }: { sessionToken?: string; username?: string; room?: string; deviceFingerprint?: string; isIncognito?: boolean; presenceState?: 'online' | 'away'; cachedVersions?: Record<string, string>; isAdminPanel?: boolean }) => {
    cleanExpiredBans();

    if (!sessionToken || typeof sessionToken !== 'string') {
      socket.emit('sessionRestoreFailed', { reason: 'رمز الجلسة مفقود، يرجى تسجيل الدخول.' });
      return;
    }

    if (revokedSessionTokens.has(sessionToken)) {
      socket.emit('sessionRestoreFailed', { reason: 'انتهت صلاحية الجلسة أو تم تسجيل الخروج منها.' });
      return;
    }

    let session = activeSessions.get(sessionToken);
    if (session && username && session.user.username.toLowerCase() !== username.trim().toLowerCase()) {
      socket.emit('sessionRestoreFailed', { reason: 'بيانات الجلسة لا تطابق المستخدم.' });
      return;
    }

    if (session) {
      const minVer = getMemberTokenVersion(session.user.username);
      const sessVer = typeof session.tokenVersion === 'number' && session.tokenVersion >= 1 ? session.tokenVersion : 1;
      if (sessVer < minVer) {
        activeSessions.delete(sessionToken);
        revokedSessionTokens.set(sessionToken, Date.now() + 7 * 24 * 60 * 60 * 1000);
        persistActiveSessions();
        session = undefined;
      }
    }

    // Seamless Recovery after container restart: ONLY if client presents a cryptographically verified, non-revoked HMAC sessionToken
    if (!session && username) {
      const verifiedPayload = verifySignedSessionTokenPayload(sessionToken, username);
      if (verifiedPayload) {
        const regRes = getRegisteredMember(verifiedPayload.username);
        if (regRes) {
          const foundKey = regRes.key;
          const member = regRes.member;
          const resolvedRole = member.role || 'member';
          const canGhost = Boolean(rolePermissions[resolvedRole]?.canGhostLogin);
          const restoredUser: ConnectedUser = {
            id: socket.id,
            username: foundKey,
            displayName: member.displayName || foundKey,
            room: room || 'الغرفة العامة',
            avatarSeed: foundKey,
            avatarUrl: member.avatarUrl,
            avatarFrame: member.avatarFrame,
            statusQuote: member.statusQuote || 'عضو في حسان برو',
            flag: member.flag || '🇾🇪',
            flagNumber: assignOrGetFlagNumber(foundKey, member.flag || '🇾🇪'),
            role: resolvedRole,
            likes: member.likes || 0,
            points: member.points || 0,
            isVoice: false,
            micSlot: null,
            isMuted: Boolean(member.isJailed),
            isTextMuted: Boolean(member.isJailed),
            isSpeaking: false,
            presenceState: presenceState === 'away' ? 'away' : 'online',
            ipAddress: clientIp,
            deviceInfo: member.deviceInfo || parseDeviceInfo(socket.handshake.headers['user-agent'] as string),
            deviceFingerprint: normalizeDeviceFingerprint(deviceFingerprint) || normalizeDeviceFingerprint(member.deviceFingerprint) || undefined,
            honorBadge: member.honorBadge,
            nameColor: member.nameColor,
            textColor: member.textColor,
            nameGradient: member.nameGradient,
            profileBg: member.profileBg || member.memberBg,
            memberBg: member.memberBg || member.profileBg,
            nameBannerUrl: member.nameBannerUrl,
            giftBadges: member.giftBadges || [],
            isGhost: false && canGhost,
            isIncognito: typeof isIncognito === 'boolean' ? isIncognito : member.isIncognito,
            isJailed: member.isJailed,
            joinedAt: Date.now(),
            sessionToken,
            lastActiveTime: Date.now(),
            engagement: member.engagement
          };
          session = {
            sessionToken,
            user: restoredUser,
            currentSocketId: socket.id,
            lastActiveTime: Date.now(),
            isExplicitlyLoggedOut: false,
            tokenVersion: getMemberTokenVersion(foundKey)
          };
          activeSessions.set(sessionToken, session);
          usernameToSessionMap.set(foundKey.toLowerCase(), sessionToken);
          persistActiveSessions();
          console.log(`[Session Recovery] Verified signed token and recovered session for [${foundKey}].`);
        }
      }
    }

    // Security & Verification on session candidate
    if (session && !session.isExplicitlyLoggedOut) {
      const uName = session.user.username;
      const lowerUName = uName.toLowerCase();
      const regMemberForRole = getRegisteredMember(uName)?.member;
      const effectiveSessionRole = regMemberForRole?.role || session.user.role;
      const isSessionSupremeHassan = isSupremeHassan(effectiveSessionRole);
      if (isSessionSupremeHassan && session.user.role !== effectiveSessionRole) {
        session.user.role = effectiveSessionRole;
      }

      const currentClientIp = getRealClientIp(socket);
      const incomingFp =
        normalizeDeviceFingerprint(deviceFingerprint) ||
        normalizeDeviceFingerprint(session.user.deviceFingerprint) ||
        normalizeDeviceFingerprint(regMemberForRole?.deviceFingerprint);
      const incomingUid = getPersistentUid(incomingFp);
      const incomingCore = getHardwareCore(incomingFp);
      const incomingCrossHw = getCrossBrowserHwId(incomingFp);
      const coreAccounts = incomingCore ? fingerprintToAccountsMap.get(incomingCore) : undefined;
      const isCoreSharedWithInnocent = coreAccounts
        ? Array.from(coreAccounts).some((acc) => !bannedUsers.has(acc.toLowerCase()))
        : false;
      const crossHwAccounts = incomingCrossHw ? fingerprintToAccountsMap.get(`HW:${incomingCrossHw}`) : undefined;
      const isCrossHwSharedWithInnocent = crossHwAccounts
        ? Array.from(crossHwAccounts).some((acc) => !bannedUsers.has(acc.toLowerCase()))
        : false;

      // 1. Strict Ban Check on Session Restore (supreme 'hassan' rank is always immune and can enter even if banned)
      if (!isSessionSupremeHassan) {
        const matchedRecord = Array.from(bannedRecords.values()).find((r) => {
          if ((r.ip && r.ip === currentClientIp) || r.username.toLowerCase() === lowerUName) return true;
          if (!incomingFp) return false;
          const recFps = getAllRecordFingerprints(r);
          return recFps.some(
            (rfp) =>
              rfp === incomingFp ||
              (incomingUid && getPersistentUid(rfp) === incomingUid) ||
              (!isCoreSharedWithInnocent && incomingCore && getHardwareCore(rfp) === incomingCore) ||
              (!isCrossHwSharedWithInnocent && incomingCrossHw && getCrossBrowserHwId(rfp) === incomingCrossHw) ||
              areFingerprintsFromSameDevice(incomingFp, rfp).match
          );
        });
        const isFpBanned = Boolean(
          (incomingFp && bannedDeviceFingerprints.has(incomingFp)) ||
          (incomingUid && bannedDeviceFingerprints.has(`UID:${incomingUid}`)) ||
          (!isCoreSharedWithInnocent && incomingCore && bannedDeviceFingerprints.has(incomingCore)) ||
          (!isCrossHwSharedWithInnocent && incomingCrossHw && bannedDeviceFingerprints.has(`HW:${incomingCrossHw}`))
        );
        const isBanned = Boolean(matchedRecord) || bannedUsers.has(lowerUName) || bannedIps.has(currentClientIp) || isFpBanned;

        if (isBanned) {
          if (!matchedRecord?.expiresAt) {
            if (isBannableIp(currentClientIp)) bannedIps.add(currentClientIp);
            bannedUsers.add(lowerUName);
            addFingerprintToBanSet(incomingFp);
            saveBans();
          }
          session.isExplicitlyLoggedOut = true;
          activeSessions.delete(session.sessionToken);
          usernameToSessionMap.delete(lowerUName);
          persistActiveSessions();
          socket.emit('sessionRestoreFailed', { reason: '🚫 تم حظر جهازك نهائياً من دخول حسان برو بقرار إداري صارم (تم التعرف على بصمة الجهاز حتى مع تغيير الـ IP أو استخدام VPN).' });
          return;
        }
      }

      // 2. Strict Kick Cooldown Check (exempt supreme 'hassan' rank)
      const kickUntil = kickedCooldownMap.get(lowerUName) || kickedCooldownMap.get(currentClientIp);
      if (!isSessionSupremeHassan && kickUntil && kickUntil > Date.now()) {
        const remainingSecs = Math.ceil((kickUntil - Date.now()) / 1000);
        socket.emit('sessionRestoreFailed', { reason: `⚠️ تم طردك مؤقتاً بقرار إداري. يرجى الانتظار ${remainingSecs} ثانية قبل إعادة الدخول.` });
        return;
      }

      // 3. Emergency Lockdown Check
      if (serverSecurity.emergencyLockdown) {
        if (!isSupremeHassan(session.user) && session.user.role !== 'admin' && session.user.role !== 'super') {
          socket.emit('sessionRestoreFailed', { reason: '🔒 وضع الطوارئ الإداري مفعل حالياً. الدخول محصور بالإدارة والمشرفين.' });
          return;
        }
      }

      // 4. Jail & Persistent Mute Enforcement & Valid Room Resolution
      const isUserJailed = jailedUsernames.has(lowerUName) || 
                           jailedIps.has(currentClientIp) || 
                           Boolean(session.user.isJailed || getRegisteredMember(uName)?.member.isJailed);

      const sessionMuteMatch = findActiveMuteMatch(uName, currentClientIp, incomingFp);
      if (sessionMuteMatch.isMuted) {
        syncMuteRecordOnReentry(uName, currentClientIp, incomingFp, sessionMuteMatch);
      }
      const effSessionTextMuted = Boolean(isUserJailed || sessionMuteMatch.muteText);
      const effSessionVoiceMuted = Boolean(isUserJailed || sessionMuteMatch.muteVoice);
      const effSessionMuted = Boolean(effSessionTextMuted || effSessionVoiceMuted);

      const sessionRoomCanonical = resolveCanonicalRoomId(session.user.room) || 'الغرفة العامة';
      let targetRoom = 'الغرفة العامة';
      if (isUserJailed) {
        targetRoom = 'سجن حسان برو';
      } else {
        const candidateInput = room || session.user.room || 'الغرفة العامة';
        if (candidateInput === 'خارج الغرف') {
          targetRoom = 'خارج الغرف';
        } else {
          const requestedDef = findRoomDefinition(candidateInput);
          if (!requestedDef) {
            targetRoom = sessionRoomCanonical === 'خارج الغرف' ? 'الغرفة العامة' : sessionRoomCanonical;
          } else if (
            requestedDef.id !== sessionRoomCanonical &&
            requestedDef.isPasswordProtected &&
            requestedDef.password &&
            !isSupremeHassan(session.user) &&
            session.user.role !== 'admin' &&
            getRoleLevel(session.user.role) < getRoleLevel('admin')
          ) {
            targetRoom = sessionRoomCanonical;
          } else {
            targetRoom = requestedDef.id;
          }
        }
      }

      if (isAdminPanel) {
        const memberRegAdmin = getRegisteredMember(uName)?.member;
        if (memberRegAdmin) {
          session.user.displayName = memberRegAdmin.displayName || session.user.displayName || session.user.username;
          session.user.nameBannerUrl = memberRegAdmin.nameBannerUrl;
          session.user.giftBadges = memberRegAdmin.giftBadges;
          session.user.role = memberRegAdmin.role || session.user.role;
        }
        session.lastActiveTime = Date.now();
        adminPanelUsers.set(socket.id, session.user);
        (socket as any).__isAdminPanelSocket = true;

        socket.emit('sessionRestored', {
          user: session.user,
          sessionToken: session.sessionToken,
          room: targetRoom
        });

        const adminRoomSettings = roomSettingsMap[targetRoom] || { isChatLocked: false, slowModeSeconds: 0, isVoiceLocked: false };
        const reqVerAdmin = cachedVersions && typeof cachedVersions === 'object' ? cachedVersions : {};
        const currentVerAdmin = getConfigVersionsSnapshot();
        socket.emit('chatConfigSync', {
          ...(reqVerAdmin.rooms !== currentVerAdmin.rooms ? { rooms: getChatRoomsWithLiveCounts() } : {}),
          roomSettings: adminRoomSettings,
          versions: currentVerAdmin,
          ...(reqVerAdmin.appearance !== currentVerAdmin.appearance
            ? {
                globalAppearance,
                generalWelcome: generalWelcomeSettings,
                likesSettings
              }
            : {}),
          ...(reqVerAdmin.emblems !== currentVerAdmin.emblems ? { emblemsConfig } : {}),
          ...(reqVerAdmin.membershipCatalog !== currentVerAdmin.membershipCatalog ? { membershipDesignCatalog } : {}),
          ...(reqVerAdmin.roles !== currentVerAdmin.roles
            ? {
                rolesConfig,
                rolePermissions
              }
            : {}),
          ...(reqVerAdmin.shortcuts !== currentVerAdmin.shortcuts ? { shortcuts: chatShortcuts } : {}),
          ...(reqVerAdmin.retentionLimits !== currentVerAdmin.retentionLimits ? { messageRetentionLimits } : {}),
          ...(reqVerAdmin.quality !== currentVerAdmin.quality ? { chatQualitySettings } : {}),
          serverSecurity: isStaffUser(session.user)
            ? serverSecurity
            : {
                marqueeTicker: serverSecurity.marqueeTicker,
                guestsAllowed: serverSecurity.guestsAllowed,
                emergencyLockdown: serverSecurity.emergencyLockdown,
                blockExternalLinks: serverSecurity.blockExternalLinks,
                offlineGraceSeconds: serverSecurity.offlineGraceSeconds ?? 300,
                micGraceSeconds: serverSecurity.micGraceSeconds ?? 90,
                awayDelaySeconds: serverSecurity.awayDelaySeconds ?? 120,
                reconnectBannerDelaySeconds: serverSecurity.reconnectBannerDelaySeconds ?? 10,
                likeCooldownSeconds: serverSecurity.likeCooldownSeconds ?? 60
              }
        });

        broadcastAllUsers();
        if (isStaffUser(session.user)) {
          socket.emit('adminInitialData', {
            bannedList: Array.from(bannedRecords.values()),
            mutedList: Array.from(mutedRecords.values()),
            staffMemos,
            filterAlerts,
            monitoredWords,
            rolePermissions,
            rolesConfig,
            serverSecurity,
            monitorLogs: monitorLogs.slice(0, 1000),
            messageRetentionLimits
          });
        }
        botController.emitStateToAdmin(socket);
        return;
      }

      if (pendingAwayTimers.has(lowerUName)) {
        clearTimeout(pendingAwayTimers.get(lowerUName)!);
        pendingAwayTimers.delete(lowerUName);
      }
      if (pendingMicGraceTimers.has(lowerUName)) {
        clearTimeout(pendingMicGraceTimers.get(lowerUName)!);
        pendingMicGraceTimers.delete(lowerUName);
      }

      const oldSocketId = session.currentSocketId;
      session.currentSocketId = socket.id;
      session.lastActiveTime = Date.now();
      session.user.id = socket.id;
      session.user.presenceState = presenceState === 'away' ? 'away' : 'online';
      session.user.room = targetRoom;

      // Transfer any active live broadcast or viewer entry to the new socket before closing the old socket
      let supersededOldSocket: any = null;
      const reconnectedBroadcasts: RoomLiveBroadcast[] = [];
      if (oldSocketId && oldSocketId !== socket.id) {
        for (const [rId, live] of Array.from(activeLiveBroadcasts.entries())) {
          if (live.broadcasterId === oldSocketId) {
            if (rId === targetRoom) {
              live.broadcasterId = socket.id;
              reconnectedBroadcasts.push(live);
            } else {
              activeLiveBroadcasts.delete(rId);
              io.to(rId).emit('liveBroadcastEnded', { room: rId, broadcasterUsername: live.broadcasterUsername });
            }
          }
          if (live.viewers.includes(oldSocketId)) {
            if (rId === targetRoom) {
              live.viewers = live.viewers.map((id) => (id === oldSocketId ? socket.id : id));
            } else {
              live.viewers = live.viewers.filter((id) => id !== oldSocketId);
              io.to(rId).emit('liveViewerCountUpdated', { room: rId, count: live.viewers.length });
              if (live.broadcasterId) {
                io.to(live.broadcasterId).emit('liveViewerLeft', { viewerId: oldSocketId });
              }
            }
          }
        }
        const existingUserEntry = users.find((u) => u.id === oldSocketId);
        if (existingUserEntry) {
          existingUserEntry.id = socket.id;
        }
        supersededOldSocket = io.sockets.sockets.get(oldSocketId) || null;
        if (supersededOldSocket) {
          (supersededOldSocket as any).__supersededBySessionRestore = true;
        }
      }
      session.user.isJailed = isUserJailed;
      session.user.isTextMuted = effSessionTextMuted;
      session.user.isVoiceMutedByAdmin = effSessionVoiceMuted;
      session.user.isMuted = effSessionMuted;

      if (targetRoom && targetRoom !== 'خارج الغرف') {
        socket.join(targetRoom);
      }

      const memberReg = getRegisteredMember(uName)?.member;
      if (memberReg) {
        session.user.displayName = memberReg.displayName || session.user.displayName || session.user.username;
        session.user.nameBannerUrl = memberReg.nameBannerUrl;
        session.user.giftBadges = memberReg.giftBadges;
        session.user.role = memberReg.role || session.user.role;
      }
      session.user.flagNumber = assignOrGetFlagNumber(session.user.username, session.user.flag || memberReg?.flag || '🇾🇪');

      const clientUserAgent = (socket.handshake.headers['user-agent'] as string) || '';
      const clientDevice = parseDeviceInfo(clientUserAgent);
      session.user.ipAddress = currentClientIp;
      session.user.deviceInfo = clientDevice;
      if (incomingFp) session.user.deviceFingerprint = incomingFp;
      if (typeof isIncognito === 'boolean') {
        session.user.isIncognito = isIncognito;
        if (memberReg) memberReg.isIncognito = isIncognito;
      }
      recordMemberAuditConnection(session.user.username, currentClientIp, clientDevice, session.user.flag || '🇾🇪', incomingFp || undefined);

      // Purge any duplicate records of this user across the users array
      let foundExisting = false;
      for (let i = users.length - 1; i >= 0; i--) {
        if (users[i].username.toLowerCase() === lowerUName) {
          if (!foundExisting) {
            users[i].id = socket.id;
            users[i].room = targetRoom;
            users[i].presenceState = presenceState === 'away' ? 'away' : 'online';
            users[i].lastActiveTime = Date.now();
            users[i].ipAddress = currentClientIp;
            users[i].deviceInfo = clientDevice;
            if (incomingFp) users[i].deviceFingerprint = incomingFp;
            if (typeof isIncognito === 'boolean') users[i].isIncognito = isIncognito;
            users[i].displayName = session.user.displayName || session.user.username;
            users[i].nameBannerUrl = session.user.nameBannerUrl;
            users[i].giftBadges = session.user.giftBadges;
            users[i].role = session.user.role;
            users[i].flagNumber = session.user.flagNumber;
            users[i].isJailed = isUserJailed;
            users[i].isTextMuted = effSessionTextMuted;
            users[i].isVoiceMutedByAdmin = effSessionVoiceMuted;
            users[i].isMuted = effSessionMuted;
            session.user = users[i];
            foundExisting = true;
          } else {
            // Remove duplicate zombie entry
            users.splice(i, 1);
          }
        }
      }
      if (!foundExisting) {
        users.unshift(session.user);
      }

      if (supersededOldSocket) {
        try {
          supersededOldSocket.disconnect(true);
        } catch {}
      }

      if (session.user.micSlot !== null && !isUserJailed && targetRoom && targetRoom !== 'خارج الغرف') {
        const slots = getMicSlotsForRoom(targetRoom);
        const slot = slots.find((s) => s.slotNumber === session!.user.micSlot);
        if (slot) {
          slot.user = toPublicConnectedUser(session.user);
          io.to(targetRoom).emit('micSlotsUpdated', getPublicMicSlotsForRoom(targetRoom));
          broadcastRoomsUpdate();
        }
      } else if (isUserJailed && session.user.micSlot !== null) {
        releaseUserMic(session.user);
      }

      socket.emit('sessionRestored', {
        user: session.user,
        sessionToken: session.sessionToken,
        room: targetRoom
      });

      if (effSessionTextMuted || effSessionVoiceMuted) {
        socket.emit('forceVoiceMuteState', {
          muted: Boolean(effSessionVoiceMuted || effSessionTextMuted),
          textMuted: effSessionTextMuted,
          voiceMuted: effSessionVoiceMuted,
          by: sessionMuteMatch.matchedRecord?.mutedBy || 'النظام الأمني'
        });
      }

      const restoredRoomSettings = roomSettingsMap[targetRoom] || { isChatLocked: false, slowModeSeconds: 0, isVoiceLocked: false };
      const reqVer = cachedVersions && typeof cachedVersions === 'object' ? cachedVersions : {};
      const currentVer = getConfigVersionsSnapshot();
      socket.emit('chatConfigSync', {
        ...(reqVer.rooms !== currentVer.rooms ? { rooms: getChatRoomsWithLiveCounts() } : {}),
        roomSettings: restoredRoomSettings,
        versions: currentVer,
        ...(reqVer.appearance !== currentVer.appearance
          ? {
              globalAppearance,
              generalWelcome: generalWelcomeSettings,
              likesSettings
            }
          : {}),
        ...(reqVer.emblems !== currentVer.emblems ? { emblemsConfig } : {}),
        ...(reqVer.membershipCatalog !== currentVer.membershipCatalog ? { membershipDesignCatalog } : {}),
        ...(reqVer.roles !== currentVer.roles
          ? {
              rolesConfig,
              rolePermissions
            }
          : {}),
        ...(reqVer.shortcuts !== currentVer.shortcuts ? { shortcuts: chatShortcuts } : {}),
        ...(reqVer.retentionLimits !== currentVer.retentionLimits ? { messageRetentionLimits } : {}),
        ...(reqVer.recentLogins !== currentVer.recentLogins ? { recentLogins: getRecentLogins() } : {}),
        ...(reqVer.quality !== currentVer.quality ? { chatQualitySettings } : {}),
        ...(reqVer.serverSecurity !== currentVer.serverSecurity
          ? {
              serverSecurity: {
                marqueeTicker: serverSecurity.marqueeTicker,
                guestsAllowed: serverSecurity.guestsAllowed,
                emergencyLockdown: serverSecurity.emergencyLockdown,
                blockExternalLinks: serverSecurity.blockExternalLinks,
                offlineGraceSeconds: serverSecurity.offlineGraceSeconds ?? 300,
                micGraceSeconds: serverSecurity.micGraceSeconds ?? 90,
                awayDelaySeconds: serverSecurity.awayDelaySeconds ?? 120,
                reconnectBannerDelaySeconds: serverSecurity.reconnectBannerDelaySeconds ?? 10,
                likeCooldownSeconds: serverSecurity.likeCooldownSeconds ?? 60
              }
            }
          : {})
      });

      // Deliver queued offline private messages if any (persisted in MongoDB)
      const pendingPmList = offlinePrivateMessages.get(lowerUName);
      if (pendingPmList && pendingPmList.length > 0) {
        socket.emit('offlinePrivateMessages', pendingPmList);
        offlinePrivateMessages.delete(lowerUName);
        saveOfflinePrivateMessages();
      }

      // Sync user personal member data (ignored users, starred messages, friends) from MongoDB
      const regMemberData = getRegisteredMember(session.user.username)?.member;
      if (regMemberData) {
        socket.emit('userMemberDataSync', {
          ignoredUsers: regMemberData.ignoredUsers || [],
          starredMessages: regMemberData.starredMessages || [],
          friends: regMemberData.friends || []
        });
      }

      io.emit('userPresenceUpdated', { userId: socket.id, username: session.user.username, state: session.user.presenceState || 'online' });
      if (targetRoom && targetRoom !== 'خارج الغرف') {
        broadcastRoomUsers(targetRoom);
        emitRoomContextSync(socket, targetRoom);
      } else {
        socket.emit('roomUsers', { room: 'خارج الغرف', users: [] });
        socket.emit('currentLiveBroadcast', null);
      }
      broadcastAllUsers();
      broadcastRoomsUpdate();

      // Re-sync live broadcast WebRTC viewer connections if broadcaster restored session
      for (const live of reconnectedBroadcasts) {
        live.viewers.forEach((viewerId) => {
          if (viewerId !== socket.id) {
            io.to(viewerId).emit('liveBroadcasterReconnected', { broadcasterId: socket.id, room: live.room });
            const viewerUser = users.find((u) => u.id === viewerId);
            socket.emit('liveViewerJoined', {
              viewerId,
              viewerUsername: viewerUser?.username || 'مشاهد'
            });
          }
        });
      }

      // Notify active speakers in this room so they initiate WebRTC audio to the restored listener,
      // and if the restored user themselves holds an active mic, send them all room peers so WebRTC resumes!
      if (targetRoom && targetRoom !== 'خارج الغرف') {
        users
          .filter((u) => u.room === targetRoom && u.isVoice && u.id !== socket.id)
          .forEach((speaker) => {
            io.to(speaker.id).emit('voiceNewListener', {
              id: socket.id,
              username: session!.user.username
            });
          });

        if (session.user.isVoice && session.user.micSlot !== null) {
          const otherRoomPeers = users
            .filter((u) => u.room === targetRoom && u.id !== socket.id)
            .map((u) => ({ id: u.id, username: u.username, isVoice: Boolean(u.isVoice) }));
          socket.emit('voiceRoomUsers', otherRoomPeers);
          socket.broadcast.to(targetRoom).emit('userJoinedVoice', toPublicConnectedUser(session.user));
        }
      }

      if (isStaffUser(session.user)) {
        socket.emit('adminInitialData', {
          bannedList: Array.from(bannedRecords.values()),
          mutedList: Array.from(mutedRecords.values()),
          staffMemos,
          filterAlerts,
          monitoredWords,
          rolePermissions,
          rolesConfig,
          serverSecurity,
          monitorLogs: monitorLogs.slice(0, 1000),
          messageRetentionLimits
        });
      }
      botController.emitStateToAdmin(socket);
    } else {
      socket.emit('sessionRestoreFailed', { reason: 'انتهت صلاحية الجلسة أو تم تسجيل الدخول من جهاز آخر.' });
    }
  });

  // Explicit Logout by user himself (لا يفصل إلا إذا سجل خروج هو بنفسه)
  socket.on('explicitLogout', ({ sessionToken }: { sessionToken?: string } = {}) => {
    let session = sessionToken ? activeSessions.get(sessionToken) : undefined;
    if (!session) {
      for (const s of activeSessions.values()) {
        if (s.currentSocketId === socket.id) {
          session = s;
          break;
        }
      }
    }

    const uName = session?.user?.username || findSocketUser(socket.id)?.username;
    if (uName) {
      for (const [aid, au] of adminPanelUsers.entries()) {
        if (aid === socket.id || au.username.toLowerCase() === uName.toLowerCase()) {
          adminPanelUsers.delete(aid);
        }
      }
    } else {
      adminPanelUsers.delete(socket.id);
    }
    if (uName && pendingAwayTimers.has(uName.toLowerCase())) {
      clearTimeout(pendingAwayTimers.get(uName.toLowerCase())!);
      pendingAwayTimers.delete(uName.toLowerCase());
    }

    if (session || uName) {
      revokeUserSessionTokens({
        sessionToken: session?.sessionToken || sessionToken,
        username: session?.user?.username || uName,
        bumpVersion: true
      });
    }

    const idx = users.findIndex((u) => u.id === socket.id || (uName && u.username.toLowerCase() === uName.toLowerCase()));
    cleanupUserLiveState(socket.id);
    if (idx !== -1) {
      const user = users.splice(idx, 1)[0];
      if (user.id && user.id !== socket.id) {
        cleanupUserLiveState(user.id);
      }
      if (user.micSlot !== null || user.isVoice) {
        releaseUserMic(user, user.room);
      }
      logMonitorEvent('leave', `سجل ${user.username} خروجاً رسمياً من الدردشة${user.isGhost ? ' (دخول مخفي 👻)' : ''}`, user.username);
      if (user.room && user.room !== 'خارج الغرف') {
        if (!user.isGhost) {
          const farewellMessage: StoredMessage = {
            id: `logout-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
            room: user.room,
            username: user.username,
            avatarUrl: user.avatarUrl,
            nameBannerUrl: user.nameBannerUrl,
            flag: user.flag,
            badge: 'تسجيل خروج 🌹',
            badgeColor: 'text-rose-400',
            text: `سجل ${user.username} خروجه من الدردشة، في أمان الله 🌹`,
            time: getCurrentTimeString(),
            timestamp: Date.now()
          };
          chatHistory.push(farewellMessage);
          saveHistory();
          io.to(user.room).emit('message', farewellMessage);
        }
        broadcastRoomUsers(user.room);
      }
      broadcastAllUsers();
    }

    socket.emit('loggedOutSuccess');
  });

  // Reveal Nicks & Account Discovery (كشف النكات والآي بي والعضويات للأعضاء المتصلين وغير المتصلين)
  const executeRevealNicks = (admin: ConnectedUser | undefined, targetUsername: string) => {
    if (
      !admin ||
      (!isSupremeHassan(admin) &&
        admin.role !== 'admin' &&
        admin.role !== 'super' &&
        !hasPermission(admin.role, 'canRevealNicks') &&
        getRoleLevel(admin.role) < 75)
    ) {
      socket.emit('systemAlert', 'كشف النكات محصور بمدير النظام والمشرفين المصرح لهم.');
      return;
    }

    const cleanTargetName = (targetUsername || '').trim();
    if (!cleanTargetName) return;
    const lowerTarget = cleanTargetName.toLowerCase();

    // 1. Check if user is currently online in memory (match username or displayName)
    const targetUser =
      users.find((u) => u.username.toLowerCase() === lowerTarget) ||
      users.find((u) => (u.displayName || '').trim().toLowerCase() === lowerTarget);

    // 2. Look up member in registeredMembers (by login key, live username, displayName, or originalUsername)
    const regFound =
      getRegisteredMember(cleanTargetName) ||
      (targetUser ? getRegisteredMember(targetUser.username) : null) ||
      getRegisteredMemberByDisplayName(cleanTargetName) ||
      getRegisteredMemberByOriginalUsername(cleanTargetName);

    const regKey = regFound?.key;
    const regMember = regFound?.member;
    const resolvedLoginUsername = regKey || targetUser?.username || cleanTargetName;
    const resolvedOriginalUsername = regMember?.originalUsername || regKey || targetUser?.username || cleanTargetName;
    const resolvedDisplayName = targetUser?.displayName || regMember?.displayName || resolvedLoginUsername;
    const lowerResolved = resolvedLoginUsername.toLowerCase();
    const lowerOriginal = resolvedOriginalUsername.toLowerCase();

    // 3. Look up active session if present
    const sessionMatch = Array.from(activeSessions.values()).find(
      (s) =>
        s.user?.username?.toLowerCase() === lowerResolved ||
        s.user?.username?.toLowerCase() === lowerTarget ||
        s.user?.username?.toLowerCase() === lowerOriginal
    );

    // 4. Collect ALL real IPs this member has ever entered with
    const discoveredIps = new Set<string>();

    const addIpIfValid = (candidate?: string) => {
      if (!candidate) return;
      const trimmed = candidate.trim();
      if (!trimmed || trimmed === '192.168.1.100' || trimmed.toLowerCase() === 'unknown') return;
      discoveredIps.add(trimmed);
    };

    // Live socket/online IPs
    addIpIfValid(targetUser?.ipAddress);
    addIpIfValid(targetUser?.ip);

    // Persistent member real IP and full IP history
    addIpIfValid(regMember?.ipAddress);
    if (Array.isArray(regMember?.ipHistory)) {
      regMember.ipHistory.forEach((ip) => addIpIfValid(ip));
    }

    // Active session stored IP
    addIpIfValid(sessionMatch?.user?.ipAddress);
    addIpIfValid(sessionMatch?.user?.ip);

    // Cross-check ipToAccountsMap
    for (const [ip, nicks] of ipToAccountsMap.entries()) {
      if (
        Array.from(nicks).some((n) => {
          const ln = n.toLowerCase();
          return ln === lowerTarget || ln === lowerResolved || ln === lowerOriginal;
        })
      ) {
        addIpIfValid(ip);
      }
    }

    // Cross-check ban/jail records
    for (const record of bannedRecords.values()) {
      const lr = record.username.toLowerCase();
      if ((lr === lowerTarget || lr === lowerResolved || lr === lowerOriginal) && record.ip) {
        addIpIfValid(record.ip);
      }
    }
    for (const record of jailedRecords.values()) {
      const lr = record.username.toLowerCase();
      if ((lr === lowerTarget || lr === lowerResolved || lr === lowerOriginal) && record.ip) {
        addIpIfValid(record.ip);
      }
    }

    const ipHistoryList = Array.from(discoveredIps);

    // Determine primary IP: prefer live online IP, then registered IP, then latest from history
    let primaryIp = targetUser?.ipAddress || regMember?.ipAddress || (ipHistoryList.length > 0 ? ipHistoryList[0] : '');
    if (!primaryIp || primaryIp === '192.168.1.100') {
      primaryIp = ipHistoryList.length > 0 ? ipHistoryList[0] : 'غير مسجل';
    }

    // 5. Correlate and discover ALL accounts sharing ANY of these real IPs or hardware fingerprints
    const accountsSet = new Set<string>();
    const canonicalAccountKey = (rawNick: string): string => {
      const trimmed = (rawNick || '').trim();
      if (!trimmed) return trimmed;
      const byKey = getRegisteredMember(trimmed);
      if (byKey) return byKey.key;
      const byOrig = getRegisteredMemberByOriginalUsername(trimmed);
      if (byOrig) return byOrig.key;
      return trimmed;
    };
    const addDiscoveredAccount = (rawNick: string) => {
      const canonical = canonicalAccountKey(rawNick);
      if (canonical) accountsSet.add(canonical);
    };
    addDiscoveredAccount(resolvedLoginUsername);

    // Correlate by all discovered real IPs
    ipHistoryList.forEach((ip) => {
      const mappedNicks = ipToAccountsMap.get(ip);
      if (mappedNicks) {
        mappedNicks.forEach((nick) => addDiscoveredAccount(nick));
      }
      for (const [mName, mData] of Object.entries(registeredMembers)) {
        if (mData.ipAddress === ip || (Array.isArray(mData.ipHistory) && mData.ipHistory.includes(ip))) {
          addDiscoveredAccount(mName);
        }
      }
      users.forEach((u) => {
        if (u.ipAddress === ip || u.ip === ip) {
          addDiscoveredAccount(u.username);
        }
      });
    });

    // Correlate by Hardware Fingerprint, Persistent UID, GPU, and Hardware Core
    const candidateFps = new Set<string>();
    const addCandidateFp = (f?: string) => {
      if (!f) return;
      const t = f.trim();
      if (t && t !== 'FP-DEV-STANDARD') candidateFps.add(t);
    };

    addCandidateFp(targetUser?.deviceFingerprint);
    addCandidateFp(regMember?.deviceFingerprint);
    if (Array.isArray(regMember?.fingerprintHistory)) {
      regMember.fingerprintHistory.forEach((f) => addCandidateFp(f));
    }
    addCandidateFp(sessionMatch?.user?.deviceFingerprint);
    if (primaryIp && primaryIp !== 'غير مسجل') {
      addCandidateFp(ipToFingerprintMap.get(primaryIp));
    }

    const resolvedFingerprint =
      targetUser?.deviceFingerprint ||
      regMember?.deviceFingerprint ||
      Array.from(candidateFps)[0] ||
      (primaryIp && primaryIp !== 'غير مسجل' ? ipToFingerprintMap.get(primaryIp) : undefined) ||
      'FP-DEV-STANDARD';

    // Account match metadata: canonical account -> reason
    const accountMatchReasons: Record<string, string> = {};
    const recordMatchReason = (rawNick: string, reason: string) => {
      const canonical = canonicalAccountKey(rawNick);
      if (canonical && !accountMatchReasons[canonical]) {
        accountMatchReasons[canonical] = reason;
      }
    };

    if (candidateFps.size > 0) {
      candidateFps.forEach((fpItem) => {
        const targetUid = getPersistentUid(fpItem);
        const targetCore = getHardwareCore(fpItem);
        const targetCrossHw = getCrossBrowserHwId(fpItem);
        const comps = parseFingerprintComponents(fpItem);

        // 1. Direct and multi-key map lookup in fingerprintToAccountsMap
        const directMapped = fingerprintToAccountsMap.get(fpItem);
        if (directMapped) {
          directMapped.forEach((nick) => {
            addDiscoveredAccount(nick);
            recordMatchReason(nick, 'بصمة الهاتف متطابقة 100%');
          });
        }
        if (targetUid) {
          const uidMapped = fingerprintToAccountsMap.get(`UID:${targetUid}`);
          if (uidMapped) {
            uidMapped.forEach((nick) => {
              addDiscoveredAccount(nick);
              recordMatchReason(nick, 'معرف الجهاز المادي (Device UID) متطابق 100% (نفس الهاتف عبر VPN)');
            });
          }
        }
        if (targetCore) {
          const coreMapped = fingerprintToAccountsMap.get(`CORE:${targetCore}`) || fingerprintToAccountsMap.get(targetCore);
          if (coreMapped) {
            coreMapped.forEach((nick) => {
              addDiscoveredAccount(nick);
              recordMatchReason(nick, 'تطابق عتاد الهاتف الداخلي (Hardware Core) حتى مع اختلاف IP');
            });
          }
        }
        if (targetCrossHw && targetCrossHw !== 'hwerr') {
          const hwMapped = fingerprintToAccountsMap.get(`HW:${targetCrossHw}`);
          if (hwMapped) {
            hwMapped.forEach((nick) => {
              addDiscoveredAccount(nick);
              recordMatchReason(nick, 'تطابق بصمة العتاد العابرة للمتصفحات (Cross-Browser HW)');
            });
          }
        }
        if (comps) {
          if (comps.webglHash && comps.audioHash && comps.webglHash !== 'wglerr' && comps.audioHash !== 'auderr') {
            const hwFullMapped = fingerprintToAccountsMap.get(`HARDWARE:${comps.os}_${comps.cores}_${comps.webglHash}_${comps.audioHash}`);
            if (hwFullMapped) {
              hwFullMapped.forEach((nick) => {
                addDiscoveredAccount(nick);
                recordMatchReason(nick, 'تطابق كامل لمعالج الرسوميات (GPU) والصوت والأنوية (نفس الجهاز عبر VPN)');
              });
            }
          }
        }

        // 2. Comprehensive deep comparison across ALL registered members
        for (const [mName, mData] of Object.entries(registeredMembers)) {
          const mFps = [mData.deviceFingerprint, ...(mData.fingerprintHistory || [])].filter(Boolean) as string[];
          for (const mf of mFps) {
            const result = areFingerprintsFromSameDevice(fpItem, mf);
            if (result.match) {
              addDiscoveredAccount(mName);
              recordMatchReason(mName, `${result.reason} (${result.confidence}%)`);
              break;
            }
          }
        }

        // 3. Deep comparison across live online users
        users.forEach((u) => {
          if (u.deviceFingerprint) {
            const result = areFingerprintsFromSameDevice(fpItem, u.deviceFingerprint);
            if (result.match) {
              addDiscoveredAccount(u.username);
              recordMatchReason(u.username, `${result.reason} (${result.confidence}%)`);
            }
          }
        });
      });
    }

    const accounts = Array.from(accountsSet);
    const memberKeysOrder = Object.keys(registeredMembers);

    // Enrich every discovered account with originalUsername, displayName, registration status, and order
    const rawAccountDetails = accounts.map((acc) => {
      const mRes = getRegisteredMember(acc) || getRegisteredMemberByOriginalUsername(acc);
      const mKey = mRes?.key || acc;
      const mData = mRes?.member;
      const liveAcc = users.find((u) => u.username.toLowerCase() === mKey.toLowerCase());
      const accRole = liveAcc?.role || mData?.role || 'guest';
      const isGuest = accRole === 'guest';
      const isRegistered = Boolean(mData && !isGuest);
      const accOriginalUsername = mData?.originalUsername || mKey;
      const accDisplayName = liveAcc?.displayName || mData?.displayName || mKey;
      const accFlag = liveAcc?.flag || mData?.flag || '';
      const accFlagNumber = liveAcc?.flagNumber || mData?.flagNumber;
      const orderIdx = memberKeysOrder.findIndex((k) => k.toLowerCase() === mKey.toLowerCase());
      return {
        username: mKey,
        originalUsername: accOriginalUsername,
        displayName: accDisplayName,
        role: accRole,
        isGuest,
        isRegistered,
        isTarget: mKey.toLowerCase() === lowerResolved,
        isFirstRegistered: false,
        flag: accFlag,
        flagNumber: accFlagNumber,
        reason: accountMatchReasons[acc] || accountMatchReasons[mKey],
        isOnline: Boolean(liveAcc && liveAcc.presenceState !== 'offline'),
        registeredAt: mData?.registeredAt,
        _orderIdx: orderIdx === -1 ? Number.MAX_SAFE_INTEGER : orderIdx
      };
    });

    // Identify the earliest / primary registered membership on this device/IP
    const registeredCandidates = rawAccountDetails.filter((a) => a.isRegistered);
    const poolForFirst = registeredCandidates.length > 0 ? registeredCandidates : rawAccountDetails;
    let firstAccountCandidate = poolForFirst[0];
    for (const candidate of poolForFirst) {
      const candTs = candidate.registeredAt ?? Number.MAX_SAFE_INTEGER;
      const bestTs = firstAccountCandidate.registeredAt ?? Number.MAX_SAFE_INTEGER;
      if (candTs < bestTs || (candTs === bestTs && candidate._orderIdx < firstAccountCandidate._orderIdx)) {
        firstAccountCandidate = candidate;
      }
    }
    if (firstAccountCandidate) {
      firstAccountCandidate.isFirstRegistered = true;
    }

    const accountDetails = rawAccountDetails.map(({ _orderIdx, ...rest }) => rest);

    // 6. Device, country, presence and last seen resolution
    const resolvedDevice =
      targetUser?.deviceInfo ||
      regMember?.deviceInfo ||
      (Array.isArray(regMember?.deviceHistory) && regMember.deviceHistory[regMember.deviceHistory.length - 1]) ||
      (primaryIp && primaryIp !== 'غير مسجل' ? ipToDeviceMap.get(primaryIp) : undefined) ||
      'هاتف ذكي / كمبيوتر';

    const resolvedCountry =
      targetUser?.flag ||
      regMember?.flag ||
      (primaryIp && primaryIp !== 'غير مسجل' ? ipToCountryMap.get(primaryIp) : undefined) ||
      '🇾🇪';

    const isUserOnline = !!targetUser && targetUser.presenceState !== 'offline';
    const resolvedRole = targetUser?.role || regMember?.role || 'member';
    const resolvedRoom = isUserOnline ? (targetUser?.room || 'الغرفة العامة') : 'غير متصل (أوفلاين)';
    const resolvedLastSeen = isUserOnline
      ? 'متصل الآن'
      : regMember?.lastSeen
      ? new Date(regMember.lastSeen).toLocaleString('ar-EG', { dateStyle: 'short', timeStyle: 'short' })
      : 'غير متوفر';
    const resolvedFlagNumber =
      targetUser?.flagNumber ||
      regMember?.flagNumber ||
      assignOrGetFlagNumber(resolvedLoginUsername, resolvedCountry);

    socket.emit('revealedNicksResult', {
      targetUsername: resolvedLoginUsername,
      originalUsername: resolvedOriginalUsername,
      displayName: resolvedDisplayName,
      flagNumber: resolvedFlagNumber,
      isRegisteredMember: Boolean(regMember && regMember.role !== 'guest'),
      firstRegisteredAccount: firstAccountCandidate
        ? {
            username: firstAccountCandidate.username,
            originalUsername: firstAccountCandidate.originalUsername,
            displayName: firstAccountCandidate.displayName,
            role: firstAccountCandidate.role,
            isGuest: firstAccountCandidate.isGuest,
            flag: firstAccountCandidate.flag,
            flagNumber: firstAccountCandidate.flagNumber
          }
        : undefined,
      accountDetails,
      ip: primaryIp,
      ipHistory: ipHistoryList,
      device: resolvedDevice,
      deviceFingerprint: resolvedFingerprint,
      country: resolvedCountry,
      accountsCount: accounts.length,
      accounts: accounts,
      accountMatchReasons: accountMatchReasons,
      role: resolvedRole,
      room: resolvedRoom,
      flag: resolvedCountry,
      isOnline: isUserOnline,
      lastSeen: resolvedLastSeen,
      isIncognito: Boolean(targetUser?.isIncognito || regMember?.isIncognito)
    });

    logMonitorEvent(
      'security',
      `كشف نكات العضو [${resolvedDisplayName}] (الأصل: ${resolvedOriginalUsername}) بواسطة ${admin.username} (IP: ${primaryIp}, عدد الآيبيهات: ${ipHistoryList.length}, عدد العضويات: ${accounts.length}, الحالة: ${isUserOnline ? 'متصل' : 'أوفلاين'})`,
      admin.username,
      resolvedLoginUsername
    );
  };

  socket.on('revealNicks', ({ targetUsername }: { targetUsername: string }) => {
    const admin = findSocketUser(socket.id);
    executeRevealNicks(admin, targetUsername);
  });


  // Get Room Statistics for Control Panel Pie Chart
  socket.on('getRoomStats', () => {
    socket.emit('roomStats', getRoomStatistics());
  });

  // Get Banned List for Control Panel (Admin/Staff Only)
  socket.on('getBannedList', () => {
    const admin = findSocketUser(socket.id);
    if (!admin || (!isStaffUser(admin) && !hasPermission(admin.role, 'canUnban'))) {
      return;
    }
    socket.emit('bannedListUpdated', Array.from(bannedRecords.values()));
  });

  // Get Persistent Muted List for Control Panel (Admin/Staff Only)
  socket.on('getMutedList', () => {
    const admin = findSocketUser(socket.id);
    if (!admin || (!isStaffUser(admin) && !hasPermission(admin.role, 'canMute') && !hasPermission(admin.role, 'canMuteVoice'))) {
      return;
    }
    socket.emit('mutedListUpdated', Array.from(mutedRecords.values()));
  });

  // Get Room Settings (locks, slow mode)
  socket.on('getRoomSettings', ({ room }: { room: string }) => {
    socket.emit('roomSettingsUpdated', { room, settings: getRoomSettings(room) });
  });

  // Verify room password server-side without ever sending passwords to clients
  socket.on('verifyRoomPassword', ({ roomId, password }: { roomId: string; password?: string }, callback?: (res: { ok: boolean; valid?: boolean; error?: string }) => void) => {
    const actor = findSocketUser(socket.id);
    const roomObj = findRoomDefinition(roomId);
    if (!roomObj) {
      callback?.({ ok: false, valid: false, error: 'الغرفة غير موجودة.' });
      return;
    }
    if (!roomObj.isPasswordProtected || !roomObj.password) {
      callback?.({ ok: true, valid: true });
      return;
    }
    if (actor && (isSupremeHassan(actor) || actor.role === 'admin' || getRoleLevel(actor.role) >= getRoleLevel('admin'))) {
      callback?.({ ok: true, valid: true });
      return;
    }
    const passRateKey = `roompw:${roomObj.id}:${clientIp}`;
    if (!checkHttpRateLimit('roompw-check', passRateKey, 8, 60_000)) {
      callback?.({ ok: false, valid: false, error: 'تم تجاوز عدد المحاولات المسموح بها، يرجى الانتظار دقيقة 🔒' });
      return;
    }
    if ((password || '').trim() === roomObj.password) {
      callback?.({ ok: true, valid: true });
    } else {
      callback?.({ ok: false, valid: false, error: 'كلمة المرور غير صحيحة، يرجى إعادة المحاولة' });
    }
  });

  // Get Server Security Settings (Full config for admins, public-safe fields for general users)
  socket.on('getServerSecurity', () => {
    const actor = findSocketUser(socket.id);
    if (isStaffUser(actor)) {
      socket.emit('serverSecurityUpdated', serverSecurity);
    } else {
      socket.emit('serverSecurityUpdated', getPublicServerSecurity(serverSecurity));
    }
  });

  // Update Server Security Settings (Admin Only)
  socket.on('updateServerSecurity', (newSettings: Partial<ServerSecuritySettings>) => {
    const admin = findSocketUser(socket.id);
    if (!admin || (!isSupremeHassan(admin) && admin.role !== 'admin' && getRoleLevel(admin.role) < getRoleLevel('admin'))) {
      socket.emit('systemAlert', 'إعدادات أمان السيرفر محصورة بمدير النظام والرتب العليا فقط.');
      return;
    }
    if (newSettings && typeof newSettings === 'object') {
      if (typeof newSettings.emergencyLockdown === 'boolean') serverSecurity.emergencyLockdown = newSettings.emergencyLockdown;
      if (typeof newSettings.guestsAllowed === 'boolean') serverSecurity.guestsAllowed = newSettings.guestsAllowed;
      if (typeof newSettings.blockExternalLinks === 'boolean') serverSecurity.blockExternalLinks = newSettings.blockExternalLinks;
      if (newSettings.floodControlRate !== undefined) {
        const rate = Math.floor(Number(newSettings.floodControlRate));
        if (Number.isFinite(rate)) serverSecurity.floodControlRate = Math.min(30, Math.max(1, rate));
      }
      if (typeof newSettings.marqueeTicker === 'string') {
        serverSecurity.marqueeTicker = sanitizeText(newSettings.marqueeTicker).slice(0, 500);
      }
      if (typeof newSettings.autoIpBanEnabled === 'boolean') serverSecurity.autoIpBanEnabled = newSettings.autoIpBanEnabled;
      if (newSettings.autoIpBanThreshold !== undefined) {
        const thresh = Math.floor(Number(newSettings.autoIpBanThreshold));
        if (Number.isFinite(thresh)) serverSecurity.autoIpBanThreshold = Math.min(20, Math.max(1, thresh));
      }
      if (newSettings.autoIpBanWindowMinutes !== undefined) {
        const winMins = Math.floor(Number(newSettings.autoIpBanWindowMinutes));
        if (Number.isFinite(winMins)) serverSecurity.autoIpBanWindowMinutes = Math.min(1440, Math.max(1, winMins));
      }
      if (newSettings.autoIpBanDurationMinutes !== undefined) {
        const durMins = Math.floor(Number(newSettings.autoIpBanDurationMinutes));
        if (Number.isFinite(durMins)) serverSecurity.autoIpBanDurationMinutes = Math.min(525600, Math.max(0, durMins));
      }
      if (typeof newSettings.geoRestrictionEnabled === 'boolean') serverSecurity.geoRestrictionEnabled = newSettings.geoRestrictionEnabled;
      if (newSettings.geoRestrictionMode === 'blacklist' || newSettings.geoRestrictionMode === 'whitelist') {
        serverSecurity.geoRestrictionMode = newSettings.geoRestrictionMode;
      }
      if (Array.isArray(newSettings.geoRestrictedCountries)) {
        serverSecurity.geoRestrictedCountries = newSettings.geoRestrictedCountries
          .filter((c): c is string => typeof c === 'string')
          .map((c) => sanitizeText(c).slice(0, 12))
          .filter(Boolean)
          .slice(0, 200);
      }
      if (typeof newSettings.geoBlockedCustomMessage === 'string') {
        serverSecurity.geoBlockedCustomMessage = sanitizeText(newSettings.geoBlockedCustomMessage).slice(0, 400);
      }
      if (newSettings.offlineGraceSeconds !== undefined) {
        const v = Math.floor(Number(newSettings.offlineGraceSeconds));
        if (Number.isFinite(v)) serverSecurity.offlineGraceSeconds = Math.min(3600, Math.max(15, v));
      }
      if (newSettings.micGraceSeconds !== undefined) {
        const v = Math.floor(Number(newSettings.micGraceSeconds));
        if (Number.isFinite(v)) serverSecurity.micGraceSeconds = Math.min(1800, Math.max(10, v));
      }
      if (newSettings.awayDelaySeconds !== undefined) {
        const v = Math.floor(Number(newSettings.awayDelaySeconds));
        if (Number.isFinite(v)) serverSecurity.awayDelaySeconds = Math.min(3600, Math.max(5, v));
      }
      if (newSettings.reconnectBannerDelaySeconds !== undefined) {
        const v = Math.floor(Number(newSettings.reconnectBannerDelaySeconds));
        if (Number.isFinite(v)) serverSecurity.reconnectBannerDelaySeconds = Math.min(120, Math.max(1, v));
      }
      if (newSettings.likeCooldownSeconds !== undefined) {
        const v = Math.floor(Number(newSettings.likeCooldownSeconds));
        if (Number.isFinite(v)) serverSecurity.likeCooldownSeconds = Math.min(86400, Math.max(5, v));
      }
    }
    saveServerSecurity();
    const publicSec = getPublicServerSecurity(serverSecurity);
    for (const s of io.sockets.sockets.values()) {
      const sUser = findSocketUser(s.id);
      if (isStaffUser(sUser)) {
        s.emit('serverSecurityUpdated', serverSecurity);
      } else {
        s.emit('serverSecurityUpdated', publicSec);
      }
    }
    logMonitorEvent('security', `تحديث إعدادات أمان الدردشة بواسطة مدير النظام [${admin.username}]`, admin.username);
    socket.emit('systemAlert', 'تم حفظ وتطبيق إعدادات أمان الدردشة بنجاح 🛡️');
  });

  socket.on('getChatQualitySettings', () => {
    socket.emit('chatQualityUpdated', chatQualitySettings);
  });

  // Update Global Chat Quality & Weak-Internet Adaptation Settings (Admin Only)
  socket.on('updateChatQualitySettings', async (newSettings: Partial<ChatQualitySettings>, callback?: (res: any) => void) => {
    const admin = findSocketUser(socket.id);
    if (!admin || (!isSupremeHassan(admin) && admin.role !== 'admin' && getRoleLevel(admin.role) < getRoleLevel('admin'))) {
      socket.emit('systemAlert', 'تعديل إعدادات جودة الشات والتكيّف محصور بمدير النظام والرتب العليا فقط.');
      if (typeof callback === 'function') {
        callback({ ok: false, error: 'صلاحية غير كافية لتعديل إعدادات الجودة.' });
      }
      return;
    }

    const base = chatQualitySettings;
    chatQualitySettings = clampChatQualitySettings(
      {
        ...(newSettings && typeof newSettings === 'object' ? newSettings : {}),
        updatedAt: Date.now(),
        updatedBy: admin.username
      },
      base
    );
    dataManager.setBatchWriteIntervalMs(chatQualitySettings.dbBatchWriteMs);
    await saveChatQualitySettings();
    io.emit('chatQualityUpdated', chatQualitySettings);
    logMonitorEvent('security', `تحديث إعدادات الجودة والتكيّف (${chatQualitySettings.preset}) بواسطة [${admin.username}]`, admin.username);
    socket.emit('systemAlert', 'تم حفظ وتطبيق إعدادات الجودة والتكيّف مع الشبكة بنجاح ⚡');
    if (typeof callback === 'function') {
      callback({ ok: true, settings: chatQualitySettings });
    }
  });

  // Likes Threshold Limits (شروط عدد اللايكات المطلوبة للإرسال)
  socket.on('getLikesSettings', () => {
    socket.emit('likesSettingsUpdated', likesSettings);
  });

  socket.on('updateLikesSettings', (newSettings: Partial<LikesThresholdSettings>) => {
    const admin = findSocketUser(socket.id);
    if (!admin || (!isSupremeHassan(admin) && admin.role !== 'admin' && admin.role !== 'super')) {
      socket.emit('systemAlert', 'تعديل شروط اللايكات محصور بطاقم الإدارة.');
      return;
    }
    likesSettings = {
      roomTextLikes: Math.max(0, parseInt(String(newSettings.roomTextLikes ?? likesSettings.roomTextLikes), 10) || 0),
      roomMediaLikes: Math.max(0, parseInt(String(newSettings.roomMediaLikes ?? likesSettings.roomMediaLikes), 10) || 0),
      wallTextLikes: Math.max(0, parseInt(String(newSettings.wallTextLikes ?? likesSettings.wallTextLikes), 10) || 0),
      wallMediaLikes: Math.max(0, parseInt(String(newSettings.wallMediaLikes ?? likesSettings.wallMediaLikes), 10) || 0),
      pmTextLikes: Math.max(0, parseInt(String(newSettings.pmTextLikes ?? likesSettings.pmTextLikes), 10) || 0),
      pmMediaLikes: Math.max(0, parseInt(String(newSettings.pmMediaLikes ?? likesSettings.pmMediaLikes), 10) || 0),
      micLikes: Math.max(0, parseInt(String(newSettings.micLikes ?? likesSettings.micLikes), 10) || 0),
      callLikes: Math.max(0, parseInt(String(newSettings.callLikes ?? likesSettings.callLikes), 10) || 0)
    };
    saveLikesSettings();
    io.emit('likesSettingsUpdated', likesSettings);
    logMonitorEvent('security', `تحديث شروط اللايكات المطلوبة للرسائل والوسائط والمايك بواسطة [${admin.username}]`, admin.username);
    socket.emit('systemAlert', 'تم حفظ وتطبيق شروط اللايكات بنجاح 👍💾');
  });

  // User Presence State Change (Green dot: online, Yellow dot: away/background, Gray dot: offline)
  socket.on('userPresenceChange', ({ state }: { state: 'online' | 'away' | 'offline' }) => {
    const user = users.find((u) => u.id === socket.id);
    if (!user) return;

    if (pendingAwayTimers.has(user.username.toLowerCase())) {
      clearTimeout(pendingAwayTimers.get(user.username.toLowerCase())!);
      pendingAwayTimers.delete(user.username.toLowerCase());
    }

    user.presenceState = state;
    if (state === 'online') {
      user.lastActiveTime = Date.now();
    }
    if (state === 'offline' && user.micSlot !== null) {
      const slots = getMicSlotsForRoom(user.room);
      const slot = slots.find((s) => s.slotNumber === user.micSlot);
      if (slot) slot.user = null;
      user.micSlot = null;
      user.isVoice = false;
      io.to(user.room).emit('micSlotsUpdated', getPublicMicSlotsForRoom(user.room));
    }

    // Keep the authenticated user record in `users` while the socket/session
    // remains alive. Removing it here made a later online state impossible to
    // publish and caused members in other rooms to appear offline.
    io.emit('userPresenceUpdated', { userId: user.id, username: user.username, state });
    broadcastRoomUsers(user.room);
    broadcastAllUsers();
  });

  // Sync Room Messages: Only serve missed messages for the authenticated user's current room
  socket.on('syncRoomMessages', ({ roomId, lastTimestamp }: { roomId: string; lastTimestamp?: number }, callback) => {
    const reqUser = users.find((u) => u.id === socket.id);
    if (!reqUser || !reqUser.room || reqUser.room === 'خارج الغرف') {
      if (typeof callback === 'function') {
        callback({ messages: [] });
      } else {
        socket.emit('syncedRoomMessages', { roomId: roomId || '', messages: [] });
      }
      return;
    }

    // Clean Room Mode: If lastTimestamp is omitted or <= 0, do not restore past messages
    if (typeof lastTimestamp !== 'number' || lastTimestamp <= 0) {
      if (typeof callback === 'function') {
        callback({ messages: [] });
      } else {
        socket.emit('syncedRoomMessages', { roomId: reqUser.room, messages: [] });
      }
      return;
    }

    const requestedRoomId = resolveCanonicalRoomId(roomId || reqUser.room) || reqUser.room;
    if (requestedRoomId !== reqUser.room) {
      if (typeof callback === 'function') {
        callback({ messages: [] });
      } else {
        socket.emit('syncedRoomMessages', { roomId: reqUser.room, messages: [] });
      }
      return;
    }

    const isAdminViewer = isSupremeHassan(reqUser) || reqUser.role === 'admin' || reqUser.role === 'super';
    const roomCfg = getRoomSettings(reqUser.room);
    const canSeeDeleted = isAdminViewer && Boolean(roomCfg.showDeletedNotice);
    const targetRoomLower = reqUser.room.trim().toLowerCase();
    const roomMsgs = chatHistory.filter(
      (m) => (resolveCanonicalRoomId(m.room) === reqUser.room || m.room.trim().toLowerCase() === targetRoomLower) && (!m.isDeleted || canSeeDeleted)
    );
    const roomLimit = messageRetentionLimits.roomMaxMessages || 200;
    const rankBadgesSet = new Set(['🦅 الإدارة العليا', 'الإدارة', 'سوبر', 'عضو']);
    const missed = roomMsgs
      .filter((m) => m.timestamp > lastTimestamp)
      .slice(-roomLimit)
      .map((m) => {
        if (m.badge && rankBadgesSet.has(m.badge.trim())) {
          const { badge: _b, badgeColor: _bc, ...rest } = m;
          return rest;
        }
        return m;
      });
    if (typeof callback === 'function') {
      callback({ messages: missed });
    } else {
      socket.emit('syncedRoomMessages', { roomId: reqUser.room, messages: missed });
    }
  });

  // Update Room Details from in-room settings
  socket.on('updateRoomDetails', async (data: {
    roomId: string;
    name?: string;
    desc?: string;
    bannerUrl?: string;
    voiceLimit?: number;
    isPasswordProtected?: boolean;
    password?: string;
    isChatLocked?: boolean;
    slowModeSeconds?: number;
    isVoiceLocked?: boolean;
    showDeletedNotice?: boolean;
    pinnedTopic?: string;
    welcomeMessage?: string;
    welcomeEnabled?: boolean;
    wallpaper?: string;
  }) => {
    const admin = findSocketUser(socket.id);
    const hasBannerPerm = Boolean(admin && (
      isSupremeHassan(admin) ||
      admin.role === 'admin' ||
      admin.role === 'super' ||
      hasPermission(admin.role, 'canEditRoomBanner') ||
      hasPermission(admin.role, 'canChangeRoomSettings') ||
      getRoleLevel(admin.role) >= 75
    ));
    const isAuthorized = Boolean(admin && (
      isSupremeHassan(admin) ||
      admin.role === 'admin' ||
      admin.role === 'super' ||
      hasPermission(admin.role, 'canChangeRoomSettings') ||
      getRoleLevel(admin.role) >= 75
    ));

    if (!isAuthorized && !(data.bannerUrl !== undefined && hasBannerPerm)) {
      socket.emit('systemAlert', 'ليس لديك صلاحية تعديل إعدادات الغرفة أو بنرها 🔒');
      logMonitorEvent('security', `محاولة غير مصرح بها لتعديل إعدادات الغرفة [${data.roomId}] بواسطة [${admin?.username || 'مجهول'}] (الرتبة: ${admin?.role || 'غير معروف'})`, admin?.username || 'مجهول');
      return;
    }

    const room = findRoomDefinition(data.roomId);
    const canonicalRoomId = room ? room.id : sanitizeText(data.roomId);
    if (!canonicalRoomId) return;

    if (room) {
      if (isAuthorized) {
        if (data.name !== undefined) {
          const cleanName = sanitizeText(data.name).slice(0, 60);
          if (cleanName) room.name = cleanName;
        }
        if (data.desc !== undefined) room.desc = sanitizeText(data.desc).slice(0, 200);
        if (data.voiceLimit !== undefined) {
          const nextLimit = Number(data.voiceLimit);
          if (Number.isFinite(nextLimit) && nextLimit >= 1) {
            room.voiceLimit = Math.max(1, Math.min(5, Math.round(nextLimit)));
          }
        }
        if (data.isPasswordProtected === false) {
          room.isPasswordProtected = false;
          delete room.password;
        } else if (data.isPasswordProtected === true || (data.password && data.password.trim())) {
          if (data.password && data.password.trim()) {
            room.isPasswordProtected = true;
            room.password = sanitizeText(data.password.trim()).slice(0, 64);
          }
        }
      }
      if (data.bannerUrl !== undefined) {
        if (!hasBannerPerm) {
          socket.emit('systemAlert', 'ليس لديك صلاحية تغيير بنر الغرفة 🔒');
        } else {
          const cleanBanner = String(data.bannerUrl || '').trim();
          if (!cleanBanner) {
            delete room.bannerUrl;
          } else {
            const safeBanner = await ensureMediaUrlNotBase64(cleanBanner);
            if (!safeBanner) {
              socket.emit('systemAlert', 'رابط بنر الغرفة غير صالح أو غير آمن.');
            } else {
              room.bannerUrl = safeBanner;
            }
          }
        }
      }
      saveChatRooms();
      broadcastRoomsUpdate();
    }
    if (isAuthorized) {
      const curSettings = getRoomSettings(canonicalRoomId);
      if (data.isChatLocked !== undefined) curSettings.isChatLocked = Boolean(data.isChatLocked);
      if (data.slowModeSeconds !== undefined) {
        const sm = Number(data.slowModeSeconds);
        if (Number.isFinite(sm)) {
          curSettings.slowModeSeconds = Math.max(0, Math.min(3600, Math.round(sm)));
        }
      }
      if (data.isVoiceLocked !== undefined) curSettings.isVoiceLocked = Boolean(data.isVoiceLocked);
      if (data.showDeletedNotice !== undefined && admin && (isSupremeHassan(admin) || admin.role === 'admin' || admin.role === 'super')) {
        curSettings.showDeletedNotice = Boolean(data.showDeletedNotice);
      }
      if (data.pinnedTopic !== undefined) {
        curSettings.pinnedTopic = sanitizeText(data.pinnedTopic).slice(0, 300);
        io.to(canonicalRoomId).emit('pinnedTopic', curSettings.pinnedTopic);
      }
      if (data.welcomeMessage !== undefined) curSettings.welcomeMessage = sanitizeText(data.welcomeMessage).slice(0, 500);
      if (data.welcomeEnabled !== undefined) curSettings.welcomeEnabled = Boolean(data.welcomeEnabled);
      if (data.wallpaper !== undefined) {
        const rawWall = String(data.wallpaper || '').trim();
        if (!rawWall) {
          curSettings.wallpaper = '';
        } else {
          const safeWall = (rawWall.startsWith('http') || rawWall.startsWith('/') || rawWall.startsWith('data:'))
            ? sanitizeUrl(rawWall)
            : sanitizeCssValue(rawWall);
          if (safeWall !== undefined && safeWall !== '') {
            curSettings.wallpaper = safeWall;
          }
        }
      }
      saveRoomSettings();
      io.to(canonicalRoomId).emit('roomSettingsUpdated', { room: canonicalRoomId, settings: curSettings });
    }
    logMonitorEvent('room', `عدل المشرف [${admin!.username}] إعدادات غرفة [${canonicalRoomId}]`, admin!.username);
    socket.emit('systemAlert', `تم حفظ وتحديث إعدادات غرفة [${canonicalRoomId}] بنجاح ⚙️`);
  });

  // Get Staff Memos (Staff Only)
  socket.on('getStaffMemos', () => {
    const admin = findSocketUser(socket.id);
    if (!isStaffUser(admin)) return;
    socket.emit('staffMemosUpdated', staffMemos);
  });

  // Add Staff Memo
  socket.on('addStaffMemo', ({ text, priority }: { text: string; priority?: 'low' | 'normal' | 'urgent' }) => {
    const user = findSocketUser(socket.id);
    if (!user || (!isSupremeHassan(user) && user.role !== 'admin' && user.role !== 'super')) {
      socket.emit('systemAlert', 'كتابة الملاحظات الإدارية محصورة بطاقم الإدارة.');
      return;
    }
    const clean = sanitizeText(text);
    if (!clean) return;
    const newMemo: StaffMemo = {
      id: `memo-${Date.now()}`,
      author: user.username,
      role: user.role,
      text: clean,
      priority: priority || 'normal',
      timestamp: Date.now(),
      timeFormatted: new Date().toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })
    };
    staffMemos.unshift(newMemo);
    if (staffMemos.length > 50) staffMemos.pop();
    saveStaffMemos();
    emitToAuthorizedStaff('staffMemosUpdated', staffMemos);
    socket.emit('systemAlert', 'تمت إضافة الملاحظة الإدارية بنجاح 📝');
  });

  // Delete Staff Memo
  socket.on('deleteStaffMemo', ({ memoId }: { memoId: string }) => {
    const user = findSocketUser(socket.id);
    if (!user || (!isSupremeHassan(user) && user.role !== 'admin' && user.role !== 'super')) return;
    staffMemos = staffMemos.filter((m) => m.id !== memoId);
    saveStaffMemos();
    emitToAuthorizedStaff('staffMemosUpdated', staffMemos);
  });

  // Manual Ban by IP or Username directly
  socket.on('manualBan', ({ username, ip, reason }: { username: string; ip?: string; reason?: string }) => {
    const admin = findSocketUser(socket.id);
    if (!admin || (!isSupremeHassan(admin) && admin.role !== 'admin' && !hasPermission(admin.role, 'canBan'))) {
      socket.emit('systemAlert', 'صلاحية الحظر والباند محصورة بمدير النظام وطاقم الإدارة المصرح لهم.');
      return;
    }
    const cleanName = sanitizeText(username?.trim());
    if (!cleanName) return;

    // Hierarchy check: cannot ban equal or higher rank
    const targetMember = getRegisteredMember(cleanName)?.member;
    const targetLive = users.find((u) => u.username.toLowerCase() === cleanName.toLowerCase());
    const targetRole = targetLive?.role || targetMember?.role || 'member';
    if (!isSupremeHassan(admin) && getRoleLevel(targetRole) >= getRoleLevel(admin.role)) {
      socket.emit('systemAlert', 'لا يمكنك حظر عضو ذو رتبة مساوية أو أعلى من رتبتك.');
      return;
    }

    const targetIp = ip?.trim() || targetLive?.ipAddress || targetMember?.ipAddress || '192.168.1.100';
    const allTargetFps = new Set<string>();
    if (targetLive?.deviceFingerprint) allTargetFps.add(targetLive.deviceFingerprint);
    if (targetMember?.deviceFingerprint) allTargetFps.add(targetMember.deviceFingerprint);
    if (Array.isArray(targetMember?.fingerprintHistory)) {
      targetMember.fingerprintHistory.forEach((f) => {
        if (f) allTargetFps.add(f);
      });
    }
    if (targetIp !== '192.168.1.100' && ipToFingerprintMap.has(targetIp)) {
      allTargetFps.add(ipToFingerprintMap.get(targetIp)!);
    }
    for (const sObj of activeSessions.values()) {
      if (sObj.user?.username?.toLowerCase() === cleanName.toLowerCase() && sObj.user?.deviceFingerprint) {
        allTargetFps.add(sObj.user.deviceFingerprint);
      }
    }
    const targetFingerprintsList = Array.from(allTargetFps);
    const targetFingerprint = targetFingerprintsList[0];
    const targetCore = getHardwareCore(targetFingerprint);

    bannedUsers.add(cleanName.toLowerCase());
    if (isBannableIp(targetIp)) {
      bannedIps.add(targetIp);
    }
    targetFingerprintsList.forEach((fpItem) => {
      addFingerprintToBanSet(fpItem);
      if (fingerprintToAccountsMap.has(fpItem)) {
        fingerprintToAccountsMap.get(fpItem)!.forEach((acc) => {
          if (!isUsernameSupremeHassan(acc)) bannedUsers.add(acc.toLowerCase());
        });
      }
      const c = getHardwareCore(fpItem);
      if (c && fingerprintToAccountsMap.has(c)) {
        fingerprintToAccountsMap.get(c)!.forEach((acc) => {
          if (!isUsernameSupremeHassan(acc)) bannedUsers.add(acc.toLowerCase());
        });
      }
    });

    bannedRecords.set(cleanName.toLowerCase(), {
      username: cleanName,
      ip: targetIp,
      deviceFingerprint: targetFingerprint,
      deviceFingerprints: targetFingerprintsList,
      reason: reason?.trim() || 'حظر إداري يدوي مباشر',
      bannedBy: admin.username,
      timestamp: Date.now()
    });
    saveBans();

    // Clean active sessions (protect supreme 'hassan' sessions from collateral IP/device sweeps)
    for (const [sTok, sObj] of activeSessions.entries()) {
      if (isSupremeHassan(sObj.user) || isUsernameSupremeHassan(sObj.user?.username)) continue;
      const sFp = sObj.user?.deviceFingerprint;
      if (
        sObj.user?.username?.toLowerCase() === cleanName.toLowerCase() ||
        (targetIp && targetIp !== '192.168.1.100' && sObj.user?.ipAddress === targetIp) ||
        (targetFingerprint && sFp && (sFp === targetFingerprint || (targetCore && getHardwareCore(sFp) === targetCore)))
      ) {
        activeSessions.delete(sTok);
      }
    }
    if (!isUsernameSupremeHassan(cleanName)) {
      usernameToSessionMap.delete(cleanName.toLowerCase());
    }
    persistActiveSessions();

    // Disconnect target & any matching device/IP if currently connected (exempt supreme 'hassan' rank)
    const liveMatches = users.filter(
      (u) =>
        !isSupremeHassan(u) &&
        !isUsernameSupremeHassan(u.username) &&
        (u.username.toLowerCase() === cleanName.toLowerCase() ||
          (targetIp && targetIp !== '192.168.1.100' && u.ipAddress === targetIp) ||
          (targetFingerprint && u.deviceFingerprint && (u.deviceFingerprint === targetFingerprint || (targetCore && getHardwareCore(u.deviceFingerprint) === targetCore))))
    );
    liveMatches.forEach((target) => {
      io.to(target.id).emit('kickedByAdmin', { reason: 'تم حظرك نهائياً من دخول حسان برو بقرار إداري.', by: admin.username });
      const targetSock = io.sockets.sockets.get(target.id);
      if (targetSock) {
        try {
          targetSock.leave(target.room);
          targetSock.disconnect(true);
        } catch {}
      }
      const tIdx = users.findIndex((u) => u.id === target.id);
      if (tIdx !== -1) users.splice(tIdx, 1);
      broadcastRoomUsers(target.room);
    });
    emitToAuthorizedStaff('bannedListUpdated', Array.from(bannedRecords.values()), 'canUnban');
    logMonitorEvent('ban', `حظر يدوي مباشر لـ [${cleanName}] بواسطة ${admin.username}`, admin.username, cleanName);
    socket.emit('systemAlert', `تم تطبيق الحظر اليدوي على [${cleanName}] وبصمة جهازه بنجاح.`);
  });

  // Critical Global Broadcast Alert Across All Rooms
  socket.on('globalBroadcast', ({ title, text }: { title?: string; text: string }) => {
    const admin = users.find((u) => u.id === socket.id);
    if (!admin || (!isSupremeHassan(admin) && admin.role !== 'admin' && admin.role !== 'super' && !hasPermission(admin.role, 'canBroadcast'))) {
      socket.emit('systemAlert', 'عفواً، إرسال الإشعار العام العاجل متاح للإدارة والمشرفين المصرح لهم فقط.');
      return;
    }
    const cleanText = sanitizeText(text);
    if (!cleanText) return;

    io.emit('criticalGlobalBroadcast', {
      id: `broadcast-${Date.now()}`,
      title: title || 'إعلان ملكي عاجل من إدارة حسان برو 🦅',
      text: cleanText,
      sender: admin.username,
      senderRole: admin.role,
      time: new Date().toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })
    });
    logMonitorEvent('warn', `إرسال بث أحمر عاجل لجميع الغرف بواسطة [${admin.role.toUpperCase()}] ${admin.username}: "${cleanText}"`, admin.username);
  });

  // Login / Join Room
  socket.on('joinRoom', ({
    username,
    room,
    loginType,
    password,
    roomPassword,
    flag,
    statusQuote,
    deviceFingerprint,
    isGhost,
    isIncognito
  }: {
    username: string;
    room?: string;
    loginType?: string;
    password?: string;
    roomPassword?: string;
    flag?: string;
    statusQuote?: string;
    deviceFingerprint?: string;
    isGhost?: boolean;
    isIncognito?: boolean;
  }) => {
    const cleanUsername = sanitizeText(username);
    // Automatic default room: 'الغرفة العامة'
    const rawTargetRoom = sanitizeText(room) || 'الغرفة العامة';
    const normalizedLoginType: 'member' | 'register' | 'visitor' =
      loginType === 'member' || loginType === 'register' || loginType === 'visitor'
        ? loginType
        : 'visitor';

    if (!cleanUsername) {
      socket.emit('loginError', 'يرجى إدخال اسم مستخدم صالح.');
      return;
    }

    const reservedNames = new Set(['hassan', 'النظام الأمني', 'إدارة حسان برو', 'نظام الهدايا', 'نظام المايكات', 'نظام الجوائز والمسابقات']);
    const lowerCleanName = cleanUsername.toLowerCase();
    if (normalizedLoginType !== 'member') {
      if (lowerCleanName === 'admin' || reservedNames.has(lowerCleanName) || botEngine.isBotUsername(cleanUsername)) {
        socket.emit('loginError', 'هذا الاسم محجوز للنظام، يرجى اختيار اسم آخر.');
        return;
      }
    }

    // Supreme 'hassan' rank immunity: verify credentials first so a hassan-rank account can ALWAYS enter even if banned (username, IP, or device fingerprint)
    let isVerifiedSupremeHassanLogin = false;
    const preLiveSession = users.find((u) => u.id === socket.id);
    if (preLiveSession && !loginType && isSupremeHassan(preLiveSession)) {
      isVerifiedSupremeHassanLogin = true;
    } else if (normalizedLoginType === 'member') {
      const supremeCandidate = getRegisteredMember(cleanUsername);
      if (supremeCandidate && isSupremeHassan(supremeCandidate.member.role)) {
        const member = supremeCandidate.member;
        const memberKey = supremeCandidate.key;
        const attemptKey = `${clientIp}_${memberKey.toLowerCase()}`;
        const attempt = loginAttemptsMap.get(attemptKey);
        if (attempt && attempt.lockedUntil > Date.now()) {
          const remainingSeconds = Math.ceil((attempt.lockedUntil - Date.now()) / 1000);
          socket.emit('loginError', `🔒 تم قفل محاولات الدخول مؤقتاً لحماية الحساب. يرجى الانتظار ${remainingSeconds} ثانية.`);
          return;
        }
        if (memberKey.toLowerCase() === 'admin' && isAdminClaimRequired()) {
          socket.emit('loginError', '🔐 حساب الإدارة العليا غير مُعد بعد. يرجى تعيين كلمة المرور الأولية في النموذج أعلاه أولاً.');
          return;
        }
        const envAdminPass = memberKey.toLowerCase() === 'admin' ? getEnvAdminPassword() : '';
        const passwordMatches = envAdminPass
          ? Boolean(password && password.length === envAdminPass.length && crypto.timingSafeEqual(Buffer.from(password, 'utf8'), Buffer.from(envAdminPass, 'utf8')))
          : verifyPassword(password || '', member.password);
        if (!passwordMatches) {
          const currentCount = (attempt?.count || 0) + 1;
          if (currentCount >= 5) {
            loginAttemptsMap.set(attemptKey, { count: currentCount, lockedUntil: Date.now() + 2 * 60 * 1000 });
            socket.emit('loginError', '🔒 تم إدخال كلمة المرور بالخطأ 5 مرات متتالية. تم قفل الحساب مؤقتاً لمدة دقيقتين.');
          } else {
            loginAttemptsMap.set(attemptKey, { count: currentCount, lockedUntil: 0 });
            socket.emit('loginError', `كلمة المرور غير صحيحة. المحاولة (${currentCount} من 5).`);
          }
          return;
        }
        loginAttemptsMap.delete(attemptKey);
        isVerifiedSupremeHassanLogin = true;
      }
    }

    // Check Temporary Kick Cooldown (مهلة الطرد المؤقت لدقيقتين) — exempt verified supreme 'hassan' rank
    if (!isVerifiedSupremeHassanLogin) {
      const kickUntil = kickedCooldownMap.get(cleanUsername.toLowerCase()) || kickedCooldownMap.get(clientIp);
      if (kickUntil && kickUntil > Date.now()) {
        const remainingSecs = Math.ceil((kickUntil - Date.now()) / 1000);
        socket.emit('loginError', `⚠️ تم طردك مؤقتاً بقرار إداري. يرجى الانتظار ${remainingSecs} ثانية قبل إعادة الدخول.`);
        return;
      }
    }

    // 1. STRICT IP, DEVICE FINGERPRINT, AND ACCOUNT BAN PROTECTION (حظر الآي بي وبصمة الجهاز حتى مع تغيير الـ IP عبر VPN)
    cleanExpiredBans();

    const incomingFp = normalizeDeviceFingerprint(deviceFingerprint);

    if (!isVerifiedSupremeHassanLogin) {
      const incomingUid = getPersistentUid(incomingFp);
      const incomingCore = getHardwareCore(incomingFp);
      const incomingCrossHw = getCrossBrowserHwId(incomingFp);
      const coreAccounts = incomingCore ? fingerprintToAccountsMap.get(incomingCore) : undefined;
      const isCoreSharedWithInnocent = coreAccounts
        ? Array.from(coreAccounts).some((acc) => !bannedUsers.has(acc.toLowerCase()))
        : false;
      const crossHwAccounts = incomingCrossHw ? fingerprintToAccountsMap.get(`HW:${incomingCrossHw}`) : undefined;
      const isCrossHwSharedWithInnocent = crossHwAccounts
        ? Array.from(crossHwAccounts).some((acc) => !bannedUsers.has(acc.toLowerCase()))
        : false;

      const matchedRecord = Array.from(bannedRecords.values()).find((r) => {
        if ((r.ip && r.ip === clientIp) || r.username.toLowerCase() === cleanUsername.toLowerCase()) return true;
        if (!incomingFp) return false;
        const recFps = getAllRecordFingerprints(r);
        return recFps.some(
          (rfp) =>
            rfp === incomingFp ||
            (incomingUid && getPersistentUid(rfp) === incomingUid) ||
            (!isCoreSharedWithInnocent && incomingCore && getHardwareCore(rfp) === incomingCore) ||
            (!isCrossHwSharedWithInnocent && incomingCrossHw && getCrossBrowserHwId(rfp) === incomingCrossHw) ||
            areFingerprintsFromSameDevice(incomingFp, rfp).match
        );
      });

      if (!matchedRecord && incomingCrossHw && isCrossHwSharedWithInnocent) {
        const suspectedBanned = Array.from(bannedRecords.values()).find((r) =>
          getAllRecordFingerprints(r).some((rfp) => getCrossBrowserHwId(rfp) === incomingCrossHw)
        );
        if (suspectedBanned) {
          logMonitorEvent(
            'security',
            `⚠️ تنبيه تطابق عتاد عبر متصفح/IP مختلف: [${cleanUsername}] يطابق عتاد العضو المحظور [${suspectedBanned.username}]`,
            cleanUsername,
            suspectedBanned.username
          );
        }
      }

      if (matchedRecord) {
        if (matchedRecord.expiresAt && matchedRecord.expiresAt > Date.now()) {
          const remainingMinutes = Math.ceil((matchedRecord.expiresAt - Date.now()) / 60000);
          const timeLabel = remainingMinutes >= 60
            ? `${Math.floor(remainingMinutes / 60)} ساعة و ${remainingMinutes % 60} دقيقة`
            : `${remainingMinutes} دقيقة`;
          socket.emit('loginError', `🚫 تم حظر جهازك وشبكتك مؤقتاً لتكرار مخالفات الفلتر. يتبقى على انتهاء الحظر: ${timeLabel}.`);
          return;
        }
        if (!matchedRecord.expiresAt) {
          // Record the banned device's new VPN IP/fingerprint, but DO NOT ban unauthenticated target usernames
          if (isBannableIp(clientIp)) bannedIps.add(clientIp);
          addFingerprintToBanSet(incomingFp);
          saveBans();
          if (matchedRecord.ip && matchedRecord.ip !== clientIp) {
            logMonitorEvent(
              'ban',
              `🛡️ إحباط محاولة تخطي الحظر عبر VPN/تغيير IP: الجهاز المحظور [${matchedRecord.username}] حاول الدخول باسم [${cleanUsername}] من IP جديد [${clientIp}]`,
              'النظام الأمني',
              cleanUsername
            );
          }
          socket.emit('loginError', `🚫 تم حظر جهازك نهائياً من دخول حسان برو بقرار إداري صارم (تم التعرف على بصمة الجهاز حتى مع تغيير الـ IP أو استخدام VPN). (السبب: ${matchedRecord.reason})`);
          return;
        }
      }

      const isIpBanned = bannedIps.has(clientIp);
      const isNameBanned = bannedUsers.has(cleanUsername.toLowerCase());
      const accountsForIp = ipToAccountsMap.get(clientIp);
      const isIpAssociatedWithBanned = accountsForIp ? Array.from(accountsForIp).some((acc) => bannedUsers.has(acc.toLowerCase())) : false;
      const isFpBanned = Boolean(
        (incomingFp && bannedDeviceFingerprints.has(incomingFp)) ||
        (incomingUid && bannedDeviceFingerprints.has(`UID:${incomingUid}`)) ||
        (!isCoreSharedWithInnocent && incomingCore && bannedDeviceFingerprints.has(incomingCore))
      );
      const accountsForFp =
        (incomingFp ? fingerprintToAccountsMap.get(incomingFp) : undefined) ||
        (!isCoreSharedWithInnocent && incomingCore ? fingerprintToAccountsMap.get(incomingCore) : undefined);
      const isFpAssociatedWithBanned = accountsForFp ? Array.from(accountsForFp).some((acc) => bannedUsers.has(acc.toLowerCase())) : false;

      if (isIpBanned || isNameBanned || isIpAssociatedWithBanned || isFpBanned || isFpAssociatedWithBanned) {
        if (isBannableIp(clientIp)) bannedIps.add(clientIp);
        addFingerprintToBanSet(incomingFp);
        saveBans();
        socket.emit('loginError', '🚫 تم حظر جهازك نهائياً من دخول حسان برو بقرار إداري صارم (تم التعرف على بصمة الجهاز حتى مع تغيير الـ IP أو استخدام VPN).');
        return;
      }
    }

    // 1.5. GEOGRAPHIC ACCESS RESTRICTION ENFORCEMENT (تقييد وحظر الوصول الجغرافي لدول معينة)
    if (serverSecurity.geoRestrictionEnabled && Array.isArray(serverSecurity.geoRestrictedCountries) && serverSecurity.geoRestrictedCountries.length > 0) {
      const prospectiveRole = getRegisteredMember(cleanUsername)?.member.role || (loginType === 'member' ? 'member' : 'guest');
      // Admin and Super accounts are always exempt from geo-restrictions
      if (!isSupremeHassan(prospectiveRole) && prospectiveRole !== 'admin' && prospectiveRole !== 'super') {
        const hasVerifiedGeo = Boolean(socket.handshake.headers['cf-ray'] || socket.handshake.headers['x-appengine-country'] || process.env.TRUST_CF_HEADER === 'true');
        const headerCountry = hasVerifiedGeo
          ? (((socket.handshake.headers['cf-ipcountry'] || socket.handshake.headers['x-appengine-country']) as string) || '').toUpperCase()
          : '';
        const flagCountry = flag ? (flagToCodeMap[flag] || '') : '';
        const detectedCountry = (headerCountry && headerCountry !== 'XX' && headerCountry !== 'T1' ? headerCountry : '') || flagCountry || '';

        const normalizedRestricted = serverSecurity.geoRestrictedCountries.map((c) => c.toUpperCase());
        const isMatched = normalizedRestricted.includes(detectedCountry) || (flag && normalizedRestricted.includes(flag));

        let isBlocked = false;
        if (serverSecurity.geoRestrictionMode === 'blacklist') {
          if (isMatched) isBlocked = true;
        } else if (serverSecurity.geoRestrictionMode === 'whitelist') {
          if (!isMatched) isBlocked = true;
        }

        if (isBlocked) {
          const blockedMsg = serverSecurity.geoBlockedCustomMessage || '🚫 نعتذر، الدخول غير متاح حالياً من منطقتك الجغرافية وفقاً لسياسة الأمان المتبعة في الدردشة.';
          socket.emit('loginError', blockedMsg);
          logMonitorEvent('security', `محاولة دخول مرفوضة بداعي التقييد الجغرافي [${cleanUsername}] من دولة [${detectedCountry || flag || 'غير معروفة'}]`, 'النظام الأمني');
          return;
        }
      }
    }

    // 2. JAIL ROOM ENFORCEMENT & VALID ROOM CHECK
    const isUserJailed = jailedUsernames.has(cleanUsername.toLowerCase()) || 
                         jailedIps.has(clientIp) || 
                         Boolean(getRegisteredMember(cleanUsername)?.member.isJailed);

    const requestedRoomDef = findRoomDefinition(rawTargetRoom);
    if (!isUserJailed && room && !requestedRoomDef) {
      socket.emit('loginError', 'الغرفة المطلوبة غير موجودة.');
      return;
    }
    const targetRoom = requestedRoomDef?.id || 'الغرفة العامة';

    // If an existing live user is in jail and trying to switch rooms:
    const liveSession = users.find((u) => u.id === socket.id);
    if (liveSession && (liveSession.isJailed || liveSession.room === 'سجن حسان برو' || isUserJailed)) {
      if (targetRoom !== 'سجن حسان برو') {
        socket.emit('systemAlert', '🚔 لا يمكنك مغادرة غرفة السجن! أنت محتجز وموقوف بقرار إداري ولا يمكنك الخروج إلا بإفراج رسمي من الإدارة.');
        return;
      }
    }

    let finalTargetRoom = targetRoom;
    if (isUserJailed) {
      finalTargetRoom = 'سجن حسان برو';
    }

    // Security Checks: Lockdown and Guest Restrictions
    if (serverSecurity.emergencyLockdown) {
      const prospectiveRole = getRegisteredMember(cleanUsername)?.member.role || (loginType === 'member' ? 'member' : 'guest');
      if (!isSupremeHassan(prospectiveRole) && prospectiveRole !== 'admin' && prospectiveRole !== 'super') {
        socket.emit('loginError', '🔒 وضع الطوارئ الإداري (Emergency Lockdown) مفعل حالياً. الدخول محصور بالإدارة والمشرفين.');
        return;
      }
    }

    if (!serverSecurity.guestsAllowed && normalizedLoginType === 'visitor') {
      socket.emit('loginError', 'عفواً، تم إيقاف دخول الزوار مؤقتاً بقرار إداري. يرجى تسجيل عضوية أو الدخول بحساب مسجل.');
      return;
    }

    // Check Member registration/login with Brute-force Protection
    if (normalizedLoginType === 'member') {
      const regRes = getRegisteredMember(cleanUsername);
      if (!regRes) {
        const byDisplay = getRegisteredMemberByDisplayName(cleanUsername);
        if (byDisplay) {
          socket.emit('loginError', 'هذا اسم الزخرفة وليس الاسم الأصلي! يجب تسجيل الدخول بالاسم الأصلي الذي سجلت به العضوية أول مرة.');
          return;
        }
        socket.emit('loginError', 'اسم العضوية غير مسجل. يمكنك الدخول كزائر أو تسجيل عضوية جديدة.');
        return;
      }
      const member = regRes.member;
      const memberKey = regRes.key;

      if (!isVerifiedSupremeHassanLogin) {
        const attemptKey = `${clientIp}_${memberKey.toLowerCase()}`;
        const attempt = loginAttemptsMap.get(attemptKey);
        if (attempt && attempt.lockedUntil > Date.now()) {
          const remainingSeconds = Math.ceil((attempt.lockedUntil - Date.now()) / 1000);
          socket.emit('loginError', `🔒 تم قفل محاولات الدخول مؤقتاً لحماية الحساب. يرجى الانتظار ${remainingSeconds} ثانية.`);
          return;
        }

        if (memberKey.toLowerCase() === 'admin' && isAdminClaimRequired()) {
          socket.emit('loginError', '🔐 حساب الإدارة العليا غير مُعد بعد. يرجى تعيين كلمة المرور الأولية في النموذج أعلاه أولاً.');
          return;
        }

        const envAdminPass = memberKey.toLowerCase() === 'admin' ? getEnvAdminPassword() : '';
        const passwordMatches = envAdminPass
          ? Boolean(password && password.length === envAdminPass.length && crypto.timingSafeEqual(Buffer.from(password, 'utf8'), Buffer.from(envAdminPass, 'utf8')))
          : verifyPassword(password || '', member.password);

        if (!passwordMatches) {
          const currentCount = (attempt?.count || 0) + 1;
          if (currentCount >= 5) {
            loginAttemptsMap.set(attemptKey, { count: currentCount, lockedUntil: Date.now() + 2 * 60 * 1000 });
            socket.emit('loginError', '🔒 تم إدخال كلمة المرور بالخطأ 5 مرات متتالية. تم قفل الحساب مؤقتاً لمدة دقيقتين.');
          } else {
            loginAttemptsMap.set(attemptKey, { count: currentCount, lockedUntil: 0 });
            socket.emit('loginError', `كلمة المرور غير صحيحة. المحاولة (${currentCount} من 5).`);
          }
          return;
        }
        loginAttemptsMap.delete(attemptKey);
      }

      // If member password was plain text, auto-upgrade to bcrypt hash on successful login
      if (!member.password.startsWith('$2a$') && !member.password.startsWith('$2b$')) {
        if (password) {
          member.password = hashPassword(password);
        }
      }
      // Update persistent metadata for member
      member.ipAddress = clientIp;
      if (!Array.isArray(member.ipHistory)) member.ipHistory = [];
      if (isBannableIp(clientIp) && !member.ipHistory.includes(clientIp)) member.ipHistory.push(clientIp);
      if (incomingFp) {
        member.deviceFingerprint = incomingFp;
        if (!Array.isArray(member.fingerprintHistory)) member.fingerprintHistory = [];
        if (!member.fingerprintHistory.includes(incomingFp)) member.fingerprintHistory.push(incomingFp);
      }
      member.deviceInfo = parseDeviceInfo(socket.handshake.headers['user-agent'] as string);
      member.lastSeen = Date.now();
      if (isUserJailed) member.isJailed = true;
      saveMembers();
    } else if (normalizedLoginType === 'register') {
      if (!password || String(password).trim().length < 3) {
        socket.emit('loginError', 'يجب إدخال كلمة مرور لا تقل عن 3 أحرف أو أرقام لتسجيل عضوية جديدة.');
        return;
      }
      const existing = getRegisteredMember(cleanUsername);
      if (existing) {
        socket.emit('loginError', 'هذا الاسم مسجل مسبقاً، يرجى اختيار اسم عضوية آخر.');
        return;
      }
      const existingDisplay = getRegisteredMemberByDisplayName(cleanUsername);
      if (existingDisplay) {
        socket.emit('loginError', 'هذا الاسم مستخدم حالياً كاسم زخرفة لعضو آخر، يرجى اختيار اسم عضوية آخر.');
        return;
      }
      registeredMembers[cleanUsername] = {
        password: hashPassword(String(password).trim()),
        originalUsername: cleanUsername,
        registeredAt: Date.now(),
        displayName: cleanUsername,
        role: 'member',
        flag: detectedRealFlag || flag || '🇾🇪',
        statusQuote: (statusQuote && statusQuote !== 'عضو جديد') ? statusQuote : 'عضو معتمد في حسان برو',
        likes: 500,
        points: 10000,
        ipAddress: clientIp,
        ipHistory: isBannableIp(clientIp) ? [clientIp] : [],
        deviceInfo: parseDeviceInfo(socket.handshake.headers['user-agent'] as string),
        deviceHistory: [parseDeviceInfo(socket.handshake.headers['user-agent'] as string)],
        deviceFingerprint: incomingFp || undefined,
        fingerprintHistory: incomingFp ? [incomingFp] : [],
        lastSeen: Date.now(),
        isJailed: isUserJailed
      };
      saveMembers();
    } else if (normalizedLoginType === 'visitor') {
      const existingVisitor = getRegisteredMember(cleanUsername);
      if (existingVisitor && existingVisitor.member.role !== 'guest') {
        socket.emit('loginError', 'هذا الاسم مسجل لعضوية خاصة بكلمة مرور. يرجى تسجيل الدخول من تبويب [دخول الاعضاء].');
        return;
      }
      // Record visitor in registeredMembers so the admin sees their account and IP even offline!
      if (!existingVisitor) {
        registeredMembers[cleanUsername] = {
          password: hashPassword(crypto.randomBytes(16).toString('hex')),
          originalUsername: cleanUsername,
          registeredAt: Date.now(),
          displayName: cleanUsername,
          role: 'guest',
          flag: detectedRealFlag || flag || '🇾🇪',
          statusQuote: 'زائر',
          likes: 100,
          points: 500,
          ipAddress: clientIp,
          ipHistory: isBannableIp(clientIp) ? [clientIp] : [],
          deviceInfo: parseDeviceInfo(socket.handshake.headers['user-agent'] as string),
          deviceHistory: [parseDeviceInfo(socket.handshake.headers['user-agent'] as string)],
          deviceFingerprint: incomingFp || undefined,
          fingerprintHistory: incomingFp ? [incomingFp] : [],
          lastSeen: Date.now(),
          isJailed: isUserJailed
        };
        saveMembers();
      } else {
        existingVisitor.member.ipAddress = clientIp;
        if (!Array.isArray(existingVisitor.member.ipHistory)) existingVisitor.member.ipHistory = [];
        if (isBannableIp(clientIp) && !existingVisitor.member.ipHistory.includes(clientIp)) {
          existingVisitor.member.ipHistory.push(clientIp);
        }
        if (incomingFp) {
          existingVisitor.member.deviceFingerprint = incomingFp;
          if (!Array.isArray(existingVisitor.member.fingerprintHistory)) existingVisitor.member.fingerprintHistory = [];
          if (!existingVisitor.member.fingerprintHistory.includes(incomingFp)) {
            existingVisitor.member.fingerprintHistory.push(incomingFp);
          }
        }
        existingVisitor.member.lastSeen = Date.now();
        saveMembers();
      }
    }

    // Server-side Room Password Enforcement (atomic check before tearing down old sessions/rooms)
    const preRegRes = getRegisteredMember(cleanUsername);
    const resolvedPreRole = preRegRes?.member.role || (normalizedLoginType === 'visitor' ? 'guest' : 'member');
    const targetRoomDef = chatRooms.find((r) => r.id === finalTargetRoom);
    if (targetRoomDef?.isPasswordProtected && targetRoomDef.password) {
      const isAlreadyInTargetRoom = liveSession?.room === finalTargetRoom;
      const isRoomAdminBypass = isSupremeHassan(resolvedPreRole) || resolvedPreRole === 'admin' || getRoleLevel(resolvedPreRole) >= getRoleLevel('admin');
      const isJailAutoPlacement = finalTargetRoom === 'سجن حسان برو' && isUserJailed;
      if (!isAlreadyInTargetRoom && !isRoomAdminBypass && !isJailAutoPlacement) {
        if ((roomPassword || '').trim() !== targetRoomDef.password) {
          socket.emit('systemAlert', `🔒 كلمة المرور غير صحيحة لدخول غرفة [${targetRoomDef.name}].`);
          return;
        }
      }
    }

    // =========================================================================
    // ENFORCE STRICT SINGLE-SESSION PER MEMBER / ACCOUNT
    // (يمنع تعدد الجلسات تماماً: عند تسجيل الدخول من جهاز أو متصفح أو صفحة أخرى،
    // يتم طرد وفصل الجلسة السابقة فوراً واعتماد الجلسة الجديدة فقط)
    // =========================================================================
    const oldSocketIds = new Set<string>();

    // 1. Collect sockets from live users list
    users.forEach((u) => {
      if (u.username.toLowerCase() === cleanUsername.toLowerCase() && u.id !== socket.id) {
        oldSocketIds.add(u.id);
      }
    });

    const isRoomSwitchOnly = Boolean(liveSession && !loginType);
    const preservedSessionToken = isRoomSwitchOnly ? liveSession?.sessionToken : undefined;

    // 2. Collect sockets from activeSessions and invalidate superseded sessions for this account
    for (const [token, sess] of activeSessions.entries()) {
      if (sess.user?.username?.toLowerCase() === cleanUsername.toLowerCase()) {
        if (isRoomSwitchOnly && preservedSessionToken && token === preservedSessionToken) {
          continue;
        }
        if (sess.currentSocketId && sess.currentSocketId !== socket.id) {
          oldSocketIds.add(sess.currentSocketId);
        }
        sess.isExplicitlyLoggedOut = true;
        activeSessions.delete(token);
        revokedSessionTokens.set(token, Date.now() + 7 * 24 * 60 * 60 * 1000);
      }
    }
    if (!isRoomSwitchOnly) {
      usernameToSessionMap.delete(cleanUsername.toLowerCase());
    }

    // 3. Clear any pending away or mic grace timer for this username
    if (pendingAwayTimers.has(cleanUsername.toLowerCase())) {
      clearTimeout(pendingAwayTimers.get(cleanUsername.toLowerCase())!);
      pendingAwayTimers.delete(cleanUsername.toLowerCase());
    }
    if (pendingMicGraceTimers.has(cleanUsername.toLowerCase())) {
      clearTimeout(pendingMicGraceTimers.get(cleanUsername.toLowerCase())!);
      pendingMicGraceTimers.delete(cleanUsername.toLowerCase());
    }

    // 4. Force disconnect and notify all old sockets
    oldSocketIds.forEach((oldId) => {
      const oldSocket = io.sockets.sockets.get(oldId);
      if (oldSocket) {
        oldSocket.emit('forceLogout', {
          reason: 'duplicate_login',
          message: '⚠️ تم تسجيل الدخول إلى حسابك من متصفح أو جهاز آخر. تم إنهاء هذه الجلسة تلقائياً واعتماد الجلسة الجديدة.'
        });
        try {
          oldSocket.disconnect(true);
        } catch {}
      }
    });

    // 5. Free mic slots & live state for all previous instances of this user in any room
    users.forEach((u) => {
      if (u.username.toLowerCase() === cleanUsername.toLowerCase()) {
        cleanupUserLiveState(u.id);
        if (u.micSlot !== null || u.isVoice) {
          releaseUserMic(u, u.room);
        }
      }
    });

    // 6. Purge all previous instances from users array
    for (let i = users.length - 1; i >= 0; i--) {
      if (users[i].username.toLowerCase() === cleanUsername.toLowerCase() && users[i].id !== socket.id) {
        const removed = users.splice(i, 1)[0];
        broadcastRoomUsers(removed.room);
      }
    }

    // Remove old session if any and track previous room & ghost state
    let previousRoom: string | null = null;
    let previousIsGhost = false;
    const existingIndex = users.findIndex((u) => u.id === socket.id);
    if (existingIndex !== -1) {
      const old = users.splice(existingIndex, 1)[0];
      previousRoom = old.room;
      previousIsGhost = Boolean(old.isGhost);
      if (old.micSlot !== null || old.isVoice) {
        releaseUserMic(old, old.room);
      }
      if (old.room !== finalTargetRoom) {
        cleanupUserLiveState(socket.id, old.room);
      }
      socket.leave(old.room);
      if (old.room && old.room !== 'خارج الغرف') {
        broadcastRoomUsers(old.room);
      }
    }

    const regResult = getRegisteredMember(cleanUsername);
    const reg = regResult?.member;
    const resolvedUsername = regResult?.key || cleanUsername;
    const realFlag = detectedRealFlag || flag || reg?.flag || '🇾🇪';
    const assignedFlagNumber = assignOrGetFlagNumber(resolvedUsername, realFlag);
    const clientUserAgent = (socket.handshake.headers['user-agent'] as string) || '';
    const clientDevice = parseDeviceInfo(clientUserAgent);

    // Track this username, device, and country under this IP address
    if (!ipToAccountsMap.has(clientIp)) {
      ipToAccountsMap.set(clientIp, new Set<string>());
    }
    ipToAccountsMap.get(clientIp)!.add(resolvedUsername);
    ipToDeviceMap.set(clientIp, clientDevice);
    ipToCountryMap.set(clientIp, realFlag);
    const clientFingerprint = incomingFp || reg?.deviceFingerprint || `FP-${clientIp.replace(/[^a-zA-Z0-9]/g, '').slice(-6).toUpperCase() || 'STD'}`;
    ipToFingerprintMap.set(clientIp, clientFingerprint);

    // Save audit connection details (IP history, device history, fingerprint, lastSeen) to persistent store
    recordMemberAuditConnection(resolvedUsername, clientIp, clientDevice, realFlag, clientFingerprint);

    if (reg) {
      reg.deviceFingerprint = clientFingerprint;
      reg.flag = realFlag;
      reg.flagNumber = assignedFlagNumber;
      if (!reg.flagNumbersByFlag) reg.flagNumbersByFlag = {};
      reg.flagNumbersByFlag[realFlag] = assignedFlagNumber;
      if (typeof isIncognito === 'boolean') reg.isIncognito = isIncognito;
      saveMembers();
    }

    const userRole = reg?.role || (normalizedLoginType === 'visitor' ? 'guest' : 'member');
    let userQuote = '';
    if (reg?.statusQuote && reg.statusQuote.trim() && reg.statusQuote.trim() !== 'عضو جديد' && reg.statusQuote.trim() !== '..') {
      userQuote = reg.statusQuote.trim();
    } else if (statusQuote && statusQuote.trim() && statusQuote.trim() !== 'عضو جديد' && statusQuote.trim() !== '..') {
      userQuote = sanitizeText(statusQuote.trim());
    } else {
      userQuote = getDefaultStatusByRole(userRole);
    }

    const activeTokenVersion = !isRoomSwitchOnly
      ? bumpMemberTokenVersion(resolvedUsername)
      : getMemberTokenVersion(resolvedUsername);
    const userSessionToken = preservedSessionToken || signSessionToken(resolvedUsername, activeTokenVersion);

    const canGhost = Boolean(rolePermissions[userRole]?.canGhostLogin);
    const effectiveGhost = isGhost !== undefined ? Boolean(isGhost) : previousIsGhost;
    const isGhostUser = Boolean(effectiveGhost && canGhost);

    const muteMatch = findActiveMuteMatch(resolvedUsername, clientIp, clientFingerprint);
    if (muteMatch.isMuted) {
      syncMuteRecordOnReentry(resolvedUsername, clientIp, clientFingerprint, muteMatch);
    }
    const effJoinTextMuted = Boolean(isUserJailed || muteMatch.muteText);
    const effJoinVoiceMuted = Boolean(isUserJailed || muteMatch.muteVoice);
    const effJoinMuted = Boolean(effJoinTextMuted || effJoinVoiceMuted);

    const newUser: ConnectedUser = {
      id: socket.id,
      username: resolvedUsername,
      displayName: reg?.displayName || resolvedUsername,
      room: finalTargetRoom,
      avatarSeed: resolvedUsername,
      avatarUrl: reg?.avatarUrl || undefined,
      avatarFrame: reg?.avatarFrame || undefined,
      statusQuote: userQuote,
      flag: realFlag,
      flagNumber: assignedFlagNumber,
      role: userRole,
      likes: reg ? reg.likes : 500,
      points: reg ? reg.points : 2500,
      honorBadge: reg?.honorBadge || undefined,
      isVoice: false,
      micSlot: null,
      isMuted: effJoinMuted,
      isTextMuted: effJoinTextMuted,
      isVoiceMutedByAdmin: effJoinVoiceMuted,
      isSpeaking: false,
      presenceState: 'online',
      ipAddress: clientIp,
      deviceInfo: clientDevice,
      deviceFingerprint: clientFingerprint,
      isJailed: isUserJailed,
      isGhost: isGhostUser,
      isIncognito: Boolean(isIncognito),
      joinedAt: Date.now(),
      sessionToken: userSessionToken,
      lastActiveTime: Date.now(),
      nameColor: (reg as any)?.nameColor || undefined,
      textColor: (reg as any)?.textColor || undefined,
      nameGradient: (reg as any)?.nameGradient || undefined,
      profileBg: (reg as any)?.profileBg || (reg as any)?.memberBg || undefined,
      memberBg: (reg as any)?.memberBg || (reg as any)?.profileBg || undefined,
      theme: (reg as any)?.theme || undefined,
      fontFamily: (reg as any)?.fontFamily || undefined,
      wallpaper: (reg as any)?.wallpaper || undefined,
      bubbleStyle: (reg as any)?.bubbleStyle || undefined,
      fontSize: (reg as any)?.fontSize || undefined,
      nameBannerUrl: reg?.nameBannerUrl || undefined,
      giftBadges: reg?.giftBadges || undefined,
      isPmDisabled: Boolean(reg?.isPmDisabled),
      engagement: reg?.engagement || getDefaultEngagement()
    };

    activeSessions.set(userSessionToken, {
      sessionToken: userSessionToken,
      user: newUser,
      currentSocketId: socket.id,
      lastActiveTime: Date.now(),
      isExplicitlyLoggedOut: false,
      tokenVersion: activeTokenVersion
    });
    usernameToSessionMap.set(resolvedUsername.toLowerCase(), userSessionToken);
    persistActiveSessions();

    users.unshift(newUser);
    socket.join(finalTargetRoom);

    if (isGhostUser) {
      logMonitorEvent('join', `دخل ${newUser.username} إلى ${newUser.room} متخفياً (دخول مخفي 👻) (العلم: ${realFlag} - IP: ${clientIp})`, newUser.username);
    } else {
      logMonitorEvent('join', `دخل ${newUser.username} إلى ${newUser.room} (العلم: ${realFlag} - IP: ${clientIp})`, newUser.username);
      recordRecentLogin({
        username: newUser.username,
        displayName: newUser.displayName || newUser.username,
        avatarUrl: newUser.avatarUrl,
        nameBannerUrl: newUser.nameBannerUrl,
        statusQuote: newUser.statusQuote,
        flag: newUser.flag,
        flagNumber: newUser.flagNumber,
        room: newUser.room,
        role: newUser.role,
        timestamp: Date.now(),
        time: getCurrentTimeString()
      });
    }

    // Always emit roomJoined so client updates room state
    socket.emit('roomJoined', { user: newUser });

    // If this is a new login session (not just changing rooms with the same socket), emit loginSuccess
    const isNewLogin = !previousRoom || Boolean(loginType);
    if (isNewLogin) {
      socket.emit('loginSuccess', { user: newUser, sessionToken: userSessionToken });
    }

    // Deliver roles configuration and permissions tables to client
    socket.emit('rolesConfigUpdated', rolesConfig);
    socket.emit('rolePermissionsUpdated', rolePermissions);

    if (isUserJailed) {
      socket.emit('systemAlert', '🚔 تنبيه: أنت قيد السجن والاحتجاز الإداري في (سجن حسان برو) بموجب قرار إداري صارم. لا يمكنك التحدث أو الكتابة أو مغادرة السجن إلا بقرار الإفراج.');
    } else if (muteMatch.isMuted) {
      socket.emit('forceVoiceMuteState', {
        muted: Boolean(effJoinVoiceMuted || effJoinTextMuted),
        textMuted: effJoinTextMuted,
        voiceMuted: effJoinVoiceMuted,
        by: muteMatch.matchedRecord?.mutedBy || 'النظام الأمني'
      });
      socket.emit(
        'systemAlert',
        effJoinTextMuted
          ? '🔇 تنبيه: أنت خاضع لإسكات إداري مستمر مرتبط بحسابك وبصمة جهازك وعنوان الـ IP حتى عند تغيير الحساب.'
          : '🔇 تنبيه: المايك الصوتي مكتوم عنك بقرار إداري مستمر مرتبط بحسابك وبصمة جهازك.'
      );
    }

    // Send mic slots, room settings, pinned topic/message & active live broadcast state for finalTargetRoom
    emitRoomContextSync(socket, finalTargetRoom);

    // Notify active mic speakers in this room so they stream WebRTC audio to this newly joined user
    if (finalTargetRoom && finalTargetRoom !== 'خارج الغرف') {
      users
        .filter((u) => u.room === finalTargetRoom && u.isVoice && u.id !== socket.id)
        .forEach((speaker) => {
          io.to(speaker.id).emit('voiceNewListener', {
            id: socket.id,
            username: newUser.username
          });
        });
    }

    // Clean Room Mode: Always clear previous messages on room entrance/switch
    socket.emit('chatHistory', []);

    // Send profile visitors for the logged-in user
    socket.emit('profileVisitorsUpdated', reg?.visitors || []);

    // Deliver queued offline private messages if any (persisted in MongoDB)
    const pendingPmList = offlinePrivateMessages.get(resolvedUsername.toLowerCase());
    if (pendingPmList && pendingPmList.length > 0) {
      socket.emit('offlinePrivateMessages', pendingPmList);
      offlinePrivateMessages.delete(resolvedUsername.toLowerCase());
      saveOfflinePrivateMessages();
    }

    // Sync member personal data (ignored users, starred messages, friends) from MongoDB
    if (reg) {
      socket.emit('userMemberDataSync', {
        ignoredUsers: reg.ignoredUsers || [],
        starredMessages: reg.starredMessages || [],
        friends: reg.friends || []
      });
    }

    // Broadcast entry message in chat stream with user name (مستثنى في حالة الدخول المخفي)
    if (!newUser.isGhost) {
      const entryMessage: StoredMessage = {
        id: `enter-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        room: finalTargetRoom,
        username: cleanUsername,
        avatarUrl: newUser.avatarUrl,
        nameBannerUrl: newUser.nameBannerUrl,
        flag: newUser.flag,
        badge: `${finalTargetRoom} Room | دخل الى`,
        badgeColor: 'text-amber-400',
        text: `دخل ${cleanUsername} إلى ${finalTargetRoom} أهلاً وسهلاً 🦅`,
        time: getCurrentTimeString(),
        timestamp: Date.now()
      };
      chatHistory.push(entryMessage);
      saveHistory();
      io.to(finalTargetRoom).emit('message', entryMessage);
    }

    // Send welcome greeting for this user
    const currentRoomObj = chatRooms.find((r) => r.id === finalTargetRoom);
    const roomTitle = currentRoomObj?.name || `${finalTargetRoom} Room`;
    const curRoomSettings = getRoomSettings(finalTargetRoom);

    // 1. Room Owner Custom Welcome Message
    if (curRoomSettings?.welcomeEnabled !== false && curRoomSettings?.welcomeMessage && curRoomSettings.welcomeMessage.trim()) {
      socket.emit('message', {
        id: `welcome-room-${Date.now()}`,
        room: finalTargetRoom,
        username: roomTitle,
        badge: 'ترحـيـب الغرفة',
        badgeColor: 'text-amber-500',
        text: curRoomSettings.welcomeMessage.trim(),
        time: getCurrentTimeString(),
        timestamp: Date.now()
      });
    }

    // 2. Chat General Welcome Message (managed in Control Panel - sent only on initial login, not on room switches)
    if (isNewLogin && generalWelcomeSettings.enabled && generalWelcomeSettings.message && generalWelcomeSettings.message.trim()) {
      socket.emit('message', {
        id: `welcome-gen-${Date.now()}`,
        room: finalTargetRoom,
        username: generalWelcomeSettings.title || 'إدارة حسان برو',
        badge: 'ترحـيـب عام',
        badgeColor: 'text-red-600',
        text: generalWelcomeSettings.message.trim(),
        time: getCurrentTimeString(),
        timestamp: Date.now() + 1
      });
    }

    // Broadcast roomUsers to the newly entered room (filtered for ghost mode)
    broadcastRoomUsers(finalTargetRoom);

    // If switching from another room, broadcast transfer departure to previous room and update users
    if (previousRoom && previousRoom !== finalTargetRoom && previousRoom !== 'خارج الغرف') {
      if (!newUser.isGhost) {
        const switchLeaveMessage: StoredMessage = {
          id: `leave-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
          room: previousRoom,
          username: cleanUsername,
          avatarUrl: newUser.avatarUrl,
          nameBannerUrl: newUser.nameBannerUrl,
          flag: newUser.flag,
          badge: `${finalTargetRoom} | انتقل إلى`,
          badgeColor: 'text-amber-400',
          text: `غادر ${cleanUsername} وانتقل إلى غرفة [${finalTargetRoom}] 🚪`,
          time: getCurrentTimeString(),
          timestamp: Date.now()
        };
        chatHistory.push(switchLeaveMessage);
        pruneRoomChatHistory(previousRoom);
        saveHistory();
        io.to(previousRoom).emit('message', switchLeaveMessage);
      }

      broadcastRoomUsers(previousRoom);
    }

    // Authoritative global snapshot broadcast so every client sees updated rooms and presence
    broadcastAllUsers();
    broadcastRoomsUpdate();

    // Send admin data to admin, super, hassan, or custom roles with control panel permissions / level >= 75
    if (isStaffUser(newUser)) {
      socket.emit('adminInitialData', {
        bannedList: Array.from(bannedRecords.values()),
        mutedList: Array.from(mutedRecords.values()),
        staffMemos,
        filterAlerts,
        monitoredWords,
        rolePermissions,
        rolesConfig,
        serverSecurity,
        monitorLogs: monitorLogs.slice(0, 1000),
        messageRetentionLimits
      });
    }

    // Trigger bot welcome greeting and sync bot admin panel state
    botEngine.onUserJoinedRoom(newUser, finalTargetRoom);
    botController.emitStateToAdmin(socket);
  });

  // Switch Room (تنقل العضو المتصل من غرفة إلى أخرى مع الحفاظ على الجلسة والصلاحيات والبصمة)
  socket.on(
    'switchRoom',
    (
      { room, roomPassword }: { room: string; roomPassword?: string },
      callback?: (res: { ok: boolean; room?: string; error?: string }) => void
    ) => {
      const fail = (errMsg: string) => {
        socket.emit('systemAlert', errMsg);
        if (typeof callback === 'function') callback({ ok: false, error: errMsg });
      };

      const user = users.find((u) => u.id === socket.id);
      if (!user) {
        fail('انتهت جلستك الحالية، يرجى تسجيل الدخول أولاً.');
        return;
      }

      const isUserJailed = Boolean(
        user.isJailed ||
        user.room === 'سجن حسان برو' ||
        jailedUsernames.has(user.username.toLowerCase()) ||
        jailedIps.has(clientIp) ||
        getRegisteredMember(user.username)?.member.isJailed
      );

      const roomDef = findRoomDefinition(room);
      if (!roomDef) {
        fail('الغرفة المطلوبة غير موجودة.');
        return;
      }

      const finalTargetRoom = roomDef.id;
      if (isUserJailed && finalTargetRoom !== 'سجن حسان برو') {
        fail('🚔 لا يمكنك مغادرة غرفة السجن! أنت محتجز وموقوف بقرار إداري ولا يمكنك الخروج إلا بإفراج رسمي من الإدارة.');
        return;
      }

      if (user.room === finalTargetRoom) {
        emitRoomContextSync(socket, finalTargetRoom);
        if (typeof callback === 'function') callback({ ok: true, room: finalTargetRoom });
        return;
      }

      if (roomDef.isPasswordProtected && roomDef.password) {
        const canBypassPass =
          isSupremeHassan(user) ||
          user.role === 'admin' ||
          getRoleLevel(user.role) >= getRoleLevel('admin') ||
          (finalTargetRoom === 'سجن حسان برو' && isUserJailed);
        if (!canBypassPass) {
          const passRateKey = `roompw:${roomDef.id}:${clientIp}`;
          if (!checkHttpRateLimit('roompw-check', passRateKey, 8, 60_000)) {
            fail('تم تجاوز عدد محاولات كلمة مرور الغرفة المسموح بها، يرجى الانتظار دقيقة 🔒');
            return;
          }
          if ((roomPassword || '').trim() !== roomDef.password) {
            fail(`🔒 كلمة المرور غير صحيحة لدخول غرفة [${roomDef.name}].`);
            return;
          }
        }
      }

      const previousRoom = user.room;
      if (user.micSlot !== null || user.isVoice) {
        releaseUserMic(user, previousRoom);
      }
      cleanupUserLiveState(socket.id, previousRoom);

      if (previousRoom && previousRoom !== 'خارج الغرف') {
        socket.leave(previousRoom);
        io.to(previousRoom).emit('userTyping', {
          userId: user.id,
          username: user.username,
          room: previousRoom,
          isTyping: false,
          timestamp: Date.now()
        });
      }

      user.room = finalTargetRoom;
      user.presenceState = user.presenceState || 'online';
      user.lastActiveTime = Date.now();
      for (const sess of activeSessions.values()) {
        if (sess.user && sess.user.username.toLowerCase() === user.username.toLowerCase()) {
          sess.user.room = finalTargetRoom;
          sess.user.micSlot = null;
          sess.user.isVoice = false;
          sess.user.isSpeaking = false;
          sess.user.isSharingMusic = false;
          sess.lastActiveTime = Date.now();
        }
      }
      persistActiveSessions();

      socket.join(finalTargetRoom);

      if (user.isGhost) {
        logMonitorEvent('join', `انتقل ${user.username} إلى ${finalTargetRoom} متخفياً (دخول مخفي 👻)`, user.username);
      } else {
        logMonitorEvent('join', `انتقل ${user.username} من [${previousRoom}] إلى [${finalTargetRoom}]`, user.username);
      }

      socket.emit('roomJoined', { user });
      emitRoomContextSync(socket, finalTargetRoom);
      socket.emit('chatHistory', []);

      users
        .filter((u) => u.room === finalTargetRoom && u.isVoice && u.id !== socket.id)
        .forEach((speaker) => {
          io.to(speaker.id).emit('voiceNewListener', {
            id: socket.id,
            username: user.username
          });
        });

      const displayAlias = user.displayName || user.username;
      if (!user.isGhost) {
        const entryMessage: StoredMessage = {
          id: `enter-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
          room: finalTargetRoom,
          username: user.username,
          displayName: displayAlias,
          avatarUrl: user.avatarUrl,
          nameBannerUrl: user.nameBannerUrl,
          flag: user.flag,
          badge: `${finalTargetRoom} Room | دخل الى`,
          badgeColor: 'text-amber-400',
          text: `دخل ${user.username} إلى ${finalTargetRoom} أهلاً وسهلاً 🦅`,
          time: getCurrentTimeString(),
          timestamp: Date.now()
        };
        chatHistory.push(entryMessage);
        pruneRoomChatHistory(finalTargetRoom);
        io.to(finalTargetRoom).emit('message', entryMessage);
      }

      const curRoomSettings = getRoomSettings(finalTargetRoom);
      if (curRoomSettings?.welcomeEnabled !== false && curRoomSettings?.welcomeMessage && curRoomSettings.welcomeMessage.trim()) {
        socket.emit('message', {
          id: `welcome-room-${Date.now()}`,
          room: finalTargetRoom,
          username: roomDef.name || `${finalTargetRoom} Room`,
          badge: 'ترحـيـب الغرفة',
          badgeColor: 'text-amber-500',
          text: curRoomSettings.welcomeMessage.trim(),
          time: getCurrentTimeString(),
          timestamp: Date.now() + 1
        });
      }

      if (previousRoom && previousRoom !== finalTargetRoom && previousRoom !== 'خارج الغرف') {
        if (!user.isGhost) {
          const switchLeaveMessage: StoredMessage = {
            id: `leave-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
            room: previousRoom,
            username: user.username,
            displayName: displayAlias,
            avatarUrl: user.avatarUrl,
            nameBannerUrl: user.nameBannerUrl,
            flag: user.flag,
            badge: `${finalTargetRoom} | انتقل إلى`,
            badgeColor: 'text-amber-400',
            text: `غادر ${user.username} وانتقل إلى غرفة [${finalTargetRoom}] 🚪`,
            time: getCurrentTimeString(),
            timestamp: Date.now()
          };
          chatHistory.push(switchLeaveMessage);
          pruneRoomChatHistory(previousRoom);
          io.to(previousRoom).emit('message', switchLeaveMessage);
        }
        broadcastRoomUsers(previousRoom);
      }

      saveHistory();
      broadcastRoomUsers(finalTargetRoom);
      broadcastAllUsers();
      broadcastRoomsUpdate();
      botEngine.onUserJoinedRoom(user, finalTargetRoom);

      if (typeof callback === 'function') {
        callback({ ok: true, room: finalTargetRoom });
      }
    }
  );

  // User typing indicator event (بث حالة الكتابة الآن للأعضاء في نفس الغرفة مع وميض وتأثير بصري)
  socket.on('typing', ({ isTyping }: { isTyping?: boolean } = {}) => {
    const user = users.find((u) => u.id === socket.id);
    if (!user || !user.room || user.room === 'خارج الغرف') return;

    socket.to(user.room).emit('userTyping', {
      userId: user.id,
      username: user.username,
      displayName: user.displayName || user.username,
      avatarUrl: user.avatarUrl,
      flag: user.flag,
      role: user.role,
      nameColor: user.nameColor,
      nameGradient: user.nameGradient,
      room: user.room,
      isTyping: Boolean(isTyping),
      timestamp: Date.now()
    });
  });

  // Private message typing indicator event (بث حالة الكتابة الآن في الخاص للطرف الآخر)
  socket.on('pmTyping', ({ toId, toUsername, isTyping }: { toId?: string; toUsername?: string; isTyping: boolean }) => {
    const user = users.find((u) => u.id === socket.id);
    if (!user) return;

    let recipient = users.find((u) => u.id === toId);
    if (!recipient && toUsername) {
      recipient = users.find((u) => u.username.toLowerCase() === toUsername.trim().toLowerCase());
    }
    if (recipient) {
      io.to(recipient.id).emit('userPmTyping', {
        fromUserId: user.id,
        fromUsername: user.username,
        fromDisplayName: user.displayName || user.username,
        avatarUrl: user.avatarUrl,
        nameBannerUrl: user.nameBannerUrl,
        isTyping: Boolean(isTyping),
        timestamp: Date.now()
      });
    }
  });

  // Chat message event (Broadcast-First: emits immediately before history persistence & batched engagement save)
  socket.on(
    'chatMessage',
    async (
      {
        text,
        mediaUrl,
        mediaType,
        voiceNote,
        replyTo,
        clientTempId,
        shortcutsExpanded
      }: {
        text?: string;
        mediaUrl?: string;
        mediaType?: 'image' | 'video' | 'sticker' | 'audio';
        voiceNote?: { audioUrl: string; duration: number };
        replyTo?: { id: string; username: string; displayName?: string; text: string; mediaUrl?: string };
        clientTempId?: string;
        shortcutsExpanded?: boolean;
      },
      ack?: (res: { ok: boolean; id?: string; clientTempId?: string; error?: string }) => void
    ) => {
      const reject = (errMsg: string) => {
        socket.emit('systemAlert', errMsg);
        if (typeof ack === 'function') ack({ ok: false, clientTempId, error: errMsg });
      };

      const user = users.find((u) => u.id === socket.id);
      if (!user) {
        if (typeof ack === 'function') ack({ ok: false, clientTempId, error: 'الجلسة غير متصلة حالياً.' });
        return;
      }

      if (!user.room || user.room === 'خارج الغرف') {
        reject('يجب الدخول إلى إحدى الغرف أولاً قبل إرسال الرسائل.');
        return;
      }

      if (clientTempId) {
        const dedupKey = `room:${user.username.toLowerCase()}:${clientTempId}`;
        const existing = recentClientTempIds.get(dedupKey);
        if (existing) {
          if (typeof ack === 'function') ack({ ok: true, id: existing.id, clientTempId });
          return;
        }
      }

      if (user.isJailed || user.isTextMuted) {
        reject('أنت خاضع للإسكات أو التقييد الإداري حالياً ولا يمكنك الإرسال.');
        return;
      }

      // Emergency Lockdown Check
      if (serverSecurity.emergencyLockdown && !isSupremeHassan(user) && user.role !== 'admin' && user.role !== 'super') {
        reject('🔒 تم تفعيل وضع الطوارئ الإداري (Lockdown)، الإرسال محصور بطاقم الإدارة.');
        return;
      }

      const roomSettings = getRoomSettings(user.room);
      if (roomSettings.isChatLocked && !isSupremeHassan(user) && user.role !== 'admin' && user.role !== 'super') {
        reject('الشات العام مقفل حالياً بقرار من إدارة حسان برو.');
        return;
      }

      if (roomSettings.slowModeSeconds > 0 && !isSupremeHassan(user) && user.role !== 'admin' && user.role !== 'super') {
        const lastSent = userLastMessageTime[socket.id] || 0;
        const elapsed = (Date.now() - lastSent) / 1000;
        if (elapsed < roomSettings.slowModeSeconds) {
          const remaining = Math.ceil(roomSettings.slowModeSeconds - elapsed);
          reject(`وضع الدردشة البطيء مفعل: يرجى الانتظار ${remaining} ثواني قبل إرسال رسالتك القادمة.`);
          return;
        }
        userLastMessageTime[socket.id] = Date.now();
      }

      const cleanMsg = sanitizeText(text).slice(0, 4000);
      if (!cleanMsg && !mediaUrl && !voiceNote) {
        if (typeof ack === 'function') ack({ ok: false, clientTempId, error: 'الرسالة فارغة.' });
        return;
      }

      const validMediaType = mediaType && ['image', 'video', 'sticker', 'audio'].includes(mediaType) ? mediaType : undefined;

      if (!isSupremeHassan(user) && user.role !== 'admin' && user.role !== 'super') {
        if (cleanMsg && !hasPermission(user.role, 'canSendText')) {
          reject('عفواً، صلاحية إرسال الرسائل الكتابية غير متاحة لرتبتك الحالية.');
          return;
        }
        if (mediaUrl && !hasPermission(user.role, 'canSendMedia')) {
          reject('عفواً، صلاحية إرسال الصور والملصقات غير متاحة لرتبتك الحالية.');
          return;
        }
        if (voiceNote && !hasPermission(user.role, 'canSendVoiceNotes')) {
          reject('عفواً، صلاحية إرسال التسجيلات الصوتية غير متاحة لرتبتك الحالية.');
          return;
        }
      }

      // Likes Requirement Check for Room Messages
      if (!isSupremeHassan(user) && user.role !== 'admin' && user.role !== 'super') {
        if (cleanMsg && likesSettings.roomTextLikes > 0 && user.likes < likesSettings.roomTextLikes) {
          reject(`عفواً، يتطلب إرسال النص في الغرف ${likesSettings.roomTextLikes} لايك على الأقل. رصيدك الحالي: ${user.likes} 👍`);
          return;
        }
        if ((mediaUrl || voiceNote) && likesSettings.roomMediaLikes > 0 && user.likes < likesSettings.roomMediaLikes) {
          reject(`عفواً، يتطلب إرسال الوسائط في الغرفة ${likesSettings.roomMediaLikes} لايك على الأقل. رصيدك الحالي: ${user.likes} 👍`);
          return;
        }
      }

      // External Link Blocker Check
      if (cleanMsg && serverSecurity.blockExternalLinks && !isSupremeHassan(user) && user.role !== 'admin' && user.role !== 'super') {
        const urlPattern = /(https?:\/\/|www\.|\.com|\.net|\.org|\.xyz|\.app|\.me|\.online|t\.me|wa\.me)/i;
        if (urlPattern.test(cleanMsg)) {
          logMonitorEvent('security', `محاولة نشر رابط محظور من [${user.username}]: "${cleanMsg}"`, user.username);
          reject('⚠️ نشر الروابط والإعلانات الخارجية ممنوع منعاً باتاً في شات حسان برو.');
          return;
        }
      }

      // Automatic Chat Shortcut Expansion (skip redundant regex pass if client already expanded shortcuts)
      const expandedMsg = cleanMsg ? (shortcutsExpanded ? cleanMsg : expandShortcuts(cleanMsg)) : '';

      // Guarantee short URLs (<1KB payload) by converting any client base64 to cloud/local storage
      const safeMediaUrl = await ensureMediaUrlNotBase64(mediaUrl);
      let safeVoiceNote: { audioUrl: string; duration: number } | undefined;
      if (voiceNote?.audioUrl) {
        const resolvedAudioUrl = await ensureMediaUrlNotBase64(voiceNote.audioUrl);
        if (resolvedAudioUrl) {
          safeVoiceNote = {
            audioUrl: resolvedAudioUrl,
            duration: Number.isFinite(Number(voiceNote.duration)) ? Math.min(600, Math.max(0, Number(voiceNote.duration))) : 0
          };
        }
      }

      const enrichedReplyTo = replyTo && typeof replyTo === 'object'
        ? {
            id: sanitizeText(String(replyTo.id || '')).slice(0, 80),
            username: sanitizeText(String(replyTo.username || '')).slice(0, 60),
            displayName: resolveUserDisplayName(sanitizeText(String(replyTo.username || '')), sanitizeText(replyTo.displayName)),
            text: sanitizeText(String(replyTo.text || '')).slice(0, 500),
            ...(replyTo.mediaUrl ? { mediaUrl: sanitizeUrl(replyTo.mediaUrl) || undefined } : {})
          }
        : undefined;

      const messageObj: StoredMessage = {
        id: `msg-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
        ...(clientTempId ? { clientTempId } : {}),
        room: user.room,
        username: user.username,
        displayName: user.displayName || user.username,
        avatarUrl: user.avatarUrl,
        nameBannerUrl: user.nameBannerUrl,
        flag: user.flag,
        text: expandedMsg,
        mediaUrl: safeMediaUrl,
        mediaType: validMediaType,
        voiceNote: safeVoiceNote,
        replyTo: enrichedReplyTo,
        time: getCurrentTimeString(),
        timestamp: Date.now(),
        reactions: {},
        nameColor: user.nameColor,
        textColor: user.textColor,
        nameGradient: user.nameGradient,
        giftBadges: user.giftBadges
      };

      if (clientTempId) {
        registerClientTempId(`room:${user.username.toLowerCase()}:${clientTempId}`, messageObj.id);
      }

      // 1. BROADCAST-FIRST: Emit to all room members & acknowledge sender immediately
      io.to(user.room).emit('message', messageObj);
      if (typeof ack === 'function') {
        ack({ ok: true, id: messageObj.id, clientTempId });
      }

      // 2. DEFERRED WORK (after broadcast): filter logging, history push & prune, batched engagement save, bots
      if (cleanMsg) {
        checkAndLogMonitoredWords(cleanMsg, user, { type: 'room', targetName: user.room });
      }

      chatHistory.push(messageObj);
      pruneRoomChatHistory(user.room);
      saveHistory();

      const regMember = getRegisteredMember(user.username)?.member;
      if (regMember) {
        if (!regMember.engagement) regMember.engagement = getDefaultEngagement();
        regMember.engagement.messagesSent += 1;
        const engProg = calculateEngagementStars(regMember.engagement);
        regMember.engagement.starsLevel = engProg.starsLevel;
        regMember.engagement.progressPercent = engProg.progressPercent;
        user.engagement = regMember.engagement;
        scheduleEngagementMembersSave();
      }

      botEngine.onRoomMessage(user, messageObj, cleanMsg);
      socket.to(user.room).emit('userTyping', {
        userId: user.id,
        username: user.username,
        displayName: user.displayName || user.username,
        room: user.room,
        isTyping: false,
        timestamp: Date.now()
      });
    }
  );

  // General Broadcast Alert (إشعار عام للغرفة من الإدارة والمشرفين)
  socket.on('broadcastAlert', ({ text }: { text: string }) => {
    const user = users.find((u) => u.id === socket.id);
    if (!user || !user.room || user.room === 'خارج الغرف') return;

    if (!isSupremeHassan(user) && user.role !== 'admin' && user.role !== 'super') {
      socket.emit('systemAlert', 'عفواً، إرسال الإشعار والتنبيه العام متاح للإدارة والمشرفين فقط.');
      return;
    }

    const clean = sanitizeText(text);
    if (!clean) return;

    const alertMessageObj: StoredMessage = {
      id: `alert-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      room: user.room,
      username: user.username,
      displayName: user.displayName || user.username,
      avatarUrl: user.avatarUrl,
      nameBannerUrl: user.nameBannerUrl,
      flag: user.flag,
      badge: '📢 إشعار عام',
      badgeColor: 'text-amber-500 font-extrabold',
      text: clean,
      time: 'الآن',
      timestamp: Date.now(),
      reactions: {}
    };

    chatHistory.push(alertMessageObj);
    pruneRoomChatHistory(user.room);
    saveHistory();

    io.to(user.room).emit('generalAlert', {
      from: user.username,
      text: clean,
      messageObj: alertMessageObj
    });
    io.to(user.room).emit('message', alertMessageObj);
  });

  // Take Mic slot (1 to 5) with explicit server validation & ack callback
  socket.on('takeMic', (payload: { slotNumber: number }, callback?: (res: { ok: boolean; error?: string; slotNumber?: number }) => void) => {
    const slotNumber = Number(payload?.slotNumber);
    const user = users.find((u) => u.id === socket.id);
    const fail = (errMsg: string) => {
      socket.emit('micError', errMsg);
      if (typeof callback === 'function') callback({ ok: false, error: errMsg });
    };

    if (!user) {
      fail('يجب تسجيل الدخول أولاً للصعود إلى المايك.');
      return;
    }

    if (user.room === 'خارج الغرف') {
      fail('يجب دخول غرفة أولاً للصعود إلى المايك.');
      return;
    }

    if (user.isJailed) {
      fail('أنت مقيد في السجن الإداري ولا يمكنك استخدام المايك.');
      return;
    }

    const canTakeMic = isSupremeHassan(user) || user.role === 'admin' || user.role === 'super' || hasPermission(user.role, 'canTakeMic');
    if (!canTakeMic) {
      fail('عفواً، صلاحية الصعود إلى المايك غير متاحة لرتبتك الحالية.');
      return;
    }

    if (user.isTextMuted) {
      fail('أنت خاضع للإسكات من قبل الإدارة، لا يمكنك الصعود إلى المايك.');
      return;
    }

    if (!isSupremeHassan(user) && user.role !== 'admin' && user.role !== 'super' && likesSettings.micLikes > 0 && user.likes < likesSettings.micLikes) {
      fail(`عفواً، يتطلب الصعود إلى المايك ${likesSettings.micLikes} لايك على الأقل. رصيدك الحالي: ${user.likes} 👍`);
      return;
    }

    const roomSettings = getRoomSettings(user.room);
    if (roomSettings.isVoiceLocked && !isSupremeHassan(user) && user.role !== 'admin' && user.role !== 'super' && !hasPermission(user.role, 'canLockVoice')) {
      fail('المايكات مقفلة ومحصورة حالياً على الإدارة والمشرفين فقط.');
      return;
    }

    const slots = getMicSlotsForRoom(user.room);
    const targetSlot = slots.find((s) => s.slotNumber === slotNumber);
    if (!targetSlot) {
      fail('مقعد المايك المحدد غير صالح.');
      return;
    }

    const roomDefForMic = findRoomDefinition(user.room);
    const effectiveVoiceLimit = Math.max(1, Math.min(5, roomDefForMic?.voiceLimit || 5));
    const currentOccupiedCount = slots.filter((s) => Boolean(s.user) && s.user?.id !== user.id).length;
    if (!targetSlot.user && currentOccupiedCount >= effectiveVoiceLimit) {
      fail(`تم الوصول للحد الأقصى لعدد المايكات المتاحة في هذه الغرفة (${effectiveVoiceLimit}).`);
      return;
    }

    if (targetSlot.user && targetSlot.user.id !== user.id) {
      fail(`المايك رقم ${slotNumber} مشغول حالياً.`);
      return;
    }

    slots.forEach((s) => {
      if (s.user && (s.user.id === user.id || s.user.username.toLowerCase() === user.username.toLowerCase())) {
        s.user = null;
      }
    });

    user.micSlot = slotNumber;
    user.isVoice = true;
    user.isMuted = Boolean(user.isVoiceMutedByAdmin);
    user.isSpeaking = false;
    user.isSharingMusic = false;
    targetSlot.user = toPublicConnectedUser(user);

    for (const sess of activeSessions.values()) {
      if (sess.user && sess.user.username.toLowerCase() === user.username.toLowerCase()) {
        sess.user.micSlot = slotNumber;
        sess.user.isVoice = true;
        sess.user.isMuted = user.isMuted;
        sess.user.isSharingMusic = false;
      }
    }

    logMonitorEvent('mic_take', `صعد ${user.username} إلى المايك (${slotNumber})`, user.username);
    io.to(user.room).emit('micSlotsUpdated', getPublicMicSlotsForRoom(user.room));
    broadcastRoomsUpdate();

    const micMsg: StoredMessage = {
      id: `mic-${Date.now()}`,
      room: user.room,
      username: 'نظام المايكات 🎙️',
      badge: `مايك ${slotNumber}`,
      badgeColor: 'text-emerald-500',
      text: `صعد ${user.username} إلى المايك رقم (${slotNumber}) 🎤`,
      time: getCurrentTimeString(),
      timestamp: Date.now()
    };
    io.to(user.room).emit('message', micMsg);

    if (typeof callback === 'function') {
      callback({ ok: true, slotNumber });
    }
    if (user.isVoiceMutedByAdmin) {
      socket.emit('forceVoiceMuteState', { muted: true, by: 'الإدارة' });
    }

    // Send ALL other users in this room (both speakers AND listeners) so WebRTC audio reaches everyone
    const otherRoomPeers = users
      .filter((u) => u.room === user.room && u.id !== socket.id)
      .map((u) => ({ id: u.id, username: u.username, isVoice: Boolean(u.isVoice) }));
    socket.emit('voiceRoomUsers', otherRoomPeers);
    socket.broadcast.to(user.room).emit('userJoinedVoice', toPublicConnectedUser(user));
  });

  // Drop Mic slot
  socket.on('dropMic', () => {
    const user = users.find((u) => u.id === socket.id);
    if (!user) return;

    const wasVoice = user.isVoice || user.micSlot !== null;
    const releasedNumber = releaseUserMic(user, user.room);

    if (wasVoice) {
      logMonitorEvent('mic_drop', `نزل ${user.username} من المايك (${releasedNumber || 1})`, user.username);
    }
  });

  socket.on('joinVoice', () => {
    // Handled alongside takeMic; kept for explicit WebRTC readiness ack
  });

  socket.on('leaveVoice', () => {
    const user = users.find((u) => u.id === socket.id);
    if (!user) return;
    if (user.isVoice) {
      user.isVoice = false;
      user.isSpeaking = false;
      user.isSharingMusic = false;
      socket.broadcast.to(user.room).emit('userLeftVoice', { userId: socket.id, username: user.username });
    }
  });

  // Listener requests PCM-WAV fallback streaming from a specific speaker if WebRTC/TURN is blocked
  socket.on('requestVoiceFallback', ({ speakerId }: { speakerId: string }) => {
    const requester = users.find((u) => u.id === socket.id);
    const speaker = users.find((u) => u.id === speakerId && (u.isVoice || u.micSlot !== null));
    if (!requester || !speaker || requester.room !== speaker.room) return;
    io.to(speaker.id).emit('enableVoiceFallback', { requesterId: socket.id });
  });

  // WebRTC Signaling (scoped to peers inside the same room)
  socket.on('voiceSignal', ({ targetId, signal }: { targetId: string; signal: any }) => {
    const sender = users.find((u) => u.id === socket.id);
    if (!sender || !targetId) return;
    const target = users.find((u) => u.id === targetId && u.room === sender.room);
    if (!target) return;

    io.to(targetId).emit('voiceSignal', {
      senderId: socket.id,
      senderUsername: sender.username,
      signal
    });
  });

  // Voice state
  socket.on('voiceStateUpdate', ({ isMuted, isSpeaking, isSharingMusic }: { isMuted?: boolean; isSpeaking?: boolean; isSharingMusic?: boolean }) => {
    const user = users.find((u) => u.id === socket.id);
    if (!user) return;

    if (typeof isMuted === 'boolean') {
      if (user.isVoiceMutedByAdmin && !isMuted) {
        socket.emit('forceVoiceMuteState', { muted: true, by: 'الإدارة' });
        socket.emit('systemAlert', '🔇 المايك مكتوم عنك من قبل الإدارة ولا يمكنك فتحه حالياً.');
        user.isMuted = true;
      } else {
        user.isMuted = isMuted;
      }
    }
    if (typeof isSharingMusic === 'boolean') {
      user.isSharingMusic = Boolean(
        isSharingMusic &&
          (user.micSlot !== null || user.isVoice) &&
          !user.isVoiceMutedByAdmin &&
          !user.isTextMuted
      );
    }
    if (typeof isSpeaking === 'boolean') {
      const canBroadcastAudio = !user.isVoiceMutedByAdmin && !user.isTextMuted && (!user.isMuted || Boolean(user.isSharingMusic));
      user.isSpeaking = canBroadcastAudio ? isSpeaking : false;
    }

    io.to(user.room).emit('micSlotsUpdated', getPublicMicSlotsForRoom(user.room));
    io.to(user.room).emit('userVoiceStateChanged', {
      userId: user.id,
      isMuted: user.isMuted,
      isSpeaking: user.isSpeaking
    });
  });

  // ================= ADMIN & MODERATION POWERS =================
  socket.on('adminAction', async ({
    action,
    targetUsername,
    value,
    reason
  }: {
    action: string;
    targetUsername?: string;
    value?: any;
    reason?: string;
  }) => {
    const admin = findSocketUser(socket.id);
    if (!admin) {
      socket.emit('systemAlert', 'يجب تسجيل الدخول أولاً لتنفيذ الإجراءات.');
      return;
    }

    const cleanTargetUsername = typeof targetUsername === 'string' ? sanitizeText(targetUsername).trim() : '';
    const target = cleanTargetUsername ? users.find((u) => u.username.toLowerCase() === cleanTargetUsername.toLowerCase()) : undefined;
    const regResult = cleanTargetUsername ? getRegisteredMember(cleanTargetUsername) : null;
    const offlineMember = regResult?.member;
    const resolvedTargetName = regResult?.key || target?.username || cleanTargetUsername;

    const readOnlyActions = ['getRoomStats', 'getBannedList', 'getMutedList', 'getMonitorLogs'];
    const actionsWithoutTarget = [
      'unban', 'unmute', 'globalBroadcast', 'broadcastMessage', 'globalClearChat', 'pullAllUsers', 'createRoom', 'editRoom', 'deleteRoom', 
      'lockRoomChat', 'setSlowMode', 'lockRoomVoice', 'setRoomPassword', 'adminSiren', 'toggleDeletedNotice',
      ...readOnlyActions
    ];

    if (!target && !offlineMember && !actionsWithoutTarget.includes(action) && action !== 'ban') {
      socket.emit('systemAlert', `المستخدم [${cleanTargetUsername}] غير موجود في قاعدة بيانات الأعضاء.`);
      return;
    }

    const targetProxy = target ? target : (offlineMember ? { username: resolvedTargetName, role: offlineMember.role } : undefined);

    if (!isSupremeHassan(admin) && cleanTargetUsername && ['ban', 'kick', 'mute', 'muteVoice', 'jailUser', 'deleteAccount', 'updateRole', 'updatePassword'].includes(action)) {
      if (cleanTargetUsername.toLowerCase() === admin.username.toLowerCase() && ['ban', 'kick', 'mute', 'muteVoice', 'jailUser', 'deleteAccount'].includes(action)) {
        socket.emit('systemAlert', 'لا يمكنك تطبيق هذا الإجراء على حسابك الشخصي.');
        return;
      }
      if (!targetProxy && (cleanTargetUsername.toLowerCase() === 'hassan' || cleanTargetUsername.toLowerCase() === 'admin')) {
        socket.emit('systemAlert', 'لا تملك صلاحية تنفيذ هذا الإجراء ضد الإدارة العليا.');
        return;
      }
    }

    const isStaffAdmin = isStaffUser(admin);

    // Role Permission & Hierarchy Check: strictly check all non-read-only actions and sensitive read-only actions
    if (!readOnlyActions.includes(action)) {
      const perm = canPerformModeration(admin, targetProxy, action);
      if (!perm.allowed) {
        socket.emit('systemAlert', perm.reason || 'ليست لديك الصلاحية لتنفيذ هذا الإجراء.');
        return;
      }
    } else if (
      (action === 'getBannedList' || action === 'getMutedList' || action === 'getMonitorLogs') &&
      !isStaffAdmin &&
      !(action === 'getMutedList' && (hasPermission(admin.role, 'canMute') || hasPermission(admin.role, 'canMuteVoice')))
    ) {
      socket.emit('systemAlert', 'ليست لديك الصلاحية لعرض السجلات الإدارية الحساسة.');
      return;
    }

    switch (action) {
      case 'getRoomStats': {
        socket.emit('roomStats', getRoomStatistics());
        break;
      }
      case 'getBannedList': {
        socket.emit('bannedListUpdated', Array.from(bannedRecords.values()));
        break;
      }
      case 'getMutedList': {
        socket.emit('mutedListUpdated', Array.from(mutedRecords.values()));
        break;
      }
      case 'getMonitorLogs': {
        socket.emit('monitorLogs', monitorLogs);
        socket.emit('monitoredWordsUpdated', monitoredWords);
        break;
      }
      // سحب المايك (Revoke Mic)
      case 'pullMic': {
        if (target && (target.micSlot !== null || target.isVoice)) {
          const slotNum = target.micSlot || 1;
          releaseUserMic(target, target.room);
          io.to(target.id).emit('micRevokedByAdmin', { adminName: admin.username });

          logMonitorEvent('mic_pull', `قام [${admin.role.toUpperCase()}] ${admin.username} بسحب المايك من ${target.username}`, admin.username, target.username);

          const alertMsg: StoredMessage = {
            id: `pull-${Date.now()}`,
            room: target.room,
            username: 'إدارة حسان برو',
            badge: 'سحب المايك',
            badgeColor: 'text-red-600',
            text: `تم سحب المايك (${slotNum}) من ${target.username} بواسطة ${isSupremeHassan(admin) ? 'الإدارة العليا' : admin.role === 'admin' ? 'مدير النظام' : 'المشرف'} (${admin.username}).`,
            time: getCurrentTimeString(),
            timestamp: Date.now()
          };
          io.to(target.room).emit('message', alertMsg);
          socket.emit('systemAlert', `تم سحب المايك من ${target.username} بنجاح.`);
        }
        break;
      }

      // إسكات دائم (Persistent Mute / Unmute Text & Voice across IP, fingerprint, & linked accounts)
      case 'mute': {
        const uName = (resolvedTargetName || targetUsername || target?.username || '').trim();
        if (!uName) break;
        const currentMatch = findActiveMuteMatch(
          uName,
          target?.ipAddress || offlineMember?.ipAddress || '',
          target?.deviceFingerprint || offlineMember?.deviceFingerprint || ''
        );
        const currentlyTextMuted = Boolean(target?.isTextMuted || currentMatch.muteText);
        const shouldMute = typeof value === 'boolean' ? value : !currentlyTextMuted;

        if (shouldMute) {
          const muteRes = applyPersistentMute(uName, {
            muteText: true,
            muteVoice: true,
            reason: reason || (typeof value === 'string' ? value : '') || 'إسكات إداري دائم يشمل الجهاز والـ IP',
            actorName: admin.username
          });
          if (!muteRes.ok) {
            socket.emit('systemAlert', muteRes.error || 'تعذر تطبيق الإسكات.');
            break;
          }
          if (target) {
            io.to(target.id).emit('systemAlert', `تم فرض الإسكات المستمر عليك بواسطة ${admin.username}.`);
          }
          logMonitorEvent('mute', `إسكات دائم (كتابي وصوتي + IP وبصمة الجهاز) لـ ${uName} بواسطة [${admin.role.toUpperCase()}] ${admin.username}`, admin.username, uName);
          socket.emit('systemAlert', `تم إسكات ${uName} دائماً (على الحساب وبصمة الجهاز والـ IP) بنجاح.`);
        } else {
          clearPersistentMute(uName, { clearText: true, clearVoice: true, actorName: admin.username });
          if (target) {
            io.to(target.id).emit('systemAlert', `تم رفع الإسكات عنك بواسطة ${admin.username}.`);
          }
          logMonitorEvent('mute', `إلغاء الإسكات عن ${uName} بواسطة [${admin.role.toUpperCase()}] ${admin.username}`, admin.username, uName);
          socket.emit('systemAlert', `تم إلغاء إسكات ${uName} وجميع الحسابات المرتبطة بجهازه بنجاح.`);
        }
        break;
      }

      // كتم / إلغاء كتم المايك الصوتي عن العضو فقط دون إسكات الكتابة (Persistent Voice Mute)
      case 'muteVoice': {
        const uName = (resolvedTargetName || targetUsername || target?.username || '').trim();
        if (!uName) break;
        const currentMatch = findActiveMuteMatch(
          uName,
          target?.ipAddress || offlineMember?.ipAddress || '',
          target?.deviceFingerprint || offlineMember?.deviceFingerprint || ''
        );
        const currentlyVoiceMuted = Boolean(target?.isVoiceMutedByAdmin || target?.isMuted || currentMatch.muteVoice);
        const nextMuted = typeof value === 'boolean' ? value : !currentlyVoiceMuted;

        if (nextMuted) {
          const muteRes = applyPersistentMute(uName, {
            muteText: false,
            muteVoice: true,
            reason: reason || 'كتم المايك الصوتي بقرار إداري مستمر',
            actorName: admin.username
          });
          if (!muteRes.ok) {
            socket.emit('systemAlert', muteRes.error || 'تعذر كتم المايك.');
            break;
          }
          if (target) {
            io.to(target.id).emit('systemAlert', `تم كتم المايك الصوتي عنك بواسطة الإدارة (${admin.username}).`);
          }
          logMonitorEvent('mute', `كتم المايك الصوتي الدائم (بصمة/IP) عن ${uName} بواسطة ${admin.username}`, admin.username, uName);
          socket.emit('systemAlert', `تم كتم المايك عن ${uName} (بصمة/IP) بنجاح.`);
        } else {
          clearPersistentMute(uName, { clearText: false, clearVoice: true, actorName: admin.username });
          if (target) {
            io.to(target.id).emit('systemAlert', `تم فك كتم المايك الصوتي عنك بواسطة الإدارة (${admin.username}).`);
          }
          logMonitorEvent('mute', `فك كتم المايك الصوتي عن ${uName} بواسطة ${admin.username}`, admin.username, uName);
          socket.emit('systemAlert', `تم فك كتم المايك عن ${uName} بنجاح.`);
        }
        break;
      }

      // طرد من الغرفة (Kick with 2-minute cooldown - bots bypass cooldown and auto-rejoin)
      case 'kick': {
        if (target) {
          const kickReason = reason || 'مخالفة قوانين وقواعد شات حسان برو';
          logMonitorEvent('kick', `طرد ${target.username} بواسطة [${admin.role.toUpperCase()}] ${admin.username} (السبب: ${kickReason})`, admin.username, target.username);

          if (target.isBot || botEngine.isBotUsername(target.username)) {
            const kickedRoom = target.room;
            const tIdx = users.findIndex((u) => u.id === target.id);
            if (tIdx !== -1) users.splice(tIdx, 1);
            broadcastRoomUsers(kickedRoom);
            broadcastAllUsers();
            broadcastRoomsUpdate();
            botEngine.onBotKicked(target.username, kickedRoom);
            socket.emit('systemAlert', `تم طرد البوت ${target.username} من الغرفة.`);
            break;
          }
          
          // Apply 2-minute temporary cooldown on username and IP
          const cooldownExpiry = Date.now() + 2 * 60 * 1000;
          kickedCooldownMap.set(target.username.toLowerCase(), cooldownExpiry);
          if (target.ipAddress) {
            kickedCooldownMap.set(target.ipAddress, cooldownExpiry);
          }

          // Invalidate active session and revoke persistent tokens
          revokeUserSessionTokens({
            sessionToken: target.sessionToken,
            username: target.username,
            bumpVersion: true
          });

          io.to(target.id).emit('kickedByAdmin', { reason: kickReason, by: admin.username });
          cleanupUserLiveState(target.id);
          if (target.micSlot !== null || target.isVoice) {
            releaseUserMic(target, target.room);
          }

          // Disconnect the target socket cleanly so they cannot immediately spam
          const targetSock = io.sockets.sockets.get(target.id);
          if (targetSock) {
            try {
              targetSock.leave(target.room);
              targetSock.disconnect(true);
            } catch {}
          }

          const tIdx = users.findIndex((u) => u.id === target.id);
          if (tIdx !== -1) users.splice(tIdx, 1);
          broadcastRoomUsers(target.room);
          broadcastAllUsers();
          socket.emit('systemAlert', `تم طرد ${target.username} بنجاح (مع فرض مهلة دقيقتين لمنع الإزعاج).`);
        }
        break;
      }

      // باند وحظر دائم يشمل عنوان الـ IP وبصمة الجهاز والحسابات المرتبطة (Ban IP, Device Fingerprint & Username)
      case 'ban': {
        const uName = (resolvedTargetName || cleanTargetUsername || target?.username || '').trim();
        if (!uName) break;
        if (target?.isBot || botEngine.isBotUsername(uName)) {
          socket.emit('systemAlert', 'لا يمكن حظر البوتات نهائياً؛ يمكن للأدمن فقط إيقاف البوت أو حذفه من قسم إدارة البوتات.');
          break;
        }
        const banReason = value || reason || 'مخالفة شروط وقوانين حسان برو';
        const regTarget = getRegisteredMember(uName)?.member;

        // 1. Resolve target IP & Device Fingerprint
        let targetIp = target?.ipAddress || regTarget?.ipAddress;
        if (!targetIp) {
          for (const [ip, nicks] of ipToAccountsMap.entries()) {
            if (Array.from(nicks).some((n) => n.toLowerCase() === uName.toLowerCase())) {
              targetIp = ip;
              break;
            }
          }
        }
        if (!targetIp) targetIp = undefined;

        const allTargetFps = new Set<string>();
        if (target?.deviceFingerprint) allTargetFps.add(target.deviceFingerprint);
        if (regTarget?.deviceFingerprint) allTargetFps.add(regTarget.deviceFingerprint);
        if (Array.isArray(regTarget?.fingerprintHistory)) {
          regTarget.fingerprintHistory.forEach((f) => {
            if (f) allTargetFps.add(f);
          });
        }
        if (targetIp && ipToFingerprintMap.has(targetIp)) {
          allTargetFps.add(ipToFingerprintMap.get(targetIp)!);
        }
        for (const sObj of activeSessions.values()) {
          if (sObj.user?.username?.toLowerCase() === uName.toLowerCase() && sObj.user?.deviceFingerprint) {
            allTargetFps.add(sObj.user.deviceFingerprint);
          }
        }
        const targetFingerprintsList = Array.from(allTargetFps);
        const targetFingerprint = targetFingerprintsList[0];
        const targetCore = getHardwareCore(targetFingerprint);

        // 2. Add to banned sets (username, IP, and all device fingerprints + UID + hardware core)
        bannedUsers.add(uName.toLowerCase());
        if (targetIp && isBannableIp(targetIp)) bannedIps.add(targetIp);
        targetFingerprintsList.forEach((fpItem) => {
          addFingerprintToBanSet(fpItem);
          if (fingerprintToAccountsMap.has(fpItem)) {
            fingerprintToAccountsMap.get(fpItem)!.forEach((acc) => {
              if (!isUsernameSupremeHassan(acc)) bannedUsers.add(acc.toLowerCase());
            });
          }
          const c = getHardwareCore(fpItem);
          if (c && fingerprintToAccountsMap.has(c)) {
            fingerprintToAccountsMap.get(c)!.forEach((acc) => {
              if (!isUsernameSupremeHassan(acc)) bannedUsers.add(acc.toLowerCase());
            });
          }
        });

        // Ban all accounts associated with this IP (exempt supreme 'hassan' rank)
        if (targetIp && ipToAccountsMap.has(targetIp)) {
          ipToAccountsMap.get(targetIp)!.forEach((acc) => {
            if (!isUsernameSupremeHassan(acc)) bannedUsers.add(acc.toLowerCase());
          });
        }

        bannedRecords.set(uName.toLowerCase(), {
          username: uName,
          ip: targetIp,
          deviceFingerprint: targetFingerprint,
          deviceFingerprints: targetFingerprintsList,
          reason: banReason,
          bannedBy: admin.username,
          timestamp: Date.now()
        });
        saveBans();

        // Invalidate all active sessions for this username, IP, or device fingerprint (protect supreme 'hassan' sessions)
        for (const [sTok, sObj] of activeSessions.entries()) {
          if (isSupremeHassan(sObj.user) || isUsernameSupremeHassan(sObj.user?.username)) continue;
          const sFp = sObj.user?.deviceFingerprint;
          if (
            sObj.user?.username?.toLowerCase() === uName.toLowerCase() ||
            (targetIp && sObj.user?.ipAddress === targetIp) ||
            (sFp && targetFingerprintsList.some((tfp) => tfp === sFp || (targetCore && getHardwareCore(sFp) === targetCore)))
          ) {
            activeSessions.delete(sTok);
          }
        }
        if (!isUsernameSupremeHassan(uName)) {
          usernameToSessionMap.delete(uName.toLowerCase());
        }
        persistActiveSessions();

        // 3. Disconnect all live users from this IP, device fingerprint, or username (exempt supreme 'hassan' rank)
        const liveToKick = users.filter(
          (u) =>
            !isSupremeHassan(u) &&
            !isUsernameSupremeHassan(u.username) &&
            (u.username.toLowerCase() === uName.toLowerCase() ||
              (targetIp && u.ipAddress === targetIp) ||
              (u.deviceFingerprint && targetFingerprintsList.some((tfp) => tfp === u.deviceFingerprint || (targetCore && getHardwareCore(u.deviceFingerprint) === targetCore))))
        );
        liveToKick.forEach((kUser) => {
          io.to(kUser.id).emit('kickedByAdmin', { reason: `تم حظرك نهائياً وحظر بصمة جهازك وعنوان الـ IP من دخول حسان برو بقرار إداري (${banReason}).`, by: admin.username });
          cleanupUserLiveState(kUser.id);
          if (kUser.micSlot !== null || kUser.isVoice) {
            releaseUserMic(kUser, kUser.room);
          }
          const kSock = io.sockets.sockets.get(kUser.id);
          if (kSock) {
            try {
              kSock.leave(kUser.room);
              kSock.disconnect(true);
            } catch {}
          }
          const tIdx = users.findIndex((u) => u.id === kUser.id);
          if (tIdx !== -1) users.splice(tIdx, 1);
          broadcastRoomUsers(kUser.room);
        });

        emitToAuthorizedStaff('bannedListUpdated', Array.from(bannedRecords.values()), 'canUnban');
        broadcastAllRegisteredMembers();
        logMonitorEvent('ban', `حظر دائم لـ ${uName} وعنوان الـ IP [${targetIp || 'غير مسجل'}] وبصمة الجهاز [${targetFingerprint || 'غير مسجلة'}] بواسطة [${admin.role.toUpperCase()}] ${admin.username} (السبب: ${banReason})`, admin.username, uName);
        socket.emit('systemAlert', `تم تطبيق الباند والحظر النهائي على ${uName}${targetIp ? ` وعنوان الـ IP [${targetIp}]` : ''} بنجاح.`);
        break;
      }


      // إلغاء الحظر وفك الباند (Unban by Username, IP, or Device Fingerprint - حتى لو كان الشخص غير متصل)
      case 'unban': {
        const uName = (targetUsername || '').trim();
        if (!uName) break;

        let rec = bannedRecords.get(uName.toLowerCase());
        if (!rec) {
          for (const [, v] of bannedRecords.entries()) {
            const vFps = getAllRecordFingerprints(v);
            if (v.ip === uName || vFps.includes(uName) || v.username.toLowerCase() === uName.toLowerCase()) {
              rec = v;
              break;
            }
          }
        }

        if (rec) {
          if (rec.ip) {
            const otherUsesIp = Array.from(bannedRecords.values()).some(
              (r) => r.username.toLowerCase() !== rec!.username.toLowerCase() && r.ip === rec!.ip
            );
            if (!otherUsesIp) bannedIps.delete(rec.ip);
            if (ipToAccountsMap.has(rec.ip)) {
              ipToAccountsMap.get(rec.ip)!.forEach((acc) => {
                if (!bannedRecords.has(acc.toLowerCase())) {
                  bannedUsers.delete(acc.toLowerCase());
                }
              });
            }
          }
          bannedUsers.delete(rec.username.toLowerCase());
          bannedRecords.delete(rec.username.toLowerCase());
          const recFps = getAllRecordFingerprints(rec);
          recFps.forEach((fpItem) => {
            removeFingerprintFromBanSet(fpItem);
            const fpAccs = fingerprintToAccountsMap.get(fpItem);
            if (fpAccs) {
              fpAccs.forEach((acc) => {
                if (!bannedRecords.has(acc.toLowerCase())) {
                  bannedUsers.delete(acc.toLowerCase());
                }
              });
            }
            const core = getHardwareCore(fpItem);
            const coreAccs = core ? fingerprintToAccountsMap.get(core) : undefined;
            if (coreAccs) {
              coreAccs.forEach((acc) => {
                if (!bannedRecords.has(acc.toLowerCase())) {
                  bannedUsers.delete(acc.toLowerCase());
                }
              });
            }
          });
        } else {
          bannedUsers.delete(uName.toLowerCase());
          bannedIps.delete(uName);
          bannedRecords.delete(uName.toLowerCase());
        }
        saveBans();

        emitToAuthorizedStaff('bannedListUpdated', Array.from(bannedRecords.values()), 'canUnban');
        logMonitorEvent('role', `فك الحظر والباند عن [${uName}] بواسطة ${admin.username}`, admin.username, uName);
        socket.emit('systemAlert', `تم رفع الحظر وفك الباند عن ${uName} وجميع الحسابات المرتبطة بجهازه بنجاح 🔓.`);
        break;
      }

      // فك الإسكات الكتابي (Unmute Text)
      case 'unmuteText': {
        const uName = (resolvedTargetName || targetUsername || target?.username || '').trim();
        if (!uName) break;
        clearPersistentMute(uName, { clearText: true, clearVoice: false, actorName: admin.username });
        if (target) {
          io.to(target.id).emit('systemAlert', `تم فك الإسكات الكتابي عنك بواسطة الإدارة (${admin.username}).`);
        }
        logMonitorEvent('mute', `فك الإسكات الكتابي عن ${uName} بواسطة ${admin.username}`, admin.username, uName);
        socket.emit('systemAlert', `تم فك الإسكات الكتابي عن ${uName}.`);
        break;
      }

      // فك الإسكات الصوتي (Unmute Voice)
      case 'unmuteVoice': {
        const uName = (resolvedTargetName || targetUsername || target?.username || '').trim();
        if (!uName) break;
        clearPersistentMute(uName, { clearText: false, clearVoice: true, actorName: admin.username });
        if (target) {
          io.to(target.id).emit('systemAlert', `تم فك الإسكات الصوتي عنك بواسطة الإدارة (${admin.username}).`);
        }
        logMonitorEvent('mute', `فك الإسكات الصوتي عن ${uName} بواسطة ${admin.username}`, admin.username, uName);
        socket.emit('systemAlert', `تم فك الإسكات الصوتي عن ${uName}.`);
        break;
      }

      // فك الإسكات الشامل (كتابي + صوتي + بصمة + IP + الحسابات المرتبطة)
      case 'unmute': {
        const uName = (targetUsername || resolvedTargetName || target?.username || '').trim();
        if (!uName) break;
        const res = clearPersistentMute(uName, { clearText: true, clearVoice: true, actorName: admin.username });
        const notifiedTarget = target || users.find((u) => u.username.toLowerCase() === res.resolvedUsername.toLowerCase());
        if (notifiedTarget) {
          io.to(notifiedTarget.id).emit('systemAlert', `تم فك الإسكات عنك بالكامل بواسطة الإدارة (${admin.username}) 🔊.`);
        }
        logMonitorEvent('mute', `فك الإسكات الشامل عن [${uName}] بواسطة ${admin.username}`, admin.username, uName);
        socket.emit('systemAlert', `تم فك الإسكات عن ${uName} وجميع الحسابات المرتبطة بجهازه بنجاح 🔊.`);
        break;
      }

      // تعديل النقاط (Update Points - Admin Only - للأعضاء المتصلين وغير المتصلين)
      case 'updatePoints': {
        const uName = (resolvedTargetName || cleanTargetUsername || target?.username || '').trim();
        const rawPts = Number(value);
        const pts = Number.isFinite(rawPts) ? Math.min(100000000, Math.max(0, Math.floor(rawPts))) : 0;
        if (target) {
          target.points = pts;
        }
        const regPointsFound = getRegisteredMember(uName);
        if (regPointsFound) {
          regPointsFound.member.points = pts;
          saveMembers();
        }
        if (target) {
          broadcastRoomUsers(target.room);
        }
        broadcastAllRegisteredMembers();
        logMonitorEvent('role', `تعديل رصيد نقاط ${uName} إلى (${pts}) بواسطة مدير النظام ${admin.username}`, admin.username, uName);
        socket.emit('systemAlert', `تم تعديل نقاط ${uName} إلى ${pts}.`);
        break;
      }

      // قفل أو فتح الشات العام للغرفة (Lock Room Chat)
      case 'lockRoomChat': {
        const room = admin.room && admin.room !== 'خارج الغرف' ? resolveCanonicalRoomId(admin.room) : '';
        if (!room) {
          socket.emit('systemAlert', 'يجب أن تكون متواجداً داخل غرفة أولاً لتنفيذ هذا الإجراء.');
          break;
        }
        const settings = getRoomSettings(room);
        settings.isChatLocked = Boolean(value);
        saveRoomSettings();
        io.to(room).emit('roomSettingsUpdated', { room, settings });
        logMonitorEvent('role', `${settings.isChatLocked ? 'قفل' : 'فتح'} الشات العام في [${room}] بواسطة ${admin.username}`, admin.username);
        io.to(room).emit('systemAlert', settings.isChatLocked ? '🔒 تم قفل الشات العام مؤقتاً بقرار إداري.' : '🔓 تم فتح الشات العام للجميع.');
        break;
      }

      // تحديد وضع الدردشة البطيء (Set Slow Mode)
      case 'setSlowMode': {
        const room = admin.room && admin.room !== 'خارج الغرف' ? resolveCanonicalRoomId(admin.room) : '';
        if (!room) {
          socket.emit('systemAlert', 'يجب أن تكون متواجداً داخل غرفة أولاً لتنفيذ هذا الإجراء.');
          break;
        }
        const settings = getRoomSettings(room);
        settings.slowModeSeconds = Number(value) || 0;
        saveRoomSettings();
        io.to(room).emit('roomSettingsUpdated', { room, settings });
        logMonitorEvent('role', `تعديل وضع الدردشة البطيء في [${room}] إلى (${settings.slowModeSeconds} ثواني) بواسطة ${admin.username}`, admin.username);
        io.to(room).emit('systemAlert', settings.slowModeSeconds > 0 ? `⏱️ تم تفعيل وضع الدردشة البطيء (${settings.slowModeSeconds} ثواني بين الرسائل).` : '⏱️ تم إيقاف وضع الدردشة البطيء.');
        break;
      }

      // قفل أو فتح المايكات الصوتية للإدارة فقط (Lock Room Voice)
      case 'lockRoomVoice': {
        const room = admin.room && admin.room !== 'خارج الغرف' ? resolveCanonicalRoomId(admin.room) : '';
        if (!room) {
          socket.emit('systemAlert', 'يجب أن تكون متواجداً داخل غرفة أولاً لتنفيذ هذا الإجراء.');
          break;
        }
        const settings = getRoomSettings(room);
        settings.isVoiceLocked = Boolean(value);
        saveRoomSettings();
        io.to(room).emit('roomSettingsUpdated', { room, settings });
        logMonitorEvent('role', `${settings.isVoiceLocked ? 'قفل' : 'فتح'} المايكات الصوتية في [${room}] بواسطة ${admin.username}`, admin.username);
        io.to(room).emit('systemAlert', settings.isVoiceLocked ? '🎙️🔒 تم قفل مقاعد الصوت وحصرها على الإدارة فقط.' : '🎙️🔓 تم فتح مقاعد الصوت لجميع الأعضاء.');
        break;
      }

      // تفعيل أو إيقاف إشعار الرسائل المحذوفة للإداريين فقط (Show Deleted Notice for Admins)
      case 'toggleDeletedNotice': {
        const room = admin.room && admin.room !== 'خارج الغرف' ? resolveCanonicalRoomId(admin.room) : '';
        if (!room) {
          socket.emit('systemAlert', 'يجب أن تكون متواجداً داخل غرفة أولاً لتنفيذ هذا الإجراء.');
          break;
        }
        const settings = getRoomSettings(room);
        settings.showDeletedNotice = Boolean(value);
        saveRoomSettings();
        io.to(room).emit('roomSettingsUpdated', { room, settings });
        logMonitorEvent('role', `${settings.showDeletedNotice ? 'تفعيل' : 'إيقاف'} إشعار الرسائل المحذوفة للإداريين في [${room}] بواسطة ${admin.username}`, admin.username);
        io.to(room).emit('systemAlert', settings.showDeletedNotice ? '🗑️ تم تفعيل إظهار إشعار خفيف مكان الرسائل المحذوفة للإداريين فقط.' : '👻 تم إيقاف إشعار الرسائل المحذوفة (اختفاء تام).');
        break;
      }

      // مسح سجل محادثات الغرفة للجميع (Global Clear Chat for admin's current room only)
      case 'globalClearChat': {
        const room = admin.room && admin.room !== 'خارج الغرف' ? resolveCanonicalRoomId(admin.room) : '';
        if (!room) {
          socket.emit('systemAlert', 'يجب أن تكون متواجداً داخل غرفة أولاً لتنفيذ هذا الإجراء.');
          break;
        }
        for (let i = chatHistory.length - 1; i >= 0; i--) {
          if (chatHistory[i].room === room) {
            chatHistory.splice(i, 1);
          }
        }
        saveHistory();
        io.to(room).emit('chatHistory', []);
        io.to(room).emit('systemAlert', `🧹 قام المشرف ${admin.username} بمسح سجل محادثات غرفة [${room}] للجميع.`);
        logMonitorEvent('role', `مسح سجل محادثات الغرفة [${room}] بواسطة ${admin.username}`, admin.username);
        break;
      }

      // بث رسالة إدارية في الغرفة الحالية (Broadcast Message / Sticker Preview)
      case 'broadcastMessage': {
        const room = admin.room && admin.room !== 'خارج الغرف' ? resolveCanonicalRoomId(admin.room) : '';
        if (!room) {
          socket.emit('systemAlert', 'يجب أن تكون متواجداً داخل غرفة أولاً لتنفيذ هذا الإجراء.');
          break;
        }
        const cleanBroadcast = sanitizeText(value);
        if (!cleanBroadcast) break;
        const msgObj: StoredMessage = {
          id: `bcast-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
          room,
          username: admin.username,
          avatarUrl: admin.avatarUrl,
          nameBannerUrl: admin.nameBannerUrl,
          flag: admin.flag,
          badge: '📢 بث إداري',
          badgeColor: 'text-amber-400',
          text: expandShortcuts(cleanBroadcast),
          time: getCurrentTimeString(),
          timestamp: Date.now()
        };
        chatHistory.push(msgObj);
        pruneRoomChatHistory(room);
        saveHistory();
        io.to(room).emit('message', msgObj);
        break;
      }

      // سحب المتواجدين في كافة الغرف لغرفة المشرف (مع استثناء المسجونين والبوتات)
      case 'pullAllUsers': {
        const targetRoom = admin.room && admin.room !== 'خارج الغرف' ? resolveCanonicalRoomId(admin.room) : '';
        if (!targetRoom) {
          socket.emit('systemAlert', 'يجب أن تكون متواجداً داخل غرفة أولاً لتنفيذ هذا الإجراء.');
          break;
        }
        let movedCount = 0;
        [...users].forEach((u) => {
          if (u.isBot || u.isJailed || u.room === 'سجن حسان برو' || jailedUsernames.has(u.username.toLowerCase())) {
            return;
          }
          if (u.room !== targetRoom) {
            moveConnectedUserToRoom(u, targetRoom, {
              actorUsername: admin.username,
              announceRooms: true
            });
            movedCount++;
          }
        });
        logMonitorEvent('role', `قام ${admin.username} بسحب (${movedCount}) عضو إلى غرفة [${targetRoom}]`, admin.username);
        io.emit('systemAlert', `📢 قامت الإدارة بسحب الأعضاء المتواجدين إلى [${targetRoom}]!`);
        break;
      }

      // تعيين أو تغيير كلمة مرور الغرفة (Set Room Password)
      case 'setRoomPassword': {
        const adminRoomId = admin.room && admin.room !== 'خارج الغرف' ? resolveCanonicalRoomId(admin.room) : '';
        const room = adminRoomId ? findRoomDefinition(adminRoomId) : undefined;
        if (!room) {
          socket.emit('systemAlert', 'يجب أن تكون متواجداً داخل غرفة أولاً لتعديل كلمة مرورها.');
          break;
        }
        const pass = sanitizeText(value);
        if (pass) {
          room.isPasswordProtected = true;
          room.password = pass;
          broadcastRoomsUpdate();
          socket.emit('systemAlert', `تم تعيين كلمة مرور للغرفة [${room.name}]: ${pass}`);
        } else {
          room.isPasswordProtected = false;
          delete room.password;
          broadcastRoomsUpdate();
          socket.emit('systemAlert', `تمت إزالة كلمة المرور وأصبحت الغرفة [${room.name}] عامة ومفتوحة.`);
        }
        logMonitorEvent('role', `تعديل حماية وكلمة سر الغرفة [${room.name}] بواسطة ${admin.username}`, admin.username);
        break;
      }

      // إرسال تنبيه رسمي (Warn)
      case 'warn': {
        if (target) {
          const warnText = value || 'الرجاء الالتزام بقوانين حسان برو واحترام المتواجدين.';
          logMonitorEvent('warn', `إرسال تنبيه رسمي لـ ${target.username} بواسطة ${admin.username}`, admin.username, target.username);
          io.to(target.id).emit('officialWarning', { from: admin.username, text: warnText });
          socket.emit('systemAlert', `تم إرسال التنبيه الرسمي إلى ${target.username}.`);
        }
        break;
      }

      // حذف الصورة الشخصية (Delete Avatar - للأعضاء المتصلين وغير المتصلين)
      case 'deleteAvatar': {
        const uName = (targetUsername || target?.username || '').trim();
        if (target) {
          target.avatarUrl = undefined;
        }
        const regFound = getRegisteredMember(uName);
        if (regFound) {
          regFound.member.avatarUrl = undefined;
          saveMembers();
        }
        for (const sess of activeSessions.values()) {
          if (sess.user && sess.user.username.toLowerCase() === uName.toLowerCase()) {
            sess.user.avatarUrl = undefined;
          }
        }
        if (target) {
          broadcastRoomUsers(target.room);
          io.to(target.id).emit('systemAlert', `تم حذف صورتك الشخصية بواسطة الإدارة (${admin.username}) لمخالفتها الآداب العامة.`);
        }
        broadcastAllRegisteredMembers();
        io.emit('userStyleUpdated', { username: regFound?.key || uName, avatarUrl: undefined });
        logMonitorEvent('role', `حذف صورة ${uName} بواسطة [${admin.role.toUpperCase()}] ${admin.username}`, admin.username, uName);
        socket.emit('systemAlert', `تم حذف صورة ${uName} بنجاح.`);
        break;
      }

      // تعيين وتحديث صورة شخصية للعضو (Update Avatar)
      case 'updateAvatar': {
        const uName = (targetUsername || target?.username || '').trim();
        if (value && typeof value === 'string') {
          const safeAvatar = await ensureMediaUrlNotBase64(value);
          if (!safeAvatar) {
            socket.emit('systemAlert', 'رابط أو بيانات الصورة غير صالحة.');
            break;
          }
          if (target) {
            target.avatarUrl = safeAvatar;
          }
          const regFound = getRegisteredMember(uName);
          if (regFound) {
            regFound.member.avatarUrl = safeAvatar;
            saveMembers();
          }
          for (const sess of activeSessions.values()) {
            if (sess.user && sess.user.username.toLowerCase() === uName.toLowerCase()) {
              sess.user.avatarUrl = safeAvatar;
            }
          }
          if (target) {
            broadcastRoomUsers(target.room);
            io.to(target.id).emit('systemAlert', `تم تحديث صورتك الشخصية بواسطة الإدارة (${admin.username}).`);
          }
          broadcastAllRegisteredMembers();
          io.emit('userStyleUpdated', { username: regFound?.key || uName, avatarUrl: safeAvatar });
          logMonitorEvent('role', `تحديث صورة ${uName} بواسطة [${admin.role.toUpperCase()}] ${admin.username}`, admin.username, uName);
          socket.emit('systemAlert', `تم تحديث صورة ${uName} بنجاح.`);
        }
        break;
      }

      // تعديل اللايكات (Update Likes - للأعضاء المتصلين وغير المتصلين)
      case 'updateLikes': {
        const uName = (resolvedTargetName || cleanTargetUsername || target?.username || '').trim();
        const rawLks = Number(value);
        const lks = Number.isFinite(rawLks) ? Math.min(100000000, Math.max(0, Math.floor(rawLks))) : 0;
        if (target) {
          target.likes = lks;
        }
        const regFound = getRegisteredMember(uName);
        if (regFound) {
          regFound.member.likes = lks;
          saveMembers();
        }
        for (const sess of activeSessions.values()) {
          if (sess.user && sess.user.username.toLowerCase() === uName.toLowerCase()) {
            sess.user.likes = lks;
          }
        }
        if (target) {
          broadcastRoomUsers(target.room);
        }
        broadcastAllRegisteredMembers();
        logMonitorEvent('likes', `تعديل لايكات ${uName} إلى (${lks}) بواسطة ${admin.username}`, admin.username, uName);
        socket.emit('systemAlert', `تم تعديل لايكات ${uName} إلى ${lks}.`);
        break;
      }

      // تعديل الحالة (Update Quote - للأعضاء المتصلين وغير المتصلين)
      case 'updateQuote': {
        const uName = (targetUsername || target?.username || '').trim();
        const cleanQuote = sanitizeText(value) || '';
        if (target) {
          target.statusQuote = cleanQuote;
        }
        const regFound = getRegisteredMember(uName);
        if (regFound) {
          regFound.member.statusQuote = cleanQuote;
          saveMembers();
        }
        for (const sess of activeSessions.values()) {
          if (sess.user && sess.user.username.toLowerCase() === uName.toLowerCase()) {
            sess.user.statusQuote = cleanQuote;
          }
        }
        if (target) {
          broadcastRoomUsers(target.room);
        }
        broadcastAllRegisteredMembers();
        socket.emit('systemAlert', `تم تحديث حالة ${uName} بنجاح.`);
        break;
      }

      // تعديل الزخرفة واسم العرض (Update Display Name - مع بقاء الاسم الأصلي للدخول ثابتاً)
      case 'updateDisplayName': {
        if (typeof value === 'string') {
          const baseName = (targetUsername || target?.username || '').trim();
          const cleanDeco = sanitizeText(value.trim());
          const regFound = getRegisteredMember(baseName);
          const resolvedKey = regFound?.key || target?.username || baseName;
          const nextDeco = cleanDeco || resolvedKey;
          if (resolvedKey) {
            if (target) {
              target.displayName = nextDeco;
            }
            if (regFound) {
              regFound.member.displayName = nextDeco;
              saveMembers();
            }
            for (const sess of activeSessions.values()) {
              if (sess.user && sess.user.username.toLowerCase() === resolvedKey.toLowerCase()) {
                sess.user.displayName = nextDeco;
              }
            }
            persistActiveSessions();

            io.emit('userStyleUpdated', {
              username: resolvedKey,
              displayName: nextDeco
            });
            if (target) {
              broadcastRoomUsers(target.room);
              io.to(target.id).emit('profileUpdated', { user: target });
              io.to(target.id).emit('systemAlert', `تم تعديل زخرفتك إلى [${nextDeco}] بواسطة الإدارة (اسم الدخول الأصلي يبقى ${resolvedKey}).`);
            }
            broadcastAllUsers();
            io.emit('recentLoginsUpdated', getRecentLogins());
            logMonitorEvent('role', `تعديل زخرفة ${resolvedKey} إلى [${nextDeco}] بواسطة ${admin.username}`, admin.username, resolvedKey);
            socket.emit('systemAlert', `تم تعديل زخرفة ${resolvedKey} إلى [${nextDeco}] بنجاح.`);
          }
        }
        break;
      }

      // تعديل الاسم والزخرفة (Update Username)
      case 'updateUsername': {
        if (value && typeof value === 'string') {
          const oldName = (targetUsername || target?.username || '').trim();
          const newName = sanitizeText(value.trim());
          if (newName && newName.toLowerCase() !== oldName.toLowerCase()) {
            const lowerNew = newName.toLowerCase();
            if (lowerNew === 'admin' || lowerNew === 'hassan' || botEngine.isBotUsername(newName)) {
              socket.emit('systemAlert', 'لا يمكن استخدام اسم محجوز للنظام أو للبوتات.');
              break;
            }
            const conflictMember = getRegisteredMember(newName);
            if (conflictMember && conflictMember.key.toLowerCase() !== oldName.toLowerCase()) {
              socket.emit('systemAlert', `الاسم [${newName}] مسجل بالفعل لعضو آخر.`);
              break;
            }
            if (target) {
              target.username = newName;
            }
            const regFound = getRegisteredMember(oldName);
            if (regFound) {
              const data = regFound.member;
              if (!data.originalUsername) {
                data.originalUsername = regFound.key;
              }
              if (!data.registeredAt) {
                data.registeredAt = Date.now();
              }
              delete registeredMembers[regFound.key];
              registeredMembers[newName] = data;
              regMemberLowerKeyMap.delete(oldName.toLowerCase());
              regMemberLowerKeyMap.set(lowerNew, newName);
              saveMembers();
              rebuildAuditMapsFromMembers();
            }
            if (bannedUsers.has(oldName.toLowerCase())) {
              bannedUsers.delete(oldName.toLowerCase());
              bannedUsers.add(lowerNew);
              const banRec = bannedRecords.get(oldName.toLowerCase());
              if (banRec) {
                bannedRecords.delete(oldName.toLowerCase());
                banRec.username = newName;
                bannedRecords.set(lowerNew, banRec);
                saveBans();
              }
            }
            if (jailedUsernames.has(oldName.toLowerCase())) {
              jailedUsernames.delete(oldName.toLowerCase());
              jailedUsernames.add(lowerNew);
              const jailRec = jailedRecords.get(oldName.toLowerCase());
              if (jailRec) {
                jailedRecords.delete(oldName.toLowerCase());
                jailRec.username = newName;
                jailedRecords.set(lowerNew, jailRec);
                saveJailed();
              }
            }
            if (mutedUsers.has(oldName.toLowerCase())) {
              mutedUsers.delete(oldName.toLowerCase());
              mutedUsers.add(lowerNew);
              const muteRec = mutedRecords.get(oldName.toLowerCase());
              if (muteRec) {
                mutedRecords.delete(oldName.toLowerCase());
                muteRec.username = newName;
                mutedRecords.set(lowerNew, muteRec);
                saveMutes();
                emitToAuthorizedStaff('mutedListUpdated', Array.from(mutedRecords.values()), 'canMute');
              }
            }
            for (const sess of activeSessions.values()) {
              if (sess.user && sess.user.username.toLowerCase() === oldName.toLowerCase()) {
                sess.user.username = newName;
              }
            }
            if (usernameToSessionMap.has(oldName.toLowerCase())) {
              const tok = usernameToSessionMap.get(oldName.toLowerCase())!;
              usernameToSessionMap.delete(oldName.toLowerCase());
              usernameToSessionMap.set(lowerNew, tok);
            }
            persistActiveSessions();

            if (target) {
              broadcastRoomUsers(target.room);
              io.to(target.id).emit('systemAlert', `تم تعديل اسمك/زخرفتك إلى [${newName}] بواسطة الإدارة.`);
            }
            broadcastAllRegisteredMembers();
            logMonitorEvent('role', `تعديل اسم/زخرفة ${oldName} إلى [${newName}] بواسطة ${admin.username}`, admin.username, oldName);
            socket.emit('systemAlert', `تم تعديل اسم ${oldName} إلى ${newName} بنجاح.`);
          }
        }
        break;
      }

      // تغيير الرتبة والصلاحيات (Update Role - مع حماية هرمية الرتب ومنع التجاوز)
      case 'updateRole': {
        const uName = (targetUsername || target?.username || '').trim();
        const validRole = rolesConfig.find((r) => r.id === value) || (['admin', 'super', 'member', 'guest'].includes(value) ? { id: value, name: value } : null);
        if (validRole) {
          const roleId = validRole.id;
          const actorLevel = getRoleLevel(admin.role);
          const newRoleLevel = getRoleLevel(roleId);

          // Role hierarchy protection: Cannot grant a role equal to or higher than their own level (exempt for supreme 'hassan')
          if (!isSupremeHassan(admin) && newRoleLevel >= actorLevel) {
            socket.emit('systemAlert', 'لا يمكنك منح أو ترقية عضو إلى رتبة مساوية أو أعلى من رتبتك الحالية.');
            break;
          }

          if (target) {
            target.role = roleId;
          }
          const regFound = getRegisteredMember(uName);
          if (regFound) {
            regFound.member.role = roleId as any;
            saveMembers();
          }
          for (const sess of activeSessions.values()) {
            if (sess.user && sess.user.username.toLowerCase() === uName.toLowerCase()) {
              sess.user.role = roleId;
            }
          }
          persistActiveSessions();

          if (target) {
            broadcastRoomUsers(target.room);
            io.to(target.id).emit('userRoleUpdated', { role: roleId });
          }
          broadcastAllUsers();
          logMonitorEvent('role', `ترقية وتعيين رتبة ${uName} إلى [${validRole.name || roleId}] بواسطة ${admin.username}`, admin.username, uName);
          socket.emit('systemAlert', `تم تحديث رتبة ${uName} إلى [${validRole.name || roleId}] بنجاح.`);
        }
        break;
      }

      // تغيير كلمة مرور العضو بواسطة الإدارة عند النسيان (Change/Reset Member Password)
      case 'updatePassword': {
        const uName = (targetUsername || target?.username || '').trim();
        const newPassword = String(value || '').trim();
        if (!uName) {
          socket.emit('systemAlert', 'يرجى تحديد اسم العضو المراد تغيير كلمة مروره.');
          break;
        }
        if (!newPassword || newPassword.length < 3) {
          socket.emit('systemAlert', 'يجب أن تتكون كلمة المرور الجديدة من 3 أحرف أو أرقام على الأقل.');
          break;
        }
        const regFound = getRegisteredMember(uName);
        if (!regFound) {
          socket.emit('systemAlert', `العضو [${uName}] غير مسجل في قاعدة بيانات الأعضاء.`);
          break;
        }

        regFound.member.password = hashPassword(newPassword);
        saveMembers();

        // Revoke active sessions and disconnect connected sockets so new password takes effect immediately
        const targetSocketsToDrop: string[] = [];
        users.forEach((u) => {
          if (u.username.toLowerCase() === regFound.key.toLowerCase()) {
            targetSocketsToDrop.push(u.id);
          }
        });
        for (const sess of activeSessions.values()) {
          if (sess.user?.username?.toLowerCase() === regFound.key.toLowerCase() && sess.currentSocketId) {
            if (!targetSocketsToDrop.includes(sess.currentSocketId)) {
              targetSocketsToDrop.push(sess.currentSocketId);
            }
          }
        }
        revokeUserSessionTokens({
          username: regFound.key,
          bumpVersion: true
        });
        targetSocketsToDrop.forEach((sid) => {
          io.to(sid).emit('sessionRestoreFailed', {
            reason: `🔑 قامت الإدارة (${admin.username}) بتحديث كلمة مرور حسابك. يرجى تسجيل الدخول مجدداً بكلمة المرور الجديدة.`
          });
          const sObj = io.sockets.sockets.get(sid);
          if (sObj) {
            try {
              sObj.disconnect(true);
            } catch {}
          }
        });

        broadcastAllRegisteredMembers();
        logMonitorEvent('role', `قام ${admin.username} بتغيير وتعيين كلمة مرور جديدة لحساب [${regFound.key}]`, admin.username, regFound.key);
        socket.emit('systemAlert', `✅ تم تحديث كلمة مرور العضو [${regFound.key}] بنجاح وإبطال الجلسات السابقة.`);
        break;
      }

      // نقل العضو لغرفة أخرى
      case 'moveRoom': {
        if (target && value) {
          const destRoom = resolveCanonicalRoomId(String(value));
          if (!destRoom || destRoom === 'خارج الغرف') {
            socket.emit('systemAlert', 'الغرفة المستهدفة غير موجودة.');
            break;
          }
          moveConnectedUserToRoom(target, destRoom, {
            actorUsername: admin.username,
            announceRooms: true
          });
          logMonitorEvent('role', `نقل ${target.username} إلى غرفة [${destRoom}] بواسطة ${admin.username}`, admin.username, target.username);
          socket.emit('systemAlert', `تم نقل ${target.username} إلى ${destRoom}.`);
        }
        break;
      }

      // سجن واحتجاز العضو (Jail User - محكم وشامل للمتصل وغير المتصل)
      case 'jailUser': {
        const uName = (targetUsername || target?.username || '').trim();
        if (!uName) break;
        const jailReason = reason || value || 'مخالفة قوانين وقواعد شات حسان برو';

        const regJailFound = getRegisteredMember(uName);
        let targetIp = target?.ipAddress || regJailFound?.member.ipAddress;

        jailedUsernames.add(uName.toLowerCase());
        if (targetIp && isBannableIp(targetIp)) jailedIps.add(targetIp);
        jailedRecords.set(uName.toLowerCase(), {
          username: uName,
          ip: targetIp,
          reason: jailReason,
          jailedBy: admin.username,
          timestamp: Date.now()
        });
        saveJailed();

        if (regJailFound) {
          regJailFound.member.isJailed = true;
          saveMembers();
        }

        if (target) {
          target.isTextMuted = true;
          target.isMuted = true;
          target.isVoiceMutedByAdmin = true;
          target.isJailed = true;
          cleanupUserLiveState(target.id);
          moveConnectedUserToRoom(target, 'سجن حسان برو', {
            actorUsername: admin.username,
            announceRooms: true,
            customOldRoomText: `تم إيداع ونقل ${target.username} إلى [سجن حسان برو] بواسطة الإدارة 🚔`,
            customNewRoomText: `تم إيداع ${target.username} في سجن حسان برو بواسطة الإدارة 🚔`
          });
          io.to(target.id).emit('systemAlert', `🚔 تم إيداعك في غرفة السجن والتأديب بقرار من الإدارة (${admin.username}). السبب: ${jailReason}. لا يمكنك مغادرة السجن.`);
        }

        broadcastAllRegisteredMembers();
        io.emit('roomStatsUpdated', getRoomStatistics());
        logMonitorEvent('jail', `إيداع ${uName} في السجن بواسطة [${admin.role.toUpperCase()}] ${admin.username} (السبب: ${jailReason})`, admin.username, uName);
        socket.emit('systemAlert', `تم إيداع ${uName} في السجن وتثبيت حبسه بنجاح 🚔.`);
        break;
      }

      // فك السجن والإفراج عن العضو (Unjail User - للمتصل وغير المتصل)
      case 'unjailUser': {
        const uName = (targetUsername || target?.username || '').trim();
        if (!uName) break;

        const rec = jailedRecords.get(uName.toLowerCase());
        if (rec?.ip) jailedIps.delete(rec.ip);
        jailedUsernames.delete(uName.toLowerCase());
        jailedRecords.delete(uName.toLowerCase());
        saveJailed();

        const regFound = getRegisteredMember(uName);
        if (regFound) {
          regFound.member.isJailed = false;
          saveMembers();
        }

        for (const sess of activeSessions.values()) {
          if (sess.user && sess.user.username.toLowerCase() === uName.toLowerCase()) {
            const postJailMute = findActiveMuteMatch(sess.user.username, sess.user.ipAddress, sess.user.deviceFingerprint);
            sess.user.isJailed = false;
            sess.user.isTextMuted = postJailMute.muteText;
            sess.user.isVoiceMutedByAdmin = postJailMute.muteVoice;
            sess.user.isMuted = postJailMute.isMuted;
            if (sess.user.room === 'سجن حسان برو') {
              sess.user.room = 'الغرفة العامة';
            }
          }
        }
        persistActiveSessions();

        if (target) {
          const postJailTargetMute = findActiveMuteMatch(target.username, target.ipAddress, target.deviceFingerprint);
          target.isTextMuted = postJailTargetMute.muteText;
          target.isVoiceMutedByAdmin = postJailTargetMute.muteVoice;
          target.isMuted = postJailTargetMute.isMuted;
          target.isJailed = false;
          moveConnectedUserToRoom(target, 'الغرفة العامة', {
            actorUsername: admin.username,
            announceRooms: true,
            customOldRoomText: `تم الإفراج عن ${target.username} ونقله إلى [الغرفة العامة] 🕊️`,
            customNewRoomText: `تم الإفراج عن ${target.username} وعاد إلى الغرفة العامة أهلاً وسهلاً 🕊️`
          });
          io.to(target.id).emit('systemAlert', `🕊️ تم الإفراج عنك ورفع الحبس بواسطة الإدارة (${admin.username}). أهلاً بك مجدداً في الغرفة العامة.`);
        }

        broadcastAllRegisteredMembers();
        io.emit('roomStatsUpdated', getRoomStatistics());
        logMonitorEvent('jail', `الإفراج عن ${uName} من السجن بواسطة ${admin.username}`, admin.username, uName);
        socket.emit('systemAlert', `تم الإفراج عن ${uName} ونقله للغرفة العامة بنجاح 🕊️.`);
        break;
      }

      // حذف عضوية بالكامل من السيرفر (Delete Account - Admin Only)
      case 'deleteAccount': {
        const uName = (targetUsername || target?.username || '').trim();
        if (botEngine.isBotUsername(uName)) {
          socket.emit('systemAlert', 'لا يمكن حذف البوت من هنا؛ يمكن للأدمن إيقاف البوت أو حذفه من قسم إدارة البوتات.');
          break;
        }
        const regFound = getRegisteredMember(uName);
        if (regFound) {
          delete registeredMembers[regFound.key];
          regMemberLowerKeyMap.delete(regFound.key.toLowerCase());
          saveMembers();
        }

        // Purge active sessions
        for (const [sTok, sObj] of activeSessions.entries()) {
          if (sObj.user?.username?.toLowerCase() === uName.toLowerCase()) {
            activeSessions.delete(sTok);
          }
        }
        usernameToSessionMap.delete(uName.toLowerCase());
        persistActiveSessions();

        if (target) {
          io.to(target.id).emit('kickedByAdmin', { reason: 'تم حذف عضويتك وحسابك بالكامل بقرار إداري.', by: admin.username });
          const targetSock = io.sockets.sockets.get(target.id);
          if (targetSock) {
            try {
              targetSock.leave(target.room);
              targetSock.disconnect(true);
            } catch {}
          }
          const tIdx = users.findIndex((u) => u.id === target.id);
          if (tIdx !== -1) users.splice(tIdx, 1);
          broadcastRoomUsers(target.room);
        }
        broadcastAllUsers();
        logMonitorEvent('role', `حذف حساب وعضوية [${regFound?.key || uName}] نهائياً بواسطة ${admin.username}`, admin.username, regFound?.key || uName);
        socket.emit('systemAlert', `تم حذف حساب وعضوية [${regFound?.key || uName}] نهائياً.`);
        break;
      }

      // تغيير الزخرفة المخالفة واستبدالها باسم عرض لائق مع بقاء الاسم الأصلي للدخول ثابتاً
      case 'resetName': {
        const oldName = (targetUsername || target?.username || '').trim();
        const cleanCustom = sanitizeText(value?.trim());
        const regFound = getRegisteredMember(oldName);
        const resolvedKey = regFound?.key || target?.username || oldName;
        const newDisplayName = cleanCustom || `عضو_محترم_${Math.floor(100 + Math.random() * 900)}`;
        if (target) {
          target.displayName = newDisplayName;
        }
        if (regFound) {
          regFound.member.displayName = newDisplayName;
          saveMembers();
        }
        for (const sess of activeSessions.values()) {
          if (sess.user && sess.user.username.toLowerCase() === resolvedKey.toLowerCase()) {
            sess.user.displayName = newDisplayName;
          }
        }
        persistActiveSessions();

        io.emit('userStyleUpdated', {
          username: resolvedKey,
          displayName: newDisplayName
        });
        if (target) {
          broadcastRoomUsers(target.room);
          io.to(target.id).emit('profileUpdated', { user: target });
          io.to(target.id).emit('systemAlert', `تم تعديل اسم الزخرفة المخالف إلى [${newDisplayName}] بواسطة إدارة الشات (اسم الدخول الأصلي يبقى ${resolvedKey}).`);
        }
        broadcastAllUsers();
        io.emit('recentLoginsUpdated', getRecentLogins());
        logMonitorEvent('role', `تعديل زخرفة ${resolvedKey} إلى [${newDisplayName}] بواسطة ${admin.username}`, admin.username, resolvedKey);
        socket.emit('systemAlert', `تم تعديل زخرفة ${resolvedKey} إلى [${newDisplayName}] بنجاح.`);
        break;
      }

      // منح وسام ولقب شرفي (Assign Honor Badge - للمتصل وغير المتصل)
      case 'assignHonorBadge': {
        const uName = (targetUsername || target?.username || '').trim();
        const badgeText = value ? sanitizeText(String(value).trim()) : undefined;
        if (target) {
          target.honorBadge = badgeText;
        }
        const regFound = getRegisteredMember(uName);
        if (regFound) {
          regFound.member.honorBadge = badgeText;
          saveMembers();
        }
        for (const sess of activeSessions.values()) {
          if (sess.user && sess.user.username.toLowerCase() === uName.toLowerCase()) {
            sess.user.honorBadge = badgeText;
          }
        }
        persistActiveSessions();

        if (target) {
          broadcastRoomUsers(target.room);
          io.to(target.id).emit('systemAlert', badgeText ? `🎉 تم منحك وساماً شرفياً جديداً من الإدارة: ${badgeText}` : 'تمت إزالة الوسام الشرفي.');
        }
        broadcastAllRegisteredMembers();
        logMonitorEvent('role', `منح/تعديل الوسام الشرفي لـ ${uName} [${badgeText || 'إزالة'}] بواسطة ${admin.username}`, admin.username, uName);
        socket.emit('systemAlert', `تم تحديث الوسام الشرفي لـ ${uName} بنجاح.`);
        break;
      }


      // إطلاق صافرة الإنذار الإداري العاجل (Admin Siren)
      case 'adminSiren': {
        const sirenText = sanitizeText(value) || '🚨 صفارة إنذار وتنبيه عام من إدارة حسان برو! الرجاء الانتباه والالتزام بالقوانين.';
        io.emit('adminSirenAlert', { from: admin.username, message: sirenText, timestamp: Date.now() });
        logMonitorEvent('siren', `إطلاق صافرة الإنذار الإداري بواسطة ${admin.username}: "${sirenText}"`, admin.username);
        socket.emit('systemAlert', 'تم إطلاق صافرة الإنذار والتنبيه الإداري لجميع المتواجدين!');
        break;
      }

      // إنشاء غرفة جديدة من لوحة التحكم (Create Room - Admin Only)
      case 'createRoom': {
        if (value && typeof value === 'object') {
          const { name, desc, password, voiceLimit, bannerUrl } = value;
          const cleanName = sanitizeText(name);
          if (!cleanName) break;
          if (chatRooms.some((r) => r.id.toLowerCase() === cleanName.toLowerCase() || r.name.toLowerCase() === cleanName.toLowerCase())) {
            socket.emit('systemAlert', `توجد غرفة بنفس الاسم [${cleanName}] بالفعل.`);
            break;
          }
          const hasBannerPerm =
            isSupremeHassan(admin) ||
            admin.role === 'admin' ||
            getRoleLevel(admin.role) >= getRoleLevel('admin') ||
            hasPermission(admin.role, 'canEditRoomBanner') ||
            hasPermission(admin.role, 'canChangeRoomSettings');

          let safeBannerUrl: string | undefined;
          if (bannerUrl && String(bannerUrl).trim()) {
            if (!hasBannerPerm) {
              socket.emit('systemAlert', 'ليس لديك صلاحية تعيين بنر للغرفة 🔒');
            } else {
              safeBannerUrl = await ensureMediaUrlNotBase64(String(bannerUrl).trim());
            }
          }
          const clampedVoiceLimit = Math.max(1, Math.min(5, Math.round(Number(voiceLimit) || 5)));
          const newRoom: ChatRoom = {
            id: cleanName,
            name: `Room | ${cleanName}`,
            desc: sanitizeText(desc) || 'غرفة جديدة في حسان برو',
            isPasswordProtected: Boolean(password),
            password: password ? sanitizeText(password) : undefined,
            bannerUrl: safeBannerUrl || undefined,
            voiceLimit: clampedVoiceLimit,
            activeVoiceCount: 0
          };
          chatRooms.push(newRoom);
          saveChatRooms();
          broadcastRoomsUpdate();
          logMonitorEvent('room', `أنشأ [${admin.username}] غرفة جديدة [${cleanName}]`, admin.username);
          socket.emit('systemAlert', `تم إنشاء غرفة [${cleanName}] بنجاح!`);
        }
        break;
      }

      // تعديل بيانات الغرفة (Edit Room - Admin Only)
      case 'editRoom': {
        if (value && typeof value === 'object') {
          const { roomId, name, desc, password, voiceLimit, bannerUrl } = value;
          const room = findRoomDefinition(roomId);
          if (room) {
            if (name) room.name = sanitizeText(name);
            if (desc !== undefined) room.desc = sanitizeText(desc);
            if (voiceLimit !== undefined) {
              const parsedLimit = Number(voiceLimit);
              if (Number.isFinite(parsedLimit) && parsedLimit >= 1) {
                room.voiceLimit = Math.max(1, Math.min(5, Math.round(parsedLimit)));
              }
            }
            if (password !== undefined) {
              if (password) {
                room.isPasswordProtected = true;
                room.password = sanitizeText(password);
              } else {
                room.isPasswordProtected = false;
                delete room.password;
              }
            }
            if (bannerUrl !== undefined) {
              const hasBannerPerm =
                isSupremeHassan(admin) ||
                admin.role === 'admin' ||
                getRoleLevel(admin.role) >= getRoleLevel('admin') ||
                hasPermission(admin.role, 'canEditRoomBanner') ||
                hasPermission(admin.role, 'canChangeRoomSettings');
              if (!hasBannerPerm) {
                socket.emit('systemAlert', 'ليس لديك صلاحية تغيير بنر الغرفة 🔒');
              } else {
                const cleanBanner = String(bannerUrl || '').trim();
                if (!cleanBanner) {
                  delete room.bannerUrl;
                } else {
                  const safeBanner = await ensureMediaUrlNotBase64(cleanBanner);
                  if (safeBanner) {
                    room.bannerUrl = safeBanner;
                  } else {
                    socket.emit('systemAlert', 'رابط أو صيغة بنر الغرفة غير صالحة.');
                  }
                }
              }
            }
            broadcastRoomsUpdate();
            saveChatRooms();
            logMonitorEvent('room', `تعديل إعدادات وبيانات الغرفة [${room.id}] بواسطة ${admin.username}`, admin.username);
            socket.emit('systemAlert', `تم تعديل بيانات وإعدادات الغرفة [${room.id}] بنجاح.`);
          }
        }
        break;
      }

      // حذف الغرفة ونقل الأعضاء للغرفة العامة (Delete Room - Admin Only)
      case 'deleteRoom': {
        const roomId = sanitizeText(value);
        if (roomId === 'الغرفة العامة' || roomId === 'سجن حسان برو') {
          socket.emit('systemAlert', 'لا يمكن حذف الغرف الأساسية للنظام.');
          break;
        }
        const idx = chatRooms.findIndex((r) => r.id === roomId);
        if (idx !== -1) {
          const roomUsersSnapshot = users.filter((u) => !u.isBot && u.room === roomId);
          roomUsersSnapshot.forEach((u) => {
            moveConnectedUserToRoom(u, 'الغرفة العامة', {
              actorUsername: admin.username,
              announceRooms: true
            });
          });
          chatRooms.splice(idx, 1);
          delete roomMicSlots[roomId];
          delete roomSettingsMap[roomId];
          delete roomPinnedMessages[roomId];
          activeLiveBroadcasts.delete(roomId);
          const pendingTimer = pendingRoomBroadcastTimers.get(roomId);
          if (pendingTimer) {
            clearTimeout(pendingTimer);
            pendingRoomBroadcastTimers.delete(roomId);
          }
          let historyRemoved = false;
          for (let i = chatHistory.length - 1; i >= 0; i--) {
            if (chatHistory[i].room === roomId) {
              chatHistory.splice(i, 1);
              historyRemoved = true;
            }
          }
          if (historyRemoved) saveHistory();
          botEngine.onRoomDeleted(roomId);
          saveRoomSettings();
          saveChatRooms();
          broadcastRoomsUpdate();
          chatRooms.forEach((r) => {
            broadcastRoomUsers(r.id);
          });
          logMonitorEvent('room', `حذف الغرفة [${roomId}] ونقل روادها إلى الغرفة العامة بواسطة ${admin.username}`, admin.username);
          socket.emit('systemAlert', `تم حذف الغرفة [${roomId}] بنجاح.`);
        }
        break;
      }

      // كشف النكات والآي بي والعضويات عند استدعائها من لوحة التحكم الإدارية
      case 'revealNicks': {
        const uName = (targetUsername || target?.username || '').trim();
        if (uName) {
          executeRevealNicks(admin, uName);
        }
        break;
      }
    }
  });

  // User Profile Settings Updates (حفظ وتعديل الملف الشخصي واستدامته - الاسم الأصلي لا يتغير، يتم تعديل الزخرفة فقط)
  socket.on(
    'updateProfile',
    async ({
      username,
      displayName,
      statusQuote,
      avatarUrl,
      nameBannerUrl,
      password,
      currentPassword,
      flag,
      nameColor,
      textColor,
      isPmDisabled
    }: {
      username?: string;
      displayName?: string;
      statusQuote?: string;
      avatarUrl?: string;
      nameBannerUrl?: string;
      password?: string;
      currentPassword?: string;
      flag?: string;
      nameColor?: string;
      textColor?: string;
      isPmDisabled?: boolean;
    }) => {
      const user = users.find((u) => u.id === socket.id);
      if (!user) return;

      // IMPORTANT: Original registered username (`user.username`) NEVER changes from Settings.
      // Any name edited inside Settings (`الزخرفة واسم العرض`) updates `displayName` only!
      const incomingDecoration = displayName !== undefined ? displayName : username;
      if (incomingDecoration !== undefined) {
        const cleanDecoration = sanitizeText(String(incomingDecoration).trim()).slice(0, 40);
        const nextDisplayName = cleanDecoration || user.username;
        user.displayName = nextDisplayName;
        if (user.sessionToken && activeSessions.has(user.sessionToken)) {
          const sess = activeSessions.get(user.sessionToken)!;
          sess.user.displayName = nextDisplayName;
        }
      }

      // العلم الحقيقي مشفر تلقائيًا عند الدخول ومقفل لمنع اختيار أعلام وهمية
      // user.flag is preserved from real country IP detection
      if (statusQuote !== undefined) user.statusQuote = sanitizeText(statusQuote).slice(0, 150);
      if (avatarUrl !== undefined) {
        if (avatarUrl === '') {
          user.avatarUrl = undefined;
        } else {
          const cleanAvatar = await ensureMediaUrlNotBase64(avatarUrl);
          if (cleanAvatar) user.avatarUrl = cleanAvatar;
        }
      }
      if (nameBannerUrl !== undefined && (isSupremeHassan(user) || user.role === 'admin' || user.role === 'super' || hasPermission(user.role, 'canAssignBanner') || getRoleLevel(user.role) >= 75)) {
        if (nameBannerUrl === '') {
          user.nameBannerUrl = undefined;
        } else {
          const cleanBanner = await ensureMediaUrlNotBase64(nameBannerUrl);
          if (cleanBanner) user.nameBannerUrl = cleanBanner;
        }
      }
      if (nameColor !== undefined) {
        const safeNC = sanitizeCssColor(nameColor);
        if (safeNC !== undefined) user.nameColor = safeNC || undefined;
      }
      if (textColor !== undefined) {
        const safeTC = sanitizeCssColor(textColor);
        if (safeTC !== undefined) user.textColor = safeTC || undefined;
      }
      if (isPmDisabled !== undefined) user.isPmDisabled = Boolean(isPmDisabled);

      // Update registered members persistent store without permitting guest -> member self-promotion
      const currentRegFound = getRegisteredMember(user.username);
      if (currentRegFound) {
        if (password !== undefined) {
          const trimmedPw = String(password).trim();
          if (currentRegFound.member.role === 'guest') {
            socket.emit('systemAlert', 'الزوار لا يملكون كلمة مرور.');
          } else if (trimmedPw.length < 3 || trimmedPw.length > 128) {
            socket.emit('systemAlert', 'يجب أن تتراوح كلمة المرور بين 3 و 128 حرفاً.');
          } else if (
            currentPassword !== undefined &&
            currentRegFound.member.password &&
            !verifyPassword(String(currentPassword).trim(), currentRegFound.member.password)
          ) {
            socket.emit('systemAlert', 'كلمة المرور الحالية غير صحيحة.');
          } else if (!checkHttpRateLimit('pwChange', user.username.toLowerCase(), 3, 10 * 60_000)) {
            socket.emit('systemAlert', '⏳ تم تغيير كلمة المرور عدة مرات مؤخراً، يرجى الانتظار قليلاً.');
          } else {
            currentRegFound.member.password = hashPassword(trimmedPw);
            const oldToken = user.sessionToken;
            const nextVer = bumpMemberTokenVersion(user.username);
            const refreshedToken = signSessionToken(user.username, nextVer);
            user.sessionToken = refreshedToken;
            revokeUserSessionTokens({
              sessionToken: oldToken,
              username: user.username,
              bumpVersion: false,
              excludeToken: refreshedToken
            });
            activeSessions.set(refreshedToken, {
              sessionToken: refreshedToken,
              user,
              currentSocketId: socket.id,
              lastActiveTime: Date.now(),
              isExplicitlyLoggedOut: false,
              tokenVersion: nextVer
            });
            usernameToSessionMap.set(user.username.toLowerCase(), refreshedToken);
            socket.emit('sessionTokenRefreshed', { sessionToken: refreshedToken });
            logMonitorEvent('security', `قام العضو [${user.username}] بتحديث كلمة المرور الخاصة بحسابه.`, user.username);
          }
        }
        if (incomingDecoration !== undefined) {
          currentRegFound.member.displayName = user.displayName || user.username;
        }
        currentRegFound.member.statusQuote = user.statusQuote;
        if (avatarUrl !== undefined) currentRegFound.member.avatarUrl = user.avatarUrl;
        if (nameBannerUrl !== undefined) currentRegFound.member.nameBannerUrl = user.nameBannerUrl;
        if (isPmDisabled !== undefined) currentRegFound.member.isPmDisabled = Boolean(isPmDisabled);
        if (user.flag) currentRegFound.member.flag = user.flag;
        if (nameColor !== undefined && user.nameColor !== undefined) (currentRegFound.member as any).nameColor = user.nameColor;
        if (textColor !== undefined && user.textColor !== undefined) (currentRegFound.member as any).textColor = user.textColor;
      }
      saveMembers();
      persistActiveSessions();
      if (statusQuote !== undefined || incomingDecoration !== undefined) {
        io.emit('recentLoginsUpdated', getRecentLogins());
      }

      io.emit('userStyleUpdated', {
        username: user.username,
        displayName: user.displayName || user.username,
        statusQuote: user.statusQuote,
        avatarUrl: user.avatarUrl,
        avatarFrame: user.avatarFrame,
        nameBannerUrl: user.nameBannerUrl,
        nameColor: user.nameColor,
        textColor: user.textColor,
        nameGradient: user.nameGradient,
        profileBg: user.profileBg,
        memberBg: user.memberBg,
        isPmDisabled: user.isPmDisabled
      });
      broadcastAllRegisteredMembers();

      // Broadcast update to all rooms and users
      chatRooms.forEach((r) => {
        broadcastRoomUsers(r.id);
      });
      broadcastAllUsers();
      socket.emit('profileUpdated', { user });
      socket.emit('systemAlert', 'تم حفظ وتحديث بيانات ملفك الشخصي وزخرفتك بنجاح ✅');
    }
  );

  // Wall posts with incremental Delta Sync (يُرسل التغييرات الجديدة فقط عند وجود نسخة مخزنة عند المستخدم)
  socket.on(
    'getWallPosts',
    (payload?: { version?: string; since?: number; knownIds?: string[] }) => {
      const currentVersion = getWallVersionString();
      if (payload && typeof payload === 'object') {
        if (payload.version && payload.version === currentVersion) {
          socket.emit('wallPostsDelta', { unchanged: true, version: currentVersion });
          return;
        }
        if (typeof payload.since === 'number' && Array.isArray(payload.knownIds)) {
          const knownSet = new Set(payload.knownIds);
          const currentSet = new Set(wallPosts.map((p) => p.id));
          const changedPosts = wallPosts
            .filter((p) => !knownSet.has(p.id) || (p.updatedAt || p.timestamp || 0) > payload.since!)
            .map(serializeWallPostForClient);
          const deletedIds = payload.knownIds.filter((id) => !currentSet.has(id));
          if (changedPosts.length + deletedIds.length <= Math.max(15, wallPosts.length * 0.6)) {
            socket.emit('wallPostsDelta', {
              unchanged: false,
              delta: true,
              version: currentVersion,
              changedPosts,
              deletedIds
            });
            return;
          }
        }
      }
      socket.emit('wallPosts', {
        posts: wallPosts.map(serializeWallPostForClient),
        version: currentVersion
      });
    }
  );

  socket.on(
    'newWallPost',
    async (
      {
        text,
        mediaUrl,
        mediaType,
        audioDuration,
        category,
        youtubeVideo,
        clientTempId,
        shortcutsExpanded
      }: {
        text: string;
        mediaUrl?: string;
        mediaType?: 'image' | 'video' | 'audio';
        audioDuration?: number;
        category?: 'posts' | 'quick';
        youtubeVideo?: {
          id: string;
          title: string;
          thumbnail?: string;
          channelTitle?: string;
          duration?: string;
          url?: string;
        };
        clientTempId?: string;
        shortcutsExpanded?: boolean;
      },
      ack?: (res: { ok: boolean; id?: string; clientTempId?: string; error?: string }) => void
    ) => {
      const reject = (errMsg: string) => {
        socket.emit('systemAlert', errMsg);
        if (typeof ack === 'function') ack({ ok: false, clientTempId, error: errMsg });
      };

      const user = users.find((u) => u.id === socket.id);
      const cleanWallInput = sanitizeText(text).slice(0, 6000);
      let resolvedYoutubeVideo: WallPost['youtubeVideo'] = undefined;
      if (youtubeVideo && typeof youtubeVideo === 'object') {
        const rawYtId = sanitizeText(String(youtubeVideo.id || '')).trim();
        if (/^[a-zA-Z0-9_-]{6,20}$/.test(rawYtId)) {
          resolvedYoutubeVideo = {
            id: rawYtId,
            title: sanitizeText(String(youtubeVideo.title || 'فيديو يوتيوب')).slice(0, 200) || 'فيديو يوتيوب',
            thumbnail: sanitizeUrl(youtubeVideo.thumbnail) || `https://img.youtube.com/vi/${rawYtId}/hqdefault.jpg`,
            channelTitle: sanitizeText(String(youtubeVideo.channelTitle || 'YouTube')).slice(0, 100) || 'YouTube',
            ...(youtubeVideo.duration ? { duration: sanitizeText(String(youtubeVideo.duration)).slice(0, 24) } : {}),
            url: sanitizeUrl(youtubeVideo.url) || `https://www.youtube.com/watch?v=${rawYtId}`
          };
        }
      }
      if (!resolvedYoutubeVideo && cleanWallInput) {
        const extractedId = extractYouTubeVideoId(cleanWallInput);
        if (extractedId) {
          resolvedYoutubeVideo = {
            id: extractedId,
            title: 'فيديو يوتيوب',
            thumbnail: `https://img.youtube.com/vi/${extractedId}/hqdefault.jpg`,
            channelTitle: 'YouTube',
            url: `https://www.youtube.com/watch?v=${extractedId}`
          };
        }
      }

      if (!user || (!cleanWallInput && !mediaUrl && !resolvedYoutubeVideo)) {
        if (typeof ack === 'function') ack({ ok: false, clientTempId, error: 'تعذر نشر المنشور.' });
        return;
      }

      if (clientTempId) {
        const dedupKey = `wall:${user.username.toLowerCase()}:${clientTempId}`;
        const existing = recentClientTempIds.get(dedupKey);
        if (existing) {
          if (typeof ack === 'function') ack({ ok: true, id: existing.id, clientTempId });
          return;
        }
      }

      if (user.isJailed || user.isTextMuted) {
        reject('أنت خاضع للإسكات أو التقييد الإداري حالياً ولا يمكنك النشر في الحائط.');
        return;
      }
      if (!isSupremeHassan(user) && user.role !== 'admin' && user.role !== 'super' && !hasPermission(user.role, 'canPostWall')) {
        reject('عفواً، صلاحية النشر في الحائط غير متاحة لرتبتك الحالية.');
        return;
      }

      if (!isSupremeHassan(user) && user.role !== 'admin' && user.role !== 'super') {
        if ((mediaUrl || resolvedYoutubeVideo) && likesSettings.wallMediaLikes > 0 && user.likes < likesSettings.wallMediaLikes) {
          reject(`عفواً، يتطلب نشر وسائط في الحائط ${likesSettings.wallMediaLikes} لايك على الأقل. رصيدك الحالي: ${user.likes} 👍`);
          return;
        }
        if (!mediaUrl && !resolvedYoutubeVideo && cleanWallInput && likesSettings.wallTextLikes > 0 && user.likes < likesSettings.wallTextLikes) {
          reject(`عفواً، يتطلب النشر في الحائط ${likesSettings.wallTextLikes} لايك على الأقل. رصيدك الحالي: ${user.likes} 👍`);
          return;
        }
      }

      if (cleanWallInput && serverSecurity.blockExternalLinks && !isSupremeHassan(user) && user.role !== 'admin' && user.role !== 'super') {
        const nonYtText = resolvedYoutubeVideo ? cleanWallInput.replace(/https?:\/\/(?:www\.|m\.)?(?:youtube\.com|youtu\.be)\S*/gi, '') : cleanWallInput;
        if (/(https?:\/\/|www\.|\.com|\.net|\.org|\.xyz|\.app|\.me|\.online|t\.me|wa\.me)/i.test(nonYtText)) {
          logMonitorEvent('security', `محاولة نشر رابط محظور بالحائط من [${user.username}]`, user.username);
          reject('⚠️ نشر الروابط والإعلانات الخارجية ممنوع منعاً باتاً في شات حسان برو.');
          return;
        }
      }

      let cleanMediaUrl = mediaUrl;
      let cleanMediaType: 'image' | 'video' | 'audio' = mediaType && ['image', 'video', 'audio'].includes(mediaType) ? mediaType : 'image';

      // If client provided a base64 Data URI, convert and route through Storage Layer
      if (cleanMediaUrl && cleanMediaUrl.startsWith('data:')) {
        try {
          if (cleanMediaUrl.length > 70 * 1024 * 1024) {
            reject('حجم الملف يتجاوز 50 ميجابايت.');
            return;
          }
          const matches = cleanMediaUrl.match(/^data:([A-Za-z0-9-+\/;=]+);base64,(.+)$/);
          let buffer: Buffer;
          let mime = 'image/jpeg';
          let ext = 'jpg';
          if (matches && matches.length === 3) {
            mime = matches[1].toLowerCase();
            if (mime.includes('svg') || mime.includes('html') || mime.includes('javascript') || mime.includes('xml')) {
              reject('عفواً، صيغة الملف غير مدعومة لأسباب أمنية.');
              return;
            }
            if (mime.startsWith('audio/')) {
              if (mime.includes('mpeg') || mime.includes('mp3')) ext = 'mp3';
              else if (mime.includes('ogg') || mime.includes('opus')) ext = 'ogg';
              else if (mime.includes('wav')) ext = 'wav';
              else if (mime.includes('mp4') || mime.includes('m4a') || mime.includes('aac')) ext = 'm4a';
              else ext = 'webm';
            } else if (mime.includes('mp4')) ext = 'mp4';
            else if (mime.includes('webm')) ext = 'webm';
            else if (mime.includes('mov') || mime.includes('quicktime')) ext = 'mov';
            else if (mime.includes('png')) ext = 'png';
            else if (mime.includes('webp')) ext = 'webp';
            else if (mime.includes('gif')) ext = 'gif';
            buffer = Buffer.from(matches[2], 'base64');
            if (buffer.length > 50 * 1024 * 1024 || !validateMediaMagicBytes(buffer, ext)) {
              reject('عفواً، محتوى الملف لا يتطابق مع صيغة وسائط صالحة.');
              return;
            }
          } else {
            reject('صيغة الوسائط غير صالحة.');
            return;
          }
          const uploadRes = await storageManager.saveBuffer(buffer, `wall_${Date.now()}.${ext}`, mime);
          cleanMediaUrl = uploadRes.url;
          if (!mediaType) {
            cleanMediaType = uploadRes.mediaType === 'audio' || mime.startsWith('audio/')
              ? 'audio'
              : uploadRes.mediaType === 'video'
              ? 'video'
              : 'image';
          }
        } catch (err) {
          console.error('[Storage Layer] Failed to convert base64 wall media:', err);
          cleanMediaUrl = undefined;
        }
      } else if (cleanMediaUrl) {
        cleanMediaUrl = sanitizeUrl(cleanMediaUrl) || undefined;
      }

      if (cleanMediaUrl && !mediaType) {
        if (/\.(mp3|m4a|aac|wav|opus|flac|ogg)(\?|#|$)/i.test(cleanMediaUrl)) {
          cleanMediaType = 'audio';
        } else if (/\.(mp4|webm|mov|m4v|3gp|mkv)(\?|#|$)/i.test(cleanMediaUrl)) {
          cleanMediaType = 'video';
        } else {
          cleanMediaType = 'image';
        }
      }

      const assignedCategory: 'posts' | 'quick' = category || (cleanMediaUrl || resolvedYoutubeVideo ? 'posts' : 'quick');
      const expandedWallText = cleanWallInput ? (shortcutsExpanded ? cleanWallInput : expandShortcuts(cleanWallInput)) : '';

      const newPost: WallPost = {
        id: `post-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        ...(clientTempId ? { clientTempId } : {}),
        username: user.username,
        displayName: user.displayName || user.username,
        avatarUrl: user.avatarUrl,
        nameBannerUrl: user.nameBannerUrl,
        text: expandedWallText,
        mediaUrl: cleanMediaUrl,
        mediaType: cleanMediaType,
        ...(typeof audioDuration === 'number' && Number.isFinite(audioDuration) && audioDuration > 0 ? { audioDuration: Math.min(600, audioDuration) } : {}),
        category: assignedCategory,
        youtubeVideo: resolvedYoutubeVideo,
        time: getCurrentTimeString(),
        likes: 0,
        commentsCount: 0,
        timestamp: Date.now(),
        updatedAt: Date.now()
      };

      if (clientTempId) {
        registerClientTempId(`wall:${user.username.toLowerCase()}:${clientTempId}`, newPost.id);
      }

      // 1. BROADCAST-FIRST: Emit immediately & acknowledge sender
      io.emit('wallPostAdded', serializeWallPostForClient(newPost));
      if (typeof ack === 'function') {
        ack({ ok: true, id: newPost.id, clientTempId });
      }

      // 2. DEFERRED WORK: filter audit, wall pruning & persistence, batched engagement
      if (text) {
        checkAndLogMonitoredWords(text, user, { type: 'wall_post', targetName: 'منشور في الحائط' });
      }

      wallPosts.unshift(newPost);
      pruneWallPosts();
      saveWallPosts();

      const regMember = getRegisteredMember(user.username)?.member;
      if (regMember) {
        if (!regMember.engagement) regMember.engagement = getDefaultEngagement();
        regMember.engagement.wallPostsCount += 1;
        const engProg = calculateEngagementStars(regMember.engagement);
        regMember.engagement.starsLevel = engProg.starsLevel;
        regMember.engagement.progressPercent = engProg.progressPercent;
        user.engagement = regMember.engagement;
        scheduleEngagementMembersSave();
      }
    }
  );

  socket.on('likeWallPost', ({ postId }: { postId: string }) => {
    const user = users.find((u) => u.id === socket.id);
    if (!user) return;
    const post = wallPosts.find((p) => p.id === postId);
    if (post) {
      if (!post.likedUsers) post.likedUsers = [];
      const userKey = user.username.toLowerCase();
      if (post.likedUsers.includes(userKey)) {
        socket.emit('systemAlert', 'لقد قمت بالإعجاب بهذا المنشور مسبقاً (مسموح بإعجاب واحد فقط لكل عضو) ❤️');
        return;
      }
      post.likedUsers.push(userKey);
      post.likes += 1;
      post.updatedAt = Date.now();
      saveWallPosts();
      io.emit('wallPostUpdated', serializeWallPostForClient(post));
      socket.emit('systemAlert', 'تم تسجيل إعجابك بالمنشور بنجاح ❤️');
    }
  });

  // Add Comment on Wall Post (التعليق على منشورات الحائط مع توسيع الاختصارات)
  socket.on('addWallComment', ({ postId, text }: { postId: string; text: string }) => {
    const user = users.find((u) => u.id === socket.id);
    if (!user || typeof text !== 'string' || !text.trim()) return;
    if (user.isJailed || user.isTextMuted) {
      socket.emit('systemAlert', 'أنت خاضع للإسكات أو التقييد الإداري حالياً.');
      return;
    }
    if (!isSupremeHassan(user) && user.role !== 'admin' && user.role !== 'super' && !hasPermission(user.role, 'canPostWall')) {
      socket.emit('systemAlert', 'عفواً، صلاحية التعليق في الحائط غير متاحة لرتبتك الحالية.');
      return;
    }
    if (!checkHttpRateLimit('wallComment', user.username.toLowerCase(), 10, 60_000)) {
      socket.emit('systemAlert', '⏳ يرجى التمهل قليلاً قبل إضافة تعليق جديد.');
      return;
    }
    const cleanCommentInput = sanitizeText(text).slice(0, 500);
    if (!cleanCommentInput) return;
    if (serverSecurity.blockExternalLinks && !isSupremeHassan(user) && user.role !== 'admin' && user.role !== 'super') {
      if (/(https?:\/\/|www\.|\.com|\.net|\.org|\.xyz|\.app|\.me|\.online|t\.me|wa\.me)/i.test(cleanCommentInput)) {
        socket.emit('systemAlert', '⚠️ نشر الروابط والإعلانات الخارجية ممنوع منعاً باتاً في شات حسان برو.');
        return;
      }
    }
    const post = wallPosts.find((p) => p.id === postId);
    if (post) {
      checkAndLogMonitoredWords(cleanCommentInput, user, { type: 'wall_comment', targetName: `تعليق على منشور ${post.username}` });

      const expandedCommentText = expandShortcuts(cleanCommentInput).slice(0, 600);
      if (!post.comments) post.comments = [];
      const newComment: WallComment = {
        id: `cm-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        username: user.username,
        displayName: user.displayName || user.username,
        avatarUrl: user.avatarUrl,
        nameBannerUrl: user.nameBannerUrl,
        text: expandedCommentText,
        time: getCurrentTimeString(),
        timestamp: Date.now()
      };
      post.comments.push(newComment);
      if (post.comments.length > 50) {
        post.comments = post.comments.slice(-50);
      }
      post.commentsCount = post.comments.length;
      post.updatedAt = Date.now();
      saveWallPosts();
      io.emit('wallPostUpdated', serializeWallPostForClient(post));
      socket.emit('systemAlert', 'تم نشر تعليقك على الحائط بنجاح 💬');
    }
  });

  // Delete Wall Post (حذف منشور الحائط)
  socket.on('deleteWallPost', ({ postId }: { postId: string }) => {
    const user = users.find((u) => u.id === socket.id);
    if (!user) return;
    const idx = wallPosts.findIndex((p) => p.id === postId);
    if (idx !== -1) {
      const post = wallPosts[idx];
      if (post.username.toLowerCase() === user.username.toLowerCase() || isSupremeHassan(user) || user.role === 'admin' || user.role === 'super' || hasPermission(user.role, 'canDeleteWallPost')) {
        wallPosts.splice(idx, 1);
        saveWallPosts();
        io.emit('wallPostDeleted', { postId });
        socket.emit('systemAlert', 'تم حذف المنشور بنجاح 🗑️');
      }
    }
  });

  // Edit Wall Post (تعديل منشور الحائط مع توسيع الاختصارات)
  socket.on('editWallPost', ({ postId, newText }: { postId: string; newText: string }) => {
    const user = users.find((u) => u.id === socket.id);
    if (!user || !newText?.trim() || user.isJailed || user.isTextMuted) return;
    const post = wallPosts.find((p) => p.id === postId);
    if (post) {
      if (post.username.toLowerCase() === user.username.toLowerCase() || isSupremeHassan(user) || user.role === 'admin' || user.role === 'super') {
        const sanitizedNew = sanitizeText(newText.trim());
        if (serverSecurity.blockExternalLinks && !isSupremeHassan(user) && user.role !== 'admin' && user.role !== 'super') {
          if (/(https?:\/\/|www\.|\.com|\.net|\.org|\.xyz|\.app|\.me|\.online|t\.me|wa\.me)/i.test(sanitizedNew)) {
            socket.emit('systemAlert', '⚠️ نشر الروابط والإعلانات الخارجية ممنوع منعاً باتاً في شات حسان برو.');
            return;
          }
        }
        checkAndLogMonitoredWords(sanitizedNew, user, { type: 'wall_post', targetName: 'تعديل منشور الحائط' });
        const cleanText = sanitizedNew ? expandShortcuts(sanitizedNew) : '';
        post.text = cleanText;
        post.isEdited = true;
        post.updatedAt = Date.now();
        saveWallPosts();
        io.emit('wallPostUpdated', serializeWallPostForClient(post));
        socket.emit('systemAlert', 'تم تعديل المنشور بنجاح ✏️');
      }
    }
  });

  // Delete Wall Comment (حذف تعليق على منشور الحائط)
  socket.on('deleteWallComment', ({ postId, commentId }: { postId: string; commentId: string }) => {
    const user = users.find((u) => u.id === socket.id);
    if (!user) return;
    const post = wallPosts.find((p) => p.id === postId);
    if (!post || !post.comments) return;

    const cmIdx = post.comments.findIndex((c) => c.id === commentId);
    if (cmIdx !== -1) {
      const comment = post.comments[cmIdx];
      const isCommentAuthor = comment.username.toLowerCase() === user.username.toLowerCase();
      const isPostAuthor = post.username.toLowerCase() === user.username.toLowerCase();
      if (isCommentAuthor || isPostAuthor || isSupremeHassan(user) || user.role === 'admin' || user.role === 'super' || hasPermission(user.role, 'canDeleteWallPost')) {
        post.comments.splice(cmIdx, 1);
        post.commentsCount = post.comments.length;
        post.updatedAt = Date.now();
        saveWallPosts();
        io.emit('wallPostUpdated', serializeWallPostForClient(post));
        socket.emit('systemAlert', 'تم حذف التعليق بنجاح 🗑️');
      }
    }
  });

  // =========================================================================
  // 24-HOUR STORIES / KHWATER SYSTEM (نظام الخواطر والحالات - حذف تلقائي بعد 24 ساعة)
  // =========================================================================
  socket.on('getStories', ({ cachedVersion }: { cachedVersion?: string } = {}) => {
    const currentVersion = getConfigVersionsSnapshot().stories;
    if (cachedVersion && cachedVersion === currentVersion) {
      socket.emit('storiesNotModified', { version: currentVersion });
      return;
    }
    socket.emit('storiesUpdated', getActiveStories());
  });

  socket.on(
    'newStory',
    async ({
      mediaUrl,
      mediaType,
      caption
    }: {
      mediaUrl: string;
      mediaType?: 'image' | 'video';
      caption?: string;
    }) => {
      const user = users.find((u) => u.id === socket.id);
      if (!user || !mediaUrl) {
        socket.emit('systemAlert', 'بيانات الخاطرة أو الوسائط مفقودة.');
        return;
      }
      if (user.isJailed || user.isTextMuted) {
        socket.emit('systemAlert', 'أنت خاضع للإسكات أو التقييد الإداري حالياً.');
        return;
      }
      if (!isSupremeHassan(user) && user.role !== 'admin' && user.role !== 'super' && !hasPermission(user.role, 'canPostWall')) {
        socket.emit('systemAlert', 'عفواً، صلاحية نشر الخواطر والحالات غير متاحة لرتبتك الحالية.');
        return;
      }

      let cleanMedia = mediaUrl;
      let cleanType: 'image' | 'video' = mediaType === 'video' ? 'video' : 'image';

      if (cleanMedia.startsWith('data:')) {
        try {
          if (cleanMedia.length > 70 * 1024 * 1024) {
            socket.emit('systemAlert', 'حجم الملف يتجاوز الحد المسموح به (50 ميجابايت).');
            return;
          }
          const matches = cleanMedia.match(/^data:([A-Za-z0-9-+\/;=]+);base64,(.+)$/);
          let buffer: Buffer;
          let mime = 'image/jpeg';
          let ext = 'jpg';
          if (matches && matches.length === 3) {
            mime = matches[1].toLowerCase();
            if (mime.includes('svg') || mime.includes('html') || mime.includes('javascript') || mime.includes('xml')) {
              socket.emit('systemAlert', 'عفواً، صيغة الملف غير مدعومة لأسباب أمنية.');
              return;
            }
            if (mime.includes('mp4')) ext = 'mp4';
            else if (mime.includes('webm')) ext = 'webm';
            else if (mime.includes('mov') || mime.includes('quicktime')) ext = 'mov';
            else if (mime.includes('png')) ext = 'png';
            else if (mime.includes('webp')) ext = 'webp';
            else if (mime.includes('gif')) ext = 'gif';
            buffer = Buffer.from(matches[2], 'base64');
            if (buffer.length > 50 * 1024 * 1024 || !validateMediaMagicBytes(buffer, ext)) {
              socket.emit('systemAlert', 'محتوى الملف لا يتطابق مع صيغة وسائط صالحة.');
              return;
            }
          } else {
            socket.emit('systemAlert', 'صيغة الملف غير صالحة.');
            return;
          }
          const uploadRes = await storageManager.saveBuffer(buffer, `story_${Date.now()}.${ext}`, mime);
          cleanMedia = uploadRes.url;
          if (!mediaType) {
            cleanType = uploadRes.mediaType === 'video' ? 'video' : 'image';
          }
        } catch (err) {
          console.error('[Storage Layer] Failed to convert base64 story to file:', err);
          socket.emit('systemAlert', 'تعذر حفظ وسائط الخاطرة.');
          return;
        }
      } else {
        const sanitizedStoryUrl = sanitizeUrl(cleanMedia);
        if (!sanitizedStoryUrl) {
          socket.emit('systemAlert', 'رابط الوسائط غير صالح.');
          return;
        }
        cleanMedia = sanitizedStoryUrl;
      }

      const newStoryItem: StoryItem = {
        id: `story-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        username: user.username,
        displayName: user.displayName || user.username,
        avatarUrl: user.avatarUrl,
        nameBannerUrl: user.nameBannerUrl,
        mediaUrl: cleanMedia,
        mediaType: cleanType,
        caption: sanitizeText(caption).slice(0, 500) || undefined,
        createdAt: Date.now(),
        time: getCurrentTimeString(),
        likes: 0,
        likedUsers: [],
        comments: []
      };

      storiesList.unshift(newStoryItem);
      saveStories();

      // Increment engagement for creating a story
      const regMember = getRegisteredMember(user.username)?.member;
      if (regMember) {
        if (!regMember.engagement) regMember.engagement = getDefaultEngagement();
        regMember.engagement.wallPostsCount += 1;
        const engProg = calculateEngagementStars(regMember.engagement);
        regMember.engagement.starsLevel = engProg.starsLevel;
        regMember.engagement.progressPercent = engProg.progressPercent;
        user.engagement = regMember.engagement;
        saveMembers();
      }

      io.emit('storiesUpdated', getActiveStories());
      socket.emit('systemAlert', 'تم نشر خاطرتك / حالتك بنجاح وستبقى ظاهرة لمدة 24 ساعة ⏳✨');
    }
  );

  socket.on('likeStory', ({ storyId }: { storyId: string }) => {
    const user = users.find((u) => u.id === socket.id);
    if (!user) return;
    const story = storiesList.find((s) => s.id === storyId);
    if (story) {
      if (!story.likedUsers) story.likedUsers = [];
      const userKey = user.username.toLowerCase();
      if (story.likedUsers.includes(userKey)) {
        socket.emit('systemAlert', 'لقد سجلت إعجابك بهذه الخاطرة مسبقاً ❤️');
        return;
      }
      story.likedUsers.push(userKey);
      story.likes += 1;
      saveStories();
      io.emit('storiesUpdated', getActiveStories());
      socket.emit('systemAlert', 'تم تسجيل إعجابك بالخاطرة ❤️');
    }
  });

  socket.on('addStoryComment', ({ storyId, text }: { storyId: string; text: string }) => {
    const user = users.find((u) => u.id === socket.id);
    if (!user || typeof text !== 'string' || !text.trim() || user.isJailed || user.isTextMuted) return;
    if (!isSupremeHassan(user) && user.role !== 'admin' && user.role !== 'super' && !hasPermission(user.role, 'canPostWall')) {
      socket.emit('systemAlert', 'عفواً، صلاحية التعليق غير متاحة لرتبتك الحالية.');
      return;
    }
    if (!checkHttpRateLimit('storyComment', user.username.toLowerCase(), 10, 60_000)) {
      socket.emit('systemAlert', '⏳ يرجى التمهل قليلاً قبل إضافة تعليق جديد.');
      return;
    }
    const cleanComment = sanitizeText(text).slice(0, 400);
    if (!cleanComment) return;
    if (serverSecurity.blockExternalLinks && !isSupremeHassan(user) && user.role !== 'admin' && user.role !== 'super') {
      if (/(https?:\/\/|www\.|\.com|\.net|\.org|\.xyz|\.app|\.me|\.online|t\.me|wa\.me)/i.test(cleanComment)) {
        socket.emit('systemAlert', '⚠️ نشر الروابط والإعلانات الخارجية ممنوع منعاً باتاً في شات حسان برو.');
        return;
      }
    }
    const story = storiesList.find((s) => s.id === storyId);
    if (story) {
      checkAndLogMonitoredWords(cleanComment, user, { type: 'wall_comment', targetName: `تعليق على خاطرة ${story.username}` });
      if (!story.comments) story.comments = [];
      const newCm: StoryComment = {
        id: `sc-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        username: user.username,
        displayName: user.displayName || user.username,
        avatarUrl: user.avatarUrl,
        nameBannerUrl: user.nameBannerUrl,
        text: cleanComment,
        time: getCurrentTimeString(),
        timestamp: Date.now()
      };
      story.comments.push(newCm);
      if (story.comments.length > 50) {
        story.comments = story.comments.slice(-50);
      }
      saveStories();
      io.emit('storiesUpdated', getActiveStories());
      socket.emit('systemAlert', 'تمت إضافة تعليقك على الخاطرة بنجاح 💬');
    }
  });

  socket.on('deleteStory', ({ storyId }: { storyId: string }) => {
    const user = users.find((u) => u.id === socket.id);
    if (!user) return;
    const idx = storiesList.findIndex((s) => s.id === storyId);
    if (idx !== -1) {
      const story = storiesList[idx];
      if (story.username.toLowerCase() === user.username.toLowerCase() || isSupremeHassan(user) || user.role === 'admin' || user.role === 'super' || hasPermission(user.role, 'canDeleteWallPost')) {
        storiesList.splice(idx, 1);
        saveStories();
        io.emit('storiesUpdated', getActiveStories());
        socket.emit('systemAlert', 'تم حذف الخاطرة بنجاح 🗑️');
      }
    }
  });

  // Delete Chat Message in Room (حذف رسالة من الغرفة)
  socket.on('deleteChatMessage', ({ messageId }: { messageId: string }) => {
    const user = users.find((u) => u.id === socket.id);
    if (!user) return;
    const msgIdx = chatHistory.findIndex((m) => m.id === messageId);
    if (msgIdx !== -1) {
      const msg = chatHistory[msgIdx];
      if (msg.username.toLowerCase() === user.username.toLowerCase() || isSupremeHassan(user) || user.role === 'admin' || user.role === 'super' || hasPermission(user.role, 'canDeleteMessage')) {
        const roomSettings = getRoomSettings(msg.room);
        if (roomSettings.showDeletedNotice) {
          msg.isDeleted = true;
          msg.deletedBy = user.username;
          msg.deletedByRole = user.role;
          msg.text = '';
          delete msg.mediaUrl;
          delete msg.mediaType;
          delete msg.voiceNote;
          delete msg.replyTo;
          delete msg.reactions;
          saveHistory();
          io.to(msg.room).emit('chatMessageDeleted', {
            messageId,
            showNotice: true,
            deletedBy: user.username,
            deletedByRole: user.role
          });
        } else {
          chatHistory.splice(msgIdx, 1);
          saveHistory();
          io.to(msg.room).emit('chatMessageDeleted', { messageId });
        }
        socket.emit('systemAlert', 'تم حذف الرسالة بنجاح 🗑️');
      }
    }
  });

  // Edit Chat Message in Room (تعديل رسالة من الغرفة)
  socket.on('editChatMessage', ({ messageId, newText }: { messageId: string; newText: string }) => {
    const user = users.find((u) => u.id === socket.id);
    if (!user || !newText?.trim() || user.isJailed || user.isTextMuted) return;
    const msg = chatHistory.find((m) => m.id === messageId);
    if (msg) {
      if (msg.username.toLowerCase() === user.username.toLowerCase() || isSupremeHassan(user) || user.role === 'admin' || user.role === 'super') {
        const cleanText = sanitizeText(newText.trim());
        if (cleanText && serverSecurity.blockExternalLinks && !isSupremeHassan(user) && user.role !== 'admin' && user.role !== 'super') {
          if (/(https?:\/\/|www\.|\.com|\.net|\.org|\.xyz|\.app|\.me|\.online|t\.me|wa\.me)/i.test(cleanText)) {
            socket.emit('systemAlert', '⚠️ نشر الروابط والإعلانات الخارجية ممنوع منعاً باتاً في شات حسان برو.');
            return;
          }
        }
        checkAndLogMonitoredWords(cleanText, user, { type: 'room', targetName: msg.room });
        msg.text = cleanText;
        msg.isEdited = true;
        saveHistory();
        io.to(msg.room).emit('chatMessageEdited', { messageId, newText: cleanText, isEdited: true });
        socket.emit('systemAlert', 'تم تعديل الرسالة بنجاح ✏️');
      }
    }
  });

  // Reaction to Chat Message (التفاعل بالإيموجي مع الرسائل - مشترك على مستوى السيرفر لمنع التكرار لكل عضو)
  socket.on('reactChatMessage', ({ messageId, emoji }: { messageId: string; emoji: string }) => {
    const user = users.find((u) => u.id === socket.id);
    if (!user || user.isJailed || !emoji || typeof emoji !== 'string' || emoji.length > 16) return;
    const msg = chatHistory.find((m) => m.id === messageId);
    if (msg && user.room && msg.room === user.room) {
      if (!msg.reactions) msg.reactions = {};
      let reactedMap = messageReactionsUsersMap.get(messageId);
      if (!reactedMap) {
        if (messageReactionsUsersMap.size >= 3000) {
          const oldestKey = messageReactionsUsersMap.keys().next().value;
          if (oldestKey) messageReactionsUsersMap.delete(oldestKey);
        }
        reactedMap = {};
        messageReactionsUsersMap.set(messageId, reactedMap);
      }
      const list = reactedMap[emoji] || [];
      const userKey = user.username.toLowerCase();
      if (list.includes(userKey)) {
        reactedMap[emoji] = list.filter((u) => u !== userKey);
        msg.reactions[emoji] = Math.max(0, (msg.reactions[emoji] || 1) - 1);
        if (msg.reactions[emoji] === 0) delete msg.reactions[emoji];
      } else {
        reactedMap[emoji] = [...list, userKey];
        msg.reactions[emoji] = (msg.reactions[emoji] || 0) + 1;
      }
      saveHistory();
      io.to(msg.room).emit('chatMessageReactionUpdated', { messageId, reactions: msg.reactions });
    }
  });

  // Pin / Unpin Room Message (تثبيت وإلغاء تثبيت رسالة في الروم)
  socket.on('pinRoomMessage', ({ messageId, unpin }: { messageId?: string; unpin?: boolean }) => {
    const user = users.find((u) => u.id === socket.id);
    if (!user || (!isSupremeHassan(user) && user.role !== 'admin' && user.role !== 'super' && !hasPermission(user.role, 'canPinMessage'))) {
      socket.emit('systemAlert', 'تثبيت الرسائل محصور بالإشراف والإدارة المصرح لهم.');
      return;
    }
    if (!user.room || user.room === 'خارج الغرف') {
      socket.emit('systemAlert', 'يجب أن تكون متواجداً داخل غرفة أولاً لتثبيت الرسائل.');
      return;
    }
    if (unpin) {
      roomPinnedMessages[user.room] = null;
      io.to(user.room).emit('roomPinnedMessageUpdated', null);
      logMonitorEvent('room', `فك المشرف ${user.username} تثبيت الإعلان في [${user.room}]`, user.username);
    } else if (messageId) {
      const msg = chatHistory.find((m) => m.id === messageId && m.room === user.room);
      if (msg) {
        const pinned = { id: msg.id, username: msg.username, text: msg.text || 'مرفق وسائط' };
        roomPinnedMessages[user.room] = pinned;
        io.to(user.room).emit('roomPinnedMessageUpdated', pinned);
        logMonitorEvent('room', `تثبيت رسالة لـ [${msg.username}] في [${user.room}] بواسطة ${user.username}`, user.username);
      }
    }
  });

  // Get Active Sessions List (عرض ومراقبة الجلسات النشطة والأجهزة المتصلة دون كشف رموز الدخول)
  socket.on('getActiveSessions', () => {
    const admin = users.find((u) => u.id === socket.id);
    if (!admin || (!isSupremeHassan(admin) && admin.role !== 'admin' && admin.role !== 'super' && !hasPermission(admin.role, 'canAccessControlPanel'))) {
      socket.emit('systemAlert', 'عرض الجلسات النشطة محصور بطاقم الإدارة.');
      return;
    }
    const sessionList = Array.from(activeSessions.values()).map((s) => ({
      sessionId: getOpaqueSessionId(s.sessionToken),
      username: s.user.username,
      role: s.user.role,
      room: s.user.room,
      ip: s.user.ipAddress || s.user.ip || 'غير مسجل',
      device: s.user.deviceInfo || 'جهاز غير معروف',
      flag: s.user.flag || '🇾🇪',
      lastActive: s.lastActiveTime,
      currentSocketId: s.currentSocketId,
      isOnline: users.some((u) => u.id === s.currentSocketId)
    }));
    socket.emit('activeSessionsList', sessionList);
  });

  // Terminate Active Session (إنهاء وإسقاط جلسة نشطة لجهاز معين)
  socket.on('terminateSession', ({ sessionId, sessionToken }: { sessionId?: string; sessionToken?: string }) => {
    const admin = users.find((u) => u.id === socket.id);
    if (!admin || (!isSupremeHassan(admin) && admin.role !== 'admin' && admin.role !== 'super' && !hasPermission(admin.role, 'canAccessControlPanel'))) {
      socket.emit('systemAlert', 'إنهاء الجلسات محصور بطاقم الإدارة.');
      return;
    }
    let resolvedToken = '';
    let sess: UserSession | undefined;
    if (typeof sessionId === 'string' && sessionId.trim()) {
      const targetSid = sessionId.trim();
      for (const [tok, s] of activeSessions.entries()) {
        if (getOpaqueSessionId(tok) === targetSid) {
          resolvedToken = tok;
          sess = s;
          break;
        }
      }
    } else if (typeof sessionToken === 'string' && sessionToken.trim()) {
      const rawTok = sessionToken.trim();
      sess = activeSessions.get(rawTok);
      if (sess) resolvedToken = rawTok;
    }
    if (sess && resolvedToken) {
      const targetUser = sess.user;
      const targetRole = targetUser?.role || 'member';
      if (!isSupremeHassan(admin) && getRoleLevel(targetRole) >= getRoleLevel(admin.role)) {
        socket.emit('systemAlert', 'لا يمكنك إنهاء جلسة لمستخدم ذو رتبة مساوية أو أعلى منك.');
        return;
      }
      revokeUserSessionTokens({
        sessionToken: resolvedToken,
        username: targetUser?.username,
        bumpVersion: true
      });

      if (sess.currentSocketId) {
        io.to(sess.currentSocketId).emit('kickedByAdmin', { reason: 'تم إنهاء جلستك من قبل الإدارة.', by: admin.username });
        const sock = io.sockets.sockets.get(sess.currentSocketId);
        if (sock) {
          try {
            sock.disconnect(true);
          } catch {}
        }
      }
      logMonitorEvent('security', `إنهاء وإسقاط جلسة [${targetUser?.username}] بواسطة [${admin.role.toUpperCase()}] ${admin.username}`, admin.username, targetUser?.username);
      socket.emit('systemAlert', `تم إنهاء وإسقاط جلسة [${targetUser?.username}] بنجاح.`);

      // Send updated list
      const sessionList = Array.from(activeSessions.values()).map((s) => ({
        sessionId: getOpaqueSessionId(s.sessionToken),
        username: s.user.username,
        role: s.user.role,
        room: s.user.room,
        ip: s.user.ipAddress || s.user.ip || 'غير مسجل',
        device: s.user.deviceInfo || 'جهاز غير معروف',
        flag: s.user.flag || '🇾🇪',
        lastActive: s.lastActiveTime,
        currentSocketId: s.currentSocketId,
        isOnline: users.some((u) => u.id === s.currentSocketId)
      }));
      socket.emit('activeSessionsList', sessionList);
    }
  });

  // Get Room Pinned Message
  socket.on('getRoomPinnedMessage', () => {
    const user = users.find((u) => u.id === socket.id);
    if (user && roomPinnedMessages[user.room]) {
      socket.emit('roomPinnedMessageUpdated', roomPinnedMessages[user.room]);
    }
  });

  // Report Chat Message (إبلاغ عن رسالة مخالفة للإدارة)
  socket.on('reportChatMessage', ({ messageId, reportedUser, text, reason }: { messageId: string; reportedUser: string; text?: string; reason?: string }) => {
    const user = users.find((u) => u.id === socket.id);
    if (!user) return;
    const nowRep = Date.now();
    const lastRepAt = ((user as any)._lastReportAt as number) || 0;
    if (nowRep - lastRepAt < 10000) {
      socket.emit('systemAlert', '⏳ يرجى الانتظار 10 ثوانٍ قبل إرسال بلاغ جديد.');
      return;
    }
    (user as any)._lastReportAt = nowRep;
    const cleanReported = sanitizeText(reportedUser).slice(0, 60);
    if (!cleanReported) return;
    const cleanReason = sanitizeText(reason || 'مخالفة').slice(0, 120) || 'مخالفة';
    const cleanSnippet = sanitizeText(text || '').slice(0, 80) || 'مرفق وسائط';
    logMonitorEvent(
      'warn',
      `🚩 بلاغ عن رسالة: [${user.username}] أبلغ عن [${cleanReported}] - السبب: ${cleanReason} - المحتوى: "${cleanSnippet}"`,
      user.username,
      cleanReported
    );
    emitToAuthorizedStaff('systemAlert', `🚩 بلاغ جديد: @${user.username} أبلغ عن رسالة لـ @${cleanReported}`);
    socket.emit('systemAlert', 'تم استلام بلاغك بنجاح وسيقوم المشرفون بمراجعته فوراً 🛡️');
  });

  // Add Points Reward from Games & Activities (strict anti-abuse cooldown + hourly cap)
  socket.on('addPointsReward', ({ amount, reason }: { amount: number; reason: string }) => {
    const user = users.find((u) => u.id === socket.id);
    if (!user || user.isJailed || user.isTextMuted) return;
    if (user.role === 'guest') {
      return;
    }
    const now = Date.now();
    const uKey = user.username.toLowerCase();
    if (!checkHttpRateLimit('gameRewardCooldown', uKey, 1, 15_000)) {
      return;
    }
    const parsedAmount = Number(amount);
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) return;
    const requestedPoints = Math.min(Math.max(1, Math.floor(parsedAmount)), 100);

    let bucket = hourlyPointsRewardMap.get(uKey);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { total: 0, resetAt: now + 3600_000 };
    }
    const remainingHourly = Math.max(0, 300 - bucket.total);
    if (remainingHourly <= 0) {
      socket.emit('systemAlert', 'وصلت للحد الأقصى لمكافآت الألعاب هذه الساعة (300 نقطة).');
      return;
    }
    const pointsToAdd = Math.min(requestedPoints, remainingHourly);
    bucket.total += pointsToAdd;
    hourlyPointsRewardMap.set(uKey, bucket);

    user.points = (user.points || 0) + pointsToAdd;
    const regMember = getRegisteredMember(user.username)?.member;
    if (regMember) {
      regMember.points = user.points;
      saveMembers();
    }
    socket.emit('userPointsUpdated', { points: user.points, reason: sanitizeText(reason).slice(0, 80) || 'مكافأة', added: pointsToAdd });
  });

  // Authoritative Daily Login Streak Claim (persistent server-side verification)
  socket.on('claimDailyLoginReward', () => {
    const user = users.find((u) => u.id === socket.id);
    if (!user || user.role === 'guest') return;
    const reg = getRegisteredMember(user.username)?.member as any;
    if (!reg) return;
    const todayStr = new Date().toISOString().slice(0, 10);
    const lastDate = reg?.lastDailyRewardDate || '';
    if (lastDate === todayStr) {
      socket.emit('dailyRewardResult', {
        ok: false,
        claimedToday: true,
        streak: reg?.dailyStreak || 1,
        points: user.points || 0,
        message: 'لقد استلمت مكافأة الدخول اليومي لهذا اليوم بالفعل ✨'
      });
      return;
    }
    let nextStreak = 1;
    if (lastDate) {
      const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
      if (lastDate === yesterday) {
        nextStreak = Math.min(30, (Number(reg?.dailyStreak) || 0) + 1);
      }
    }
    const rewardPoints = 25 + nextStreak * 15;
    user.points = (user.points || 0) + rewardPoints;
    reg.points = user.points;
    reg.dailyStreak = nextStreak;
    reg.lastDailyRewardDate = todayStr;
    saveMembers();
    socket.emit('userPointsUpdated', { points: user.points, reason: `مكافأة الدخول اليومي (يوم ${nextStreak})`, added: rewardPoints });
    socket.emit('dailyRewardResult', {
      ok: true,
      claimedToday: true,
      streak: nextStreak,
      points: user.points,
      reward: rewardPoints,
      message: `تم استلام +${rewardPoints} نقطة لمواظبة الدخول (سلسلة ${nextStreak} يوم) 🎁`
    });
  });

  // Authoritative Peer-to-Peer Points Transfer
  socket.on('transferPoints', ({ targetUsername, amount }: { targetUsername: string; amount: number }) => {
    const sender = users.find((u) => u.id === socket.id);
    if (!sender) return;
    if (sender.role === 'guest' || sender.isJailed) {
      socket.emit('systemAlert', 'تحويل النقاط متاح للأعضاء المسجلين فقط.');
      return;
    }
    const now = Date.now();
    const lastTxAt = ((sender as any)._lastPointsTransferAt as number) || 0;
    if (now - lastTxAt < 4000) {
      socket.emit('systemAlert', '⏳ يرجى الانتظار قليلاً بين عمليات التحويل.');
      return;
    }
    const cleanTarget = sanitizeText(targetUsername)?.trim();
    if (!cleanTarget || cleanTarget.toLowerCase() === sender.username.toLowerCase()) {
      socket.emit('systemAlert', 'يرجى تحديد عضو آخر صالح لتحويل النقاط إليه.');
      return;
    }
    const parsedAmount = Math.floor(Number(amount));
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0 || parsedAmount > 100000) {
      socket.emit('systemAlert', 'يرجى إدخال كمية نقاط صالحة للتحويل (1 إلى 100,000).');
      return;
    }
    if ((sender.points || 0) < parsedAmount) {
      socket.emit('systemAlert', `رصيد نقاطك (${sender.points || 0}) غير كافٍ للتحويل.`);
      return;
    }

    const targetOnline = users.find((u) => u.username.toLowerCase() === cleanTarget.toLowerCase());
    const regTarget = getRegisteredMember(cleanTarget);
    if (!regTarget || regTarget.member.role === 'guest') {
      socket.emit('systemAlert', `العضو [${cleanTarget}] غير مسجل أو غير موجود.`);
      return;
    }

    (sender as any)._lastPointsTransferAt = now;
    sender.points = (sender.points || 0) - parsedAmount;
    const regSender = getRegisteredMember(sender.username)?.member;
    if (regSender) regSender.points = sender.points;

    const resolvedTargetName = regTarget.key;
    regTarget.member.points = (regTarget.member.points || 0) + parsedAmount;
    const newTargetPoints = regTarget.member.points;
    if (targetOnline) {
      targetOnline.points = newTargetPoints;
      io.to(targetOnline.id).emit('userPointsUpdated', {
        points: targetOnline.points,
        reason: `تحويل نقاط من ${sender.username}`,
        added: parsedAmount
      });
      io.to(targetOnline.id).emit('systemAlert', `💸 استلمت ${parsedAmount} نقطة هدية من [${sender.username}]!`);
    }
    saveMembers();

    socket.emit('userPointsUpdated', {
      points: sender.points,
      reason: `تحويل إلى ${resolvedTargetName}`,
      added: -parsedAmount
    });
    socket.emit('systemAlert', `✅ تم تحويل ${parsedAmount} نقطة إلى [${resolvedTargetName}] بنجاح!`);
  });

  // Broadcast Mini-Game Win to Room (with anti-spam cooldown)
  socket.on('broadcastGameWin', ({ gameName, pointsWon }: { gameName: string; pointsWon: number }) => {
    const user = users.find((u) => u.id === socket.id);
    if (!user || user.isJailed || user.isTextMuted || !user.room || user.room === 'خارج الغرف') return;
    const now = Date.now();
    if (!checkHttpRateLimit('gameWinCooldown', user.username.toLowerCase(), 1, 15_000)) return;
    const cleanGameName = sanitizeText(gameName).slice(0, 60) || 'لعبة المسابقات';
    const clampedPoints = Math.min(Math.max(1, Math.floor(Number(pointsWon) || 1)), 100);
    const winMsg: StoredMessage = {
      id: `gamewin-${now}`,
      room: user.room,
      username: 'نظام الجوائز والمسابقات 🏆',
      badge: 'فوز مستحق',
      badgeColor: 'text-amber-500',
      text: `🎉 كفو! حقق الصقر [${user.username}] فوزاً في (${cleanGameName}) وحصد [${clampedPoints} نقطة] إضافية!`,
      time: getCurrentTimeString(),
      timestamp: now
    };
    chatHistory.push(winMsg);
    pruneRoomChatHistory(user.room);
    saveHistory();
    io.to(user.room).emit('message', winMsg);
  });

  // Delete Private Message (حذف رسالة من الخاص - مع التحقق من الملكية والمشاركة)
  socket.on('deletePrivateMessage', ({ messageId, partnerId, partnerUsername }: { messageId: string; partnerId?: string; partnerUsername?: string }) => {
    const actor = users.find((u) => u.id === socket.id);
    if (!actor || !messageId) return;

    let deleted = false;
    let resolvedPartnerUsername = partnerUsername;
    for (const [, list] of privateChatHistory.entries()) {
      const idx = list.findIndex((m) => m.id === messageId);
      if (idx !== -1) {
        const msg = list[idx];
        const isSender = msg.fromUsername?.toLowerCase() === actor.username.toLowerCase();
        const isParticipant = isSender || msg.toUsername?.toLowerCase() === actor.username.toLowerCase();
        if (!isSender && !(isParticipant && isSupremeHassan(actor))) {
          socket.emit('systemAlert', 'لا يمكنك حذف رسالة لم ترسلها أو لست طرفاً فيها.');
          return;
        }
        resolvedPartnerUsername = isSender ? msg.toUsername : msg.fromUsername;
        list.splice(idx, 1);
        savePrivateChatHistory();
        deleted = true;
        break;
      }
    }
    if (!deleted) return;

    socket.emit('privateMessageDeleted', { messageId });
    if (resolvedPartnerUsername) {
      const partner = users.find((u) => u.username.toLowerCase() === resolvedPartnerUsername!.toLowerCase());
      if (partner) {
        io.to(partner.id).emit('privateMessageDeleted', { messageId });
      }
    } else if (partnerId) {
      io.to(partnerId).emit('privateMessageDeleted', { messageId });
    }
    socket.emit('systemAlert', 'تم حذف الرسالة الخاصة 🗑️');
  });

  // Edit Private Message (تعديل رسالة من الخاص - محصور بالمرسل فقط)
  socket.on('editPrivateMessage', ({ messageId, newText, partnerId, partnerUsername }: { messageId: string; newText: string; partnerId?: string; partnerUsername?: string }) => {
    const actor = users.find((u) => u.id === socket.id);
    if (!actor || !messageId || !newText?.trim() || actor.isJailed) return;
    const cleanText = sanitizeText(newText.trim());

    let updated = false;
    let resolvedPartnerUsername = partnerUsername;
    for (const [, list] of privateChatHistory.entries()) {
      const target = list.find((m) => m.id === messageId);
      if (target) {
        if (target.fromUsername?.toLowerCase() !== actor.username.toLowerCase()) {
          socket.emit('systemAlert', 'لا يمكنك تعديل رسالة خاصة لم تقم بإرسالها.');
          return;
        }
        resolvedPartnerUsername = target.toUsername;
        checkAndLogMonitoredWords(cleanText, actor, { type: 'pm', targetName: resolvedPartnerUsername });
        target.text = cleanText;
        target.isEdited = true;
        savePrivateChatHistory();
        updated = true;
        break;
      }
    }
    if (!updated) return;

    socket.emit('privateMessageEdited', { messageId, newText: cleanText, isEdited: true });
    if (resolvedPartnerUsername) {
      const partner = users.find((u) => u.username.toLowerCase() === resolvedPartnerUsername!.toLowerCase());
      if (partner) {
        io.to(partner.id).emit('privateMessageEdited', { messageId, newText: cleanText, isEdited: true });
      }
    } else if (partnerId) {
      io.to(partnerId).emit('privateMessageEdited', { messageId, newText: cleanText, isEdited: true });
    }
    socket.emit('systemAlert', 'تم تعديل الرسالة الخاصة بنجاح ✏️');
  });

  // Reply to Admin Warning (الرد على التنبيه الإداري وكتابة يدوية)
  socket.on('replyToWarning', ({ toUsername, replyText }: { toUsername: string; replyText: string }) => {
    const sender = users.find((u) => u.id === socket.id);
    const cleanTo = sanitizeText(toUsername).trim().slice(0, 60);
    const cleanReply = sanitizeText(replyText).trim().slice(0, 500);
    if (!sender || !cleanTo || !cleanReply) return;

    const adminUser = users.find((u) => u.username.toLowerCase() === cleanTo.toLowerCase());
    if (!adminUser || !isStaffUser(adminUser)) return;

    logMonitorEvent(
      'security',
      `رد العضو [${sender.username}] على التنبيه الإداري من [${cleanTo}]: "${cleanReply}"`,
      sender.username,
      cleanTo
    );

    io.to(adminUser.id).emit('warningReplyReceived', {
      from: sender.username,
      avatarUrl: sender.avatarUrl,
      flag: sender.flag,
      replyText: cleanReply,
      time: new Date().toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })
    });
    socket.emit('systemAlert', 'تم إرسال ردك وتوضيحك للإدارة بنجاح ✔️');
  });

  // Phone-to-Phone Direct Audio Packet Relay (إرسال واستقبال بث الصوت المباشر بين الهواتف)
  socket.on('voiceDataChunk', ({ chunk }: { chunk: string }) => {
    const user = users.find((u) => u.id === socket.id);
    if (!user || user.micSlot === null || user.isTextMuted || user.isVoiceMutedByAdmin) return;
    if (user.isMuted && !user.isSharingMusic) return;

    // Relay audio chunk to all other users in this room
    socket.to(user.room).emit('remoteVoiceChunk', {
      userId: user.id,
      username: user.username,
      micSlot: user.micSlot,
      chunk
    });
  });

  // Private Messages (Broadcast-First: emits immediately before history persistence & offline queue save)
  socket.on(
    'privateMessage',
    async (
      {
        toId,
        toUsername,
        text,
        mediaUrl,
        voiceNote,
        replyTo,
        selfDestructSeconds,
        clientTempId,
        shortcutsExpanded
      }: {
        toId: string;
        toUsername?: string;
        text?: string;
        mediaUrl?: string;
        voiceNote?: { audioUrl: string; duration: number };
        replyTo?: { id: string; username: string; text: string };
        selfDestructSeconds?: number;
        clientTempId?: string;
        shortcutsExpanded?: boolean;
      },
      ack?: (res: { ok: boolean; id?: string; clientTempId?: string; error?: string }) => void
    ) => {
      const reject = (errMsg: string) => {
        socket.emit('systemAlert', errMsg);
        if (typeof ack === 'function') ack({ ok: false, clientTempId, error: errMsg });
      };

      const sender = users.find((u) => u.id === socket.id);
      if (!sender) {
        if (typeof ack === 'function') ack({ ok: false, clientTempId, error: 'الجلسة غير متصلة حالياً.' });
        return;
      }

      if (clientTempId) {
        const dedupKey = `pm:${sender.username.toLowerCase()}:${clientTempId}`;
        const existing = recentClientTempIds.get(dedupKey);
        if (existing) {
          if (typeof ack === 'function') ack({ ok: true, id: existing.id, clientTempId });
          return;
        }
      }

      if (sender.isJailed) {
        reject('أنت مقيد في السجن الإداري ولا يمكنك إرسال رسائل خاصة.');
        return;
      }
      if (!isSupremeHassan(sender) && sender.role !== 'admin' && sender.role !== 'super' && !hasPermission(sender.role, 'canPrivateChat')) {
        reject('عفواً، صلاحية المحادثة الخاصة غير متاحة لرتبتك الحالية.');
        return;
      }

      let recipient = users.find((u) => u.id === toId);
      if (!recipient && toUsername) {
        recipient = users.find((u) => u.username.toLowerCase() === toUsername.trim().toLowerCase());
      }
      const clean = sanitizeText(text).slice(0, 4000);

      if (!isSupremeHassan(sender) && sender.role !== 'admin' && sender.role !== 'super') {
        if (clean && likesSettings.pmTextLikes > 0 && sender.likes < likesSettings.pmTextLikes) {
          reject(`عفواً، يتطلب إرسال الرسائل الخاصة ${likesSettings.pmTextLikes} لايك على الأقل. رصيدك الحالي: ${sender.likes} 👍`);
          return;
        }
        if ((mediaUrl || voiceNote) && likesSettings.pmMediaLikes > 0 && sender.likes < likesSettings.pmMediaLikes) {
          reject(`عفواً، يتطلب إرسال الوسائط في الخاص ${likesSettings.pmMediaLikes} لايك على الأقل. رصيدك الحالي: ${sender.likes} 👍`);
          return;
        }
      }

      if (!clean && !mediaUrl && !voiceNote) {
        if (typeof ack === 'function') ack({ ok: false, clientTempId, error: 'الرسالة فارغة.' });
        return;
      }

      const destUsername = recipient ? recipient.username : (toUsername ? sanitizeText(toUsername).trim() : '');
      if (!destUsername) {
        if (typeof ack === 'function') ack({ ok: false, clientTempId, error: 'المستلم غير محدد.' });
        return;
      }

      const targetMemberInfo = getRegisteredMember(destUsername)?.member;
      const isRecipientPmDisabled = recipient ? Boolean(recipient.isPmDisabled) : Boolean(targetMemberInfo?.isPmDisabled);
      if (isRecipientPmDisabled && !isSupremeHassan(sender) && sender.role !== 'admin' && sender.role !== 'super') {
        reject(`عفواً، قام [${destUsername}] بتعطيل استلام المحادثات الخاصة 🔒`);
        return;
      }

      const expandedPmText = clean ? (shortcutsExpanded ? clean : expandShortcuts(clean)) : '';
      const now = Date.now();
      const validSelfDestruct =
        typeof selfDestructSeconds === 'number' && Number.isFinite(selfDestructSeconds) && selfDestructSeconds > 0
          ? Math.min(86400, Math.max(1, Math.floor(selfDestructSeconds)))
          : undefined;

      const safePmMediaUrl = await ensureMediaUrlNotBase64(mediaUrl);
      let safePmVoiceNote: { audioUrl: string; duration: number } | undefined;
      if (voiceNote?.audioUrl) {
        const resolvedPmAudio = await ensureMediaUrlNotBase64(voiceNote.audioUrl);
        if (resolvedPmAudio) {
          safePmVoiceNote = {
            audioUrl: resolvedPmAudio,
            duration: Number.isFinite(Number(voiceNote.duration)) ? Math.min(600, Math.max(0, Number(voiceNote.duration))) : 0
          };
        }
      }

      const safePmReplyTo = replyTo && typeof replyTo === 'object'
        ? {
            id: sanitizeText(String(replyTo.id || '')).slice(0, 80),
            username: sanitizeText(String(replyTo.username || '')).slice(0, 60),
            text: sanitizeText(String(replyTo.text || '')).slice(0, 500)
          }
        : undefined;

      const destBanner = recipient?.nameBannerUrl || targetMemberInfo?.nameBannerUrl;
      const isRecipientBot = Boolean(recipient?.isBot || botEngine.isBotUsername(destUsername));

      const pm: PrivateMessage = {
        id: `pm-${now}-${Math.random().toString(36).substring(2, 6)}`,
        ...(clientTempId ? { clientTempId } : {}),
        fromId: sender.id,
        fromUsername: sender.username,
        fromDisplayName: sender.displayName || sender.username,
        fromAvatar: sender.avatarUrl,
        fromNameBannerUrl: sender.nameBannerUrl,
        toId: recipient ? recipient.id : `offline-${destUsername}`,
        toUsername: destUsername,
        toDisplayName: resolveUserDisplayName(destUsername, recipient?.displayName || targetMemberInfo?.displayName),
        toNameBannerUrl: destBanner,
        text: expandedPmText,
        mediaUrl: safePmMediaUrl,
        voiceNote: safePmVoiceNote,
        replyTo: safePmReplyTo,
        time: new Date().toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' }),
        timestamp: now,
        status: recipient || isRecipientBot ? 'delivered' : 'sent',
        selfDestructSeconds: validSelfDestruct,
        selfDestructAt: validSelfDestruct ? now + (validSelfDestruct * 1000) : undefined
      };

      if (clientTempId) {
        registerClientTempId(`pm:${sender.username.toLowerCase()}:${clientTempId}`, pm.id);
      }

      // 1. BROADCAST-FIRST: Emit immediately to sender & recipient + send ACK
      socket.emit('newPrivateMessage', pm);
      const recipientSock = recipient ? io.sockets.sockets.get(recipient.id) : undefined;
      const isRecipientSocketAlive = Boolean(recipient && recipientSock && recipientSock.connected);

      if (!isRecipientBot && isRecipientSocketAlive && recipient && recipient.id !== socket.id) {
        io.to(recipient.id).emit('newPrivateMessage', pm);
      }
      if (typeof ack === 'function') {
        ack({ ok: true, id: pm.id, clientTempId });
      }

      // 2. DEFERRED WORK (after live delivery): filter log, persistent PM archive & pruning, offline queue, bot reply
      if (clean) {
        checkAndLogMonitoredWords(clean, sender, { type: 'pm', targetName: destUsername });
      }

      if (!validSelfDestruct) {
        const pairKey = getPmPairKey(sender.username, destUsername);
        if (!privateChatHistory.has(pairKey)) {
          privateChatHistory.set(pairKey, []);
        }
        privateChatHistory.get(pairKey)!.push(pm);
        prunePrivateChatHistory(pairKey);
        savePrivateChatHistory();
      }

      if (isRecipientBot) {
        botEngine.onPrivateMessage(sender, destUsername, expandedPmText || clean || '', pm);
      } else if (!isRecipientSocketAlive) {
        const key = destUsername.toLowerCase();
        if (!offlinePrivateMessages.has(key)) {
          offlinePrivateMessages.set(key, []);
        }
        offlinePrivateMessages.get(key)!.push(pm);
        saveOfflinePrivateMessages();
        if (!recipient) {
          socket.emit('systemAlert', `تم حفظ رسالتك في صندوق الوارد السحابي، وستصل لـ [${destUsername}] فور دخوله 📬`);
        }
      }

      if (validSelfDestruct) {
        const senderLower = sender.username.toLowerCase();
        const destLower = destUsername.toLowerCase();
        setTimeout(() => {
          users.forEach((u) => {
            const uLower = u.username.toLowerCase();
            if (uLower === senderLower || uLower === destLower) {
              io.to(u.id).emit('privateMessageDeleted', { messageId: pm.id });
            }
          });
        }, validSelfDestruct * 1000);
      }
    }
  );

  // Mark Private Messages as Read (مؤشرات القراءة بالصحين الأزرقين مع الحفظ الدائم)
  socket.on('markPrivateMessagesRead', ({ partnerUsername, partnerId }: { partnerUsername: string; partnerId?: string }) => {
    const user = users.find((u) => u.id === socket.id);
    if (!user) return;

    const partnerLower = (partnerUsername || '').trim().toLowerCase();
    const partnerSockets = users.filter(
      (u) =>
        (partnerLower && u.username.trim().toLowerCase() === partnerLower) ||
        (partnerId && u.id === partnerId)
    );

    const now = Date.now();
    partnerSockets.forEach((p) => {
      io.to(p.id).emit('privateMessagesRead', {
        byUsername: user.username,
        partnerUsername: p.username,
        readAt: now
      });
    });

    // Also confirm read status back to the reading socket
    socket.emit('privateMessagesRead', {
      byUsername: user.username,
      partnerUsername: partnerUsername || '',
      readAt: now
    });

    // Update read state in persistent privateChatHistory
    if (partnerUsername) {
      const pairKey = getPmPairKey(user.username, partnerUsername);
      const list = privateChatHistory.get(pairKey);
      if (list) {
        let changed = false;
        list.forEach((m) => {
          if (m.toUsername.toLowerCase() === user.username.toLowerCase() && m.status !== 'read') {
            m.status = 'read';
            m.readAt = now;
            changed = true;
          }
        });
        if (changed) {
          savePrivateChatHistory();
        }
      }
    }
  });

  // Get Persistent Private Chat History between two members from MongoDB (filtering expired self-destructs)
  socket.on('getPrivateChatHistory', ({ partnerUsername }: { partnerUsername: string }) => {
    const user = users.find((u) => u.id === socket.id);
    if (!user || !partnerUsername) return;
    const now = Date.now();
    const pairKey = getPmPairKey(user.username, partnerUsername);
    const history = (privateChatHistory.get(pairKey) || []).filter((m) => !m.selfDestructAt || m.selfDestructAt > now);
    const pmLimit = Math.max(1, messageRetentionLimits.privateMaxMessages || 100);
    socket.emit('privateChatHistory', {
      partnerUsername,
      messages: history.slice(-pmLimit)
    });
  });

  // Persistent User State Synchronization (قائمة التجاهل، المفضلة، الأصدقاء في MongoDB)
  socket.on('updateIgnoredUsers', ({ ignoredUsers }: { ignoredUsers: string[] }) => {
    const user = users.find((u) => u.id === socket.id);
    if (!user) return;
    const reg = getRegisteredMember(user.username)?.member;
    if (reg && Array.isArray(ignoredUsers)) {
      const cleaned = Array.from(new Set(ignoredUsers.filter((s): s is string => typeof s === 'string').map((s) => sanitizeText(s).slice(0, 64)).filter(Boolean)));
      reg.ignoredUsers = cleaned.slice(0, 500);
      saveMembers();
    }
  });

  socket.on('updateStarredMessages', ({ starredMessages }: { starredMessages: any[] }) => {
    const user = users.find((u) => u.id === socket.id);
    if (!user) return;
    const reg = getRegisteredMember(user.username)?.member;
    if (reg && Array.isArray(starredMessages)) {
      reg.starredMessages = starredMessages
        .filter((m) => m && typeof m === 'object')
        .slice(0, 100)
        .map((m) => ({
          id: sanitizeText(String(m.id || '')).slice(0, 80),
          username: sanitizeText(String(m.username || '')).slice(0, 64),
          ...(typeof m.displayName === 'string' && m.displayName.trim()
            ? { displayName: sanitizeText(m.displayName).slice(0, 64) }
            : {}),
          text: sanitizeText(String(m.text || '')).slice(0, 500),
          time: sanitizeText(String(m.time || '')).slice(0, 40)
        }))
        .filter((m) => Boolean(m.id && m.username));
      saveMembers();
    }
  });

  socket.on('updateFriendsList', ({ friends }: { friends: string[] }) => {
    const user = users.find((u) => u.id === socket.id);
    if (!user) return;
    const reg = getRegisteredMember(user.username)?.member;
    if (reg && Array.isArray(friends)) {
      const cleaned = Array.from(new Set(friends.filter((s): s is string => typeof s === 'string').map((s) => sanitizeText(s).slice(0, 64)).filter(Boolean)));
      reg.friends = cleaned.slice(0, 500);
      saveMembers();
    }
  });

  // Like User Profile (مرة واحدة بالدقيقة لكل عضو - يعطيه لايك واحد +1 مع إشعار عائم)
  socket.on('likeUserProfile', ({ targetUsername }: { targetUsername: string }) => {
    const sender = users.find((u) => u.id === socket.id);
    if (!sender) return;

    const cleanTarget = (targetUsername || '').trim();
    if (!cleanTarget || sender.username.toLowerCase() === cleanTarget.toLowerCase()) {
      socket.emit('systemAlert', 'لا يمكنك إعطاء لايك لملفك الشخصي 🙂');
      return;
    }

    const target = users.find((u) => u.username.toLowerCase() === cleanTarget.toLowerCase());
    if (!target) {
      socket.emit('systemAlert', 'المستخدم غير متواجد حالياً.');
      return;
    }

    const cooldownKey = `${sender.username.toLowerCase()}::${target.username.toLowerCase()}`;
    const now = Date.now();
    const lastLikeTime = userLikeCooldownMap.get(cooldownKey) || 0;
    const cooldownDuration = Math.max(5, Number(serverSecurity.likeCooldownSeconds ?? 60)) * 1000;

    if (now - lastLikeTime < cooldownDuration) {
      const remainingSec = Math.ceil((cooldownDuration - (now - lastLikeTime)) / 1000);
      socket.emit('systemAlert', `⏳ يمكنك إعطاء لايك لهذا العضو مرة واحدة كل دقيقة (متبقي ${remainingSec} ثانية).`);
      return;
    }

    // Record timestamp
    userLikeCooldownMap.set(cooldownKey, now);

    // Increment target user likes by exactly 1
    target.likes = (target.likes || 0) + 1;

    // Persist in registeredMembers if exists
    const regTargetLikes = getRegisteredMember(target.username)?.member;
    if (regTargetLikes) {
      regTargetLikes.likes = target.likes;
      saveMembers();
    }

    // Broadcast updated likes count to everyone
    io.emit('userLikesUpdated', {
      username: target.username,
      likes: target.likes
    });

    // Notify sender of success
    socket.emit('systemAlert', `أهديت إعجاباً ❤️ لـ [${target.username}]. رصيده الآن: ${target.likes} لايك 👍`);

    // Emit live floating like alert with sender avatar and name to the recipient
    io.to(target.id).emit('receivedProfileLike', {
      fromUsername: sender.username,
      fromAvatar: sender.avatarUrl || '',
      flag: sender.flag,
      likes: target.likes,
      timestamp: Date.now()
    });

    logMonitorEvent('likes', `أهدى [${sender.username}] لايك للملف الشخصي لـ [${target.username}] (المجموع: ${target.likes})`, sender.username, target.username);
  });

  // Private 1-on-1 Call Signaling (اتصال صوت وفيديو خاص)
  const resolveLiveCallTarget = (toId?: string, toUsername?: string) => {
    let target = toId ? users.find((u) => u.id === toId) : undefined;
    if (!target && toUsername) {
      const cleanName = toUsername.trim().toLowerCase();
      target = users.find((u) => u.username.trim().toLowerCase() === cleanName);
    }
    return target;
  };

  socket.on(
    'pmCallOffer',
    ({ toId, toUsername, callType }: { toId?: string; toUsername?: string; callType: 'audio' | 'video' }) => {
      const caller = users.find((u) => u.id === socket.id);
      const callee = resolveLiveCallTarget(toId, toUsername);

      if (!caller || !callee) {
        socket.emit('systemAlert', 'المستخدم غير متصل حالياً للاتصال به.');
        socket.emit('pmCallEnded', { fromId: socket.id });
        return;
      }

      if (callee.id === caller.id) {
        socket.emit('systemAlert', 'لا يمكنك إجراء مكالمة مع نفسك.');
        socket.emit('pmCallEnded', { fromId: socket.id });
        return;
      }

      if (!isSupremeHassan(caller) && caller.role !== 'admin' && caller.role !== 'super' && likesSettings.callLikes > 0 && caller.likes < likesSettings.callLikes) {
        socket.emit('systemAlert', `عفواً، تتطلب ميزة الاتصال الخاص ${likesSettings.callLikes} لايك على الأقل. رصيدك الحالي: ${caller.likes} 👍`);
        socket.emit('pmCallEnded', { fromId: socket.id });
        return;
      }

      const callId = `call-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
      socket.emit('pmCallInitiated', {
        callId,
        toId: callee.id,
        toUsername: callee.username
      });

      io.to(callee.id).emit('pmIncomingCall', {
        callId,
        fromUser: {
          id: caller.id,
          username: caller.username,
          displayName: caller.displayName || caller.username,
          avatarUrl: caller.avatarUrl,
          flag: caller.flag
        },
        callType
      });
    }
  );

  socket.on(
    'pmCallAnswer',
    ({ callId, toId, toUsername, accepted }: { callId: string; toId?: string; toUsername?: string; accepted: boolean }) => {
      const responder = users.find((u) => u.id === socket.id);
      if (!responder) return;
      const target = resolveLiveCallTarget(toId, toUsername);
      if (!target) return;

      if (accepted) {
        io.to(target.id).emit('pmCallAccepted', { callId, responderId: socket.id });
      } else {
        io.to(target.id).emit('pmCallRejected', {
          callId,
          reason: `${responder.username} رفض أو لم يستطع الرد على المكالمة.`
        });
      }
    }
  );

  socket.on(
    'pmCallSignal',
    ({ toId, toUsername, data }: { toId?: string; toUsername?: string; data: any }) => {
      const sender = users.find((u) => u.id === socket.id);
      if (!sender) return;
      const target = resolveLiveCallTarget(toId, toUsername);
      if (!target) return;
      io.to(target.id).emit('pmCallSignal', { fromId: socket.id, data });
    }
  );

  socket.on(
    'pmCallEnd',
    ({ toId, toUsername, duration, callType }: { toId?: string; toUsername?: string; duration?: number; callType?: 'audio' | 'video' }) => {
      const sender = users.find((u) => u.id === socket.id);
      const recipient = resolveLiveCallTarget(toId, toUsername);
      const destId = recipient?.id || toId;

      if (destId) {
        io.to(destId).emit('pmCallEnded', { fromId: socket.id });
      }
      socket.emit('pmCallEnded', { fromId: socket.id });

      if (sender && recipient) {
        const durationFormatted = duration && duration > 0
          ? `${Math.floor(duration / 60)}:${(duration % 60).toString().padStart(2, '0')}`
          : 'أقل من دقيقة';
        const notice: PrivateMessage = {
          id: `call-log-${Date.now()}`,
          fromId: sender.id,
          fromUsername: sender.username,
          fromAvatar: sender.avatarUrl,
          toId: recipient.id,
          toUsername: recipient.username,
          text: `📞 انتهت مكالمة ${callType === 'video' ? 'فيديو' : 'صوتية'} خاصة (${durationFormatted})`,
          isCallNotification: true,
          time: new Date().toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' }),
          timestamp: Date.now()
        };
        socket.emit('newPrivateMessage', notice);
        if (recipient.id !== socket.id) {
          io.to(recipient.id).emit('newPrivateMessage', notice);
        }
      }
    }
  );

  // Add Room (with optional Banner)
  socket.on('createRoom', async ({ name, desc, password, bannerUrl, voiceLimit }: { name: string; desc?: string; password?: string; bannerUrl?: string; voiceLimit?: number }) => {
    const admin = findSocketUser(socket.id);
    const canCreateRoom = Boolean(
      admin && (
        isSupremeHassan(admin) ||
        admin.role === 'admin' ||
        admin.role === 'super' ||
        hasPermission(admin.role, 'canChangeRoomSettings') ||
        getRoleLevel(admin.role) >= 75
      )
    );
    if (!canCreateRoom) {
      socket.emit('systemAlert', 'ليس لديك صلاحية إنشاء غرفة جديدة 🔒');
      return;
    }

    const cleanName = sanitizeText(name);
    if (!cleanName) return;
    if (chatRooms.some((r) => r.id.toLowerCase() === cleanName.toLowerCase() || r.name.toLowerCase() === cleanName.toLowerCase())) {
      socket.emit('systemAlert', `توجد غرفة بنفس الاسم [${cleanName}] بالفعل.`);
      return;
    }

    let safeBannerUrl: string | undefined;
    if (bannerUrl && String(bannerUrl).trim()) {
      const hasBannerPerm =
        isSupremeHassan(admin) ||
        admin!.role === 'admin' ||
        getRoleLevel(admin!.role) >= getRoleLevel('admin') ||
        hasPermission(admin!.role, 'canEditRoomBanner') ||
        hasPermission(admin!.role, 'canChangeRoomSettings');
      if (!hasBannerPerm) {
        socket.emit('systemAlert', 'ليس لديك صلاحية تعيين بنر للغرفة 🔒');
      } else {
        safeBannerUrl = await ensureMediaUrlNotBase64(String(bannerUrl).trim());
      }
    }

    const clampedVoiceLimit = Math.max(1, Math.min(5, Math.round(Number(voiceLimit) || 5)));
    const newRoom: ChatRoom = {
      id: cleanName,
      name: `Room | ${cleanName}`,
      desc: sanitizeText(desc) || 'غرفة جديدة في حسان برو',
      isPasswordProtected: !!password,
      password: password ? sanitizeText(password) : undefined,
      bannerUrl: safeBannerUrl || undefined,
      voiceLimit: clampedVoiceLimit,
      activeVoiceCount: 0
    };

    chatRooms.push(newRoom);
    saveChatRooms();
    broadcastRoomsUpdate();
    logMonitorEvent('room', `أنشأ [${admin!.username}] غرفة جديدة [${cleanName}]`, admin!.username);
    socket.emit('systemAlert', `تم إنشاء غرفة [${cleanName}] بنجاح!`);
  });

  // Monitor logs fetch & clear (Staff/Admin Only)
  socket.on('getMonitorLogs', () => {
    const admin = findSocketUser(socket.id);
    if (!isStaffUser(admin)) {
      return;
    }
    socket.emit('monitorLogs', monitorLogs);
    socket.emit('monitoredWordsUpdated', monitoredWords);
    socket.emit('filterAlertsList', filterAlerts);
  });

  socket.on('getFilterAlerts', () => {
    const admin = findSocketUser(socket.id);
    if (!isStaffUser(admin)) return;
    socket.emit('filterAlertsList', filterAlerts);
  });

  socket.on('clearFilterAlerts', () => {
    const admin = findSocketUser(socket.id);
    if (!admin || (!isSupremeHassan(admin) && admin.role !== 'admin' && admin.role !== 'super')) {
      socket.emit('systemAlert', 'عفواً، صلاحية مسح سجل الفلتر محصورة بالإدارة فقط.');
      return;
    }
    filterAlerts.length = 0;
    emitToAuthorizedStaff('filterAlertsList', []);
    socket.emit('systemAlert', 'تم تفريغ ومسح سجل تنبيهات الفلتر بنجاح 🧹');
  });

  socket.on('getMonitoredWords', () => {
    const admin = findSocketUser(socket.id);
    if (!isStaffUser(admin)) {
      return;
    }
    socket.emit('monitoredWordsUpdated', monitoredWords);
  });

  socket.on('addMonitoredWord', ({ word }: { word: string }) => {
    const admin = findSocketUser(socket.id);
    if (!admin || (!isSupremeHassan(admin) && admin.role !== 'admin' && admin.role !== 'super')) {
      socket.emit('systemAlert', 'عفواً، التحكم بكلمات الفلتر متاح للإدارة فقط.');
      return;
    }
    const cleanWord = sanitizeText(word?.trim());
    if (cleanWord && !monitoredWords.includes(cleanWord)) {
      monitoredWords.push(cleanWord);
      saveMonitoredWords();
      emitToAuthorizedStaff('monitoredWordsUpdated', monitoredWords);
      logMonitorEvent('role', `أضاف [${admin.username}] الكلمة [${cleanWord}] إلى فلتر المراقبة`, admin.username);
      socket.emit('systemAlert', `تمت إضافة الكلمة [${cleanWord}] إلى فلتر المراقبة.`);
    }
  });

  socket.on('removeMonitoredWord', ({ word }: { word: string }) => {
    const admin = findSocketUser(socket.id);
    if (!admin || (!isSupremeHassan(admin) && admin.role !== 'admin' && admin.role !== 'super')) {
      socket.emit('systemAlert', 'عفواً، التحكم بكلمات الفلتر متاح للإدارة فقط.');
      return;
    }
    monitoredWords = monitoredWords.filter((w) => w !== word);
    saveMonitoredWords();
    emitToAuthorizedStaff('monitoredWordsUpdated', monitoredWords);
    logMonitorEvent('role', `حذف [${admin.username}] الكلمة [${word}] من فلتر المراقبة`, admin.username);
    socket.emit('systemAlert', `تم حذف الكلمة [${word}] من فلتر المراقبة.`);
  });

  socket.on('clearMonitorLogs', () => {
    const admin = findSocketUser(socket.id);
    if (!admin || (!isSupremeHassan(admin) && admin.role !== 'admin' && admin.role !== 'super')) {
      socket.emit('systemAlert', 'عفواً، صلاحية حذف وإفراغ السجل الإداري محصورة بمدير النظام (Admin/Super) فقط.');
      return;
    }
    monitorLogs = [];
    logMonitorEvent('role', `قام ${admin.username} بحذف وإفراغ سجل المراقبة كاملاً بطلب يدوي صريح`, admin.username);
    saveAuditLogs(true);
    emitToAuthorizedStaff('monitorLogs', monitorLogs);
    socket.emit('systemAlert', 'تم حذف وإفراغ السجل الإداري كاملاً من قاعدة البيانات بنجاح 🗑️');
  });

  // Message Retention Limits Updates (تعديل سقف وحدود الرسائل مع الحذف التلقائي للأقدم)
  socket.on('updateMessageRetentionLimits', (limits: Partial<MessageRetentionLimits>) => {
    const admin = findSocketUser(socket.id);
    if (!admin || (admin.role !== 'hassan' && admin.role !== 'admin' && admin.role !== 'super' && getRoleLevel(admin.role) < 75)) {
      socket.emit('systemAlert', 'تعديل سقف وحدود الرسائل محصور بطاقم الإدارة.');
      return;
    }
    if (limits && typeof limits === 'object') {
      if (typeof limits.roomMaxMessages === 'number' && limits.roomMaxMessages > 0) {
        messageRetentionLimits.roomMaxMessages = Math.max(1, Math.floor(limits.roomMaxMessages));
      }
      if (typeof limits.wallMaxPosts === 'number' && limits.wallMaxPosts > 0) {
        messageRetentionLimits.wallMaxPosts = Math.max(1, Math.floor(limits.wallMaxPosts));
      }
      if (typeof limits.privateMaxMessages === 'number' && limits.privateMaxMessages > 0) {
        messageRetentionLimits.privateMaxMessages = Math.max(1, Math.floor(limits.privateMaxMessages));
      }
      saveMessageRetentionLimits();
      pruneRoomChatHistory();
      pruneWallPosts();
      prunePrivateChatHistory();
      saveHistory();
      saveWallPosts();
      savePrivateChatHistory();
      const retentionVersion = computeVersionHash(messageRetentionLimits);
      io.emit('messageRetentionLimitsUpdated', {
        ...messageRetentionLimits,
        version: retentionVersion
      });
      logMonitorEvent('security', `تعديل سقف الرسائل والحذف التلقائي: غرف (${messageRetentionLimits.roomMaxMessages})، حائط (${messageRetentionLimits.wallMaxPosts})، خاص (${messageRetentionLimits.privateMaxMessages}) بواسطة ${admin.username}`, admin.username);
      socket.emit('systemAlert', 'تم حفظ سقف وحدود الرسائل وتطبيق الحذف التلقائي بنجاح ✅');
    }
  });

  // =========================================================================
  // PROFILE VISITORS SYSTEM (زائري ملفي الشخصي - يظهر الاسم والصورة وعدد المرات)
  // =========================================================================
  socket.on('recordProfileVisit', ({ targetUsername }: { targetUsername: string }) => {
    const visitor = users.find((u) => u.id === socket.id);
    const cleanTarget = sanitizeText(targetUsername).trim();
    if (!visitor || !cleanTarget) return;
    if (visitor.username.toLowerCase() === cleanTarget.toLowerCase()) return; // Don't count self visits

    const targetMember = getRegisteredMember(cleanTarget)?.member;
    if (!targetMember) return;

    const nowVisit = Date.now();
    if (!(visitor as any)._visitCooldowns) (visitor as any)._visitCooldowns = new Map<string, number>();
    const visitMap: Map<string, number> = (visitor as any)._visitCooldowns;
    const lastVisitToTarget = visitMap.get(cleanTarget.toLowerCase()) || 0;
    if (nowVisit - lastVisitToTarget < 60_000) {
      return;
    }
    visitMap.set(cleanTarget.toLowerCase(), nowVisit);

    if (!Array.isArray(targetMember.visitors)) {
      targetMember.visitors = [];
    }

    const existingIndex = targetMember.visitors.findIndex(
      (v) => v.username.toLowerCase() === visitor.username.toLowerCase()
    );

    if (existingIndex !== -1) {
      targetMember.visitors[existingIndex].displayName = visitor.displayName || visitor.username;
      targetMember.visitors[existingIndex].visitCount = (targetMember.visitors[existingIndex].visitCount || 0) + 1;
      targetMember.visitors[existingIndex].lastVisitTime = Date.now();
      targetMember.visitors[existingIndex].avatarUrl = visitor.avatarUrl;
      targetMember.visitors[existingIndex].flag = visitor.flag;
      // Move to top of visitors list
      const [item] = targetMember.visitors.splice(existingIndex, 1);
      targetMember.visitors.unshift(item);
    } else {
      targetMember.visitors.unshift({
        username: visitor.username,
        displayName: visitor.displayName || visitor.username,
        avatarUrl: visitor.avatarUrl,
        flag: visitor.flag,
        visitCount: 1,
        lastVisitTime: Date.now()
      });
    }

    if (targetMember.visitors.length > 50) {
      targetMember.visitors = targetMember.visitors.slice(0, 50);
    }

    saveMembers();

    // If target user is online, emit real-time update and gentle notification
    const targetUser = users.find((u) => u.username.toLowerCase() === targetUsername.toLowerCase());
    if (targetUser) {
      io.to(targetUser.id).emit('profileVisitorsUpdated', targetMember.visitors);
      io.to(targetUser.id).emit('profileVisitedAlert', {
        visitorUsername: visitor.username,
        visitorDisplayName: visitor.displayName || visitor.username,
        visitorAvatar: visitor.avatarUrl,
        visitCount: targetMember.visitors[0].visitCount,
        time: Date.now()
      });
    }
  });

  socket.on('getProfileVisitors', () => {
    const user = users.find((u) => u.id === socket.id);
    if (!user) return;
    const visitors = getRegisteredMember(user.username)?.member.visitors || [];
    socket.emit('profileVisitorsUpdated', visitors);
  });

  // =========================================================================
  // LIVE VIDEO & AUDIO BROADCAST SYSTEM (بث مباشر فيديو وصوت حقيقي للغرفة)
  // =========================================================================
  socket.on('startLiveBroadcast', ({ room, title }: { room: string; title?: string }, callback?: (res: { ok: boolean; error?: string; broadcast?: any }) => void) => {
    const user = users.find((u) => u.id === socket.id);
    const fail = (errMsg: string) => {
      socket.emit('liveBroadcastError', errMsg);
      socket.emit('systemAlert', errMsg);
      if (typeof callback === 'function') callback({ ok: false, error: errMsg });
    };

    if (!user) {
      fail('يجب تسجيل الدخول أولاً لبدء البث المباشر.');
      return;
    }
    if (user.isJailed || !user.room || user.room === 'خارج الغرف') {
      fail('لا يمكنك بدء البث المباشر حالياً.');
      return;
    }
    if (!isSupremeHassan(user) && user.role !== 'admin' && user.role !== 'super' && !hasPermission(user.role, 'canStartLive')) {
      fail('عفواً، صلاحية بدء البث المباشر غير متاحة لرتبتك الحالية.');
      return;
    }

    // Bind live broadcast strictly to the broadcaster's current room
    const targetRoom = user.room;
    const existingLive = activeLiveBroadcasts.get(targetRoom);
    if (existingLive && existingLive.broadcasterId !== socket.id) {
      const existingSocketAlive = io.sockets.sockets.get(existingLive.broadcasterId)?.connected;
      const existingHolder = users.find((u) => u.id === existingLive.broadcasterId);
      const actorOutranks =
        isSupremeHassan(user) ||
        (existingHolder ? getRoleLevel(user.role) > getRoleLevel(existingHolder.role) : user.role === 'admin');
      if (existingSocketAlive && !actorOutranks) {
        fail(`يوجد بث مباشر نشط حالياً بواسطة [${existingLive.broadcasterUsername}] في هذه الغرفة.`);
        return;
      }
      activeLiveBroadcasts.delete(targetRoom);
      io.to(targetRoom).emit('liveBroadcastEnded', {
        room: targetRoom,
        broadcasterUsername: existingLive.broadcasterUsername
      });
    }

    // Drop any mic slot held by the broadcaster so mic audio & live audio never collide
    if (user.micSlot !== null || user.isVoice) {
      releaseUserMic(user, user.room);
    }

    const broadcast: RoomLiveBroadcast = {
      broadcasterId: socket.id,
      broadcasterUsername: user.username,
      broadcasterDisplayName: user.displayName || user.username,
      broadcasterAvatar: user.avatarUrl,
      broadcasterFlag: user.flag,
      room: targetRoom,
      title: sanitizeText(title) || `بث مباشر 🔴 ${user.displayName || user.username}`,
      startedAt: Date.now(),
      viewers: []
    };

    activeLiveBroadcasts.set(targetRoom, broadcast);
    const serialized = serializeLiveBroadcast(broadcast)!;
    io.to(targetRoom).emit('liveBroadcastStarted', serialized);
    if (typeof callback === 'function') callback({ ok: true, broadcast: serialized });

    logMonitorEvent('role', `بدأ [${user.username}] بثاً لايف مباشر (فيديو وصوت) في غرفة [${targetRoom}]`, user.username);
  });

  socket.on('endLiveBroadcast', ({ room }: { room?: string } = {}) => {
    const user = users.find((u) => u.id === socket.id);
    if (!user) return;
    const requestedRoom = room ? resolveCanonicalRoomId(room) : undefined;
    const isStaffModerator =
      isSupremeHassan(user) ||
      user.role === 'admin' ||
      user.role === 'super' ||
      hasPermission(user.role, 'canLockVoice') ||
      getRoleLevel(user.role) >= 75;
    const targetRoom = isStaffModerator && requestedRoom ? requestedRoom : user.room;
    if (!targetRoom || targetRoom === 'خارج الغرف') return;
    const broadcast = activeLiveBroadcasts.get(targetRoom);
    if (
      broadcast &&
      (broadcast.broadcasterId === socket.id ||
        broadcast.broadcasterUsername.toLowerCase() === user.username.toLowerCase() ||
        isStaffModerator)
    ) {
      activeLiveBroadcasts.delete(targetRoom);
      io.to(targetRoom).emit('liveBroadcastEnded', { room: targetRoom, broadcasterUsername: broadcast.broadcasterUsername });
    }
  });

  socket.on('getLiveBroadcast', (_payload: { room?: string } = {}) => {
    const user = users.find((u) => u.id === socket.id);
    if (!user || !user.room || user.room === 'خارج الغرف') {
      socket.emit('currentLiveBroadcast', null);
      return;
    }
    socket.emit('currentLiveBroadcast', serializeLiveBroadcast(activeLiveBroadcasts.get(user.room)));
  });

  socket.on('joinLiveViewer', (_payload: { room?: string } = {}) => {
    const viewer = users.find((u) => u.id === socket.id);
    if (!viewer || !viewer.room || viewer.room === 'خارج الغرف') {
      socket.emit('currentLiveBroadcast', null);
      return;
    }
    const targetRoom = viewer.room;
    const broadcast = activeLiveBroadcasts.get(targetRoom);
    if (broadcast) {
      if (!broadcast.viewers.includes(socket.id)) {
        broadcast.viewers.push(socket.id);
      }
      io.to(targetRoom).emit('liveViewerCountUpdated', { room: targetRoom, count: broadcast.viewers.length });
      if (broadcast.broadcasterId && broadcast.broadcasterId !== socket.id) {
        io.to(broadcast.broadcasterId).emit('liveViewerJoined', {
          viewerId: socket.id,
          viewerUsername: viewer.username || 'مشاهد'
        });
      }
    } else {
      socket.emit('currentLiveBroadcast', null);
    }
  });

  socket.on('leaveLiveViewer', (_payload: { room?: string } = {}) => {
    const viewer = users.find((u) => u.id === socket.id);
    if (!viewer || !viewer.room || viewer.room === 'خارج الغرف') {
      cleanupUserLiveState(socket.id);
      return;
    }
    const targetRoom = viewer.room;
    const broadcast = activeLiveBroadcasts.get(targetRoom);
    if (broadcast) {
      broadcast.viewers = broadcast.viewers.filter((id) => id !== socket.id);
      io.to(targetRoom).emit('liveViewerCountUpdated', { room: targetRoom, count: broadcast.viewers.length });
      if (broadcast.broadcasterId && broadcast.broadcasterId !== socket.id) {
        io.to(broadcast.broadcasterId).emit('liveViewerLeft', { viewerId: socket.id });
      }
    }
  });

  socket.on('liveSignal', ({ targetId, signal }: { targetId: string; signal: any }) => {
    if (!targetId || !signal) return;
    const sender = users.find((u) => u.id === socket.id);
    if (!sender || !sender.room || sender.room === 'خارج الغرف') return;
    const isAuthorizedLivePeer = Array.from(activeLiveBroadcasts.values()).some(
      (b) =>
        b.room === sender.room &&
        ((b.broadcasterId === socket.id && b.viewers.includes(targetId)) ||
          (b.broadcasterId === targetId && b.viewers.includes(socket.id)))
    );
    if (!isAuthorizedLivePeer) return;
    io.to(targetId).emit('liveSignal', { senderId: socket.id, senderUsername: sender.username, signal });
  });

  socket.on('requestLiveAudioFallback', (_payload: { room?: string } = {}) => {
    const viewer = users.find((u) => u.id === socket.id);
    if (!viewer || !viewer.room || viewer.room === 'خارج الغرف') return;
    const broadcast = activeLiveBroadcasts.get(viewer.room);
    if (!broadcast || !broadcast.broadcasterId || broadcast.broadcasterId === socket.id) return;
    io.to(broadcast.broadcasterId).emit('enableLiveAudioFallback', { requesterId: socket.id });
  });

  socket.on('liveAudioChunk', ({ chunk }: { room?: string; chunk: string }) => {
    const sender = users.find((u) => u.id === socket.id);
    if (!sender || !chunk || !sender.room || sender.room === 'خارج الغرف') return;
    const broadcast = activeLiveBroadcasts.get(sender.room);
    if (!broadcast || broadcast.broadcasterId !== socket.id) return;
    broadcast.viewers.forEach((viewerId) => {
      if (viewerId !== socket.id) {
        io.to(viewerId).emit('liveAudioChunk', { broadcasterId: socket.id, chunk });
      }
    });
  });

  socket.on('liveVideoFrame', ({ frameData }: { room?: string; frameData: string }) => {
    const sender = users.find((u) => u.id === socket.id);
    if (!sender || !sender.room || sender.room === 'خارج الغرف' || typeof frameData !== 'string' || !frameData || frameData.length > 220000) return;
    const broadcast = activeLiveBroadcasts.get(sender.room);
    if (!broadcast || broadcast.broadcasterId !== socket.id) return;
    broadcast.viewers.forEach((viewerId) => {
      if (viewerId !== socket.id) {
        io.to(viewerId).volatile.emit('liveVideoFrame', { broadcasterUsername: sender.username, frameData });
      }
    });
  });

  socket.on('liveReaction', ({ emoji }: { room?: string; emoji: string }) => {
    const user = users.find((u) => u.id === socket.id);
    if (!user || !user.room || user.room === 'خارج الغرف') return;
    if (!activeLiveBroadcasts.has(user.room)) return;
    io.to(user.room).emit('liveReactionReceived', { emoji, username: user.username });
  });

  // Disconnect handler: Preserves presence across phone screen locks & background sleep
  socket.on('disconnect', () => {
    socketFloodGuard.reset(socket.id);
    if (adminPanelUsers.has(socket.id) || (socket as any).__isAdminPanelSocket) {
      adminPanelUsers.delete(socket.id);
      return;
    }
    if ((socket as any).__supersededBySessionRestore) {
      return;
    }
    const disconnectedUser = users.find((u) => u.id === socket.id);
    if (disconnectedUser && disconnectedUser.room && disconnectedUser.room !== 'خارج الغرف') {
      socket.to(disconnectedUser.room).emit('userTyping', {
        userId: disconnectedUser.id,
        username: disconnectedUser.username,
        room: disconnectedUser.room,
        isTyping: false,
        timestamp: Date.now()
      });
    }

    let session: UserSession | undefined;
    for (const s of activeSessions.values()) {
      if (s.currentSocketId === socket.id) {
        session = s;
        break;
      }
    }

    // Only purge user if they EXPLICITLY triggered logout
    if (session && session.isExplicitlyLoggedOut) {
      cleanupUserLiveState(socket.id);
      const index = users.findIndex((u) => u.id === socket.id || u.username.toLowerCase() === session!.user.username.toLowerCase());
      if (index !== -1) {
        const user = users.splice(index, 1)[0];

        if (user.micSlot !== null || user.isVoice) {
          releaseUserMic(user, user.room);
        } else {
          broadcastRoomsUpdate();
        }

        logMonitorEvent('leave', `سجل ${user.username} خروجاً رسمياً من الدردشة`, user.username);

        chatRooms.forEach((r) => {
          broadcastRoomUsers(r.id);
        });
        broadcastAllUsers();
        io.emit('roomStatsUpdated', getRoomStatistics());
      }
      if (session?.user?.username) {
        const uLower = session.user.username.toLowerCase();
        if (pendingAwayTimers.has(uLower)) {
          clearTimeout(pendingAwayTimers.get(uLower)!);
          pendingAwayTimers.delete(uLower);
        }
      }
      activeSessions.delete(session.sessionToken);
      usernameToSessionMap.delete(session.user.username.toLowerCase());
      return;
    }

    // Temporary disconnect / background app switch / screen lock:
    // Keep user session 100% active and connected without disconnection.
    // The presence mark remains green (online) for 2 full minutes, then transitions to yellow (away).
    const user = users.find((u) => u.id === socket.id);
    if (user) {
      user.isSpeaking = false;
      user.lastActiveTime = Date.now();
      const uName = user.username;
      const disconnectedSocketId = socket.id;

      // Keep user as 'online' (green mark) for 5 minutes before marking 'away' (yellow mark)
      if (pendingAwayTimers.has(uName.toLowerCase())) {
        clearTimeout(pendingAwayTimers.get(uName.toLowerCase())!);
      }

      const offlineGraceMs = Math.max(15, Number(serverSecurity.offlineGraceSeconds ?? 300)) * 1000;
      const micGraceMs = Math.max(10, Number(serverSecurity.micGraceSeconds ?? 90)) * 1000;

      const awayTimer = setTimeout(() => {
        pendingAwayTimers.delete(uName.toLowerCase());
        const currentU = users.find((u) => u.username.toLowerCase() === uName.toLowerCase());
        // If socket is still disconnected after offlineGraceMs (internet lost / browser closed), mark as 'offline' (gray dot)
        // whereas 'away' (yellow dot) is reserved for users whose socket is still alive in the background.
        if (currentU && currentU.id === disconnectedSocketId) {
          currentU.presenceState = 'offline';
          io.emit('userPresenceUpdated', { userId: currentU.id, username: currentU.username, state: 'offline' });
          broadcastRoomUsers(currentU.room);
          broadcastAllUsers();
        }
      }, offlineGraceMs);

      pendingAwayTimers.set(uName.toLowerCase(), awayTimer);

      // Grace period for mic preservation on momentary disconnect / tab switch
      if (user.micSlot !== null) {
        const slotRoom = user.room;
        const slotNum = user.micSlot;
        const uLower = uName.toLowerCase();
        if (pendingMicGraceTimers.has(uLower)) {
          clearTimeout(pendingMicGraceTimers.get(uLower)!);
          pendingMicGraceTimers.delete(uLower);
        }

        const micTimer = setTimeout(() => {
          pendingMicGraceTimers.delete(uLower);
          // Check if user reconnected with a new socket ID
          const currentU = users.find((u) => u.username.toLowerCase() === uLower);
          if (!currentU || currentU.id === disconnectedSocketId || currentU.presenceState === 'offline') {
            // Still not reconnected after micGraceMs: safely free the mic slot
            if (currentU && currentU.room === slotRoom) {
              currentU.micSlot = null;
              currentU.isVoice = false;
              currentU.isSpeaking = false;
            }
            for (const sess of activeSessions.values()) {
              if (sess.user && sess.user.username.toLowerCase() === uLower) {
                sess.user.micSlot = null;
                sess.user.isVoice = false;
                sess.user.isSpeaking = false;
              }
            }
            const slots = getMicSlotsForRoom(slotRoom);
            const slot = slots.find((s) => s.slotNumber === slotNum);
            if (slot && (!slot.user || slot.user.id === disconnectedSocketId)) {
              slot.user = null;
              io.to(slotRoom).emit('micSlotsUpdated', getPublicMicSlotsForRoom(slotRoom));
              io.to(slotRoom).emit('userLeftVoice', { userId: disconnectedSocketId, username: uName, slotNumber: slotNum });
              broadcastRoomUsers(slotRoom);
              broadcastRoomsUpdate();
            }
          }
        }, micGraceMs);
        pendingMicGraceTimers.set(uLower, micTimer);
      }
    }

    if (session) {
      session.lastActiveTime = Date.now();
      session.user.isSpeaking = false;
    }

    // Clean up active live broadcast if this socket was broadcaster or viewer
    cleanupUserLiveState(socket.id);

    // Real-time online count & presence update (ghost-filtered)
    broadcastAllUsers();
  });
});

// Periodic check: Removes sessions only after the 1-hour grace period has fully expired
setInterval(() => {
  const oneHourAgo = Date.now() - 3600 * 1000;
  let changed = false;
  let sessionRemoved = false;

  for (const [token, session] of activeSessions.entries()) {
    const socketConnected = io.sockets.sockets.get(session.currentSocketId)?.connected;
    if (!socketConnected && session.lastActiveTime < oneHourAgo) {
      const uIdx = users.findIndex((u) => u.username.toLowerCase() === session.user.username.toLowerCase());
      if (uIdx !== -1) {
        const removed = users.splice(uIdx, 1)[0];
        cleanupUserLiveState(removed.id);
        if (removed.micSlot !== null || removed.isVoice) {
          releaseUserMic(removed, removed.room);
        }
        broadcastRoomUsers(removed.room);
        changed = true;
      }
      activeSessions.delete(token);
      usernameToSessionMap.delete(session.user.username.toLowerCase());
      sessionRemoved = true;
    }
  }

  // Also sweep users array directly for any disconnected or orphaned sockets inactive > 30 mins
  const thirtyMinsAgo = Date.now() - 30 * 60 * 1000;
  for (let i = users.length - 1; i >= 0; i--) {
    const u = users[i];
    if (u.isBot) continue;
    const isSocketAlive = io.sockets.sockets.get(u.id)?.connected;
    const lastActive = u.lastActiveTime || u.joinedAt || 0;
    if (!isSocketAlive && lastActive < thirtyMinsAgo) {
      const removed = users.splice(i, 1)[0];
      cleanupUserLiveState(removed.id);
      if (removed.micSlot !== null || removed.isVoice) {
        releaseUserMic(removed, removed.room);
      }
      broadcastRoomUsers(removed.room);
      changed = true;
    }
  }

  if (sessionRemoved) {
    persistActiveSessions();
  }
  if (changed) {
    broadcastAllUsers();
    broadcastRoomsUpdate();
  }
}, 60000);

app.post('/api/presence-heartbeat', express.text({ type: 'text/plain', limit: '64kb' }), (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  let payload: any = req.body;
  if (typeof payload === 'string') {
    try {
      payload = JSON.parse(payload);
    } catch {
      payload = {};
    }
  }
  const sessionToken = typeof payload?.sessionToken === 'string' ? payload.sessionToken.trim() : '';
  const username = typeof payload?.username === 'string' ? payload.username.trim() : '';
  const keepOnline = payload?.keepOnline !== false;

  if (!sessionToken) {
    return res.status(200).json({ ok: false, loggedOut: true });
  }

  const session = resolveVerifiedHttpSession(sessionToken, username);
  if (!session) {
    return res.status(200).json({ ok: false, loggedOut: true });
  }

  const now = Date.now();
  const uLower = session.user.username.toLowerCase();
  session.lastActiveTime = now;

  if (pendingAwayTimers.has(uLower)) {
    clearTimeout(pendingAwayTimers.get(uLower)!);
    pendingAwayTimers.delete(uLower);
  }

  let activeUser = users.find((u) => u.username.toLowerCase() === uLower);
  let presenceChanged = false;
  let roomAdded = false;

  if (activeUser) {
    activeUser.lastActiveTime = now;
    if (keepOnline && activeUser.presenceState !== 'online') {
      activeUser.presenceState = 'online';
      session.user.presenceState = 'online';
      presenceChanged = true;
    } else if (!keepOnline && activeUser.presenceState === 'offline') {
      activeUser.presenceState = 'away';
      session.user.presenceState = 'away';
      presenceChanged = true;
    }
  } else {
    session.user.lastActiveTime = now;
    session.user.presenceState = keepOnline ? 'online' : 'away';
    users.push(session.user);
    activeUser = session.user;
    presenceChanged = true;
    roomAdded = true;
  }

  if (presenceChanged && activeUser) {
    io.emit('userPresenceUpdated', {
      userId: activeUser.id,
      username: activeUser.username,
      state: activeUser.presenceState || 'online'
    });
    broadcastRoomUsers(activeUser.room);
    broadcastAllUsers();
    if (roomAdded) {
      io.emit('roomStatsUpdated', getRoomStatistics());
    }
  }

  const activeSocketAlive = Boolean(io.sockets.sockets.get(session.currentSocketId)?.connected);
  return res.status(200).json({
    ok: true,
    presenceState: activeUser?.presenceState || 'online',
    activeSocketAlive,
    serverTime: now
  });
});

// REST API & Health Check Endpoints
app.get(['/health', '/api/health'], (_req, res) => {
  res.status(200).json({
    status: 'healthy',
    uptime: Math.floor(process.uptime()),
    timestamp: Date.now(),
    onlineUsers: users.length,
    activeRooms: chatRooms.length,
    version: '1.0.0'
  });
});

app.get('/api/stats', (_req, res) => {
  res.json({
    onlineUsers: users.length,
    activeRooms: chatRooms.length,
    totalMessages: chatHistory.length
  });
});

async function startServer() {
  const isProd = process.env.NODE_ENV === 'production';
  let port = 3000;
  const portArgIndex = process.argv.findIndex((arg) => arg === '--port' || arg === '-p');
  if (portArgIndex !== -1 && process.argv[portArgIndex + 1]) {
    port = parseInt(process.argv[portArgIndex + 1], 10) || 3000;
  } else if (process.env.PORT) {
    port = parseInt(process.env.PORT, 10) || 3000;
  }

  let host = '0.0.0.0';
  const hostArgIndex = process.argv.findIndex((arg) => arg === '--host' || arg === '-h');
  if (hostArgIndex !== -1 && process.argv[hostArgIndex + 1]) {
    host = process.argv[hostArgIndex + 1];
  } else if (process.env.HOST) {
    host = process.env.HOST;
  }

  const isHmrDisabled = process.env.DISABLE_HMR === 'true';

  const rewriteAdminRoute = (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    if (/^\/admin(\/|$|\?)/i.test(req.url)) {
      const qIndex = req.url.indexOf('?');
      req.url = '/admin.html' + (qIndex !== -1 ? req.url.slice(qIndex) : '');
    }
    next();
  };

  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: isHmrDisabled
          ? false
          : {
              server: httpServer
            }
      },
      appType: 'mpa'
    });
    app.use(rewriteAdminRoute);
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, 'dist');
    if (fs.existsSync(distPath)) {
      app.use(
        express.static(distPath, {
          maxAge: '1d',
          etag: true,
          setHeaders: (res, filePath) => {
            const normalized = filePath.replace(/\\/g, '/');
            if (filePath.endsWith('.html') || filePath.endsWith('sw.js') || filePath.endsWith('.webmanifest')) {
              res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
              res.setHeader('Pragma', 'no-cache');
              res.setHeader('Expires', '0');
            } else if (normalized.includes('/assets/')) {
              res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
            } else {
              res.setHeader('Cache-Control', 'public, max-age=86400, stale-while-revalidate=604800');
            }
          }
        })
      );
      app.get(/^\/admin(\/.*)?$/i, (_req, res) => {
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
        const adminHtmlPath = path.join(distPath, 'admin.html');
        res.sendFile(fs.existsSync(adminHtmlPath) ? adminHtmlPath : path.join(distPath, 'index.html'));
      });
      app.get('*', (req, res, next) => {
        if (req.path.startsWith('/api/') || req.path.startsWith('/socket.io/')) {
          return next();
        }
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
        res.sendFile(path.join(distPath, 'index.html'));
      });
    } else {
      console.warn('⚠️ [Production Warning] dist/ folder not found. Falling back to dynamic Vite dev server so the app runs smoothly!');
      const { createServer: createViteServer } = await import('vite');
      const vite = await createViteServer({
        server: {
          middlewareMode: true,
          hmr: isHmrDisabled
            ? false
            : {
                server: httpServer
              }
        },
        appType: 'mpa'
      });
      app.use(rewriteAdminRoute);
      app.use(vite.middlewares);
    }
  }

  try {
    // Warm up and await storage adapter hydration so initial requests receive complete data
    await dataManager.whenReady(3000);
    console.log(`📦 Data storage ready (isCloudConnected: ${dataManager.isCloudConnected()})`);
  } catch (err) {
    console.warn('⚠️ Data storage warmup warning (proceeding with best effort):', err);
  }

  httpServer.on('error', (err: any) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`❌ Port ${port} is already in use by another process.`);
    } else {
      console.error('❌ HTTP server encountered an error:', err);
    }
  });

  httpServer.listen(port, host, () => {
    console.log(`🚀 ProChat Hassan Server running on http://${host}:${port}`);
  });

  const handleShutdown = async (signal?: string) => {
    try {
      console.log(`🛑 Server shutting down (${signal || 'manual'}), committing all pending database writes...`);
      const pendingFlushOps: Array<Promise<any>> = [];

      if (engagementMembersSaveTimer) {
        clearTimeout(engagementMembersSaveTimer);
        engagementMembersSaveTimer = null;
        pendingFlushOps.push(dataManager.saveMembers(registeredMembers).catch(() => {}));
      }
      if (saveMembersTimer) {
        clearTimeout(saveMembersTimer);
        saveMembersTimer = null;
        pendingFlushOps.push(dataManager.saveMembers(registeredMembers).catch(() => {}));
      }
      if (persistSessionsTimer) {
        clearTimeout(persistSessionsTimer);
        persistSessionsTimer = null;
        const sessionsObj: Record<string, UserSession> = {};
        for (const [token, sess] of activeSessions.entries()) {
          if (!sess.isExplicitlyLoggedOut) {
            sessionsObj[token] = sess;
          }
        }
        pendingFlushOps.push(dataManager.saveSessions(sessionsObj).catch(() => {}));
      }
      if (saveFlagCountersTimer) {
        clearTimeout(saveFlagCountersTimer);
        saveFlagCountersTimer = null;
        pendingFlushOps.push(dataManager.save('flag_counters', flagCounters).catch(() => {}));
      }
      if (saveHistoryTimer) {
        clearTimeout(saveHistoryTimer);
        saveHistoryTimer = null;
        pendingFlushOps.push(dataManager.saveChatHistory(chatHistory).catch(() => {}));
      }
      if (saveOfflinePmTimer) {
        clearTimeout(saveOfflinePmTimer);
        saveOfflinePmTimer = null;
        const offlineObj: Record<string, PrivateMessage[]> = {};
        for (const [key, msgs] of offlinePrivateMessages.entries()) {
          if (msgs && msgs.length > 0) offlineObj[key] = msgs;
        }
        pendingFlushOps.push(dataManager.saveOfflinePrivateMessages(offlineObj).catch(() => {}));
      }
      if (savePrivateChatHistoryTimer) {
        clearTimeout(savePrivateChatHistoryTimer);
        savePrivateChatHistoryTimer = null;
        const pmHistoryObj: Record<string, PrivateMessage[]> = {};
        const maxRetention = Math.max(1, messageRetentionLimits.privateMaxMessages || 100);
        for (const [pairKey, msgs] of privateChatHistory.entries()) {
          if (msgs && msgs.length > 0) pmHistoryObj[pairKey] = msgs.slice(-maxRetention);
        }
        pendingFlushOps.push(dataManager.savePrivateChatHistory(pmHistoryObj).catch(() => {}));
      }

      saveAuditLogs(true);
      saveMonitoredWords();
      saveMessageRetentionLimits();
      await Promise.all(pendingFlushOps);
      await dataManager.flush();
      io.close();
      httpServer.close();
    } catch (e) {
      console.error('Error during shutdown flush:', e);
    }
    process.exit(0);
  };

  process.on('SIGTERM', () => handleShutdown('SIGTERM'));
  process.on('SIGINT', () => handleShutdown('SIGINT'));
}

// Process-level resilience against crashes on hosting platforms
process.on('uncaughtException', (err) => {
  console.error('⚠️ Trapped Uncaught Exception:', err);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('⚠️ Trapped Unhandled Rejection at:', promise, 'reason:', reason);
});

startServer().catch((err) => {
  console.error('Failed to start server:', err);
});
