export async function ralphFetch(url: string, options?: RequestInit): Promise<Response> {
  return fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options?.headers,
      "X-Ralph-Request": "true",
    },
  });
}

export async function ralphFetchJson<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await ralphFetch(url, options);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const message =
      (body as { error?: { message?: string } }).error?.message ?? `HTTP ${res.status}`;
    throw new Error(message);
  }
  const body = (await res.json()) as { data: T };
  return body.data;
}
