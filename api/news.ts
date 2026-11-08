import { getNews } from '../server/news.js';
import { json } from '../server/http.js';

export async function GET(): Promise<Response> {
  try {
    return json(await getNews(), 600);
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 502 });
  }
}
