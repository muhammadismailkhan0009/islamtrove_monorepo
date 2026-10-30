import { InjectionToken } from '@angular/core';

/** Independent spoken-translation manifest; QUL Arabic never depends on it. */
export interface TranslationAudioManifest {
  surahId: number;
  language: { id: string; name: string; attribution: string };
  audio: { ayah: number; url: string }[];
  unavailableAyahs: number[];
}
export interface TranslationAudioPort {
  getSurah(surahId: number, language: string): Promise<TranslationAudioManifest>;
}
export const TRANSLATION_AUDIO = new InjectionToken<TranslationAudioPort>('TranslationAudioPort');
