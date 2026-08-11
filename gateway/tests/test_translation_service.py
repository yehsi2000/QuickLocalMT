import json
from pathlib import Path

import pytest

from app.schemas import GlossaryEntry
from app.settings import Settings
from app.translation_service import (
    DEFAULT_OPTIONS,
    MIN_OUTPUT_TOKENS,
    TranslationError,
    TranslationService,
    compute_output_token_budget,
)


class FakeClient:
    def __init__(self, outputs):
        self.outputs = list(outputs)
        self.calls = 0
        self.last_options = None
        self.last_prompt = None

    async def translate(self, prompt, options):
        self.calls += 1
        self.last_options = options
        self.last_prompt = prompt
        if self.outputs:
            return self.outputs.pop(0)
        return ""


@pytest.fixture
def service():
    return TranslationService(FakeClient([]), None)


def test_short_text_budget_has_floor():
    budget = compute_output_token_budget("hello", 1024)
    assert budget == MIN_OUTPUT_TOKENS


def test_long_text_budget_capped_at_max():
    budget = compute_output_token_budget("a" * 5000, 1024)
    assert budget <= 1024


def test_budget_scales_with_input():
    short = compute_output_token_budget("a" * 100, 1024)
    long = compute_output_token_budget("a" * 2000, 1024)
    assert long > short


def test_valid_translation_succeeds_on_first_attempt():
    client = FakeClient(["Hello world."])
    svc = TranslationService(client, None)
    result = asyncio_run(svc.translate("안녕하세요", "ko", "en"))
    assert result["translation"] == "Hello world."
    assert result["attempts"] == 1
    assert result["warnings"] == []


def test_repetitive_output_is_retried_once_then_fails():
    client = FakeClient(["This is a test. This is a test."] * 3)
    svc = TranslationService(client, None)
    with pytest.raises(TranslationError) as exc_info:
        asyncio_run(svc.translate("테스트 문장입니다", "ko", "en"))
    assert exc_info.value.code in {"REPEATED_SENTENCE", "REPEATED_NGRAM"}
    assert client.calls == 2


def test_repetitive_output_then_valid_passes_on_retry():
    client = FakeClient(["This is a test. This is a test.", "This is a test."])
    svc = TranslationService(client, None)
    result = asyncio_run(svc.translate("테스트 문장입니다", "ko", "en"))
    assert result["translation"] == "This is a test."
    assert result["attempts"] == 2
    assert len(result["warnings"]) == 1


def test_echoed_source_rejected():
    client = FakeClient(["안녕하세요"] * 3)
    svc = TranslationService(client, None)
    with pytest.raises(TranslationError) as exc_info:
        asyncio_run(svc.translate("안녕하세요", "ko", "en"))
    assert exc_info.value.code == "ECHOED_SOURCE"


def test_retry_uses_adjusted_options():
    client = FakeClient(["hello hello hello hello", "Good translation."])
    svc = TranslationService(client, None)
    asyncio_run(svc.translate("some source text", "ko", "en"))
    assert client.calls == 2
    assert client.last_options["temperature"] == 0.15
    assert client.last_options["repeat_penalty"] == 1.12


def test_default_num_ctx_is_4096():
    assert DEFAULT_OPTIONS["num_ctx"] == 4096


def test_glossary_flows_into_prompt_and_post_replacement_applied():
    glossary = [
        GlossaryEntry(source="冒険者", target="모험가"),
        GlossaryEntry(source="魔法使い", target="마법사"),
    ]
    client = FakeClient(["모험가와 魔法使い는 여행을 했어."])
    svc = TranslationService(client, None)
    result = asyncio_run(
        svc.translate("冒険者と魔法使いは旅をした。", "ja", "ko", glossary=glossary)
    )
    assert "Refer to the following translations:" in client.last_prompt
    assert "冒険者 -> 모험가" in client.last_prompt
    assert "魔法使い -> 마법사" in client.last_prompt
    assert result["translation"] == "모험가와 마법사는 여행을 했어."


def test_successful_pair_written_to_jsonl(tmp_path):
    log_path = tmp_path / "translation_log.jsonl"
    settings = Settings(translation_log_path=str(log_path))
    client = FakeClient(["Hello world."])
    svc = TranslationService(client, settings)
    asyncio_run(svc.translate("안녕하세요", "ko", "en"))
    lines = log_path.read_text(encoding="utf-8").strip().splitlines()
    assert len(lines) == 1
    entry = json.loads(lines[0])
    assert entry["source_lang"] == "ko"
    assert entry["target_lang"] == "en"
    assert entry["source_text"] == "안녕하세요"
    assert entry["translation"] == "Hello world."
    assert entry["model"] == settings.ollama_model
    assert entry["attempts"] == 1
    assert entry["warnings"] == []
    assert entry["glossary_count"] == 0
    assert entry["ts"].endswith("Z")


def test_glossary_count_recorded_in_log(tmp_path):
    log_path = tmp_path / "translation_log.jsonl"
    settings = Settings(translation_log_path=str(log_path))
    glossary = [GlossaryEntry(source="冒険者", target="모험가")]
    client = FakeClient(["모험가가 도착했다."])
    svc = TranslationService(client, settings)
    asyncio_run(
        svc.translate("冒険者が到着した。", "ja", "ko", glossary=glossary)
    )
    entry = json.loads(log_path.read_text(encoding="utf-8").strip().splitlines()[0])
    assert entry["glossary_count"] == 1


def test_logging_can_be_disabled(tmp_path):
    log_path = tmp_path / "translation_log.jsonl"
    settings = Settings(translation_log_path=str(log_path), translation_log_enabled=False)
    client = FakeClient(["Hello world."])
    svc = TranslationService(client, settings)
    asyncio_run(svc.translate("안녕하세요", "ko", "en"))
    assert not Path(log_path).exists()


def test_log_failure_does_not_break_translation(tmp_path):
    blocker = tmp_path / "blocker"
    blocker.write_text("x", encoding="utf-8")
    settings = Settings(translation_log_path=str(blocker / "log.jsonl"))
    client = FakeClient(["Hello world."])
    svc = TranslationService(client, settings)
    result = asyncio_run(svc.translate("안녕하세요", "ko", "en"))
    assert result["translation"] == "Hello world."


def asyncio_run(awaitable):
    import asyncio

    return asyncio.run(awaitable)
