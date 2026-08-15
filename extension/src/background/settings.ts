import type { DomainRule, ExtensionSettings, GlossaryEntry, LangCode, SiteGlossary } from '../shared/types';
import {
  clampInt,
  isPlainRecord,
  isNonEmptyText,
  isValidLangCode,
  isValidSelector,
  isValidTargetLang,
  normalizeBaseUrl,
  normalizeGatewayUrl,
  normalizeGlossary,
  normalizeLang,
  normalizeSelector,
} from '../shared/validation';

export const DEFAULT_SETTINGS: ExtensionSettings = {
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

const SETTINGS_KEY = 'extensionSettings';

function sanitizeRule(value: unknown): DomainRule | null {
  if (!isPlainRecord(value)) {
    return null;
  }
  const selector = normalizeSelector(value.selector);
  if (!isValidSelector(selector)) {
    return null;
  }
  const hostname = typeof value.hostname === 'string' ? value.hostname.trim() : '';
  if (hostname.length === 0) {
    return null;
  }
  const id = typeof value.id === 'string' && value.id.length > 0 ? value.id : crypto.randomUUID();
  const excludedSelectors = Array.isArray(value.excludedSelectors)
    ? value.excludedSelectors.filter((item): item is string => isNonEmptyText(item)).slice(0, 50)
    : [];
  return {
    id,
    hostname,
    pathPattern:
      typeof value.pathPattern === 'string' && value.pathPattern.length > 0
        ? value.pathPattern
        : undefined,
    selector,
    excludedSelectors,
    sourceLang: isValidLangCode(value.sourceLang) ? value.sourceLang : undefined,
    targetLang: isValidTargetLang(value.targetLang) ? value.targetLang : undefined,
    glossary: normalizeGlossary(value.glossary),
    enabled: typeof value.enabled === 'boolean' ? value.enabled : true,
    createdAt: typeof value.createdAt === 'string' ? value.createdAt : new Date().toISOString(),
    updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : new Date().toISOString(),
  };
}

function sanitizeSiteGlossary(value: unknown): SiteGlossary | null {
  if (!isPlainRecord(value)) {
    return null;
  }
  const hostname = typeof value.hostname === 'string' ? value.hostname.trim().toLowerCase() : '';
  if (hostname.length === 0 || hostname.length > 253) {
    return null;
  }
  return {
    hostname,
    glossary: normalizeGlossary(value.glossary),
  };
}

export function sanitizeSettings(raw: unknown): ExtensionSettings {
  const record = isPlainRecord(raw) ? raw : {};
  const rawRules = Array.isArray(record.domainRules) ? record.domainRules : [];
  const rules = rawRules
    .map(sanitizeRule)
    .filter((rule): rule is DomainRule => rule !== null)
    .slice(0, 200);
  const siteGlossaries = Array.isArray(record.siteGlossaries)
    ? record.siteGlossaries
        .map(sanitizeSiteGlossary)
        .filter((entry): entry is SiteGlossary => entry !== null)
        .slice(0, 200)
    : [];
  const glossaryByHost = new Map<string, GlossaryEntry[]>();
  for (const site of siteGlossaries) {
    if (!glossaryByHost.has(site.hostname)) {
      glossaryByHost.set(site.hostname, site.glossary);
    }
  }
  for (const rawRule of rawRules) {
    const rule = sanitizeRule(rawRule);
    if (!rule) {
      continue;
    }
    const legacy = normalizeGlossary(
      isPlainRecord(rawRule) ? rawRule.glossary : undefined,
    );
    if (legacy.length === 0) {
      continue;
    }
    glossaryByHost.set(
      rule.hostname.toLowerCase(),
      normalizeGlossary([...(glossaryByHost.get(rule.hostname.toLowerCase()) ?? []), ...legacy]),
    );
  }
  const mergedSiteGlossaries: SiteGlossary[] = Array.from(glossaryByHost.entries()).map(
    ([hostname, glossary]) => ({ hostname, glossary }),
  );
  const provider =
    record.provider === 'ollama' || record.provider === 'llamacpp' ? record.provider : 'gateway';
  return {
    provider,
    gatewayBaseUrl: normalizeGatewayUrl(record.gatewayBaseUrl),
    ollamaBaseUrl: normalizeBaseUrl(record.ollamaBaseUrl, 'http://127.0.0.1:11434'),
    ollamaModel:
      typeof record.ollamaModel === 'string' && record.ollamaModel.trim().length > 0
        ? record.ollamaModel.trim().slice(0, 128)
        : DEFAULT_SETTINGS.ollamaModel,
    llamacppBaseUrl: normalizeBaseUrl(record.llamacppBaseUrl, 'http://127.0.0.1:8080'),
    llamacppModel:
      typeof record.llamacppModel === 'string' ? record.llamacppModel.trim().slice(0, 128) : '',
    defaultSourceLang: normalizeLang(record.defaultSourceLang, 'auto'),
    defaultTargetLang: isValidTargetLang(record.defaultTargetLang)
      ? record.defaultTargetLang
      : DEFAULT_SETTINGS.defaultTargetLang,
    concurrency: clampInt(record.concurrency, 1, 4, DEFAULT_SETTINGS.concurrency),
    textChunkMaxChars: clampInt(record.textChunkMaxChars, 200, 8000, DEFAULT_SETTINGS.textChunkMaxChars),
    autoUseSavedRule: typeof record.autoUseSavedRule === 'boolean' ? record.autoUseSavedRule : false,
    domainRules: rules,
    siteGlossaries: mergedSiteGlossaries,
  };
}

export async function loadSettings(): Promise<ExtensionSettings> {
  const stored = await chrome.storage.local.get(SETTINGS_KEY);
  return sanitizeSettings(stored[SETTINGS_KEY]);
}

export async function saveSettings(patch: Partial<ExtensionSettings>): Promise<ExtensionSettings> {
  const current = await loadSettings();
  const merged = { ...current, ...patch };
  const sanitized = sanitizeSettings(merged);
  await chrome.storage.local.set({ [SETTINGS_KEY]: sanitized });
  return sanitized;
}

export async function addDomainRule(
  rule: Omit<DomainRule, 'id' | 'createdAt' | 'updatedAt'>,
): Promise<DomainRule> {
  const now = new Date().toISOString();
  const created: DomainRule = {
    ...rule,
    id: crypto.randomUUID(),
    createdAt: now,
    updatedAt: now,
  };
  const settings = await loadSettings();
  const withoutDuplicate = settings.domainRules.filter(
    (existing) =>
      existing.hostname !== created.hostname || existing.selector !== created.selector,
  );
  const updated = sanitizeSettings({
    ...settings,
    domainRules: [created, ...withoutDuplicate],
  });
  await chrome.storage.local.set({ [SETTINGS_KEY]: updated });
  return created;
}

export async function updateDomainRule(id: string, patch: Partial<DomainRule>): Promise<void> {
  const settings = await loadSettings();
  const updated = sanitizeSettings({
    ...settings,
    domainRules: settings.domainRules.map((rule) =>
      rule.id === id ? { ...rule, ...patch, id: rule.id, updatedAt: new Date().toISOString() } : rule,
    ),
  });
  await chrome.storage.local.set({ [SETTINGS_KEY]: updated });
}

export async function deleteDomainRule(id: string): Promise<void> {
  const settings = await loadSettings();
  const updated = sanitizeSettings({
    ...settings,
    domainRules: settings.domainRules.filter((rule) => rule.id !== id),
  });
  await chrome.storage.local.set({ [SETTINGS_KEY]: updated });
}

export function hostnameFromUrl(url: string | undefined): string {
  if (!url) {
    return '';
  }
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

export function matchesPathPattern(pathPattern: string | undefined, pathname: string): boolean {
  if (!pathPattern || pathPattern.length === 0) {
    return true;
  }
  if (pathPattern === pathname) {
    return true;
  }
  if (pathPattern.endsWith('*')) {
    return pathname.startsWith(pathPattern.slice(0, -1));
  }
  return false;
}

export function findRulesForUrl(rules: DomainRule[], url: string): DomainRule[] {
  const hostname = hostnameFromUrl(url);
  if (hostname.length === 0) {
    return [];
  }
  let pathname = '';
  try {
    pathname = new URL(url).pathname;
  } catch {
    pathname = '';
  }
  const matched: DomainRule[] = [];
  for (const rule of rules) {
    if (!rule.enabled) {
      continue;
    }
    if (rule.hostname !== hostname) {
      continue;
    }
    if (!matchesPathPattern(rule.pathPattern, pathname)) {
      continue;
    }
    matched.push(rule);
  }
  return matched;
}

export function siteGlossaryForHostname(
  siteGlossaries: SiteGlossary[],
  hostname: string,
): GlossaryEntry[] {
  const match = siteGlossaries.find((entry) => entry.hostname === hostname);
  return match ? match.glossary : [];
}

export async function upsertSiteGlossary(
  hostname: string,
  glossary: GlossaryEntry[],
): Promise<void> {
  const settings = await loadSettings();
  const normalizedHostname = hostname.trim().toLowerCase();
  const updated = sanitizeSettings({
    ...settings,
    siteGlossaries: [
      ...settings.siteGlossaries.filter((entry) => entry.hostname !== normalizedHostname),
      { hostname: normalizedHostname, glossary: normalizeGlossary(glossary) },
    ],
  });
  await chrome.storage.local.set({ [SETTINGS_KEY]: updated });
}

export async function deleteSiteGlossary(hostname: string): Promise<void> {
  const settings = await loadSettings();
  const normalizedHostname = hostname.trim().toLowerCase();
  const updated = sanitizeSettings({
    ...settings,
    siteGlossaries: settings.siteGlossaries.filter(
      (entry) => entry.hostname !== normalizedHostname,
    ),
  });
  await chrome.storage.local.set({ [SETTINGS_KEY]: updated });
}

export function langForRule(rule: DomainRule | null, settings: ExtensionSettings): {
  sourceLang: LangCode;
  targetLang: Exclude<LangCode, 'auto'>;
} {
  return {
    sourceLang: rule?.sourceLang ?? settings.defaultSourceLang,
    targetLang: rule?.targetLang ?? settings.defaultTargetLang,
  };
}
