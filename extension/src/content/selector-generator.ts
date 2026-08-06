export type GeneratedSelector = {
  selector: string;
  matches: number;
  exact: boolean;
};

export type SelectorValidation = {
  matches: number;
  exact: boolean;
  error: string | null;
};

const GENERATED_CLASS_PATTERNS: RegExp[] = [
  /^css-/i,
  /^sc-/i,
  /^jss/i,
  /^emotion-/i,
  /^mui/i,
  /^styled-/i,
  /^[a-z0-9]+-[a-f0-9]{6,}$/i,
  /[a-f0-9]{10,}/i,
];

const UNSTABLE_SELECTOR_PATTERNS: RegExp[] = [
  /:nth-child/i,
  /data-(testid|test|cy|qa|automation|hook)/i,
  /(?:css|sc|jss|emotion|styled)-\w+/i,
  /[a-f0-9]{10,}/i,
];

function cssEscape(part: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
    return CSS.escape(part);
  }
  return part.replace(/[^a-zA-Z0-9_-]/g, (ch) => `\\${ch}`);
}

function isGeneratedId(id: string): boolean {
  if (/^[0-9]+$/.test(id)) {
    return true;
  }
  if (id.length >= 12 && /^[a-z0-9]+$/.test(id)) {
    return true;
  }
  return /[a-f0-9]{16,}/i.test(id);
}

function isStableClass(className: string): boolean {
  if (className.length < 2) {
    return false;
  }
  return !GENERATED_CLASS_PATTERNS.some((pattern) => pattern.test(className));
}

function partFor(el: Element): string {
  const tag = el.tagName.toLowerCase();
  const stableClasses = Array.from(el.classList).filter(isStableClass);
  if (stableClasses.length > 0) {
    return `${tag}.${stableClasses.map(cssEscape).join('.')}`;
  }
  if (el.id && !isGeneratedId(el.id)) {
    return `${tag}#${cssEscape(el.id)}`;
  }
  return tag;
}

function nthOfTypeFor(el: Element): string {
  const tag = el.tagName.toLowerCase();
  const parent = el.parentElement;
  let index = 1;
  if (parent) {
    const sameTag = Array.from(parent.children).filter((child) => child.tagName === el.tagName);
    index = sameTag.indexOf(el) + 1;
  }
  return `${tag}:nth-of-type(${Math.max(1, index)})`;
}

function chainFrom(el: Element): Element[] {
  const chain: Element[] = [];
  let node: Element | null = el;
  while (node && node !== document.documentElement && node !== document.body) {
    chain.unshift(node);
    node = node.parentElement;
  }
  if (chain.length === 0) {
    chain.unshift(el);
  }
  return chain;
}

export function generateSelector(el: Element): GeneratedSelector {
  if (el.id && !isGeneratedId(el.id)) {
    const idSelector = `#${cssEscape(el.id)}`;
    if (document.querySelectorAll(idSelector).length === 1) {
      return { selector: idSelector, matches: 1, exact: true };
    }
  }
  const chain = chainFrom(el);
  const classPath = chain.map(partFor).join(' > ');
  const classMatches = document.querySelectorAll(classPath).length;
  if (classMatches === 1) {
    return { selector: classPath, matches: 1, exact: true };
  }
  for (let i = chain.length - 1; i >= 0; i -= 1) {
    const path = chain
      .map((node, index) => (index === i ? nthOfTypeFor(node) : partFor(node)))
      .join(' > ');
    if (document.querySelectorAll(path).length === 1) {
      return { selector: path, matches: 1, exact: true };
    }
  }
  return { selector: classPath, matches: classMatches, exact: classMatches === 1 };
}

export function validateSelector(selector: string, root: Document | Element = document): SelectorValidation {
  const trimmed = selector.trim();
  if (trimmed.length === 0) {
    return { matches: 0, exact: false, error: 'Selector is empty' };
  }
  try {
    const elements = root.querySelectorAll(trimmed);
    if (elements.length === 0) {
      return { matches: 0, exact: false, error: 'Selector matched no elements' };
    }
    return { matches: elements.length, exact: elements.length === 1, error: null };
  } catch {
    return { matches: 0, exact: false, error: 'Invalid CSS selector' };
  }
}

export function isUnstableSelector(selector: string): boolean {
  return UNSTABLE_SELECTOR_PATTERNS.some((pattern) => pattern.test(selector));
}
