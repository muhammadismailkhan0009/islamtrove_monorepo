import type { StreamingSourcePort } from '../../../../application/ports/streaming-source';

export const productionStreamingSourceAdapter: StreamingSourcePort = {
  resolve(url) {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || parsed.hostname !== 'audio-cdn.tarteel.ai' ||
        !/^\/quran\/surah\/minshawy\/mujawwad\/mp3\/\d{3}\.mp3$/.test(parsed.pathname)) {
      // The full-file page 1 source and small translations retain their
      // existing playback path; only the approved QUL source is proxied.
      return url;
    }
    return '/api/quran/stream?url=' + encodeURIComponent(url);
  }
};
