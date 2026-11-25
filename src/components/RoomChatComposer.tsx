import React, { forwardRef, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { Image as ImageIcon, LogOut, Mic, Send, X } from 'lucide-react';
import type { User } from '../types/chat';
import type { ChatShortcut } from '../utils/chatShortcuts';
import { findMatchingShortcut } from '../utils/chatShortcuts';
import type { ThemeFullStyle } from '../constants/themeStyles';

export interface RoomChatComposerHandle {
  getText: () => string;
  setText: (next: string | ((prev: string) => string)) => void;
  appendToken: (token: string) => void;
  insertFormat: (prefix: string, suffix?: string) => void;
  insertMention: (targetUsername: string) => void;
  clear: () => void;
  focus: () => void;
}

interface RoomChatComposerProps {
  currentUser: User;
  rosterUsers: User[];
  shortcuts: ChatShortcut[];
  curTheme: ThemeFullStyle;
  settingTextColor?: string;
  falconIcon: string;
  isRecordingVoice: boolean;
  isEmojiPickerOpen: boolean;
  isMediaPickerOpen: boolean;
  isPlusMenuOpen: boolean;
  voiceRecorderNode?: React.ReactNode;
  middleSlot?: React.ReactNode;
  onNotifyTyping: (isTyping: boolean) => void;
  onSendMessageText: (text: string) => void;
  onLeaveCurrentRoom: () => void;
  onToggleEmojiPicker: () => void;
  onToggleMediaPicker: () => void;
  onStartVoiceRecording: () => void;
  onTogglePlusMenu: () => void;
  onInputFocusScroll: () => void;
  onInputFocusChange?: (focused: boolean) => void;
}

export const RoomChatComposer = React.memo(
  forwardRef<RoomChatComposerHandle, RoomChatComposerProps>(
    (
      {
        currentUser,
        rosterUsers,
        shortcuts,
        curTheme,
        settingTextColor,
        falconIcon,
        isRecordingVoice,
        voiceRecorderNode,
        middleSlot,
        onNotifyTyping,
        onSendMessageText,
        onLeaveCurrentRoom,
        onToggleEmojiPicker,
        onToggleMediaPicker,
        onStartVoiceRecording,
        onTogglePlusMenu,
        onInputFocusScroll,
        onInputFocusChange
      },
      ref
    ) => {
      const [text, setText] = useState('');
      const [mentionQuery, setMentionQuery] = useState<string | null>(null);
      const inputRef = useRef<HTMLTextAreaElement | null>(null);

      const handleChangeText = (val: string) => {
        setText(val);
        onNotifyTyping(val.trim().length > 0);
        const cursor = inputRef.current?.selectionStart ?? val.length;
        const textBeforeCursor = val.slice(0, cursor);
        const atMatch = textBeforeCursor.match(/@([^\s]*)$/);
        if (atMatch) {
          setMentionQuery(atMatch[1].toLowerCase());
        } else if (mentionQuery !== null) {
          setMentionQuery(null);
        }
      };

      const insertMentionInternal = (targetUsername: string) => {
        setText((prev) => {
          const cursor = inputRef.current?.selectionStart ?? prev.length;
          const textBeforeCursor = prev.slice(0, cursor);
          const textAfterCursor = prev.slice(cursor);
          const atIndex = textBeforeCursor.lastIndexOf('@');
          if (atIndex !== -1) {
            return textBeforeCursor.slice(0, atIndex) + `@${targetUsername} ` + textAfterCursor;
          }
          return prev ? `${prev} @${targetUsername} ` : `@${targetUsername} `;
        });
        setMentionQuery(null);
        inputRef.current?.focus();
      };

      useImperativeHandle(ref, () => ({
        getText: () => text,
        setText: (next) => {
          setText((prev) => (typeof next === 'function' ? next(prev) : next));
        },
        appendToken: (token) => {
          setText((prev) => (prev ? `${prev} ${token} ` : `${token} `));
        },
        insertFormat: (prefix, suffix = '') => {
          const input = inputRef.current;
          if (!input) {
            setText((prev) => prev + prefix + 'نص' + suffix);
            return;
          }
          const start = input.selectionStart || 0;
          const end = input.selectionEnd || 0;
          setText((current) => {
            const selected = current.substring(start, end);
            const replacement = prefix + (selected || 'نص') + suffix;
            const nextText = current.substring(0, start) + replacement + current.substring(end);
            setTimeout(() => {
              input.focus();
              input.setSelectionRange(
                start + prefix.length,
                start + prefix.length + (selected || 'نص').length
              );
            }, 50);
            return nextText;
          });
        },
        insertMention: insertMentionInternal,
        clear: () => {
          setText('');
          setMentionQuery(null);
        },
        focus: () => {
          inputRef.current?.focus();
        }
      }));

      const mentionSuggestions = useMemo(() => {
        if (mentionQuery === null) return [];
        const results: User[] = [];
        for (let i = 0; i < rosterUsers.length; i++) {
          const u = rosterUsers[i];
          if (
            u.username !== currentUser?.username &&
            u.username.toLowerCase().includes(mentionQuery)
          ) {
            results.push(u);
            if (results.length >= 6) break;
          }
        }
        return results;
      }, [mentionQuery, rosterUsers, currentUser?.username]);

      const matchedShortcut = useMemo(
        () => (text ? findMatchingShortcut(text, shortcuts) : null),
        [text, shortcuts]
      );

      const handleSend = () => {
        const trimmed = text.trim();
        if (!trimmed) return;
        onSendMessageText(text);
        setText('');
        setMentionQuery(null);
        inputRef.current?.focus();
      };

      return (
        <>
          {/* Mention Autocomplete Suggestions Popup */}
          {mentionQuery !== null && mentionSuggestions.length > 0 && (
            <>
              <div className="fixed inset-0 z-25" onClick={() => setMentionQuery(null)} />
              <div className="absolute bottom-16 right-10 w-52 max-h-48 overflow-y-auto bg-white border border-slate-300 rounded-xl shadow-2xl z-30 divide-y divide-slate-100 animate-in fade-in duration-150">
                <div className="p-1.5 bg-amber-50 text-[10px] font-bold text-amber-900 flex items-center justify-between">
                  <span>منشن سريع للأعضاء (@):</span>
                  <button
                    type="button"
                    onClick={() => setMentionQuery(null)}
                    className="text-slate-400 hover:text-slate-600 cursor-pointer"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
                {mentionSuggestions.map((u) => (
                  <button
                    key={u.id}
                    type="button"
                    onClick={() => insertMentionInternal(u.username)}
                    className="w-full p-2 text-right hover:bg-amber-100/60 flex items-center gap-2 transition-colors cursor-pointer"
                  >
                    <img
                      src={u.avatarUrl || falconIcon}
                      alt={u.username}
                      loading="lazy"
                      decoding="async"
                      className="w-6 h-6 rounded-full object-cover border border-slate-300"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-bold text-slate-800 truncate">{u.username}</div>
                      <div className="text-[9px] text-slate-500 font-mono">
                        {u.role === 'hassan'
                          ? 'الإدارة العليا'
                          : u.role === 'admin'
                          ? 'إداري'
                          : u.role === 'super'
                          ? 'مشرف'
                          : 'عضو'}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </>
          )}

          {/* Active Shortcut Preview Banner */}
          {matchedShortcut && (
            <div className="mb-1 px-2 py-1 bg-gradient-to-r from-amber-500/15 via-amber-50 to-amber-500/15 border border-amber-400 rounded-lg flex items-center justify-between text-[11px] text-amber-950 shadow-xs animate-in fade-in">
              <div className="flex items-center gap-1 min-w-0">
                <span className="px-1.5 py-0.2 rounded bg-amber-500 text-white font-mono font-black text-[9.5px] shrink-0">
                  ⚡ [{matchedShortcut.trigger}]
                </span>
                <span className="text-amber-700 font-bold shrink-0">➔</span>
                <span className="truncate text-slate-800 font-bold text-[11px] max-w-[170px] sm:max-w-sm">
                  "{matchedShortcut.replacement}"
                </span>
              </div>
              <span className="text-[9.5px] text-amber-800 font-bold bg-amber-200/80 px-1.5 py-0.2 rounded-full shrink-0">
                اختصار ⚡
              </span>
            </div>
          )}

          {middleSlot}

          {isRecordingVoice ? (
            voiceRecorderNode
          ) : (
            <div className="flex items-center gap-0.5 sm:gap-1 w-full max-w-full">
              {/* Exit Room Button */}
              <button
                type="button"
                onClick={onLeaveCurrentRoom}
                disabled={
                  currentUser?.room === 'خارج الغرف' ||
                  Boolean(currentUser?.isJailed) ||
                  currentUser?.room === 'سجن حسان برو'
                }
                className="w-6 h-6 sm:w-7 sm:h-7 rounded-md text-rose-500 hover:text-white hover:bg-rose-600 disabled:opacity-40 disabled:pointer-events-none border border-rose-300 flex items-center justify-center transition-all cursor-pointer flex-shrink-0 shadow-2xs"
                title={
                  currentUser?.room === 'خارج الغرف'
                    ? 'أنت خارج الغرف حالياً'
                    : currentUser?.isJailed || currentUser?.room === 'سجن حسان برو'
                    ? 'لا يمكنك الخروج أثناء التقييد في السجن'
                    : 'الخروج من الغرفة الحالية فقط والعودة لقائمة الغرف'
                }
              >
                <LogOut className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
              </button>

              {/* Emoji yellow smiley 😊 */}
              <button
                type="button"
                onClick={onToggleEmojiPicker}
                className="w-6 h-6 sm:w-7 sm:h-7 rounded-md text-sm sm:text-base flex items-center justify-center hover:bg-slate-200 transition-all cursor-pointer flex-shrink-0"
                title="الرموز التعبيرية"
              >
                😊
              </button>

              {/* Media Image Button */}
              <button
                type="button"
                onClick={onToggleMediaPicker}
                className="w-6 h-6 sm:w-7 sm:h-7 rounded-md text-slate-600 hover:text-indigo-600 flex items-center justify-center transition-all cursor-pointer flex-shrink-0 hover:bg-slate-200"
                title="إرسال صورة"
              >
                <ImageIcon className="w-3.5 h-3.5 text-rose-500" />
              </button>

              {/* Voice Recording Button */}
              <button
                type="button"
                onClick={onStartVoiceRecording}
                className="w-6 h-6 sm:w-7 sm:h-7 rounded-md text-slate-600 hover:text-rose-600 flex items-center justify-center transition-all cursor-pointer flex-shrink-0 hover:bg-slate-200"
                title="تسجيل مقطع صوتي 🎙️"
              >
                <Mic className="w-3.5 h-3.5 text-rose-600" />
              </button>

              {/* Textarea Input */}
              <textarea
                ref={inputRef}
                rows={1}
                name="chat_room_text_freeform"
                id="chat_room_text_freeform"
                inputMode="text"
                enterKeyHint="send"
                autoComplete="off"
                autoCorrect="on"
                autoCapitalize="sentences"
                spellCheck={true}
                data-form-type="other"
                data-lpignore="true"
                data-1p-ignore="true"
                data-bwignore="true"
                data-protonpass-ignore="true"
                data-keeper-ignore="true"
                aria-autocomplete="none"
                role="textbox"
                value={text}
                onChange={(e) => handleChangeText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSend();
                  }
                }}
                onFocus={() => {
                  onInputFocusChange?.(true);
                  onInputFocusScroll();
                }}
                onBlur={() => {
                  setTimeout(() => onInputFocusChange?.(false), 200);
                }}
                style={{ color: settingTextColor || curTheme.recommendedTextColor || '#fef3c7' }}
                placeholder="اكتب رسالتك، واستخدم @ للمنشن"
                maxLength={400}
                className={`flex-1 min-w-0 px-1.5 py-1 ${curTheme.fieldBg || 'bg-white'} border ${curTheme.fieldBorder || 'border-slate-300'} rounded-md ${curTheme.fieldText || 'text-slate-900'} ${curTheme.fieldPlaceholder || 'placeholder-slate-400'} text-xs sm:text-sm font-medium outline-none ${curTheme.fieldFocus || 'focus:border-amber-600 focus:ring-1 focus:ring-amber-600'} resize-none h-7 leading-tight overflow-hidden transition-all shadow-inner`}
              />

              {/* [+] Button */}
              <button
                type="button"
                onClick={onTogglePlusMenu}
                className={`w-6 h-7 rounded-md ${curTheme.cardBg || 'bg-[#2a241e]'} ${curTheme.accentText || 'text-amber-200'} border ${curTheme.cardBorder || 'border-amber-800/60'} font-bold text-xs flex items-center justify-center hover:opacity-90 transition-all cursor-pointer flex-shrink-0 shadow-xs`}
                title="خيارات إضافية"
              >
                +
              </button>

              {/* [إرسال ✈] button */}
              <button
                type="button"
                onClick={handleSend}
                disabled={!text.trim()}
                className={`h-7 px-1.5 sm:px-2 rounded-md ${curTheme.primaryBtn || 'bg-amber-500 hover:bg-amber-600 text-black'} disabled:opacity-40 font-black text-[10.5px] sm:text-[11px] flex items-center gap-0.5 transition-all cursor-pointer flex-shrink-0 shadow-sm whitespace-nowrap z-10`}
                title="إرسال الرسالة للغرفة"
              >
                <span>إرسال</span>
                <Send className="w-2.5 h-2.5 sm:w-3 sm:h-3 rotate-180" />
              </button>
            </div>
          )}
        </>
      );
    }
  )
);
RoomChatComposer.displayName = 'RoomChatComposer';
