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
