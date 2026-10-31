import { QPC_ENDINGS } from './qpc-boundaries';
import { RUKU_ENDINGS } from './ruku-boundaries';

export type PassagePresetSource = 'qpc' | 'ruku' | 'whole';

/** Confirm boundaries are valid for the active Surah before using them. */
function validBoundaries(boundaries: readonly number[] | undefined, count: number): boolean {
  return Number.isSafeInteger(count) && count > 0 && !!boundaries?.length
    && boundaries.at(-1) === count
    && boundaries.every((end, index) =>
      Number.isSafeInteger(end) && end >= 1 && end <= count
      && (index === 0 || end > boundaries[index - 1]));
}

/**
 * Fallback source when no administrator-published grouping exists.
 * QPC is the preferred listening scaffold; Rukūʿ protects against invalid
 * QPC metadata; whole-Surah is the final fallback for unknown Surahs.
 */
export function passagePresetSource(surahId: number, ayahCount: number): PassagePresetSource {
  if (validBoundaries(QPC_ENDINGS[surahId], ayahCount)) return 'qpc';
  if (validBoundaries(RUKU_ENDINGS[surahId], ayahCount)) return 'ruku';
  return 'whole';
}

export function suggestedBreakpoints(surahId: number, ayahCount: number): number[] {
  switch (passagePresetSource(surahId, ayahCount)) {
    case 'qpc': return [...QPC_ENDINGS[surahId]];
    case 'ruku': return [...RUKU_ENDINGS[surahId]];
    case 'whole': return [ayahCount];
  }
}
