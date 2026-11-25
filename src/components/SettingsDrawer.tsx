import React, { useEffect, useState } from 'react';
import {
  Bell,
  BellOff,
  Camera,
  Eye,
  Key,
  Lock,
  LogOut,
  Play,
  Radio,
  Save,
  Settings,
  Shield,
  Sliders,
  Sparkles,
  Trash2,
  Unlock,
  User as UserIcon,
  UserX,
  Volume2,
  VolumeX,
  Wifi,
  X
} from 'lucide-react';
import type { User } from '../types/chat';
import type { ThemeFullStyle } from '../constants/themeStyles';
import { getThemeLuminance } from '../constants/themeStyles';
import {
  ALERT_SOUND_OPTIONS,
  JOIN_SOUND_OPTIONS,
  MENTION_SOUND_OPTIONS,
  MESSAGE_SOUND_OPTIONS,
  PRIVATE_SOUND_OPTIONS,
  type AlertSoundId,
  type JoinSoundId,
  type MentionSoundId,
  type MessageSoundId,
  type PrivateSoundId
} from '../utils/soundEffects';

type SettingsTabId = 'profile' | 'privacy' | 'sounds' | 'account';

export interface SettingsDrawerProps {
  onClose: () => void;
  curTheme: ThemeFullStyle;
  currentUser: User;
  falconIcon: string;
  profileVisitorsCount: number;
  onOpenProfileVisitors: () => void;
  onOpenMembershipDesign: () => void;
  isMembershipLocked: boolean;
  hasActiveMembershipStyle: boolean;
  canManageCurrentRoom: boolean;
  onOpenRoomSettings: () => void;
  settingName: string;
  onChangeSettingName: (val: string) => void;
  settingQuote: string;
  onChangeSettingQuote: (val: string) => void;
  settingNameColor: string;
  onChangeNameColor: (col: string) => void;
  settingTextColor: string;
  onChangeTextColor: (col: string) => void;
  settingAvatar: string;
  onChangeSettingAvatar: (val: string) => void;
  onUploadAvatar: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onRemoveAvatar: () => void;
  onSaveSettings: () => void;
  isPmDisabled: boolean;
  onTogglePmDisabled: () => void;
  allNotificationsDisabled: boolean;
  onToggleAllNotifications: () => void;
  keepAlivePlayerEnabled: boolean;
  isKeepAlivePlayingState: boolean;
  isKeepAlivePaused: boolean;
  onToggleKeepAliveEnabled: () => void;
  onToggleKeepAlivePause: () => void;
  localWeakNetMode: boolean;
  onToggleWeakNetMode: () => void;
  soundsMuted: boolean;
  onToggleSoundsMuted: () => void;
  testingSequence: boolean;
  onPlayToneSequence: () => void;
  selectedAlertSound: AlertSoundId;
  onChangeAlertSound: (id: AlertSoundId) => void;
  onPreviewAlertSound: (id: AlertSoundId) => void;
  selectedPrivateSound: PrivateSoundId;
  onChangePrivateSound: (id: PrivateSoundId) => void;
  onPreviewPrivateSound: (id: PrivateSoundId) => void;
  selectedMentionSound: MentionSoundId;
  onChangeMentionSound: (id: MentionSoundId) => void;
  onPreviewMentionSound: (id: MentionSoundId) => void;
  selectedMsgSound: MessageSoundId;
  onChangeMsgSound: (id: MessageSoundId) => void;
  onPreviewMsgSound: (id: MessageSoundId) => void;
  selectedJoinSound: JoinSoundId;
  onChangeJoinSound: (id: JoinSoundId) => void;
  onPreviewJoinSound: (id: JoinSoundId) => void;
  ignoredUsers: string[];
  onClearIgnoredUsers: () => void;
  onUnignoreUser: (username: string) => void;
  onOpenChangePassword: () => void;
  roleInfo: {
    short: string;
    badgeClass: string;
    description: string;
  };
  isSupremeHassan: boolean;
  onSwitchTestRole: (role: 'admin' | 'super' | 'member') => void;
  canOpenAdminPanel: boolean;
  adminUrl: string;
  onExitChat: () => void;
}

interface ToggleSwitchProps {
  checked: boolean;
  onToggle: () => void;
  label: string;
  isLight: boolean;
  activeTone?: 'emerald' | 'rose' | 'amber';
}

const ToggleSwitch: React.FC<ToggleSwitchProps> = ({
  checked,
  onToggle,
  label,
  isLight,
  activeTone = 'emerald'
}) => {
  const trackActiveClass =
    activeTone === 'rose'
      ? 'bg-rose-600'
      : activeTone === 'amber'
      ? 'bg-amber-500'
      : 'bg-emerald-600';

  const trackInactiveClass = isLight ? 'bg-slate-300' : 'bg-slate-700';

  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={onToggle}
      className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full p-0.5 transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 ${
        checked ? trackActiveClass : trackInactiveClass
      }`}
    >
      <span
        className={`inline-block h-5 w-5 rounded-full bg-white shadow-sm transition-transform duration-150 ${
          checked ? '-translate-x-5' : 'translate-x-0'
        }`}
      />
    </button>
  );
};

export const SettingsDrawer: React.FC<SettingsDrawerProps> = ({
  onClose,
  curTheme,
  currentUser,
  falconIcon,
  profileVisitorsCount,
  onOpenProfileVisitors,
  onOpenMembershipDesign,
  isMembershipLocked,
  hasActiveMembershipStyle,
  canManageCurrentRoom,
  onOpenRoomSettings,
  settingName,
  onChangeSettingName,
  settingQuote,
  onChangeSettingQuote,
  settingNameColor,
  onChangeNameColor,
  settingTextColor,
  onChangeTextColor,
  settingAvatar,
  onChangeSettingAvatar,
  onUploadAvatar,
  onRemoveAvatar,
  onSaveSettings,
  isPmDisabled,
  onTogglePmDisabled,
  allNotificationsDisabled,
  onToggleAllNotifications,
  keepAlivePlayerEnabled,
  isKeepAlivePlayingState,
  isKeepAlivePaused,
  onToggleKeepAliveEnabled,
  onToggleKeepAlivePause,
  localWeakNetMode,
  onToggleWeakNetMode,
  soundsMuted,
  onToggleSoundsMuted,
  testingSequence,
  onPlayToneSequence,
  selectedAlertSound,
  onChangeAlertSound,
  onPreviewAlertSound,
  selectedPrivateSound,
  onChangePrivateSound,
  onPreviewPrivateSound,
  selectedMentionSound,
  onChangeMentionSound,
  onPreviewMentionSound,
  selectedMsgSound,
  onChangeMsgSound,
  onPreviewMsgSound,
  selectedJoinSound,
  onChangeJoinSound,
  onPreviewJoinSound,
  ignoredUsers,
  onClearIgnoredUsers,
  onUnignoreUser,
  onOpenChangePassword,
  roleInfo,
  isSupremeHassan,
  onSwitchTestRole,
  canOpenAdminPanel,
  adminUrl,
  onExitChat
}) => {
  const [activeTab, setActiveTab] = useState<SettingsTabId>('profile');

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const isLight = getThemeLuminance(curTheme) > 0.45;

  const drawerTextClass = isLight ? 'text-slate-900' : 'text-slate-100';
  const sectionBgClass = isLight
    ? 'bg-white border border-slate-200/90'
    : 'bg-white/[0.04] border border-white/10';
  const dividerClass = isLight ? 'border-slate-200/80' : 'border-white/10';
  const headingTextClass = isLight ? 'text-slate-900' : 'text-slate-100';
  const subTextClass = isLight ? 'text-slate-500' : 'text-slate-400';
  const inputClass = isLight
    ? 'w-full px-3 py-2 rounded-lg border border-slate-300 bg-slate-50 text-slate-900 placeholder-slate-400 text-xs font-semibold outline-none focus:border-amber-500 focus:bg-white transition-colors'
    : 'w-full px-3 py-2 rounded-lg border border-white/15 bg-black/25 text-slate-100 placeholder-slate-400 text-xs font-semibold outline-none focus:border-amber-400 focus:bg-black/40 transition-colors';
  const selectClass = isLight
    ? 'w-full px-2.5 py-2 rounded-lg border border-slate-300 bg-white text-slate-800 text-xs font-semibold outline-none focus:border-amber-500'
    : 'w-full px-2.5 py-2 rounded-lg border border-white/15 bg-slate-900 text-slate-100 text-xs font-semibold outline-none focus:border-amber-400';
  const subtleBtnClass = isLight
    ? 'bg-slate-100 hover:bg-slate-200 text-slate-800 border border-slate-300/80'
    : 'bg-white/10 hover:bg-white/15 text-slate-100 border border-white/15';

  const tabs: Array<{ id: SettingsTabId; label: string; icon: React.ReactNode }> = [
    { id: 'profile', label: 'الملف', icon: <UserIcon className="w-3.5 h-3.5" /> },
    { id: 'privacy', label: 'الخصوصية', icon: <Sliders className="w-3.5 h-3.5" /> },
    { id: 'sounds', label: 'الأصوات', icon: <Volume2 className="w-3.5 h-3.5" /> },
    { id: 'account', label: 'الحساب', icon: <Shield className="w-3.5 h-3.5" /> }
  ];

  const soundRows = [
    {
      label: 'الإشعار والتنبيه العام',
      value: selectedAlertSound,
      options: ALERT_SOUND_OPTIONS,
      onChange: (val: string) => onChangeAlertSound(val as AlertSoundId),
      onPreview: () => onPreviewAlertSound(selectedAlertSound)
    },
    {
      label: 'الرسائل الخاصة (الخاص)',
      value: selectedPrivateSound,
      options: PRIVATE_SOUND_OPTIONS,
      onChange: (val: string) => onChangePrivateSound(val as PrivateSoundId),
      onPreview: () => onPreviewPrivateSound(selectedPrivateSound)
    },
    {
      label: 'الإشارة والمنشن (@اسمك)',
      value: selectedMentionSound,
      options: MENTION_SOUND_OPTIONS,
      onChange: (val: string) => onChangeMentionSound(val as MentionSoundId),
      onPreview: () => onPreviewMentionSound(selectedMentionSound)
    },
    {
      label: 'رسائل الغرفة العامة',
      value: selectedMsgSound,
      options: MESSAGE_SOUND_OPTIONS,
      onChange: (val: string) => onChangeMsgSound(val as MessageSoundId),
      onPreview: () => onPreviewMsgSound(selectedMsgSound)
    },
    {
      label: 'صوت دخول الأعضاء للغرفة',
      value: selectedJoinSound,
      options: JOIN_SOUND_OPTIONS,
      onChange: (val: string) => onChangeJoinSound(val as JoinSoundId),
      onPreview: () => onPreviewJoinSound(selectedJoinSound)
    }
  ];

  return (
    <div
      className={`absolute inset-y-0 right-0 w-[86%] max-w-md ${curTheme.drawerBg} ${drawerTextClass} z-40 shadow-2xl border-l ${curTheme.cardBorder} flex flex-col min-h-0 overflow-hidden animate-in slide-in-from-right duration-200 text-right`}
    >
      {/* Header */}
      <div
        className={`shrink-0 ${curTheme.drawerHeaderBg || curTheme.headerBg} ${curTheme.accentText} px-3 py-2.5 flex items-center justify-between border-b ${curTheme.headerBorder}`}
      >
        <div className="flex items-center gap-2 min-w-0">
          <Settings className="w-4 h-4 shrink-0" />
          <span className="font-bold text-sm truncate">الإعدادات والضبط</span>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="w-8 h-8 shrink-0 bg-red-600 hover:bg-red-700 text-white flex items-center justify-center rounded-lg font-bold cursor-pointer transition-colors"
          title="إغلاق الضبط"
          aria-label="إغلاق الضبط"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* 4-Tab Segmented Bar */}
      <div className={`shrink-0 px-2.5 pt-2 pb-2 border-b ${dividerClass}`}>
        <div
          className={`grid grid-cols-4 gap-1 p-1 rounded-xl ${
            isLight ? 'bg-slate-200/80' : 'bg-black/30'
          }`}
          role="tablist"
          aria-label="أقسام الضبط"
        >
          {tabs.map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={isActive}
                onClick={() => setActiveTab(tab.id)}
                className={`min-h-[36px] px-1.5 rounded-lg text-[11px] font-bold flex items-center justify-center gap-1 whitespace-nowrap transition-all cursor-pointer ${
                  isActive
                    ? isLight
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'bg-amber-500 text-slate-950 shadow-xs'
                    : isLight
                    ? 'text-slate-600 hover:text-slate-900'
                    : 'text-slate-300 hover:text-white'
                }`}
              >
                {tab.icon}
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Scrollable Content */}
      <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-3 text-xs modal-scroll-container overscroll-contain">
        {/* TAB 1: PROFILE & APPEARANCE */}
        {activeTab === 'profile' && (
          <>
            {/* Quick Profile Actions: Visitors & Membership Design */}
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={onOpenProfileVisitors}
                className={`min-h-[54px] p-2.5 rounded-xl flex items-center gap-2 text-right cursor-pointer transition-colors ${sectionBgClass} ${
                  isLight ? 'hover:bg-slate-50' : 'hover:bg-white/[0.08]'
                }`}
              >
                <div className="w-8 h-8 rounded-lg bg-amber-500/15 text-amber-500 flex items-center justify-center shrink-0">
                  <Eye className="w-4 h-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className={`font-bold text-xs truncate ${headingTextClass}`}>زوار ملفي</div>
                  <div className={`text-[11px] tabular-nums ${subTextClass}`}>
                    {profileVisitorsCount} زائر
                  </div>
                </div>
              </button>

              <button
                type="button"
                onClick={onOpenMembershipDesign}
                className={`min-h-[54px] p-2.5 rounded-xl flex items-center gap-2 text-right cursor-pointer transition-colors ${sectionBgClass} ${
                  isLight ? 'hover:bg-slate-50' : 'hover:bg-white/[0.08]'
                }`}
              >
                <div className="w-8 h-8 rounded-lg bg-indigo-500/15 text-indigo-400 flex items-center justify-center shrink-0">
                  {isMembershipLocked ? <Lock className="w-4 h-4 text-rose-400" /> : <Sparkles className="w-4 h-4" />}
                </div>
                <div className="min-w-0 flex-1">
                  <div className={`font-bold text-xs truncate ${headingTextClass}`}>تصميم العضوية</div>
                  <div className={`text-[11px] truncate ${hasActiveMembershipStyle ? 'text-emerald-500 font-semibold' : subTextClass}`}>
                    {hasActiveMembershipStyle ? 'تصميم مفعل' : 'إطار وخلفية'}
                  </div>
                </div>
              </button>
            </div>

            {/* Name, Quote & Colors */}
            <div className={`rounded-xl ${sectionBgClass} divide-y ${dividerClass}`}>
              <div className="p-3 space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <label htmlFor="settings-display-name" className={`font-bold text-xs ${headingTextClass}`}>
                    الزخرفة واسم العرض
                  </label>
                  <span className={`text-[11px] font-mono truncate max-w-[140px] ${subTextClass}`} title="الاسم الأصلي الثابت لتسجيل الدخول">
                    @{currentUser.username}
                  </span>
                </div>
                <input
                  id="settings-display-name"
                  type="text"
                  value={settingName}
                  onChange={(e) => onChangeSettingName(e.target.value)}
                  placeholder="اكتب اسمك أو زخرفتك..."
                  className={inputClass}
                />
              </div>

              <div className="p-3 space-y-1.5">
                <label htmlFor="settings-status-quote" className={`block font-bold text-xs ${headingTextClass}`}>
                  الحالة والعبارة الشخصية
                </label>
                <input
                  id="settings-status-quote"
                  type="text"
                  value={settingQuote}
                  onChange={(e) => onChangeSettingQuote(e.target.value)}
                  placeholder="اكتب حالتك أو عبارتك التعبيرية..."
                  className={inputClass}
                />
              </div>

              <div className="p-3 grid grid-cols-2 gap-2.5">
                <label className="space-y-1 cursor-pointer">
                  <span className={`block text-[11px] font-bold ${subTextClass}`}>لون الاسم</span>
                  <div
                    className={`flex items-center gap-2 px-2 py-1.5 rounded-lg border ${
                      isLight ? 'border-slate-300 bg-slate-50' : 'border-white/15 bg-black/25'
                    }`}
                  >
                    <input
                      type="color"
                      value={settingNameColor}
                      onChange={(e) => onChangeNameColor(e.target.value)}
                      className="w-7 h-7 cursor-pointer rounded border-0 bg-transparent p-0 shrink-0"
                    />
                    <span className="font-bold text-xs truncate flex-1" style={{ color: settingNameColor }}>
                      {settingName || currentUser.username}
                    </span>
                  </div>
                </label>

                <label className="space-y-1 cursor-pointer">
                  <span className={`block text-[11px] font-bold ${subTextClass}`}>لون الخط</span>
                  <div
                    className={`flex items-center gap-2 px-2 py-1.5 rounded-lg border ${
                      isLight ? 'border-slate-300 bg-slate-50' : 'border-white/15 bg-black/25'
                    }`}
                  >
                    <input
                      type="color"
                      value={settingTextColor}
                      onChange={(e) => onChangeTextColor(e.target.value)}
                      className="w-7 h-7 cursor-pointer rounded border-0 bg-transparent p-0 shrink-0"
                    />
                    <span className="font-bold text-xs truncate flex-1" style={{ color: settingTextColor }}>
                      معاينة الخط
                    </span>
                  </div>
                </label>
              </div>
            </div>

            {/* Avatar Section */}
            <div className={`rounded-xl p-3 space-y-2.5 ${sectionBgClass}`}>
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <img
                    src={settingAvatar || currentUser.avatarUrl || falconIcon}
                    alt="الصورة الشخصية"
                    className="w-10 h-10 rounded-full object-cover border border-amber-500/70 shrink-0"
                    onError={(e) => {
                      (e.currentTarget as HTMLImageElement).src = falconIcon;
                    }}
                  />
                  <div className="min-w-0">
                    <div className={`font-bold text-xs ${headingTextClass}`}>الصورة الشخصية</div>
                    <div className={`text-[11px] ${subTextClass}`}>رفع من الجهاز أو رابط مباشر</div>
                  </div>
                </div>

                {settingAvatar && (
                  <button
                    type="button"
                    onClick={onRemoveAvatar}
                    className="min-h-[34px] px-2.5 rounded-lg bg-rose-500/15 hover:bg-rose-500/25 text-rose-500 font-bold text-[11px] inline-flex items-center gap-1 cursor-pointer transition-colors shrink-0"
                    title="حذف صورتي الشخصية"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>حذف</span>
                  </button>
                )}
              </div>

              <label className="w-full min-h-[38px] px-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-bold text-xs flex items-center justify-center gap-1.5 cursor-pointer transition-colors">
                <Camera className="w-3.5 h-3.5" />
                <span>اختيار صورة من هاتفك أو جهازك</span>
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={onUploadAvatar}
                />
              </label>

              <input
                type="text"
                placeholder="أو الصق رابط صورة مباشرة..."
                value={settingAvatar}
                onChange={(e) => onChangeSettingAvatar(e.target.value)}
                className={inputClass}
              />
            </div>
          </>
        )}

        {/* TAB 2: PRIVACY, ROOM & CONNECTION */}
        {activeTab === 'privacy' && (
          <>
            {/* Current Room Settings (if permitted & inside a room) */}
            {canManageCurrentRoom && currentUser.room && currentUser.room !== 'خارج الغرف' && (
              <div className={`rounded-xl p-3 flex items-center justify-between gap-2.5 ${sectionBgClass}`}>
                <div className="min-w-0">
                  <div className={`font-bold text-xs truncate ${headingTextClass}`}>
                    إعدادات الغرفة: {currentUser.room}
                  </div>
                  <div className={`text-[11px] mt-0.5 leading-snug ${subTextClass}`}>
                    الاسم، البنر، الإعلان المثبت، قفل الشات والمايكات
                  </div>
                </div>
                <button
                  type="button"
                  onClick={onOpenRoomSettings}
                  className="min-h-[38px] px-3 bg-amber-500 hover:bg-amber-600 text-slate-950 font-black text-xs rounded-lg shrink-0 inline-flex items-center gap-1 cursor-pointer transition-colors"
                >
                  <Sliders className="w-3.5 h-3.5" />
                  <span>تعديل</span>
                </button>
              </div>
            )}

            {/* Clean Toggle Switches List */}
            <div className={`rounded-xl ${sectionBgClass} divide-y ${dividerClass}`}>
              {/* 1. Private Messages Lock */}
              <div className="p-3 flex items-center justify-between gap-3">
                <div className="flex items-start gap-2.5 min-w-0">
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${isPmDisabled ? 'bg-rose-500/15 text-rose-500' : 'bg-emerald-500/15 text-emerald-500'}`}>
                    {isPmDisabled ? <Lock className="w-4 h-4" /> : <Unlock className="w-4 h-4" />}
                  </div>
                  <div className="min-w-0">
                    <div className={`font-bold text-xs ${headingTextClass}`}>المحادثات الخاصة (الخاص)</div>
                    <div className={`text-[11px] mt-0.5 ${subTextClass}`}>
                      {isPmDisabled ? 'مقفل حالياً (ممنوع استلام الخاص)' : 'مفعّل (يسمح باستلام الخاص)'}
                    </div>
                  </div>
                </div>
                <ToggleSwitch
                  checked={!isPmDisabled}
                  onToggle={onTogglePmDisabled}
                  label="تفعيل أو قفل المحادثات الخاصة"
                  isLight={isLight}
                  activeTone="emerald"
                />
              </div>

              {/* 2. Global Notifications Toggle */}
              <div className="p-3 flex items-center justify-between gap-3">
                <div className="flex items-start gap-2.5 min-w-0">
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${allNotificationsDisabled ? 'bg-rose-500/15 text-rose-500' : 'bg-amber-500/15 text-amber-500'}`}>
                    {allNotificationsDisabled ? <BellOff className="w-4 h-4" /> : <Bell className="w-4 h-4" />}
                  </div>
                  <div className="min-w-0">
                    <div className={`font-bold text-xs ${headingTextClass}`}>التنبيهات والإشعارات العامة</div>
                    <div className={`text-[11px] mt-0.5 ${subTextClass}`}>
                      {allNotificationsDisabled ? 'صامت تام (كل الإشعارات معطلة)' : 'التنبيهات والأصوات مفعلة'}
                    </div>
                  </div>
                </div>
                <ToggleSwitch
                  checked={!allNotificationsDisabled}
                  onToggle={onToggleAllNotifications}
                  label="تفعيل أو تعطيل التنبيهات"
                  isLight={isLight}
                  activeTone="amber"
                />
              </div>

              {/* 3. Weak Network / Data Saver */}
              <div className="p-3 flex items-center justify-between gap-3">
                <div className="flex items-start gap-2.5 min-w-0">
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${localWeakNetMode ? 'bg-amber-500/15 text-amber-500' : 'bg-cyan-500/15 text-cyan-500'}`}>
                    <Wifi className="w-4 h-4" />
                  </div>
                  <div className="min-w-0">
                    <div className={`font-bold text-xs ${headingTextClass}`}>وضع الإنترنت الضعيف</div>
                    <div className={`text-[11px] mt-0.5 leading-snug ${subTextClass}`}>
                      {localWeakNetMode ? 'مفعّل — توفير البيانات وتخفيف الوسائط' : 'تلقائي حسب سرعة الشبكة'}
                    </div>
                  </div>
                </div>
                <ToggleSwitch
                  checked={localWeakNetMode}
                  onToggle={onToggleWeakNetMode}
                  label="تفعيل وضع الإنترنت الضعيف"
                  isLight={isLight}
                  activeTone="amber"
                />
              </div>

              {/* 4. Keep-Alive Background Audio Player */}
              <div className="p-3 space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-start gap-2.5 min-w-0">
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${keepAlivePlayerEnabled ? 'bg-emerald-500/15 text-emerald-500' : 'bg-slate-500/15 text-slate-400'}`}>
                      <Radio className="w-4 h-4" />
                    </div>
                    <div className="min-w-0">
                      <div className={`font-bold text-xs ${headingTextClass}`}>مشغل منع تجميد الهاتف</div>
                      <div className={`text-[11px] mt-0.5 leading-snug ${subTextClass}`}>
                        {keepAlivePlayerEnabled && isKeepAlivePlayingState
                          ? 'نشط الآن في شريط الإشعارات'
                          : keepAlivePlayerEnabled && isKeepAlivePaused
                          ? 'مفعّل (متوقف مؤقتاً)'
                          : keepAlivePlayerEnabled
                          ? 'مفعّل وجاهز في الخلفية'
                          : 'يبقي اتصالك حياً عند قفل الشاشة'}
                      </div>
                    </div>
                  </div>
                  <ToggleSwitch
                    checked={keepAlivePlayerEnabled}
                    onToggle={onToggleKeepAliveEnabled}
                    label="تفعيل مشغل منع تجميد الهاتف"
                    isLight={isLight}
                    activeTone="emerald"
                  />
                </div>

                {keepAlivePlayerEnabled && (
                  <button
                    type="button"
                    onClick={onToggleKeepAlivePause}
                    className={`w-full min-h-[36px] px-3 rounded-lg font-bold text-xs flex items-center justify-center gap-1.5 cursor-pointer transition-colors ${subtleBtnClass}`}
                  >
                    {isKeepAlivePlayingState ? <VolumeX className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                    <span>{isKeepAlivePlayingState ? 'إيقاف المشغل مؤقتاً' : 'تشغيل المشغل الآن'}</span>
                  </button>
                )}
              </div>
            </div>

            {/* Ignored Users List */}
            <div className={`rounded-xl p-3 space-y-2 ${sectionBgClass}`}>
              <div className={`flex items-center justify-between pb-2 border-b ${dividerClass}`}>
                <div className="flex items-center gap-1.5 font-bold text-xs">
                  <UserX className="w-4 h-4 text-rose-500" />
                  <span className={headingTextClass}>الأعضاء المتجاهلون</span>
                  <span className={`tabular-nums ${subTextClass}`}>({ignoredUsers.length})</span>
                </div>
                {ignoredUsers.length > 0 && (
                  <button
                    type="button"
                    onClick={onClearIgnoredUsers}
                    className="text-[11px] text-rose-500 hover:text-rose-400 font-bold cursor-pointer"
                  >
                    إلغاء تجاهل الكل
                  </button>
                )}
              </div>

              {ignoredUsers.length === 0 ? (
                <div className={`text-[11px] py-1.5 text-center leading-relaxed ${subTextClass}`}>
                  لا يوجد أعضاء متجاهلون حالياً. لتجاهل شخص اضغط على اسمه في الدردشة واختر تجاهل.
                </div>
              ) : (
                <div className="space-y-1.5 max-h-40 overflow-y-auto pr-0.5">
                  {ignoredUsers.map((username) => (
                    <div
                      key={username}
                      className={`flex items-center justify-between px-2.5 py-2 rounded-lg border text-xs ${
                        isLight ? 'bg-slate-50 border-slate-200' : 'bg-black/20 border-white/10'
                      }`}
                    >
                      <span className={`font-bold truncate ${headingTextClass}`}>{username}</span>
                      <button
                        type="button"
                        onClick={() => onUnignoreUser(username)}
                        className="px-2.5 py-1 rounded-md bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-500 text-[11px] font-bold transition-colors cursor-pointer shrink-0"
                      >
                        إلغاء التجاهل
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}

        {/* TAB 3: NOTIFICATION SOUNDS */}
        {activeTab === 'sounds' && (
          <>
            <div className={`rounded-xl p-3 space-y-2.5 ${sectionBgClass}`}>
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${soundsMuted ? 'bg-rose-500/15 text-rose-500' : 'bg-emerald-500/15 text-emerald-500'}`}>
                    {soundsMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
                  </div>
                  <div className="min-w-0">
                    <div className={`font-bold text-xs ${headingTextClass}`}>التنبيهات الصوتية</div>
                    <div className={`text-[11px] ${subTextClass}`}>
                      {soundsMuted ? 'الأصوات مكتومة حالياً' : 'الأصوات مفعلة'}
                    </div>
                  </div>
                </div>
                <ToggleSwitch
                  checked={!soundsMuted}
                  onToggle={onToggleSoundsMuted}
                  label="تشغيل أو كتم التنبيهات الصوتية"
                  isLight={isLight}
                  activeTone="emerald"
                />
              </div>

              <button
                type="button"
                disabled={testingSequence}
                onClick={onPlayToneSequence}
                className="w-full min-h-[38px] px-3 bg-amber-500 hover:bg-amber-600 disabled:opacity-60 text-slate-950 font-black text-xs rounded-lg flex items-center justify-center gap-1.5 cursor-pointer transition-colors"
              >
                <Play className="w-3.5 h-3.5 fill-current" />
                <span>
                  {testingSequence
                    ? 'جارٍ الاستماع المتتابع...'
                    : 'اختبار النغمات الثلاث بالتتابع (عام، خاص، منشن)'}
                </span>
              </button>
            </div>

            <div className={`rounded-xl ${sectionBgClass} divide-y ${dividerClass}`}>
              {soundRows.map((row) => (
                <div key={row.label} className="p-3 space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className={`font-bold text-[11.5px] ${headingTextClass}`}>{row.label}</span>
                    <button
                      type="button"
                      onClick={row.onPreview}
                      className={`min-h-[28px] px-2.5 rounded-md text-[11px] font-bold inline-flex items-center gap-1 cursor-pointer transition-colors shrink-0 ${subtleBtnClass}`}
                      title={`استماع لنغمة ${row.label}`}
                    >
                      <Play className="w-2.5 h-2.5 fill-current" />
                      <span>استماع</span>
                    </button>
                  </div>
                  <select
                    value={row.value}
                    onChange={(e) => row.onChange(e.target.value)}
                    className={selectClass}
                  >
                    {row.options.map((opt) => (
                      <option key={opt.id} value={opt.id}>
                        {opt.icon} {opt.label} - {opt.desc}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
          </>
        )}

        {/* TAB 4: ACCOUNT, SECURITY & ROLE */}
        {activeTab === 'account' && (
          <>
            <button
              type="button"
              onClick={onOpenChangePassword}
              className={`w-full min-h-[46px] px-3 rounded-xl font-bold text-xs flex items-center justify-between cursor-pointer transition-colors ${sectionBgClass} ${
                isLight ? 'hover:bg-slate-50' : 'hover:bg-white/[0.08]'
              }`}
            >
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-amber-500/15 text-amber-500 flex items-center justify-center shrink-0">
                  <Key className="w-4 h-4" />
                </div>
                <div className="text-right">
                  <div className={`font-bold text-xs ${headingTextClass}`}>تغيير كلمة المرور</div>
                  <div className={`text-[11px] ${subTextClass}`}>تحديث كلمة مرور حسابك</div>
                </div>
              </div>
              <span className={`text-xs font-bold ${subTextClass}`}>تعديل ←</span>
            </button>

            <div className={`rounded-xl p-3 space-y-2 ${sectionBgClass}`}>
              <div className="flex items-center justify-between gap-2">
                <span className={`font-bold text-xs ${headingTextClass}`}>رتبتك وصلاحياتك</span>
                <span className={`px-2 py-0.5 rounded text-[10.5px] font-bold ${roleInfo.badgeClass}`}>
                  {roleInfo.short}
                </span>
              </div>
              <div className={`text-[11px] leading-relaxed ${subTextClass}`}>
                {roleInfo.description}
              </div>

              {isSupremeHassan && (
                <div className={`pt-2 border-t ${dividerClass} space-y-1.5`}>
                  <div className={`text-[11px] font-bold ${headingTextClass}`}>
                    تبديل الرتبة للاختبار الفوري:
                  </div>
                  <div className="grid grid-cols-3 gap-1.5">
                    <button
                      type="button"
                      onClick={() => onSwitchTestRole('admin')}
                      className={`min-h-[34px] rounded-lg font-bold text-[11px] transition-colors cursor-pointer ${
                        String(currentUser.role) === 'admin'
                          ? 'bg-red-600 text-white'
                          : subtleBtnClass
                      }`}
                    >
                      👑 Admin
                    </button>
                    <button
                      type="button"
                      onClick={() => onSwitchTestRole('super')}
                      className={`min-h-[34px] rounded-lg font-bold text-[11px] transition-colors cursor-pointer ${
                        String(currentUser.role) === 'super'
                          ? 'bg-amber-600 text-white'
                          : subtleBtnClass
                      }`}
                    >
                      🛡️ Super
                    </button>
                    <button
                      type="button"
                      onClick={() => onSwitchTestRole('member')}
                      className={`min-h-[34px] rounded-lg font-bold text-[11px] transition-colors cursor-pointer ${
                        String(currentUser.role) === 'member'
                          ? 'bg-indigo-600 text-white'
                          : subtleBtnClass
                      }`}
                    >
                      🎖️ Member
                    </button>
                  </div>
                </div>
              )}
            </div>

            {canOpenAdminPanel && (
              <a
                href={adminUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="w-full min-h-[44px] px-3 bg-amber-500 hover:bg-amber-600 text-slate-950 font-black rounded-xl flex items-center justify-center gap-1.5 text-xs cursor-pointer transition-colors"
                title="فتح لوحة التحكم المستقلة في تبويب جديد مع بقاء الشات مفتوحاً"
              >
                <Shield className="w-4 h-4" />
                <span>فتح لوحة التحكم المستقلة (/admin)</span>
              </a>
            )}

            <button
              type="button"
              onClick={onExitChat}
              className="w-full min-h-[44px] px-3 bg-rose-600 hover:bg-rose-700 text-white font-black rounded-xl flex items-center justify-center gap-1.5 text-xs cursor-pointer transition-colors"
            >
              <LogOut className="w-4 h-4" />
              <span>تسجيل خروج ومسح المحادثات</span>
            </button>
          </>
        )}
      </div>

      {/* Sticky Bottom Action Bar: Save + Quick Exit */}
      <div className={`shrink-0 p-2.5 border-t ${dividerClass} flex items-center gap-2`}>
        <button
          type="button"
          onClick={onSaveSettings}
          className="flex-1 min-h-[42px] px-3 bg-[#48a942] hover:bg-emerald-600 text-white font-bold rounded-xl shadow-xs flex items-center justify-center gap-1.5 text-xs sm:text-sm cursor-pointer transition-colors"
        >
          <Save className="w-4 h-4" />
          <span>حفظ الإعدادات</span>
        </button>
        <button
          type="button"
          onClick={onExitChat}
          className="min-h-[42px] px-3 bg-rose-600 hover:bg-rose-700 text-white font-bold rounded-xl shadow-xs flex items-center justify-center gap-1.5 text-xs cursor-pointer transition-colors shrink-0"
          title="تسجيل خروج ومسح المحادثات"
        >
          <LogOut className="w-4 h-4" />
          <span>خروج</span>
        </button>
      </div>
    </div>
  );
};
