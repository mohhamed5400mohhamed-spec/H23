import React, { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AtSign, MessageCircle, Mic, Search, ShieldCheck, Users, X } from 'lucide-react';
import type { User } from '../types/chat';
import type { ThemeFullStyle } from '../constants/themeStyles';
import { getThemeLuminance } from '../constants/themeStyles';
import { resolveMemberBgUrl } from '../constants/membershipDesigns';
import { getCachedBgAspect, recordBgDimensions } from '../utils/bgDimensionsCache';
import { AvatarWithFrame } from './AvatarWithFrame';

export interface RegisteredMemberRosterItem {
  username: string;
  displayName?: string;
  role: string;
  flag: string;
  flagNumber?: number;
  statusQuote: string;
  avatarUrl?: string;
  avatarFrame?: string;
  memberBg?: string;
  memberBgAspect?: number;
  profileBg?: string;
  nameBannerUrl?: string;
  giftBadges?: string[];
  likes?: number;
  points?: number;
  honorBadge?: string;
  isOnline: boolean;
  currentRoom?: string;
  lastSeen?: number;
  presenceState?: 'online' | 'away' | 'offline';
}

type RosterFilterTab = 'all' | 'room' | 'online' | 'offline';

export interface MembersRosterDrawerProps {
  onClose: () => void;
  currentUser: User;
  curTheme: ThemeFullStyle;
  falconIcon: string;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  isCurrentUserOutside: boolean;
  currentRoomUsers: User[];
  otherConnectedUsers: User[];
  offlineMembers: RegisteredMemberRosterItem[];
  getUserBanner: (username?: string, fallbackUrl?: string) => string | undefined;
  getUserDisplayName: (username?: string, fallbackDisplayName?: string) => string;
  getUserFlagNumber: (username?: string, explicitNum?: number) => number | undefined;
  getCountryNameFromFlag: (flag?: string) => string;
  getRoleLevel: (role?: string) => number;
  isUserIgnored: (username: string) => boolean;
  onOpenUserProfile: (u: User) => void;
  onOpenPrivateChat: (u: User) => void;
  onInsertMention: (username: string) => void;
  onRevealNicks: (username: string) => void;
}

interface MemberRowCardProps {
  user: User;
  isOffline?: boolean;
  isSameRoom?: boolean;
  isSelf?: boolean;
  isLightDrawer: boolean;
  curTheme: ThemeFullStyle;
  falconIcon: string;
  canRevealNicks: boolean;
  bannerUrl?: string;
  displayName: string;
  flagNumber?: number;
  countryName?: string;
  isIgnored: boolean;
  eager?: boolean;
  onSelect: (u: User) => void;
  onPrivateChat?: (u: User) => void;
  onMention?: (username: string) => void;
  onReveal?: (username: string) => void;
}

const MemberRowCard = memo<MemberRowCardProps>(({
  user,
  isOffline = false,
  isSameRoom = false,
  isSelf = false,
  isLightDrawer,
  curTheme,
  falconIcon,
  canRevealNicks,
  bannerUrl,
  displayName,
  flagNumber,
  countryName,
  isIgnored,
  eager = false,
  onSelect,
  onPrivateChat,
  onMention,
  onReveal
}) => {
  const bgUrl = resolveMemberBgUrl(user.memberBg || user.profileBg);
  const bgImgRef = useRef<HTMLImageElement | null>(null);
  const [measuredAspect, setMeasuredAspect] = useState<number | undefined>(() =>
    getCachedBgAspect(bgUrl, user.memberBgAspect)
  );
  const [isBgLoaded, setIsBgLoaded] = useState<boolean>(false);

  useLayoutEffect(() => {
    if (!bgUrl) {
      setIsBgLoaded(false);
      setMeasuredAspect(undefined);
      return;
    }
    const cached = getCachedBgAspect(bgUrl, user.memberBgAspect);
    if (cached !== undefined) {
      setMeasuredAspect(cached);
    }
    const imgEl = bgImgRef.current;
    if (imgEl && imgEl.complete && imgEl.naturalWidth > 0) {
      const recorded = recordBgDimensions(bgUrl, imgEl.naturalWidth, imgEl.naturalHeight);
      if (recorded !== undefined) {
        setMeasuredAspect(recorded);
      }
      setIsBgLoaded(true);
    } else {
      setIsBgLoaded(false);
    }
  }, [bgUrl, user.memberBgAspect]);

  const isOtherOutside = !user.room || user.room === 'خارج الغرف' || user.room.trim() === '';
  const hasActiveMic = !isOffline && (user.isVoice || user.micSlot !== null);
  const cleanStatus = user.statusQuote && user.statusQuote.trim() !== '..' ? user.statusQuote.trim() : '';

  const showImageVisuals = Boolean(bgUrl && isBgLoaded);

  const primaryTextClass = bgUrl
    ? showImageVisuals
      ? 'text-white [text-shadow:0_1px_2px_rgba(0,0,0,0.92),0_0_6px_rgba(0,0,0,0.65)]'
      : 'text-slate-900'
    : isOffline
    ? isLightDrawer
      ? 'text-slate-700'
      : 'text-slate-300'
    : isLightDrawer
    ? 'text-slate-900'
    : curTheme.accentText;

  const secondaryTextClass = bgUrl
    ? showImageVisuals
      ? 'text-white/95 [text-shadow:0_1px_2px_rgba(0,0,0,0.92),0_0_5px_rgba(0,0,0,0.65)]'
      : 'text-slate-600'
    : isLightDrawer
    ? 'text-slate-600'
    : 'text-slate-400';

  const actionBtnClass = bgUrl
    ? showImageVisuals
      ? 'bg-slate-900/75 hover:bg-slate-900/90 text-white border border-white/30'
      : 'bg-slate-100 hover:bg-slate-200 text-slate-800 border border-slate-300'
    : isLightDrawer
    ? 'bg-slate-200/85 hover:bg-slate-300 text-slate-800 border border-slate-300/80'
    : 'bg-slate-800/85 hover:bg-slate-700 text-slate-200 border border-slate-700/80';

  const presenceTitle = isOffline
    ? 'عضوية غير متصلة (خارج الغرف)'
    : isSameRoom
    ? `متواجد معك في (${user.room})`
    : isOtherOutside
    ? 'متواجد في بهو الشات (خارج الغرف)'
    : `متصل بغرفة (${user.room})`;

  const locationSummary = isOffline
    ? 'غير متصل'
    : isSameRoom
    ? hasActiveMic
      ? 'على المايك الآن'
      : undefined
    : isOtherOutside
    ? 'في البهو'
    : user.room;

  const hasQuickActions = !isSelf && Boolean((isSameRoom && onMention) || onPrivateChat || (canRevealNicks && onReveal));

  const rowInner = (
    <div className="flex items-start justify-between gap-2.5 w-full min-w-0">
      <div className="flex items-start gap-2.5 min-w-0 flex-1">
        <div className="shrink-0 pt-0.5">
          <AvatarWithFrame
            src={user.avatarUrl || falconIcon}
            alt={user.username}
            frame={user.avatarFrame}
            size={isSameRoom ? 'md' : 'sm'}
            presenceState={isOffline ? 'offline' : user.presenceState}
            isGhost={user.isGhost}
            grayscale={isOffline}
            showPresenceDot
            presenceTitle={presenceTitle}
            eager={eager}
          />
        </div>

        <div className="min-w-0 flex-1 text-right">
          <div className={`font-bold text-xs ${primaryTextClass} flex items-center gap-1.5 min-w-0 min-h-[24px] leading-snug overflow-hidden`}>
            {user.giftBadges && user.giftBadges.length > 0 && (
              <img
                src={user.giftBadges[0]}
                alt="هدية"
                title="هدية تكريمية مرافقة للاسم"
                loading={eager ? 'eager' : 'lazy'}
                decoding="async"
                className="w-4 h-4 sm:w-5 sm:h-5 object-contain inline-block drop-shadow-xs shrink-0 select-none align-middle"
              />
            )}

            {bannerUrl ? (
              <img
                src={bannerUrl}
                alt={user.username}
                title={user.username}
                loading={eager ? 'eager' : 'lazy'}
                decoding="async"
                className={`${isSameRoom ? 'h-6 max-h-[24px] max-w-[165px] sm:max-w-[195px]' : 'h-5 max-h-[22px] max-w-[155px] sm:max-w-[180px]'} object-contain drop-shadow-xs select-none inline-block align-middle rounded shrink min-w-0 ${
                  isOffline ? 'opacity-85' : ''
                }`}
              />
            ) : (
              <span className="truncate min-w-0">{displayName}</span>
            )}

            {user.giftBadges && user.giftBadges.length > 1 && (
              <span className="inline-flex items-center gap-0.5 align-middle shrink-0">
                {user.giftBadges.slice(1).map((badgeUrl, bIdx) => (
                  <img
                    key={bIdx}
                    src={badgeUrl}
                    alt="وسام"
                    title="وسام شرفي"
                    className="w-3.5 h-3.5 object-contain inline-block drop-shadow-xs opacity-90"
                  />
                ))}
              </span>
            )}

            {hasActiveMic && (
              <span
                className={`inline-flex items-center gap-0.5 text-[10px] font-bold shrink-0 ${
                  bgUrl
                    ? showImageVisuals
                      ? 'text-emerald-300 [text-shadow:0_1px_2px_rgba(0,0,0,0.9)]'
                      : 'text-emerald-700'
                    : isLightDrawer
                    ? 'text-emerald-700'
                    : 'text-emerald-400'
                }`}
                title="متحدث على المايك"
              >
                <Mic className="w-3 h-3" />
              </span>
            )}

            {isSelf && (
              <span
                className={`text-[10px] font-bold shrink-0 ${
                  bgUrl
                    ? showImageVisuals
                      ? 'text-amber-300 [text-shadow:0_1px_2px_rgba(0,0,0,0.9)]'
                      : 'text-amber-700'
                    : isLightDrawer
                    ? 'text-amber-700'
                    : 'text-amber-400'
                }`}
              >
                (أنت)
              </span>
            )}
          </div>

          {(locationSummary || user.isGhost || isIgnored) && (
            <div className={`text-[11px] leading-tight mt-0.5 flex items-center gap-1.5 flex-wrap ${secondaryTextClass}`}>
              {locationSummary && (
                <span className="truncate max-w-[165px]">{locationSummary}</span>
              )}
              {user.isGhost && (
                <>
                  {locationSummary && <span aria-hidden="true">·</span>}
                  <span
                    className={
                      bgUrl
                        ? showImageVisuals
                          ? 'text-purple-200 font-bold [text-shadow:0_1px_2px_rgba(0,0,0,0.9)]'
                          : 'text-purple-700 font-bold'
                        : isLightDrawer
                        ? 'text-purple-700 font-bold'
                        : 'text-purple-400 font-bold'
                    }
                  >
                    مخفي
                  </span>
                </>
              )}
              {isIgnored && (
                <>
                  {(locationSummary || user.isGhost) && <span aria-hidden="true">·</span>}
                  <span
                    className={
                      bgUrl
                        ? showImageVisuals
                          ? 'text-rose-200 font-bold [text-shadow:0_1px_2px_rgba(0,0,0,0.9)]'
                          : 'text-rose-700 font-bold'
                        : isLightDrawer
                        ? 'text-rose-700 font-bold'
                        : 'text-rose-400 font-bold'
                    }
                  >
                    متجاهل
                  </span>
                </>
              )}
            </div>
          )}

          {cleanStatus && (
            <div className={`text-[11px] truncate max-w-full mt-0.5 ${secondaryTextClass}`}>
              {cleanStatus}
            </div>
          )}

          {hasQuickActions && (
            <div className="flex items-center gap-1.5 flex-wrap mt-1.5">
              {!isSelf && isSameRoom && onMention && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onMention(user.username);
                  }}
                  className={`h-6 px-2 rounded-md inline-flex items-center gap-1 text-[10px] font-bold transition-colors duration-150 cursor-pointer whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 ${actionBtnClass}`}
                  title={`منشن @${user.username}`}
                  aria-label={`منشن ${user.username}`}
                >
                  <AtSign className="w-3 h-3" />
                  <span>منشن</span>
                </button>
              )}

              {!isSelf && onPrivateChat && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onPrivateChat(user);
                  }}
                  className={`h-6 px-2 rounded-md inline-flex items-center gap-1 text-[10px] font-bold transition-colors duration-150 cursor-pointer whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 ${actionBtnClass}`}
                  title={`محادثة خاصة مع ${user.username}`}
                  aria-label={`محادثة خاصة مع ${user.username}`}
                >
                  <MessageCircle className="w-3 h-3" />
                  <span>خاص</span>
                </button>
              )}

              {!isSelf && canRevealNicks && onReveal && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onReveal(user.username);
                  }}
                  className="h-6 px-2 bg-amber-500 hover:bg-amber-400 text-slate-950 text-[10px] font-black rounded-md transition-colors duration-150 cursor-pointer whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300"
                  title="كشف النكات والآي بي"
                >
                  كشف
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      <div
        className="flex flex-col items-center justify-center min-w-[28px] pt-0.5 leading-none select-none shrink-0"
        title={countryName || undefined}
      >
        <span className="text-base leading-none">{user.flag}</span>
        {flagNumber && (
          <span
            className={`text-[10px] font-bold tabular-nums mt-0.5 leading-none font-mono ${
              bgUrl
                ? showImageVisuals
                  ? 'text-amber-300 [text-shadow:0_1px_2px_rgba(0,0,0,0.9)]'
                  : 'text-amber-700'
                : isLightDrawer
                ? 'text-amber-700'
                : 'text-amber-400'
            }`}
          >
            #{flagNumber}
          </span>
        )}
      </div>
    </div>
  );

  if (bgUrl) {
    return (
      <div
        role="button"
        tabIndex={0}
        onClick={() => onSelect(user)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onSelect(user);
          }
        }}
        style={{
          aspectRatio: String(measuredAspect ?? 2.2),
          minHeight: '84px',
          contain: 'layout style paint'
        }}
        className={`relative w-full overflow-hidden cursor-pointer z-0 flex items-start bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-amber-400 ${
          isOffline ? 'opacity-90' : ''
        }`}
      >
        <img
          ref={bgImgRef}
          src={bgUrl}
          alt=""
          aria-hidden="true"
          loading={eager ? 'eager' : 'lazy'}
          decoding="async"
          onLoad={(e) => {
            const imgEl = e.currentTarget;
            if (imgEl.naturalWidth > 0 && imgEl.naturalHeight > 0) {
              const aspect = recordBgDimensions(bgUrl, imgEl.naturalWidth, imgEl.naturalHeight);
              if (aspect !== undefined) {
                setMeasuredAspect((prev) => (prev === aspect ? prev : aspect));
              }
            }
            setIsBgLoaded(true);
          }}
          className={`absolute inset-0 w-full h-full object-cover object-center select-none pointer-events-none transition-opacity duration-300 ease-out ${
            isBgLoaded ? 'opacity-100' : 'opacity-0'
          }`}
        />
        <div className="relative z-10 w-full px-3.5 py-2.5 self-start">
          {rowInner}
        </div>
      </div>
    );
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onSelect(user)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect(user);
        }
      }}
      style={{ contain: 'layout style paint' }}
      className={`relative z-0 px-3.5 py-2.5 min-h-[60px] transition-colors duration-150 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-amber-400 ${
        isSelf
          ? isLightDrawer
            ? 'bg-amber-500/12 hover:bg-amber-500/18'
            : 'bg-amber-500/10 hover:bg-amber-500/15'
          : isLightDrawer
          ? 'hover:bg-slate-200/60'
          : 'hover:bg-white/5'
      } ${isOffline ? 'opacity-80' : ''}`}
    >
      {rowInner}
    </div>
  );
});

MemberRowCard.displayName = 'MemberRowCard';

export const MembersRosterDrawer: React.FC<MembersRosterDrawerProps> = memo(({
  onClose,
  currentUser,
  curTheme,
  falconIcon,
  searchQuery,
  onSearchChange,
  isCurrentUserOutside,
  currentRoomUsers,
  otherConnectedUsers,
  offlineMembers,
  getUserBanner,
  getUserDisplayName,
  getUserFlagNumber,
  getCountryNameFromFlag,
  getRoleLevel,
  isUserIgnored,
  onOpenUserProfile,
  onOpenPrivateChat,
  onInsertMention,
  onRevealNicks
}) => {
  const [activeTab, setActiveTab] = useState<RosterFilterTab>('all');

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const isLightDrawer = useMemo(() => getThemeLuminance(curTheme) > 0.45, [curTheme]);

  const canRevealNicks = Boolean(
    currentUser.role === 'hassan' ||
      currentUser.role === 'admin' ||
      currentUser.role === 'super' ||
      getRoleLevel(currentUser.role) >= 75
  );

  const totalOnlineCount = isCurrentUserOutside
    ? otherConnectedUsers.length
    : currentRoomUsers.length + otherConnectedUsers.length;

  const showRoomSection = !isCurrentUserOutside && (activeTab === 'all' || activeTab === 'room');
  const showOtherOnlineSection =
    activeTab === 'all' ||
    activeTab === 'online' ||
    (isCurrentUserOutside && activeTab === 'room');
  const showOfflineSection = activeTab === 'all' || activeTab === 'offline';

  const visibleCount =
    (showRoomSection ? currentRoomUsers.length : 0) +
    (showOtherOnlineSection ? otherConnectedUsers.length : 0) +
    (showOfflineSection ? offlineMembers.length : 0);

  const myLower = currentUser.username.trim().toLowerCase();

  const headerTextClass = isLightDrawer ? 'text-slate-900' : 'text-slate-100';
  const mutedTextClass = isLightDrawer ? 'text-slate-600' : 'text-slate-400';
  const dividerClass = isLightDrawer ? 'divide-slate-200/90' : 'divide-slate-800/60';
  const sectionHeaderClass = `${curTheme.subHeaderBg} ${
    curTheme.subHeaderText || (isLightDrawer ? 'text-slate-800' : curTheme.accentText)
  } border-y ${curTheme.subHeaderBorder} px-3 py-1.5 text-[11px] font-bold flex items-center justify-between gap-2 sticky top-0 z-30`;

  const tabBarContainerClass = isLightDrawer
    ? 'bg-slate-200/80 border border-slate-300/70'
    : 'bg-slate-900/75 border border-slate-800';

  const renderTabButton = (tabId: RosterFilterTab, label: string, count: number) => {
    const isActive = activeTab === tabId;
    return (
      <button
        key={tabId}
        type="button"
        onClick={() => setActiveTab(tabId)}
        className={`flex-1 min-w-0 px-2 py-1.5 rounded-lg text-[11px] font-bold whitespace-nowrap shrink-0 flex items-center justify-center gap-1 transition-colors duration-150 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 ${
          isActive
            ? isLightDrawer
              ? 'bg-white text-slate-900 shadow-xs'
              : 'bg-slate-800 text-amber-300 shadow-xs'
            : isLightDrawer
            ? 'text-slate-600 hover:text-slate-900'
            : 'text-slate-400 hover:text-slate-200'
        }`}
      >
        <span>{label}</span>
        <span className="tabular-nums opacity-75 text-[10px]">({count})</span>
      </button>
    );
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="قائمة الأعضاء"
      className={`absolute inset-y-0 right-0 z-40 h-full w-[86%] sm:w-[84%] max-w-[390px] ${curTheme.drawerBg} ${headerTextClass} shadow-2xl border-l ${curTheme.cardBorder} flex flex-col min-h-0 overflow-hidden drawer-panel-enter`}
    >
      {/* Header */}
      <div
        className={`${curTheme.drawerHeaderBg || curTheme.headerBg} px-3 py-2.5 flex items-center justify-between gap-2 border-b ${curTheme.headerBorder} shrink-0`}
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <div
            className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
              isLightDrawer ? 'bg-slate-200/80 text-slate-800' : 'bg-slate-800/90 text-amber-400'
            }`}
          >
            <Users className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <h2 className={`font-extrabold text-sm leading-tight truncate ${curTheme.headerAccent || headerTextClass}`}>
              قائمة الأعضاء
            </h2>
            <div className={`text-[11px] flex items-center gap-1.5 tabular-nums truncate ${mutedTextClass}`}>
              <span>متصل الآن: {totalOnlineCount}</span>
              <span aria-hidden="true">·</span>
              <span>غير متصل: {offlineMembers.length}</span>
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={onClose}
          aria-label="إغلاق قائمة الأعضاء"
          className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 transition-colors duration-150 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400 ${
            isLightDrawer
              ? 'bg-slate-200 hover:bg-red-600 text-slate-700 hover:text-white'
              : 'bg-slate-800 hover:bg-red-600 text-slate-200 hover:text-white'
          }`}
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Search & Filter Controls */}
      <div className={`p-2.5 space-y-2 ${curTheme.subHeaderBg} border-b ${curTheme.subHeaderBorder} shrink-0`}>
        <div className="relative">
          <Search className={`w-4 h-4 ${mutedTextClass} absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none`} />
          <input
            type="text"
            placeholder="ابحث بالاسم أو الحالة أو الغرفة..."
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            className={`w-full pr-9 pl-8 py-2 text-xs rounded-xl border outline-none transition-colors duration-150 ${
              curTheme.fieldBg || (isLightDrawer ? 'bg-white' : 'bg-slate-900')
            } ${curTheme.fieldText || headerTextClass} ${curTheme.fieldBorder || curTheme.cardBorder} ${
              curTheme.fieldPlaceholder || 'placeholder-slate-400'
            } ${curTheme.fieldFocus || 'focus:border-amber-400'}`}
          />
          {searchQuery.trim().length > 0 && (
            <button
              type="button"
              onClick={() => onSearchChange('')}
              aria-label="مسح البحث"
              className={`w-6 h-6 rounded-md flex items-center justify-center absolute left-2 top-1/2 -translate-y-1/2 transition-colors duration-150 cursor-pointer ${
                isLightDrawer ? 'hover:bg-slate-200 text-slate-600' : 'hover:bg-slate-700 text-slate-300'
              }`}
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Segmented Filter Tabs */}
        <div className={`flex items-center gap-1 p-1 rounded-xl ${tabBarContainerClass}`}>
          {renderTabButton('all', 'الكل', totalOnlineCount + offlineMembers.length)}
          {!isCurrentUserOutside && renderTabButton('room', 'الغرفة', currentRoomUsers.length)}
          {renderTabButton('online', 'المتصلون', totalOnlineCount)}
          {renderTabButton('offline', 'غير متصل', offlineMembers.length)}
        </div>
      </div>

      {/* Members List Body */}
      <div className={`flex-1 min-h-0 overflow-y-auto divide-y ${dividerClass}`}>
        {visibleCount === 0 ? (
          <div className="px-4 py-12 text-center space-y-3">
            <div
              className={`w-12 h-12 rounded-2xl mx-auto flex items-center justify-center ${
                isLightDrawer ? 'bg-slate-200 text-slate-600' : 'bg-slate-800/80 text-slate-400'
              }`}
            >
              <ShieldCheck className="w-6 h-6" />
            </div>
            <div className="space-y-1">
              <p className={`text-sm font-bold ${headerTextClass}`}>لا توجد نتائج مطابقة</p>
              <p className={`text-xs ${mutedTextClass}`}>
                {searchQuery.trim()
                  ? `لم نعثر على عضو يطابق "${searchQuery.trim()}"`
                  : 'لا يوجد أعضاء في هذا القسم حالياً'}
              </p>
            </div>
            {(searchQuery.trim() || activeTab !== 'all') && (
              <button
                type="button"
                onClick={() => {
                  onSearchChange('');
                  setActiveTab('all');
                }}
                className={`px-4 py-2 rounded-xl text-xs font-bold transition-colors duration-150 cursor-pointer ${curTheme.primaryBtn}`}
              >
                عرض جميع الأعضاء
              </button>
            )}
          </div>
        ) : (
          <>
            {/* Section 1: Current Room Users */}
            {showRoomSection && currentRoomUsers.length > 0 && (
              <div>
                <div className={sectionHeaderClass}>
                  <span className="truncate">في هذه الغرفة ({currentUser.room})</span>
                  <span className="tabular-nums shrink-0">{currentRoomUsers.length} متصل</span>
                </div>
                <div className={`divide-y ${dividerClass}`}>
                  {currentRoomUsers.map((u, idx) => {
                    const isSelf = u.username.trim().toLowerCase() === myLower;
                    return (
                      <MemberRowCard
                        key={u.id || u.username}
                        user={u}
                        isSameRoom
                        isSelf={isSelf}
                        isLightDrawer={isLightDrawer}
                        curTheme={curTheme}
                        falconIcon={falconIcon}
                        canRevealNicks={canRevealNicks}
                        bannerUrl={getUserBanner(u.username, u.nameBannerUrl)}
                        displayName={getUserDisplayName(u.username, u.displayName)}
                        flagNumber={getUserFlagNumber(u.username, u.flagNumber)}
                        countryName={getCountryNameFromFlag(u.flag)}
                        isIgnored={isUserIgnored(u.username)}
                        eager={idx < 14}
                        onSelect={onOpenUserProfile}
                        onPrivateChat={!isSelf ? onOpenPrivateChat : undefined}
                        onMention={!isSelf ? onInsertMention : undefined}
                        onReveal={!isSelf && canRevealNicks ? onRevealNicks : undefined}
                      />
                    );
                  })}
                </div>
              </div>
            )}

            {/* Section 2: Other Rooms & Lobby Online Users */}
            {showOtherOnlineSection && otherConnectedUsers.length > 0 && (
              <div>
                <div className={sectionHeaderClass}>
                  <span className="truncate">
                    {isCurrentUserOutside ? 'المتصلون الآن في الشات والبهو' : 'متصلون في غرف أخرى أو البهو'}
                  </span>
                  <span className="tabular-nums shrink-0">{otherConnectedUsers.length} متصل</span>
                </div>
                <div className={`divide-y ${dividerClass}`}>
                  {otherConnectedUsers.map((u, idx) => {
                    const isSelf = u.username.trim().toLowerCase() === myLower;
                    return (
                      <MemberRowCard
                        key={u.id || u.username}
                        user={u}
                        isSameRoom={false}
                        isSelf={isSelf}
                        isLightDrawer={isLightDrawer}
                        curTheme={curTheme}
                        falconIcon={falconIcon}
                        canRevealNicks={canRevealNicks}
                        bannerUrl={getUserBanner(u.username, u.nameBannerUrl)}
                        displayName={getUserDisplayName(u.username, u.displayName)}
                        flagNumber={getUserFlagNumber(u.username, u.flagNumber)}
                        countryName={getCountryNameFromFlag(u.flag)}
                        isIgnored={isUserIgnored(u.username)}
                        eager={currentRoomUsers.length + idx < 14}
                        onSelect={onOpenUserProfile}
                        onPrivateChat={!isSelf ? onOpenPrivateChat : undefined}
                        onReveal={!isSelf && canRevealNicks ? onRevealNicks : undefined}
                      />
                    );
                  })}
                </div>
              </div>
            )}

            {/* Section 3: Registered Offline Members */}
            {showOfflineSection && offlineMembers.length > 0 && (
              <div>
                <div className={sectionHeaderClass}>
                  <span className="truncate">الأعضاء المسجلون غير المتصلين</span>
                  <span className="tabular-nums shrink-0">{offlineMembers.length} عضو</span>
                </div>
                <div className={`divide-y ${dividerClass}`}>
                  {offlineMembers.map((m, idx) => {
                    const simulatedUser: User = {
                      id: `offline-${m.username}`,
                      username: m.username,
                      displayName: m.displayName || m.username,
                      avatarSeed: m.username,
                      role: m.role as any,
                      flag: m.flag,
                      flagNumber: m.flagNumber,
                      statusQuote: m.statusQuote || '',
                      avatarUrl: m.avatarUrl,
                      avatarFrame: m.avatarFrame,
                      memberBg: m.memberBg,
                      memberBgAspect: m.memberBgAspect,
                      profileBg: m.profileBg,
                      nameBannerUrl: m.nameBannerUrl,
                      giftBadges: m.giftBadges,
                      likes: m.likes || 100,
                      points: m.points || 500,
                      isVoice: false,
                      isSpeaking: false,
                      micSlot: null,
                      isMuted: false,
                      isTextMuted: false,
                      room: 'خارج الغرف'
                    };
                    return (
                      <MemberRowCard
                        key={m.username}
                        user={simulatedUser}
                        isOffline
                        isSameRoom={false}
                        isSelf={false}
                        isLightDrawer={isLightDrawer}
                        curTheme={curTheme}
                        falconIcon={falconIcon}
                        canRevealNicks={canRevealNicks}
                        bannerUrl={getUserBanner(m.username, m.nameBannerUrl)}
                        displayName={getUserDisplayName(m.username, m.displayName)}
                        flagNumber={getUserFlagNumber(m.username, m.flagNumber)}
                        countryName={getCountryNameFromFlag(m.flag)}
                        isIgnored={isUserIgnored(m.username)}
                        eager={currentRoomUsers.length + otherConnectedUsers.length + idx < 14}
                        onSelect={onOpenUserProfile}
                        onPrivateChat={onOpenPrivateChat}
                        onReveal={canRevealNicks ? onRevealNicks : undefined}
                      />
                    );
                  })}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
});

MembersRosterDrawer.displayName = 'MembersRosterDrawer';
