import type {
  GatewayErrorBody,
  GatewayHealth,
  GatewayModelPreset,
  GatewayTranslateRequest,
  GatewayTranslateResponse,
} from '../shared/types';

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
      throw new GatewayTimeoutError(`Gateway request timed out after ${timeoutMs}ms`);
    }
    throw new GatewayConnectionError(`Unable to reach gateway at ${url}`, error);
  } finally {
    clearTimeout(timer);
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
