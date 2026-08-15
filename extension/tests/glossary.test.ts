import { describe, expect, it } from 'vitest';
import {
  applyGlossaryReplacement,
  renderGlossaryBlock,
  sortGlossary,
} from '../src/shared/glossary';
import type { GlossaryEntry } from '../src/shared/types';

function make(...pairs: Array<[string, string]>): GlossaryEntry[] {
  return pairs.map(([source, target]) => ({ source, target }));
}

describe('applyGlossaryReplacement', () => {
  it('is a no-op for an empty glossary', () => {
    expect(applyGlossaryReplacement('冒険者の剣', [])).toBe('冒険者の剣');
  });

  it('replaces longest sources first', () => {
    const glossary = make(['魔法使い', '마법사'], ['魔法', '마법']);
    expect(applyGlossaryReplacement('魔法使い', glossary)).toBe('마법사');
  });

  it('respects ASCII word boundaries', () => {
    expect(applyGlossaryReplacement('Swordfish has a Sword.', make(['Sword', '검']))).toBe(
      'Swordfish has a 검.',
    );
  });

  it('replaces Japanese substrings without word boundaries', () => {
    expect(applyGlossaryReplacement('冒険者の剣', make(['冒険者', '모험가']))).toBe('모험가の剣');
  });

  it('matches ASCII case-insensitively', () => {
    expect(applyGlossaryReplacement('Sword and SWORD', make(['sword', '검']))).toBe('검 and 검');
  });

  it('is idempotent', () => {
    const glossary = make(['冒険者', '모험가']);
    const once = applyGlossaryReplacement('冒険者の剣', glossary);
    expect(applyGlossaryReplacement(once, glossary)).toBe(once);
  });

  it('does not interpret dollar signs in targets', () => {
    expect(applyGlossaryReplacement('gold', make(['gold', '$5']))).toBe('$5');
  });
});

describe('renderGlossaryBlock', () => {
  it('renders an empty string for an empty glossary', () => {
    expect(renderGlossaryBlock([])).toBe('');
  });

  it('renders entries in stable source order', () => {
    const block = renderGlossaryBlock(make(['魔法使い', '마법사'], ['冒険者', '모험가']));
    expect(block.startsWith('Refer to the following translations:')).toBe(true);
    expect(block.indexOf('冒険者 -> 모험가')).toBeLessThan(block.indexOf('魔法使い -> 마법사'));
  });
});

describe('sortGlossary', () => {
  it('sorts by source in code-point order', () => {
    const entries = sortGlossary(make(['魔法使い', '마법사'], ['冒険者', '모험가'], ['異世界', '이세계']));
    expect(entries.map((entry) => entry.source)).toEqual(['冒険者', '異世界', '魔法使い']);
  });
});
