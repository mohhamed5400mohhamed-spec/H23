import React, { useState } from 'react';
import { Smile, X } from 'lucide-react';
import { EmblemItem } from '../utils/emblemsSystem';

interface CustomEmojiPickerPopoverProps {
  items: EmblemItem[];
  vintageStickers: string[];
  onSelectCustomEmoji: (shortcut: string) => void;
  onSelectSticker?: (sticker: EmblemItem) => void;
  onSelectVintage: (emoji: string) => void;
  onClose: () => void;
  title?: string;
  alignClassName?: string;
  allowStickers?: boolean;
}

export const CustomEmojiPickerPopover: React.FC<CustomEmojiPickerPopoverProps> = ({
  items,
  vintageStickers,
  onSelectCustomEmoji,
  onSelectSticker,
  onSelectVintage,
  onClose,
  title = 'الفيسات المخصصة والملصقات',
  alignClassName = 'bottom-full mb-1.5 right-0',
  allowStickers = true
}) => {
  const [tab, setTab] = useState<'custom' | 'stickers' | 'vintage'>('custom');

  const customEmojis = items
    .filter((i) => i.type === 'emoji')
    .sort((a, b) => (a.codeNumber || 0) - (b.codeNumber || 0));
  const stickers = items.filter((i) => i.type === 'sticker');
  const showStickersTab = allowStickers && Boolean(onSelectSticker);

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div
        onClick={(e) => e.stopPropagation()}
        className={`absolute ${alignClassName} p-2.5 bg-slate-900 border-2 border-amber-500/70 rounded-2xl shadow-2xl z-50 w-72 sm:w-80 max-w-[calc(100vw-2rem)] text-right text-slate-100 backdrop-blur-md animate-in zoom-in-95 duration-150`}
      >
        <div className="flex items-center justify-between pb-1.5 border-b border-slate-700/80 mb-2">
          <div className="flex items-center gap-1.5 font-bold text-xs text-amber-300">
            <Smile className="w-4 h-4 text-amber-400" />
            <span>{title}</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-6 h-6 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white flex items-center justify-center cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        <div
          className={`grid ${showStickersTab ? 'grid-cols-3' : 'grid-cols-2'} gap-1 p-1 bg-slate-950/80 rounded-xl mb-2 border border-slate-800 text-[11px] font-bold`}
        >
          <button
            type="button"
            onClick={() => setTab('custom')}
            className={`py-1 px-2 rounded-lg transition-all cursor-pointer flex items-center justify-center gap-1 ${
              tab === 'custom'
                ? 'bg-purple-600 text-white shadow-md'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <span>🎨</span>
            <span>فيسات (ف1)</span>
          </button>

          {showStickersTab && (
            <button
              type="button"
              onClick={() => setTab('stickers')}
              className={`py-1 px-2 rounded-lg transition-all cursor-pointer flex items-center justify-center gap-1 ${
                tab === 'stickers'
                  ? 'bg-amber-600 text-white shadow-md'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <span>🖼️</span>
              <span>ستيكرات</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => setTab('vintage')}
            className={`py-1 px-2 rounded-lg transition-all cursor-pointer flex items-center justify-center gap-1 ${
              tab === 'vintage'
                ? 'bg-emerald-600 text-white shadow-md'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <span>😊</span>
            <span>شعبية</span>
          </button>
        </div>

        {tab === 'custom' && (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-[10px] text-slate-400 px-1">
              <span>انقر على الفيس لإدراجه:</span>
              <span className="font-mono text-purple-300 font-bold">
                {customEmojis.length} فيس متاح
              </span>
            </div>
            <div className="grid grid-cols-4 gap-1.5 max-h-36 sm:max-h-48 overflow-y-auto p-1">
              {customEmojis.map((emoji) => (
                <button
                  key={emoji.id}
                  type="button"
                  onClick={() => {
                    if (emoji.shortcut) {
                      onSelectCustomEmoji(emoji.shortcut);
                    }
                  }}
                  className="p-1.5 rounded-xl bg-slate-950/70 border border-slate-800 hover:border-purple-400 hover:bg-purple-950/30 flex flex-col items-center justify-center gap-1 transition-all group cursor-pointer hover:scale-105"
                  title={`${emoji.title} (${emoji.shortcut})`}
                >
                  <img
                    src={emoji.imageUrl}
                    alt={emoji.shortcut || emoji.title}
                    className="w-7 h-7 object-contain drop-shadow-sm group-hover:scale-110 transition-transform"
                    loading="lazy"
                  />
                  <span className="px-1.5 py-0.2 rounded-full bg-amber-500/20 text-amber-300 font-mono text-[9px] font-black border border-amber-500/40">
                    {emoji.shortcut}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        {tab === 'stickers' && showStickersTab && onSelectSticker && (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-[10px] text-slate-400 px-1">
              <span>انقر لإرسال الستيكر فوراً:</span>
              <span className="font-mono text-amber-300 font-bold">
                {stickers.length} ستيكر
              </span>
            </div>
            <div className="grid grid-cols-3 gap-1.5 max-h-36 sm:max-h-48 overflow-y-auto p-1">
              {stickers.map((stk) => (
                <button
                  key={stk.id}
                  type="button"
                  onClick={() => {
                    onSelectSticker(stk);
                    onClose();
                  }}
                  className="p-1.5 rounded-xl bg-slate-950/70 border border-slate-800 hover:border-amber-400 hover:bg-amber-950/30 flex flex-col items-center justify-center gap-1 transition-all group cursor-pointer hover:scale-105"
                  title={stk.title}
                >
                  <img
                    src={stk.imageUrl}
                    alt={stk.title}
                    className="w-10 h-10 object-contain drop-shadow-md group-hover:scale-110 transition-transform"
                    loading="lazy"
                  />
                  <span className="text-[10px] text-slate-300 font-bold truncate max-w-full">
                    {stk.title}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        {tab === 'vintage' && (
          <div className="space-y-1.5">
            <div className="text-[10px] text-slate-400 px-1">الابتسامات والرموز السريعة:</div>
            <div className="grid grid-cols-6 gap-1.5 text-xl max-h-36 sm:max-h-48 overflow-y-auto p-1">
              {vintageStickers.map((stk) => (
                <button
                  key={stk}
                  type="button"
                  onClick={() => onSelectVintage(stk)}
                  className="p-1 hover:bg-slate-800 rounded-lg text-center cursor-pointer hover:scale-125 transition-transform"
                >
                  {stk}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </>
  );
};
