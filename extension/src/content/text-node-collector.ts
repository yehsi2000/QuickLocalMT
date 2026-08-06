import type { TranslationBlock } from '../shared/types';
import { chunkText, isWhitespaceOnly } from '../shared/text-utils';
import { pageState } from './page-state';

export const SKIP_TAGS = new Set([
  'SCRIPT',
  'STYLE',
  'NOSCRIPT',
  'TEMPLATE',
  'SVG',
  'CANVAS',
  'CODE',
  'PRE',
  'KBD',
  'SAMP',
  'TEXTAREA',
  'INPUT',
  'SELECT',
  'OPTION',
  'BUTTON',
]);

export const BLOCK_TAGS = new Set([
  'P',
  'LI',
  'BLOCKQUOTE',
  'FIGCAPTION',
  'H1',
  'H2',
  'H3',
  'H4',
  'H5',
  'H6',
  'TD',
  'TH',
]);

export const OVERLAY_ATTR = 'data-lst-overlay';

export type CollectOptions = {
  maxChars: number;
  excludedSelectors: string[];
};

function isOverlayNode(node: Node): boolean {
  if (node.nodeType === Node.TEXT_NODE) {
    return node.parentElement?.closest('[data-lst-overlay], [data-lst-ui]') !== null;
  }
  if (node.nodeType === Node.ELEMENT_NODE) {
    return (node as Element).closest('[data-lst-overlay], [data-lst-ui]') !== null;
  }
  return false;
}

function isCollectable(node: Text, container: Element, options: CollectOptions): boolean {
  if (isWhitespaceOnly(node.nodeValue)) {
    return false;
  }
  const parent = node.parentElement;
  if (!parent || isOverlayNode(node) || isOverlayNode(parent)) {
    return false;
  }
  let el: Element | null = parent;
  while (el) {
    if (SKIP_TAGS.has(el.tagName)) {
      return false;
    }
    if (el.getAttribute('contenteditable') === 'true') {
      return false;
    }
    if (el.getAttribute('aria-hidden') === 'true') {
      return false;
    }
    if (el === container) {
      break;
    }
    el = el.parentElement;
  }
  if (options.excludedSelectors.length > 0) {
    for (const selector of options.excludedSelectors) {
      if (selector.trim().length > 0 && parent.closest(selector)) {
        return false;
      }
    }
  }
  if (pageState.isTranslated(node)) {
    return false;
  }
  if (parent instanceof HTMLElement) {
    const style = window.getComputedStyle(parent);
    if (style.display === 'none' || style.visibility === 'hidden') {
      return false;
    }
  }
  return true;
}

function blockAncestor(node: Text, container: Element): Element {
  let el = node.parentElement;
  while (el && el !== container) {
    if (BLOCK_TAGS.has(el.tagName)) {
      return el;
    }
    el = el.parentElement;
  }
  return container;
}

function pushChunkedBlocks(
  blocks: TranslationBlock[],
  nodes: Text[],
  text: string,
  maxChars: number,
  nextId: () => number,
): void {
  for (const chunk of chunkText(text, maxChars)) {
    blocks.push({ id: `b${nextId()}`, text: chunk, nodes });
  }
}

export function collectBlocks(container: Element, options: CollectOptions): TranslationBlock[] {
  const blocks: TranslationBlock[] = [];
  const groups = new Map<Element, Text[]>();
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  let node: Node | null = walker.nextNode();
  while (node) {
    const textNode = node as Text;
    if (isCollectable(textNode, container, options)) {
      const blockEl = blockAncestor(textNode, container);
      const list = groups.get(blockEl) ?? [];
      list.push(textNode);
      groups.set(blockEl, list);
    }
    node = walker.nextNode();
  }
  let nextId = 0;
  const id = (): number => nextId++;
  for (const [blockEl, nodes] of groups) {
    const hasNestedFormatting = nodes.some((textNode) => textNode.parentElement !== blockEl);
    const combined = nodes.map((textNode) => textNode.nodeValue ?? '').join('');
    if (nodes.length === 1) {
      pushChunkedBlocks(blocks, nodes, combined, options.maxChars, id);
    } else if (!hasNestedFormatting && combined.length <= options.maxChars) {
      blocks.push({ id: `b${id()}`, text: combined, nodes });
    } else {
      for (const textNode of nodes) {
        pushChunkedBlocks(blocks, [textNode], textNode.nodeValue ?? '', options.maxChars, id);
      }
    }
  }
  return blocks;
}
