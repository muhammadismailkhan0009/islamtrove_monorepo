import type { AudioMediaPort, AudioEdition, SurahAudio } from '../../../../application/ports/audio-media';
import { SAMPLE_AYAH_MEDIA } from '../../../mock-data/audio-media/default';

const RECITERS = new Map<string, AudioEdition>([
  ['Muhammad Siddiq Al-Minshawi (Mujawwad)', { id: 'ar.minshawimujawwad', name: 'Muhammad Siddiq Al-Minshawi (Mujawwad)', attribution: 'Muhammad Siddiq Al-Minshawi (Mujawwad, 192 kbps)' }]
]);
const TRANSLATIONS = new Map<string, AudioEdition>([
  ['Urdu', { id: 'ur.khan', name: 'Urdu', attribution: 'Shamshad Ali Khan' }],
  ['English', { id: 'en.walk', name: 'English', attribution: 'Ibrahim Walk' }],
  ['German', { id: 'de.bubenheim.nail', name: 'German', attribution: 'Bubenheim & Elyas · Narrated by Nail ibn Radhan · Den Koran verstehen' }]
]);
const BITRATES: Record<string, number> = {
  'ur.khan': 64, 'en.walk': 192
};
/** Design fixtures use verified index ranges; audio URLs point to publicly streamed media. */
export const mockAudioMediaAdapter: AudioMediaPort = {
  async getSurahAudio(surahId, reciter, translation): Promise<SurahAudio> {
    const range = SAMPLE_AYAH_MEDIA[surahId as keyof typeof SAMPLE_AYAH_MEDIA];
    const reciterInfo = RECITERS.get(reciter);
    const translationInfo = translation ? TRANSLATIONS.get(translation) : undefined;
    if (!range || !reciterInfo || (translation && !translationInfo)) {
      throw new Error('Audio is unavailable for this sample selection');
    }
    const build = (edition: AudioEdition) => Array.from({ length: range.count }, (_, i) => ({
      ayah: i + 1,
      url: edition.id === 'de.bubenheim.nail'
        ? `https://anlayarakkuranokuyorum.com/audio/de/${String(surahId).padStart(3, '0')}${String(i + 1).padStart(3, '0')}.mp3`
        : edition.id === 'ar.minshawimujawwad'
          ? `https://everyayah.com/data/Minshawy_Mujawwad_192kbps/${String(surahId).padStart(3, '0')}${String(i + 1).padStart(3, '0')}.mp3`
          : `https://cdn.islamic.network/quran/audio/${BITRATES[edition.id]}/${edition.id}/${range.globalStart + i}.mp3`
    }));
    return {
      surahId, reciter: reciterInfo, translation: translationInfo ?? null,
      recitation: build(reciterInfo), translationAudio: translationInfo ? build(translationInfo) : []
    };
  }
};
