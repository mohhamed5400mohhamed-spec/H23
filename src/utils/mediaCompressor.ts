/**
 * High-performance Client-side Media Compression & Optimization Utility
 * Prevents socket buffer crashes, memory bottlenecks, and browser freezing.
 */

import { getEffectiveQualityProfile } from './networkQualityEngine';

export interface CompressionResult {
  dataUrl: string;
  type: 'image' | 'video' | 'audio';
  originalSize: number;
  compressedSize: number;
  width?: number;
  height?: number;
}

/**
 * Compresses an image file client-side using HTML5 Canvas
 * Adapts dimensions and quality automatically to network & admin quality settings.
 */
export async function compressImage(file: File, maxDimension?: number, quality?: number): Promise<CompressionResult> {
  const profile = getEffectiveQualityProfile();
  const targetMaxDim = typeof maxDimension === 'number' && maxDimension > 0 ? maxDimension : profile.imageMaxDim;
  const targetQuality = typeof quality === 'number' && quality > 0 ? quality : profile.imageQuality;
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('فشل قراءة ملف الصورة'));
    reader.onload = (e) => {
      const img = new Image();
      img.onerror = () => reject(new Error('فشل تحميل الصورة'));
      img.onload = () => {
        let width = img.width;
        let height = img.height;

        if (width > targetMaxDim || height > targetMaxDim) {
          if (width > height) {
            height = Math.round((height * targetMaxDim) / width);
            width = targetMaxDim;
          } else {
            width = Math.round((width * targetMaxDim) / height);
            height = targetMaxDim;
          }
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          return resolve({
            dataUrl: e.target?.result as string,
            type: 'image',
            originalSize: file.size,
            compressedSize: file.size,
            width,
            height
          });
        }

        // Draw image with smooth bilinear scaling
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, width, height);

        // Try WebP first for optimal compression, fallback to JPEG
        let dataUrl: string;
        try {
          dataUrl = canvas.toDataURL('image/webp', targetQuality);
          if (!dataUrl.startsWith('data:image/webp')) {
            dataUrl = canvas.toDataURL('image/jpeg', targetQuality);
          }
        } catch {
          dataUrl = canvas.toDataURL('image/jpeg', targetQuality);
        }

        const compressedSize = Math.round((dataUrl.length * 3) / 4);

        resolve({
          dataUrl,
          type: 'image',
          originalSize: file.size,
          compressedSize,
          width,
          height
        });
      };
      img.src = e.target?.result as string;
    };
    reader.readAsDataURL(file);
  });
}

export interface ImageUploadCompressionOptions {
  maxDimension?: number;
  quality?: number;
  purpose?: 'avatar' | 'banner' | 'chat' | 'emblem';
  skipCompression?: boolean;
}

/**
 * Compresses an image File directly into a smaller WebP/JPEG File for binary upload.
 * Preserves animated GIFs and vector SVGs untouched, and returns the original File
 * if compression doesn't save bytes.
 */
export async function compressImageToFile(
  file: File,
  options: ImageUploadCompressionOptions = {}
): Promise<File> {
  try {
    if (options.skipCompression) return file;
    if (!file || !file.type || !file.type.startsWith('image/')) return file;
    // Preserve animated GIFs and crisp SVGs
    if (file.type === 'image/gif' || file.type === 'image/svg+xml') return file;

    const profile = getEffectiveQualityProfile();
    let defaultMaxDim = profile.imageMaxDim;
    if (options.purpose === 'emblem') defaultMaxDim = Math.min(256, profile.imageMaxDim);
    else if (options.purpose === 'avatar') defaultMaxDim = Math.min(384, profile.imageMaxDim);
    else if (options.purpose === 'banner') defaultMaxDim = Math.min(1000, Math.max(640, profile.imageMaxDim));

    const targetMaxDim =
      typeof options.maxDimension === 'number' && options.maxDimension > 0
        ? options.maxDimension
        : defaultMaxDim;
    const targetQuality =
      typeof options.quality === 'number' && options.quality > 0
        ? options.quality
        : profile.imageQuality;

    // Tiny images don't benefit from canvas re-encoding unless resized
    if (file.size <= 24 * 1024 && options.purpose !== 'emblem' && options.purpose !== 'avatar') {
      return file;
    }

    const objectUrl = URL.createObjectURL(file);
    try {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const el = new Image();
        el.onload = () => resolve(el);
        el.onerror = () => reject(new Error('Image decode failed'));
        el.src = objectUrl;
      });

      let width = img.naturalWidth || img.width;
      let height = img.naturalHeight || img.height;
      if (!width || !height) return file;

      const needsResize = width > targetMaxDim || height > targetMaxDim;
      if (!needsResize && file.size <= 35 * 1024) {
        return file;
      }

      if (needsResize) {
        if (width > height) {
          height = Math.max(1, Math.round((height * targetMaxDim) / width));
          width = targetMaxDim;
        } else {
          width = Math.max(1, Math.round((width * targetMaxDim) / height));
          height = targetMaxDim;
        }
      }

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return file;

      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, width, height);

      const toBlobAsync = (mime: string, q: number) =>
        new Promise<Blob | null>((resolve) => {
          try {
            canvas.toBlob((b) => resolve(b), mime, q);
          } catch {
            resolve(null);
          }
        });

      let compressedBlob = await toBlobAsync('image/webp', targetQuality);
      let outExt = 'webp';
      if (!compressedBlob || compressedBlob.type !== 'image/webp') {
        compressedBlob = await toBlobAsync('image/jpeg', targetQuality);
        outExt = 'jpg';
      }

      if (!compressedBlob || compressedBlob.size === 0) return file;

      // Return compressed file if smaller OR if huge dimensions were scaled down
      if (compressedBlob.size < file.size * 0.96 || (needsResize && compressedBlob.size <= file.size)) {
        const baseName = file.name.replace(/\.[^/.]+$/, '') || 'image';
        return new File([compressedBlob], `${baseName}.${outExt}`, {
          type: compressedBlob.type,
          lastModified: Date.now()
        });
      }
      return file;
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  } catch {
    return file;
  }
}

/**
 * Handles media files (images, videos, audio) with graceful size management
 * Prevents socket disconnects and UI freezing.
 */
export async function processMediaFile(file: File): Promise<CompressionResult> {
  const isVideo = file.type.startsWith('video');
  const isAudio = file.type.startsWith('audio');
  const isImage = file.type.startsWith('image');

  if (isImage) {
    return await compressImage(file);
  }

  if (isVideo) {
    // 50MB limit matching server HTTP binary upload pipeline
    const MAX_VIDEO_SIZE = 50 * 1024 * 1024;
    if (file.size > MAX_VIDEO_SIZE) {
      throw new Error(`حجم الفيديو (${(file.size / (1024 * 1024)).toFixed(1)} ميجابايت) يتجاوز الحد الأقصى المسموح به (50 ميجابايت).`);
    }

    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('فشل قراءة ملف الفيديو'));
      reader.onload = () => {
        resolve({
          dataUrl: reader.result as string,
          type: 'video',
          originalSize: file.size,
          compressedSize: file.size
        });
      };
      reader.readAsDataURL(file);
    });
  }

  if (isAudio) {
    const MAX_AUDIO_SIZE = 20 * 1024 * 1024;
    if (file.size > MAX_AUDIO_SIZE) {
      throw new Error('حجم الملف الصوتي يتجاوز 20 ميجابايت.');
    }
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('فشل قراءة الملف الصوتي'));
      reader.onload = () => {
        resolve({
          dataUrl: reader.result as string,
          type: 'audio',
          originalSize: file.size,
          compressedSize: file.size
        });
      };
      reader.readAsDataURL(file);
    });
  }

  throw new Error('نوع الملف غير مدعوم، يرجى اختيار صورة أو فيديو أو مقطع صوتي.');
}
