import { beforeEach, describe, expect, it } from 'vitest';
import { collectBlocks } from '../src/content/text-node-collector';
import { pageState } from '../src/content/page-state';
import type { TranslationRecord } from '../src/shared/types';

function containerWith(html: string): HTMLElement {
  const container = document.createElement('div');
  container.id = 'c';
  container.innerHTML = html;
  document.body.appendChild(container);
  return container;
}

const defaultOptions = { maxChars: 1200, excludedSelectors: [] as string[] };

beforeEach(() => {
  document.body.innerHTML = '';
  pageState.clear();
});

describe('collectBlocks', () => {
  it('skips script, style, pre and code content', () => {
    const container = containerWith(`
      <p>Hello <strong>world</strong></p>
      <script>var x = 1;</script>
      <style>p { color: red }</style>
      <pre>keep me? no</pre>
      <code>code()</code>
    `);
    const blocks = collectBlocks(container, defaultOptions);
    const all = blocks.map((block) => block.text).join('|');
    expect(all).toContain('Hello');
    expect(all).toContain('world');
    expect(all).not.toContain('var x');
    expect(all).not.toContain('keep me');
    expect(all).not.toContain('code()');
  });

  it('skips whitespace-only text nodes', () => {
    const container = containerWith('<p>   </p><p>Real text</p>');
    const blocks = collectBlocks(container, defaultOptions);
    expect(blocks.length).toBe(1);
    expect(blocks[0]?.text).toBe('Real text');
  });

  it('skips contenteditable and aria-hidden subtrees', () => {
    const container = containerWith(`
      <p>Visible text</p>
      <div contenteditable="true"><p>Editable</p></div>
      <div aria-hidden="true"><p>Hidden</p></div>
    `);
    const blocks = collectBlocks(container, defaultOptions);
    const all = blocks.map((block) => block.text).join('|');
    expect(all).toContain('Visible');
    expect(all).not.toContain('Editable');
    expect(all).not.toContain('Hidden');
  });

  it('respects excluded selectors', () => {
    const container = containerWith(`
      <p>Keep this</p>
      <div class="ads"><p>Skip this ad</p></div>
    `);
    const blocks = collectBlocks(container, { maxChars: 1200, excludedSelectors: ['.ads'] });
    const all = blocks.map((block) => block.text).join('|');
    expect(all).toContain('Keep');
    expect(all).not.toContain('Skip this ad');
  });

  it('skips nodes already marked as translated', () => {
    const container = containerWith('<p>Already done</p>');
    const node = container.querySelector('p')?.firstChild as Text;
    const record: TranslationRecord = {
      node,
      originalText: 'Already done',
      translatedText: '이미 완료',
      status: 'translated',
    };
    pageState.add(node, record);
    const blocks = collectBlocks(container, defaultOptions);
    expect(blocks.length).toBe(0);
  });

  it('chunks a long paragraph into multiple blocks', () => {
    const sentence = '이것은 아주 긴 문장입니다. ';
    const container = containerWith(`<p>${sentence.repeat(40)}</p>`);
    const blocks = collectBlocks(container, { maxChars: 200, excludedSelectors: [] });
    expect(blocks.length).toBeGreaterThan(1);
    expect(blocks.every((block) => block.text.length <= 200)).toBe(true);
  });

  it('translates nested inline formatting nodes independently', () => {
    const container = containerWith('<p>Hello <strong>bold</strong> world</p>');
    const blocks = collectBlocks(container, defaultOptions);
    const texts = blocks.map((block) => block.text);
    expect(texts).toContain('Hello ');
    expect(texts).toContain('bold');
    expect(texts).toContain(' world');
  });

  it('combines direct text children of a block into one unit', () => {
    const container = containerWith('<p>Hello world</p>');
    const blocks = collectBlocks(container, defaultOptions);
    expect(blocks.length).toBe(1);
    expect(blocks[0]?.text).toBe('Hello world');
    expect(blocks[0]?.nodes.length).toBe(1);
  });
});
