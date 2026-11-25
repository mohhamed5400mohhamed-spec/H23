import React, { useEffect, useState } from 'react';
import {
  Activity,
  Check,
  Database,
  Image as ImageIcon,
  Mic,
  PhoneCall,
  Radio,
  RotateCcw,
  Server,
  Wifi,
  Zap
} from 'lucide-react';
import type { ChatQualitySettings, QualityPresetMode } from '../types/chat';
import {
  DEFAULT_CHAT_QUALITY_SETTINGS,
  QUALITY_PRESET_TEMPLATES,
  getEffectiveQualityProfile,
  subscribeQualityProfile,
  type EffectiveQualityProfile
} from '../utils/networkQualityEngine';

interface AdminQualityPanelProps {
  chatQualitySettings?: ChatQualitySettings;
  onUpdateChatQuality?: (next: Partial<ChatQualitySettings>) => void;
  showToast: (message: string, type?: 'success' | 'error' | 'info') => void;
}

const PRESET_OPTIONS: Array<{
  id: QualityPresetMode;
  title: string;
  subtitle: string;
  badge: string;
  accent: string;
}> = [
  {
    id: 'auto',
    title: 'تلقائي ذكي 🤖',
    subtitle: 'يتكيّف لحظياً مع سرعة نت كل عضو (4G/3G/2G) وجودة المكالمة',
    badge: 'موصى به',
    accent: 'border-cyan-500/70 bg-cyan-950/40 text-cyan-200'
  },
  {
    id: 'weak',
    title: 'إنترنت ضعيف وتوفير 📶',
    subtitle: 'أخف استهلاك للبيانات، بث مستقر وبدون تقطيع على الشبكات الضعيفة',
    badge: 'توفير أقصى',
    accent: 'border-amber-500/70 bg-amber-950/40 text-amber-200'
  },
  {
    id: 'balanced',
    title: 'متوازن ⚡',
    subtitle: 'توازن مثالي بين السلاسة وجودة الصوت والفيديو وحمل السيرفر',
    badge: 'متوازن',
    accent: 'border-sky-500/70 bg-sky-950/40 text-sky-200'
  },
  {
    id: 'high',
    title: 'جودة فائقة 💎',
    subtitle: 'أعلى وضوح للصور واللايف والمكالمات والمايكات للاتصال السريع',
    badge: 'HD',
    accent: 'border-emerald-500/70 bg-emerald-950/40 text-emerald-200'
  }
];

export const AdminQualityPanel: React.FC<AdminQualityPanelProps> = ({
  chatQualitySettings,
  onUpdateChatQuality,
  showToast
}) => {
  const [form, setForm] = useState<ChatQualitySettings>(
    () => chatQualitySettings || { ...DEFAULT_CHAT_QUALITY_SETTINGS }
  );
  const [liveProfile, setLiveProfile] = useState<EffectiveQualityProfile>(() =>
    getEffectiveQualityProfile()
  );

  useEffect(() => {
    if (chatQualitySettings) {
      setForm(chatQualitySettings);
    }
  }, [chatQualitySettings]);

  useEffect(() => {
    return subscribeQualityProfile((next) => setLiveProfile(next));
  }, []);

  const applyPresetTemplate = (preset: QualityPresetMode, autoSave = false) => {
    const template = QUALITY_PRESET_TEMPLATES[preset];
    const next: ChatQualitySettings = {
      ...form,
      ...template
    };
    setForm(next);
    if (autoSave && onUpdateChatQuality) {
      onUpdateChatQuality(next);
      showToast(`تم تفعيل وضع "${PRESET_OPTIONS.find((p) => p.id === preset)?.title || preset}" على الشات بالكامل ⚡`, 'success');
    }
  };

  const handleSaveAll = () => {
    if (!onUpdateChatQuality) return;
    onUpdateChatQuality(form);
    showToast('تم حفظ وتطبيق إعدادات الجودة والتكيّف على جميع الغرف والأجهزة بنجاح ⚡💾', 'success');
  };

  return (
    <div className="flex-1 overflow-y-auto p-3 space-y-3 text-xs bg-slate-900/70 text-slate-100" dir="rtl">
      {/* Live Telemetry & Status Header */}
      <div className="p-3 rounded-2xl bg-gradient-to-l from-cyan-950/70 via-slate-900 to-amber-950/60 border border-cyan-500/40 shadow-lg space-y-2">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-cyan-500/20 border border-cyan-400/40 flex items-center justify-center text-cyan-300">
              <Zap className="w-4 h-4" />
            </div>
            <div>
              <h4 className="font-black text-sm text-cyan-200">مركز الجودة والتكيّف مع الإنترنت الضعيف</h4>
              <p className="text-[10.5px] text-slate-300">
                تحكّم موحّد وسريع بالمايكات، البث المباشر، المكالمات، الصور، Cloudinary، السيرفر و MongoDB
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={handleSaveAll}
            className="px-3.5 py-2 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-black text-xs shadow-lg flex items-center gap-1.5 cursor-pointer active:scale-95 transition-all"
          >
            <Check className="w-4 h-4" />
            <span>حفظ وتطبيق للجميع ⚡</span>
          </button>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1 text-[10.5px]">
          <div className="p-2 rounded-xl bg-slate-950/65 border border-slate-700/80 flex items-center gap-1.5">
            <Wifi className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
            <div className="min-w-0">
              <div className="text-slate-400 text-[9.5px]">الوضع النشط بجهازك</div>
              <div className="font-black text-cyan-200 truncate">
                {liveProfile.effectiveMode === 'weak'
                  ? 'توفير (إنترنت ضعيف)'
                  : liveProfile.effectiveMode === 'high'
                    ? 'جودة عالية'
                    : 'متوازن'}
              </div>
            </div>
          </div>

          <div className="p-2 rounded-xl bg-slate-950/65 border border-slate-700/80 flex items-center gap-1.5">
            <Activity className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
            <div className="min-w-0">
              <div className="text-slate-400 text-[9.5px]">نوع الشبكة المرصود</div>
              <div className="font-black text-emerald-300 font-mono truncate">
                {liveProfile.network.effectiveType.toUpperCase()}
                {liveProfile.network.downlinkMbps !== null ? ` • ${liveProfile.network.downlinkMbps}M` : ''}
              </div>
            </div>
          </div>

          <div className="p-2 rounded-xl bg-slate-950/65 border border-slate-700/80 flex items-center gap-1.5">
            <ImageIcon className="w-3.5 h-3.5 text-amber-400 shrink-0" />
            <div className="min-w-0">
              <div className="text-slate-400 text-[9.5px]">توصيل Cloudinary</div>
              <div className="font-black text-amber-300 font-mono truncate">{liveProfile.cloudinaryQualityToken}</div>
            </div>
          </div>

          <div className="p-2 rounded-xl bg-slate-950/65 border border-slate-700/80 flex items-center gap-1.5">
            <Database className="w-3.5 h-3.5 text-purple-400 shrink-0" />
            <div className="min-w-0">
              <div className="text-slate-400 text-[9.5px]">دفعات السيرفر و DB</div>
              <div className="font-black text-purple-300 font-mono truncate">
                {form.broadcastThrottleMs}ms / {form.dbBatchWriteMs}ms
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Quick Global Presets */}
      <div className="p-3 rounded-2xl bg-slate-800/70 border border-slate-700 space-y-2.5">
        <div className="flex items-center justify-between">
          <span className="font-black text-xs text-amber-300 flex items-center gap-1.5">
            <Zap className="w-3.5 h-3.5" />
            <span>اختيار الوضع العام الفوري (يطبق على كل الشات بضغطة واحدة)</span>
          </span>
          <button
            type="button"
            onClick={() => applyPresetTemplate('auto', true)}
            className="text-[10px] text-slate-300 hover:text-white flex items-center gap-1 px-2 py-1 rounded-lg bg-slate-900 border border-slate-700 cursor-pointer"
          >
            <RotateCcw className="w-3 h-3" />
            <span>افتراضي تلقائي</span>
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {PRESET_OPTIONS.map((opt) => {
            const isSelected = form.preset === opt.id;
            return (
              <button
                key={opt.id}
                type="button"
                onClick={() => applyPresetTemplate(opt.id, true)}
                className={`p-2.5 rounded-xl border text-right transition-all cursor-pointer flex flex-col gap-1 ${
                  isSelected
                    ? `${opt.accent} ring-2 ring-amber-400/70 shadow-md`
                    : 'bg-slate-900/70 border-slate-700 hover:border-slate-500 text-slate-200'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-black text-xs">{opt.title}</span>
                  <span className="px-1.5 py-0.5 rounded-md text-[9px] font-bold bg-black/40 border border-white/15">
                    {isSelected ? '✔️ مفعّل الآن' : opt.badge}
                  </span>
                </div>
                <p className="text-[10px] opacity-85 leading-relaxed">{opt.subtitle}</p>
              </button>
            );
          })}
        </div>

        <label className="flex items-center justify-between p-2.5 rounded-xl bg-slate-900/80 border border-slate-700 cursor-pointer">
          <div>
            <div className="font-bold text-slate-100 text-xs">
              التكيّف التلقائي الذكي للإنترنت الضعيف لدى العضو
            </div>
            <div className="text-[10px] text-slate-400">
              يخفض الدقة تلقائياً فقط للعضو الذي يضعف لديه الاتصال أو ترتفع نسبة فقدان الحزم بدون التأثير على باقي الأعضاء
            </div>
          </div>
          <input
            type="checkbox"
            checked={form.autoAdaptWeakNet}
            onChange={(e) => setForm((prev) => ({ ...prev, autoAdaptWeakNet: e.target.checked }))}
            className="w-4 h-4 accent-cyan-500 cursor-pointer shrink-0"
          />
        </label>
      </div>

      {/* 1. Mics & Voice Audio */}
      <div className="p-3 rounded-2xl bg-slate-800/70 border border-slate-700 space-y-2.5">
        <div className="font-black text-xs text-emerald-300 flex items-center gap-1.5 border-b border-slate-700 pb-1.5">
          <Mic className="w-4 h-4" />
          <span>جودة المايكات والصوتيات الجماعية (Opus + PCM Fallback)</span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="space-y-1">
            <div className="flex justify-between text-[11px]">
              <span className="font-bold text-slate-200">بت ريت صوت المايكات</span>
              <span className="font-mono font-black text-emerald-300">{form.micAudioBitrateKbps} kbps</span>
            </div>
            <input
              type="range"
              min={12}
              max={64}
              step={2}
              value={form.micAudioBitrateKbps}
              onChange={(e) => setForm((p) => ({ ...p, micAudioBitrateKbps: Number(e.target.value) }))}
              className="w-full accent-emerald-500 cursor-pointer"
            />
            <div className="text-[9.5px] text-slate-400">12–16 kbps ممتازة للشبكات الضعيفة، 24–40 kbps فائقة النقاء</div>
          </label>

          <label className="space-y-1">
            <div className="flex justify-between text-[11px]">
              <span className="font-bold text-slate-200">بت ريت مشاركة الصوت / الموسيقى</span>
              <span className="font-mono font-black text-emerald-300">{form.musicBitrateKbps} kbps</span>
            </div>
            <input
              type="range"
              min={20}
              max={96}
              step={4}
              value={form.musicBitrateKbps}
              onChange={(e) => setForm((p) => ({ ...p, musicBitrateKbps: Number(e.target.value) }))}
              className="w-full accent-emerald-500 cursor-pointer"
            />
            <div className="text-[9.5px] text-slate-400">يتكيّف تلقائياً مع حركة الصوت واستقرار الاتصال</div>
          </label>
        </div>
      </div>

      {/* 2. Live Broadcast */}
      <div className="p-3 rounded-2xl bg-slate-800/70 border border-slate-700 space-y-2.5">
        <div className="font-black text-xs text-rose-300 flex items-center gap-1.5 border-b border-slate-700 pb-1.5">
          <Radio className="w-4 h-4" />
          <span>جودة وسلاسة البث المباشر (اللايف)</span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <label className="space-y-1">
            <div className="flex justify-between text-[11px]">
              <span className="font-bold text-slate-200">دقة العرض</span>
              <span className="font-mono font-black text-rose-300">{form.liveVideoWidth}px</span>
            </div>
            <input
              type="range"
              min={160}
              max={480}
              step={16}
              value={form.liveVideoWidth}
              onChange={(e) => setForm((p) => ({ ...p, liveVideoWidth: Number(e.target.value) }))}
              className="w-full accent-rose-500 cursor-pointer"
            />
          </label>

          <label className="space-y-1">
            <div className="flex justify-between text-[11px]">
              <span className="font-bold text-slate-200">أقصى إطارات (FPS)</span>
              <span className="font-mono font-black text-rose-300">{form.liveVideoMaxFps} fps</span>
            </div>
            <input
              type="range"
              min={2}
              max={15}
              step={1}
              value={form.liveVideoMaxFps}
              onChange={(e) => setForm((p) => ({ ...p, liveVideoMaxFps: Number(e.target.value) }))}
              className="w-full accent-rose-500 cursor-pointer"
            />
          </label>

          <label className="space-y-1">
            <div className="flex justify-between text-[11px]">
              <span className="font-bold text-slate-200">نقاء اللقطة</span>
              <span className="font-mono font-black text-rose-300">{Math.round(form.liveVideoQuality * 100)}%</span>
            </div>
            <input
              type="range"
              min={0.3}
              max={0.85}
              step={0.02}
              value={form.liveVideoQuality}
              onChange={(e) => setForm((p) => ({ ...p, liveVideoQuality: Number(e.target.value) }))}
              className="w-full accent-rose-500 cursor-pointer"
            />
          </label>
        </div>
      </div>

      {/* 3. Private Voice & Video Calls */}
      <div className="p-3 rounded-2xl bg-slate-800/70 border border-slate-700 space-y-2.5">
        <div className="font-black text-xs text-sky-300 flex items-center gap-1.5 border-b border-slate-700 pb-1.5">
          <PhoneCall className="w-4 h-4" />
          <span>مكالمات الخاص الصوتية والفيديو</span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="space-y-1">
            <div className="flex justify-between text-[11px]">
              <span className="font-bold text-slate-200">صوت المكالمة الخاصة</span>
              <span className="font-mono font-black text-sky-300">{form.privateCallAudioBitrateKbps} kbps</span>
            </div>
            <input
              type="range"
              min={12}
              max={48}
              step={2}
              value={form.privateCallAudioBitrateKbps}
              onChange={(e) => setForm((p) => ({ ...p, privateCallAudioBitrateKbps: Number(e.target.value) }))}
              className="w-full accent-sky-500 cursor-pointer"
            />
          </label>

          <label className="space-y-1">
            <div className="flex justify-between text-[11px]">
              <span className="font-bold text-slate-200">بت ريت فيديو المكالمة</span>
              <span className="font-mono font-black text-sky-300">{form.privateCallVideoMaxKbps} kbps</span>
            </div>
            <input
              type="range"
              min={100}
              max={950}
              step={20}
              value={form.privateCallVideoMaxKbps}
              onChange={(e) => setForm((p) => ({ ...p, privateCallVideoMaxKbps: Number(e.target.value) }))}
              className="w-full accent-sky-500 cursor-pointer"
            />
          </label>

          <label className="space-y-1">
            <div className="flex justify-between text-[11px]">
              <span className="font-bold text-slate-200">أقصى عرض فيديو للمكالمة</span>
              <span className="font-mono font-black text-sky-300">{form.privateCallMaxWidth}px</span>
            </div>
            <input
              type="range"
              min={240}
              max={720}
              step={40}
              value={form.privateCallMaxWidth}
              onChange={(e) => setForm((p) => ({ ...p, privateCallMaxWidth: Number(e.target.value) }))}
              className="w-full accent-sky-500 cursor-pointer"
            />
          </label>

          <label className="space-y-1">
            <div className="flex justify-between text-[11px]">
              <span className="font-bold text-slate-200">إطارات فيديو المكالمة</span>
              <span className="font-mono font-black text-sky-300">{form.privateCallMaxFps} fps</span>
            </div>
            <input
              type="range"
              min={8}
              max={24}
              step={2}
              value={form.privateCallMaxFps}
              onChange={(e) => setForm((p) => ({ ...p, privateCallMaxFps: Number(e.target.value) }))}
              className="w-full accent-sky-500 cursor-pointer"
            />
          </label>
        </div>
      </div>

      {/* 4. Images & Cloudinary */}
      <div className="p-3 rounded-2xl bg-slate-800/70 border border-slate-700 space-y-2.5">
        <div className="font-black text-xs text-amber-300 flex items-center gap-1.5 border-b border-slate-700 pb-1.5">
          <ImageIcon className="w-4 h-4" />
          <span>ضغط الصور وتوصيل Cloudinary</span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <label className="space-y-1">
            <span className="font-bold text-slate-200 text-[11px] block">وضع توصيل Cloudinary</span>
            <select
              value={form.cloudinaryDeliveryMode}
              onChange={(e) =>
                setForm((p) => ({
                  ...p,
                  cloudinaryDeliveryMode: e.target.value as ChatQualitySettings['cloudinaryDeliveryMode']
                }))
              }
              className="w-full px-2.5 py-1.5 rounded-xl bg-slate-900 border border-slate-600 text-amber-200 font-bold text-xs outline-none focus:border-amber-400"
            >
              <option value="auto">🤖 تلقائي حسب شبكة العضو</option>
              <option value="eco">📶 توفير أقصى (q_auto:eco)</option>
              <option value="good">⚡ متوازن سريع (q_auto:good)</option>
              <option value="best">💎 أعلى جودة (q_auto:best)</option>
            </select>
          </label>

          <label className="space-y-1">
            <div className="flex justify-between text-[11px]">
              <span className="font-bold text-slate-200">أقصى مقاس للرفع</span>
              <span className="font-mono font-black text-amber-300">{form.imageMaxDim}px</span>
            </div>
            <input
              type="range"
              min={640}
              max={1600}
              step={40}
              value={form.imageMaxDim}
              onChange={(e) => setForm((p) => ({ ...p, imageMaxDim: Number(e.target.value) }))}
              className="w-full accent-amber-500 cursor-pointer"
            />
          </label>

          <label className="space-y-1">
            <div className="flex justify-between text-[11px]">
              <span className="font-bold text-slate-200">جودة ضغط الصورة</span>
              <span className="font-mono font-black text-amber-300">{Math.round(form.imageQuality * 100)}%</span>
            </div>
            <input
              type="range"
              min={0.5}
              max={0.92}
              step={0.02}
              value={form.imageQuality}
              onChange={(e) => setForm((p) => ({ ...p, imageQuality: Number(e.target.value) }))}
              className="w-full accent-amber-500 cursor-pointer"
            />
          </label>
        </div>
      </div>

      {/* 5. Server, Socket.IO & MongoDB Lightness */}
      <div className="p-3 rounded-2xl bg-slate-800/70 border border-slate-700 space-y-2.5">
        <div className="font-black text-xs text-purple-300 flex items-center gap-1.5 border-b border-slate-700 pb-1.5">
          <Server className="w-4 h-4" />
          <span>تخفيف الضغط على السيرفر و Socket.IO و MongoDB</span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="space-y-1">
            <div className="flex justify-between text-[11px]">
              <span className="font-bold text-slate-200">تجميع بث القوائم (Broadcast Coalesce)</span>
              <span className="font-mono font-black text-purple-300">{form.broadcastThrottleMs} ms</span>
            </div>
            <input
              type="range"
              min={0}
              max={300}
              step={20}
              value={form.broadcastThrottleMs}
              onChange={(e) => setForm((p) => ({ ...p, broadcastThrottleMs: Number(e.target.value) }))}
              className="w-full accent-purple-500 cursor-pointer"
            />
            <div className="text-[9.5px] text-slate-400">يدمج التحديثات المتلاحقة للغرف والمايكات لتقليل استهلاك المعالج والشبكة</div>
          </label>

          <label className="space-y-1">
            <div className="flex justify-between text-[11px]">
              <span className="font-bold text-slate-200">تجميع الكتابة لقاعدة MongoDB</span>
              <span className="font-mono font-black text-purple-300">{form.dbBatchWriteMs} ms</span>
            </div>
            <input
              type="range"
              min={300}
              max={3000}
              step={100}
              value={form.dbBatchWriteMs}
              onChange={(e) => setForm((p) => ({ ...p, dbBatchWriteMs: Number(e.target.value) }))}
              className="w-full accent-purple-500 cursor-pointer"
            />
            <div className="text-[9.5px] text-slate-400">يمنع الكتابات المكررة والمتقاربة على MongoDB ويحافظ على سرعة الاستجابة</div>
          </label>
        </div>
      </div>

      <div className="flex items-center justify-between pt-1 pb-2">
        <div className="text-[10px] text-slate-400">
          {form.updatedBy ? `آخر تعديل بواسطة [${form.updatedBy}]` : 'جاهز للتطبيق الفوري على السيرفر وجميع الأعضاء'}
        </div>
        <button
          type="button"
          onClick={handleSaveAll}
          className="px-4 py-2 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-black text-xs shadow-lg flex items-center gap-1.5 cursor-pointer active:scale-95 transition-all"
        >
          <Check className="w-4 h-4" />
          <span>حفظ وتطبيق جميع إعدادات الجودة ⚡</span>
        </button>
      </div>
    </div>
  );
};
