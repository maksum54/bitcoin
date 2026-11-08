import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { InstallPrompt, OfflineBanner, UpdateBanner } from './components/Shell';
import { Loading, useAsync } from './components/ui';
import { getPrice } from './lib/api';
import { idr, type Lang } from './lib/format';
import { AppCtx, makeT, type Key } from './lib/i18n';
import { NavCtx, TABS, type Draft, type Tab } from './lib/nav';
import { dueAlerts, PriceCtx, type Alert } from './lib/price';
import { load, save, useStored } from './lib/storage';
import Market from './pages/Market';

const Plan = lazy(() => import('./pages/Plan'));
const Portfolio = lazy(() => import('./pages/Portfolio'));
const Explorer = lazy(() => import('./pages/Explorer'));
const News = lazy(() => import('./pages/News'));

const ICONS: Record<Tab, string> = { market: '📈', plan: '🗓️', portfolio: '💼', explorer: '🔎', news: '📰' };

const tabFromHash = (): Tab => {
  const h = location.hash.slice(1) as Tab;
  return TABS.includes(h) ? h : 'market';
};

async function notify(title: string, body: string) {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg) await reg.showNotification(title, { body, icon: '/pwa-192.png', badge: '/pwa-192.png', tag: 'btc-alert' });
    else new Notification(title, { body, icon: '/pwa-192.png' });
  } catch {
    /* ignore */
  }
}

export default function App() {
  const [lang, setLang] = useStored<Lang>('lang', 'id');
  const [theme, setTheme] = useStored<'dark' | 'light'>('theme', 'light');
  const [tab, setTab] = useState<Tab>(tabFromHash);
  const [draft, setDraft] = useState<Draft | null>(null);
  const t = useMemo(() => makeT(lang), [lang]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.lang = lang;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#0b0f14' : '#ffffff');
  }, [theme, lang]);

  useEffect(() => {
    const onHash = () => setTab(tabFromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const go = useCallback((next: Tab, d?: Draft) => {
    if (d) setDraft(d);
    location.hash = next;
    window.scrollTo({ top: 0 });
  }, []);
  const clearDraft = useCallback(() => setDraft(null), []);

  const p = useAsync(getPrice, [], 60_000);

  // Price alerts: checked on each price refresh while the app is open.
  useEffect(() => {
    const price = p.data?.data.idr;
    if (!price || p.data?.stale) return;
    const alerts = load<Alert[]>('alerts', []);
    const due = dueAlerts(alerts, price);
    if (!due.length) return;
    for (const a of due) {
      notify(
        `BTC ${a.dir === 'above' ? '▲' : '▼'} ${idr(a.priceIdr, lang)}`,
        t('m.alertFired', { price: idr(price, lang), dir: a.dir === 'above' ? '≥' : '≤', target: idr(a.priceIdr, lang) }),
      );
    }
    const ids = new Set(due.map((a) => a.id));
    save(
      'alerts',
      alerts.map((a) => (ids.has(a.id) ? { ...a, active: false, firedAt: Date.now() } : a)),
    );
  }, [p.data, lang, t]);

  const priceState = useMemo(
    () => ({ price: p.data?.data ?? null, at: p.data?.at, stale: p.data?.stale, error: p.error, reload: p.reload }),
    [p.data, p.error, p.reload],
  );

  return (
    <AppCtx.Provider value={{ lang, t }}>
      <PriceCtx.Provider value={priceState}>
        <NavCtx.Provider value={{ go, draft, clearDraft }}>
          <div className="mx-auto min-h-dvh max-w-6xl px-4 pb-28 sm:pb-10">
            <header className="sticky top-0 z-20 -mx-4 mb-4 border-b border-line bg-bg/90 px-4 pt-[env(safe-area-inset-top)] backdrop-blur">
              <div className="flex h-14 items-center justify-between gap-3">
                <a href="#market" className="flex items-center gap-2 font-bold">
                  <img src="/favicon.svg" alt="" className="h-7 w-7" />
                  <span>{t('appName')}</span>
                  {p.data && (
                    <span className="num hidden rounded-lg bg-card px-2 py-0.5 text-sm font-medium text-accent sm:inline">{idr(p.data.data.idr, lang)}</span>
                  )}
                </a>
                <nav className="hidden gap-1 sm:flex">
                  {TABS.map((k) => (
                    <a
                      key={k}
                      href={`#${k}`}
                      className={`rounded-lg px-3 py-1.5 text-sm ${tab === k ? 'bg-accent font-semibold text-accent-fg' : 'text-muted hover:text-fg'}`}
                    >
                      {t(`tab.${k}` as Key)}
                    </a>
                  ))}
                </nav>
                <div className="flex items-center gap-1">
                  <button
                    className="rounded-lg border border-line px-2 py-1 text-xs font-semibold"
                    onClick={() => setLang(lang === 'id' ? 'en' : 'id')}
                    aria-label={t('lang.toggle')}
                    title={t('lang.toggle')}
                  >
                    {lang === 'id' ? 'EN' : 'ID'}
                  </button>
                  <button
                    className="rounded-lg border border-line px-2 py-1 text-sm"
                    onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
                    aria-label={t('theme.toggle')}
                    title={t('theme.toggle')}
                  >
                    {theme === 'dark' ? '☀️' : '🌙'}
                  </button>
                </div>
              </div>
            </header>

            <OfflineBanner />
            <UpdateBanner />

            <main>
              <Suspense fallback={<Loading />}>
                {tab === 'market' && <Market />}
                {tab === 'plan' && <Plan />}
                {tab === 'portfolio' && <Portfolio />}
                {tab === 'explorer' && <Explorer />}
                {tab === 'news' && <News />}
              </Suspense>
            </main>

            <footer className="mt-8 text-center text-xs text-muted">
              <p>{t('disclaimer')}</p>
              <p className="mt-1">Data: CoinGecko · mempool.space · blockchain.com · RSS (CoinDesk, Cointelegraph, Bitcoin Magazine, Decrypt, Google News)</p>
            </footer>

            <InstallPrompt />

            <nav className="fixed inset-x-0 bottom-0 z-20 grid grid-cols-5 border-t border-line bg-bg/95 pb-[env(safe-area-inset-bottom)] backdrop-blur sm:hidden">
              {TABS.map((k) => (
                <a key={k} href={`#${k}`} className={`flex flex-col items-center gap-0.5 py-2 text-[11px] ${tab === k ? 'text-accent' : 'text-muted'}`}>
                  <span className="text-lg leading-none">{ICONS[k]}</span>
                  {t(`tab.${k}` as Key)}
                </a>
              ))}
            </nav>
          </div>
        </NavCtx.Provider>
      </PriceCtx.Provider>
    </AppCtx.Provider>
  );
}
