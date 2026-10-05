export async function api<T>(url: string, options?: { method?: string; body?: unknown; signal?: AbortSignal }): Promise<T> {
  const response = await fetch(url, {
    method: options?.method ?? (options?.body ? "POST" : "GET"),
    headers: options?.body ? { "Content-Type": "application/json" } : undefined,
    body: options?.body ? JSON.stringify(options.body) : undefined,
    signal: options?.signal,
    cache: "no-store",
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? "Sift couldn’t complete that request.");
  return data as T;
}
