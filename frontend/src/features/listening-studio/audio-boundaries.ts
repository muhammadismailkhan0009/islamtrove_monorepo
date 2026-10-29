/**
 * Conservative edge analysis for separately encoded verse recordings.
 *
 * Decoded MP3s can contain low-level leading/trailing padding. An exact
 * AudioContext butt-join still reproduces that padding. Only inspect a short
 * boundary window; never alter the middle of an Ayah or perform VAD on speech.
 */
export interface AudioEdges { start: number; end: number }

const FRAME_SECONDS = 0.005;
const MAX_LEADING_SECONDS = 0.16;
const MAX_TRAILING_SECONDS = 0.22;
const EDGE_GUARD_SECONDS = 0.012;

/**
 * Keep tiny margins around detected signal. These are playback offsets,
 * not modifications to the cached audio bytes.
 */
export function analyzeAudioEdges(
  buffer: AudioBuffer,
  trimLeading: boolean,
  trimTrailing: boolean
): AudioEdges {
  const full: AudioEdges = { start: 0, end: buffer.duration };
  if (!trimLeading && !trimTrailing) return full;
  if (typeof buffer.getChannelData !== 'function' || buffer.length < 1) return full;

  const channels = Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i));
  const frame = Math.max(1, Math.floor(buffer.sampleRate * FRAME_SECONDS));
  const count = Math.ceil(buffer.length / frame);
  const level = (index: number): number => {
    const begin = index * frame, finish = Math.min(buffer.length, begin + frame);
    let energy = 0, samples = 0;
    for (const channel of channels) {
      for (let i = begin; i < finish; i++) energy += channel[i] * channel[i];
      samples += finish - begin;
    }
    return Math.sqrt(energy / Math.max(1, samples));
  };
  // Limit the threshold to the low-level range so softly spoken consonants
  // aren't mistaken for padding. Background room noise is left untouched.
  const threshold = 0.006;
  const guardFrames = Math.ceil(EDGE_GUARD_SECONDS / FRAME_SECONDS);
  const minRun = 2; // Need 10ms of content; ignore isolated noise spikes.
  let first = 0, last = count - 1;

  if (trimLeading) {
    const limit = Math.min(count - minRun, Math.ceil(MAX_LEADING_SECONDS / FRAME_SECONDS));
    for (let i = 0; i <= limit; i++) {
      if (level(i) > threshold && level(i + 1) > threshold) {
        first = Math.max(0, i - guardFrames);
        break;
      }
    }
  }
  if (trimTrailing) {
    const limit = Math.max(minRun, count - 1 - Math.ceil(MAX_TRAILING_SECONDS / FRAME_SECONDS));
    for (let i = count - 1; i >= limit; i--) {
      if (level(i) > threshold && level(i - 1) > threshold) {
        last = Math.min(count - 1, i + guardFrames);
        break;
      }
    }
  }
  const start = first * frame / buffer.sampleRate;
  const end = Math.min(buffer.duration, (last + 1) * frame / buffer.sampleRate);
  // Do not trim recordings unusually short or with uncertain boundaries.
  return end - start >= 0.08 ? { start, end } : full;
}

export const RECITATION_CROSSFADE_SECONDS = 0.032;
export const TRANSLATION_CROSSFADE_SECONDS = 0.014;

/** Consecutive QUL offsets on one source have no encoded-audio seam. */
export function isContinuousRecording(
  a?: { phase: string; url: string; endSeconds?: number },
  b?: { phase: string; url: string; startSeconds?: number }
): boolean {
  return !!a && !!b && a.phase === 'arabic' && b.phase === 'arabic' &&
    a.url === b.url && a.endSeconds !== undefined && b.startSeconds !== undefined &&
    Math.abs(a.endSeconds - b.startSeconds) < 0.02;
}
