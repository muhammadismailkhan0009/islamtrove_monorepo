import type { SurahAudio } from '../../application/ports/audio-media';
import type { ContinuousRecitation } from '../../application/ports/continuous-recitation';
import type { PlaybackTrack } from './media-playback';

/**
 * Pure audio sequencing rules. Kept separate from Angular so breakpoint
 * behavior can be validated without a browser or backend.
 */
export type ListeningMode = 'recitation' | 'both';
export type AudioMode = 'arabic' | 'translation';
export interface Passage { index: number; start: number; end: number }
export interface AudioStage { passageIndex: number; start: number; end: number; mode: AudioMode; label: string; language?: string }

/** Ignore invalid/duplicate boundaries and always end at the last Ayah. */
export function normalizeBreakpoints(input: readonly unknown[], ayahCount: number): number[] {
  if (!Number.isInteger(ayahCount) || ayahCount < 1) {
    throw new RangeError('Surah must contain at least one Ayah');
  }
  const valid = input.filter((n): n is number =>
    typeof n === 'number' && Number.isInteger(n) && n >= 1 && n < ayahCount
  );
  return [...new Set(valid), ayahCount].sort((a, b) => a - b);
}

export function createPassages(breakpoints: readonly number[], ayahCount: number): Passage[] {
  const boundaries = normalizeBreakpoints(breakpoints, ayahCount);
  let start = 1;
  return boundaries.map((end, index) => {
    const passage = { index, start, end };
    start = end + 1;
    return passage;
  });
}

/**
 * Preserve semantic Arabic passages. With two spoken languages, pair translations
 * for EACH Ayah before advancing; with one, play its translation as a full group.
 * For example, Arabic 1–3 → English 1 → German 1 → English 2 → German 2 ...
 */
export function createAudioQueue(
  mode: ListeningMode,
  breakpoints: readonly number[],
  ayahCount: number,
  translations: string | readonly string[]
): AudioStage[] {
  if (mode === 'recitation') {
    return createPassages(breakpoints, ayahCount).map(passage => ({
      passageIndex: passage.index, start: passage.start, end: passage.end,
      mode: 'arabic', label: 'Arabic recitation'
    }));
  }
  const languages = typeof translations === 'string' ? [translations] : [...translations];
  if (languages.length === 0 || languages.length > 2 || new Set(languages).size !== languages.length) {
    throw new RangeError('Select one or two distinct spoken translation languages');
  }
  return createPassages(breakpoints, ayahCount).flatMap(passage => {
    const arabic: AudioStage = {
      passageIndex: passage.index, start: passage.start, end: passage.end,
      mode: 'arabic', label: 'Arabic recitation'
    };
    if (languages.length === 1) {
      return [arabic, {
        passageIndex: passage.index, start: passage.start, end: passage.end,
        mode: 'translation' as const, language: languages[0], label: languages[0] + ' audio translation'
      }];
    }
    const paired = Array.from({ length: passage.end - passage.start + 1 }, (_, offset) => passage.start + offset)
      .flatMap(ayah => languages.map(language => ({
        passageIndex: passage.index, start: ayah, end: ayah,
        mode: 'translation' as const, language, label: language + ' · Ayah ' + ayah
      })));
    return [arabic, ...paired];
  });
}

/** EveryAyah records the opening Bismillah separately as Ayah 0.
 * At-Tawbah (9) deliberately has no opening Bismillah; Al-Fatihah (1)
 * already includes it in Ayah 1. Only prepend it at the Surah beginning. */
export function createOpeningBismillah(surahId: number, first: PlaybackTrack): PlaybackTrack | null {
  if (surahId === 1 || surahId === 9 || first.phase !== 'arabic' || first.ayah !== 1) return null;
  return {
    stage: first.stage, ayah: 0, phase: 'intro', passageIndex: first.passageIndex,
    url: `https://everyayah.com/data/Minshawy_Mujawwad_192kbps/${String(surahId).padStart(3, '0')}000.mp3`
  };
}

/** Build playback files for Arabic and each independently selected translation. */
export function createAudioTracks(
  queue: readonly AudioStage[],
  audioByLanguage: ReadonlyMap<string, SurahAudio>,
  surahId: number,
  continuous: ContinuousRecitation
): PlaybackTrack[] {
  const tracks: PlaybackTrack[] = [];
  if (continuous.surahId !== surahId) throw new Error('Continuous recording belongs to another Surah');
  queue.forEach((stage, index) => {
    if (stage.mode === 'arabic') {
      const first = continuous.timings[stage.start - 1];
      const last = continuous.timings[stage.end - 1];
      if (!first || !last || first.ayah !== stage.start || last.ayah !== stage.end ||
          last.toMs > continuous.endMs) throw new Error('Missing QUL passage timestamps');
      tracks.push({
        stage: index, ayah: stage.start, url: continuous.audioUrl,
        phase: 'arabic', passageIndex: stage.passageIndex,
        startSeconds: first.fromMs / 1000, endSeconds: last.toMs / 1000,
        recordingEndSeconds: continuous.endMs / 1000,
        ayahTimings: continuous.timings.slice(stage.start - 1, stage.end)
      });
      return;
    }
    const payload = audioByLanguage.get(stage.language ?? '');
    if (!payload || payload.surahId !== surahId) {
      throw new Error('Selected translation audio is unavailable');
    }
    const collection = payload.translationAudio;
    for (let ayah = stage.start; ayah <= stage.end; ayah++) {
      const item = collection[ayah - 1];
      if (!item || item.ayah !== ayah || !item.url.startsWith('https://')) {
        throw new Error('An Ayah audio file is missing or invalid');
      }
      tracks.push({ stage: index, ayah, url: item.url, phase: stage.mode, passageIndex: stage.passageIndex });
    }
  });
  return tracks;
}
