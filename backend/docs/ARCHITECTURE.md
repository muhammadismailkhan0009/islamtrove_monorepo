# Backend architecture

```
GET /api/quran/...         FastAPI API router
           ↓
  QuranService             application use cases
           ↓
  QuranSource              provider Protocol (port)
           ↓
  EveryAyahAudioSource    media-routing decorator (Minshawi Mujawwad only)
           ↓
  AlQuranCloudSource       HTTPX adapter
           ↓
  Al Quran Cloud API       catalog + Ayah indexes
  EveryAyah static CDN    distinct Minshawi Mujawwad MP3s
```

`domain/models.py` defines application-visible data shapes and the supported audio edition allowlist. `api/routes.py` speaks HTTP only and keeps logic out of the controllers. `application/quran_service.py` validates provider selection, resolves streams in parallel, and checks recitation/translation alignment. `infrastructure/alquran_cloud.py` translates upstream JSON into our domain model and refuses incomplete, reordered, or untrusted media URLs. `infrastructure/everyayah.py` uses the validated Ayah indexes to supply EveryAyah Mujawwad audio URLs for one edition; every other edition passes through unchanged. `main.py` constructs dependencies using a shared lifecycle-owned HTTPX client.

**Frontend contract:** Surah payload fields are `id`, `name`, `meaning`, `arabicName`, `revelation`, and `ayahCount`. Audio options retain the design's `reciters` and `translationLanguages` string arrays, supplemented with stable edition IDs. The audio endpoint returns `recitation` and `translationAudio` arrays, each containing `{ayah, url}`.

**Provider boundaries:** all outbound network calls are isolated in an adapter and can be simulated through HTTPX MockTransport. Provider failures return 503, malformed upstream responses 502, invalid user edition choices 422. No end-user arbitrary network URLs are accepted.

**Where sequencing lives:** users can change breakpoints without refetching media; the Angular player builds the queue from the already-resolved Ayah media. A future backend playback-plan endpoint is not needed for MVP.

**Later:** introduce SQLAlchemy/Alembic/PostgreSQL with Testcontainers when saved playlists/accounts require persistence.
