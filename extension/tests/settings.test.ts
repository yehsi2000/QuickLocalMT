import { describe, expect, it } from 'vitest';
import { sanitizeSettings, siteGlossaryForHostname } from '../src/background/settings';
import type { SiteGlossary } from '../src/shared/types';

function makeSiteGlossary(overrides: Partial<SiteGlossary> = {}): SiteGlossary {
  return {
    hostname: 'example.com',
    glossary: [{ source: '冒険者', target: '모험가' }],
    ...overrides,
  };
}

describe('siteGlossaryForHostname', () => {
  it('returns the glossary for the matching hostname', () => {
    const site = makeSiteGlossary({ glossary: [{ source: '冒険者', target: '모험가' }] });
    expect(siteGlossaryForHostname([site], 'example.com')).toEqual([
      { source: '冒険者', target: '모험가' },
    ]);
  });

  it('returns an empty list for an unknown hostname', () => {
    expect(siteGlossaryForHostname([makeSiteGlossary()], 'other.example.com')).toEqual([]);
  });

  it('returns an empty list when there are no glossaries', () => {
    expect(siteGlossaryForHostname([], 'example.com')).toEqual([]);
  });
});

describe('sanitizeSettings siteGlossaries', () => {
  it('sanitizes site glossaries and normalizes hostnames', () => {
    const settings = sanitizeSettings({
      siteGlossaries: [
        {
          hostname: ' Example.com ',
          glossary: [
            { source: ' 冒険者 ', target: '모험가' },
            { source: '', target: 'bad' },
          ],
        },
        { hostname: '', glossary: [] },
      ],
    });
    expect(settings.siteGlossaries).toEqual([
      {
        hostname: 'example.com',
        glossary: [{ source: '冒険者', target: '모험가' }],
      },
    ]);
  });

  it('dedupes sites by hostname keeping the first', () => {
    const settings = sanitizeSettings({
      siteGlossaries: [
        makeSiteGlossary({ hostname: 'example.com', glossary: [{ source: 'a', target: '가' }] }),
        makeSiteGlossary({ hostname: 'example.com', glossary: [{ source: 'b', target: '나' }] }),
      ],
    });
    expect(settings.siteGlossaries).toHaveLength(1);
    expect(settings.siteGlossaries[0]?.glossary).toEqual([{ source: 'a', target: '가' }]);
  });

  it('migrates legacy rule glossaries into per-site glossaries', () => {
    const settings = sanitizeSettings({
      domainRules: [
        {
          id: 'r1',
          hostname: 'example.com',
          selector: '.main',
          excludedSelectors: [],
          enabled: true,
          glossary: [{ source: '冒険者', target: '모험가' }],
        },
      ],
      siteGlossaries: [
        makeSiteGlossary({ hostname: 'example.com', glossary: [{ source: 'existing', target: '기존' }] }),
      ],
    });
    expect(settings.siteGlossaries).toHaveLength(1);
    expect(settings.siteGlossaries[0]?.glossary).toEqual([
      { source: 'existing', target: '기존' },
      { source: '冒険者', target: '모험가' },
    ]);
  });

  it('strips glossary from migrated rules', () => {
    const settings = sanitizeSettings({
      domainRules: [
        {
          id: 'r1',
          hostname: 'example.com',
          selector: '.main',
          excludedSelectors: [],
          enabled: true,
          glossary: [{ source: '冒険者', target: '모험가' }],
        },
      ],
    });
    expect(settings.domainRules).toHaveLength(1);
    expect('glossary' in settings.domainRules[0]!).toBe(false);
  });
});
