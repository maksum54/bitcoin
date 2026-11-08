import { getWhales } from '../server/whales.js';
import { json } from '../server/http.js';

export async function GET(request: Request): Promise<Response> {
  const min = Number(new URL(request.url).searchParams.get('min') ?? 100);
  const minBtc = Number.isFinite(min) ? Math.min(Math.max(min, 10), 10_000) : 100;
  try {
    return json(await getWhales(minBtc), 120);
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 502 });
  }
}
