import type { TranslationAudioPort, TranslationAudioManifest } from '../../application/ports/translation-audio';
import type { MediaCachePort } from '../../application/ports/media-cache';
import type { ContinuousRecitationPort } from '../../application/ports/continuous-recitation';
import type { StreamingSourcePort } from '../../application/ports/streaming-source';
import type { AudioStage } from './audio-plan';
import { createIndependentAudioTracks, createOpeningBismillah } from './audio-plan';
import { BufferedAudioPlayer, type PlaybackTrack } from './media-playback';

export type ClipLanguage = 'Arabic' | 'German' | 'English' | 'Urdu';
export interface ListeningCallbacks {
  onPlaying(playing: boolean): void;
  onLoading(loading: boolean): void;
  onMainTrack(track: PlaybackTrack): void;
  onAyah(ayah: number): void;
  onClipTrack(ayah: number, language: ClipLanguage): void;
  onError(message: string | null): void;
  onTranslationWarning(message: string): void;
}

/** Owns the one active audio session: full passage playback OR a single Ayah. */
export class ListeningController {
  private player: BufferedAudioPlayer | null = null;
  private context: AudioContext | null = null;
  private readonly translations = new Map<string, Promise<TranslationAudioManifest>>();
  private readonly warnedTranslations = new Set<string>();
  private mode: 'main' | 'clip' | null = null;
  private passageScope: number | null = null;
  private clipKey: string | null = null;
  private request = 0;
  private playing = false;
  private loading = false;

  constructor(
    private readonly translationSource: TranslationAudioPort,
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

  /** Independent language metadata is requested only when its first clip
   * becomes due. One request per language per session, regardless of Ayahs. */
  private translationFor(surahId: number, language: string): Promise<TranslationAudioManifest> {
    const key = `${surahId}|${language}`;
    let pending = this.translations.get(key);
    if (!pending) {
      pending = this.translationSource.getSurah(surahId, language);
      this.translations.set(key, pending);
    }
    return pending;
  }

  private async translationUrl(surahId: number, language: string, ayah: number): Promise<string | null> {
    const manifest = await this.translationFor(surahId, language);
    if (manifest.surahId !== surahId) throw new Error(`${language} translation belongs to another Surah`);
    if (manifest.unavailableAyahs.includes(ayah)) {
      throw new Error(`${language} audio unavailable for Ayahs ${manifest.unavailableAyahs.join(', ')}; Arabic recitation continues`);
    }
    const file = manifest.audio.find(item => item.ayah === ayah);
    if (!file) throw new Error(`${language} recording for ${surahId}:${ayah} was not provided`);
    return file.url;
  }

  private reportTranslationWarning(message: string): void {
    // A failed provider should not produce hundreds of identical warnings.
    // Different missing-Ayah errors are still visible once each.
    if (this.warnedTranslations.has(message)) return;
    this.warnedTranslations.add(message);
    this.callbacks.onTranslationWarning(message);
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
    this.translations.clear();
    this.warnedTranslations.clear();
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
      },
      onTranslationWarning: message => {
        if (this.request === request) this.reportTranslationWarning(message);
      }
    }, context, this.streamingSource);
  }

  private async resumeCurrent(): Promise<void> {
    if (!this.player || this.loading) return;
    if (this.playing) this.player.pause();
    else await this.player.play();
  }

  async toggleMain(
    surahId: number, _reciter: string, queue: readonly AudioStage[],
    languages: readonly string[], initialStage: number,
    passageScope: number | null = null
  ): Promise<void> {
    const context = this.activateAudio();
    if (this.mode === 'main' && this.player &&
        (passageScope === null || this.passageScope === passageScope)) {
      await this.resumeCurrent(); return;
    }
    this.stop();
    this.mode = 'main';
    this.passageScope = passageScope;
    const request = this.request;
    this.callbacks.onError(null);
    this.setLoading(true);
    try {
      // Arabic starts from QUL alone. No German/English/Urdu request is made
      // here: the player resolves each spoken recording only when required.
      const continuous = await this.continuous.getSurah(
        surahId, Math.max(...queue.map(stage => stage.end))
      );
      if (request !== this.request) return;
      const tracks = createIndependentAudioTracks(
        queue, surahId, continuous,
        (language, ayah) => this.translationUrl(surahId, language, ayah)
      );
      if (initialStage < 0 || initialStage >= queue.length) {
        throw new Error('Invalid playback stage');
      }
      // A passage click chooses the starting position, not a playback limit.
      // Keep every later Arabic/translation stage in the sequence.
      let selected = tracks.filter(track => track.stage >= initialStage);
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

  async toggleClip(surahId: number, _reciter: string, ayah: number, language: ClipLanguage, ayahCount: number): Promise<void> {
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
        const url = await this.translationUrl(surahId, language, ayah);
        if (!url) throw new Error(`${language} audio is unavailable for Ayah ${surahId}:${ayah}`);
        if (!url.startsWith('https://')) throw new Error('The selected Ayah recording is invalid');
        track = { stage: 0, ayah, url, phase: 'translation', passageIndex: 0, language };
      }
      if (request !== this.request) return;
      const opening = language === 'Arabic' ? createOpeningBismillah(surahId, track) : null;
      this.player = this.attach(opening ? [opening, track] : [track], context, request, { ayah, language });
      await this.player.play();
    } catch (error) {
      if (request === this.request) this.callbacks.onError(
        error instanceof Error ? error.message : 'This Ayah recording is unavailable'
      );
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
    this.translations.clear();
  }
}
