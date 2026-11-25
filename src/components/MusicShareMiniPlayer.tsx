import React, { useEffect, useRef, useState } from 'react';
import {
  Music,
  Play,
  Pause,
  Square,
  Volume2,
  VolumeX,
  Minimize2,
  Maximize2,
  RefreshCw,
  Mic,
  MicOff,
  RotateCcw,
  RotateCw,
  GripHorizontal
} from 'lucide-react';
import type { SharedMusicState } from '../utils/audioMesh';

interface MusicShareMiniPlayerProps {
  musicState: SharedMusicState;
  isMicMuted: boolean;
  onTogglePlayPause: () => void;
  onStop: () => void;
  onSeek: (seconds: number) => void;
  onVolumeChange: (percent: number) => void;
  onReplaceTrack: () => void;
  onToggleMicMute?: () => void;
}

function formatTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '00:00';
  const total = Math.floor(sec);
  const hrs = Math.floor(total / 3600);
  const mins = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  if (hrs > 0) return `${hrs}:${pad(mins)}:${pad(secs)}`;
  return `${pad(mins)}:${pad(secs)}`;
}

export const MusicShareMiniPlayer: React.FC<MusicShareMiniPlayerProps> = ({
  musicState,
  isMicMuted,
  onTogglePlayPause,
  onStop,
  onSeek,
  onVolumeChange,
  onReplaceTrack,
  onToggleMicMute
}) => {
  const [sizeMode, setSizeMode] = useState<'minimized' | 'compact' | 'expanded'>('compact');
  const [lastVolumeBeforeMute, setLastVolumeBeforeMute] = useState<number>(75);
  const [position, setPosition] = useState<{ x: number; y: number }>(() => {
    if (typeof window === 'undefined') return { x: 12, y: 140 };
    const defaultW = Math.min(325, Math.max(240, window.innerWidth - 16));
    return {
      x: Math.max(8, Math.round((window.innerWidth - defaultW) / 2)),
      y: Math.max(70, window.innerHeight - 285)
    };
  });
  const [isDragging, setIsDragging] = useState(false);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const dragSessionRef = useRef<{
    pointerId: number;
    startClientX: number;
    startClientY: number;
    startPosX: number;
    startPosY: number;
    moved: boolean;
    restoreOnTap: boolean;
  } | null>(null);

  const clampPositionToViewport = (rawX: number, rawY: number) => {
    if (typeof window === 'undefined') return { x: rawX, y: rawY };
    const rect = containerRef.current?.getBoundingClientRect();
    const width = rect?.width || (sizeMode === 'minimized' ? 124 : sizeMode === 'expanded' ? 355 : 320);
    const height = rect?.height || (sizeMode === 'minimized' ? 42 : 180);
    const maxX = Math.max(8, window.innerWidth - width - 8);
    const maxY = Math.max(8, window.innerHeight - height - 8);
    return {
      x: Math.max(8, Math.min(maxX, Math.round(rawX))),
      y: Math.max(8, Math.min(maxY, Math.round(rawY)))
    };
  };

  useEffect(() => {
    if (!musicState.isActive) return;
    const raf = requestAnimationFrame(() => {
      setPosition((prev) => clampPositionToViewport(prev.x, prev.y));
    });
    const onResize = () => {
      setPosition((prev) => clampPositionToViewport(prev.x, prev.y));
    };
    window.addEventListener('resize', onResize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
    };
  }, [sizeMode, musicState.isActive]);

  useEffect(() => {
    const handlePointerMove = (e: PointerEvent) => {
      const sess = dragSessionRef.current;
      if (!sess || e.pointerId !== sess.pointerId) return;
      const dx = e.clientX - sess.startClientX;
      const dy = e.clientY - sess.startClientY;
      if (!sess.moved && Math.hypot(dx, dy) >= 5) {
        sess.moved = true;
        setIsDragging(true);
      }
      if (sess.moved) {
        setPosition(clampPositionToViewport(sess.startPosX + dx, sess.startPosY + dy));
      }
    };

    const handlePointerUp = (e: PointerEvent) => {
      const sess = dragSessionRef.current;
      if (!sess || e.pointerId !== sess.pointerId) return;
      const wasMoved = sess.moved;
      const shouldRestore = sess.restoreOnTap;
      dragSessionRef.current = null;
      setIsDragging(false);
      if (!wasMoved && shouldRestore) {
        setSizeMode('compact');
      }
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerUp);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerUp);
    };
  }, [sizeMode]);

  if (!musicState.isActive) return null;

  const duration = Number.isFinite(musicState.duration) && musicState.duration > 0 ? musicState.duration : 0;
  const currentTime = Number.isFinite(musicState.currentTime)
    ? Math.min(duration || musicState.currentTime, Math.max(0, musicState.currentTime))
    : 0;
  const progressPercent = duration > 0 ? Math.min(100, (currentTime / duration) * 100) : 0;

  const handleToggleSongMute = () => {
    if (musicState.volume > 0) {
      setLastVolumeBeforeMute(musicState.volume);
      onVolumeChange(0);
    } else {
      onVolumeChange(lastVolumeBeforeMute > 0 ? lastVolumeBeforeMute : 75);
    }
  };

  const beginDrag = (e: React.PointerEvent, restoreOnTap = false) => {
    const target = e.target as HTMLElement | null;
    if (target && target.closest('button, input, [data-no-drag="true"]')) {
      return;
    }
    e.preventDefault();
    dragSessionRef.current = {
      pointerId: e.pointerId,
      startClientX: e.clientX,
      startClientY: e.clientY,
      startPosX: position.x,
      startPosY: position.y,
      moved: false,
      restoreOnTap
    };
  };

  // Ultra-tiny minimized floating pill (draggable anywhere on screen; tap music icon to restore)
  if (sizeMode === 'minimized') {
    return (
      <div
        ref={containerRef}
        dir="rtl"
        style={{ left: `${position.x}px`, top: `${position.y}px` }}
        onPointerDown={(e) => beginDrag(e, true)}
        className={`fixed z-40 pointer-events-auto touch-none select-none ${
          isDragging ? 'scale-105 cursor-grabbing' : 'cursor-grab'
        } transition-transform`}
        title="اسحب لتحريك الأيقونة لأي مكان • انقر على النغمة لفتح التحكم"
      >
        <div className="bg-[#1b140e]/95 backdrop-blur-md border-2 border-amber-500 rounded-full p-1 shadow-2xl flex items-center gap-1 text-amber-100">
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-amber-500 to-amber-600 text-slate-950 flex items-center justify-center relative shrink-0 shadow-sm">
            <Music className={`w-4 h-4 ${musicState.isPlaying ? 'animate-pulse' : ''}`} />
            <span
              className={`absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border border-slate-950 ${
                musicState.isPlaying ? 'bg-emerald-400 animate-ping' : 'bg-amber-300'
              }`}
            />
          </div>

          <button
            type="button"
            onClick={onTogglePlayPause}
            className="w-7 h-7 rounded-full bg-slate-800 hover:bg-slate-700 text-amber-300 border border-amber-500/40 flex items-center justify-center cursor-pointer transition-colors"
            title={musicState.isPlaying ? 'إيقاف مؤقت' : 'تشغيل'}
          >
            {musicState.isPlaying ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5 translate-x-[0.5px]" />}
          </button>

          <button
            type="button"
            onClick={onStop}
            className="w-7 h-7 rounded-full bg-rose-600 hover:bg-rose-500 text-white flex items-center justify-center cursor-pointer transition-colors"
            title="إيقاف الأغنية كاملة"
          >
            <Square className="w-2.5 h-2.5 fill-current" />
          </button>
        </div>
      </div>
    );
  }

  const isExpanded = sizeMode === 'expanded';
  const cardWidth = isExpanded ? 'w-[min(94vw,375px)]' : 'w-[min(92vw,325px)]';

  return (
    <div
      ref={containerRef}
      dir="rtl"
      style={{ left: `${position.x}px`, top: `${position.y}px` }}
      className={`fixed z-40 pointer-events-auto ${cardWidth} ${isDragging ? 'opacity-95 scale-[1.01]' : ''}`}
    >
      <div className="bg-[#1b140e]/95 backdrop-blur-md border-2 border-amber-500/90 rounded-2xl shadow-2xl overflow-hidden text-slate-100">
        {/* Draggable Header Bar */}
        <div
          onPointerDown={(e) => beginDrag(e, false)}
          className={`bg-gradient-to-l from-[#3b2918] via-[#2b1e12] to-[#1e140c] px-2.5 py-1.5 flex items-center justify-between gap-2 border-b border-amber-500/30 touch-none select-none ${
            isDragging ? 'cursor-grabbing' : 'cursor-grab'
          }`}
          title="اسحب من هنا لتحريك النافذة لأي مكان على الشاشة"
        >
          <div className="flex items-center gap-1.5 min-w-0 flex-1">
            <span className="w-6 h-6 rounded-lg bg-amber-500/20 border border-amber-400/50 flex items-center justify-center shrink-0">
              <Music className={`w-3.5 h-3.5 text-amber-400 ${musicState.isPlaying ? 'animate-pulse' : ''}`} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-[11px] font-black text-amber-200 truncate flex items-center gap-1" title={musicState.trackName}>
                <GripHorizontal className="w-3 h-3 text-amber-400/70 shrink-0" />
                <span className="truncate">{musicState.trackName}</span>
              </div>
              <div className="text-[9px] text-amber-300/80 flex items-center gap-1.5">
                <span className={musicState.isPlaying ? 'text-emerald-400 font-bold' : 'text-amber-300'}>
                  {musicState.isPlaying ? '● يبث للغرفة الآن' : '⏸ متوقف مؤقتاً'}
                </span>
                {isExpanded && (
                  <span className="text-slate-300 truncate">
                    • {isMicMuted ? 'المايك مكتوم (موسيقى فقط)' : 'مايكك + الموسيقى معاً'}
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={() => setSizeMode(isExpanded ? 'compact' : 'expanded')}
              className="w-6 h-6 rounded-lg bg-black/40 hover:bg-black/70 text-amber-300 border border-amber-500/30 flex items-center justify-center cursor-pointer transition-colors"
              title={isExpanded ? 'تقليص حجم النافذة' : 'توسيع النافذة قليلاً'}
            >
              {isExpanded ? <Minimize2 className="w-3 h-3" /> : <Maximize2 className="w-3 h-3" />}
            </button>
            <button
              type="button"
              onClick={() => setSizeMode('minimized')}
              className="w-6 h-6 rounded-lg bg-black/40 hover:bg-black/70 text-slate-200 border border-slate-600/60 flex items-center justify-center cursor-pointer transition-colors"
              title="تصغير النافذة تماماً إلى أيقونة صغيرة"
            >
              <span className="text-[11px] font-black leading-none mb-1">—</span>
            </button>
            <button
              type="button"
              onClick={onStop}
              className="w-6 h-6 rounded-lg bg-rose-600/90 hover:bg-rose-600 text-white flex items-center justify-center cursor-pointer transition-colors"
              title="إيقاف الأغنية كاملة"
            >
              <Square className="w-3 h-3 fill-current" />
            </button>
          </div>
        </div>

        {/* Body Controls */}
        <div className={`${isExpanded ? 'p-3 space-y-2.5' : 'p-2.5 space-y-2'}`}>
          {/* Seek / Scrub Bar */}
          <div className="space-y-1">
            <div className="flex items-center justify-between text-[10px] font-mono text-amber-200/90 px-0.5">
              <span>{formatTime(currentTime)}</span>
              {isExpanded && (
                <span className="text-[9px] text-slate-400 font-sans">اسحب الشريط لتقديم أو تأخير الأغنية</span>
              )}
              <span>{formatTime(duration)}</span>
            </div>
            <div dir="ltr" className="relative flex items-center">
              <input
                type="range"
                min={0}
                max={duration > 0 ? duration : 100}
                step={0.5}
                value={duration > 0 ? currentTime : 0}
                disabled={duration <= 0}
                onChange={(e) => onSeek(Number(e.target.value))}
                style={{
                  background: `linear-gradient(to right, #f59e0b ${progressPercent}%, rgba(255,255,255,0.16) ${progressPercent}%)`
                }}
                className="w-full h-2 rounded-full appearance-none cursor-pointer accent-amber-400 disabled:opacity-50"
                title="شريط تقديم وتأخير الأغنية"
              />
            </div>
          </div>

          {/* Primary Action Buttons */}
          <div className="flex items-center justify-between gap-1.5">
            <div className="flex items-center gap-1.5">
              {/* Pause / Play */}
              <button
                type="button"
                onClick={onTogglePlayPause}
                className={`px-2.5 ${isExpanded ? 'py-1.5 text-xs' : 'py-1 text-[11px]'} rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-black flex items-center gap-1 cursor-pointer transition-colors shadow-xs`}
                title={musicState.isPlaying ? 'إيقاف مؤقت' : 'استئناف التشغيل'}
              >
                {musicState.isPlaying ? (
                  <>
                    <Pause className="w-3.5 h-3.5" />
                    <span>إيقاف مؤقت</span>
                  </>
                ) : (
                  <>
                    <Play className="w-3.5 h-3.5" />
                    <span>تشغيل</span>
                  </>
                )}
              </button>

              {/* Replace Song */}
              <button
                type="button"
                onClick={onReplaceTrack}
                className={`px-2.5 ${isExpanded ? 'py-1.5 text-xs' : 'py-1 text-[11px]'} rounded-xl bg-slate-800 hover:bg-slate-700 text-amber-200 border border-amber-500/40 font-bold flex items-center gap-1 cursor-pointer transition-colors`}
                title="فتح التخزين لاختيار أغنية بديلة"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>استبدال</span>
              </button>

              {/* Full Stop */}
              <button
                type="button"
                onClick={onStop}
                className={`px-2 ${isExpanded ? 'py-1.5 text-xs' : 'py-1 text-[11px]'} rounded-xl bg-rose-600/90 hover:bg-rose-600 text-white font-bold flex items-center gap-1 cursor-pointer transition-colors`}
                title="إيقاف الأغنية كاملة وإغلاق النافذة"
              >
                <Square className="w-3 h-3 fill-current" />
                <span>إيقاف</span>
              </button>
            </div>

            {/* Quick mic mute toggle right inside player */}
            {onToggleMicMute && (
              <button
                type="button"
                onClick={onToggleMicMute}
                className={`${isExpanded ? 'px-2 py-1.5' : 'px-1.5 py-1'} rounded-xl border text-[10px] font-bold flex items-center gap-1 cursor-pointer transition-colors shrink-0 ${
                  isMicMuted
                    ? 'bg-slate-800 hover:bg-slate-700 text-rose-300 border-rose-500/40'
                    : 'bg-emerald-900/70 hover:bg-emerald-800 text-emerald-200 border-emerald-500/50'
                }`}
                title={isMicMuted ? 'فتح المايك للتحدث مع الأغنية' : 'كتم المايك وإبقاء الأغنية شغالة'}
              >
                {isMicMuted ? <MicOff className="w-3 h-3" /> : <Mic className="w-3 h-3" />}
                {isExpanded && <span>{isMicMuted ? 'المايك مكتوم' : 'صوتي مفتوح'}</span>}
              </button>
            )}
          </div>

          {/* Quick Skip Buttons (shown cleanly in Expanded mode) */}
          {isExpanded && (
            <div className="flex items-center justify-between gap-2 pt-0.5">
              <button
                type="button"
                onClick={() => onSeek(Math.max(0, currentTime - 10))}
                disabled={duration <= 0}
                className="flex-1 py-1 rounded-lg bg-slate-800/90 hover:bg-slate-700 text-amber-200 border border-slate-700 text-[10px] font-bold flex items-center justify-center gap-1 cursor-pointer disabled:opacity-40 transition-colors"
              >
                <RotateCcw className="w-3 h-3" />
                <span>ترجيع 10ث</span>
              </button>
              <button
                type="button"
                onClick={() => onSeek(currentTime + 10)}
                disabled={duration <= 0}
                className="flex-1 py-1 rounded-lg bg-slate-800/90 hover:bg-slate-700 text-amber-200 border border-slate-700 text-[10px] font-bold flex items-center justify-center gap-1 cursor-pointer disabled:opacity-40 transition-colors"
              >
                <span>تقديم 10ث</span>
                <RotateCw className="w-3 h-3" />
              </button>
            </div>
          )}

          {/* Song Volume Slider */}
          <div className="flex items-center gap-2 bg-black/30 rounded-xl px-2 py-1.5 border border-amber-500/20">
            <button
              type="button"
              onClick={handleToggleSongMute}
              className="text-amber-300 hover:text-amber-200 cursor-pointer shrink-0"
              title={musicState.volume > 0 ? 'كتم صوت الأغنية مؤقتاً' : 'إعادة صوت الأغنية'}
            >
              {musicState.volume > 0 ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4 text-rose-400" />}
            </button>
            <span className="text-[10px] font-bold text-slate-300 shrink-0">صوت الأغنية</span>
            <div dir="ltr" className="flex-1 flex items-center">
              <input
                type="range"
                min={0}
                max={100}
                step={1}
                value={musicState.volume}
                onChange={(e) => onVolumeChange(Number(e.target.value))}
                style={{
                  background: `linear-gradient(to right, #10b981 ${musicState.volume}%, rgba(255,255,255,0.16) ${musicState.volume}%)`
                }}
                className="w-full h-1.5 rounded-full appearance-none cursor-pointer accent-emerald-400"
                title="التحكم بمستوى صوت الأغنية"
              />
            </div>
            <span className="text-[10px] font-mono font-bold text-emerald-300 w-8 text-left shrink-0">
              {musicState.volume}%
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};
