import { Component, useEffect, useState, type ReactNode } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { dueInstallment, normalizePlan, normalizeTx, type Plan, type Tx } from '../lib/calc';
import { monthLabel } from '../lib/format';
import { useApp } from '../lib/i18n';
import { money } from '../lib/money';
import { useNav } from '../lib/nav';
import { useStored } from '../lib/storage';
import { Btn } from './ui';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const SHOW_AFTER_MS = 30_000;
const SHOW_AFTER_CLICKS = 4;
const SNOOZE_DAYS = 14;

/**
 * Custom install button instead of the browser's default prompt. It appears only after the
 * user has used the app for a while, and a dismissal is remembered for two weeks.
 */
export function InstallPrompt() {
  const { t } = useApp();
  const [evt, setEvt] = useState<BeforeInstallPromptEvent | null>(null);
  const [engaged, setEngaged] = useState(false);
  const [dismissedAt, setDismissedAt] = useStored<number>('installDismissedAt', 0);
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) && !('MSStream' in window);
  const standalone = window.matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;

  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setEvt(e as BeforeInstallPromptEvent);
    };
    window.addEventListener('beforeinstallprompt', onPrompt);
    let clicks = 0;
    const onClick = () => ++clicks >= SHOW_AFTER_CLICKS && setEngaged(true);
    window.addEventListener('click', onClick);
    const timer = setTimeout(() => setEngaged(true), SHOW_AFTER_MS);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('click', onClick);
      clearTimeout(timer);
    };
  }, []);

  const snoozed = Date.now() - dismissedAt < SNOOZE_DAYS * 86_400_000;
  if (standalone || snoozed || !engaged || (!evt && !ios)) return null;

  return (
    <div className="anim-slide-up fixed inset-x-3 bottom-20 z-30 mx-auto max-w-md rounded-2xl border border-accent/50 bg-card p-4 shadow-2xl sm:bottom-6">
      <div className="flex items-start gap-3">
        <img src="/pwa-192.png" alt="" className="anim-wiggle h-10 w-10 rounded-xl" />
        <p className="text-sm">{ios && !evt ? t('install.ios') : t('install.text')}</p>
      </div>
      <div className="mt-3 flex justify-end gap-2">
        <Btn kind="ghost" onClick={() => setDismissedAt(Date.now())}>
          {t('install.later')}
        </Btn>
        {evt && (
          <Btn
            onClick={async () => {
              await evt.prompt();
              const { outcome } = await evt.userChoice;
              if (outcome === 'dismissed') setDismissedAt(Date.now());
              setEvt(null);
            }}
          >
            {t('install.btn')}
          </Btn>
        )}
      </div>
    </div>
  );
}

export function OfflineBanner() {
  const { t } = useApp();
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  if (online) return null;
  return <div className="anim-slide-down mb-4 rounded-xl border border-accent/50 bg-accent/10 p-3 text-sm text-accent">📴 {t('offline')}</div>;
}

export function UpdateBanner() {
  const { t } = useApp();
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, reg) {
      // Check for a new version every hour while the app stays open.
      if (reg) setInterval(() => reg.update(), 60 * 60_000);
    },
  });
  if (!needRefresh) return null;
  return (
    <div className="anim-slide-down mb-4 flex items-center justify-between gap-2 rounded-xl border border-line bg-card p-3 text-sm">
      <span>{t('update.ready')}</span>
      <Btn onClick={() => updateServiceWorker(true)}>{t('update.reload')}</Btn>
    </div>
  );
}

const pad = (n: number) => String(n).padStart(2, '0');

/**
 * Reminds about this month's planned purchase once its day has come and no buy is recorded.
 * Only for people who saved a plan; shown while the app is open (plus one notification per month if allowed).
 */
export function PlanReminder() {
  const { t, lang } = useApp();
  const { go } = useNav();
  const [stored] = useStored<Plan | null>('plan', null);
  const [txs] = useStored<Tx[]>('txs', []);
  const [dismissed, setDismissed] = useStored<string>('remind.dismissed', '');
  const [notified, setNotified] = useStored<string>('remind.notified', '');
  const plan = stored ? normalizePlan(stored) : null;
  const month = plan ? dueInstallment(plan, txs.map(normalizeTx)) : null;
  const text = plan && month ? t('remind.text', { month: monthLabel(`${month}-01T00:00:00`, lang), amount: money(plan.monthly, plan.ccy, lang) }) : '';

  useEffect(() => {
    if (!month || notified === month || typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
    setNotified(month);
    navigator.serviceWorker
      ?.getRegistration()
      .then((reg) => reg?.showNotification(t('remind.title'), { body: text, icon: '/pwa-192.png', badge: '/pwa-192.png', tag: 'btc-plan' }))
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month]);

  if (!plan || !month || dismissed === month) return null;
  const now = new Date();
  const date = `${month}-${pad(Math.min(now.getDate(), 31))}`;
  return (
    <div className="anim-slide-down mb-4 flex items-center justify-between gap-2 rounded-xl border border-accent/50 bg-accent/10 p-3 text-sm">
      <span>🗓️ {text}</span>
      <span className="flex shrink-0 items-center gap-1">
        <Btn onClick={() => go('portfolio', { date, total: plan.monthly, ccy: plan.ccy })}>{t('remind.record')}</Btn>
        <button className="px-2 text-muted hover:text-fg" aria-label={t('remind.dismiss')} onClick={() => setDismissed(month)}>
          ✕
        </button>
      </span>
    </div>
  );
}

/** Last-resort screen so a crash in one page does not leave a blank app. Saved data is untouched. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: unknown }> {
  state = { error: null as unknown };
  static getDerivedStateFromError(error: unknown) {
    return { error };
  }
  componentDidCatch(error: unknown) {
    console.error(error);
  }
  render() {
    if (!this.state.error) return this.props.children;
    const en = document.documentElement.lang === 'en';
    return (
      <div className="mx-auto grid min-h-dvh max-w-md place-content-center gap-3 p-6 text-center">
        <h1 className="text-lg font-bold">{en ? 'Something went wrong' : 'Terjadi kesalahan'}</h1>
        <p className="text-sm text-muted">
          {en ? 'Your saved data is safe. Reload to continue.' : 'Data yang tersimpan tetap aman. Muat ulang untuk melanjutkan.'}
        </p>
        <p className="break-words font-mono text-xs text-muted">{String(this.state.error).slice(0, 200)}</p>
        <button className="mx-auto rounded-xl bg-accent px-4 py-2 text-sm font-medium text-accent-fg" onClick={() => location.reload()}>
          {en ? 'Reload' : 'Muat ulang'}
        </button>
      </div>
    );
  }
}
