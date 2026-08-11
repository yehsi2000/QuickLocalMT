from app.glossary import render_glossary_block
from app.prompt_builder import build_translation_prompt
from app.schemas import GlossaryEntry


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


def test_empty_glossary_equals_old_prompt():
    with_glossary = build_translation_prompt("안녕하세요", "ko", "en", [])
    without = build_translation_prompt("안녕하세요", "ko", "en")
    assert with_glossary == without


def test_glossary_block_rendered_before_instruction_in_stable_order():
    glossary = [
        GlossaryEntry(source="魔法使い", target="마법사"),
        GlossaryEntry(source="冒険者", target="모험가"),
    ]
    prompt = build_translation_prompt("冒険者と魔法使い", "ja", "ko", glossary)
    assert "Refer to the following translations:" in prompt
    assert prompt.index("Refer to the following translations:") < prompt.index("Translate from")
    assert prompt.index("冒険者 -> 모험가") < prompt.index("魔法使い -> 마법사")
    assert "冒険者と魔法使い" in prompt


def test_glossary_block_truncation_guard():
    glossary = [
        GlossaryEntry(source=f"term-{i}-{'x' * 30}", target="T") for i in range(200)
    ]
    block = render_glossary_block(glossary)
    assert len(block) <= 4000
    prompt = build_translation_prompt("text", "ko", "en", glossary)
    assert "term-199" not in prompt
    assert "text" in prompt
