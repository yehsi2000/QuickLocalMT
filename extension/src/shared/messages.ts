import type {
  BlockError,
  DomainRule,
  GatewayHealth,
  SerializableBlock,
} from './types';

export type ExtensionMessage =
  | {
      type: 'PING';
    }
  | {
      type: 'PONG';
    }
  | {
      type: 'START_ELEMENT_PICKER';
    }
  | {
      type: 'ELEMENT_SELECTED';
      selector: string;
      previewText: string;
      hostname: string;
    }
  | {
      type: 'PICKER_CANCELLED';
    }
  | {
      type: 'START_TRANSLATION';
      requestId: string;
      selectors: string[];
      sourceLang: string;
      targetLang: string;
      useSavedRules: boolean;
    }
  | {
      type: 'TRANSLATION_PROGRESS';
      requestId: string;
      completed: number;
      total: number;
      failed: number;
    }
  | {
      type: 'TRANSLATION_COMPLETE';
      requestId: string;
      completed: number;
      failed: number;
    }
  | {
      type: 'RESTORE_ORIGINAL';
    }
  | {
      type: 'CANCEL_TRANSLATION';
      requestId: string;
    }
  | {
      type: 'START_PICKER';
    }
  | {
      type: 'TRANSLATE_SELECTOR';
      selectors: string[];
      sourceLang: string;
      targetLang: string;
      useSavedRules?: boolean;
    }
  | {
      type: 'TRANSLATE_BLOCKS';
      requestId: string;
      blocks: SerializableBlock[];
      sourceLang: string;
      targetLang: string;
    }
  | {
      type: 'TRANSLATION_RESULT';
      requestId: string;
      blockId: string;
      translation?: string;
      error?: BlockError;
    }
  | {
      type: 'GET_PAGE_STATE';
    }
  | {
      type: 'PAGE_STATE';
      translated: boolean;
      inProgress: boolean;
      total: number;
      completed: number;
      failed: number;
      selector: string | null;
      rules: DomainRule[];
    }
  | {
      type: 'GATEWAY_STATUS_REQUEST';
    }
  | {
      type: 'GATEWAY_STATUS';
      connected: boolean;
      health?: GatewayHealth;
      error?: string;
    }
  | {
      type: 'CANCEL';
    }
  | {
      type: 'RESTORE';
    }
  | {
      type: 'OPEN_OPTIONS';
    }
  | {
      type: 'SAVE_RULE';
      rule: Omit<DomainRule, 'id' | 'createdAt' | 'updatedAt'>;
    }
  | {
      type: 'RESULT_OK';
    };

export function isExtensionMessage(value: unknown): value is ExtensionMessage {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as { type?: unknown };
  return typeof candidate.type === 'string' && candidate.type.length > 0;
}
