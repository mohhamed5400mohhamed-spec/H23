import React, { useState, useRef, useEffect } from 'react';
import {
  Award,
  Sparkles,
  Flame,
  Crown,
  Heart,
  Star,
  Shield,
  Palette,
  Check,
  Calendar,
  Gift,
  Smile,
  Users,
  Copy,
  UserCheck,
  Zap,
  TrendingUp,
  X,
  ChevronLeft,
  ChevronRight
} from 'lucide-react';
import confetti from '../utils/confetti';
import {
  AVATAR_FRAME_PRESETS,
  DEFAULT_MEMBERSHIP_DESIGN_CATALOG,
  type MembershipDesignCatalog
} from '../constants/membershipDesigns';
import { AvatarWithFrame } from './AvatarWithFrame';
import { DEFAULT_AVATAR_SVG } from '../utils/avatarConstants';

export interface IdentityProfileStudioProps {
  isOpen: boolean;
  onClose: () => void;
  currentUser: {
    id: string;
    username: string;
    displayName?: string;
    role: string;
    likes: number;
    points: number;
    statusQuote: string;
    avatarUrl?: string;
    flag: string;
    room?: string;
  };
  activeFrame: string;
  onChangeFrame: (frame: string) => void;
  userMood: string;
  onChangeMood: (mood: string) => void;
  nameGradient: string;
  onChangeNameGradient: (gradient: string) => void;
  onUpdateStatusQuote: (quote: string) => void;
  onAddPoints: (amount: number, reason: string) => void;
  onShowToast: (msg: string, type?: 'info' | 'success' | 'error') => void;
  socket?: any;
  friends?: string[];
  onUpdateFriends?: (friends: string[]) => void;
  designCatalog?: MembershipDesignCatalog;
}

export const IdentityProfileStudio: React.FC<IdentityProfileStudioProps> = ({
  isOpen,
  onClose,
  currentUser,
  activeFrame,
  onChangeFrame,
  userMood,
  onChangeMood,
  nameGradient,
  onChangeNameGradient,
  onUpdateStatusQuote,
  onAddPoints,
  onShowToast,
  socket,
  friends,
  onUpdateFriends,
  designCatalog = DEFAULT_MEMBERSHIP_DESIGN_CATALOG
}) => {
  const [activeTab, setActiveTab] = useState<'frames' | 'mood' | 'name' | 'badges' | 'streak' | 'friends'>('frames');
  const [newQuote, setNewQuote] = useState(currentUser.statusQuote || '');
  const [dailyStreakDay, setDailyStreakDay] = useState(1);
  const [streakClaimedToday, setStreakClaimedToday] = useState(false);
  const tabsContainerRef = useRef<HTMLDivElement>(null);

  const scrollTabs = (direction: 'left' | 'right') => {
    if (tabsContainerRef.current) {
      const offset = direction === 'left' ? -160 : 160;
      tabsContainerRef.current.scrollBy({ left: offset, behavior: 'smooth' });
    }
  };

  // VIP Friends persisted per user / synced with parent & server
  const [friendsList, setFriendsList] = useState<string[]>(() => Array.isArray(friends) ? friends : []);
  const [friendNameInput, setFriendNameInput] = useState('');
  const [isClaimingDaily, setIsClaimingDaily] = useState(false);

  useEffect(() => {
    setNewQuote(currentUser.statusQuote || '');
  }, [currentUser.statusQuote]);

  useEffect(() => {
    if (Array.isArray(friends)) {
      setFriendsList(friends);
    }
  }, [friends]);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onClose]);

  useEffect(() => {
    if (!socket) return;
    const handleDailyResult = (res: { ok?: boolean; claimedToday?: boolean; streak?: number; points?: number; reward?: number; message?: string }) => {
      setIsClaimingDaily(false);
      if (!res) return;
      if (typeof res.streak === 'number') {
        setDailyStreakDay(Math.max(1, Math.min(7, res.streak)));
      }
      if (res.claimedToday || res.ok) {
        setStreakClaimedToday(true);
        try {
          const todayKey = new Date().toISOString().slice(0, 10);
          localStorage.setItem(
            `soqoor_streak_${currentUser.username}`,
            JSON.stringify({ day: res.streak || dailyStreakDay, lastClaimDate: todayKey })
          );
        } catch {}
      }
      if (res.ok) {
        confetti({ particleCount: 90, spread: 65 });
        onShowToast(res.message || `مبروك! استلمت مكافأة اليوم (+${res.reward || 25} نقطة) 🎁`, 'success');
      } else if (res.message) {
        onShowToast(res.message, 'info');
      }
    };
    socket.on('dailyRewardResult', handleDailyResult);
    return () => {
      socket.off('dailyRewardResult', handleDailyResult);
    };
  }, [socket, currentUser.username, dailyStreakDay, onShowToast]);

  useEffect(() => {
    const uname = (currentUser.username || '').trim();
    if (!uname) return;
    const todayKey = new Date().toISOString().slice(0, 10);
    try {
      const rawStreak = localStorage.getItem(`soqoor_streak_${uname}`);
      if (rawStreak) {
        const parsed = JSON.parse(rawStreak);
        if (parsed && parsed.lastClaimDate === todayKey) {
          setDailyStreakDay(Math.max(1, Math.min(7, Number(parsed.day) || 1)));
          setStreakClaimedToday(true);
        } else if (parsed && typeof parsed.day === 'number') {
          setDailyStreakDay((parsed.day % 7) + 1);
          setStreakClaimedToday(false);
        } else {
          setDailyStreakDay(1);
          setStreakClaimedToday(false);
        }
      } else {
        setDailyStreakDay(1);
        setStreakClaimedToday(false);
      }
    } catch {
      setDailyStreakDay(1);
      setStreakClaimedToday(false);
    }

    if (Array.isArray(friends)) return;
    try {
      const rawFriends = localStorage.getItem(`soqoor_friends_${uname}`);
      if (rawFriends) {
        const parsedFriends = JSON.parse(rawFriends);
        if (Array.isArray(parsedFriends)) {
          setFriendsList(parsedFriends.filter((f): f is string => typeof f === 'string'));
          return;
        }
      }
    } catch {}
    setFriendsList([]);
  }, [currentUser.username, friends]);

  const [studioFrameFilter, setStudioFrameFilter] = useState<'all' | 'animated' | 'static'>('all');

  // Calculate Level based on points
  const userLevel = Math.max(1, Math.floor(currentUser.points / 100) + 1);
  const nextLevelPoints = userLevel * 100;
  const currentLevelProgress = currentUser.points % 100;

  const deletedPresetSet = new Set(designCatalog?.deletedPresetFrameIds || []);
  const customCatalogFrames = Array.isArray(designCatalog?.customFrames) ? designCatalog.customFrames : [];
  const availablePresetFrames = AVATAR_FRAME_PRESETS.filter((f) => !deletedPresetSet.has(f.id));

  const filteredCustomFrames = customCatalogFrames.filter((f) => {
    if (studioFrameFilter === 'animated') return Boolean(f.animated);
    if (studioFrameFilter === 'static') return !f.animated;
    return true;
  });

  const filteredStudioFrames = availablePresetFrames.filter((f) => {
    if (studioFrameFilter === 'animated') return f.animated;
    if (studioFrameFilter === 'static') return !f.animated;
    return true;
  });

  // Moods
  const MOODS = [
    { id: 'مروق قهوة ☕', icon: '☕', label: 'مروق قهوة عربية' },
    { id: 'في صيد صقور 🦅', icon: '🦅', label: 'في صيد ومقناص' },
    { id: 'يستمع للشعر 📜', icon: '📜', label: 'يستمع للقصائد' },
    { id: 'شاعر المجلس ✍️', icon: '✍️', label: 'شاعر وكاتب خواطر' },
    { id: 'ملك الساحة 👑', icon: '👑', label: 'ملك الساحة' },
    { id: 'طاقة ونشاط 🔥', icon: '🔥', label: 'شعلة نشاط وحماس' },
    { id: 'مستمع هادئ 🎧', icon: '🎧', label: 'مستمع في الصمت' },
    { id: 'سهران ومستانس 🌙', icon: '🌙', label: 'سهرة وسعادة' },
  ];

  // Name Gradients
  const GRADIENTS = [
    { id: 'from-amber-400 to-yellow-200', name: 'الذهب الخالص', preview: 'bg-gradient-to-r from-amber-400 to-yellow-200' },
    { id: 'from-rose-400 to-amber-300', name: 'الياقوت والغروب', preview: 'bg-gradient-to-r from-rose-400 to-amber-300' },
    { id: 'from-emerald-400 to-teal-200', name: 'الزمرد الملكي', preview: 'bg-gradient-to-r from-emerald-400 to-teal-200' },
    { id: 'from-cyan-400 to-blue-400', name: 'أمواج الخليج', preview: 'bg-gradient-to-r from-cyan-400 to-blue-400' },
    { id: 'from-purple-400 to-pink-400', name: 'الشفق البنفسجي', preview: 'bg-gradient-to-r from-purple-400 to-pink-400' },
    { id: 'from-white to-slate-300', name: 'الفضي النقي', preview: 'bg-gradient-to-r from-white to-slate-300' },
  ];

  // Honor Badges Collection
  const BADGES = [
    { id: 'falcon-crest', title: 'صقر حسان برو الأصيل', icon: '🦅', desc: 'شارة الفخر والانتماء لحسان برو', unlocked: true },
    { id: 'poet', title: 'شاعر المجلس', icon: '📜', desc: 'أبدع بأبيات وقصائد راقية', unlocked: currentUser.points >= 50 },
    { id: 'generous', title: 'كريم الدار (داعم)', icon: '💎', desc: 'أرسل أكثر من 10 هدايا للأعضاء', unlocked: currentUser.likes >= 10 },
    { id: 'night-owl', title: 'فارس السهر', icon: '🌙', desc: 'تواجد أكثر من 50 ساعة تفاعل', unlocked: true },
    { id: 'knight', title: 'فارس الأخلاق', icon: '🛡️', desc: 'سجل أمني ناصع بدون أي مخالفة', unlocked: true },
    { id: 'legend', title: 'أسطورة الشات', icon: '👑', desc: 'تجاوز المستوى 10 وجمع آلاف النقاط', unlocked: userLevel >= 10 }
  ];

  const handleClaimDailyReward = () => {
    if (streakClaimedToday || isClaimingDaily) return;
    if (socket?.connected) {
      setIsClaimingDaily(true);
      socket.emit('claimDailyLoginReward');
      return;
    }
    onShowToast('يرجى الاتصال بالخادم أولاً لاستلام المكافأة اليومية', 'error');
  };

  const handleAddFriend = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = friendNameInput.trim();
    if (!trimmed) return;
    if (trimmed === currentUser.username) {
      onShowToast('لا يمكنك إضافة نفسك إلى قائمة الأصدقاء', 'info');
      return;
    }
    if (friendsList.includes(trimmed)) {
      onShowToast('هذا المستخدم مضاف بالفعل في قائمة أصدقائك المقربين', 'info');
      return;
    }
    const updated = [...friendsList, trimmed];
    setFriendsList(updated);
    onUpdateFriends?.(updated);
    if (socket?.connected) {
      socket.emit('updateFriendsList', { friends: updated });
    }
    onShowToast(`تمت إضافة @${trimmed} إلى قائمة أصدقائك VIP! ⭐`, 'success');
    setFriendNameInput('');
  };

  const handleRemoveFriend = (name: string) => {
    const updated = friendsList.filter((n) => n !== name);
    setFriendsList(updated);
    onUpdateFriends?.(updated);
    if (socket?.connected) {
      socket.emit('updateFriendsList', { friends: updated });
    }
    onShowToast(`تمت إزالة ${name} من قائمة الأصدقاء المقربين`, 'info');
  };

  if (!isOpen) return null;

  return (
    <div
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      className="fixed inset-0 z-50 flex items-center justify-center p-3 bg-black/80 backdrop-blur-sm animate-fade-in"
      dir="rtl"
    >
      <div className="bg-slate-900 border border-slate-700/80 rounded-2xl w-full max-w-3xl max-h-[92vh] flex flex-col shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="p-4 bg-gradient-to-r from-purple-950/70 via-slate-900 to-amber-950/70 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-purple-500/20 border border-purple-500/40 flex items-center justify-center text-purple-400 shadow-inner">
              <Crown className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white flex items-center gap-2">
                استوديو الهوية الشخصية والرتب الشرفية
                <span className="text-[10px] bg-purple-500/20 text-purple-300 border border-purple-500/40 px-2 py-0.5 rounded-full">
                  Level {userLevel}
                </span>
              </h2>
              <p className="text-xs text-slate-400">خصص إطار صورتك، ألوان اسمك، حالتك، وأوسمتك الشرفية</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors"
          >
            ✕
          </button>
        </div>

        {/* Live Profile Card Preview */}
        <div className="p-4 bg-slate-950/60 border-b border-slate-800">
          <div className="bg-gradient-to-r from-slate-900 via-indigo-950/40 to-slate-900 border border-slate-700/70 rounded-xl p-4 flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-3.5">
              {/* Avatar with current frame */}
              <div className="relative p-1.5">
                <AvatarWithFrame
                  src={currentUser.avatarUrl || DEFAULT_AVATAR_SVG}
                  alt={currentUser.username}
                  frame={activeFrame === 'none' ? '' : activeFrame}
                  size="md"
                />
                <div className="absolute -bottom-0.5 -left-0.5 z-30 text-sm bg-slate-900 border border-slate-700 rounded-full px-1">
                  {currentUser.flag || '🇸🇦'}
                </div>
              </div>

              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`text-base font-extrabold bg-gradient-to-r ${nameGradient} bg-clip-text text-transparent truncate max-w-full`}>
                    {currentUser.displayName || currentUser.username}
                  </span>
                  <span className="text-xs shrink-0">{userMood}</span>
                  <span className="text-[10px] bg-amber-500/20 text-amber-300 border border-amber-500/30 px-2 py-0.5 rounded-md shrink-0">
                    {currentUser.role === 'hassan' ? 'الإدارة العليا 🦅' : currentUser.role === 'admin' ? 'مدير عام 👑' : currentUser.role === 'super' ? 'سوبر مشرف 🛡️' : 'عضو حسان برو 🦅'}
                  </span>
                </div>
                <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                  {(!currentUser.room || currentUser.room === 'خارج الغرف' || currentUser.room.trim() === '') ? (
                    <span className="text-[11px] bg-emerald-950/80 text-emerald-300 border border-emerald-600/50 px-2.5 py-0.5 rounded-md font-bold flex items-center gap-1 shrink-0">
                      <span>التواجد:</span>
                      <strong className="text-emerald-100 font-extrabold">في بهو الغرف 📋</strong>
                    </span>
                  ) : (
                    <span className="text-[11px] bg-indigo-950/70 text-indigo-300 border border-indigo-700/50 px-2.5 py-0.5 rounded-md font-bold flex items-center gap-1 shrink-0 max-w-[200px] truncate">
                      <span>الغرفة الحالية:</span>
                      <strong className="text-white font-extrabold truncate">{currentUser.room}</strong>
                    </span>
                  )}
                </div>
                <p className="text-xs text-slate-400 mt-0.5 line-clamp-1 italic">
                  "{newQuote || 'الصقر لا يلتفت لصياح الغربان'}"
                </p>
              </div>
            </div>

            {/* Level & XP bar */}
            <div className="w-full sm:w-48 bg-slate-800/80 p-2.5 rounded-xl border border-slate-700/60 space-y-1 shrink-0">
              <div className="flex justify-between text-[11px]">
                <span className="text-amber-400 font-bold flex items-center gap-1">
                  <TrendingUp className="w-3 h-3" />
                  المستوى {userLevel}
                </span>
                <span className="text-slate-400 font-mono">{currentLevelProgress} / 100 XP</span>
              </div>
              <div className="w-full h-2 bg-slate-900 rounded-full overflow-hidden border border-slate-700">
                <div
                  className="h-full bg-gradient-to-r from-amber-500 to-amber-300 transition-all duration-500"
                  style={{ width: `${currentLevelProgress}%` }}
                />
              </div>
            </div>
          </div>
        </div>

        {/* Tab Navigation with Left/Right Arrows for effortless scrolling */}
        <div className="relative flex items-center border-b border-slate-800 bg-slate-950/80 px-1 py-1.5 min-w-0">
          <button
            type="button"
            onClick={() => scrollTabs('right')}
            className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800/80 shrink-0 transition-colors cursor-pointer"
            title="تمرير لليمين"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
          
          <div
            ref={tabsContainerRef}
            className="flex-1 flex overflow-x-auto gap-1 px-1 py-0.5 scrollbar-thin scrollbar-thumb-slate-700 scrollbar-track-transparent touch-pan-x flex-nowrap min-w-0 overscroll-contain"
          >
            {[
              { id: 'frames', label: 'إطارات الصورة', icon: Crown },
              { id: 'mood', label: 'المزاج والحالة', icon: Smile },
              { id: 'name', label: 'ألوان وتدرج الاسم', icon: Palette },
              { id: 'badges', label: 'الأوسمة الشرفية', icon: Award },
              { id: 'streak', label: 'المكافأة اليومية', icon: Calendar },
              { id: 'friends', label: 'الأصدقاء المقربون VIP', icon: Users },
            ].map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id as any)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-all cursor-pointer ${
                    isActive
                      ? 'bg-purple-600 text-white font-bold shadow-md'
                      : 'text-slate-400 hover:text-white hover:bg-slate-800'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  {tab.label}
                </button>
              );
            })}
          </div>

          <button
            type="button"
            onClick={() => scrollTabs('left')}
            className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800/80 shrink-0 transition-colors cursor-pointer"
            title="تمرير لليسار"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
        </div>

        {/* Content Area */}
        <div className="p-5 overflow-y-auto max-h-[calc(92vh-220px)] space-y-4">
          {/* TAB 1: Frames */}
          {activeTab === 'frames' && (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <label className="text-xs font-bold text-slate-300 block">اختر إطار رمزيتك الشخصية (متحرك أو ثابت):</label>
                <div className="flex items-center gap-1.5">
                  {[
                    { id: 'all', label: `الكل (${availablePresetFrames.length + customCatalogFrames.length})` },
                    { id: 'animated', label: 'متحركة ✨' },
                    { id: 'static', label: 'ثابتة 🏛️' }
                  ].map((tab) => (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => setStudioFrameFilter(tab.id as any)}
                      className={`px-2.5 py-1 rounded-lg text-[10px] font-bold border transition-all cursor-pointer ${
                        studioFrameFilter === tab.id
                          ? 'bg-purple-600 text-white border-purple-400'
                          : 'bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700'
                      }`}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                <button
                  type="button"
                  onClick={() => {
                    onChangeFrame('');
                    onShowToast('تمت إزالة الإطار', 'info');
                  }}
                  className={`pt-4 pb-2.5 px-3 rounded-xl border flex flex-col items-center gap-2 transition-all text-center cursor-pointer ${
                    !activeFrame || activeFrame === 'none'
                      ? 'bg-purple-950/40 border-purple-500 shadow-md shadow-purple-500/20'
                      : 'bg-slate-800/50 border-slate-700 hover:bg-slate-800'
                  }`}
                >
                  <AvatarWithFrame src={currentUser.avatarUrl || DEFAULT_AVATAR_SVG} alt="بدون إطار" frame="" size="md" />
                  <div className="text-xs font-bold text-slate-200">بدون إطار</div>
                </button>
                {filteredCustomFrames.map((cf) => {
                  const isSelected = activeFrame === cf.imageUrl || activeFrame === cf.id;
                  return (
                    <button
                      key={cf.id}
                      type="button"
                      onClick={() => {
                        onChangeFrame(cf.imageUrl);
                        onShowToast(`تم تطبيق إطار: ${cf.name}`, 'success');
                      }}
                      className={`pt-4 pb-2.5 px-2.5 rounded-xl border flex flex-col items-center gap-2 transition-all text-center cursor-pointer ${
                        isSelected
                          ? 'bg-purple-950/40 border-purple-500 shadow-md shadow-purple-500/20'
                          : 'bg-slate-800/50 border-slate-700 hover:bg-slate-800'
                      }`}
                    >
                      <div className="py-1">
                        <AvatarWithFrame src={currentUser.avatarUrl || DEFAULT_AVATAR_SVG} alt={cf.name} frame={cf.imageUrl} size="md" />
                      </div>
                      <div className="w-full space-y-0.5">
                        <div className={`text-[11px] font-bold truncate ${isSelected ? 'text-purple-300' : 'text-slate-200'}`}>
                          {cf.name}
                        </div>
                        <div className="text-[9px] font-bold text-emerald-300 truncate">مرفوع • {cf.createdBy}</div>
                        {isSelected && <span className="text-[10px] text-emerald-400 font-semibold block">مفعّل حالياً ✓</span>}
                      </div>
                    </button>
                  );
                })}
                {filteredStudioFrames.map((f) => {
                  const isSelected = activeFrame === f.id;
                  return (
                    <button
                      key={f.id}
                      type="button"
                      onClick={() => {
                        onChangeFrame(f.id);
                        onShowToast(`تم تطبيق إطار: ${f.name}`, 'success');
                      }}
                      className={`pt-4 pb-2.5 px-2.5 rounded-xl border flex flex-col items-center gap-2 transition-all text-center cursor-pointer ${
                        isSelected
                          ? 'bg-purple-950/40 border-purple-500 shadow-md shadow-purple-500/20'
                          : 'bg-slate-800/50 border-slate-700 hover:bg-slate-800'
                      }`}
                    >
                      <div className="py-1">
                        <AvatarWithFrame src={currentUser.avatarUrl || DEFAULT_AVATAR_SVG} alt={f.name} frame={f.id} size="md" />
                      </div>
                      <div className="w-full space-y-0.5">
                        <div className={`text-[11px] font-bold truncate ${isSelected ? 'text-purple-300' : 'text-slate-200'}`}>
                          {f.name}
                        </div>
                        <div className={`text-[9px] font-bold ${f.animated ? 'text-amber-300' : 'text-sky-300'}`}>
                          {f.badge}
                        </div>
                        {isSelected && <span className="text-[10px] text-emerald-400 font-semibold block">مفعّل حالياً ✓</span>}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* TAB 2: Mood & Status Quote */}
          {activeTab === 'mood' && (
            <div className="space-y-4 max-w-xl mx-auto">
              <div>
                <label className="text-xs font-bold text-slate-300 block mb-2">اختر مزاجك الحالي:</label>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {MOODS.map((m) => {
                    const isSelected = userMood === m.id;
                    return (
                      <button
                        key={m.id}
                        onClick={() => {
                          onChangeMood(m.id);
                          onShowToast(`تم تعيين الحالة: ${m.label}`, 'success');
                        }}
                        className={`p-2.5 rounded-xl border text-center transition-all ${
                          isSelected
                            ? 'bg-amber-500/20 border-amber-500 text-amber-300 font-bold'
                            : 'bg-slate-800/60 border-slate-700 text-slate-300 hover:bg-slate-800'
                        }`}
                      >
                        <div className="text-xl mb-1">{m.icon}</div>
                        <div className="text-[11px]">{m.label}</div>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <label className="text-xs font-bold text-slate-300 block mb-1">العبارة والاقتباس الشخصي (Bio):</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newQuote}
                    onChange={(e) => setNewQuote(e.target.value)}
                    placeholder="اكتب عبارتك التي تظهر في بروفايلك..."
                    maxLength={100}
                    className="flex-1 px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-xs text-white focus:outline-none focus:border-amber-500"
                  />
                  <button
                    onClick={() => {
                      onUpdateStatusQuote(newQuote);
                      onShowToast('تم تحديث العبارة الشخصية بنجاح!', 'success');
                    }}
                    className="px-4 py-2 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs rounded-xl shadow-md"
                  >
                    حفظ
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: Name Gradients */}
          {activeTab === 'name' && (
            <div className="space-y-3">
              <label className="text-xs font-bold text-slate-300 block">اختر تدرج ألوان اسمك في المحادثة:</label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {GRADIENTS.map((g) => {
                  const isSelected = nameGradient === g.id;
                  return (
                    <button
                      key={g.id}
                      onClick={() => {
                        onChangeNameGradient(g.id);
                        onShowToast(`تم تطبيق تدرج: ${g.name}`, 'success');
                      }}
                      className={`p-3 rounded-xl border flex items-center justify-between transition-all ${
                        isSelected
                          ? 'bg-slate-800 border-amber-500 shadow-md'
                          : 'bg-slate-800/50 border-slate-700 hover:bg-slate-800'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <div className={`w-6 h-6 rounded-full ${g.preview} shadow-sm`} />
                        <span className={`text-sm font-extrabold bg-gradient-to-r ${g.id} bg-clip-text text-transparent`}>
                          {currentUser.displayName || currentUser.username}
                        </span>
                      </div>
                      <span className="text-xs text-slate-400">{g.name}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* TAB 4: Badges */}
          {activeTab === 'badges' && (
            <div className="space-y-3">
              <label className="text-xs font-bold text-slate-300 block">مجموعة الأوسمة والشارات الشرفية:</label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {BADGES.map((b) => (
                  <div
                    key={b.id}
                    className={`p-3.5 rounded-xl border flex items-start gap-3 ${
                      b.unlocked
                        ? 'bg-slate-800/80 border-slate-700'
                        : 'bg-slate-900/40 border-slate-800/60 opacity-60'
                    }`}
                  >
                    <div className="w-10 h-10 rounded-xl bg-slate-900 border border-slate-700 flex items-center justify-center text-xl shrink-0">
                      {b.icon}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <h4 className="text-xs font-bold text-white">{b.title}</h4>
                        {b.unlocked ? (
                          <span className="text-[10px] text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded">مكتسب ✓</span>
                        ) : (
                          <span className="text-[10px] text-slate-500 bg-slate-800 px-1.5 py-0.5 rounded">مغلق 🔒</span>
                        )}
                      </div>
                      <p className="text-[11px] text-slate-400 mt-0.5">{b.desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* TAB 5: Daily Streak */}
          {activeTab === 'streak' && (
            <div className="max-w-md mx-auto text-center space-y-4">
              <div className="bg-slate-800/60 border border-slate-700 rounded-2xl p-5 shadow-lg">
                <div className="w-12 h-12 rounded-2xl bg-amber-500/20 text-amber-400 border border-amber-500/40 flex items-center justify-center mx-auto text-2xl mb-2">
                  🔥
                </div>
                <h3 className="text-base font-bold text-white mb-1">سجل الحضور اليومي المستمر</h3>
                <p className="text-xs text-slate-400 mb-4">سجل دخولك كل يوم لتضاعف نقاطك ومكافآتك الذهبية</p>

                {/* Days Tracker */}
                <div className="grid grid-cols-7 gap-1.5 mb-5">
                  {[1, 2, 3, 4, 5, 6, 7].map((d) => {
                    const isPast = d < dailyStreakDay;
                    const isToday = d === dailyStreakDay;
                    return (
                      <div
                        key={d}
                        className={`p-2 rounded-xl border text-center flex flex-col items-center justify-between ${
                          isPast
                            ? 'bg-emerald-950/40 border-emerald-500/50 text-emerald-400'
                            : isToday
                            ? 'bg-amber-500/20 border-amber-500 text-amber-300 font-bold animate-pulse'
                            : 'bg-slate-900 border-slate-800 text-slate-500'
                        }`}
                      >
                        <span className="text-[10px]">يوم {d}</span>
                        <span className="text-base my-1">{isPast ? '✓' : '🎁'}</span>
                        <span className="text-[9px] font-mono">+{d * 25}</span>
                      </div>
                    );
                  })}
                </div>

                <button
                  onClick={handleClaimDailyReward}
                  disabled={streakClaimedToday || isClaimingDaily}
                  className={`w-full py-3 rounded-xl font-bold text-xs shadow-lg transition-all ${
                    streakClaimedToday || isClaimingDaily
                      ? 'bg-slate-800 text-slate-500 cursor-not-allowed border border-slate-700'
                      : 'bg-gradient-to-r from-amber-500 to-yellow-400 hover:from-amber-400 hover:to-yellow-300 text-slate-950 shadow-amber-500/20'
                  }`}
                >
                  {streakClaimedToday ? 'تم استلام مكافأة اليوم بنجاح ✓' : isClaimingDaily ? 'جاري التحقق من السيرفر...' : `استلم مكافأة اليوم (${dailyStreakDay}) (+${dailyStreakDay * 25} نقطة) 🎉`}
                </button>
              </div>
            </div>
          )}

          {/* TAB 6: VIP Friends */}
          {activeTab === 'friends' && (
            <div className="max-w-lg mx-auto space-y-4">
              <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-3.5">
                <form onSubmit={handleAddFriend} className="flex gap-2">
                  <input
                    type="text"
                    value={friendNameInput}
                    onChange={(e) => setFriendNameInput(e.target.value)}
                    placeholder="اكتب اسم العضو لإضافته لقائمة المقربين..."
                    className="flex-1 px-3 py-2 bg-slate-900 border border-slate-700 rounded-xl text-xs text-white focus:outline-none focus:border-purple-500"
                  />
                  <button
                    type="submit"
                    className="px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold rounded-xl shadow-md"
                  >
                    إضافة صديق VIP
                  </button>
                </form>
              </div>

              <div className="space-y-2">
                {friendsList.length === 0 ? (
                  <div className="p-6 text-center text-xs text-slate-400 bg-slate-800/40 border border-slate-700/60 rounded-xl">
                    قائمة الأصدقاء المقربين فارغة حالياً — أضف اسم أي عضو لتسجيله هنا.
                  </div>
                ) : (
                  friendsList.map((friend) => (
                    <div
                      key={friend}
                      className="p-3 bg-slate-800/70 border border-slate-700 rounded-xl flex items-center justify-between"
                    >
                      <div className="flex items-center gap-2.5">
                        <div className="w-8 h-8 rounded-full bg-purple-500/20 text-purple-400 flex items-center justify-center font-bold text-xs border border-purple-500/30">
                          ⭐
                        </div>
                        <div>
                          <div className="text-xs font-bold text-white">@{friend}</div>
                          <div className="text-[10px] text-emerald-400">صديق مقرب VIP</div>
                        </div>
                      </div>
                      <button
                        onClick={() => handleRemoveFriend(friend)}
                        className="text-xs text-rose-400 hover:text-rose-300 hover:bg-rose-500/10 px-2 py-1 rounded-lg transition-colors"
                      >
                        إزالة
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-3 bg-slate-950 border-t border-slate-800 flex items-center justify-between text-xs text-slate-400">
          <span>التعديلات تُحفظ وتظهر فوراً لجميع الحاضرين في الغرفة</span>
          <button
            onClick={onClose}
            className="px-5 py-1.5 rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-bold"
          >
            إغلاق
          </button>
        </div>
      </div>
    </div>
  );
};
