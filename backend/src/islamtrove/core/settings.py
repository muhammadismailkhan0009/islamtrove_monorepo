"""Runtime settings; never load secrets in application modules."""

from pydantic import Field, HttpUrl
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="ISLAMTROVE_",
        env_file=".env",
        extra="ignore",
    )

    quran_api_base_url: HttpUrl = HttpUrl("https://api.alquran.cloud/v1")
    http_timeout_seconds: float = Field(default=12, gt=0, le=60)
    cors_origins: str = ""

    @property
    def allowed_origins(self) -> list[str]:
        return [value.strip() for value in self.cors_origins.split(",") if value.strip()]
