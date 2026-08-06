import { describe, expect, it } from 'vitest';
import {
  cleanChunkOutput,
  containsPromptLeakage,
  hasConsecutiveRepeatedSentences,
  hasRepeatedNgram,
  isNearlyIdentical,
  outputTooLong,
  validateChunk,
} from '../src/shared/output-guard';

describe('output-guard', () => {
  it('detects repeated complete sentences', () => {
    const output = 'This is a test. This is a test.';
    expect(hasConsecutiveRepeatedSentences(output)).toBe(true);
    expect(validateChunk('원문', 'ko', 'en', output)).toContain('REPEATED_SENTENCE');
  });

  it('detects repeated phrases via n-grams', () => {
    expect(hasRepeatedNgram('hello hello hello hello')).toBe(true);
  });

  it('passes legitimate short repeated text', () => {
    expect(hasConsecutiveRepeatedSentences('OK OK')).toBe(false);
    expect(hasRepeatedNgram('OK OK')).toBe(false);
    expect(validateChunk('원문', 'ko', 'en', 'OK OK')).toEqual([]);
  });

  it('passes names and code that stay identical', () => {
    expect(isNearlyIdentical('OpenAI GPT-4', 'OpenAI GPT-4', 'ko', 'en')).toBe(false);
    expect(validateChunk('OpenAI GPT-4', 'ko', 'en', 'OpenAI GPT-4')).toEqual([]);
  });

  it('flags echoed source-language text', () => {
    expect(isNearlyIdentical('안녕하세요', '안녕하세요', 'ko', 'en')).toBe(true);
    expect(validateChunk('안녕하세요', 'ko', 'en', '안녕하세요')).toContain('ECHOED_SOURCE');
  });

  it('handles korean and english punctuation', () => {
    expect(hasConsecutiveRepeatedSentences('안녕하세요. 안녕하세요. 반갑습니다.')).toBe(true);
    expect(hasConsecutiveRepeatedSentences('Hello world. Hello world!')).toBe(true);
  });

  it('rejects empty output', () => {
    expect(validateChunk('원문', 'ko', 'en', '   ')).toEqual(['EMPTY_OUTPUT']);
  });

  it('flags output that is too long', () => {
    expect(outputTooLong('short', 'this output is far too long for a short source')).toBe(true);
  });

  it('detects prompt leakage', () => {
    expect(containsPromptLeakage('Translation: 안녕하세요')).toBe(true);
    expect(containsPromptLeakage('Translate from Korean to English')).toBe(true);
    expect(containsPromptLeakage('안녕하세요')).toBe(false);
  });

  it('cleans wrapping quotes', () => {
    expect(cleanChunkOutput('  "Hello world"  ')).toBe('Hello world');
    expect(cleanChunkOutput('Hello world')).toBe('Hello world');
  });
});
