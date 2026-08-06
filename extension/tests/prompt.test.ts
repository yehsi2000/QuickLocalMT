import { describe, expect, it } from 'vitest';
import {
  buildTranslationPrompt,
  computeOutputTokenBudget,
  languageName,
  MAX_OUTPUT_TOKENS,
  MIN_OUTPUT_TOKENS,
} from '../src/shared/prompt';

describe('buildTranslationPrompt', () => {
  it('contains the language pair and the source text', () => {
    const prompt = buildTranslationPrompt('안녕하세요', 'ko', 'en');
    expect(prompt).toContain('Korean');
    expect(prompt).toContain('English');
    expect(prompt).toContain('안녕하세요');
  });

  it('handles auto source language', () => {
    expect(buildTranslationPrompt('text', 'auto', 'en')).toContain('the source language');
  });

  it('maps language codes to names', () => {
    expect(languageName('ja')).toBe('Japanese');
    expect(languageName('xx')).toBe('xx');
  });
});

describe('computeOutputTokenBudget', () => {
  it('has a minimum floor for short text', () => {
    expect(computeOutputTokenBudget('hello')).toBe(MIN_OUTPUT_TOKENS);
  });

  it('is capped at the maximum', () => {
    expect(computeOutputTokenBudget('a'.repeat(5000))).toBe(MAX_OUTPUT_TOKENS);
  });

  it('scales with input length', () => {
    const short = computeOutputTokenBudget('a'.repeat(100));
    const long = computeOutputTokenBudget('a'.repeat(2000));
    expect(long).toBeGreaterThan(short);
  });
});
