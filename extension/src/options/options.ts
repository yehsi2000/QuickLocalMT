import {
  addDomainRule,
  deleteDomainRule,
  deleteSiteGlossary,
  loadSettings,
  saveSettings,
  updateDomainRule,
  upsertSiteGlossary,
} from '../background/settings';
import { clearHistory, exportHistoryJsonl, getHistory } from '../background/history';
import { isValidGatewayUrl, isValidSelector, normalizeGlossary } from '../shared/validation';
import type { DomainRule, ExtensionSettings, GlossaryEntry, ProviderKind } from '../shared/types';

function byId<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`Missing element #${id}`);
  }
  return element as T;
}

const providerSelect = byId<HTMLSelectElement>('provider');
const gatewayUrlInput = byId<HTMLInputElement>('gateway-url');
const ollamaUrlInput = byId<HTMLInputElement>('ollama-url');
const ollamaModelInput = byId<HTMLInputElement>('ollama-model');
const llamacppUrlInput = byId<HTMLInputElement>('llamacpp-url');
const llamacppModelInput = byId<HTMLInputElement>('llamacpp-model');
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
const glossaryList = byId<HTMLDivElement>('glossary-list');
const addGlossaryBtn = byId<HTMLButtonElement>('add-glossary');
const glossaryEditor = byId<HTMLElement>('glossary-editor');
const glossaryEditorTitle = byId<HTMLElement>('glossary-editor-title');
const glossaryHost = byId<HTMLInputElement>('glossary-host');
const glossaryText = byId<HTMLTextAreaElement>('glossary-text');
const glossaryCount = byId<HTMLSpanElement>('glossary-count');
const glossaryErrors = byId<HTMLDivElement>('glossary-errors');
const glossarySaveBtn = byId<HTMLButtonElement>('glossary-save');
const glossaryDeleteBtn = byId<HTMLButtonElement>('glossary-delete');
const glossaryCancelBtn = byId<HTMLButtonElement>('glossary-cancel');
const glossaryMsg = byId<HTMLDivElement>('glossary-msg');
const exportHistoryBtn = byId<HTMLButtonElement>('export-history');
const clearHistoryBtn = byId<HTMLButtonElement>('clear-history');
const historyMsg = byId<HTMLSpanElement>('history-msg');
const tabButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('.tab'));
const tabPanels = Array.from(document.querySelectorAll<HTMLElement>('.tab-panel'));

let settings: ExtensionSettings = {
  provider: 'gateway',
  gatewayBaseUrl: 'http://127.0.0.1:8000',
  ollamaBaseUrl: 'http://127.0.0.1:11434',
  ollamaModel: 'hy-mt:1.5b',
  llamacppBaseUrl: 'http://127.0.0.1:8080',
  llamacppModel: '',
  defaultSourceLang: 'auto',
  defaultTargetLang: 'en',
  concurrency: 2,
  textChunkMaxChars: 1200,
  autoUseSavedRule: false,
  domainRules: [],
  siteGlossaries: [],
};
let editingRuleId: string | null = null;
let editingGlossaryHostname: string | null = null;

function switchTab(name: string): void {
  for (const button of tabButtons) {
    button.classList.toggle('active', button.dataset.tab === name);
  }
  for (const panel of tabPanels) {
    panel.classList.toggle('active', panel.id === `tab-${name}`);
  }
}

for (const button of tabButtons) {
  button.addEventListener('click', () => switchTab(button.dataset.tab ?? 'general'));
}

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

const MAX_GLOSSARY_TERM_LENGTH = 200;

function findSeparator(line: string): number {
  const asciiIdx = line.indexOf('->');
  const unicodeIdx = line.indexOf('→');
  if (asciiIdx < 0) {
    return unicodeIdx;
  }
  if (unicodeIdx < 0) {
    return asciiIdx;
  }
  return Math.min(asciiIdx, unicodeIdx);
}

export function parseGlossaryText(text: string): { entries: GlossaryEntry[]; errors: string[] } {
  const entries: GlossaryEntry[] = [];
  const errors: string[] = [];
  const lines = text.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith('#')) {
      continue;
    }
    const sepIndex = findSeparator(line);
    if (sepIndex < 0) {
      errors.push(`Line ${index + 1}: expected "source -> target"`);
      continue;
    }
    const source = line.slice(0, sepIndex).trim();
    const target = line
      .slice(sepIndex + (line.startsWith('->', sepIndex) ? 2 : 1))
      .trim();
    if (source.length === 0 || target.length === 0) {
      errors.push(`Line ${index + 1}: source and target are both required`);
      continue;
    }
    if (source.length > MAX_GLOSSARY_TERM_LENGTH || target.length > MAX_GLOSSARY_TERM_LENGTH) {
      errors.push(`Line ${index + 1}: terms must be at most ${MAX_GLOSSARY_TERM_LENGTH} characters`);
      continue;
    }
    entries.push({ source, target });
  }
  return { entries, errors };
}

function updateGlossaryPreview(): void {
  const parsed = parseGlossaryText(glossaryText.value);
  const normalized = normalizeGlossary(parsed.entries);
  const count = normalized.length;
  glossaryCount.textContent = `${count} term${count === 1 ? '' : 's'}`;
  glossaryErrors.textContent = parsed.errors.slice(0, 8).join('\n');
}

function downloadBlob(filename: string, content: string, type: string): void {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
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

function renderGlossaries(): void {
  glossaryList.textContent = '';
  if (settings.siteGlossaries.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = 'No vocabulary yet. Add one per site and it is applied whenever that site is translated.';
    glossaryList.appendChild(empty);
    return;
  }
  for (const site of settings.siteGlossaries) {
    const row = document.createElement('div');
    row.className = 'rule';
    const info = document.createElement('div');
    info.className = 'rule-info';
    const host = document.createElement('div');
    host.className = 'host';
    host.textContent = site.hostname;
    const meta = document.createElement('div');
    meta.className = 'meta';
    meta.textContent = `${site.glossary.length} term${site.glossary.length === 1 ? '' : 's'}`;
    info.append(host, meta);
    const actions = document.createElement('div');
    actions.className = 'rule-actions';
    const editBtn = document.createElement('button');
    editBtn.textContent = 'Edit';
    editBtn.addEventListener('click', () => openGlossaryEditor(site.hostname));
    const deleteBtn = document.createElement('button');
    deleteBtn.textContent = 'Delete';
    deleteBtn.className = 'danger';
    deleteBtn.addEventListener('click', () => {
      if (window.confirm(`Delete vocabulary for ${site.hostname}?`)) {
        void deleteSiteGlossary(site.hostname).then(loadAndRender);
      }
    });
    actions.append(editBtn, deleteBtn);
    row.append(info, actions);
    glossaryList.appendChild(row);
  }
}

function openGlossaryEditor(hostname: string | null): void {
  editingGlossaryHostname = hostname;
  const site = hostname
    ? settings.siteGlossaries.find((entry) => entry.hostname === hostname)
    : undefined;
  glossaryEditor.classList.add('open');
  glossaryEditorTitle.textContent = hostname ? `Edit vocabulary — ${hostname}` : 'New vocabulary';
  glossaryHost.value = hostname ?? '';
  glossaryText.value = (site?.glossary ?? []).map((entry) => `${entry.source} -> ${entry.target}`).join('\n');
  updateGlossaryPreview();
  glossaryDeleteBtn.style.display = hostname ? 'inline-block' : 'none';
  glossaryMsg.textContent = '';
  glossaryMsg.className = 'msg';
}

function closeGlossaryEditor(): void {
  glossaryEditor.classList.remove('open');
  editingGlossaryHostname = null;
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

function toggleProviderFields(): void {
  for (const kind of ['gateway', 'ollama', 'llamacpp'] as const) {
    const fields = document.getElementById(`provider-fields-${kind}`);
    if (fields) {
      fields.classList.toggle('active', providerSelect.value === kind);
    }
  }
}

function fillGeneralForm(): void {
  providerSelect.value = settings.provider;
  gatewayUrlInput.value = settings.gatewayBaseUrl;
  ollamaUrlInput.value = settings.ollamaBaseUrl;
  ollamaModelInput.value = settings.ollamaModel;
  llamacppUrlInput.value = settings.llamacppBaseUrl;
  llamacppModelInput.value = settings.llamacppModel;
  concurrencyInput.value = String(settings.concurrency);
  chunkSizeInput.value = String(settings.textChunkMaxChars);
  defaultSourceSelect.value = settings.defaultSourceLang;
  defaultTargetSelect.value = settings.defaultTargetLang;
  autoRuleCheckbox.checked = settings.autoUseSavedRule;
  toggleProviderFields();
}

async function loadAndRender(): Promise<void> {
  settings = await loadSettings();
  fillGeneralForm();
  renderRules();
  renderGlossaries();
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
  const provider = providerSelect.value as ProviderKind;
  const gatewayUrl = gatewayUrlInput.value.trim() || 'http://127.0.0.1:8000';
  const ollamaUrl = ollamaUrlInput.value.trim() || 'http://127.0.0.1:11434';
  const llamacppUrl = llamacppUrlInput.value.trim() || 'http://127.0.0.1:8080';
  if (!isValidGatewayUrl(gatewayUrl) || !isValidGatewayUrl(ollamaUrl) || !isValidGatewayUrl(llamacppUrl)) {
    flashMessage(saveMsg, 'Provider URLs must be valid http(s) URLs.', 'err');
    return;
  }
  settings = await saveSettings({
    provider,
    gatewayBaseUrl: gatewayUrl,
    ollamaBaseUrl: ollamaUrl,
    ollamaModel: ollamaModelInput.value.trim() || 'hy-mt:1.5b',
    llamacppBaseUrl: llamacppUrl,
    llamacppModel: llamacppModelInput.value.trim(),
    concurrency,
    textChunkMaxChars: chunkSize,
    defaultSourceLang: defaultSourceSelect.value as ExtensionSettings['defaultSourceLang'],
    defaultTargetLang: defaultTargetSelect.value as ExtensionSettings['defaultTargetLang'],
    autoUseSavedRule: autoRuleCheckbox.checked,
  });
  flashMessage(saveMsg, 'Settings saved.', 'ok');
});

providerSelect.addEventListener('change', toggleProviderFields);

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

addGlossaryBtn.addEventListener('click', () => openGlossaryEditor(null));

glossarySaveBtn.addEventListener('click', async () => {
  const hostname = glossaryHost.value.trim().toLowerCase();
  if (!hostname) {
    flashMessage(glossaryMsg, 'Hostname is required.', 'err');
    return;
  }
  const parsed = parseGlossaryText(glossaryText.value);
  if (parsed.errors.length > 0) {
    flashMessage(glossaryMsg, 'Fix vocabulary errors before saving.', 'err');
    return;
  }
  await upsertSiteGlossary(hostname, normalizeGlossary(parsed.entries));
  closeGlossaryEditor();
  await loadAndRender();
});

glossaryDeleteBtn.addEventListener('click', async () => {
  if (!editingGlossaryHostname) {
    return;
  }
  await deleteSiteGlossary(editingGlossaryHostname);
  closeGlossaryEditor();
  await loadAndRender();
});

glossaryCancelBtn.addEventListener('click', closeGlossaryEditor);

glossaryText.addEventListener('input', updateGlossaryPreview);

exportHistoryBtn.addEventListener('click', async () => {
  const entries = await getHistory();
  if (entries.length === 0) {
    flashMessage(historyMsg, 'No history to export.', 'err');
    return;
  }
  downloadBlob('translation-history.jsonl', exportHistoryJsonl(entries), 'application/x-ndjson');
  flashMessage(historyMsg, `Exported ${entries.length} entries.`, 'ok');
});

clearHistoryBtn.addEventListener('click', async () => {
  if (!window.confirm('Clear all translation history? This cannot be undone.')) {
    return;
  }
  await clearHistory();
  flashMessage(historyMsg, 'History cleared.', 'ok');
});

void loadAndRender();
