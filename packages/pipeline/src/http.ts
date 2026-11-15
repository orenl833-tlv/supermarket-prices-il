/**
 * fetch with a timeout and a few retries. Chain portals are slow and
 * occasionally drop connections; a transient failure should not fail the run.
 */
export async function fetchWithRetry(
  url: string,
  init: RequestInit = {},
  { attempts = 3, timeoutMs = 60_000 } = {},
): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
      if (res.status >= 500) throw new Error(`HTTP ${res.status} for ${url}`);
      return res;
    } catch (err) {
      lastError = err;
      if (attempt < attempts) await sleep(1000 * 2 ** attempt);
    }
  }
  throw lastError;
}

export async function fetchBytes(url: string, init: RequestInit = {}): Promise<Uint8Array> {
  const res = await fetchWithRetry(url, init);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return new Uint8Array(await res.arrayBuffer());
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
