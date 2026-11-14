type FailureKind = 'network' | 'timeout' | 'http' | 'invalid-response';

export class ApiError extends Error {
  constructor(
    readonly kind: FailureKind,
    readonly status?: number,
    readonly code?: string,
    readonly fields: readonly string[] = [],
  ) {
    super(code ?? kind);
    this.name = 'ApiError';
  }
}

const baseUrl = (import.meta.env.VITE_API_BASE_URL || '/api/v1').replace(/\/+$/, '');
const timeoutMs = 10_000;

async function responseError(response: Response) {
  const body: unknown = await response.json().catch(() => null);
  const error = (body as { error?: { code?: unknown; fields?: unknown } } | null)?.error;
  // Do not render arbitrary proxy HTML, untrusted messages, or raw response bodies.
  const code = typeof error?.code === 'string' && /^[a-z][a-z_]{0,127}$/.test(error.code)
    ? error.code
    : undefined;
  const fields: string[] = [];
  if (Array.isArray(error?.fields)) {
    for (const field of error.fields) {
      const location: unknown = field?.location;
      if (Array.isArray(location) && location[0] === 'body' && typeof location[1] === 'string') {
        fields.push(location[1]);
      }
    }
  }
  return new ApiError('http', response.status, code, fields);
}

export function apiGet<T>(path: string, signal: AbortSignal) {
  return request<T>(path, signal);
}

export function apiPost<T>(path: string, body: object, signal: AbortSignal) {
  return sendJson<T>('POST', path, body, signal);
}

export function apiPut<T>(path: string, body: object, signal: AbortSignal) {
  return sendJson<T>('PUT', path, body, signal);
}

function sendJson<T>(method: 'POST' | 'PUT', path: string, body: object, signal: AbortSignal) {
  return request<T>(path, signal, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function request<T>(path: string, signal: AbortSignal, init?: RequestInit): Promise<T> {
  const timeout = AbortSignal.timeout(timeoutMs);
  const combinedSignal = AbortSignal.any([signal, timeout]);
  try {
    const response = await fetch(`${baseUrl}${path}`, {
      ...init,
      signal: combinedSignal,
      cache: 'no-store',
      headers: { Accept: 'application/json', ...init?.headers },
    });
    if (!response.ok) throw await responseError(response);
    try {
      const body: T = await response.json();
      return body;
    } catch {
      throw new ApiError('invalid-response');
    }
  } catch (error) {
    signal.throwIfAborted();
    if (timeout.aborted) throw new ApiError('timeout');
    if (error instanceof ApiError) throw error;
    throw new ApiError('network');
  }
}
