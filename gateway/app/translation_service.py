import json
import logging
from datetime import datetime, timezone
from pathlib import Path

from .glossary import apply_glossary_replacement
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
    "num_ctx": 4096,
}

RETRY_OPTIONS: ModelOptions = {
    "temperature": 0.15,
    "top_p": 0.9,
    "top_k": 40,
    "repeat_penalty": 1.12,
    "repeat_last_n": 96,
    "num_ctx": 4096,
}

MIN_OUTPUT_TOKENS = 128
OUTPUT_RATIO = 1.6
MAX_LOG_BYTES = 200 * 1024 * 1024


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
        glossary: list | None = None,
    ) -> dict:
        prompt = build_translation_prompt(text, source_lang, target_lang, glossary)
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
            cleaned = apply_glossary_replacement(cleaned, glossary)
            result = {
                "translation": cleaned,
                "detected_source_lang": source_lang,
                "model": self.settings.ollama_model,
                "attempts": attempts,
                "warnings": warnings,
            }
            self._record_pair(text, source_lang, target_lang, cleaned, attempts, warnings, glossary)
            return result
        raise TranslationError("TRANSLATION_FAILED", "Translation failed after retries")

    def _record_pair(
        self,
        text: str,
        source_lang: str,
        target_lang: str,
        translation: str,
        attempts: int,
        warnings: list[str],
        glossary: list | None,
    ) -> None:
        if not self.settings.translation_log_enabled:
            return
        entry = {
            "ts": datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z"),
            "source_lang": source_lang,
            "target_lang": target_lang,
            "source_text": text,
            "translation": translation,
            "model": self.settings.ollama_model,
            "attempts": attempts,
            "warnings": warnings,
            "glossary_count": len(glossary or []),
        }
        try:
            self._append_log(entry)
        except Exception as exc:  # noqa: BLE001 - logging must never break translation
            logger.warning("failed to write translation log entry: %s", exc)

    def _append_log(self, entry: dict) -> None:
        path = Path(self.settings.translation_log_path)
        if path.exists() and path.stat().st_size > MAX_LOG_BYTES:
            path.rename(path.with_suffix(".1.jsonl"))
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(entry, ensure_ascii=False) + "\n")
