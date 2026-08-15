import type {
  ExtensionSettings,
  GatewayErrorBody,
  GatewayHealth,
  GatewayModelPreset,
  GatewayTranslateRequest,
  GatewayTranslateResponse,
} from '../shared/types';
import { applyGlossaryReplacement } from '../shared/glossary';
import {
  buildTranslationPrompt,
  computeOutputTokenBudget,
  DEFAULT_GENERATION_OPTIONS,
  RETRY_GENERATION_OPTIONS,
} from '../shared/prompt';
import { cleanChunkOutput, validateChunk } from '../shared/output-guard';

export class GatewayApiError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = 'GatewayApiError';
    this.code = code;
    this.status = status;
  }
}

export class GatewayConnectionError extends Error {
  override readonly cause?: unknown;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'GatewayConnectionError';
    this.cause = cause;
  }
}

export class GatewayTimeoutError extends GatewayConnectionError {
  constructor(message: string) {
    super(message);
    this.name = 'GatewayTimeoutError';
  }
}

const DEFAULT_TIMEOUT_MS = 45_000;

function endpoint(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, '')}${path}`;
}

async function parseErrorBody(response: Response): Promise<GatewayErrorBody | null> {
  try {
    const body = (await response.json()) as GatewayErrorBody;
    if (body && typeof body.error === 'object' && body.error !== null) {
      return body;
    }
  } catch {
    return null;
  }
  return null;
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new GatewayTimeoutError(`Provider request timed out after ${timeoutMs}ms`);
    }
    throw new GatewayConnectionError(`Unable to reach provider at ${url}`, error);
  } finally {
    clearTimeout(timer);
  }
}

async function postJson(
  url: string,
  body: Record<string, unknown>,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<Record<string, unknown>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onOuterAbort = () => controller.abort();
  if (signal) {
    if (signal.aborted) {
      controller.abort();
    } else {
      signal.addEventListener('abort', onOuterAbort, { once: true });
    }
  }
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new GatewayApiError('HTTP_ERROR', `Provider returned HTTP ${response.status}`, response.status);
    }
    return (await response.json()) as Record<string, unknown>;
  } catch (error) {
    if (error instanceof GatewayApiError || error instanceof GatewayConnectionError) {
      throw error;
    }
    if (error instanceof DOMException && error.name === 'AbortError') {
      if (signal?.aborted) {
        throw new GatewayConnectionError('Request cancelled');
      }
      throw new GatewayTimeoutError(`Provider request timed out after ${timeoutMs}ms`);
    }
    throw new GatewayConnectionError(`Unable to reach provider at ${url}`, error);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onOuterAbort);
  }
}

export async function getGatewayHealth(
  baseUrl: string,
  timeoutMs: number = 5_000,
): Promise<GatewayHealth> {
  const response = await fetchWithTimeout(endpoint(baseUrl, '/health'), { method: 'GET' }, timeoutMs);
  if (!response.ok) {
    const errorBody = await parseErrorBody(response);
    throw new GatewayApiError(
      errorBody?.error.code ?? 'HEALTH_CHECK_FAILED',
      errorBody?.error.message ?? `Gateway returned HTTP ${response.status}`,
      response.status,
    );
  }
  const body = (await response.json()) as GatewayHealth;
  if (body.status !== 'ok') {
    throw new GatewayApiError('HEALTH_CHECK_FAILED', 'Gateway health check did not report ok', 200);
  }
  return body;
}

export async function getGatewayModels(
  baseUrl: string,
  timeoutMs: number = 5_000,
): Promise<GatewayModelPreset[]> {
  const response = await fetchWithTimeout(endpoint(baseUrl, '/models'), { method: 'GET' }, timeoutMs);
  if (!response.ok) {
    throw new GatewayApiError('MODELS_FETCH_FAILED', `Gateway returned HTTP ${response.status}`, response.status);
  }
  const body = (await response.json()) as { presets: GatewayModelPreset[] };
  return Array.isArray(body.presets) ? body.presets : [];
}

export async function translateText(
  baseUrl: string,
  request: GatewayTranslateRequest,
  signal?: AbortSignal,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<GatewayTranslateResponse> {
  const controller = new AbortController();
  const timeoutTimer = setTimeout(() => controller.abort(), timeoutMs);
  const onOuterAbort = () => controller.abort();
  if (signal) {
    if (signal.aborted) {
      controller.abort();
    } else {
      signal.addEventListener('abort', onOuterAbort, { once: true });
    }
  }
  try {
    const response = await fetch(endpoint(baseUrl, '/translate'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
      signal: controller.signal,
    });
    if (!response.ok) {
      const errorBody = await parseErrorBody(response);
      throw new GatewayApiError(
        errorBody?.error.code ?? 'TRANSLATION_FAILED',
        errorBody?.error.message ?? `Gateway returned HTTP ${response.status}`,
        response.status,
      );
    }
    const body = (await response.json()) as GatewayTranslateResponse;
    if (typeof body.translation !== 'string' || body.translation.length === 0) {
      throw new GatewayApiError('INVALID_RESPONSE', 'Gateway returned an empty translation', 200);
    }
    return body;
  } catch (error) {
    if (error instanceof GatewayApiError || error instanceof GatewayConnectionError) {
      throw error;
    }
    if (error instanceof DOMException && error.name === 'AbortError') {
      if (signal?.aborted) {
        throw new GatewayConnectionError('Request cancelled');
      }
      throw new GatewayTimeoutError(`Gateway request timed out after ${timeoutMs}ms`);
    }
    throw new GatewayConnectionError(`Unable to reach gateway at ${endpoint(baseUrl, '/translate')}`, error);
  } finally {
    clearTimeout(timeoutTimer);
    signal?.removeEventListener('abort', onOuterAbort);
  }
}

async function translateWithValidation(
  request: GatewayTranslateRequest,
  generate: (prompt: string, options: Record<string, number>) => Promise<string>,
): Promise<string> {
  const glossary = request.glossary ?? [];
  const prompt = buildTranslationPrompt(request.text, request.source_lang, request.target_lang, glossary);
  const budget = computeOutputTokenBudget(request.text);
  const attemptSets = [
    { ...DEFAULT_GENERATION_OPTIONS, num_predict: budget },
    { ...RETRY_GENERATION_OPTIONS, num_predict: Math.min(budget, 256) },
  ];
  for (let index = 0; index < attemptSets.length; index += 1) {
    const options = attemptSets[index];
    if (!options) {
      continue;
    }
    const raw = await generate(prompt, options);
    const cleaned = cleanChunkOutput(raw);
    const reasons = validateChunk(request.text, request.source_lang, request.target_lang, cleaned);
    if (reasons.length === 0) {
      return applyGlossaryReplacement(cleaned, glossary);
    }
    if (index === attemptSets.length - 1) {
      throw new GatewayApiError(
        reasons[0] ?? 'TRANSLATION_FAILED',
        `Model output failed validation: ${reasons.join(', ')}`,
        200,
      );
    }
  }
  throw new GatewayApiError('TRANSLATION_FAILED', 'Translation failed after retries', 200);
}

async function translateViaOllama(
  settings: ExtensionSettings,
  request: GatewayTranslateRequest,
  signal?: AbortSignal,
): Promise<string> {
  return translateWithValidation(request, async (prompt, options) => {
    const data = await postJson(
      endpoint(settings.ollamaBaseUrl, '/api/generate'),
      {
        model: settings.ollamaModel,
        prompt,
        stream: false,
        options,
        keep_alive: '5m',
      },
      DEFAULT_TIMEOUT_MS,
      signal,
    );
    const response = data.response;
    if (typeof response !== 'string') {
      throw new GatewayApiError('INVALID_RESPONSE', 'Ollama returned no response text', 200);
    }
    return response;
  });
}

async function translateViaLlamaCpp(
  settings: ExtensionSettings,
  request: GatewayTranslateRequest,
  signal?: AbortSignal,
): Promise<string> {
  return translateWithValidation(request, async (prompt, options) => {
    const body: Record<string, unknown> = {
      messages: [{ role: 'user', content: prompt }],
      stream: false,
      temperature: options.temperature,
      top_p: options.top_p,
      top_k: options.top_k,
      repeat_penalty: options.repeat_penalty,
      repeat_last_n: options.repeat_last_n,
      max_tokens: options.num_predict,
    };
    if (settings.llamacppModel.length > 0) {
      body.model = settings.llamacppModel;
    }
    const data = await postJson(
      endpoint(settings.llamacppBaseUrl, '/v1/chat/completions'),
      body,
      DEFAULT_TIMEOUT_MS,
      signal,
    );
    const choices = Array.isArray(data.choices) ? data.choices : [];
    const content = (choices[0] as { message?: { content?: unknown } } | undefined)?.message?.content;
    if (typeof content !== 'string') {
      throw new GatewayApiError('INVALID_RESPONSE', 'llama.cpp returned no message content', 200);
    }
    return content;
  });
}

export async function translateChunk(
  settings: ExtensionSettings,
  request: GatewayTranslateRequest,
  signal?: AbortSignal,
): Promise<string> {
  switch (settings.provider) {
    case 'ollama':
      return translateViaOllama(settings, request, signal);
    case 'llamacpp':
      return translateViaLlamaCpp(settings, request, signal);
    case 'gateway': {
      const result = await translateText(settings.gatewayBaseUrl, request, signal);
      return result.translation;
    }
  }
}

export async function getProviderHealth(
  settings: ExtensionSettings,
  timeoutMs: number = 5_000,
): Promise<GatewayHealth> {
  switch (settings.provider) {
    case 'gateway':
      return getGatewayHealth(settings.gatewayBaseUrl, timeoutMs);
    case 'ollama': {
      const response = await fetchWithTimeout(
        endpoint(settings.ollamaBaseUrl, '/api/tags'),
        { method: 'GET' },
        timeoutMs,
      );
      if (!response.ok) {
        throw new GatewayApiError(
          'HEALTH_CHECK_FAILED',
          `Ollama returned HTTP ${response.status}`,
          response.status,
        );
      }
      const body = (await response.json()) as { models?: unknown[] };
      if (!Array.isArray(body.models)) {
        throw new GatewayApiError('HEALTH_CHECK_FAILED', 'Ollama /api/tags did not return models', 200);
      }
      return { status: 'ok', runtime: 'ollama', model: settings.ollamaModel };
    }
    case 'llamacpp': {
      const response = await fetchWithTimeout(
        endpoint(settings.llamacppBaseUrl, '/health'),
        { method: 'GET' },
        timeoutMs,
      );
      if (!response.ok) {
        throw new GatewayApiError(
          'HEALTH_CHECK_FAILED',
          `llama.cpp returned HTTP ${response.status}`,
          response.status,
        );
      }
      return { status: 'ok', runtime: 'llamacpp', model: settings.llamacppModel || 'default' };
    }
  }
}
