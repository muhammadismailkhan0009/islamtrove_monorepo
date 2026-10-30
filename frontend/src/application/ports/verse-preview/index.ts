import { InjectionToken } from '@angular/core';

export type TranslationLanguage = 'German' | 'English' | 'Urdu';

export interface VerseText {
  ayah: number;
  arabic: string;
  translations: Partial<Record<TranslationLanguage, string>>;
}

/** Reading-text boundary, kept independent of the audio provider. */
export interface WrittenTranslation {
  ayah: number;
  text: string;
}

/** Edition attribution is supplied by the source actually used. */
export interface WrittenTranslationResult {
  language: TranslationLanguage;
  source: string;
  edition: string;
  attribution: string;
  verses: WrittenTranslation[];
}

export interface VersePreviewPort {
  /** Arabic is an independent, required resource. */
  getArabicVerses(surahId: number): Promise<VerseText[]>;
  /** Each QuranEnc written language is optional and resolves independently. */
  getTranslationVerses(
    surahId: number, language: TranslationLanguage
  ): Promise<WrittenTranslationResult>;
  /** Legacy aggregate for existing consumers; partial translations are valid. */
  getSurahVerses(surahId: number): Promise<VerseText[]>;
}

export const VERSE_PREVIEW = new InjectionToken<VersePreviewPort>('VersePreviewPort');
