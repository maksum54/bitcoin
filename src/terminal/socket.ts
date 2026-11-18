/**
 * A WebSocket that reconnects with backoff, sends its subscriptions on every open,
 * keeps itself alive with a ping where the venue needs one, and stays closed
 * while the page is hidden (reopening when it is shown again).
 */
export interface SocketOpts {
  url: string;
  /** Messages sent after each open (subscriptions). */
  subscribe?: unknown[];
  ping?: { ms: number; msg: string };
  onMessage: (raw: string) => void;
  onStatus?: (live: boolean) => void;
  /** Called after a reconnect, so the caller can refetch anything it may have missed. */
  onReopen?: () => void;
}

const HIDDEN_CLOSE_MS = 30_000;

export function openSocket(o: SocketOpts): () => void {
  let ws: WebSocket | null = null;
  let closed = false;
  let retry = 0;
  let opened = false;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let hiddenTimer: ReturnType<typeof setTimeout> | undefined;
  let pingTimer: ReturnType<typeof setInterval> | undefined;

  const connect = () => {
    if (closed || ws) return;
    let sock: WebSocket;
    try {
      sock = new WebSocket(o.url);
    } catch {
      schedule();
      return;
    }
    ws = sock;
    sock.onopen = () => {
      retry = 0;
      for (const m of o.subscribe ?? []) sock.send(typeof m === 'string' ? m : JSON.stringify(m));
      if (o.ping) pingTimer = setInterval(() => sock.readyState === 1 && sock.send(o.ping!.msg), o.ping.ms);
      o.onStatus?.(true);
      if (opened) o.onReopen?.();
      opened = true;
    };
    sock.onmessage = (ev) => o.onMessage(String(ev.data));
    sock.onerror = () => sock.close();
    sock.onclose = () => {
      clearInterval(pingTimer);
      if (ws !== sock) return;
      ws = null;
      o.onStatus?.(false);
      if (!closed && document.visibilityState !== 'hidden') schedule();
    };
  };

  const schedule = () => {
    clearTimeout(retryTimer);
    retryTimer = setTimeout(connect, Math.min(30_000, 1000 * 2 ** retry++));
  };

  const onVisibility = () => {
    clearTimeout(hiddenTimer);
    if (document.visibilityState === 'hidden') {
      hiddenTimer = setTimeout(() => {
        const s = ws;
        ws = null;
        clearInterval(pingTimer);
        s?.close();
        o.onStatus?.(false);
      }, HIDDEN_CLOSE_MS);
    } else if (!ws && !closed) {
      clearTimeout(retryTimer);
      retry = 0;
      connect();
    }
  };
  document.addEventListener('visibilitychange', onVisibility);
  connect();

  return () => {
    closed = true;
    clearTimeout(retryTimer);
    clearTimeout(hiddenTimer);
    clearInterval(pingTimer);
    document.removeEventListener('visibilitychange', onVisibility);
    const s = ws;
    ws = null;
    s?.close();
  };
}
