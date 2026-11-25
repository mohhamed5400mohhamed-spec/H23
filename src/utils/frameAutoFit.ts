export interface FrameFitMetrics {
  mode: 'transparent-hole' | 'opaque-border';
  holeShape: 'circle' | 'rounded-square';
  avatarScale: number; // 0.76 .. 1.0
  frameWidthPct: number; // % of avatar container width
  frameHeightPct: number; // % of avatar container height
  translateXPct: number; // % of frame image width to align hole center to container center
  translateYPct: number; // % of frame image height to align hole center to container center
}

const DEFAULT_FALLBACK_FIT: FrameFitMetrics = {
  mode: 'transparent-hole',
  holeShape: 'circle',
  avatarScale: 0.9,
  frameWidthPct: 126,
  frameHeightPct: 126,
  translateXPct: 0,
  translateYPct: 0
};

const fitCache = new Map<string, FrameFitMetrics>();
const inflightMap = new Map<string, Promise<FrameFitMetrics>>();

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function measureImageElement(img: HTMLImageElement): FrameFitMetrics {
  const natW = img.naturalWidth || img.width || 128;
  const natH = img.naturalHeight || img.height || 128;
  const maxDim = 128;
  const scale = maxDim / Math.max(natW, natH);
  const w = Math.max(24, Math.round(natW * scale));
  const h = Math.max(24, Math.round(natH * scale));

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return DEFAULT_FALLBACK_FIT;

  ctx.clearRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);

  let pixels: Uint8ClampedArray;
  try {
    pixels = ctx.getImageData(0, 0, w, h).data;
  } catch {
    // Cross-origin image without CORS headers: safe balanced circular fit
    return DEFAULT_FALLBACK_FIT;
  }

  const alphaAt = (px: number, py: number): number => {
    const x = Math.max(0, Math.min(w - 1, Math.round(px)));
    const y = Math.max(0, Math.min(h - 1, Math.round(py)));
    return pixels[(y * w + x) * 4 + 3];
  };

  // 1. Check whether center area contains a transparent window
  // Scan center 30% x 30% region for transparent pixels to locate hole seed
  const SOLID_ALPHA = 90;
  const HOLE_ALPHA = 50;
  let seedX = w / 2;
  let seedY = h / 2;
  let transparentCount = 0;
  let sumTx = 0;
  let sumTy = 0;
  const scanX0 = Math.floor(w * 0.34);
  const scanX1 = Math.ceil(w * 0.66);
  const scanY0 = Math.floor(h * 0.34);
  const scanY1 = Math.ceil(h * 0.66);

  for (let y = scanY0; y <= scanY1; y++) {
    for (let x = scanX0; x <= scanX1; x++) {
      if (alphaAt(x, y) < HOLE_ALPHA) {
        transparentCount++;
        sumTx += x;
        sumTy += y;
      }
    }
  }

  const scanArea = Math.max(1, (scanX1 - scanX0 + 1) * (scanY1 - scanY0 + 1));
  const centerTransparentRatio = transparentCount / scanArea;
  const centerPixelAlpha = alphaAt(w / 2, h / 2);

  // If center has no transparent hole (e.g. JPEG or solid PNG frame), use outer bezel border mode
  if (centerTransparentRatio < 0.14 && centerPixelAlpha >= SOLID_ALPHA) {
    return {
      mode: 'opaque-border',
      holeShape: 'circle',
      avatarScale: 1,
      frameWidthPct: 100,
      frameHeightPct: 100,
      translateXPct: 0,
      translateYPct: 0
    };
  }

  if (transparentCount > 0 && centerPixelAlpha >= HOLE_ALPHA) {
    seedX = sumTx / transparentCount;
    seedY = sumTy / transparentCount;
  }

  // 2. Refine true hole center by walking cardinal spans twice
  const walkRay = (sx: number, sy: number, dx: number, dy: number): number => {
    const maxSteps = Math.max(w, h);
    let lastOpen = 0;
    for (let step = 1; step <= maxSteps; step++) {
      const x = sx + dx * step;
      const y = sy + dy * step;
      if (x < 0 || x >= w || y < 0 || y >= h) {
        // Reached image boundary without hitting frame wall: edge itself bounds the hole
        return step - 1;
      }
      if (alphaAt(x, y) >= SOLID_ALPHA) {
        return lastOpen;
      }
      lastOpen = step;
    }
    return lastOpen;
  };

  let cx = seedX;
  let cy = seedY;
  for (let pass = 0; pass < 2; pass++) {
    const rLeft = walkRay(cx, cy, -1, 0);
    const rRight = walkRay(cx, cy, 1, 0);
    const rUp = walkRay(cx, cy, 0, -1);
    const rDown = walkRay(cx, cy, 0, 1);
    cx = clamp(cx + (rRight - rLeft) / 2, w * 0.2, w * 0.8);
    cy = clamp(cy + (rDown - rUp) / 2, h * 0.2, h * 0.8);
  }

  // 3. Cast 16 rays from refined center to measure inner rim radius & shape
  const cardinalRays: number[] = [];
  const diagonalRays: number[] = [];
  const allRays: number[] = [];

  for (let i = 0; i < 16; i++) {
    const angle = (i * Math.PI) / 8;
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);
    const r = walkRay(cx, cy, dx, dy);
    allRays.push(r);
    if (i % 4 === 0) {
      cardinalRays.push(r);
    } else if (i % 4 === 2) {
      diagonalRays.push(r);
    }
  }

  const cardinalMed = median(cardinalRays);
  const diagonalMed = median(diagonalRays);
  const allMed = median(allRays);

  // If detected hole is unreasonably tiny (< 14% of width), treat as opaque overlay so photo is never covered
  const holeDiameterPx = Math.max(4, (cardinalMed > 0 ? Math.min(cardinalMed, allMed) : allMed) * 2);
  if (holeDiameterPx / Math.min(w, h) < 0.18) {
    return {
      mode: 'opaque-border',
      holeShape: 'circle',
      avatarScale: 1,
      frameWidthPct: 100,
      frameHeightPct: 100,
      translateXPct: 0,
      translateYPct: 0
    };
  }

  const holeShape: FrameFitMetrics['holeShape'] =
    cardinalMed > 4 && diagonalMed / cardinalMed > 1.18 ? 'rounded-square' : 'circle';

  // 4. Compute exact proportional scale with ~2.5% inner rim tuck so 0px empty gap & 97.5% photo visible
  const BLEED_FACTOR = 0.975;
  const rawFrameWidthRatio = (w / holeDiameterPx) * BLEED_FACTOR;
  const rawFrameHeightRatio = (h / holeDiameterPx) * BLEED_FACTOR;

  // Keep overall decorative wings compact in tight list rows by subtly scaling avatar if frame span > 168%
  const MAX_OUTER_SPAN_RATIO = 1.68;
  const maxRawSpan = Math.max(rawFrameWidthRatio, rawFrameHeightRatio);
  const avatarScale =
    maxRawSpan > MAX_OUTER_SPAN_RATIO
      ? clamp(MAX_OUTER_SPAN_RATIO / maxRawSpan, 0.76, 1)
      : 1;

  const frameWidthPct = Number((rawFrameWidthRatio * avatarScale * 100).toFixed(2));
  const frameHeightPct = Number((rawFrameHeightRatio * avatarScale * 100).toFixed(2));

  // Translate frame so detected hole center (cx, cy) aligns dead-center over container (50%, 50%)
  const translateXPct = Number((((0.5 - cx / w) * 100)).toFixed(2));
  const translateYPct = Number((((0.5 - cy / h) * 100)).toFixed(2));

  return {
    mode: 'transparent-hole',
    holeShape,
    avatarScale: Number(avatarScale.toFixed(3)),
    frameWidthPct,
    frameHeightPct,
    translateXPct: clamp(translateXPct, -28, 28),
    translateYPct: clamp(translateYPct, -28, 28)
  };
}

export function getCachedFrameFit(url?: string): FrameFitMetrics | undefined {
  if (!url) return undefined;
  return fitCache.get(url);
}

export function analyzeFrameImage(url: string): Promise<FrameFitMetrics> {
  if (!url) return Promise.resolve(DEFAULT_FALLBACK_FIT);
  const cached = fitCache.get(url);
  if (cached) return Promise.resolve(cached);

  const existing = inflightMap.get(url);
  if (existing) return existing;

  const promise = new Promise<FrameFitMetrics>((resolve) => {
    if (typeof window === 'undefined' || typeof Image === 'undefined') {
      resolve(DEFAULT_FALLBACK_FIT);
      return;
    }

    const img = new Image();
    if (/^https?:\/\//i.test(url)) {
      img.crossOrigin = 'anonymous';
    }
    img.onload = () => {
      try {
        const metrics = measureImageElement(img);
        fitCache.set(url, metrics);
        resolve(metrics);
      } catch {
        fitCache.set(url, DEFAULT_FALLBACK_FIT);
        resolve(DEFAULT_FALLBACK_FIT);
      } finally {
        inflightMap.delete(url);
      }
    };
    img.onerror = () => {
      inflightMap.delete(url);
      resolve(DEFAULT_FALLBACK_FIT);
    };
    img.src = url;
  });

  inflightMap.set(url, promise);
  return promise;
}
