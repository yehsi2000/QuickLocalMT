import pytest
from pydantic import ValidationError

from app.schemas import TranslateRequest


def test_valid_request():
    request = TranslateRequest(text="안녕하세요", source_lang="ko", target_lang="en")
    assert request.preset == "translation-default"


def test_blank_text_rejected():
    with pytest.raises(ValidationError):
        TranslateRequest(text="   ")


def test_empty_text_rejected():
    with pytest.raises(ValidationError):
        TranslateRequest(text="")


def test_too_long_text_rejected():
    with pytest.raises(ValidationError):
        TranslateRequest(text="a" * 8001)


def test_unsupported_lang_rejected():
    with pytest.raises(ValidationError):
        TranslateRequest(text="hello", source_lang="fr", target_lang="en")


def test_auto_target_rejected():
    with pytest.raises(ValidationError):
        TranslateRequest(text="hello", source_lang="ko", target_lang="auto")


def test_valid_glossary():
    request = TranslateRequest(
        text="hello",
        glossary=[{"source": "冒険者", "target": "모험가"}],
    )
    assert request.glossary[0].source == "冒険者"
    assert request.glossary[0].target == "모험가"


def test_glossary_absent_defaults_to_empty():
    request = TranslateRequest(text="hello")
    assert request.glossary == []


def test_glossary_over_limit_rejected():
    glossary = [{"source": f"term{i}", "target": f"T{i}"} for i in range(51)]
    with pytest.raises(ValidationError):
        TranslateRequest(text="hello", glossary=glossary)


def test_glossary_blank_source_rejected():
    with pytest.raises(ValidationError):
        TranslateRequest(text="hello", glossary=[{"source": "   ", "target": "모험가"}])


def test_glossary_blank_target_rejected():
    with pytest.raises(ValidationError):
        TranslateRequest(text="hello", glossary=[{"source": "冒険者", "target": ""}])


def test_glossary_term_too_long_rejected():
    with pytest.raises(ValidationError):
        TranslateRequest(text="hello", glossary=[{"source": "a" * 201, "target": "T"}])


def test_glossary_terms_are_stripped():
    request = TranslateRequest(
        text="hello",
        glossary=[{"source": "  冒険者 ", "target": " 모험가 "}],
    )
    assert request.glossary[0].source == "冒険者"
    assert request.glossary[0].target == "모험가"
