import type { AudioMediaPort, SurahAudio } from '../../application/ports/audio-media';
import type { MediaCachePort } from '../../application/ports/media-cache';
import type { ContinuousRecitationPort } from '../../application/ports/continuous-recitation';
import type { StreamingSourcePort } from '../../application/ports/streaming-source';
import type { AudioStage } from './audio-plan';
import { createAudioTracks, createOpeningBismillah } from './audio-plan';
import { BufferedAudioPlayer, type PlaybackTrack } from './media-playback';

export type ClipLanguage = 'Arabic' | 'German' | 'English' | 'Urdu';
export interface ListeningCallbacks {
  onPlaying(playing: boolean): void;
  onLoading(loading: boolean): void;
  onMainTrack(track: PlaybackTrack): void;
  onAyah(ayah: number): void;
  onClipTrack(ayah: number, language: ClipLanguage): void;
  onError(message: string | null): void;
}

/** Owns the one active audio session: full passage playback OR a single Ayah. */
export class ListeningController {
  private player: BufferedAudioPlayer | null = null;
  private context: AudioContext | null = null;
  private readonly urls = new Map<string, Promise<SurahAudio>>();
  private mode: 'main' | 'clip' | null = null;
  private passageScope: number | null = null;
  private clipKey: string | null = null;
  private request = 0;
  private playing = false;
  private loading = false;

  constructor(
    private readonly media: AudioMediaPort,
    private readonly cache: MediaCachePort,
    private readonly continuous: ContinuousRecitationPort,
    private readonly streamingSource: StreamingSourcePort,
    private readonly callbacks: ListeningCallbacks
  ) {}

  get currentMode(): 'main' | 'clip' | null { return this.mode; }
  get currentClipKey(): string | null { return this.clipKey; }
  get isPlaying(): boolean { return this.playing; }

  /** Called synchronously on user click, before any asynchronous fetch. */
  private activateAudio(): AudioContext {
    if (!this.context) this.context = new AudioContext();
    void this.context.resume().catch(() => { /* Displayed if subsequent play fails. */ });
    return this.context;
  }

  private mediaFor(surahId: number, reciter: string, language?: string): Promise<SurahAudio> {
    const key = [surahId, reciter, language ?? 'Arabic'].join('|');
    let pending = this.urls.get(key);
    if (!pending) {
      pending = this.media.getSurahAudio(surahId, reciter, language);
      this.urls.set(key, pending);
      void pending.catch(() => { if (this.urls.get(key) === pending) this.urls.delete(key); });
    }
    return pending;
  }

  private setLoading(value: boolean): void {
    this.loading = value;
    this.callbacks.onLoading(value);
  }

  stop(): void {
    this.request++;
    this.player?.dispose();
    this.player = null;
    this.mode = null;
    this.passageScope = null;
    this.clipKey = null;
    this.playing = false;
    this.callbacks.onPlaying(false);
    this.setLoading(false);
  }

  private attach(
    tracks: PlaybackTrack[], context: AudioContext, request: number,
    clip?: { ayah: number; language: ClipLanguage }
  ): BufferedAudioPlayer {
    return new BufferedAudioPlayer(tracks, this.cache, {
      onAyah: ayah => {
        if (this.request === request) this.callbacks.onAyah(ayah);
      },
      onTrack: track => {
        if (this.request !== request) return;
        // The prelude is Ayah zero and is not part of the Quran verse reader.
        if (track.phase === 'intro') return;
        if (clip) this.callbacks.onClipTrack(track.ayah, clip.language);
        else this.callbacks.onMainTrack(track);
      },
      onPlaying: playing => {
        if (this.request !== request) return;
        this.playing = playing;
        this.callbacks.onPlaying(playing);
        if (playing) this.callbacks.onError(null);
      },
      onFinished: () => {
        if (this.request !== request) return;
        this.playing = false;
        this.callbacks.onPlaying(false);
      },
      onError: message => {
        if (this.request !== request) return;
        this.playing = false;
        this.callbacks.onPlaying(false);
        this.callbacks.onError(message ?? 'Recording unavailable');
      }
    }, context, this.streamingSource);
  }

  private async resumeCurrent(): Promise<void> {
    if (!this.player || this.loading) return;
    if (this.playing) this.player.pause();
    else await this.player.play();
  }

  async toggleMain(
    surahId: number, reciter: string, queue: readonly AudioStage[],
    languages: readonly string[], initialStage: number,
    passageScope: number | null = null
  ): Promise<void> {
    const context = this.activateAudio();
    if (this.mode === 'main' && this.player && this.passageScope === passageScope) {
      await this.resumeCurrent(); return;
    }
    this.stop();
    this.mode = 'main';
    this.passageScope = passageScope;
    const request = this.request;
    this.callbacks.onError(null);
    this.setLoading(true);
    try {
      // The Arabic source is one continuous MP3; it doesn't need a per-Ayah
      // audio manifest. Only request translation manifests when selected.
      const [replies, continuous] = await Promise.all([
        Promise.all(languages.map(async language =>
          [language, await this.mediaFor(surahId, reciter, language)] as const)),
        this.continuous.getSurah(surahId, Math.max(...queue.map(stage => stage.end)))
      ]);
      if (request !== this.request) return;
      const tracks = createAudioTracks(queue, new Map(replies), surahId, continuous);
      if (initialStage < 0 || initialStage >= queue.length) {
        throw new Error('Invalid playback stage');
      }
      let selected = tracks.filter(track =>
        track.stage >= initialStage &&
        (passageScope === null || track.passageIndex === passageScope)
      );
      if (!selected.length) throw new Error('Selected passage contains no audio');
      // In Arabic-only mode, keep ONE uninterrupted audio element while
      // progressing through all passages. Ayah events update the UI sections.
      if (languages.length === 0 && passageScope === null) {
        const first = selected[0], last = selected[selected.length - 1];
        selected = [{...first, endSeconds: last.endSeconds,
          ayahTimings: continuous.timings.slice(first.ayah - 1)
        }];
      }
      const opening = createOpeningBismillah(surahId, selected[0]);
      if (opening) selected = [opening, ...selected];
      this.player = this.attach(selected, context, request);
      await this.player.play();
    } catch (error) {
      if (request === this.request) this.callbacks.onError(
        error instanceof Error ? 'Audio could not be prepared: ' + error.message : 'Audio could not be prepared'
      );
    } finally {
      if (request === this.request) this.setLoading(false);
    }
  }

  async toggleClip(surahId: number, reciter: string, ayah: number, language: ClipLanguage, ayahCount: number): Promise<void> {
    const context = this.activateAudio();
    const key = [surahId, ayah, language].join(':');
    if (this.mode === 'clip' && this.clipKey === key) {
      await this.resumeCurrent();
      return;
    }
    this.stop();
    this.mode = 'clip';
    this.clipKey = key;
    const request = this.request;
    this.callbacks.onError(null);
    this.callbacks.onClipTrack(ayah, language);
    this.setLoading(true);
    try {
      let track: PlaybackTrack;
      if (language === 'Arabic') {
        const continuous = await this.continuous.getSurah(surahId, ayahCount);
        const selected = continuous.timings[ayah - 1];
        if (!selected || selected.ayah !== ayah) throw new Error('Missing Ayah timestamps');
        track = {
          stage: 0, ayah, url: continuous.audioUrl, phase: 'arabic', passageIndex: 0,
          startSeconds: selected.fromMs / 1000, endSeconds: selected.toMs / 1000,
          recordingEndSeconds: continuous.endMs / 1000,
          ayahTimings: [selected]
        };
      } else {
        const payload = await this.mediaFor(surahId, reciter, language);
        const media = payload.translationAudio[ayah - 1];
        if (!media || media.ayah !== ayah || !media.url.startsWith('https://')) {
          throw new Error('The selected Ayah recording is missing');
        }
        track = { stage: 0, ayah, url: media.url, phase: 'translation', passageIndex: 0 };
      }
      if (request !== this.request) return;
      const opening = language === 'Arabic' ? createOpeningBismillah(surahId, track) : null;
      this.player = this.attach(opening ? [opening, track] : [track], context, request, { ayah, language });
      await this.player.play();
    } catch {
      if (request === this.request) this.callbacks.onError('This Ayah recording is unavailable');
    } finally {
      if (request === this.request) this.setLoading(false);
    }
  }

  seekStage(index: number): void {
    if (this.mode === 'main') this.player?.seekStage(index);
    else if (this.mode === 'clip') this.stop();
  }

  dispose(): void {
    this.stop();
    void this.context?.close();
    this.context = null;
    this.urls.clear();
  }
}
