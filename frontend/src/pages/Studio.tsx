import {ScheduleFields} from '../components/ScheduleFields';
import {scheduleHasWork} from '../../../lib/schedule-patterns.mjs';
import {ServiceDirectionEditor,ServiceDirectionSelect} from '../components/ServiceDirection';
import { useHistoryState } from '../lib/useHistoryState';
import { ExperienceFields } from '../components/ExperienceFields';
import { useCallback, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowRight, Check, LogOut, Plus, Settings2, Trash2 } from 'lucide-react';
import { api, json, money, servicePriceLabel, prettyDate, prettyTime, masterDayKey, masterDate, masterTime, statusLabel, type Appointment, type Schedule, type Studio } from '../lib/api';
import { useResource } from '../lib/useResource';
import { useApp, EmptyState, ErrorState, Loading } from '../components/Shell';
import '../work-upload.css';
import '../studio-setup.css';
import '../studio-desktop.css';
import directions from '../../../lib/categories.json';
import { AddressFields, addressChanged, addressValueFromStored, type StoredAddress, type AddressValue } from '../components/AddressFields';
import { PushButton } from '../components/AccountTools';
import { WorkUpload } from '../components/WorkUpload';
import { PersonalAppearance } from '../components/AppearanceEditor';
import { CalendarWorkspace } from '../components/CalendarWorkspace';
import '../cabinet-flows.css';
import { MasterCabinet, MasterOverview } from '../components/MasterCabinet';
import { CabinetStories } from '../components/CabinetStories';

type StudioTab = 'overview' | 'works' | 'stories' | 'services' | 'appearance' | 'settings';
type StudioData = [Studio, Appointment[], string];
type StudioRemoval = { ownerId: string; kind: 'work' | 'service'; id: string; pending: boolean; error: string; notice: string };

export function StudioPage() {
  const { me, refreshMe } = useApp();
  const navigate = useNavigate();
  const [studioParams] = useSearchParams();
  const requestedTab = studioParams.get('tab');
  const [tab, setTab] = useHistoryState<StudioTab>('studio-tab', () => ['overview','works','stories','services','appearance','settings'].includes(requestedTab || '') ? requestedTab as StudioTab : 'overview');
  const [saveNotice, setSaveNotice] = useState('');
  const [addingWork, setAddingWork] = useState(false);
  const [workBusy, setWorkBusy] = useState(false);
  const [workNotice, setWorkNotice] = useState('');
  const workUploadLock = useRef(false);
  const onWorkBusyChange = useCallback((busy: boolean) => {
    workUploadLock.current = busy;
    setWorkBusy(busy);
    if (busy) setWorkNotice('');
  }, []);
  const [removal, setRemoval] = useState<StudioRemoval | null>(null);
  const removalLock = useRef(false);
  const masterId = me?.user?.account_type === 'master' ? me.user.id : '';
  const removalOwner = useRef(masterId);
  removalOwner.current = masterId;
  const resource = useResource<StudioData>(() => masterId ? Promise.all([api<Studio>('/studio'), api<Appointment[]>('/appointments')]).then(([studio, appointments]): StudioData => [studio, appointments, masterId]) : Promise.resolve([{ profile: null, services: [], works: [] }, [], '']), [masterId]);
  async function remove(kind: StudioRemoval['kind'], id: string) {
    if (!masterId || removalLock.current || !confirm(kind === 'work' ? 'Удалить работу?' : 'Удалить услугу?')) return;
    const ownerId = masterId;
    removalLock.current = true;
    setRemoval({ ownerId, kind, id, pending: true, error: '', notice: kind === 'work' ? 'Удаляем работу…' : 'Удаляем услугу…' });
    try {
      await api((kind === 'work' ? '/works/' : '/services/') + id, { method: 'DELETE' });
      if (removalOwner.current !== ownerId) return;
      // Apply the acknowledged deletion even when refreshing the remaining list fails.
      resource.setData(previous => {
        if (!previous || previous[2] !== ownerId) return previous;
        const studio = previous[0];
        return [{ ...studio, ...(kind === 'work' ? { works: studio.works.filter(item => item.id !== id) } : { services: studio.services.filter(item => item.id !== id) }) }, previous[1], ownerId];
      });
      await resource.reload();
      if (removalOwner.current === ownerId) setRemoval({ ownerId, kind, id, pending: false, error: '', notice: kind === 'work' ? 'Работа удалена.' : 'Услуга удалена.' });
    } catch (reason) {
      if (removalOwner.current === ownerId) setRemoval({ ownerId, kind, id, pending: false, notice: '', error: reason instanceof TypeError ? 'Не удалось связаться с сервером. Попробуйте ещё раз.' : reason instanceof Error ? reason.message : 'Не удалось удалить. Попробуйте ещё раз.' });
    } finally {
      removalLock.current = false;
      setRemoval(previous => previous?.ownerId === ownerId && previous.pending ? { ...previous, pending: false, notice: '' } : previous);
    }
  }
  function removalFeedback(kind: StudioRemoval['kind'], id?: string) {
    if (!removal || removal.ownerId !== masterId || removal.kind !== kind) return null;
    if (id ? removal.id !== id || (!removal.error && !removal.pending) : removal.error || removal.pending) return null;
    return removal.error ? <p className="form-error studio-removal-feedback" role="alert">{removal.error}</p> : removal.notice ? <p className="studio-action-notice studio-removal-feedback" role="status">{removal.notice}</p> : null;
  }
  if (!me) return <Loading/>;
  if (me.user?.account_type === 'salon' || (me.user?.account_type === 'client' && me.workspaces?.some(w => w.kind === 'salon'))) return <Navigate to="/salon" replace/>;
  if (!me.user) return <div className="container page-content"><div className="editorial-heading"><span className="eyebrow">ДЛЯ ТЕХ, КТО СОЗДАЁТ КРАСОТУ</span><h1>Ваше личное <em>пространство.</em></h1><p>Откройте студию, опубликуйте работы и принимайте запись по личной ссылке.</p><Link className="button button-wine" to="/auth?role=master">Создать студию <ArrowRight size={17}/></Link></div></div>;
  if (me.user.account_type !== 'master') return <div className="container page-content"><div className="editorial-heading"><h1>Вы вошли как <em>клиент.</em></h1><p>Ваши записи и сохранённые работы находятся в личном кабинете.</p><Link className="button button-dark" to="/me">Открыть мой кабинет</Link></div></div>;
  if (!resource.data || resource.data[2] !== masterId) return resource.error ? <ErrorState message={resource.error} retry={resource.reload}/> : <Loading/>;
  const [studio, appointments] = resource.data;
  if (!studio.profile) return <div className="container studio-page studio-onboarding"><div className="editorial-heading"><span className="eyebrow">ПЕРВОЕ ЗНАКОМСТВО</span><h1>Расскажите <em>о себе.</em></h1><p>Сначала создайте скрытую страницу. Затем добавьте услугу и график — и откройте запись клиентам.</p><Link className="text-link" to="/access">Вход и безопасность</Link></div><div className="studio-form-card"><ProfileForm addressDraft={studio.address_draft} onDone={notice => { setSaveNotice(notice || ""); resource.reload(); refreshMe(); }}/></div></div>;
  const profile = studio.profile;
  async function share() { const url = location.origin + '/v2/m/' + profile.slug; if (navigator.share) await navigator.share({ title: profile.name, url }).catch(() => {}); else { await navigator.clipboard.writeText(url); alert('Ссылка скопирована'); } }
  return <MasterCabinet profile={profile} tab={tab} openTab={setTab} share={share}>
    {saveNotice ? <p role="status">{saveNotice}</p> : null}
    {resource.error ? <div className="studio-refresh-error" role="alert"><span>Не удалось обновить кабинет: {resource.error}</span><button className="text-link" type="button" disabled={resource.loading} onClick={() => void resource.reload()}>Повторить обновление</button></div> : null}
    {tab === 'overview' ? <MasterOverview studio={{...studio, profile}} appointments={appointments} openTab={setTab} reload={resource.reload}/> : null}
    {tab === 'works' ? <section className="studio-panel studio-works-panel"><div className="section-head compact"><div><span className="eyebrow">ВАШИ ИСТОРИИ</span><h2>Мои <em>работы.</em></h2></div><button type="button" className="button button-wine studio-add-work-toggle" disabled={workBusy} onClick={() => { if (workUploadLock.current) return; setWorkNotice(''); setAddingWork(value => !value); }}><Plus size={16}/>{addingWork ? 'Закрыть форму' : 'Добавить работу'}</button></div>{(addingWork || studio.works.length === 0) ? <div className="studio-work-upload-card"><WorkUpload services={studio.services} pending={workBusy} onBusyChange={onWorkBusyChange} onSaved={setWorkNotice} onDone={async () => { setAddingWork(false); await resource.reload(); }} onCancel={studio.works.length > 0 ? () => setAddingWork(false) : undefined}/></div> : null}{workNotice ? <p className="studio-action-notice" role="status">{workNotice}</p> : null}{removalFeedback('work')}<div className="studio-list-heading"><h3>Ваше портфолио</h3><span>Работ: {studio.works.length}</span></div>{studio.works.length ? <div className="studio-work-grid">{studio.works.map(work => <article key={work.id}><Link to={'/w/' + work.id} title={work.caption || 'Просмотр работы'}><img src={work.image} alt={work.caption || 'Ваша работа'} loading="lazy"/></Link><div><p title={work.caption || 'Без подписи'}>{work.caption || 'Без подписи'}</p><button type="button" aria-label="Удалить работу" disabled={Boolean(removal?.pending)} aria-busy={removal?.pending && removal.id === work.id} onClick={() => void remove('work', work.id)}><Trash2 size={17}/></button></div>{removalFeedback('work', work.id)}</article>)}</div> : <p className="studio-list-hint">Сохранённые работы появятся здесь. Добавить фото можно и на скрытой странице.</p>}</section> : null}
    {tab === 'stories' ? <CabinetStories ownerType="master" services={studio.services} onChange={resource.reload}/> : null}
    {tab === 'services' ? <section className="studio-panel studio-services-panel"><div className="section-head compact"><div><span className="eyebrow">ВАШИ УСЛУГИ</span><h2>Услуги <em>и цены.</em></h2></div></div><details className="service-create"><summary>Добавить услугу</summary><ServiceForm categories={studio.profile?.categories||[]} onDone={resource.reload}/></details>{removalFeedback('service')}<div className="studio-list-heading"><h3>Список услуг</h3><span>Услуг: {studio.services.length}</span></div>{studio.services.length ? <div className="services-list">{studio.services.map(service => <div className="service-row cabinet-service-item" key={service.id}><div className="cabinet-service-details"><div className="cabinet-service-heading"><h3>{service.name}</h3><strong>{servicePriceLabel(service.price)}</strong></div><span>{service.duration} мин</span><ServiceDirectionEditor key={service.id+':'+service.category+':'+studio.profile?.categories?.join()} service={service} categories={studio.profile?.categories||[]} endpoint="/services" onDone={resource.reload}/>{removalFeedback('service', service.id)}</div><button className="cabinet-service-remove" type="button" aria-label={'Удалить услугу ' + service.name} disabled={Boolean(removal?.pending)} aria-busy={removal?.pending && removal.id === service.id} onClick={() => void remove('service', service.id)}><Trash2 size={17}/></button></div>)}</div> : <EmptyState title="Услуг пока нет" text="Добавьте первую услугу, чтобы клиенты могли выбрать время записи."/>}</section> : null}
    {tab === 'appearance' ? <PersonalAppearance key={profile.user_id} profile={profile} onDone={() => { resource.reload(); void refreshMe(); }}/>: null}
    {tab === 'settings' ? <div className="studio-settings"><section className="studio-panel"><div className="section-head compact"><div><span className="eyebrow">ПРОФЕССИОНАЛЬНАЯ ВИЗИТКА</span><h2>О вашей <em>странице.</em></h2></div></div><PublicationControl studio={studio} onDone={() => { resource.reload(); refreshMe(); }} openTab={setTab}/><ProfileForm initial={profile} onDone={notice => { setSaveNotice(notice || ""); resource.reload(); refreshMe(); }}/></section><div className="studio-settings-side"><section className="studio-panel" id="studio-schedule"><div className="section-head compact"><div><span className="eyebrow">ДЛЯ ЗАПИСИ</span><h2>Рабочий <em>график.</em></h2></div></div>{studio.schedule ? <ScheduleForm schedule={studio.schedule} configured={studio.schedule_configured} onDone={resource.reload}/> : <p>Обновите страницу, чтобы настроить расписание.</p>}</section><section className="studio-panel"><h2>Аккаунт</h2><Link className="button button-outline" to="/access">Вход и безопасность</Link><div className="settings-aside"><p>Уведомления о новых заявках</p><PushButton/></div><button className="button button-outline logout-button" onClick={async () => { await json('/auth/logout', 'POST', {}); await refreshMe(); navigate('/'); }}><LogOut size={16}/> Выйти</button></section></div></div> : null}</MasterCabinet>;
}


function PublicationControl({ studio, onDone, openTab }: { studio: Studio; onDone: () => void; openTab: (tab: StudioTab) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const published = Boolean(studio.profile?.published);
  const hasService = studio.services.length > 0;
  const hasSchedule = Boolean(studio.schedule_configured && studio.schedule && scheduleHasWork(studio.schedule));
  async function toggle() {
    setBusy(true); setError('');
    try { await json('/profile/publication', 'PATCH', { published: !published }); onDone(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Не удалось изменить видимость страницы'); }
    finally { setBusy(false); }
  }
  return <section className="publication-control" aria-label="Видимость страницы">
    <div><h3>{published ? 'Страница открыта клиентам' : 'Страница пока скрыта'}</h3><p>{published ? 'Клиенты видят вашу страницу и могут выбрать свободное время.' : 'Проверьте услугу и сохраните график. Работы можно добавить сейчас или позже.'}</p></div>
    {!published && !hasService ? <button type="button" className="text-link" onClick={() => openTab('services')}>Добавить услугу <ArrowRight size={16}/></button> : null}
    {!published && !hasSchedule ? <a className="text-link" href="#studio-schedule">Настроить график <ArrowRight size={16}/></a> : null}
    <button type="button" className={'button ' + (published ? 'button-outline' : 'button-wine')} disabled={busy || (!published && (!hasService || !hasSchedule))} onClick={toggle}>{busy ? 'Сохраняем…' : published ? 'Скрыть страницу' : 'Открыть страницу клиентам'}</button>
    {error ? <p className="form-error" role="alert">{error}</p> : null}
  </section>;
}

function ProfileForm({ initial, addressDraft, onDone }: { initial?: Studio['profile']; addressDraft?: StoredAddress | null; onDone: (notice?: string) => void }) {
  const [name, setName] = useState(initial?.name || ''); const [slug, setSlug] = useState(initial?.slug || '');
  const [addressValue, setAddressValue] = useState<AddressValue>(() => addressValueFromStored(initial || addressDraft));
  const [savedAddress, setSavedAddress] = useState(addressValue);
  const [addressBusy, setAddressBusy] = useState(false);
  const [categories, setCategories] = useState<string[]>(initial ? (initial.categories?.length ? initial.categories : [initial.category]) : []);
  const [teaches, setTeaches] = useState(Boolean(initial?.teaches));
  const [lookingModels,setLookingModels]=useState(Boolean(initial?.looking_models));
  const availableDirections = [...directions, ...(initial?.categories || []).filter(value => !directions.includes(value))];
  const [bio, setBio] = useState(initial?.bio || '');
  const [experience, setExperience] = useState<number | null>(initial?.experience_months ?? null);
  const [experienceError, setExperienceError] = useState('');
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!initial && (addressChanged(addressValue, savedAddress) || !savedAddress.city)) { setError('Сначала сохраните адрес.'); return; }
    if (!categories.length) { setError('Выберите хотя бы одно направление.'); return; }
    if (experienceError) { setError(experienceError); return; }
    setBusy(true); setError('');
    try { await json('/profile', 'PUT', { name, slug, categories, teaches, looking_models:lookingModels, bio, experience_months: experience, address_mode: 'preserve' }); onDone(addressChanged(addressValue, savedAddress) ? 'Страница сохранена. Адрес сохраните отдельно.' : initial ? 'Страница сохранена.' : 'Страница создана и пока скрыта от клиентов.'); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Не удалось сохранить'); } finally { setBusy(false); }
  }
  return <form className="settings-form" onSubmit={submit}>
    <div className="form-row"><label>Ваше имя<input value={name} onChange={event => setName(event.target.value)} maxLength={80} required/></label><label>Адрес страницы<input value={slug} onChange={event => setSlug(event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))} minLength={3} maxLength={40} placeholder="anna-makeup" required/></label></div>
    <fieldset className="category-picker"><legend>Направления деятельности</legend><p>Отметьте всё, чем занимаетесь.</p><div className="category-options">{availableDirections.map(direction => <label key={direction}><input type="checkbox" checked={categories.includes(direction)} onChange={event => setCategories(current => event.target.checked ? [...current, direction] : current.filter(value => value !== direction))}/><span>{direction}</span></label>)}</div></fieldset>
    <fieldset className="teaching-picker"><legend>Обучение</legend><label><input type="checkbox" checked={teaches} onChange={event => setTeaches(event.target.checked)}/><span>Провожу обучение</span></label><p>Отметка обучения появится в вашей карточке и на странице.</p><label><input type="checkbox" checked={lookingModels} onChange={event=>setLookingModels(event.target.checked)}/><span>Ищу моделей</span></label><p>Отметка появится рядом с обучением. Условия вы согласуете с клиентом отдельно.</p></fieldset>
    <label>О себе<textarea value={bio} onChange={event => setBio(event.target.value)} maxLength={1500} rows={4} placeholder="Ваш подход, опыт и любовь к делу"/></label>
    <ExperienceFields value={experience} onChange={setExperience} onValidationChange={setExperienceError}/>
    <AddressFields value={addressValue} saveEndpoint="/profile/address" onStart={() => setError('')} onChange={next => { setError(''); setAddressValue(next); }} onSaved={next => { setError(''); setAddressValue(next); setSavedAddress(next); }} onBusy={setAddressBusy} busy={busy}/>
    {!initial ? <p className="setup-hint">Страница пока будет видна только вам. Фотографии работ можно добавить до её открытия клиентам.</p> : null}
    {error ? <p className="form-error" role="alert">{error}</p> : null}<button className="button button-dark" disabled={busy || addressBusy}>{busy ? 'Сохраняем…' : initial ? 'Сохранить страницу' : 'Создать страницу'} <ArrowRight size={16}/></button>
  </form>;
}

function ServiceForm({ onDone,categories }: { onDone: () => void;categories:string[] }) {
  const [category,setCategory]=useState('');const selectedCategory=categories.includes(category)?category:categories.length===1?categories[0]:'';
  const [name, setName] = useState(''); const [price, setPrice] = useState(''); const [duration, setDuration] = useState('60');
  const [error, setError] = useState(''); const [message, setMessage] = useState(''); const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  async function submit(event: FormEvent) {
    event.preventDefault(); if (submitting.current) return;
    submitting.current = true; setBusy(true); setError(''); setMessage('');
    try { await json('/services', 'POST', { name, price: Number(price), duration: Number(duration),category:selectedCategory }); setName(''); setPrice(''); setMessage('Услуга добавлена в список.'); onDone(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Не удалось добавить услугу'); }
    finally { submitting.current = false; setBusy(false); }
  }
  return <form className="inline-service-form" onSubmit={submit} aria-busy={busy}><label>Название услуги<input value={name} onChange={event => setName(event.target.value)} maxLength={120} placeholder="Например, дневной макияж" required disabled={busy}/></label><label>Цена от, ₽<input type="number" min="0" max="1000000" value={price} onChange={event => setPrice(event.target.value)} required disabled={busy}/></label><label>Длительность, мин<input type="number" min="5" max="720" value={duration} onChange={event => setDuration(event.target.value)} required disabled={busy}/></label><ServiceDirectionSelect categories={categories} value={selectedCategory} onChange={setCategory} disabled={busy}/><button className="button button-wine" disabled={busy}><Plus size={16}/>{busy ? 'Добавляем…' : 'Добавить услугу'}</button>{message ? <p className="studio-action-notice" role="status">{message}</p> : null}{error ? <p className="form-error" role="alert">{error}</p> : null}</form>;
}

type ScheduleFormProps = { schedule: Schedule; onDone: () => void | Promise<unknown>; endpoint?: string; configured?: boolean; lockedOffset?: number; copyFrom?: {id:string;name:string;schedule:Schedule}[] };
export function ScheduleForm(props: ScheduleFormProps) {
  return <ScheduleEditor key={(props.endpoint||'/schedule')+Boolean(props.configured)} {...props}/>;
}
function ScheduleEditor({schedule,onDone,endpoint='/schedule',configured=true,lockedOffset,copyFrom=[]}:ScheduleFormProps) {
  const [value,setValue]=useState<Schedule>({...schedule,weekdays:configured?schedule.weekdays:[],utc_offset:lockedOffset??schedule.utc_offset});
  const [saved,setSaved]=useState(configured?JSON.stringify(value):'');
  const [message,setMessage]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const submitting=useRef(false),dirty=JSON.stringify(value)!==saved;
  async function submit(event:FormEvent){
    event.preventDefault();if(submitting.current)return;
    submitting.current=true;setBusy(true);setMessage('');setError('');
    try{
      const result=await json<Schedule & {conflicting_appointments?:number}>(endpoint,'PUT',value);
      setSaved(JSON.stringify(value));setMessage(result.conflicting_appointments?`График сохранён. ${result.conflicting_appointments} существующих записей вне новых рабочих часов сохранены. Проверьте календарь.`:'График сохранён. Свободное время обновлено.');await onDone();
    }catch(reason){setError(reason instanceof Error?reason.message:'Не удалось сохранить график')}
    finally{submitting.current=false;setBusy(false)}
  }
  return <form className="settings-form schedule-editor" onSubmit={submit}><p className={'schedule-save-state'+(dirty?' unsaved':'')} role="status">{!saved?'График ещё не сохранён.':dirty?'Изменения ещё не сохранены.':'Действует сохранённый график.'}</p><fieldset className="schedule-fields" disabled={busy}>{copyFrom.length?<label>Скопировать график<select aria-label="Скопировать график" value="" onChange={e=>{const source=copyFrom.find(p=>p.id===e.target.value);if(source)setValue({...source.schedule,weekdays:[...source.schedule.weekdays],exceptions:source.schedule.exceptions?.map(item=>({...item})),utc_offset:lockedOffset??source.schedule.utc_offset})}}><option value="">Выберите мастера</option>{copyFrom.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>:null}<ScheduleFields value={value} onChange={setValue} lockedOffset={lockedOffset}/></fieldset>{!scheduleHasWork(value)?<p className="setup-hint">Рабочие дни не выбраны. После сохранения онлайн-запись будет закрыта.</p>:null}{message?<p role="status">{message}</p>:null}{error?<p className="form-error" role="alert">{error}</p>:null}<button className="button button-dark" disabled={busy||!dirty}><Settings2 size={16}/>{busy?'Сохраняем…':'Сохранить график'}</button></form>;
}

export function AppointmentList({ appointments, onChange, master = false, offset }: { appointments: Appointment[]; onChange: () => void; master?: boolean; offset?: number }) {
  const sorted = useMemo(() => [...appointments].sort((a, b) => a.start - b.start), [appointments]);
  async function update(id: string, status: Appointment['status']) { try { await json('/appointments/' + id, 'PATCH', { status }); onChange(); } catch (reason) { alert(reason instanceof Error ? reason.message : 'Не удалось изменить запись'); } }
  return <div className="appointment-list">{sorted.map(visit => <article className="appointment-card" key={visit.id}><div className="appointment-date"><b>{offset === undefined ? new Date(visit.start).getDate() : Number(masterDayKey(visit.start, offset).slice(-2))}</b><small>{offset === undefined ? prettyDate(visit.start, { month: 'short' }) : masterDate(visit.start, offset, { month: 'short' })}</small></div><div><span className={'status-pill ' + visit.status}>{statusLabel(visit.status)}</span><h3>{visit.service}</h3><p>{visit.client_name} · {offset === undefined ? prettyTime(visit.start) : masterTime(visit.start, offset)} · {money(visit.price)}</p>{visit.guest_contact ? <p className="muted">Контакт: {visit.guest_contact}</p> : null}{visit.notes ? <p className="muted">{visit.notes}</p> : null}</div>{master ? <div className="appointment-actions">{visit.status === 'pending' ? <button onClick={() => update(visit.id, 'confirmed')}><Check size={15}/> Подтвердить</button> : null}{visit.status === 'confirmed' ? <button onClick={() => update(visit.id, 'done')}>Завершить</button> : null}{['pending', 'confirmed'].includes(visit.status) ? <button className="danger" onClick={() => { if (confirm('Отменить запись?')) update(visit.id, 'cancelled'); }}>Отменить</button> : null}</div> : null}</article>)}</div>;
}

export function CalendarPage() {
  const { me } = useApp();
  const calendarOwner = me?.user?.account_type === 'master' ? me.user.id : '';
  const resource = useResource<[Appointment[], Studio, string]>(() => calendarOwner ? Promise.all([api<Appointment[]>('/appointments'), api<Studio>('/studio')]).then(([appointments, studio]) => [appointments, studio, calendarOwner]) : Promise.resolve([[], { profile: null, services: [], works: [] }, '']), [calendarOwner]);
  if (!me) return <Loading/>;
  if (me.user?.account_type === 'salon' || (me.user?.account_type === 'client' && me.workspaces?.some(w => w.kind === 'salon'))) return <Navigate to="/salon" replace/>;
  if (!me.user) return <div className="container page-content"><div className="editorial-heading"><h1>Войдите, чтобы увидеть <em>календарь.</em></h1><Link className="button button-dark" to="/auth">Войти</Link></div></div>;
  if (me.user.account_type === 'client') return <Navigate to="/me" replace/>;
  if (!resource.data || resource.data[2] !== calendarOwner) return resource.error ? <ErrorState message={resource.error} retry={resource.reload}/> : <Loading/>;
  const [appointments, studio] = resource.data;
  if (!studio.profile) return <Navigate to="/studio" replace/>;
  return <CalendarWorkspace key={studio.profile.user_id} studio={{ ...studio, profile: studio.profile }} appointments={appointments} reload={resource.reload} refreshError={resource.error} refreshBusy={resource.loading}/>;
}
