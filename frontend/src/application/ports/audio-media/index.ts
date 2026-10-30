import { InjectionToken } from '@angular/core';

export interface AyahAudio {
  ayah: number;
  url: string;
}
export interface AudioEdition {
  id: string;
  name: string;
  attribution: string;
}
export interface SurahAudio {
  surahId: number;
  reciter: AudioEdition;
  translation: AudioEdition | null;
  recitation: AyahAudio[];
  translationAudio: AyahAudio[];
  /** Ayahs for which the selected spoken translation has no audio recording. */
  unavailableTranslationAyahs?: number[];
}

/** Resolve individual Ayah audio references for playback. */
export interface AudioMediaPort {
  getSurahAudio(surahId: number, reciter: string, translation?: string): Promise<SurahAudio>;
}
export const AUDIO_MEDIA = new InjectionToken<AudioMediaPort>('AudioMediaPort');
