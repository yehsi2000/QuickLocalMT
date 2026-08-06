import re
import unicodedata

SENTENCE_SPLIT_RE = re.compile(
    r"(?<=[.!?])\s+|(?<=[。！？…])(?=\S)|(?<=[.!?])(?=[\uac00-\ud7af\u3040-\u30ff\u4e00-\u9fff])"
)
STRIP_PUNCTUATION = "\"'“”‘’「」『』【】()[]{}<>《》〈〉.,!?;:。！？；：、，"


def normalize(text: str) -> str:
    text = unicodedata.normalize("NFKC", text)
    text = text.lower()
    text = re.sub(r"\s+", " ", text).strip()
    return text.strip(STRIP_PUNCTUATION)


def split_sentences(text: str) -> list[str]:
    parts = SENTENCE_SPLIT_RE.split(text)
    return [part.strip() for part in parts if part.strip()]


def has_consecutive_repeated_sentences(text: str) -> bool:
    sentences = split_sentences(text)
    if len(sentences) < 2:
        return False
    previous = None
    for sentence in sentences:
        normalized = normalize(sentence)
        if normalized and normalized == previous:
            return True
        previous = normalized
    return False


def has_repeated_ngram(text: str, n: int = 8, threshold: int = 3) -> bool:
    compact = re.sub(r"\s+", "", unicodedata.normalize("NFKC", text))
    if len(compact) < n + threshold - 1:
        return False
    counts: dict[str, int] = {}
    for i in range(len(compact) - n + 1):
        gram = compact[i : i + n]
        count = counts.get(gram, 0) + 1
        if count >= threshold:
            return True
        counts[gram] = count
    return False


HANGUL_RE = re.compile(r"[\uac00-\ud7af]")
JAPANESE_RE = re.compile(r"[\u3040-\u30ff]")
IDENTIFIER_RE = re.compile(r"[a-z0-9_.@:/#+-]+")


def is_nearly_identical(source: str, output: str, source_lang: str, target_lang: str) -> bool:
    normalized_source = normalize(source)
    normalized_output = normalize(output)
    if not normalized_source or normalized_source != normalized_output:
        return False
    tokens = normalized_output.split()
    if tokens and all(IDENTIFIER_RE.fullmatch(token) for token in tokens):
        return False
    if source_lang == "ko" and HANGUL_RE.search(output):
        return True
    if source_lang == "ja" and JAPANESE_RE.search(output):
        return True
    if target_lang == "en" and HANGUL_RE.search(output):
        return True
    if target_lang == "ja" and JAPANESE_RE.search(output):
        return True
    if target_lang in ("ko", "ja") and re.fullmatch(r"[a-z0-9 _.,!?;:'-]+", normalized_output) and len(normalized_output) > 3:
        return True
    return False


def output_exceeds_length_ratio(source: str, output: str, ratio: float = 3.0) -> bool:
    source_len = len(source.strip())
    output_len = len(output.strip())
    if source_len == 0:
        return False
    return output_len > source_len * ratio


def contains_prompt_leakage(output: str) -> bool:
    lowered = output.lower().strip()
    if lowered.startswith(("translate", "translation:", "<text>", "assistant", "system:")):
        return True
    return re.search(r"<\|(?:im_start|im_end|assistant|system|user)", lowered) is not None


def validate_output(source_text: str, source_lang: str, target_lang: str, output: str) -> list[str]:
    reasons: list[str] = []
    if not output.strip():
        reasons.append("EMPTY_OUTPUT")
        return reasons
    same_language = source_lang != "auto" and source_lang == target_lang
    if not same_language and is_nearly_identical(source_text, output, source_lang, target_lang):
        reasons.append("ECHOED_SOURCE")
    if has_consecutive_repeated_sentences(output):
        reasons.append("REPEATED_SENTENCE")
    if has_repeated_ngram(output):
        reasons.append("REPEATED_NGRAM")
    if output_exceeds_length_ratio(source_text, output):
        reasons.append("OUTPUT_TOO_LONG")
    if contains_prompt_leakage(output):
        reasons.append("PROMPT_LEAKAGE")
    return reasons
