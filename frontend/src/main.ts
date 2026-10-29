import { bootstrapApplication } from '@angular/platform-browser';
import { AppComponent } from './features/listening-studio/components/player/app.component';
import { QURAN_SURAHS, type QuranCatalogPort } from './application/ports/quran-catalog';
import { AUDIO_OPTIONS, type AudioOptionsPort } from './application/ports/audio-options';
import { AUDIO_MEDIA, type AudioMediaPort } from './application/ports/audio-media';
import { VERSE_PREVIEW, type VersePreviewPort } from './application/ports/verse-preview';
import { MEDIA_CACHE, type MediaCachePort } from './application/ports/media-cache';
import { CONTINUOUS_RECITATION, type ContinuousRecitationPort } from './application/ports/continuous-recitation';
import { STREAMING_SOURCE, type StreamingSourcePort } from './application/ports/streaming-source';
import { mockQuranCatalogAdapter } from './infrastructure/adapters/mock/quran-catalog';
import { mockAudioOptionsAdapter } from './infrastructure/adapters/mock/audio-options';
import { mockAudioMediaAdapter } from './infrastructure/adapters/mock/audio-media';
import { mockVersePreviewAdapter } from './infrastructure/adapters/mock/verse-preview';
import { mockMediaCacheAdapter } from './infrastructure/adapters/mock/media-cache';
import { mockContinuousRecitationAdapter } from './infrastructure/adapters/mock/continuous-recitation';
import { mockStreamingSourceAdapter } from './infrastructure/adapters/mock/streaming-source';
import { productionQuranCatalogAdapter } from './infrastructure/adapters/production/quran-catalog';
import { productionAudioOptionsAdapter } from './infrastructure/adapters/production/audio-options';
import { productionAudioMediaAdapter } from './infrastructure/adapters/production/audio-media';
import { productionVersePreviewAdapter } from './infrastructure/adapters/production/verse-preview';
import { productionMediaCacheAdapter } from './infrastructure/adapters/production/media-cache';
import { productionContinuousRecitationAdapter } from './infrastructure/adapters/production/continuous-recitation';
import { productionStreamingSourceAdapter } from './infrastructure/adapters/production/streaming-source';
import { registerPersistentAudioCache } from './infrastructure/media/register-stream-cache';
import { DC_ADAPTER_MODE } from './environments/environment';

/** Infrastructure mode is selected once, at the application composition root. */
async function start(): Promise<void> {
  const catalog: QuranCatalogPort = DC_ADAPTER_MODE === 'mock'
    ? mockQuranCatalogAdapter : productionQuranCatalogAdapter;
  const audio: AudioOptionsPort = DC_ADAPTER_MODE === 'mock'
    ? mockAudioOptionsAdapter : productionAudioOptionsAdapter;

  const audioMedia: AudioMediaPort = DC_ADAPTER_MODE === 'mock'
    ? mockAudioMediaAdapter : productionAudioMediaAdapter;

  const verseText: VersePreviewPort = DC_ADAPTER_MODE === 'mock'
    ? mockVersePreviewAdapter : productionVersePreviewAdapter;

  const mediaCache: MediaCachePort = DC_ADAPTER_MODE === 'mock'
    ? mockMediaCacheAdapter : productionMediaCacheAdapter;

  const continuousAudio: ContinuousRecitationPort = DC_ADAPTER_MODE === 'mock'
    ? mockContinuousRecitationAdapter : productionContinuousRecitationAdapter;

  const streamingSource: StreamingSourcePort = DC_ADAPTER_MODE === 'mock'
    ? mockStreamingSourceAdapter : productionStreamingSourceAdapter;
  if (DC_ADAPTER_MODE === 'production') registerPersistentAudioCache();

  const [surahs, audioOptions] = await Promise.all([catalog.listSurahs(), audio.listAudioOptions()]);
  if (surahs.length === 0) throw new Error('Cannot start listening studio without a Quran catalog');

  await bootstrapApplication(AppComponent, {
    providers: [
      { provide: QURAN_SURAHS, useValue: surahs },
      { provide: AUDIO_OPTIONS, useValue: audioOptions },
      { provide: AUDIO_MEDIA, useValue: audioMedia },
      { provide: VERSE_PREVIEW, useValue: verseText },
      { provide: MEDIA_CACHE, useValue: mediaCache },
      { provide: CONTINUOUS_RECITATION, useValue: continuousAudio },
      { provide: STREAMING_SOURCE, useValue: streamingSource }
    ]
  });
}

void start().catch(error => console.error('IslamTrove startup failed:', error));
