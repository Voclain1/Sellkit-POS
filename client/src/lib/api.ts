const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000/api';

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
