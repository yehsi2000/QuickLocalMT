from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="LST_", env_file=".env", extra="ignore")

    ollama_base_url: str = "http://127.0.0.1:11434"
    ollama_model: str = "hy-mt:1.5b"
    ollama_keep_alive: str = "5m"
    model_mode: str = "generate"
    request_timeout_seconds: float = 60.0
    cors_origins: str = ""
    max_input_chars: int = 8000
    max_output_tokens: int = 1024
    log_level: str = "INFO"
    debug_log_text: bool = False


@lru_cache
def get_settings() -> Settings:
    return Settings()
