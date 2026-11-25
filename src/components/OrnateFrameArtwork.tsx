import React, { useId } from 'react';

interface OrnateFrameArtworkProps {
  ornateId: string;
  animated?: boolean;
}

// Helper for crisp 4-point star sparkles
const Sparkle4: React.FC<{ x: number; y: number; r?: number; fill?: string; className?: string; delay?: string }> = ({
  x,
  y,
  r = 4,
  fill = '#ffffff',
  className = '',
  delay
}) => (
  <path
    d={`M${x} ${y - r} Q${x} ${y} ${x + r} ${y} Q${x} ${y} ${x} ${y + r} Q${x} ${y} ${x - r} ${y} Q${x} ${y} ${x} ${y - r} Z`}
    fill={fill}
    className={className}
    style={delay ? { animationDelay: delay } : undefined}
  />
);

export const OrnateFrameArtwork: React.FC<OrnateFrameArtworkProps> = ({ ornateId, animated = true }) => {
  const rawUid = useId();
  const uid = rawUid.replace(/[^a-zA-Z0-9_-]/g, '');
  const id = (name: string) => `${name}-${uid}`;

  switch (ornateId) {
    // 1. أجنحة العنقاء الذهبية (Golden Phoenix Wings)
    case 'golden-phoenix-wings':
      return (
        <svg viewBox="0 0 120 120" className="w-full h-full overflow-visible" aria-hidden="true">
          <defs>
            <linearGradient id={id('gold')} x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#fef9c3" />
              <stop offset="28%" stopColor="#fbbf24" />
              <stop offset="65%" stopColor="#d97706" />
              <stop offset="100%" stopColor="#fef08a" />
            </linearGradient>
            <linearGradient id={id('goldDark')} x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#f59e0b" />
              <stop offset="100%" stopColor="#78350f" />
            </linearGradient>
            <radialGradient id={id('gem')} cx="50%" cy="35%" r="60%">
              <stop offset="0%" stopColor="#ffffff" />
              <stop offset="40%" stopColor="#38bdf8" />
              <stop offset="100%" stopColor="#0369a1" />
            </radialGradient>
          </defs>

          {/* Animated Sweeping Wings */}
          <g className={animated ? 'avatar-frame-wing-pulse' : ''}>
            {/* Left Wing Feathers */}
            <path d="M22 62 C7 48, 3 28, 12 12 C16 26, 22 36, 30 43 C20 33, 18 20, 22 10 C25 22, 31 32, 38 38 Z" fill={`url(#${id('gold')})`} stroke="#78350f" strokeWidth="0.8" />
            <path d="M21 68 C8 60, 4 46, 8 34 C13 46, 19 54, 27 58 Z" fill={`url(#${id('goldDark')})`} stroke="#fef08a" strokeWidth="0.6" />
            <path d="M24 76 C12 72, 7 62, 10 52 C15 62, 21 67, 29 70 Z" fill={`url(#${id('gold')})`} stroke="#78350f" strokeWidth="0.6" />
            {/* Right Wing Feathers */}
            <path d="M98 62 C113 48, 117 28, 108 12 C104 26, 98 36, 90 43 C100 33, 102 20, 98 10 C95 22, 89 32, 82 38 Z" fill={`url(#${id('gold')})`} stroke="#78350f" strokeWidth="0.8" />
            <path d="M99 68 C112 60, 116 46, 112 34 C107 46, 101 54, 93 58 Z" fill={`url(#${id('goldDark')})`} stroke="#fef08a" strokeWidth="0.6" />
            <path d="M96 76 C108 72, 113 62, 110 52 C105 62, 99 67, 91 70 Z" fill={`url(#${id('gold')})`} stroke="#78350f" strokeWidth="0.6" />
          </g>

          {/* Outer Beveled Gold Ring */}
          <circle cx="60" cy="60" r="41.5" fill="none" stroke={`url(#${id('gold')})`} strokeWidth="4.5" />
          <circle cx="60" cy="60" r="39.2" fill="none" stroke="#fffbeb" strokeWidth="0.9" opacity="0.85" />
          <circle cx="60" cy="60" r="43.8" fill="none" stroke="#92400e" strokeWidth="1" />

          {/* Top Crown & Gem */}
          <path d="M46 19 L52 8 L60 14 L68 8 L74 19 Q60 22 46 19 Z" fill={`url(#${id('gold')})`} stroke="#78350f" strokeWidth="0.9" />
          <polygon points="60,11 63.5,16 60,21 56.5,16" fill={`url(#${id('gem')})`} stroke="#fef08a" strokeWidth="0.7" />

          {/* Bottom Royal Crest */}
          <path d="M41 97 Q60 106 79 97 L73 107 Q60 113 47 107 Z" fill={`url(#${id('gold')})`} stroke="#78350f" strokeWidth="0.8" />
          <polygon points="60,99 64,104 60,109 56,104" fill={`url(#${id('gem')})`} stroke="#fffbeb" strokeWidth="0.7" />

          {animated && (
            <>
              <Sparkle4 x={18} y={24} r={4.2} fill="#fef08a" className="avatar-frame-sparkle" />
              <Sparkle4 x={102} y={24} r={4.2} fill="#fef08a" className="avatar-frame-sparkle" delay="0.8s" />
              <Sparkle4 x={60} y={8} r={3.5} fill="#ffffff" className="avatar-frame-sparkle" delay="0.4s" />
            </>
          )}
        </svg>
      );

    // 2. تاج الجليد الكريستالي (Frost Dragon Crown)
    case 'frost-dragon-crown':
      return (
        <svg viewBox="0 0 120 120" className="w-full h-full overflow-visible" aria-hidden="true">
          <defs>
            <linearGradient id={id('ice')} x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#ffffff" />
              <stop offset="35%" stopColor="#7dd3fc" />
              <stop offset="70%" stopColor="#38bdf8" />
              <stop offset="100%" stopColor="#818cf8" />
            </linearGradient>
            <linearGradient id={id('iceDeep')} x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#bae6fd" />
              <stop offset="100%" stopColor="#1e3a8a" />
            </linearGradient>
          </defs>

          <g className={animated ? 'avatar-frame-wing-pulse' : ''}>
            {/* Crystalline Ice Wings */}
            <path d="M22 60 L6 36 L16 32 L11 17 L27 30 L24 14 L38 35 Z" fill={`url(#${id('ice')})`} stroke="#0284c7" strokeWidth="0.8" />
            <path d="M22 66 L7 58 L18 52 L11 42 L28 48 Z" fill={`url(#${id('iceDeep')})`} stroke="#e0f2fe" strokeWidth="0.6" />
            <path d="M98 60 L114 36 L104 32 L109 17 L93 30 L96 14 L82 35 Z" fill={`url(#${id('ice')})`} stroke="#0284c7" strokeWidth="0.8" />
            <path d="M98 66 L113 58 L102 52 L109 42 L92 48 Z" fill={`url(#${id('iceDeep')})`} stroke="#e0f2fe" strokeWidth="0.6" />
          </g>

          <circle cx="60" cy="60" r="41.5" fill="none" stroke={`url(#${id('ice')})`} strokeWidth="4.2" />
          <circle cx="60" cy="60" r="39.2" fill="none" stroke="#ffffff" strokeWidth="0.8" opacity="0.9" />

          {/* Ice Crown Spires */}
          <path d="M43 20 L48 8 L55 15 L60 4 L65 15 L72 8 L77 20 Z" fill={`url(#${id('ice')})`} stroke="#0369a1" strokeWidth="0.8" />
          <polygon points="60,9 63.5,15 60,20 56.5,15" fill="#ffffff" stroke="#38bdf8" strokeWidth="0.7" />
          {/* Bottom Frost Crystal */}
          <polygon points="60,98 66,105 60,113 54,105" fill={`url(#${id('ice')})`} stroke="#ffffff" strokeWidth="0.8" />
          <polygon points="48,99 52,104 48,108 44,104" fill="#bae6fd" stroke="#0284c7" strokeWidth="0.6" />
          <polygon points="72,99 76,104 72,108 68,104" fill="#bae6fd" stroke="#0284c7" strokeWidth="0.6" />

          {animated && (
            <>
              <Sparkle4 x={16} y={22} r={4} fill="#ffffff" className="avatar-frame-sparkle" />
              <Sparkle4 x={104} y={22} r={4} fill="#ffffff" className="avatar-frame-sparkle" delay="0.6s" />
              <Sparkle4 x={60} y={113} r={3.5} fill="#bae6fd" className="avatar-frame-sparkle" delay="1.1s" />
            </>
          )}
        </svg>
      );

    // 3. تاج الصدارة TOP-1 الفضي (Silver TOP-1 Tiara)
    case 'silver-top1-tiara':
      return (
        <svg viewBox="0 0 120 120" className="w-full h-full overflow-visible" aria-hidden="true">
          <defs>
            <linearGradient id={id('silver')} x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#ffffff" />
              <stop offset="40%" stopColor="#cbd5e1" />
              <stop offset="75%" stopColor="#64748b" />
              <stop offset="100%" stopColor="#f1f5f9" />
            </linearGradient>
            <linearGradient id={id('ribbon')} x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#7e22ce" />
              <stop offset="50%" stopColor="#a855f7" />
              <stop offset="100%" stopColor="#6b21a8" />
            </linearGradient>
          </defs>

          <g className={animated ? 'avatar-frame-wing-pulse' : ''}>
            {/* Grand Angelic Silver Wings */}
            <path d="M21 66 C5 50, 3 25, 11 9 C15 24, 21 34, 28 42 C20 30, 19 16, 24 6 C27 20, 32 30, 39 38 Z" fill={`url(#${id('silver')})`} stroke="#475569" strokeWidth="0.7" />
            <path d="M23 76 C9 70, 5 54, 11 40 C15 54, 21 62, 29 66 Z" fill={`url(#${id('silver')})`} stroke="#475569" strokeWidth="0.7" />
            <path d="M99 66 C115 50, 117 25, 109 9 C105 24, 99 34, 92 42 C100 30, 101 16, 96 6 C93 20, 88 30, 81 38 Z" fill={`url(#${id('silver')})`} stroke="#475569" strokeWidth="0.7" />
            <path d="M97 76 C111 70, 115 54, 109 40 C105 54, 99 62, 91 66 Z" fill={`url(#${id('silver')})`} stroke="#475569" strokeWidth="0.7" />
          </g>

          <circle cx="60" cy="60" r="41.5" fill="none" stroke={`url(#${id('silver')})`} strokeWidth="4.2" />
          <circle cx="60" cy="60" r="39.3" fill="none" stroke="#ffffff" strokeWidth="0.9" />

          {/* Diamond Tiara */}
          <path d="M40 21 L45 10 L52 16 L60 5 L68 16 L75 10 L80 21 Q60 23 40 21 Z" fill={`url(#${id('silver')})`} stroke="#475569" strokeWidth="0.8" />
          <circle cx="60" cy="14" r="2.6" fill="#c084fc" stroke="#ffffff" strokeWidth="0.8" />
          <circle cx="49" cy="17" r="1.6" fill="#e0e7ff" />
          <circle cx="71" cy="17" r="1.6" fill="#e0e7ff" />

          {/* Purple TOP-1 Ribbon (rim-hugged so it does not cover portrait chin) */}
          <path d="M36 96 L42 108 L34 110 L40 99 Z" fill="#581c87" />
          <path d="M84 96 L78 108 L86 110 L80 99 Z" fill="#581c87" />
          <path d="M38 99 Q60 103 82 99 L80 110 Q60 115 40 110 Z" fill={`url(#${id('ribbon')})`} stroke="#e9d5ff" strokeWidth="0.8" />
          <text x="60" y="107.5" textAnchor="middle" fill="#ffffff" fontSize="6.8" fontWeight="900" fontFamily="sans-serif" letterSpacing="0.6">
            TOP 1
          </text>

          {animated && (
            <>
              <Sparkle4 x={60} y={4} r={3.6} fill="#ffffff" className="avatar-frame-sparkle" />
              <Sparkle4 x={22} y={24} r={3.5} fill="#e9d5ff" className="avatar-frame-sparkle" delay="0.7s" />
              <Sparkle4 x={98} y={24} r={3.5} fill="#e9d5ff" className="avatar-frame-sparkle" delay="1.2s" />
            </>
          )}
        </svg>
      );

    // 4. أجنحة الكريستال البنفسجي (Amethyst Crystal Wings)
    case 'amethyst-crystal-wings':
      return (
        <svg viewBox="0 0 120 120" className="w-full h-full overflow-visible" aria-hidden="true">
          <defs>
            <linearGradient id={id('amy')} x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#f5d0fe" />
              <stop offset="40%" stopColor="#c084fc" />
              <stop offset="80%" stopColor="#7e22ce" />
              <stop offset="100%" stopColor="#e879f9" />
            </linearGradient>
          </defs>

          <g className={animated ? 'avatar-frame-wing-pulse' : ''}>
            <path d="M20 62 C6 48, 5 26, 15 13 C18 27, 25 36, 33 41 C23 30, 23 19, 27 11 C30 22, 35 30, 41 36 Z" fill={`url(#${id('amy')})`} stroke="#581c87" strokeWidth="0.7" />
            <path d="M22 72 C10 66, 8 52, 14 40 C17 51, 22 58, 30 62 Z" fill={`url(#${id('amy')})`} stroke="#f5d0fe" strokeWidth="0.6" />
            <path d="M100 62 C114 48, 115 26, 105 13 C102 27, 95 36, 87 41 C97 30, 97 19, 93 11 C90 22, 85 30, 79 36 Z" fill={`url(#${id('amy')})`} stroke="#581c87" strokeWidth="0.7" />
            <path d="M98 72 C110 66, 112 52, 106 40 C103 51, 98 58, 90 62 Z" fill={`url(#${id('amy')})`} stroke="#f5d0fe" strokeWidth="0.6" />
          </g>

          <circle cx="60" cy="60" r="41.5" fill="none" stroke={`url(#${id('amy')})`} strokeWidth="4" />
          <circle cx="60" cy="60" r="39.2" fill="none" stroke="#fae8ff" strokeWidth="0.8" />

          {/* Amethyst Crown */}
          <path d="M45 20 L51 9 L60 15 L69 9 L75 20 Z" fill={`url(#${id('amy')})`} stroke="#581c87" strokeWidth="0.8" />
          <polygon points="60,7 64,14 60,20 56,14" fill="#f0abfc" stroke="#ffffff" strokeWidth="0.7" />
          <polygon points="60,98 65,105 60,112 55,105" fill="#e879f9" stroke="#ffffff" strokeWidth="0.8" />

          {animated && (
            <>
              <Sparkle4 x={19} y={20} r={4} fill="#f5d0fe" className="avatar-frame-sparkle" />
              <Sparkle4 x={101} y={20} r={4} fill="#f5d0fe" className="avatar-frame-sparkle" delay="0.9s" />
            </>
          )}
        </svg>
      );

    // 5. الأجنحة السوداء المهيبة (Fallen Angel Black Wings)
    case 'fallen-angel-black':
      return (
        <svg viewBox="0 0 120 120" className="w-full h-full overflow-visible" aria-hidden="true">
          <defs>
            <linearGradient id={id('obsidian')} x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#475569" />
              <stop offset="35%" stopColor="#1e293b" />
              <stop offset="75%" stopColor="#020617" />
              <stop offset="100%" stopColor="#334155" />
            </linearGradient>
          </defs>

          <g className={animated ? 'avatar-frame-wing-pulse' : ''}>
            {/* Left Sweeping Black Wings */}
            <path d="M22 68 C5 50, 2 22, 13 6 C17 22, 23 35, 31 44 C22 29, 22 14, 27 5 C30 20, 35 32, 42 40 Z" fill={`url(#${id('obsidian')})`} stroke="#94a3b8" strokeWidth="0.7" />
            <path d="M25 80 C10 74, 5 57, 10 42 C15 56, 22 65, 31 70 Z" fill="#0f172a" stroke="#64748b" strokeWidth="0.6" />
            <path d="M32 90 C19 88, 12 78, 15 66 C20 76, 26 81, 35 84 Z" fill="#020617" stroke="#64748b" strokeWidth="0.6" />
            {/* Right Sweeping Black Wings */}
            <path d="M98 68 C115 50, 118 22, 107 6 C103 22, 97 35, 89 44 C98 29, 98 14, 93 5 C90 20, 85 32, 78 40 Z" fill={`url(#${id('obsidian')})`} stroke="#94a3b8" strokeWidth="0.7" />
            <path d="M95 80 C110 74, 115 57, 110 42 C105 56, 98 65, 89 70 Z" fill="#0f172a" stroke="#64748b" strokeWidth="0.6" />
            <path d="M88 90 C101 88, 108 78, 105 66 C100 76, 94 81, 85 84 Z" fill="#020617" stroke="#64748b" strokeWidth="0.6" />
          </g>

          <circle cx="60" cy="60" r="41" fill="none" stroke={`url(#${id('obsidian')})`} strokeWidth="4.2" />
          <circle cx="60" cy="60" r="39" fill="none" stroke="#94a3b8" strokeWidth="0.8" opacity="0.7" />
          <polygon points="60,97 64,103 60,109 56,103" fill="#334155" stroke="#cbd5e1" strokeWidth="0.7" />
        </svg>
      );

    // 6. هالة الملاك وأجنحة النور (Angel Halo & Light Wings)
    case 'angel-halo-wings':
      return (
        <svg viewBox="0 0 120 120" className="w-full h-full overflow-visible" aria-hidden="true">
          <defs>
            <linearGradient id={id('angelWing')} x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#ffffff" />
              <stop offset="60%" stopColor="#fce7f3" />
              <stop offset="100%" stopColor="#f9a8d4" />
            </linearGradient>
            <linearGradient id={id('haloGold')} x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#fde047" />
              <stop offset="50%" stopColor="#ffffff" />
              <stop offset="100%" stopColor="#fbbf24" />
            </linearGradient>
          </defs>

          {/* Soft Feathered Side Wings */}
          <g className={animated ? 'avatar-frame-wing-pulse' : ''}>
            <path d="M21 63 C5 56, 2 41, 10 32 C14 41, 19 46, 25 49 C16 44, 13 35, 16 26 C21 35, 25 42, 31 46 Z" fill={`url(#${id('angelWing')})`} stroke="#f472b6" strokeWidth="0.6" />
            <path d="M22 72 C10 70, 5 61, 9 52 C14 59, 20 63, 27 65 Z" fill={`url(#${id('angelWing')})`} stroke="#f472b6" strokeWidth="0.6" />
            <path d="M99 63 C115 56, 118 41, 110 32 C106 41, 101 46, 95 49 C104 44, 107 35, 104 26 C99 35, 95 42, 89 46 Z" fill={`url(#${id('angelWing')})`} stroke="#f472b6" strokeWidth="0.6" />
            <path d="M98 72 C110 70, 115 61, 111 52 C106 59, 100 63, 93 65 Z" fill={`url(#${id('angelWing')})`} stroke="#f472b6" strokeWidth="0.6" />
          </g>

          <circle cx="60" cy="60" r="40.8" fill="none" stroke={`url(#${id('angelWing')})`} strokeWidth="2.8" />
          <circle cx="60" cy="60" r="39.2" fill="none" stroke="#fde047" strokeWidth="0.8" opacity="0.85" />

          {/* Floating Angelic Halo */}
          <g className={animated ? 'avatar-frame-float' : ''}>
            <ellipse cx="60" cy="11" rx="18" ry="4.5" fill="none" stroke={`url(#${id('haloGold')})`} strokeWidth="3.2" />
            <ellipse cx="60" cy="11" rx="18" ry="4.5" fill="none" stroke="#ffffff" strokeWidth="0.9" opacity="0.9" />
          </g>

          {animated && (
            <>
              <Sparkle4 x={36} y={10} r={3} fill="#fef08a" className="avatar-frame-sparkle" />
              <Sparkle4 x={84} y={10} r={3} fill="#fef08a" className="avatar-frame-sparkle" delay="0.9s" />
            </>
          )}
        </svg>
      );

    // 7. تاج الصقر الملكي (Falcon Royal Crest - حسان برو)
    case 'falcon-royal-crest':
      return (
        <svg viewBox="0 0 120 120" className="w-full h-full overflow-visible" aria-hidden="true">
          <defs>
            <linearGradient id={id('fgold')} x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#fef08a" />
              <stop offset="45%" stopColor="#f59e0b" />
              <stop offset="100%" stopColor="#92400e" />
            </linearGradient>
            <linearGradient id={id('femerald')} x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#34d399" />
              <stop offset="100%" stopColor="#065f46" />
            </linearGradient>
          </defs>

          <g className={animated ? 'avatar-frame-wing-pulse' : ''}>
            <path d="M22 60 C7 49, 4 30, 12 16 C17 29, 23 38, 31 44 C22 33, 21 21, 25 13 C28 24, 33 32, 39 38 Z" fill={`url(#${id('fgold')})`} stroke="#065f46" strokeWidth="0.7" />
            <path d="M98 60 C113 49, 116 30, 108 16 C103 29, 97 38, 89 44 C98 33, 99 21, 95 13 C92 24, 87 32, 81 38 Z" fill={`url(#${id('fgold')})`} stroke="#065f46" strokeWidth="0.7" />
          </g>

          <circle cx="60" cy="60" r="41.5" fill="none" stroke={`url(#${id('fgold')})`} strokeWidth="4.2" />
          <circle cx="60" cy="60" r="39.2" fill="none" stroke="#10b981" strokeWidth="1.1" />

          {/* Royal Emerald Crown */}
          <path d="M44 19 L49 8 L60 14 L71 8 L76 19 Z" fill={`url(#${id('fgold')})`} stroke="#78350f" strokeWidth="0.8" />
          <polygon points="60,8 64,14 60,20 56,14" fill={`url(#${id('femerald')})`} stroke="#fef08a" strokeWidth="0.7" />

          {/* Bottom Emerald Shield */}
          <path d="M48 97 L72 97 L68 107 L60 112 L52 107 Z" fill={`url(#${id('femerald')})`} stroke="#fbbf24" strokeWidth="1" />
          {animated && (
            <>
              <Sparkle4 x={20} y={24} r={3.5} fill="#34d399" className="avatar-frame-sparkle" />
              <Sparkle4 x={100} y={24} r={3.5} fill="#34d399" className="avatar-frame-sparkle" delay="0.7s" />
            </>
          )}
        </svg>
      );

    // 8. إكليل النصر الملتهب (Blazing Victory Wreath)
    case 'blazing-victory-wreath':
      return (
        <svg viewBox="0 0 120 120" className="w-full h-full overflow-visible" aria-hidden="true">
          <defs>
            <linearGradient id={id('flameGold')} x1="0%" y1="100%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#ea580c" />
              <stop offset="45%" stopColor="#f59e0b" />
              <stop offset="85%" stopColor="#fde047" />
              <stop offset="100%" stopColor="#fffbeb" />
            </linearGradient>
          </defs>

          <g className={animated ? 'avatar-frame-flame' : ''}>
            {/* Left Flame Wreath */}
            <path d="M36 95 C14 82, 8 44, 24 17 C24 31, 29 41, 35 47 C26 35, 27 20, 36 10 C35 23, 38 33, 44 40 C30 47, 25 70, 38 88 Z" fill={`url(#${id('flameGold')})`} stroke="#9a3412" strokeWidth="0.7" />
            {/* Right Flame Wreath */}
            <path d="M84 95 C106 82, 112 44, 96 17 C96 31, 91 41, 85 47 C94 35, 93 20, 84 10 C85 23, 82 33, 76 40 C90 47, 95 70, 82 88 Z" fill={`url(#${id('flameGold')})`} stroke="#9a3412" strokeWidth="0.7" />
          </g>

          <circle cx="60" cy="60" r="41" fill="none" stroke={`url(#${id('flameGold')})`} strokeWidth="3.8" />
          {/* Scroll Plaque Bottom */}
          <path d="M38 96 Q60 104 82 96 L79 107 Q60 113 41 107 Z" fill={`url(#${id('flameGold')})`} stroke="#7c2d12" strokeWidth="0.8" />
          <circle cx="60" cy="103" r="2.2" fill="#fffbeb" />

          {animated && (
            <>
              <Sparkle4 x={20} y={28} r={3.5} fill="#fef08a" className="avatar-frame-sparkle" />
              <Sparkle4 x={100} y={28} r={3.5} fill="#fef08a" className="avatar-frame-sparkle" delay="0.6s" />
            </>
          )}
        </svg>
      );

    // 9. تنين الماء والذهب (Aqua & Gold Sea Dragon)
    case 'aqua-gold-dragon':
      return (
        <svg viewBox="0 0 120 120" className="w-full h-full overflow-visible" aria-hidden="true">
          <defs>
            <linearGradient id={id('sea')} x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#e0f2fe" />
              <stop offset="40%" stopColor="#38bdf8" />
              <stop offset="100%" stopColor="#1d4ed8" />
            </linearGradient>
            <linearGradient id={id('seaGold')} x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#fef08a" />
              <stop offset="50%" stopColor="#f59e0b" />
              <stop offset="100%" stopColor="#b45309" />
            </linearGradient>
          </defs>

          <g className={animated ? 'avatar-frame-spin-slow' : ''}>
            {/* Surging Aqua Waves */}
            <path d="M18 52 C14 30, 32 14, 52 16 C40 20, 30 30, 26 42 Z" fill={`url(#${id('sea')})`} stroke="#bae6fd" strokeWidth="0.7" />
            <path d="M102 68 C106 90, 88 106, 68 104 C80 100, 90 90, 94 78 Z" fill={`url(#${id('sea')})`} stroke="#bae6fd" strokeWidth="0.7" />
            <path d="M84 19 C104 28, 110 50, 102 68 C99 52, 92 40, 80 32 Z" fill={`url(#${id('sea')})`} stroke="#e0f2fe" strokeWidth="0.6" />
            <path d="M36 101 C16 92, 10 70, 18 52 C21 68, 28 80, 40 88 Z" fill={`url(#${id('sea')})`} stroke="#e0f2fe" strokeWidth="0.6" />
          </g>

          <circle cx="60" cy="60" r="41.2" fill="none" stroke={`url(#${id('seaGold')})`} strokeWidth="4.2" />
          <circle cx="60" cy="60" r="39" fill="none" stroke="#bae6fd" strokeWidth="0.8" />
          <circle cx="60" cy="18" r="3.5" fill="#38bdf8" stroke="#fef08a" strokeWidth="1.2" />
          <circle cx="60" cy="102" r="3.5" fill="#38bdf8" stroke="#fef08a" strokeWidth="1.2" />
          <circle cx="18" cy="60" r="3" fill="#fef08a" stroke="#0284c7" strokeWidth="1" />
          <circle cx="102" cy="60" r="3" fill="#fef08a" stroke="#0284c7" strokeWidth="1" />
        </svg>
      );

    // 10. دوامة الماء المتدفقة (Flowing Water Vortex)
    case 'flowing-water-vortex':
      return (
        <svg viewBox="0 0 120 120" className="w-full h-full overflow-visible" aria-hidden="true">
          <defs>
            <linearGradient id={id('water')} x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#ffffff" stopOpacity="0.95" />
              <stop offset="40%" stopColor="#67e8f9" stopOpacity="0.9" />
              <stop offset="100%" stopColor="#0284c7" stopOpacity="0.85" />
            </linearGradient>
          </defs>

          <g className={animated ? 'avatar-frame-spin-slow' : ''}>
            <path d="M22 42 C34 15, 76 12, 95 34 C76 22, 42 26, 26 49 Z" fill={`url(#${id('water')})`} />
            <path d="M98 78 C86 105, 44 108, 25 86 C44 98, 78 94, 94 71 Z" fill={`url(#${id('water')})`} />
            <path d="M78 20 C104 34, 108 72, 90 92 C98 74, 94 40, 72 26 Z" fill={`url(#${id('water')})`} opacity="0.85" />
            <path d="M42 100 C16 86, 12 48, 30 28 C22 46, 26 80, 48 94 Z" fill={`url(#${id('water')})`} opacity="0.85" />
            <circle cx="24" cy="24" r="2.6" fill="#e0f2fe" />
            <circle cx="98" cy="28" r="2.2" fill="#67e8f9" />
            <circle cx="95" cy="96" r="2.6" fill="#e0f2fe" />
            <circle cx="22" cy="90" r="2.2" fill="#67e8f9" />
          </g>

          <circle cx="60" cy="60" r="40.5" fill="none" stroke="#67e8f9" strokeWidth="2.4" opacity="0.9" />
          <circle cx="60" cy="60" r="39" fill="none" stroke="#ffffff" strokeWidth="0.8" opacity="0.8" />
        </svg>
      );

    // 11. حلقة الجمر والنجوم (Ember & Stars Ring)
    case 'ember-stars-ring':
      return (
        <svg viewBox="0 0 120 120" className="w-full h-full overflow-visible" aria-hidden="true">
          <defs>
            <linearGradient id={id('ember')} x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#fef08a" />
              <stop offset="45%" stopColor="#f97316" />
              <stop offset="100%" stopColor="#b91c1c" />
            </linearGradient>
          </defs>

          <g className={animated ? 'avatar-frame-flame' : ''}>
            <circle cx="60" cy="60" r="42" fill="none" stroke={`url(#${id('ember')})`} strokeWidth="4.8" />
            <path d="M60 13 L64 20 L56 20 Z" fill="#fef08a" />
            <path d="M60 107 L64 100 L56 100 Z" fill="#f97316" />
            <path d="M13 60 L20 56 L20 64 Z" fill="#fde047" />
            <path d="M107 60 L100 56 L100 64 Z" fill="#f97316" />
          </g>

          <circle cx="60" cy="60" r="39.2" fill="none" stroke="#fffbeb" strokeWidth="0.9" />
          <Sparkle4 x={26} y={26} r={5} fill="#fef08a" className={animated ? 'avatar-frame-sparkle' : ''} />
          <Sparkle4 x={94} y={26} r={4.2} fill="#fb923c" className={animated ? 'avatar-frame-sparkle' : ''} delay="0.5s" />
          <Sparkle4 x={94} y={94} r={5} fill="#fef08a" className={animated ? 'avatar-frame-sparkle' : ''} delay="0.9s" />
          <Sparkle4 x={26} y={94} r={4.2} fill="#fb923c" className={animated ? 'avatar-frame-sparkle' : ''} delay="1.3s" />
        </svg>
      );

    // 12. حلقة اللهب المشتعل (Inferno Flame Ring)
    case 'inferno-flame-ring':
      return (
        <svg viewBox="0 0 120 120" className="w-full h-full overflow-visible" aria-hidden="true">
          <defs>
            <linearGradient id={id('inf')} x1="0%" y1="100%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#dc2626" />
              <stop offset="50%" stopColor="#f97316" />
              <stop offset="100%" stopColor="#fde047" />
            </linearGradient>
          </defs>

          <g className={animated ? 'avatar-frame-spin-slow' : ''}>
            <path d="M22 40 C30 14, 65 8, 86 22 C70 18, 46 24, 30 46 Z" fill={`url(#${id('inf')})`} />
            <path d="M98 80 C90 106, 55 112, 34 98 C50 102, 74 96, 90 74 Z" fill={`url(#${id('inf')})`} />
            <path d="M84 20 C108 36, 112 72, 92 94 C100 72, 96 42, 78 26 Z" fill="#f97316" />
            <path d="M36 100 C12 84, 8 48, 28 26 C20 48, 24 78, 42 94 Z" fill="#ea580c" />
            <circle cx="96" cy="24" r="2.5" fill="#fde047" />
            <circle cx="24" cy="96" r="2.5" fill="#fde047" />
          </g>

          <circle cx="60" cy="60" r="40.8" fill="none" stroke={`url(#${id('inf')})`} strokeWidth="3.5" />
          <circle cx="60" cy="60" r="39" fill="none" stroke="#fef08a" strokeWidth="0.8" />
        </svg>
      );

    // 13. موجة الحوت الأزرق (Ocean Blue Whale Wave)
    case 'ocean-whale-wave':
      return (
        <svg viewBox="0 0 120 120" className="w-full h-full overflow-visible" aria-hidden="true">
          <defs>
            <linearGradient id={id('ocean')} x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#38bdf8" />
              <stop offset="50%" stopColor="#2563eb" />
              <stop offset="100%" stopColor="#1e40af" />
            </linearGradient>
          </defs>

          <circle cx="60" cy="60" r="41.5" fill="none" stroke={`url(#${id('ocean')})`} strokeWidth="5.2" />
          <circle cx="60" cy="60" r="39" fill="none" stroke="#bae6fd" strokeWidth="1" />

          {/* Splash & Cute Whale Motif perched along outer rim without covering photo */}
          <g className={animated ? 'avatar-frame-float' : ''}>
            <ellipse cx="22" cy="92" rx="10.5" ry="6.2" fill="#38bdf8" stroke="#e0f2fe" strokeWidth="0.95" />
            <path d="M12 90 C8 85, 6 88, 9.5 92.5 C6 94, 9 97.5, 13 93.5 Z" fill="#0284c7" stroke="#bae6fd" strokeWidth="0.6" />
            <ellipse cx="23.5" cy="94.5" rx="6.5" ry="2.7" fill="#e0f2fe" opacity="0.85" />
            <circle cx="27" cy="90.5" r="1.2" fill="#0f172a" />
            <path d="M21 85 Q19 80 15.5 81 M22 85 Q24.5 80 27 81.5" fill="none" stroke="#bae6fd" strokeWidth="1.2" strokeLinecap="round" />
          </g>

          <circle cx="96" cy="28" r="3" fill="#7dd3fc" opacity="0.85" />
          <circle cx="101" cy="36" r="1.8" fill="#e0f2fe" />
        </svg>
      );

    // 14. هالة قوس قزح الكريستالية (Prismatic Rainbow Halo)
    case 'rainbow-prism-halo':
      return (
        <svg viewBox="0 0 120 120" className="w-full h-full overflow-visible" aria-hidden="true">
          <defs>
            <linearGradient id={id('rb1')} x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#fb7185" />
              <stop offset="25%" stopColor="#fbbf24" />
              <stop offset="50%" stopColor="#34d399" />
              <stop offset="75%" stopColor="#38bdf8" />
              <stop offset="100%" stopColor="#c084fc" />
            </linearGradient>
          </defs>

          <g className={animated ? 'avatar-frame-spin-slow' : ''}>
            <circle cx="60" cy="60" r="42" fill="none" stroke={`url(#${id('rb1')})`} strokeWidth="4.8" />
            <circle cx="60" cy="60" r="45.2" fill="none" stroke={`url(#${id('rb1')})`} strokeWidth="1" strokeDasharray="8 6" opacity="0.7" />
          </g>
          <circle cx="60" cy="60" r="39.2" fill="none" stroke="#ffffff" strokeWidth="1" opacity="0.9" />
          {animated && (
            <>
              <Sparkle4 x={22} y={24} r={4} fill="#ffffff" className="avatar-frame-sparkle" />
              <Sparkle4 x={98} y={96} r={4} fill="#ffffff" className="avatar-frame-sparkle" delay="0.8s" />
            </>
          )}
        </svg>
      );

    // 15. هلال الليل والنجوم الذهبية (Crescent Night & Stars)
    case 'crescent-night-stars':
      return (
        <svg viewBox="0 0 120 120" className="w-full h-full overflow-visible" aria-hidden="true">
          <defs>
            <linearGradient id={id('moon')} x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#fef9c3" />
              <stop offset="55%" stopColor="#fbbf24" />
              <stop offset="100%" stopColor="#b45309" />
            </linearGradient>
          </defs>

          <circle cx="60" cy="60" r="41" fill="none" stroke="#312e81" strokeWidth="4" />
          <circle cx="60" cy="60" r="39.2" fill="none" stroke="#fbbf24" strokeWidth="1" />

          {/* Golden Crescent Cradle hugging outer rim */}
          <path d="M18 39 C8 63, 21 97, 54 106 C71 110, 88 103, 98 90 C84 101, 56 104, 36 89 C19 76, 17 52, 23 34 Z" fill={`url(#${id('moon')})`} stroke="#78350f" strokeWidth="0.7" />
          {/* Hanging & Twinkling Stars */}
          <Sparkle4 x={96} y={24} r={5} fill="#fef08a" className={animated ? 'avatar-frame-sparkle' : ''} />
          <Sparkle4 x={84} y={14} r={3.2} fill="#fbbf24" className={animated ? 'avatar-frame-sparkle' : ''} delay="0.5s" />
          <Sparkle4 x={20} y={22} r={3.8} fill="#fef08a" className={animated ? 'avatar-frame-sparkle' : ''} delay="1s" />
        </svg>
      );

    // 16. رادار السايبر الهولوجرامي (Cyber Hologram HUD)
    case 'cyber-hologram-hud':
      return (
        <svg viewBox="0 0 120 120" className="w-full h-full overflow-visible" aria-hidden="true">
          <g className={animated ? 'avatar-frame-spin-slow' : ''}>
            <circle cx="60" cy="60" r="44.5" fill="none" stroke="#22d3ee" strokeWidth="1.4" strokeDasharray="16 6 4 6" />
          </g>
          <g className={animated ? 'avatar-frame-spin-reverse' : ''}>
            <circle cx="60" cy="60" r="41.2" fill="none" stroke="#d946ef" strokeWidth="2.8" strokeDasharray="24 8" />
          </g>
          <circle cx="60" cy="60" r="39.2" fill="none" stroke="#67e8f9" strokeWidth="1" />
          {/* Tech Brackets */}
          <path d="M12 54 L12 66 M108 54 L108 66 M54 12 L66 12 M54 108 L66 108" stroke="#22d3ee" strokeWidth="2.2" strokeLinecap="round" />
        </svg>
      );

    // 17. آذان القطة والقلوب الوردية (Pink Cat Ears & Hearts)
    case 'pink-cat-hearts':
      return (
        <svg viewBox="0 0 120 120" className="w-full h-full overflow-visible" aria-hidden="true">
          <defs>
            <linearGradient id={id('pink')} x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#fbcfe8" />
              <stop offset="50%" stopColor="#f472b6" />
              <stop offset="100%" stopColor="#ec4899" />
            </linearGradient>
          </defs>

          {/* Cute Cat Ears */}
          <path d="M23 35 L20 10 L42 22 Z" fill={`url(#${id('pink')})`} stroke="#ffffff" strokeWidth="1.1" strokeLinejoin="round" />
          <path d="M26 30 L24 16 L37 24 Z" fill="#fdf2f8" opacity="0.85" />
          <path d="M97 35 L100 10 L78 22 Z" fill={`url(#${id('pink')})`} stroke="#ffffff" strokeWidth="1.1" strokeLinejoin="round" />
          <path d="M94 30 L96 16 L83 24 Z" fill="#fdf2f8" opacity="0.85" />

          <circle cx="60" cy="60" r="41" fill="none" stroke={`url(#${id('pink')})`} strokeWidth="4.2" />
          <circle cx="60" cy="60" r="39" fill="none" stroke="#ffffff" strokeWidth="0.9" />

          {/* Glowing Floating Pink Hearts */}
          <g className={animated ? 'avatar-frame-float' : ''}>
            <path d="M19 72 C19 68, 13 68, 13 72 C13 76, 19 80, 19 80 C19 80, 25 76, 25 72 C25 68, 19 68, 19 72 Z" fill="#fb7185" stroke="#ffffff" strokeWidth="0.8" />
            <path d="M99 66 C99 61, 91 61, 91 66 C91 71, 99 77, 99 77 C99 77, 107 71, 107 66 C107 61, 99 61, 99 66 Z" fill="#f472b6" stroke="#ffffff" strokeWidth="0.9" />
            <path d="M60 101 C60 98, 55 98, 55 101 C55 104, 60 108, 60 108 C60 108, 65 104, 65 101 C65 98, 60 98, 60 101 Z" fill="#fb7185" stroke="#ffffff" strokeWidth="0.7" />
          </g>
        </svg>
      );

    // 18. فراشات الأرجوان الساحرة (Purple Butterfly Aura)
    case 'purple-butterfly-aura':
      return (
        <svg viewBox="0 0 120 120" className="w-full h-full overflow-visible" aria-hidden="true">
          <defs>
            <linearGradient id={id('butRing')} x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#f0abfc" />
              <stop offset="50%" stopColor="#a855f7" />
              <stop offset="100%" stopColor="#fbbf24" />
            </linearGradient>
          </defs>

          <circle cx="60" cy="60" r="41.2" fill="none" stroke={`url(#${id('butRing')})`} strokeWidth="4.2" />
          <circle cx="60" cy="60" r="39" fill="none" stroke="#fde047" strokeWidth="0.9" />

          {/* Left Butterfly */}
          <g transform="translate(18, 28) rotate(-18)" className={animated ? 'avatar-frame-flutter' : ''}>
            <ellipse cx="-4" cy="-3" rx="6" ry="4.5" fill="#e879f9" stroke="#ffffff" strokeWidth="0.6" />
            <ellipse cx="4" cy="-3" rx="6" ry="4.5" fill="#c084fc" stroke="#ffffff" strokeWidth="0.6" />
            <ellipse cx="-3" cy="3" rx="4" ry="3.2" fill="#a855f7" stroke="#fde047" strokeWidth="0.5" />
            <ellipse cx="3" cy="3" rx="4" ry="3.2" fill="#a855f7" stroke="#fde047" strokeWidth="0.5" />
            <rect x="-0.8" y="-5" width="1.6" height="10" rx="0.8" fill="#fef08a" />
          </g>

          {/* Right Butterfly */}
          <g transform="translate(101, 78) rotate(18)" className={animated ? 'avatar-frame-flutter' : ''} style={animated ? { animationDelay: '0.45s' } : undefined}>
            <ellipse cx="-4" cy="-3" rx="6" ry="4.5" fill="#c084fc" stroke="#ffffff" strokeWidth="0.6" />
            <ellipse cx="4" cy="-3" rx="6" ry="4.5" fill="#e879f9" stroke="#ffffff" strokeWidth="0.6" />
            <ellipse cx="-3" cy="3" rx="4" ry="3.2" fill="#9333ea" stroke="#fde047" strokeWidth="0.5" />
            <ellipse cx="3" cy="3" rx="4" ry="3.2" fill="#9333ea" stroke="#fde047" strokeWidth="0.5" />
            <rect x="-0.8" y="-5" width="1.6" height="10" rx="0.8" fill="#fef08a" />
          </g>

          {/* Top Gem */}
          <polygon points="60,13 64,19 60,25 56,19" fill="#e879f9" stroke="#fef08a" strokeWidth="0.9" />
          {animated && (
            <Sparkle4 x={98} y={24} r={3.8} fill="#f5d0fe" className="avatar-frame-sparkle" />
          )}
        </svg>
      );

    // =========================================================================
    // STATIC ORNATE FRAMES
    // =========================================================================

    // 19. أجنحة الفارس الفضي (Silver Knight Wings - Static)
    case 'silver-knight-wings':
      return (
        <svg viewBox="0 0 120 120" className="w-full h-full overflow-visible" aria-hidden="true">
          <defs>
            <linearGradient id={id('steel')} x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#f1f5f9" />
              <stop offset="45%" stopColor="#64748b" />
              <stop offset="100%" stopColor="#1e293b" />
            </linearGradient>
          </defs>
          <path d="M22 65 C7 52, 5 28, 15 11 C19 25, 25 35, 32 43 C23 31, 22 18, 27 9 C30 22, 35 32, 41 38 Z" fill={`url(#${id('steel')})`} stroke="#e2e8f0" strokeWidth="0.7" />
          <path d="M24 76 C11 71, 8 56, 13 43 C18 55, 23 63, 30 67 Z" fill="#334155" stroke="#cbd5e1" strokeWidth="0.6" />
          <path d="M98 65 C113 52, 115 28, 105 11 C101 25, 95 35, 88 43 C97 31, 98 18, 93 9 C90 22, 85 32, 79 38 Z" fill={`url(#${id('steel')})`} stroke="#e2e8f0" strokeWidth="0.7" />
          <path d="M96 76 C109 71, 112 56, 107 43 C102 55, 97 63, 90 67 Z" fill="#334155" stroke="#cbd5e1" strokeWidth="0.6" />
          <circle cx="60" cy="60" r="41.5" fill="none" stroke={`url(#${id('steel')})`} strokeWidth="4.5" />
          <circle cx="60" cy="60" r="39.2" fill="none" stroke="#e2e8f0" strokeWidth="0.8" />
          <polygon points="60,96 65,103 60,110 55,103" fill={`url(#${id('steel')})`} stroke="#f8fafc" strokeWidth="0.7" />
        </svg>
      );

    // 20. أجنحة البلاتين المصقول (Platinum Blade Wings - Static)
    case 'platinum-blade-wings':
      return (
        <svg viewBox="0 0 120 120" className="w-full h-full overflow-visible" aria-hidden="true">
          <defs>
            <linearGradient id={id('plat')} x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#fafaf9" />
              <stop offset="45%" stopColor="#d6d3d1" />
              <stop offset="100%" stopColor="#57534e" />
            </linearGradient>
          </defs>
          <path d="M21 63 L6 46 L17 44 L8 27 L25 36 L20 16 L36 37 Z" fill={`url(#${id('plat')})`} stroke="#44403c" strokeWidth="0.7" />
          <path d="M99 63 L114 46 L103 44 L112 27 L95 36 L100 16 L84 37 Z" fill={`url(#${id('plat')})`} stroke="#44403c" strokeWidth="0.7" />
          <circle cx="60" cy="60" r="41.2" fill="none" stroke={`url(#${id('plat')})`} strokeWidth="4.2" />
          <circle cx="60" cy="60" r="39" fill="none" stroke="#ffffff" strokeWidth="0.8" />
          <path d="M46 19 L60 11 L74 19 L60 22 Z" fill={`url(#${id('plat')})`} stroke="#44403c" strokeWidth="0.7" />
        </svg>
      );

    // 21. درع الفارس السماوي (Paladin Sky Helm - Static)
    case 'paladin-sky-helm':
      return (
        <svg viewBox="0 0 120 120" className="w-full h-full overflow-visible" aria-hidden="true">
          <defs>
            <linearGradient id={id('skyHelm')} x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#e0f2fe" />
              <stop offset="45%" stopColor="#94a3b8" />
              <stop offset="100%" stopColor="#334155" />
            </linearGradient>
          </defs>
          <path d="M22 58 C10 46, 8 24, 18 10 C22 24, 28 34, 36 40 Z" fill={`url(#${id('skyHelm')})`} stroke="#0284c7" strokeWidth="0.7" />
          <path d="M98 58 C110 46, 112 24, 102 10 C98 24, 92 34, 84 40 Z" fill={`url(#${id('skyHelm')})`} stroke="#0284c7" strokeWidth="0.7" />
          {/* Helm Visor Arch Top seated cleanly outside inner circle */}
          <path d="M24 41 C28 17, 44 8, 60 8 C76 8, 92 17, 96 41 L89 35 C81 22, 70 18, 60 18 C50 18, 39 22, 31 35 Z" fill={`url(#${id('skyHelm')})`} stroke="#0f172a" strokeWidth="0.7" />
          <circle cx="60" cy="60" r="41" fill="none" stroke={`url(#${id('skyHelm')})`} strokeWidth="4" />
          <circle cx="60" cy="60" r="39" fill="none" stroke="#7dd3fc" strokeWidth="0.9" />
          {/* Blue Shield Crest */}
          <path d="M22 70 L34 70 L32 82 L28 87 L24 82 Z" fill="#38bdf8" stroke="#e0f2fe" strokeWidth="0.9" />
          <path d="M86 70 L98 70 L96 82 L92 87 L88 82 Z" fill="#38bdf8" stroke="#e0f2fe" strokeWidth="0.9" />
        </svg>
      );

    // 22. درع تنين الشمس الذهبي (Solar Dragon Gold - Static)
    case 'solar-dragon-gold':
      return (
        <svg viewBox="0 0 120 120" className="w-full h-full overflow-visible" aria-hidden="true">
          <defs>
            <linearGradient id={id('sol')} x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#fef08a" />
              <stop offset="50%" stopColor="#f59e0b" />
              <stop offset="100%" stopColor="#92400e" />
            </linearGradient>
          </defs>
          <path d="M21 66 L7 48 L15 44 L10 24 L25 34 L24 14 L38 34 Z" fill={`url(#${id('sol')})`} stroke="#78350f" strokeWidth="0.8" />
          <path d="M99 66 L113 48 L105 44 L110 24 L95 34 L96 14 L82 34 Z" fill={`url(#${id('sol')})`} stroke="#78350f" strokeWidth="0.8" />
          <circle cx="60" cy="60" r="41.5" fill="none" stroke={`url(#${id('sol')})`} strokeWidth="4.4" />
          <circle cx="60" cy="60" r="39.2" fill="none" stroke="#fef9c3" strokeWidth="0.8" />
          <path d="M47 97 L60 109 L73 97 L60 102 Z" fill={`url(#${id('sol')})`} stroke="#78350f" strokeWidth="0.8" />
          <circle cx="60" cy="102" r="2.5" fill="#dc2626" stroke="#fef08a" strokeWidth="0.8" />
        </svg>
      );

    // 23. الدرع الحديدي المرصع (Gothic Iron Crest - Static)
    case 'gothic-iron-crest':
      return (
        <svg viewBox="0 0 120 120" className="w-full h-full overflow-visible" aria-hidden="true">
          <defs>
            <linearGradient id={id('iron')} x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#cbd5e1" />
              <stop offset="50%" stopColor="#475569" />
              <stop offset="100%" stopColor="#0f172a" />
            </linearGradient>
          </defs>
          <circle cx="60" cy="60" r="42" fill="none" stroke={`url(#${id('iron')})`} strokeWidth="5.2" />
          <circle cx="60" cy="60" r="39.2" fill="none" stroke="#94a3b8" strokeWidth="0.9" />
          {/* Gothic Spikes at 8 points */}
          <path d="M55 17 L60 7 L65 17 Z" fill={`url(#${id('iron')})`} stroke="#e2e8f0" strokeWidth="0.6" />
          <path d="M55 103 L60 113 L65 103 Z" fill={`url(#${id('iron')})`} stroke="#e2e8f0" strokeWidth="0.6" />
          <path d="M17 55 L7 60 L17 65 Z" fill={`url(#${id('iron')})`} stroke="#e2e8f0" strokeWidth="0.6" />
          <path d="M103 55 L113 60 L103 65 Z" fill={`url(#${id('iron')})`} stroke="#e2e8f0" strokeWidth="0.6" />
          <path d="M24 30 L17 20 L31 23 Z" fill="#334155" stroke="#cbd5e1" strokeWidth="0.6" />
          <path d="M96 30 L103 20 L89 23 Z" fill="#334155" stroke="#cbd5e1" strokeWidth="0.6" />
          <path d="M24 90 L17 100 L31 97 Z" fill="#334155" stroke="#cbd5e1" strokeWidth="0.6" />
          <path d="M96 90 L103 100 L89 97 Z" fill="#334155" stroke="#cbd5e1" strokeWidth="0.6" />
          <circle cx="60" cy="18" r="2.2" fill="#38bdf8" stroke="#ffffff" strokeWidth="0.6" />
          <circle cx="60" cy="102" r="2.2" fill="#38bdf8" stroke="#ffffff" strokeWidth="0.6" />
        </svg>
      );

    // 24. إكليل المجد الذهبي VIP (Golden Laurel VIP - Static)
    case 'golden-laurel-vip':
      return (
        <svg viewBox="0 0 120 120" className="w-full h-full overflow-visible" aria-hidden="true">
          <defs>
            <linearGradient id={id('laurel')} x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#fef08a" />
              <stop offset="50%" stopColor="#f59e0b" />
              <stop offset="100%" stopColor="#92400e" />
            </linearGradient>
          </defs>
          <circle cx="60" cy="60" r="41" fill="none" stroke={`url(#${id('laurel')})`} strokeWidth="3.8" />
          {/* Left Laurel Leaves */}
          <path d="M35 92 C16 78, 12 48, 28 24 C24 38, 25 68, 38 86 Z" fill={`url(#${id('laurel')})`} stroke="#78350f" strokeWidth="0.6" />
          <ellipse cx="18" cy="58" rx="4" ry="2.2" transform="rotate(-15 18 58)" fill="#fde047" stroke="#92400e" strokeWidth="0.5" />
          <ellipse cx="20" cy="44" rx="4" ry="2.2" transform="rotate(-35 20 44)" fill="#fbbf24" stroke="#92400e" strokeWidth="0.5" />
          <ellipse cx="26" cy="31" rx="4" ry="2.2" transform="rotate(-50 26 31)" fill="#fde047" stroke="#92400e" strokeWidth="0.5" />
          {/* Right Laurel Leaves */}
          <path d="M85 92 C104 78, 108 48, 92 24 C96 38, 95 68, 82 86 Z" fill={`url(#${id('laurel')})`} stroke="#78350f" strokeWidth="0.6" />
          <ellipse cx="102" cy="58" rx="4" ry="2.2" transform="rotate(15 102 58)" fill="#fde047" stroke="#92400e" strokeWidth="0.5" />
          <ellipse cx="100" cy="44" rx="4" ry="2.2" transform="rotate(35 100 44)" fill="#fbbf24" stroke="#92400e" strokeWidth="0.5" />
          <ellipse cx="94" cy="31" rx="4" ry="2.2" transform="rotate(50 94 31)" fill="#fde047" stroke="#92400e" strokeWidth="0.5" />
          {/* Crown Top */}
          <path d="M47 19 L52 9 L60 14 L68 9 L73 19 Z" fill={`url(#${id('laurel')})`} stroke="#78350f" strokeWidth="0.7" />
          {/* Bottom VIP Plaque */}
          <rect x="42" y="96" width="36" height="12" rx="4" fill={`url(#${id('laurel')})`} stroke="#78350f" strokeWidth="0.8" />
          <text x="60" y="104.5" textAnchor="middle" fill="#451a03" fontSize="7.5" fontWeight="900" fontFamily="sans-serif" letterSpacing="1">
            VIP
          </text>
        </svg>
      );

    // 25. إكليل الأزهار اللؤلؤية (Pearl Blossom Wreath - Static)
    case 'pearl-blossom-wreath':
      return (
        <svg viewBox="0 0 120 120" className="w-full h-full overflow-visible" aria-hidden="true">
          <circle cx="60" cy="60" r="41" fill="none" stroke="#fde68a" strokeWidth="2.8" />
          <circle cx="60" cy="60" r="39" fill="none" stroke="#ffffff" strokeWidth="0.9" />
          {/* Ivory Flowers around ring */}
          {[
            { cx: 24, cy: 38 },
            { cx: 21, cy: 62 },
            { cx: 30, cy: 86 },
            { cx: 96, cy: 38 },
            { cx: 99, cy: 62 },
            { cx: 90, cy: 86 },
            { cx: 60, cy: 17 }
          ].map((pt, idx) => (
            <g key={idx} transform={`translate(${pt.cx}, ${pt.cy})`}>
              <circle cx="0" cy="-3.5" r="2.7" fill="#ffffff" stroke="#fde68a" strokeWidth="0.5" />
              <circle cx="3.3" cy="-1" r="2.7" fill="#fffbeb" stroke="#fde68a" strokeWidth="0.5" />
              <circle cx="2" cy="3" r="2.7" fill="#ffffff" stroke="#fde68a" strokeWidth="0.5" />
              <circle cx="-2" cy="3" r="2.7" fill="#fffbeb" stroke="#fde68a" strokeWidth="0.5" />
              <circle cx="-3.3" cy="-1" r="2.7" fill="#ffffff" stroke="#fde68a" strokeWidth="0.5" />
              <circle cx="0" cy="0" r="1.8" fill="#fbbf24" />
            </g>
          ))}
          <circle cx="60" cy="102" r="3.2" fill="#ffffff" stroke="#fbbf24" strokeWidth="1" />
        </svg>
      );

    // 26. زهور اللوتس والأحجار الكريمة (Golden Lotus & Gems - Static)
    case 'golden-lotus-gems':
      return (
        <svg viewBox="0 0 120 120" className="w-full h-full overflow-visible" aria-hidden="true">
          <defs>
            <linearGradient id={id('lotGold')} x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#fef08a" />
              <stop offset="50%" stopColor="#f59e0b" />
              <stop offset="100%" stopColor="#b45309" />
            </linearGradient>
          </defs>
          <circle cx="60" cy="60" r="41" fill="none" stroke={`url(#${id('lotGold')})`} strokeWidth="3.6" />
          {/* Top Lotus */}
          <path d="M51 20 Q55 8 60 6 Q65 8 69 20 Z" fill="#38bdf8" stroke="#fef08a" strokeWidth="0.8" />
          <path d="M43 22 Q48 12 55 18 Z" fill="#fbbf24" stroke="#78350f" strokeWidth="0.6" />
          <path d="M77 22 Q72 12 65 18 Z" fill="#fbbf24" stroke="#78350f" strokeWidth="0.6" />
          {/* Bottom Lotus */}
          <path d="M48 98 Q60 112 72 98 Q60 103 48 98 Z" fill={`url(#${id('lotGold')})`} stroke="#78350f" strokeWidth="0.7" />
          <polygon points="60,99 64,104 60,109 56,104" fill="#38bdf8" stroke="#ffffff" strokeWidth="0.7" />
          {/* Side Cyan Gems */}
          <circle cx="18" cy="60" r="3.4" fill="#38bdf8" stroke="#fef08a" strokeWidth="1.2" />
          <circle cx="102" cy="60" r="3.4" fill="#38bdf8" stroke="#fef08a" strokeWidth="1.2" />
        </svg>
      );

    // 27. الإطار الإمبراطوري المرصع (Imperial Baroque Sapphire - Static)
    case 'imperial-baroque-sapphire':
      return (
        <svg viewBox="0 0 120 120" className="w-full h-full overflow-visible" aria-hidden="true">
          <defs>
            <linearGradient id={id('impGold')} x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#fef08a" />
              <stop offset="50%" stopColor="#d97706" />
              <stop offset="100%" stopColor="#fef08a" />
            </linearGradient>
          </defs>
          <circle cx="60" cy="60" r="41.8" fill="none" stroke={`url(#${id('impGold')})`} strokeWidth="4.6" />
          <circle cx="60" cy="60" r="45.2" fill="none" stroke="#60a5fa" strokeWidth="1.3" strokeDasharray="6 4" />
          <circle cx="60" cy="60" r="39.2" fill="none" stroke="#fffbeb" strokeWidth="0.8" />
          {/* Corner Filigree & Sapphires */}
          {[
            { x: 60, y: 15 },
            { x: 60, y: 105 },
            { x: 15, y: 60 },
            { x: 105, y: 60 }
          ].map((g, i) => (
            <g key={i}>
              <circle cx={g.x} cy={g.y} r="5.5" fill={`url(#${id('impGold')})`} stroke="#78350f" strokeWidth="0.7" />
              <polygon points={`${g.x},${g.y - 3.6} ${g.x + 3.6},${g.y} ${g.x},${g.y + 3.6} ${g.x - 3.6},${g.y}`} fill="#2563eb" stroke="#bae6fd" strokeWidth="0.7" />
            </g>
          ))}
        </svg>
      );

    // 28. الذهبي الكلاسيكي الهادئ (Minimal Champagne Gold - Static)
    case 'minimal-champagne-gold':
      return (
        <svg viewBox="0 0 120 120" className="w-full h-full overflow-visible" aria-hidden="true">
          <defs>
            <linearGradient id={id('champ')} x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#fef3c7" />
              <stop offset="50%" stopColor="#d97706" />
              <stop offset="100%" stopColor="#fde68a" />
            </linearGradient>
          </defs>
          <circle cx="60" cy="60" r="41.5" fill="none" stroke={`url(#${id('champ')})`} strokeWidth="3.8" />
          <circle cx="60" cy="60" r="44.8" fill="none" stroke="#fbbf24" strokeWidth="0.9" opacity="0.75" />
          <circle cx="60" cy="60" r="39.2" fill="none" stroke="#fffbeb" strokeWidth="0.8" />
          <circle cx="60" cy="16.5" r="2" fill="#fef3c7" stroke="#92400e" strokeWidth="0.6" />
          <circle cx="60" cy="103.5" r="2" fill="#fef3c7" stroke="#92400e" strokeWidth="0.6" />
        </svg>
      );

    // 29. الأوبسيديان والذهب الوردي (Obsidian & Rose Gold - Static)
    case 'obsidian-rose-gold':
      return (
        <svg viewBox="0 0 120 120" className="w-full h-full overflow-visible" aria-hidden="true">
          <defs>
            <linearGradient id={id('rosegold')} x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#fecdd3" />
              <stop offset="50%" stopColor="#fb7185" />
              <stop offset="100%" stopColor="#be123c" />
            </linearGradient>
          </defs>
          <circle cx="60" cy="60" r="42" fill="none" stroke="#0f172a" strokeWidth="5.2" />
          <circle cx="60" cy="60" r="42" fill="none" stroke={`url(#${id('rosegold')})`} strokeWidth="2.4" />
          <circle cx="60" cy="60" r="39.2" fill="none" stroke="#fecdd3" strokeWidth="0.8" />
          <polygon points="60,13 64,18 60,23 56,18" fill="#fb7185" stroke="#fff1f2" strokeWidth="0.7" />
          <polygon points="60,97 64,102 60,107 56,102" fill="#fb7185" stroke="#fff1f2" strokeWidth="0.7" />
        </svg>
      );

    default:
      return null;
  }
};
