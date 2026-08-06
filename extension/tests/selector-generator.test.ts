import { beforeEach, describe, expect, it } from 'vitest';
import { generateSelector, isUnstableSelector, validateSelector } from '../src/content/selector-generator';

function setDocumentBody(html: string): void {
  document.body.innerHTML = html;
}

beforeEach(() => {
  setDocumentBody('');
});

describe('generateSelector', () => {
  it('prefers a stable unique id', () => {
    setDocumentBody('<div id="article-content"><p>Hello</p></div>');
    const element = document.getElementById('article-content');
    expect(element).not.toBeNull();
    const result = generateSelector(element as Element);
    expect(result.selector).toBe('#article-content');
    expect(result.exact).toBe(true);
  });

  it('ignores generated-looking ids', () => {
    setDocumentBody('<div id="a1b2c3d4e5f6g7h8"><p>Hello</p></div>');
    const element = document.getElementById('a1b2c3d4e5f6g7h8');
    const result = generateSelector(element as Element);
    expect(result.selector).not.toBe('#a1b2c3d4e5f6g7h8');
  });

  it('builds a class-based path and validates uniqueness', () => {
    setDocumentBody('<article><div class="chapter-content"><p>Text</p></div></article>');
    const element = document.querySelector('.chapter-content');
    const result = generateSelector(element as Element);
    expect(result.selector).toContain('chapter-content');
    expect(validateSelector(result.selector).exact).toBe(true);
  });

  it('falls back to nth-of-type when classes are unstable', () => {
    setDocumentBody(`
      <div>
        <div class="css-1a2b3c"><span>One</span></div>
        <div class="css-4d5e6f"><span>Two</span></div>
      </div>
    `);
    const second = document.querySelectorAll('div')[2] as Element;
    const result = generateSelector(second);
    expect(result.selector).toContain(':nth-of-type');
    expect(validateSelector(result.selector).exact).toBe(true);
  });

  it('resolves to exactly one element on the page', () => {
    setDocumentBody(`
      <main>
        <section class="post"><p>A</p></section>
        <section class="post"><p>B</p></section>
        <section class="post"><p>C</p></section>
      </main>
    `);
    const second = document.querySelectorAll('.post')[1] as Element;
    const result = generateSelector(second);
    expect(result.exact).toBe(true);
    expect(document.querySelectorAll(result.selector).length).toBe(1);
  });
});

describe('validateSelector', () => {
  it('flags empty selectors', () => {
    expect(validateSelector('   ').error).not.toBeNull();
  });

  it('flags invalid syntax', () => {
    expect(validateSelector('div >>>').error).not.toBeNull();
  });

  it('reports match counts', () => {
    setDocumentBody('<p class="x">a</p><p class="x">b</p>');
    const result = validateSelector('.x');
    expect(result.matches).toBe(2);
    expect(result.exact).toBe(false);
  });

  it('accepts a valid unique selector', () => {
    setDocumentBody('<p id="only">a</p>');
    const result = validateSelector('#only');
    expect(result.error).toBeNull();
    expect(result.exact).toBe(true);
  });
});

describe('isUnstableSelector', () => {
  it('flags nth-child chains', () => {
    expect(isUnstableSelector('div:nth-child(4) > span')).toBe(true);
  });

  it('flags generated hashes', () => {
    expect(isUnstableSelector('div.css-1a2b3c')).toBe(true);
  });

  it('accepts stable selectors', () => {
    expect(isUnstableSelector('article .chapter-content')).toBe(false);
  });
});
