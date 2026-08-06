import { describe, expect, it } from 'vitest';
import {
  clampInt,
  isValidGatewayUrl,
  isValidLangCode,
  isValidSelector,
  normalizeGatewayUrl,
  normalizeSelector,
} from '../src/shared/validation';

describe('validation', () => {
  it('validates language codes', () => {
    expect(isValidLangCode('ko')).toBe(true);
    expect(isValidLangCode('auto')).toBe(true);
    expect(isValidLangCode('fr')).toBe(false);
    expect(isValidLangCode(undefined)).toBe(false);
  });

  it('validates selectors', () => {
    expect(isValidSelector('article .content')).toBe(true);
    expect(isValidSelector('  article  ')).toBe(true);
    expect(isValidSelector('')).toBe(false);
    expect(isValidSelector('   ')).toBe(false);
    expect(isValidSelector('div<script>')).toBe(false);
    expect(isValidSelector('a'.repeat(3000))).toBe(false);
  });

  it('normalizes selectors by trimming', () => {
    expect(normalizeSelector('  p.foo  ')).toBe('p.foo');
    expect(normalizeSelector(42)).toBe('');
  });

  it('validates gateway urls', () => {
    expect(isValidGatewayUrl('http://127.0.0.1:8000')).toBe(true);
    expect(isValidGatewayUrl('https://localhost:8443')).toBe(true);
    expect(isValidGatewayUrl('ftp://example.com')).toBe(false);
    expect(isValidGatewayUrl('not a url')).toBe(false);
    expect(isValidGatewayUrl('')).toBe(false);
  });

  it('normalizes gateway urls by stripping trailing slashes', () => {
    expect(normalizeGatewayUrl('http://127.0.0.1:8000///')).toBe('http://127.0.0.1:8000');
    expect(normalizeGatewayUrl('garbage')).toBe('http://127.0.0.1:8000');
  });

  it('clamps integers to a range', () => {
    expect(clampInt(0, 1, 4, 2)).toBe(1);
    expect(clampInt(9, 1, 4, 2)).toBe(4);
    expect(clampInt('x', 1, 4, 2)).toBe(2);
    expect(clampInt(2.7, 1, 4, 2)).toBe(3);
  });
});
