import { getProviderHealth, translateChunk } from './api-client';
import { addHistoryEntry } from './history';
import { TranslationQueue, type QueueResult, type QueueSummary } from './translation-queue';
import {
  addDomainRule,
  findRulesForUrl,
  hostnameFromUrl,
  loadSettings,
  siteGlossaryForHostname,
} from './settings';
import { isExtensionMessage, type ExtensionMessage } from '../shared/messages';
import type { GlossaryEntry } from '../shared/types';

type SessionState = {
  status: 'idle' | 'running';
  requestId: string | null;
  selector: string | null;
  total: number;
  completed: number;
  failed: number;
  translated: boolean;
};

const sessions = new Map<number, SessionState>();
const queues = new Map<number, TranslationQueue>();

function emptySession(): SessionState {
  return {
    status: 'idle',
    requestId: null,
    selector: null,
    total: 0,
    completed: 0,
    failed: 0,
    translated: false,
  };
}

function sessionForTab(tabId: number): SessionState {
  let session = sessions.get(tabId);
  if (!session) {
    session = emptySession();
    sessions.set(tabId, session);
  }
  return session;
}

function broadcast(message: ExtensionMessage): void {
  void chrome.runtime.sendMessage(message).catch(() => undefined);
}

async function getActiveTab(): Promise<chrome.tabs.Tab & { id: number }> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    throw new Error('No active tab available');
  }
  return tab as chrome.tabs.Tab & { id: number };
}

async function ensureContentScript(tabId: number): Promise<void> {
  try {
    const response = (await chrome.tabs.sendMessage(tabId, { type: 'PING' })) as ExtensionMessage | undefined;
    if (response && response.type === 'PONG') {
      return;
    }
  } catch {
    // Content script is not injected yet.
  }
  await chrome.scripting.executeScript({ target: { tabId }, files: ['content-script.js'] });
}

function queueForTab(
  tabId: number,
  settings: Awaited<ReturnType<typeof loadSettings>>,
  glossary: GlossaryEntry[],
  hostname: string,
): TranslationQueue {
  let queue = queues.get(tabId);
  if (!queue) {
    queue = new TranslationQueue({
      concurrency: settings.concurrency,
      translate: (text, sourceLang, targetLang, signal) =>
        translateChunk(
          settings,
          {
            text,
            source_lang: sourceLang,
            target_lang: targetLang,
            preset: 'translation-default',
            ...(glossary.length > 0 ? { glossary } : {}),
          },
          signal,
        ),
      onResult: (result: QueueResult) => {
        const message: ExtensionMessage = {
          type: 'TRANSLATION_RESULT',
          requestId: sessionForTab(tabId).requestId ?? '',
          blockId: result.blockId,
          ...(result.ok
            ? { translation: result.translation }
            : { error: result.error }),
        };
        void chrome.tabs.sendMessage(tabId, message).catch(() => undefined);
        if (result.ok && hostname.length > 0) {
          void addHistoryEntry({
            ts: new Date().toISOString(),
            hostname,
            source_lang: result.sourceLang,
            target_lang: result.targetLang,
            source_text: result.sourceText,
            translation: result.translation,
          });
        }
      },
      onComplete: (summary: QueueSummary) => {
        const session = sessionForTab(tabId);
        session.total = summary.total;
        session.completed = summary.completed;
        session.failed = summary.failed;
        session.status = 'idle';
        session.translated = summary.completed > 0;
        queues.delete(tabId);
      },
    });
    queues.set(tabId, queue);
  }
  return queue;
}

async function handleMessage(
  message: unknown,
  sender: chrome.runtime.MessageSender,
): Promise<unknown> {
  if (!isExtensionMessage(message)) {
    return undefined;
  }
  switch (message.type) {
    case 'START_PICKER': {
      const tab = await getActiveTab();
      await ensureContentScript(tab.id);
      await chrome.tabs.sendMessage(tab.id, { type: 'START_ELEMENT_PICKER' });
      return { type: 'RESULT_OK' };
    }

    case 'TRANSLATE_SELECTOR': {
      const tabId = sender.tab?.id ?? (await getActiveTab()).id;
      await ensureContentScript(tabId);
      const requestId = crypto.randomUUID();
      const session = sessionForTab(tabId);
      session.status = 'running';
      session.requestId = requestId;
      session.selector = message.selectors[0] ?? null;
      session.total = 0;
      session.completed = 0;
      session.failed = 0;
      await chrome.tabs.sendMessage(tabId, {
        type: 'START_TRANSLATION',
        requestId,
        selectors: message.selectors,
        sourceLang: message.sourceLang,
        targetLang: message.targetLang,
        useSavedRules: message.useSavedRules ?? false,
      });
      return { type: 'RESULT_OK', requestId };
    }

    case 'CANCEL': {
      const tab = await getActiveTab();
      queues.get(tab.id)?.cancel();
      queues.delete(tab.id);
      const session = sessionForTab(tab.id);
      const oldRequestId = session.requestId;
      session.status = 'idle';
      session.requestId = null;
      session.total = 0;
      session.completed = 0;
      session.failed = 0;
      await ensureContentScript(tab.id);
      await chrome.tabs
        .sendMessage(tab.id, {
          type: 'CANCEL_TRANSLATION',
          requestId: oldRequestId ?? '',
        } as ExtensionMessage)
        .catch(() => undefined);
      return { type: 'RESULT_OK' };
    }

    case 'RESTORE': {
      const tab = await getActiveTab();
      await ensureContentScript(tab.id);
      const response = (await chrome.tabs.sendMessage(tab.id, {
        type: 'RESTORE_ORIGINAL',
      })) as { restored: number } | undefined;
      const session = sessionForTab(tab.id);
      session.translated = false;
      session.status = 'idle';
      session.requestId = null;
      session.selector = null;
      session.total = 0;
      session.completed = 0;
      session.failed = 0;
      return { type: 'RESULT_OK', restored: response?.restored ?? 0 };
    }

    case 'OPEN_OPTIONS': {
      void chrome.runtime.openOptionsPage();
      return { type: 'RESULT_OK' };
    }

    case 'GATEWAY_STATUS_REQUEST': {
      const settings = await loadSettings();
      try {
        const health = await getProviderHealth(settings);
        return { type: 'GATEWAY_STATUS', connected: true, health };
      } catch (error) {
        return {
          type: 'GATEWAY_STATUS',
          connected: false,
          error: error instanceof Error ? error.message : 'Translation provider unavailable',
        };
      }
    }

    case 'GET_PAGE_STATE': {
      const tab = await getActiveTab();
      const settings = await loadSettings();
      const session = sessionForTab(tab.id);
      const rules = findRulesForUrl(settings.domainRules, tab.url ?? '');
      let pageState: ExtensionMessage = {
        type: 'PAGE_STATE',
        translated: session.translated,
        inProgress: session.status === 'running',
        total: session.total,
        completed: session.completed,
        failed: session.failed,
        selector: session.selector,
        rules,
      };
      try {
        await ensureContentScript(tab.id);
        const contentState = (await chrome.tabs.sendMessage(tab.id, {
          type: 'GET_PAGE_STATE',
        })) as ExtensionMessage | undefined;
        if (contentState && contentState.type === 'PAGE_STATE') {
          pageState = {
            type: 'PAGE_STATE',
            translated: contentState.translated,
            inProgress: contentState.inProgress,
            total: contentState.total,
            completed: contentState.completed,
            failed: contentState.failed,
            selector: contentState.selector ?? session.selector,
            rules,
          };
        }
      } catch {
        // Content script unavailable; fall back to service worker session state.
      }
      return pageState;
    }

    case 'TRANSLATE_BLOCKS': {
      if (!sender.tab?.id) {
        return { type: 'RESULT_OK' };
      }
      const tabId = sender.tab.id;
      const settings = await loadSettings();
      const hostname = hostnameFromUrl(sender.tab.url ?? '');
      const glossary = siteGlossaryForHostname(settings.siteGlossaries, hostname);
      const queue = queueForTab(tabId, settings, glossary, hostname);
      queue.runSession(
        message.blocks.map((block) => ({
          requestId: message.requestId,
          blockId: block.id,
          text: block.text,
          sourceLang: message.sourceLang,
          targetLang: message.targetLang,
        })),
      );
      return { type: 'RESULT_OK' };
    }

    case 'TRANSLATION_PROGRESS': {
      if (sender.tab?.id) {
        const session = sessionForTab(sender.tab.id);
        session.status = 'running';
        session.total = message.total;
        session.completed = message.completed;
        session.failed = message.failed;
        broadcast(message);
      }
      return { type: 'RESULT_OK' };
    }

    case 'TRANSLATION_COMPLETE': {
      if (sender.tab?.id) {
        const session = sessionForTab(sender.tab.id);
        session.status = 'idle';
        session.total = message.completed + message.failed;
        session.completed = message.completed;
        session.failed = message.failed;
        session.translated = message.completed > 0;
        broadcast(message);
      }
      return { type: 'RESULT_OK' };
    }

    case 'ELEMENT_SELECTED':
    case 'PICKER_CANCELLED': {
      broadcast(message);
      return { type: 'RESULT_OK' };
    }

    case 'SAVE_RULE': {
      const created = await addDomainRule(message.rule);
      return { type: 'RESULT_OK', rule: created };
    }

    default:
      return { type: 'RESULT_OK' };
  }
}

chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
  void handleMessage(message, sender).then(
    (result) => sendResponse(result),
    (error) =>
      sendResponse({
        type: 'RESULT_OK',
        error: error instanceof Error ? error.message : 'Extension error',
      }),
  );
  return true;
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'loading') {
    sessions.delete(tabId);
    queues.get(tabId)?.cancel();
    queues.delete(tabId);
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  sessions.delete(tabId);
  queues.get(tabId)?.cancel();
  queues.delete(tabId);
});
