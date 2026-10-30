import type { TranslationAudioManifest, TranslationAudioPort } from '../../../../application/ports/translation-audio';
import { SAMPLE_AYAH_MEDIA } from '../../../mock-data/audio-media/default';

const LANGUAGES = {
  German: {id:'de.bubenheim.nail',name:'German',attribution:'Nail ibn Radhan'},
  English:{id:'en.walk',name:'English',attribution:'Ibrahim Walk'},
  Urdu:{id:'ur.khan',name:'Urdu',attribution:'Shamshad Ali Khan'}
} as const;
const BITRATE: Record<string, number> = {English:192,Urdu:64};

/** Mock media references are synthetic URLs, not coupled to any reciter. */
export const mockTranslationAudioAdapter: TranslationAudioPort = {
  async getSurah(surahId, language): Promise<TranslationAudioManifest> {
    const range = SAMPLE_AYAH_MEDIA[surahId as keyof typeof SAMPLE_AYAH_MEDIA];
    const choice = LANGUAGES[language as keyof typeof LANGUAGES];
    if (!range || !choice) throw new Error(`${language} is not in the sample translation catalog`);
    const unavailableAyahs = language === 'German' && surahId === 2 ? [283,284,285,286] : [];
    const audio = Array.from({length:range.count}, (_,i)=>i+1)
      .filter(ayah=>!unavailableAyahs.includes(ayah))
      .map(ayah=>({
        ayah,
        url: language === 'German'
          ? `https://anlayarakkuranokuyorum.com/audio/de/${String(surahId).padStart(3,'0')}${String(ayah).padStart(3,'0')}.mp3`
          : `https://cdn.islamic.network/quran/audio/${BITRATE[language]}/${choice.id}/${range.globalStart+ayah-1}.mp3`
      }));
    return {surahId,language:choice,audio,unavailableAyahs};
  }
};
