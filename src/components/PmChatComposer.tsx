import React, { forwardRef, useImperativeHandle, useRef, useState } from 'react';
import { Send } from 'lucide-react';
import type { ThemeFullStyle } from '../constants/themeStyles';

export interface PmChatComposerHandle {
  getText: () => string;
  setText: (next: string | ((prev: string) => string)) => void;
  clear: () => void;
  focus: () => void;
}

interface PmChatComposerProps {
  placeholder: string;
  curTheme: ThemeFullStyle;
  settingTextColor?: string;
  leftToolsSlot: React.ReactNode;
  onNotifyPmTyping: (isTyping: boolean) => void;
  onSendPmText: (text: string) => void;
}

export const PmChatComposer = React.memo(
  forwardRef<PmChatComposerHandle, PmChatComposerProps>(
    (
      {
        placeholder,
        curTheme,
        settingTextColor,
        leftToolsSlot,
        onNotifyPmTyping,
        onSendPmText
      },
      ref
    ) => {
      const [pmText, setPmText] = useState('');
      const textareaRef = useRef<HTMLTextAreaElement | null>(null);

      useImperativeHandle(ref, () => ({
        getText: () => pmText,
        setText: (next) => {
          setPmText((prev) => (typeof next === 'function' ? next(prev) : next));
        },
        clear: () => setPmText(''),
        focus: () => textareaRef.current?.focus()
      }));

      const handleSend = () => {
        if (!pmText.trim()) return;
        onNotifyPmTyping(false);
        onSendPmText(pmText.trim());
        setPmText('');
      };

      return (
        <div className="flex items-center gap-1">
          {leftToolsSlot}

          {/* Textarea */}
          <textarea
            ref={textareaRef}
            rows={1}
            name="chat_pm_text_freeform"
            id="chat_pm_text_freeform"
            inputMode="text"
            enterKeyHint="send"
            autoComplete="off"
            placeholder={placeholder}
            value={pmText}
            style={{ color: settingTextColor || curTheme.recommendedTextColor || '#fef3c7' }}
            onChange={(e) => {
              const val = e.target.value;
              setPmText(val);
              onNotifyPmTyping(val.trim().length > 0);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && pmText.trim()) {
                e.preventDefault();
                handleSend();
              }
            }}
            className={`flex-1 px-2 py-1 text-xs border ${curTheme.fieldBorder || 'border-slate-700'} rounded-lg ${curTheme.fieldBg || 'bg-slate-900 focus:bg-black'} ${curTheme.fieldText || 'text-slate-100'} ${curTheme.fieldPlaceholder || 'placeholder-slate-500'} outline-none ${curTheme.fieldFocus || 'focus:border-amber-500'} resize-none h-7 min-h-[28px] max-h-16 leading-tight font-medium overflow-hidden transition-all shadow-inner`}
          />

          {/* Send Button */}
          <button
            type="button"
            onClick={handleSend}
            className={`px-2 py-0.5 h-7 ${curTheme.primaryBtn || 'bg-amber-500 hover:bg-amber-600 text-black'} rounded-lg text-[11px] font-bold transition-all cursor-pointer whitespace-nowrap shadow-xs flex items-center gap-1`}
          >
            <span>إرسال</span>
            <Send className="w-2.5 h-2.5 rotate-180" />
          </button>
        </div>
      );
    }
  )
);
PmChatComposer.displayName = 'PmChatComposer';
