export type LangCode = 'auto' | 'ko' | 'en' | 'ja';

export type ExtensionSettings = {
  gatewayBaseUrl: string;
  defaultSourceLang: LangCode;
  defaultTargetLang: Exclude<LangCode, 'auto'>;
  concurrency: number;
  textChunkMaxChars: number;
  autoUseSavedRule: boolean;
  domainRules: DomainRule[];
};

export type DomainRule = {
  id: string;
  hostname: string;
  pathPattern?: string;
  selector: string;
  excludedSelectors: string[];
  sourceLang?: LangCode;
  targetLang?: Exclude<LangCode, 'auto'>;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};

export type GatewayHealth = {
  status: 'ok';
  runtime: string;
  model: string;
};

export type GatewayModelPreset = {
  id: string;
  label: string;
  description?: string;
};

export type GatewayTranslateRequest = {
  text: string;
  source_lang: string;
  target_lang: string;
  preset?: string;
};

export type GatewayTranslateResponse = {
  translation: string;
  detected_source_lang: string;
  model: string;
  attempts: number;
  warnings: string[];
};

export type GatewayErrorBody = {
  error: {
    code: string;
    message: string;
  };
};

export type TranslationBlock = {
  id: string;
  text: string;
  nodes: Text[];
};

export type SerializableBlock = {
  id: string;
  text: string;
};

export type BlockError = {
  code: string;
  message: string;
};

export type TranslationRecord = {
  node: Text;
  originalText: string;
  translatedText: string;
  status: 'pending' | 'translated' | 'failed' | 'skipped';
};
