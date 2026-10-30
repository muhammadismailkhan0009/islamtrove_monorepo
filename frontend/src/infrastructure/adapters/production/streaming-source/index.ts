import type { StreamingSourcePort } from '../../../../application/ports/streaming-source';
import { ANBIYA_AUDIO_URL } from '../../../../application/ports/continuous-recitation';

export const productionStreamingSourceAdapter: StreamingSourcePort = {
  resolve(url) {
    if (url === ANBIYA_AUDIO_URL) return '/api/quran/stream?url=' + encodeURIComponent(url);
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
