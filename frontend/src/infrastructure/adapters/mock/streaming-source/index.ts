import type { StreamingSourcePort } from '../../../../application/ports/streaming-source';

// The preview has no FastAPI /api/quran/stream endpoint. A native audio URL
// still supports progressive playback, but cannot persist QUL chunks in IDB.
export const mockStreamingSourceAdapter: StreamingSourcePort = {
  resolve: url => url
};
