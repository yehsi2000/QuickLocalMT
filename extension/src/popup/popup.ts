import { loadSettings } from '../background/settings';
import { isExtensionMessage, type ExtensionMessage } from '../shared/messages';
import type { DomainRule } from '../shared/types';

function byId<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`Missing element #${id}`);
  }
  return element as T;
}

const statusEl = byId<HTMLDivElement>('status');
const sourceSelect = byId<HTMLSelectElement>('source-lang');
const targetSelect = byId<HTMLSelectElement>('target-lang');
const selectAreaBtn = byId<HTMLButtonElement>('select-area');
const translateSavedBtn = byId<HTMLButtonElement>('translate-saved');
const toggleViewBtn = byId<HTMLButtonElement>('restore');
const cancelBtn = byId<HTMLButtonElement>('cancel');
const progressEl = byId<HTMLParagraphElement>('progress');
const optionsLink = byId<HTMLAnchorElement>('open-options');

let gatewayConnected = false;
let gatewayError: string | null = null;
let pageRules: DomainRule[] = [];
let running = false;
let hasCache = false;
let viewMode: 'original' | 'translated' = 'translated';

async function sendMessage(message: ExtensionMessage): Promise<unknown> {
  try {
    return await chrome.runtime.sendMessage(message);
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Extension error' };
  }
}

function setStatus(connected: boolean, label: string): void {
  statusEl.className = `status ${connected ? 'ok' : 'down'}`;
  statusEl.textContent = label;
  statusEl.title = gatewayError ?? '';
}

function renderProgress(completed: number, total: number, failed: number): void {
  progressEl.classList.remove('hidden');
  progressEl.textContent =
    total > 0
      ? `${completed} / ${total} blocks translated${failed > 0 ? ` · ${failed} failed` : ''}`
      : 'No text blocks found.';
}

function setRunning(isRunning: boolean): void {
  running = isRunning;
  updateButtons();
}

function updateButtons(): void {
  selectAreaBtn.disabled = running;
  translateSavedBtn.disabled = running || !gatewayConnected || pageRules.length === 0;
  toggleViewBtn.disabled = running || !hasCache;
  toggleViewBtn.textContent = viewMode === 'translated' ? 'Show original' : 'Show translation';
  cancelBtn.disabled = !running;
}

async function refresh(): Promise<void> {
  const settings = await loadSettings();
  sourceSelect.value = settings.defaultSourceLang;
  targetSelect.value = settings.defaultTargetLang;

  const [statusResponse, stateResponse] = (await Promise.all([
    sendMessage({ type: 'GATEWAY_STATUS_REQUEST' }),
    sendMessage({ type: 'GET_PAGE_STATE' }),
  ])) as [ExtensionMessage | undefined, ExtensionMessage | undefined];

  if (statusResponse && statusResponse.type === 'GATEWAY_STATUS') {
    gatewayConnected = statusResponse.connected;
    gatewayError = statusResponse.error ?? null;
    if (statusResponse.connected && statusResponse.health) {
      setStatus(true, `${statusResponse.health.runtime} · ${statusResponse.health.model}`);
    } else {
      setStatus(false, 'Gateway offline');
    }
  } else {
    gatewayConnected = false;
    setStatus(false, 'Gateway offline');
  }

  if (stateResponse && stateResponse.type === 'PAGE_STATE') {
    pageRules = stateResponse.rules;
    running = stateResponse.inProgress;
    hasCache = stateResponse.hasCache;
    viewMode = stateResponse.viewMode;
    if (running) {
      renderProgress(stateResponse.completed, stateResponse.total, stateResponse.failed);
    } else {
      progressEl.classList.add('hidden');
    }
    if (stateResponse.rules.length > 0) {
      translateSavedBtn.textContent =
        stateResponse.rules.length === 1
          ? `Translate saved area (${stateResponse.rules[0]?.hostname ?? ''})`
          : `Translate saved area (${stateResponse.rules.length} sections)`;
    } else {
      translateSavedBtn.textContent = 'Translate saved area';
    }
  }
  updateButtons();
}

selectAreaBtn.addEventListener('click', () => {
  void sendMessage({ type: 'START_PICKER' });
  window.close();
});

translateSavedBtn.addEventListener('click', async () => {
  if (pageRules.length === 0) {
    return;
  }
  const firstRule = pageRules[0] as DomainRule;
  const sourceLang = firstRule.sourceLang ?? sourceSelect.value;
  const targetLang = firstRule.targetLang ?? targetSelect.value;
  await sendMessage({
    type: 'TRANSLATE_SELECTOR',
    selectors: pageRules.map((rule) => rule.selector),
    sourceLang,
    targetLang,
    useSavedRules: true,
  });
  setRunning(true);
  renderProgress(0, 1, 0);
});

toggleViewBtn.addEventListener('click', async () => {
  const response = (await sendMessage({ type: 'TOGGLE_VIEW' })) as
    | { viewMode?: 'original' | 'translated'; hasCache?: boolean }
    | undefined;
  viewMode = response?.viewMode ?? (viewMode === 'translated' ? 'original' : 'translated');
  hasCache = response?.hasCache ?? hasCache;
  updateButtons();
});

cancelBtn.addEventListener('click', async () => {
  await sendMessage({ type: 'CANCEL' });
  setRunning(false);
  progressEl.classList.add('hidden');
});

optionsLink.addEventListener('click', (event) => {
  event.preventDefault();
  void sendMessage({ type: 'OPEN_OPTIONS' });
  window.close();
});

chrome.runtime.onMessage.addListener((message: unknown) => {
  if (!isExtensionMessage(message)) {
    return;
  }
  if (message.type === 'TRANSLATION_PROGRESS') {
    renderProgress(message.completed, message.total, message.failed);
    setRunning(true);
  } else if (message.type === 'TRANSLATION_COMPLETE') {
    renderProgress(message.completed, message.completed + message.failed, message.failed);
    setRunning(false);
    hasCache = hasCache || message.completed > 0;
    viewMode = 'translated';
    updateButtons();
  }
});

void refresh();
