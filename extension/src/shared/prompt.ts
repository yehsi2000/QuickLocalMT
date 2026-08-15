import { renderGlossaryBlock } from './glossary';
import type { GlossaryEntry } from './types';

export type GenerationOptions = {
  temperature: number;
  top_p: number;
  top_k: number;
  repeat_penalty: number;
  repeat_last_n: number;
  num_ctx: number;
  num_predict: number;
};

const LANGUAGE_NAMES: Record<string, string> = {
  auto: 'the source language',
  ko: 'Korean',
  en: 'English',
  ja: 'Japanese',
};

const PROMPT_TEMPLATE = `
Translate the following text from {source_lang} into {target_lang}. Note that you should only output the translated result without any additional explanation:

{input_text}
`
// `
// Translate from {source_lang} to {target_lang}.

// Rules:
// - Return only the translation.
// - Do not explain the translation.
// - Do not repeat the source text.
// - Do not add headings, quotes, notes, or commentary.
// - Preserve line breaks when they carry meaning.

// Text:
// {input_text}`;
// `

export function languageName(code: string): string {
  return LANGUAGE_NAMES[code] ?? code;
}

export function buildTranslationPrompt(
  text: string,
  sourceLang: string,
  targetLang: string,
  glossary: GlossaryEntry[] = [],
): string {
  const base = PROMPT_TEMPLATE.replace('{source_lang}', languageName(sourceLang))
    .replace('{target_lang}', languageName(targetLang))
    .replace('{input_text}', text);
  if (glossary.length === 0) {
    return base;
  }
  const block = renderGlossaryBlock(glossary);
  if (block.length === 0) {
    return base;
  }
  return `${block}\n${base}`;
}

export const MIN_OUTPUT_TOKENS = 128;
export const OUTPUT_TOKEN_RATIO = 1.6;
export const MAX_OUTPUT_TOKENS = 1024;

export function computeOutputTokenBudget(sourceText: string, maxOutputTokens: number = MAX_OUTPUT_TOKENS): number {
  const estimatedSourceTokens = Math.max(1, Math.floor(sourceText.length / 4));
  const budget = Math.max(MIN_OUTPUT_TOKENS, Math.floor(estimatedSourceTokens * OUTPUT_TOKEN_RATIO));
  return Math.min(budget, maxOutputTokens);
}

export const DEFAULT_GENERATION_OPTIONS: Omit<GenerationOptions, 'num_predict'> = {
  temperature: 0.1,
  top_p: 0.9,
  top_k: 40,
  repeat_penalty: 1.08,
  repeat_last_n: 96,
  num_ctx: 4096,
};

export const RETRY_GENERATION_OPTIONS: Omit<GenerationOptions, 'num_predict'> = {
  temperature: 0.15,
  top_p: 0.9,
  top_k: 40,
  repeat_penalty: 1.12,
  repeat_last_n: 96,
  num_ctx: 4096,
};
