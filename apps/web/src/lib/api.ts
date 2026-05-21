const API_BASE = import.meta.env.VITE_API_BASE_URL ?? '';

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const initHeaders = (init?.headers ?? {}) as HeadersInit;
  const headers = new Headers(initHeaders);

  const isFormData = typeof FormData !== 'undefined' && init?.body instanceof FormData;
  if (!isFormData && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers,
  });

  const payload = await response.json();

  if (!response.ok) {
    throw new Error(payload?.error?.message ?? 'Request failed');
  }

  return payload.data as T;
}

export function authHeader(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
  };
}
