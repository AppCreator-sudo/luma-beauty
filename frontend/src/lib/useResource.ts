import { useEffect, useRef, useState } from 'react';

export function useResource<T>(load: () => Promise<T>, deps: readonly unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const generation = useRef(0);
  useEffect(() => {
    const request = ++generation.current;
    setLoading(true);
    setError('');
    load().then(value => { if (generation.current === request) setData(value); }).catch(reason => { if (generation.current === request) setError(reason instanceof Error ? reason.message : 'Ошибка загрузки'); }).finally(() => { if (generation.current === request) setLoading(false); });
    return () => { generation.current++; };
    // Dependency list is supplied by the caller to match the request key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return { data, error, loading, setData, reload: () => {
    const request = ++generation.current;
    setLoading(true);
    setError('');
    return load().then(value => { if (generation.current === request) setData(value); }).catch(reason => { if (generation.current === request) setError(reason instanceof Error ? reason.message : 'Ошибка загрузки'); }).finally(() => { if (generation.current === request) setLoading(false); });
  } };
}
