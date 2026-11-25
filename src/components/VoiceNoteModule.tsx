import React, { useState, useRef, useEffect, useId } from 'react';
import { Mic, Square, Trash2, Send, Play, Pause } from 'lucide-react';
import { uploadMediaWithProgress, pauseKeepAliveAudio } from '../utils/connectionKeepAlive';
import { mediaSessionManager } from '../utils/mediaSessionManager';
import { normalizePlayableAudioUrl } from '../utils/mediaUrl';

export interface VoiceNoteData {
  audioUrl: string;
  duration: number; // in seconds
}

// 1. Sleek Voice Note Recorder Component with Accurate Seconds Counter
interface VoiceRecorderProps {
  onSendVoice: (voiceData: VoiceNoteData) => void;
  onCancel: () => void;
  onError?: (errorMsg: string) => void;
}

export const VoiceRecorder: React.FC<VoiceRecorderProps> = ({ onSendVoice, onCancel, onError }) => {
  const [isRecording, setIsRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const [audioBlobUrl, setAudioBlobUrl] = useState<string | null>(null);
  const [recordedDuration, setRecordedDuration] = useState(0);
  const [isPlayingPreview, setIsPlayingPreview] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [micError, setMicError] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);
  const startTimeRef = useRef<number>(0);
  const pendingSendRef = useRef<boolean>(false);
  const audioBlobUrlRef = useRef<string | null>(null);
  const isCancelledRef = useRef<boolean>(false);

  useEffect(() => {
    startRecording();
    return () => {
      cleanup();
    };
  }, []);

  const cleanup = () => {
    isCancelledRef.current = true;
    pendingSendRef.current = false;
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (mediaRecorderRef.current) {
      try {
        if (mediaRecorderRef.current.state !== 'inactive') {
          mediaRecorderRef.current.stop();
        }
      } catch {}
      try {
        mediaRecorderRef.current.stream?.getTracks().forEach((track) => track.stop());
      } catch {}
    }
    if (previewAudioRef.current) {
      previewAudioRef.current.pause();
      previewAudioRef.current = null;
    }
  };

  const reportMicError = (msg: string) => {
    setIsRecording(false);
    setIsUploading(false);
    setMicError(msg);
    onError?.(msg);
  };

  const startRecording = async () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    isCancelledRef.current = false;
    startTimeRef.current = Date.now();
    setRecordSeconds(0);
    setRecordedDuration(0);
    setAudioBlobUrl(null);
    setMicError(null);
    audioBlobUrlRef.current = null;
    pendingSendRef.current = false;

    if (!navigator?.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      reportMicError('المتصفح الحالي لا يدعم تسجيل الصوت بالميكروفون.');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioChunksRef.current = [];

      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/ogg;codecs=opus')
        ? 'audio/ogg;codecs=opus'
        : 'audio/mp4';

      let mediaRecorder: MediaRecorder;
      try {
        mediaRecorder = new MediaRecorder(stream, { mimeType, audioBitsPerSecond: 24000 });
      } catch {
        mediaRecorder = new MediaRecorder(stream, { mimeType });
      }
      mediaRecorderRef.current = mediaRecorder;

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        if (isCancelledRef.current) return;

        const audioBlob = new Blob(audioChunksRef.current, { type: mimeType });
        const finalSec = Math.max(1, Math.floor((Date.now() - startTimeRef.current) / 1000));

        if (!audioBlob || audioBlob.size === 0) {
          reportMicError('لم يتم التقاط أي صوت من الميكروفون.');
          return;
        }

        setIsUploading(true);
        try {
          const ext = mimeType.includes('mp4') ? 'mp4' : mimeType.includes('ogg') ? 'ogg' : 'webm';
          const audioFile = new File([audioBlob], `voice_${Date.now()}.${ext}`, { type: mimeType });
          const res = await uploadMediaWithProgress(audioFile);
          if (isCancelledRef.current) return;
          setIsUploading(false);
          if (res?.url) {
            setAudioBlobUrl(res.url);
            audioBlobUrlRef.current = res.url;
            if (pendingSendRef.current) {
              pendingSendRef.current = false;
              onSendVoice({
                audioUrl: res.url,
                duration: finalSec
              });
            }
          } else {
            reportMicError('تعذر رفع التسجيل الصوتي للسيرفر.');
          }
        } catch (err) {
          console.warn('Failed to upload audio binary:', err);
          reportMicError('حدث خطأ أثناء رفع المقطع الصوتي.');
        }
      };

      mediaRecorder.start(100);
      setIsRecording(true);

      timerRef.current = setInterval(() => {
        const elapsed = Math.max(0, Math.floor((Date.now() - startTimeRef.current) / 1000));
        setRecordSeconds(elapsed);
        if (elapsed >= 120) {
          stopRecording();
        }
      }, 250);
    } catch (err: any) {
      const msg =
        err?.name === 'NotAllowedError'
          ? 'تم رفض إذن الميكروفون. يرجى تفعيل المايك من إعدادات المتصفح.'
          : 'تعذر تشغيل الميكروفون: ' + (err?.message || 'تأكد من توصيل المايك');
      reportMicError(msg);
    }
  };

  const stopRecording = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    setIsRecording(false);
    const finalSec = Math.max(1, Math.floor((Date.now() - startTimeRef.current) / 1000));
    setRecordedDuration(finalSec);
    setRecordSeconds(finalSec);

    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      try {
        mediaRecorderRef.current.stop();
      } catch (e) {
        // ignore
      }
    }
  };

  const handleSend = () => {
    if (isUploading) return;
    const finalDuration = recordedDuration || recordSeconds || Math.max(1, Math.floor((Date.now() - startTimeRef.current) / 1000));

    if (isRecording) {
      pendingSendRef.current = true;
      stopRecording();
      return;
    }

    if (audioBlobUrl || audioBlobUrlRef.current) {
      onSendVoice({
        audioUrl: audioBlobUrl || audioBlobUrlRef.current!,
        duration: finalDuration
      });
    } else {
      reportMicError('لم يجهز الملف الصوتي للإرسال بعد.');
    }
  };

  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m < 10 ? '0' : ''}${m}:${s < 10 ? '0' : ''}${s}`;
  };

  if (micError) {
    return (
      <div className="flex items-center justify-between gap-2 px-3 py-1.5 bg-rose-50 border border-rose-300 rounded-2xl w-full max-w-md shadow-xs text-xs text-rose-700 font-bold">
        <span className="truncate">{micError}</span>
        <button
          type="button"
          onClick={() => {
            cleanup();
            onCancel();
          }}
          className="px-2.5 py-1 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-[11px] shrink-0 cursor-pointer"
        >
          إغلاق
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 px-3 py-1.5 bg-rose-50 border border-rose-300 rounded-2xl animate-in fade-in duration-150 w-full max-w-md shadow-xs select-none">
      {/* Cancel button */}
      <button
        type="button"
        onClick={() => {
          cleanup();
          onCancel();
        }}
        className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-white rounded-full transition-colors cursor-pointer"
        title="إلغاء التسجيل"
      >
        <Trash2 className="w-4 h-4 text-red-500" />
      </button>

      {/* Recording status & Waveform */}
      <div className="flex-1 flex items-center gap-2">
        {isRecording ? (
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-rose-600 animate-ping" />
            <span className="text-xs font-mono font-bold text-rose-700 min-w-[45px]">
              {formatTime(recordSeconds)}
            </span>
          </div>
        ) : (
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => {
                const url = audioBlobUrl || audioBlobUrlRef.current;
                if (!previewAudioRef.current && url) {
                  const a = new Audio(url);
                  previewAudioRef.current = a;
                  a.onended = () => setIsPlayingPreview(false);
                }
                if (previewAudioRef.current) {
                  if (isPlayingPreview) {
                    previewAudioRef.current.pause();
                    setIsPlayingPreview(false);
                  } else {
                    previewAudioRef.current.play().catch(() => {});
                    setIsPlayingPreview(true);
                  }
                }
              }}
              className="p-1 bg-rose-600 text-white rounded-full hover:bg-rose-700 cursor-pointer shadow-xs"
            >
              {isPlayingPreview ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3 ml-0.5" />}
            </button>
            <span className="text-xs font-mono font-bold text-slate-800">
              {formatTime(recordedDuration || recordSeconds)}
            </span>
          </div>
        )}

        {/* Animated Sound Bars */}
        <div className="flex items-center gap-0.5 h-4 flex-1 justify-center overflow-hidden">
          {[40, 75, 55, 90, 60, 80, 45, 95, 70, 50, 85, 65, 40, 80].map((h, i) => (
            <div
              key={i}
              className={`w-1 rounded-full transition-all duration-150 ${
                isRecording ? 'bg-rose-500 animate-pulse' : 'bg-slate-300'
              }`}
              style={{
                height: isRecording ? `${Math.max(25, (h * ((recordSeconds % 3) + 1)) / 3)}%` : '35%'
              }}
            />
          ))}
        </div>
      </div>

      {/* Stop / Send Button */}
      {isRecording ? (
        <button
          type="button"
          onClick={stopRecording}
          className="px-2.5 py-1 bg-amber-600 hover:bg-amber-700 text-white rounded-xl text-xs font-bold flex items-center gap-1 cursor-pointer transition-colors shadow-xs"
        >
          <Square className="w-3 h-3" />
          <span>إيقاف</span>
        </button>
      ) : (
        <button
          type="button"
          onClick={handleSend}
          disabled={isUploading}
          className="px-3 py-1 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 disabled:cursor-not-allowed text-white rounded-xl text-xs font-bold flex items-center gap-1 cursor-pointer transition-colors shadow-xs"
        >
          <Send className="w-3 h-3 rotate-180" />
          <span>{isUploading ? 'جاري الرفع...' : 'إرسال'}</span>
        </button>
      )}
    </div>
  );
};

// 2. Custom Sleek Voice Note Player inside Chat Bubbles (يعمل في العام والخاص مع عداد الثواني + ربط شريط إشعارات الهاتف)
interface VoicePlayerProps {
  audioUrl: string;
  duration?: number;
  isMe?: boolean;
  senderName?: string;
}

export const VoicePlayer: React.FC<VoicePlayerProps> = ({ audioUrl, duration = 3, isMe = false, senderName }) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [actualDuration, setActualDuration] = useState<number>(duration || 3);
  const [playbackSpeed, setPlaybackSpeed] = useState<number>(1);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const isManualPauseRef = useRef<boolean>(false);
  const reactId = useId();
  const mediaId = `voice-note-${reactId}`;

  const formatSecs = (s: number) => {
    const total = Math.max(0, Math.floor(s));
    const m = Math.floor(total / 60);
    const sec = total % 60;
    return `${m < 10 ? '0' : ''}${m}:${sec < 10 ? '0' : ''}${sec}`;
  };

  useEffect(() => {
    setActualDuration(duration && duration > 0 ? duration : 3);
  }, [duration]);

  useEffect(() => {
    if (!audioUrl) return;

    const playableAudio = normalizePlayableAudioUrl(audioUrl);
    const a = new Audio(playableAudio);
    (a as any).playsInline = true;
    a.setAttribute('playsinline', 'true');
    a.setAttribute('webkit-playsinline', 'true');
    a.preload = 'metadata';
    audioRef.current = a;

    a.onloadedmetadata = () => {
      if (a.duration && isFinite(a.duration) && a.duration > 0) {
        const rounded = Math.round(a.duration);
        setActualDuration(rounded);
        mediaSessionManager.updateMediaState(mediaId, { duration: a.duration });
      }
    };

    a.ontimeupdate = () => {
      setCurrentTime(a.currentTime);
      mediaSessionManager.updateMediaState(mediaId, {
        currentTime: a.currentTime,
        duration: a.duration && isFinite(a.duration) && a.duration > 0 ? a.duration : actualDuration,
        playbackRate: a.playbackRate || 1
      });
    };

    a.onpause = () => {
      setIsPlaying(false);
      if (!isManualPauseRef.current && !a.ended) {
        mediaSessionManager.notifyUnexpectedElementPause(mediaId);
      }
      isManualPauseRef.current = false;
    };

    a.onplay = () => {
      isManualPauseRef.current = false;
      setIsPlaying(true);
      mediaSessionManager.updateMediaState(mediaId, { isPlaying: true });
    };

    a.onended = () => {
      isManualPauseRef.current = true;
      setIsPlaying(false);
      setCurrentTime(0);
      mediaSessionManager.deactivateMedia(mediaId);
    };

    return () => {
      isManualPauseRef.current = true;
      mediaSessionManager.deactivateMedia(mediaId);
      a.pause();
      a.src = '';
    };
  }, [audioUrl]);

  const registerAndPlay = () => {
    const a = audioRef.current;
    if (!a) return;

    pauseKeepAliveAudio();

    const effectiveDur =
      a.duration && isFinite(a.duration) && a.duration > 0 ? a.duration : Math.max(1, actualDuration);
    const clipTitle = senderName
      ? `🎙️ ملاحظة صوتية من ${senderName}`
      : '🎙️ ملاحظة صوتية في الدردشة';

    mediaSessionManager.activateMedia({
      id: mediaId,
      kind: 'voice-note',
      title: clipTitle,
      artist: `المدة ${formatSecs(effectiveDur)} • شات حسان برو`,
      album: 'الملاحظات الصوتية',
      artworkUrl: '/pwa-192x192.png',
      duration: effectiveDur,
      currentTime: a.currentTime || 0,
      playbackRate: playbackSpeed,
      isPlaying: true,
      onPlay: () => {
        if (!audioRef.current) return;
        audioRef.current.playbackRate = playbackSpeed;
        audioRef.current.play().catch(() => {});
        setIsPlaying(true);
      },
      onPause: () => {
        if (!audioRef.current) return;
        isManualPauseRef.current = true;
        audioRef.current.pause();
        setIsPlaying(false);
      },
      onStop: () => {
        if (!audioRef.current) return;
        isManualPauseRef.current = true;
        audioRef.current.pause();
        audioRef.current.currentTime = 0;
        setCurrentTime(0);
        setIsPlaying(false);
        mediaSessionManager.deactivateMedia(mediaId);
      },
      onSeekTo: (time: number) => {
        if (!audioRef.current) return;
        audioRef.current.currentTime = Math.max(0, Math.min(effectiveDur, time));
        setCurrentTime(audioRef.current.currentTime);
      },
      onInterruptPause: () => {
        if (!audioRef.current) return;
        isManualPauseRef.current = true;
        audioRef.current.pause();
        setIsPlaying(false);
      },
      onInterruptResume: () => {
        if (!audioRef.current) return;
        audioRef.current.playbackRate = playbackSpeed;
        audioRef.current.play().catch(() => {});
        setIsPlaying(true);
      }
    });

    a.playbackRate = playbackSpeed;
    a.play().catch(() => {});
    setIsPlaying(true);
  };

  const togglePlay = () => {
    if (!audioRef.current) return;
    if (isPlaying) {
      isManualPauseRef.current = true;
      audioRef.current.pause();
      setIsPlaying(false);
      mediaSessionManager.updateMediaState(mediaId, { isPlaying: false });
    } else {
      registerAndPlay();
    }
  };

  const toggleSpeed = () => {
    const speeds = [1, 1.5, 2];
    const nextIdx = (speeds.indexOf(playbackSpeed) + 1) % speeds.length;
    const nextSpeed = speeds[nextIdx];
    setPlaybackSpeed(nextSpeed);
    if (audioRef.current) {
      audioRef.current.playbackRate = nextSpeed;
      mediaSessionManager.updateMediaState(mediaId, { playbackRate: nextSpeed });
    }
  };

  const effectiveDuration = Math.max(1, actualDuration);
  const progressPercent = Math.min(100, (currentTime / effectiveDuration) * 100);

  return (
    <div
      className={`flex items-center gap-2.5 py-1.5 px-3 rounded-2xl select-none min-w-[210px] sm:min-w-[250px] max-w-full shadow-xs ${
        isMe
          ? 'bg-amber-950/50 text-amber-100 border border-amber-700/60'
          : 'bg-white/95 text-slate-800 border border-slate-200 shadow-sm'
      }`}
      dir="ltr"
    >
      {/* Play/Pause Button */}
      <button
        type="button"
        onClick={togglePlay}
        className={`w-8 h-8 rounded-full flex items-center justify-center transition-transform active:scale-95 flex-shrink-0 shadow-xs cursor-pointer ${
          isMe ? 'bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold' : 'bg-indigo-600 hover:bg-indigo-700 text-white'
        }`}
      >
        {isPlaying ? <Pause className="w-4 h-4 fill-current" /> : <Play className="w-4 h-4 fill-current ml-0.5" />}
      </button>

      {/* Waveform & Scrubber */}
      <div className="flex-1 flex flex-col justify-center gap-1 min-w-0">
        <div
          className="relative h-6 flex items-center gap-[2.5px] cursor-pointer"
          onClick={(e) => {
            if (!audioRef.current || effectiveDuration <= 0) return;
            const rect = e.currentTarget.getBoundingClientRect();
            const clickPos = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
            const newTime = clickPos * effectiveDuration;
            audioRef.current.currentTime = newTime;
            setCurrentTime(newTime);
          }}
        >
          {/* Simulated Waveform Bars */}
          {[25, 45, 80, 50, 95, 60, 40, 75, 90, 55, 30, 70, 85, 45, 60, 90, 75, 40, 65, 35].map((h, i) => {
            const barPercent = (i / 20) * 100;
            const isFilled = barPercent <= progressPercent;
            return (
              <div
                key={i}
                className="w-[3px] rounded-full transition-all"
                style={{
                  height: `${h}%`,
                  backgroundColor: isFilled
                    ? isMe
                      ? '#f59e0b'
                      : '#4f46e5'
                    : isMe
                    ? 'rgba(245, 158, 11, 0.3)'
                    : 'rgba(100, 116, 139, 0.3)'
                }}
              />
            );
          })}
        </div>

        {/* Time display: shows seconds counter accurately during playback and total duration when paused */}
        <div className="flex items-center justify-between text-[10px] font-mono leading-none opacity-90">
          <span className="font-bold">
            {isPlaying
              ? `${formatSecs(currentTime)} / ${formatSecs(effectiveDuration)}`
              : `${formatSecs(effectiveDuration)}`}
          </span>
          <span className="flex items-center gap-1 font-sans text-[10px] text-amber-500 font-bold">
            <Mic className="w-2.5 h-2.5" />
            <span>تسجيل صوتي</span>
          </span>
        </div>
      </div>

      {/* Speed Multiplier Pill */}
      <button
        type="button"
        onClick={toggleSpeed}
        className={`px-1.5 py-0.5 rounded text-[10px] font-bold font-mono transition-colors cursor-pointer flex-shrink-0 ${
          isMe ? 'bg-amber-900/70 hover:bg-amber-800 text-amber-200' : 'bg-slate-200 hover:bg-slate-300 text-slate-700'
        }`}
        title="تغيير سرعة الصوت"
      >
        {playbackSpeed}x
      </button>
    </div>
  );
};
