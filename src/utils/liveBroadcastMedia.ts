import { Socket } from 'socket.io-client';
import {
  encodeDownsampledWavBase64,
  getRuntimeIceServers,
  optimizeSdpForWeakNetworks,
  refreshIceServersFromApi
} from './audioMesh';
import {
  getEffectiveQualityProfile,
  reportWebRtcNetworkHealth,
  subscribeQualityProfile
} from './networkQualityEngine';

/**
 * Dual-Layer Real-Time Audio Engine for Live Room Broadcasts
 * ----------------------------------------------------------
 * Guarantees Live Broadcaster audio reaches every Live Viewer:
 * 1. Primary: WebRTC Opus peer audio over STUN/TURN (24kbps FEC+DTX, port 443 TLS)
 * 2. Automatic VPN/Firewall Fallback: Downsampled 16kHz PCM-WAV chunks relayed over HTTPS WebSocket
 *    whenever a viewer's WebRTC connection fails, stalls, or disconnects behind strict VPN/NAT.
 */
export class LiveBroadcastAudioManager {
  private socket: Socket;
  private room = 'الغرفة العامة';
  private role: 'idle' | 'broadcaster' | 'viewer' = 'idle';

  // Broadcaster state
  private localStream: MediaStream | null = null;
  private isMicMuted = false;
  private viewerPeers: Map<string, RTCPeerConnection> = new Map();
  private restartTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();
  private pendingBroadcasterCandidates: Map<string, RTCIceCandidateInit[]> = new Map();
  private pcmCtx: AudioContext | null = null;
  private pcmSource: MediaStreamAudioSourceNode | null = null;
  private pcmProcessor: ScriptProcessorNode | null = null;
  private pcmWorkletNode: AudioWorkletNode | null = null;
  private pcmWorkletLoadedCtx: WeakSet<AudioContext> = new WeakSet();
  private pcmSilentGain: GainNode | null = null;
  private pcmBuffer: Float32Array[] = [];
  private pcmTotalSamples = 0;
  private isFallbackStreaming = false;
  private pcmFallbackExpireTimer: ReturnType<typeof setTimeout> | null = null;

  // Viewer state
  private broadcasterId: string | null = null;
  private viewerPc: RTCPeerConnection | null = null;
  private pendingViewerCandidates: RTCIceCandidateInit[] = [];
  private remoteStream: MediaStream | null = null;
  private remoteAudioEl: HTMLAudioElement | null = null;
  private playbackCtx: AudioContext | null = null;
  private nextFallbackPlayTime = 0;
  private viewerFallbackCheckTimer: ReturnType<typeof setTimeout> | null = null;
  private viewerWatchdogTimer: ReturnType<typeof setInterval> | null = null;
  private lastFallbackRequestAt = 0;
  public isViewerMuted = false;
  public autoplayBlocked = false;

  public onAutoplayBlocked?: (blocked: boolean) => void;

  private listeners: Array<{ event: string; fn: (...args: any[]) => void }> = [];
  private unsubscribeQuality: (() => void) | null = null;
  private broadcasterStatsTimer: ReturnType<typeof setInterval> | null = null;

  constructor(socket: Socket) {
    this.socket = socket;
    refreshIceServersFromApi().catch(() => {});
    this.attachSocketListeners();
    this.unsubscribeQuality = subscribeQualityProfile(() => {
      this.applyAdaptiveAudioBitrate();
    });
  }

  private applyAdaptiveAudioBitrate() {
    if (this.role !== 'broadcaster' || this.viewerPeers.size === 0) return;
    const profile = getEffectiveQualityProfile();
    const targetBps = Math.max(10000, Math.min(96000, profile.micAudioBitrateKbps * 1000));
    for (const pc of this.viewerPeers.values()) {
      pc.getSenders().forEach((sender) => {
        if (sender.track && sender.track.kind === 'audio') {
          try {
            const params = sender.getParameters();
            if (!params.encodings || params.encodings.length === 0) params.encodings = [{}];
            params.encodings[0].maxBitrate = targetBps;
            sender.setParameters(params).catch(() => {});
          } catch {}
        }
      });
    }
  }

  private on(event: string, fn: (...args: any[]) => void) {
    this.socket.on(event, fn);
    this.listeners.push({ event, fn });
  }

  private attachSocketListeners() {
    this.on('liveViewerJoined', ({ viewerId }: { viewerId: string }) => {
      if (this.role !== 'broadcaster' || !viewerId || viewerId === this.socket.id) return;
      this.createBroadcasterPeerOffer(viewerId);
    });

    this.on('liveViewerLeft', ({ viewerId }: { viewerId: string }) => {
      if (this.role !== 'broadcaster' || !viewerId) return;
      this.closeBroadcasterPeer(viewerId);
    });

    this.on('enableLiveAudioFallback', () => {
      if (this.role === 'broadcaster' && this.localStream) {
        if (!this.isFallbackStreaming) {
          this.startPcmFallbackStreaming();
        }
        this.touchPcmFallbackTimer();
      }
    });

    this.on('liveBroadcasterReconnected', ({ broadcasterId }: { broadcasterId: string }) => {
      if (this.role === 'viewer' && broadcasterId) {
        this.closeViewerPeer();
        this.broadcasterId = broadcasterId;
        this.nextFallbackPlayTime = 0;
        this.requestFallback();
      }
    });

    this.on('liveSignal', async ({ senderId, signal }: { senderId: string; signal: any }) => {
      if (!senderId || senderId === this.socket.id || !signal) return;
      try {
        if (this.role === 'viewer' && signal.type === 'offer') {
          await this.handleViewerOffer(senderId, signal);
        } else if (this.role === 'broadcaster' && signal.type === 'answer') {
          const pc = this.viewerPeers.get(senderId);
          if (pc && pc.signalingState === 'have-local-offer') {
            await pc.setRemoteDescription(new RTCSessionDescription(signal));
            const queued = this.pendingBroadcasterCandidates.get(senderId);
            if (queued?.length) {
              for (const c of queued) await pc.addIceCandidate(new RTCIceCandidate(c)).catch(() => {});
              this.pendingBroadcasterCandidates.delete(senderId);
            }
          }
        } else if (signal.candidate) {
          if (this.role === 'viewer') {
            if (this.viewerPc && this.viewerPc.remoteDescription) {
              await this.viewerPc.addIceCandidate(new RTCIceCandidate(signal.candidate)).catch(() => {});
            } else {
              this.pendingViewerCandidates.push(signal.candidate);
            }
          } else if (this.role === 'broadcaster') {
            const pc = this.viewerPeers.get(senderId);
            if (pc && pc.remoteDescription) {
              await pc.addIceCandidate(new RTCIceCandidate(signal.candidate)).catch(() => {});
            } else {
              const list = this.pendingBroadcasterCandidates.get(senderId) || [];
              list.push(signal.candidate);
              this.pendingBroadcasterCandidates.set(senderId, list);
            }
          }
        }
      } catch {}
    });

    this.on('liveAudioChunk', ({ chunk }: { chunk: string }) => {
      if (this.role !== 'viewer' || !chunk || this.isViewerMuted) return;
      if (this.hasConnectedViewerWebRtc()) return;
      this.playFallbackChunk(chunk);
    });
  }

  public startBroadcaster(room: string, stream: MediaStream, micMuted = false): void {
    this.stop();
    this.role = 'broadcaster';
    this.room = room || 'الغرفة العامة';
    this.localStream = stream;
    this.isMicMuted = micMuted;
    refreshIceServersFromApi().catch(() => {});
    if (this.broadcasterStatsTimer) clearInterval(this.broadcasterStatsTimer);
    this.broadcasterStatsTimer = setInterval(() => {
      if (this.role !== 'broadcaster' || this.viewerPeers.size === 0) return;
      const samplePc = Array.from(this.viewerPeers.values()).find(
        (p) => p.connectionState === 'connected' || p.iceConnectionState === 'connected'
      );
      if (!samplePc) return;
      samplePc.getStats().then((report) => {
        let rttMs: number | null = null;
        let lossPct: number | null = null;
        report.forEach((stat: any) => {
          if (stat.type === 'candidate-pair' && (stat.nominated || stat.state === 'succeeded') && typeof stat.currentRoundTripTime === 'number') {
            rttMs = Math.round(stat.currentRoundTripTime * 1000);
          } else if (stat.type === 'remote-inbound-rtp' && typeof stat.fractionLost === 'number') {
            lossPct = Number((stat.fractionLost * 100).toFixed(1));
          }
        });
        if (rttMs !== null || lossPct !== null) {
          reportWebRtcNetworkHealth({ rttMs, packetLossPct: lossPct });
          this.applyAdaptiveAudioBitrate();
        }
      }).catch(() => {});
    }, 4000);
  }

  public setBroadcasterMicMuted(muted: boolean): void {
    this.isMicMuted = muted;
  }

  public async updateBroadcasterStream(newStream: MediaStream): Promise<void> {
    this.localStream = newStream;
    if (this.role !== 'broadcaster') return;

    const newAudioTrack = newStream.getAudioTracks()[0] || null;
    for (const pc of this.viewerPeers.values()) {
      const audioSender = pc.getSenders().find((s) => !s.track || s.track.kind === 'audio');
      if (audioSender && newAudioTrack) {
        await audioSender.replaceTrack(newAudioTrack).catch(() => {});
      }
    }

    if (this.isFallbackStreaming) {
      this.stopPcmFallback();
      this.startPcmFallbackStreaming();
    }
  }

  private async createBroadcasterPeerOffer(viewerId: string): Promise<void> {
    this.closeBroadcasterPeer(viewerId);
    const pc = new RTCPeerConnection(getRuntimeIceServers());
    this.viewerPeers.set(viewerId, pc);

    if (this.localStream) {
      const audioTracks = this.localStream.getAudioTracks();
      audioTracks.forEach((track) => {
        pc.addTrack(track, this.localStream!);
      });
    }

    pc.onicecandidate = (e) => {
      if (e.candidate) {
        this.socket.emit('liveSignal', {
          targetId: viewerId,
          signal: { candidate: e.candidate }
        });
      }
    };

    let restartTries = 0;
    let isRestarting = false;
    const onState = () => {
      const state = pc.iceConnectionState;
      const conn = pc.connectionState;
      if (state === 'connected' || state === 'completed' || conn === 'connected') {
        restartTries = 0;
        isRestarting = false;
        const rt = this.restartTimers.get(viewerId);
        if (rt) {
          clearTimeout(rt);
          this.restartTimers.delete(viewerId);
        }
        this.applyAdaptiveAudioBitrate();
        return;
      }
      if ((state === 'failed' || state === 'disconnected' || conn === 'failed') && !isRestarting && restartTries < 2 && this.role === 'broadcaster') {
        if (this.restartTimers.has(viewerId)) return;
        restartTries += 1;
        const t = setTimeout(() => {
          this.restartTimers.delete(viewerId);
          if (this.role !== 'broadcaster' || this.viewerPeers.get(viewerId) !== pc) return;
          if (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed' || pc.connectionState === 'connected') return;
          isRestarting = true;
          pc.createOffer({ iceRestart: true })
            .then(async (raw) => {
              const offer = raw.sdp ? { type: raw.type, sdp: optimizeSdpForWeakNetworks(raw.sdp) } : raw;
              await pc.setLocalDescription(offer);
              this.socket.emit('liveSignal', { targetId: viewerId, signal: offer });
            })
            .catch(() => {})
            .finally(() => {
              isRestarting = false;
            });
        }, state === 'disconnected' ? 1600 : 100);
        this.restartTimers.set(viewerId, t);
      }
    };
    pc.oniceconnectionstatechange = onState;
    pc.onconnectionstatechange = onState;

    try {
      let offer = await pc.createOffer();
      if (offer.sdp) {
        offer = { type: offer.type, sdp: optimizeSdpForWeakNetworks(offer.sdp) };
      }
      await pc.setLocalDescription(offer);
      this.socket.emit('liveSignal', { targetId: viewerId, signal: offer });
    } catch {}
  }

  private closeBroadcasterPeer(viewerId: string) {
    const rt = this.restartTimers.get(viewerId);
    if (rt) {
      clearTimeout(rt);
      this.restartTimers.delete(viewerId);
    }
    this.pendingBroadcasterCandidates.delete(viewerId);
    const pc = this.viewerPeers.get(viewerId);
    if (pc) {
      try {
        pc.onicecandidate = null;
        pc.oniceconnectionstatechange = null;
        pc.onconnectionstatechange = null;
        pc.close();
      } catch {}
      this.viewerPeers.delete(viewerId);
    }
  }

  private async startPcmFallbackStreaming() {
    if (!this.localStream || this.role !== 'broadcaster' || this.isFallbackStreaming) return;
    if (this.localStream.getAudioTracks().length === 0) return;

    try {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = this.pcmCtx && this.pcmCtx.state !== 'closed' ? this.pcmCtx : new AudioCtx();
      this.pcmCtx = ctx;
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});

      const source = ctx.createMediaStreamSource(this.localStream);
      const silentGain = ctx.createGain();
      silentGain.gain.value = 0;

      this.pcmSource = source;
      this.pcmSilentGain = silentGain;
      this.pcmBuffer = [];
      this.pcmTotalSamples = 0;
      this.isFallbackStreaming = true;

      const liveProfile = getEffectiveQualityProfile();
      const targetChunkSamples = Math.round(ctx.sampleRate * (liveProfile.pcmFallbackChunkMs / 1000));
      const handleSamples = (input: Float32Array) => {
        if (this.role !== 'broadcaster' || this.isMicMuted || !this.isFallbackStreaming) return;
        const copy = new Float32Array(input.length);
        copy.set(input);
        this.pcmBuffer.push(copy);
        this.pcmTotalSamples += copy.length;

        if (this.pcmTotalSamples >= targetChunkSamples) {
          const merged = new Float32Array(this.pcmTotalSamples);
          let pos = 0;
          for (const b of this.pcmBuffer) {
            merged.set(b, pos);
            pos += b.length;
          }
          this.pcmBuffer = [];
          this.pcmTotalSamples = 0;

          let maxAmp = 0;
          for (let i = 0; i < merged.length; i += 8) {
            const abs = Math.abs(merged[i]);
            if (abs > maxAmp) maxAmp = abs;
          }
          if (maxAmp > 0.004) {
            const currentProf = getEffectiveQualityProfile();
            const chunk = encodeDownsampledWavBase64(merged, ctx.sampleRate, currentProf.pcmFallbackSampleRate);
            this.socket.emit('liveAudioChunk', { room: this.room, chunk });
          }
        }
      };

      let workletConnected = false;
      if (typeof AudioWorkletNode !== 'undefined' && ctx.audioWorklet) {
        try {
          if (!this.pcmWorkletLoadedCtx.has(ctx)) {
            const processorCode = `
              class LivePcmCaptureProcessor extends AudioWorkletProcessor {
                process(inputs) {
                  const input = inputs[0] && inputs[0][0];
                  if (input && input.length) {
                    this.port.postMessage(new Float32Array(input));
                  }
                  return true;
                }
              }
              registerProcessor('hassan-live-pcm-capture', LivePcmCaptureProcessor);
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
          if (this.role !== 'broadcaster' || !this.isFallbackStreaming) return;
          const workletNode = new AudioWorkletNode(ctx, 'hassan-live-pcm-capture');
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
    } catch {
      this.isFallbackStreaming = false;
    }
  }

  private touchPcmFallbackTimer() {
    if (this.pcmFallbackExpireTimer) {
      clearTimeout(this.pcmFallbackExpireTimer);
    }
    this.pcmFallbackExpireTimer = setTimeout(() => {
      this.pcmFallbackExpireTimer = null;
      this.stopPcmFallback();
    }, 12000);
  }

  private stopPcmFallback() {
    if (this.pcmFallbackExpireTimer) {
      clearTimeout(this.pcmFallbackExpireTimer);
      this.pcmFallbackExpireTimer = null;
    }
    this.isFallbackStreaming = false;
    this.pcmBuffer = [];
    this.pcmTotalSamples = 0;
    try {
      if (this.pcmWorkletNode) {
        this.pcmWorkletNode.port.onmessage = null;
        this.pcmWorkletNode.disconnect();
      }
      this.pcmProcessor?.disconnect();
      this.pcmSource?.disconnect();
      this.pcmSilentGain?.disconnect();
    } catch {}
    this.pcmWorkletNode = null;
    this.pcmProcessor = null;
    this.pcmSource = null;
    this.pcmSilentGain = null;
  }

  // ==================== VIEWER SIDE ====================

  public startViewer(room: string, broadcasterId?: string): void {
    this.stop();
    this.role = 'viewer';
    this.room = room || 'الغرفة العامة';
    this.broadcasterId = broadcasterId || null;
    this.isViewerMuted = false;
    this.autoplayBlocked = false;
    refreshIceServersFromApi().catch(() => {});
    this.unlockPlayback().catch(() => {});

    // Check quickly at 2.2s if WebRTC connected; if blocked by VPN/firewall, request WebSocket audio fallback
    this.viewerFallbackCheckTimer = setTimeout(() => {
      if (this.role === 'viewer' && !this.hasConnectedViewerWebRtc()) {
        this.requestFallback();
      }
    }, 2200);

    // Continuous watchdog every 3.5s in case VPN toggles mid-stream
    this.viewerWatchdogTimer = setInterval(() => {
      if (this.role === 'viewer' && !this.hasConnectedViewerWebRtc()) {
        this.requestFallback();
      }
    }, 3500);
  }

  private requestFallback() {
    const now = Date.now();
    if (now - this.lastFallbackRequestAt < 3000) return;
    this.lastFallbackRequestAt = now;
    this.socket.emit('requestLiveAudioFallback', { room: this.room });
  }

  private async handleViewerOffer(broadcasterId: string, offer: RTCSessionDescriptionInit): Promise<void> {
    const canReusePeer = Boolean(
      this.viewerPc &&
        this.broadcasterId === broadcasterId &&
        this.viewerPc.signalingState !== 'closed' &&
        this.viewerPc.iceConnectionState !== 'failed' &&
        this.viewerPc.iceConnectionState !== 'closed' &&
        this.viewerPc.connectionState !== 'failed' &&
        this.viewerPc.connectionState !== 'closed'
    );

    let pc: RTCPeerConnection;
    if (canReusePeer && this.viewerPc) {
      pc = this.viewerPc;
    } else {
      this.broadcasterId = broadcasterId;
      this.closeViewerPeer();

      pc = new RTCPeerConnection(getRuntimeIceServers());
      this.viewerPc = pc;

      pc.ontrack = (e) => {
        const stream = e.streams?.[0] || new MediaStream([e.track]);
        this.remoteStream = stream;
        this.attachViewerAudio(stream);
      };

      pc.onicecandidate = (e) => {
        if (e.candidate) {
          this.socket.emit('liveSignal', {
            targetId: broadcasterId,
            signal: { candidate: e.candidate }
          });
        }
      };

      const handleState = () => {
        const ice = pc.iceConnectionState;
        const conn = pc.connectionState;
        if (ice === 'failed' || ice === 'disconnected' || conn === 'failed' || conn === 'disconnected') {
          this.requestFallback();
        }
      };
      pc.oniceconnectionstatechange = handleState;
      pc.onconnectionstatechange = handleState;
    }

    await pc.setRemoteDescription(new RTCSessionDescription(offer));
    if (this.pendingViewerCandidates.length > 0) {
      for (const c of this.pendingViewerCandidates) {
        await pc.addIceCandidate(new RTCIceCandidate(c)).catch(() => {});
      }
      this.pendingViewerCandidates = [];
    }

    if (pc.getTransceivers().length === 0) {
      pc.addTransceiver('audio', { direction: 'recvonly' });
    }

    let answer = await pc.createAnswer();
    if (answer.sdp) {
      answer = { type: answer.type, sdp: optimizeSdpForWeakNetworks(answer.sdp) };
    }
    await pc.setLocalDescription(answer);
    this.socket.emit('liveSignal', { targetId: broadcasterId, signal: answer });
  }

  private attachViewerAudio(stream: MediaStream) {
    if (typeof document === 'undefined') return;
    if (!this.remoteAudioEl) {
      const el = document.createElement('audio');
      el.autoplay = true;
      el.setAttribute('playsinline', 'true');
      el.setAttribute('webkit-playsinline', 'true');
      (el as any).playsInline = true;
      el.style.display = 'none';
      document.body.appendChild(el);
      this.remoteAudioEl = el;
    }
    this.remoteAudioEl.srcObject = stream;
    this.remoteAudioEl.muted = this.isViewerMuted;
    this.remoteAudioEl
      .play()
      .then(() => {
        this.autoplayBlocked = false;
        this.onAutoplayBlocked?.(false);
      })
      .catch(() => {
        this.autoplayBlocked = true;
        this.onAutoplayBlocked?.(true);
      });
  }

  public hasConnectedViewerWebRtc(): boolean {
    if (!this.viewerPc) return false;
    const stateOk =
      this.viewerPc.connectionState === 'connected' ||
      this.viewerPc.iceConnectionState === 'connected' ||
      this.viewerPc.iceConnectionState === 'completed';
    const hasLiveAudio = Boolean(this.remoteStream?.getAudioTracks().some((t) => t.readyState === 'live'));
    return stateOk && hasLiveAudio;
  }

  public setViewerMuted(muted: boolean): void {
    this.isViewerMuted = muted;
    if (this.remoteAudioEl) {
      this.remoteAudioEl.muted = muted;
      if (!muted && this.remoteStream && this.remoteAudioEl.paused) {
        this.remoteAudioEl.play().catch(() => {});
      }
    }
    if (!muted) {
      this.unlockPlayback().catch(() => {});
    }
  }

  public async unlockPlayback(): Promise<void> {
    let blocked = false;
    if (!this.playbackCtx || this.playbackCtx.state === 'closed') {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (AudioCtx) this.playbackCtx = new AudioCtx();
    }
    if (this.playbackCtx && this.playbackCtx.state === 'suspended') {
      try {
        await this.playbackCtx.resume();
      } catch {
        blocked = true;
      }
    }
    if (this.remoteAudioEl && this.remoteStream) {
      this.remoteAudioEl.muted = this.isViewerMuted;
      if (this.remoteAudioEl.paused) {
        try {
          await this.remoteAudioEl.play();
        } catch {
          blocked = true;
        }
      }
    }
    this.autoplayBlocked = blocked;
    this.onAutoplayBlocked?.(blocked);
  }

  private async playFallbackChunk(chunkDataUri: string): Promise<void> {
    if (this.isViewerMuted || this.hasConnectedViewerWebRtc()) return;
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
      for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);

      const audioBuffer = await ctx.decodeAudioData(bytes.buffer.slice(0));
      const source = ctx.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(ctx.destination);

      const now = ctx.currentTime;
      const prev = this.nextFallbackPlayTime || now + 0.02;
      const scheduledAt = Math.min(now + 0.32, Math.max(now + 0.02, prev));
      source.start(scheduledAt);
      this.nextFallbackPlayTime = scheduledAt + audioBuffer.duration;
    } catch {
      this.nextFallbackPlayTime = 0;
    }
  }

  private closeViewerPeer() {
    this.pendingViewerCandidates = [];
    this.remoteStream = null;
    if (this.viewerPc) {
      try {
        this.viewerPc.ontrack = null;
        this.viewerPc.onicecandidate = null;
        this.viewerPc.oniceconnectionstatechange = null;
        this.viewerPc.onconnectionstatechange = null;
        this.viewerPc.close();
      } catch {}
      this.viewerPc = null;
    }
    if (this.remoteAudioEl) {
      try {
        this.remoteAudioEl.pause();
        this.remoteAudioEl.srcObject = null;
        this.remoteAudioEl.remove();
      } catch {}
      this.remoteAudioEl = null;
    }
  }

  public stop(): void {
    this.role = 'idle';
    this.localStream = null;
    this.broadcasterId = null;
    this.nextFallbackPlayTime = 0;

    if (this.broadcasterStatsTimer) {
      clearInterval(this.broadcasterStatsTimer);
      this.broadcasterStatsTimer = null;
    }

    if (this.viewerFallbackCheckTimer) {
      clearTimeout(this.viewerFallbackCheckTimer);
      this.viewerFallbackCheckTimer = null;
    }
    if (this.viewerWatchdogTimer) {
      clearInterval(this.viewerWatchdogTimer);
      this.viewerWatchdogTimer = null;
    }

    this.stopPcmFallback();
    if (this.pcmCtx && this.pcmCtx.state !== 'closed') {
      this.pcmCtx.close().catch(() => {});
      this.pcmCtx = null;
    }

    for (const viewerId of Array.from(this.viewerPeers.keys())) {
      this.closeBroadcasterPeer(viewerId);
    }
    this.closeViewerPeer();

    if (this.playbackCtx && this.playbackCtx.state !== 'closed') {
      this.playbackCtx.close().catch(() => {});
      this.playbackCtx = null;
    }
  }

  public destroy(): void {
    if (this.unsubscribeQuality) {
      this.unsubscribeQuality();
      this.unsubscribeQuality = null;
    }
    this.stop();
    for (const { event, fn } of this.listeners) {
      this.socket.off(event, fn);
    }
    this.listeners = [];
    this.onAutoplayBlocked = undefined;
  }
}
