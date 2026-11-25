/**
 * Shared media URL detection, normalization, and upload limit constants.
 * Ensures videos & audio with query strings and iPhone HEVC/.mov or WebM/OGG Cloudinary assets play reliably across Android & iOS.
 */

export const MAX_MEDIA_UPLOAD_MB = 50;
export const MAX_MEDIA_UPLOAD_BYTES = MAX_MEDIA_UPLOAD_MB * 1024 * 1024;

const VIDEO_EXT_PATTERN = /\.(mp4|webm|mov|m4v|ogg|3gp|mkv|avi)(\?|#|$)/i;
const STRICT_AUDIO_EXT_PATTERN = /\.(mp3|m4a|aac|wav|opus|flac)(\?|#|$)/i;
const AUDIO_OR_CONTAINER_PATTERN = /\.(mp3|m4a|aac|wav|ogg|opus|flac|webm)(\?|#|$)/i;

export function isAudioMediaUrl(url?: string | null, mediaType?: string | null): boolean {
  if (mediaType === 'audio') return true;
  if (mediaType === 'video' || mediaType === 'image' || mediaType === 'sticker') return false;
  if (!url || typeof url !== 'string') return false;
  const trimmed = url.trim();
  if (trimmed.startsWith('data:audio')) return true;
  if (trimmed.includes('voice_') && AUDIO_OR_CONTAINER_PATTERN.test(trimmed)) return true;
  return STRICT_AUDIO_EXT_PATTERN.test(trimmed);
}

export function isVideoMediaUrl(url?: string | null, mediaType?: string | null): boolean {
  if (mediaType === 'video') return true;
  if (mediaType === 'audio' || mediaType === 'image' || mediaType === 'sticker') return false;
  if (!url || typeof url !== 'string') return false;
  const trimmed = url.trim();
  if (trimmed.startsWith('data:video')) return true;
  if (trimmed.startsWith('data:audio') || STRICT_AUDIO_EXT_PATTERN.test(trimmed)) return false;
  if (trimmed.includes('voice_') && AUDIO_OR_CONTAINER_PATTERN.test(trimmed)) return false;
  return VIDEO_EXT_PATTERN.test(trimmed);
}

/**
 * Rewrites Cloudinary raw `.mov`/`.3gp`/`.mkv`/`.avi` video URLs on the fly to H.264 `.mp4`
 * (`f_mp4,vc_h264,ac_aac`) so iPhone recordings play seamlessly on Android/Chrome/Windows.
 */
export function normalizePlayableVideoUrl(url?: string | null): string {
  if (!url || typeof url !== 'string') return '';
  const trimmed = url.trim();
  if (!trimmed) return '';

  if (
    /res\.cloudinary\.com\/.+\/video\/upload\//i.test(trimmed) &&
    /\.(mov|3gp|mkv|avi)(\?|#|$)/i.test(trimmed)
  ) {
    const transformed = trimmed.includes('/video/upload/f_mp4')
      ? trimmed
      : trimmed.replace('/video/upload/', '/video/upload/f_mp4,vc_h264,ac_aac/');
    return transformed.replace(/\.(mov|3gp|mkv|avi)(?=(\?|#|$))/i, '.mp4');
  }

  return trimmed;
}

/**
 * Rewrites Cloudinary audio/voice notes (especially `.webm`/`.ogg`/`.opus` recorded on Android/Desktop)
 * to universal `MP3` (`f_mp3`) so iOS Safari and all mobile browsers play them without codec errors.
 */
export function normalizePlayableAudioUrl(url?: string | null): string {
  if (!url || typeof url !== 'string') return '';
  const trimmed = url.trim();
  if (!trimmed) return '';

  if (
    /res\.cloudinary\.com\/.+\/(video|raw)\/upload\//i.test(trimmed) &&
    /\.(webm|ogg|opus|3gp|mkv|avi|mov)(\?|#|$)/i.test(trimmed)
  ) {
    const transformed = trimmed.includes('/upload/f_mp3')
      ? trimmed
      : trimmed.replace('/upload/', '/upload/f_mp3/');
    return transformed.replace(/\.(webm|ogg|opus|3gp|mkv|avi|mov)(?=(\?|#|$))/i, '.mp3');
  }

  return normalizePlayableVideoUrl(trimmed);
}

/**
 * Extracts a lightweight audio-only MP3 stream from Cloudinary video URLs when used
 * inside background <audio> so mobile devices avoid double video downloads and container errors.
 */
export function normalizeBackgroundAudioTrackUrl(url?: string | null): string {
  if (!url || typeof url !== 'string') return '';
  const trimmed = url.trim();
  if (!trimmed) return '';

  if (
    /res\.cloudinary\.com\/.+\/video\/upload\//i.test(trimmed) &&
    /\.(mp4|m4v|mov|webm|ogg|3gp|mkv|avi)(\?|#|$)/i.test(trimmed)
  ) {
    let cleaned = trimmed.replace(/\/video\/upload\/f_mp4[^/]*\//i, '/video/upload/');
    if (!cleaned.includes('/video/upload/f_mp3')) {
      cleaned = cleaned.replace('/video/upload/', '/video/upload/f_mp3/');
    }
    return cleaned.replace(/\.(mp4|m4v|mov|webm|ogg|3gp|mkv|avi)(?=(\?|#|$))/i, '.mp3');
  }

  return normalizePlayableAudioUrl(trimmed);
}

import { getEffectiveQualityProfile } from './networkQualityEngine';

/**
 * Optimizes Cloudinary image URLs dynamically (`f_auto,q_auto:eco|good|best,c_limit,w_<max>`)
 * according to live network conditions & admin quality settings while preserving GIF animation & SVGs untouched.
 */
export function optimizeCloudinaryImageUrl(
  url?: string | null,
  options?: { maxWidth?: number; quality?: 'auto' | 'eco' | 'good' | 'best'; isAvatar?: boolean }
): string {
  if (!url || typeof url !== 'string') return '';
  const trimmed = url.trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('data:') || trimmed.startsWith('blob:')) return trimmed;
  if (!/res\.cloudinary\.com\/[^/]+\/image\/upload\//i.test(trimmed)) return trimmed;
  if (/\.svg(\?|#|$)/i.test(trimmed)) return trimmed;

  // Do not double-inject if the URL already carries explicit Cloudinary transformations
  const uploadMarker = '/image/upload/';
  const idx = trimmed.indexOf(uploadMarker);
  if (idx === -1) return trimmed;
  const afterUpload = trimmed.slice(idx + uploadMarker.length);
  const firstSegment = afterUpload.split('/')[0] || '';
  if (!/^v\d+$/.test(firstSegment) && /(f_|q_|w_|c_)/.test(firstSegment)) {
    return trimmed;
  }

  const profile = getEffectiveQualityProfile();
  let qToken = profile.cloudinaryQualityToken;
  if (options?.quality && options.quality !== 'auto') {
    qToken = `q_auto:${options.quality}` as typeof qToken;
  }
  const maxWidth = options?.maxWidth || (options?.isAvatar ? profile.cloudinaryAvatarMaxWidth : profile.cloudinaryImageMaxWidth);
  const transform = `f_auto,${qToken},c_limit,w_${maxWidth}`;
  return `${trimmed.slice(0, idx + uploadMarker.length)}${transform}/${afterUpload}`;
}
