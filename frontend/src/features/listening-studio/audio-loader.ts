import type { MediaCachePort } from '../../application/ports/media-cache';
import type { StreamingSourcePort } from '../../application/ports/streaming-source';
import type { PlaybackTrack } from './media-playback';

export type PreparedAudio =
  | { kind: 'buffer'; audio: AudioBuffer }
  | { kind: 'element'; audio: HTMLAudioElement };

const MAX_DECODED_SURAH_SECONDS = 240;

/**
 * A native media element progressively streams remote MP3 bytes.
 * It can start playing without completing the download. When the origin
 * supports HTTP Range requests, seeking to late Ayahs requests the
 * appropriate region instead of downloading preceding audio.
 */
function stream(url: string): PreparedAudio {
  const audio = new Audio();
  audio.preload = 'auto';
  audio.src = url;
  audio.load();
  return { kind: 'element', audio };
}

/** A long Surah is never downloaded/decoded as one huge PCM buffer. */
export async function prepareAudio(
  track: PlaybackTrack, cache: MediaCachePort, context: AudioContext,
  isDisposed: () => boolean,
  streamingSource: StreamingSourcePort = { resolve: url => url }
): Promise<PreparedAudio> {
  if (track.startSeconds !== undefined &&
      (track.recordingEndSeconds ?? track.endSeconds ?? 0) > MAX_DECODED_SURAH_SECONDS) {
    return stream(streamingSource.resolve(track.url));
  }
  try {
    const { blob } = await cache.get(track.url);
    if (isDisposed()) throw new Error('Player disposed');
    const audio = await context.decodeAudioData(await blob.arrayBuffer());
    if (!audio.length) throw new Error('Empty decoded recording');
    if (track.endSeconds !== undefined && audio.duration + 0.02 < track.endSeconds) {
      throw new Error('Recording shorter than QUL Ayah range');
    }
    return { kind: 'buffer', audio };
  } catch (err) {
    if (isDisposed()) throw err;
    // Mock hosts without binary CORS still play from native audio.
    return stream(track.url);
  }
}

export function releaseAudio(entry: PreparedAudio): void {
  if (entry.kind === 'buffer') return;
  entry.audio.pause();
  entry.audio.onended = null;
  entry.audio.ontimeupdate = null;
  entry.audio.onerror = null;
  entry.audio.removeAttribute('src');
  entry.audio.load();
}
