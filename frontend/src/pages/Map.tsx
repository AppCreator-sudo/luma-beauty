import {ProfileBadges} from '../components/ProfileBadges';
import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, Flower2, List, LocateFixed, Map as MapIcon, MapPin, Search, SlidersHorizontal, X } from 'lucide-react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import '../map-viewport.css';
import { api, masterTime } from '../lib/api';
import { mapIdentity as identity, type MapMaster } from '../lib/map';
import { MapRating } from '../components/MapRating';
import { MapProfileCard } from '../components/MapProfileCard';
import { MapFiltersSheet } from '../components/MapFiltersSheet';
import { useHistoryState } from '../lib/useHistoryState';
import directions from '../../../lib/categories.json';
import { PromotionBadge } from '../components/PromotionBadge';
import { currentPromotion, usePromotionClock } from '../lib/promotions';

type Bounds = [number, number, number, number];
type MapCluster = { id: string; count: number; latitude: number; longitude: number; bounds: Bounds; promotedCount?: number };
type MapPageData = { total: number; listTotal: number; points: MapMaster[]; clusters: MapCluster[]; items: MapMaster[]; next: string | null; bounds: Bounds | null; selectedCluster: string | null; nextPromotionExpiry?: string | null };
type View = { filterKey: string; bbox: Bounds; zoom: number };
type Result = { data: MapPageData | null; key: string; filterKey: string; loading: boolean; error: string };
type More = { key: string; items: MapMaster[]; next: string | null; loading: boolean; error: string };
type MapSnapshot = { query: string; category: string; soon: boolean; view: View | null; cluster: { filterKey: string; id: string } | null; result: Result; more: More; scroll: number; at: number };
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
function useMapResult(key: string, filterKey: string, cached?: Result) {
  const [retry, setRetry] = useState(0);
  const [result, setResult] = useState<Result>(() => cached?.key === key ? cached : { data: null, key: '', filterKey: '', loading: true, error: '' });
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
  // Public search/view data stays on this history entry, without adding entries
  // for map movements. Returning from a profile/booking restores the same place.
  const [restored] = useState<MapSnapshot | undefined>(() => window.history.state?.usr?.mapView);
  const [query, setQuery] = useState(() => restored?.query ?? new URLSearchParams(window.location.search).get('q') ?? ''), [search, setSearch] = useState(query.trim()), [category, setCategory] = useState(restored?.category || 'Все');
  const [soon, setSoon] = useState(restored?.soon || false);
  const [selection, setSelection] = useHistoryState<{ filterKey: string; profile: MapMaster } | null>('map-selection', null, { flow: true });
  const [display, setDisplay] = useHistoryState<'map' | 'list'>('map-display', 'map');
  const [filtersOpen, setFiltersOpen] = useHistoryState('map-filters', false, { flow: true, transient: true });
  const filterButton = useRef<HTMLButtonElement>(null);
  const displayRef = useRef(display); displayRef.current = display;
  const [viewState, setViewState] = useState<View | null>(restored?.view || null);
  const [cluster, setCluster] = useHistoryState<{ filterKey: string; id: string } | null>('map-cluster', () => restored?.cluster || null);
  const [message, setMessage] = useState(''), [tileError, setTileError] = useState(false);
  const element = useRef<HTMLDivElement>(null), listElement = useRef<HTMLDivElement>(null), canvas = useRef<HTMLDivElement>(null), map = useRef<L.Map | null>(null), markers = useRef<L.LayerGroup | null>(null);
  const bootstrap = useRef(''), moveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const preserveGroup = useRef(false);
  const cardLayout = useRef<(card: HTMLElement) => void>(() => {});
  useEffect(() => { const timer = setTimeout(() => setSearch(query.trim()), 250); return () => clearTimeout(timer); }, [query]);
  const filterKey = filters(search, category, soon);
  const filterRef = useRef(filterKey); filterRef.current = filterKey;
  const view = viewState?.filterKey === filterKey ? viewState : null;
  const params = new URLSearchParams(filterKey); params.set('zoom', String(view?.zoom ?? 4));
  if (view) params.set('bbox', view.bbox.join(','));
  const selectedCluster = cluster?.filterKey === filterKey ? cluster.id : '';
  if (selectedCluster && view) params.set('cluster', selectedCluster);
  const key = params.toString(), keyRef = useRef(key); keyRef.current = key;
  const recent = restored && Date.now() - restored.at < 60000;
  const result = useMapResult(key, filterKey, recent ? restored.result : undefined), ready = result.key === key;
  const reloadRef = useRef(result.reload); reloadRef.current = result.reload;
  const data = result.filterKey === filterKey ? result.data : null;
  const [more, setMore] = useState<More>(() => recent ? { ...restored.more, loading: false } : { key: '', items: [], next: null, loading: false, error: '' });
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
    const raw = window.history.state;
    if (!window.location.pathname.endsWith('/map')) return;
    window.history.replaceState({ ...raw, usr: { ...raw?.usr, mapView: { query, category, soon, view: viewState, cluster, result: { data: result.data, key: result.key, filterKey: result.filterKey, loading: false, error: result.error }, more, scroll: listElement.current?.scrollTop || 0, at: Date.now() } satisfies MapSnapshot } }, '');
  }, [query, category, soon, viewState, cluster, result.data, result.key, result.filterKey, result.error, more, display, selected]);
  useEffect(() => {
    if (!restored?.scroll || !ready) return;
    const frame = requestAnimationFrame(() => listElement.current?.scrollTo({ top: restored.scroll, behavior: 'instant' }));
    return () => cancelAnimationFrame(frame);
  }, [restored, ready]);
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
    setDisplay('map'); setSelection({ filterKey: filterRef.current, profile }); setMessage('');
  };
  handlers.current.showCluster = value => {
    if (!ready || result.loading || result.error) return;
    const instance = map.current; if (!instance) return;
    const [west, south, east, north] = value.bounds;
    if (instance.getZoom() >= 18 || Math.abs(east - west) < .000001 && Math.abs(north - south) < .000001) {
      setCluster({ filterKey: filterRef.current, id: value.id });
      if (window.matchMedia('(max-width: 800px)').matches) setDisplay('list');
      listElement.current?.scrollTo({ top: 0, behavior: 'instant' });
    } else {
      const currentZoom = instance.getZoom();
      instance.fitBounds(leafletBounds(value.bounds), { padding: [45, 45], maxZoom: Math.min(18, currentZoom + 3), animate: false });
      if (instance.getZoom() <= currentZoom) instance.setView([value.latitude, value.longitude], Math.min(18, currentZoom + 2));
    }
  };
  function capture(instance: L.Map, resetGroup = true) {
    if (bootstrap.current !== filterRef.current || displayRef.current !== 'map') return;
    const fresh = viewport(instance, filterRef.current);
    setViewState(previous => previous && JSON.stringify(previous) === JSON.stringify(fresh) ? previous : fresh);
    if (resetGroup) setCluster(null);
  }
  function chooseFilters(value: string, nextSoon: boolean) {
    if (value === category && nextSoon === soon) return;
    const freshKey = filters(search, value, nextSoon);
    if (map.current && bootstrap.current === filterKey) {
      bootstrap.current = freshKey;
      setViewState(viewport(map.current, freshKey));
      map.current.closePopup();
    }
    setCategory(value); setSoon(nextSoon); setCluster(null);
  }
  function keepPointVisible(card: HTMLElement) {
    const instance = map.current, frame = canvas.current;
    if (!instance || !frame || !selected || selected.latitude == null || selected.longitude == null || !frame.clientWidth) return;
    const size = instance.getSize(), point = instance.latLngToContainerPoint([selected.latitude, selected.longitude]);
    const cardBox = card.getBoundingClientRect(), frameBox = frame.getBoundingClientRect();
    const left = cardBox.left - frameBox.left, top = cardBox.top - frameBox.top;
    const onCard = point.x > left - 35 && point.x < left + cardBox.width + 35 && point.y > top - 25 && point.y < top + cardBox.height + 45;
    const outside = point.x < 35 || point.x > size.x - 35 || point.y < 65 || point.y > size.y - 30;
    if (!onCard && !outside) return;
    const target = window.matchMedia('(max-width: 800px)').matches
      ? L.point(size.x / 2, Math.max(80, top / 2))
      : L.point(Math.min(size.x - 65, left + cardBox.width + 100), Math.max(80, Math.min(size.y - 60, cardBox.height / 2)));
    preserveGroup.current = true;
    instance.panBy(point.subtract(target), { animate: false });
  }
  cardLayout.current = keepPointVisible;
  useEffect(() => {
    if (!element.current) return;
    const instance = L.map(element.current, { zoomControl: false, attributionControl: false, maxZoom: 18 }).setView([56.5, 84], 4);
    if (restored?.view && restored.view.filterKey === filterRef.current) {
      instance.setView(leafletBounds(restored.view.bbox).getCenter(), restored.view.zoom, { animate: false });
      bootstrap.current = filterRef.current;
    }
    L.control.attribution({ prefix: false }).addTo(instance);
    const tiles = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>', maxZoom: 18 }).addTo(instance);
    tiles.on('tileerror', () => setTileError(true));
    tiles.on('tileload', () => setTileError(false));
    L.control.zoom({ position: 'topright' }).addTo(instance);
    map.current = instance; markers.current = L.layerGroup().addTo(instance);
    const moved = () => {
      if (bootstrap.current !== filterRef.current) return;
      const resetGroup = !preserveGroup.current; preserveGroup.current = false;
      if (moveTimer.current) clearTimeout(moveTimer.current);
      moveTimer.current = setTimeout(() => capture(instance, resetGroup), 220);
    };
    // A pending pan capture must not run halfway through the next zoom.
    // Leaflet's animated bounds are intermediate until the final moveend.
    const moving = () => { if (moveTimer.current) clearTimeout(moveTimer.current); moveTimer.current = null; };
    instance.on('movestart zoomstart', moving);
    instance.on('moveend', moved);
    const zoomed = () => { const card = canvas.current?.querySelector<HTMLElement>('.map-selected-card'); if (card) cardLayout.current(card); };
    instance.on('zoomend', zoomed);
    const target = element.current;
    const observer = new ResizeObserver(() => { if (target.clientWidth && target.clientHeight) instance.invalidateSize({ pan: false, debounceMoveend: true }); }); observer.observe(target);
    return () => { if (moveTimer.current) clearTimeout(moveTimer.current); observer.disconnect(); instance.off('movestart zoomstart', moving); instance.off('moveend', moved); instance.off('zoomend', zoomed); instance.remove(); map.current = null; markers.current = null; };
  }, []);
  useEffect(() => {
    if (display === 'map') requestAnimationFrame(() => { map.current?.invalidateSize({ pan: false }); });
  }, [display]);
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
      const symbol = profile.kind === 'salon' ? '<path d="M12 21C4 19 2 14 3 10c4 0 7 3 9 11Zm0 0c8-2 10-7 9-11-4 0-7 3-9 11Zm0 0C7 15 7 8 12 3c5 5 5 12 0 18Z"/>' : '<circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="m9 8 11 12M9 16 20 4"/>';
      const icon = L.divIcon({ className: 'atelier-marker' + (profile.kind === 'salon' ? ' atelier-marker-salon' : '') + (profile.promotion ? ' atelier-marker-promoted' : '') + (isSelected ? ' atelier-marker-selected' : ''), html: '<span class="map-pin-frame"><svg class="map-pin-shape" viewBox="0 0 44 52" aria-hidden="true"><path class="map-pin-halo" d="M22 5C12.61 5 5 12.61 5 22c0 12 17 26 17 26s17-14 17-26C39 12.61 31.39 5 22 5Z"/><path class="map-pin-body" d="M22 5C12.61 5 5 12.61 5 22c0 12 17 26 17 26s17-14 17-26C39 12.61 31.39 5 22 5Z"/><svg class="map-pin-glyph" x="12" y="12" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">' + symbol + '</svg></svg>' + (profile.promotion ? '<small>★</small>' : '') + '</span>', iconSize: [44, 52], iconAnchor: [22, 50] });
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
      setDisplay('map');
      instance.flyTo([position.coords.latitude, position.coords.longitude], 13, { duration: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 1 });
      setMessage('Местоположение определено.');
    }, () => setMessage('Не удалось определить местоположение. Проверьте разрешение браузера.'));
  }
  const count = result.loading || !ready && !result.error ? 'Ищем на карте…' : selectedCluster ? 'В этом месте: ' + (data?.listTotal || 0) : 'В этой области: ' + (data?.total || 0);
  const busy = result.loading || !ready && !result.error;
  return <div className={'map-page map-reference' + (display === 'list' ? ' map-list-view' : '')}>
    <section className="map-toolbar" aria-label="Поиск и вид карты">
      <label className="map-search"><Search size={19}/><input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Город, мастер или салон" aria-label="Поиск на карте"/></label>
      <label className="map-direction"><Flower2 size={20}/><select aria-label="Направление на карте" value={category} onChange={event => chooseFilters(event.target.value, soon)}><option value="Все">Все услуги</option>{directions.map(value => <option key={value}>{value}</option>)}</select></label>
      <label className="map-soon map-toolbar-soon"><input type="checkbox" checked={soon} onChange={event => chooseFilters(category, event.target.checked)}/><span>Есть время в ближайший час</span></label>
      <button ref={filterButton} type="button" className={'map-filter-toggle' + (category !== 'Все' || soon ? ' map-filter-active' : '')} onClick={() => setFiltersOpen(true)} aria-expanded={filtersOpen} aria-label="Открыть фильтры"><SlidersHorizontal size={20}/></button>
      <div className="map-view-switch" role="group" aria-label="Вид результатов"><button type="button" onClick={() => setDisplay('list')} aria-pressed={display === 'list'}><List size={19}/>Список</button><button type="button" onClick={() => setDisplay('map')} aria-pressed={display === 'map'}><MapIcon size={19}/>Карта</button></div>
    </section>
    <div className="map-layout"><aside className="map-sidebar" ref={listElement} aria-label="Места в видимой области" onScroll={event => { const raw = window.history.state; if (raw?.usr?.mapView) window.history.replaceState({ ...raw, usr: { ...raw.usr, mapView: { ...raw.usr.mapView, scroll: event.currentTarget.scrollTop } } }, ''); }}>
      <div className="map-list-heading"><h1>Красота <em>рядом.</em></h1><p className="map-result-count" role="status">{result.error ? 'Поиск временно недоступен' : count}</p></div>
      {selectedCluster ? <button className="map-group-reset" type="button" onClick={() => setCluster(null)}><X size={16}/> Все в этой области</button> : null}
      <div className="map-results" aria-busy={busy}>
        {result.error ? <div className="map-list-state" role="alert"><MapIcon size={23}/><h2>Не удалось загрузить места</h2><p>{result.error}</p><button type="button" className="button button-wine" onClick={selectedCluster ? () => setCluster(null) : result.reload}>Повторить</button></div> : !ready ? <div className="map-skeletons" role="status" aria-label="Ищем мастеров и салоны"><div/><div/><div/></div> : items.length ? <>
          <div className="map-result-grid">{items.map(profile => <div key={identity(profile)} className={'map-entry' + (profile.promotion ? ' map-entry-promoted' : '') + (selected && identity(selected) === identity(profile) ? ' map-entry-selected' : '')}>
            <button type="button" className="map-result" aria-label={'Открыть карточку: ' + profile.name} aria-pressed={Boolean(selected && identity(selected) === identity(profile))} onClick={() => handlers.current.select(profile)} disabled={result.loading}>
              {profile.avatar ? <img className="map-result-avatar" src={profile.avatar} alt="" loading="lazy"/> : <span className="map-result-avatar map-avatar-fallback" aria-hidden="true">{profile.name.slice(0, 1)}</span>}
              <span className="map-result-copy"><ProfileBadges salon={profile.kind==='salon'} teaches={profile.teaches} models={profile.looking_models}/><strong>{profile.name}</strong><MapRating rating={profile.rating} review_count={profile.review_count}/><span className="map-entry-categories">{(profile.categories || [profile.category]).join(' · ')}</span><span className="map-entry-address"><MapPin size={15}/><span>{[profile.city,profile.address].filter(Boolean).join(', ')}</span></span>{profile.availability && profile.availability.start > Date.now() ? <span className="map-entry-time">Ближайшая запись · {masterTime(profile.availability.start, profile.availability.utc_offset)}</span> : null}<span className="map-entry-details">Подробнее<ArrowUpRight size={16}/></span></span>
            </button><PromotionBadge promotion={profile.promotion}/>
          </div>)}</div>
          {next && !(more.key === key && more.error) ? <button className="button button-outline map-load-more" type="button" onClick={loadMore} disabled={more.key === key && more.loading}>{more.key === key && more.loading ? 'Загружаем…' : 'Показать ещё'}</button> : null}
          {more.key === key && more.error ? <><p className="form-error" role="alert">{more.error}</p><button className="button button-outline map-load-more" type="button" onClick={refreshList}>Обновить список</button></> : null}
          <p className="map-loaded">Показано: {items.length} из {selectedCluster ? data?.listTotal : data?.total}</p>
        </> : <div className="map-list-state"><Search size={23}/><h2>Здесь пока никого нет</h2><p>Передвиньте карту или измените поиск.</p><button type="button" className="button button-wine" onClick={() => { setQuery(''); chooseFilters('Все', false); }}>Сбросить фильтры</button></div>}
      </div>
    </aside><div className="map-canvas-wrap" ref={canvas}>
      <div ref={element} className="map-canvas" role="region" aria-label="Интерактивная карта мастеров и салонов"/>
      <div className="map-area-count">{count}</div>
      {points.some(p => p.promotion) || data?.clusters.some(c => c.promotedCount) ? <div className="map-promotion-legend">★ Золотые точки — есть реклама</div> : null}
      <button className="map-locate" type="button" onClick={locate} aria-label="Найти мастеров рядом"><LocateFixed size={20}/></button>
      {message || tileError || result.error || ready && !data?.total ? <div className="map-message" role="status">{message || (result.error ? 'Не удалось загрузить места. Откройте список, чтобы повторить поиск.' : tileError ? 'Подложка карты временно недоступна. Список мест работает.' : 'Здесь пока никого нет. Передвиньте карту или измените поиск.')}<button type="button" onClick={() => setDisplay('list')}>Открыть список</button></div> : null}
      {display === 'map' && selected ? <MapProfileCard key={identity(selected)} profile={selected} category={category === 'Все' ? '' : category} soon={soon} onClose={() => setSelection(null)} onLayout={keepPointVisible}/> : null}
    </div></div>
    <MapFiltersSheet open={filtersOpen} category={category} soon={soon} trigger={filterButton} close={() => setFiltersOpen(false)} apply={chooseFilters}/>
  </div>;
}
