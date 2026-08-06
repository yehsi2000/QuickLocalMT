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

export class DomTranslator {
  private currentRequestId: string | null = null;
  private blocks: InternalBlock[] = [];
  private blocksById = new Map<string, InternalBlock>();
  private totalCount = 0;
  private completedCount = 0;
  private failedCount = 0;

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

  cancel(): void {
    this.invalidate();
  }

  async start(
    requestId: string,
    selector: string,
    sourceLang: string,
    targetLang: string,
    options: CollectOptions,
  ): Promise<{ total: number } | { error: string }> {
    this.invalidate();
    this.restoreRecords();
    pageState.clear();
    const element = document.querySelector(selector);
    if (!element) {
      this.events.onError('The saved selector matched no elements on this page.');
      return { error: 'SELECTOR_NO_MATCH' };
    }
    const collected = collectBlocks(element, options);
    if (collected.length === 0) {
      this.events.onComplete(0, 0);
      return { total: 0 };
    }
    this.currentRequestId = requestId;
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
    return { total: collected.length };
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

  restore(): number {
    const count = this.restoreRecords();
    pageState.clear();
    this.invalidate();
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
