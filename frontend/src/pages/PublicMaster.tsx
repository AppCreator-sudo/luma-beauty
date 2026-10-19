import { useHistoryState } from '../lib/useHistoryState';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowRight, CalendarDays, Heart, Share2 } from 'lucide-react';
import { api, json, servicePriceLabel, masterDate, masterTime, type Profile, type StoryAuthor } from '../lib/api';
import { useResource } from '../lib/useResource';
import { useApp, Loading, ErrorState, EmptyState } from '../components/Shell';
import { PublicWorkTile } from '../components/PublicWorkTile';
import {PublicPageCover,PublicPageIdentity,PublicReviews} from '../components/PublicPageIdentity';
import { experienceText } from '../components/ExperienceFields';
import { StoryViewer } from '../components/StoryViewer';

const tabs = [['works', 'Портфолио'], ['services', 'Услуги'], ['reviews', 'Отзывы'], ['about', 'О мастере']] as const;
type Tab = typeof tabs[number][0];

export function ProfilePage() {
  const { slug = '' } = useParams(), navigate = useNavigate(), { me } = useApp();
  const resource = useResource(() => api<Profile>('/profiles/' + encodeURIComponent(slug)), [slug]);
  const storiesResource = useResource(() => api<StoryAuthor>('/stories/owner/' + encodeURIComponent(slug)), [slug]);
  const [showStories, setShowStories] = useState(false);
  const [tab, setTab] = useHistoryState<Tab>('master-public-tab', 'works'), [serviceId, setServiceId] = useHistoryState('master-window-service', '');
  const [selectedStart, setSelectedStart] = useHistoryState<number | null>('master-window-start', null);
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState('');
  const p = resource.data;
  useEffect(() => { setNotice(''); }, [slug]);
  useEffect(() => { if (p) document.title = p.name + ' — Luma Beauty'; }, [p]);
  async function follow() {
    if (!p || busy) return;
    if (!me?.user) { navigate('/auth?next=' + encodeURIComponent('/m/' + slug)); return; }
    setBusy(true); setNotice('');
    try { const result = await json<{ following: boolean }>('/masters/' + p.user_id + '/follow', p.following ? 'DELETE' : 'POST', {}); resource.setData(current=>current?.user_id===p.user_id?{...current,following:result.following}:current); }
    catch (e) { setNotice(e instanceof Error ? e.message : 'Не удалось подписаться'); }
    finally { setBusy(false); }
  }
  async function share() {
    try { if (navigator.share) await navigator.share({ title: p?.name, url: location.href }); else { await navigator.clipboard.writeText(location.href); setNotice('Ссылка скопирована'); } }
    catch (e) { if (!(e instanceof DOMException && e.name === 'AbortError')) setNotice('Не удалось поделиться ссылкой'); }
  }
  if (resource.loading) return <Loading/>;
  if (resource.error || !p) return <ErrorState message={resource.error || 'Страница не найдена'} retry={resource.reload}/>;
  const service = p.services.find(s => s.id === serviceId) || p.services[0];
  const slots = (p.availability || []).filter(s => s.start > Date.now() && service && s.end - s.start >= service.duration * 60000);
  const nearest = slots[0], selected = slots.find(s => s.start === selectedStart) || nearest, offset = p.schedule?.utc_offset ?? 180, canBook = !p.is_demo && p.services.length > 0;
  const about = <><p className="public-description">{p.bio || 'Мастер пока не добавил описание.'}</p>{p.experience_months != null ? <p className="public-experience">Стаж: {experienceText(p.experience_months)}</p> : null}</>;
  return <div className="public-reference public-master public-page-shell">
    <PublicPageCover cover={p.cover} theme={p.theme||'cream'}/>
    <div className="public-content">
      <PublicPageIdentity name={p.name} image={p.avatar} teaches={p.teaches} models={p.looking_models} address={[p.city,p.address].filter(Boolean).join(', ')} categories={p.categories?.length?p.categories:[p.category]} rating={p.rating} count={p.review_count} reviews={()=>setTab('reviews')} hasStory={Boolean(storiesResource.data?.stories?.length)} onStoryClick={() => setShowStories(true)} actions={<>
        {!canBook?<p className="public-muted">Онлайн-запись пока закрыта</p>:null}
        <button type="button" className="public-icon" aria-label={p.following?'Отписаться от мастера':'Подписаться на мастера'} aria-pressed={Boolean(p.following)} disabled={busy} onClick={()=>void follow()}><Heart size={20} fill={p.following?'currentColor':'none'}/></button>
        <button type="button" className="public-icon" aria-label="Поделиться страницей" onClick={()=>void share()}><Share2 size={19}/></button>
      </>}/>

      {!p.published ? <p className="public-notice">Предпросмотр владельца: страница пока скрыта от клиентов.</p> : notice ? <p role="status" className="public-notice">{notice}</p> : null}
      <div className="public-master-layout"><aside className="public-master-aside"><section className="public-window" aria-label="Ближайшее свободное окно"><h2><CalendarDays size={19}/>Ближайшее окно</h2>{canBook && service ? <><label>Услуга<select value={service.id} onChange={e => { setServiceId(e.target.value); setSelectedStart(null); }}>{p.services.map(s => <option value={s.id} key={s.id}>{s.name}</option>)}</select></label>{nearest ? <><p className="public-window-date">{masterDate(nearest.start, offset)}</p><div className="public-window-times">{slots.filter(s => masterDate(s.start, offset) === masterDate(nearest.start, offset)).slice(0, 3).map(s => <button type="button" key={s.start} aria-pressed={selected?.start === s.start} className={selected?.start === s.start ? 'active' : ''} onClick={() => setSelectedStart(s.start)}>{masterTime(s.start, offset)}</button>)}</div></> : <p className="public-muted">Свободных окон пока нет. Другие даты можно проверить при записи.</p>}<div className="public-window-price"><strong>{servicePriceLabel(service.price)}</strong><span>{service.duration} мин</span></div><div className="public-window-actions">{selected?<Link className="button button-wine" to={'/book/' + p.slug + '?service=' + encodeURIComponent(service.id) + '&start=' + selected.start}>Выбрать это время<ArrowRight size={16}/></Link>:null}<Link className="button button-outline" to={'/book/' + p.slug + '?service=' + encodeURIComponent(service.id)}>Или выбрать своё время<ArrowRight size={16}/></Link></div><small>Время мастера · UTC+{offset / 60}</small></> : <p className="public-muted">Мастер ещё готовит услуги и график.</p>}</section><section className="public-about-preview"><h2>О мастере</h2>{about}</section></aside>
        <div className="public-main"><nav className="public-tabs" aria-label="Разделы мастера">{tabs.map(([key, label]) => <button key={key} type="button" aria-current={tab === key ? 'page' : undefined} className={tab === key ? 'active' : ''} onClick={() => setTab(key)}>{label}{key === 'reviews' && p.review_count ? <small>{p.review_count}</small> : null}</button>)}</nav>
          {tab === 'works' ? <section className="public-panel"><div className="public-section-title"><h2>Работы мастера</h2><span>{p.works.length} работ</span></div>{p.works.length ? <div className="public-work-grid">{p.works.map(w => <PublicWorkTile key={w.id} work={w}/>)}</div> : <EmptyState title="Портфолио пока пусто" text="Мастер скоро добавит первые работы."/>}</section> : null}
          {tab === 'services' ? <section className="public-panel"><h2>Услуги и цены</h2>{p.services.length ? <div className="public-service-list">{p.services.map(s => <article key={s.id}><div><h3>{s.name}</h3><small>{s.duration} мин</small></div><strong>{servicePriceLabel(s.price)}</strong>{canBook ? <Link to={'/book/' + p.slug + '?service=' + s.id} aria-label={'Записаться: ' + s.name}><ArrowRight size={18}/></Link> : null}</article>)}</div> : <EmptyState title="Услуги пока не добавлены" text="Мастер готовит список услуг и цен."/>}</section> : null}
          {tab === 'reviews' ? <section className="public-panel"><h2>Отзывы клиентов</h2><PublicReviews reviews={p.reviews}/></section> : null}
          {tab === 'about' ? <section className="public-panel"><h2>О мастере</h2>{about}</section> : null}
        </div></div>
    </div>
    {showStories && storiesResource.data?.stories?.length ? (
      <StoryViewer
        authors={[storiesResource.data]}
        onClose={() => setShowStories(false)}
      />
    ) : null}
  </div>;
}
