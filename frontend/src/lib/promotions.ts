import { useEffect, useState } from 'react';
import type { Promotion } from './api';

export function usePromotionClock(items: readonly { promotion?: Promotion }[]) {
  const [clock, setClock] = useState(Date.now);
  const now = Math.max(clock, Date.now());
  const expiry = items.reduce((earliest, item) => item.promotion && item.promotion.until > now ? Math.min(earliest, item.promotion.until) : earliest, Infinity);
  useEffect(() => {
    if (!Number.isFinite(expiry)) return;
    const timer = setTimeout(() => setClock(Date.now()), Math.min(Math.max(expiry - Date.now() + 20, 1), 2147483647));
    return () => clearTimeout(timer);
  }, [expiry]);
  useEffect(() => {
    const update = () => setClock(Date.now());
    window.addEventListener('focus', update);
    document.addEventListener('visibilitychange', update);
    return () => { window.removeEventListener('focus', update); document.removeEventListener('visibilitychange', update); };
  }, []);
  return now;
}

export function currentPromotion<T extends { promotion?: Promotion }>(item: T, now: number): T {
  return item.promotion && item.promotion.until <= now ? { ...item, promotion: undefined } : item;
}
