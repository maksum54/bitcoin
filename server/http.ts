const UA = 'btc-nyicil/0.1 (+https://github.com/maksum54/bitcoin)';

export async function fetchText(url: string, timeoutMs = 10_000): Promise<string> {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: '*/*' },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.text();
}

export async function fetchJson<T>(url: string, timeoutMs = 15_000): Promise<T> {
  return JSON.parse(await fetchText(url, timeoutMs)) as T;
}

export function json(data: unknown, cacheSeconds: number): Response {
  return new Response(JSON.stringify(data), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': `public, s-maxage=${cacheSeconds}, stale-while-revalidate=${cacheSeconds * 3}`,
      'Access-Control-Allow-Origin': '*',
    },
  });
}
