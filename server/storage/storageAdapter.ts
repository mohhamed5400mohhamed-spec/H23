import fs from 'fs';
import path from 'path';
import { PassThrough } from 'stream';
import { fileURLToPath } from 'url';
import cloudinaryPkg, { type UploadApiResponse } from 'cloudinary';

const cloudinary = cloudinaryPkg.v2 || cloudinaryPkg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export type StorageProviderType = 'local' | 's3_compatible' | 'cloudinary' | 'supabase' | 'firebase' | 'custom_http';

export interface StorageConfig {
  provider: StorageProviderType;
  endpoint?: string;
  bucket?: string;
  region?: string;
  accessKey?: string;
  secretKey?: string;
  apiKey?: string;
  apiSecret?: string;
  authToken?: string;
  publicUrlPrefix?: string;
  localUploadsDir: string;
}

export interface MediaUploadResult {
  success: boolean;
  url: string;
  mediaType: 'image' | 'video' | 'audio' | 'file';
  size: number;
  filename: string;
  key: string;
  provider: StorageProviderType;
  error?: string;
}

export interface IStorageAdapter {
  providerName: StorageProviderType;
  saveBuffer(buffer: Buffer, originalFilename: string, mimeType?: string, folder?: string): Promise<MediaUploadResult>;
  saveStream(stream: NodeJS.ReadableStream, originalFilename: string, mimeType?: string, folder?: string): Promise<MediaUploadResult>;
  deleteFile(keyOrUrl: string): Promise<boolean>;
  isExternal(): boolean;
}

/**
 * Automatically detects and reads Storage configuration from process.env
 */
export function getStorageConfigFromEnv(): StorageConfig {
  // Prefer Railway or Render persistent volume when configured.
  const configuredUploadsDir = process.env.UPLOADS_DIR || process.env.RAILWAY_VOLUME_MOUNT_PATH;
  const rootUploadsDir = configuredUploadsDir
    ? path.resolve(configuredUploadsDir)
    : path.resolve(__dirname, '../../uploads');
  if (!fs.existsSync(rootUploadsDir)) {
    try {
      fs.mkdirSync(rootUploadsDir, { recursive: true });
    } catch {}
  }

  // 1. Automatic Cloudinary Detection (CLOUDINARY_URL, separate keys, or Cloudinary endpoint)
  const hasCloudinaryUrl = !!process.env.CLOUDINARY_URL;
  const hasCloudinaryKeys = !!(process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET);
  const endpointIsCloudinary = !!(process.env.STORAGE_ENDPOINT && process.env.STORAGE_ENDPOINT.toLowerCase().includes('cloudinary'));
  const providerIsCloudinary = (process.env.STORAGE_PROVIDER || '').toLowerCase() === 'cloudinary';

  if (hasCloudinaryUrl || hasCloudinaryKeys || endpointIsCloudinary || providerIsCloudinary) {
    const cloudName = process.env.CLOUDINARY_CLOUD_NAME || process.env.STORAGE_BUCKET || (process.env.STORAGE_ENDPOINT ? process.env.STORAGE_ENDPOINT.split('/').pop() : '');
    return {
      provider: 'cloudinary',
      endpoint: process.env.STORAGE_ENDPOINT || (cloudName ? `https://api.cloudinary.com/v1_1/${cloudName}` : 'cloudinary'),
      bucket: cloudName,
      apiKey: process.env.CLOUDINARY_API_KEY || process.env.STORAGE_API_KEY,
      apiSecret: process.env.CLOUDINARY_API_SECRET || process.env.STORAGE_AUTH_TOKEN,
      authToken: process.env.CLOUDINARY_API_SECRET || process.env.STORAGE_AUTH_TOKEN,
      localUploadsDir: rootUploadsDir
    };
  }

  const endpoint = process.env.STORAGE_ENDPOINT;
  if (endpoint && (endpoint.startsWith('http://') || endpoint.startsWith('https://'))) {
    return {
      provider: (process.env.STORAGE_PROVIDER as StorageProviderType) || 'custom_http',
      endpoint,
      bucket: process.env.STORAGE_BUCKET,
      region: process.env.STORAGE_REGION,
      apiKey: process.env.STORAGE_API_KEY,
      authToken: process.env.STORAGE_AUTH_TOKEN,
      publicUrlPrefix: process.env.STORAGE_PUBLIC_URL_PREFIX,
      localUploadsDir: rootUploadsDir
    };
  }

  if (process.env.NODE_ENV === 'production' && !configuredUploadsDir) {
    console.warn('[Storage Layer] No remote persistent media storage configured. Using local uploads directory.');
  }

  return {
    provider: 'local',
    localUploadsDir: rootUploadsDir
  };
}

/**
 * Standard Local File System Storage Adapter (High performance, streaming & static serving)
 */
export class LocalStorageAdapter implements IStorageAdapter {
  providerName: StorageProviderType = 'local';
  private uploadsDir: string;

  constructor(uploadsDir: string) {
    this.uploadsDir = uploadsDir;
    if (!fs.existsSync(this.uploadsDir)) {
      fs.mkdirSync(this.uploadsDir, { recursive: true });
    }
  }

  isExternal(): boolean {
    return false;
  }

  private static readonly ALLOWED_MEDIA_EXTENSIONS = new Set([
    'jpg', 'jpeg', 'png', 'webp', 'gif',
    'mp4', 'webm', 'mov', 'mkv',
    'mp3', 'wav', 'ogg', 'aac', 'm4a'
  ]);

  public detectExtensionAndType(filename: string, mimeType?: string): { extension: string; mediaType: 'image' | 'video' | 'audio' | 'file' } {
    let extension = path.extname(filename).replace('.', '').toLowerCase();
    const mime = (mimeType || '').toLowerCase();

    if (mime.includes('svg') || mime.includes('html') || mime.includes('javascript') || mime.includes('ecmascript')) {
      throw new Error('نوع الملف غير مسموح به لأسباب أمنية.');
    }

    if (!extension || extension === 'bin') {
      if (mime.includes('mp4')) extension = 'mp4';
      else if (mime.includes('webm')) extension = 'webm';
      else if (mime.includes('ogg')) extension = 'ogg';
      else if (mime.includes('mov') || mime.includes('quicktime')) extension = 'mov';
      else if (mime.includes('jpeg') || mime.includes('jpg')) extension = 'jpg';
      else if (mime.includes('png')) extension = 'png';
      else if (mime.includes('webp')) extension = 'webp';
      else if (mime.includes('gif')) extension = 'gif';
      else if (mime.includes('mp3') || mime.includes('mpeg')) extension = 'mp3';
      else if (mime.includes('wav')) extension = 'wav';
      else if (mime.includes('aac')) extension = 'aac';
      else if (mime.includes('m4a')) extension = 'm4a';
      else if (mime.includes('audio')) extension = 'mp3';
      else if (mime.includes('video')) extension = 'mp4';
      else if (mime.startsWith('image/')) extension = 'jpg';
    }

    if (!LocalStorageAdapter.ALLOWED_MEDIA_EXTENSIONS.has(extension)) {
      throw new Error(`صيغة الملف (.${extension || 'unknown'}) غير مسموحة. الصيغ المسموحة هي الصور والصوتيات والفيديو فقط.`);
    }

    const isVideo = ['mp4', 'webm', 'mov', 'mkv'].includes(extension) || mime.startsWith('video/');
    const isAudio = ['mp3', 'wav', 'ogg', 'aac', 'm4a'].includes(extension) || mime.startsWith('audio/');
    const isImage = ['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(extension) || (mime.startsWith('image/') && !mime.includes('svg'));

    const mediaType = isVideo ? 'video' : isAudio ? 'audio' : isImage ? 'image' : 'file';
    return { extension, mediaType };
  }

  private sanitizeFolder(folder = ''): string {
    return String(folder || '')
      .replace(/[^a-zA-Z0-9_-]/g, '')
      .slice(0, 64);
  }

  async saveBuffer(buffer: Buffer, originalFilename: string, mimeType?: string, folder = ''): Promise<MediaUploadResult> {
    const { extension, mediaType } = this.detectExtensionAndType(originalFilename, mimeType);
    if (!validateMediaMagicBytes(buffer, extension)) {
      throw new Error('محتوى الملف لا يتطابق مع صيغة وسائط صالحة (صورة/فيديو/صوت).');
    }
    const safeFolder = this.sanitizeFolder(folder);
    const safeFilename = `soqoor_${Date.now()}_${Math.random().toString(36).substring(2, 7)}.${extension}`;
    const targetDir = safeFolder ? path.join(this.uploadsDir, safeFolder) : this.uploadsDir;

    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    const targetFilePath = path.join(targetDir, safeFilename);
    await fs.promises.writeFile(targetFilePath, buffer);

    const publicUrl = safeFolder ? `/uploads/${safeFolder}/${safeFilename}` : `/uploads/${safeFilename}`;

    return {
      success: true,
      url: publicUrl,
      mediaType,
      size: buffer.length,
      filename: safeFilename,
      key: safeFilename,
      provider: 'local'
    };
  }

  async saveStream(stream: NodeJS.ReadableStream, originalFilename: string, mimeType?: string, folder = ''): Promise<MediaUploadResult> {
    const { extension, mediaType } = this.detectExtensionAndType(originalFilename, mimeType);
    const safeFolder = this.sanitizeFolder(folder);
    const safeFilename = `soqoor_${Date.now()}_${Math.random().toString(36).substring(2, 7)}.${extension}`;
    const targetDir = safeFolder ? path.join(this.uploadsDir, safeFolder) : this.uploadsDir;

    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    const targetFilePath = path.join(targetDir, safeFilename);
    const writeStream = fs.createWriteStream(targetFilePath);

    const MAX_STREAM_BYTES = 50 * 1024 * 1024;
    return new Promise((resolve, reject) => {
      let bytesReceived = 0;
      let aborted = false;
      let signatureVerified = false;
      const headChunks: Buffer[] = [];
      let headLen = 0;

      const failAbort = (err: Error) => {
        if (aborted) return;
        aborted = true;
        writeStream.destroy();
        fs.promises.unlink(targetFilePath).catch(() => {});
        reject(err);
      };

      stream.on('data', (chunk: Buffer) => {
        if (aborted) return;
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        bytesReceived += buf.length;
        if (bytesReceived > MAX_STREAM_BYTES) {
          failAbort(new Error('حجم الملف يتجاوز الحد الأقصى المسموح به (50 ميجابايت).'));
          return;
        }
        if (!signatureVerified) {
          headChunks.push(buf);
          headLen += buf.length;
          if (headLen >= 16) {
            const headBuf = Buffer.concat(headChunks, Math.min(headLen, 64));
            signatureVerified = true;
            if (!validateMediaMagicBytes(headBuf, extension)) {
              failAbort(new Error('محتوى الملف لا يتطابق مع صيغة وسائط صالحة (صورة/فيديو/صوت).'));
              return;
            }
          }
        }
      });

      stream.on('end', () => {
        if (!aborted && !signatureVerified) {
          const headBuf = Buffer.concat(headChunks);
          signatureVerified = true;
          if (!validateMediaMagicBytes(headBuf, extension)) {
            failAbort(new Error('محتوى الملف لا يتطابق مع صيغة وسائط صالحة (صورة/فيديو/صوت).'));
          }
        }
      });

      stream.on('error', (err) => failAbort(err instanceof Error ? err : new Error(String(err))));
      stream.pipe(writeStream);

      writeStream.on('finish', () => {
        if (aborted) return;
        const publicUrl = safeFolder ? `/uploads/${safeFolder}/${safeFilename}` : `/uploads/${safeFilename}`;
        resolve({
          success: true,
          url: publicUrl,
          mediaType,
          size: bytesReceived,
          filename: safeFilename,
          key: safeFilename,
          provider: 'local'
        });
      });

      writeStream.on('error', (err) => {
        if (!aborted) reject(err);
      });
    });
  }

  async deleteFile(keyOrUrl: string): Promise<boolean> {
    try {
      const normalizedKey = String(keyOrUrl || '')
        .split('?')[0]
        .replace(/^https?:\/\/[^/]+/i, '')
        .replace(/^\/?uploads\//i, '')
        .replace(/^\/+/, '');
      if (!normalizedKey) return false;
      const baseResolved = path.resolve(this.uploadsDir);
      const filePath = path.resolve(baseResolved, normalizedKey);
      if (!filePath.startsWith(baseResolved + path.sep)) {
        return false;
      }
      if (fs.existsSync(filePath)) {
        await fs.promises.unlink(filePath);
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }
}

/**
 * Universal External Cloud Storage Adapter
 * Compatible with any external HTTP endpoint, S3/R2 presigned or direct REST API, Supabase Storage, or custom CDN.
 */
export class ExternalCloudStorageAdapter implements IStorageAdapter {
  providerName: StorageProviderType;
  private config: StorageConfig;
  private localFallback: LocalStorageAdapter;

  constructor(config: StorageConfig) {
    this.config = config;
    this.providerName = config.provider;
    this.localFallback = new LocalStorageAdapter(config.localUploadsDir);
  }

  isExternal(): boolean {
    return true;
  }

  async saveBuffer(buffer: Buffer, originalFilename: string, mimeType?: string, folder = ''): Promise<MediaUploadResult> {
    const detected = this.localFallback.detectExtensionAndType(originalFilename, mimeType);
    if (!validateMediaMagicBytes(buffer, detected.extension)) {
      throw new Error('محتوى الملف لا يتطابق مع صيغة وسائط صالحة (صورة/فيديو/صوت).');
    }
    const safeFolder = folder ? String(folder).replace(/[^a-zA-Z0-9_-]/g, '') : '';
    const encodedName = encodeURIComponent(originalFilename);
    // If endpoint is set, attempt cloud upload via HTTP POST
    if (this.config.endpoint) {
      try {
        const headers: Record<string, string> = {
          'Content-Type': mimeType || 'application/octet-stream',
          'X-Filename': encodedName
        };
        if (safeFolder) {
          headers['X-Folder'] = safeFolder;
        }
        if (this.config.authToken) {
          headers['Authorization'] = `Bearer ${this.config.authToken}`;
        }
        if (this.config.apiKey) {
          headers['X-API-Key'] = this.config.apiKey;
        }

        const response = await fetch(this.config.endpoint, {
          method: 'POST',
          headers,
          body: new Uint8Array(buffer)
        });

        if (response.ok) {
          const data = await response.json().catch(() => ({}));
          const fallbackPath = safeFolder ? `${safeFolder}/${encodedName}` : encodedName;
          const remoteUrl =
            data.url ||
            data.secure_url ||
            data.link ||
            (this.config.publicUrlPrefix ? `${this.config.publicUrlPrefix.replace(/\/$/, '')}/${fallbackPath}` : null);
          if (remoteUrl && /^https?:\/\//i.test(String(remoteUrl))) {
            return {
              success: true,
              url: String(remoteUrl),
              mediaType: detected.mediaType,
              size: buffer.length,
              filename: originalFilename,
              key: data.key || originalFilename,
              provider: this.providerName
            };
          }
        }
      } catch (err) {
        console.error(`[Storage Layer] External upload failed:`, err);
        return {
          success: false,
          url: '',
          mediaType: detected.mediaType,
          size: buffer.length,
          filename: originalFilename,
          key: '',
          provider: this.providerName,
          error: 'تعذر حفظ الملف في التخزين الخارجي'
        };
      }
    }

    return {
      success: false,
      url: '',
      mediaType: 'file',
      size: buffer.length,
      filename: originalFilename,
      key: '',
      provider: this.providerName,
      error: 'لم يتم إعداد نقطة تخزين خارجية'
    };
  }

  async saveStream(stream: NodeJS.ReadableStream, originalFilename: string, mimeType?: string, folder = ''): Promise<MediaUploadResult> {
    // Validate format upfront BEFORE buffering up to 50MB in memory
    this.localFallback.detectExtensionAndType(originalFilename, mimeType);
    // Collect stream into buffer if external upload is enabled
    if (this.config.endpoint) {
      try {
        const MAX_STREAM_BYTES = 50 * 1024 * 1024;
        let totalBytes = 0;
        const chunks: Buffer[] = [];
        for await (const chunk of stream) {
          const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          totalBytes += buf.length;
          if (totalBytes > MAX_STREAM_BYTES) {
            throw new Error('حجم الملف يتجاوز الحد الأقصى المسموح به (50 ميجابايت).');
          }
          chunks.push(buf);
        }
        const fullBuffer = Buffer.concat(chunks);
        return this.saveBuffer(fullBuffer, originalFilename, mimeType, folder);
      } catch (err) {
        console.error(`[Storage Layer] Stream upload failed:`, err);
        return {
          success: false,
          url: '',
          mediaType: 'file',
          size: 0,
          filename: originalFilename,
          key: '',
          provider: this.providerName,
          error: (err as any)?.message || 'تعذر حفظ الملف في التخزين الخارجي'
        };
      }
    }

    return {
      success: false,
      url: '',
      mediaType: 'file',
      size: 0,
      filename: originalFilename,
      key: '',
      provider: this.providerName,
      error: 'لم يتم إعداد نقطة تخزين خارجية'
    };
  }

  async deleteFile(keyOrUrl: string): Promise<boolean> {
    return this.localFallback.deleteFile(keyOrUrl);
  }
}

/**
 * Official Cloudinary Storage Adapter
 * Uploads media assets (Images, Voice notes, Videos) directly to Cloudinary CDN
 * with secure HTTPS URLs and resilient local fallback.
 */
export class CloudinaryStorageAdapter implements IStorageAdapter {
  providerName: StorageProviderType = 'cloudinary';
  private localFallback: LocalStorageAdapter;
  private isConfigured: boolean = false;
  private cloudName: string = '';

  constructor(config: StorageConfig) {
    this.localFallback = new LocalStorageAdapter(config.localUploadsDir);
    this.initCloudinary(config);
  }

  private initCloudinary(config: StorageConfig) {
    try {
      if (process.env.CLOUDINARY_URL) {
        cloudinary.config();
        this.isConfigured = true;
        const match = process.env.CLOUDINARY_URL.match(/@([a-zA-Z0-9_-]+)/);
        this.cloudName = match ? match[1] : (process.env.CLOUDINARY_CLOUD_NAME || config.bucket || '');
      } else {
        const cloudName = process.env.CLOUDINARY_CLOUD_NAME || config.bucket || (config.endpoint ? config.endpoint.split('/').pop() : '');
        const apiKey = process.env.CLOUDINARY_API_KEY || config.apiKey;
        const apiSecret = process.env.CLOUDINARY_API_SECRET || config.apiSecret || config.authToken;

        if (cloudName && apiKey && apiSecret) {
          cloudinary.config({
            cloud_name: cloudName,
            api_key: apiKey,
            api_secret: apiSecret,
            secure: true
          });
          this.isConfigured = true;
          this.cloudName = cloudName;
        }
      }

      if (this.isConfigured) {
        console.log(`[Storage Layer] Initialized official Cloudinary adapter (Cloud: ${this.cloudName || 'configured'})`);
      } else {
        console.warn('[Storage Layer] Cloudinary credentials incomplete, falling back to local replica.');
      }
    } catch (err) {
      console.error('[Storage Layer] Error initializing Cloudinary:', err);
    }
  }

  isExternal(): boolean {
    return true;
  }

  private detectMediaType(filename: string, mimeType?: string): 'image' | 'video' | 'audio' | 'file' {
    const ext = path.extname(filename).replace('.', '').toLowerCase();
    const mime = (mimeType || '').toLowerCase();

    if ((mime.startsWith('image/') && !mime.includes('svg')) || ['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(ext)) {
      return 'image';
    }
    if (mime.startsWith('video/') || ['mp4', 'webm', 'mov', 'avi', 'mkv'].includes(ext)) {
      return 'video';
    }
    if (mime.startsWith('audio/') || ['mp3', 'wav', 'ogg', 'm4a', 'aac'].includes(ext)) {
      return 'audio';
    }
    return 'file';
  }

  private buildCloudinaryUploadOptions(
    originalFilename: string,
    mimeType: string | undefined,
    folder: string,
    publicId: string,
    resourceType: 'image' | 'video' | 'raw' | 'auto'
  ) {
    const ext = path.extname(originalFilename).replace('.', '').toLowerCase();
    const mime = (mimeType || '').toLowerCase();
    const isAnimatedGif = ext === 'gif' || mime.includes('gif');
    return {
      folder,
      public_id: publicId,
      resource_type: resourceType,
      overwrite: true,
      ...(resourceType === 'image' && !isAnimatedGif ? { quality: 'auto:good' } : {})
    };
  }

  async saveBuffer(buffer: Buffer, originalFilename: string, mimeType?: string, folder = 'hassanpro_chat'): Promise<MediaUploadResult> {
    const detected = this.localFallback.detectExtensionAndType(originalFilename, mimeType);
    if (!validateMediaMagicBytes(buffer, detected.extension)) {
      throw new Error('محتوى الملف لا يتطابق مع صيغة وسائط صالحة (صورة/فيديو/صوت).');
    }
    if (!this.isConfigured) {
      return this.localFallback.saveBuffer(buffer, originalFilename, mimeType, folder);
    }

    const mediaType = detected.mediaType || this.detectMediaType(originalFilename, mimeType);
    const resourceType: 'image' | 'video' | 'raw' | 'auto' = mediaType === 'video' || mediaType === 'audio' ? 'video' : mediaType === 'image' ? 'image' : 'auto';
    const safeBaseName = path.parse(originalFilename).name.replace(/[^a-zA-Z0-9_\u0600-\u06FF-]/g, '_') || 'upload';
    const publicId = `${Date.now()}_${safeBaseName}`;

    try {
      const result = await new Promise<UploadApiResponse>((resolve, reject) => {
        const uploadStream = cloudinary.uploader.upload_stream(
          this.buildCloudinaryUploadOptions(originalFilename, mimeType, folder, publicId, resourceType),
          (error, res) => {
            if (error || !res) {
              reject(error || new Error('Upload to Cloudinary returned empty response'));
            } else {
              resolve(res);
            }
          }
        );
        uploadStream.end(buffer);
      });

      return {
        success: true,
        url: result.secure_url || result.url,
        mediaType,
        size: result.bytes || buffer.length,
        filename: originalFilename,
        key: result.public_id,
        provider: 'cloudinary'
      };
    } catch (err: any) {
      console.error('[Storage Layer] Cloudinary buffer upload failed, attempting local replica fallback:', err?.message || err);
      return this.localFallback.saveBuffer(buffer, originalFilename, mimeType, folder);
    }
  }

  async saveStream(stream: NodeJS.ReadableStream, originalFilename: string, mimeType?: string, folder = 'hassanpro_chat'): Promise<MediaUploadResult> {
    // Validate allowed extensions & reject SVG/HTML/JS upfront
    const detected = this.localFallback.detectExtensionAndType(originalFilename, mimeType);
    if (!this.isConfigured) {
      return this.localFallback.saveStream(stream, originalFilename, mimeType, folder);
    }

    const mediaType = detected.mediaType || this.detectMediaType(originalFilename, mimeType);
    const resourceType: 'image' | 'video' | 'raw' | 'auto' = mediaType === 'video' || mediaType === 'audio' ? 'video' : mediaType === 'image' ? 'image' : 'auto';
    const safeBaseName = path.parse(originalFilename).name.replace(/[^a-zA-Z0-9_\u0600-\u06FF-]/g, '_') || 'upload';
    const publicId = `${Date.now()}_${safeBaseName}`;
    const MAX_STREAM_BYTES = 50 * 1024 * 1024;

    try {
      const result = await new Promise<UploadApiResponse>((resolve, reject) => {
        let settled = false;
        let bytesReceived = 0;
        let signatureVerified = false;
        const headChunks: Buffer[] = [];
        let headLen = 0;
        const gateStream = new PassThrough();

        const uploadStream = cloudinary.uploader.upload_stream(
          this.buildCloudinaryUploadOptions(originalFilename, mimeType, folder, publicId, resourceType),
          (error, res) => {
            if (settled) return;
            settled = true;
            if (error || !res) {
              reject(error || new Error('Stream upload to Cloudinary returned empty response'));
            } else {
              resolve(res);
            }
          }
        );

        const fail = (err: Error) => {
          if (settled) return;
          settled = true;
          try { gateStream.destroy(); } catch {}
          try { uploadStream.destroy(); } catch {}
          reject(err);
        };

        gateStream.pipe(uploadStream);

        stream.on('data', (chunk: Buffer) => {
          if (settled) return;
          const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          bytesReceived += buf.length;
          if (bytesReceived > MAX_STREAM_BYTES) {
            fail(new Error('حجم الملف يتجاوز الحد الأقصى المسموح به (50 ميجابايت).'));
            return;
          }
          if (!signatureVerified) {
            headChunks.push(buf);
            headLen += buf.length;
            if (headLen >= 16) {
              const combined = Buffer.concat(headChunks);
              signatureVerified = true;
              if (!validateMediaMagicBytes(combined, detected.extension)) {
                fail(new Error('محتوى الملف لا يتطابق مع صيغة وسائط صالحة (صورة/فيديو/صوت).'));
                return;
              }
              gateStream.write(combined);
            }
            return;
          }
          gateStream.write(buf);
        });
        stream.on('end', () => {
          if (settled) return;
          if (!signatureVerified) {
            const combined = Buffer.concat(headChunks);
            signatureVerified = true;
            if (!validateMediaMagicBytes(combined, detected.extension)) {
              fail(new Error('محتوى الملف لا يتطابق مع صيغة وسائط صالحة (صورة/فيديو/صوت).'));
              return;
            }
            if (combined.length > 0) gateStream.write(combined);
          }
          gateStream.end();
        });
        stream.on('error', (err) => fail(err instanceof Error ? err : new Error(String(err))));
        stream.on('aborted', () => fail(new Error('تم إلغاء رفع الملف قبل اكتماله.')));
        uploadStream.on('error', (err) => fail(err instanceof Error ? err : new Error(String(err))));
      });

      return {
        success: true,
        url: result.secure_url || result.url,
        mediaType,
        size: result.bytes || 0,
        filename: originalFilename,
        key: result.public_id,
        provider: 'cloudinary'
      };
    } catch (err: any) {
      console.error('[Storage Layer] Cloudinary stream upload failed:', err?.message || err);
      return {
        success: false,
        url: '',
        mediaType,
        size: 0,
        filename: originalFilename,
        key: '',
        provider: 'cloudinary',
        error: `تعذر رفع الملف إلى Cloudinary: ${err?.message || 'خطأ غير معروف'}`
      };
    }
  }

  async deleteFile(keyOrUrl: string): Promise<boolean> {
    try {
      let publicId = keyOrUrl;
      if (keyOrUrl.includes('cloudinary.com')) {
        const match = keyOrUrl.match(/\/upload\/(?:v\d+\/)?(.+?)\.[^/.]+$/);
        if (match && match[1]) {
          publicId = match[1];
        } else {
          const parts = keyOrUrl.split('/');
          const fileWithExt = parts.slice(-2).join('/');
          publicId = fileWithExt.replace(/\.[^/.]+$/, '');
        }
      }
      await cloudinary.uploader.destroy(publicId);
      return true;
    } catch (err) {
      console.warn('[Storage Layer] Cloudinary delete warning:', err);
      return false;
    }
  }
}

/**
 * Singleton Storage Manager providing unified, provider-agnostic media uploads
 */
export class StorageManager {
  private static instance: StorageManager;
  private adapter: IStorageAdapter;
  private config: StorageConfig;

  private constructor() {
    this.config = getStorageConfigFromEnv();
    if (this.config.provider === 'cloudinary') {
      this.adapter = new CloudinaryStorageAdapter(this.config);
      console.log(`[Storage Layer] Initialized official Cloudinary adapter (Bucket/Cloud: ${this.config.bucket || 'default'})`);
    } else if (this.config.provider !== 'local' && (this.config.endpoint || this.config.bucket)) {
      this.adapter = new ExternalCloudStorageAdapter(this.config);
      console.log(`[Storage Layer] Initialized external cloud storage adapter (${this.config.provider}) with endpoint: ${this.config.endpoint || 'configured bucket'}`);
    } else {
      this.adapter = new LocalStorageAdapter(this.config.localUploadsDir);
      console.log(`[Storage Layer] Initialized local storage adapter (Uploads directory: ${this.config.localUploadsDir})`);
    }
  }

  public static getInstance(): StorageManager {
    if (!StorageManager.instance) {
      StorageManager.instance = new StorageManager();
    }
    return StorageManager.instance;
  }

  public getAdapter(): IStorageAdapter {
    return this.adapter;
  }

  public getConfig(): StorageConfig {
    return this.config;
  }

  public isExternal(): boolean {
    return this.adapter.isExternal();
  }

  public getProviderName(): StorageProviderType {
    return this.adapter.providerName;
  }

  public async saveBuffer(buffer: Buffer, originalFilename: string, mimeType?: string, folder?: string): Promise<MediaUploadResult> {
    return this.adapter.saveBuffer(buffer, originalFilename, mimeType, folder);
  }

  public async saveStream(stream: NodeJS.ReadableStream, originalFilename: string, mimeType?: string, folder?: string): Promise<MediaUploadResult> {
    return this.adapter.saveStream(stream, originalFilename, mimeType, folder);
  }

  public async deleteFile(keyOrUrl: string): Promise<boolean> {
    return this.adapter.deleteFile(keyOrUrl);
  }
}

export function validateMediaMagicBytes(buffer: Buffer, expectedExt?: string): boolean {
  if (!Buffer.isBuffer(buffer) || buffer.length < 4) return false;
  const headText = buffer.subarray(0, Math.min(256, buffer.length)).toString('utf8').trimStart().toLowerCase();
  if (
    headText.startsWith('<svg') ||
    headText.startsWith('<?xml') ||
    headText.startsWith('<!doctype html') ||
    headText.startsWith('<html') ||
    headText.startsWith('<script')
  ) {
    return false;
  }

  const b = buffer;
  const isPng = b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a;
  const isJpg = b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
  const isGif = b.length >= 6 && (b.subarray(0, 6).toString('ascii') === 'GIF87a' || b.subarray(0, 6).toString('ascii') === 'GIF89a');
  const isWebp = b.length >= 12 && b.subarray(0, 4).toString('ascii') === 'RIFF' && b.subarray(8, 12).toString('ascii') === 'WEBP';
  const isWav = b.length >= 12 && b.subarray(0, 4).toString('ascii') === 'RIFF' && b.subarray(8, 12).toString('ascii') === 'WAVE';
  const isWebmOrMkv = b.length >= 4 && b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3;
  const isOgg = b.length >= 4 && b.subarray(0, 4).toString('ascii') === 'OggS';
  const isMp4Box = b.length >= 8 && ['ftyp', 'moov', 'mdat', 'wide', 'free'].includes(b.subarray(4, 8).toString('ascii'));
  const isId3 = b.length >= 3 && b.subarray(0, 3).toString('ascii') === 'ID3';
  const isMpegFrame = b.length >= 2 && b[0] === 0xff && (b[1] & 0xe0) === 0xe0;

  const ext = (expectedExt || '').toLowerCase();
  if (ext === 'png') return isPng || isJpg || isWebp;
  if (ext === 'jpg' || ext === 'jpeg') return isJpg || isPng || isWebp;
  if (ext === 'gif') return isGif || isWebp || isPng || isJpg;
  if (ext === 'webp') return isWebp || isPng || isJpg;
  if (ext === 'wav') return isWav || isOgg || isWebmOrMkv;
  if (ext === 'ogg') return isOgg || isWav || isWebmOrMkv;
  if (ext === 'webm' || ext === 'mkv') return isWebmOrMkv || isMp4Box || isOgg;
  if (ext === 'mp4' || ext === 'mov' || ext === 'm4a') return isMp4Box || isWebmOrMkv || isId3 || isMpegFrame;
  if (ext === 'mp3' || ext === 'aac') return isId3 || isMpegFrame || isMp4Box || isWebmOrMkv || isOgg || isWav;

  return isPng || isJpg || isGif || isWebp || isWav || isWebmOrMkv || isOgg || isMp4Box || isId3 || isMpegFrame;
}

export const storageManager = StorageManager.getInstance();
