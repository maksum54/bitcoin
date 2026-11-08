import { XMLParser } from 'fast-xml-parser';
import { fetchText } from './http.js';

export type NewsCategory = 'institution' | 'whale' | 'market';
export type NewsFlow = 'buy' | 'sell' | 'mixed' | null;

export interface NewsItem {
  id: string;
  title: string;
  link: string;
  source: string;
  publishedAt: string; // ISO
  summary: string;
  category: NewsCategory;
  flow: NewsFlow;
  lang: 'en' | 'id';
}

interface Feed {
  name: string;
  url: string;
  lang: 'en' | 'id';
  /** Feeds from Google News carry the publisher in <source>. */
  google?: boolean;
}

const g = (q: string, lang: 'en' | 'id' = 'en') =>
  lang === 'id'
    ? `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=id&gl=ID&ceid=ID:id`
    : `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-US&gl=US&ceid=US:en`;

export const FEEDS: Feed[] = [
  { name: 'CoinDesk', url: 'https://www.coindesk.com/arc/outboundfeeds/rss/', lang: 'en' },
  { name: 'Cointelegraph', url: 'https://cointelegraph.com/rss/tag/bitcoin', lang: 'en' },
  { name: 'Bitcoin Magazine', url: 'https://bitcoinmagazine.com/.rss/full/', lang: 'en' },
  { name: 'Decrypt', url: 'https://decrypt.co/feed', lang: 'en' },
  { name: 'Google News', url: g('bitcoin ETF inflows OR outflows when:3d'), lang: 'en', google: true },
  { name: 'Google News', url: g('bitcoin hedge fund OR "13F" OR "asset manager" when:7d'), lang: 'en', google: true },
  { name: 'Google News', url: g('Strategy OR MicroStrategy OR Metaplanet bitcoin purchase when:7d'), lang: 'en', google: true },
  { name: 'Google News', url: g('bitcoin whale wallet moved when:3d'), lang: 'en', google: true },
  { name: 'Google News', url: g('bitcoin when:2d', 'id'), lang: 'id', google: true },
];

const INSTITUTION =
  /\b(etfs?|ibit|fbtc|gbtc|arkb|bitb|blackrock|fidelity|grayscale|ark invest|bitwise|vaneck|invesco|hedge funds?|13f|microstrategy|strategy inc|saylor|metaplanet|institution(al|s)?|asset managers?|pension|sovereign|corporate treasur(y|ies)|wall street|tesla|semler|reksa dana|institusi|manajer investasi)\b/i;
const WHALE =
  /\b(whales?|paus|large holders?|dormant|satoshi[- ]era|wallet|dompet|on-?chain|exchange (inflows?|outflows?|reserves?)|arkham|lookonchain|moved \$?[\d,.]+|transfers? \$?[\d,.]+)\b/i;
const BUY =
  /\b(inflows?|buys?|bought|buying|acquir(e|es|ed|ing)|purchas(e|es|ed|ing)|accumulat(e|es|ed|ing|ion)|adds?|added|scoops?|snaps? up|increas(e|es|ed) (its |their )?(stake|holdings?|position)|borong|membeli|beli|akumulasi|masuk)\b/i;
const SELL =
  /\b(outflows?|sells?|sold|selling|sell-off|dump(s|ed|ing)?|offload(s|ed|ing)?|unload(s|ed|ing)?|liquidat(e|es|ed|ing|ion)|(cut|reduc(e|es|ed))s? (its |their )?(stake|holdings?|position)|exits?|menjual|jual|dilepas|keluar)\b/i;

// "Strategy" (formerly MicroStrategy) is a common word, so only match it next to a trade verb.
const STRATEGY_CO =
  /\b(MSTR|Strategy('s)?\s+(buys|bought|acquires|acquired|adds|added|purchases|purchased|sells|sold|holds|now holds|boosts|expands|resumes))\b/i;

export function classify(text: string): { category: NewsCategory; flow: NewsFlow } {
  const category: NewsCategory = INSTITUTION.test(text) || STRATEGY_CO.test(text) ? 'institution' : WHALE.test(text) ? 'whale' : 'market';
  const b = text.search(BUY);
  const s = text.search(SELL);
  let flow: NewsFlow = null;
  if (b >= 0 && s >= 0) flow = 'mixed';
  else if (b >= 0) flow = 'buy';
  else if (s >= 0) flow = 'sell';
  return { category, flow };
}

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', textNodeName: '#text' });

function text(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'string' || typeof v === 'number') return String(v);
  if (typeof v === 'object' && '#text' in (v as Record<string, unknown>)) return String((v as Record<string, unknown>)['#text']);
  return '';
}

export function stripHtml(s: string): string {
  return s
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

export function parseRss(xml: string, feed: Feed): NewsItem[] {
  const doc = parser.parse(xml);
  const raw = doc?.rss?.channel?.item ?? [];
  const items: unknown[] = Array.isArray(raw) ? raw : [raw];
  const out: NewsItem[] = [];
  for (const it of items as Record<string, unknown>[]) {
    let title = stripHtml(text(it.title));
    const link = text(it.link) || text(it.guid);
    if (!title || !link) continue;
    let source = feed.name;
    if (feed.google) {
      const src = text(it.source);
      if (src) {
        source = src;
        title = title.replace(new RegExp(`\\s+-\\s+${src.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`), '');
      }
    }
    // Google News descriptions are just a link to the same headline.
    const summary = feed.google ? '' : stripHtml(text(it.description)).slice(0, 240);
    const date = new Date(text(it.pubDate) || text(it['dc:date']) || Date.now());
    const { category, flow } = classify(`${title} ${summary}`);
    out.push({
      id: link,
      title,
      link,
      source,
      publishedAt: isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString(),
      summary,
      category,
      flow,
      lang: feed.lang,
    });
  }
  return out;
}

const norm = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().slice(0, 80);

export function mergeNews(lists: NewsItem[][], limit = 120): NewsItem[] {
  const seen = new Set<string>();
  const all = lists.flat().sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
  const out: NewsItem[] = [];
  for (const n of all) {
    const k = norm(n.title);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(n);
    if (out.length >= limit) break;
  }
  return out;
}

export async function getNews() {
  const results = await Promise.allSettled(FEEDS.map(async (f) => parseRss(await fetchText(f.url), f)));
  const lists = results.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []));
  const failed = results.filter((r) => r.status === 'rejected').length;
  return { items: mergeNews(lists), sources: FEEDS.length, failed, updatedAt: new Date().toISOString() };
}
