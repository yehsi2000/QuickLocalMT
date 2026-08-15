import { describe, expect, it } from 'vitest';
import { renderGlossaryBlock } from '../src/shared/glossary';
import {
  buildTranslationPrompt,
  computeOutputTokenBudget,
  languageName,
  MAX_OUTPUT_TOKENS,
  MIN_OUTPUT_TOKENS,
} from '../src/shared/prompt';
import type { GlossaryEntry } from '../src/shared/types';

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

  it('is unchanged for an empty glossary', () => {
    expect(buildTranslationPrompt('안녕하세요', 'ko', 'en', [])).toBe(
      buildTranslationPrompt('안녕하세요', 'ko', 'en'),
    );
  });

  it('prepends the glossary block in stable order', () => {
    const glossary: GlossaryEntry[] = [
      { source: '魔法使い', target: '마법사' },
      { source: '冒険者', target: '모험가' },
    ];
    const prompt = buildTranslationPrompt('冒険者と魔法使い', 'ja', 'ko', glossary);
    expect(prompt.indexOf('Refer to the following translations:')).toBeLessThan(
      prompt.indexOf('Translate'),
    );
    expect(prompt.indexOf('冒険者 -> 모험가')).toBeLessThan(prompt.indexOf('魔法使い -> 마법사'));
    expect(prompt).toContain('冒険者と魔法使い');
  });

  it('drops tail glossary entries beyond the block size limit', () => {
    const many: GlossaryEntry[] = Array.from({ length: 200 }, (_, index) => ({
      source: `term${index}`,
      target: `T${index}`,
    }));
    const block = renderGlossaryBlock(many, 100);
    expect(block.length).toBeLessThanOrEqual(100);
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
