from app.prompt_builder import build_translation_prompt


def test_prompt_contains_language_pair():
    prompt = build_translation_prompt("안녕하세요", "ko", "en")
    assert "Korean" in prompt
    assert "English" in prompt
    assert "안녕하세요" in prompt


def test_prompt_does_not_ask_for_explanation():
    prompt = build_translation_prompt("text", "ko", "en")
    assert "Return only the translation" in prompt
    assert "explain" not in prompt.lower() or "Do not explain" in prompt


def test_auto_source_language_handling():
    prompt = build_translation_prompt("text", "auto", "en")
    assert "the source language" in prompt
