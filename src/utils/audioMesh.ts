// WebRTC Group Voice Mesh Manager for Real-Time Multi-User Audio (Speakers + Listeners)

import { Socket } from 'socket.io-client';
import {
  getEffectiveQualityProfile,
  reportWebRtcNetworkHealth,
  subscribeQualityProfile
} from './networkQualityEngine';

// Global dynamic TURN/STUN configuration for bypassing firewalls & VoIP blocks in countries with strict NATs
const customTurnUrl = (typeof window !== 'undefined' && (window as any).__CHATHASSAN_TURN_URL__) || import.meta.env.VITE_TURN_SERVER_URL;
const customTurnUser = (typeof window !== 'undefined' && (window as any).__CHATHASSAN_TURN_USER__) || import.meta.env.VITE_TURN_USERNAME;
const customTurnPass = (typeof window !== 'undefined' && (window as any).__CHATHASSAN_TURN_PASS__) || import.meta.env.VITE_TURN_CREDENTIAL;

const defaultTurnServers: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' },
  { urls: 'stun:global.stun.twilio.com:3478' },
  {
    // TURN over TLS on Port 443 (HTTPS port) - Bypasses DPI & ISP VoIP blocking in UAE, Oman, Qatar, KSA, etc.
    urls: [
      'turns:openrelay.metered.ca:443?transport=tcp',
      'turn:openrelay.metered.ca:443?transport=tcp',
      'turn:openrelay.metered.ca:80',
      'turn:openrelay.metered.ca:443'
    ],
    username: 'openrelayproject',
    credential: 'openrelayproject'
  }
];

if (customTurnUrl) {
  defaultTurnServers.unshift({
    urls: String(customTurnUrl).split(',').map((u) => u.trim()).filter(Boolean),
    username: customTurnUser || undefined,
    credential: customTurnPass || undefined
  });
}

export const ICE_SERVERS: RTCConfiguration = {
  iceServers: defaultTurnServers,
  iceCandidatePoolSize: 10,
  iceTransportPolicy: 'all',
  bundlePolicy: 'max-bundle',
  rtcpMuxPolicy: 'require'
};

let runtimeIceFetched = false;
let runtimeIceFetchPromise: Promise<void> | null = null;

export function getRuntimeIceServers(): RTCConfiguration {
  return {
    ...ICE_SERVERS,
    iceServers: [...(ICE_SERVERS.iceServers || defaultTurnServers)]
  };
}

export async function refreshIceServersFromApi(): Promise<void> {
  if (runtimeIceFetched || typeof window === 'undefined') return;
  if (runtimeIceFetchPromise) return runtimeIceFetchPromise;
  runtimeIceFetchPromise = (async () => {
    try {
      const apiBase = ((import.meta.env.VITE_SERVER_URL as string) || '').replace(/\/$/, '');
      const res = await fetch(`${apiBase}/api/ice-servers`, { cache: 'no-store' });
      if (!res.ok) return;
      const data = await res.json();
      if (Array.isArray(data?.iceServers) && data.iceServers.length > 0) {
        ICE_SERVERS.iceServers = data.iceServers;
        runtimeIceFetched = true;
      }
    } catch {
      // Keep default STUN/TURN list on transient offline error
    } finally {
      runtimeIceFetchPromise = null;
    }
  })();
  return runtimeIceFetchPromise;
}

/**
 * Enforces Opus codec parameters dynamically for weak internet & mobile 3G/4G/5G connections:
 * - Detects actual dynamic Opus payload types from rtpmap (and falls back to 111/96)
 * - usedtx=1: Discontinuous Transmission (0 data sent when silent)
 * - useinbandfec=1: Forward Error Correction (reconstructs dropped audio packets without retransmitting)
 * - maxaveragebitrate: Caps bitrate dynamically (12kbps-64kbps) according to live network & admin preset
 */
export function optimizeSdpForWeakNetworks(sdp: string, targetKbps?: number): string {
  if (!sdp) return sdp;
  const effectiveKbps =
    typeof targetKbps === 'number' && Number.isFinite(targetKbps) && targetKbps > 0
      ? Math.round(targetKbps)
      : getEffectiveQualityProfile().micAudioBitrateKbps;
  const maxAvgBps = Math.max(10000, Math.min(96000, effectiveKbps * 1000));

  const payloadTypes = new Set<string>();
  const rtpmapRegex = /^a=rtpmap:(\d+)\s+opus\/48000/gim;
  let match: RegExpExecArray | null;
  while ((match = rtpmapRegex.exec(sdp)) !== null) {
    if (match[1]) payloadTypes.add(match[1]);
  }
  if (payloadTypes.size === 0) {
    payloadTypes.add('111');
    payloadTypes.add('96');
  }

  let updated = sdp;
  for (const pt of payloadTypes) {
    const fmtpPattern = new RegExp(`a=fmtp:${pt} ([^\\r\\n]*)\\r?\\n`, 'g');
    if (fmtpPattern.test(updated)) {
      updated = updated.replace(new RegExp(`a=fmtp:${pt} ([^\\r\\n]*)(\\r?\\n)`, 'g'), (_m, params: string, eol: string) => {
        const cleaned = params
          .split(';')
          .map((p) => p.trim())
          .filter((p) => p && !/^(usedtx|useinbandfec|maxaveragebitrate|stereo|cbr)=/i.test(p));
        cleaned.push('useinbandfec=1', 'usedtx=1', `maxaveragebitrate=${maxAvgBps}`, 'stereo=0');
        return `a=fmtp:${pt} ${cleaned.join(';')}${eol}`;
      });
    } else {
      const rtpLinePattern = new RegExp(`(a=rtpmap:${pt} [^\\r\\n]*\\r?\\n)`, 'i');
      if (rtpLinePattern.test(updated)) {
        updated = updated.replace(
          rtpLinePattern,
          `$1a=fmtp:${pt} minptime=10;useinbandfec=1;usedtx=1;maxaveragebitrate=${maxAvgBps};stereo=0\r\n`
        );
      }
    }
  }
  return updated;
}

export interface SharedMusicState {
  isActive: boolean;
  isPlaying: boolean;
  trackName: string;
  currentTime: number;
  duration: number;
  volume: number;
}

export interface VoiceNetworkQualityStats {
  activePeers: number;
  pingMs: number | null;
  packetLossPct: number | null;
  jitterMs: number | null;
}

export interface RemoteVoicePeer {
  id: string;
  username: string;
  pc: RTCPeerConnection;
  stream?: MediaStream;
  audioElement?: HTMLAudioElement;
  isMuted?: boolean;
  isSpeaking?: boolean;
  isRemoteSpeaker?: boolean;
  isInitiator?: boolean;
  iceRestartAttempts?: number;
  isIceRestarting?: boolean;
  lastIceRestartAt?: number;
  wasSpeakerLeft?: boolean;
}

// Encode Float32 PCM samples (at sourceSampleRate) downsampled to targetRate (16kHz / 11kHz on weak net) Int16 mono WAV base64
export function encodeDownsampledWavBase64(samples: Float32Array, sourceSampleRate: number, targetRate = 16000): string {
  const safeTargetRate = Math.max(8000, Math.min(24000, Math.round(targetRate || 16000)));
  const ratio = sourceSampleRate / safeTargetRate;
  const newLength = Math.max(1, Math.floor(samples.length / ratio));
  const dataSize = newLength * 2;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  const writeStr = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  };

  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // Mono
  view.setUint32(24, safeTargetRate, true);
  view.setUint32(28, safeTargetRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, 'data');
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let i = 0; i < newLength; i++) {
    const srcIdx = Math.min(samples.length - 1, Math.floor(i * ratio));
    const s = Math.max(-1, Math.min(1, samples[srcIdx]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    offset += 2;
  }

  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return 'data:audio/wav;base64,' + btoa(binary);
}

export class AudioMeshManager {
  private socket: Socket;
  public localStream: MediaStream | null = null;
  public peers: Map<string, RemoteVoicePeer> = new Map();
  private pendingCandidates: Map<string, RTCIceCandidateInit[]> = new Map();
  private activeRoomSpeakers: Set<string> = new Set();
  private fallbackTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();
  private disconnectRecoveryTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();
  private lastFallbackRequestAt: Map<string, number> = new Map();
  private voiceWatchdogTimer: ReturnType<typeof setInterval> | null = null;

  public isMuted = false;
  public isAdminMuted = false;
  public isDeafened = false;
  public isInVoice = false; // True when user is holding a mic
  public isListening = true; // True whenever user is inside a chat room
  public autoplayBlocked = false;

  private audioCtx: AudioContext | null = null;
  private playbackCtx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private analysisSource: MediaStreamAudioSourceNode | null = null;
  private animFrameId: number | null = null;
  private lastSpeakingState = false;

  // Web Audio Studio processing chain (Gain + Voice Modulator Effects + Spatial Pan + DJ Duck)
  private studioEffect: 'normal' | 'falcon' | 'robot' | 'helium' | 'studio' | 'radio' | 'echo' = 'normal';
  private studioGainPercent = 100;
  private studioSpatialPan = 0;
  private djDuckMode = false;
  private studioSource: MediaStreamAudioSourceNode | null = null;
  private studioDest: MediaStreamAudioDestinationNode | null = null;
  private studioMixBus: GainNode | null = null;
  private studioMicMasterGain: GainNode | null = null;
  private studioPanner: StereoPannerNode | null = null;
  private studioCleanupFns: Array<() => void> = [];

  // Shared Room Music Mixer (streams audio from user-selected audio/video file alongside mic voice)
  private musicEl: HTMLVideoElement | null = null;
  private musicMediaSource: MediaElementAudioSourceNode | null = null;
  private musicBroadcastGain: GainNode | null = null;
  private musicMonitorGain: GainNode | null = null;
  private musicObjectUrl: string | null = null;
  private musicState: SharedMusicState = {
    isActive: false,
    isPlaying: false,
    trackName: '',
    currentTime: 0,
    duration: 0,
    volume: 75
  };

  // On-demand PCM-WAV fallback streaming (only active if a listener requests fallback due to firewall/NAT block)
  private pcmProcessor: ScriptProcessorNode | null = null;
  private pcmWorkletNode: AudioWorkletNode | null = null;
  private pcmWorkletLoadedCtx: WeakSet<AudioContext> = new WeakSet();
  private pcmSource: AudioNode | null = null;
  private pcmSourceFromMixBus = false;
  private pcmSilentGain: GainNode | null = null;
  private pcmBuffer: Float32Array[] = [];
  private pcmTotalSamples = 0;
  private isFallbackStreaming = false;
  private pcmFallbackExpireTimer: ReturnType<typeof setTimeout> | null = null;
  private nextFallbackPlayTime: Map<string, number> = new Map();

  private audioContainerEl: HTMLElement | null = null;
  private gestureUnlockAttached = false;
  private unlockHandler: (() => void) | null = null;

  // Callbacks
  public onVolumeChange?: (volume: number) => void;
  public onPeersUpdated?: (peers: RemoteVoicePeer[]) => void;
  public onError?: (errorMsg: string) => void;
  public onAutoplayBlocked?: (blocked: boolean) => void;
  public onSharedMusicChange?: (state: SharedMusicState) => void;

  private socketListeners: Array<{ event: string; fn: (...args: any[]) => void }> = [];
  private unsubscribeQuality: (() => void) | null = null;
  private lastAppliedAudioBitrateBps = 0;
  private lastAdaptiveStatsProbeAt = 0;

  constructor(socket: Socket) {
    this.socket = socket;
    this.ensureAudioContainer();
    this.attachGestureUnlock();
    this.setupSocketListeners();
    refreshIceServersFromApi().catch(() => {});
    this.startVoiceWatchdog();
    this.unsubscribeQuality = subscribeQualityProfile(() => {
      this.applyAdaptiveAudioParameters(true);
    });
  }

  private getTargetAudioBitrateBps(): number {
    const profile = getEffectiveQualityProfile();
    const isMusic = Boolean(this.musicState.isActive && this.musicState.isPlaying);
    const kbps = isMusic ? profile.musicBitrateKbps : profile.micAudioBitrateKbps;
    return Math.max(10000, Math.min(96000, Math.round(kbps * 1000)));
  }

  private applyAdaptiveAudioParameters(force = false) {
    if (!this.isInVoice || this.peers.size === 0) return;
    const targetBps = this.getTargetAudioBitrateBps();
    if (!force && this.lastAppliedAudioBitrateBps === targetBps) return;
    this.lastAppliedAudioBitrateBps = targetBps;

    this.peers.forEach((peer) => {
      peer.pc.getSenders().forEach((sender) => {
        if (sender.track && sender.track.kind === 'audio') {
          try {
            const params = sender.getParameters();
            if (!params.encodings || params.encodings.length === 0) {
              params.encodings = [{}];
            }
            params.encodings[0].maxBitrate = targetBps;
            sender.setParameters(params).catch(() => {});
          } catch {}
        }
      });
    });
  }

  private startVoiceWatchdog() {
    if (this.voiceWatchdogTimer) return;
    this.voiceWatchdogTimer = setInterval(() => {
      const now = Date.now();
      if (this.peers.size > 0 && now - this.lastAdaptiveStatsProbeAt >= 3800) {
        this.lastAdaptiveStatsProbeAt = now;
        this.getNetworkQualityStats()
          .then((stats) => {
            if (stats.activePeers > 0) {
              reportWebRtcNetworkHealth({
                packetLossPct: stats.packetLossPct,
                rttMs: stats.pingMs
              });
              this.applyAdaptiveAudioParameters(false);
            }
          })
          .catch(() => {});
      }
      if (this.activeRoomSpeakers.size === 0) return;
      for (const speakerId of this.activeRoomSpeakers) {
        if (speakerId === this.socket.id) continue;
        if (!this.hasConnectedPeer(speakerId)) {
          const lastReq = this.lastFallbackRequestAt.get(speakerId) || 0;
          if (now - lastReq >= 3500) {
            this.lastFallbackRequestAt.set(speakerId, now);
            this.socket.emit('requestVoiceFallback', { speakerId });
          }
        }
      }
    }, 4000);
  }

  private requestFallbackForSpeaker(speakerId: string) {
    const now = Date.now();
    const lastReq = this.lastFallbackRequestAt.get(speakerId) || 0;
    if (now - lastReq < 3200) return;
    this.lastFallbackRequestAt.set(speakerId, now);
    this.socket.emit('requestVoiceFallback', { speakerId });
  }

  private ensureAudioContainer() {
    if (typeof document === 'undefined') return;
    let container = document.getElementById('hassan-webrtc-audio-pool');
    if (!container) {
      container = document.createElement('div');
      container.id = 'hassan-webrtc-audio-pool';
      container.style.position = 'fixed';
      container.style.width = '1px';
      container.style.height = '1px';
      container.style.opacity = '0';
      container.style.pointerEvents = 'none';
      container.style.overflow = 'hidden';
      document.body.appendChild(container);
    }
    this.audioContainerEl = container;
  }

  private attachGestureUnlock() {
    if (this.gestureUnlockAttached || typeof window === 'undefined') return;
    this.gestureUnlockAttached = true;
    const unlock = () => {
      if (this.autoplayBlocked || (this.playbackCtx && this.playbackCtx.state === 'suspended')) {
        this.unlockAudioPlayback();
      }
    };
    this.unlockHandler = unlock;
    window.addEventListener('pointerdown', unlock, { passive: true });
    window.addEventListener('touchstart', unlock, { passive: true });
    window.addEventListener('click', unlock, { passive: true });
  }

  public async unlockAudioPlayback(): Promise<void> {
    if (this.playbackCtx && this.playbackCtx.state === 'suspended') {
      try {
        await this.playbackCtx.resume();
      } catch {}
    }
    let stillBlocked = false;
    for (const peer of this.peers.values()) {
      if (peer.audioElement) {
        peer.audioElement.muted = this.isDeafened;
        if (peer.audioElement.paused && peer.stream) {
          try {
            await peer.audioElement.play();
          } catch {
            stillBlocked = true;
          }
        }
      }
    }
    this.autoplayBlocked = stillBlocked;
    if (this.onAutoplayBlocked) {
      this.onAutoplayBlocked(stillBlocked);
    }
  }

  private registerSocketListener(event: string, fn: (...args: any[]) => void) {
    this.socket.on(event, fn);
    this.socketListeners.push({ event, fn });
  }

  private setupSocketListeners() {
    // When local user takes a mic, server sends ALL room peers (speakers & listeners) to initiate offers to
    this.registerSocketListener('voiceRoomUsers', (existingUsers: Array<{ id: string; username: string; isVoice?: boolean }>) => {
      if (!this.isInVoice || !this.localStream) return;
      existingUsers.forEach((user) => {
        if (user.id && user.id !== this.socket.id) {
          if (user.isVoice) this.activeRoomSpeakers.add(user.id);
          this.initiateCallTo(user.id, user.username, Boolean(user.isVoice));
        }
      });
    });

    // When a new user enters the room while we are on a mic, initiate an offer to them so they hear us!
    this.registerSocketListener('voiceNewListener', (listener: { id: string; username: string }) => {
      if (!this.isInVoice || !this.localStream) return;
      if (listener.id && listener.id !== this.socket.id) {
        this.initiateCallTo(listener.id, listener.username, false);
      }
    });

    // When another user joins voice/mic
    this.registerSocketListener('userJoinedVoice', (user: { id: string; username: string }) => {
      if (user?.id && user.id !== this.socket.id) {
        this.activeRoomSpeakers.add(user.id);
        this.scheduleFallbackCheck(user.id);
      }
    });

    // When listener joins room, track active speakers so we know if WebRTC fails and needs fallback
    this.registerSocketListener('micSlotsUpdated', (slots: Array<{ slotNumber: number; user: { id: string; username: string } | null }>) => {
      const currentSpeakers = new Set<string>();
      (slots || []).forEach((slot) => {
        if (slot.user?.id && slot.user.id !== this.socket.id) {
          currentSpeakers.add(slot.user.id);
          if (!this.activeRoomSpeakers.has(slot.user.id)) {
            this.scheduleFallbackCheck(slot.user.id);
          }
        }
      });
      this.activeRoomSpeakers = currentSpeakers;
      // Clean up fallback timers for users no longer on mic
      for (const [uid, t] of this.fallbackTimers.entries()) {
        if (!currentSpeakers.has(uid)) {
          clearTimeout(t);
          this.fallbackTimers.delete(uid);
        }
      }
    });

    // Server instructs this speaker to stream PCM-WAV fallback chunks because a listener couldn't connect via WebRTC
    this.registerSocketListener('enableVoiceFallback', () => {
      if (this.isInVoice && this.localStream) {
        if (!this.isFallbackStreaming) {
          this.startPcmFallbackStreaming();
        }
        this.touchPcmFallbackTimer();
      }
    });

    // Signaling Relay: incoming offer, answer, or ice candidate (Works for BOTH Speakers AND Listeners!)
    this.registerSocketListener('voiceSignal', async ({ senderId, senderUsername, signal }: { senderId: string; senderUsername: string; signal: any }) => {
      if (!this.isListening && !this.isInVoice) return;
      if (!senderId || senderId === this.socket.id) return;

      try {
        if (signal.type === 'offer') {
          await this.handleReceiveOffer(senderId, senderUsername, signal);
        } else if (signal.type === 'answer') {
          await this.handleReceiveAnswer(senderId, signal);
        } else if (signal.candidate) {
          await this.handleReceiveCandidate(senderId, signal.candidate);
        }
      } catch (err: any) {
        console.warn('Signal handling notice:', err?.message || err);
      }
    });

    // Remote user changed voice state (e.g. muted or speaking)
    this.registerSocketListener('userVoiceStateChanged', ({ userId, isMuted, isSpeaking }: { userId: string; isMuted: boolean; isSpeaking: boolean }) => {
      const peer = this.peers.get(userId);
      if (peer) {
        if (typeof isMuted === 'boolean') peer.isMuted = isMuted;
        if (typeof isSpeaking === 'boolean') peer.isSpeaking = isSpeaking;
        this.notifyPeers();
      }
    });

    // Remote user left voice / dropped mic
    this.registerSocketListener('userLeftVoice', ({ userId }: { userId: string }) => {
      this.activeRoomSpeakers.delete(userId);
      const t = this.fallbackTimers.get(userId);
      if (t) {
        clearTimeout(t);
        this.fallbackTimers.delete(userId);
      }
      if (!this.isInVoice) {
        this.closePeer(userId);
      } else {
        const peer = this.peers.get(userId);
        if (peer) {
          peer.isRemoteSpeaker = false;
          peer.wasSpeakerLeft = true;
          peer.isSpeaking = false;
          if (peer.audioElement) {
            peer.audioElement.pause();
            peer.audioElement.srcObject = null;
          }
          peer.stream = undefined;
          this.notifyPeers();
        }
      }
    });
  }

  private scheduleFallbackCheck(speakerId: string) {
    if (this.fallbackTimers.has(speakerId)) {
      clearTimeout(this.fallbackTimers.get(speakerId)!);
    }
    const timer = setTimeout(() => {
      this.fallbackTimers.delete(speakerId);
      if (!this.activeRoomSpeakers.has(speakerId)) return;
      if (!this.hasConnectedPeer(speakerId)) {
        this.requestFallbackForSpeaker(speakerId);
      }
    }, 2800);
    this.fallbackTimers.set(speakerId, timer);
  }

  // Called when entering or leaving rooms so listener state stays clean
  public resetForRoomSwitch() {
    this.pendingCandidates.clear();
    this.activeRoomSpeakers.clear();
    this.nextFallbackPlayTime.clear();
    this.lastFallbackRequestAt.clear();
    for (const t of this.fallbackTimers.values()) clearTimeout(t);
    this.fallbackTimers.clear();
    for (const t of this.disconnectRecoveryTimers.values()) clearTimeout(t);
    this.disconnectRecoveryTimers.clear();
    if (this.pcmFallbackExpireTimer) {
      clearTimeout(this.pcmFallbackExpireTimer);
      this.pcmFallbackExpireTimer = null;
    }

    if (this.isInVoice) {
      this.leaveVoice();
    } else {
      this.peers.forEach((peer) => {
        if (peer.audioElement) {
          peer.audioElement.pause();
          peer.audioElement.srcObject = null;
          peer.audioElement.remove();
        }
        try {
          peer.pc.ontrack = null;
          peer.pc.onicecandidate = null;
          peer.pc.oniceconnectionstatechange = null;
          peer.pc.onconnectionstatechange = null;
          peer.pc.close();
        } catch {}
      });
      this.peers.clear();
      this.notifyPeers();
    }
    this.isListening = true;
  }

  // Join the voice call (Mic Holder)
  public async joinVoice(): Promise<boolean> {
    if (this.isInVoice && this.localStream) return true;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        },
        video: false
      });

      this.localStream = stream;
      this.isInVoice = true;
      this.isListening = true;
      this.isMuted = this.isAdminMuted;
      if (this.isMuted) {
        stream.getAudioTracks().forEach((t) => {
          t.enabled = false;
        });
      }

      // Setup Audio Visualizer and Speech Detection
      this.setupAudioAnalysis(stream);

      // Re-apply studio equalizer settings if configured before climbing mic
      if (this.studioEffect !== 'normal' || this.studioGainPercent !== 100) {
        this.rebuildStudioChain();
      }

      // Unlock playback context simultaneously inside user gesture
      this.unlockAudioPlayback().catch(() => {});

      this.socket.emit('joinVoice');
      return true;
    } catch (err: any) {
      console.warn('Microphone permission not granted or device unavailable:', err?.message || err);
      const msg = err.name === 'NotAllowedError'
        ? 'تم رفض إذن الوصول للميكروفون. يرجى تفعيل إذن المايك في إعدادات المتصفح.'
        : 'تعذر الوصول إلى الميكروفون: ' + (err.message || 'يرجى التأكد من توصيل المايكروفون');
      if (this.onError) this.onError(msg);
      return false;
    }
  }

  // Take one of the 5 Mic Slots (waits for server acknowledgment and rolls back mic stream if rejected)
  public async takeMicSlot(slotNumber: number): Promise<{ ok: boolean; error?: string }> {
    const success = await this.joinVoice();
    if (!success) {
      return { ok: false, error: 'تعذر الوصول إلى الميكروفون' };
    }

    return new Promise((resolve) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          resolve({ ok: true });
        }
      }, 6000);

      this.socket.emit('takeMic', { slotNumber }, (res?: { ok?: boolean; error?: string }) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (res && res.ok === false) {
          this.leaveVoice();
          resolve({ ok: false, error: res.error || 'تعذر الصعود إلى المايك' });
          return;
        }
        resolve({ ok: true });
      });
    });
  }

  // Drop Mic Slot
  public dropMicSlot() {
    this.socket.emit('dropMic');
    this.leaveVoice();
  }

  private createPeerConnection(targetId: string, username: string, isRemoteSpeaker = false, isInitiator = false): RemoteVoicePeer {
    const existing = this.peers.get(targetId);
    if (existing) {
      try {
        existing.pc.ontrack = null;
        existing.pc.onicecandidate = null;
        existing.pc.oniceconnectionstatechange = null;
        existing.pc.onconnectionstatechange = null;
        existing.pc.close();
      } catch {}
      if (existing.audioElement) {
        existing.audioElement.pause();
        existing.audioElement.srcObject = null;
        existing.audioElement.remove();
      }
      this.peers.delete(targetId);
    }

    const existingDiscTimer = this.disconnectRecoveryTimers.get(targetId);
    if (existingDiscTimer) {
      clearTimeout(existingDiscTimer);
      this.disconnectRecoveryTimers.delete(targetId);
    }

    const pc = new RTCPeerConnection(getRuntimeIceServers());
    const peer: RemoteVoicePeer = {
      id: targetId,
      username,
      pc,
      isRemoteSpeaker,
      isInitiator,
      iceRestartAttempts: 0
    };
    this.peers.set(targetId, peer);

    pc.ontrack = (event) => {
      const stream = event.streams?.[0] || new MediaStream([event.track]);
      this.attachRemoteTrack(peer, stream);
      const t = this.fallbackTimers.get(targetId);
      if (t) {
        clearTimeout(t);
        this.fallbackTimers.delete(targetId);
      }
    };

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.socket.emit('voiceSignal', {
          targetId,
          signal: { candidate: event.candidate }
        });
      }
    };

    const triggerIceRestart = async () => {
      const latest = this.peers.get(targetId);
      if (!latest || latest.pc !== pc) return;
      const now = Date.now();
      if (
        latest.isIceRestarting ||
        (latest.lastIceRestartAt && now - latest.lastIceRestartAt < 2500)
      ) {
        return;
      }
      if (!this.isInVoice || !latest.isInitiator || (latest.iceRestartAttempts || 0) >= 2) return;
      latest.isIceRestarting = true;
      latest.lastIceRestartAt = now;
      latest.iceRestartAttempts = (latest.iceRestartAttempts || 0) + 1;
      try {
        let offer = await pc.createOffer({ iceRestart: true });
        if (offer.sdp) {
          offer = { type: offer.type, sdp: optimizeSdpForWeakNetworks(offer.sdp) };
        }
        await pc.setLocalDescription(offer);
        this.socket.emit('voiceSignal', { targetId, signal: offer });
      } catch {
      } finally {
        latest.isIceRestarting = false;
      }
    };

    const handleConnectionState = () => {
      const iceState = pc.iceConnectionState;
      const connState = pc.connectionState;
      const currentPeer = this.peers.get(targetId);
      if (!currentPeer || currentPeer.pc !== pc) return;

      if (iceState === 'connected' || iceState === 'completed' || connState === 'connected') {
        currentPeer.iceRestartAttempts = 0;
        currentPeer.isIceRestarting = false;
        const dt = this.disconnectRecoveryTimers.get(targetId);
        if (dt) {
          clearTimeout(dt);
          this.disconnectRecoveryTimers.delete(targetId);
        }
        const t = this.fallbackTimers.get(targetId);
        if (t) {
          clearTimeout(t);
          this.fallbackTimers.delete(targetId);
        }
        this.applyAdaptiveAudioParameters(true);
        this.notifyPeers();
      } else if (iceState === 'disconnected' || connState === 'disconnected') {
        // VPN toggle / mobile handoff often stays stuck in 'disconnected' without emitting 'failed'
        if (!this.disconnectRecoveryTimers.has(targetId)) {
          const dt = setTimeout(() => {
            this.disconnectRecoveryTimers.delete(targetId);
            const latest = this.peers.get(targetId);
            if (!latest || latest.pc !== pc) return;
            if (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed' || pc.connectionState === 'connected') return;

            if (this.activeRoomSpeakers.has(targetId)) {
              this.requestFallbackForSpeaker(targetId);
            }
            void triggerIceRestart();
          }, 1800);
          this.disconnectRecoveryTimers.set(targetId, dt);
        }
      } else if (iceState === 'failed' || connState === 'failed') {
        if (this.activeRoomSpeakers.has(targetId)) {
          this.requestFallbackForSpeaker(targetId);
        }
        void triggerIceRestart();
      }
    };

    pc.oniceconnectionstatechange = handleConnectionState;
    pc.onconnectionstatechange = handleConnectionState;

    return peer;
  }

  // Initiate call to an existing peer (or cleanly upgrade existing recvonly connection on mic re-climb)
  private async initiateCallTo(targetId: string, username: string, isRemoteSpeaker = false) {
    if (!this.localStream) return;
    const outgoingTrack = this.getOutgoingAudioTrack();
    const outgoingStream = this.studioDest?.stream || this.localStream;

    const existing = this.peers.get(targetId);
    if (existing && existing.pc && existing.pc.signalingState === 'stable') {
      const hasLiveSender = existing.pc.getSenders().some((s) => s.track && s.track.readyState === 'live');
      if (hasLiveSender) return;

      // Upgrade existing recvonly connection cleanly using existing audio sender/transceiver
      try {
        existing.isInitiator = true;
        if (isRemoteSpeaker) existing.isRemoteSpeaker = true;
        if (outgoingTrack) {
          const audioTransceiver = existing.pc.getTransceivers().find(
            (tr) => tr.receiver?.track?.kind === 'audio' || tr.sender?.track?.kind === 'audio' || tr.sender
          );
          if (audioTransceiver) {
            audioTransceiver.direction = 'sendrecv';
            await audioTransceiver.sender.replaceTrack(outgoingTrack);
          } else {
            existing.pc.addTrack(outgoingTrack, outgoingStream);
          }
        }
        let offer = await existing.pc.createOffer();
        if (offer.sdp) {
          offer = { type: offer.type, sdp: optimizeSdpForWeakNetworks(offer.sdp) };
        }
        await existing.pc.setLocalDescription(offer);
        this.socket.emit('voiceSignal', { targetId, signal: offer });
        this.notifyPeers();
        return;
      } catch (err) {
        console.warn('Renegotiation failed, creating fresh peer connection:', err);
      }
    }

    const peer = this.createPeerConnection(targetId, username, isRemoteSpeaker, true);
    const pc = peer.pc;

    // Add local tracks
    if (outgoingTrack) {
      pc.addTrack(outgoingTrack, outgoingStream);
    } else {
      this.localStream.getTracks().forEach((track) => {
        pc.addTrack(track, this.localStream!);
      });
    }

    // Create & send offer optimized for weak mobile networks
    try {
      let offer = await pc.createOffer();
      if (offer.sdp) {
        offer = { type: offer.type, sdp: optimizeSdpForWeakNetworks(offer.sdp) };
      }
      await pc.setLocalDescription(offer);
      this.socket.emit('voiceSignal', {
        targetId,
        signal: offer
      });
    } catch (err) {
      console.error('Failed to create offer:', err);
    }

    this.notifyPeers();
  }

  // Handle incoming offer from a speaker peer (works for BOTH listeners and speakers!)
  private async handleReceiveOffer(senderId: string, senderUsername: string, offer: RTCSessionDescriptionInit) {
    let peer = this.peers.get(senderId);

    // Deterministic polite/impolite glare resolution when both peers climb mic at the exact same moment
    const isGlare = Boolean(peer && peer.pc.signalingState === 'have-local-offer');
    const isPolite = !this.isInVoice || !this.socket.id || this.socket.id < senderId;
    if (isGlare && !isPolite) {
      return;
    }

    if (isGlare && peer && peer.pc.connectionState !== 'failed' && peer.pc.connectionState !== 'closed') {
      try {
        await peer.pc.setLocalDescription({ type: 'rollback' });
      } catch {
        // Fall back to fresh connection below if browser rejects rollback
      }
    }

    const needsFreshPc =
      !peer ||
      peer.wasSpeakerLeft ||
      peer.pc.signalingState === 'have-local-offer' ||
      peer.pc.iceConnectionState === 'failed' ||
      peer.pc.iceConnectionState === 'closed' ||
      peer.pc.connectionState === 'failed' ||
      peer.pc.connectionState === 'closed';

    if (needsFreshPc) {
      peer = this.createPeerConnection(senderId, senderUsername, true, false);
      if (this.isInVoice && this.localStream) {
        const outgoingTrack = this.getOutgoingAudioTrack();
        const outgoingStream = this.studioDest?.stream || this.localStream;
        if (outgoingTrack) {
          peer.pc.addTrack(outgoingTrack, outgoingStream);
        } else {
          this.localStream.getTracks().forEach((track) => {
            peer!.pc.addTrack(track, this.localStream!);
          });
        }
      }
    } else if (peer) {
      peer.isRemoteSpeaker = true;
      peer.wasSpeakerLeft = false;
    }

    const pc = peer!.pc;
    await pc.setRemoteDescription(new RTCSessionDescription(offer));

    // Flush any queued ICE candidates that arrived before remote description
    const queued = this.pendingCandidates.get(senderId);
    if (queued && queued.length > 0) {
      for (const cand of queued) {
        await pc.addIceCandidate(new RTCIceCandidate(cand)).catch(() => {});
      }
      this.pendingCandidates.delete(senderId);
    }

    // If we are listening only and haven't added tracks, ensure recvonly transceiver is ready
    if (!this.isInVoice && pc.getTransceivers().length === 0) {
      pc.addTransceiver('audio', { direction: 'recvonly' });
    }

    let answer = await pc.createAnswer();
    if (answer.sdp) {
      answer = { type: answer.type, sdp: optimizeSdpForWeakNetworks(answer.sdp) };
    }
    await pc.setLocalDescription(answer);

    this.socket.emit('voiceSignal', {
      targetId: senderId,
      signal: answer
    });

    this.notifyPeers();
  }

  // Handle incoming answer
  private async handleReceiveAnswer(senderId: string, answer: RTCSessionDescriptionInit) {
    const peer = this.peers.get(senderId);
    if (peer && peer.pc && peer.pc.signalingState === 'have-local-offer') {
      await peer.pc.setRemoteDescription(new RTCSessionDescription(answer));
      const queued = this.pendingCandidates.get(senderId);
      if (queued && queued.length > 0) {
        for (const cand of queued) {
          await peer.pc.addIceCandidate(new RTCIceCandidate(cand)).catch(() => {});
        }
        this.pendingCandidates.delete(senderId);
      }
    }
  }

  // Handle incoming candidate with automatic queueing before setRemoteDescription
  private async handleReceiveCandidate(senderId: string, candidate: RTCIceCandidateInit) {
    const peer = this.peers.get(senderId);
    if (peer && peer.pc && peer.pc.remoteDescription) {
      await peer.pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(() => {});
    } else {
      const list = this.pendingCandidates.get(senderId) || [];
      list.push(candidate);
      this.pendingCandidates.set(senderId, list);
    }
  }

  // Attach remote stream to DOM-mounted HTMLAudioElement with Autoplay-block notification
  private attachRemoteTrack(peer: RemoteVoicePeer, stream: MediaStream) {
    this.ensureAudioContainer();
    peer.stream = stream;
    let audio = peer.audioElement;
    if (!audio) {
      audio = document.createElement('audio');
      audio.autoplay = true;
      audio.setAttribute('playsinline', 'true');
      audio.setAttribute('webkit-playsinline', 'true');
      (audio as any).playsInline = true;
      audio.volume = 1.0;
      audio.muted = this.isDeafened;
      peer.audioElement = audio;
      if (this.audioContainerEl) {
        this.audioContainerEl.appendChild(audio);
      }
    }
    audio.srcObject = stream;
    audio.muted = this.isDeafened;
    audio
      .play()
      .then(() => {
        if (this.autoplayBlocked) {
          this.autoplayBlocked = false;
          this.onAutoplayBlocked?.(false);
        }
      })
      .catch(() => {
        this.autoplayBlocked = true;
        this.onAutoplayBlocked?.(true);
      });
    this.notifyPeers();
  }

  // On-demand seamless PCM-WAV fallback streamer (AudioWorklet primary with ScriptProcessor fallback)
  private async startPcmFallbackStreaming() {
    if (!this.localStream || !this.isInVoice || this.isFallbackStreaming) return;
    try {
      const ctx = this.ensureAudioContext();
      if (!ctx) return;
      if (ctx.state === 'suspended') {
        ctx.resume().catch(() => {});
      }

      let source: AudioNode;
      if (this.studioMixBus) {
        source = this.studioMixBus;
        this.pcmSourceFromMixBus = true;
      } else {
        source = ctx.createMediaStreamSource(this.localStream);
        this.pcmSourceFromMixBus = false;
      }
      const silentGain = ctx.createGain();
      silentGain.gain.value = 0;

      this.pcmSource = source;
      this.pcmSilentGain = silentGain;
      this.pcmBuffer = [];
      this.pcmTotalSamples = 0;
      this.isFallbackStreaming = true;

      const initProfile = getEffectiveQualityProfile();
      const targetChunkSamples = Math.round(ctx.sampleRate * (initProfile.pcmFallbackChunkMs / 1000)); // Adaptive chunk window
      const handleSamples = (input: Float32Array) => {
        const allowOutgoing = !this.isAdminMuted && (!this.isMuted || (this.musicState.isActive && this.musicState.isPlaying));
        if (!this.isInVoice || !allowOutgoing || !this.isFallbackStreaming) return;
        const copy = new Float32Array(input.length);
        copy.set(input);
        this.pcmBuffer.push(copy);
        this.pcmTotalSamples += copy.length;

        if (this.pcmTotalSamples >= targetChunkSamples) {
          const merged = new Float32Array(this.pcmTotalSamples);
          let pos = 0;
          for (const buf of this.pcmBuffer) {
            merged.set(buf, pos);
            pos += buf.length;
          }
          this.pcmBuffer = [];
          this.pcmTotalSamples = 0;

          let maxAmp = 0;
          for (let i = 0; i < merged.length; i += 8) {
            const abs = Math.abs(merged[i]);
            if (abs > maxAmp) maxAmp = abs;
          }
          if (maxAmp > 0.004) {
            const liveProf = getEffectiveQualityProfile();
            const wavDataUri = encodeDownsampledWavBase64(merged, ctx.sampleRate, liveProf.pcmFallbackSampleRate);
            this.socket.emit('voiceDataChunk', { chunk: wavDataUri });
          }
        }
      };

      let workletConnected = false;
      if (typeof AudioWorkletNode !== 'undefined' && ctx.audioWorklet) {
        try {
          if (!this.pcmWorkletLoadedCtx.has(ctx)) {
            const processorCode = `
              class HassPcmCaptureProcessor extends AudioWorkletProcessor {
                process(inputs) {
                  const input = inputs[0] && inputs[0][0];
                  if (input && input.length) {
                    this.port.postMessage(new Float32Array(input));
                  }
                  return true;
                }
              }
              registerProcessor('hassan-pcm-capture', HassPcmCaptureProcessor);
            `;
            const blob = new Blob([processorCode], { type: 'application/javascript' });
            const url = URL.createObjectURL(blob);
            try {
              await ctx.audioWorklet.addModule(url);
              this.pcmWorkletLoadedCtx.add(ctx);
            } finally {
              URL.revokeObjectURL(url);
            }
          }
          if (!this.isInVoice || !this.isFallbackStreaming) return;
          const workletNode = new AudioWorkletNode(ctx, 'hassan-pcm-capture');
          workletNode.port.onmessage = (ev) => {
            if (ev.data instanceof Float32Array) {
              handleSamples(ev.data);
            }
          };
          this.pcmWorkletNode = workletNode;
          source.connect(workletNode);
          workletNode.connect(silentGain);
          silentGain.connect(ctx.destination);
          workletConnected = true;
        } catch {
          workletConnected = false;
        }
      }

      if (!workletConnected) {
        const processor = ctx.createScriptProcessor(4096, 1, 1);
        this.pcmProcessor = processor;
        processor.onaudioprocess = (e) => {
          handleSamples(e.inputBuffer.getChannelData(0));
        };
        source.connect(processor);
        processor.connect(silentGain);
        silentGain.connect(ctx.destination);
      }

      this.touchPcmFallbackTimer();
    } catch (err) {
      this.isFallbackStreaming = false;
      console.warn('PCM fallback stream setup notice:', err);
    }
  }

  private touchPcmFallbackTimer() {
    if (this.pcmFallbackExpireTimer) {
      clearTimeout(this.pcmFallbackExpireTimer);
    }
    this.pcmFallbackExpireTimer = setTimeout(() => {
      this.pcmFallbackExpireTimer = null;
      this.stopPcmFallbackStreaming();
    }, 12000);
  }

  private stopPcmFallbackStreaming() {
    if (this.pcmFallbackExpireTimer) {
      clearTimeout(this.pcmFallbackExpireTimer);
      this.pcmFallbackExpireTimer = null;
    }
    this.isFallbackStreaming = false;
    this.pcmBuffer = [];
    this.pcmTotalSamples = 0;
    try {
      if (this.pcmWorkletNode) {
        if (this.pcmSourceFromMixBus && this.pcmSource) {
          try { this.pcmSource.disconnect(this.pcmWorkletNode); } catch {}
        }
        this.pcmWorkletNode.port.onmessage = null;
        this.pcmWorkletNode.disconnect();
      }
      if (this.pcmProcessor) {
        if (this.pcmSourceFromMixBus && this.pcmSource) {
          try { this.pcmSource.disconnect(this.pcmProcessor); } catch {}
        }
        this.pcmProcessor.disconnect();
      }
      if (!this.pcmSourceFromMixBus) {
        this.pcmSource?.disconnect();
      }
      this.pcmSilentGain?.disconnect();
    } catch {}
    this.pcmWorkletNode = null;
    this.pcmProcessor = null;
    this.pcmSource = null;
    this.pcmSourceFromMixBus = false;
    this.pcmSilentGain = null;
  }

  // Play incoming standalone WAV/Audio chunk smoothly via bounded WebAudio jitter buffer
  public async playFallbackChunk(userId: string, chunkDataUri: string): Promise<void> {
    if (this.isDeafened || this.hasConnectedPeer(userId)) return;
    try {
      if (!this.playbackCtx || this.playbackCtx.state === 'closed') {
        const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        this.playbackCtx = new AudioCtx();
      }
      const ctx = this.playbackCtx;
      if (ctx.state === 'suspended') {
        await ctx.resume().catch(() => {
          this.autoplayBlocked = true;
          this.onAutoplayBlocked?.(true);
        });
      }
      if (ctx.state !== 'running') {
        this.autoplayBlocked = true;
        this.onAutoplayBlocked?.(true);
        return;
      }

      const b64Index = chunkDataUri.indexOf('base64,');
      if (b64Index === -1) return;
      const binaryStr = atob(chunkDataUri.slice(b64Index + 7));
      const bytes = new Uint8Array(binaryStr.length);
      for (let i = 0; i < binaryStr.length; i++) {
        bytes[i] = binaryStr.charCodeAt(i);
      }

      const audioBuffer = await ctx.decodeAudioData(bytes.buffer.slice(0));
      const source = ctx.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(ctx.destination);

      const now = ctx.currentTime;
      const prevScheduled = this.nextFallbackPlayTime.get(userId) || now + 0.02;
      // Clamp max jitter buffer drift to 320ms so VPN latency spikes never lag audio seconds behind
      const scheduledAt = Math.min(now + 0.32, Math.max(now + 0.02, prevScheduled));
      source.start(scheduledAt);
      this.nextFallbackPlayTime.set(userId, scheduledAt + audioBuffer.duration);
    } catch {
      this.nextFallbackPlayTime.delete(userId);
    }
  }

  private cleanupAudioAnalysis() {
    if (this.animFrameId) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }
    try { this.analysisSource?.disconnect(); } catch {}
    try { this.analyser?.disconnect(); } catch {}
    this.analysisSource = null;
    this.analyser = null;
  }

  // Setup AnalyserNode for local mic volume meter and speaking indicator
  private setupAudioAnalysis(stream: MediaStream) {
    this.cleanupAudioAnalysis();
    try {
      const ctx = this.ensureAudioContext();
      if (!ctx) return;
      const source = ctx.createMediaStreamSource(stream);
      this.analysisSource = source;
      this.analyser = ctx.createAnalyser();
      this.analyser.fftSize = 256;
      this.analyser.smoothingTimeConstant = 0.5;
      source.connect(this.analyser);

      const bufferLength = this.analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);

      const checkVolume = () => {
        if (!this.analyser || !this.isInVoice) return;

        if (this.isAdminMuted || (this.isMuted && !this.musicState.isPlaying)) {
          if (this.lastSpeakingState) {
            this.lastSpeakingState = false;
            this.socket.emit('voiceStateUpdate', {
              isSpeaking: false,
              isSharingMusic: false
            });
          }
          if (this.onVolumeChange) {
            this.onVolumeChange(0);
          }
          this.animFrameId = requestAnimationFrame(checkVolume);
          return;
        }

        if (this.isMuted && this.musicState.isPlaying) {
          if (!this.lastSpeakingState) {
            this.lastSpeakingState = true;
            this.socket.emit('voiceStateUpdate', {
              isSpeaking: true,
              isSharingMusic: !this.isAdminMuted
            });
          }
          if (this.onVolumeChange) {
            this.onVolumeChange(Math.max(15, Math.min(85, Math.round(this.musicState.volume * 0.65))));
          }
          this.animFrameId = requestAnimationFrame(checkVolume);
          return;
        }

        this.analyser.getByteFrequencyData(dataArray);

        let sum = 0;
        for (let i = 0; i < bufferLength; i++) {
          sum += dataArray[i];
        }
        const avg = sum / bufferLength;
        const volumePercent = Math.min(100, Math.round((avg / 128) * 100));

        if (this.onVolumeChange) {
          this.onVolumeChange(volumePercent);
        }

        const isSpeakingNow = volumePercent > 12 || this.musicState.isPlaying;
        if (isSpeakingNow !== this.lastSpeakingState) {
          this.lastSpeakingState = isSpeakingNow;
          this.socket.emit('voiceStateUpdate', {
            isSpeaking: isSpeakingNow,
            isSharingMusic: Boolean(this.musicState.isActive && this.musicState.isPlaying && !this.isAdminMuted)
          });
        }

        this.animFrameId = requestAnimationFrame(checkVolume);
      };

      this.animFrameId = requestAnimationFrame(checkVolume);
    } catch (err) {
      console.error('Audio analysis setup error:', err);
    }
  }

  private getOutgoingAudioTrack(): MediaStreamTrack | null {
    return this.studioDest?.stream.getAudioTracks()[0] || this.localStream?.getAudioTracks()[0] || null;
  }

  private cleanupStudioChain() {
    for (const fn of this.studioCleanupFns) {
      try { fn(); } catch {}
    }
    this.studioCleanupFns = [];
    try { this.studioSource?.disconnect(); } catch {}
    try { this.studioMixBus?.disconnect(); } catch {}
    try { this.studioDest?.disconnect(); } catch {}
    try { this.studioPanner?.disconnect(); } catch {}
    this.studioSource = null;
    this.studioMixBus = null;
    this.studioDest = null;
    this.studioMicMasterGain = null;
    this.studioPanner = null;
  }

  private notifySharedMusic() {
    this.onSharedMusicChange?.({ ...this.musicState });
  }

  public getSharedMusicState(): SharedMusicState {
    return { ...this.musicState };
  }

  private ensureAudioContext(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!this.audioCtx || this.audioCtx.state === 'closed') {
      this.audioCtx = new AudioCtx();
    }
    if (this.audioCtx.state === 'suspended') {
      this.audioCtx.resume().catch(() => {});
    }
    return this.audioCtx;
  }

  private ensureMusicAudioGraph(ctx: AudioContext) {
    this.ensureAudioContainer();
    if (!this.musicEl) {
      const el = document.createElement('video');
      el.playsInline = true;
      el.setAttribute('playsinline', 'true');
      el.setAttribute('webkit-playsinline', 'true');
      el.preload = 'auto';
      el.muted = false;
      el.volume = 1;
      el.style.position = 'fixed';
      el.style.width = '1px';
      el.style.height = '1px';
      el.style.opacity = '0.001';
      el.style.pointerEvents = 'none';
      if (this.audioContainerEl) {
        this.audioContainerEl.appendChild(el);
      } else if (typeof document !== 'undefined') {
        document.body.appendChild(el);
      }

      el.addEventListener('loadedmetadata', () => {
        this.musicState.duration = Number.isFinite(el.duration) ? el.duration : 0;
        this.notifySharedMusic();
      });
      el.addEventListener('durationchange', () => {
        this.musicState.duration = Number.isFinite(el.duration) ? el.duration : 0;
        this.notifySharedMusic();
      });
      el.addEventListener('timeupdate', () => {
        this.musicState.currentTime = el.currentTime || 0;
        if (Number.isFinite(el.duration) && el.duration > 0) {
          this.musicState.duration = el.duration;
        }
        this.notifySharedMusic();
      });
      el.addEventListener('play', () => {
        this.musicState.isPlaying = true;
        this.syncOutgoingTrackEnabledState();
        this.socket.emit('voiceStateUpdate', {
          isMuted: this.isMuted,
          isSharingMusic: !this.isAdminMuted,
          isSpeaking: !this.isAdminMuted
        });
        this.notifySharedMusic();
      });
      el.addEventListener('pause', () => {
        this.musicState.isPlaying = false;
        this.syncOutgoingTrackEnabledState();
        this.socket.emit('voiceStateUpdate', {
          isMuted: this.isMuted,
          isSharingMusic: false,
          isSpeaking: !this.isMuted && !this.isAdminMuted ? this.lastSpeakingState : false
        });
        this.notifySharedMusic();
      });
      el.addEventListener('ended', () => {
        this.musicState.isPlaying = false;
        this.musicState.currentTime = 0;
        try { el.currentTime = 0; } catch {}
        this.syncOutgoingTrackEnabledState();
        this.socket.emit('voiceStateUpdate', {
          isMuted: this.isMuted,
          isSharingMusic: false,
          isSpeaking: !this.isMuted && !this.isAdminMuted ? this.lastSpeakingState : false
        });
        this.notifySharedMusic();
      });
      el.addEventListener('error', () => {
        if (this.musicState.isActive && el.getAttribute('src')) {
          this.musicState.isPlaying = false;
          this.notifySharedMusic();
          this.onError?.('تعذر تشغيل هذا الملف الصوتي أو المرئي. يرجى اختيار ملف آخر مدعوم.');
        }
      });

      this.musicEl = el;
    }

    if (!this.musicMediaSource) {
      this.musicMediaSource = ctx.createMediaElementSource(this.musicEl);
    }
    const volRatio = Math.max(0, Math.min(1, this.musicState.volume / 100));
    if (!this.musicBroadcastGain) {
      this.musicBroadcastGain = ctx.createGain();
      this.musicBroadcastGain.gain.value = volRatio;
      this.musicMediaSource.connect(this.musicBroadcastGain);
    }
    if (!this.musicMonitorGain) {
      this.musicMonitorGain = ctx.createGain();
      this.musicMonitorGain.gain.value = volRatio;
      this.musicMediaSource.connect(this.musicMonitorGain);
      this.musicMonitorGain.connect(ctx.destination);
    }
  }

  private syncOutgoingTrackEnabledState() {
    if (this.localStream) {
      // While mixed music is active through studioMicMasterGain, keep hardware track active so mobile browsers
      // do not suspend the AudioContext graph; studioMicMasterGain.gain = 0 silences 100% of voice input.
      const keepRawTrackAliveForMixedMusic = Boolean(
        this.musicState.isActive && this.studioDest && this.studioMicMasterGain
      );
      this.localStream.getAudioTracks().forEach((track) => {
        track.enabled = keepRawTrackAliveForMixedMusic ? !this.isAdminMuted : (!this.isMuted && !this.isAdminMuted);
      });
    }
    if (this.studioMicMasterGain) {
      const targetMicGain =
        this.isMuted || this.isAdminMuted
          ? 0
          : Math.max(0.1, Math.min(2.0, this.studioGainPercent / 100));
      const now = this.audioCtx?.currentTime || 0;
      try {
        this.studioMicMasterGain.gain.setValueAtTime(targetMicGain, now);
      } catch {
        this.studioMicMasterGain.gain.value = targetMicGain;
      }
    }
    if (this.studioDest) {
      const allowMixedOutgoing = !this.isAdminMuted && (!this.isMuted || this.musicState.isActive);
      this.studioDest.stream.getAudioTracks().forEach((track) => {
        track.enabled = allowMixedOutgoing;
      });
    }
  }

  public async startSharedMusic(file: File): Promise<boolean> {
    if (!this.isInVoice || !this.localStream) {
      this.onError?.('يجب أن تكون صاعداً على المايك أولاً لمشاركة صوت الموسيقى في الغرفة 🎙️');
      return false;
    }
    if (this.isAdminMuted) {
      this.onError?.('🔇 المايك مكتوم عنك من قبل الإدارة ولا يمكنك بث الموسيقى حالياً.');
      return false;
    }

    const ctx = this.ensureAudioContext();
    if (!ctx) return false;

    try {
      if (ctx.state === 'suspended') {
        await ctx.resume().catch(() => {});
      }
      this.ensureMusicAudioGraph(ctx);
      if (!this.musicEl) return false;

      if (!this.musicEl.paused) {
        this.musicEl.pause();
      }
      if (this.musicObjectUrl) {
        URL.revokeObjectURL(this.musicObjectUrl);
        this.musicObjectUrl = null;
      }

      const nextUrl = URL.createObjectURL(file);
      this.musicObjectUrl = nextUrl;

      const cleanTitle = (file.name || 'مقطع موسيقي').replace(/\.[^/.]+$/, '').trim() || 'مقطع موسيقي';
      this.musicState = {
        ...this.musicState,
        isActive: true,
        isPlaying: false,
        trackName: cleanTitle,
        currentTime: 0,
        duration: 0
      };

      this.musicEl.src = nextUrl;
      this.musicEl.load();

      // Ensure WebRTC outgoing stream includes the mixed destination
      this.rebuildStudioChain();
      this.syncOutgoingTrackEnabledState();
      this.notifySharedMusic();

      try {
        await this.musicEl.play();
        this.musicState.isPlaying = true;
        this.notifySharedMusic();
      } catch {
        this.musicState.isPlaying = false;
        this.notifySharedMusic();
      }
      return true;
    } catch (err) {
      console.error('Failed to start shared music:', err);
      this.onError?.('تعذر تحميل ملف الموسيقى المختار.');
      return false;
    }
  }

  public toggleSharedMusicPause(): boolean {
    if (!this.musicEl || !this.musicState.isActive) return false;
    if (this.isAdminMuted) {
      this.onError?.('🔇 المايك مكتوم عنك من قبل الإدارة حالياً.');
      return false;
    }
    const ctx = this.ensureAudioContext();
    if (ctx && ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }
    if (this.musicEl.paused) {
      this.musicEl.play().then(() => {
        this.musicState.isPlaying = true;
        this.notifySharedMusic();
      }).catch(() => {});
      return true;
    } else {
      this.musicEl.pause();
      this.musicState.isPlaying = false;
      this.notifySharedMusic();
      return false;
    }
  }

  public seekSharedMusic(seconds: number): void {
    if (!this.musicEl || !this.musicState.isActive) return;
    const maxDur = Number.isFinite(this.musicEl.duration) && this.musicEl.duration > 0
      ? this.musicEl.duration
      : this.musicState.duration;
    const target = Math.max(0, maxDur > 0 ? Math.min(maxDur, seconds) : seconds);
    try {
      this.musicEl.currentTime = target;
      this.musicState.currentTime = target;
      this.notifySharedMusic();
    } catch {}
  }

  public setSharedMusicVolume(percent: number): void {
    const clamped = Math.max(0, Math.min(100, Math.round(percent)));
    this.musicState.volume = clamped;
    const baseRatio = clamped / 100;
    const broadcastRatio = this.djDuckMode ? baseRatio * 0.35 : baseRatio;
    const now = this.audioCtx?.currentTime || 0;
    if (this.musicBroadcastGain) {
      try {
        this.musicBroadcastGain.gain.setValueAtTime(broadcastRatio, now);
      } catch {
        this.musicBroadcastGain.gain.value = broadcastRatio;
      }
    }
    if (this.musicMonitorGain) {
      try {
        this.musicMonitorGain.gain.setValueAtTime(baseRatio, now);
      } catch {
        this.musicMonitorGain.gain.value = baseRatio;
      }
    }
    this.notifySharedMusic();
  }

  public stopSharedMusic(opts?: { destroyElement?: boolean }): void {
    const wasActive = this.musicState.isActive;
    if (this.musicEl) {
      try { this.musicEl.pause(); } catch {}
      try {
        this.musicEl.removeAttribute('src');
        this.musicEl.load();
      } catch {}
    }
    if (this.musicObjectUrl) {
      URL.revokeObjectURL(this.musicObjectUrl);
      this.musicObjectUrl = null;
    }
    this.musicState = {
      isActive: false,
      isPlaying: false,
      trackName: '',
      currentTime: 0,
      duration: 0,
      volume: this.musicState.volume
    };

    if (opts?.destroyElement) {
      try { this.musicBroadcastGain?.disconnect(); } catch {}
      try { this.musicMonitorGain?.disconnect(); } catch {}
      try { this.musicMediaSource?.disconnect(); } catch {}
      if (this.musicEl) {
        try { this.musicEl.remove(); } catch {}
      }
      this.musicBroadcastGain = null;
      this.musicMonitorGain = null;
      this.musicMediaSource = null;
      this.musicEl = null;
    }

    if (this.isInVoice && this.localStream && !opts?.destroyElement) {
      this.rebuildStudioChain();
      this.syncOutgoingTrackEnabledState();
      this.socket.emit('voiceStateUpdate', {
        isMuted: this.isMuted,
        isSharingMusic: false,
        isSpeaking: !this.isMuted && !this.isAdminMuted ? this.lastSpeakingState : false
      });
    }

    if (wasActive || opts?.destroyElement) {
      this.notifySharedMusic();
    }
  }

  private rebuildStudioChain() {
    this.cleanupStudioChain();
    if (!this.localStream || !this.isInVoice) return;

    const rawTrack = this.localStream.getAudioTracks()[0] || null;
    const needsMixedChain =
      this.studioEffect !== 'normal' ||
      this.studioGainPercent !== 100 ||
      Math.abs(this.studioSpatialPan) > 0.01 ||
      this.musicState.isActive;

    if (!needsMixedChain) {
      if (rawTrack) {
        rawTrack.enabled = !this.isMuted && !this.isAdminMuted;
        this.peers.forEach((peer) => {
          peer.pc.getTransceivers().forEach((tr) => {
            const isAudioTr =
              tr.sender?.track?.kind === 'audio' ||
              tr.receiver?.track?.kind === 'audio' ||
              (!tr.sender?.track && peer.isInitiator);
            if (isAudioTr && tr.sender) {
              tr.sender.replaceTrack(rawTrack).catch(() => {});
            }
          });
        });
      }
      if (this.isFallbackStreaming) {
        this.stopPcmFallbackStreaming();
        this.startPcmFallbackStreaming();
      }
      return;
    }

    try {
      const ctx = this.ensureAudioContext();
      if (!ctx) return;

      const source = ctx.createMediaStreamSource(this.localStream);
      const dest = ctx.createMediaStreamDestination();
      const mixBus = ctx.createGain();
      mixBus.gain.value = 1;
      const masterGain = ctx.createGain();
      masterGain.gain.value =
        this.isMuted || this.isAdminMuted
          ? 0
          : Math.max(0.1, Math.min(2.0, this.studioGainPercent / 100));

      this.studioSource = source;
      this.studioDest = dest;
      this.studioMixBus = mixBus;
      this.studioMicMasterGain = masterGain;
      const nodes: AudioNode[] = [masterGain, mixBus];

      if (this.studioEffect === 'falcon') {
        const bassBoost = ctx.createBiquadFilter();
        bassBoost.type = 'lowshelf';
        bassBoost.frequency.value = 220;
        bassBoost.gain.value = 9;
        source.connect(bassBoost);
        bassBoost.connect(masterGain);
        nodes.push(bassBoost);
      } else if (this.studioEffect === 'helium') {
        const trebleBoost = ctx.createBiquadFilter();
        trebleBoost.type = 'highpass';
        trebleBoost.frequency.value = 340;
        const presence = ctx.createBiquadFilter();
        presence.type = 'peaking';
        presence.frequency.value = 2200;
        presence.gain.value = 8;
        source.connect(trebleBoost);
        trebleBoost.connect(presence);
        presence.connect(masterGain);
        nodes.push(trebleBoost, presence);
      } else if (this.studioEffect === 'radio') {
        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.value = 1400;
        bp.Q.value = 1.6;
        source.connect(bp);
        bp.connect(masterGain);
        nodes.push(bp);
      } else if (this.studioEffect === 'robot') {
        const osc = ctx.createOscillator();
        const oscGain = ctx.createGain();
        const modGain = ctx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.value = 55;
        oscGain.gain.value = 0.5;
        modGain.gain.value = 1.0;
        osc.connect(oscGain);
        oscGain.connect(modGain.gain);
        source.connect(modGain);
        modGain.connect(masterGain);
        osc.start();
        nodes.push(oscGain, modGain);
        this.studioCleanupFns.push(() => {
          try { osc.stop(); osc.disconnect(); } catch {}
        });
      } else if (this.studioEffect === 'studio' || this.studioEffect === 'echo') {
        const dry = ctx.createGain();
        const wet = ctx.createGain();
        const delay = ctx.createDelay(1.0);
        const feedback = ctx.createGain();
        dry.gain.value = 0.9;
        wet.gain.value = this.studioEffect === 'echo' ? 0.55 : 0.3;
        delay.delayTime.value = this.studioEffect === 'echo' ? 0.28 : 0.11;
        feedback.gain.value = this.studioEffect === 'echo' ? 0.42 : 0.2;
        source.connect(dry);
        dry.connect(masterGain);
        source.connect(delay);
        delay.connect(feedback);
        feedback.connect(delay);
        delay.connect(wet);
        wet.connect(masterGain);
        nodes.push(dry, wet, delay, feedback);
      } else {
        source.connect(masterGain);
      }

      if (Math.abs(this.studioSpatialPan) > 0.01 && typeof ctx.createStereoPanner === 'function') {
        const panner = ctx.createStereoPanner();
        panner.pan.value = Math.max(-1, Math.min(1, this.studioSpatialPan));
        masterGain.connect(panner);
        panner.connect(mixBus);
        this.studioPanner = panner;
        nodes.push(panner);
      } else {
        masterGain.connect(mixBus);
      }
      if (this.musicState.isActive && this.musicBroadcastGain) {
        this.musicBroadcastGain.connect(mixBus);
        const bgGain = this.musicBroadcastGain;
        this.studioCleanupFns.push(() => {
          try { bgGain.disconnect(mixBus); } catch {}
        });
      }
      mixBus.connect(dest);

      this.studioCleanupFns.push(() => {
        nodes.forEach((n) => {
          try { n.disconnect(); } catch {}
        });
      });

      const processedTrack = dest.stream.getAudioTracks()[0];
      if (processedTrack) {
        processedTrack.enabled = !this.isAdminMuted && (!this.isMuted || this.musicState.isActive);
        this.peers.forEach((peer) => {
          let replaced = false;
          peer.pc.getTransceivers().forEach((tr) => {
            const isAudioTr =
              tr.sender?.track?.kind === 'audio' ||
              tr.receiver?.track?.kind === 'audio' ||
              (!tr.sender?.track && peer.isInitiator);
            if (isAudioTr && tr.sender) {
              if (tr.direction === 'recvonly' && peer.isInitiator) {
                try { tr.direction = 'sendrecv'; } catch {}
              }
              replaced = true;
              tr.sender.replaceTrack(processedTrack).catch(() => {});
            }
          });
          if (!replaced) {
            peer.pc.getSenders().forEach((sender) => {
              if (sender.track?.kind === 'audio') {
                sender.replaceTrack(processedTrack).catch(() => {});
              }
            });
          }
        });
      }

      if (this.isFallbackStreaming) {
        this.stopPcmFallbackStreaming();
        this.startPcmFallbackStreaming();
      }
    } catch (err) {
      console.warn('Studio audio chain notice:', err);
    }
  }

  public applyStudioSettings(opts: {
    effect?: 'normal' | 'falcon' | 'robot' | 'helium' | 'studio' | 'radio' | 'echo';
    micGain?: number;
    spatialPan?: number;
    djDuckMode?: boolean;
    noiseSuppression?: boolean;
    echoCancellation?: boolean;
  }) {
    const prevPan = this.studioSpatialPan;
    if (opts.effect) this.studioEffect = opts.effect;
    if (typeof opts.micGain === 'number') this.studioGainPercent = opts.micGain;
    if (typeof opts.spatialPan === 'number' && Number.isFinite(opts.spatialPan)) {
      this.studioSpatialPan = Math.max(-1, Math.min(1, opts.spatialPan));
    }
    if (typeof opts.djDuckMode === 'boolean') {
      this.djDuckMode = opts.djDuckMode;
      if (this.musicBroadcastGain) {
        const baseRatio = Math.max(0, Math.min(1, this.musicState.volume / 100));
        const nextGain = this.djDuckMode ? baseRatio * 0.35 : baseRatio;
        try {
          this.musicBroadcastGain.gain.setTargetAtTime(nextGain, this.audioCtx?.currentTime || 0, 0.05);
        } catch {
          this.musicBroadcastGain.gain.value = nextGain;
        }
      }
    }
    if (this.localStream && (typeof opts.noiseSuppression === 'boolean' || typeof opts.echoCancellation === 'boolean')) {
      this.localStream.getAudioTracks().forEach((track) => {
        track
          .applyConstraints({
            noiseSuppression: opts.noiseSuppression ?? true,
            echoCancellation: opts.echoCancellation ?? true,
            autoGainControl: true
          })
          .catch(() => {});
      });
    }
    if (this.isInVoice && this.localStream) {
      if (
        this.studioPanner &&
        opts.effect === undefined &&
        Math.abs(prevPan) > 0.01 &&
        Math.abs(this.studioSpatialPan) > 0.01
      ) {
        try {
          this.studioPanner.pan.setTargetAtTime(this.studioSpatialPan, this.audioCtx?.currentTime || 0, 0.03);
          return;
        } catch {}
      }
      this.rebuildStudioChain();
    }
  }

  public setAdminMuted(muted: boolean) {
    this.isAdminMuted = muted;
    this.isMuted = muted;
    if (muted && this.musicEl && !this.musicEl.paused) {
      try { this.musicEl.pause(); } catch {}
    }
    this.syncOutgoingTrackEnabledState();
    if (muted) {
      this.lastSpeakingState = false;
      this.onVolumeChange?.(0);
    }
  }

  public setMutedState(muted: boolean): boolean {
    if (!muted && this.isAdminMuted) {
      this.isMuted = true;
      this.onError?.('🔇 المايك مكتوم عنك من قبل الإدارة ولا يمكنك فتحه حالياً.');
      return true;
    }
    if (!this.localStream) return this.isMuted;
    this.isMuted = muted;
    this.syncOutgoingTrackEnabledState();
    if (muted && !this.musicState.isPlaying) {
      this.lastSpeakingState = false;
      this.onVolumeChange?.(0);
    }
    const isSharingNow = Boolean(this.musicState.isActive && this.musicState.isPlaying && !this.isAdminMuted);
    this.socket.emit('voiceStateUpdate', {
      isMuted: this.isMuted,
      isSharingMusic: isSharingNow,
      isSpeaking: !muted ? this.lastSpeakingState : isSharingNow
    });
    return this.isMuted;
  }

  // Toggle local mute
  public toggleMute(): boolean {
    if (!this.localStream) return false;
    return this.setMutedState(!this.isMuted);
  }

  // Toggle Deafen (mute all remote voices)
  public toggleDeafen(): boolean {
    this.isDeafened = !this.isDeafened;
    this.peers.forEach((peer) => {
      if (peer.audioElement) {
        peer.audioElement.muted = this.isDeafened;
        if (!this.isDeafened && peer.stream && peer.audioElement.paused) {
          peer.audioElement.play().catch(() => {});
        }
      }
    });
    if (!this.isDeafened) {
      this.unlockAudioPlayback().catch(() => {});
    }
    return this.isDeafened;
  }

  // Close specific peer
  private closePeer(id: string) {
    this.pendingCandidates.delete(id);
    const dt = this.disconnectRecoveryTimers.get(id);
    if (dt) {
      clearTimeout(dt);
      this.disconnectRecoveryTimers.delete(id);
    }
    const peer = this.peers.get(id);
    if (peer) {
      if (peer.audioElement) {
        peer.audioElement.pause();
        peer.audioElement.srcObject = null;
        peer.audioElement.remove();
      }
      try {
        peer.pc.ontrack = null;
        peer.pc.onicecandidate = null;
        peer.pc.oniceconnectionstatechange = null;
        peer.pc.onconnectionstatechange = null;
        peer.pc.close();
      } catch {}
      this.peers.delete(id);
      this.notifyPeers();
    }
  }

  // Leave Voice Mic (keeps listener connections to any remaining room speakers!)
  public leaveVoice() {
    if (!this.isInVoice) return;
    this.isInVoice = false;
    this.isMuted = this.isAdminMuted;
    this.lastSpeakingState = false;

    this.cleanupAudioAnalysis();

    this.stopSharedMusic({ destroyElement: true });
    this.stopPcmFallbackStreaming();
    this.cleanupStudioChain();

    if (this.localStream) {
      this.localStream.getTracks().forEach((t) => t.stop());
      this.localStream = null;
    }

    if (this.audioCtx && this.audioCtx.state !== 'closed') {
      this.audioCtx.close().catch(() => {});
      this.audioCtx = null;
    }

    // Remove outgoing mic senders and keep recvonly connections to active speakers; close connections to listeners
    for (const [id, peer] of Array.from(this.peers.entries())) {
      const isSpeaker = peer.isRemoteSpeaker || this.activeRoomSpeakers.has(id);
      if (isSpeaker) {
        try {
          peer.pc.getSenders().forEach((sender) => {
            if (sender.track) {
              sender.replaceTrack(null).catch(() => {});
            }
          });
        } catch {}
      } else {
        this.closePeer(id);
      }
    }

    this.socket.emit('leaveVoice');
    this.notifyPeers();
  }

  // Check if WebRTC connection is already active and streaming with peer to avoid duplicate audio fallback
  public hasConnectedPeer(id: string): boolean {
    const peer = this.peers.get(id);
    if (!peer || !peer.pc) return false;
    const stateOk = peer.pc.connectionState === 'connected' || peer.pc.iceConnectionState === 'connected' || peer.pc.iceConnectionState === 'completed';
    const hasAudioTrack = Boolean(peer.stream && peer.stream.getAudioTracks().some((t) => t.readyState === 'live'));
    return stateOk && hasAudioTrack;
  }

  // Read live WebRTC telemetry (Ping/RTT, Packet Loss %, Jitter ms) from active RTCPeerConnections
  public async getNetworkQualityStats(): Promise<VoiceNetworkQualityStats> {
    const connectedPeers = Array.from(this.peers.values()).filter(
      (p) =>
        p.pc &&
        (p.pc.connectionState === 'connected' ||
          p.pc.iceConnectionState === 'connected' ||
          p.pc.iceConnectionState === 'completed')
    );

    if (connectedPeers.length === 0) {
      return {
        activePeers: 0,
        pingMs: null,
        packetLossPct: null,
        jitterMs: null
      };
    }

    const rttSamplesMs: number[] = [];
    const jitterSamplesMs: number[] = [];
    const remoteFractionLossPctSamples: number[] = [];
    let totalPacketsReceived = 0;
    let totalPacketsLost = 0;

    await Promise.all(
      connectedPeers.map(async (peer) => {
        try {
          const report = await peer.pc.getStats();
          report.forEach((stat: any) => {
            if (
              stat.type === 'candidate-pair' &&
              (stat.nominated || stat.state === 'succeeded') &&
              typeof stat.currentRoundTripTime === 'number' &&
              stat.currentRoundTripTime >= 0
            ) {
              rttSamplesMs.push(stat.currentRoundTripTime * 1000);
            } else if (
              stat.type === 'inbound-rtp' &&
              (stat.kind === 'audio' || stat.mediaType === 'audio')
            ) {
              if (typeof stat.packetsReceived === 'number' && stat.packetsReceived >= 0) {
                totalPacketsReceived += stat.packetsReceived;
              }
              if (typeof stat.packetsLost === 'number' && stat.packetsLost > 0) {
                totalPacketsLost += stat.packetsLost;
              }
              if (typeof stat.jitter === 'number' && stat.jitter >= 0) {
                jitterSamplesMs.push(stat.jitter * 1000);
              }
            } else if (
              stat.type === 'remote-inbound-rtp' &&
              (stat.kind === 'audio' || stat.mediaType === 'audio' || !stat.kind)
            ) {
              if (typeof stat.roundTripTime === 'number' && stat.roundTripTime >= 0) {
                rttSamplesMs.push(stat.roundTripTime * 1000);
              }
              if (typeof stat.jitter === 'number' && stat.jitter >= 0) {
                jitterSamplesMs.push(stat.jitter * 1000);
              }
              if (typeof stat.fractionLost === 'number' && stat.fractionLost >= 0) {
                remoteFractionLossPctSamples.push(stat.fractionLost * 100);
              }
            }
          });
        } catch {
          // Ignore single peer getStats failure during disconnect/renegotiation
        }
      })
    );

    const pingMs =
      rttSamplesMs.length > 0
        ? Math.round(rttSamplesMs.reduce((sum, v) => sum + v, 0) / rttSamplesMs.length)
        : null;

    let packetLossPct: number | null = null;
    if (totalPacketsReceived + totalPacketsLost > 0) {
      packetLossPct = Number(((totalPacketsLost / (totalPacketsReceived + totalPacketsLost)) * 100).toFixed(1));
    } else if (remoteFractionLossPctSamples.length > 0) {
      const avgFrac =
        remoteFractionLossPctSamples.reduce((sum, v) => sum + v, 0) / remoteFractionLossPctSamples.length;
      packetLossPct = Number(avgFrac.toFixed(1));
    }

    const jitterMs =
      jitterSamplesMs.length > 0
        ? Number((jitterSamplesMs.reduce((sum, v) => sum + v, 0) / jitterSamplesMs.length).toFixed(1))
        : null;

    return {
      activePeers: connectedPeers.length,
      pingMs,
      packetLossPct,
      jitterMs
    };
  }

  // Complete cleanup and destroy manager instance
  public destroy() {
    this.isListening = false;
    if (this.unsubscribeQuality) {
      this.unsubscribeQuality();
      this.unsubscribeQuality = null;
    }
    if (this.unlockHandler && typeof window !== 'undefined') {
      window.removeEventListener('pointerdown', this.unlockHandler);
      window.removeEventListener('touchstart', this.unlockHandler);
      window.removeEventListener('click', this.unlockHandler);
      this.unlockHandler = null;
      this.gestureUnlockAttached = false;
    }
    if (this.voiceWatchdogTimer) {
      clearInterval(this.voiceWatchdogTimer);
      this.voiceWatchdogTimer = null;
    }
    this.leaveVoice();
    this.peers.forEach((peer) => {
      if (peer.audioElement) {
        peer.audioElement.pause();
        peer.audioElement.srcObject = null;
        peer.audioElement.remove();
      }
      try {
        peer.pc.ontrack = null;
        peer.pc.onicecandidate = null;
        peer.pc.oniceconnectionstatechange = null;
        peer.pc.onconnectionstatechange = null;
        peer.pc.close();
      } catch {}
    });
    this.peers.clear();
    this.pendingCandidates.clear();
    this.lastFallbackRequestAt.clear();
    for (const t of this.fallbackTimers.values()) clearTimeout(t);
    this.fallbackTimers.clear();
    for (const t of this.disconnectRecoveryTimers.values()) clearTimeout(t);
    this.disconnectRecoveryTimers.clear();
    if (this.playbackCtx && this.playbackCtx.state !== 'closed') {
      this.playbackCtx.close().catch(() => {});
      this.playbackCtx = null;
    }
    this.socketListeners.forEach(({ event, fn }) => {
      this.socket.off(event, fn);
    });
    this.socketListeners = [];
    this.onVolumeChange = undefined;
    this.onPeersUpdated = undefined;
    this.onError = undefined;
    this.onAutoplayBlocked = undefined;
    this.onSharedMusicChange = undefined;
  }

  private notifyPeers() {
    if (this.onPeersUpdated) {
      this.onPeersUpdated(Array.from(this.peers.values()));
    }
  }
}
