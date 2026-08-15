import type { GlossaryEntry, LangCode } from './types';

export const KNOWN_LANGS: LangCode[] = ['auto', 'ko', 'en', 'ja'];
export const TARGET_LANGS: Exclude<LangCode, 'auto'>[] = ['ko', 'en', 'ja'];
export const MAX_GLOSSARY_ENTRIES = 50;
export const MAX_GLOSSARY_TERM_LENGTH = 200;

export function isValidLangCode(value: unknown): value is LangCode {
  return typeof value === 'string' && (KNOWN_LANGS as string[]).includes(value);
}

export function isValidTargetLang(value: unknown): value is Exclude<LangCode, 'auto'> {
  return typeof value === 'string' && (TARGET_LANGS as string[]).includes(value);
}

export function normalizeLang(value: unknown, fallback: LangCode): LangCode {
  return isValidLangCode(value) ? value : fallback;
}

export function isNonEmptyText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

export function isValidSelector(value: unknown): value is string {
  if (typeof value !== 'string') {
    return false;
  }
  const selector = value.trim();
  if (selector.length === 0 || selector.length > 2048) {
    return false;
  }
  if (/</.test(selector)) {
    return false;
  }
  if (/[{}]/.test(selector)) {
    return false;
  }
  return true;
}

export function normalizeSelector(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function isValidGatewayUrl(value: unknown): value is string {
  if (typeof value !== 'string') {
    return false;
  }
  try {
    const url = new URL(value.trim());
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

export function normalizeBaseUrl(value: unknown, fallback: string): string {
  if (!isValidGatewayUrl(value)) {
    return fallback;
  }
  return value.trim().replace(/\/+$/, '');
}

export function normalizeGatewayUrl(value: unknown): string {
  return normalizeBaseUrl(value, 'http://127.0.0.1:8000');
}

export function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const num = typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : fallback;
  return Math.min(max, Math.max(min, num));
}

export function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isGlossaryEntry(value: unknown): value is GlossaryEntry {
  if (!isPlainRecord(value)) {
    return false;
  }
  const source = value.source;
  const target = value.target;
  return (
    typeof source === 'string' &&
    typeof target === 'string' &&
    source.trim().length > 0 &&
    target.trim().length > 0 &&
    source.trim().length <= MAX_GLOSSARY_TERM_LENGTH &&
    target.trim().length <= MAX_GLOSSARY_TERM_LENGTH
  );
}

export function normalizeGlossary(value: unknown): GlossaryEntry[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const seen = new Set<string>();
  const result: GlossaryEntry[] = [];
  for (const item of value) {
    if (!isGlossaryEntry(item)) {
      continue;
    }
    const source = item.source.trim();
    if (seen.has(source)) {
      continue;
    }
    seen.add(source);
    result.push({ source, target: item.target.trim() });
    if (result.length >= MAX_GLOSSARY_ENTRIES) {
      break;
    }
  }
  return result;
}

export function assertNever(value: never): never {
  throw new Error(`Unexpected value: ${String(value)}`);
}
