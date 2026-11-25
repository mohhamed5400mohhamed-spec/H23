import type { VoiceNoteData } from '../components/VoiceNoteModule';

export interface RoleDefinition {
  id: string;
  name: string;
  level: number;
  badgeColor?: string;
  isSystem?: boolean;
}

export interface RolePermissions {
  // 1. Chat & Rooms (الدردشة العامة والغرف)
  canSendText?: boolean;
  canSendMedia?: boolean;
  canSendVoiceNotes?: boolean;
  canDeleteMessage?: boolean;
  canDeleteMessages?: boolean;
  canPinMessage?: boolean;
  canClearRoomChat?: boolean;
  canLockRoom?: boolean;
  canSetSlowMode?: boolean;
  canChangeRoomSettings?: boolean;
  canEditRoomBanner?: boolean;

  // 2. Microphone & Audio (المايكروفون والصوتيات)
  canTakeMic?: boolean;
  canPullMic?: boolean;
  canMuteVoice?: boolean;
  canLockVoice?: boolean;
  canStartLive?: boolean;

  // 3. Moderation & Penalties (العقوبات والضبط الإداري)
  canWarn?: boolean;
  canMute?: boolean;
  canMuteText?: boolean;
  canKick?: boolean;
  canTempBan?: boolean;
  canBan?: boolean;
  canUnban?: boolean;
  canJail?: boolean;
  canUnjail?: boolean;

  // 4. Members & Profiles (إدارة الأعضاء والملفات الشخصية)
  canEditMemberProfile?: boolean;
  canEditMemberData?: boolean;
  canDeleteAvatar?: boolean;
  canEditLikes?: boolean;
  canEditPoints?: boolean;
  canAssignBanner?: boolean;
  canAssignBadge?: boolean;
  canUseAvatarFrame?: boolean;
  canUseMemberBg?: boolean;
  canManageMembershipCatalog?: boolean;
  canChangeMemberPassword?: boolean;
  canMoveUsers?: boolean;
  canChangeRoles?: boolean;
  canManagePermissions?: boolean;
  canManageRoles?: boolean;
  canDeleteAccounts?: boolean;
  canDeleteAccount?: boolean;

  // 5. Security, Filter & Logs (الرقابة والأمان ولوحة التحكم)
  canAccessControlPanel?: boolean;
  canFilter?: boolean;
  canManageFilterWords?: boolean;
  canRevealNicks?: boolean;
  canViewAuditLogs?: boolean;
  canClearAuditLogs?: boolean;

  // 6. Features, Wall & PM (الميزات العامة والحائط والخاص)
  canBroadcast?: boolean;
  canGhostLogin?: boolean;
  canManageShortcuts?: boolean;
  canChangeGlobalTheme?: boolean;
  canPostWall?: boolean;
  canDeleteWallPost?: boolean;
  canPrivateChat?: boolean;
  canPrivateCall?: boolean;

  [key: string]: boolean | undefined;
}

export interface PermissionDefinitionItem {
  key: keyof RolePermissions;
  label: string;
  desc: string;
}

export interface PermissionCategoryGroup {
  id: string;
  title: string;
  iconName: string;
  badge: string;
  permissions: PermissionDefinitionItem[];
}

export interface User {
  id: string;
  username: string;
  displayName?: string;
  room: string;
  avatarSeed: string;
  avatarUrl?: string;
  avatarFrame?: string; // إطار الصورة الشخصية (مسبق الصنع أو مرفوع من الجهاز)
  statusQuote: string;
  flag: string;
  flagNumber?: number;
  role: 'admin' | 'super' | 'member' | 'guest' | string;
  likes: number;
  points: number;
  isVoice: boolean;
  micSlot: number | null;
  isMuted: boolean;
  isTextMuted: boolean;
  isVoiceMutedByAdmin?: boolean;
  isSpeaking: boolean;
  presenceState?: 'online' | 'away' | 'offline'; // Green dot (online), Yellow dot (away/background), Gray dot (offline)
  ipAddress?: string;
  honorBadge?: string;
  nameBannerUrl?: string; // رابط البنر / السوابر المصور للعضو بمقاس 500x50
  giftBadges?: string[]; // قائمة أيقونات الهدايا والأوسمة التكريمية بجانب الاسم
  isJailed?: boolean;
  joinedAt?: number;
  sessionToken?: string;
  lastActiveTime?: number;
  nameColor?: string;
  textColor?: string;
  nameGradient?: string;
  profileBg?: string;
  memberBg?: string; // خلفية بطاقة العضو في قائمة الأعضاء والبروفايل
  theme?: string;
  fontFamily?: string;
  wallpaper?: string;
  bubbleStyle?: string;
  isPmDisabled?: boolean;
  isGhost?: boolean; // حالة الدخول المخفي / المتخفي
  isIncognito?: boolean; // كشف وضع التصفح المتخفي في المتصفح
  isBot?: boolean;
  engagement?: MemberEngagement;
}

export interface MemberEngagement {
  activeTimeMinutes: number;
  messagesSent: number;
  wallPostsCount: number;
  micTimeMinutes: number;
  starsLevel: number; // 0 to 5
  progressPercent: number; // 0 to 100
}

export interface StoryComment {
  id: string;
  username: string;
  displayName?: string;
  avatarUrl?: string;
  nameBannerUrl?: string;
  text: string;
  time: string;
  timestamp: number;
}

export interface StoryItem {
  id: string;
  username: string;
  displayName?: string;
  avatarUrl?: string;
  nameBannerUrl?: string;
  flag?: string;
  mediaUrl: string;
  mediaType: 'image' | 'video';
  caption?: string;
  createdAt: number;
  time: string;
  likes: number;
  likedUsers?: string[];
  comments?: StoryComment[];
}

export interface Message {
  id: string;
  room: string;
  username: string;
  displayName?: string;
  avatarUrl?: string;
  nameBannerUrl?: string;
  giftBadges?: string[];
  isGiftAnnouncement?: boolean;
  giftInfo?: {
    fromUsername: string;
    toUsername: string;
    giftTitle: string;
    giftUrl: string;
    giftMessage?: string;
  };
  flag?: string;
  badge?: string;
  badgeColor?: string;
  text: string;
  mediaUrl?: string;
  mediaType?: 'image' | 'video' | 'sticker' | 'audio';
  voiceNote?: VoiceNoteData;
  replyTo?: {
    id: string;
    username: string;
    displayName?: string;
    text: string;
    mediaUrl?: string;
  };
  time: string;
  timestamp: number;
  reactions?: Record<string, number>;
  nameColor?: string;
  textColor?: string;
  nameGradient?: string;
  isEdited?: boolean;
  isDeleted?: boolean;
  deletedBy?: string;
  deletedByRole?: string;
  clientTempId?: string;
  deliveryState?: 'sending' | 'queued' | 'sent';
}

export interface TypingUser {
  userId: string;
  username: string;
  displayName?: string;
  avatarUrl?: string;
  flag?: string;
  role?: string;
  nameColor?: string;
  nameGradient?: string;
  room: string;
  lastTypedAt: number;
}

export interface MicSlot {
  slotNumber: number;
  user: User | null;
}

export interface WallComment {
  id: string;
  username: string;
  displayName?: string;
  avatarUrl?: string;
  nameBannerUrl?: string;
  text: string;
  time: string;
  timestamp?: number;
}

export interface ProfileVisitorRecord {
  username: string;
  displayName?: string;
  avatarUrl?: string;
  nameBannerUrl?: string;
  flag?: string;
  visitCount: number;
  lastVisitTime: number;
}

export interface RoomLiveBroadcastState {
  broadcasterId: string;
  broadcasterUsername: string;
  broadcasterDisplayName?: string;
  broadcasterAvatar?: string;
  broadcasterFlag?: string;
  room: string;
  title: string;
  startedAt: number;
  viewersCount: number;
}

export interface YouTubeVideoInfo {
  id: string;
  title: string;
  thumbnail?: string;
  channelTitle?: string;
  duration?: string;
  views?: string;
  uploadedAt?: string;
  url?: string;
}

export interface WallPost {
  id: string;
  username: string;
  displayName?: string;
  avatarUrl?: string;
  nameBannerUrl?: string;
  flag?: string;
  text: string;
  mediaUrl?: string;
  mediaType?: 'image' | 'video' | 'audio';
  audioDuration?: number;
  category?: 'posts' | 'quick';
  youtubeVideo?: YouTubeVideoInfo;
  time: string;
  likes: number;
  commentsCount: number;
  comments?: WallComment[];
  likedUsers?: string[];
  timestamp?: number;
  updatedAt?: number;
  isEdited?: boolean;
  clientTempId?: string;
  deliveryState?: 'sending' | 'queued' | 'sent';
}

export interface PrivateMessage {
  id: string;
  fromId: string;
  fromUsername: string;
  fromDisplayName?: string;
  fromAvatar?: string;
  fromNameBannerUrl?: string;
  toId: string;
  toUsername: string;
  toDisplayName?: string;
  toNameBannerUrl?: string;
  text: string;
  mediaUrl?: string;
  mediaType?: 'image' | 'video' | 'sticker' | 'audio';
  voiceNote?: VoiceNoteData;
  replyTo?: {
    id: string;
    username: string;
    text: string;
  };
  isCallNotification?: boolean;
  time: string;
  timestamp?: number;
  isEdited?: boolean;
  status?: 'sent' | 'delivered' | 'read';
  readAt?: number;
  selfDestructSeconds?: number;
  selfDestructAt?: number;
  clientTempId?: string;
  deliveryState?: 'sending' | 'queued' | 'sent';
}

export interface ChatRoom {
  id: string;
  name: string;
  desc: string;
  isPasswordProtected: boolean;
  password?: string;
  bannerUrl?: string;
  voiceLimit: number;
  activeVoiceCount: number;
}

export interface MonitorEvent {
  id: string;
  type: string;
  description: string;
  actor: string;
  target?: string;
  time: string;
  timestamp?: number;
}

export type QualityPresetMode = 'auto' | 'high' | 'balanced' | 'weak';

export interface ChatQualitySettings {
  preset: QualityPresetMode;
  autoAdaptWeakNet: boolean;
  // Client images & Cloudinary
  imageMaxDim: number;
  imageQuality: number;
  cloudinaryDeliveryMode: 'auto' | 'eco' | 'good' | 'best';
  // Voice Mics & Audio
  micAudioBitrateKbps: number;
  musicBitrateKbps: number;
  // Live Broadcast
  liveVideoWidth: number;
  liveVideoMaxFps: number;
  liveVideoQuality: number;
  // Private Voice & Video Calls
  privateCallAudioBitrateKbps: number;
  privateCallVideoMaxKbps: number;
  privateCallMaxWidth: number;
  privateCallMaxFps: number;
  // Server & MongoDB lightness
  broadcastThrottleMs: number;
  dbBatchWriteMs: number;
  updatedAt?: number;
  updatedBy?: string;
}

export interface LikesThresholdSettings {
  roomTextLikes: number;
  roomMediaLikes: number;
  wallTextLikes: number;
  wallMediaLikes: number;
  pmTextLikes: number;
  pmMediaLikes: number;
  micLikes: number;
  callLikes: number;
}

export interface MessageRetentionLimits {
  roomMaxMessages: number;
  wallMaxPosts: number;
  privateMaxMessages: number;
}

export interface ServerSecuritySettings {
  emergencyLockdown: boolean;
  guestsAllowed: boolean;
  blockExternalLinks: boolean;
  floodControlRate: number;
  marqueeTicker: string;
  autoIpBanEnabled?: boolean;
  autoIpBanThreshold?: number;
  autoIpBanWindowMinutes?: number;
  autoIpBanDurationMinutes?: number;
  geoRestrictionEnabled?: boolean;
  geoRestrictionMode?: 'blacklist' | 'whitelist';
  geoRestrictedCountries?: string[];
  geoBlockedCustomMessage?: string;
  offlineGraceSeconds?: number;
  micGraceSeconds?: number;
  awayDelaySeconds?: number;
  reconnectBannerDelaySeconds?: number;
  likeCooldownSeconds?: number;
}

export interface StaffMemo {
  id: string;
  author: string;
  role: string;
  text: string;
  priority: 'low' | 'normal' | 'urgent';
  timestamp: number;
  timeFormatted: string;
}

export interface BannedRecord {
  username: string;
  ip?: string;
  deviceFingerprint?: string;
  deviceFingerprints?: string[];
  reason: string;
  bannedBy: string;
  timestamp: number;
  expiresAt?: number;
  banDurationMinutes?: number;
  banType?: 'auto_filter' | 'manual';
}

export interface MutedRecord {
  username: string;
  ip?: string;
  ips?: string[];
  deviceFingerprint?: string;
  deviceFingerprints?: string[];
  muteText: boolean;
  muteVoice: boolean;
  reason: string;
  mutedBy: string;
  timestamp: number;
}

export interface FilterAlertItem {
  id: string;
  username: string;
  avatarUrl?: string;
  flag?: string;
  room: string;
  matchedWords: string[];
  fullMessage: string;
  timestamp: number;
  time: string;
  contextType?: string;
  targetUser?: string;
}

export interface RegisteredMemberItem {
  username: string;
  displayName?: string;
  role: 'admin' | 'super' | 'member' | 'guest' | string;
  flag: string;
  flagNumber?: number;
  statusQuote: string;
  avatarUrl?: string;
  nameBannerUrl?: string;
  giftBadges?: string[];
  likes?: number;
  points?: number;
  honorBadge?: string;
  ipAddress?: string;
  deviceInfo?: string;
  deviceFingerprint?: string;
  isJailed?: boolean;
  isTextMuted?: boolean;
  isVoiceMutedByAdmin?: boolean;
  isOnline: boolean;
  isGhost?: boolean;
  presenceState?: 'online' | 'away' | 'offline';
  currentRoom?: string;
  lastSeen?: number;
  engagement?: MemberEngagement;
}

export interface RoomStatUser {
  id: string;
  username: string;
  role: 'hassan' | 'admin' | 'super' | 'member' | 'guest' | string;
  flag: string;
  avatarUrl?: string;
  isVoice: boolean;
  micSlot: number | null;
}

export interface RoomStatData {
  id: string;
  name: string;
  desc: string;
  isPasswordProtected: boolean;
  voiceLimit: number;
  count: number;
  percentage: number;
  voiceCount: number;
  users: RoomStatUser[];
}

