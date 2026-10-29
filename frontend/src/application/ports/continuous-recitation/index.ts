import { InjectionToken } from '@angular/core';

/** QUL times are absolute milliseconds within ONE continuous Surah recording. */
export interface AyahTime {
  ayah: number;
  fromMs: number;
  toMs: number;
}
export interface ContinuousRecitation {
  surahId: number;
  audioUrl: string;
  timings: AyahTime[];
  /** Last Ayah end, not the physical MP3 duration. */
  endMs: number;
}
export interface ContinuousRecitationPort {
  getSurah(surahId: number, expectedAyahCount: number): Promise<ContinuousRecitation>;
}
export const CONTINUOUS_RECITATION =
  new InjectionToken<ContinuousRecitationPort>('ContinuousRecitationPort');

/** Do not invent or interpolate missing Ayah boundaries. */
export function parseQulRecitation(
  surahId: number, expectedAyahCount: number, payload: unknown
): ContinuousRecitation {
  if (!Number.isInteger(surahId) || surahId < 1 || surahId > 114 ||
      !Number.isInteger(expectedAyahCount) || expectedAyahCount < 1 ||
      typeof payload !== 'object' || payload === null) {
    throw new Error('Invalid QUL recitation metadata');
  }
  const response = payload as { audio?: { url?: unknown }; segments?: Record<string, unknown> };
  const audioUrl = response.audio?.url;
  if (typeof audioUrl !== 'string' ||
      !/^https:\/\/audio-cdn\.tarteel\.ai\/quran\/surah\/minshawy\/mujawwad\/mp3\/\d{3}\.mp3$/.test(audioUrl) ||
      !audioUrl.endsWith('/' + String(surahId).padStart(3, '0') + '.mp3')) {
    throw new Error('Invalid continuous recitation audio URL');
  }
  const segments = response.segments;
  if (!segments || typeof segments !== 'object' || Object.keys(segments).length !== expectedAyahCount) {
    throw new Error('QUL timings do not cover every Ayah');
  }
  const timings: AyahTime[] = [];
  let previous = 0;
  for (let ayah = 1; ayah <= expectedAyahCount; ayah++) {
    const segment = segments[`${surahId}:${ayah}`] as { time_from?: unknown; time_to?: unknown } | undefined;
    const fromMs = segment?.time_from, toMs = segment?.time_to;
    if (typeof fromMs !== 'number' || typeof toMs !== 'number' ||
        !Number.isInteger(fromMs) || !Number.isInteger(toMs) ||
        fromMs < 0 || toMs <= fromMs ||
        (ayah > 1 && fromMs < previous) ||
        toMs > 86_400_000) {
      throw new Error(`Invalid QUL Ayah timing at ${surahId}:${ayah}`);
    }
    timings.push({ ayah, fromMs, toMs });
    previous = toMs;
  }
  // EveryAyah Page001 is the original uninterrupted Al-Fatihah recording.
  // Its 130.95s decode matches QUL's last Ayah boundary (130.96s), while
  // the QUL CDN's 001.mp3 is a different, 126.59s rendition.
  const playbackUrl = surahId === 1
    ? 'https://everyayah.com/data/Minshawy_Mujawwad_192kbps/PageMp3s/Page001.mp3'
    : audioUrl;
  return { surahId, audioUrl: playbackUrl, timings, endMs: previous };
}
