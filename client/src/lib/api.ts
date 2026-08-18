const DEFAULT_API_BASE_URL = 'http://localhost:3000/api';

/**
 * Resolve VITE_API_BASE_URL, tolerating the ways it gets mangled in a hosting
 * dashboard.
 *
 * The value is inlined at build time, so a bad one is baked into the bundle and
 * only surfaces in production. The nastiest case is a markdown link pasted out
 * of rendered docs -- "[https://host/api](https://host/api)". That has no URL
 * scheme, so the browser resolves it as a *relative* path against the frontend
 * origin, and every API call 404s against the static host instead of the API.
 * Repair what can be repaired safely, and say so loudly rather than fail silently.
 */
function resolveApiBaseUrl(): string {
  const raw = (import.meta.env.VITE_API_BASE_URL ?? DEFAULT_API_BASE_URL).trim();

  // "[label](target)" -> target
  const markdown = raw.match(/^\[([^\]]*)\]\((.+)\)$/);
  const unwrapped = (markdown ? markdown[2] : raw).trim();

  // Drop stray quotes/angle brackets and any trailing slash, so we never build a "//" path.
  const cleaned = unwrapped.replace(/^['"`<]+|['"`>]+$/g, '').replace(/\/+$/, '');

  if (cleaned !== raw) {
    console.error(
      'VITE_API_BASE_URL is malformed (' + JSON.stringify(raw) + '). Using ' +
        JSON.stringify(cleaned) + '. Fix it in the hosting environment and redeploy - ' +
        'Vite inlines this at build time, so changing it requires a rebuild.'
    );
  }

  if (!/^https?:\/\//i.test(cleaned) && !cleaned.startsWith('/')) {
    console.error(
      'VITE_API_BASE_URL (' + JSON.stringify(cleaned) + ') is neither an absolute URL nor a ' +
        'root-relative path, so every request resolves against the frontend origin and 404s.'
    );
  }

  return cleaned || DEFAULT_API_BASE_URL;
}

const API_BASE_URL = resolveApiBaseUrl();

/** Error carrying the HTTP status, so callers can tell "retry later" from "never going to work". */
export class ApiError extends Error {
  status: number;
  payload: unknown;

  constructor(message: string, status: number, payload?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.payload = payload;
  }

  /** True for transport failures and 5xx — worth retrying once we are back online. */
  get isRetryable(): boolean {
    return this.status === 0 || this.status >= 500;
  }
}

export const getAuthToken = (): string | null => {
  return localStorage.getItem('sellkit_token');
};

export const setAuthToken = (token: string): void => {
  localStorage.setItem('sellkit_token', token);
};

export const clearAuthToken = (): void => {
  localStorage.removeItem('sellkit_token');
};

export const apiFetch = async (endpoint: string, options: RequestInit = {}): Promise<any> => {
  const token = getAuthToken();

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${endpoint}`, { ...options, headers });
  } catch (err) {
    // Network-level failure (offline, DNS, connection refused): status 0, retryable.
    throw new ApiError(err instanceof Error ? err.message : 'Network request failed', 0);
  }

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new ApiError(
      data.error || data.message || `API Error (${response.status})`,
      response.status,
      data
    );
  }

  return data;
};
