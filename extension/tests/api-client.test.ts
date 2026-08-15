import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getProviderHealth, translateChunk } from '../src/background/api-client';
import type { ExtensionSettings, GlossaryEntry } from '../src/shared/types';

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
    ...overrides,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const koreanRequest = { text: '안녕하세요', source_lang: 'ko', target_lang: 'en' };

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('translateChunk (direct providers)', () => {
  it('translates directly through Ollama /api/generate', async () => {
    fetchMock.mockImplementation(async (url: string, init: RequestInit) => {
      expect(url).toBe('http://127.0.0.1:11434/api/generate');
      const body = JSON.parse(String(init.body)) as { model: string; prompt: string; options: { num_predict: number } };
      expect(body.model).toBe('hy-mt:1.5b');
      expect(body.prompt).toContain('Korean');
      expect(body.options.num_predict).toBeGreaterThan(0);
      return jsonResponse({ model: 'hy-mt:1.5b', response: 'Hello.', done: true });
    });
    const result = await translateChunk(makeSettings(), koreanRequest);
    expect(result).toBe('Hello.');
  });

  it('retries once with adjusted options when Ollama output is repetitive', async () => {
    let calls = 0;
    fetchMock.mockImplementation(async (_url: string, init: RequestInit) => {
      calls += 1;
      const body = JSON.parse(String(init.body)) as { options: { repeat_penalty: number } };
      if (calls === 1) {
        expect(body.options.repeat_penalty).toBe(1.08);
        return jsonResponse({ response: 'This is a test. This is a test.' });
      }
      expect(body.options.repeat_penalty).toBe(1.12);
      return jsonResponse({ response: 'This is a test.' });
    });
    const result = await translateChunk(
      makeSettings(),
      { text: '테스트 문장입니다', source_lang: 'ko', target_lang: 'en' },
    );
    expect(calls).toBe(2);
    expect(result).toBe('This is a test.');
  });

  it('throws a structured validation error when direct output never improves', async () => {
    fetchMock.mockImplementation(async () => jsonResponse({ response: '안녕하세요' }));
    await expect(translateChunk(makeSettings(), koreanRequest)).rejects.toMatchObject({
      code: 'ECHOED_SOURCE',
    });
  });

  it('translates through llama.cpp /v1/chat/completions', async () => {
    fetchMock.mockImplementation(async (url: string, init: RequestInit) => {
      expect(url).toBe('http://127.0.0.1:8080/v1/chat/completions');
      const body = JSON.parse(String(init.body)) as {
        messages: Array<{ role: string; content: string }>;
        max_tokens: number;
      };
      expect(body.messages[0]?.role).toBe('user');
      expect(body.messages[0]?.content).toContain('Korean');
      expect(body.max_tokens).toBeGreaterThan(0);
      return jsonResponse({ choices: [{ message: { content: 'Hello.' } }] });
    });
    const result = await translateChunk(makeSettings({ provider: 'llamacpp' }), koreanRequest);
    expect(result).toBe('Hello.');
  });

  it('still supports the gateway provider', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        translation: 'Hello.',
        detected_source_lang: 'ko',
        model: 'test',
        attempts: 1,
        warnings: [],
      }),
    );
    const result = await translateChunk(makeSettings({ provider: 'gateway' }), koreanRequest);
    expect(result).toBe('Hello.');
    expect(fetchMock.mock.calls[0]?.[0]).toBe('http://127.0.0.1:8000/translate');
  });

  it('sends the glossary to the direct provider and applies the safety-net replacement', async () => {
    const glossary: GlossaryEntry[] = [
      { source: '冒険者', target: '모험가' },
      { source: '魔法使い', target: '마법사' },
    ];
    fetchMock.mockImplementation(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as { prompt: string };
      expect(body.prompt).toContain('冒険者 -> 모험가');
      expect(body.prompt).toContain('魔法使い -> 마법사');
      return jsonResponse({ response: '모험가와 魔法使い는 여행을 했어.' });
    });
    const result = await translateChunk(makeSettings(), {
      text: '冒険者と魔法使いは旅をした。',
      source_lang: 'ja',
      target_lang: 'ko',
      glossary,
    });
    expect(result).toBe('모험가와 마법사는 여행을 했어.');
  });

  it('sends the glossary to the gateway without double-replacing', async () => {
    const glossary: GlossaryEntry[] = [
      { source: '冒険者', target: '모험가' },
      { source: '魔法使い', target: '마법사' },
    ];
    let capturedBody: Record<string, unknown> | null = null;
    fetchMock.mockImplementation(async (_url: string, init: RequestInit) => {
      capturedBody = JSON.parse(String(init.body)) as Record<string, unknown>;
      return jsonResponse({
        translation: '모험가와 魔法使い는 여행을 했어.',
        detected_source_lang: 'ja',
        model: 'test',
        attempts: 1,
        warnings: [],
      });
    });
    const result = await translateChunk(makeSettings({ provider: 'gateway' }), {
      text: '冒険者と魔法使いは旅をした。',
      source_lang: 'ja',
      target_lang: 'ko',
      glossary,
    });
    expect(result).toBe('모험가와 魔法使い는 여행을 했어.');
    expect(capturedBody).toMatchObject({ glossary });
  });
});

describe('getProviderHealth (direct providers)', () => {
  it('checks Ollama via /api/tags', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      expect(url).toBe('http://127.0.0.1:11434/api/tags');
      return jsonResponse({ models: [{ name: 'hy-mt:1.5b' }] });
    });
    const health = await getProviderHealth(makeSettings());
    expect(health).toMatchObject({ status: 'ok', runtime: 'ollama', model: 'hy-mt:1.5b' });
  });

  it('checks llama.cpp via /health', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      expect(url).toBe('http://127.0.0.1:8080/health');
      return new Response('ok', { status: 200 });
    });
    const health = await getProviderHealth(makeSettings({ provider: 'llamacpp' }));
    expect(health).toMatchObject({ status: 'ok', runtime: 'llamacpp' });
  });

  it('reports failure when Ollama is unreachable', async () => {
    fetchMock.mockRejectedValue(new TypeError('failed to fetch'));
    await expect(getProviderHealth(makeSettings())).rejects.toBeInstanceOf(Error);
  });
});
