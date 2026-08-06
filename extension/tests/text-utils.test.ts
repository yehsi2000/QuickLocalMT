import { describe, expect, it } from 'vitest';
import { chunkText, graphemes, normalizeForComparison, splitByGraphemes, splitSentences, truncateForPreview } from '../src/shared/text-utils';

describe('chunkText', () => {
  it('returns a single chunk for short text', () => {
    expect(chunkText('short text', 1200)).toEqual(['short text']);
  });

  it('splits at sentence boundaries', () => {
    const chunks = chunkText('First sentence here. Second sentence here. Third sentence here.', 25);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.join(' ')).toContain('First');
    expect(chunks.join(' ')).toContain('Third');
  });

  it('splits korean sentences', () => {
    const text = '첫 번째 문장입니다. 두 번째 문장입니다. 세 번째 문장입니다.';
    const chunks = chunkText(text, 15);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.join('')).toContain('첫');
    expect(chunks.join('')).toContain('세');
  });

  it('hard-splits long text without boundaries', () => {
    const long = 'a'.repeat(100);
    const chunks = chunkText(long, 30);
    expect(chunks.length).toBe(4);
    expect(chunks.every((chunk) => chunk.length <= 30)).toBe(true);
    expect(chunks.join('')).toBe(long);
  });

  it('never splits surrogate pairs', () => {
    const emoji = '😀'.repeat(50);
    const chunks = chunkText(emoji, 10);
    for (const chunk of chunks) {
      expect(chunk.length % 2).toBe(0);
    }
    expect(chunks.join('')).toBe(emoji);
  });
});

describe('splitSentences', () => {
  it('splits on ascii punctuation followed by space', () => {
    expect(splitSentences('One. Two. Three.')).toEqual(['One.', 'Two.', 'Three.']);
  });

  it('splits on korean punctuation without space', () => {
    expect(splitSentences('하나.둘.셋.')).toEqual(['하나.', '둘.', '셋.']);
  });
});

describe('graphemes', () => {
  it('keeps emoji zs sequences intact', () => {
    const text = 'a👨‍👩‍👧‍👦b';
    const parts = graphemes(text);
    expect(parts).toEqual(['a', '👨‍👩‍👧‍👦', 'b']);
  });
});

describe('splitByGraphemes', () => {
  it('preserves content when reassembled', () => {
    const text = '안녕하세요 세계 😀😀';
    const chunks = splitByGraphemes(text, 4);
    expect(chunks.join('')).toBe(text);
  });
});

describe('truncateForPreview', () => {
  it('adds ellipsis for long text', () => {
    const result = truncateForPreview('a'.repeat(200), 20);
    expect(result.endsWith('\u2026')).toBe(true);
    expect(result.length).toBeLessThan(30);
  });

  it('returns text unchanged when short', () => {
    expect(truncateForPreview('hello world', 120)).toBe('hello world');
  });
});

describe('normalizeForComparison', () => {
  it('lowercases and trims surrounding punctuation', () => {
    expect(normalizeForComparison('  Hello, World!  ')).toBe('hello, world');
  });
});
