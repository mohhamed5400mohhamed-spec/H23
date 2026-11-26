import React, { useRef, useState } from 'react';
import {
  Sparkles,
  Upload,
  Trash2,
  Lock,
  Check,
  Image as ImageIcon,
  X,
  Crown,
  RotateCcw,
  FolderPlus
} from 'lucide-react';
import {
  AVATAR_FRAME_PRESETS,
  MEMBER_BG_PRESETS,
  DEFAULT_MEMBERSHIP_DESIGN_CATALOG,
  type MembershipDesignCatalog,
  isCustomImageValue,
  resolveMemberBgUrl
} from '../constants/membershipDesigns';
import { AvatarWithFrame } from './AvatarWithFrame';
import { analyzeFrameImage } from '../utils/frameAutoFit';
import { getCachedBgAspect, measureImageAspect } from '../utils/bgDimensionsCache';

export interface MembershipDesignModalProps {
  isOpen: boolean;
  onClose: () => void;
  username: string;
  displayName?: string;
  avatarUrl: string;
  statusQuote?: string;
  flag?: string;
  currentFrame?: string;
  currentBg?: string;
  canUseAvatarFrame: boolean;
  canUseMemberBg: boolean;
  canManageCatalog: boolean;
  catalog?: MembershipDesignCatalog;
  onUploadImage: (file: File) => Promise<string | null>;
  onSaveFrame: (frameValue: string) => void;
  onSaveBg: (bgValue: string, aspectRatio?: number) => void;
  onAddCatalogFrame?: (name: string, imageUrl: string, applyToSelf: boolean) => void;
  onAddCatalogBg?: (name: string, imageUrl: string, applyToSelf: boolean, aspectRatio?: number) => void;
  onDeleteCatalogFrame?: (id: string) => void;
  onDeleteCatalogBg?: (id: string) => void;
  onRestoreDefaultPresets?: (kind: 'frames' | 'bgs') => void;
  onShowToast: (msg: string, type?: 'success' | 'error' | 'info') => void;
}

export const MembershipDesignModal: React.FC<MembershipDesignModalProps> = ({
  isOpen,
  onClose,
  username,
  displayName,
  avatarUrl,
  statusQuote,
  flag = '👑',
  currentFrame = '',
  currentBg = '',
  canUseAvatarFrame,
  canUseMemberBg,
  canManageCatalog,
  catalog = DEFAULT_MEMBERSHIP_DESIGN_CATALOG,
  onUploadImage,
  onSaveFrame,
  onSaveBg,
  onAddCatalogFrame,
  onAddCatalogBg,
  onDeleteCatalogFrame,
  onDeleteCatalogBg,
  onRestoreDefaultPresets,
  onShowToast
}) => {
  const frameFileRef = useRef<HTMLInputElement>(null);
  const bgFileRef = useRef<HTMLInputElement>(null);
  const [isUploadingFrame, setIsUploadingFrame] = useState(false);
  const [isUploadingBg, setIsUploadingBg] = useState(false);
  const [customFrameName, setCustomFrameName] = useState('');
  const [customBgName, setCustomBgName] = useState('');
  const [applyUploadedToSelf, setApplyUploadedToSelf] = useState(true);
  const [confirmDeleteFrameId, setConfirmDeleteFrameId] = useState<string | null>(null);
  const [confirmDeleteBgId, setConfirmDeleteBgId] = useState<string | null>(null);
  const [frameFilter, setFrameFilter] = useState<
    'all' | 'custom' | 'animated' | 'static' | 'wings' | 'elements' | 'cute' | 'classic'
  >('all');

  if (!isOpen) return null;

  const customFrames = Array.isArray(catalog?.customFrames) ? catalog.customFrames : [];
  const customBgs = Array.isArray(catalog?.customBgs) ? catalog.customBgs : [];
  const deletedPresetFrameIds = new Set(
    Array.isArray(catalog?.deletedPresetFrameIds) ? catalog.deletedPresetFrameIds : []
  );
  const deletedPresetBgIds = new Set(
    Array.isArray(catalog?.deletedPresetBgIds) ? catalog.deletedPresetBgIds : []
  );

  const availablePresets = AVATAR_FRAME_PRESETS.filter((p) => !deletedPresetFrameIds.has(p.id));
  const availableBgPresets = MEMBER_BG_PRESETS.filter((b) => !deletedPresetBgIds.has(b.id));

  const filteredCustomFrames = customFrames.filter((cf) => {
    if (frameFilter === 'all' || frameFilter === 'custom') return true;
    if (frameFilter === 'animated') return Boolean(cf.animated);
    if (frameFilter === 'static') return !cf.animated;
    return false;
  });

  const filteredPresetFrames =
    frameFilter === 'custom'
      ? []
      : availablePresets.filter((p) => {
          if (frameFilter === 'all') return true;
          if (frameFilter === 'animated') return p.animated;
          if (frameFilter === 'static') return !p.animated;
          return p.category === frameFilter;
        });

  const totalFramesCount = customFrames.length + availablePresets.length;
  const previewBgUrl = resolveMemberBgUrl(currentBg);
  const hasCustomFrameNotInCatalog = Boolean(
    currentFrame &&
      isCustomImageValue(currentFrame) &&
      !customFrames.some((cf) => cf.imageUrl === currentFrame || cf.id === currentFrame)
  );
  const hasCustomBgNotInCatalog = Boolean(
    currentBg &&
      isCustomImageValue(currentBg) &&
      !customBgs.some((cb) => cb.imageUrl === currentBg || cb.id === currentBg)
  );

  const denyFrame = () => {
    onShowToast('ليس لديك صلاحية استخدام أو تغيير إطار الصورة الشخصية 🔒', 'error');
  };

  const denyBg = () => {
    onShowToast('ليس لديك صلاحية استخدام أو تغيير خلفية العضوية والبروفايل 🔒', 'error');
  };

  const denyManageCatalog = () => {
    onShowToast('رفع أو حذف الإطارات والخلفيات من المكتبة يتطلب صلاحية إدارة مكتبة التصاميم 🔒', 'error');
  };

  const handleFrameFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!canManageCatalog && !canUseAvatarFrame) {
      denyFrame();
      return;
    }
    setIsUploadingFrame(true);
    try {
      const url = await onUploadImage(file);
      if (url) {
        await analyzeFrameImage(url);
        if (canManageCatalog && onAddCatalogFrame) {
          const derivedName = customFrameName.trim() || file.name.replace(/\.[^/.]+$/, '').slice(0, 40);
          onAddCatalogFrame(derivedName, url, applyUploadedToSelf && canUseAvatarFrame);
          setCustomFrameName('');
        } else if (canUseAvatarFrame) {
          onSaveFrame(url);
        }
      }
    } finally {
      setIsUploadingFrame(false);
    }
  };

  const handleBgFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!canManageCatalog && !canUseMemberBg) {
      denyBg();
      return;
    }
    setIsUploadingBg(true);
    try {
      const localPreviewUrl = URL.createObjectURL(file);
      let measuredAspect: number | undefined;
      try {
        measuredAspect = await measureImageAspect(localPreviewUrl);
      } finally {
        URL.revokeObjectURL(localPreviewUrl);
      }
      const url = await onUploadImage(file);
      if (url) {
        const finalAspect = measuredAspect ?? (await measureImageAspect(url));
        if (canManageCatalog && onAddCatalogBg) {
          const derivedName = customBgName.trim() || file.name.replace(/\.[^/.]+$/, '').slice(0, 40);
          onAddCatalogBg(derivedName, url, applyUploadedToSelf && canUseMemberBg, finalAspect);
          setCustomBgName('');
        } else if (canUseMemberBg) {
          onSaveBg(url, finalAspect);
        }
      }
    } finally {
      setIsUploadingBg(false);
    }
  };

  const renderDeleteButton = (
    itemId: string,
    confirmId: string | null,
    setConfirmId: (id: string | null) => void,
    onDelete?: (id: string) => void
  ) => {
    if (!canManageCatalog || !onDelete) return null;
    const isConfirming = confirmId === itemId;
    if (isConfirming) {
      return (
        <div
          onClick={(e) => e.stopPropagation()}
          className="absolute top-1.5 right-1.5 z-30 flex items-center gap-1 bg-slate-950/95 border border-rose-500 rounded-lg px-1.5 py-0.5 shadow-lg"
        >
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onDelete(itemId);
              setConfirmId(null);
            }}
            className="text-[10px] font-black text-rose-400 hover:text-rose-300 px-1 cursor-pointer"
            title="تأكيد الحذف النهائي"
          >
            حذف
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setConfirmId(null);
            }}
            className="text-[10px] font-bold text-slate-300 hover:text-white px-0.5 cursor-pointer"
            title="إلغاء"
          >
            ✕
          </button>
        </div>
      );
    }
    return (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setConfirmId(itemId);
        }}
        className="absolute top-1.5 right-1.5 z-30 w-6 h-6 rounded-lg bg-rose-950/85 hover:bg-rose-600 text-rose-200 hover:text-white border border-rose-500/60 flex items-center justify-center shadow-sm transition-colors cursor-pointer"
        title="حذف من المكتبة"
      >
        <Trash2 className="w-3 h-3" />
      </button>
    );
  };

  return (
    <div
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-2.5 sm:p-4 animate-in fade-in"
      dir="rtl"
    >
      <div className="w-full max-w-lg max-h-[92vh] bg-[#131722] border-2 border-amber-500/75 rounded-2xl shadow-2xl overflow-hidden flex flex-col text-right text-slate-100">
        {/* Header */}
        <div className="shrink-0 bg-gradient-to-l from-[#1e1711] via-[#261c12] to-[#1e1711] border-b border-amber-500/40 px-3.5 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-amber-500/20 border border-amber-400/50 flex items-center justify-center text-amber-400 shrink-0">
              <Crown className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h3 className="font-black text-sm text-amber-300 truncate">تصميم العضوية ✨</h3>
              <p className="text-[11px] text-amber-100/70 truncate">
                اختر إطارك وخلفية عضويتك — تتناسب الصورة والإطار تلقائياً بدون تغطية أو فراغ
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-lg bg-red-600 hover:bg-red-700 text-white flex items-center justify-center cursor-pointer shrink-0 transition-colors"
            title="إغلاق"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Scrollable Body */}
        <div className="flex-1 min-h-0 overflow-y-auto modal-scroll-container p-3.5 space-y-4 text-xs">
          {/* Live Preview Card */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-[11px] font-bold text-slate-300">
              <span>معاينة ظهورك في قائمة الأعضاء والبروفايل:</span>
              {(currentFrame || currentBg) && (
                <span className="text-emerald-400 font-semibold">مباشر ⚡</span>
              )}
            </div>
            <div className="grid grid-cols-1 rounded-xl overflow-hidden border border-amber-500/40 bg-slate-900/90 shadow-lg">
              {previewBgUrl && (
                <img
                  src={previewBgUrl}
                  alt="معاينة الخلفية"
                  className="col-start-1 row-start-1 w-full h-auto max-h-[210px] min-h-full object-cover select-none pointer-events-none"
                />
              )}
              {previewBgUrl && (
                <div
                  aria-hidden="true"
                  className="col-start-1 row-start-1 bg-gradient-to-b from-slate-950/90 via-slate-950/35 to-transparent pointer-events-none"
                />
              )}
              <div className="col-start-1 row-start-1 relative z-10 self-start w-full px-4 pt-4 pb-3.5 flex items-start justify-between gap-2.5">
                <div className="flex items-center gap-3.5 min-w-0">
                  <AvatarWithFrame
                    src={avatarUrl}
                    alt={username}
                    frame={currentFrame}
                    size="md"
                    presenceState="online"
                    showPresenceDot
                  />
                  <div className="min-w-0 text-right">
                    <div className="font-black text-sm text-white drop-shadow truncate">
                      {displayName || username}
                    </div>
                    <div className="text-[11px] text-slate-200/90 truncate max-w-[220px] drop-shadow">
                      {statusQuote || 'عضو مميز في شات حسان برو'}
                    </div>
                  </div>
                </div>
                <span className="text-lg shrink-0 drop-shadow">{flag}</span>
              </div>
            </div>
          </div>

          {canManageCatalog && (
            <div className="p-2.5 rounded-xl bg-emerald-950/40 border border-emerald-500/40 flex flex-wrap items-center justify-between gap-2 text-[11px]">
              <div className="flex items-center gap-1.5 text-emerald-300 font-bold">
                <FolderPlus className="w-4 h-4 shrink-0" />
                <span>صلاحية إدارة المكتبة مفعّلة: يمكنك رفع وحذف الإطارات والخلفيات للجميع</span>
              </div>
              <label className="flex items-center gap-1.5 text-[10px] text-slate-200 font-bold cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={applyUploadedToSelf}
                  onChange={(e) => setApplyUploadedToSelf(e.target.checked)}
                  className="accent-amber-500 rounded cursor-pointer"
                />
                <span>تطبيق على حسابي تلقائياً عند الرفع</span>
              </label>
            </div>
          )}

          {/* SECTION 1: FRAMES (قسم الإطارات) */}
          <div className="p-3 rounded-2xl bg-slate-900/80 border border-slate-700/80 space-y-3">
            <div className="flex items-center justify-between gap-2 border-b border-slate-800 pb-2">
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-amber-400" />
                <span className="font-black text-sm text-amber-300">قسم الإطارات ({totalFramesCount})</span>
              </div>
              <span
                className={`px-2 py-0.5 rounded-full text-[10px] font-bold flex items-center gap-1 border ${
                  canUseAvatarFrame
                    ? 'bg-emerald-950/80 text-emerald-300 border-emerald-500/40'
                    : 'bg-rose-950/80 text-rose-300 border-rose-500/40'
                }`}
              >
                {canUseAvatarFrame ? <Check className="w-3 h-3" /> : <Lock className="w-3 h-3" />}
                <span>{canUseAvatarFrame ? 'اختيار الإطار مفعل' : 'يتطلب صلاحية'}</span>
              </span>
            </div>

            {canManageCatalog && (
              <input
                type="text"
                value={customFrameName}
                onChange={(e) => setCustomFrameName(e.target.value)}
                placeholder="اسم الإطار المرفوع من الهاتف (اختياري)..."
                maxLength={50}
                className="w-full px-3 py-2 rounded-xl bg-slate-950/80 border border-slate-700 focus:border-amber-500 outline-none text-xs text-white placeholder-slate-500"
              />
            )}

            {/* Frame Actions Row */}
            <div className="grid grid-cols-2 gap-2">
              <input
                ref={frameFileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleFrameFileChange}
              />
              <button
                type="button"
                disabled={isUploadingFrame}
                onClick={() => {
                  if (!canManageCatalog && !canUseAvatarFrame) {
                    denyManageCatalog();
                    return;
                  }
                  frameFileRef.current?.click();
                }}
                className="py-2.5 px-3 rounded-xl bg-amber-600 hover:bg-amber-500 disabled:opacity-60 text-slate-950 font-black text-xs flex items-center justify-center gap-1.5 cursor-pointer shadow-md transition-colors"
              >
                <Upload className="w-3.5 h-3.5 shrink-0" />
                <span>
                  {isUploadingFrame
                    ? 'جارٍ رفع الإطار...'
                    : canManageCatalog
                    ? 'رفع إطار من الهاتف للمكتبة'
                    : 'رفع إطار من الهاتف'}
                </span>
              </button>

              <button
                type="button"
                onClick={() => {
                  if (!canUseAvatarFrame) {
                    denyFrame();
                    return;
                  }
                  if (!currentFrame) {
                    onShowToast('لا يوجد إطار مُفعّل حالياً على صورتك لإزالته.', 'info');
                    return;
                  }
                  onSaveFrame('');
                }}
                className="py-2.5 px-3 rounded-xl bg-rose-700 hover:bg-rose-600 text-white font-bold text-xs flex items-center justify-center gap-1.5 cursor-pointer shadow-md transition-colors"
              >
                <X className="w-3.5 h-3.5 shrink-0" />
                <span>إزالة إطار صورتي</span>
              </button>
            </div>

            {hasCustomFrameNotInCatalog && (
              <div className="p-2 rounded-xl bg-amber-500/10 border border-amber-500/40 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <AvatarWithFrame src={avatarUrl} alt="الإطار المرفوع" frame={currentFrame} size="sm" />
                  <span className="text-[11px] font-bold text-amber-200">إطارك الشخصي المرفوع حالياً ✓</span>
                </div>
                <span className="text-[10px] text-emerald-300 font-bold">مُطبق على صورتك</span>
              </div>
            )}

            {/* Frame Category & Motion Filters */}
            <div className="flex flex-wrap items-center gap-1.5">
              {[
                { id: 'all', label: `الكل (${totalFramesCount})` },
                ...(customFrames.length > 0 ? [{ id: 'custom', label: `المرفوعة 📱 (${customFrames.length})` }] : []),
                {
                  id: 'animated',
                  label: `متحركة ✨ (${
                    availablePresets.filter((f) => f.animated).length + customFrames.filter((f) => f.animated).length
                  })`
                },
                {
                  id: 'static',
                  label: `ثابتة 🏛️ (${
                    availablePresets.filter((f) => !f.animated).length + customFrames.filter((f) => !f.animated).length
                  })`
                },
                { id: 'wings', label: 'أجنحة وتيجان 👑' },
                { id: 'elements', label: 'نار وماء وطاقة 🔥' },
                { id: 'cute', label: 'قلوب وفراشات 🌸' },
                { id: 'classic', label: 'كلاسيكية 💎' }
              ].map((tab) => {
                const active = frameFilter === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setFrameFilter(tab.id as any)}
                    className={`px-2.5 py-1 rounded-lg text-[10px] font-bold border transition-all cursor-pointer ${
                      active
                        ? 'bg-amber-500 text-slate-950 border-amber-400 shadow-xs'
                        : 'bg-slate-800/80 text-slate-300 border-slate-700 hover:border-amber-500/50 hover:text-white'
                    }`}
                  >
                    {tab.label}
                  </button>
                );
              })}

              {canManageCatalog && deletedPresetFrameIds.size > 0 && onRestoreDefaultPresets && (
                <button
                  type="button"
                  onClick={() => onRestoreDefaultPresets('frames')}
                  className="px-2.5 py-1 rounded-lg text-[10px] font-bold border border-emerald-500/50 bg-emerald-950/60 hover:bg-emerald-900 text-emerald-300 flex items-center gap-1 cursor-pointer"
                  title="استعادة الإطارات السابقة المحذوفة"
                >
                  <RotateCcw className="w-3 h-3" />
                  <span>استعادة السابقة ({deletedPresetFrameIds.size})</span>
                </button>
              )}
            </div>

            {/* Frames Grid (Uploaded Custom + Presets) */}
            {filteredCustomFrames.length === 0 && filteredPresetFrames.length === 0 ? (
              <div className="p-6 rounded-xl bg-slate-950/60 border border-slate-800 text-center text-slate-400 text-xs">
                لا توجد إطارات في هذا التصنيف حالياً. يمكنك رفع إطارات من هاتفك لتظهر لجميع الأعضاء.
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                {filteredCustomFrames.map((cf) => {
                  const isSelected = currentFrame === cf.imageUrl || currentFrame === cf.id;
                  return (
                    <div
                      key={cf.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => {
                        if (!canUseAvatarFrame) {
                          denyFrame();
                          return;
                        }
                        onSaveFrame(cf.imageUrl);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          if (!canUseAvatarFrame) {
                            denyFrame();
                            return;
                          }
                          onSaveFrame(cf.imageUrl);
                        }
                      }}
                      className={`pt-5 pb-2.5 px-2 rounded-xl border text-center flex flex-col items-center gap-2.5 transition-all cursor-pointer relative ${
                        isSelected
                          ? 'bg-amber-500/20 border-amber-400 ring-2 ring-amber-400/50 shadow-md'
                          : 'bg-slate-800/70 border-slate-700 hover:border-amber-500/60 hover:bg-slate-800'
                      }`}
                    >
                      {isSelected && (
                        <span className="absolute top-1.5 left-1.5 w-4 h-4 rounded-full bg-amber-400 text-slate-950 flex items-center justify-center shadow-xs">
                          <Check className="w-3 h-3 stroke-[3]" />
                        </span>
                      )}
                      {renderDeleteButton(cf.id, confirmDeleteFrameId, setConfirmDeleteFrameId, onDeleteCatalogFrame)}
                      <div className="py-2 flex items-center justify-center">
                        <AvatarWithFrame src={avatarUrl} alt={cf.name} frame={cf.imageUrl} size="md" />
                      </div>
                      <div className="space-y-0.5 w-full">
                        <div className="font-bold text-[11px] text-slate-100 truncate">{cf.name}</div>
                        <div className="text-[9px] font-bold text-emerald-300 truncate">
                          مرفوع • {cf.createdBy}
                        </div>
                      </div>
                    </div>
                  );
                })}

                {filteredPresetFrames.map((preset) => {
                  const isSelected = currentFrame === preset.id;
                  return (
                    <div
                      key={preset.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => {
                        if (!canUseAvatarFrame) {
                          denyFrame();
                          return;
                        }
                        onSaveFrame(preset.id);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          if (!canUseAvatarFrame) {
                            denyFrame();
                            return;
                          }
                          onSaveFrame(preset.id);
                        }
                      }}
                      className={`pt-5 pb-2.5 px-2 rounded-xl border text-center flex flex-col items-center gap-2.5 transition-all cursor-pointer relative ${
                        isSelected
                          ? 'bg-amber-500/20 border-amber-400 ring-2 ring-amber-400/50 shadow-md'
                          : 'bg-slate-800/70 border-slate-700 hover:border-amber-500/60 hover:bg-slate-800'
                      }`}
                    >
                      {isSelected && (
                        <span className="absolute top-1.5 left-1.5 w-4 h-4 rounded-full bg-amber-400 text-slate-950 flex items-center justify-center shadow-xs">
                          <Check className="w-3 h-3 stroke-[3]" />
                        </span>
                      )}
                      {renderDeleteButton(preset.id, confirmDeleteFrameId, setConfirmDeleteFrameId, onDeleteCatalogFrame)}
                      <div className="py-2 flex items-center justify-center">
                        <AvatarWithFrame src={avatarUrl} alt={preset.name} frame={preset.id} size="md" />
                      </div>
                      <div className="space-y-0.5 w-full">
                        <div className="font-bold text-[11px] text-slate-100 truncate">{preset.name}</div>
                        <div className={`text-[9px] font-bold ${preset.animated ? 'text-amber-300' : 'text-sky-300'}`}>
                          {preset.badge}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* SECTION 2: BACKGROUNDS (قسم الخلفيات) */}
          <div className="p-3 rounded-2xl bg-slate-900/80 border border-slate-700/80 space-y-3">
            <div className="flex items-center justify-between gap-2 border-b border-slate-800 pb-2">
              <div className="flex items-center gap-2">
                <ImageIcon className="w-4 h-4 text-cyan-400" />
                <span className="font-black text-sm text-cyan-300">
                  قسم الخلفيات ({customBgs.length + availableBgPresets.length})
                </span>
              </div>
              <span
                className={`px-2 py-0.5 rounded-full text-[10px] font-bold flex items-center gap-1 border ${
                  canUseMemberBg
                    ? 'bg-emerald-950/80 text-emerald-300 border-emerald-500/40'
                    : 'bg-rose-950/80 text-rose-300 border-rose-500/40'
                }`}
              >
                {canUseMemberBg ? <Check className="w-3 h-3" /> : <Lock className="w-3 h-3" />}
                <span>{canUseMemberBg ? 'اختيار الخلفية مفعل' : 'يتطلب صلاحية'}</span>
              </span>
            </div>

            <p className="text-[11px] text-slate-400 leading-relaxed">
              تظهر الخلفية التي تختارها في البروفايل الخاص بك، وتظهر أيضاً كخلفية لمساحة عضويتك داخل قائمة الأعضاء وتتمدد تلقائياً بدون أن تغطي على باقي الأعضاء.
            </p>

            {canManageCatalog && (
              <input
                type="text"
                value={customBgName}
                onChange={(e) => setCustomBgName(e.target.value)}
                placeholder="اسم الخلفية المرفوعة من الهاتف (اختياري)..."
                maxLength={50}
                className="w-full px-3 py-2 rounded-xl bg-slate-950/80 border border-slate-700 focus:border-cyan-500 outline-none text-xs text-white placeholder-slate-500"
              />
            )}

            {/* Bg Actions Row */}
            <div className="grid grid-cols-2 gap-2">
              <input
                ref={bgFileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleBgFileChange}
              />
              <button
                type="button"
                disabled={isUploadingBg}
                onClick={() => {
                  if (!canManageCatalog && !canUseMemberBg) {
                    denyManageCatalog();
                    return;
                  }
                  bgFileRef.current?.click();
                }}
                className="py-2.5 px-3 rounded-xl bg-cyan-600 hover:bg-cyan-500 disabled:opacity-60 text-white font-black text-xs flex items-center justify-center gap-1.5 cursor-pointer shadow-md transition-colors"
              >
                <Upload className="w-3.5 h-3.5 shrink-0" />
                <span>
                  {isUploadingBg
                    ? 'جارٍ رفع الخلفية...'
                    : canManageCatalog
                    ? 'رفع خلفية من الهاتف للمكتبة'
                    : 'رفع خلفية من الهاتف'}
                </span>
              </button>

              <button
                type="button"
                onClick={() => {
                  if (!canUseMemberBg) {
                    denyBg();
                    return;
                  }
                  if (!currentBg) {
                    onShowToast('لا توجد خلفية مُفعّلة حالياً على عضويتك لإزالتها.', 'info');
                    return;
                  }
                  onSaveBg('');
                }}
                className="py-2.5 px-3 rounded-xl bg-rose-700 hover:bg-rose-600 text-white font-bold text-xs flex items-center justify-center gap-1.5 cursor-pointer shadow-md transition-colors"
              >
                <X className="w-3.5 h-3.5 shrink-0" />
                <span>إزالة خلفيتي الحالية</span>
              </button>
            </div>

            {canManageCatalog && deletedPresetBgIds.size > 0 && onRestoreDefaultPresets && (
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={() => onRestoreDefaultPresets('bgs')}
                  className="px-2.5 py-1 rounded-lg text-[10px] font-bold border border-emerald-500/50 bg-emerald-950/60 hover:bg-emerald-900 text-emerald-300 flex items-center gap-1 cursor-pointer"
                >
                  <RotateCcw className="w-3 h-3" />
                  <span>استعادة الخلفيات السابقة ({deletedPresetBgIds.size})</span>
                </button>
              </div>
            )}

            {hasCustomBgNotInCatalog && (
              <div className="p-2 rounded-xl bg-cyan-500/10 border border-cyan-500/40 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <img
                    src={previewBgUrl || currentBg}
                    alt="خلفية العضوية الحالية"
                    className="w-16 h-10 rounded-lg object-cover border border-cyan-400/50 shrink-0"
                  />
                  <span className="text-[11px] font-bold text-cyan-200 truncate">خلفية العضوية المرفوعة حالياً ✓</span>
                </div>
                <span className="text-[10px] text-emerald-300 font-bold shrink-0">نشطة الآن</span>
              </div>
            )}

            {/* Backgrounds Grid (Custom + Presets) */}
            {customBgs.length === 0 && availableBgPresets.length === 0 ? (
              <div className="p-6 rounded-xl bg-slate-950/60 border border-slate-800 text-center text-slate-400 text-xs">
                لا توجد خلفيات في المكتبة حالياً. يمكنك رفع خلفيات من هاتفك لتظهر لجميع الأعضاء.
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                {customBgs.map((cb) => {
                  const isSelected = currentBg === cb.imageUrl || currentBg === cb.id;
                  return (
                    <div
                      key={cb.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => {
                        if (!canUseMemberBg) {
                          denyBg();
                          return;
                        }
                        onSaveBg(cb.imageUrl, cb.aspectRatio ?? getCachedBgAspect(cb.imageUrl));
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          if (!canUseMemberBg) {
                            denyBg();
                            return;
                          }
                          onSaveBg(cb.imageUrl, cb.aspectRatio ?? getCachedBgAspect(cb.imageUrl));
                        }
                      }}
                      className={`rounded-xl overflow-hidden border text-right transition-all cursor-pointer grid grid-cols-1 relative ${
                        isSelected
                          ? 'border-cyan-400 ring-2 ring-cyan-400/50 shadow-md'
                          : 'border-slate-700 hover:border-cyan-500/60'
                      }`}
                    >
                      <img
                        src={cb.imageUrl}
                        alt={cb.name}
                        className="col-start-1 row-start-1 w-full h-24 object-cover select-none pointer-events-none"
                      />
                      <div
                        aria-hidden="true"
                        className="col-start-1 row-start-1 bg-gradient-to-t from-black/85 via-black/35 to-transparent pointer-events-none"
                      />
                      {renderDeleteButton(cb.id, confirmDeleteBgId, setConfirmDeleteBgId, onDeleteCatalogBg)}
                      <div className="col-start-1 row-start-1 relative z-10 p-2 flex flex-col justify-between h-24">
                        <div className="flex items-center justify-between pl-6">
                          <span className="text-[9px] font-bold bg-black/60 text-emerald-300 px-1.5 py-0.5 rounded">
                            مرفوعة • {cb.createdBy}
                          </span>
                          {isSelected && (
                            <span className="w-4 h-4 rounded-full bg-cyan-500 text-slate-950 flex items-center justify-center">
                              <Check className="w-3 h-3 stroke-[3]" />
                            </span>
                          )}
                        </div>
                        <div className="font-bold text-[11px] text-white truncate drop-shadow">{cb.name}</div>
                      </div>
                    </div>
                  );
                })}

                {availableBgPresets.map((bgPreset) => {
                  const isSelected = currentBg === bgPreset.id;
                  return (
                    <div
                      key={bgPreset.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => {
                        if (!canUseMemberBg) {
                          denyBg();
                          return;
                        }
                        onSaveBg(bgPreset.id, 600 / 180);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          if (!canUseMemberBg) {
                            denyBg();
                            return;
                          }
                          onSaveBg(bgPreset.id, 600 / 180);
                        }
                      }}
                      className={`rounded-xl overflow-hidden border text-right transition-all cursor-pointer grid grid-cols-1 relative ${
                        isSelected
                          ? 'border-cyan-400 ring-2 ring-cyan-400/50 shadow-md'
                          : 'border-slate-700 hover:border-cyan-500/60'
                      }`}
                    >
                      <img
                        src={bgPreset.previewImage}
                        alt={bgPreset.name}
                        className="col-start-1 row-start-1 w-full h-24 object-cover select-none pointer-events-none"
                      />
                      <div
                        aria-hidden="true"
                        className="col-start-1 row-start-1 bg-gradient-to-t from-black/85 via-black/35 to-transparent pointer-events-none"
                      />
                      {renderDeleteButton(bgPreset.id, confirmDeleteBgId, setConfirmDeleteBgId, onDeleteCatalogBg)}
                      <div className="col-start-1 row-start-1 relative z-10 p-2 flex flex-col justify-between h-24">
                        <div className="flex items-center justify-between pl-6">
                          <span className="text-[9px] font-bold bg-black/55 text-amber-300 px-1.5 py-0.5 rounded">
                            {bgPreset.badge}
                          </span>
                          {isSelected && (
                            <span className="w-4 h-4 rounded-full bg-cyan-500 text-slate-950 flex items-center justify-center">
                              <Check className="w-3 h-3 stroke-[3]" />
                            </span>
                          )}
                        </div>
                        <div className="font-bold text-[11px] text-white truncate drop-shadow">
                          {bgPreset.name}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
