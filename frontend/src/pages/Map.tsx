import { useEffect, useRef, useState } from 'react';
import { LocateFixed, MapPin, Search, X } from 'lucide-react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import '../map-viewport.css';
import { api, masterTime } from '../lib/api';
import { mapIdentity as identity, type MapMaster } from '../lib/map';
import { MapProfileCard } from '../components/MapProfileCard';
import { EmptyState, ErrorState, Loading } from '../components/Shell';
import directions from '../../../lib/categories.json';
import { PromotionBadge } from '../components/PromotionBadge';
import { currentPromotion, usePromotionClock } from '../lib/promotions';

type Bounds = [number, number, number, number];
type MapCluster = { id: string; count: number; latitude: number; longitude: number; bounds: Bounds; promotedCount?: number };
type MapPageData = { total: number; listTotal: number; points: MapMaster[]; clusters: MapCluster[]; items: MapMaster[]; next: string | null; bounds: Bounds | null; selectedCluster: string | null; nextPromotionExpiry?: string | null };
type View = { filterKey: string; bbox: Bounds; zoom: number };
type Result = { data: MapPageData | null; key: string; filterKey: string; loading: boolean; error: string };
const filters = (query: string, category: string, soon: boolean) => new URLSearchParams({ q: query, category: category === 'Все' ? '' : category, ...(soon ? { soon: 'true' } : {}) }).toString();
const wrap = (value: number) => ((value + 180) % 360 + 360) % 360 - 180;
function viewport(instance: L.Map, filterKey: string): View {
  const b = instance.getBounds(), round = (value: number) => Number(value.toFixed(6));
  const world = b.getEast() - b.getWest() >= 360;
  return { filterKey, bbox: [world ? -180 : round(wrap(b.getWest())), round(Math.max(-90, b.getSouth())), world ? 180 : round(wrap(b.getEast())), round(Math.min(90, b.getNorth()))], zoom: Math.max(0, Math.min(18, Math.round(instance.getZoom()))) };
}
function leafletBounds(bounds: Bounds) {
  const [west, south, east, north] = bounds;
  return L.latLngBounds([south, west], [north, east < west ? east + 360 : east]);
}
function useMapResult(key: string, filterKey: string) {
  const [retry, setRetry] = useState(0);
  const [result, setResult] = useState<Result>({ data: null, key: '', filterKey: '', loading: true, error: '' });
  useEffect(() => {
    const controller = new AbortController();
    setResult(value => ({ ...value, loading: true, error: '' }));
    api<MapPageData>('/map/viewport?' + key, { signal: controller.signal })
      .then(data => { if (!controller.signal.aborted) setResult({ data, key, filterKey, loading: false, error: '' }); })
      .catch(reason => { if (!controller.signal.aborted) setResult(value => ({ ...value, loading: false, error: reason instanceof Error ? reason.message : 'Не удалось загрузить карту' })); });
    return () => controller.abort();
  }, [key, filterKey, retry]);
  return { ...result, reload: () => setRetry(value => value + 1) };
}

export function MapPage() {
  const [query, setQuery] = useState(() => new URLSearchParams(window.location.search).get('q') || ''), [search, setSearch] = useState(''), [category, setCategory] = useState('Все');
  const [soon, setSoon] = useState(false), [selection, setSelection] = useState<{ filterKey: string; profile: MapMaster } | null>(null);
  const [viewState, setViewState] = useState<View | null>(null), [cluster, setCluster] = useState<{ filterKey: string; id: string } | null>(null);
  const [message, setMessage] = useState('');
  const element = useRef<HTMLDivElement>(null), listElement = useRef<HTMLDivElement>(null), canvas = useRef<HTMLDivElement>(null), map = useRef<L.Map | null>(null), markers = useRef<L.LayerGroup | null>(null);
  const bootstrap = useRef(''), moveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => { const timer = setTimeout(() => setSearch(query.trim()), 250); return () => clearTimeout(timer); }, [query]);
  const filterKey = filters(search, category, soon);
  const filterRef = useRef(filterKey); filterRef.current = filterKey;
  const view = viewState?.filterKey === filterKey ? viewState : null;
  const params = new URLSearchParams(filterKey); params.set('zoom', String(view?.zoom ?? 4));
  if (view) params.set('bbox', view.bbox.join(','));
  const selectedCluster = cluster?.filterKey === filterKey ? cluster.id : '';
  if (selectedCluster && view) params.set('cluster', selectedCluster);
  const key = params.toString(), keyRef = useRef(key); keyRef.current = key;
  const result = useMapResult(key, filterKey), ready = result.key === key;
  const reloadRef = useRef(result.reload); reloadRef.current = result.reload;
  const data = result.filterKey === filterKey ? result.data : null;
  const [more, setMore] = useState<{ key: string; items: MapMaster[]; next: string | null; loading: boolean; error: string }>({ key: '', items: [], next: null, loading: false, error: '' });
  const moreRequest = useRef<AbortController | null>(null);
  useEffect(() => { moreRequest.current?.abort(); moreRequest.current = null; }, [key]);
  useEffect(() => () => moreRequest.current?.abort(), []);
  const candidates = [...(data?.points || []), ...(ready ? data?.items || [] : []), ...(more.key === key ? more.items : [])];
  const promotionTime = usePromotionClock(candidates);
  const points = (data?.points || []).map(p => currentPromotion(p, promotionTime));
  const seen = new Set<string>();
  const items = (ready ? [...(data?.items || []), ...(more.key === key ? more.items : [])] : []).filter(p => { const id = identity(p); if (seen.has(id)) return false; seen.add(id); return true; }).map(p => currentPromotion(p, promotionTime));
  const next = more.key === key ? more.next : ready ? data?.next : null;
  const selected = selection?.filterKey === filterKey ? currentPromotion(selection.profile, promotionTime) : null;
  const shownPoints = selected && selected.latitude != null && selected.longitude != null && !points.some(p => identity(p) === identity(selected)) ? [...points, selected] : points;
  const markerKey = JSON.stringify({ points: shownPoints, clusters: data?.clusters || [], selected: selected ? identity(selected) : null });
  useEffect(() => {
    if (!soon) return;
    const refresh = () => { if (!document.hidden) { moreRequest.current?.abort(); moreRequest.current = null; setMore({ key: '', items: [], next: null, loading: false, error: '' }); reloadRef.current(); } };
    const timer = setInterval(refresh, 60000);
    window.addEventListener('focus', refresh); document.addEventListener('visibilitychange', refresh);
    return () => { clearInterval(timer); window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', refresh); };
  }, [soon]);
  useEffect(() => {
    const expiry = data?.nextPromotionExpiry ? Date.parse(data.nextPromotionExpiry) : NaN;
    if (!Number.isFinite(expiry)) return;
    const refresh = () => {
      if (Date.now() < expiry) return;
      setCluster(null); setMore({ key: '', items: [], next: null, loading: false, error: '' });
      reloadRef.current();
    };
    const timer = setTimeout(refresh, Math.min(Math.max(expiry - Date.now() + 30, 1), 2147483647));
    window.addEventListener('focus', refresh); document.addEventListener('visibilitychange', refresh);
    return () => { clearTimeout(timer); window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', refresh); };
  }, [data?.nextPromotionExpiry]);
  const handlers = useRef({ showCluster: (_value: MapCluster) => {}, select: (_value: MapMaster) => {} });
  handlers.current.select = profile => {
    if (!ready || result.loading || result.error) return;
    setSelection({ filterKey: filterRef.current, profile }); setMessage('');
    if (window.matchMedia('(max-width: 800px)').matches) canvas.current?.scrollIntoView({ block: 'nearest', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
  };
  handlers.current.showCluster = value => {
    if (!ready || result.loading || result.error) return;
    const instance = map.current; if (!instance) return;
    const [west, south, east, north] = value.bounds;
    if (instance.getZoom() >= 18 || Math.abs(east - west) < .000001 && Math.abs(north - south) < .000001) {
      setCluster({ filterKey: filterRef.current, id: value.id });
      listElement.current?.scrollIntoView({ block: 'nearest', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
    } else {
      const currentZoom = instance.getZoom();
      instance.fitBounds(leafletBounds(value.bounds), { padding: [45, 45], maxZoom: Math.min(18, currentZoom + 3), animate: false });
      if (instance.getZoom() <= currentZoom) instance.setView([value.latitude, value.longitude], Math.min(18, currentZoom + 2));
    }
  };
  function capture(instance: L.Map) {
    if (bootstrap.current !== filterRef.current) return;
    const fresh = viewport(instance, filterRef.current);
    setViewState(previous => previous && JSON.stringify(previous) === JSON.stringify(fresh) ? previous : fresh);
    setCluster(null);
  }
  function chooseCategory(value: string) {
    if (value === category) return;
    const freshKey = filters(search, value, soon);
    if (map.current && bootstrap.current === filterKey) {
      bootstrap.current = freshKey;
      setViewState(viewport(map.current, freshKey));
      map.current.closePopup();
    }
    setCategory(value); setCluster(null);
  }
  function chooseSoon(value: boolean) {
    const freshKey = filters(search, category, value);
    if (map.current && bootstrap.current === filterKey) {
      bootstrap.current = freshKey;
      setViewState(viewport(map.current, freshKey));
    }
    setSoon(value); setCluster(null); setSelection(null);
  }
  function keepPointVisible(card: HTMLElement) {
    const instance = map.current, frame = canvas.current;
    if (!instance || !frame || !selected || selected.latitude == null || selected.longitude == null) return;
    const size = instance.getSize(), point = instance.latLngToContainerPoint([selected.latitude, selected.longitude]);
    const cardBox = card.getBoundingClientRect(), frameBox = frame.getBoundingClientRect();
    const left = cardBox.left - frameBox.left, top = cardBox.top - frameBox.top;
    const onCard = point.x > left - 30 && point.x < left + cardBox.width + 30 && point.y > top - 25;
    const outside = point.x < 35 || point.x > size.x - 35 || point.y < 65 || point.y > size.y - 30;
    if (!onCard && !outside) return;
    const target = window.matchMedia('(max-width: 800px)').matches
      ? L.point(size.x / 2, Math.max(80, top / 2))
      : L.point(Math.max(65, Math.min(size.x / 2, left / 2)), Math.max(80, size.y / 2));
    instance.panBy(point.subtract(target), { animate: false });
  }
  useEffect(() => {
    if (!element.current) return;
    const instance = L.map(element.current, { zoomControl: false, attributionControl: false, maxZoom: 18 }).setView([56.5, 84], 4);
    L.control.attribution({ prefix: false }).addTo(instance);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>', maxZoom: 18 }).addTo(instance);
    L.control.zoom({ position: 'topright' }).addTo(instance);
    map.current = instance; markers.current = L.layerGroup().addTo(instance);
    const moved = () => {
      if (bootstrap.current !== filterRef.current) return;
      if (moveTimer.current) clearTimeout(moveTimer.current);
      moveTimer.current = setTimeout(() => capture(instance), 220);
    };
    instance.on('moveend', moved);
    const observer = new ResizeObserver(() => instance.invalidateSize({ debounceMoveend: true })); observer.observe(element.current);
    return () => { if (moveTimer.current) clearTimeout(moveTimer.current); observer.disconnect(); instance.off('moveend', moved); instance.remove(); map.current = null; markers.current = null; };
  }, []);
  useEffect(() => {
    if (!ready || !data || !map.current || bootstrap.current === filterKey) return;
    const instance = map.current; bootstrap.current = filterKey; instance.closePopup();
    if (data.bounds) instance.fitBounds(leafletBounds(data.bounds), { padding: [45, 45], maxZoom: data.total === 1 ? 16 : 11, animate: false });
    capture(instance);
    // Fit only once per search; moving the map must never trigger a fit back to results.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, data, filterKey]);
  useEffect(() => {
    const layer = markers.current; if (!layer) return; layer.clearLayers();
    for (const profile of shownPoints) {
      if (profile.latitude == null || profile.longitude == null) continue;
      const isSelected = selected && identity(profile) === identity(selected);
      const icon = L.divIcon({ className: 'atelier-marker' + (profile.promotion ? ' atelier-marker-promoted' : '') + (isSelected ? ' atelier-marker-selected' : ''), html: profile.promotion ? '<span>★</span>' : '<span>L</span>', iconSize: [40, 40], iconAnchor: [20, 40] });
      const marker = L.marker([profile.latitude, profile.longitude], { icon, zIndexOffset: (profile.promotion ? 1000 : 0) + (isSelected ? 2000 : 0), title: profile.name }).addTo(layer);
      marker.on('click', () => handlers.current.select(profile));
      marker.getElement()?.setAttribute('aria-label', 'Открыть точку: ' + profile.name);
      marker.getElement()?.setAttribute('aria-pressed', String(Boolean(isSelected)));
    }
    for (const group of data?.clusters || []) {
      const promoted = Boolean(group.promotedCount);
      const icon = L.divIcon({ className: 'atelier-cluster' + (promoted ? ' atelier-cluster-promoted' : ''), html: '<span>' + group.count + (promoted ? '<small>★</small>' : '') + '</span>', iconSize: [48, 48], iconAnchor: [24, 24] });
      const marker = L.marker([group.latitude, group.longitude], { icon, title: 'Группа: ' + group.count, zIndexOffset: promoted ? 500 : 0 }).addTo(layer);
      marker.getElement()?.setAttribute('aria-label', 'Группа: ' + group.count + ' мастеров и салонов' + (promoted ? ', есть реклама' : ''));
      marker.on('click', () => handlers.current.showCluster(group));
    }
    // Rebuild only when actual marker data or promotion expiry changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [markerKey]);
  async function loadMore() {
    if (!next || !ready || result.loading || moreRequest.current && !moreRequest.current.signal.aborted) return;
    const requestKey = key, controller = new AbortController(); moreRequest.current?.abort(); moreRequest.current = controller;
    setMore(value => ({ key: requestKey, items: value.key === requestKey ? value.items : [], next, loading: true, error: '' }));
    try {
      const page = await api<MapPageData>('/map/viewport?' + requestKey + '&cursor=' + encodeURIComponent(next), { signal: controller.signal });
      if (!controller.signal.aborted && keyRef.current === requestKey) setMore(value => ({ key: requestKey, items: [...(value.key === requestKey ? value.items : []), ...page.items], next: page.next, loading: false, error: '' }));
    } catch (reason) { if (!controller.signal.aborted && keyRef.current === requestKey) setMore(value => ({ ...value, loading: false, error: reason instanceof Error ? reason.message : 'Не удалось загрузить мастеров' })); }
    finally { if (moreRequest.current === controller) moreRequest.current = null; }
  }
  function refreshList() {
    moreRequest.current?.abort(); moreRequest.current = null;
    setMore({ key: '', items: [], next: null, loading: false, error: '' });
    setCluster(null); result.reload();
  }
  function locate() {
    if (!navigator.geolocation) { setMessage('Геолокация недоступна на этом устройстве.'); return; }
    navigator.geolocation.getCurrentPosition(position => {
      const instance = map.current; if (!instance) return;
      bootstrap.current = filterRef.current; setCluster(null);
      instance.flyTo([position.coords.latitude, position.coords.longitude], 13, { duration: 1 });
      setMessage('Местоположение определено.');
    }, () => setMessage('Не удалось определить местоположение. Проверьте разрешение браузера.'));
  }
  return <div className="map-page">
    <div className="container map-heading"><span className="eyebrow">КРАСОТА РЯДОМ</span><h1>Мастера и салоны <em>на карте.</em></h1><p>Посмотрите, кто работает рядом.</p></div>
    <div className="map-layout"><aside className="map-sidebar">
      <div className="map-filters"><label className="search-field"><Search size={17}/><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Город, мастер или салон" aria-label="Поиск на карте"/></label>
      <div className="map-categories" role="group" aria-label="Направление на карте">{['Все', ...directions].map(item => <button type="button" aria-pressed={category === item} key={item} className={category === item ? 'active' : ''} onClick={() => chooseCategory(item)}>{item}</button>)}</div>
      <label className="map-soon"><input type="checkbox" checked={soon} onChange={event => chooseSoon(event.target.checked)}/><span>Есть время в ближайший час</span></label>
      <div className="map-result-count" role="status">{result.loading || !ready && !result.error ? 'Ищем на карте…' : selectedCluster ? 'В этом месте: ' + (data?.listTotal || 0) : 'В этой области: ' + (data?.total || 0)}</div>
      {selectedCluster ? <button className="map-group-reset text-link" type="button" onClick={() => setCluster(null)}><X size={14}/> Все в этой области</button> : null}</div>
      <div className="map-results" ref={listElement} aria-busy={result.loading}>{result.error ? <ErrorState message={result.error} retry={selectedCluster ? () => setCluster(null) : result.reload}/> : !ready ? <Loading text="Ищем мастеров…"/> : items.length ? <>
        {items.map(profile => <div key={identity(profile)} className={'map-entry' + (profile.promotion ? ' map-entry-promoted' : '') + (selected && identity(selected) === identity(profile) ? ' map-entry-selected' : '')}><button type="button" className="map-result" aria-label={'Открыть карточку: ' + profile.name} aria-pressed={Boolean(selected && identity(selected) === identity(profile))} onClick={() => handlers.current.select(profile)} disabled={result.loading}>{profile.avatar ? <img src={profile.avatar} alt="" loading="lazy"/> : <span className="mini-avatar">L</span>}<span><strong>{profile.name}</strong><small><MapPin size={13}/>{(profile.categories || [profile.category]).join(', ')} · {profile.city}</small>{profile.availability && profile.availability.start > Date.now() ? <span className="map-entry-time">Ближайшая запись · {masterTime(profile.availability.start, profile.availability.utc_offset)}</span> : null}</span><span aria-hidden="true">→</span></button><PromotionBadge promotion={profile.promotion}/></div>)}
        {next && !(more.key === key && more.error) ? <button className="button button-outline map-load-more" type="button" onClick={loadMore} disabled={more.key === key && more.loading}>{more.key === key && more.loading ? 'Загружаем…' : 'Показать ещё'}</button> : null}
        {more.key === key && more.error ? <><p className="form-error" role="alert">{more.error}</p><button className="button button-outline map-load-more" type="button" onClick={refreshList}>Обновить список</button></> : null}
      </> : <EmptyState title="Здесь пока никого нет" text="Передвиньте карту или измените поиск."/>}</div>
  </aside><div className="map-canvas-wrap" ref={canvas}>
      <div ref={element} className="map-canvas" role="region" aria-label="Интерактивная карта мастеров и салонов"/>
      {points.some(p => p.promotion) || data?.clusters.some(c => c.promotedCount) ? <div className="map-promotion-legend">★ Золотые точки — есть реклама</div> : null}
      <button className="map-locate" type="button" onClick={locate} aria-label="Найти мастеров рядом"><LocateFixed size={19}/></button>
      {message ? <div className="map-message" role="status">{message}</div> : null}
      {selected ? <MapProfileCard key={identity(selected)} profile={selected} category={category === 'Все' ? '' : category} soon={soon} onClose={() => setSelection(null)} onLayout={keepPointVisible}/> : null}
    </div></div>
  </div>;
}
