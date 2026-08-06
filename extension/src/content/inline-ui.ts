const UI_ATTR = 'data-lst-ui';

export type ConfirmOptions = {
  selector: string;
  previewText: string;
  matches: number;
  defaultSourceLang: string;
  defaultTargetLang: string;
};

export type ConfirmResult = {
  action: 'translate' | 'save_translate' | 'cancel';
  sourceLang: string;
  targetLang: string;
};

let rootEl: HTMLElement | null = null;
let shadow: ShadowRoot | null = null;

const STYLES = `
  :host { all: initial; position: fixed; top: 16px; right: 16px; z-index: 2147483646; }
  * { box-sizing: border-box; }
  .card {
    width: 320px;
    background: #ffffff;
    color: #0f172a;
    font: 13px/1.5 system-ui, sans-serif;
    border: 1px solid #cbd5e1;
    border-radius: 10px;
    box-shadow: 0 8px 28px rgba(0,0,0,0.25);
    padding: 12px;
  }
  .title { font-weight: 600; font-size: 13px; margin-bottom: 8px; }
  .row { margin-bottom: 8px; }
  .label { display: block; font-size: 11px; color: #475569; margin-bottom: 2px; }
  input, select {
    width: 100%;
    font: 12px/1.4 system-ui, sans-serif;
    padding: 5px 7px;
    border: 1px solid #cbd5e1;
    border-radius: 6px;
    background: #fff;
    color: #0f172a;
  }
  .preview {
    background: #f1f5f9;
    border-radius: 6px;
    padding: 6px 8px;
    font-size: 12px;
    color: #334155;
    max-height: 64px;
    overflow: hidden;
  }
  .warn { color: #b45309; font-size: 11px; margin-top: 4px; }
  .langs { display: flex; gap: 8px; }
  .langs > div { flex: 1; }
  .actions { display: flex; gap: 6px; margin-top: 10px; }
  button {
    flex: 1;
    font: 12px/1.4 system-ui, sans-serif;
    padding: 6px 8px;
    border-radius: 6px;
    border: 1px solid #cbd5e1;
    background: #fff;
    color: #0f172a;
    cursor: pointer;
  }
  button.primary { background: #2563eb; border-color: #2563eb; color: #fff; }
  button.danger { background: #ef4444; border-color: #ef4444; color: #fff; }
  .progress-card {
    width: 260px;
    background: #ffffff;
    color: #0f172a;
    font: 13px/1.5 system-ui, sans-serif;
    border: 1px solid #cbd5e1;
    border-radius: 10px;
    box-shadow: 0 8px 28px rgba(0,0,0,0.25);
    padding: 10px 12px;
  }
  .bar { height: 6px; border-radius: 3px; background: #e2e8f0; margin-top: 6px; overflow: hidden; }
  .bar > div { height: 100%; background: #2563eb; border-radius: 3px; transition: width 0.2s; }
  .meta { font-size: 11px; color: #475569; margin-top: 4px; }
  .toast {
    background: #b91c1c;
    color: #fff;
    font: 13px/1.5 system-ui, sans-serif;
    border-radius: 8px;
    padding: 10px 14px;
    box-shadow: 0 8px 28px rgba(0,0,0,0.25);
    max-width: 320px;
  }
`;

function ensureRoot(): ShadowRoot {
  if (rootEl && shadow) {
    return shadow;
  }
  rootEl = document.createElement('div');
  rootEl.setAttribute(UI_ATTR, '');
  const hostShadow = rootEl.attachShadow({ mode: 'closed' });
  const style = document.createElement('style');
  style.textContent = STYLES;
  hostShadow.appendChild(style);
  document.documentElement.appendChild(rootEl);
  shadow = hostShadow;
  return hostShadow;
}

function clearContainer(): void {
  const hostShadow = ensureRoot();
  for (const child of Array.from(hostShadow.children)) {
    if (child.tagName !== 'STYLE') {
      child.remove();
    }
  }
}

export function isUiOverlayNode(node: Node): boolean {
  if (node.nodeType === Node.TEXT_NODE) {
    return node.parentElement?.closest(`[${UI_ATTR}]`) !== null;
  }
  if (node.nodeType === Node.ELEMENT_NODE) {
    return (node as Element).closest(`[${UI_ATTR}]`) !== null;
  }
  return false;
}

export function showConfirm(options: ConfirmOptions): Promise<ConfirmResult> {
  const hostShadow = ensureRoot();
  clearContainer();
  const card = document.createElement('div');
  card.className = 'card';
  card.innerHTML = `
    <div class="title">Translate selected area</div>
    <div class="row">
      <span class="label">CSS selector</span>
      <input type="text" class="selector" spellcheck="false">
    </div>
    <div class="preview"></div>
    <div class="warn"></div>
    <div class="row langs">
      <div>
        <span class="label">Source</span>
        <select class="src">
          <option value="auto">Auto</option>
          <option value="ko">Korean</option>
          <option value="en">English</option>
          <option value="ja">Japanese</option>
        </select>
      </div>
      <div>
        <span class="label">Target</span>
        <select class="target">
          <option value="ko">Korean</option>
          <option value="en">English</option>
          <option value="ja">Japanese</option>
        </select>
      </div>
    </div>
    <div class="actions">
      <button class="cancel">Cancel</button>
      <button class="save">Save &amp; translate</button>
      <button class="primary translate">Translate</button>
    </div>
  `;

  const selectorInput = card.querySelector('.selector') as HTMLInputElement;
  const preview = card.querySelector('.preview') as HTMLDivElement;
  const warn = card.querySelector('.warn') as HTMLDivElement;
  const srcSelect = card.querySelector('.src') as HTMLSelectElement;
  const targetSelect = card.querySelector('.target') as HTMLSelectElement;

  selectorInput.value = options.selector;
  preview.textContent = options.previewText;
  if (options.matches > 1) {
    warn.textContent = `Warning: selector matches ${options.matches} elements. Refine it if this looks wrong.`;
  }
  srcSelect.value = options.defaultSourceLang;
  targetSelect.value = options.defaultTargetLang;

  hostShadow.appendChild(card);

  return new Promise((resolve) => {
    function finish(action: 'translate' | 'save_translate' | 'cancel'): void {
      card.remove();
      resolve({
        action,
        sourceLang: srcSelect.value,
        targetLang: targetSelect.value,
      });
    }
    card.querySelector('.translate')?.addEventListener('click', () => finish('translate'));
    card.querySelector('.save')?.addEventListener('click', () => finish('save_translate'));
    card.querySelector('.cancel')?.addEventListener('click', () => finish('cancel'));
  });
}

export function hideConfirm(): void {
  clearContainer();
}

export function showProgress(progress: { completed: number; total: number; failed: number }): void {
  const hostShadow = ensureRoot();
  clearContainer();
  const card = document.createElement('div');
  card.className = 'progress-card';
  const percent =
    progress.total > 0 ? Math.min(100, Math.round((progress.completed / progress.total) * 100)) : 0;
  card.innerHTML = `
    <div>Translating…</div>
    <div class="bar"><div style="width:${percent}%"></div></div>
    <div class="meta">${progress.completed} / ${progress.total} blocks${
      progress.failed > 0 ? ` · ${progress.failed} failed` : ''
    }</div>
  `;
  hostShadow.appendChild(card);
}

export function hideProgress(): void {
  clearContainer();
}

export function showError(message: string, timeoutMs: number = 6000): void {
  const hostShadow = ensureRoot();
  clearContainer();
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;
  hostShadow.appendChild(toast);
  window.setTimeout(() => {
    toast.remove();
  }, timeoutMs);
}
