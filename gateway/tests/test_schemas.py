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
