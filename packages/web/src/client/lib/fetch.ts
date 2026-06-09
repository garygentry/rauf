export async function raufFetch(url: string, options?: RequestInit): Promise<Response> {
  return fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options?.headers,
      "X-Rauf-Request": "true",
    },
  });
}

export async function raufFetchJson<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await raufFetch(url, options);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const message =
      (body as { error?: { message?: string } }).error?.message ?? `HTTP ${res.status}`;
    throw new Error(message);
  }
  const body = (await res.json()) as { data: T };
  return body.data;
}
