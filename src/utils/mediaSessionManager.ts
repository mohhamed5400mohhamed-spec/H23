/**
 * Unified Native Media Session, Audio Focus & Phone Call Interruption Engine
 * ---------------------------------------------------------------------------
 * Coordinates:
 * 1. Wall Videos (<video> + background <audio>)
 * 2. Wall YouTube Videos (<iframe> + underlying silent MediaStream keep-alive)
 * 3. Voice Notes (VoiceNoteModule in Public Rooms & Private Chat)
 * 4. In-App Voice/Video Calls (PrivateCallOverlay & AudioMeshManager)
 * 5. Background WebSocket Keep-Alive Player
 *
 * Guarantees:
 * - Automatic navigator.mediaSession metadata & live position sync for phone lockscreen/notification bar
 * - Immediate pause on Phone Call Interruption / OS audio focus loss, with automatic resume after call ends
 * - Zero audio-focus fighting between players or external apps (WhatsApp, YouTube, Phone Calls)
 * - Continuous background playback until the clip finishes or the user manually stops it
 */

export type MediaSourceKind =
  | 'call'
  | 'voice-note'
  | 'wall-video'
  | 'wall-youtube'
  | 'keepalive';

export interface ActiveMediaDescriptor {
  id: string;
  kind: MediaSourceKind;
  title: string;
  artist: string;
  album?: string;
  artworkUrl?: string;
  duration?: number;
  currentTime?: number;
  playbackRate?: number;
  isPlaying: boolean;
  /** Called when user presses Play in OS notification bar or when a phone call ends */
  onPlay: () => void;
  /** Called when user presses Pause in OS notification bar */
  onPause: () => void;
  /** Called when user presses Stop / closes notification player */
  onStop?: () => void;
  /** Called when user seeks in OS notification bar */
  onSeekTo?: (time: number) => void;
  /** Called when user presses Next Track in OS notification bar */
  onNextTrack?: () => void;
  /** Called when user presses Previous Track in OS notification bar */
  onPreviousTrack?: () => void;
  /** Called immediately when OS phone call or external exclusive audio interrupts playback */
  onInterruptPause?: () => void;
  /** Called automatically when the phone call ends and audio focus returns */
  onInterruptResume?: () => void;
}

const SOURCE_PRIORITY: Record<MediaSourceKind, number> = {
  call: 100,
  'voice-note': 80,
  'wall-video': 70,
  'wall-youtube': 60,
  keepalive: 10
};

class UnifiedMediaSessionManager {
  private activeMedia: ActiveMediaDescriptor | null = null;
  private suspendedMediaStack: ActiveMediaDescriptor[] = [];
  private keepAliveDescriptor: ActiveMediaDescriptor | null = null;

  // AudioContext used to detect iOS/Android Phone Call Interruptions ('interrupted' / 'suspended')
  private monitorCtx: AudioContext | null = null;
  private isInterruptedByExternal = false;
  private wasPlayingBeforeInterrupt = false;
  private interruptedMediaId: string | null = null;
  private interruptRecoveryTimer: number | null = null;
  private unexpectedPauseRecoveryTimer: number | null = null;
  private unexpectedPauseRecoveryAttempts = 0;
  private isInCallMode = false;
  private listenersAttached = false;

  private isWallKind(kind: MediaSourceKind): boolean {
    return kind === 'wall-video' || kind === 'wall-youtube';
  }

  private clearUnexpectedPauseRecovery(): void {
    if (this.unexpectedPauseRecoveryTimer !== null) {
      clearTimeout(this.unexpectedPauseRecoveryTimer);
      this.unexpectedPauseRecoveryTimer = null;
    }
    this.unexpectedPauseRecoveryAttempts = 0;
  }

  constructor() {
    if (typeof window !== 'undefined') {
      this.attachGlobalListeners();
    }
  }

  private attachGlobalListeners(): void {
    if (this.listenersAttached || typeof window === 'undefined') return;
    this.listenersAttached = true;

    const tryRecoverOnForeground = () => {
      if (this.isInterruptedByExternal && !this.isInCallMode) {
        this.probeAudioFocusRecovery();
      }
    };

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        tryRecoverOnForeground();
      }
    });
    window.addEventListener('focus', tryRecoverOnForeground);
    window.addEventListener('pageshow', tryRecoverOnForeground);
  }

  /**
   * Initializes or returns the shared AudioContext used for both Keep-Alive MediaStream
   * and OS-level Phone Call / Audio Focus interruption detection.
   */
  public ensureAudioContext(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    if (this.monitorCtx && this.monitorCtx.state !== 'closed') {
      return this.monitorCtx;
    }
    try {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return null;
      const ctx = new AudioCtx({ latencyHint: 'playback' });
      this.monitorCtx = ctx;

      ctx.addEventListener('statechange', () => {
        const state = ctx.state as string;
        if (state === 'interrupted') {
          // Real iOS / OS phone call or exclusive audio interruption
          this.handleExternalInterruption('audioctx-interrupted');
        } else if (state === 'suspended') {
          // Browsers routinely suspend WebAudio AudioContext when screen locks or app is backgrounded.
          // Do NOT treat routine background 'suspended' as a phone call interruption, otherwise it kills
          // HTML5 <audio>/<video> background playback on screen lock!
          if (this.activeMedia && this.activeMedia.isPlaying && !this.isInCallMode) {
            if (this.activeMedia.kind === 'keepalive' && typeof document !== 'undefined' && !document.hidden) {
              ctx.resume().catch(() => {});
            }
          }
        } else if (state === 'running') {
          if (this.isInterruptedByExternal && !this.isInCallMode) {
            this.completeAudioFocusRecovery();
          }
        }
      });

      return ctx;
    } catch {
      return null;
    }
  }

  public getAudioContextState(): string {
    return this.monitorCtx ? (this.monitorCtx.state as string) : 'none';
  }

  /**
   * Registers or updates the fallback Keep-Alive MediaSession descriptor.
   * When active higher-priority media (Wall Video, YouTube, Voice Note) finishes or stops,
   * the notification bar cleanly reverts to this descriptor if enabled.
   */
  public setKeepAliveDescriptor(descriptor: ActiveMediaDescriptor | null): void {
    this.keepAliveDescriptor = descriptor;
    if (!this.activeMedia || this.activeMedia.kind === 'keepalive') {
      if (descriptor) {
        this.activeMedia = descriptor;
        this.syncNavigatorMediaSession();
      } else if (this.activeMedia?.kind === 'keepalive') {
        this.activeMedia = null;
        this.clearNavigatorMediaSession();
      }
    }
  }

  /**
   * Activates a foreground/background media item (Wall Video, YouTube, Voice Note, or Keep-Alive)
   * and binds it to navigator.mediaSession.
   */
  public activateMedia(descriptor: ActiveMediaDescriptor): void {
    if (descriptor.kind === 'keepalive') {
      this.setKeepAliveDescriptor(descriptor);
      return;
    }

    // Reset stale interruption & unexpected pause recovery state when user explicitly starts a new clip
    this.clearInterruptRecovery();
    this.clearUnexpectedPauseRecovery();
    this.isInterruptedByExternal = false;
    this.wasPlayingBeforeInterrupt = false;
    this.interruptedMediaId = null;

    // Ensure monitor AudioContext is running so we can detect phone call interruptions
    const ctx = this.ensureAudioContext();
    if (ctx && ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }

    const current = this.activeMedia;
    if (current && current.id !== descriptor.id && current.kind !== 'keepalive') {
      if (this.isWallKind(current.kind) && this.isWallKind(descriptor.kind)) {
        // Wall items share the single floating player; replace directly without pausing the newly loaded source
        this.suspendedMediaStack = this.suspendedMediaStack.filter((m) => !this.isWallKind(m.kind));
      } else if (current.kind === 'voice-note' && descriptor.kind === 'voice-note') {
        try {
          current.onPause();
        } catch {}
      } else if (SOURCE_PRIORITY[current.kind] <= SOURCE_PRIORITY[descriptor.kind]) {
        // Save lower-priority active media (e.g. Wall Video paused temporarily while a Voice Note plays)
        if (current.isPlaying) {
          try {
            current.onPause();
          } catch {}
          this.suspendedMediaStack = this.suspendedMediaStack.filter((m) => m.id !== current.id);
          this.suspendedMediaStack.push({ ...current, isPlaying: true });
        }
      }
    }

    this.activeMedia = descriptor;
    this.syncNavigatorMediaSession();
  }

  /**
   * Updates title, playback state, or timeline position for an already-registered media item.
   */
  public updateMediaState(
    id: string,
    patch: Partial<Pick<ActiveMediaDescriptor, 'title' | 'artist' | 'album' | 'artworkUrl' | 'duration' | 'currentTime' | 'playbackRate' | 'isPlaying'>>
  ): void {
    if (this.keepAliveDescriptor && this.keepAliveDescriptor.id === id) {
      this.keepAliveDescriptor = { ...this.keepAliveDescriptor, ...patch };
    }
    if (!this.activeMedia || this.activeMedia.id !== id) return;

    const metadataChanged =
      (patch.title !== undefined && patch.title !== this.activeMedia.title) ||
      (patch.artist !== undefined && patch.artist !== this.activeMedia.artist) ||
      (patch.album !== undefined && patch.album !== this.activeMedia.album) ||
      (patch.artworkUrl !== undefined && patch.artworkUrl !== this.activeMedia.artworkUrl);

    this.activeMedia = { ...this.activeMedia, ...patch };
    if (patch.isPlaying === true) {
      this.clearUnexpectedPauseRecovery();
    } else if (patch.isPlaying === false) {
      if (this.unexpectedPauseRecoveryTimer !== null) {
        clearTimeout(this.unexpectedPauseRecoveryTimer);
        this.unexpectedPauseRecoveryTimer = null;
      }
    }

    if (metadataChanged) {
      this.syncNavigatorMediaSession();
    } else {
      this.syncPlaybackAndPosition();
    }
  }

  /**
   * Deactivates a media item when it finishes or is manually closed by the user.
   * Cleanly restores any suspended media or falls back to Keep-Alive.
   */
  public deactivateMedia(id: string): void {
    this.suspendedMediaStack = this.suspendedMediaStack.filter((m) => m.id !== id);

    if (this.interruptedMediaId === id) {
      this.clearInterruptRecovery();
      this.isInterruptedByExternal = false;
      this.wasPlayingBeforeInterrupt = false;
      this.interruptedMediaId = null;
    }

    if (this.activeMedia?.id !== id) return;
    this.clearUnexpectedPauseRecovery();

    // Restore suspended Wall Video/YouTube only if not currently in Call/Mic mode
    if (!this.isInCallMode) {
      const prevSuspended = this.suspendedMediaStack.pop();
      if (prevSuspended) {
        this.activeMedia = prevSuspended;
        this.syncNavigatorMediaSession();
        try {
          prevSuspended.onPlay();
        } catch {}
        return;
      }
    }

    if (this.keepAliveDescriptor && id !== this.keepAliveDescriptor.id) {
      this.activeMedia = this.keepAliveDescriptor;
      this.syncNavigatorMediaSession();
      if (this.keepAliveDescriptor.isPlaying && !this.isInCallMode) {
        try {
          this.keepAliveDescriptor.onPlay();
        } catch {}
      }
      return;
    }

    this.activeMedia = null;
    this.clearNavigatorMediaSession();
  }

  public getActiveMediaId(): string | null {
    return this.activeMedia?.id || null;
  }

  public getActiveMediaKind(): MediaSourceKind | null {
    return this.activeMedia?.kind || null;
  }

  public isCallModeActive(): boolean {
    return this.isInCallMode;
  }

  /**
   * Called by HTMLMediaElement 'pause' listeners when playback pauses unexpectedly
   * (e.g. OS Phone Call Interruption or another app taking audio focus on Android/iOS).
   */
  public notifyUnexpectedElementPause(id: string): void {
    if (!this.activeMedia || this.activeMedia.id !== id) return;
    if (this.isInCallMode) return;

    const ctxState = this.getAudioContextState();

    // For Keep-Alive audio: only pause on an actual OS phone call ('interrupted').
    // If Android/iOS briefly paused the element in background, revive playback immediately
    // instead of letting the OS freeze the WebSocket connection.
    if (this.activeMedia.kind === 'keepalive') {
      if (ctxState === 'interrupted') {
        if (this.activeMedia.isPlaying) {
          this.handleExternalInterruption('element-pause-interrupted');
        }
      } else if (this.activeMedia.isPlaying) {
        setTimeout(() => {
          if (this.activeMedia?.id === id && this.activeMedia.isPlaying && !this.isInCallMode) {
            try {
              this.monitorCtx?.resume?.().catch(() => {});
              this.activeMedia.onPlay();
            } catch {}
          }
        }, 400);
      }
      return;
    }

    // Genuine OS interruption ('interrupted') -> pause cleanly and watch for call end
    if (ctxState === 'interrupted') {
      if (this.activeMedia.isPlaying) {
        this.handleExternalInterruption('element-pause-interrupted');
      }
      return;
    }

    // Transient OS pause in background (e.g. Android/iOS screen-lock transition, brief focus duck, or network drop)
    // when user did NOT tap pause: attempt bounded auto-recovery before giving up.
    if (this.activeMedia.isPlaying && this.unexpectedPauseRecoveryAttempts < 3) {
      const attempt = this.unexpectedPauseRecoveryAttempts;
      this.unexpectedPauseRecoveryAttempts += 1;
      const delayMs = attempt === 0 ? 350 : attempt === 1 ? 1100 : 2200;
      if (this.unexpectedPauseRecoveryTimer !== null) {
        clearTimeout(this.unexpectedPauseRecoveryTimer);
      }
      this.unexpectedPauseRecoveryTimer = window.setTimeout(() => {
        this.unexpectedPauseRecoveryTimer = null;
        if (
          this.activeMedia?.id === id &&
          this.activeMedia.isPlaying &&
          !this.isInCallMode &&
          !this.isInterruptedByExternal
        ) {
          if (this.getAudioContextState() === 'interrupted') {
            this.handleExternalInterruption('delayed-interrupted');
            return;
          }
          try {
            this.monitorCtx?.resume?.().catch(() => {});
            this.activeMedia.onPlay();
          } catch {}
        }
      }, delayMs);
      return;
    }

    this.clearUnexpectedPauseRecovery();
    this.updateMediaState(id, { isPlaying: false });
  }

  /**
   * Handles incoming Phone Call or external app audio interruption.
   * Immediately pauses active media and starts non-intrusive recovery polling
   * so playback resumes automatically once the call ends.
   */
  public handleExternalInterruption(_reason: string): void {
    this.clearUnexpectedPauseRecovery();
    if (!this.activeMedia) return;
    if (this.isInterruptedByExternal && this.interruptedMediaId === this.activeMedia.id) {
      return;
    }

    const media = this.activeMedia;
    this.wasPlayingBeforeInterrupt = media.isPlaying;
    this.isInterruptedByExternal = true;
    this.interruptedMediaId = media.id;

    if (media.isPlaying) {
      media.isPlaying = false;
      try {
        if (media.onInterruptPause) {
          media.onInterruptPause();
        } else {
          media.onPause();
        }
      } catch {}
      this.syncPlaybackAndPosition();
    }

    this.startInterruptRecoveryWatcher();
  }

  private startInterruptRecoveryWatcher(): void {
    this.clearInterruptRecovery();
    if (!this.isInterruptedByExternal) return;

    this.interruptRecoveryTimer = window.setInterval(() => {
      this.probeAudioFocusRecovery();
    }, 1500);
  }

  private clearInterruptRecovery(): void {
    if (this.interruptRecoveryTimer !== null) {
      clearInterval(this.interruptRecoveryTimer);
      this.interruptRecoveryTimer = null;
    }
  }

  private async probeAudioFocusRecovery(): Promise<void> {
    if (!this.isInterruptedByExternal || this.isInCallMode) return;

    const ctx = this.monitorCtx;
    if (ctx && ctx.state !== 'closed') {
      if (ctx.state === 'running') {
        this.completeAudioFocusRecovery();
        return;
      }
      try {
        await ctx.resume();
        if ((ctx.state as string) === 'running') {
          this.completeAudioFocusRecovery();
        }
      } catch {
        // Phone call or external app still holds exclusive audio focus — keep waiting cleanly
      }
    } else if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
      // Fallback if AudioContext wasn't supported: resume when user returns to visible tab
      this.completeAudioFocusRecovery();
    }
  }

  private completeAudioFocusRecovery(): void {
    if (!this.isInterruptedByExternal) return;

    const shouldResume = this.wasPlayingBeforeInterrupt;
    const targetId = this.interruptedMediaId;
    this.isInterruptedByExternal = false;
    this.wasPlayingBeforeInterrupt = false;
    this.interruptedMediaId = null;
    this.clearInterruptRecovery();

    if (!shouldResume || this.isInCallMode) return;

    if (this.activeMedia && (!targetId || this.activeMedia.id === targetId)) {
      this.activeMedia.isPlaying = true;
      try {
        if (this.activeMedia.onInterruptResume) {
          this.activeMedia.onInterruptResume();
        } else {
          this.activeMedia.onPlay();
        }
      } catch {}
      this.syncNavigatorMediaSession();
    }
  }

  /**
   * In-App Private Call / Voice Mic Coordination
   */
  public enterCallMode(): void {
    if (this.isInCallMode) return;
    this.isInCallMode = true;
    this.clearInterruptRecovery();
    this.clearUnexpectedPauseRecovery();

    if (this.activeMedia && this.activeMedia.isPlaying && this.activeMedia.kind !== 'call') {
      const current = this.activeMedia;
      this.suspendedMediaStack = this.suspendedMediaStack.filter((m) => m.id !== current.id);
      this.suspendedMediaStack.push({ ...current, isPlaying: true });
      current.isPlaying = false;
      try {
        if (current.onInterruptPause) {
          current.onInterruptPause();
        } else {
          current.onPause();
        }
      } catch {}
      this.syncPlaybackAndPosition();
    }
  }

  public exitCallMode(): void {
    if (!this.isInCallMode) return;
    this.isInCallMode = false;

    if (this.activeMedia?.kind === 'call') {
      this.activeMedia = null;
    }

    const ctx = this.monitorCtx;
    if (ctx && ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }

    const toResume = this.suspendedMediaStack.pop();
    if (toResume) {
      this.activeMedia = toResume;
      this.syncNavigatorMediaSession();
      try {
        if (toResume.onInterruptResume) {
          toResume.onInterruptResume();
        } else {
          toResume.onPlay();
        }
      } catch {}
    } else if (this.keepAliveDescriptor && this.keepAliveDescriptor.isPlaying) {
      this.activeMedia = this.keepAliveDescriptor;
      this.syncNavigatorMediaSession();
      try {
        this.keepAliveDescriptor.onPlay();
      } catch {}
    } else if (!this.activeMedia) {
      this.clearNavigatorMediaSession();
    }
  }

  private resolveMediaArtwork(rawArt?: string): MediaImage[] {
    const clean = (rawArt || '').trim();
    const isUnsupportedSvg =
      !clean ||
      /\.svg(\?|#|$)/i.test(clean) ||
      clean.startsWith('data:image/svg');

    const toAbsoluteUrl = (pathOrUrl: string): string => {
      if (pathOrUrl.startsWith('data:') || pathOrUrl.startsWith('blob:')) return pathOrUrl;
      if (typeof window !== 'undefined' && window.location?.origin) {
        try {
          return new URL(pathOrUrl, window.location.origin).href;
        } catch {}
      }
      return pathOrUrl;
    };

    if (isUnsupportedSvg) {
      return [
        { src: toAbsoluteUrl('/pwa-192x192.png'), sizes: '192x192', type: 'image/png' },
        { src: toAbsoluteUrl('/pwa-512x512.png'), sizes: '512x512', type: 'image/png' }
      ];
    }

    const absUrl = toAbsoluteUrl(clean);
    const dataMimeMatch = absUrl.match(/^data:(image\/(?:png|jpeg|jpg|webp|gif));/i);
    let artType: string | undefined;
    if (dataMimeMatch) {
      artType = dataMimeMatch[1].toLowerCase() === 'image/jpg' ? 'image/jpeg' : dataMimeMatch[1].toLowerCase();
    } else {
      const pathOnly = absUrl.split('?')[0].split('#')[0].toLowerCase();
      if (pathOnly.endsWith('.png')) artType = 'image/png';
      else if (pathOnly.endsWith('.webp')) artType = 'image/webp';
      else if (pathOnly.endsWith('.gif')) artType = 'image/gif';
      else if (pathOnly.endsWith('.jpg') || pathOnly.endsWith('.jpeg')) artType = 'image/jpeg';
    }

    const base192: MediaImage = artType ? { src: absUrl, sizes: '192x192', type: artType } : { src: absUrl, sizes: '192x192' };
    const base512: MediaImage = artType ? { src: absUrl, sizes: '512x512', type: artType } : { src: absUrl, sizes: '512x512' };
    return [base192, base512];
  }

  /**
   * Synchronizes navigator.mediaSession metadata & OS notification bar controls
   */
  private syncNavigatorMediaSession(): void {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator) || !this.activeMedia) {
      return;
    }

    const media = this.activeMedia;
    const siteHost =
      typeof window !== 'undefined' ? window.location.hostname || 'chathassan2031' : 'chathassan2031';
    const artwork = this.resolveMediaArtwork(media.artworkUrl);

    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: media.title || 'شات حسان برو',
        artist: media.artist || 'اتصال مباشر ونشط في الخلفية 🟢',
        album: media.album || siteHost,
        artwork
      });
    } catch {}

    this.syncPlaybackAndPosition();
    this.bindActionHandlers();
  }

  private syncPlaybackAndPosition(): void {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator) || !this.activeMedia) {
      return;
    }

    const media = this.activeMedia;
    try {
      navigator.mediaSession.playbackState = media.isPlaying ? 'playing' : 'paused';
    } catch {}

    if ('setPositionState' in navigator.mediaSession) {
      if (typeof media.duration === 'number' && isFinite(media.duration) && media.duration > 0) {
        try {
          const dur = Math.max(1, media.duration);
          const pos = Math.max(0, Math.min(dur, media.currentTime || 0));
          navigator.mediaSession.setPositionState({
            duration: dur,
            playbackRate: media.playbackRate || 1,
            position: pos
          });
        } catch {}
      } else {
        try {
          (navigator.mediaSession as any).setPositionState();
        } catch {}
      }
    }
  }

  private bindActionHandlers(): void {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;

    const safeSetHandler = (
      action: MediaSessionAction,
      handler: MediaSessionActionHandler | null
    ) => {
      try {
        navigator.mediaSession.setActionHandler(action, handler);
      } catch {}
    };

    safeSetHandler('play', () => {
      this.clearInterruptRecovery();
      this.isInterruptedByExternal = false;
      this.wasPlayingBeforeInterrupt = false;
      if (this.activeMedia) {
        this.activeMedia.isPlaying = true;
        try {
          this.activeMedia.onPlay();
        } catch {}
        this.syncPlaybackAndPosition();
      }
    });

    safeSetHandler('pause', () => {
      // Distinguish OS Phone Call Interruption from manual Pause tap
      const ctxState = this.getAudioContextState();
      if (ctxState === 'interrupted') {
        this.handleExternalInterruption('mediasession-pause-interrupted');
        return;
      }

      if (this.activeMedia) {
        this.clearUnexpectedPauseRecovery();
        this.activeMedia.isPlaying = false;
        try {
          this.activeMedia.onPause();
        } catch {}
        this.syncPlaybackAndPosition();
      }
    });

    safeSetHandler('stop', () => {
      this.clearInterruptRecovery();
      this.clearUnexpectedPauseRecovery();
      this.isInterruptedByExternal = false;
      this.wasPlayingBeforeInterrupt = false;
      if (this.activeMedia) {
        const target = this.activeMedia;
        if (target.onStop) {
          try {
            target.onStop();
          } catch {}
        } else {
          target.isPlaying = false;
          try {
            target.onPause();
          } catch {}
          this.syncPlaybackAndPosition();
        }
      }
    });

    safeSetHandler(
      'seekto',
      this.activeMedia?.onSeekTo
        ? (details) => {
            if (typeof details.seekTime === 'number') {
              try {
                this.activeMedia?.onSeekTo?.(details.seekTime);
              } catch {}
            }
          }
        : null
    );

    safeSetHandler(
      'seekbackward',
      this.activeMedia?.onSeekTo
        ? (details) => {
            if (typeof this.activeMedia?.currentTime === 'number') {
              const offset = details.seekOffset || 10;
              const nextTime = Math.max(0, this.activeMedia.currentTime - offset);
              try {
                this.activeMedia.onSeekTo?.(nextTime);
              } catch {}
            }
          }
        : null
    );

    safeSetHandler(
      'seekforward',
      this.activeMedia?.onSeekTo
        ? (details) => {
            if (typeof this.activeMedia?.currentTime === 'number') {
              const offset = details.seekOffset || 10;
              const maxDur = this.activeMedia.duration || this.activeMedia.currentTime + offset;
              const nextTime = Math.min(maxDur, this.activeMedia.currentTime + offset);
              try {
                this.activeMedia.onSeekTo?.(nextTime);
              } catch {}
            }
          }
        : null
    );

    safeSetHandler(
      'nexttrack',
      this.activeMedia?.onNextTrack
        ? () => {
            try {
              this.activeMedia?.onNextTrack?.();
            } catch {}
          }
        : null
    );

    safeSetHandler(
      'previoustrack',
      this.activeMedia?.onPreviousTrack
        ? () => {
            try {
              this.activeMedia?.onPreviousTrack?.();
            } catch {}
          }
        : null
    );
  }

  private clearNavigatorMediaSession(): void {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
    try {
      navigator.mediaSession.playbackState = 'none';
    } catch {}
    try {
      navigator.mediaSession.metadata = null;
    } catch {}
    try {
      (navigator.mediaSession as any).setPositionState?.();
    } catch {}
    const actions: MediaSessionAction[] = [
      'play',
      'pause',
      'stop',
      'seekto',
      'seekbackward',
      'seekforward',
      'nexttrack',
      'previoustrack'
    ];
    for (const action of actions) {
      try {
        navigator.mediaSession.setActionHandler(action, null);
      } catch {}
    }
  }
}

export const mediaSessionManager = new UnifiedMediaSessionManager();
