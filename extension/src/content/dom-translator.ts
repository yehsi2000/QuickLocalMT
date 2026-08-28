import { collectBlocks, type CollectOptions } from './text-node-collector';
import { pageState } from './page-state';
import type { BlockError, TranslationBlock } from '../shared/types';

export type TranslatorEvents = {
  onProgress: (completed: number, total: number, failed: number) => void;
  onComplete: (completed: number, failed: number) => void;
  onError: (message: string) => void;
};

type InternalBlock = TranslationBlock & {
  originalText: string;
  appliedText: string | null;
};

export type SelectorEntry = {
  selector: string;
  excludedSelectors: string[];
};

type CollectionRoot = {
  element: Element;
  excludedSelectors: string[];
};

export type ViewMode = 'original' | 'translated';

function buildCacheKey(entries: SelectorEntry[], sourceLang: string, targetLang: string): string {
  const areas = entries
    .map((entry) => `${entry.selector}|${[...entry.excludedSelectors].sort().join(',')}`)
    .sort();
  return JSON.stringify([areas, sourceLang, targetLang]);
}

export class DomTranslator {
  private currentRequestId: string | null = null;
  private blocks: InternalBlock[] = [];
  private blocksById = new Map<string, InternalBlock>();
  private totalCount = 0;
  private completedCount = 0;
  private failedCount = 0;
  private viewMode: ViewMode = 'translated';
  private cacheKey: string | null = null;
  private fromCacheCount = 0;

  constructor(private readonly events: TranslatorEvents) {}

  get isRunning(): boolean {
    return this.currentRequestId !== null;
  }

  get requestId(): string | null {
    return this.currentRequestId;
  }

  get progress(): { total: number; completed: number; failed: number } {
    return {
      total: this.totalCount,
      completed: this.completedCount,
      failed: this.failedCount,
    };
  }

  get hasCache(): boolean {
    return pageState.translatedCount() > 0;
  }

  get currentViewMode(): ViewMode {
    return this.viewMode;
  }

  /** Nodes served from cache by the most recent start(); readable from onComplete. */
  get lastRunFromCache(): number {
    return this.fromCacheCount;
  }

  cancel(): void {
    this.invalidate();
  }

  /** Swaps visible text without touching the cache, so it can be swapped back. */
  showOriginal(): number {
    let swapped = 0;
    for (const record of pageState.all()) {
      if (record.node.nodeValue !== record.originalText) {
        record.node.nodeValue = record.originalText;
      }
      swapped += 1;
    }
    this.viewMode = 'original';
    return swapped;
  }

  showTranslation(): number {
    let swapped = 0;
    for (const record of pageState.all()) {
      if (record.status !== 'translated') {
        continue;
      }
      if (record.node.nodeValue !== record.translatedText) {
        record.node.nodeValue = record.translatedText;
      }
      swapped += 1;
    }
    this.viewMode = 'translated';
    return swapped;
  }

  toggleView(): ViewMode {
    if (!this.hasCache) {
      return this.viewMode;
    }
    if (this.viewMode === 'translated') {
      this.showOriginal();
    } else {
      this.showTranslation();
    }
    return this.viewMode;
  }

  async start(
    requestId: string,
    entries: SelectorEntry[],
    sourceLang: string,
    targetLang: string,
    options: Pick<CollectOptions, 'maxChars'>,
  ): Promise<{ total: number; fromCache: number } | { error: string }> {
    this.invalidate();
    if (entries.length === 0) {
      this.hardReset();
      this.events.onError('No translation area selected.');
      return { error: 'SELECTOR_NO_MATCH' };
    }
    const key = buildCacheKey(entries, sourceLang, targetLang);
    // Same area and languages: keep the cached nodes so only new or failed text is sent.
    const reuseCache = key === this.cacheKey && this.hasCache;
    if (reuseCache) {
      this.showTranslation();
    } else {
      this.hardReset();
    }
    this.cacheKey = key;
    const fromCache = reuseCache ? pageState.translatedCount() : 0;
    this.fromCacheCount = fromCache;
    const roots = this.resolveRoots(entries);
    if (roots.length === 0) {
      this.events.onError('The saved selectors matched no elements on this page.');
      return { error: 'SELECTOR_NO_MATCH' };
    }
    const collected = this.collectFromRoots(roots, options.maxChars);
    if (collected.length === 0) {
      this.events.onComplete(fromCache, 0);
      return { total: 0, fromCache };
    }
    this.currentRequestId = requestId;
    this.viewMode = 'translated';
    this.totalCount = collected.length;
    this.completedCount = 0;
    this.failedCount = 0;
    this.blocks = collected.map((block) => ({
      ...block,
      originalText: block.text,
      appliedText: null,
    }));
    this.blocksById = new Map(this.blocks.map((block) => [block.id, block]));
    for (const block of this.blocks) {
      for (const node of block.nodes) {
        if (!pageState.isRecorded(node)) {
          pageState.add(node, {
            node,
            originalText: node.nodeValue ?? '',
            translatedText: '',
            status: 'pending',
          });
        }
      }
    }
    await chrome.runtime.sendMessage({
      type: 'TRANSLATE_BLOCKS',
      requestId,
      blocks: this.blocks.map((block) => ({ id: block.id, text: block.text })),
      sourceLang,
      targetLang,
    });
    return { total: collected.length, fromCache };
  }

  private resolveRoots(entries: SelectorEntry[]): CollectionRoot[] {
    const roots: CollectionRoot[] = [];
    for (const entry of entries) {
      const element = document.querySelector(entry.selector);
      if (!element) {
        continue;
      }
      const covered = roots.some(
        (root) =>
          root.element === element ||
          root.element.contains(element) ||
          element.contains(root.element),
      );
      if (covered) {
        continue;
      }
      roots.push({ element, excludedSelectors: entry.excludedSelectors });
    }
    return roots;
  }

  private collectFromRoots(roots: CollectionRoot[], maxChars: number): TranslationBlock[] {
    const blocks: TranslationBlock[] = [];
    const seenNodes = new Set<Text>();
    for (const root of roots) {
      const collected = collectBlocks(root.element, { maxChars, excludedSelectors: root.excludedSelectors });
      for (const block of collected) {
        const freshNodes = block.nodes.filter((node) => !seenNodes.has(node));
        if (freshNodes.length === 0) {
          continue;
        }
        for (const node of freshNodes) {
          seenNodes.add(node);
        }
        if (freshNodes.length === block.nodes.length) {
          blocks.push(block);
        } else {
          blocks.push({
            id: block.id,
            text: freshNodes.map((node) => node.nodeValue ?? '').join(''),
            nodes: freshNodes,
          });
        }
      }
    }
    return blocks.map((block, index) => ({ ...block, id: `b${index}` }));
  }

  applyResult(
    requestId: string,
    blockId: string,
    result: { translation?: string; error?: BlockError },
  ): boolean {
    if (requestId !== this.currentRequestId) {
      return false;
    }
    const block = this.blocksById.get(blockId);
    if (!block) {
      return false;
    }
    if (typeof result.translation === 'string' && result.translation.length > 0) {
      block.appliedText = result.translation;
      this.completedCount += 1;
      this.applyNodeTexts(block.nodes);
      for (const node of block.nodes) {
        const record = pageState.get(node);
        if (record) {
          record.translatedText = node.nodeValue ?? '';
          record.status = 'translated';
        }
      }
    } else {
      this.failedCount += 1;
      for (const node of block.nodes) {
        const record = pageState.get(node);
        if (record && record.status !== 'translated') {
          record.status = 'failed';
        }
      }
    }
    this.events.onProgress(this.completedCount, this.totalCount, this.failedCount);
    if (this.completedCount + this.failedCount >= this.totalCount) {
      this.currentRequestId = null;
      this.events.onComplete(this.completedCount, this.failedCount);
    }
    return true;
  }

  /** Drops the cache entirely: originals come back and the next run re-translates everything. */
  restore(): number {
    const count = this.hardReset();
    this.invalidate();
    return count;
  }

  private hardReset(): number {
    const count = this.restoreRecords();
    pageState.clear();
    this.cacheKey = null;
    this.viewMode = 'translated';
    this.fromCacheCount = 0;
    return count;
  }

  private applyNodeTexts(nodes: Text[]): void {
    for (const node of nodes) {
      const relevant = this.blocks.filter((block) => block.nodes.includes(node));
      const joined = relevant.map((block) => block.appliedText ?? block.originalText).join('');
      if (node.nodeValue !== joined) {
        node.nodeValue = joined;
      }
    }
  }

  private restoreRecords(): number {
    const records = pageState.all();
    for (const record of records) {
      if (record.node.nodeValue !== record.originalText) {
        record.node.nodeValue = record.originalText;
      }
    }
    return records.length;
  }

  private invalidate(): void {
    this.currentRequestId = null;
    this.blocks = [];
    this.blocksById = new Map();
    this.totalCount = 0;
    this.completedCount = 0;
    this.failedCount = 0;
  }
}
