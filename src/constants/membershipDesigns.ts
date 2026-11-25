export type AvatarFrameCategory = 'wings' | 'elements' | 'cute' | 'classic';

export interface AvatarFramePreset {
  id: string;
  name: string;
  badge: string;
  animated: boolean;
  category?: AvatarFrameCategory;
  ornateId?: string;
  gradient: string;
  glowColor: string;
  accentColor: string;
  sparkles?: boolean;
  crown?: boolean;
  spinFast?: boolean;
  ringStyle?: 'rounded' | 'circle' | 'octagon';
}

export interface MemberBackgroundPreset {
  id: string;
  name: string;
  badge: string;
  previewImage: string;
  cssGradient: string;
}

export interface RoomBannerPreset {
  id: string;
  name: string;
  imageUrl: string;
}

export interface CustomCatalogFrame {
  id: string;
  name: string;
  imageUrl: string;
  animated?: boolean;
  createdBy: string;
  createdAt: number;
}

export interface CustomCatalogBg {
  id: string;
  name: string;
  imageUrl: string;
  createdBy: string;
  createdAt: number;
}

export interface MembershipDesignCatalog {
  customFrames: CustomCatalogFrame[];
  customBgs: CustomCatalogBg[];
  deletedPresetFrameIds: string[];
  deletedPresetBgIds: string[];
}

export const DEFAULT_MEMBERSHIP_DESIGN_CATALOG: MembershipDesignCatalog = {
  customFrames: [],
  customBgs: [],
  deletedPresetFrameIds: [],
  deletedPresetBgIds: []
};

// Helper to build crisp offline-safe inline SVG data URI illustrations for luxury backgrounds
function svgDataUri(svg: string): string {
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg.trim())}`;
}

export const AVATAR_FRAME_PRESETS: AvatarFramePreset[] = [
  // =========================================================================
  // 1. ANIMATED ORNATE FRAMES (إطارات فاخرة متحركة)
  // =========================================================================
  {
    id: 'frame:golden-phoenix-wings',
    name: 'أجنحة العنقاء الذهبية',
    badge: 'متحرك ✨',
    animated: true,
    category: 'wings',
    ornateId: 'golden-phoenix-wings',
    gradient: 'conic-gradient(from 0deg, #fbbf24, #fef08a, #d97706, #fde047, #b45309, #fbbf24)',
    glowColor: 'rgba(245, 158, 11, 0.78)',
    accentColor: '#fde047',
    sparkles: true,
    ringStyle: 'circle'
  },
  {
    id: 'frame:frost-dragon-crown',
    name: 'تاج الجليد الكريستالي',
    badge: 'متحرك ❄️',
    animated: true,
    category: 'wings',
    ornateId: 'frost-dragon-crown',
    gradient: 'conic-gradient(from 0deg, #e0f2fe, #38bdf8, #818cf8, #bae6fd, #0284c7, #e0f2fe)',
    glowColor: 'rgba(56, 189, 248, 0.8)',
    accentColor: '#bae6fd',
    sparkles: true,
    ringStyle: 'circle'
  },
  {
    id: 'frame:silver-top1-tiara',
    name: 'تاج الصدارة TOP-1 الفضي',
    badge: 'متحرك 👑',
    animated: true,
    category: 'wings',
    ornateId: 'silver-top1-tiara',
    gradient: 'conic-gradient(from 0deg, #f8fafc, #c084fc, #cbd5e1, #e0e7ff, #94a3b8, #f8fafc)',
    glowColor: 'rgba(192, 132, 252, 0.75)',
    accentColor: '#f8fafc',
    sparkles: true,
    ringStyle: 'circle'
  },
  {
    id: 'frame:amethyst-crystal-wings',
    name: 'أجنحة الكريستال البنفسجي',
    badge: 'متحرك 💎',
    animated: true,
    category: 'wings',
    ornateId: 'amethyst-crystal-wings',
    gradient: 'conic-gradient(from 0deg, #a855f7, #e879f9, #6366f1, #f0abfc, #7e22ce, #a855f7)',
    glowColor: 'rgba(168, 85, 247, 0.8)',
    accentColor: '#e879f9',
    sparkles: true,
    ringStyle: 'circle'
  },
  {
    id: 'frame:fallen-angel-black',
    name: 'الأجنحة السوداء المهيبة',
    badge: 'متحرك 🖤',
    animated: true,
    category: 'wings',
    ornateId: 'fallen-angel-black',
    gradient: 'conic-gradient(from 0deg, #1e293b, #64748b, #090d16, #94a3b8, #0f172a, #1e293b)',
    glowColor: 'rgba(100, 116, 139, 0.68)',
    accentColor: '#cbd5e1',
    ringStyle: 'circle'
  },
  {
    id: 'frame:angel-halo-wings',
    name: 'هالة الملاك وأجنحة النور',
    badge: 'متحرك 🪽',
    animated: true,
    category: 'wings',
    ornateId: 'angel-halo-wings',
    gradient: 'conic-gradient(from 0deg, #fef08a, #fbcfe8, #ffffff, #fde047, #f9a8d4, #fef08a)',
    glowColor: 'rgba(253, 224, 71, 0.75)',
    accentColor: '#fef08a',
    sparkles: true,
    ringStyle: 'circle'
  },
  {
    id: 'frame:falcon-royal-crest',
    name: 'تاج الصقر الملكي',
    badge: 'متحرك 🦅',
    animated: true,
    category: 'wings',
    ornateId: 'falcon-royal-crest',
    gradient: 'conic-gradient(from 0deg, #fbbf24, #10b981, #fde047, #047857, #d97706, #fbbf24)',
    glowColor: 'rgba(16, 185, 129, 0.72)',
    accentColor: '#fbbf24',
    sparkles: true,
    ringStyle: 'circle'
  },
  {
    id: 'frame:blazing-victory-wreath',
    name: 'إكليل النصر الملتهب',
    badge: 'متحرك 🔥',
    animated: true,
    category: 'elements',
    ornateId: 'blazing-victory-wreath',
    gradient: 'conic-gradient(from 0deg, #f59e0b, #fef08a, #ea580c, #fbbf24, #b45309, #f59e0b)',
    glowColor: 'rgba(245, 158, 11, 0.85)',
    accentColor: '#fde047',
    sparkles: true,
    ringStyle: 'circle'
  },
  {
    id: 'frame:aqua-gold-dragon',
    name: 'تنين الماء والذهب',
    badge: 'متحرك 🌊',
    animated: true,
    category: 'elements',
    ornateId: 'aqua-gold-dragon',
    gradient: 'conic-gradient(from 0deg, #0ea5e9, #fbbf24, #22d3ee, #f59e0b, #0284c7, #0ea5e9)',
    glowColor: 'rgba(14, 165, 233, 0.8)',
    accentColor: '#38bdf8',
    sparkles: true,
    ringStyle: 'circle'
  },
  {
    id: 'frame:flowing-water-vortex',
    name: 'دوامة الماء المتدفقة',
    badge: 'متحرك 💧',
    animated: true,
    category: 'elements',
    ornateId: 'flowing-water-vortex',
    gradient: 'conic-gradient(from 0deg, #06b6d4, #e0f2fe, #0284c7, #67e8f9, #0ea5e9, #06b6d4)',
    glowColor: 'rgba(34, 211, 238, 0.8)',
    accentColor: '#67e8f9',
    spinFast: true,
    ringStyle: 'circle'
  },
  {
    id: 'frame:ember-stars-ring',
    name: 'حلقة الجمر والنجوم',
    badge: 'متحرك 🌟',
    animated: true,
    category: 'elements',
    ornateId: 'ember-stars-ring',
    gradient: 'conic-gradient(from 0deg, #f97316, #fde047, #dc2626, #fb923c, #fef08a, #f97316)',
    glowColor: 'rgba(249, 115, 22, 0.82)',
    accentColor: '#fde047',
    sparkles: true,
    ringStyle: 'circle'
  },
  {
    id: 'frame:inferno-flame-ring',
    name: 'حلقة اللهب المشتعل',
    badge: 'متحرك 🔥',
    animated: true,
    category: 'elements',
    ornateId: 'inferno-flame-ring',
    gradient: 'conic-gradient(from 0deg, #ef4444, #f97316, #facc15, #dc2626, #fb923c, #ef4444)',
    glowColor: 'rgba(239, 68, 68, 0.85)',
    accentColor: '#fb923c',
    spinFast: true,
    ringStyle: 'circle'
  },
  {
    id: 'frame:ocean-whale-wave',
    name: 'موجة الحوت الأزرق',
    badge: 'متحرك 🐳',
    animated: true,
    category: 'elements',
    ornateId: 'ocean-whale-wave',
    gradient: 'conic-gradient(from 0deg, #2563eb, #38bdf8, #1d4ed8, #7dd3fc, #3b82f6, #2563eb)',
    glowColor: 'rgba(37, 99, 235, 0.82)',
    accentColor: '#7dd3fc',
    sparkles: true,
    ringStyle: 'circle'
  },
  {
    id: 'frame:rainbow-prism-halo',
    name: 'هالة قوس قزح الكريستالية',
    badge: 'متحرك 🌈',
    animated: true,
    category: 'elements',
    ornateId: 'rainbow-prism-halo',
    gradient: 'conic-gradient(from 0deg, #fb7185, #fbbf24, #34d399, #38bdf8, #a78bfa, #f472b6, #fb7185)',
    glowColor: 'rgba(167, 139, 250, 0.72)',
    accentColor: '#ffffff',
    sparkles: true,
    ringStyle: 'circle'
  },
  {
    id: 'frame:crescent-night-stars',
    name: 'هلال الليل والنجوم الذهبية',
    badge: 'متحرك 🌙',
    animated: true,
    category: 'elements',
    ornateId: 'crescent-night-stars',
    gradient: 'conic-gradient(from 0deg, #1e1b4b, #fbbf24, #312e81, #fde047, #0f172a, #1e1b4b)',
    glowColor: 'rgba(251, 191, 36, 0.72)',
    accentColor: '#fde047',
    sparkles: true,
    ringStyle: 'circle'
  },
  {
    id: 'frame:cyber-hologram-hud',
    name: 'رادار السايبر الهولوجرامي',
    badge: 'متحرك ⚡',
    animated: true,
    category: 'elements',
    ornateId: 'cyber-hologram-hud',
    gradient: 'conic-gradient(from 0deg, #22d3ee, #0ea5e9, #d946ef, #22d3ee)',
    glowColor: 'rgba(34, 211, 238, 0.82)',
    accentColor: '#22d3ee',
    spinFast: true,
    ringStyle: 'circle'
  },
  {
    id: 'frame:pink-cat-hearts',
    name: 'آذان القطة والقلوب الوردية',
    badge: 'متحرك 💖',
    animated: true,
    category: 'cute',
    ornateId: 'pink-cat-hearts',
    gradient: 'conic-gradient(from 0deg, #f472b6, #fbcfe8, #fb7185, #fdf2f8, #ec4899, #f472b6)',
    glowColor: 'rgba(244, 114, 182, 0.82)',
    accentColor: '#fbcfe8',
    sparkles: true,
    ringStyle: 'circle'
  },
  {
    id: 'frame:purple-butterfly-aura',
    name: 'فراشات الأرجوان الساحرة',
    badge: 'متحرك 🦋',
    animated: true,
    category: 'cute',
    ornateId: 'purple-butterfly-aura',
    gradient: 'conic-gradient(from 0deg, #c026d3, #fbbf24, #9333ea, #f0abfc, #a855f7, #c026d3)',
    glowColor: 'rgba(192, 38, 211, 0.8)',
    accentColor: '#f0abfc',
    sparkles: true,
    ringStyle: 'circle'
  },

  // =========================================================================
  // 2. STATIC ORNATE FRAMES (إطارات فاخرة ثابتة)
  // =========================================================================
  {
    id: 'frame:silver-knight-wings',
    name: 'أجنحة الفارس الفضي',
    badge: 'ثابت 🏛️',
    animated: false,
    category: 'wings',
    ornateId: 'silver-knight-wings',
    gradient: 'linear-gradient(135deg, #cbd5e1 0%, #475569 50%, #e2e8f0 100%)',
    glowColor: 'rgba(148, 163, 184, 0.6)',
    accentColor: '#e2e8f0',
    ringStyle: 'circle'
  },
  {
    id: 'frame:platinum-blade-wings',
    name: 'أجنحة البلاتين المصقول',
    badge: 'ثابت 🏛️',
    animated: false,
    category: 'wings',
    ornateId: 'platinum-blade-wings',
    gradient: 'linear-gradient(135deg, #f3e8d2 0%, #78716c 50%, #e7e5e4 100%)',
    glowColor: 'rgba(214, 211, 209, 0.55)',
    accentColor: '#f5f5f4',
    ringStyle: 'circle'
  },
  {
    id: 'frame:paladin-sky-helm',
    name: 'درع الفارس السماوي',
    badge: 'ثابت 🛡️',
    animated: false,
    category: 'wings',
    ornateId: 'paladin-sky-helm',
    gradient: 'linear-gradient(135deg, #bae6fd 0%, #475569 55%, #38bdf8 100%)',
    glowColor: 'rgba(56, 189, 248, 0.6)',
    accentColor: '#bae6fd',
    ringStyle: 'circle'
  },
  {
    id: 'frame:solar-dragon-gold',
    name: 'درع تنين الشمس الذهبي',
    badge: 'ثابت 🐉',
    animated: false,
    category: 'wings',
    ornateId: 'solar-dragon-gold',
    gradient: 'linear-gradient(135deg, #fde047 0%, #b45309 55%, #fbbf24 100%)',
    glowColor: 'rgba(245, 158, 11, 0.65)',
    accentColor: '#fde047',
    ringStyle: 'circle'
  },
  {
    id: 'frame:gothic-iron-crest',
    name: 'الدرع الحديدي المرصع',
    badge: 'ثابت ⚔️',
    animated: false,
    category: 'wings',
    ornateId: 'gothic-iron-crest',
    gradient: 'linear-gradient(135deg, #94a3b8 0%, #1e293b 50%, #cbd5e1 100%)',
    glowColor: 'rgba(100, 116, 139, 0.55)',
    accentColor: '#cbd5e1',
    ringStyle: 'circle'
  },
  {
    id: 'frame:golden-laurel-vip',
    name: 'إكليل المجد الذهبي VIP',
    badge: 'ثابت 🏆',
    animated: false,
    category: 'classic',
    ornateId: 'golden-laurel-vip',
    gradient: 'linear-gradient(135deg, #fef08a 0%, #d97706 50%, #fbbf24 100%)',
    glowColor: 'rgba(245, 158, 11, 0.65)',
    accentColor: '#fef08a',
    ringStyle: 'circle'
  },
  {
    id: 'frame:pearl-blossom-wreath',
    name: 'إكليل الأزهار اللؤلؤية',
    badge: 'ثابت 🌸',
    animated: false,
    category: 'cute',
    ornateId: 'pearl-blossom-wreath',
    gradient: 'linear-gradient(135deg, #fffbeb 0%, #e2e8f0 50%, #fde68a 100%)',
    glowColor: 'rgba(253, 230, 138, 0.6)',
    accentColor: '#fffbeb',
    ringStyle: 'circle'
  },
  {
    id: 'frame:golden-lotus-gems',
    name: 'زهور اللوتس والأحجار الكريمة',
    badge: 'ثابت 🪷',
    animated: false,
    category: 'cute',
    ornateId: 'golden-lotus-gems',
    gradient: 'linear-gradient(135deg, #fbbf24 0%, #38bdf8 50%, #f59e0b 100%)',
    glowColor: 'rgba(251, 191, 36, 0.6)',
    accentColor: '#7dd3fc',
    ringStyle: 'circle'
  },
  {
    id: 'frame:imperial-baroque-sapphire',
    name: 'الإطار الإمبراطوري المرصع',
    badge: 'ثابت 💠',
    animated: false,
    category: 'classic',
    ornateId: 'imperial-baroque-sapphire',
    gradient: 'linear-gradient(135deg, #fbbf24 0%, #1d4ed8 50%, #fde047 100%)',
    glowColor: 'rgba(59, 130, 246, 0.65)',
    accentColor: '#fbbf24',
    ringStyle: 'circle'
  },
  {
    id: 'frame:minimal-champagne-gold',
    name: 'الذهبي الكلاسيكي الهادئ',
    badge: 'ثابت ✨',
    animated: false,
    category: 'classic',
    ornateId: 'minimal-champagne-gold',
    gradient: 'linear-gradient(135deg, #fef3c7 0%, #b45309 50%, #fde68a 100%)',
    glowColor: 'rgba(217, 119, 6, 0.5)',
    accentColor: '#fde68a',
    ringStyle: 'circle'
  },
  {
    id: 'frame:obsidian-rose-gold',
    name: 'الأوبسيديان والذهب الوردي',
    badge: 'ثابت 🌹',
    animated: false,
    category: 'classic',
    ornateId: 'obsidian-rose-gold',
    gradient: 'linear-gradient(135deg, #1e293b 0%, #fb7185 50%, #0f172a 100%)',
    glowColor: 'rgba(251, 113, 133, 0.5)',
    accentColor: '#fda4af',
    ringStyle: 'circle'
  },

  // =========================================================================
  // 3. CLASSIC GRADIENT / GLITTER RINGS (إطارات البريق الدوارة الكلاسيكية)
  // =========================================================================
  {
    id: 'frame:royal-gold-glitter',
    name: 'الذهبي الملكي المتلألئ',
    badge: 'متحرك ✨',
    animated: true,
    category: 'classic',
    gradient: 'conic-gradient(from 0deg, #fbbf24, #fef08a, #d97706, #fde047, #b45309, #fbbf24)',
    glowColor: 'rgba(245, 158, 11, 0.75)',
    accentColor: '#fbbf24',
    sparkles: true,
    crown: true,
    ringStyle: 'rounded'
  },
  {
    id: 'frame:diamond-prism',
    name: 'إطار الألماس الكريستالي',
    badge: 'متحرك 💎',
    animated: true,
    category: 'elements',
    gradient: 'conic-gradient(from 0deg, #e0f2fe, #38bdf8, #ffffff, #818cf8, #67e8f9, #e0f2fe)',
    glowColor: 'rgba(56, 189, 248, 0.75)',
    accentColor: '#38bdf8',
    sparkles: true,
    spinFast: true,
    ringStyle: 'circle'
  },
  {
    id: 'frame:phoenix-fire',
    name: 'لهيب العنقاء المتوهج',
    badge: 'متحرك 🔥',
    animated: true,
    category: 'elements',
    gradient: 'conic-gradient(from 0deg, #f97316, #ef4444, #facc15, #ea580c, #fde047, #f97316)',
    glowColor: 'rgba(249, 115, 22, 0.8)',
    accentColor: '#f97316',
    sparkles: true,
    spinFast: true,
    ringStyle: 'rounded'
  },
  {
    id: 'frame:aurora-rainbow',
    name: 'الشفق الملكي المتوهج',
    badge: 'متحرك 🌈',
    animated: true,
    category: 'elements',
    gradient: 'conic-gradient(from 0deg, #f43f5e, #f59e0b, #10b981, #06b6d4, #6366f1, #ec4899, #f43f5e)',
    glowColor: 'rgba(168, 85, 247, 0.7)',
    accentColor: '#c084fc',
    sparkles: true,
    ringStyle: 'circle'
  },
  {
    id: 'frame:emerald-sultan',
    name: 'زمرد السلطان المذهب',
    badge: 'متحرك 🌿',
    animated: true,
    category: 'wings',
    gradient: 'conic-gradient(from 0deg, #10b981, #fbbf24, #059669, #fde047, #34d399, #10b981)',
    glowColor: 'rgba(16, 185, 129, 0.7)',
    accentColor: '#34d399',
    sparkles: true,
    crown: true,
    ringStyle: 'rounded'
  },
  {
    id: 'frame:rose-crystal',
    name: 'تاج الورد الكريستالي',
    badge: 'متحرك 🌸',
    animated: true,
    category: 'cute',
    gradient: 'conic-gradient(from 0deg, #ec4899, #fbcfe8, #f43f5e, #fdf2f8, #db2777, #ec4899)',
    glowColor: 'rgba(236, 72, 153, 0.7)',
    accentColor: '#f472b6',
    sparkles: true,
    ringStyle: 'circle'
  },
  {
    id: 'frame:cyber-neon',
    name: 'نيون السايبر اللامع',
    badge: 'متحرك ⚡',
    animated: true,
    category: 'elements',
    gradient: 'conic-gradient(from 0deg, #22d3ee, #0ea5e9, #a855f7, #ec4899, #22d3ee)',
    glowColor: 'rgba(34, 211, 238, 0.8)',
    accentColor: '#22d3ee',
    spinFast: true,
    ringStyle: 'rounded'
  },
  {
    id: 'frame:silver-pearl',
    name: 'اللؤلؤ الفضي الهادئ',
    badge: 'متحرك 🪞',
    animated: true,
    category: 'classic',
    gradient: 'conic-gradient(from 0deg, #f8fafc, #94a3b8, #e2e8f0, #cbd5e1, #ffffff, #f8fafc)',
    glowColor: 'rgba(226, 232, 240, 0.65)',
    accentColor: '#e2e8f0',
    sparkles: true,
    ringStyle: 'circle'
  },
  {
    id: 'frame:ruby-crimson',
    name: 'الياقوت الأحمر الفخم',
    badge: 'متحرك 👑',
    animated: true,
    category: 'wings',
    gradient: 'conic-gradient(from 0deg, #dc2626, #fbbf24, #991b1b, #fca5a5, #ef4444, #dc2626)',
    glowColor: 'rgba(220, 38, 38, 0.75)',
    accentColor: '#f87171',
    crown: true,
    ringStyle: 'rounded'
  },
  {
    id: 'frame:obsidian-gold',
    name: 'الأوبسيديان المطعم بالذهب',
    badge: 'ثابت 🖤',
    animated: false,
    category: 'classic',
    gradient: 'linear-gradient(135deg, #1e293b 0%, #fbbf24 50%, #0f172a 100%)',
    glowColor: 'rgba(251, 191, 36, 0.5)',
    accentColor: '#f59e0b',
    ringStyle: 'rounded'
  }
];

export const MEMBER_BG_PRESETS: MemberBackgroundPreset[] = [
  {
    id: 'bg:royal-gold-damask',
    name: 'نقش الذهب الملكي',
    badge: 'ملكي 👑',
    cssGradient: 'linear-gradient(135deg, #1c1306 0%, #3d2808 50%, #140e04 100%)',
    previewImage: svgDataUri(`
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 180">
        <defs>
          <linearGradient id="g1" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="#171005"/>
            <stop offset="50%" stop-color="#3c2606"/>
            <stop offset="100%" stop-color="#0f0a03"/>
          </linearGradient>
          <radialGradient id="glow1" cx="75%" cy="35%" r="55%">
            <stop offset="0%" stop-color="#fbbf24" stop-opacity="0.38"/>
            <stop offset="100%" stop-color="#fbbf24" stop-opacity="0"/>
          </radialGradient>
        </defs>
        <rect width="600" height="180" fill="url(#g1)"/>
        <rect width="600" height="180" fill="url(#glow1)"/>
        <path d="M0,145 Q150,95 300,140 T600,120 L600,180 L0,180 Z" fill="#f59e0b" fill-opacity="0.14"/>
        <path d="M0,160 Q180,115 360,155 T600,135" fill="none" stroke="#fbbf24" stroke-opacity="0.45" stroke-width="2"/>
        <circle cx="480" cy="48" r="3" fill="#fef08a" opacity="0.8"/>
        <circle cx="520" cy="72" r="2" fill="#fbbf24" opacity="0.7"/>
        <circle cx="420" cy="34" r="2" fill="#fde047" opacity="0.6"/>
        <circle cx="110" cy="40" r="2.5" fill="#fbbf24" opacity="0.5"/>
      </svg>
    `)
  },
  {
    id: 'bg:midnight-aurora',
    name: 'أضواء الشفق الليلي',
    badge: 'شفق 🌌',
    cssGradient: 'linear-gradient(135deg, #061326 0%, #1e1b4b 55%, #0f172a 100%)',
    previewImage: svgDataUri(`
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 180">
        <defs>
          <linearGradient id="g2" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="#050e1d"/>
            <stop offset="50%" stop-color="#1e1b4b"/>
            <stop offset="100%" stop-color="#09192b"/>
          </linearGradient>
          <radialGradient id="au1" cx="30%" cy="25%" r="55%">
            <stop offset="0%" stop-color="#22d3ee" stop-opacity="0.35"/>
            <stop offset="100%" stop-color="#22d3ee" stop-opacity="0"/>
          </radialGradient>
          <radialGradient id="au2" cx="80%" cy="65%" r="50%">
            <stop offset="0%" stop-color="#a855f7" stop-opacity="0.35"/>
            <stop offset="100%" stop-color="#a855f7" stop-opacity="0"/>
          </radialGradient>
        </defs>
        <rect width="600" height="180" fill="url(#g2)"/>
        <rect width="600" height="180" fill="url(#au1)"/>
        <rect width="600" height="180" fill="url(#au2)"/>
        <path d="M0,120 C140,65 280,150 440,85 C510,55 560,75 600,60" fill="none" stroke="#38bdf8" stroke-opacity="0.45" stroke-width="2.5"/>
        <circle cx="95" cy="40" r="1.8" fill="#fff" opacity="0.8"/>
        <circle cx="240" cy="28" r="2.2" fill="#e0f2fe" opacity="0.7"/>
        <circle cx="490" cy="36" r="1.8" fill="#fff" opacity="0.9"/>
        <circle cx="555" cy="110" r="1.5" fill="#c084fc" opacity="0.8"/>
      </svg>
    `)
  },
  {
    id: 'bg:crimson-velvet',
    name: 'مخمل الياقوت الأحمر',
    badge: 'فاخر 🌹',
    cssGradient: 'linear-gradient(135deg, #2a0711 0%, #581022 50%, #1c050c 100%)',
    previewImage: svgDataUri(`
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 180">
        <defs>
          <linearGradient id="g3" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="#25060f"/>
            <stop offset="50%" stop-color="#681228"/>
            <stop offset="100%" stop-color="#19040a"/>
          </linearGradient>
          <radialGradient id="rg3" cx="68%" cy="40%" r="55%">
            <stop offset="0%" stop-color="#f43f5e" stop-opacity="0.4"/>
            <stop offset="100%" stop-color="#f43f5e" stop-opacity="0"/>
          </radialGradient>
        </defs>
        <rect width="600" height="180" fill="url(#g3)"/>
        <rect width="600" height="180" fill="url(#rg3)"/>
        <path d="M0,140 Q170,90 340,140 T600,115 L600,180 L0,180 Z" fill="#fb7185" fill-opacity="0.12"/>
        <circle cx="465" cy="55" r="32" fill="none" stroke="#fda4af" stroke-opacity="0.22" stroke-width="1.5"/>
        <circle cx="465" cy="55" r="52" fill="none" stroke="#fbbf24" stroke-opacity="0.18" stroke-width="1"/>
      </svg>
    `)
  },
  {
    id: 'bg:emerald-palace',
    name: 'حدائق الزمرد الأندلسية',
    badge: 'زمرد 🌿',
    cssGradient: 'linear-gradient(135deg, #042018 0%, #0b4635 55%, #031912 100%)',
    previewImage: svgDataUri(`
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 180">
        <defs>
          <linearGradient id="g4" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="#031b14"/>
            <stop offset="55%" stop-color="#0d523d"/>
            <stop offset="100%" stop-color="#02140e"/>
          </linearGradient>
        </defs>
        <rect width="600" height="180" fill="url(#g4)"/>
        <circle cx="500" cy="45" r="70" fill="#10b981" fill-opacity="0.16"/>
        <circle cx="120" cy="140" r="65" fill="#fbbf24" fill-opacity="0.08"/>
        <path d="M0,150 Q150,105 300,145 T600,125" fill="none" stroke="#34d399" stroke-opacity="0.4" stroke-width="2"/>
        <path d="M0,165 Q200,130 400,160 T600,145" fill="none" stroke="#fbbf24" stroke-opacity="0.28" stroke-width="1.2"/>
      </svg>
    `)
  },
  {
    id: 'bg:pearl-platinum',
    name: 'البلاتين اللؤلؤي الهادئ',
    badge: 'لؤلؤي 🪞',
    cssGradient: 'linear-gradient(135deg, #1e293b 0%, #475569 50%, #0f172a 100%)',
    previewImage: svgDataUri(`
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 180">
        <defs>
          <linearGradient id="g5" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="#1e293b"/>
            <stop offset="50%" stop-color="#475569"/>
            <stop offset="100%" stop-color="#0f172a"/>
          </linearGradient>
        </defs>
        <rect width="600" height="180" fill="url(#g5)"/>
        <path d="M-20,160 C160,60 360,200 620,40" fill="none" stroke="#e2e8f0" stroke-opacity="0.25" stroke-width="22"/>
        <path d="M-20,130 C160,30 360,170 620,10" fill="none" stroke="#f8fafc" stroke-opacity="0.16" stroke-width="2"/>
        <circle cx="490" cy="60" r="3" fill="#f8fafc" opacity="0.7"/>
        <circle cx="140" cy="45" r="2" fill="#cbd5e1" opacity="0.6"/>
      </svg>
    `)
  },
  {
    id: 'bg:sapphire-ocean',
    name: 'أعماق الياقوت الأزرق',
    badge: 'ياقوت 🌊',
    cssGradient: 'linear-gradient(135deg, #071936 0%, #164e87 55%, #051126 100%)',
    previewImage: svgDataUri(`
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 180">
        <defs>
          <linearGradient id="g6" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="#061630"/>
            <stop offset="55%" stop-color="#154d8a"/>
            <stop offset="100%" stop-color="#041024"/>
          </linearGradient>
        </defs>
        <rect width="600" height="180" fill="url(#g6)"/>
        <path d="M0,120 Q150,80 300,125 T600,110 L600,180 L0,180 Z" fill="#38bdf8" fill-opacity="0.14"/>
        <path d="M0,145 Q180,105 360,145 T600,130 L600,180 L0,180 Z" fill="#0ea5e9" fill-opacity="0.18"/>
        <circle cx="470" cy="45" r="2.5" fill="#bae6fd" opacity="0.8"/>
      </svg>
    `)
  },
  {
    id: 'bg:sunset-desert',
    name: 'غروب الصحراء الذهبية',
    badge: 'غروب 🌅',
    cssGradient: 'linear-gradient(135deg, #2e1029 0%, #831843 45%, #d97706 100%)',
    previewImage: svgDataUri(`
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 180">
        <defs>
          <linearGradient id="g7" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="#270d23"/>
            <stop offset="55%" stop-color="#7c1d3d"/>
            <stop offset="100%" stop-color="#b45309"/>
          </linearGradient>
        </defs>
        <rect width="600" height="180" fill="url(#g7)"/>
        <circle cx="460" cy="70" r="38" fill="#fbbf24" fill-opacity="0.32"/>
        <path d="M0,135 Q160,105 320,135 T600,125 L600,180 L0,180 Z" fill="#1e0914" fill-opacity="0.65"/>
      </svg>
    `)
  },
  {
    id: 'bg:cyber-purple',
    name: 'سديم النيون البنفسجي',
    badge: 'نيون 🔮',
    cssGradient: 'linear-gradient(135deg, #170936 0%, #4c1d95 55%, #0f172a 100%)',
    previewImage: svgDataUri(`
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 180">
        <defs>
          <linearGradient id="g8" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="#14072e"/>
            <stop offset="55%" stop-color="#4c1d95"/>
            <stop offset="100%" stop-color="#090d1f"/>
          </linearGradient>
        </defs>
        <rect width="600" height="180" fill="url(#g8)"/>
        <circle cx="140" cy="50" r="60" fill="#ec4899" fill-opacity="0.22"/>
        <circle cx="490" cy="110" r="75" fill="#22d3ee" fill-opacity="0.18"/>
        <path d="M0,155 L600,85" stroke="#c084fc" stroke-opacity="0.25" stroke-width="1.5"/>
      </svg>
    `)
  }
];

export const ROOM_BANNER_PRESETS: RoomBannerPreset[] = MEMBER_BG_PRESETS.slice(0, 6).map((b) => ({
  id: b.id,
  name: b.name,
  imageUrl: b.previewImage
}));

export function getFramePreset(value?: string): AvatarFramePreset | undefined {
  if (!value) return undefined;
  return AVATAR_FRAME_PRESETS.find((f) => f.id === value);
}

export function isCustomImageValue(value?: string): boolean {
  if (!value) return false;
  return (
    value.startsWith('http://') ||
    value.startsWith('https://') ||
    value.startsWith('/uploads/') ||
    value.startsWith('data:image/') ||
    value.startsWith('blob:')
  );
}

export function getMemberBgPreset(value?: string): MemberBackgroundPreset | undefined {
  if (!value) return undefined;
  return MEMBER_BG_PRESETS.find((b) => b.id === value);
}

export function resolveMemberBgUrl(value?: string): string | undefined {
  if (!value) return undefined;
  const preset = getMemberBgPreset(value);
  if (preset) return preset.previewImage;
  if (isCustomImageValue(value)) return value;
  return undefined;
}
