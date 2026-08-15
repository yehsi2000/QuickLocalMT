import { describe, expect, it } from 'vitest';
import { getProviderHealth, translateChunk } from '../src/background/api-client';
import type { ExtensionSettings } from '../src/shared/types';

function makeSettings(overrides: Partial<ExtensionSettings> = {}): ExtensionSettings {
  return {
    provider: 'ollama',
    gatewayBaseUrl: 'http://127.0.0.1:8000',
    ollamaBaseUrl: 'http://127.0.0.1:11434',
    ollamaModel: 'hy-mt:1.5b',
    llamacppBaseUrl: 'http://127.0.0.1:8080',
    llamacppModel: '',
    defaultSourceLang: 'auto',
    defaultTargetLang: 'en',
    concurrency: 2,
    textChunkMaxChars: 1200,
    autoUseSavedRule: false,
    domainRules: [],
    siteGlossaries: [],
    ...overrides,
  };
}

async function serversUp(): Promise<boolean> {
  try {
    const ollama = await fetch('http://127.0.0.1:11434/api/tags');
    const llamacpp = await fetch('http://127.0.0.1:8080/health');
    return ollama.ok && llamacpp.ok;
  } catch {
    return false;
  }
}

const liveAvailable = await serversUp();

describe.skipIf(!liveAvailable)('live direct providers', () => {
  it('reaches a running Ollama server', async () => {
    const health = await getProviderHealth(makeSettings());
    expect(health.runtime).toBe('ollama');
    const translation = await translateChunk(makeSettings(), {
      text: '안녕하세요',
      source_lang: 'ko',
      target_lang: 'en',
    });
    expect(translation).toBe('Hello.');
  });

  it('rejects repetitive output from Ollama', async () => {
    await expect(
      translateChunk(makeSettings(), {
        text: '반복 문장 테스트',
        source_lang: 'ko',
        target_lang: 'en',
      }),
    ).rejects.toMatchObject({ code: 'REPEATED_SENTENCE' });
  });

  it('reaches a running llama.cpp server', async () => {
    const health = await getProviderHealth(makeSettings({ provider: 'llamacpp' }));
    expect(health.runtime).toBe('llamacpp');
    const translation = await translateChunk(makeSettings({ provider: 'llamacpp' }), {
      text: '이 문장은 길이가 충분하여 번역 결과가 과도하게 길다고 판단되지 않습니다.',
      source_lang: 'ko',
      target_lang: 'en',
    });
    expect(translation).toBe('Hello from llama.cpp.');
  });
});
