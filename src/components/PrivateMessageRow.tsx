import React from 'react';
import {
  Check,
  CheckCheck,
  Edit3,
  Flame,
  PhoneCall,
  Play,
  Reply,
  Trash2
} from 'lucide-react';
import type { PrivateMessage } from '../types/chat';
import { getAutoContrastMessageTextColor } from '../constants/themeStyles';
import { VoicePlayer } from './VoiceNoteModule';
import { isVideoMediaUrl, normalizePlayableVideoUrl, optimizeCloudinaryImageUrl } from '../utils/mediaUrl';
import { renderFormattedMessageText, SelfDestructCountdown } from '../utils/messageFormatting';

export interface PrivateMessageRowProps {
  pm: PrivateMessage;
  isMe: boolean;
  timeLabel: string;
  senderBannerUrl?: string;
  senderDisplayName: string;
  isEditing: boolean;
  editingText: string;
  bubbleStyle: string;
  isNightMode: boolean;
  isHighContrastMode: boolean;
  onOpenUserProfileByName: (username: string) => void;
  onReply: (pm: PrivateMessage) => void;
  onStartEdit: (pm: PrivateMessage) => void;
  onChangeEditingText: (val: string) => void;
  onSaveEdit: (pmId: string, text: string) => void;
  onCancelEdit: () => void;
  onDelete: (pmId: string) => void;
  onOpenMedia: (viewer: { url: string; type: 'image' | 'video'; title: string }) => void;
}

export const PrivateMessageRow: React.FC<PrivateMessageRowProps> = React.memo(
  ({
    pm,
    isMe,
    timeLabel,
    senderBannerUrl,
    senderDisplayName,
    isEditing,
    editingText,
    bubbleStyle,
    isNightMode,
    isHighContrastMode,
    onOpenUserProfileByName,
    onReply,
    onStartEdit,
    onChangeEditingText,
    onSaveEdit,
    onCancelEdit,
    onDelete,
    onOpenMedia
  }) => {
    if (pm.isCallNotification) {
      return (
        <div className="flex justify-center my-1">
          <div className="px-2.5 py-0.5 bg-slate-800/90 text-slate-200 rounded-full text-[10px] font-bold flex items-center gap-1.5 shadow-2xs border border-slate-700">
            <PhoneCall className="w-3 h-3 text-emerald-400" />
            <span>{pm.text}</span>
            <span className="text-[9px] text-slate-400 font-mono">({timeLabel})</span>
          </div>
        </div>
      );
    }

    const isPendingDelivery = pm.deliveryState === 'sending' || pm.deliveryState === 'queued';

    return (
      <div
        id={`pm-msg-${pm.id}`}
        className={`flex flex-col ${isMe ? 'items-end' : 'items-start'} my-0.2 sm:my-0.5 ${
          isPendingDelivery ? 'opacity-75' : ''
        }`}
      >
        <div
          className={`px-2 py-0.5 sm:px-2.5 sm:py-1 w-fit max-w-[90%] text-[11px] sm:text-xs leading-snug shadow-2xs [overflow-wrap:anywhere] break-words transition-all ${
            bubbleStyle === 'transparent'
              ? isMe
                ? 'bg-transparent border-b-2 border-amber-500/50 text-amber-200 shadow-none px-1.5 py-0.5'
                : isNightMode
                ? 'bg-transparent border-b-2 border-slate-700/70 text-slate-100 shadow-none px-1.5 py-0.5'
                : 'bg-transparent border-b-2 border-slate-300 text-slate-800 shadow-none px-1.5 py-0.5'
              : bubbleStyle === 'pill'
              ? isMe
                ? isNightMode
                  ? 'rounded-full px-3 py-1 bg-[#241a12] text-amber-100 border border-amber-600/50 shadow-xs'
                  : 'rounded-full px-3 py-1 bg-amber-50 text-slate-900 border border-amber-300 shadow-2xs'
                : isNightMode
                ? 'rounded-full px-3 py-1 bg-[#161f33] text-slate-100 border border-slate-700/80 shadow-xs'
                : 'rounded-full px-3 py-1 bg-white text-slate-900 border border-slate-200 shadow-2xs'
              : bubbleStyle === 'classic' || bubbleStyle === 'vintage'
              ? isMe
                ? isNightMode
                  ? 'rounded-xs border-2 border-amber-500/70 bg-[#241a12] text-amber-100 shadow-xs font-medium'
                  : 'rounded-xs border-2 border-amber-300 bg-amber-50/90 text-slate-900 shadow-2xs font-medium'
                : isNightMode
                ? 'rounded-xs border-2 border-slate-700 bg-[#161f33] text-slate-100 shadow-xs font-medium'
                : 'rounded-xs border-2 border-slate-300 bg-white text-slate-900 shadow-2xs font-medium'
              : bubbleStyle === 'glass'
              ? isMe
                ? isNightMode
                  ? 'rounded-xl backdrop-blur-md bg-amber-950/60 border border-amber-500/50 text-amber-100 shadow-md'
                  : 'rounded-xl backdrop-blur-md bg-amber-100/80 border border-amber-300/70 text-slate-900 shadow-xs'
                : isNightMode
                ? 'rounded-xl backdrop-blur-md bg-slate-900/80 border border-slate-700/60 text-slate-100 shadow-md'
                : 'rounded-xl backdrop-blur-md bg-white/80 border border-white/60 text-slate-900 shadow-xs'
              : bubbleStyle === 'sharp'
              ? isMe
                ? isNightMode
                  ? 'rounded-tl-xl rounded-br-xl rounded-tr-xs rounded-bl-xs border-r-3 border-amber-500 bg-[#241a12] text-amber-100 shadow-xs'
                  : 'rounded-tl-xl rounded-br-xl rounded-tr-xs rounded-bl-xs border-r-3 border-amber-400 bg-amber-50/90 text-slate-900 shadow-2xs'
                : isNightMode
                ? 'rounded-tl-xl rounded-br-xl rounded-tr-xs rounded-bl-xs border-r-3 border-slate-500 bg-[#161f33] text-slate-100 shadow-xs'
                : 'rounded-tl-xl rounded-br-xl rounded-tr-xs rounded-bl-xs border-r-3 border-slate-400 bg-white text-slate-900 shadow-2xs'
              : bubbleStyle === 'speech'
              ? isMe
                ? isNightMode
                  ? 'rounded-xl rounded-tr-xs bg-[#241a12] text-amber-100 border border-amber-600/50 shadow-xs'
                  : 'rounded-xl rounded-tr-xs bg-amber-50/90 text-slate-900 border border-amber-200/90 shadow-2xs'
                : isNightMode
                ? 'rounded-xl rounded-tl-xs bg-[#161f33] text-slate-100 border border-slate-700/80 shadow-xs'
                : 'rounded-xl rounded-tl-xs bg-white text-slate-900 border border-slate-200/90 shadow-2xs'
              : bubbleStyle === 'neon'
              ? isMe
                ? 'rounded-xl shadow-xs shadow-amber-500/30 border-2 border-amber-500 bg-[#241a12] text-amber-100'
                : 'rounded-xl shadow-xs shadow-indigo-500/25 border-2 border-indigo-400/70 bg-[#161f33] text-slate-100'
              : bubbleStyle === 'compact'
              ? isMe
                ? isNightMode
                  ? 'rounded-md py-0.5 px-2 text-xs border border-amber-600/50 bg-[#241a12] text-amber-100 shadow-xs'
                  : 'rounded-md py-0.5 px-2 text-xs border border-amber-200 bg-amber-50/90 text-slate-900 shadow-2xs'
                : isNightMode
                ? 'rounded-md py-0.5 px-2 text-xs border border-slate-700 bg-[#161f33] text-slate-100 shadow-xs'
                : 'rounded-md py-0.5 px-2 text-xs border border-slate-200 bg-white text-slate-900 shadow-2xs'
              : bubbleStyle === 'royal-gold'
              ? isMe
                ? 'rounded-xl border-2 border-amber-400 bg-gradient-to-r from-amber-950/90 to-yellow-950/80 text-amber-100 font-medium shadow-sm'
                : 'rounded-xl border border-amber-500/40 bg-gradient-to-r from-slate-900 via-[#1e1710] to-slate-900 text-slate-100 shadow-sm'
              : isMe
              ? isNightMode
                ? 'bg-[#241a12] text-amber-200 text-right rounded-tr-xs rounded-xl border border-amber-900/60 shadow-xs'
                : 'bg-amber-50 text-slate-900 text-right rounded-tr-xs rounded-xl border border-amber-200 shadow-2xs'
              : isNightMode
              ? 'bg-[#182338] border border-slate-700/80 text-slate-100 text-right rounded-tl-xs rounded-xl shadow-xs'
              : 'bg-white border border-slate-200 text-slate-900 text-right rounded-tl-xs rounded-xl shadow-2xs'
          }`}
        >
          <div className="flex items-center justify-between gap-1.5 text-[9px] mb-0">
            <div className="flex items-center gap-1">
              {senderBannerUrl ? (
                <img
                  src={senderBannerUrl}
                  alt={pm.fromUsername}
                  title={pm.fromUsername}
                  loading="lazy"
                  decoding="async"
                  onClick={() => onOpenUserProfileByName(pm.fromUsername)}
                  className="h-3.5 max-h-[16px] max-w-[100px] sm:max-w-[130px] object-contain rounded inline-block cursor-pointer hover:opacity-90"
                />
              ) : (
                <span
                  onClick={() => onOpenUserProfileByName(pm.fromUsername)}
                  className={`font-bold cursor-pointer hover:underline text-[10px] sm:text-[11px] ${
                    isMe ? 'text-amber-400' : 'text-indigo-600'
                  }`}
                >
                  {isMe ? 'أنت' : senderDisplayName}
                </span>
              )}
            </div>
            {!isPendingDelivery && (
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => onReply(pm)}
                  className="text-slate-400 hover:text-amber-500 cursor-pointer flex items-center gap-0.5 text-[8px] font-bold"
                  title="رد على هذه الرسالة"
                >
                  <Reply className="w-2.5 h-2.5 rotate-180" />
                  <span>رد</span>
                </button>
                {isMe && !pm.voiceNote && !pm.mediaUrl && (
                  <button
                    type="button"
                    onClick={() => onStartEdit(pm)}
                    className="text-slate-400 hover:text-blue-500 p-0.5 transition-colors cursor-pointer"
                    title="تعديل الرسالة ✏️"
                  >
                    <Edit3 className="w-2.5 h-2.5 text-blue-400" />
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => onDelete(pm.id)}
                  className="text-slate-400 hover:text-rose-600 p-0.5 transition-colors cursor-pointer"
                  title="حذف الرسالة 🗑️"
                >
                  <Trash2 className="w-2.5 h-2.5 text-rose-500" />
                </button>
              </div>
            )}
          </div>

          {pm.replyTo && (
            <div
              onClick={() => {
                const el = document.getElementById(`pm-msg-${pm.replyTo?.id}`);
                if (el) {
                  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                  el.classList.add('ring-2', 'ring-amber-500');
                  setTimeout(() => el.classList.remove('ring-2', 'ring-amber-500'), 2000);
                }
              }}
              className={`mb-0.5 px-1.5 py-0.2 rounded text-[8px] cursor-pointer ${
                isMe
                  ? 'bg-amber-950/60 text-amber-300 border-r-2 border-amber-400'
                  : 'bg-slate-100 text-slate-700 border-r-2 border-indigo-500'
              }`}
            >
              <div className="font-bold flex items-center gap-0.5 text-[8px]">
                <Reply className="w-2 h-2 rotate-180" />
                <span>رد على:</span>
                <span>@{pm.replyTo.username}</span>
              </div>
              <div className="truncate max-w-[180px]">{pm.replyTo.text}</div>
            </div>
          )}

          {pm.voiceNote && (
            <div className="my-0.5">
              <VoicePlayer
                audioUrl={pm.voiceNote.audioUrl}
                duration={pm.voiceNote.duration}
                isMe={isMe}
                senderName={pm.fromUsername}
              />
            </div>
          )}

          {isEditing ? (
            <div className="my-1 p-1.5 bg-white/95 text-slate-800 rounded-xl space-y-1 shadow-sm text-right">
              <input
                type="text"
                value={editingText}
                onChange={(e) => onChangeEditingText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') onSaveEdit(pm.id, editingText);
                  if (e.key === 'Escape') onCancelEdit();
                }}
                className="w-full p-1 text-xs bg-slate-50 border border-blue-400 rounded-lg outline-none font-medium"
                autoFocus
              />
              <div className="flex items-center justify-end gap-1">
                <button
                  type="button"
                  onClick={() => onSaveEdit(pm.id, editingText)}
                  className="px-2 py-0.5 bg-blue-600 hover:bg-blue-700 text-white rounded text-[9px] font-bold cursor-pointer"
                >
                  حفظ
                </button>
                <button
                  type="button"
                  onClick={onCancelEdit}
                  className="px-2 py-0.5 bg-slate-200 hover:bg-slate-300 text-slate-700 rounded text-[9px] font-bold cursor-pointer"
                >
                  إلغاء
                </button>
              </div>
            </div>
          ) : (
            pm.text && (
              <div
                style={{
                  color: getAutoContrastMessageTextColor({
                    isMe,
                    isNight: isNightMode,
                    forceHighContrast: isHighContrastMode
                  })
                }}
                className="whitespace-pre-wrap [overflow-wrap:anywhere] break-words text-xs font-medium select-text"
                dir="auto"
              >
                {renderFormattedMessageText(pm.text)}
                {pm.isEdited && (
                  <span className="text-[9px] text-amber-400/90 font-normal mr-1 select-none">(معدلة ✏️)</span>
                )}
              </div>
            )
          )}

          {pm.mediaUrl && (
            <div
              onClick={() => {
                const url = pm.mediaUrl;
                if (!url) return;
                const isVid = isVideoMediaUrl(url, (pm as any).mediaType);
                onOpenMedia({
                  url: isVid ? normalizePlayableVideoUrl(url) : url,
                  type: isVid ? 'video' : 'image',
                  title: `وسائط من @${pm.fromUsername}`
                });
              }}
              className="mt-1 cursor-pointer relative group rounded-lg overflow-hidden border border-slate-300 max-h-36"
              title="انقر لعرض وتكبير الوسائط"
            >
              {isVideoMediaUrl(pm.mediaUrl, (pm as any).mediaType) ? (
                <div className="relative bg-black max-h-36 w-full flex items-center justify-center">
                  <video
                    src={normalizePlayableVideoUrl(pm.mediaUrl)}
                    preload="metadata"
                    playsInline
                    muted
                    className="max-h-36 object-cover w-full"
                  />
                  <div className="absolute inset-0 bg-black/40 flex items-center justify-center group-hover:bg-black/20">
                    <div className="w-8 h-8 rounded-full bg-amber-500 flex items-center justify-center text-white shadow-lg">
                      <Play className="w-4 h-4 fill-white ml-0.5" />
                    </div>
                  </div>
                </div>
              ) : (
                <img
                  src={optimizeCloudinaryImageUrl(pm.mediaUrl, { maxWidth: 960 }) || pm.mediaUrl}
                  alt="media"
                  loading="lazy"
                  decoding="async"
                  className="rounded-lg max-h-36 object-cover border group-hover:opacity-90 transition-opacity"
                />
              )}
            </div>
          )}

          {pm.selfDestructAt && (
            <div className="mt-0.5 flex items-center gap-1 px-1.5 py-0.2 rounded bg-rose-950/80 border border-rose-500/40 text-rose-300 text-[9px] font-mono shadow-xs animate-pulse w-fit">
              <Flame className="w-3 h-3 text-rose-400 animate-bounce" />
              <span>تختفي خلال:</span>
              <SelfDestructCountdown targetAt={pm.selfDestructAt} />
            </div>
          )}

          <div
            className={`text-[9px] font-mono mt-0.5 flex items-center gap-1 ${
              isMe ? 'text-amber-300/70 justify-end' : 'text-slate-400 justify-start'
            }`}
          >
            <span title={pm.timestamp ? new Date(pm.timestamp).toLocaleString('ar-EG') : undefined}>
              {timeLabel}
            </span>
            {isMe && (
              <span className="inline-flex items-center gap-0.5 select-none">
                {pm.deliveryState === 'queued' ? (
                  <span className="text-[8px] font-sans text-amber-300 font-bold">بانتظار الشبكة ⏳</span>
                ) : pm.deliveryState === 'sending' ? (
                  <span className="text-[8px] font-sans text-amber-300/90">جاري الإرسال...</span>
                ) : pm.status === 'read' ? (
                  <span className="inline-flex items-center gap-0.5 text-sky-400 font-bold" title="تمت القراءة">
                    <CheckCheck className="w-3 h-3 text-sky-400" />
                    <span className="text-[8px] font-sans">مقروءة</span>
                  </span>
                ) : pm.status === 'delivered' ? (
                  <span className="inline-flex items-center gap-0.5 text-slate-400" title="مستلمة">
                    <CheckCheck className="w-3 h-3 text-slate-400" />
                    <span className="text-[8px] font-sans">مستلمة</span>
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-0.5 text-slate-400" title="أُرسلت">
                    <Check className="w-2.5 h-2.5 text-slate-400" />
                    <span className="text-[8px] font-sans">أُرسلت</span>
                  </span>
                )}
              </span>
            )}
          </div>
        </div>
      </div>
    );
  }
);
PrivateMessageRow.displayName = 'PrivateMessageRow';
