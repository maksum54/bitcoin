import { useEffect, useState } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { useApp } from '../lib/i18n';
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
    <div className="fixed inset-x-3 bottom-20 z-30 mx-auto max-w-md rounded-2xl border border-accent/50 bg-card p-4 shadow-2xl sm:bottom-6">
      <div className="flex items-start gap-3">
        <img src="/pwa-192.png" alt="" className="h-10 w-10 rounded-xl" />
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
  return <div className="mb-4 rounded-xl border border-accent/50 bg-accent/10 p-3 text-sm text-accent">📴 {t('offline')}</div>;
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
    <div className="mb-4 flex items-center justify-between gap-2 rounded-xl border border-line bg-card p-3 text-sm">
      <span>{t('update.ready')}</span>
      <Btn onClick={() => updateServiceWorker(true)}>{t('update.reload')}</Btn>
    </div>
  );
}
