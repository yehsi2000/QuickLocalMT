import type { GlossaryEntry } from './types';

export const MAX_GLOSSARY_BLOCK_CHARS = 4000;

const GLOSSARY_HEADER = 'Refer to the following translations:';
const ASCII_TERM_RE = /^[A-Za-z0-9_]+$/;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function sortGlossary(glossary: GlossaryEntry[]): GlossaryEntry[] {
  return glossary
    .slice()
    .sort((a, b) => (a.source < b.source ? -1 : a.source > b.source ? 1 : 0));
}

export function renderGlossaryBlock(
  glossary: GlossaryEntry[],
  maxChars: number = MAX_GLOSSARY_BLOCK_CHARS,
): string {
  const lines: string[] = [];
  for (const entry of sortGlossary(glossary)) {
    const candidate = `${entry.source} -> ${entry.target}`;
    if ([GLOSSARY_HEADER, ...lines, candidate].join('\n').length > maxChars) {
      break;
    }
    lines.push(candidate);
  }
  if (lines.length === 0) {
    return '';
  }
  return [GLOSSARY_HEADER, ...lines].join('\n');
}

export function applyGlossaryReplacement(
  output: string,
  glossary: GlossaryEntry[],
): string {
  if (glossary.length === 0) {
    return output;
  }
  const entries = glossary.slice().sort((a, b) => b.source.length - a.source.length);
  let result = output;
  for (const entry of entries) {
    const escaped = escapeRegExp(entry.source);
    const pattern = ASCII_TERM_RE.test(entry.source) ? `\\b${escaped}\\b` : escaped;
    result = result.replace(new RegExp(pattern, 'gi'), () => entry.target);
  }
  return result;
}
