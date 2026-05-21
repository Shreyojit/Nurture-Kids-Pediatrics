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

  const text = await response.text();
  let payload: Record<string, unknown> | null = null;
  try {
    payload = JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error(
      response.ok
        ? `Server returned non-JSON response (${response.status})`
        : `Server error ${response.status}: ${response.statusText || 'no response body'}`,
    );
  }

  if (!response.ok) {
    const err = payload?.error as Record<string, unknown> | undefined;
    throw new Error((err?.message as string) ?? 'Request failed');
  }

  return payload.data as T;
}

export function authHeader(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
  };
}
