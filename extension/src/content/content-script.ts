import { DomTranslator } from './dom-translator';
import { startPicker } from './element-picker';
import { generateSelector } from './selector-generator';
import { pageState } from './page-state';
import { findRuleForUrl, hostnameFromUrl, loadSettings } from '../background/settings';
import {
  hideConfirm,
  hideProgress,
  showConfirm,
  showError,
  showProgress,
} from './inline-ui';
import { isExtensionMessage, type ExtensionMessage } from '../shared/messages';
import { truncateForPreview } from '../shared/text-utils';

const GLOBAL_FLAG = '__local_selector_translator_loaded__';

function boot(): void {
  if ((window as unknown as Record<string, unknown>)[GLOBAL_FLAG]) {
    return;
  }
  (window as unknown as Record<string, unknown>)[GLOBAL_FLAG] = true;

  const hostname = hostnameFromUrl(location.href);
  const translator = new DomTranslator({
    onProgress: (completed, total, failed) => {
      showProgress({ completed, total, failed });
      void chrome.runtime
        .sendMessage({
          type: 'TRANSLATION_PROGRESS',
          requestId: translator.requestId ?? '',
          completed,
          total,
          failed,
        })
        .catch(() => undefined);
    },
    onComplete: (completed, failed) => {
      hideProgress();
      void chrome.runtime
        .sendMessage({
          type: 'TRANSLATION_COMPLETE',
          requestId: translator.requestId ?? '',
          completed,
          failed,
        })
        .catch(() => undefined);
      if (failed > 0) {
        showError(`${failed} text block(s) could not be translated. Original text was kept.`);
      } else if (completed === 0) {
        showError('No translatable text found in the selected area.');
      }
    },
    onError: (message) => {
      hideProgress();
      showError(message);
    },
  });

  async function startPickerFlow(): Promise<void> {
    const element = await startPicker();
    if (!element) {
      void chrome.runtime.sendMessage({ type: 'PICKER_CANCELLED' }).catch(() => undefined);
      return;
    }
    const generated = generateSelector(element);
    const settings = await loadSettings();
    const confirm = await showConfirm({
      selector: generated.selector,
      previewText: truncateForPreview(element.textContent ?? '', 140),
      matches: generated.matches,
      defaultSourceLang: settings.defaultSourceLang,
      defaultTargetLang: settings.defaultTargetLang,
    });
    if (confirm.action === 'cancel') {
      void chrome.runtime.sendMessage({ type: 'PICKER_CANCELLED' }).catch(() => undefined);
      return;
    }
    const { sourceLang, targetLang } = confirm;
    void chrome.runtime
      .sendMessage({
        type: 'ELEMENT_SELECTED',
        selector: generated.selector,
        previewText: truncateForPreview(element.textContent ?? '', 140),
        hostname,
      })
      .catch(() => undefined);
    if (confirm.action === 'save_translate') {
      await chrome.runtime.sendMessage({
        type: 'SAVE_RULE',
        rule: {
          hostname,
          selector: generated.selector,
          excludedSelectors: [],
          sourceLang: sourceLang === 'auto' ? undefined : sourceLang,
          targetLang,
          enabled: true,
        },
      });
    }
    await chrome.runtime.sendMessage({
      type: 'TRANSLATE_SELECTOR',
      selector: generated.selector,
      sourceLang,
      targetLang,
    });
  }

  async function runTranslation(message: Extract<ExtensionMessage, { type: 'START_TRANSLATION' }>): Promise<void> {
    hideConfirm();
    const settings = await loadSettings();
    const rule = findRuleForUrl(settings.domainRules, location.href);
    const result = await translator.start(
      message.requestId,
      message.selector,
      message.sourceLang,
      message.targetLang,
      {
        maxChars: settings.textChunkMaxChars,
        excludedSelectors: rule?.excludedSelectors ?? [],
      },
    );
    if ('error' in result) {
      hideProgress();
    }
  }

  chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
    if (!isExtensionMessage(message)) {
      return;
    }
    switch (message.type) {
      case 'PING':
        sendResponse({ type: 'PONG' });
        return;
      case 'START_ELEMENT_PICKER':
        void startPickerFlow();
        sendResponse({ type: 'RESULT_OK' });
        return;
      case 'START_TRANSLATION':
        void runTranslation(message);
        sendResponse({ type: 'RESULT_OK' });
        return;
      case 'TRANSLATION_RESULT':
        translator.applyResult(message.requestId, message.blockId, message);
        sendResponse({ type: 'RESULT_OK' });
        return;
      case 'RESTORE_ORIGINAL': {
        const restored = translator.restore();
        hideConfirm();
        hideProgress();
        sendResponse({ type: 'RESULT_OK', restored });
        return;
      }
      case 'CANCEL_TRANSLATION':
        translator.cancel();
        hideConfirm();
        hideProgress();
        sendResponse({ type: 'RESULT_OK' });
        return;
      case 'GET_PAGE_STATE': {
        const progress = translator.progress;
        sendResponse({
          type: 'PAGE_STATE',
          translated: pageState.count() > 0,
          inProgress: translator.isRunning,
          total: progress.total,
          completed: progress.completed,
          failed: progress.failed,
          selector: null,
          rule: null,
        });
        return;
      }
      default:
        sendResponse({ type: 'RESULT_OK' });
    }
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
  boot();
}
