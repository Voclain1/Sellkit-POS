/** Where the API lives in a dev checkout, alongside `npm run dev`. */
const DEV_API_BASE_URL = 'http://localhost:3000/api';

/**
 * Live API. Compiled into the bundle as the last-resort default so a production
 * deploy with a missing or misconfigured VITE_API_BASE_URL still reaches a real
 * server instead of the visitor's own machine.
 */
const PROD_API_BASE_URL = 'https://sellkit-pos.onrender.com/api';

/** Loopback in a production bundle means every visitor's browser calls itself. */
const LOOPBACK = /^https?:\/\/(localhost|127(?:\.\d+){3}|\[::1\]|0\.0\.0\.0)(:\d+)?(\/|$)/i;

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
  const fallback = import.meta.env.PROD ? PROD_API_BASE_URL : DEV_API_BASE_URL;

  // Empty counts as absent. A hosting dashboard readily stores VITE_API_BASE_URL
  // as "", which is *defined* -- so `??` does not fire and the value flows through
  // as a blank base URL. This is not hypothetical: it is what pointed the live
  // Vercel build at localhost.
  const configured = (import.meta.env.VITE_API_BASE_URL ?? '').trim();
  if (configured === '') {
    if (import.meta.env.PROD) {
      console.error(
        'VITE_API_BASE_URL is unset or empty in a production build. Falling back to ' +
          JSON.stringify(PROD_API_BASE_URL) + '. Set it in the hosting environment and ' +
          'redeploy - Vite inlines this at build time.'
      );
    }
    return fallback;
  }

  const raw = configured;

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

  // A production bundle pointed at loopback is never right: "localhost" resolves
  // on the *visitor's* machine, so every call fails for everyone but the person
  // who ran the build. Prefer the known live API over an address that cannot work.
  if (import.meta.env.PROD && LOOPBACK.test(cleaned)) {
    console.error(
      'VITE_API_BASE_URL (' + JSON.stringify(cleaned) + ') points at loopback in a production ' +
        'build, which resolves against each visitor\'s own machine. Falling back to ' +
        JSON.stringify(PROD_API_BASE_URL) + '. Set VITE_API_BASE_URL in the hosting ' +
        'environment and redeploy - Vite inlines this at build time.'
    );
    return PROD_API_BASE_URL;
  }

  if (!/^https?:\/\//i.test(cleaned) && !cleaned.startsWith('/')) {
    console.error(
      'VITE_API_BASE_URL (' + JSON.stringify(cleaned) + ') is neither an absolute URL nor a ' +
        'root-relative path, so every request resolves against the frontend origin and 404s.'
    );
    if (import.meta.env.PROD) return PROD_API_BASE_URL;
  }

  return cleaned || fallback;
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
