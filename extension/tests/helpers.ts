import { vi } from 'vitest';

export type ChromeMock = {
  sendMessage: ReturnType<typeof vi.fn>;
  listeners: Array<(message: unknown, sender: unknown, sendResponse: (response: unknown) => void) => void>;
};

export function installChromeMock(): ChromeMock {
  const listeners: ChromeMock['listeners'] = [];
  const sendMessage = vi.fn(async () => ({ type: 'RESULT_OK' }));
  const chromeMock = {
    runtime: {
      onMessage: {
        addListener: (listener: ChromeMock['listeners'][number]) => {
          listeners.push(listener);
        },
      },
      sendMessage,
    },
  };
  (globalThis as unknown as Record<string, unknown>).chrome = chromeMock;
  return { sendMessage, listeners };
}
