from typing import Literal

from pydantic import BaseModel, Field, field_validator

LangCode = Literal["auto", "ko", "en", "ja"]
TargetLangCode = Literal["ko", "en", "ja"]

ALLOWED_LANGS = {"auto", "ko", "en", "ja"}


class TranslateRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=8000)
    source_lang: str = "auto"
    target_lang: str = "en"
    preset: str = "translation-default"

    @field_validator("text")
    @classmethod
    def text_must_not_be_blank(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("text must not be blank")
        return value

    @field_validator("source_lang", "target_lang")
    @classmethod
    def lang_must_be_supported(cls, value: str) -> str:
        if value not in ALLOWED_LANGS:
            raise ValueError("unsupported language code")
        return value

    @field_validator("target_lang")
    @classmethod
    def target_must_not_be_auto(cls, value: str) -> str:
        if value == "auto":
            raise ValueError("target_lang cannot be 'auto'")
        return value


class TranslateResponse(BaseModel):
    translation: str
    detected_source_lang: str
    model: str
    attempts: int
    warnings: list[str]


class ErrorDetail(BaseModel):
    code: str
    message: str


class ErrorResponse(BaseModel):
    error: ErrorDetail


class HealthResponse(BaseModel):
    status: str
    runtime: str
    model: str


class ModelPreset(BaseModel):
    id: str
    label: str
    description: str = ""


class ModelsResponse(BaseModel):
    presets: list[ModelPreset]
