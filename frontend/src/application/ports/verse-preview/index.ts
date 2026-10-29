import { InjectionToken } from '@angular/core';

export type TranslationLanguage = 'German' | 'English' | 'Urdu';

export interface VerseText {
  ayah: number;
  arabic: string;
  translations: Partial<Record<TranslationLanguage, string>>;
}

/** Reading-text boundary, kept independent of the audio provider. */
export interface VersePreviewPort {
  getSurahVerses(surahId: number): Promise<VerseText[]>;
}

export const VERSE_PREVIEW = new InjectionToken<VersePreviewPort>('VersePreviewPort');
