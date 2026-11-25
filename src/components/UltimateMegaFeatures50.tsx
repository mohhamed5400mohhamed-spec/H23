import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  Sparkles,
  Zap,
  Activity,
  Mic,
  MicOff,
  Volume2,
  VolumeX,
  Radio,
  Sliders,
  Play,
  Pause,
  Award,
  Crown,
  Heart,
  Flame,
  Star,
  Search,
  Copy,
  Check,
  Send,
  Trash2,
  Download,
  Share2,
  Shield,
  Lock,
  Unlock,
  Key,
  HelpCircle,
  RotateCw,
  Gift,
  Clock,
  Timer,
  Feather,
  BookOpen,
  Volume1,
  MessageSquare,
  X,
  CheckCircle2,
  AlertTriangle,
  FileText,
  UserCheck,
  Headphones,
  Compass,
  Smile,
  BarChart2,
  Layers,
  ListOrdered,
  Bell,
  RefreshCw,
  Eye,
  EyeOff,
  Globe,
  Settings,
  Wifi,
  WifiOff,
  Music,
  UserPlus,
  Megaphone
} from 'lucide-react';
import confetti from '../utils/confetti';
import { sounds } from '../utils/soundEffects';
import type { AudioMeshManager } from '../utils/audioMesh';
import type { Message, MicSlot, MonitorEvent } from '../types/chat';

function shuffleTriviaOptions<T>(items: T[], seed: number): T[] {
  const arr = [...items];
  let s = (seed + 1) * 2654435761;
  for (let i = arr.length - 1; i > 0; i--) {
    s = (s * 1664525 + 1013904223) >>> 0;
    const j = s % (i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

const MULTILINGUAL_GREETINGS: Array<{
  ar: string;
  translations: Record<'en' | 'fr' | 'ur' | 'tr', string>;
}> = [
  { ar: 'السلام عليكم', translations: { en: 'Peace be upon you', fr: 'Que la paix soit sur vous', ur: 'السلام علیکم', tr: 'Selamün aleyküm' } },
  { ar: 'مرحبا بكم', translations: { en: 'Hello / Welcome', fr: 'Bonjour / Bienvenue', ur: 'خوش آمدید', tr: 'Merhaba / Hoş geldiniz' } },
  { ar: 'أهلاً وسهلاً', translations: { en: 'You are most welcome', fr: 'Soyez les bienvenus', ur: 'جی آیاں نوں', tr: 'Hoş geldiniz' } },
  { ar: 'شكراً لكم', translations: { en: 'Thank you very much', fr: 'Merci beaucoup', ur: 'بہت شکریہ', tr: 'Çok teşekkür ederim' } },
  { ar: 'كيف حالك؟', translations: { en: 'How are you?', fr: 'Comment allez-vous ?', ur: 'آپ کیسے ہیں؟', tr: 'Nasılsınız?' } },
  { ar: 'صباح الخير', translations: { en: 'Good morning', fr: 'Bonjour', ur: 'صبح بخیر', tr: 'Günaydın' } },
  { ar: 'مساء الخير', translations: { en: 'Good evening', fr: 'Bonsoir', ur: 'شام بخیر', tr: 'İyi akşamlar' } },
  { ar: 'حياك الله', translations: { en: 'May God bless and welcome you', fr: 'Soyez béni et bienvenu', ur: 'اللہ آپ کو خوش رکھے', tr: 'Hoş geldiniz, Allah razı olsun' } }
];

export interface UltimateMegaFeatures50Props {
  isOpen: boolean;
  onClose: () => void;
  currentUser: {
    id?: string;
    username: string;
    displayName?: string;
    role: string;
    points: number;
    likes: number;
    room: string;
    isVoice?: boolean;
    isMuted?: boolean;
    micSlot?: number | null;
  };
  onlineUsers: Array<{
    id: string;
    username: string;
    displayName?: string;
    role: string;
    flag?: string;
    avatarUrl?: string;
    points?: number;
    likes?: number;
    micSlot?: number | null;
  }>;
  onSendChatMessage: (text: string) => void;
  onShowToast: (msg: string, type?: 'info' | 'success' | 'error') => void;
  onAddPoints: (amount: number, reason: string) => void;
  onApplyTheme?: (themeId: string) => void;
  onApplyFont?: (fontId: string) => void;
  onToggleMic?: () => void;
  socket?: any;
  audioManager?: AudioMeshManager | null;
  micSlots?: MicSlot[];
  messages?: Message[];
  pinnedTopic?: string;
  roomSettings?: { isChatLocked: boolean; slowModeSeconds: number; isVoiceLocked: boolean; showDeletedNotice?: boolean };
  currentRoomObj?: { id: string; name: string; isPasswordProtected?: boolean };
  monitoredWordsList?: string[];
  monitorLogs?: MonitorEvent[];
  serverSecurity?: { emergencyLockdown: boolean; guestsAllowed: boolean; floodControlRate: number; [key: string]: any };
  ignoredUsers?: string[];
  onAdminAction?: (action: string, targetUsername: string, value?: any, reason?: string) => void;
  onExportChat?: () => void;
  onClearLocalChat?: () => void;
  starredMessages?: Array<{ id: string; username: string; displayName?: string; text: string; time: string }>;
  onToggleStarMessage?: (msg: { id: string; username: string; displayName?: string; text: string; time: string }) => void;
}

// 42. Trivia Quiz Questions (Islamic & Arabic Culture)
const ARABIC_TRIVIA = [
  {
    q: 'ما هي عاصمة الدولة العباسية الأولى قبل بغداد؟',
    options: ['الهاشمية / الكوفة', 'دمشق', 'الفسطاط', 'سامراء'],
    correct: 0,
    explanation: 'كانت الكوفة والهاشمية أول مقرات العباسيين قبل بناء بغداد عام 762م على يد المنصور.'
  },
  {
    q: 'من هو الشاعر الملقب بـ "أمير الشعراء" في العصر الحديث؟',
    options: ['أحمد شوقي', 'حافظ إبراهيم', 'المتنبي', 'نزار قباني'],
    correct: 0,
    explanation: 'أحمد شوقي بويع أميراً للشعراء عام 1927م تقديراً لعلو شأنه في الشعر العربي.'
  },
  {
    q: 'ما هو أطول نهر في الوطن العربي والعالم؟',
    options: ['نهر النيل', 'نهر دجلة', 'نهر الفرات', 'نهر العاصي'],
    correct: 0,
    explanation: 'نهر النيل هو أطول أنهار العالم والوطن العربي بطول يقارب 6650 كم.'
  },
  {
    q: 'ما هي كنية الصقر العربي الحر المشهور في التراث الخليجي؟',
    options: ['أبو الشجعان / صقر قريش', 'أبو الفداء', 'أبو الطيب', 'أبو الفوارس'],
    correct: 0,
    explanation: 'الصقر الحر رمز للعزة والأنفة في تراث البادية والخليج العربي.'
  },
  {
    q: 'من هو القائد المسلم الذي فتح الأندلس عام 711م؟',
    options: ['طارق بن زياد', 'موسى بن نصير', 'عقبة بن نافع', 'خالد بن الوليد'],
    correct: 0,
    explanation: 'طارق بن زياد عبر المضيق الذي سمي باسمه جبل طارق وافتتح الأندلس.'
  }
];

// 43. Guess the Arabic Proverb
const ARABIC_PROVERBS = [
  {
    prefix: 'الصبر مفتاح',
    word: 'الفرج',
    hint: 'عكس الضيق والشدة'
  },
  {
    prefix: 'رب أخ لك لم تلده',
    word: 'أمك',
    hint: 'أقرب الناس إليك نسباً'
  },
  {
    prefix: 'من شب على شيء شاب',
    word: 'عليه',
    hint: 'يستمر معه حتى كبر سنه'
  },
  {
    prefix: 'إذا فات الفوت ما ينفع',
    word: 'الصوت',
    hint: 'النداء المتأخر بعد فوات الأوان'
  },
  {
    prefix: 'خير الكلام ما قل و',
    word: 'دل',
    hint: 'أوضح المعنى بأوجز عبارة'
  }
];

// 44. Virtual Gifts
const VIRTUAL_GIFTS = [
  { id: 'dallah', name: 'دلة رسلان ملكية', icon: '☕', cost: 10, bonusLikes: 5 },
  { id: 'falcon', name: 'صقر حر أصيل', icon: '🦅', cost: 25, bonusLikes: 15 },
  { id: 'crown', name: 'تاج السيادة الذهبي', icon: '👑', cost: 50, bonusLikes: 30 },
  { id: 'rose', name: 'وردة الجوري الطائفي', icon: '🌹', cost: 5, bonusLikes: 2 },
  { id: 'oud', name: 'مبخرة عود كمبودي', icon: '🪵', cost: 20, bonusLikes: 10 },
  { id: 'diamond', name: 'ألماسة المجلس اللامعة', icon: '💎', cost: 100, bonusLikes: 60 }
];

// 46. User Moods & Custom Statuses
const USER_MOODS = [
  { emoji: '☕', text: 'يرتشف قهوة المجلس' },
  { emoji: '🦅', text: 'يحلق في سماء الحوار' },
  { emoji: '🎧', text: 'يستمع بإنصات للحديث' },
  { emoji: '👑', text: 'حضور ملكي فخم' },
  { emoji: '📖', text: 'في خلوة تأمل وقراءة' },
  { emoji: '✨', text: 'ينشر الإيجابية والأنس' },
  { emoji: '🌹', text: 'يرحب بالكرام الأفاضل' },
  { emoji: '⚔️', text: 'حماسي وجاهز للمساجلة' },
  { emoji: '🌙', text: 'جلسة سمر ليلية هادئة' },
  { emoji: '🤝', text: 'على العهد والوفاء دائماً' }
];

// 47. Soundboard Sounds
const SOUNDBOARD_ITEMS = [
  { id: 'applause', name: 'تصفيق حار 👏', tone: 'applause' },
  { id: 'oud', name: 'عزف عود أصيل 🎵', tone: 'oud' },
  { id: 'falcon', name: 'صرخة صقر شامخ 🦅', tone: 'falcon' },
  { id: 'victory', name: 'بوق النصر والابتهاج 🎺', tone: 'victory' },
  { id: 'bell', name: 'جرس التنبيه الملكي 🔔', tone: 'bell' }
];

// 17. Gulf & Arabic Hospitality Canned Greetings
const HOSPITALITY_PHRASES = [
  'أهلاً ومرحباً بكم في مجلسنا الموقر، نورتونا يا كرام 🌹',
  'صح لسانك وعلا شانك، كفيت ووفيت يا الشيخ 👏',
  'تفضلوا تقهوا معنا، يا حي الله من جانا وزارنا ☕',
  'بيض الله وجيهكم على هذا الحديث الطيب المبارك 👑',
  'حضوركم شرف ومجلسنا بكم يزدهر ويفخر 🦅',
  'ما شاء الله تبارك الله، كلام موزون ودرر نادرة 💎',
  'عاش من سمع صوتك، لا عدمنا هذا الحضور البهي ✨',
  'مساء الخير والنور والسرور على الجميع 🌙'
];

// 15. Royal Text Ornaments
const TEXT_ORNAMENTS = [
  { id: 'crown', name: 'التاج الملكي 👑', format: (t: string) => `👑 彡 [${t}] 彡 👑` },
  { id: 'wings', name: 'أجنحة الصقر 🦅', format: (t: string) => `🦅 «« ${t} »» 🦅` },
  { id: 'sparkles', name: 'النجوم والبريق ✨', format: (t: string) => `✨ ༺ ${t} ༻ ✨` },
  { id: 'diamond', name: 'الماس والأناقة 💎', format: (t: string) => `💎 ✦ ${t} ✦ 💎` },
  { id: 'flower', name: 'الورد والريحان 🌹', format: (t: string) => `🌹 ❖ ${t} ❖ 🌹` }
];

// 18. Rare Arabic Lexicon
const ARABIC_LEXICON = [
  { word: 'العَسْجَد', meaning: 'الذهب الخالص الصافي اللامع البراق', example: 'تألقت كلماته كالعسجد الخالص' },
  { word: 'الفَرْقَد', meaning: 'النجم القطبي الهادي الساطع في السماء', example: 'أنت فرقد مجلسنا ونوره الوضاء' },
  { word: 'الغَيْدَاق', meaning: 'الكريم واسع العطاء والسحاب المغدق بالخير', example: 'رجل غيداق الأخلاق وطيب اليد' },
  { word: 'الصِّنْدِيد', meaning: 'الشجاع البطل الشامخ الثابت في الشدائد', example: 'موقف صنديد لا تلين له قناة' },
  { word: 'اليَعْبُوب', meaning: 'الفرس السريع الجواد أو النهر الجاري بعذوبة', example: 'حديث عذب كالنهر اليعبوب' },
  { word: 'السُّلاف', meaning: 'خلاصة الشيء وأفضله وأنقاه على الإطلاق', example: 'سلاف القول وأطيب الحديث' }
];

// 30. Majlis Athkar & Prayers
const ARABIC_ATHKAR = [
  'سبحان الله وبحمده، سبحان الله العظيم 📿',
  'أستغفر الله العظيم وأتوب إليه 🤲',
  'لا حول ولا قوة إلا بالله العلي العظيم 💫',
  'اللهم صلِّ وسلِّم وبارك على نبينا محمد 🌸',
  'لا إله إلا الله وحده لا شريك له، له الملك وله الحمد وهو على كل شيء قدير 🌙'
];

// 48. Arab Wisdoms & Classical Eloquence
const ARABIC_WISDOMS = [
  { text: 'ذو العَقلِ يَشقَى في النَعيمِ بِعَقلِهِ .. وَأَخو الجَهالَةِ في الشَقاوَةِ يَنعَمُ', author: 'أبو الطيب المتنبي' },
  { text: 'إِذا هَبَّت رِياحُكَ فَاغتَنِمها .. فَعُقبى كُلِّ خافِقَةٍ سُكونُ', author: 'الإمام الشافعي' },
  { text: 'لِسانُ الفَتى نِصفٌ وَنِصفٌ فُؤادُهُ .. فَلَم يَبقَ إِلّا صورَةُ اللَحمِ وَالدَمِ', author: 'زهير بن أبي سلمى' },
  { text: 'إِنَّما الأُمَمُ الأَخلاقُ ما بَقِيَت .. فَإِن هُمُ ذَهَبَت أَخلاقُهُم ذَهَبوا', author: 'أحمد شوقي' },
  { text: 'عَلى قَدرِ أَهلِ العَزمِ تَأتي العَزائِمُ .. وَتَأتي عَلى قَدرِ الكِرامِ المَكارِمُ', author: 'أبو الطيب المتنبي' }
];

export const UltimateMegaFeatures50: React.FC<UltimateMegaFeatures50Props> = ({
  isOpen,
  onClose,
  currentUser,
  onlineUsers,
  onSendChatMessage,
  onShowToast,
  onAddPoints,
  onToggleMic,
  socket,
  audioManager,
  micSlots = [],
  messages = [],
  pinnedTopic = '',
  roomSettings,
  currentRoomObj,
  monitoredWordsList = [],
  monitorLogs = [],
  serverSecurity,
  ignoredUsers = [],
  onAdminAction,
  onExportChat,
  onClearLocalChat,
  starredMessages,
  onToggleStarMessage
}) => {
  // Navigation tabs across the features
  const [activeTab, setActiveTab] = useState<'voice' | 'chat' | 'room' | 'security' | 'gamification'>('voice');

  // --- 1. Live WebRTC Quality Meter (RTCPeerConnection.getStats) ---
  const [webrtcPing, setWebrtcPing] = useState<number | null>(() => {
    const rtt = (navigator as any)?.connection?.rtt;
    return typeof rtt === 'number' && rtt > 0 ? rtt : null;
  });
  const [packetLoss, setPacketLoss] = useState<number | null>(null);
  const [jitter, setJitter] = useState<number | null>(null);
  const [activeVoicePeersCount, setActiveVoicePeersCount] = useState<number>(0);

  // --- 2. Waveform & Mic Activity ---
  const [isVisualizerActive, setIsVisualizerActive] = useState<boolean>(true);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const micAnalyserRef = useRef<AnalyserNode | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const ambientGainRef = useRef<GainNode | null>(null);
  const ambientSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recorderStreamRef = useRef<MediaStream | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);

  // --- 4. Mic Analyser / Feedback Test ---
  const [isEchoTesting, setIsEchoTesting] = useState<boolean>(false);

  // --- 5. 3D Spatial Audio Pan (wired to AudioMeshManager) ---
  const [spatialPan, setSpatialPan] = useState<number>(0);

  // --- 6. Voice Studio Equalizer Presets (wired to AudioMeshManager) ---
  const [voicePreset, setVoicePreset] = useState<'studio' | 'falcon' | 'radio' | 'echo' | 'helium'>('studio');

  // --- 7. Ambient Soundscapes Studio ---
  const [ambientType, setAmbientType] = useState<'none' | 'campfire' | 'rain' | 'oud' | 'desert'>('none');
  const [ambientVolume, setAmbientVolume] = useState<number>(45);

  // --- 8. Self-Mute Sync ---
  const isSelfMicMuted = Boolean(currentUser.isMuted || audioManager?.isMuted);

  // --- 9. Mic Slot Handover ---
  const [selectedHandoverUser, setSelectedHandoverUser] = useState<string>('');

  // --- 10. Voice Room Session Audio Recorder ---
  const [isRecordingRoom, setIsRecordingRoom] = useState<boolean>(false);
  const [recordingSeconds, setRecordingSeconds] = useState<number>(0);

  // --- 11. Live Text-to-Speech (TTS) ---
  const [ttsSpeed] = useState<number>(1.0);
  const [ttsPitch] = useState<number>(1.0);

  // --- 12. Starred & Bookmarked Messages ---
  const [localStarredList, setLocalStarredList] = useState<Array<{ id: string; user: string; text: string; time: string }>>([]);
  const [starredSearchQuery, setStarredSearchQuery] = useState('');

  const effectiveStarredList = useMemo(() => {
    if (Array.isArray(starredMessages)) {
      return starredMessages.map((m) => ({
        id: m.id,
        user: m.displayName || m.username,
        text: m.text,
        time: m.time
      }));
    }
    return localStarredList;
  }, [starredMessages, localStarredList]);

  const liveLeaderboard = useMemo(() => {
    const map = new Map<string, { name: string; pts: number; role: string }>();
    onlineUsers.forEach((u) => {
      const uname = u.displayName || u.username;
      map.set(u.username, { name: uname, pts: Number(u.points || 0), role: u.role });
    });
    if (currentUser.username) {
      map.set(currentUser.username, {
        name: currentUser.displayName || currentUser.username,
        pts: Number(currentUser.points || 0),
        role: currentUser.role
      });
    }
    const badges = ['🥇', '🥈', '🥉', '🎖️', '✨'];
    return Array.from(map.values())
      .sort((a, b) => b.pts - a.pts)
      .slice(0, 5)
      .map((item, idx) => ({
        rank: idx + 1,
        name: item.name,
        title: item.role === 'hassan' ? 'الإدارة العليا 🦅' : item.role === 'admin' ? 'مدير عام 👑' : item.role === 'super' ? 'سوبر مشرف 🛡️' : 'عضو نشط ⭐',
        pts: item.pts,
        badge: badges[idx] || '⭐'
      }));
  }, [onlineUsers, currentUser]);

  // --- 14. Poetry & Rhyme Assistant ---
  const [firstHemistich, setFirstHemistich] = useState('');
  const [secondHemistich, setSecondHemistich] = useState('');
  const [selectedRhymeChar, setSelectedRhymeChar] = useState('ر');

  // --- 16. Multilingual Hospitality Phrasebook ---
  const [targetLang, setTargetLang] = useState<'en' | 'fr' | 'ur' | 'tr'>('en');

  // --- 19. Message Scheduler & Timed Reminders ---
  const [scheduledReminderText, setScheduledReminderText] = useState('');
  const [scheduledMinutes, setScheduledMinutes] = useState<number>(5);

  // --- 21. Room MOTD / Pinned Topic (synced with room pinnedTopic) ---
  const [roomMotd, setRoomMotd] = useState(
    pinnedTopic || 'أهلاً بكم في شات حسان برو! يرجى الالتزام بآداب الحوار واحترام الجميع 🦅✨'
  );
  const [editingMotd, setEditingMotd] = useState(false);

  useEffect(() => {
    if (pinnedTopic && !editingMotd) {
      setRoomMotd(pinnedTopic);
    }
  }, [pinnedTopic, editingMotd]);

  // --- 22. Real Peak Hours Activity Heatmap computed from live messages ---
  const peakHoursBuckets = useMemo(() => {
    const labels = ['12ص', '2ص', '4ص', '6ص', '8ص', '10ص', '12م', '2م', '4م', '6م', '8م', '10م'];
    const counts = new Array<number>(12).fill(0);
    messages.forEach((m) => {
      const ts = typeof m.timestamp === 'number' && m.timestamp > 0 ? m.timestamp : null;
      if (!ts) return;
      const hour = new Date(ts).getHours();
      const bucketIdx = Math.min(11, Math.floor(hour / 2));
      counts[bucketIdx] += 1;
    });
    const maxCount = Math.max(1, ...counts);
    return labels.map((label, idx) => ({
      label,
      count: counts[idx],
      pct: messages.length > 0 ? Math.round((counts[idx] / maxCount) * 100) : 0
    }));
  }, [messages]);

  // --- 24. Room Password Input ---
  const [roomPasscode, setRoomPasscode] = useState('');
  const activeSlowModeSeconds = roomSettings?.slowModeSeconds || 0;
  const activeIsPasswordProtected = Boolean(currentRoomObj?.isPasswordProtected);

  // --- 26. Reputation & Honor Level System ---
  const calculatedLevel = Math.max(1, Math.floor(currentUser.points / 50) + 1);
  const levelTitle =
    calculatedLevel > 20
      ? 'شيخ المجلس ورمز الحكمة 👑'
      : calculatedLevel > 10
      ? 'فارس الكلمة وصقر الأدب 🦅'
      : calculatedLevel > 5
      ? 'عضو مرموق ومتميز ⭐'
      : 'صقر جديد واعد 🌟';

  // --- 31. Local Chat Auto-Clear Timer ---
  const [ephemeralTimer, setEphemeralTimer] = useState<'off' | '5m' | '15m' | '30m'>('off');
  const clearScreenTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // --- 33. FPS & Memory Profiler ---
  const [liveFps, setLiveFps] = useState<number>(60);
  const [estimatedMemoryMb, setEstimatedMemoryMb] = useState<number | null>(() => {
    const mem = (performance as any)?.memory?.usedJSHeapSize;
    return typeof mem === 'number' && mem > 0 ? Number((mem / (1024 * 1024)).toFixed(1)) : null;
  });

  // --- 34. Word Filter Input (wired to server monitoredWords for staff) ---
  const [newBlockedWord, setNewBlockedWord] = useState('');

  // --- 38. PWA Connectivity Status ---
  const [isOnline, setIsOnline] = useState<boolean>(navigator.onLine);

  // --- 41. Falcon Fortune Wheel ---
  const [isSpinningWheel, setIsSpinningWheel] = useState<boolean>(false);
  const [wheelRotation, setWheelRotation] = useState<number>(0);
  const [wheelWinMessage, setWheelWinMessage] = useState<string>('');

  // --- 42. Trivia Game State ---
  const [triviaIdx, setTriviaIdx] = useState<number>(0);
  const [selectedTriviaOption, setSelectedTriviaOption] = useState<number | null>(null);
  const [triviaScore, setTriviaScore] = useState<number>(0);

  // --- 43. Guess Proverb State ---
  const [proverbIdx, setProverbIdx] = useState<number>(0);
  const [userProverbInput, setUserProverbInput] = useState<string>('');
  const [proverbSolved, setProverbSolved] = useState<boolean>(false);

  // --- 45. Member-to-Member Points Transfer ---
  const [transferTargetUser, setTransferTargetUser] = useState<string>('');
  const [transferPointsAmount, setTransferPointsAmount] = useState<number>(10);

  // --- 46. User Mood & Custom Status ---
  const [activeMood, setActiveMood] = useState<string>('يرتشف قهوة المجلس ☕');

  // --- 15. Royal Text Ornaments ---
  const [calligraphyInput, setCalligraphyInput] = useState<string>('');
  const [selectedOrnamentIdx, setSelectedOrnamentIdx] = useState<number>(0);

  // --- 18. Rare Arabic Lexicon ---
  const [lexiconQuery, setLexiconQuery] = useState<string>('');

  // --- 25. Live Majlis Poll ---
  const [pollQuestion] = useState<string>('هل تؤيد تنظيم أمسية شعرية خاصة لصقور المجلس في نهاية الأسبوع؟');
  const [pollOptions] = useState<string[]>(['نعم وبشدة 👏', 'أفضل جلسة حوارية عامة ☕', 'حسب الوقت والظروف 🌙']);
  const [pollVotes, setPollVotes] = useState<number[]>([0, 0, 0]);
  const [userHasVoted, setUserHasVoted] = useState<number | null>(null);

  // --- 29. Zen Distraction-Free Sound Mute Mode (wired to sounds engine) ---
  const [isZenMode, setIsZenMode] = useState<boolean>(() => sounds.isMuted());

  // --- 30. Majlis Athkar & Prayers Reminder ---
  const [thikrIdx, setThikrIdx] = useState<number>(0);
  const [thikrCounter, setThikrCounter] = useState<number>(33);

  // --- 36. Security Access & Connection Info (from real browser/socket state) ---
  const [securityAuditInfo] = useState(() => {
    const ua = navigator.userAgent || '';
    const browser = ua.includes('Edg')
      ? 'Edge'
      : ua.includes('Chrome')
      ? 'Chrome'
      : ua.includes('Firefox')
      ? 'Firefox'
      : ua.includes('Safari')
      ? 'Safari'
      : 'Browser';
    const platform = /Android/i.test(ua)
      ? 'Android'
      : /iPhone|iPad|iPod/i.test(ua)
      ? 'iOS'
      : /Windows/i.test(ua)
      ? 'Windows'
      : /Mac OS X|Macintosh/i.test(ua)
      ? 'macOS'
      : /Linux/i.test(ua)
      ? 'Linux'
      : 'Client';
    return {
      os: `${browser} / ${platform}`,
      protocol: window.location.protocol === 'https:' ? 'WSS / HTTPS' : 'WS / Local Dev'
    };
  });

  // --- 38. Data Privacy Shield ---
  const [privacyCleared, setPrivacyCleared] = useState<boolean>(false);

  // --- 40. Quick Account Password Update ---
  const [quickNewPassword, setQuickNewPassword] = useState<string>('');

  // --- 48. Arab Wisdoms Dispenser ---
  const [wisdomIdx, setWisdomIdx] = useState<number>(0);

  const [selectedGiftRecipient, setSelectedGiftRecipient] = useState<string>(
    () => onlineUsers.find((u) => u.username !== currentUser.username)?.username || ''
  );

  // Stable room share code & tracked timer refs
  const wheelTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reminderTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const triviaTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const proverbTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isStaffMember =
    currentUser.role === 'hassan' || currentUser.role === 'admin' || currentUser.role === 'super';

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      if (wheelTimeoutRef.current) clearTimeout(wheelTimeoutRef.current);
      if (reminderTimeoutRef.current) clearTimeout(reminderTimeoutRef.current);
      if (triviaTimeoutRef.current) clearTimeout(triviaTimeoutRef.current);
      if (proverbTimeoutRef.current) clearTimeout(proverbTimeoutRef.current);
      if (clearScreenTimerRef.current) clearTimeout(clearScreenTimerRef.current);
      if ('speechSynthesis' in window) {
        try { window.speechSynthesis.cancel(); } catch {}
      }
      if (micStreamRef.current) {
        micStreamRef.current.getTracks().forEach((t) => t.stop());
        micStreamRef.current = null;
      }
      if (recorderStreamRef.current) {
        recorderStreamRef.current.getTracks().forEach((t) => t.stop());
        recorderStreamRef.current = null;
      }
      if (ambientSourceRef.current) {
        try { ambientSourceRef.current.stop(); ambientSourceRef.current.disconnect(); } catch {}
        ambientSourceRef.current = null;
      }
      if (audioCtxRef.current && audioCtxRef.current.state !== 'closed') {
        try { audioCtxRef.current.close(); } catch {}
        audioCtxRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onClose]);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;

    const readTelemetry = async () => {
      const mem = (performance as any)?.memory?.usedJSHeapSize;
      setEstimatedMemoryMb(typeof mem === 'number' && mem > 0 ? Number((mem / (1024 * 1024)).toFixed(1)) : null);

      const fallbackRtt = (navigator as any)?.connection?.rtt;
      const navPing = typeof fallbackRtt === 'number' && fallbackRtt > 0 ? fallbackRtt : null;

      if (audioManager) {
        try {
          const stats = await audioManager.getNetworkQualityStats();
          if (cancelled) return;
          setActiveVoicePeersCount(stats.activePeers);
          setWebrtcPing(stats.pingMs !== null ? stats.pingMs : navPing);
          setPacketLoss(stats.packetLossPct);
          setJitter(stats.jitterMs);
          return;
        } catch {
          // Ignore transient stats read errors
        }
      }

      if (!cancelled) {
        setActiveVoicePeersCount(0);
        setWebrtcPing(navPing);
        setPacketLoss(null);
        setJitter(null);
      }
    };
    void readTelemetry();

    let frameCount = 0;
    let lastTime = performance.now();
    let rafId: number | null = null;
    const tick = (now: number) => {
      frameCount += 1;
      const elapsed = now - lastTime;
      if (elapsed >= 1500) {
        setLiveFps(Math.min(120, Math.round((frameCount * 1000) / elapsed)));
        void readTelemetry();
        frameCount = 0;
        lastTime = now;
      }
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);

    return () => {
      cancelled = true;
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
  }, [isOpen, audioManager]);

  // Voice recording timer
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | undefined;
    if (isRecordingRoom) {
      timer = setInterval(() => {
        setRecordingSeconds((prev) => prev + 1);
      }, 1000);
    } else {
      setRecordingSeconds(0);
    }
    return () => {
      if (timer) clearInterval(timer);
    };
  }, [isRecordingRoom]);

  // Audio Canvas visualizer (uses real AnalyserNode when mic test is active; idle frame otherwise)
  useEffect(() => {
    if (!isOpen || !isVisualizerActive || activeTab !== 'voice') return;
    let animId: number | null = null;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const freqData = micAnalyserRef.current ? new Uint8Array(micAnalyserRef.current.frequencyBinCount) : null;

    const drawBars = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const bars = 24;
      const barWidth = canvas.width / bars - 2;
      if (isEchoTesting && micAnalyserRef.current && freqData) {
        micAnalyserRef.current.getByteFrequencyData(freqData);
      }

      for (let i = 0; i < bars; i++) {
        let height = 6;
        if (isEchoTesting && freqData) {
          const bin = Math.min(freqData.length - 1, Math.floor((i / bars) * freqData.length));
          height = 6 + (freqData[bin] / 255) * (canvas.height - 8);
        } else if (currentUser.isVoice) {
          height = 10 + ((i % 3) * 4);
        }
        const x = i * (barWidth + 2);
        const y = (canvas.height - height) / 2;

        const grad = ctx.createLinearGradient(0, y, 0, y + height);
        grad.addColorStop(0, '#f59e0b');
        grad.addColorStop(1, '#d97706');

        ctx.fillStyle = grad;
        ctx.fillRect(x, y, barWidth, height);
      }
    };

    drawBars();
    if (!isEchoTesting) return;

    const render = () => {
      drawBars();
      animId = requestAnimationFrame(render);
    };
    animId = requestAnimationFrame(render);
    return () => {
      if (animId !== null) cancelAnimationFrame(animId);
    };
  }, [isOpen, isVisualizerActive, activeTab, isEchoTesting, currentUser.isVoice]);

  const shuffledArabicTrivia = useMemo(() => {
    const q = ARABIC_TRIVIA[triviaIdx];
    const items = q.options.map((text, idx) => ({ text, isCorrect: idx === q.correct }));
    return shuffleTriviaOptions(items, triviaIdx * 19 + 5);
  }, [triviaIdx]);

  if (!isOpen) return null;

  // --- Handlers ---
  const handleSpinWheel = () => {
    if (isSpinningWheel) return;
    setIsSpinningWheel(true);
    setWheelWinMessage('');

    const rewards = [
      { pts: 25, label: '25 نقطة صقر ذهبية ⭐' },
      { pts: 50, label: '50 نقطة ملكية + وسام الشجاعة 🦅' },
      { pts: 10, label: '10 نقاط تحية للمجلس ☕' },
      { pts: 100, label: 'الجائزة الكبرى: 100 نقطة فخامة! 👑' },
      { pts: 15, label: '15 نقطة لايك شرفي ❤️' },
      { pts: 30, label: '30 نقطة شاعر المجلس 📜' }
    ];

    const chosenIdx = Math.floor(Math.random() * rewards.length);
    const extraRotations = 5 + Math.floor(Math.random() * 3);
    const newAngle = wheelRotation + extraRotations * 360 + chosenIdx * 60;
    setWheelRotation(newAngle);

    if (wheelTimeoutRef.current) clearTimeout(wheelTimeoutRef.current);
    wheelTimeoutRef.current = setTimeout(() => {
      wheelTimeoutRef.current = null;
      setIsSpinningWheel(false);
      const win = rewards[chosenIdx];
      setWheelWinMessage(win.label);
      onAddPoints(win.pts, 'عجلة الحظ اليومية');
      confetti({ particleCount: 50, spread: 70 });
      sounds.playGeneralAlertPing();
      onShowToast(`مبروك! فزت بـ ${win.label}`, 'success');
    }, 3200);
  };

  const handleSendGift = (gift: (typeof VIRTUAL_GIFTS)[0]) => {
    if (currentUser.points < gift.cost) {
      onShowToast(`عفواً، رصيد نقاطك (${currentUser.points}) لا يكفي لإهداء ${gift.name} (${gift.cost} نقطة)`, 'error');
      return;
    }
    const targetUsername =
      selectedGiftRecipient || onlineUsers.find((u) => u.username !== currentUser.username)?.username || '';
    if (!targetUsername) {
      onShowToast('يرجى اختيار عضو مستلم للهدية أولاً', 'error');
      return;
    }
    if (!socket?.connected) {
      onShowToast('يرجى الاتصال بالخادم أولاً لإرسال الهدايا', 'error');
      return;
    }
    socket.emit('sendMemberGift', {
      targetUsername,
      giftTitle: gift.name,
      giftIcon: gift.icon,
      giftCost: gift.cost
    });
    confetti({ particleCount: 40, spread: 60 });
    sounds.playGeneralAlertPing();
    onShowToast(`تم إرسال ${gift.name} إلى ${targetUsername} بنجاح! 🎁`, 'success');
  };

  const handlePlaySoundboard = (item: (typeof SOUNDBOARD_ITEMS)[0]) => {
    sounds.playMentionPing();
    onShowToast(`تم تشغيل مؤثر: ${item.name}`, 'info');
    onSendChatMessage(`🔊 [مؤثر صوتي]: قام ${currentUser.displayName || currentUser.username} بتشغيل ${item.name}`);
  };

  const handleSendTTS = (text: string) => {
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = 'ar-SA';
      utterance.rate = ttsSpeed;
      utterance.pitch = ttsPitch;
      window.speechSynthesis.speak(utterance);
      onShowToast('جاري نطق الرسالة بصوت عربي فصيح 🗣️', 'info');
    } else {
      onShowToast('ميزة القراءة الصوتية غير مدعومة في متصفحك', 'error');
    }
  };

  const handleSendPoetry = () => {
    if (!firstHemistich.trim() || !secondHemistich.trim()) {
      onShowToast('يرجى كتابة شطري البيت الشعري (الصدر والعجز)', 'error');
      return;
    }
    const poem = `📜 [بيت شعر موزون على قافية الـ ${selectedRhymeChar}]:\n"${firstHemistich.trim()} ... ${secondHemistich.trim()}"`;
    onSendChatMessage(poem);
    setFirstHemistich('');
    setSecondHemistich('');
    onShowToast('تم نشر البيت الشعري في المجلس!', 'success');
  };

  const handleTransferPoints = () => {
    if (!transferTargetUser) {
      onShowToast('يرجى اختيار العضو المستلم', 'error');
      return;
    }
    if (transferTargetUser === currentUser.username) {
      onShowToast('لا يمكنك تحويل النقاط لنفسك', 'error');
      return;
    }
    const amount = Math.floor(Number(transferPointsAmount));
    if (!Number.isFinite(amount) || amount < 1) {
      onShowToast('يرجى إدخال عدد صحيح أكبر من صفر', 'error');
      return;
    }
    if (currentUser.points < amount) {
      onShowToast('رصيدك من النقاط لا يكفي للتحويل', 'error');
      return;
    }
    const targetObj = onlineUsers.find((u) => u.username === transferTargetUser);
    const targetDisplay = targetObj?.displayName || transferTargetUser;
    if (socket?.connected) {
      socket.emit('transferPoints', { targetUsername: transferTargetUser, amount });
      onShowToast(`تم إرسال طلب تحويل ${amount} نقطة إلى ${targetDisplay}`, 'success');
    } else {
      onShowToast('يرجى الاتصال بالخادم لتنفيذ تحويل النقاط بأمان', 'error');
    }
  };



  const handleToggleVoiceMonitor = async () => {
    if (isEchoTesting) {
      setIsEchoTesting(false);
      if (micStreamRef.current) {
        micStreamRef.current.getTracks().forEach((t) => t.stop());
        micStreamRef.current = null;
      }
      micAnalyserRef.current = null;
      onShowToast('تم إيقاف فحص المايك', 'info');
      return;
    }
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        onShowToast('المتصفح لا يدعم التقاط الصوت', 'error');
        return;
      }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!audioCtxRef.current || audioCtxRef.current.state === 'closed') {
        audioCtxRef.current = new AudioCtx();
      }
      if (audioCtxRef.current.state === 'suspended') {
        await audioCtxRef.current.resume();
      }
      const source = audioCtxRef.current.createMediaStreamSource(stream);
      const analyser = audioCtxRef.current.createAnalyser();
      analyser.fftSize = 128;
      source.connect(analyser);
      micStreamRef.current = stream;
      micAnalyserRef.current = analyser;
      setIsEchoTesting(true);
      onShowToast('جاري التقاط ترددات الميكروفون الحقيقية بدون صدى 🎤', 'success');
    } catch {
      onShowToast('تعذر الوصول إلى الميكروفون — يرجى منح الإذن', 'error');
    }
  };

  const handleSelectAmbient = (type: 'none' | 'campfire' | 'rain' | 'oud' | 'desert', label: string) => {
    setAmbientType(type);
    if (ambientSourceRef.current) {
      try { ambientSourceRef.current.stop(); ambientSourceRef.current.disconnect(); } catch {}
      ambientSourceRef.current = null;
    }
    if (type === 'none') {
      if (ambientGainRef.current && audioCtxRef.current) {
        ambientGainRef.current.gain.setValueAtTime(0, audioCtxRef.current.currentTime);
      }
      onShowToast('تم إيقاف الخلفية الصوتية', 'info');
      return;
    }
    try {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!audioCtxRef.current || audioCtxRef.current.state === 'closed') {
        audioCtxRef.current = new AudioCtx();
      }
      const ctx = audioCtxRef.current;
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});
      if (!ambientGainRef.current) {
        ambientGainRef.current = ctx.createGain();
        ambientGainRef.current.connect(ctx.destination);
      }
      ambientGainRef.current.gain.setValueAtTime((ambientVolume / 100) * 0.14, ctx.currentTime);
      const bufferSize = ctx.sampleRate * 2;
      const buf = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
      const ch = buf.getChannelData(0);
      let last = 0;
      for (let i = 0; i < bufferSize; i++) {
        const w = Math.random() * 2 - 1;
        last = (last + 0.04 * w) / 1.04;
        ch[i] = Math.max(-1, Math.min(1, last * 1.4));
      }
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = type === 'rain' ? 950 : type === 'desert' ? 320 : 520;
      src.connect(filter);
      filter.connect(ambientGainRef.current);
      src.start();
      ambientSourceRef.current = src;
      onShowToast(`تم تشغيل خلفية: ${label}`, 'info');
    } catch {
      onShowToast(`تم اختيار الخلفية: ${label}`, 'info');
    }
  };

  const handleToggleRoomRecording = async () => {
    if (isRecordingRoom) {
      setIsRecordingRoom(false);
      if (recorderRef.current && recorderRef.current.state !== 'inactive') {
        try { recorderRef.current.stop(); } catch {}
      }
      return;
    }
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        onShowToast('المتصفح لا يدعم التسجيل الصوتي', 'error');
        return;
      }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      recorderStreamRef.current = stream;
      const recorder = new MediaRecorder(stream);
      recorderRef.current = recorder;
      recordedChunksRef.current = [];
      recorder.ondataavailable = (ev) => {
        if (ev.data.size > 0) recordedChunksRef.current.push(ev.data);
      };
      recorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        if (recorderStreamRef.current === stream) recorderStreamRef.current = null;
        if (recordedChunksRef.current.length > 0) {
          const blob = new Blob(recordedChunksRef.current, { type: recorder.mimeType || 'audio/webm' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `hassan_session_${Date.now()}.webm`;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          setTimeout(() => URL.revokeObjectURL(url), 1000);
          onShowToast('تم حفظ وتنزيل التسجيل الصوتي بنجاح 💾', 'success');
        }
      };
      recorder.start();
      setIsRecordingRoom(true);
      onShowToast('بدأ تسجيل المقطع الصوتي من الميكروفون 🔴', 'info');
    } catch {
      onShowToast('تعذر بدء التسجيل — تحقق من إذن الميكروفون', 'error');
    }
  };

  const handleDownloadChatLog = () => {
    if (onExportChat) {
      onExportChat();
      return;
    }
    if (messages.length === 0) {
      onShowToast('لا توجد رسائل لتصديرها حالياً', 'info');
      return;
    }
    const lines = messages.map((m) => `[${m.time}] ${m.displayName || m.username}: ${m.text || ''}`);
    const textContent = `سجل محادثات شات حسان برو\nالتاريخ: ${new Date().toLocaleString('ar-SA')}\nالغرفة: ${currentUser.room}\n==============================\n\n` + lines.join('\n');
    const blob = new Blob([textContent], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `hassanpro-chat-${Date.now()}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    onShowToast('تم تنزيل سجل المحادثة الحقيقي 📥', 'success');
  };

  // 15. Send Formatted Calligraphy Text
  const handleSendFormattedText = () => {
    if (!calligraphyInput.trim()) {
      onShowToast('يرجى كتابة نص لتطبيق الزخرفة الملكية', 'error');
      return;
    }
    const formatted = TEXT_ORNAMENTS[selectedOrnamentIdx].format(calligraphyInput.trim());
    onSendChatMessage(formatted);
    setCalligraphyInput('');
    confetti({ particleCount: 25, spread: 50 });
    sounds.playGeneralAlertPing();
    onShowToast('تم إرسال النص المزخرف الملكي بنجاح! 👑', 'success');
  };

  // 25. Vote in Live Majlis Poll
  const handleVotePoll = (index: number) => {
    if (userHasVoted !== null) {
      onShowToast('لقد شاركت في هذا التصويت مسبقاً!', 'info');
      return;
    }
    setUserHasVoted(index);
    setPollVotes((prev) => {
      const next = [...prev];
      next[index] += 1;
      return next;
    });
    confetti({ particleCount: 30, spread: 50 });
    sounds.playGeneralAlertPing();
    onShowToast(`تم تسجيل صوتك لصالح: ${pollOptions[index]}!`, 'success');
    onSendChatMessage(`📊 شارك [${currentUser.displayName || currentUser.username}] في استطلاع المجلس: صوت لصالح [${pollOptions[index]}]`);
  };

  // 30. Send Athkar Blessing to Room
  const handleSendThikrToRoom = () => {
    const text = ARABIC_ATHKAR[thikrIdx];
    onSendChatMessage(`📿 [ذكر ودعاء مبارك]: ${text}`);
    onAddPoints(5, 'مشاركة الذكر مع المجلس');
    sounds.playGeneralAlertPing();
    onShowToast('جزاك الله خيراً، تم إرسال الذكر إلى المجلس (+5 نقاط) 🤲', 'success');
  };

  // 38. Clear Privacy Footprint
  const handleClearPrivacyFootprint = () => {
    setPrivacyCleared(true);
    try {
      sessionStorage.removeItem('temp_audio_cache');
      sessionStorage.removeItem('draft_chat');
    } catch (e) {}
    sounds.playGeneralAlertPing();
    onShowToast('تم مسح جميع البصمات المؤقتة وسجل الجلسة بنجاح 🛡️', 'success');
  };

  // 39. Emergency Lockdown Switch (wired directly to serverSecurity)
  const handleEmergencyLockdownToggle = () => {
    if (!isStaffMember) {
      onShowToast('هذه الميزة مخصصة لمشرفي وإدارة المجلس فقط!', 'error');
      return;
    }
    if (!socket?.connected) {
      onShowToast('يرجى الاتصال بالخادم أولاً', 'error');
      return;
    }
    const nextState = !Boolean(serverSecurity?.emergencyLockdown);
    socket.emit('updateServerSecurity', { emergencyLockdown: nextState });
    onShowToast(
      nextState ? 'تم تفعيل الإغلاق الأمني الطارئ على السيرفر 🚨' : 'تم إلغاء وضع الطوارئ بنجاح ✅',
      nextState ? 'error' : 'success'
    );
  };

  // 48. Share Arab Wisdom to Room
  const handleShareDailyWisdom = () => {
    const w = ARABIC_WISDOMS[wisdomIdx];
    onSendChatMessage(`📜 [حكمة وأدب عربي أصيل]:\n"${w.text}"\n— ${w.author}`);
    sounds.playGeneralAlertPing();
    onShowToast('تمت مشاركة الحكمة مع المجلس!', 'success');
    setWisdomIdx((prev) => (prev + 1) % ARABIC_WISDOMS.length);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-2 sm:p-4 animate-fade-in" dir="rtl">
      <div className="bg-slate-900 border border-slate-700 w-full max-w-2xl max-h-[88dvh] min-h-0 rounded-3xl shadow-2xl flex flex-col overflow-hidden text-slate-100">
        
        {/* Header */}
        <div className="bg-gradient-to-r from-amber-950 via-slate-900 to-amber-950 border-b border-amber-500/30 p-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-amber-400 shadow-md">
              <Sparkles className="w-5 h-5 animate-pulse" />
            </div>
            <div>
              <h2 className="text-base font-extrabold text-amber-300 flex items-center gap-2">
                ترسانة الميزات الـ 50 الشاملة (Mega Suite 50+)
                <span className="text-[10px] bg-amber-500/20 text-amber-400 px-2 py-0.5 rounded-full border border-amber-500/30">
                  الإصدار الفائق
                </span>
              </h2>
              <p className="text-xs text-slate-400">
                منظومة متكاملة من ميزات الصوت، الشات، الرقابة، الألعاب والجماليات
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-slate-800/80 hover:bg-slate-700 flex items-center justify-center text-slate-400 hover:text-white transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Navigation Tabs */}
        <div className="flex items-center justify-around bg-slate-950/60 border-b border-slate-800 px-2 py-2 text-xs overflow-x-auto">
          <button
            onClick={() => setActiveTab('voice')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl font-bold transition-all shrink-0 ${
              activeTab === 'voice'
                ? 'bg-amber-500 text-slate-950 shadow-md'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
            }`}
          >
            <Headphones className="w-3.5 h-3.5" />
            <span>الصوت والمايكات (1-10)</span>
          </button>

          <button
            onClick={() => setActiveTab('chat')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl font-bold transition-all shrink-0 ${
              activeTab === 'chat'
                ? 'bg-amber-500 text-slate-950 shadow-md'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
            }`}
          >
            <MessageSquare className="w-3.5 h-3.5" />
            <span>أدوات الشات (11-20)</span>
          </button>

          <button
            onClick={() => setActiveTab('room')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl font-bold transition-all shrink-0 ${
              activeTab === 'room'
                ? 'bg-amber-500 text-slate-950 shadow-md'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
            }`}
          >
            <Shield className="w-3.5 h-3.5" />
            <span>إدارة المجلس (21-30)</span>
          </button>

          <button
            onClick={() => setActiveTab('security')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl font-bold transition-all shrink-0 ${
              activeTab === 'security'
                ? 'bg-amber-500 text-slate-950 shadow-md'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
            }`}
          >
            <Lock className="w-3.5 h-3.5" />
            <span>الأمان والتتبع (31-40)</span>
          </button>

          <button
            onClick={() => setActiveTab('gamification')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl font-bold transition-all shrink-0 ${
              activeTab === 'gamification'
                ? 'bg-amber-500 text-slate-950 shadow-md'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
            }`}
          >
            <Gift className="w-3.5 h-3.5" />
            <span>الألعاب والمرح (41-50)</span>
          </button>
        </div>

        {/* Content Body */}
        <div className="flex-1 min-h-0 overflow-y-auto modal-scroll-container p-4 space-y-4 overscroll-contain">
          
          {/* ================= SECTION 1: VOICE & MIC (Features 1-10) ================= */}
          {activeTab === 'voice' && (
            <div className="space-y-4 animate-fade-in">
              {/* 1. Live Audio Latency & WebRTC Quality Meter (RTCPeerConnection.getStats) */}
              <div className="bg-slate-800/60 border border-slate-700/60 rounded-2xl p-3.5 space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2 font-bold text-amber-400">
                    <Activity className="w-4 h-4" />
                    <span>ميزة 1: مقياس جودة WebRTC اللحظي (getStats)</span>
                  </div>
                  <span className="text-[11px] text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full border border-emerald-500/30">
                    {activeVoicePeersCount > 0
                      ? `متصل (${activeVoicePeersCount} قناة صوتية)`
                      : isOnline
                      ? 'بانتظار قناة صوتية (WebRTC)'
                      : 'غير متصل'}
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-2 text-center text-xs">
                  <div className="bg-slate-900/80 rounded-xl p-2 border border-slate-800">
                    <div className="text-[10px] text-slate-400">زمن الاستجابة (Ping)</div>
                    <div className="text-base font-bold text-amber-400 font-mono mt-0.5">{webrtcPing !== null ? `${Math.round(webrtcPing)} ms` : '-- ms'}</div>
                  </div>
                  <div className="bg-slate-900/80 rounded-xl p-2 border border-slate-800">
                    <div className="text-[10px] text-slate-400">فقد الحزم (Loss)</div>
                    <div className="text-base font-bold text-emerald-400 font-mono mt-0.5">{packetLoss !== null ? `${packetLoss}%` : '--'}</div>
                  </div>
                  <div className="bg-slate-900/80 rounded-xl p-2 border border-slate-800">
                    <div className="text-[10px] text-slate-400">تذبذب الإشارة (Jitter)</div>
                    <div className="text-base font-bold text-sky-400 font-mono mt-0.5">{jitter !== null ? `${jitter} ms` : '--'}</div>
                  </div>
                </div>
              </div>

              {/* 2. Waveform & Mic Level Canvas */}
              <div className="bg-slate-800/60 border border-slate-700/60 rounded-2xl p-3.5 space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2 font-bold text-amber-400">
                    <Radio className="w-4 h-4" />
                    <span>ميزة 2: المحلل الطيفي والموجات الصوتية الحيّة (Live Waveform)</span>
                  </div>
                  <button
                    onClick={() => setIsVisualizerActive(!isVisualizerActive)}
                    className="text-[11px] text-slate-300 hover:text-white"
                  >
                    {isVisualizerActive ? 'إيقاف الرسوم' : 'تفعيل'}
                  </button>
                </div>
                <canvas
                  ref={canvasRef}
                  width={400}
                  height={48}
                  className="w-full h-12 bg-slate-950/70 rounded-xl border border-slate-800"
                />
              </div>

              {/* 3. Live Microphone Slots Monitor */}
              <div className="bg-slate-800/60 border border-slate-700/60 rounded-2xl p-3.5 space-y-2.5">
                <div className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2 font-bold text-amber-400">
                    <ListOrdered className="w-4 h-4" />
                    <span>ميزة 3: حالة مقاعد المايك الحية بالغرفة (Live Mic Slots)</span>
                  </div>
                  {onToggleMic && (
                    <button
                      onClick={onToggleMic}
                      className={`text-xs px-2.5 py-1 rounded-xl font-bold transition-all ${
                        currentUser.micSlot !== null && currentUser.micSlot !== undefined
                          ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
                          : 'bg-amber-500 text-slate-950'
                      }`}
                    >
                      {currentUser.micSlot !== null && currentUser.micSlot !== undefined ? 'النزول من المايك' : 'الصعود لمايك شاغر 🎤'}
                    </button>
                  )}
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
                  {micSlots.length === 0 ? (
                    <div className="col-span-full text-[11px] text-slate-400">لا توجد بيانات مقاعد حالياً</div>
                  ) : (
                    micSlots.map((slot) => (
                      <div key={slot.slotNumber} className="text-[11px] bg-slate-900 border border-slate-700 px-2 py-1.5 rounded-lg flex items-center justify-between text-slate-300">
                        <span className="text-amber-400 font-bold">#{slot.slotNumber}</span>
                        <span className="truncate mr-1.5">
                          {slot.user ? (slot.user.displayName || slot.user.username) : 'شاغر'}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* 4 & 5. Loopback Echo Test & Spatial Panning (wired to AudioMeshManager) */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="bg-slate-800/60 border border-slate-700/60 rounded-2xl p-3 space-y-2">
                  <div className="text-xs font-bold text-amber-400 flex items-center gap-1.5">
                    <Headphones className="w-3.5 h-3.5" />
                    <span>ميزة 4: اختبار تردد الميكروفون الحقيقي (Mic Check)</span>
                  </div>
                  <p className="text-[11px] text-slate-400">افحص استجابة الميكروفون على الطيف الموجي</p>
                  <button
                    onClick={handleToggleVoiceMonitor}
                    className={`w-full py-1.5 rounded-xl text-xs font-bold transition-colors ${
                      isEchoTesting ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40' : 'bg-slate-700 hover:bg-slate-600 text-slate-200'
                    }`}
                  >
                    {isEchoTesting ? 'إيقاف الفحص' : 'بدء فحص المايك'}
                  </button>
                </div>

                <div className="bg-slate-800/60 border border-slate-700/60 rounded-2xl p-3 space-y-2">
                  <div className="text-xs font-bold text-amber-400 flex items-center gap-1.5">
                    <Sliders className="w-3.5 h-3.5" />
                    <span>ميزة 5: توزيع الصوت المجسم ثلاثي الأبعاد (Spatial Pan)</span>
                  </div>
                  <div className="flex items-center justify-between text-[10px] text-slate-400">
                    <span>يسار ◀</span>
                    <span className="text-amber-400 font-bold">{spatialPan === 0 ? 'في المنتصف' : spatialPan < 0 ? `${Math.round(spatialPan * -100)}% يسار` : `${Math.round(spatialPan * 100)}% يمين`}</span>
                    <span>▶ يمين</span>
                  </div>
                  <input
                    type="range"
                    min="-1"
                    max="1"
                    step="0.1"
                    value={spatialPan}
                    onChange={(e) => {
                      const nextPan = parseFloat(e.target.value);
                      setSpatialPan(nextPan);
                      audioManager?.applyStudioSettings({ spatialPan: nextPan });
                    }}
                    className="w-full accent-amber-500 h-1.5 bg-slate-900 rounded-lg cursor-pointer"
                  />
                </div>
              </div>

              {/* 6. Voice Presets Equalizer (wired to AudioMeshManager) */}
              <div className="bg-slate-800/60 border border-slate-700/60 rounded-2xl p-3.5 space-y-2">
                <div className="text-xs font-bold text-amber-400 flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>ميزة 6: قوالب ومؤثرات نبرة الصوت في البث (Voice Studio Presets)</span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-1.5 text-xs">
                  {[
                    { id: 'studio', label: 'استوديو نقي 🎙️' },
                    { id: 'falcon', label: 'صقر مهيب 🦅' },
                    { id: 'radio', label: 'مذياع كلاسيك 📻' },
                    { id: 'echo', label: 'صدى المجالس 🏛️' },
                    { id: 'helium', label: 'مرح وهيليوم 🎈' }
                  ].map((p) => (
                    <button
                      key={p.id}
                      onClick={() => {
                        const preset = p.id as 'studio' | 'falcon' | 'radio' | 'echo' | 'helium';
                        setVoicePreset(preset);
                        audioManager?.applyStudioSettings({ effect: preset });
                        onShowToast(`تم تفعيل نبرة: ${p.label}`, 'success');
                      }}
                      className={`p-2 rounded-xl text-center font-bold text-[11px] transition-all ${
                        voicePreset === p.id
                          ? 'bg-amber-500 text-slate-950 shadow-md'
                          : 'bg-slate-900/80 hover:bg-slate-800 text-slate-300 border border-slate-800'
                      }`}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* 7. Background Ambient Soundscapes */}
              <div className="bg-slate-800/60 border border-slate-700/60 rounded-2xl p-3.5 space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <div className="text-xs font-bold text-amber-400 flex items-center gap-1.5">
                    <Music className="w-3.5 h-3.5" />
                    <span>ميزة 7: استوديو الخلفيات الصوتية للمجلس (Ambient Soundscapes)</span>
                  </div>
                  <span className="text-[11px] text-slate-400">حجم: {ambientVolume}%</span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-1.5 text-xs">
                  {[
                    { id: 'none', label: 'بدون خلفية ⏹️' },
                    { id: 'campfire', label: 'نار السمر 🔥' },
                    { id: 'rain', label: 'مطر البادية 🌧️' },
                    { id: 'oud', label: 'تقاسيم عود 🎵' },
                    { id: 'desert', label: 'نسيم الصحراء 🏜️' }
                  ].map((a) => (
                    <button
                      key={a.id}
                      onClick={() => handleSelectAmbient(a.id as any, a.label)}
                      className={`p-2 rounded-xl text-center font-bold text-[11px] transition-all ${
                        ambientType === a.id
                          ? 'bg-amber-500 text-slate-950 shadow-md'
                          : 'bg-slate-900/80 hover:bg-slate-800 text-slate-300 border border-slate-800'
                      }`}
                    >
                      {a.label}
                    </button>
                  ))}
                </div>
                {ambientType !== 'none' && (
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={ambientVolume}
                    onChange={(e) => {
                      const val = parseInt(e.target.value, 10);
                      setAmbientVolume(val);
                      if (ambientGainRef.current && audioCtxRef.current) {
                        ambientGainRef.current.gain.setValueAtTime((val / 100) * 0.14, audioCtxRef.current.currentTime);
                      }
                    }}
                    className="w-full accent-amber-500 h-1.5 bg-slate-900 rounded-lg cursor-pointer mt-2"
                  />
                )}
              </div>

              {/* 8, 9, 10. Handover, Mute Warning, Voice Recording */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {/* 8. Quick Mic Mute Control (wired to AudioMeshManager) */}
                <div className="bg-slate-800/60 border border-slate-700/60 rounded-2xl p-3 space-y-1.5">
                  <div className="text-xs font-bold text-amber-400 flex items-center gap-1.5">
                    <MicOff className="w-3.5 h-3.5" />
                    <span>ميزة 8: التحكم بكتم الميكروفون</span>
                  </div>
                  <p className="text-[10px] text-slate-400">
                    {currentUser.isVoice ? 'كتم أو فتح صوت الميكروفون مباشرة' : 'متاح عند الصعود على المايك'}
                  </p>
                  <button
                    disabled={!currentUser.isVoice || !audioManager}
                    onClick={() => {
                      if (!audioManager) return;
                      const nextMuted = audioManager.setMutedState(!audioManager.isMuted);
                      onShowToast(nextMuted ? 'تم كتم الميكروفون 🔇' : 'تم فتح الميكروفون 🎙️', 'info');
                    }}
                    className={`w-full py-1 rounded-xl text-xs font-bold disabled:opacity-50 ${
                      isSelfMicMuted ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40' : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                    }`}
                  >
                    {isSelfMicMuted ? 'المايك مكتوم (انقر للفتح)' : 'المايك مفتوح (انقر للكتم)'}
                  </button>
                </div>

                {/* 9. Mic Slot Handover */}
                <div className="bg-slate-800/60 border border-slate-700/60 rounded-2xl p-3 space-y-1.5">
                  <div className="text-xs font-bold text-amber-400 flex items-center gap-1.5">
                    <Share2 className="w-3.5 h-3.5" />
                    <span>ميزة 9: إهداء وتمرير المايك</span>
                  </div>
                  <select
                    value={selectedHandoverUser}
                    onChange={(e) => setSelectedHandoverUser(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 text-[11px] rounded-lg p-1.5 text-slate-200"
                  >
                    <option value="">اختر عضواً لتسليمه المايك</option>
                    {onlineUsers.filter((u) => u.username !== currentUser.username).map((u) => (
                      <option key={u.id} value={u.username}>{u.displayName || u.username}</option>
                    ))}
                  </select>
                  <button
                    onClick={() => {
                      if (!selectedHandoverUser) {
                        onShowToast('يرجى اختيار العضو أولاً', 'error');
                        return;
                      }
                      const targetObj = onlineUsers.find((u) => u.username === selectedHandoverUser);
                      const targetDisplay = targetObj?.displayName || selectedHandoverUser;
                      onSendChatMessage(`🎤 قام [${currentUser.displayName || currentUser.username}] بتمرير وإهداء دور المايك لـ ${targetDisplay}`);
                      if (currentUser.micSlot !== null && currentUser.micSlot !== undefined && onToggleMic) {
                        onToggleMic();
                      }
                      onShowToast(`تم تمرير الدور وإخلاء المايك لـ ${targetDisplay}!`, 'success');
                    }}
                    className="w-full bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold py-1 rounded-xl text-xs"
                  >
                    تمرير وإخلاء المايك
                  </button>
                </div>

                {/* 10. Voice Room Session Audio Recorder */}
                <div className="bg-slate-800/60 border border-slate-700/60 rounded-2xl p-3 space-y-1.5">
                  <div className="text-xs font-bold text-amber-400 flex items-center gap-1.5">
                    <Volume2 className="w-3.5 h-3.5" />
                    <span>ميزة 10: تسجيل جلسة الصوت</span>
                  </div>
                  <p className="text-[10px] text-slate-400">
                    {isRecordingRoom ? `جاري التسجيل: ${recordingSeconds} ثانية` : 'تسجيل الأمسية وتنزيلها'}
                  </p>
                  <button
                    onClick={handleToggleRoomRecording}
                    className={`w-full py-1 rounded-xl text-xs font-bold ${
                      isRecordingRoom ? 'bg-rose-500 text-white animate-pulse' : 'bg-slate-700 hover:bg-slate-600 text-slate-200'
                    }`}
                  >
                    {isRecordingRoom ? 'إيقاف وحفظ الملف' : 'بدء التسجيل'}
                  </button>
                </div>
              </div>
              {onToggleMic && (
                <div className="bg-slate-800/60 border border-slate-700/60 rounded-2xl p-3 flex items-center justify-between text-xs">
                  <span className="font-bold text-slate-200">التحكم السريع بالمايك العام:</span>
                  <button
                    onClick={onToggleMic}
                    className={`px-3 py-1 rounded-xl font-bold ${currentUser.isVoice ? 'bg-rose-500 text-white' : 'bg-emerald-500 text-slate-950'}`}
                  >
                    {currentUser.isVoice ? 'إغلاق المايك الآن' : 'فتح المايك والتحدث 🎤'}
                  </button>
                </div>
              )}
            </div>
          )}

          {/* ================= SECTION 2: CHAT POWER TOOLS (Features 11-20) ================= */}
          {activeTab === 'chat' && (
            <div className="space-y-4 animate-fade-in">
              {/* 11. Live Text-to-Speech (TTS) Engine */}
              <div className="bg-slate-800/60 border border-slate-700/60 rounded-2xl p-3.5 space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <div className="text-xs font-bold text-amber-400 flex items-center gap-1.5">
                    <Volume2 className="w-3.5 h-3.5" />
                    <span>ميزة 11: قارئ الرسائل الصوتي الآلي (Arabic TTS Engine)</span>
                  </div>
                  <span className="text-[10px] text-slate-400">سرعة: {ttsSpeed}x</span>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    id="ttsInputSample"
                    placeholder="اكتب أي نص هنا لتجربة القراءة الصوتية الفصحى..."
                    className="flex-1 bg-slate-900 border border-slate-700 rounded-xl px-3 py-1.5 text-xs text-slate-200 placeholder:text-slate-500"
                    defaultValue="مرحباً بكم في شات حسان برو للمحادثات الصوتية والنصية"
                  />
                  <button
                    onClick={() => {
                      const el = document.getElementById('ttsInputSample') as HTMLInputElement;
                      if (el && el.value) handleSendTTS(el.value);
                    }}
                    className="bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold px-3 py-1.5 rounded-xl text-xs flex items-center gap-1"
                  >
                    <Play className="w-3.5 h-3.5" />
                    <span>قراءة</span>
                  </button>
                </div>
              </div>

              {/* 12. Starred & Bookmarked Messages Hub */}
              <div className="bg-slate-800/60 border border-slate-700/60 rounded-2xl p-3.5 space-y-2.5">
                <div className="flex items-center justify-between text-xs">
                  <div className="text-xs font-bold text-amber-400 flex items-center gap-1.5">
                    <Star className="w-3.5 h-3.5" />
                    <span>ميزة 12: مركز الرسائل المميزة والمحفوظة (Bookmarks Hub)</span>
                  </div>
                  <span className="text-[11px] text-slate-400">{effectiveStarredList.length} رسالة محفوظة</span>
                </div>
                <input
                  type="text"
                  value={starredSearchQuery}
                  onChange={(e) => setStarredSearchQuery(e.target.value)}
                  placeholder="بحث في الرسائل المحفوظة..."
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-1.5 text-xs text-slate-200"
                />
                <div className="space-y-1.5 max-h-36 overflow-y-auto">
                  {effectiveStarredList.length === 0 ? (
                    <div className="text-center text-[11px] text-slate-400 py-3">لا توجد رسائل محفوظة في المفضلة حالياً.</div>
                  ) : (
                    effectiveStarredList
                      .filter((m) => !starredSearchQuery || m.text.includes(starredSearchQuery) || m.user.includes(starredSearchQuery))
                      .map((item) => (
                        <div key={item.id} className="bg-slate-900/90 border border-slate-800 p-2 rounded-xl flex items-center justify-between text-xs">
                          <div>
                            <span className="text-amber-400 font-bold ml-1.5">@{item.user}:</span>
                            <span className="text-slate-200">{item.text}</span>
                          </div>
                          <button
                            onClick={() => {
                              if (onToggleStarMessage) {
                                onToggleStarMessage({ id: item.id, username: item.user, text: item.text, time: item.time });
                              } else {
                                setLocalStarredList((prev) => prev.filter((x) => x.id !== item.id));
                              }
                              onShowToast('تمت إزالة الرسالة من المفضلة', 'info');
                            }}
                            className="text-slate-500 hover:text-rose-400 p-1"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                      ))
                  )}
                </div>
              </div>

              {/* 13. Super Reaction Particle Bursts */}
              <div className="bg-slate-800/60 border border-slate-700/60 rounded-2xl p-3.5 space-y-2">
                <div className="text-xs font-bold text-amber-400 flex items-center gap-1.5">
                  <Flame className="w-3.5 h-3.5" />
                  <span>ميزة 13: تفاعلات الشرارات الحية المتفجرة (Reaction Fireworks)</span>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  {['❤️ حب ووفاء', '🔥 حماس مشتعل', '👏 كفو وتصفيق', '👑 حضور ملكي', '🦅 شموخ صقر', '🌹 ورد وتقدير'].map((r, i) => (
                    <button
                      key={i}
                      onClick={() => {
                        confetti({ particleCount: 35, spread: 60 });
                        sounds.playGeneralAlertPing();
                        onShowToast(`أرسلت تفاعل: ${r}`, 'success');
                      }}
                      className="bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-200 px-2.5 py-1.5 rounded-xl text-xs font-bold transition-all hover:scale-105"
                    >
                      {r}
                    </button>
                  ))}
                </div>
              </div>

              {/* 14. Poetry & Rhyme Assistant */}
              <div className="bg-slate-800/60 border border-slate-700/60 rounded-2xl p-3.5 space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <div className="text-xs font-bold text-amber-400 flex items-center gap-1.5">
                    <Feather className="w-3.5 h-3.5" />
                    <span>ميزة 14: مساعد القوافي ونظم الشعر العربي (Poetry Studio)</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="text-[10px] text-slate-400">الروي:</span>
                    <select
                      value={selectedRhymeChar}
                      onChange={(e) => setSelectedRhymeChar(e.target.value)}
                      className="bg-slate-900 text-amber-400 font-bold border border-slate-700 rounded-lg text-xs px-1.5 py-0.5"
                    >
                      {['ر', 'م', 'ل', 'د', 'ن', 'ق', 'ب'].map((c) => (
                        <option key={c} value={c}>قافية الـ ({c})</option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <input
                    type="text"
                    value={firstHemistich}
                    onChange={(e) => setFirstHemistich(e.target.value)}
                    placeholder="الصدر: الشطر الأول من البيت..."
                    className="bg-slate-900 border border-slate-700 rounded-xl px-2.5 py-1.5 text-xs text-slate-200"
                  />
                  <input
                    type="text"
                    value={secondHemistich}
                    onChange={(e) => setSecondHemistich(e.target.value)}
                    placeholder="العجز: الشطر الثاني من البيت..."
                    className="bg-slate-900 border border-slate-700 rounded-xl px-2.5 py-1.5 text-xs text-slate-200"
                  />
                </div>
                <button
                  onClick={handleSendPoetry}
                  className="w-full bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold py-1.5 rounded-xl text-xs flex items-center justify-center gap-1"
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>إرسال البيت الشعري منسقاً إلى الغرفة</span>
                </button>
              </div>

              {/* 15. Royal Text Formatter & Calligraphy Decorator */}
              <div className="bg-slate-800/60 border border-slate-700/60 rounded-2xl p-3.5 space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <div className="text-xs font-bold text-amber-400 flex items-center gap-1.5">
                    <Crown className="w-3.5 h-3.5" />
                    <span>ميزة 15: منسق ومزخرف النصوص الملكية (Calligraphy Ornaments)</span>
                  </div>
                  <div className="flex gap-1">
                    {TEXT_ORNAMENTS.map((orn, idx) => (
                      <button
                        key={orn.id}
                        onClick={() => setSelectedOrnamentIdx(idx)}
                        className={`text-[10px] px-2 py-0.5 rounded-lg font-bold transition-all ${
                          selectedOrnamentIdx === idx ? 'bg-amber-500 text-slate-950' : 'bg-slate-900 text-slate-400'
                        }`}
                      >
                        {orn.name}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={calligraphyInput}
                    onChange={(e) => setCalligraphyInput(e.target.value)}
                    placeholder="اكتب رسالتك لزخرفتها بالطابع الملكي الفخم..."
                    className="flex-1 bg-slate-900 border border-slate-700 rounded-xl px-2.5 py-1.5 text-xs text-slate-200"
                  />
                  <button
                    onClick={handleSendFormattedText}
                    className="bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold px-3 py-1.5 rounded-xl text-xs flex items-center gap-1"
                  >
                    <Send className="w-3 h-3" />
                    <span>إرسال مزخرف</span>
                  </button>
                </div>
                {calligraphyInput && (
                  <div className="text-center p-1.5 bg-slate-950/80 rounded-xl border border-amber-500/30 text-amber-300 font-bold text-xs">
                    {TEXT_ORNAMENTS[selectedOrnamentIdx].format(calligraphyInput)}
                  </div>
                )}
              </div>

              {/* 16. Multilingual Hospitality Phrasebook (Instant Bilingual Greetings) */}
              <div className="bg-slate-800/60 border border-slate-700/60 rounded-2xl p-3.5 space-y-2.5">
                <div className="flex items-center justify-between text-xs">
                  <div className="text-xs font-bold text-amber-400 flex items-center gap-1.5">
                    <Globe className="w-3.5 h-3.5" />
                    <span>ميزة 16: قاموس الترحيب الفوري بعدة لغات للضيوف</span>
                  </div>
                  <select
                    value={targetLang}
                    onChange={(e) => setTargetLang(e.target.value as 'en' | 'fr' | 'ur' | 'tr')}
                    className="bg-slate-900 text-xs border border-slate-700 rounded-lg px-2 py-0.5 text-slate-300"
                  >
                    <option value="en">الإنجليزية (English)</option>
                    <option value="fr">الفرنسية (Français)</option>
                    <option value="ur">الأردية (Urdu)</option>
                    <option value="tr">التركية (Türkçe)</option>
                  </select>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 max-h-40 overflow-y-auto">
                  {MULTILINGUAL_GREETINGS.map((item, idx) => {
                    const trText = item.translations[targetLang];
                    return (
                      <button
                        key={idx}
                        onClick={() => {
                          onSendChatMessage(`🌐 ${item.ar} — ${trText}`);
                          onShowToast('تم إرسال العبارة المترجمة في الشات!', 'success');
                        }}
                        className="bg-slate-900/90 hover:bg-slate-800 border border-slate-800 rounded-xl p-2 text-right transition-colors flex flex-col gap-0.5"
                      >
                        <span className="text-[11px] font-bold text-amber-300">{item.ar}</span>
                        <span className="text-[11px] text-slate-300">{trText}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* 17. Gulf & Arabic Hospitality Phrases */}
              <div className="bg-slate-800/60 border border-slate-700/60 rounded-2xl p-3.5 space-y-2">
                <div className="text-xs font-bold text-amber-400 flex items-center gap-1.5">
                  <MessageSquare className="w-3.5 h-3.5" />
                  <span>ميزة 17: باقة التراحيب والردود الخليجية والعربية الأصيلة</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                  {HOSPITALITY_PHRASES.map((phrase, i) => (
                    <button
                      key={i}
                      onClick={() => {
                        onSendChatMessage(phrase);
                        onShowToast('تم إرسال التحية إلى المجلس 🌹', 'success');
                      }}
                      className="bg-slate-900/80 hover:bg-slate-800 border border-slate-800 text-slate-300 text-right p-2 rounded-xl text-[11px] truncate transition-colors"
                    >
                      {phrase}
                    </button>
                  ))}
                </div>
              </div>

              {/* 18. Rare Arabic Eloquence Lexicon */}
              <div className="bg-slate-800/60 border border-slate-700/60 rounded-2xl p-3.5 space-y-2.5">
                <div className="flex items-center justify-between text-xs">
                  <div className="text-xs font-bold text-amber-400 flex items-center gap-1.5">
                    <BookOpen className="w-3.5 h-3.5" />
                    <span>ميزة 18: معجم الفصاحة وبلاغة الصقور (Arabic Eloquence Lexicon)</span>
                  </div>
                  <span className="text-[10px] text-slate-400">كنوز ودرر لغوية نادرة</span>
                </div>
                <input
                  type="text"
                  value={lexiconQuery}
                  onChange={(e) => setLexiconQuery(e.target.value)}
                  placeholder="ابحث عن كلمة عربية نادرة أو معناها..."
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl px-2.5 py-1.5 text-xs text-slate-200"
                />
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-36 overflow-y-auto">
                  {ARABIC_LEXICON
                    .filter((item) => !lexiconQuery || item.word.includes(lexiconQuery) || item.meaning.includes(lexiconQuery))
                    .map((item, idx) => (
                      <div key={idx} className="bg-slate-900/90 border border-slate-800 p-2 rounded-xl text-xs space-y-1">
                        <div className="flex items-center justify-between">
                          <span className="text-amber-400 font-extrabold">{item.word}</span>
                          <button
                            onClick={() => {
                              onSendChatMessage(`📖 [درة من المعجم]: كلمة "${item.word}" تعني: ${item.meaning}. مثل: "${item.example}"`);
                              onShowToast(`تمت مشاركة كلمة ${item.word} في الشات!`, 'success');
                            }}
                            className="text-[10px] bg-slate-800 hover:bg-slate-700 text-slate-200 px-2 py-0.5 rounded-md"
                          >
                            مشاركة
                          </button>
                        </div>
                        <div className="text-slate-300 text-[11px]">{item.meaning}</div>
                        <div className="text-slate-500 text-[10px] italic">"{item.example}"</div>
                      </div>
                    ))}
                </div>
              </div>

              {/* 19 & 20. Message Scheduler & Chat Export */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="bg-slate-800/60 border border-slate-700/60 rounded-2xl p-3 space-y-2">
                  <div className="text-xs font-bold text-amber-400 flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5" />
                    <span>ميزة 19: جدولة رسائل وتذكير المجلس</span>
                  </div>
                  <input
                    type="text"
                    value={scheduledReminderText}
                    onChange={(e) => setScheduledReminderText(e.target.value)}
                    placeholder="نص التذكير (مثلاً: حان موعد المسابقة)..."
                    className="w-full bg-slate-900 border border-slate-700 rounded-xl px-2.5 py-1 text-xs text-slate-200"
                  />
                  <div className="flex items-center gap-1 text-xs">
                    {[5, 15, 30].map((m) => (
                      <button
                        key={m}
                        onClick={() => setScheduledMinutes(m)}
                        className={`flex-1 py-1 rounded-lg text-[10px] font-bold ${
                          scheduledMinutes === m ? 'bg-amber-500 text-slate-950' : 'bg-slate-900 text-slate-400'
                        }`}
                      >
                        بعد {m} دقيقة
                      </button>
                    ))}
                  </div>
                  <button
                    onClick={() => {
                      const reminderText = scheduledReminderText.trim();
                      if (!reminderText) {
                        onShowToast('يرجى إدخال نص التذكير', 'error');
                        return;
                      }
                      if (reminderTimeoutRef.current) clearTimeout(reminderTimeoutRef.current);
                      reminderTimeoutRef.current = setTimeout(() => {
                        reminderTimeoutRef.current = null;
                        onSendChatMessage(`⏰ [تذكير مجدول]: ${reminderText}`);
                      }, scheduledMinutes * 60 * 1000);
                      onShowToast(`تمت جدولة التذكير للإرسال بعد ${scheduledMinutes} دقيقة!`, 'success');
                      setScheduledReminderText('');
                    }}
                    className="w-full bg-slate-700 hover:bg-slate-700 text-slate-200 font-bold py-1 rounded-xl text-xs"
                  >
                    تأكيد الجدولة
                  </button>
                </div>

                <div className="bg-slate-800/60 border border-slate-700/60 rounded-2xl p-3 space-y-2">
                  <div className="text-xs font-bold text-amber-400 flex items-center gap-1.5">
                    <Download className="w-3.5 h-3.5" />
                    <span>ميزة 20: تصدير المحادثة والنسخ الاحتياطي</span>
                  </div>
                  <p className="text-[11px] text-slate-400">تنزيل كامل مجريات الغرفة كملف نصي موثق</p>
                  <button
                    onClick={handleDownloadChatLog}
                    className="w-full bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold py-1.5 rounded-xl text-xs flex items-center justify-center gap-1 mt-4"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>تنزيل السجل الآن (TXT)</span>
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ================= SECTION 3: ROOM MANAGEMENT (Features 21-30) ================= */}
          {activeTab === 'room' && (
            <div className="space-y-4 animate-fade-in">
              {/* 21. Room Message of the Day / Pinned Topic (synced to server updateRoomDetails) */}
              <div className="bg-slate-800/60 border border-slate-700/60 rounded-2xl p-3.5 space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <div className="text-xs font-bold text-amber-400 flex items-center gap-1.5">
                    <Megaphone className="w-3.5 h-3.5" />
                    <span>ميزة 21: لافتة وموضوع الغرفة المثبت (Room Topic)</span>
                  </div>
                  {isStaffMember && (
                    <button
                      onClick={() => setEditingMotd(!editingMotd)}
                      className="text-[11px] text-amber-400 hover:underline"
                    >
                      {editingMotd ? 'إلغاء التعديل' : 'تعديل الإعلان'}
                    </button>
                  )}
                </div>
                {editingMotd && isStaffMember ? (
                  <div className="space-y-2">
                    <textarea
                      value={roomMotd}
                      onChange={(e) => setRoomMotd(e.target.value)}
                      className="w-full bg-slate-900 border border-slate-700 rounded-xl p-2 text-xs text-slate-200 h-16"
                    />
                    <button
                      onClick={() => {
                        setEditingMotd(false);
                        const roomId = currentRoomObj?.id || currentUser.room;
                        if (socket?.connected && roomId) {
                          socket.emit('updateRoomDetails', { roomId, pinnedTopic: roomMotd.trim() });
                          onShowToast('تم حفظ وتعميم موضوع الغرفة على السيرفر!', 'success');
                        } else {
                          onShowToast('تعذر الاتصال بالخادم لتحديث الموضوع', 'error');
                        }
                      }}
                      className="bg-amber-500 text-slate-950 font-bold px-3 py-1 rounded-xl text-xs"
                    >
                      حفظ ونشر للجميع
                    </button>
                  </div>
                ) : (
                  <div className="bg-gradient-to-r from-amber-950/70 to-slate-900 p-2.5 rounded-xl border border-amber-500/30 text-xs text-amber-200">
                    {pinnedTopic || roomMotd}
                  </div>
                )}
              </div>

              {/* 22. Live Room Activity Heatmap (computed from real messages) */}
              <div className="bg-slate-800/60 border border-slate-700/60 rounded-2xl p-3.5 space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <div className="font-bold text-amber-400 flex items-center gap-1.5">
                    <BarChart2 className="w-3.5 h-3.5" />
                    <span>ميزة 22: توزيع نشاط رسائل الغرفة الفعلي</span>
                  </div>
                  <span className="text-[10px] text-slate-400">{messages.length} رسالة محللة</span>
                </div>
                {messages.length === 0 ? (
                  <div className="text-center text-[11px] text-slate-400 py-3">
                    لا توجد رسائل كافية في الغرفة بعد لحساب ذروة النشاط
                  </div>
                ) : (
                  <div className="grid grid-cols-6 sm:grid-cols-12 gap-1 text-center items-end">
                    {peakHoursBuckets.map((bucket, idx) => (
                      <div key={idx} className="space-y-1" title={`${bucket.label}: ${bucket.count} رسالة`}>
                        <div
                          style={{ height: `${Math.max(4, Math.round(bucket.pct * 0.36))}px` }}
                          className={`w-full rounded-md transition-all ${
                            bucket.pct > 75 ? 'bg-amber-500' : bucket.pct > 35 ? 'bg-amber-600/70' : 'bg-slate-700'
                          }`}
                        />
                        <span className="text-[9px] text-slate-400 block">{bucket.label}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* 23 & 24. Real Server Slow Mode & Room Password Lock */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="bg-slate-800/60 border border-slate-700/60 rounded-2xl p-3 space-y-2">
                  <div className="text-xs font-bold text-amber-400 flex items-center gap-1.5">
                    <Timer className="w-3.5 h-3.5" />
                    <span>ميزة 23: وضع التهدئة الفعلي للغرفة (Slow Mode)</span>
                  </div>
                  <p className="text-[10px] text-slate-400">
                    الحالة الحالية: {activeSlowModeSeconds === 0 ? 'معطل' : `${activeSlowModeSeconds} ثوانٍ بين كل رسالة`}
                  </p>
                  <div className="grid grid-cols-4 gap-1">
                    {[0, 3, 5, 10].map((s) => (
                      <button
                        key={s}
                        onClick={() => {
                          if (!isStaffMember) {
                            onShowToast('هذه الميزة مخصصة لمشرفي وإدارة المجلس فقط!', 'error');
                            return;
                          }
                          if (onAdminAction) {
                            onAdminAction('setSlowMode', '', s);
                          } else {
                            socket?.emit('adminAction', { action: 'setSlowMode', targetUsername: '', value: s });
                          }
                        }}
                        className={`py-1 rounded-lg text-xs font-bold ${
                          activeSlowModeSeconds === s ? 'bg-amber-500 text-slate-950' : 'bg-slate-900 text-slate-400'
                        }`}
                      >
                        {s === 0 ? 'معطل' : `${s} ثوان`}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="bg-slate-800/60 border border-slate-700/60 rounded-2xl p-3 space-y-2">
                  <div className="text-xs font-bold text-amber-400 flex items-center gap-1.5">
                    <Lock className="w-3.5 h-3.5" />
                    <span>ميزة 24: قفل الغرفة الفعلي برمز سري</span>
                  </div>
                  <div className="flex gap-1.5">
                    <input
                      type="password"
                      value={roomPasscode}
                      onChange={(e) => setRoomPasscode(e.target.value)}
                      placeholder={activeIsPasswordProtected ? 'أدخل رمزاً جديداً أو اتركه فارغاً لفك القفل' : 'رمز دخول الغرفة...'}
                      className="flex-1 bg-slate-900 border border-slate-700 rounded-xl px-2.5 py-1 text-xs text-slate-200"
                    />
                    <button
                      onClick={() => {
                        if (!isStaffMember) {
                          onShowToast('هذه الميزة مخصصة لمشرفي وإدارة المجلس فقط!', 'error');
                          return;
                        }
                        const nextPass = activeIsPasswordProtected && !roomPasscode.trim() ? '' : roomPasscode.trim();
                        if (!activeIsPasswordProtected && !nextPass) {
                          onShowToast('يرجى إدخال رمز سري لقفل الغرفة', 'error');
                          return;
                        }
                        if (onAdminAction) {
                          onAdminAction('setRoomPassword', '', nextPass);
                        } else {
                          socket?.emit('adminAction', { action: 'setRoomPassword', targetUsername: '', value: nextPass });
                        }
                        setRoomPasscode('');
                      }}
                      className={`px-3 py-1 rounded-xl text-xs font-bold ${
                        activeIsPasswordProtected ? 'bg-rose-500 text-white' : 'bg-amber-500 text-slate-950'
                      }`}
                    >
                      {activeIsPasswordProtected ? 'فك القفل' : 'قفل الآن'}
                    </button>
                  </div>
                </div>
              </div>

              {/* 25. Live Majlis Poll */}
              <div className="bg-slate-800/60 border border-slate-700/60 rounded-2xl p-3.5 space-y-2.5">
                <div className="flex items-center justify-between text-xs">
                  <div className="text-xs font-bold text-amber-400 flex items-center gap-1.5">
                    <ListOrdered className="w-3.5 h-3.5" />
                    <span>ميزة 25: استطلاع الرأي والتصويت اللحظي للمجلس (Live Majlis Poll)</span>
                  </div>
                  <span className="text-[10px] text-slate-400 font-bold">
                    إجمالي الأصوات: {pollVotes.reduce((a, b) => a + b, 0)}
                  </span>
                </div>
                <div className="text-xs font-bold text-slate-200 bg-slate-900/80 p-2 rounded-xl border border-slate-700">
                  {pollQuestion}
                </div>
                <div className="space-y-1.5 text-xs">
                  {pollOptions.map((opt, idx) => {
                    const total = pollVotes.reduce((a, b) => a + b, 0) || 1;
                    const percent = Math.round((pollVotes[idx] / total) * 100);
                    return (
                      <button
                        key={idx}
                        onClick={() => handleVotePoll(idx)}
                        className={`w-full p-2 rounded-xl border text-right transition-all relative overflow-hidden flex items-center justify-between ${
                          userHasVoted === idx
                            ? 'border-amber-400 bg-amber-500/20 text-amber-200'
                            : 'border-slate-800 bg-slate-900/90 hover:bg-slate-800 text-slate-300'
                        }`}
                      >
                        <div
                          style={{ width: `${percent}%` }}
                          className="absolute inset-y-0 right-0 bg-amber-500/10 -z-0"
                        />
                        <span className="font-bold relative z-10">{opt}</span>
                        <span className="text-[11px] font-mono font-bold text-amber-400 relative z-10">
                          {percent}% ({pollVotes[idx]})
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* 26. Honor & Reputation Leveling System */}
              <div className="bg-gradient-to-r from-amber-950/80 via-slate-900 to-amber-950/80 border border-amber-500/40 rounded-2xl p-3.5 space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2 font-bold text-amber-400">
                    <Crown className="w-4 h-4 text-amber-400" />
                    <span>ميزة 26: نظام رتب الصقور والشرف (Member Honor Level)</span>
                  </div>
                  <span className="text-amber-300 font-extrabold text-xs">المستوى {calculatedLevel}</span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-300 font-bold">{levelTitle}</span>
                  <span className="text-slate-400 font-mono text-[11px]">{currentUser.points} نقطة</span>
                </div>
                <div className="w-full bg-slate-950 h-2 rounded-full overflow-hidden border border-amber-500/30">
                  <div
                    style={{ width: `${Math.min(100, (currentUser.points % 50) * 2)}%` }}
                    className="bg-gradient-to-r from-amber-500 to-amber-300 h-full rounded-full transition-all"
                  />
                </div>
              </div>

              {/* 27. Room Direct Link Share */}
              <div className="bg-slate-800/60 border border-slate-700/60 rounded-2xl p-3.5 space-y-2">
                <div className="text-xs font-bold text-amber-400 flex items-center gap-1.5">
                  <UserPlus className="w-3.5 h-3.5" />
                  <span>ميزة 27: مشاركة رابط الدخول المباشر للشات</span>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    readOnly
                    value={window.location.origin}
                    className="flex-1 bg-slate-900 border border-slate-700 rounded-xl px-2.5 py-1.5 text-xs text-slate-300 font-mono"
                  />
                  <button
                    onClick={() => {
                      const inviteUrl = window.location.origin;
                      navigator.clipboard?.writeText(inviteUrl).then(() => {
                        onShowToast('تم نسخ رابط الشات بنجاح!', 'success');
                      }).catch(() => {
                        onShowToast('تعذر نسخ الرابط تلقائياً — انسخه من الحقل', 'error');
                      });
                    }}
                    className="bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold px-3 py-1.5 rounded-xl text-xs flex items-center gap-1 cursor-pointer"
                  >
                    <Copy className="w-3.5 h-3.5" />
                    <span>نسخ</span>
                  </button>
                </div>
              </div>

              {/* 28. Real Room & Monitor Events Log */}
              <div className="bg-slate-800/60 border border-slate-700/60 rounded-2xl p-3.5 space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <div className="text-xs font-bold text-amber-400 flex items-center gap-1.5">
                    <Activity className="w-3.5 h-3.5" />
                    <span>ميزة 28: سجل أحداث الغرفة المباشر</span>
                  </div>
                  <span className="text-[10px] text-slate-400">
                    {isStaffMember ? `${monitorLogs.length} سجل إداري` : `${messages.length} رسالة بالغرفة`}
                  </span>
                </div>
                <div className="space-y-1 max-h-28 overflow-y-auto">
                  {isStaffMember && monitorLogs.length > 0 ? (
                    monitorLogs.slice(0, 8).map((evt) => (
                      <div key={evt.id} className="flex items-center justify-between bg-slate-900/90 border border-slate-800 px-2.5 py-1.5 rounded-xl text-[11px] gap-2">
                        <span className="text-slate-300 truncate">{evt.description}</span>
                        <span className="text-[10px] text-slate-500 font-mono shrink-0">{evt.time}</span>
                      </div>
                    ))
                  ) : messages.length > 0 ? (
                    messages.slice(-6).reverse().map((m) => (
                      <div key={m.id} className="flex items-center justify-between bg-slate-900/90 border border-slate-800 px-2.5 py-1.5 rounded-xl text-[11px] gap-2">
                        <span className="text-slate-300 truncate">
                          <strong className="text-amber-400 ml-1">{m.displayName || m.username}:</strong>
                          {m.text || 'رسالة وسائط/صوت'}
                        </span>
                        <span className="text-[10px] text-slate-500 font-mono shrink-0">{m.time}</span>
                      </div>
                    ))
                  ) : (
                    <div className="text-center text-[11px] text-slate-400 py-2">لا توجد أحداث مسجلة بعد</div>
                  )}
                </div>
              </div>

              {/* 29. Zen Mute Notifications Mode (wired to soundEffects engine) */}
              <div className="bg-slate-800/60 border border-slate-700/60 rounded-2xl p-3.5 space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <div className="text-xs font-bold text-amber-400 flex items-center gap-1.5">
                    <Compass className="w-3.5 h-3.5" />
                    <span>ميزة 29: وضع الهدوء وكتم أصوات التنبيهات (Zen Mute)</span>
                  </div>
                  <button
                    onClick={() => {
                      const next = !isZenMode;
                      sounds.setMuted(next);
                      setIsZenMode(next);
                      onShowToast(next ? 'تم كتم أصوات الإشعارات والتنبيهات 🧘' : 'تمت إعادة تفعيل أصوات التنبيهات 🔔', 'info');
                    }}
                    className={`px-3 py-1 rounded-xl text-xs font-bold ${
                      isZenMode ? 'bg-emerald-500 text-slate-950' : 'bg-slate-700 text-slate-300'
                    }`}
                  >
                    {isZenMode ? 'مفعل (صامت) ✓' : 'تفعيل الهدوء'}
                  </button>
                </div>
                <p className="text-[11px] text-slate-400">يكتم نغمات الرسائل والدخول والتنبيهات فعلياً أثناء القراءة الهادئة</p>
              </div>

              {/* 30. Majlis Athkar & Prayers Reminder */}
              <div className="bg-slate-800/60 border border-slate-700/60 rounded-2xl p-3.5 space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <div className="text-xs font-bold text-amber-400 flex items-center gap-1.5">
                    <Heart className="w-3.5 h-3.5 text-rose-400" />
                    <span>ميزة 30: مسبحة وأذكار المجلس النيرة (Majlis Athkar & Beads)</span>
                  </div>
                  <span className="text-[10px] text-amber-300 font-mono font-bold">المتبقي: {thikrCounter}</span>
                </div>
                <div className="bg-slate-900/90 border border-slate-700 p-2.5 rounded-xl text-xs text-center text-slate-200 font-bold">
                  {ARABIC_ATHKAR[thikrIdx]}
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      if (thikrCounter > 1) {
                        setThikrCounter((c) => c - 1);
                        sounds.playMentionPing();
                      } else {
                        setThikrCounter(33);
                        setThikrIdx((i) => (i + 1) % ARABIC_ATHKAR.length);
                        confetti({ particleCount: 25, spread: 45 });
                        onAddPoints(10, 'إتمام تسبيح المجلس');
                        onShowToast('ما شاء الله! أتممت الورد بنجاح (+10 نقاط) 🌸', 'success');
                      }
                    }}
                    className="flex-1 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold py-1.5 rounded-xl text-xs flex items-center justify-center gap-1"
                  >
                    <span>تسبيح (اضغط هنا)</span>
                    <span className="bg-slate-950/20 px-1.5 rounded-md text-[10px]">{thikrCounter}</span>
                  </button>
                  <button
                    onClick={handleSendThikrToRoom}
                    className="bg-slate-700 hover:bg-slate-700 text-slate-200 font-bold px-3 py-1.5 rounded-xl text-xs"
                  >
                    مشاركة بالدردشة
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ================= SECTION 4: SECURITY & DIAGNOSTICS (Features 31-40) ================= */}
          {activeTab === 'security' && (
            <div className="space-y-4 animate-fade-in">
              {/* 31. Local Screen Chat Auto-Clear */}
              <div className="bg-slate-800/60 border border-slate-700/60 rounded-2xl p-3.5 space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <div className="text-xs font-bold text-amber-400 flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5" />
                    <span>ميزة 31: تنظيف شاشة الدردشة المحلية (فوري أو مؤقت)</span>
                  </div>
                  {onClearLocalChat && (
                    <button
                      onClick={onClearLocalChat}
                      className="bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 border border-rose-500/30 px-2.5 py-0.5 rounded-lg text-[11px] font-bold"
                    >
                      مسح الشاشة الآن
                    </button>
                  )}
                </div>
                <p className="text-[11px] text-slate-400">ضبط مؤقت لمسح الرسائل المعروضة في شاشتك تلقائياً</p>
                <div className="grid grid-cols-4 gap-1.5">
                  {[
                    { id: 'off', label: 'معطل ✕', ms: 0 },
                    { id: '5m', label: '5 دقائق', ms: 5 * 60 * 1000 },
                    { id: '15m', label: '15 دقيقة', ms: 15 * 60 * 1000 },
                    { id: '30m', label: '30 دقيقة', ms: 30 * 60 * 1000 }
                  ].map((t) => (
                    <button
                      key={t.id}
                      onClick={() => {
                        setEphemeralTimer(t.id as 'off' | '5m' | '15m' | '30m');
                        if (clearScreenTimerRef.current) {
                          clearTimeout(clearScreenTimerRef.current);
                          clearScreenTimerRef.current = null;
                        }
                        if (t.ms > 0 && onClearLocalChat) {
                          clearScreenTimerRef.current = setTimeout(() => {
                            clearScreenTimerRef.current = null;
                            onClearLocalChat();
                            setEphemeralTimer('off');
                          }, t.ms);
                        }
                        onShowToast(`تم ضبط تنظيف الشاشة: ${t.label}`, 'info');
                      }}
                      className={`p-2 rounded-xl text-xs font-bold transition-all ${
                        ephemeralTimer === t.id ? 'bg-amber-500 text-slate-950 shadow-md' : 'bg-slate-900 text-slate-400'
                      }`}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* 32 & 33. Connection Inspector & FPS Profiler */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="bg-slate-800/60 border border-slate-700/60 rounded-2xl p-3 space-y-2">
                  <div className="text-xs font-bold text-amber-400 flex items-center gap-1.5">
                    <Wifi className="w-3.5 h-3.5" />
                    <span>ميزة 32: فاحص سلامة اتصال السوكيت</span>
                  </div>
                  <div className="space-y-1 text-xs">
                    <div className="flex justify-between text-slate-300">
                      <span>حالة الخادم:</span>
                      <span className={`font-mono font-bold ${socket?.connected ? 'text-emerald-400' : 'text-rose-400'}`}>
                        {socket?.connected ? 'Socket.IO متصل' : 'غير متصل'}
                      </span>
                    </div>
                    <div className="flex justify-between text-slate-300">
                      <span>حالة الشبكة:</span>
                      <span className="text-emerald-400 font-bold">{isOnline ? 'متصل بالإنترنت ✓' : 'غير متصل ✕'}</span>
                    </div>
                  </div>
                </div>

                <div className="bg-slate-800/60 border border-slate-700/60 rounded-2xl p-3 space-y-2">
                  <div className="text-xs font-bold text-amber-400 flex items-center gap-1.5">
                    <Activity className="w-3.5 h-3.5" />
                    <span>ميزة 33: محلل أداء الذاكرة ومعدل الإطارات (FPS)</span>
                  </div>
                  <div className="space-y-1 text-xs">
                    <div className="flex justify-between text-slate-300">
                      <span>معدل الإطارات:</span>
                      <span className="font-mono text-emerald-400 font-bold">{liveFps} FPS</span>
                    </div>
                    <div className="flex justify-between text-slate-300">
                      <span>استهلاك الذاكرة التقريبي:</span>
                      <span className="font-mono text-sky-400 font-bold">{estimatedMemoryMb !== null ? `${estimatedMemoryMb} MB` : '--'}</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* 34. Real Word Filter (for Staff) / Ignored List (for Members) */}
              <div className="bg-slate-800/60 border border-slate-700/60 rounded-2xl p-3.5 space-y-2.5">
                <div className="text-xs font-bold text-amber-400 flex items-center gap-1.5">
                  <Shield className="w-3.5 h-3.5" />
                  <span>
                    {isStaffMember
                      ? 'ميزة 34: الكلمات المراقبة في الفلتر الإداري (السيرفر)'
                      : 'ميزة 34: قائمة الأعضاء المتجاهلين لديك'}
                  </span>
                </div>
                {isStaffMember ? (
                  <>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={newBlockedWord}
                        onChange={(e) => setNewBlockedWord(e.target.value)}
                        placeholder="أدخل كلمة لإضافتها لفلتر السيرفر..."
                        className="flex-1 bg-slate-900 border border-slate-700 rounded-xl px-2.5 py-1 text-xs text-slate-200"
                      />
                      <button
                        onClick={() => {
                          const w = newBlockedWord.trim();
                          if (!w) return;
                          socket?.emit('addMonitoredWord', { word: w });
                          setNewBlockedWord('');
                          onShowToast(`تمت إضافة "${w}" لفلتر السيرفر`, 'success');
                        }}
                        className="bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold px-3 py-1 rounded-xl text-xs"
                      >
                        حظر
                      </button>
                    </div>
                    <div className="flex items-center gap-1.5 flex-wrap max-h-24 overflow-y-auto">
                      {monitoredWordsList.length === 0 ? (
                        <span className="text-[11px] text-slate-400">لا توجد كلمات مراقبة حالياً</span>
                      ) : (
                        monitoredWordsList.map((w, i) => (
                          <span key={i} className="bg-rose-500/10 border border-rose-500/30 text-rose-300 text-[11px] px-2 py-0.5 rounded-lg flex items-center gap-1">
                            <span>{w}</span>
                            <button
                              onClick={() => socket?.emit('removeMonitoredWord', { word: w })}
                              className="hover:text-rose-100"
                            >
                              ×
                            </button>
                          </span>
                        ))
                      )}
                    </div>
                  </>
                ) : (
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {ignoredUsers.length === 0 ? (
                      <span className="text-[11px] text-slate-400">لا يوجد أعضاء في قائمة التجاهل الخاصة بك</span>
                    ) : (
                      ignoredUsers.map((u, i) => (
                        <span key={i} className="bg-slate-900 border border-slate-700 text-slate-300 text-[11px] px-2 py-0.5 rounded-lg">
                          @{u}
                        </span>
                      ))
                    )}
                  </div>
                )}
              </div>

              {/* 35. Guests Access Policy & Room Composition */}
              <div className="bg-slate-800/60 border border-slate-700/60 rounded-2xl p-3.5 space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <div className="text-xs font-bold text-amber-400 flex items-center gap-1.5">
                    <UserCheck className="w-3.5 h-3.5" />
                    <span>ميزة 35: إحصائية الحضور وسياسة دخول الزوار</span>
                  </div>
                  {isStaffMember && serverSecurity && (
                    <button
                      onClick={() => {
                        const nextAllowed = !serverSecurity.guestsAllowed;
                        socket?.emit('updateServerSecurity', { guestsAllowed: nextAllowed });
                        onShowToast(nextAllowed ? 'تم السماح بدخول الزوار' : 'تم إغلاق دخول الزوار مؤقتاً', 'info');
                      }}
                      className={`px-3 py-1 rounded-xl text-xs font-bold ${
                        serverSecurity.guestsAllowed ? 'bg-emerald-500 text-slate-950' : 'bg-rose-500 text-white'
                      }`}
                    >
                      {serverSecurity.guestsAllowed ? 'الزوار مسموحون ✓' : 'الزوار ممنوعون ✕'}
                    </button>
                  )}
                </div>
                <div className="grid grid-cols-3 gap-2 text-center text-[11px]">
                  <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-1.5">
                    <div className="text-slate-400">المتصلون بالغرفة</div>
                    <div className="font-bold text-amber-300">{onlineUsers.length}</div>
                  </div>
                  <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-1.5">
                    <div className="text-slate-400">الإدارة</div>
                    <div className="font-bold text-emerald-400">
                      {onlineUsers.filter((u) => u.role === 'hassan' || u.role === 'admin' || u.role === 'super').length}
                    </div>
                  </div>
                  <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-1.5">
                    <div className="text-slate-400">على المايك</div>
                    <div className="font-bold text-sky-400">
                      {micSlots.filter((s) => Boolean(s.user)).length}
                    </div>
                  </div>
                </div>
              </div>

              {/* 36. Client Transport Diagnostics */}
              <div className="bg-slate-800/60 border border-slate-700/60 rounded-2xl p-3.5 space-y-2">
                <div className="text-xs font-bold text-amber-400 flex items-center gap-1.5">
                  <Shield className="w-3.5 h-3.5" />
                  <span>ميزة 36: معلومات اتصال المتصفح والبروتوكول</span>
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="bg-slate-900/90 border border-slate-800 p-2 rounded-xl">
                    <span className="text-slate-400 block text-[10px]">بروتوكول الاتصال:</span>
                    <span className="text-emerald-400 font-mono font-bold">{securityAuditInfo.protocol}</span>
                  </div>
                  <div className="bg-slate-900/90 border border-slate-800 p-2 rounded-xl">
                    <span className="text-slate-400 block text-[10px]">نظام العميل:</span>
                    <span className="text-slate-200 font-bold">{securityAuditInfo.os}</span>
                  </div>
                </div>
              </div>

              {/* 37. Real Server Anti-Flood Limiter */}
              <div className="bg-slate-800/60 border border-slate-700/60 rounded-2xl p-3.5 space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <div className="text-xs font-bold text-amber-400 flex items-center gap-1.5">
                    <Zap className="w-3.5 h-3.5" />
                    <span>ميزة 37: درع السيرفر لمنع التكرار (Flood Control)</span>
                  </div>
                  <span className="text-[11px] font-bold text-emerald-400">
                    {serverSecurity ? `حد السيرفر: ${serverSecurity.floodControlRate} ثوانٍ` : 'نشط'}
                  </span>
                </div>
                {isStaffMember && serverSecurity && (
                  <div className="flex items-center justify-between text-xs text-slate-300">
                    <span>الفاصل الزمني بين الرسائل:</span>
                    <div className="flex gap-1">
                      {[1, 3, 5].map((sec) => (
                        <button
                          key={sec}
                          onClick={() => {
                            socket?.emit('updateServerSecurity', { floodControlRate: sec });
                            onShowToast(`تم ضبط منع التكرار على السيرفر إلى ${sec} ثوانٍ`, 'info');
                          }}
                          className={`px-2 py-0.5 rounded text-[11px] font-bold ${
                            serverSecurity.floodControlRate === sec ? 'bg-amber-500 text-slate-950' : 'bg-slate-900 text-slate-400'
                          }`}
                        >
                          {sec} ث
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* 38. Data Privacy Shield & Footprint Cleaner */}
              <div className="bg-slate-800/60 border border-slate-700/60 rounded-2xl p-3.5 space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <div className="text-xs font-bold text-amber-400 flex items-center gap-1.5">
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>ميزة 38: مسح البيانات المؤقتة من المتصفح</span>
                  </div>
                  <button
                    onClick={handleClearPrivacyFootprint}
                    className="bg-rose-500 hover:bg-rose-400 text-white font-bold px-3 py-1 rounded-xl text-xs flex items-center gap-1"
                  >
                    <Trash2 className="w-3 h-3" />
                    <span>مسح المؤقت الآن</span>
                  </button>
                </div>
                <p className="text-[11px] text-slate-400">
                  تنظيف مسودات الجلسة وبيانات sessionStorage المؤقتة في المتصفح
                </p>
                {privacyCleared && (
                  <div className="text-xs text-emerald-300 font-bold bg-emerald-500/10 border border-emerald-500/30 p-1.5 rounded-xl text-center">
                    تم تنظيف البيانات المؤقتة بنجاح ✓
                  </div>
                )}
              </div>

              {/* 39. Real Emergency Lockdown Panic Switch */}
              <div className="bg-gradient-to-r from-rose-950/70 to-slate-900 border border-rose-500/40 rounded-2xl p-3.5 space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <div className="text-xs font-bold text-rose-400 flex items-center gap-1.5">
                    <AlertTriangle className="w-4 h-4 text-rose-400" />
                    <span>ميزة 39: زر الطوارئ وقفل السيرفر الفوري (Panic Switch)</span>
                  </div>
                  <button
                    onClick={handleEmergencyLockdownToggle}
                    className={`px-3 py-1.5 rounded-xl text-xs font-extrabold transition-all ${
                      serverSecurity?.emergencyLockdown
                        ? 'bg-emerald-500 text-slate-950 shadow-lg animate-pulse'
                        : 'bg-rose-600 hover:bg-rose-500 text-white'
                    }`}
                  >
                    {serverSecurity?.emergencyLockdown ? 'إلغاء وضع الطوارئ ✓' : 'تفعيل الطوارئ 🚨'}
                  </button>
                </div>
                <p className="text-[11px] text-rose-200/80">
                  مربوط مباشرة بالسيرفر: يوقف الدردشة العامة في حالات الطوارئ للمشرفين والإدارة
                </p>
              </div>

              {/* 40. Quick Account Password Update */}
              <div className="bg-slate-800/60 border border-slate-700/60 rounded-2xl p-3.5 space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <div className="text-xs font-bold text-amber-400 flex items-center gap-1.5">
                    <Key className="w-3.5 h-3.5" />
                    <span>ميزة 40: تغيير كلمة مرور الحساب السريع</span>
                  </div>
                  <span className="text-[10px] text-slate-400">
                    {currentUser.role === 'guest' ? 'للحسابات المسجلة فقط' : 'مربوط بالسيرفر 🔒'}
                  </span>
                </div>
                <div className="flex gap-2">
                  <input
                    type="password"
                    value={quickNewPassword}
                    onChange={(e) => setQuickNewPassword(e.target.value)}
                    placeholder="كلمة المرور الجديدة (3 أحرف على الأقل)..."
                    className="flex-1 bg-slate-900 border border-slate-700 rounded-xl px-2.5 py-1 text-xs text-slate-200 text-center"
                  />
                  <button
                    onClick={() => {
                      if (currentUser.role === 'guest') {
                        onShowToast('الزوار لا يملكون كلمة مرور — سجل عضويتك أولاً', 'error');
                        return;
                      }
                      const clean = quickNewPassword.trim();
                      if (clean.length < 3) {
                        onShowToast('يجب أن تتكون كلمة المرور من 3 أحرف على الأقل', 'error');
                        return;
                      }
                      socket?.emit('updateProfile', { password: clean });
                      setQuickNewPassword('');
                      sounds.playGeneralAlertPing();
                      onShowToast('تم إرسال تحديث كلمة المرور للسيرفر بنجاح 🛡️', 'success');
                    }}
                    className="bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold px-3 py-1 rounded-xl text-xs"
                  >
                    حفظ
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ================= SECTION 5: GAMIFICATION & GIFTS (Features 41-50) ================= */}
          {activeTab === 'gamification' && (
            <div className="space-y-4 animate-fade-in">
              {/* 41. Falcon Fortune Wheel */}
              <div className="bg-gradient-to-r from-amber-950/80 via-slate-900 to-amber-950/80 border border-amber-500/40 rounded-2xl p-3.5 space-y-3 text-center">
                <div className="text-xs font-bold text-amber-400 flex items-center justify-center gap-1.5">
                  <Sparkles className="w-4 h-4 text-amber-400 animate-spin" />
                  <span>ميزة 41: عجلة صقور الحظ اليومية (Falcon Fortune Wheel)</span>
                </div>
                <div className="relative w-36 h-36 mx-auto my-2 flex items-center justify-center">
                  <div
                    style={{ transform: `rotate(${wheelRotation}deg)`, transition: isSpinningWheel ? 'transform 3s cubic-bezier(0.17, 0.67, 0.12, 0.99)' : 'none' }}
                    className="w-full h-full rounded-full border-4 border-amber-500/60 shadow-2xl flex items-center justify-center bg-gradient-to-tr from-amber-600 to-amber-900 overflow-hidden"
                  >
                    <span className="text-3xl">🦅</span>
                  </div>
                  <div className="absolute -top-1 left-1/2 -translate-x-1/2 text-amber-300 text-lg">▼</div>
                </div>
                {wheelWinMessage && (
                  <div className="text-xs font-extrabold text-amber-300 bg-amber-500/20 py-1.5 px-3 rounded-xl border border-amber-500/40 inline-block animate-bounce">
                    {wheelWinMessage}
                  </div>
                )}
                <div>
                  <button
                    disabled={isSpinningWheel}
                    onClick={handleSpinWheel}
                    className="bg-gradient-to-r from-amber-500 to-amber-400 hover:from-amber-400 hover:to-amber-300 text-slate-950 font-extrabold px-6 py-2 rounded-2xl text-xs shadow-lg transition-all active:scale-95 disabled:opacity-50"
                  >
                    {isSpinningWheel ? 'جاري دوران العجلة...' : 'تدوير العجلة الآن 🎲'}
                  </button>
                </div>
              </div>

              {/* 42. Islamic & Cultural Arabic Trivia Quiz */}
              <div className="bg-slate-800/60 border border-slate-700/60 rounded-2xl p-3.5 space-y-2.5">
                <div className="flex items-center justify-between text-xs">
                  <div className="text-xs font-bold text-amber-400 flex items-center gap-1.5">
                    <HelpCircle className="w-3.5 h-3.5" />
                    <span>ميزة 42: مسابقة المعرفة والثقافة العربية (Trivia Quiz)</span>
                  </div>
                  <span className="text-amber-400 font-bold">النقاط: {triviaScore}</span>
                </div>
                <div className="bg-slate-900 p-2.5 rounded-xl border border-slate-700 text-xs font-semibold text-slate-200">
                  {ARABIC_TRIVIA[triviaIdx].q}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 text-xs">
                  {shuffledArabicTrivia.map((opt, i) => (
                    <button
                      key={i}
                      disabled={selectedTriviaOption !== null}
                      onClick={() => {
                        setSelectedTriviaOption(i);
                        if (opt.isCorrect) {
                          setTriviaScore((prev) => prev + 10);
                          onAddPoints(10, 'إجابة صحيحة في مسابقة الثقافة');
                          confetti({ particleCount: 30, spread: 50 });
                          sounds.playGeneralAlertPing();
                          onShowToast('إجابة صحيحة وممتازة! +10 نقاط 👏', 'success');
                        } else {
                          onShowToast('إجابة غير صحيحة، حاول في السؤال القادم', 'error');
                        }
                        if (triviaTimeoutRef.current) clearTimeout(triviaTimeoutRef.current);
                        triviaTimeoutRef.current = setTimeout(() => {
                          triviaTimeoutRef.current = null;
                          setSelectedTriviaOption(null);
                          setTriviaIdx((prev) => (prev + 1) % ARABIC_TRIVIA.length);
                        }, 1800);
                      }}
                      className={`p-2 rounded-xl text-right font-medium transition-all ${
                        selectedTriviaOption !== null
                          ? opt.isCorrect
                            ? 'bg-emerald-500 text-slate-950 font-bold'
                            : selectedTriviaOption === i
                            ? 'bg-rose-500 text-white'
                            : 'bg-slate-900/60 text-slate-400 border border-slate-800'
                          : 'bg-slate-900/80 hover:bg-slate-800 text-slate-300 border border-slate-800'
                      }`}
                    >
                      {opt.text}
                    </button>
                  ))}
                </div>
              </div>

              {/* 43. Guess the Arabic Proverb */}
              <div className="bg-slate-800/60 border border-slate-700/60 rounded-2xl p-3.5 space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <div className="text-xs font-bold text-amber-400 flex items-center gap-1.5">
                    <BookOpen className="w-3.5 h-3.5" />
                    <span>ميزة 43: لعبة أكمل المثل الشعبي المأثور</span>
                  </div>
                  <span className="text-[10px] text-slate-400">تلميح: {ARABIC_PROVERBS[proverbIdx].hint}</span>
                </div>
                <div className="bg-slate-900 p-2.5 rounded-xl border border-slate-700 text-xs text-slate-200">
                  <span className="font-bold text-amber-400 ml-1">المثل:</span>
                  "{ARABIC_PROVERBS[proverbIdx].prefix} [ ... ]"
                </div>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={userProverbInput}
                    onChange={(e) => setUserProverbInput(e.target.value)}
                    placeholder="اكتب الكلمة الناقصة..."
                    className="flex-1 bg-slate-900 border border-slate-700 rounded-xl px-2.5 py-1 text-xs text-slate-200"
                  />
                  <button
                    onClick={() => {
                      if (userProverbInput.trim() === ARABIC_PROVERBS[proverbIdx].word) {
                        setProverbSolved(true);
                        onAddPoints(15, 'حل لغز المثل الشعبي');
                        confetti({ particleCount: 35, spread: 60 });
                        onShowToast('أحسنت! الإجابة صحيحة تماماً (+15 نقطة) 👏', 'success');
                        if (proverbTimeoutRef.current) clearTimeout(proverbTimeoutRef.current);
                        proverbTimeoutRef.current = setTimeout(() => {
                          proverbTimeoutRef.current = null;
                          setProverbSolved(false);
                          setUserProverbInput('');
                          setProverbIdx((prev) => (prev + 1) % ARABIC_PROVERBS.length);
                        }, 2000);
                      } else {
                        onShowToast('الكلمة غير صحيحة، ركز في التلميح!', 'error');
                      }
                    }}
                    className="bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold px-3 py-1 rounded-xl text-xs"
                  >
                    تخمين
                  </button>
                </div>
              </div>

              {/* 44. Virtual Gifts Showcase */}
              <div className="bg-slate-800/60 border border-slate-700/60 rounded-2xl p-3.5 space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <div className="text-xs font-bold text-amber-400 flex items-center gap-1.5">
                    <Gift className="w-3.5 h-3.5" />
                    <span>ميزة 44: الهدايا الملكية الفاخرة (Royal Arab Gifts)</span>
                  </div>
                  <span className="text-[11px] text-slate-400">رصيدك: {currentUser.points} نقطة</span>
                </div>
                <select
                  value={selectedGiftRecipient}
                  onChange={(e) => setSelectedGiftRecipient(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 text-xs rounded-xl p-1.5 text-slate-200"
                >
                  <option value="">اختر العضو المستلم للهدية</option>
                  {onlineUsers.filter((u) => u.username !== currentUser.username).map((u) => (
                    <option key={u.id} value={u.username}>{u.displayName || u.username}</option>
                  ))}
                </select>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {VIRTUAL_GIFTS.map((g) => (
                    <button
                      key={g.id}
                      onClick={() => handleSendGift(g)}
                      className="bg-slate-900/80 hover:bg-slate-800 border border-slate-800 p-2.5 rounded-2xl text-center space-y-1 transition-all hover:scale-105"
                    >
                      <div className="text-2xl">{g.icon}</div>
                      <div className="text-xs font-bold text-slate-200">{g.name}</div>
                      <div className="text-[10px] text-amber-400 font-mono font-bold">{g.cost} نقطة</div>
                    </button>
                  ))}
                </div>
              </div>

              {/* 45 & 46. Points Transfer & User Mood Status */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="bg-slate-800/60 border border-slate-700/60 rounded-2xl p-3 space-y-2">
                  <div className="text-xs font-bold text-amber-400 flex items-center gap-1.5">
                    <Zap className="w-3.5 h-3.5" />
                    <span>ميزة 45: تحويل وإهداء النقاط بين الأعضاء</span>
                  </div>
                  <select
                    value={transferTargetUser}
                    onChange={(e) => setTransferTargetUser(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 text-xs rounded-xl p-1.5 text-slate-200"
                  >
                    <option value="">اختر العضو المستلم</option>
                    {onlineUsers.filter((u) => u.username !== currentUser.username).map((u) => (
                      <option key={u.id} value={u.username}>{u.displayName || u.username}</option>
                    ))}
                  </select>
                  <div className="flex gap-2">
                    <input
                      type="number"
                      min="1"
                      value={transferPointsAmount}
                      onChange={(e) => setTransferPointsAmount(parseInt(e.target.value) || 1)}
                      className="w-20 bg-slate-900 border border-slate-700 text-xs rounded-xl p-1 text-center text-amber-400 font-bold"
                    />
                    <button
                      onClick={handleTransferPoints}
                      className="flex-1 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold py-1 rounded-xl text-xs"
                    >
                      تحويل النقاط الآن
                    </button>
                  </div>
                </div>

                <div className="bg-slate-800/60 border border-slate-700/60 rounded-2xl p-3 space-y-2">
                  <div className="text-xs font-bold text-amber-400 flex items-center gap-1.5">
                    <Smile className="w-3.5 h-3.5" />
                    <span>ميزة 46: حالة المزاج والرمز التعبيري</span>
                  </div>
                  <select
                    value={activeMood}
                    onChange={(e) => {
                      setActiveMood(e.target.value);
                      onSendChatMessage(`✨ غير [${currentUser.displayName || currentUser.username}] حالته إلى: ${e.target.value}`);
                      onShowToast(`تم تحديث حالتك إلى: ${e.target.value}`, 'success');
                    }}
                    className="w-full bg-slate-900 border border-slate-700 text-xs rounded-xl p-1.5 text-slate-200"
                  >
                    {USER_MOODS.map((m, idx) => (
                      <option key={idx} value={`${m.text} ${m.emoji}`}>{m.emoji} {m.text}</option>
                    ))}
                  </select>
                  <div className="text-center text-xs text-amber-300 font-bold bg-slate-900/60 p-1.5 rounded-xl border border-slate-800">
                    الحالة الحالية: {activeMood}
                  </div>
                </div>
              </div>

              {/* 47. Soundboard SFX */}
              <div className="bg-slate-800/60 border border-slate-700/60 rounded-2xl p-3.5 space-y-2">
                <div className="text-xs font-bold text-amber-400 flex items-center gap-1.5">
                  <Volume2 className="w-3.5 h-3.5" />
                  <span>ميزة 47: لوحة المؤثرات الصوتية الفورية (Audio Soundboard)</span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-1.5">
                  {SOUNDBOARD_ITEMS.map((s) => (
                    <button
                      key={s.id}
                      onClick={() => handlePlaySoundboard(s)}
                      className="bg-slate-900/90 hover:bg-slate-800 border border-slate-800 p-2 rounded-xl text-center text-xs text-slate-200 font-bold transition-all hover:scale-105"
                    >
                      {s.name}
                    </button>
                  ))}
                </div>
              </div>

              {/* 48. Daily Arab Wisdoms Dispenser */}
              <div className="bg-slate-800/60 border border-slate-700/60 rounded-2xl p-3.5 space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <div className="text-xs font-bold text-amber-400 flex items-center gap-1.5">
                    <Feather className="w-3.5 h-3.5" />
                    <span>ميزة 48: بنك روائع الحكم والشعر العربي (Arab Wisdom Dispenser)</span>
                  </div>
                  <span className="text-[10px] text-amber-300 font-bold">{ARABIC_WISDOMS[wisdomIdx].author}</span>
                </div>
                <div className="bg-slate-900/90 border border-slate-700 p-2.5 rounded-xl text-xs text-amber-200 font-semibold text-center italic">
                  "{ARABIC_WISDOMS[wisdomIdx].text}"
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => setWisdomIdx((prev) => (prev + 1) % ARABIC_WISDOMS.length)}
                    className="flex-1 bg-slate-700 hover:bg-slate-700 text-slate-200 font-bold py-1.5 rounded-xl text-xs"
                  >
                    حكمة أخرى ↻
                  </button>
                  <button
                    onClick={handleShareDailyWisdom}
                    className="bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold px-4 py-1.5 rounded-xl text-xs flex items-center gap-1"
                  >
                    <Send className="w-3 h-3" />
                    <span>مشاركة في المجلس</span>
                  </button>
                </div>
              </div>

              {/* 49. Live Rank & Points Progress Calculator */}
              <div className="bg-gradient-to-r from-amber-950/70 via-slate-900 to-amber-950/70 border border-amber-500/40 rounded-2xl p-3.5 space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <div className="text-xs font-bold text-amber-400 flex items-center gap-1.5">
                    <Zap className="w-3.5 h-3.5" />
                    <span>ميزة 49: حاسبة الترقية للمستوى التالي</span>
                  </div>
                  <span className="text-xs font-extrabold text-amber-300 font-mono">
                    المستوى الحالي: {calculatedLevel}
                  </span>
                </div>
                <div className="flex items-center justify-between text-xs text-slate-300">
                  <span>النقاط المتبقية للمستوى {calculatedLevel + 1}:</span>
                  <span className="font-mono font-bold text-amber-400">
                    {50 - (currentUser.points % 50)} نقطة
                  </span>
                </div>
              </div>

              {/* 50. Live Room Top Leaderboard */}
              <div className="bg-slate-800/60 border border-slate-700/60 rounded-2xl p-3.5 space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <div className="text-xs font-bold text-amber-400 flex items-center gap-1.5">
                    <Crown className="w-3.5 h-3.5 text-yellow-400" />
                    <span>ميزة 50: صدارة نقاط المتواجدين حالياً</span>
                  </div>
                  <span className="text-[10px] text-slate-400">حسب النقاط الحقيقية</span>
                </div>
                <div className="space-y-1 max-h-36 overflow-y-auto">
                  {liveLeaderboard.length === 0 ? (
                    <div className="text-center text-[11px] text-slate-400 py-3">لا يوجد متواجدون في القائمة حالياً</div>
                  ) : (
                    liveLeaderboard.map((falcon) => (
                      <div
                        key={falcon.rank}
                        className="bg-slate-900/90 border border-slate-800 p-2 rounded-xl flex items-center justify-between text-xs hover:border-amber-500/40 transition-all"
                      >
                        <div className="flex items-center gap-2">
                          <span className="text-sm">{falcon.badge}</span>
                          <div>
                            <div className="font-extrabold text-slate-200">{falcon.name}</div>
                            <div className="text-[10px] text-amber-400/90">{falcon.title}</div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="font-mono font-bold text-amber-300 text-xs">{falcon.pts} نقطة</span>
                          <button
                            onClick={() => {
                              confetti({ particleCount: 20, spread: 40 });
                              sounds.playMentionPing();
                              onShowToast(`أرسلت تحية وتشجيع إلى ${falcon.name}! 👏`, 'success');
                            }}
                            className="text-[10px] bg-slate-800 hover:bg-amber-500 hover:text-slate-950 text-slate-300 px-2 py-1 rounded-lg font-bold transition-all"
                          >
                            تحية 👏
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          )}

        </div>

        {/* Footer */}
        <div className="bg-slate-950 border-t border-slate-800 p-3 flex items-center justify-between text-xs text-slate-400">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span>نظام حسان برو الفائق • 50 ميزة متكاملة</span>
          </div>
          <button
            onClick={onClose}
            className="bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold px-4 py-1.5 rounded-xl transition-all"
          >
            إغلاق الترسانة
          </button>
        </div>

      </div>
    </div>
  );
};
