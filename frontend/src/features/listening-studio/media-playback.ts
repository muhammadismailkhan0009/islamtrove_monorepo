import type { MediaCachePort } from '../../application/ports/media-cache';
import type { StreamingSourcePort } from '../../application/ports/streaming-source';
import type { AyahTime } from '../../application/ports/continuous-recitation';
import { analyzeAudioEdges, isContinuousRecording, RECITATION_CROSSFADE_SECONDS, TRANSLATION_CROSSFADE_SECONDS } from './audio-boundaries';
import { prepareAudio, releaseAudio, type PreparedAudio } from './audio-loader';
import { startAyahMonitor } from './ayah-monitor';
import { startNativeStream, primeStreamingAfterBismillah } from './native-stream-transition';

export interface PlaybackTrack {
  stage: number;
  ayah: number;
  url: string;
  phase: 'intro' | 'arabic' | 'translation';
  passageIndex: number;
  startSeconds?: number;
  endSeconds?: number;
  recordingEndSeconds?: number;
  ayahTimings?: AyahTime[];
  /** Only translated tracks need a lazy recording URL. */
  language?: string;
  resolveUrl?: () => Promise<string | null>;
}
export interface PlayerCallbacks {
  onTrack: (track: PlaybackTrack) => void;
  onAyah: (ayah: number) => void;
  onPlaying: (playing: boolean) => void;
  onFinished: () => void;
  onError: (message?: string) => void;
  onTranslationWarning?: (message: string) => void;
}
interface Scheduled { source: AudioBufferSourceNode; gain: GainNode; start: number; end: number; offset: number }
/** Gapless Web Audio for short clips; progressive native MP3 streaming for long Surahs. */
export class BufferedAudioPlayer {
  private readonly prepared = new Map<number, Promise<PreparedAudio>>();
  private readonly decoded = new Map<number, PreparedAudio>();
  private readonly scheduled = new Map<number, Scheduled>();
  private readonly continuousStreams = new Map<string, PreparedAudio>();
  private position = 0;
  private offset = 0;
  private playing = false;
  private disposed = false;
  private token = 0;
  private stopAyahMonitor: (() => void) | null = null;
  private readonly transitionTimers = new Set<ReturnType<typeof setTimeout>>();
  private nativePrimedIndex: number | null = null;
  constructor(
    private readonly tracks: readonly PlaybackTrack[],
    private readonly cache: MediaCachePort,
    private readonly callbacks: PlayerCallbacks,
    private readonly context: AudioContext,
    private readonly streamingSource: StreamingSourcePort = { resolve: url => url }
  ) {
    if (!tracks.length) throw new Error('Audio playlist is empty');
    this.callbacks.onTrack(this.tracks[0]);
  }
  get currentIndex(): number { return this.position; }
  get bufferedCount(): number { return this.prepared.size; }
  private samePhase(a: number, b: number): boolean {
    const left = this.tracks[a], right = this.tracks[b];
    if (left?.phase === 'intro' && right?.phase === 'arabic' &&
        left.passageIndex === right.passageIndex) return true;
    return isContinuousRecording(left, right) ||
      (!!left && !!right && left.phase === right.phase && left.passageIndex === right.passageIndex);
  }
  private async load(index: number): Promise<PreparedAudio> {
    const track = this.tracks[index];
    if (track.phase === 'translation' && track.resolveUrl) {
      const resolved = await track.resolveUrl();
      if (this.disposed) throw new Error('Player disposed');
      if (!resolved || !resolved.startsWith('https://')) {
        throw new Error(`${track.language ?? 'Spoken'} translation missing at Ayah ${track.ayah}`);
      }
      track.url = resolved;
      track.resolveUrl = undefined;
    }
    let preceding = this.decoded.get(index - 1);
    // Consecutive passages share one Arabic MP3: if the preceding passage
    // is still being prepared, reuse its Promise instead of fetching and
    // decoding the entire recording a second time.
    if (!preceding && this.tracks[index - 1]?.url === track.url &&
        this.prepared.has(index - 1)) {
      preceding = await this.prepared.get(index - 1);
    }
    const result = track.startSeconds !== undefined && this.continuousStreams.has(track.url)
      ? this.continuousStreams.get(track.url)!
      : preceding?.kind === 'buffer' && this.tracks[index - 1]?.url === track.url
        ? preceding
        : await prepareAudio(track, this.cache, this.context,
          () => this.disposed, this.streamingSource);
    if (track.startSeconds !== undefined && result.kind === 'element' && !this.disposed) {
      this.continuousStreams.set(track.url, result);
    }
    if (this.disposed || (index !== this.position && index !== this.position + 1)) {
      if (!this.continuousStreams.has(track.url)) releaseAudio(result);
      throw new Error('Superseded audio download');
    }
    this.decoded.set(index, result);
    return result;
  }
  private prepare(index: number): Promise<PreparedAudio> {
    let task = this.prepared.get(index);
    if (!task) {
      task = this.load(index);
      void task.catch(() => {});
      this.prepared.set(index, task);
    }
    return task;
  }
  private trimWindow(): void {
    for (const [index, item] of this.decoded) {
      if (index < this.position || index > this.position + 1) {
        if (![...this.continuousStreams.values()].includes(item)) releaseAudio(item);
        this.decoded.delete(index);
        this.prepared.delete(index);
      }
    }
    for (const index of this.prepared.keys()) {
      if (index < this.position || index > this.position + 1) this.prepared.delete(index);
    }
  }
  private schedule(index: number, item: PreparedAudio, when: number, offset = 0, fadeIn = 0): Scheduled | null {
    if (item.kind !== 'buffer') return null;
    const track = this.tracks[index];
    const edges = track.startSeconds !== undefined && track.endSeconds !== undefined
      ? { start: track.startSeconds, end: track.endSeconds }
      : analyzeAudioEdges(item.audio,
        this.samePhase(index - 1, index), this.samePhase(index, index + 1));
    const node = this.context.createBufferSource();
    const gain = this.context.createGain();
    node.buffer = item.audio;
    node.connect(gain);
    gain.connect(this.context.destination);
    const start = Math.max(when, this.context.currentTime + 0.006);
    const playbackOffset = Math.min(edges.end - 0.001, Math.max(offset, edges.start));
    const remaining = Math.max(0.001, edges.end - playbackOffset);
    const fadeDuration = Math.min(fadeIn, remaining / 3);
    gain.gain.setValueAtTime(fadeDuration ? 0 : 1, start);
    if (fadeDuration) gain.gain.linearRampToValueAtTime(1, start + fadeDuration);
    const scheduled = { source: node, gain, start, end: start + remaining, offset: playbackOffset };
    this.scheduled.set(index, scheduled);
    const token = this.token;
    node.onended = () => {
      if (!this.disposed && token === this.token && this.position === index) this.advance();
    };
    node.start(start, playbackOffset, remaining);
    return scheduled;
  }
  private async scheduleNext(index: number, token: number): Promise<void> {
    if (!this.samePhase(index, index + 1)) return;
    const current = this.scheduled.get(index);
    if (!current) return;
    // Preparing the *next* translation must not stop the current recording.
    // The normal advancement path handles a missing translation independently.
    let next: PreparedAudio;
    try { next = await this.prepare(index + 1); }
    catch { return; }
    if (this.disposed || token !== this.token || this.position !== index) return;
    if (next.kind !== 'buffer') {
      if (this.tracks[index].phase === 'intro' && next.kind === 'element') {
        primeStreamingAfterBismillah({
          audio: next.audio,
          context: this.context,
          startAtSeconds: this.tracks[index + 1].startSeconds ?? 0,
          endOnAudioClock: current.end,
          introGain: () => this.scheduled.get(index)?.gain,
          isActive: () => !this.disposed && this.token === token && this.position === index,
          onPrimed: () => {
            this.nativePrimedIndex = index + 1;
            this.bindNativeEvents(index + 1, next.audio, token);
          },
          trackTimer: timer => this.transitionTimers.add(timer),
          untrackTimer: timer => this.transitionTimers.delete(timer)
        });
      }
      return;
    }
    const sameContinuousRecording = isContinuousRecording(this.tracks[index], this.tracks[index + 1]);
    const fade = sameContinuousRecording ? 0 : this.tracks[index].phase === 'intro'
      ? 0.075 : this.tracks[index].phase === 'arabic'
        ? RECITATION_CROSSFADE_SECONDS : TRANSLATION_CROSSFADE_SECONDS;
    const desired = Math.max(current.end - fade, this.context.currentTime + 0.01);
    const overlap = Math.max(0, current.end - desired);
    const scheduled = this.schedule(index + 1, next, desired, 0, overlap);
    if (scheduled && overlap > 0) {
      const actual = Math.max(0, current.end - scheduled.start);
      if (actual > 0) {
        current.gain.gain.setValueAtTime(1, current.end - actual);
        current.gain.gain.linearRampToValueAtTime(0, current.end);
      }
    }
  }
  private bindNativeEvents(index: number, audio: HTMLAudioElement, token: number): void {
    audio.ontimeupdate = () => {
      const segment = this.tracks[index];
      if (!this.disposed && token === this.token && this.position === index &&
          segment.endSeconds !== undefined && audio.currentTime >= segment.endSeconds - 0.02) {
        audio.pause();
        this.advance();
      }
    };
    audio.onended = () => {
      if (this.disposed || token !== this.token || this.position !== index) return;
      const end = this.tracks[index].endSeconds;
      if (end !== undefined && Number.isFinite(audio.duration) &&
          audio.duration + 0.5 < end) {
        this.fail('The source recording ends before its QUL Ayah timestamps.');
      } else this.advance();
    };
    audio.onerror = () => {
      if (!this.disposed && token === this.token && this.position === index) {
        const reason = 'Cannot decode or stream this MP3 (media error ' + (audio.error?.code ?? '?') + ').';
        if (this.tracks[index].phase === 'translation') {
          this.skipTranslation(index, reason);
        } else {
          this.fail(reason);
        }
      }
    };
  }

  async play(): Promise<void> {
    if (this.disposed || this.playing) return;
    const token = ++this.token;
    try {
      const currentPromise = this.prepare(this.position);
      const nextPromise = this.samePhase(this.position, this.position + 1)
        ? this.prepare(this.position + 1) : null;
      const current = await currentPromise;
      // Never wait for or fail due to preloading another translation track.
      if (nextPromise) void nextPromise.catch(() => {});
      if (this.disposed || token !== this.token) return;
      await this.context.resume();
      if (this.disposed || token !== this.token) return;
      if (current.kind === 'buffer') {
        this.schedule(this.position, current, this.context.currentTime + 0.025, this.offset);
        await this.scheduleNext(this.position, token);
      } else {
        const element = current.audio;
        const segment = this.tracks[this.position];
        element.volume = 1;
        this.bindNativeEvents(this.position, element, token);
        await startNativeStream(
          element, this.offset || segment.startSeconds || 0,
          () => !this.disposed && this.token === token
        );
      }
      if (this.disposed || token !== this.token) return;
      this.playing = true;
      this.callbacks.onPlaying(true);
      this.beginAyahMonitor();
      this.trimWindow();
    } catch (error) {
      if (!this.disposed && token === this.token) {
        const detail = error instanceof Error ? error.message : 'Unknown media error';
        const track = this.tracks[this.position];
        if (track.phase === 'translation') {
          this.skipTranslation(this.position, detail);
        } else {
          this.fail('Unable to prepare this recording: ' + detail);
        }
      }
    }
  }
  private beginAyahMonitor(): void {
    this.stopAyahMonitor?.();
    this.stopAyahMonitor = startAyahMonitor({
      getTrack: () => this.tracks[this.position],
      getScheduled: () => this.scheduled.get(this.position),
      getPrepared: () => this.decoded.get(this.position),
      currentTime: () => this.context.currentTime,
      isPlaying: () => this.playing && !this.disposed,
      onAyah: ayah => this.callbacks.onAyah(ayah),
      onStreamBoundary: () => this.advance()
    });
  }
  private advance(): void {
    if (this.position >= this.tracks.length - 1) {
      this.pause();
      this.position = 0;
      this.offset = 0;
      this.callbacks.onFinished();
      return;
    }
    const index = this.position;
    this.scheduled.delete(index);
    const nextIndex = index + 1;
    const continuing = this.samePhase(index, nextIndex);
    this.position = nextIndex;
    this.offset = 0;
    this.trimWindow();
    this.callbacks.onTrack(this.tracks[this.position]);
    if (this.nativePrimedIndex === nextIndex) {
      this.nativePrimedIndex = null;
      this.beginAyahMonitor();
      this.trimWindow();
      return;
    }
    if (continuing && this.scheduled.has(nextIndex)) {
      void this.scheduleNext(nextIndex, this.token);
    } else {
      this.playing = false;
      this.callbacks.onPlaying(false);
      void this.play();
    }
  }
  private skipTranslation(index: number, reason: string): void {
    if (this.disposed || this.position !== index) return;
    // Optional spoken audio must never terminate the Quran recitation.
    this.prepared.delete(index);
    this.callbacks.onTranslationWarning?.(reason);
    const prepared = this.decoded.get(index);
    if (prepared?.kind === 'element') prepared.audio.pause();
    this.advance();
  }
  private fail(message: string): void {
    this.pause();
    this.callbacks.onError(message);
  }
  pause(): void {
    for (const timer of this.transitionTimers) clearTimeout(timer);
    this.transitionTimers.clear();
    this.nativePrimedIndex = null;
    for (const entry of this.decoded.values()) {
      if (entry.kind === 'element') { entry.audio.pause(); entry.audio.volume = 1; }
    }
    this.stopAyahMonitor?.();
    this.stopAyahMonitor = null;
    this.token++;
    const now = this.context.currentTime;
    for (const [index, item] of this.scheduled) {
      if (item.start <= now && index >= this.position) {
        this.position = index;
        this.offset = Math.min(
          item.source.buffer?.duration ?? 0,
          item.offset + Math.max(0, now - item.start)
        );
      }
      item.source.onended = null;
      try { item.source.stop(); } catch { /* A scheduled source may already have ended. */ }
      item.source.disconnect();
      item.gain.disconnect();
    }
    this.scheduled.clear();
    const current = this.decoded.get(this.position);
    if (current?.kind === 'element') {
      this.offset = current.audio.currentTime;
      current.audio.pause();
    }
    this.playing = false;
    this.callbacks.onPlaying(false);
    this.trimWindow();
  }
  seek(index: number, keepPlaying = this.playing): void {
    if (this.disposed || index < 0 || index >= this.tracks.length) return;
    this.pause();
    this.position = index;
    this.offset = 0;
    this.trimWindow();
    this.callbacks.onTrack(this.tracks[index]);
    if (keepPlaying) void this.play();
  }
  seekStage(stage: number): void {
    const index = this.tracks.findIndex(track => track.stage === stage);
    if (index >= 0) this.seek(index);
  }
  dispose(): void {
    if (this.disposed) return;
    this.pause();
    this.disposed = true;
    this.token++;
    for (const item of this.decoded.values()) {
      if (![...this.continuousStreams.values()].includes(item)) releaseAudio(item);
    }
    for (const item of this.continuousStreams.values()) releaseAudio(item);
    this.continuousStreams.clear();
    this.decoded.clear();
    this.prepared.clear();
  }
}
