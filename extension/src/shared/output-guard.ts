import { normalizeForComparison, splitSentences } from './text-utils';

const HANGUL_RE = /[\uac00-\ud7af]/;
const JAPANESE_RE = /[\u3040-\u30ff]/;
const IDENTIFIER_RE = /^[a-z0-9_.@:/#+-]+$/;

export function hasConsecutiveRepeatedSentences(text: string): boolean {
  const sentences = splitSentences(text);
  if (sentences.length < 2) {
    return false;
  }
  let previous: string | null = null;
  for (const sentence of sentences) {
    const normalized = normalizeForComparison(sentence);
    if (normalized.length > 0 && normalized === previous) {
      return true;
    }
    previous = normalized;
  }
  return false;
}

export function hasRepeatedNgram(text: string, n = 8, threshold = 3): boolean {
  const compact = text.normalize('NFKC').replace(/\s+/g, '');
  if (compact.length < n + threshold - 1) {
    return false;
  }
  const counts = new Map<string, number>();
  for (let i = 0; i <= compact.length - n; i += 1) {
    const gram = compact.slice(i, i + n);
    const count = (counts.get(gram) ?? 0) + 1;
    if (count >= threshold) {
      return true;
    }
    counts.set(gram, count);
  }
  return false;
}

export function isNearlyIdentical(
  source: string,
  output: string,
  sourceLang: string,
  targetLang: string,
): boolean {
  const normalizedSource = normalizeForComparison(source);
  const normalizedOutput = normalizeForComparison(output);
  if (!normalizedSource || normalizedSource !== normalizedOutput) {
    return false;
  }
  const tokens = normalizedOutput.split(' ');
  if (tokens.length > 0 && tokens.every((token) => IDENTIFIER_RE.test(token))) {
    return false;
  }
  if (sourceLang === 'ko' && HANGUL_RE.test(output)) {
    return true;
  }
  if (sourceLang === 'ja' && JAPANESE_RE.test(output)) {
    return true;
  }
  if (targetLang === 'en' && HANGUL_RE.test(output)) {
    return true;
  }
  if (targetLang === 'ja' && JAPANESE_RE.test(output)) {
    return true;
  }
  if (
    (targetLang === 'ko' || targetLang === 'ja') &&
    /^[a-z0-9 _.,!?;:'-]+$/.test(normalizedOutput) &&
    normalizedOutput.length > 3
  ) {
    return true;
  }
  return false;
}

export function outputTooLong(source: string, output: string, ratio = 3): boolean {
  const sourceLength = source.trim().length;
  const outputLength = output.trim().length;
  return sourceLength > 0 && outputLength > sourceLength * ratio;
}

export function containsPromptLeakage(output: string): boolean {
  const lowered = output.toLowerCase().trim();
  if (
    lowered.startsWith('translate') ||
    lowered.startsWith('translation:') ||
    lowered.startsWith('<text>') ||
    lowered.startsWith('assistant') ||
    lowered.startsWith('system:')
  ) {
    return true;
  }
  return /<\|(?:im_start|im_end|assistant|system|user)/.test(lowered);
}

export function validateChunk(
  sourceText: string,
  sourceLang: string,
  targetLang: string,
  output: string,
): string[] {
  const reasons: string[] = [];
  if (output.trim().length === 0) {
    reasons.push('EMPTY_OUTPUT');
    return reasons;
  }
  const sameLanguage = sourceLang !== 'auto' && sourceLang === targetLang;
  if (!sameLanguage && isNearlyIdentical(sourceText, output, sourceLang, targetLang)) {
    reasons.push('ECHOED_SOURCE');
  }
  if (hasConsecutiveRepeatedSentences(output)) {
    reasons.push('REPEATED_SENTENCE');
  }
  if (hasRepeatedNgram(output)) {
    reasons.push('REPEATED_NGRAM');
  }
  if (outputTooLong(sourceText, output)) {
    reasons.push('OUTPUT_TOO_LONG');
  }
  if (containsPromptLeakage(output)) {
    reasons.push('PROMPT_LEAKAGE');
  }
  return reasons;
}

export function cleanChunkOutput(output: string): string {
  let cleaned = output.trim();
  const first = cleaned[0];
  if (
    cleaned.length >= 2 &&
    first !== undefined &&
    first === cleaned[cleaned.length - 1] &&
    '"\u201C\u201D'.includes(first)
  ) {
    cleaned = cleaned.slice(1, -1).trim();
  }
  return cleaned;
}
