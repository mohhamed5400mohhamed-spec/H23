import React, { useEffect, useMemo, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import {
  Shield,
  Lock,
  ArrowRight,
  LogOut,
  AlertTriangle,
  CheckCircle2,
  Info,
  Loader2,
  Eye,
  EyeOff
} from 'lucide-react';
import {
  AdminControlSuite,
  type User as AdminSuiteUser,
  type LikesThresholdSettings,
  type ServerSecuritySettings,
  type MessageRetentionLimits,
  type StaffMemo,
  type BannedRecord,
  type MutedRecord,
  type FilterAlertItem,
  type RegisteredMemberItem,
  type ChatRoom,
  type MonitorEvent
} from './components/AdminControlSuite';
import type { RoomStatData } from './components/RoomStatsPieChart';
import type { RoleDefinition, ChatQualitySettings } from './types/chat';
import type { ChatShortcut } from './utils/chatShortcuts';
import type { CustomThemePreset } from './constants/themeStyles';
import {
  DEFAULT_EMBLEMS_CONFIG,
  DEFAULT_FALCON_CHAT_BANNER,
  DEFAULT_FALCON_AVATAR_ICON,
  type EmblemsConfig
} from './utils/emblemsSystem';
import {
  DEFAULT_CHAT_QUALITY_SETTINGS,
  setServerChatQualitySettings
} from './utils/networkQualityEngine';
import { generateDeviceFingerprint, detectIncognitoMode } from './utils/countryDetect';

type AdminTabId =
  | 'moderation'
  | 'roomControls'
  | 'security'
  | 'bans'
  | 'broadcast'
  | 'stats'
  | 'memos'
  | 'words'
  | 'shortcuts'
  | 'logs'
  | 'matrix'
  | 'welcome'
  | 'emblems'
  | 'colors'
  | 'bots'
  | 'quality';

const VALID_ADMIN_TABS = new Set<string>([
  'moderation',
  'roomControls',
  'security',
  'bans',
  'broadcast',
  'stats',
  'memos',
  'words',
  'shortcuts',
  'logs',
  'matrix',
  'welcome',
  'emblems',
  'colors',
  'bots',
  'quality'
]);

const DEFAULT_ROLES_CONFIG: RoleDefinition[] = [
  { id: 'hassan', name: '🦅 إدارة عليا (hassan)', level: 100000, badgeColor: 'bg-gradient-to-r from-amber-500 via-yellow-400 to-amber-600 text-black font-black shadow-lg', isSystem: true },
  { id: 'admin', name: '👑 مدير النظام (Admin)', level: 100, badgeColor: 'bg-red-600 text-white', isSystem: true },
  { id: 'super', name: '🛡️ سوبر إداري (Super)', level: 75, badgeColor: 'bg-amber-600 text-white', isSystem: true },
  { id: 'member', name: '🎖️ عضو معتمد (Member)', level: 50, badgeColor: 'bg-indigo-600 text-white', isSystem: true },
  { id: 'guest', name: '👤 زائر (Guest)', level: 10, badgeColor: 'bg-slate-600 text-white', isSystem: true }
];

export default function AdminApp() {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [isRestoring, setIsRestoring] = useState(() => {
    try {
      return Boolean(localStorage.getItem('soqoor_session_token') && localStorage.getItem('soqoor_session_username'));
    } catch {
      return false;
    }
  });
  const [currentUser, setCurrentUser] = useState<AdminSuiteUser | null>(null);
  const [authError, setAuthError] = useState('');
  const [loginUsername, setLoginUsername] = useState(() => {
    try {
      return localStorage.getItem('soqoor_session_username') || localStorage.getItem('soqoor_last_member_username') || '';
    } catch {
      return '';
    }
  });
  const [loginPassword, setLoginPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmittingLogin, setIsSubmittingLogin] = useState(false);
  const [needsAdminSetup, setNeedsAdminSetup] = useState(false);
  const [adminClaimPassword, setAdminClaimPassword] = useState('');
  const [showAdminClaimPassword, setShowAdminClaimPassword] = useState(false);
  const [isClaimingAdmin, setIsClaimingAdmin] = useState(false);
  const [adminClaimError, setAdminClaimError] = useState('');

  // Admin panel data states
  const [rosterUsers, setRosterUsers] = useState<AdminSuiteUser[]>([]);
  const [allRegisteredMembers, setAllRegisteredMembers] = useState<RegisteredMemberItem[]>([]);
  const [roomsList, setRoomsList] = useState<ChatRoom[]>([]);
  const [roomStatsData, setRoomStatsData] = useState<RoomStatData[]>([]);
  const [bannedList, setBannedList] = useState<BannedRecord[]>([]);
  const [mutedList, setMutedList] = useState<MutedRecord[]>([]);
  const [roomSettings, setRoomSettings] = useState<{
    isChatLocked: boolean;
    slowModeSeconds: number;
    isVoiceLocked: boolean;
    showDeletedNotice?: boolean;
  }>({ isChatLocked: false, slowModeSeconds: 0, isVoiceLocked: false });
  const [serverSecurity, setServerSecurity] = useState<ServerSecuritySettings>({
    emergencyLockdown: false,
    guestsAllowed: true,
    blockExternalLinks: false,
    floodControlRate: 20,
    marqueeTicker: ''
  });
  const [staffMemos, setStaffMemos] = useState<StaffMemo[]>([]);
  const [monitorLogs, setMonitorLogs] = useState<MonitorEvent[]>([]);
  const [monitoredWordsList, setMonitoredWordsList] = useState<string[]>([]);
  const [filterAlertsList, setFilterAlertsList] = useState<FilterAlertItem[]>([]);
  const [shortcuts, setShortcuts] = useState<ChatShortcut[]>([]);
  const [rolesConfig, setRolesConfig] = useState<RoleDefinition[]>(DEFAULT_ROLES_CONFIG);
  const [rolePermissions, setRolePermissions] = useState<Record<string, any>>({});
  const [likesSettings, setLikesSettings] = useState<LikesThresholdSettings>({
    roomTextLikes: 0,
    roomMediaLikes: 0,
    wallTextLikes: 0,
    wallMediaLikes: 0,
    pmTextLikes: 0,
    pmMediaLikes: 0,
    micLikes: 0,
    callLikes: 0
  });
  const [messageRetentionLimits, setMessageRetentionLimits] = useState<MessageRetentionLimits>({
    roomMaxMessages: 200,
    wallMaxPosts: 100,
    privateMaxMessages: 100
  });
  const [generalWelcome, setGeneralWelcome] = useState<{ enabled: boolean; message: string; title: string }>({
    enabled: true,
    title: 'إدارة حسان برو 🦅',
    message: ''
  });
  const [customThemes, setCustomThemes] = useState<CustomThemePreset[]>([]);
  const [chatFontWeight, setChatFontWeight] = useState<'thin' | 'normal' | 'default' | 'bold' | 'black'>('default');
  const [emblemsConfig, setEmblemsConfig] = useState<EmblemsConfig>(DEFAULT_EMBLEMS_CONFIG);
  const [falconChatBanner, setFalconChatBanner] = useState<string>(DEFAULT_FALCON_CHAT_BANNER);
  const [falconAvatarIcon, setFalconAvatarIcon] = useState<string>(DEFAULT_FALCON_AVATAR_ICON);
  const [chatQualitySettings, setChatQualitySettings] = useState<ChatQualitySettings>(DEFAULT_CHAT_QUALITY_SETTINGS);

  const [initialTab] = useState<AdminTabId>(() => {
    try {
      const fromSession = sessionStorage.getItem('hassan_admin_initial_tab') || '';
      if (VALID_ADMIN_TABS.has(fromSession)) {
        sessionStorage.removeItem('hassan_admin_initial_tab');
        return fromSession as AdminTabId;
      }
      const params = new URLSearchParams(window.location.search);
      const qTab = params.get('tab') || '';
      if (VALID_ADMIN_TABS.has(qTab)) return qTab as AdminTabId;
    } catch {}
    return 'moderation';
  });

  const [initialThemeToEdit] = useState<string | undefined>(() => {
    try {
      const val = sessionStorage.getItem('hassan_admin_initial_theme') || undefined;
      if (val) sessionStorage.removeItem('hassan_admin_initial_theme');
      const params = new URLSearchParams(window.location.search);
      const qTheme = params.get('theme') || undefined;
      return val || qTheme;
    } catch {
      return undefined;
    }
  });

  const [isOpenedFromChat] = useState<boolean>(() => {
    try {
      return new URLSearchParams(window.location.search).get('from') === 'chat';
    } catch {
      return false;
    }
  });

  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showToast = (message: string, type: 'success' | 'error' | 'info' = 'info') => {
    if (toastTimerRef.current) {
      clearTimeout(toastTimerRef.current);
    }
    setToast({ message, type });
    toastTimerRef.current = setTimeout(() => {
      toastTimerRef.current = null;
      setToast((prev) => (prev?.message === message ? null : prev));
    }, 4000);
  };

  const rolesConfigRef = useRef<RoleDefinition[]>(rolesConfig);
  const rolePermissionsRef = useRef<Record<string, any>>(rolePermissions);
  useEffect(() => {
    rolesConfigRef.current = rolesConfig;
  }, [rolesConfig]);
  useEffect(() => {
    rolePermissionsRef.current = rolePermissions;
  }, [rolePermissions]);

  const getRoleLevel = (roleId?: string): number => {
    const clean = (roleId || '').trim().toLowerCase();
    if (clean === 'hassan') return 100000;
    const found = rolesConfigRef.current.find((r) => r.id.toLowerCase() === clean);
    if (found) return found.level;
    switch (clean) {
      case 'admin': return 100;
      case 'super': return 75;
      case 'member': return 50;
      default: return 10;
    }
  };

  const isStaffAuthorized = useMemo(() => {
    if (!currentUser) return false;
    const role = (currentUser.role || '').trim().toLowerCase();
    if (role === 'hassan' || role === 'admin' || role === 'super') return true;
    if (getRoleLevel(role) >= 75) return true;
    const perms = rolePermissions[currentUser.role] || rolePermissions[role] || {};
    return Boolean(perms.canAccessControlPanel);
  }, [currentUser, rolePermissions, rolesConfig]);

  const fetchStaffData = (s: Socket) => {
    s.emit('getAdminData');
    s.emit('getMonitorLogs');
    s.emit('getFilterAlerts');
    s.emit('getMonitoredWords');
    s.emit('getMessageRetentionLimits');
    s.emit('getRoomStats');
    s.emit('getBotsAdminState');
    s.emit('getChatQualitySettings');
  };

  useEffect(() => {
    const envServerUrl = (import.meta.env.VITE_SERVER_URL as string | undefined)?.trim();
    const remoteServerUrl =
      envServerUrl && !/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(envServerUrl)
        ? envServerUrl
        : undefined;

    const s = remoteServerUrl
      ? io(remoteServerUrl, {
          reconnection: true,
          reconnectionAttempts: Infinity,
          reconnectionDelay: 400,
          reconnectionDelayMax: 2000,
          transports: ['websocket', 'polling']
        })
      : io({
          reconnection: true,
          reconnectionAttempts: Infinity,
          reconnectionDelay: 400,
          reconnectionDelayMax: 2000,
          transports: ['websocket', 'polling']
        });

    setSocket(s);

    const applyConfigPayload = (data: any) => {
      if (!data || typeof data !== 'object') return;
      if (Array.isArray(data.rooms)) setRoomsList(data.rooms);
      if (Array.isArray(data.roomStats)) setRoomStatsData(data.roomStats);
      if (data.roomSettings) setRoomSettings(data.roomSettings);
      if (Array.isArray(data.rolesConfig)) setRolesConfig(data.rolesConfig);
      if (data.rolePermissions) setRolePermissions(data.rolePermissions);
      if (Array.isArray(data.shortcuts)) setShortcuts(data.shortcuts);
      if (data.likesSettings) setLikesSettings(data.likesSettings);
      if (data.messageRetentionLimits) setMessageRetentionLimits(data.messageRetentionLimits);
      if (data.generalWelcome) setGeneralWelcome(data.generalWelcome);
      if (data.serverSecurity) setServerSecurity((prev) => ({ ...prev, ...data.serverSecurity }));
      if (data.emblemsConfig) {
        setEmblemsConfig(data.emblemsConfig);
        if (data.emblemsConfig.falconChatBanner) setFalconChatBanner(data.emblemsConfig.falconChatBanner);
        if (data.emblemsConfig.falconAvatarIcon) setFalconAvatarIcon(data.emblemsConfig.falconAvatarIcon);
      }
      if (data.globalAppearance) {
        if (Array.isArray(data.globalAppearance.customThemes)) setCustomThemes(data.globalAppearance.customThemes);
        if (data.globalAppearance.fontWeight) setChatFontWeight(data.globalAppearance.fontWeight);
        if (data.globalAppearance.bannerUrl) setFalconChatBanner(data.globalAppearance.bannerUrl);
        if (data.globalAppearance.logoUrl) setFalconAvatarIcon(data.globalAppearance.logoUrl);
      }
      if (data.chatQualitySettings) {
        setChatQualitySettings(data.chatQualitySettings);
        setServerChatQualitySettings(data.chatQualitySettings);
      }
    };

    let restoreFallbackTimer: ReturnType<typeof setTimeout> | null = null;
    if (isRestoring) {
      restoreFallbackTimer = setTimeout(() => {
        setIsRestoring(false);
      }, 8000);
    }

    s.on('connect', () => {
      setIsConnected(true);
      try {
        const token = localStorage.getItem('soqoor_session_token');
        const uname = localStorage.getItem('soqoor_session_username');
        const savedRoom = localStorage.getItem('soqoor_last_room') || 'الغرفة العامة';
        if (token && uname) {
          setIsRestoring(true);
          if (restoreFallbackTimer) clearTimeout(restoreFallbackTimer);
          restoreFallbackTimer = setTimeout(() => {
            setIsRestoring(false);
          }, 8000);
          s.emit('restoreSession', {
            sessionToken: token,
            username: uname,
            room: savedRoom,
            presenceState: 'online',
            deviceFingerprint: generateDeviceFingerprint().fingerprintId,
            isIncognito: detectIncognitoMode(),
            isAdminPanel: true
          });
        } else {
          setIsRestoring(false);
        }
      } catch {
        setIsRestoring(false);
      }
    });

    s.on('disconnect', () => {
      setIsConnected(false);
    });

    s.on('initialRoster', (data: any) => {
      if (Array.isArray(data?.users)) setRosterUsers(data.users);
      if (typeof data?.needsAdminSetup === 'boolean') {
        setNeedsAdminSetup(data.needsAdminSetup);
      }
      applyConfigPayload(data);
    });

    s.on('adminBootstrapStatus', (d: { needsAdminSetup?: boolean }) => {
      if (typeof d?.needsAdminSetup === 'boolean') {
        setNeedsAdminSetup(d.needsAdminSetup);
      }
    });

    s.on('sessionTokenRefreshed', ({ sessionToken }: { sessionToken?: string }) => {
      if (!sessionToken) return;
      try {
        localStorage.setItem('soqoor_session_token', sessionToken);
      } catch {}
    });

    s.on('chatConfigSync', (data: any) => {
      applyConfigPayload(data);
    });

    s.on('sessionRestored', ({ user }: { user: AdminSuiteUser }) => {
      setIsRestoring(false);
      setIsSubmittingLogin(false);
      setAuthError('');
      setCurrentUser(user);
      fetchStaffData(s);
    });

    s.on('sessionRestoreFailed', ({ reason }: { reason?: string }) => {
      try {
        localStorage.removeItem('soqoor_session_token');
        localStorage.removeItem('soqoor_session_username');
      } catch {}
      setIsRestoring(false);
      setIsSubmittingLogin(false);
      setCurrentUser(null);
      if (reason) setAuthError(reason);
    });

    s.on('loginSuccess', ({ user, sessionToken }: { user: AdminSuiteUser; sessionToken?: string }) => {
      setIsSubmittingLogin(false);
      setIsRestoring(false);
      setAuthError('');
      setCurrentUser(user);
      if (sessionToken) {
        try {
          localStorage.setItem('soqoor_session_token', sessionToken);
          localStorage.setItem('soqoor_session_username', user.username);
        } catch {}
      }
      fetchStaffData(s);
    });

    s.on('loginError', (msg: string) => {
      setIsSubmittingLogin(false);
      setIsRestoring(false);
      setAuthError(msg || 'بيانات الدخول غير صحيحة.');
    });

    s.on('allUsers', (usersList: AdminSuiteUser[]) => {
      if (Array.isArray(usersList)) setRosterUsers(usersList);
    });

    s.on('allRegisteredMembers', (members: RegisteredMemberItem[]) => {
      if (Array.isArray(members)) setAllRegisteredMembers(members);
    });

    s.on('roomsList', (rooms: ChatRoom[]) => {
      if (Array.isArray(rooms)) setRoomsList(rooms);
    });

    s.on('roomStats', (stats: RoomStatData[]) => {
      if (Array.isArray(stats)) setRoomStatsData(stats);
    });
    s.on('roomStatsUpdated', (stats: RoomStatData[]) => {
      if (Array.isArray(stats)) setRoomStatsData(stats);
    });

    s.on('adminInitialData', (data: any) => {
      if (data?.bannedList) setBannedList(data.bannedList);
      if (data?.mutedList) setMutedList(data.mutedList);
      if (data?.serverSecurity) setServerSecurity((prev) => ({ ...prev, ...data.serverSecurity }));
      if (data?.staffMemos) setStaffMemos(data.staffMemos);
      if (data?.filterAlerts) setFilterAlertsList(data.filterAlerts);
      if (data?.monitoredWords) setMonitoredWordsList(data.monitoredWords);
      if (data?.rolePermissions) setRolePermissions(data.rolePermissions);
      if (data?.rolesConfig) setRolesConfig(data.rolesConfig);
      if (data?.monitorLogs) setMonitorLogs(data.monitorLogs);
      if (data?.messageRetentionLimits) setMessageRetentionLimits(data.messageRetentionLimits);
    });

    s.on('bannedListUpdated', (list: BannedRecord[]) => {
      if (Array.isArray(list)) setBannedList(list);
    });

    s.on('mutedListUpdated', (list: MutedRecord[]) => {
      if (Array.isArray(list)) setMutedList(list);
    });

    s.on('staffMemosUpdated', (memos: StaffMemo[]) => {
      if (Array.isArray(memos)) setStaffMemos(memos);
    });

    s.on('monitorLogs', (logs: MonitorEvent[]) => {
      if (Array.isArray(logs)) setMonitorLogs(logs);
    });

    s.on('monitorEvent', (ev: MonitorEvent) => {
      if (ev) setMonitorLogs((prev) => [ev, ...prev].slice(0, 1000));
    });

    s.on('filterAlertsList', (list: FilterAlertItem[]) => {
      if (Array.isArray(list)) setFilterAlertsList(list);
    });

    s.on('monitoredWordsUpdated', (words: string[]) => {
      if (Array.isArray(words)) setMonitoredWordsList(words);
    });

    s.on('serverSecurityUpdated', (sec: ServerSecuritySettings) => {
      if (sec) setServerSecurity((prev) => ({ ...prev, ...sec }));
    });

    s.on('roomSettingsUpdated', ({ settings }: { room: string; settings: any }) => {
      if (settings) setRoomSettings(settings);
    });

    s.on('rolesConfigUpdated', (configs: RoleDefinition[]) => {
      if (Array.isArray(configs)) setRolesConfig(configs);
    });

    s.on('rolePermissionsUpdated', (perms: Record<string, any>) => {
      if (perms) setRolePermissions(perms);
    });

    s.on('shortcutsUpdated', (list: ChatShortcut[]) => {
      if (Array.isArray(list)) setShortcuts(list);
    });

    s.on('likesSettingsUpdated', (ls: LikesThresholdSettings) => {
      if (ls) setLikesSettings(ls);
    });

    s.on('messageRetentionLimitsUpdated', (limits: MessageRetentionLimits) => {
      if (limits) setMessageRetentionLimits(limits);
    });

    s.on('generalWelcomeUpdated', (gw: { enabled: boolean; message: string; title: string }) => {
      if (gw) setGeneralWelcome(gw);
    });

    s.on('emblemsUpdated', (cfg: EmblemsConfig) => {
      if (cfg) {
        setEmblemsConfig(cfg);
        if (cfg.falconChatBanner) setFalconChatBanner(cfg.falconChatBanner);
        if (cfg.falconAvatarIcon) setFalconAvatarIcon(cfg.falconAvatarIcon);
      }
    });

    s.on('falconAssetsUpdated', (assets: { falconChatBanner?: string; falconAvatarIcon?: string }) => {
      if (assets?.falconChatBanner) setFalconChatBanner(assets.falconChatBanner);
      if (assets?.falconAvatarIcon) setFalconAvatarIcon(assets.falconAvatarIcon);
    });

    s.on('globalAppearanceUpdated', (data: any) => {
      if (Array.isArray(data?.customThemes)) setCustomThemes(data.customThemes);
      if (data?.fontWeight) setChatFontWeight(data.fontWeight);
      if (data?.bannerUrl) setFalconChatBanner(data.bannerUrl);
      if (data?.logoUrl) setFalconAvatarIcon(data.logoUrl);
    });

    s.on('chatQualityUpdated', (q: ChatQualitySettings) => {
      if (q) {
        setChatQualitySettings(q);
        setServerChatQualitySettings(q);
      }
    });

    s.on('systemAlert', (msg: string) => {
      if (msg) showToast(msg, 'info');
    });

    return () => {
      if (restoreFallbackTimer) clearTimeout(restoreFallbackTimer);
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
      s.disconnect();
    };
  }, []);

  const handleClaimAdmin = async (e: React.FormEvent) => {
    e.preventDefault();
    const pwd = adminClaimPassword.trim();
    if (pwd.length < 6) {
      setAdminClaimError('يجب أن تكون كلمة مرور الإدارة 6 أحرف على الأقل.');
      return;
    }
    setIsClaimingAdmin(true);
    setAdminClaimError('');
    try {
      const envServerUrl = (import.meta.env.VITE_SERVER_URL as string | undefined)?.trim();
      const remoteServerUrl =
        envServerUrl && !/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(envServerUrl)
          ? envServerUrl.replace(/\/+$/, '')
          : '';
      const url = remoteServerUrl ? `${remoteServerUrl}/api/auth/claim-admin` : '/api/auth/claim-admin';
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: pwd })
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.ok) {
        setAdminClaimError(json?.error || 'تعذّر تعيين كلمة مرور الإدارة.');
        setIsClaimingAdmin(false);
        return;
      }
      setNeedsAdminSetup(false);
      setAdminClaimPassword('');
      setLoginUsername('admin');
      setLoginPassword(pwd);
      setIsClaimingAdmin(false);
      showToast('تم تفعيل وتأمين حساب الإدارة (admin) بنجاح! يمكنك الدخول الآن.', 'success');
    } catch {
      setAdminClaimError('تعذّر الاتصال بالخادم لتعيين كلمة مرور الإدارة.');
      setIsClaimingAdmin(false);
    }
  };

  const handleAdminLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (!socket) return;
    const uname = loginUsername.trim();
    if (!uname || !loginPassword) {
      setAuthError('يرجى إدخال اسم المشرف وكلمة المرور.');
      return;
    }
    setAuthError('');
    setIsSubmittingLogin(true);
    socket.emit('joinRoom', {
      username: uname,
      password: loginPassword,
      loginType: 'member',
      room: 'الغرفة العامة',
      deviceFingerprint: generateDeviceFingerprint().fingerprintId,
      isIncognito: detectIncognitoMode()
    });
  };

  const handleReturnToChat = () => {
    if (isOpenedFromChat) {
      try {
        window.close();
      } catch {}
      setTimeout(() => {
        if (!window.closed) {
          showToast('صفحة الشات ما زالت مفتوحة في التبويب السابق؛ يمكنك العودة إليها مباشرة أو إغلاق هذا التبويب.', 'info');
        }
      }, 150);
      return;
    }
    window.location.assign('/');
  };

  const handleLogoutAdmin = () => {
    try {
      const token = localStorage.getItem('soqoor_session_token');
      socket?.emit('explicitLogout', { sessionToken: token || undefined });
      localStorage.removeItem('soqoor_session_token');
      localStorage.removeItem('soqoor_session_username');
    } catch {}
    setCurrentUser(null);
    setLoginPassword('');
  };

  const handleAdminAction = (action: string, targetUsername?: string, value?: any, reason?: string) => {
    if (!socket || !currentUser) return;
    if (action === 'revealNicks') {
      socket.emit('revealNicks', { targetUsername: targetUsername || '' });
      return;
    }
    socket.emit('adminAction', {
      action,
      targetUsername: targetUsername || '',
      value,
      reason
    });
  };

  if (isRestoring) {
    return (
      <div className="min-h-screen w-full flex flex-col items-center justify-center bg-[#120d09] text-amber-300 gap-3 p-4" dir="rtl">
        <Loader2 className="w-9 h-9 animate-spin text-amber-400" />
        <p className="text-sm font-bold">جاري التحقق من جلسة الإدارة المستقلة...</p>
      </div>
    );
  }

  if (!currentUser) {
    return (
      <div className="min-h-screen w-full flex items-center justify-center bg-gradient-to-br from-[#120d09] via-[#1c130c] to-[#0c0907] p-4" dir="rtl">
        <div className="w-full max-w-md bg-[#1e1610] border border-[#4d3722] rounded-2xl shadow-2xl p-6 space-y-5">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-amber-500/20 border border-amber-500/50 flex items-center justify-center text-amber-400 shrink-0">
              <Shield className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-base font-black text-amber-200">بوابة الإدارة المستقلة</h1>
              <p className="text-xs text-amber-300/70">شات حسان برو — دخول مصرح لطاقم الإدارة فقط</p>
            </div>
          </div>

          {needsAdminSetup && (
            <div className="p-3.5 rounded-xl bg-amber-950/50 border border-amber-500/60 space-y-2.5">
              <div className="flex items-center gap-2 text-amber-300 font-black text-xs">
                <Lock className="w-4 h-4 text-amber-400 shrink-0" />
                <span>التهيئة الأولية لحساب الإدارة الأعلى (admin)</span>
              </div>
              <p className="text-[11px] text-amber-200/80 leading-relaxed">
                لحماية البوابة، لم يتم تعيين كلمة مرور افتراضية لحساب <span className="font-black text-amber-300">admin</span>. أنشئ كلمة مرور قوية لمرة واحدة للمتابعة:
              </p>
              {adminClaimError && (
                <div className="p-2 rounded-lg bg-red-950/70 border border-red-600/60 text-red-200 text-[11px] font-bold">
                  {adminClaimError}
                </div>
              )}
              <form onSubmit={handleClaimAdmin} className="space-y-2">
                <div className="relative">
                  <input
                    type={showAdminClaimPassword ? 'text' : 'password'}
                    value={adminClaimPassword}
                    onChange={(e) => {
                      setAdminClaimPassword(e.target.value);
                      if (adminClaimError) setAdminClaimError('');
                    }}
                    placeholder="كلمة مرور الإدارة الجديدة (6+ أحرف)..."
                    minLength={6}
                    required
                    autoComplete="new-password"
                    className="w-full px-3 py-2 text-xs bg-black/50 border border-amber-500/50 focus:border-amber-400 rounded-xl text-white outline-none pl-9"
                  />
                  <button
                    type="button"
                    onClick={() => setShowAdminClaimPassword((v) => !v)}
                    className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-amber-300 cursor-pointer"
                  >
                    {showAdminClaimPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                <button
                  type="submit"
                  disabled={isClaimingAdmin}
                  className="w-full py-2 rounded-xl bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-slate-950 font-black text-xs flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  {isClaimingAdmin ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                  <span>تعيين وتأمين حساب الإدارة</span>
                </button>
              </form>
            </div>
          )}

          {authError && (
            <div className="p-2.5 rounded-xl bg-red-950/70 border border-red-600/60 text-red-200 text-xs font-bold flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
              <span>{authError}</span>
            </div>
          )}

          <form onSubmit={handleAdminLogin} className="space-y-3">
            <div className="space-y-1">
              <label className="text-xs font-bold text-amber-200/90 block">اسم المشرف / العضوية</label>
              <input
                type="text"
                value={loginUsername}
                onChange={(e) => setLoginUsername(e.target.value)}
                placeholder="أدخل اسم حساب الإدارة..."
                className="w-full px-3 py-2 text-sm bg-black/40 border border-[#4d3722] focus:border-amber-500 rounded-xl text-white outline-none"
                autoComplete="username"
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs font-bold text-amber-200/90 block">كلمة المرور</label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={loginPassword}
                  onChange={(e) => setLoginPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full px-3 py-2 text-sm bg-black/40 border border-[#4d3722] focus:border-amber-500 rounded-xl text-white outline-none pl-9"
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-amber-300 cursor-pointer"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={isSubmittingLogin || !isConnected}
              className="w-full py-2.5 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 disabled:opacity-50 text-slate-950 font-black text-sm shadow-lg flex items-center justify-center gap-2 cursor-pointer"
            >
              {isSubmittingLogin ? <Loader2 className="w-4 h-4 animate-spin" /> : <Lock className="w-4 h-4" />}
              <span>{isSubmittingLogin ? 'جاري التحقق...' : 'دخول إلى لوحة الإدارة'}</span>
            </button>
          </form>

          <div className="pt-2 border-t border-[#3b2a1a] flex items-center justify-between text-xs">
            <span className={isConnected ? 'text-emerald-400 font-bold' : 'text-amber-400 font-bold'}>
              {isConnected ? '● متصل بالسيرفر' : '○ جاري الاتصال...'}
            </span>
            <button
              type="button"
              onClick={handleReturnToChat}
              className="inline-flex items-center gap-1 text-amber-300 hover:text-amber-200 font-bold cursor-pointer"
            >
              <ArrowRight className="w-3.5 h-3.5" />
              <span>العودة إلى الشات</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!isStaffAuthorized) {
    return (
      <div className="min-h-screen w-full flex items-center justify-center bg-[#120d09] p-4" dir="rtl">
        <div className="w-full max-w-md bg-[#1e1610] border-2 border-red-600/70 rounded-2xl p-6 text-center space-y-4 shadow-2xl">
          <div className="w-14 h-14 mx-auto rounded-full bg-red-600/20 border border-red-500/60 flex items-center justify-center text-red-400">
            <Lock className="w-7 h-7" />
          </div>
          <h2 className="text-base font-black text-red-300">الوصول مقيد لطاقم الإدارة فقط</h2>
          <p className="text-xs text-slate-300 leading-relaxed">
            الحساب الحالي ({currentUser.username} - {currentUser.role}) لا يملك صلاحية الدخول إلى لوحة التحكم المستقلة.
          </p>
          <div className="flex items-center gap-2 pt-2">
            <button
              type="button"
              onClick={handleReturnToChat}
              className="flex-1 py-2 rounded-xl bg-amber-500 hover:bg-amber-600 text-slate-950 font-black text-xs cursor-pointer"
            >
              العودة إلى الشات
            </button>
            <button
              type="button"
              onClick={handleLogoutAdmin}
              className="py-2 px-3 rounded-xl bg-red-600/80 hover:bg-red-600 text-white font-bold text-xs cursor-pointer"
            >
              تسجيل خروج
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen w-screen flex flex-col bg-[#120d09] text-slate-100 overflow-hidden" dir="rtl">
      {/* Standalone Top Bar */}
      <header className="shrink-0 bg-[#1e150e] border-b border-[#4d3722] px-3 py-1.5 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-amber-500/15 border border-amber-500/40 text-amber-300 text-[11px] font-black shrink-0">
            <Shield className="w-3.5 h-3.5" />
            <span>الإدارة المستقلة</span>
          </span>
          <span className={`text-[10px] font-bold ${isConnected ? 'text-emerald-400' : 'text-rose-400'}`}>
            {isConnected ? '● متصل' : '○ منقطع'}
          </span>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={handleReturnToChat}
            className="px-2.5 py-1 rounded-lg bg-amber-500 hover:bg-amber-600 text-slate-950 font-black text-[11px] flex items-center gap-1 cursor-pointer"
          >
            <ArrowRight className="w-3.5 h-3.5" />
            <span>العودة للشات</span>
          </button>
          <button
            type="button"
            onClick={handleLogoutAdmin}
            className="px-2 py-1 rounded-lg bg-red-600/80 hover:bg-red-600 text-white font-bold text-[11px] flex items-center gap-1 cursor-pointer"
            title="تسجيل خروج من لوحة الإدارة"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">خروج</span>
          </button>
        </div>
      </header>

      {/* Main Isolated Admin Suite Workspace */}
      <main className="flex-1 min-h-0 overflow-hidden max-w-6xl w-full mx-auto border-x border-[#3b2a1a]">
        <AdminControlSuite
          currentUser={currentUser}
          initialTab={initialTab}
          initialThemeToEdit={initialThemeToEdit}
          rosterUsers={rosterUsers}
          allRegisteredMembers={allRegisteredMembers}
          roomsList={roomsList}
          roomStatsData={roomStatsData}
          bannedList={bannedList}
          mutedList={mutedList}
          roomSettings={roomSettings}
          serverSecurity={serverSecurity}
          likesSettings={likesSettings}
          staffMemos={staffMemos}
          monitorLogs={monitorLogs}
          monitoredWordsList={monitoredWordsList}
          filterAlerts={filterAlertsList}
          shortcuts={shortcuts}
          onUpdateLikesSettings={(newLikes) => {
            setLikesSettings((prev) => ({ ...prev, ...newLikes }));
            socket?.emit('updateLikesSettings', newLikes);
          }}
          onAdminAction={(action, targetUsername, value, reason) => {
            handleAdminAction(action, targetUsername || '', value, reason);
          }}
          onManualBan={(username, ip, reason) => {
            socket?.emit('manualBan', { username, ip, reason });
          }}
          onUpdateSecurity={(newSettings) => {
            socket?.emit('updateServerSecurity', newSettings);
          }}
          onUpdateRoomDetails={(data) => {
            socket?.emit('updateRoomDetails', data);
          }}
          onAddStaffMemo={(text, priority) => {
            socket?.emit('addStaffMemo', { text, priority });
          }}
          onDeleteStaffMemo={(memoId) => {
            socket?.emit('deleteStaffMemo', { memoId });
          }}
          onAddMonitoredWord={(word) => {
            socket?.emit('addMonitoredWord', { word });
          }}
          onRemoveMonitoredWord={(word) => {
            socket?.emit('removeMonitoredWord', { word });
          }}
          onAddShortcut={(trigger, replacement) => {
            socket?.emit('addShortcut', { trigger, replacement });
          }}
          onDeleteShortcut={(shortcutId) => {
            socket?.emit('deleteShortcut', { shortcutId });
          }}
          onUpdateShortcut={(id, trigger, replacement) => {
            socket?.emit('updateShortcut', { id, trigger, replacement });
          }}
          onClearMonitorLogs={() => {
            socket?.emit('clearMonitorLogs');
          }}
          onClearFilterAlerts={() => {
            socket?.emit('clearFilterAlerts');
            setFilterAlertsList([]);
          }}
          onRefreshRoomStats={() => {
            socket?.emit('getRoomStats');
          }}
          onOpenUserProfile={(user) => {
            showToast(`تحديد العضو [${user.username}] في إدارة الأعضاء`, 'info');
          }}
          onSwitchRoom={(roomId) => {
            try {
              localStorage.setItem('soqoor_last_room', roomId);
            } catch {}
            showToast(`تم اختيار غرفة [${roomId}] — جاري العودة للشات...`, 'info');
            window.location.assign('/');
          }}
          onApplyGlobalAppearance={(theme, fontFamily, wallpaper, bubbleStyle) => {
            socket?.emit('updateGlobalAppearance', { theme, fontFamily, wallpaper, bubbleStyle });
          }}
          customThemes={customThemes}
          chatFontWeight={chatFontWeight}
          onChangeFontWeight={(weight) => {
            setChatFontWeight(weight);
            socket?.emit('updateGlobalAppearance', { fontWeight: weight });
          }}
          onSaveCustomTheme={(preset) => {
            socket?.emit('saveCustomTheme', preset);
          }}
          onDeleteCustomTheme={(themeId) => {
            socket?.emit('deleteCustomTheme', { themeId });
          }}
          rolesConfig={rolesConfig}
          onSaveRole={(role, permissions) => {
            socket?.emit('saveRole', { role, permissions });
          }}
          onDeleteRole={(roleId) => {
            socket?.emit('deleteRole', { roleId });
          }}
          rolePermissions={rolePermissions}
          onUpdateRolePermissions={(role, permissions) => {
            setRolePermissions((prev) => ({
              ...prev,
              [role]: { ...(prev?.[role] || {}), ...permissions }
            }));
            socket?.emit('updateRolePermissions', { role, permissions });
          }}
          generalWelcome={generalWelcome}
          onUpdateGeneralWelcome={(settings) => {
            setGeneralWelcome((prev) => ({ ...prev, ...settings }));
            socket?.emit('updateGeneralWelcome', settings);
          }}
          emblemsConfig={emblemsConfig}
          messageLimits={messageRetentionLimits}
          onUpdateMessageLimits={(limits) => {
            setMessageRetentionLimits((prev) => ({ ...prev, ...limits }));
            socket?.emit('updateMessageRetentionLimits', limits);
          }}
          falconChatBanner={falconChatBanner}
          falconAvatarIcon={falconAvatarIcon}
          onUpdateFalconAssets={(assets) => socket?.emit('updateFalconAssets', assets)}
          onAddEmblem={(data) => socket?.emit('addEmblem', data)}
          onDeleteEmblem={(id) => socket?.emit('deleteEmblem', { id })}
          onUpdateEmojiSize={(emojiSize) => socket?.emit('updateEmblemEmojiSize', { emojiSize })}
          onAssignMemberBanner={(username, bannerUrl) => socket?.emit('assignMemberBanner', { username, bannerUrl })}
          onGrantMemberGift={(username, giftUrl, giftTitle) => socket?.emit('grantMemberGift', { username, giftUrl, giftTitle })}
          onRemoveMemberGift={(username, giftUrl) => socket?.emit('removeMemberGift', { username, giftUrl })}
          chatQualitySettings={chatQualitySettings}
          onUpdateChatQuality={(next) => socket?.emit('updateChatQualitySettings', next)}
          socket={socket}
          onClose={handleReturnToChat}
          showToast={showToast}
        />
      </main>

      {/* Toast Notification */}
      {toast && (
        <div
          className={`fixed bottom-4 left-4 z-50 px-3.5 py-2 rounded-xl border text-xs font-bold shadow-2xl flex items-center gap-2 ${
            toast.type === 'error'
              ? 'bg-red-950/95 border-red-500 text-red-100'
              : toast.type === 'success'
              ? 'bg-emerald-950/95 border-emerald-500 text-emerald-100'
              : 'bg-[#2a1d12]/95 border-amber-500 text-amber-100'
          }`}
        >
          {toast.type === 'error' ? (
            <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
          ) : toast.type === 'success' ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          ) : (
            <Info className="w-4 h-4 text-amber-400 shrink-0" />
          )}
          <span>{toast.message}</span>
        </div>
      )}
    </div>
  );
}
