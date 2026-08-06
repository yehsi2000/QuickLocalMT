import pytest

from app.translation_service import (
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

    async def translate(self, prompt, options):
        self.calls += 1
        self.last_options = options
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


def asyncio_run(awaitable):
    import asyncio

    return asyncio.run(awaitable)
