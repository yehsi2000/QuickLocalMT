import { GatewayApiError, GatewayConnectionError, GatewayTimeoutError } from './api-client';
import type { BlockError } from '../shared/types';

export type QueueJob = {
  requestId: string;
  blockId: string;
  text: string;
  sourceLang: string;
  targetLang: string;
};

export type TranslateFunction = (
  text: string,
  sourceLang: string,
  targetLang: string,
  signal?: AbortSignal,
) => Promise<string>;

export type QueueResult =
  | {
      ok: true;
      blockId: string;
      translation: string;
      sourceText: string;
      sourceLang: string;
      targetLang: string;
    }
  | { ok: false; blockId: string; error: BlockError };

export type QueueSummary = {
  total: number;
  completed: number;
  failed: number;
};

const RETRY_DELAY_MS = 500;

function toBlockError(error: unknown): BlockError {
  if (error instanceof GatewayTimeoutError) {
    return { code: 'TIMEOUT', message: 'Gateway request timed out' };
  }
  if (error instanceof GatewayApiError) {
    return { code: error.code, message: error.message };
  }
  if (error instanceof GatewayConnectionError) {
    return { code: 'GATEWAY_UNREACHABLE', message: 'Unable to reach the local gateway' };
  }
  return { code: 'UNKNOWN', message: error instanceof Error ? error.message : 'Unknown error' };
}

function isRetriable(error: unknown): boolean {
  if (error instanceof GatewayTimeoutError || error instanceof GatewayConnectionError) {
    return true;
  }
  if (error instanceof GatewayApiError) {
    if (error.status >= 500) {
      return true;
    }
    return ['REPETITIVE_OUTPUT', 'INVALID_RESPONSE', 'EMPTY_OUTPUT', 'OUTPUT_TOO_LONG', 'MODEL_TIMEOUT'].includes(
      error.code,
    );
  }
  return false;
}

export class TranslationQueue {
  private readonly concurrency: number;
  private readonly translate: TranslateFunction;
  private readonly onResult: (result: QueueResult) => void;
  private readonly onComplete: (summary: QueueSummary) => void;

  private pending: QueueJob[] = [];
  private active = new Map<string, Promise<void>>();
  private running = false;
  private aborted = false;
  private abortController: AbortController | null = null;
  private completedCount = 0;
  private failedCount = 0;
  private totalCount = 0;

  constructor(options: {
    concurrency: number;
    translate: TranslateFunction;
    onResult: (result: QueueResult) => void;
    onComplete: (summary: QueueSummary) => void;
  }) {
    this.concurrency = Math.max(1, options.concurrency);
    this.translate = options.translate;
    this.onResult = options.onResult;
    this.onComplete = options.onComplete;
  }

  get activeCount(): number {
    return this.active.size;
  }

  get isRunning(): boolean {
    return this.running;
  }

  runSession(jobs: QueueJob[]): void {
    this.cancel();
    this.abortController = new AbortController();
    this.pending = jobs.slice();
    this.totalCount = jobs.length;
    this.completedCount = 0;
    this.failedCount = 0;
    this.aborted = false;
    this.running = true;
    if (jobs.length === 0) {
      this.running = false;
      this.onComplete({ total: 0, completed: 0, failed: 0 });
      return;
    }
    void this.pump();
  }

  cancel(): void {
    this.aborted = true;
    this.running = false;
    this.pending = [];
    this.abortController?.abort();
    this.abortController = null;
  }

  private async pump(): Promise<void> {
    while (!this.aborted && (this.pending.length > 0 || this.active.size > 0)) {
      while (!this.aborted && this.pending.length > 0 && this.active.size < this.concurrency) {
        const job = this.pending.shift();
        if (!job) {
          break;
        }
        const task = this.processJob(job).finally(() => {
          this.active.delete(job.blockId);
        });
        this.active.set(job.blockId, task);
      }
      if (this.pending.length > 0 && this.active.size > 0) {
        await Promise.race(this.active.values());
      } else if (this.active.size > 0) {
        await Promise.allSettled(this.active.values());
      }
    }
    if (!this.aborted && this.active.size === 0) {
      this.running = false;
      this.onComplete({
        total: this.totalCount,
        completed: this.completedCount,
        failed: this.failedCount,
      });
    }
  }

  private async attemptTranslate(job: QueueJob): Promise<string> {
    return this.translate(job.text, job.sourceLang, job.targetLang, this.abortController?.signal);
  }

  private async processJob(job: QueueJob): Promise<void> {
    const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
    const okResult = (translation: string): QueueResult => ({
      ok: true,
      blockId: job.blockId,
      translation,
      sourceText: job.text,
      sourceLang: job.sourceLang,
      targetLang: job.targetLang,
    });
    try {
      const translation = await this.attemptTranslate(job);
      if (this.aborted) {
        return;
      }
      this.completedCount += 1;
      this.onResult(okResult(translation));
    } catch (error) {
      if (this.aborted) {
        return;
      }
      if (isRetriable(error)) {
        await delay(RETRY_DELAY_MS);
        try {
          const translation = await this.attemptTranslate(job);
          if (this.aborted) {
            return;
          }
          this.completedCount += 1;
          this.onResult(okResult(translation));
        } catch (retryError) {
          if (this.aborted) {
            return;
          }
          this.failedCount += 1;
          this.onResult({ ok: false, blockId: job.blockId, error: toBlockError(retryError) });
        }
      } else {
        this.failedCount += 1;
        this.onResult({ ok: false, blockId: job.blockId, error: toBlockError(error) });
      }
    }
  }
}
