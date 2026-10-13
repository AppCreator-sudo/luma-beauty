import { useEffect, useRef, useState, type MouseEvent } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { MapPin, Search, SlidersHorizontal, X } from 'lucide-react';
import { api, dayKey, type Profile } from '../lib/api';
import { useMore } from '../lib/useMore';
import { currentPromotion, usePromotionClock } from '../lib/promotions';
import { CatalogMasterCard } from '../components/CatalogMasterCard';
import { ShowMore } from '../components/ShowMore';
import { EmptyState, ErrorState, Loading, useApp } from '../components/Shell';
import directions from '../../../lib/categories.json';
import '../catalog-navigation.css';
import '../catalog-reference.css';

type MasterSearch = { items: Profile[]; featured?: Profile[]; next: string | null };
const categories = ['Все', ...directions], durations = [30, 60, 90, 120, 180];
const validCursor = (v: unknown): v is string => typeof v === 'string' && /^[a-z0-9][a-z0-9-]{2,39}$/.test(v);

export function MastersPage() {
  const [params, setParams] = useSearchParams(), location = useLocation();
  const { me } = useApp();
  const initialCity = useRef(false);
  const [defaultLimit] = useState(() => window.matchMedia('(max-width: 680px)').matches ? 12 : 24);
  const limit = params.get('limit') === '12' ? 12 : params.get('limit') === '24' ? 24 : defaultLimit;
  const search = (params.get('q') || '').trim().slice(0, 100);
  const category = directions.includes(params.get('category') || '') ? params.get('category')! : 'Все';
  const date = /^\d{4}-\d{2}-\d{2}$/.test(params.get('date') || '') ? params.get('date')! : '';
  const duration = durations.includes(Number(params.get('duration'))) ? Number(params.get('duration')) : 60;
  const cursor = validCursor(params.get('cursor')) ? params.get('cursor')! : '';
  const filters = new URLSearchParams({ limit: String(limit) });
  if (search) filters.set('q', search);
  if (category !== 'Все') filters.set('category', category);
  if (date) { filters.set('date', date); filters.set('duration', String(duration)); }
  const filterKey = filters.toString(), key = 'masters:' + filterKey + ':' + cursor;
  const [query, setQuery] = useState(search), [filtersOpen, setFiltersOpen] = useState(false);
  const input = useRef<HTMLInputElement>(null), results = useRef<HTMLDivElement>(null), restored = useRef('');
  const jump = useRef(false);
  const resource = useMore<Profile, string>(key, cursor, async position => {
    const request = new URLSearchParams(filterKey);
    if (position) request.set('cursor', position);
    const page = await api<MasterSearch>('/search/masters?' + request);
    return { items: [...(page.featured || []), ...page.items], next: page.next };
  }, profile => (profile.kind || 'master') + ':' + profile.user_id);
  const candidates = resource.data?.items || [], time = usePromotionClock(candidates);
  const displayed = candidates.map(profile => currentPromotion(profile, time));
  const activeFilters = Number(category !== 'Все') + Number(Boolean(date));
  function changeFilter(name: string, value: string) {
    const next = new URLSearchParams(filterKey);
    if (query.trim()) next.set('q', query.trim()); else next.delete('q');
    if (value) next.set(name, value); else next.delete(name);
    if (name === 'date' && value) next.set('duration', String(duration));
    if (!next.get('date')) next.delete('duration');
    jump.current = true; setParams(next, { replace: true, state: null });
  }
  function reset() { setQuery(''); jump.current = true; setParams({ limit: String(limit) }, { replace: true, state: null }); }
  useEffect(() => {
    if (initialCity.current || !me) return;
    initialCity.current = true;
    const city = me.user?.account_type === 'client' ? me.client_profile?.city.trim() : '';
    if (!city || params.has('q') || query.trim()) return;
    const next = new URLSearchParams(params);
    next.set('q', city);
    setQuery(city);
    setParams(next, { replace: true, state: null });
  }, [me, params, query, setParams]);
  useEffect(() => { setQuery(search); }, [search]);
  useEffect(() => {
    if (query.trim() === search) return;
    const timer = setTimeout(() => {
      const next = new URLSearchParams(filterKey);
      if (query.trim()) next.set('q', query.trim()); else next.delete('q');
      jump.current = true; setParams(next, { replace: true, state: null });
    }, 250);
    return () => clearTimeout(timer);
  }, [query, search, filterKey, setParams]);
  useEffect(() => { if (params.get('focus') === 'search') input.current?.focus(); }, [location.key, params]);
  useEffect(() => {
    if (!resource.ready || restored.current === location.key) return;
    let frame = requestAnimationFrame(() => { frame = requestAnimationFrame(() => {
      let position: { y: number; anchor?: string; offset?: number } | null = null;
      try { position = JSON.parse(sessionStorage.getItem('luma.catalog.position:' + location.key + ':' + key) || 'null'); } catch { /* Optional. */ }
      if (position && !jump.current && Number.isFinite(position.y)) {
        const anchor = Array.from(document.querySelectorAll<HTMLElement>('[data-catalog-id]')).find(card => card.dataset.catalogId === position.anchor);
        window.scrollTo({ top: anchor && Number.isFinite(position.offset) ? window.scrollY + anchor.getBoundingClientRect().top - position.offset! : position.y, behavior: 'instant' });
      } else if (jump.current && results.current) results.current.scrollIntoView({ block: 'start', behavior: 'instant' });
      restored.current = location.key; jump.current = false;
    }); });
    return () => cancelAnimationFrame(frame);
  }, [resource.ready, key, location.key]);
  function rememberPosition(event: MouseEvent<HTMLDivElement>) {
    const link = (event.target as HTMLElement).closest('a');
    if (!link || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const anchor = link.closest<HTMLElement>('[data-catalog-id]');
    try { sessionStorage.setItem('luma.catalog.position:' + location.key + ':' + key, JSON.stringify({ y: window.scrollY, anchor: anchor?.dataset.catalogId, offset: anchor?.getBoundingClientRect().top })); } catch { /* Optional. */ }
  }
  const mapParams = new URLSearchParams();
  if (search) mapParams.set('q', search);
  if (category !== 'Все') mapParams.set('category', category);
  return <div className="container reference-catalog compact-catalog-page">
    <div className="catalog-heading"><h1>Мастера и салоны</h1><p>Выбирайте по работам.</p></div>
    <div className="catalog-toolbar">
      <div className="catalog-search-row"><label className="catalog-search"><Search size={19}/><input ref={input} value={query} maxLength={100} placeholder="Имя, услуга или город" aria-label="Поиск мастеров и салонов" onChange={event => setQuery(event.target.value)}/>{query ? <button type="button" onClick={() => setQuery('')} aria-label="Очистить поиск"><X size={17}/></button> : null}</label><button className={'catalog-filter-toggle' + (filtersOpen ? ' active' : '')} type="button" aria-expanded={filtersOpen} aria-controls="catalog-filters" onClick={() => setFiltersOpen(value => !value)}><SlidersHorizontal size={19}/>Фильтры{activeFilters ? ' · ' + activeFilters : ''}</button><Link className="catalog-filter-toggle" to={'/map' + (mapParams.size ? '?' + mapParams : '')}><MapPin size={18}/>На карте</Link></div>
      {filtersOpen ? <div className="catalog-filters" id="catalog-filters"><label>Направление<select value={category} onChange={event => changeFilter('category', event.target.value === 'Все' ? '' : event.target.value)}>{categories.map(value => <option key={value}>{value}</option>)}</select></label><label>Свободный день<input type="date" value={date} min={dayKey(Date.now())} max={dayKey(Date.now() + 89 * 86400000)} onChange={event => changeFilter('date', event.target.value)}/></label><label>Длительность<select value={duration} disabled={!date} onChange={event => changeFilter('duration', event.target.value)}>{durations.map(value => <option key={value} value={value}>{value} мин</option>)}</select></label><button type="button" className="catalog-reset" onClick={reset}>Сбросить</button>{!date ? <small>Длительность доступна после выбора дня.</small> : null}</div> : null}
      {activeFilters ? <div className="catalog-applied-filters" aria-label="Выбранные фильтры">{category !== 'Все' ? <button type="button" onClick={() => changeFilter('category', '')}>{category}<X size={14}/><span className="sr-only">Сбросить направление</span></button> : null}{date ? <button type="button" onClick={() => changeFilter('date', '')}>{date.split('-').reverse().join('.')} · {duration} мин<X size={14}/><span className="sr-only">Сбросить дату</span></button> : null}</div> : null}
    </div>
    <div className="catalog-results" ref={results} aria-busy={resource.loading || resource.loadingMore}>
      <div className="catalog-result-heading" aria-live="polite"><span>{resource.ready ? displayed.length ? 'Показано: ' + displayed.length : 'Ничего не найдено' : 'Ищем мастеров и салоны…'}</span></div>
      {resource.error ? <ErrorState message={resource.error} retry={resource.reload}/> : !resource.ready ? <Loading text="Ищем мастеров и салоны…"/> : displayed.length ? <><div className="compact-masters-grid" onClickCapture={rememberPosition}>{displayed.map(profile => <CatalogMasterCard key={(profile.kind || 'master') + ':' + profile.user_id} profile={profile}/>)}</div><ShowMore hasNext={resource.data?.next !== null} busy={resource.loadingMore} error={resource.moreError} onClick={() => void resource.more()} subject="карточки"/></> : <EmptyState title="Пока никого не нашли" text="Попробуйте другой город, день или направление."><button className="button button-dark" type="button" onClick={reset}>Сбросить фильтры</button></EmptyState>}
    </div>
  </div>;
}
