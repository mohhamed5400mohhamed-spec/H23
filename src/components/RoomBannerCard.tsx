import React, { useState, useRef, useEffect, useCallback } from 'react';

interface BannerDimensions {
  naturalWidth: number;
  naturalHeight: number;
  renderedWidth: number;
  renderedHeight: number;
  aspectRatio: number;
}

interface RoomBannerCardProps {
  bannerUrl: string;
  roomName: string;
  maxHeight?: number;
  onClick?: () => void;
  className?: string;
  children: React.ReactNode;
}

/**
 * RoomBannerCard
 * يكتشف أبعاد بنر الغرفة الخلفي (العرض والارتفاع الفعلي والطبيعي) تلقائياً عبر onLoad و ResizeObserver،
 * ويحسب قيمة paddingTop ديناميكية وآمنة لعنصر معلومات الغرفة بحيث تبقى المعلومات دائماً في المنطقة الآمنة بالاعلى.
 */
export const RoomBannerCard: React.FC<RoomBannerCardProps> = ({
  bannerUrl,
  roomName,
  maxHeight = 240,
  onClick,
  className = '',
  children
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const infoRef = useRef<HTMLDivElement | null>(null);

  const [dims, setDims] = useState<BannerDimensions | null>(null);
  const [safePaddingTop, setSafePaddingTop] = useState<number>(10);

  const recalculateSafePadding = useCallback(() => {
    const imgEl = imgRef.current;
    const containerEl = containerRef.current;
    const infoEl = infoRef.current;
    if (!imgEl || !containerEl) return;

    const naturalWidth = imgEl.naturalWidth || 0;
    const naturalHeight = imgEl.naturalHeight || 0;
    const renderedWidth = containerEl.clientWidth || imgEl.clientWidth || 0;

    let renderedHeight = imgEl.clientHeight || 0;
    if (naturalWidth > 0 && naturalHeight > 0 && renderedWidth > 0) {
      const proportionalHeight = Math.round((renderedWidth * naturalHeight) / naturalWidth);
      renderedHeight = Math.min(maxHeight, Math.max(renderedHeight, proportionalHeight));
    }

    const aspectRatio = naturalHeight > 0 ? naturalWidth / naturalHeight : 3;
    setDims({
      naturalWidth,
      naturalHeight,
      renderedWidth,
      renderedHeight,
      aspectRatio
    });

    if (renderedHeight <= 0) {
      setSafePaddingTop(10);
      return;
    }

    // حساب paddingTop بناءً على طول البنر ونسبة أبعاده:
    // كلما زاد طول البنر، يزداد الهامش العلوي الآمن قليلاً لعدم ملامسة الحافة العليا،
    // مع ضمان ألا يدفع عنصر معلومات الغرفة للخروج من المنطقة الآمنة أو تجاوز حدود البنر.
    const infoHeight = infoEl?.offsetHeight || 44;
    const ratioFactor = aspectRatio < 2.2 ? 0.13 : aspectRatio < 3.5 ? 0.11 : 0.09;
    const desiredTop =
      renderedHeight <= 72
        ? 8
        : Math.min(32, Math.max(10, Math.round(renderedHeight * ratioFactor)));

    // الحد الأقصى الآمن الذي يبقي المعلومات بالكامل في الجزء العلوي من البنر
    const maxAllowedTop = Math.max(8, Math.round(renderedHeight - infoHeight - 10));
    const computedPaddingTop = Math.max(8, Math.min(desiredTop, maxAllowedTop));

    setSafePaddingTop(computedPaddingTop);
  }, [maxHeight]);

  useEffect(() => {
    recalculateSafePadding();
    const observer =
      typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver(() => recalculateSafePadding())
        : null;

    if (observer) {
      if (containerRef.current) observer.observe(containerRef.current);
      if (imgRef.current) observer.observe(imgRef.current);
      if (infoRef.current) observer.observe(infoRef.current);
    }

    return () => {
      observer?.disconnect();
    };
  }, [bannerUrl, recalculateSafePadding]);

  return (
    <div
      ref={containerRef}
      onClick={onClick}
      data-banner-natural={dims ? `${dims.naturalWidth}x${dims.naturalHeight}` : undefined}
      data-banner-rendered-height={dims ? Math.round(dims.renderedHeight) : undefined}
      data-safe-padding-top={safePaddingTop}
      className={`grid grid-cols-1 overflow-hidden relative ${className}`}
    >
      <img
        ref={imgRef}
        src={bannerUrl}
        alt={roomName}
        onLoad={recalculateSafePadding}
        style={{ maxHeight: `${maxHeight}px` }}
        className="col-start-1 row-start-1 w-full h-auto min-h-full object-cover select-none pointer-events-none"
        loading="lazy"
      />
      <div
        aria-hidden="true"
        className="col-start-1 row-start-1 bg-gradient-to-b from-slate-950/92 via-slate-950/40 to-transparent pointer-events-none"
      />
      <div
        ref={infoRef}
        style={{ paddingTop: `${safePaddingTop}px` }}
        className="col-start-1 row-start-1 relative z-10 self-start w-full px-3 pb-3 flex items-start justify-between gap-2 min-w-0 transition-[padding] duration-150"
      >
        {children}
      </div>
    </div>
  );
};
