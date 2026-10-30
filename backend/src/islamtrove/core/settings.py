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
    admin_code: str = ""
    review_data_dir: str = ""
