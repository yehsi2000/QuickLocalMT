from app.glossary import apply_glossary_replacement, render_glossary_block, sort_glossary
from app.schemas import GlossaryEntry


def make(*pairs: tuple[str, str]) -> list[GlossaryEntry]:
    return [GlossaryEntry(source=source, target=target) for source, target in pairs]


def test_empty_glossary_is_noop():
    assert apply_glossary_replacement("冒険者の剣", []) == "冒険者の剣"


def test_longest_source_wins():
    glossary = make(("魔法使い", "마법사"), ("魔法", "마법"))
    assert apply_glossary_replacement("魔法使い", glossary) == "마법사"


def test_ascii_word_boundary():
    glossary = make(("Sword", "검"))
    assert apply_glossary_replacement("Swordfish has a Sword.", glossary) == "Swordfish has a 검."


def test_japanese_substring():
    glossary = make(("冒険者", "모험가"))
    assert apply_glossary_replacement("冒険者の剣", glossary) == "모험가の剣"


def test_ascii_case_insensitive():
    glossary = make(("sword", "검"))
    assert apply_glossary_replacement("Sword and SWORD", glossary) == "검 and 검"


def test_idempotent():
    glossary = make(("冒険者", "모험가"))
    once = apply_glossary_replacement("冒険者の剣", glossary)
    twice = apply_glossary_replacement(once, glossary)
    assert twice == once


def test_dollar_sign_in_target_is_literal():
    glossary = make(("gold", "$5"))
    assert apply_glossary_replacement("gold", glossary) == "$5"


def test_sort_glossary_stable_code_point_order():
    glossary = make(("魔法使い", "마법사"), ("冒険者", "모험가"), ("異世界", "이세계"))
    sources = [entry.source for entry in sort_glossary(glossary)]
    assert sources == sorted(sources)


def test_render_glossary_block_stable_order():
    glossary = make(("魔法使い", "마법사"), ("冒険者", "모험가"))
    block = render_glossary_block(glossary)
    assert block.startswith("Refer to the following translations:")
    assert block.index("冒険者 -> 모험가") < block.index("魔法使い -> 마법사")


def test_render_glossary_block_empty():
    assert render_glossary_block([]) == ""
