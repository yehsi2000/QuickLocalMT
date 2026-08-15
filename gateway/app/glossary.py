"""Glossary helpers for site-scoped terminology translation.

Pure functions, no I/O. Kept byte-compatible with the extension mirror
`extension/src/shared/glossary.ts`.
"""

import re

from .schemas import GlossaryEntry

GLOSSARY_HEADER = "Refer to the following translations:"
DEFAULT_MAX_BLOCK_CHARS = 4000

_ASCII_TERM_RE = re.compile(r"^[A-Za-z0-9_]+$")


def sort_glossary(glossary: list[GlossaryEntry]) -> list[GlossaryEntry]:
    """Stable sort by source term (Unicode code-point order)."""
    return sorted(glossary, key=lambda entry: entry.source)


def render_glossary_block(
    glossary: list[GlossaryEntry], max_chars: int = DEFAULT_MAX_BLOCK_CHARS
) -> str:
    """Render the prompt glossary block in stable order.

    Entries are added while the rendered block stays within ``max_chars``;
    tail entries are dropped (an entry is never truncated mid-way).
    """
    entries = sort_glossary(glossary)
    if not entries:
        return ""
    lines: list[str] = []
    for entry in entries:
        candidate = f"{entry.source} -> {entry.target}"
        if len("\n".join([GLOSSARY_HEADER, *lines, candidate])) > max_chars:
            break
        lines.append(candidate)
    if not lines:
        return ""
    return "\n".join([GLOSSARY_HEADER, *lines])


def apply_glossary_replacement(output: str, glossary: list[GlossaryEntry]) -> str:
    """Deterministic safety net after model output validation.

    Replaces any remaining source term in the output with its target term.
    Longest source first; pure-ASCII sources use word boundaries and
    case-insensitive matching; non-ASCII sources match as substrings.
    """
    if not glossary:
        return output
    entries = sorted(glossary, key=lambda entry: len(entry.source), reverse=True)
    result = output
    for entry in entries:
        source = entry.source
        if _ASCII_TERM_RE.match(source):
            pattern = re.compile(rf"\b{re.escape(source)}\b", re.IGNORECASE)
        else:
            pattern = re.compile(re.escape(source), re.IGNORECASE)
        result = pattern.sub(lambda _match, replacement=entry.target: replacement, result)
    return result
