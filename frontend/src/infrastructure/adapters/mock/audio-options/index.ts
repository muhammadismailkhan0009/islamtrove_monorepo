import type { AudioOptionsPort } from '../../../../application/ports/audio-options';
import { SAMPLE_AUDIO_OPTIONS } from '../../../mock-data/audio-options/default';

/** AudioOptionsPort mock adapter: local design choices without a backend. */
export const mockAudioOptionsAdapter: AudioOptionsPort = {
  async listAudioOptions() { return SAMPLE_AUDIO_OPTIONS; }
};
