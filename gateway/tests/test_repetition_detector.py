from app.repetition_detector import (
    contains_prompt_leakage,
    has_consecutive_repeated_sentences,
    has_repeated_ngram,
    is_nearly_identical,
    normalize,
    output_exceeds_length_ratio,
    validate_output,
)


def test_repeated_complete_sentence_is_detected():
    output = "This is a test. This is a test."
    assert has_consecutive_repeated_sentences(output) is True
    assert "REPEATED_SENTENCE" in validate_output("원문", "ko", "en", output)


def test_repeated_phrase_is_detected():
    output = "hello hello hello hello"
    assert has_repeated_ngram(output) is True
    assert "REPEATED_NGRAM" in validate_output("원문", "ko", "en", output)


def test_legitimate_short_repeated_text_passes():
    output = "OK OK"
    assert has_consecutive_repeated_sentences(output) is False
    assert has_repeated_ngram(output) is False
    assert validate_output("원문", "ko", "en", output) == []


def test_source_equals_target_due_to_names_or_code_passes():
    source = "OpenAI GPT-4"
    output = "OpenAI GPT-4"
    assert is_nearly_identical(source, output, "ko", "en") is False
    assert validate_output(source, "ko", "en", output) == []


def test_echoed_source_language_text_is_detected():
    source = "안녕하세요"
    output = "안녕하세요"
    assert is_nearly_identical(source, output, "ko", "en") is True
    assert "ECHOED_SOURCE" in validate_output(source, "ko", "en", output)


def test_korean_punctuation_edge_cases():
    repeated_korean = "안녕하세요. 안녕하세요. 반갑습니다."
    assert has_consecutive_repeated_sentences(repeated_korean) is True
    assert validate_output("원문", "en", "ko", repeated_korean) != []
    quoted_korean = "「안녕하세요」"
    assert normalize(quoted_korean) == "안녕하세요"


def test_english_punctuation_edge_cases():
    repeated_english = "Hello world. Hello world!"
    assert has_consecutive_repeated_sentences(repeated_english) is True
    assert normalize("Hello, world!") == "hello, world"


def test_empty_output_rejected():
    assert "EMPTY_OUTPUT" in validate_output("원문", "ko", "en", "   ")


def test_output_too_long_detected():
    source = "short"
    output = "this output is far too long for a very short source phrase indeed"
    assert output_exceeds_length_ratio(source, output) is True
    assert "OUTPUT_TOO_LONG" in validate_output(source, "ko", "en", output)


def test_prompt_leakage_detected():
    assert contains_prompt_leakage("Translation: 안녕하세요") is True
    assert contains_prompt_leakage("Translate from Korean to English") is True
    assert contains_prompt_leakage("안녕하세요") is False
