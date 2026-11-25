import React, { useEffect, useState } from 'react';
import {
  EmblemItem,
  EmblemsConfig,
  EmojiSizeSetting,
  DEFAULT_EMBLEMS_CONFIG,
  parseCustomEmojisInText
} from './emblemsSystem';

let sharedEmblemsConfig: EmblemsConfig = DEFAULT_EMBLEMS_CONFIG;

export function setSharedEmblemsConfig(config: EmblemsConfig) {
  sharedEmblemsConfig = config || DEFAULT_EMBLEMS_CONFIG;
}

export function renderFormattedMessageText(
  text: string,
  customEmojis?: EmblemItem[],
  emojiSize?: EmojiSizeSetting
) {
  if (!text) return null;

  const activeEmojis = customEmojis || sharedEmblemsConfig.items;
  const activeSize = emojiSize || sharedEmblemsConfig.emojiSize;

  // Check if poetry verse: starts with 📜 and has |
  if (text.startsWith('📜') && text.includes('|')) {
    const parts = text.replace('📜', '').split('|');
    return (
      <div className="my-1.5 p-3 rounded-xl bg-gradient-to-r from-amber-950/20 via-slate-900/10 to-amber-950/20 border border-amber-500/30 text-center font-serif shadow-inner">
        <div className="flex flex-col sm:flex-row items-center justify-center gap-2 sm:gap-4 text-amber-900 font-bold text-sm">
          <span>« {parseCustomEmojisInText(parts[0]?.trim() || '', activeEmojis, activeSize)} »</span>
          <span className="text-amber-500 font-mono text-xs">❈ ═══ ❈</span>
          <span>« {parseCustomEmojisInText(parts[1]?.trim() || '', activeEmojis, activeSize)} »</span>
        </div>
      </div>
    );
  }

  // Parse formatting tokens: **bold**, *italic*, ~~strike~~, `code`, ==mark==
  const regex = /(\*\*[^*]+\*\*|\*[^*]+\*|~~[^~]+~~|`[^`]+`|==[^=]+==)/g;
  const parts = text.split(regex);

  return parts.map((part, index) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return (
        <strong key={index} className="font-extrabold">
          {parseCustomEmojisInText(part.slice(2, -2), activeEmojis, activeSize)}
        </strong>
      );
    }
    if (part.startsWith('*') && part.endsWith('*')) {
      return (
        <em key={index} className="italic opacity-90">
          {parseCustomEmojisInText(part.slice(1, -1), activeEmojis, activeSize)}
        </em>
      );
    }
    if (part.startsWith('~~') && part.endsWith('~~')) {
      return (
        <del key={index} className="line-through opacity-60">
          {parseCustomEmojisInText(part.slice(2, -2), activeEmojis, activeSize)}
        </del>
      );
    }
    if (part.startsWith('`') && part.endsWith('`')) {
      return (
        <code key={index} className="px-1.5 py-0.5 rounded bg-slate-800 text-amber-300 font-mono text-xs">
          {part.slice(1, -1)}
        </code>
      );
    }
    if (part.startsWith('==') && part.endsWith('==')) {
      return (
        <mark key={index} className="bg-yellow-200 text-slate-900 px-1 rounded font-semibold">
          {parseCustomEmojisInText(part.slice(2, -2), activeEmojis, activeSize)}
        </mark>
      );
    }
    return (
      <React.Fragment key={index}>
        {parseCustomEmojisInText(part, activeEmojis, activeSize)}
      </React.Fragment>
    );
  });
}

export const SelfDestructCountdown: React.FC<{ targetAt: number }> = ({ targetAt }) => {
  const [secondsLeft, setSecondsLeft] = useState<number>(() =>
    Math.max(0, Math.ceil((targetAt - Date.now()) / 1000))
  );

  useEffect(() => {
    const update = () => {
      setSecondsLeft(Math.max(0, Math.ceil((targetAt - Date.now()) / 1000)));
    };
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [targetAt]);

  return <span className="font-bold text-amber-300">{secondsLeft}ث</span>;
};

export function formatAppRelativeTime(timestamp?: number, fallbackTime?: string, id?: string): string {
  let effectiveTs = timestamp;
  if (!effectiveTs && id) {
    if (id.startsWith('msg-')) {
      const parsed = Number(id.replace('msg-', ''));
      if (parsed && !isNaN(parsed)) effectiveTs = parsed;
    } else if (id.startsWith('pm-')) {
      const parts = id.split('-');
      const parsed = Number(parts[1]);
      if (parsed && !isNaN(parsed)) effectiveTs = parsed;
    } else if (id.startsWith('post-')) {
      const parsed = Number(id.replace('post-', ''));
      if (parsed && !isNaN(parsed)) effectiveTs = parsed;
    } else if (id.startsWith('cm-')) {
      const parts = id.split('-');
      const parsed = Number(parts[1]);
      if (parsed && !isNaN(parsed)) effectiveTs = parsed;
    }
  }

  if (!effectiveTs || isNaN(effectiveTs) || effectiveTs <= 0) {
    if (fallbackTime && fallbackTime !== '0د' && fallbackTime !== 'الآن') {
      return fallbackTime;
    }
    return 'الآن';
  }

  const now = Date.now();
  const diffSec = Math.max(0, Math.floor((now - effectiveTs) / 1000));

  if (diffSec < 60) {
    return 'الآن';
  }

  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) {
    if (diffMin === 1) return 'منذ دقيقة';
    if (diffMin === 2) return 'منذ دقيقتين';
    if (diffMin >= 3 && diffMin <= 10) return `منذ ${diffMin} دقائق`;
    return `منذ ${diffMin} دقيقة`;
  }

  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) {
    if (diffHours === 1) return 'منذ ساعة';
    if (diffHours === 2) return 'منذ ساعتين';
    if (diffHours >= 3 && diffHours <= 10) return `منذ ${diffHours} ساعات`;
    return `منذ ${diffHours} ساعة`;
  }

  const diffDays = Math.floor(diffHours / 24);
  if (diffDays === 1) return 'منذ يوم';
  if (diffDays === 2) return 'منذ يومين';
  if (diffDays <= 10) return `منذ ${diffDays} أيام`;
  if (diffDays < 30) return `منذ ${diffDays} يوماً`;

  const diffMonths = Math.floor(diffDays / 30);
  if (diffMonths < 12) {
    if (diffMonths === 1) return 'منذ شهر';
    if (diffMonths === 2) return 'منذ شهرين';
    if (diffMonths <= 10) return `منذ ${diffMonths} أشهر`;
    return `منذ ${diffMonths} شهراً`;
  }

  const diffYears = Math.floor(diffDays / 365);
  if (diffYears === 1) return 'منذ سنة';
  if (diffYears === 2) return 'منذ سنتين';
  return `منذ ${diffYears} سنوات`;
}

export function formatMessageRelativeTime(msg: { id?: string; time?: string; timestamp?: number }): string {
  return formatAppRelativeTime(msg.timestamp, msg.time, msg.id);
}

export function formatCompactWallTime(timestamp?: number, fallbackTime?: string, id?: string): string {
  let effectiveTs = timestamp;
  if (!effectiveTs && id) {
    if (id.startsWith('post-')) {
      const parsed = Number(id.replace('post-', ''));
      if (parsed && !isNaN(parsed)) effectiveTs = parsed;
    } else if (id.startsWith('cm-')) {
      const parts = id.split('-');
      const parsed = Number(parts[1]);
      if (parsed && !isNaN(parsed)) effectiveTs = parsed;
    }
  }

  if (!effectiveTs || isNaN(effectiveTs) || effectiveTs <= 0) {
    if (fallbackTime && fallbackTime !== '0د' && fallbackTime !== 'الآن') {
      return fallbackTime;
    }
    return 'الآن';
  }

  const diffSec = Math.max(0, Math.floor((Date.now() - effectiveTs) / 1000));
  if (diffSec < 60) return 'الآن';

  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}د`;

  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `${diffHours}س`;

  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 30) return `${diffDays}ي`;

  const diffMonths = Math.floor(diffDays / 30);
  if (diffMonths < 12) return `${diffMonths}ش`;

  const diffYears = Math.floor(diffDays / 365);
  return `${diffYears}ع`;
}
