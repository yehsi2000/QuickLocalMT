import { describe, expect, it } from 'vitest';
import { rulesForTranslation } from '../src/background/settings';
import type { DomainRule } from '../src/shared/types';

function makeRule(overrides: Partial<DomainRule> = {}): DomainRule {
  return {
    id: 'r1',
    hostname: 'example.com',
    selector: '.main',
    excludedSelectors: [],
    enabled: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('rulesForTranslation', () => {
  it('includes rules whose explicit direction matches the translation', () => {
    const rules = [
      makeRule({
        sourceLang: 'ja',
        targetLang: 'ko',
        glossary: [{ source: '冒険者', target: '모험가' }],
      }),
    ];
    expect(rulesForTranslation(rules, 'ja', 'ko', 'auto', 'en')).toHaveLength(1);
  });

  it('excludes rules whose target differs from the translation target', () => {
    const rules = [
      makeRule({ sourceLang: 'ja', targetLang: 'ko', glossary: [{ source: '冒険者', target: '모험가' }] }),
    ];
    expect(rulesForTranslation(rules, 'ja', 'ja', 'auto', 'en')).toHaveLength(0);
  });

  it('excludes rules whose explicit source differs from the translation source', () => {
    const rules = [makeRule({ sourceLang: 'ja', targetLang: 'ko' })];
    expect(rulesForTranslation(rules, 'en', 'ko', 'auto', 'en')).toHaveLength(0);
  });

  it('matches any source when the rule has no explicit source (default auto)', () => {
    const rules = [makeRule({ targetLang: 'ko', glossary: [{ source: 'magic', target: '마법' }] })];
    expect(rulesForTranslation(rules, 'en', 'ko', 'auto', 'en')).toHaveLength(1);
    expect(rulesForTranslation(rules, 'ja', 'ko', 'auto', 'en')).toHaveLength(1);
  });

  it('matches the default target when the rule has no explicit target', () => {
    const rules = [makeRule({ sourceLang: 'ko' })];
    expect(rulesForTranslation(rules, 'ko', 'en', 'auto', 'en')).toHaveLength(1);
    expect(rulesForTranslation(rules, 'ko', 'ja', 'auto', 'en')).toHaveLength(0);
  });

  it('treats an auto-detect translation source as a wildcard when the target matches', () => {
    const rules = [makeRule({ sourceLang: 'ja', targetLang: 'ko' }), makeRule({ sourceLang: 'en', targetLang: 'ko' })];
    expect(rulesForTranslation(rules, 'auto', 'ko', 'auto', 'en')).toHaveLength(2);
  });

  it('excludes disabled rules', () => {
    const rules = [makeRule({ sourceLang: 'ja', targetLang: 'ko', enabled: false })];
    expect(rulesForTranslation(rules, 'ja', 'ko', 'auto', 'en')).toHaveLength(0);
  });

  it('returns an empty list when nothing matches', () => {
    expect(rulesForTranslation([], 'ja', 'ko', 'auto', 'en')).toEqual([]);
  });
});
