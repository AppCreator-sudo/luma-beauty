import { useHistoryState } from '../lib/useHistoryState';
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowRight, Heart, Share2 } from 'lucide-react';
import { api, json, masterDate, masterTime, money, type PublicSalon, type Slot } from '../lib/api';
import { useResource } from '../lib/useResource';
import { EmptyState, ErrorState, Loading, useApp } from '../components/Shell';
import {PublicPageCover,PublicPageIdentity,PublicReviews} from '../components/PublicPageIdentity';
import {SalonPublicWindow} from '../components/SalonPublicWindow';
import { PublicWorkTile } from '../components/PublicWorkTile';
import { experienceText } from '../components/ExperienceFields';

const tabs = [['services', 'Услуги'], ['team', 'Команда'], ['works', 'Работы'], ['reviews','Отзывы'], ['about', 'О салоне']] as const;
type Tab = typeof tabs[number][0];

function TeamCard({ salon, person, showWorks }: { salon: PublicSalon; person: PublicSalon['staff'][number]; showWorks: () => void }) {
  const service = salon.services.find(s => s.master_ids.includes(person.id));
  const slots = useResource(async () => service && salon.published ? api<{ slots: Slot[] }>('/public/salons/' + encodeURIComponent(salon.slug) + '/availability?' + new URLSearchParams({ service: service.id, master: person.id })) : { slots: [] }, [salon.slug, salon.published, person.id, service?.id]);
  const nearest = !slots.loading && !slots.error ? slots.data?.slots.find(s => s.start > Date.now()) : null;
  const book = '/s/' + salon.slug + '/book?master=' + person.id + (service ? '&service=' + encodeURIComponent(service.id) : '') + (nearest ? '&start=' + nearest.start : '');
  return <article className="public-team-card"><div className="public-team-identity"><span className="public-team-avatar">{person.avatar ? <img src={person.avatar} alt={'Фото ' + person.name} loading="lazy"/> : person.name.slice(0, 1)}</span><div><h3>{person.name}</h3><p>{person.categories.join(' · ')}</p>{person.teaches ? <small>Обучает</small> : null}{person.experience_months != null ? <small>Стаж: {experienceText(person.experience_months)}</small> : null}</div></div><button type="button" className="public-team-portfolio" onClick={showWorks}>Портфолио <ArrowRight size={15}/></button>{service ? <Link className="public-team-window" to={book}><span>{nearest ? 'Ближайшее окно' : slots.loading ? 'Проверяем время…' : 'Выбрать время'}{nearest ? <strong>{masterDate(nearest.start, salon.utc_offset, { day: 'numeric', month: 'long' })} · {masterTime(nearest.start, salon.utc_offset)}</strong> : <small>{service.name}</small>}</span><ArrowRight size={17}/></Link> : null}</article>;
}

export function PublicSalonPage() {
  const navigate=useNavigate(),{me}=useApp(),saving=useRef(false);
  const [busy,setBusy]=useState(false);
  const { slug = '' } = useParams(), [params, setParams] = useSearchParams();
  const resource = useResource(() => api<PublicSalon>('/public/salons/' + encodeURIComponent(slug)), [slug]);
  const selected = params.get('master') || '';
  const [tab, setTab] = useHistoryState<Tab>('salon-public-tab', () => selected ? 'works' : 'team'), [teamLimit, setTeamLimit] = useState(4), [notice, setNotice] = useState('');
  
  useEffect(() => { setTeamLimit(4); setNotice(''); }, [slug]);
  useEffect(() => { if (resource.data) document.title = resource.data.name + ' — Luma Beauty'; }, [resource.data]);
  async function saveSalon() {
    const salon=resource.data;if(!salon||saving.current)return;
    if(!me?.user){navigate('/auth?next='+encodeURIComponent('/s/'+slug));return;}
    saving.current=true;setBusy(true);setNotice('');
    try{const result=await json<{saved:boolean}>('/salons/'+salon.id+'/save',salon.saved?'DELETE':'POST',{});resource.setData(current=>current?.id===salon.id?{...current,saved:result.saved}:current);}
    catch(reason){setNotice(reason instanceof Error?reason.message:'Не удалось сохранить салон');}
    finally{saving.current=false;setBusy(false);}
  }
  async function share() {
    try { if (navigator.share) await navigator.share({ title: resource.data?.name, url: location.href }); else { await navigator.clipboard.writeText(location.href); setNotice('Ссылка скопирована'); } }
    catch (e) { if (!(e instanceof DOMException && e.name === 'AbortError')) setNotice('Не удалось поделиться ссылкой'); }
  }
  if (resource.loading) return <Loading/>;
  if (resource.error || !resource.data) return <ErrorState message={resource.error || 'Салон не найден'} retry={resource.reload}/>;
  const salon = resource.data, person = salon.staff.find(p => p.id === selected);
  const works = (salon.works || []).filter(w => !person || w.performer_id === person.id);
  const categories = [...new Set(salon.staff.flatMap(p => p.categories))];
  const portfolio = <section id="works" className="public-panel"><div className="public-section-title"><h2>{person ? 'Работы: ' + person.name : 'Работы команды'}</h2><span>{works.length} работ</span></div><div className="public-author-filter"><label>Автор работ<select value={person?.id || ''} onChange={e => setParams(e.target.value ? { master: e.target.value } : {}, { preventScrollReset: true })}><option value="">Все мастера</option>{salon.staff.map(p => <option value={p.id} key={p.id}>{p.name}</option>)}</select></label>{person && salon.services.some(s => s.master_ids.includes(person.id)) ? <Link className="button button-wine" to={'/s/' + slug + '/book?master=' + person.id}>Записаться к мастеру <ArrowRight size={16}/></Link> : null}</div>{works.length ? <div className="public-work-grid">{works.map(w => <PublicWorkTile key={w.id} work={w} showAuthor/>)}</div> : <EmptyState title="Работы скоро появятся" text={person ? 'У этого мастера пока нет опубликованных работ.' : 'Команда ещё готовит портфолио.'}/>}</section>;
  return <div className="public-reference public-salon public-page-shell"><PublicPageCover cover={salon.cover} theme={salon.theme}/><div className="public-content">
    <PublicPageIdentity name={salon.name} image={salon.logo} salon teaches={salon.teaches} models={salon.looking_models} address={[salon.city,salon.address].filter(Boolean).join(', ')} categories={categories} rating={salon.rating} count={salon.review_count} reviews={()=>setTab('reviews')} actions={<>
      {!salon.services.length||!salon.published?<p className="public-muted">Онлайн-запись пока закрыта</p>:null}
      <button type="button" className="public-icon" aria-label={salon.saved?'Убрать салон из избранного':'Добавить салон в избранное'} aria-pressed={Boolean(salon.saved)} disabled={busy||!salon.published} onClick={()=>void saveSalon()}><Heart size={20} fill={salon.saved?'currentColor':'none'}/></button>
      <button type="button" className="public-icon" aria-label="Поделиться страницей" onClick={()=>void share()}><Share2 size={19}/></button>
    </>}/>
    {!salon.published?<p className="public-notice">Предпросмотр владельца: страница пока скрыта от клиентов.</p>:null}{notice?<p className="public-notice" role="status">{notice}</p>:null}
    <div className="public-master-layout"><aside className="public-master-aside"><SalonPublicWindow salon={salon}/><section className="public-about-preview"><h2>О салоне</h2><p className="public-description">{salon.bio||'Салон пока не добавил описание.'}</p></section></aside><div className="public-main">
    <nav className="public-tabs" aria-label="Разделы салона">{tabs.map(([key, label]) => <button type="button" key={key} className={tab === key ? 'active' : ''} aria-current={tab === key ? 'page' : undefined} onClick={() => setTab(key)}>{label}</button>)}</nav>
      {tab === 'team' ? <><section className="public-panel"><div className="public-section-title"><h2>Наша команда</h2><span>{salon.staff.length} мастеров</span></div>{salon.staff.length ? <><div className="public-team-grid">{salon.staff.slice(0, teamLimit).map(p => <TeamCard salon={salon} person={p} key={p.id} showWorks={() => { setParams({ master: p.id }, { preventScrollReset: true, state: { lumaNavigation: { values: { [location.pathname + ':salon-public-tab']: 'works' }, trail: [] } } }); }}/>)}</div>{salon.staff.length > teamLimit ? <button className="button button-outline public-more" type="button" onClick={() => setTeamLimit(v => v + 4)}>Показать ещё мастеров</button> : null}</> : <EmptyState title="Знакомство с командой впереди" text="Мастера появятся после открытия онлайн-записи."/>}</section>{portfolio}</> : null}
      {tab === 'works' ? <>{portfolio}{salon.posts?.length ? <section className="public-panel"><h2>Жизнь салона</h2><div className="public-work-grid public-life-grid">{salon.posts.map(p => <article className="public-work-tile" key={p.id}><img src={p.image} alt={p.caption || 'Фото салона'} loading="lazy"/><small>{p.kind === 'news' ? 'Новость салона' : 'Интерьер и атмосфера'}</small><p>{p.caption}</p>{p.images.length > 1 ? <details><summary>Ещё фото: {p.images.length - 1}</summary>{p.images.slice(1).map(photo => <img src={photo.image} alt={p.caption || 'Фото салона'} key={photo.id} loading="lazy"/>)}</details> : null}</article>)}</div></section> : null}</> : null}
      {tab === 'services' ? <section className="public-panel"><h2>Услуги и цены</h2>{salon.services.length ? <div className="public-service-list">{salon.services.map(s => <article key={s.id}><div><h3>{s.name}</h3><small>{s.duration} мин · мастеров: {s.master_ids.length}</small></div><strong>{money(s.price)}</strong><Link to={'/s/' + slug + '/book?service=' + encodeURIComponent(s.id)} aria-label={'Записаться: ' + s.name}><ArrowRight size={18}/></Link></article>)}</div> : <EmptyState title="Услуги готовятся" text="Онлайн-запись пока закрыта."/>}</section> : null}
      {tab === 'reviews'?<section className="public-panel"><h2>Отзывы клиентов</h2><PublicReviews reviews={salon.reviews}/></section>:null}
      {tab === 'about' ? <section className="public-panel"><h2>О салоне</h2><p className="public-description">{salon.bio || 'Салон пока не добавил описание.'}</p>{salon.latitude != null && salon.longitude != null ? <a className="button button-outline" href={`https://www.openstreetmap.org/?mlat=${salon.latitude}&mlon=${salon.longitude}#map=18/${salon.latitude}/${salon.longitude}`} target="_blank" rel="noopener noreferrer">Точный адрес на карте <ArrowRight size={16}/></a> : null}<p className="public-muted">Время салона · UTC+{salon.utc_offset / 60}</p></section> : null}
    </div></div></div></div>;
}
