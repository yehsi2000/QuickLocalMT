import logging

from .model_client import ModelClient, ModelClientError, ModelOptions
from .output_validator import OutputValidationError, clean_output, validate_translation
from .prompt_builder import build_translation_prompt
from .settings import Settings, get_settings

logger = logging.getLogger("lst.gateway")

DEFAULT_OPTIONS: ModelOptions = {
    "temperature": 0.1,
    "top_p": 0.9,
    "top_k": 40,
    "repeat_penalty": 1.08,
    "repeat_last_n": 96,
    "num_ctx": 2048,
}

RETRY_OPTIONS: ModelOptions = {
    "temperature": 0.15,
    "top_p": 0.9,
    "top_k": 40,
    "repeat_penalty": 1.12,
    "repeat_last_n": 96,
    "num_ctx": 2048,
}

MIN_OUTPUT_TOKENS = 128
OUTPUT_RATIO = 1.6


class TranslationError(Exception):
    def __init__(self, code: str, message: str):
        self.code = code
        self.message = message
        super().__init__(message)


def compute_output_token_budget(source_text: str, max_output_tokens: int) -> int:
    source_chars = len(source_text)
    estimated_source_tokens = max(1, source_chars // 4)
    budget = int(estimated_source_tokens * OUTPUT_RATIO)
    budget = max(MIN_OUTPUT_TOKENS, budget)
    return min(budget, max_output_tokens)


class TranslationService:
    def __init__(self, client: ModelClient, settings: Settings | None = None):
        self.client = client
        self.settings = settings or get_settings()

    async def translate(
        self,
        text: str,
        source_lang: str,
        target_lang: str,
        preset: str = "translation-default",
    ) -> dict:
        prompt = build_translation_prompt(text, source_lang, target_lang)
        budget = compute_output_token_budget(text, self.settings.max_output_tokens)
        attempts = 0
        warnings: list[str] = []
        for options in (dict(DEFAULT_OPTIONS, num_predict=budget), dict(RETRY_OPTIONS, num_predict=min(budget, 256))):
            attempts += 1
            try:
                raw = await self.client.translate(prompt, options)
            except ModelClientError as exc:
                if attempts >= 2:
                    raise TranslationError("MODEL_UNAVAILABLE", exc.message) from exc
                warnings.append(exc.message)
                continue
            cleaned = clean_output(raw)
            try:
                validate_translation(text, source_lang, target_lang, cleaned)
            except OutputValidationError as exc:
                if attempts >= 2:
                    raise TranslationError(exc.code, exc.message) from exc
                warnings.append(exc.message)
                continue
            return {
                "translation": cleaned,
                "detected_source_lang": source_lang,
                "model": self.settings.ollama_model,
                "attempts": attempts,
                "warnings": warnings,
            }
        raise TranslationError("TRANSLATION_FAILED", "Translation failed after retries")
