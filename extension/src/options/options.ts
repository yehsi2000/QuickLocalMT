import {
  addDomainRule,
  deleteDomainRule,
  loadSettings,
  saveSettings,
  updateDomainRule,
} from '../background/settings';
import { isValidSelector } from '../shared/validation';
import type { DomainRule, ExtensionSettings } from '../shared/types';

function byId<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`Missing element #${id}`);
  }
  return element as T;
}

const gatewayUrlInput = byId<HTMLInputElement>('gateway-url');
const concurrencyInput = byId<HTMLInputElement>('concurrency');
const chunkSizeInput = byId<HTMLInputElement>('chunk-size');
const defaultSourceSelect = byId<HTMLSelectElement>('default-source');
const defaultTargetSelect = byId<HTMLSelectElement>('default-target');
const autoRuleCheckbox = byId<HTMLInputElement>('auto-rule');
const saveGeneralBtn = byId<HTMLButtonElement>('save-general');
const saveMsg = byId<HTMLSpanElement>('save-msg');
const rulesList = byId<HTMLDivElement>('rules-list');
const addRuleBtn = byId<HTMLButtonElement>('add-rule');
const editor = byId<HTMLElement>('editor');
const editorTitle = byId<HTMLElement>('editor-title');
const ruleHost = byId<HTMLInputElement>('rule-host');
const rulePath = byId<HTMLInputElement>('rule-path');
const ruleSelector = byId<HTMLInputElement>('rule-selector');
const ruleExcluded = byId<HTMLInputElement>('rule-excluded');
const ruleSource = byId<HTMLSelectElement>('rule-source');
const ruleTarget = byId<HTMLSelectElement>('rule-target');
const ruleSaveBtn = byId<HTMLButtonElement>('rule-save');
const ruleTestBtn = byId<HTMLButtonElement>('rule-test');
const ruleDeleteBtn = byId<HTMLButtonElement>('rule-delete');
const ruleCancelBtn = byId<HTMLButtonElement>('rule-cancel');
const ruleMsg = byId<HTMLDivElement>('rule-msg');
const testResult = byId<HTMLDivElement>('test-result');

let settings: ExtensionSettings = {
  gatewayBaseUrl: 'http://127.0.0.1:8000',
  defaultSourceLang: 'auto',
  defaultTargetLang: 'en',
  concurrency: 2,
  textChunkMaxChars: 1200,
  autoUseSavedRule: false,
  domainRules: [],
};
let editingRuleId: string | null = null;

function flashMessage(element: HTMLElement, message: string, kind: 'ok' | 'err'): void {
  element.textContent = message;
  element.className = `msg ${kind}`;
  window.setTimeout(() => {
    if (element.textContent === message) {
      element.textContent = '';
      element.className = 'msg';
    }
  }, 3000);
}

function renderRules(): void {
  rulesList.textContent = '';
  if (settings.domainRules.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = 'No saved rules yet. Select an area on a page and choose "Save & translate".';
    rulesList.appendChild(empty);
    return;
  }
  for (const rule of settings.domainRules) {
    const row = document.createElement('div');
    row.className = 'rule';
    const info = document.createElement('div');
    info.className = 'rule-info';
    const host = document.createElement('div');
    host.className = 'host';
    host.textContent = rule.enabled ? rule.hostname : `${rule.hostname} (disabled)`;
    const code = document.createElement('code');
    code.textContent = rule.selector;
    const meta = document.createElement('div');
    meta.className = 'meta';
    const sourceLang = rule.sourceLang ?? settings.defaultSourceLang;
    const targetLang = rule.targetLang ?? settings.defaultTargetLang;
    meta.textContent = `${rule.pathPattern ?? 'all paths'} · ${sourceLang} → ${targetLang}${rule.excludedSelectors.length > 0 ? ` · excludes ${rule.excludedSelectors.length}` : ''}`;
    info.append(host, code, meta);
    const actions = document.createElement('div');
    actions.className = 'rule-actions';
    const toggleBtn = document.createElement('button');
    toggleBtn.className = `toggle${rule.enabled ? '' : ' off'}`;
    toggleBtn.textContent = rule.enabled ? 'Disable' : 'Enable';
    toggleBtn.addEventListener('click', () => {
      void updateDomainRule(rule.id, { enabled: !rule.enabled }).then(loadAndRender);
    });
    const editBtn = document.createElement('button');
    editBtn.textContent = 'Edit';
    editBtn.addEventListener('click', () => openEditor(rule));
    const testBtn = document.createElement('button');
    testBtn.textContent = 'Test';
    testBtn.addEventListener('click', () => void runTest(rule.selector));
    const deleteBtn = document.createElement('button');
    deleteBtn.textContent = 'Delete';
    deleteBtn.className = 'danger';
    deleteBtn.addEventListener('click', () => {
      if (window.confirm(`Delete rule for ${rule.hostname}?`)) {
        void deleteDomainRule(rule.id).then(loadAndRender);
      }
    });
    actions.append(toggleBtn, editBtn, testBtn, deleteBtn);
    row.append(info, actions);
    rulesList.appendChild(row);
  }
}

function openEditor(rule: DomainRule | null): void {
  editingRuleId = rule?.id ?? null;
  editor.classList.add('open');
  editorTitle.textContent = rule ? `Edit rule — ${rule.hostname}` : 'New rule';
  ruleHost.value = rule?.hostname ?? '';
  rulePath.value = rule?.pathPattern ?? '';
  ruleSelector.value = rule?.selector ?? '';
  ruleExcluded.value = rule?.excludedSelectors.join(', ') ?? '';
  ruleSource.value = rule?.sourceLang ?? '';
  ruleTarget.value = rule?.targetLang ?? '';
  ruleDeleteBtn.style.display = rule ? 'inline-block' : 'none';
  testResult.textContent = '';
  testResult.style.display = 'none';
}

function closeEditor(): void {
  editor.classList.remove('open');
  editingRuleId = null;
}

async function runTest(selector: string): Promise<void> {
  testResult.style.display = 'block';
  testResult.textContent = 'Testing…';
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) {
      testResult.textContent = 'No active tab available.';
      return;
    }
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: (sel: string) => {
        try {
          const elements = document.querySelectorAll(sel);
          const first = elements[0];
          return {
            matches: elements.length,
            preview: first ? (first.textContent ?? '').trim().slice(0, 80) : '',
          };
        } catch (error) {
          return { error: error instanceof Error ? error.message : 'Invalid selector' };
        }
      },
      args: [selector],
    });
    const result = results[0]?.result;
    if (result && typeof result === 'object' && 'error' in result) {
      testResult.textContent = String(result.error);
    } else if (result) {
      testResult.textContent = `Matches: ${result.matches}${result.preview ? ` · Preview: "${result.preview}"` : ''}`;
    } else {
      testResult.textContent = 'No result returned.';
    }
  } catch (error) {
    testResult.textContent =
      error instanceof Error
        ? `Cannot access the active page (${error.message}). Open the popup once and click Select area to grant access, then retry.`
        : 'Test failed.';
  }
}

function fillGeneralForm(): void {
  gatewayUrlInput.value = settings.gatewayBaseUrl;
  concurrencyInput.value = String(settings.concurrency);
  chunkSizeInput.value = String(settings.textChunkMaxChars);
  defaultSourceSelect.value = settings.defaultSourceLang;
  defaultTargetSelect.value = settings.defaultTargetLang;
  autoRuleCheckbox.checked = settings.autoUseSavedRule;
}

async function loadAndRender(): Promise<void> {
  settings = await loadSettings();
  fillGeneralForm();
  renderRules();
}

saveGeneralBtn.addEventListener('click', async () => {
  const concurrency = Number(concurrencyInput.value);
  const chunkSize = Number(chunkSizeInput.value);
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 4) {
    flashMessage(saveMsg, 'Concurrency must be an integer between 1 and 4.', 'err');
    return;
  }
  if (!Number.isInteger(chunkSize) || chunkSize < 200 || chunkSize > 8000) {
    flashMessage(saveMsg, 'Chunk size must be between 200 and 8000.', 'err');
    return;
  }
  settings = await saveSettings({
    gatewayBaseUrl: gatewayUrlInput.value.trim() || 'http://127.0.0.1:8000',
    concurrency,
    textChunkMaxChars: chunkSize,
    defaultSourceLang: defaultSourceSelect.value as ExtensionSettings['defaultSourceLang'],
    defaultTargetLang: defaultTargetSelect.value as ExtensionSettings['defaultTargetLang'],
    autoUseSavedRule: autoRuleCheckbox.checked,
  });
  flashMessage(saveMsg, 'Settings saved.', 'ok');
});

addRuleBtn.addEventListener('click', () => openEditor(null));

ruleSaveBtn.addEventListener('click', async () => {
  const hostname = ruleHost.value.trim().toLowerCase();
  const selector = ruleSelector.value.trim();
  if (!hostname) {
    flashMessage(ruleMsg, 'Hostname is required.', 'err');
    return;
  }
  if (!isValidSelector(selector)) {
    flashMessage(ruleMsg, 'Enter a valid CSS selector.', 'err');
    return;
  }
  const base = {
    hostname,
    pathPattern: rulePath.value.trim() || undefined,
    selector,
    excludedSelectors: ruleExcluded.value
      .split(',')
      .map((item) => item.trim())
      .filter((item) => item.length > 0),
    sourceLang: (ruleSource.value || undefined) as DomainRule['sourceLang'],
    targetLang: (ruleTarget.value || undefined) as DomainRule['targetLang'],
    enabled: true,
  };
  if (editingRuleId) {
    await updateDomainRule(editingRuleId, base);
  } else {
    await addDomainRule(base);
  }
  closeEditor();
  await loadAndRender();
});

ruleTestBtn.addEventListener('click', () => {
  void runTest(ruleSelector.value.trim());
});

ruleDeleteBtn.addEventListener('click', async () => {
  if (!editingRuleId) {
    return;
  }
  await deleteDomainRule(editingRuleId);
  closeEditor();
  await loadAndRender();
});

ruleCancelBtn.addEventListener('click', closeEditor);

void loadAndRender();
