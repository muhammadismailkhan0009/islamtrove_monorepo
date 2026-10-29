/** Starter listening groups; not an authoritative tafsir segmentation. */
export const AL_KAHF_STARTER_BREAKPOINTS = [10, 26, 44, 59, 70, 82, 98, 110] as const;

/** Keep all other Surahs unchanged unless their boundaries were saved. */
export function suggestedBreakpoints(surahId: number, ayahCount: number): number[] {
  if (surahId === 18 && ayahCount === 110) return [...AL_KAHF_STARTER_BREAKPOINTS];
  return [ayahCount];
}
