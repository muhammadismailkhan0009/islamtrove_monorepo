"""Public application models, independent of the external Quran provider."""

from pydantic import BaseModel, Field, HttpUrl


class Surah(BaseModel):
    id: int = Field(ge=1, le=114)
    name: str
    meaning: str
    arabicName: str
    revelation: str
    ayahCount: int = Field(gt=0)


class AudioChoice(BaseModel):
    id: str
    name: str
    attribution: str


class AudioOptions(BaseModel):
    # Retain existing approved Angular UI contracts.
    reciters: list[str]
    translationLanguages: list[str]
    # IDs and credits support stable backend integrations and attribution.
    reciterOptions: list[AudioChoice]
    translationOptions: list[AudioChoice]


class AyahAudio(BaseModel):
    ayah: int = Field(gt=0)
    url: HttpUrl


class SurahAudio(BaseModel):
    surahId: int = Field(ge=1, le=114)
    reciter: AudioChoice
    translation: AudioChoice | None
    recitation: list[AyahAudio]
    translationAudio: list[AyahAudio]
    # Explicit omissions; the client must not treat missing audio as corrupted data.
    unavailableTranslationAyahs: list[int] = Field(default_factory=list)


class TranslationAudioManifest(BaseModel):
    """A spoken-language resource, independent of any Arabic reciter."""

    surahId: int = Field(ge=1, le=114)
    language: AudioChoice
    audio: list[AyahAudio]
    unavailableAyahs: list[int] = Field(default_factory=list)


# Only editions confirmed to provide verse-by-verse audio are exposed.
# Names match the approved Angular design while IDs are stable provider references.
RECITERS: tuple[AudioChoice, ...] = (
    AudioChoice(
        id="ar.alafasy", name="Mishary Rashid Alafasy", attribution="Mishary Rashid Alafasy"
    ),
    AudioChoice(
        id="ar.abdulbasitmurattal",
        name="Abdul Basit Abdus Samad",
        attribution="Abdul Basit Abdus Samad (Murattal)",
    ),
    AudioChoice(id="ar.mahermuaiqly", name="Maher Al Muaiqly", attribution="Maher Al Muaiqly"),
    AudioChoice(
        id="ar.minshawi",
        name="Muhammad Siddiq Al-Minshawi (Murattal)",
        attribution="Muhammad Siddiq Al-Minshawi (Murattal)",
    ),
    AudioChoice(
        id="ar.minshawimujawwad",
        name="Muhammad Siddiq Al-Minshawi (Mujawwad)",
        attribution="Muhammad Siddiq Al-Minshawi (Mujawwad)",
    ),
)

TRANSLATIONS: tuple[AudioChoice, ...] = (
    AudioChoice(id="ur.khan", name="Urdu", attribution="Shamshad Ali Khan"),
    AudioChoice(id="en.walk", name="English", attribution="Ibrahim Walk"),
    AudioChoice(
        id="de.bubenheim.nail",
        name="German",
        attribution="Bubenheim & Elyas, read by Nail ibn Radhan · Den Koran verstehen",
    ),
)


def audio_options() -> AudioOptions:
    return AudioOptions(
        reciters=[choice.name for choice in RECITERS],
        translationLanguages=[choice.name for choice in TRANSLATIONS],
        reciterOptions=list(RECITERS),
        translationOptions=list(TRANSLATIONS),
    )
