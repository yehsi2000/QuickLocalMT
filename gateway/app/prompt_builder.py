from .glossary import render_glossary_block

LANGUAGE_NAMES = {
    "auto": "the source language",
    "ko": "Korean",
    "en": "English",
    "ja": "Japanese",
}

PROMPT_TEMPLATE = """Translate from {source_lang} to {target_lang}.

Rules:
- Return only the translation.
- Do not explain the translation.
- Do not repeat the source text.
- Do not add headings, quotes, notes, or commentary.
- Preserve line breaks when they carry meaning.

Text:
{input_text}
"""


def language_name(code: str) -> str:
    return LANGUAGE_NAMES.get(code, code)


def build_translation_prompt(
    text: str,
    source_lang: str,
    target_lang: str,
    glossary: list | None = None,
) -> str:
    base = PROMPT_TEMPLATE.format(
        source_lang=language_name(source_lang),
        target_lang=language_name(target_lang),
        input_text=text,
    )
    if not glossary:
        return base
    block = render_glossary_block(glossary)
    if not block:
        return base
    return block + "\n" + base
