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
let activeCompany: string | undefined;
let operatorCredential = '';
export function getOperatorCredential() { return operatorCredential; }
export function setOperatorCredential(value: string) { operatorCredential = value; }
export function lockOperator() {
  operatorCredential = '';
  window.dispatchEvent(new Event('harbourline-operator-locked'));
}
export function getCompanyScope() { return activeCompany; }
export function setCompanyScope(id: string | undefined) { activeCompany = id; }

async function responseError(response: Response) {
  const body: unknown = await response.json().catch(() => null);
  const error = (body as { error?: { code?: unknown; fields?: unknown } } | null)?.error;
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

export function apiGet<T>(path: string, signal: AbortSignal, requestTimeout?: number) {
  return request<T>(path, signal, {}, requestTimeout);
}

export function apiAttachment(path: string, signal: AbortSignal, mediaType: string) {
  return request<Blob>(path, signal, { headers: { Accept: mediaType } }, 30_000, response => {
    if (response.headers.get('Content-Type')?.split(';')[0] !== mediaType) {
      throw new ApiError('invalid-response');
    }
    return response.blob();
  });
}

export function apiPost<T>(path: string, body: object, signal: AbortSignal, requestTimeout?: number) {
  return sendJson<T>('POST', path, body, signal, requestTimeout);
}

export function apiPostWithStatus<T>(path: string, body: object, signal: AbortSignal) {
  return sendJson<{ status: number; data: T }>('POST', path, body, signal, undefined,
    async response => ({ status: response.status, data: await response.json() }));
}

export function apiDelete<T>(path: string, signal: AbortSignal) {
  return request<T>(path, signal, {method:'DELETE'});
}

export function apiPut<T>(path: string, body: object, signal: AbortSignal) {
  return sendJson<T>('PUT', path, body, signal);
}

export function apiPatch<T>(path: string, body: object, signal: AbortSignal) {
  return sendJson<T>('PATCH', path, body, signal);
}

export function apiLocal<T>(path: string, token: string, signal: AbortSignal,
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'GET', body?: object,
) {
  return request<T>(path, signal, {
    method,
    redirect: 'error',
    headers: { Authorization: 'Bearer ' + token, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  }, timeoutMs, response => response.status === 204 ? Promise.resolve(undefined as T) : response.json(), '/api/v1');
}

function sendJson<T>(method: 'POST' | 'PUT' | 'PATCH', path: string, body: object, signal: AbortSignal,
  requestTimeout?: number, read?: (response: Response) => Promise<T>,
) {
  return request<T>(path, signal, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }, requestTimeout, read);
}

async function request<T>(path: string, signal: AbortSignal, init?: RequestInit, requestTimeout = timeoutMs,
  read: (response: Response) => Promise<T> = response => response.json(), target = baseUrl,
): Promise<T> {
  const timeout = AbortSignal.timeout(requestTimeout);
  const combinedSignal = AbortSignal.any([signal, timeout]);
  try {
    const companyScoped = path.startsWith('/marketing/intelligence/partner/') || (path.startsWith('/marketing/companies/') && path !== '/marketing/companies/session');
    const companyHeader: Record<string,string> = companyScoped && activeCompany ? { 'X-Harbourline-Company': activeCompany } : {};
    const coreCredential = operatorCredential && target === '/api/v1' && !path.startsWith('/marketing/')
      ? operatorCredential : '';
    const headers = new Headers({ Accept: 'application/json', ...companyHeader, ...init?.headers });
    if (coreCredential) headers.set('Authorization', 'Bearer ' + coreCredential);
    const activeOperatorRequest = Boolean(operatorCredential && headers.get('Authorization') === 'Bearer ' + operatorCredential);
    const sentCredential = operatorCredential;
    const response = await fetch(`${target}${path}`, {
      ...init,
      signal: combinedSignal,
      cache: 'no-store',
      ...(activeOperatorRequest ? { redirect: 'error' } : {}),
      headers,
    });
    if (!response.ok) {
      const problem = await responseError(response);
      if (activeOperatorRequest && sentCredential === operatorCredential &&
          (problem.code === 'pilot_operator_login' || problem.code === 'operator_required')) lockOperator();
      if (companyScoped && activeCompany && companyHeader['X-Harbourline-Company'] === activeCompany &&
          (problem.code === 'company_login_required' || problem.code === 'company_changed')) {
        window.dispatchEvent(new Event('company-session'));
      }
      throw problem;
    }
    try {
      return await read(response);
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
