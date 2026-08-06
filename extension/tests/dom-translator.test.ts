import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DomTranslator } from '../src/content/dom-translator';
import { pageState } from '../src/content/page-state';
import { installChromeMock } from './helpers';

function setupPage(html: string, containerId = 'article'): HTMLElement {
  const container = document.createElement('div');
  container.id = containerId;
  container.innerHTML = html;
  document.body.appendChild(container);
  return container;
}

beforeEach(() => {
  document.body.innerHTML = '';
  pageState.clear();
  vi.restoreAllMocks();
});

describe('DomTranslator', () => {
  it('translates blocks, applies results, and restores originals exactly', async () => {
    const chrome = installChromeMock();
    setupPage('<p>Hello world</p>');
    const events = { completed: 0, failed: 0, errors: [] as string[], progress: [] as number[][] };
    const translator = new DomTranslator({
      onProgress: (completed, total, failed) => events.progress.push([completed, total, failed]),
      onComplete: (completed, failed) => {
        events.completed = completed;
        events.failed = failed;
      },
      onError: (message) => events.errors.push(message),
    });

    const started = await translator.start('req-1', '#article', 'ko', 'en', {
      maxChars: 1200,
      excludedSelectors: [],
    });
    expect(started).toEqual({ total: 1 });

    const sentMessage = chrome.sendMessage.mock.calls[0]?.[0] as {
      type: string;
      blocks: Array<{ id: string; text: string }>;
    };
    expect(sentMessage.type).toBe('TRANSLATE_BLOCKS');
    expect(sentMessage.blocks[0]?.text).toBe('Hello world');

    const blockId = sentMessage.blocks[0]?.id as string;
    const applied = translator.applyResult('req-1', blockId, { translation: '안녕하세요 세계' });
    expect(applied).toBe(true);

    const paragraph = document.querySelector('p') as HTMLParagraphElement;
    expect(paragraph.textContent).toBe('안녕하세요 세계');
    expect(events.completed).toBe(1);
    expect(events.failed).toBe(0);

    const restored = translator.restore();
    expect(restored).toBe(1);
    expect(paragraph.textContent).toBe('Hello world');
    expect(pageState.count()).toBe(0);
  });

  it('ignores stale results from a previous request', async () => {
    const chrome = installChromeMock();
    setupPage('<p>Hello world</p>');
    const translator = new DomTranslator({
      onProgress: () => undefined,
      onComplete: () => undefined,
      onError: () => undefined,
    });

    await translator.start('req-1', '#article', 'ko', 'en', { maxChars: 1200, excludedSelectors: [] });
    const sentMessage = chrome.sendMessage.mock.calls[0]?.[0] as { blocks: Array<{ id: string; text: string }> };
    const blockId = sentMessage.blocks[0]?.id as string;

    const applied = translator.applyResult('stale-request-id', blockId, { translation: 'BAD' });
    expect(applied).toBe(false);
    expect(document.querySelector('p')?.textContent).toBe('Hello world');
  });

  it('keeps original text when a block fails', async () => {
    const chrome = installChromeMock();
    setupPage('<p>Hello world</p><p>Second line</p>');
    const events = { failed: 0 };
    const translator = new DomTranslator({
      onProgress: () => undefined,
      onComplete: (_completed, failed) => {
        events.failed = failed;
      },
      onError: () => undefined,
    });

    await translator.start('req-1', '#article', 'ko', 'en', { maxChars: 1200, excludedSelectors: [] });
    const sentMessage = chrome.sendMessage.mock.calls[0]?.[0] as { blocks: Array<{ id: string; text: string }> };
    const blockIds = sentMessage.blocks.map((block: { id: string }) => block.id);

    translator.applyResult('req-1', blockIds[0] as string, { error: { code: 'TIMEOUT', message: 'timed out' } });
    translator.applyResult('req-1', blockIds[1] as string, { translation: '두 번째 줄' });

    const paragraphs = document.querySelectorAll('p');
    expect(paragraphs[0]?.textContent).toBe('Hello world');
    expect(paragraphs[1]?.textContent).toBe('두 번째 줄');
    expect(events.failed).toBe(1);
  });

  it('reports a selector that matches nothing', async () => {
    installChromeMock();
    setupPage('<p>Hello</p>');
    const errors: string[] = [];
    const translator = new DomTranslator({
      onProgress: () => undefined,
      onComplete: () => undefined,
      onError: (message) => errors.push(message),
    });
    const result = await translator.start('req-1', '#missing', 'ko', 'en', {
      maxChars: 1200,
      excludedSelectors: [],
    });
    expect('error' in result && result.error).toBe('SELECTOR_NO_MATCH');
    expect(errors.length).toBe(1);
  });
});
