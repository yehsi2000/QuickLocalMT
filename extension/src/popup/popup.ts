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
const restoreBtn = byId<HTMLButtonElement>('restore');
const cancelBtn = byId<HTMLButtonElement>('cancel');
const progressEl = byId<HTMLParagraphElement>('progress');
const optionsLink = byId<HTMLAnchorElement>('open-options');

let gatewayConnected = false;
let gatewayError: string | null = null;
let pageRule: DomainRule | null = null;
let running = false;
let translated = false;

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
  translateSavedBtn.disabled = running || !gatewayConnected || pageRule === null;
  restoreBtn.disabled = running || !translated;
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
    pageRule = stateResponse.rule;
    running = stateResponse.inProgress;
    translated = stateResponse.translated;
    if (running) {
      renderProgress(stateResponse.completed, stateResponse.total, stateResponse.failed);
    } else {
      progressEl.classList.add('hidden');
    }
    if (stateResponse.rule) {
      translateSavedBtn.textContent = `Translate saved area (${stateResponse.rule.hostname})`;
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
  if (!pageRule) {
    return;
  }
  const sourceLang = pageRule.sourceLang ?? sourceSelect.value;
  const targetLang = pageRule.targetLang ?? targetSelect.value;
  await sendMessage({
    type: 'TRANSLATE_SELECTOR',
    selector: pageRule.selector,
    sourceLang,
    targetLang,
  });
  setRunning(true);
  renderProgress(0, 1, 0);
});

restoreBtn.addEventListener('click', async () => {
  await sendMessage({ type: 'RESTORE' });
  translated = false;
  progressEl.classList.add('hidden');
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
    translated = message.completed > 0;
  }
});

void refresh();
