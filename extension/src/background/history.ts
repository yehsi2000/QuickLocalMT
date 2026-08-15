export type TranslationHistoryEntry = {
  ts: string;
  hostname: string;
  source_lang: string;
  target_lang: string;
  source_text: string;
  translation: string;
};

const HISTORY_KEY = 'translationHistory';
const HISTORY_CAP = 2000;

export async function addHistoryEntry(entry: TranslationHistoryEntry): Promise<void> {
  try {
    const stored = await chrome.storage.local.get(HISTORY_KEY);
    const existing = Array.isArray(stored[HISTORY_KEY])
      ? (stored[HISTORY_KEY] as TranslationHistoryEntry[])
      : [];
    const next = [...existing, entry];
    if (next.length > HISTORY_CAP) {
      next.splice(0, next.length - HISTORY_CAP);
    }
    await chrome.storage.local.set({ [HISTORY_KEY]: next });
  } catch {
    // History writes must never break translation.
  }
}

export async function getHistory(): Promise<TranslationHistoryEntry[]> {
  const stored = await chrome.storage.local.get(HISTORY_KEY);
  return Array.isArray(stored[HISTORY_KEY])
    ? (stored[HISTORY_KEY] as TranslationHistoryEntry[])
    : [];
}

export async function clearHistory(): Promise<void> {
  await chrome.storage.local.remove(HISTORY_KEY);
}

export function exportHistoryJsonl(entries: TranslationHistoryEntry[]): string {
  return entries.map((entry) => JSON.stringify(entry)).join('\n');
}
