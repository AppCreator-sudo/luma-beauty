import { useCallback, useEffect, useRef, useState } from 'react';

export type MorePage<T, P> = { items: T[]; next: P | null };
type Snapshot<T, P> = MorePage<T, P> & { key: string; at: number; batches: number };
const snapshots = new Map<string, Snapshot<unknown, unknown>>();
const storageKey = (key: string) => 'luma.more.v1:' + key;

function read<T, P>(key: string): Snapshot<T, P> | null {
  try {
    const value = snapshots.get(key) || JSON.parse(sessionStorage.getItem(storageKey(key)) || 'null');
    if (value?.key === key && Array.isArray(value.items) && Number.isFinite(value.at)) return { ...value, batches: Number.isInteger(value.batches) && value.batches > 0 ? value.batches : 1 };
  } catch { /* Storage is optional. */ }
  return null;
}
function remember<T, P>(value: Snapshot<T, P>) {
  snapshots.delete(value.key);
  snapshots.set(value.key, value);
  if (snapshots.size > 16) snapshots.delete(snapshots.keys().next().value!);
  try { sessionStorage.setItem(storageKey(value.key), JSON.stringify(value)); } catch { /* Quota or private browsing. */ }
}

// Only public catalogue data is cached. A generation guard prevents old filters
// or duplicate clicks from appending to a different list.
export function useMore<T, P>(key: string, initial: P, load: (position: P) => Promise<MorePage<T, P>>, identity: (item: T) => string) {
  const [data, setData] = useState<Snapshot<T, P> | null>(() => read(key));
  const [loading, setLoading] = useState(!data || Date.now() - data.at >= 60000), [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(''), [moreError, setMoreError] = useState('');
  const generation = useRef(0), locked = useRef(false), currentKey = useRef(key);
  const args = useRef({ key, initial, load, identity });
  args.current = { key, initial, load, identity };
  currentKey.current = key;
  const reload = useCallback(async () => {
    const a = args.current, ticket = ++generation.current;
    locked.current = false; setLoadingMore(false); setMoreError(''); setLoading(true); setError('');
    try {
      // Refresh expired public data without losing how far the visitor browsed.
      // Follow fresh cursors, since the catalogue may have changed meanwhile.
      const requestedBatches = read<T, P>(a.key)?.batches || 1;
      const seen = new Set<string>(), items: T[] = [];
      let position = a.initial, next: P | null = null, batches = 0;
      do {
        const page = await a.load(position);
        if (generation.current !== ticket || currentKey.current !== a.key) return;
        for (const item of page.items) { const id = a.identity(item); if (!seen.has(id)) { seen.add(id); items.push(item); } }
        next = JSON.stringify(page.next) === JSON.stringify(position) ? null : page.next;
        batches++;
        if (next === null) break;
        position = next;
      } while (batches < requestedBatches);
      const value = { items, next, batches, key: a.key, at: Date.now() };
      remember(value); setData(value);
    } catch (reason) {
      if (generation.current === ticket && currentKey.current === a.key) setError(reason instanceof Error ? reason.message : 'Не удалось загрузить');
    } finally { if (generation.current === ticket) setLoading(false); }
  }, []);
  useEffect(() => {
    generation.current++; locked.current = false; setLoadingMore(false); setMoreError(''); setError('');
    const cached = read<T, P>(key);
    if (cached && Date.now() - cached.at < 60000) { setData(cached); setLoading(false); } else { setData(null); void reload(); }
    return () => { generation.current++; locked.current = false; };
  }, [key, reload]);
  const ready = !loading && data?.key === key;
  async function more() {
    if (!ready || !data || data.next === null || locked.current) return;
    locked.current = true; setLoadingMore(true); setMoreError('');
    const a = args.current, ticket = generation.current, previous = data;
    try {
      const page = await a.load(previous.next!);
      if (generation.current !== ticket || currentKey.current !== a.key) return;
      const seen = new Set(previous.items.map(a.identity));
      const added = page.items.filter(item => { const id = a.identity(item); if (seen.has(id)) return false; seen.add(id); return true; });
      const next = JSON.stringify(page.next) === JSON.stringify(previous.next) ? null : page.next;
      const value = { items: [...previous.items, ...added], next, batches: previous.batches + 1, key: a.key, at: Date.now() };
      remember(value); setData(value);
    } catch (reason) {
      if (generation.current === ticket && currentKey.current === a.key) setMoreError(reason instanceof Error ? reason.message : 'Не удалось загрузить следующие карточки');
    } finally {
      if (generation.current === ticket) { locked.current = false; setLoadingMore(false); }
    }
  }
  return { data: ready ? data : null, ready, loading, error, loadingMore, moreError, more, reload };
}
