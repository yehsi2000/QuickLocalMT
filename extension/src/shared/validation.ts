import type { LangCode } from './types';

export const KNOWN_LANGS: LangCode[] = ['auto', 'ko', 'en', 'ja'];
export const TARGET_LANGS: Exclude<LangCode, 'auto'>[] = ['ko', 'en', 'ja'];

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
  if (/[<>]/.test(selector)) {
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

export function normalizeGatewayUrl(value: unknown): string {
  if (!isValidGatewayUrl(value)) {
    return 'http://127.0.0.1:8000';
  }
  return value.trim().replace(/\/+$/, '');
}

export function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const num = typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : fallback;
  return Math.min(max, Math.max(min, num));
}

export function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function assertNever(value: never): never {
  throw new Error(`Unexpected value: ${String(value)}`);
}
