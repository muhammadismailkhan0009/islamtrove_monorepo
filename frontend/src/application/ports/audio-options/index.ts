import { InjectionToken } from '@angular/core';

export interface AudioOptions {
  reciters: readonly string[];
  translationLanguages: readonly string[];
}

/** Available recitation voices and spoken-translation languages, not audio files. */
export interface AudioOptionsPort {
  listAudioOptions(): Promise<AudioOptions>;
}

export const AUDIO_OPTIONS = new InjectionToken<AudioOptions>('AudioOptionsPort: selections');
