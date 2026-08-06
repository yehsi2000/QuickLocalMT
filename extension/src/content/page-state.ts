import type { TranslationRecord } from '../shared/types';

const records = new WeakMap<Text, TranslationRecord>();
let knownNodes: Text[] = [];

export const pageState = {
  add(node: Text, record: TranslationRecord): void {
    records.set(node, record);
    knownNodes.push(node);
  },
  get(node: Text): TranslationRecord | undefined {
    return records.get(node);
  },
  isRecorded(node: Text): boolean {
    return records.has(node);
  },
  isTranslated(node: Text): boolean {
    return records.get(node)?.status === 'translated';
  },
  all(): TranslationRecord[] {
    return knownNodes
      .map((node) => records.get(node))
      .filter((record): record is TranslationRecord => record !== undefined);
  },
  count(): number {
    return knownNodes.length;
  },
  clear(): void {
    knownNodes = [];
  },
};
