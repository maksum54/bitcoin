import { Card, ErrorBox, Loading, Seg, Updated, useAsync } from '../components/ui';
import { getNews, getWhales, type NewsItem, type WhaleTx } from '../lib/api';
import { ago, compact, num, short } from '../lib/format';
import { useApp, type Key } from '../lib/i18n';
import { usePrice } from '../lib/price';
import { useStored } from '../lib/storage';

type Cat = 'all' | NewsItem['category'];
type Flow = 'any' | 'buy' | 'sell';

const FLOW_STYLE: Record<NonNullable<NewsItem['flow']>, string> = {
  buy: 'bg-up/15 text-up',
  sell: 'bg-down/15 text-down',
  mixed: 'bg-accent/15 text-accent',
};

const WHALE_FLOW: Record<WhaleTx['flow'], { key: Key; cls: string }> = {
  exchange_in: { key: 'n.exIn', cls: 'bg-down/15 text-down' },
  exchange_out: { key: 'n.exOut', cls: 'bg-up/15 text-up' },
  exchange_internal: { key: 'n.exInt', cls: 'bg-card2 text-muted' },
  unknown: { key: 'n.unknown', cls: 'bg-card2 text-muted' },
};

export default function News() {
  return (
    <div className="grid gap-4 lg:grid-cols-5">
      <div className="min-w-0 lg:col-span-3">
        <Headlines />
      </div>
      <div className="min-w-0 lg:col-span-2">
        <Whales />
      </div>
    </div>
  );
}

function Headlines() {
  const { t, lang } = useApp();
  const [cat, setCat] = useStored<Cat>('ui.newsCat', 'institution');
  const [flow, setFlow] = useStored<Flow>('ui.newsFlow', 'any');
  const news = useAsync(getNews, [], 10 * 60_000);

  const items = (news.data?.data.items ?? []).filter(
    (n) => (cat === 'all' || n.category === cat) && (flow === 'any' || n.flow === flow || n.flow === 'mixed'),
  );
  const counts = (news.data?.data.items ?? []).reduce<Record<string, number>>((c, n) => ((c[n.category] = (c[n.category] ?? 0) + 1), c), {});

  return (
    <Card title={t('n.headlines')} right={news.data && <Updated at={news.data.at} stale={news.data.stale} />}>
      <div className="mb-3 flex flex-wrap gap-2">
        <Seg
          value={cat}
          onChange={setCat}
          options={[
            { v: 'all', label: t('n.all') },
            { v: 'institution', label: `${t('n.institution')} ${counts.institution ?? ''}` },
            { v: 'whale', label: `${t('n.whale')} ${counts.whale ?? ''}` },
            { v: 'market', label: `${t('n.market')} ${counts.market ?? ''}` },
          ]}
        />
        <Seg
          value={flow}
          onChange={setFlow}
          options={[
            { v: 'any', label: t('n.anyFlow') },
            { v: 'buy', label: `▲ ${t('n.buy')}` },
            { v: 'sell', label: `▼ ${t('n.sell')}` },
          ]}
        />
      </div>
      {news.error && !news.data ? (
        <ErrorBox onRetry={news.reload} msg={`${t('error')} ${t('n.needServer')}`} />
      ) : !news.data ? (
        <Loading />
      ) : (
        <>
          {news.data.data.failed > 0 && <p className="mb-2 text-xs text-muted">{t('n.failed', { n: news.data.data.failed })}</p>}
          <ul className="divide-y divide-line">
            {items.length === 0 && <li className="py-6 text-center text-sm text-muted">{t('n.empty')}</li>}
            {items.map((n) => (
              <li key={n.id} className="py-3">
                <a href={n.link} target="_blank" rel="noreferrer" className="group block">
                  <div className="mb-1 flex flex-wrap items-center gap-1.5 text-xs text-muted">
                    {n.flow && <span className={`rounded px-1.5 py-0.5 font-medium ${FLOW_STYLE[n.flow]}`}>{t(`n.${n.flow}` as Key)}</span>}
                    {cat === 'all' && <span className="rounded bg-card2 px-1.5 py-0.5">{t(`n.${n.category}` as Key)}</span>}
                    <span>{n.source}</span>
                    <span>·</span>
                    <span>{ago(n.publishedAt, lang)}</span>
                    {n.lang === 'id' && <span>🇮🇩</span>}
                  </div>
                  <div className="font-medium leading-snug group-hover:text-accent">{n.title}</div>
                  {n.summary && <p className="mt-1 line-clamp-2 text-sm text-muted">{n.summary}</p>}
                </a>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-muted">{t('n.newsNote')}</p>
        </>
      )}
    </Card>
  );
}

function Whales() {
  const { t, lang } = useApp();
  const { price } = usePrice();
  const [min, setMin] = useStored<number>('ui.whaleMin', 100);
  const w = useAsync(() => getWhales(min), [min], 2 * 60_000);

  return (
    <Card title={`🐋 ${t('n.onchain')}`} right={w.data && <Updated at={w.data.at} stale={w.data.stale} />}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted">{t('n.onchainDesc', { n: num(min, lang) })}</p>
        <Seg
          value={min}
          onChange={setMin}
          options={[50, 100, 500, 1000].map((v) => ({ v, label: `≥${num(v, lang)}` }))}
        />
      </div>
      {w.error && !w.data ? (
        <ErrorBox onRetry={w.reload} msg={`${t('error')} ${t('n.needServer')}`} />
      ) : !w.data ? (
        <Loading />
      ) : (
        <>
          <ul className="divide-y divide-line">
            {w.data.data.items.length === 0 && <li className="py-6 text-center text-sm text-muted">{t('n.empty')}</li>}
            {w.data.data.items.map((x) => (
              <li key={x.txid} className="py-3 text-sm">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="num text-base font-semibold">{num(x.btc, lang, 2)} BTC</div>
                    {price && <div className="num text-xs text-muted">≈ Rp {compact(x.btc * price.idr, lang)}</div>}
                  </div>
                  <div className="text-right text-xs">
                    <span className={`rounded px-1.5 py-0.5 font-medium ${WHALE_FLOW[x.flow].cls}`}>{t(WHALE_FLOW[x.flow].key)}</span>
                    <div className="mt-1 text-muted">
                      {x.confirmed ? `#${num(x.height ?? 0, lang)}` : t('n.pending')} · {ago(x.time, lang)}
                    </div>
                  </div>
                </div>
                <div className="mt-2 grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-xs">
                  <span className="text-muted">{t('n.from')}</span>
                  <span className="truncate font-mono">{x.from.map((f) => f.label ?? short(f.addr, 6)).join(', ')}</span>
                  <span className="text-muted">{t('n.to')}</span>
                  <span className="truncate font-mono">
                    {x.to.map((o) => `${o.label ?? short(o.addr, 6)} (${num(o.btc, lang, 2)})`).join(', ')}
                  </span>
                </div>
                <a className="mt-1 inline-block text-xs text-accent" href={`https://mempool.space/tx/${x.txid}`} target="_blank" rel="noreferrer">
                  {short(x.txid, 8)} ↗
                </a>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-muted">{t('n.whaleNote')}</p>
        </>
      )}
    </Card>
  );
}
