# HTTP contract

## Catalog

`GET /api/quran/surahs` returns an array with 114 objects:

```json
{"id":1,"name":"Al-Faatiha","meaning":"The Opening","arabicName":"سُورَةُ ٱلْفَاتِحَةِ","revelation":"Meccan","ayahCount":7}
```

## Audio choices

`GET /api/quran/audio-options` returns:

```json
{
  "reciters": ["Mishary Rashid Alafasy", "Abdul Basit Abdus Samad", "Maher Al Muaiqly"],
  "translationLanguages": ["Urdu", "English"],
  "reciterOptions": [{"id":"ar.alafasy","name":"Mishary Rashid Alafasy","attribution":"Mishary Rashid Alafasy"}],
  "translationOptions": [{"id":"ur.khan","name":"Urdu","attribution":"Shamshad Ali Khan"}]
}
```

The example shows the shape; other entries are omitted.

## Per-Ayah audio

`GET /api/quran/surahs/1/audio?reciter=ar.alafasy&translation=Urdu` returns:

```json
{
  "surahId": 1,
  "reciter": {"id":"ar.alafasy","name":"Mishary Rashid Alafasy","attribution":"Mishary Rashid Alafasy"},
  "translation": {"id":"ur.khan","name":"Urdu","attribution":"Shamshad Ali Khan"},
  "recitation": [{"ayah":1,"url":"https://cdn.islamic.network/quran/audio/128/ar.alafasy/1.mp3"}],
  "translationAudio": [{"ayah":1,"url":"https://cdn.islamic.network/quran/audio/64/ur.khan/1.mp3"}]
}
```

The response includes *every* Ayah of the requested Surah in both arrays, not just the first example item. `translation` is optional and defaults to omitted (`null` in responses), giving an empty `translationAudio` array. `reciter` accepts the documented edition ID or display name.

Ayah indexes are 1-based and ordered; the client may switch between streams at user-chosen breakpoints.

## Errors

- 422 invalid Surah bounds or unknown voice/translation
- 502 invalid/incomplete upstream data
- 503 upstream timeout or HTTP error
- 200 health response: `{"status":"ok"}`

## Decoupled translation audio (listening studio)

`GET /api/quran/surahs/{surah_id}/translation-audio?language=German` returns only the language-specific spoken translation manifest. No Arabic recitation request is necessary. Response fields: `surahId`, `language` (name/id/attribution), `audio` (actual Ayah URL entries), and `unavailableAyahs` (explicit known gaps). For German Surah 2, 2:283–286 are omitted from `audio` and listed in `unavailableAyahs`. Other unexpected gaps fail validation. Translation source failure returns a distinct `SpokenTranslationUnavailable` HTTP 502; it never prevents the independent QUL recitation endpoint from serving Arabic. The legacy combined `/surahs/{id}/audio` route remains for older clients but is no longer called by the Angular listening studio.


## Reading-text separation and 503 fallback

Arabic Uthmani verse text no longer depends on QuranEnc. It is fetched from the **Al Quran Cloud** `quran-uthmani` edition, with the documented alternate host `alquran.api.islamic.network` used automatically if the first host fails or returns incomplete data. The backend checks that all Ayahs are present in the correct order, and stores verified Surahs in an in-memory cache.

- `GET /api/quran/surahs/{surah_id}/arabic-verses` → ordered `[{ayah,arabic}]`, **no written translation request**.
- `GET /api/quran/surahs/{surah_id}/translation-text?language=German|English|Urdu` → ordered `[{ayah,text}]`, **no Arabic request**.
- Existing `GET /api/quran/surahs/{surah_id}/verses` is retained for compatibility. It now returns verified Arabic even if one or all QuranEnc translations fail, filling the `translations` object with only those written-language editions that succeeded and match the Arabic Ayah count.

QuranEnc translations are optional on the UI: each edition is fetched separately and added when available; an unreachable QuranEnc endpoint shows an inline translation warning and retry without hiding the Arabic. QuranEnc and the audio translation systems are independent.

The frontend compares the returned Arabic text count against the selected Surah catalog. Invalid/missing Arabic text is never silently replaced with guessed verses. No tests or browser runs performed for this change per the established user workflow.


## Written translation provider fallback (Al Quran Cloud first)

As of October 2026, QuranEnc's written translation API can time out repeatedly. For **written text only**, IslamTrove now queries an edition of Al Quran Cloud first, tries its documented alternate host if that fails, and uses the originally selected QuranEnc translation as a last fallback.

| Language | Primary text edition / attribution | QuranEnc fallback / attribution |
| --- | --- | --- |
| German | `de.bubenheim` — Bubenheim & Elyas | `german_bubenheim` — Bubenheim & Elyas |
| English | `en.sahih` — Saheeh International | `english_rwwad` — Rowwad Translation Center |
| Urdu | `ur.junagarhi` — Muhammad Junagarhi | `urdu_junagarhi` — Muhammad Junagarhi |

**Different English editions must not share attribution.** The backend validates the complete numbered Surah response, caches successful text by Surah and language, and returns the actual provenance.

`GET /api/quran/surahs/{id}/translation-text?language=German|English|Urdu` now returns:

```json
{
  "language": "English",
  "source": "Al Quran Cloud",
  "edition": "en.sahih",
  "attribution": "Saheeh International",
  "verses": [
    {"ayah": 1, "text": "..."}
  ]
}
```

This written-text API remains independent of the Arabic source, QUL Ayah timestamps, and the separately sourced **spoken** translations. Failed text providers do not interrupt Arabic playback or hide already loaded Arabic words. Previously cached in-memory successful responses can be reused while the API is unavailable.

Provider references: https://legacy.alquran.cloud/api (editions and documented alternate hosts); https://quranenc.com/en/home/api/ (QuranEnc translation API).
