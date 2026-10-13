import { useEffect, useRef, type MouseEvent } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { api, type Feed, type Work } from '../lib/api';
import { useMore } from '../lib/useMore';
import { MasonryGrid } from '../components/MasonryGrid';
import { ShowMore } from '../components/ShowMore';
import { EmptyState, ErrorState, Loading } from '../components/Shell';
import directions from '../../../lib/categories.json';
import '../catalog-navigation.css';
import '../catalog-reference.css';

type Position = { cursor: string; offset: number };
type Preview = Work & { ratio: number };
const batches = new Map<string, { at: number; feed: Feed }>();
const ratios = new Map<string, Promise<number>>();
const validCursor = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_-]{1,512}$/.test(v);
const validOffset = (v: number) => Number.isInteger(v) && v >= 0 && v < 48;
function imageRatio(url: string) {
  const known = ratios.get(url);
  if (known) return known;
  const promise = new Promise<number>(resolve => {
    const image = new Image();
    const finish = () => { clearTimeout(timer); image.onload = null; image.onerror = null; resolve(image.naturalWidth && image.naturalHeight ? image.naturalWidth / image.naturalHeight : 4 / 5); };
    const timer = setTimeout(finish, 8000);
    image.onload = finish; image.onerror = finish; image.src = url;
  });
  ratios.set(url, promise);
  if (ratios.size > 200) ratios.delete(ratios.keys().next().value!);
  return promise;
}
async function loadWorkPage(category: string, position: Position) {
  const items: Work[] = [], visited = new Set<string>();
  let { cursor, offset } = position, next: Position | null = null;
  while (items.length < 8 && !visited.has(cursor)) {
    visited.add(cursor);
    const query = new URLSearchParams();
    if (category) query.set('category', category);
    if (cursor) query.set('cursor', cursor);
    const key = query.toString(), cached = batches.get(key);
    let feed = cached && Date.now() - cached.at < 60000 ? cached.feed : null;
    if (!feed) {
      feed = await api<Feed>('/inspiration?' + key);
      batches.delete(key); batches.set(key, { at: Date.now(), feed });
      if (batches.size > 20) batches.delete(batches.keys().next().value!);
    }
    const taken = feed.items.slice(offset, offset + 8 - items.length);
    items.push(...taken); offset += taken.length;
    if (items.length === 8) { next = offset < feed.items.length ? { cursor, offset } : feed.next ? { cursor: feed.next, offset: 0 } : null; break; }
    if (!feed.next) break;
    cursor = feed.next; offset = 0;
  }
  // Reserve each photograph's real proportion before placing the new batch,
  // so existing masonry cards do not jump when more photos arrive.
  return { items: await Promise.all(items.map(async work => ({ ...work, ratio: await imageRatio(work.image) }))), next };
}
function InspirationWorkCard({ work }: { work: Preview }) {
  const author = work.salon_slug ? '/s/' + work.salon_slug + (work.performer_id ? '?master=' + encodeURIComponent(work.performer_id) + '#works' : '') : '/m/' + work.slug;
  const caption = work.caption || work.service_name || 'Работа мастера';
  return <article className="reference-inspiration-card" data-work-id={work.id}>
    <Link className="reference-inspiration-photo" style={{ aspectRatio: work.ratio }} to={'/w/' + work.id} aria-label={'Открыть работу: ' + caption}><img src={work.image} alt={caption} loading="lazy"/>{(work.images?.length || 0) > 1 ? <span className="inspiration-photo-count">{work.images!.length} фото</span> : null}</Link>
    <Link className="reference-inspiration-caption" to={'/w/' + work.id}>{caption}</Link>
    <Link className="reference-inspiration-author" to={author}>{work.avatar ? <img src={work.avatar} alt="" loading="lazy"/> : <span className="reference-author-initial" aria-hidden="true">{Array.from(work.master_name || 'L')[0]}</span>}<span><b>{work.master_name || 'Мастер'}</b><small>{[work.salon_name, work.city].filter(Boolean).join(' · ')}</small></span></Link>
  </article>;
}
export function InspirationPage() {
  const [params, setParams] = useSearchParams(), location = useLocation();
  const category = directions.includes(params.get('category') || '') ? params.get('category')! : '';
  const cursor = validCursor(params.get('cursor')) ? params.get('cursor')! : '';
  const rawOffset = Number(params.get('offset') || 0), offset = validOffset(rawOffset) ? rawOffset : 0;
  const key = 'inspiration:' + new URLSearchParams({ category, cursor, offset: String(offset) });
  const resource = useMore<Preview, Position>(key, { cursor, offset }, position => loadWorkPage(category, position), work => work.id);
  const restored = useRef(''), jump = useRef(false), results = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!resource.ready || restored.current === location.key) return;
    let frame = requestAnimationFrame(() => { frame = requestAnimationFrame(() => {
      let position: { y: number; anchor?: string; offset?: number } | null = null;
      try { position = JSON.parse(sessionStorage.getItem('luma.inspiration.position:' + location.key + ':' + key) || 'null'); } catch { /* Optional. */ }
      if (!jump.current && position && Number.isFinite(position.y)) {
        const card = Array.from(document.querySelectorAll<HTMLElement>('[data-work-id]')).find(item => item.dataset.workId === position.anchor);
        window.scrollTo({ top: card && Number.isFinite(position.offset) ? window.scrollY + card.getBoundingClientRect().top - position.offset! : position.y, behavior: 'instant' });
      } else if (jump.current && results.current) results.current.scrollIntoView({ block: 'start', behavior: 'instant' });
      restored.current = location.key; jump.current = false;
    }); });
    return () => cancelAnimationFrame(frame);
  }, [resource.ready, key, location.key]);
  function remember(event: MouseEvent<HTMLDivElement>) {
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || !(event.target as HTMLElement).closest('a')) return;
    const card = (event.target as HTMLElement).closest<HTMLElement>('[data-work-id]');
    try { sessionStorage.setItem('luma.inspiration.position:' + location.key + ':' + key, JSON.stringify({ y: window.scrollY, anchor: card?.dataset.workId, offset: card?.getBoundingClientRect().top })); } catch { /* Optional. */ }
  }
  return <div className="container reference-catalog reference-inspiration compact-catalog-page">
    <div className="catalog-heading reference-inspiration-heading"><h1>Вдохновение <em>в деталях.</em></h1><label><span className="sr-only">Направление</span><select aria-label="Направление" value={category} onChange={event => { jump.current = true; setParams(event.target.value ? { category: event.target.value } : {}, { replace: true, state: null }); }}><option value="">Все направления</option>{directions.map(value => <option key={value}>{value}</option>)}</select></label></div>
    <div className="catalog-results" ref={results} aria-busy={resource.loading || resource.loadingMore}>
      <div className="catalog-result-heading" aria-live="polite"><span>{resource.ready ? 'Показано: ' + resource.data!.items.length : 'Открываем работы…'}</span></div>
      {resource.error ? <ErrorState message={resource.error} retry={() => { batches.clear(); void resource.reload(); }}/> : !resource.ready ? <Loading text="Открываем работы…"/> : resource.data!.items.length ? <><MasonryGrid onClickCapture={remember}>{resource.data!.items.map(work => <InspirationWorkCard key={work.id} work={work}/>)}</MasonryGrid><ShowMore hasNext={resource.data!.next !== null} busy={resource.loadingMore} error={resource.moreError} onClick={() => void resource.more()} subject="работы"/></> : <EmptyState title="Здесь скоро появятся работы" text={category ? 'Попробуйте другое направление.' : 'Познакомьтесь с мастерами и их страницами.'}><Link className="button button-dark" to="/masters">Смотреть мастеров</Link></EmptyState>}
    </div>
  </div>;
}
