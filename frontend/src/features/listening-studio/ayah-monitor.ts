import type { PlaybackTrack } from './media-playback';
import type { PreparedAudio } from './audio-loader';

export interface AyahMonitorState {
  getTrack(): PlaybackTrack;
  getScheduled(): { offset: number; start: number } | undefined;
  getPrepared(): PreparedAudio | undefined;
  currentTime(): number;
  isPlaying(): boolean;
  onAyah(ayah: number): void;
  onStreamBoundary(): void;
}

/** UI highlighting is informational; actual short-Surah stops use AudioBuffer duration. */
export function startAyahMonitor(state: AyahMonitorState): () => void {
  let lastAyah = 0;
  const timer = setInterval(() => {
    if (!state.isPlaying()) return;
    const track = state.getTrack();
    if (track.startSeconds === undefined || !track.ayahTimings?.length) return;
    const scheduled = state.getScheduled();
    const prepared = state.getPrepared();
    const current = scheduled
      ? scheduled.offset + Math.max(0, state.currentTime() - scheduled.start)
      : prepared?.kind === 'element' ? prepared.audio.currentTime : track.startSeconds;
    if (current >= track.endSeconds! - 0.025 && prepared?.kind === 'element') {
      prepared.audio.pause();
      state.onStreamBoundary();
      return;
    }
    const found = [...track.ayahTimings].reverse().find(t => t.fromMs / 1000 <= current);
    const ayah = found?.ayah ?? track.ayahTimings[0].ayah;
    if (ayah !== lastAyah) {
      lastAyah = ayah;
      state.onAyah(ayah);
    }
  }, 40);
  return () => clearInterval(timer);
}
