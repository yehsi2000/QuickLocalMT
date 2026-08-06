import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TranslationQueue, type QueueJob } from '../src/background/translation-queue';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function makeJobs(count: number): QueueJob[] {
  return Array.from({ length: count }, (_, index) => ({
    requestId: 'req-1',
    blockId: `b${index}`,
    text: `block ${index}`,
    sourceLang: 'ko',
    targetLang: 'en',
  }));
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('TranslationQueue', () => {
  it('limits concurrent requests to the configured concurrency', async () => {
    let active = 0;
    let maxActive = 0;
    fetchMock.mockImplementation(async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await delay(20);
      active -= 1;
      return jsonResponse({
        translation: 'translated',
        detected_source_lang: 'ko',
        model: 'test',
        attempts: 1,
        warnings: [],
      });
    });

    const results: string[] = [];
    let complete = false;
    const queue = new TranslationQueue({
      concurrency: 2,
      baseUrl: 'http://127.0.0.1:8000',
      onResult: (result) => {
        if (result.ok) {
          results.push(result.blockId);
        }
      },
      onComplete: () => {
        complete = true;
      },
    });

    queue.runSession(makeJobs(6));
    await vi.waitFor(() => expect(complete).toBe(true), { timeout: 2000 });

    expect(maxActive).toBeLessThanOrEqual(2);
    expect(results.length).toBe(6);
  });

  it('retries a transient failure once with backoff', async () => {
    let calls = 0;
    fetchMock.mockImplementation(async () => {
      calls += 1;
      if (calls === 1) {
        return jsonResponse({ error: { code: 'UPSTREAM', message: 'nope' } }, 503);
      }
      return jsonResponse({
        translation: 'translated',
        detected_source_lang: 'ko',
        model: 'test',
        attempts: 1,
        warnings: [],
      });
    });

    const results: string[] = [];
    let complete = false;
    const queue = new TranslationQueue({
      concurrency: 2,
      baseUrl: 'http://127.0.0.1:8000',
      onResult: (result) => {
        if (result.ok) {
          results.push(result.blockId);
        }
      },
      onComplete: () => {
        complete = true;
      },
    });

    queue.runSession(makeJobs(1));
    await vi.waitFor(() => expect(complete).toBe(true), { timeout: 2000 });

    expect(calls).toBe(2);
    expect(results.length).toBe(1);
  });

  it('reports failed blocks without stopping the session', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ error: { code: 'BAD_REQUEST', message: 'invalid' } }, 400),
    );

    const failed: string[] = [];
    let complete = false;
    let summaryTotal = 0;
    const queue = new TranslationQueue({
      concurrency: 2,
      baseUrl: 'http://127.0.0.1:8000',
      onResult: (result) => {
        if (!result.ok) {
          failed.push(result.blockId);
        }
      },
      onComplete: (summary) => {
        complete = true;
        summaryTotal = summary.total;
      },
    });

    queue.runSession(makeJobs(3));
    await vi.waitFor(() => expect(complete).toBe(true), { timeout: 2000 });

    expect(failed.length).toBe(3);
    expect(summaryTotal).toBe(3);
  });

  it('stops remaining work when cancelled', async () => {
    let startCount = 0;
    fetchMock.mockImplementation(async () => {
      startCount += 1;
      await delay(100);
      return jsonResponse({
        translation: 't',
        detected_source_lang: 'ko',
        model: 'test',
        attempts: 1,
        warnings: [],
      });
    });

    const results: string[] = [];
    const queue = new TranslationQueue({
      concurrency: 2,
      baseUrl: 'http://127.0.0.1:8000',
      onResult: (result) => {
        if (result.ok) {
          results.push(result.blockId);
        }
      },
      onComplete: () => undefined,
    });

    queue.runSession(makeJobs(10));
    await wait(30);
    queue.cancel();
    await wait(200);

    expect(results.length).toBeLessThan(10);
    expect(startCount).toBeLessThan(10);
  });

  it('handles an empty job list', async () => {
    let complete = false;
    const queue = new TranslationQueue({
      concurrency: 2,
      baseUrl: 'http://127.0.0.1:8000',
      onResult: () => undefined,
      onComplete: () => {
        complete = true;
      },
    });
    queue.runSession([]);
    await vi.waitFor(() => expect(complete).toBe(true));
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
