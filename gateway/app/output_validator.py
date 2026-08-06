from .repetition_detector import validate_output


class OutputValidationError(Exception):
    def __init__(self, code: str, message: str):
        self.code = code
        self.message = message
        super().__init__(message)


def validate_translation(source_text: str, source_lang: str, target_lang: str, output: str) -> None:
    reasons = validate_output(source_text, source_lang, target_lang, output)
    if reasons:
        code = reasons[0]
        detail = ", ".join(reasons)
        raise OutputValidationError(code, f"Model output failed validation: {detail}")


def clean_output(output: str) -> str:
    cleaned = output.strip()
    if len(cleaned) >= 2 and cleaned[0] == cleaned[-1] and cleaned[0] in "\"'“”":
        cleaned = cleaned[1:-1].strip()
    return cleaned
