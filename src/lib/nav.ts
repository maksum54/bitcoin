import { createContext, useContext } from 'react';
import type { Ccy } from './money';

export type Tab = 'market' | 'plan' | 'portfolio' | 'explorer' | 'news';
export const TABS: Tab[] = ['market', 'plan', 'portfolio', 'explorer', 'news'];

export interface Draft {
  date: string;
  total: number;
  ccy: Ccy;
}

export const NavCtx = createContext<{ go: (t: Tab, draft?: Draft) => void; draft: Draft | null; clearDraft: () => void }>({
  go: () => {},
  draft: null,
  clearDraft: () => {},
});
export const useNav = () => useContext(NavCtx);
