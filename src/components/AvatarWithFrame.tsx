import React, { useEffect, useState } from 'react';
import { getFramePreset, isCustomImageValue } from '../constants/membershipDesigns';
import { OrnateFrameArtwork } from './OrnateFrameArtwork';
import { analyzeFrameImage, getCachedFrameFit, type FrameFitMetrics } from '../utils/frameAutoFit';
import { optimizeCloudinaryImageUrl } from '../utils/mediaUrl';

export interface AvatarWithFrameProps {
  src: string;
  alt: string;
  frame?: string;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  presenceState?: 'online' | 'away' | 'offline';
  isGhost?: boolean;
  isVoice?: boolean;
  className?: string;
  imgClassName?: string;
  grayscale?: boolean;
  showPresenceDot?: boolean;
  presenceTitle?: string;
}

const SIZE_CLASSES: Record<NonNullable<AvatarWithFrameProps['size']>, { box: string; pad: string; dot: string; corner: string }> = {
  xs: { box: 'w-9 h-9', pad: 'p-[2px]', dot: 'w-2.5 h-2.5 -top-0.5 -right-0.5', corner: 'text-[8px]' },
  sm: { box: 'w-11 h-11', pad: 'p-[2.5px]', dot: 'w-3 h-3 -top-1 -right-1', corner: 'text-[9px]' },
  md: { box: 'w-12 h-12', pad: 'p-[3px]', dot: 'w-3 h-3 -top-1 -right-1', corner: 'text-[10px]' },
  lg: { box: 'w-20 h-20', pad: 'p-[4px]', dot: 'w-4 h-4 bottom-0 left-0', corner: 'text-xs' },
  xl: { box: 'w-24 h-24', pad: 'p-[5px]', dot: 'w-4 h-4 bottom-0 left-0', corner: 'text-sm' }
};

export const AvatarWithFrame: React.FC<AvatarWithFrameProps> = React.memo(({
  src,
  alt,
  frame,
  size = 'md',
  presenceState,
  isGhost,
  isVoice,
  className = '',
  imgClassName = '',
  grayscale = false,
  showPresenceDot = false,
  presenceTitle
}) => {
  const dim = SIZE_CLASSES[size];
  const optimizedAvatarSrc = optimizeCloudinaryImageUrl(src, { isAvatar: true }) || src;
  const preset = getFramePreset(frame);
  const rawCustomFrameUrl = !preset && isCustomImageValue(frame) ? frame : undefined;
  const customFrameUrl = rawCustomFrameUrl
    ? optimizeCloudinaryImageUrl(rawCustomFrameUrl, { maxWidth: 420 }) || rawCustomFrameUrl
    : undefined;
  const [customFit, setCustomFit] = useState<FrameFitMetrics | undefined>(() =>
    customFrameUrl ? getCachedFrameFit(customFrameUrl) : undefined
  );

  useEffect(() => {
    if (!customFrameUrl) {
      setCustomFit(undefined);
      return;
    }
    const cached = getCachedFrameFit(customFrameUrl);
    if (cached) {
      setCustomFit(cached);
      return;
    }
    let cancelled = false;
    analyzeFrameImage(customFrameUrl).then((metrics) => {
      if (!cancelled) {
        setCustomFit(metrics);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [customFrameUrl]);

  const isCircle = preset?.ringStyle === 'circle' || Boolean(preset?.ornateId);
  const radiusClass = isCircle ? 'rounded-full' : size === 'lg' || size === 'xl' ? 'rounded-full' : 'rounded-lg';

  const renderPresenceDot = () => {
    if (!showPresenceDot && !isVoice) return null;
    if (showPresenceDot) {
      if (isGhost) {
        return (
          <span
            className={`absolute z-30 rounded-full bg-blue-500 border-2 border-slate-900 shadow-xs ring-1 ring-blue-400 ${dim.dot}`}
            title={presenceTitle || 'متواجد ولكن بوضع مخفي 🔵'}
          />
        );
      }
      if (presenceState === 'away') {
        return (
          <span
            className={`absolute z-30 rounded-full bg-amber-400 border-2 border-slate-900 shadow-xs animate-pulse ${dim.dot}`}
            title={presenceTitle || 'في الخلفية (بالانتظار) 🟡'}
          />
        );
      }
      if (presenceState === 'offline') {
        return (
          <span
            className={`absolute z-30 rounded-full bg-slate-400 border-2 border-slate-900 ${dim.dot}`}
            title={presenceTitle || 'غير متصل ⚪'}
          />
        );
      }
      return (
        <span
          className={`absolute z-30 rounded-full bg-emerald-500 border-2 border-slate-900 shadow-xs ${dim.dot}`}
          title={presenceTitle || 'متواجد ونشط 🟢'}
        />
      );
    }
    if (isVoice) {
      return <span className="absolute z-30 bottom-0 left-0 w-4 h-4 rounded-full bg-emerald-500 border-2 border-white" />;
    }
    return null;
  };

  // Case 1A: Ornate vector frame (wings, crowns, flames, hearts, halo, etc.)
  // Using w-[146%] h-[146%] centers the avatar rim (r = 41.10) cleanly inside the SVG ring stroke (39.2..43.8)
  const isLargeProfile = size === 'lg' || size === 'xl';

  if (preset && preset.ornateId) {
    return (
      <div
        className={`relative inline-flex items-center justify-center shrink-0 ${dim.box} ${className}`}
        style={isLargeProfile ? { filter: `drop-shadow(0 0 6px ${preset.glowColor})` } : undefined}
      >
        {/* Subtle animated aura behind circular avatar */}
        {preset.animated && (
          <div
            aria-hidden="true"
            className="absolute -inset-0.5 rounded-full opacity-45 avatar-frame-glitter pointer-events-none"
            style={{ background: preset.gradient }}
          />
        )}
        <div className="relative z-10 w-full h-full rounded-full overflow-hidden bg-slate-950">
          <img
            src={optimizedAvatarSrc}
            alt={alt}
            loading="lazy"
            decoding="async"
            className={`w-full h-full object-cover ${grayscale ? 'grayscale' : ''} ${imgClassName}`}
          />
        </div>
        <div
          aria-hidden="true"
          className="pointer-events-none select-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[146%] h-[146%] z-20 flex items-center justify-center"
        >
          <OrnateFrameArtwork ornateId={preset.ornateId} animated={preset.animated} />
        </div>
        {renderPresenceDot()}
      </div>
    );
  }

  // Case 1B: Built-in animated/glittering conic-gradient ring preset frame
  if (preset) {
    return (
      <div
        className={`relative inline-flex items-center justify-center shrink-0 ${dim.box} ${className}`}
        style={isLargeProfile ? { filter: `drop-shadow(0 0 6px ${preset.glowColor})` } : { boxShadow: `0 0 6px ${preset.glowColor}`, borderRadius: isCircle ? '9999px' : '0.5rem' }}
      >
        {/* Rotating/Glowing metallic conic ring */}
        <div
          className={`relative w-full h-full overflow-hidden ${radiusClass} ${dim.pad} ${
            preset.animated ? 'avatar-frame-glitter' : ''
          }`}
        >
          <div
            aria-hidden="true"
            className={`absolute -inset-2 ${
              preset.animated ? (preset.spinFast ? 'avatar-frame-spin-fast' : 'avatar-frame-spin') : ''
            }`}
            style={{ background: preset.gradient }}
          />
          <div className={`relative z-10 w-full h-full overflow-hidden bg-slate-950 ${radiusClass}`}>
            <img
              src={optimizedAvatarSrc}
              alt={alt}
              loading="lazy"
              decoding="async"
              className={`w-full h-full object-cover ${grayscale ? 'grayscale' : ''} ${imgClassName}`}
            />
          </div>
        </div>

        {/* Sparkling accents on corners */}
        {preset.sparkles && (
          <>
            <span
              aria-hidden="true"
              className={`pointer-events-none select-none absolute -top-1 -left-1 z-20 leading-none avatar-frame-sparkle ${dim.corner}`}
              style={{ color: preset.accentColor }}
            >
              ✦
            </span>
            <span
              aria-hidden="true"
              className={`pointer-events-none select-none absolute -bottom-1 -right-1 z-20 leading-none avatar-frame-sparkle ${dim.corner}`}
              style={{ color: preset.accentColor, animationDelay: '0.9s' }}
            >
              ✦
            </span>
          </>
        )}

        {/* Royal crown badge for kingly presets */}
        {preset.crown && (size === 'lg' || size === 'xl' || size === 'md') && (
          <span
            aria-hidden="true"
            className="pointer-events-none select-none absolute -top-2 left-1/2 -translate-x-1/2 z-20 text-[11px] leading-none drop-shadow"
          >
            👑
          </span>
        )}

        {renderPresenceDot()}
      </div>
    );
  }

  // Case 2: Uploaded custom image frame from phone — auto-fitted so photo & frame match flush
  if (customFrameUrl) {
    const fit: FrameFitMetrics = customFit || {
      mode: 'transparent-hole',
      holeShape: 'circle',
      avatarScale: 0.9,
      frameWidthPct: 126,
      frameHeightPct: 126,
      translateXPct: 0,
      translateYPct: 0
    };

    // Sub-case 2A: Opaque image (e.g., JPEG or solid PNG without transparent window) -> wrap behind avatar as bezel ring
    if (fit.mode === 'opaque-border') {
      return (
        <div className={`relative inline-flex items-center justify-center shrink-0 ${dim.box} ${className}`}>
          <div className={`relative w-full h-full rounded-full overflow-hidden ${dim.pad} shadow-md`}>
            <img
              src={customFrameUrl}
              alt="إطار العضوية"
              aria-hidden="true"
              loading="lazy"
              decoding="async"
              className="absolute inset-0 w-full h-full object-cover select-none pointer-events-none"
            />
            <div className="relative z-10 w-full h-full rounded-full overflow-hidden bg-slate-950">
              <img
                src={optimizedAvatarSrc}
                alt={alt}
                loading="lazy"
                decoding="async"
                className={`w-full h-full object-cover ${grayscale ? 'grayscale' : ''} ${imgClassName}`}
              />
            </div>
          </div>
          {renderPresenceDot()}
        </div>
      );
    }

    // Sub-case 2B: Transparent center frame -> scale avatar & frame proportionally so they lock flush
    const customRadius = fit.holeShape === 'rounded-square' ? 'rounded-xl' : 'rounded-full';
    const avatarSizePct = `${(fit.avatarScale * 100).toFixed(1)}%`;

    return (
      <div className={`relative inline-flex items-center justify-center shrink-0 ${dim.box} ${className}`}>
        <div
          className={`relative z-10 overflow-hidden bg-slate-950 shadow-sm ${customRadius}`}
          style={{ width: avatarSizePct, height: avatarSizePct }}
        >
          <img
            src={optimizedAvatarSrc}
            alt={alt}
            loading="lazy"
            decoding="async"
            className={`w-full h-full object-cover ${grayscale ? 'grayscale' : ''} ${imgClassName}`}
          />
        </div>
        <img
          src={customFrameUrl}
          alt="إطار العضوية"
          aria-hidden="true"
          loading="lazy"
          decoding="async"
          className="pointer-events-none select-none absolute left-1/2 top-1/2 z-20 drop-shadow-md max-w-none max-h-none"
          style={{
            width: `${fit.frameWidthPct}%`,
            height: `${fit.frameHeightPct}%`,
            transform: `translate(${-50 + fit.translateXPct}%, ${-50 + fit.translateYPct}%)`
          }}
        />
        {renderPresenceDot()}
      </div>
    );
  }

  // Case 3: Default standard avatar (no frame)
  return (
    <div className={`relative inline-flex items-center justify-center shrink-0 ${dim.box} ${className}`}>
      <img
        src={optimizedAvatarSrc}
        alt={alt}
        loading="lazy"
        decoding="async"
        className={`w-full h-full ${radiusClass} object-cover border border-amber-500/50 shadow-sm ${grayscale ? 'grayscale' : ''} ${imgClassName}`}
      />
      {renderPresenceDot()}
    </div>
  );
});
AvatarWithFrame.displayName = 'AvatarWithFrame';
