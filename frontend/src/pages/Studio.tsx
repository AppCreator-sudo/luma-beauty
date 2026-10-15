import {ServiceDirectionEditor,ServiceDirectionSelect} from '../components/ServiceDirection';
import { useHistoryState } from '../lib/useHistoryState';
import { ExperienceFields } from '../components/ExperienceFields';
import { useMemo, useRef, useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowRight, Check, LogOut, Plus, Settings2, Trash2 } from 'lucide-react';
import { api, json, money, prettyDate, prettyTime, masterDayKey, masterDate, masterTime, statusLabel, type Appointment, type Schedule, type Studio } from '../lib/api';
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

type StudioTab = 'overview' | 'works' | 'services' | 'appearance' | 'settings';
type StudioData = [Studio, Appointment[], string];

export function StudioPage() {
  const { me, refreshMe } = useApp();
  const navigate = useNavigate();
  const [studioParams] = useSearchParams();
  const requestedTab = studioParams.get('tab');
  const [tab, setTab] = useHistoryState<StudioTab>('studio-tab', () => ['overview','works','services','appearance','settings'].includes(requestedTab || '') ? requestedTab as StudioTab : 'overview');
  const [saveNotice, setSaveNotice] = useState('');
  const masterId = me?.user?.account_type === 'master' ? me.user.id : '';
  const resource = useResource<StudioData>(() => masterId ? Promise.all([api<Studio>('/studio'), api<Appointment[]>('/appointments')]).then(([studio, appointments]): StudioData => [studio, appointments, masterId]) : Promise.resolve([{ profile: null, services: [], works: [] }, [], '']), [masterId]);
  if (!me) return <Loading/>;
  if (me.user?.account_type === 'salon' || (me.user?.account_type === 'client' && me.workspaces?.some(w => w.kind === 'salon'))) return <Navigate to="/salon" replace/>;
  if (!me.user) return <div className="container page-content"><div className="editorial-heading"><span className="eyebrow">ДЛЯ ТЕХ, КТО СОЗДАЁТ КРАСОТУ</span><h1>Ваше личное <em>пространство.</em></h1><p>Откройте студию, опубликуйте работы и принимайте запись по личной ссылке.</p><Link className="button button-wine" to="/auth?role=master">Создать студию <ArrowRight size={17}/></Link></div></div>;
  if (me.user.account_type !== 'master') return <div className="container page-content"><div className="editorial-heading"><h1>Вы вошли как <em>клиент.</em></h1><p>Ваши записи и сохранённые работы находятся в личном кабинете.</p><Link className="button button-dark" to="/me">Открыть мой кабинет</Link></div></div>;
  if (!resource.data || resource.data[2] !== masterId) return resource.error ? <ErrorState message={resource.error} retry={resource.reload}/> : <Loading/>;
  const [studio, appointments] = resource.data;
  if (!studio.profile) return <div className="container studio-page"><div className="editorial-heading"><span className="eyebrow">ПЕРВОЕ ЗНАКОМСТВО</span><h1>Расскажите <em>о себе.</em></h1><p>Сначала создайте скрытую страницу. Затем добавьте услугу и график — и откройте запись клиентам.</p><Link className="text-link" to="/access">Вход и безопасность</Link></div><div className="studio-form-card"><ProfileForm addressDraft={studio.address_draft} onDone={notice => { setSaveNotice(notice || ""); resource.reload(); refreshMe(); }}/></div></div>;
  const profile = studio.profile;
  async function share() { const url = location.origin + '/v2/m/' + profile.slug; if (navigator.share) await navigator.share({ title: profile.name, url }).catch(() => {}); else { await navigator.clipboard.writeText(url); alert('Ссылка скопирована'); } }
  return <MasterCabinet profile={profile} tab={tab} openTab={setTab} share={share}>
    {saveNotice ? <p role="status">{saveNotice}</p> : null}
    {resource.error ? <div className="studio-refresh-error" role="alert"><span>Не удалось обновить кабинет: {resource.error}</span><button className="text-link" type="button" disabled={resource.loading} onClick={() => void resource.reload()}>Повторить обновление</button></div> : null}
    {tab === 'overview' ? <MasterOverview studio={{...studio, profile}} appointments={appointments} openTab={setTab} reload={resource.reload}/> : null}
    {tab === 'works' ? <section className="studio-panel studio-works-panel"><div className="section-head compact"><div><span className="eyebrow">ВАШИ ИСТОРИИ</span><h2>Мои <em>работы.</em></h2></div></div><WorkUpload services={studio.services} onDone={resource.reload}/><div className="studio-list-heading"><h3>Ваше портфолио</h3><span>Работ: {studio.works.length}</span></div>{studio.works.length ? <div className="studio-work-grid">{studio.works.map(work => <article key={work.id}><Link to={'/w/' + work.id}><img src={work.image} alt={work.caption || 'Ваша работа'}/></Link><div><p>{work.caption || 'Без подписи'}</p><button type="button" aria-label="Удалить работу" onClick={async () => { if (confirm('Удалить работу?')) { await api('/works/' + work.id, { method: 'DELETE' }); resource.reload(); } }}><Trash2 size={17}/></button></div></article>)}</div> : <p className="studio-list-hint">Сохранённые работы появятся здесь. Добавить фото можно и на скрытой странице.</p>}</section> : null}
    {tab === 'services' ? <section className="studio-panel studio-services-panel"><div className="section-head compact"><div><span className="eyebrow">ВАШИ УСЛУГИ</span><h2>Услуги <em>и цены.</em></h2></div></div><ServiceForm categories={studio.profile?.categories||[]} onDone={resource.reload}/><div className="studio-list-heading"><h3>Список услуг</h3><span>Услуг: {studio.services.length}</span></div>{studio.services.length ? <div className="services-list">{studio.services.map(service => <div className="service-row" key={service.id}><div><h3>{service.name}</h3><span>{service.duration} мин</span><ServiceDirectionEditor key={service.id+':'+service.category+':'+studio.profile?.categories?.join()} service={service} categories={studio.profile?.categories||[]} endpoint="/services" onDone={resource.reload}/></div><div><strong>{money(service.price)}</strong><button type="button" aria-label={'Удалить услугу ' + service.name} onClick={async () => { if (confirm('Удалить услугу?')) { await api('/services/' + service.id, { method: 'DELETE' }); resource.reload(); } }}><Trash2 size={17}/></button></div></div>)}</div> : <EmptyState title="Услуг пока нет" text="Добавьте первую услугу, чтобы клиенты могли выбрать время записи."/>}</section> : null}
    {tab === 'appearance' ? <PersonalAppearance key={profile.user_id} profile={profile} onDone={() => { resource.reload(); void refreshMe(); }}/>: null}
    {tab === 'settings' ? <div className="studio-settings"><section className="studio-panel"><div className="section-head compact"><div><span className="eyebrow">ПРОФЕССИОНАЛЬНАЯ ВИЗИТКА</span><h2>О вашей <em>странице.</em></h2></div></div><PublicationControl studio={studio} onDone={() => { resource.reload(); refreshMe(); }} openTab={setTab}/><ProfileForm initial={profile} onDone={notice => { setSaveNotice(notice || ""); resource.reload(); refreshMe(); }}/></section><div className="studio-settings-side"><section className="studio-panel" id="studio-schedule"><div className="section-head compact"><div><span className="eyebrow">ДЛЯ ЗАПИСИ</span><h2>Рабочий <em>график.</em></h2></div></div>{studio.schedule ? <ScheduleForm schedule={studio.schedule} configured={studio.schedule_configured} onDone={resource.reload}/> : <p>Обновите страницу, чтобы настроить расписание.</p>}</section><section className="studio-panel"><h2>Аккаунт</h2><Link className="button button-outline" to="/access">Вход и безопасность</Link><div className="settings-aside"><p>Уведомления о новых заявках</p><PushButton/></div><button className="button button-outline logout-button" onClick={async () => { await json('/auth/logout', 'POST', {}); await refreshMe(); navigate('/'); }}><LogOut size={16}/> Выйти</button></section></div></div> : null}</MasterCabinet>;
}

function formatMinutes(value: number) { return String(Math.floor(value / 60)).padStart(2, '0') + ':' + String(value % 60).padStart(2, '0'); }
function timeMinutes(value: string) { const [hours, minutes] = value.split(':').map(Number); return hours * 60 + minutes; }

function PublicationControl({ studio, onDone, openTab }: { studio: Studio; onDone: () => void; openTab: (tab: StudioTab) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const published = Boolean(studio.profile?.published);
  const hasService = studio.services.length > 0;
  const hasSchedule = Boolean(studio.schedule_configured && studio.schedule?.weekdays.length);
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
  return <form className="inline-service-form" onSubmit={submit} aria-busy={busy}><label>Название услуги<input value={name} onChange={event => setName(event.target.value)} maxLength={120} placeholder="Например, дневной макияж" required disabled={busy}/></label><label>Цена, ₽<input type="number" min="0" max="1000000" value={price} onChange={event => setPrice(event.target.value)} required disabled={busy}/></label><label>Длительность, мин<input type="number" min="5" max="720" value={duration} onChange={event => setDuration(event.target.value)} required disabled={busy}/></label><ServiceDirectionSelect categories={categories} value={selectedCategory} onChange={setCategory} disabled={busy}/><button className="button button-wine" disabled={busy}><Plus size={16}/>{busy ? 'Добавляем…' : 'Добавить услугу'}</button>{message ? <p className="studio-action-notice" role="status">{message}</p> : null}{error ? <p className="form-error" role="alert">{error}</p> : null}</form>;
}

type ScheduleFormProps = { schedule: Schedule; onDone: () => void | Promise<unknown>; endpoint?: string; configured?: boolean; lockedOffset?: number };
export function ScheduleForm(props: ScheduleFormProps) {
  // Changing employee or receiving a newly saved schedule must reset the form.
  const { schedule, endpoint = '/schedule', configured = true } = props;
  const key = JSON.stringify([endpoint, configured, schedule.opening, schedule.closing, schedule.utc_offset, schedule.weekdays]);
  return <ScheduleEditor key={key} {...props}/>;
}
function ScheduleEditor({ schedule, onDone, endpoint = '/schedule', configured = true, lockedOffset }: ScheduleFormProps) {
  const [opening, setOpening] = useState(formatMinutes(schedule.opening)); const [closing, setClosing] = useState(formatMinutes(schedule.closing)); const [offset, setOffset] = useState(schedule.utc_offset); const [days, setDays] = useState(configured ? schedule.weekdays : []);
  const signature = (open: string, close: string, zone: number, weekdays: number[]) => JSON.stringify([open, close, zone, [...weekdays].sort((a, b) => a - b)]);
  const [saved, setSaved] = useState(configured ? signature(opening, closing, offset, days) : '');
  const [message, setMessage] = useState(''); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const dirty = signature(opening, closing, offset, days) !== saved;
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setMessage(''); setError('');
    try { await json(endpoint, 'PUT', { opening: timeMinutes(opening), closing: timeMinutes(closing), utc_offset: offset, weekdays: days }); setSaved(signature(opening, closing, offset, days)); setMessage('График сохранён. Свободное время обновлено.'); await onDone(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Не удалось сохранить график'); }
    finally { setBusy(false); }
  }
  return <form className="settings-form schedule-editor" onSubmit={submit}>
    <p className={'schedule-save-state' + (dirty ? ' unsaved' : '')} role="status">{!saved ? 'График ещё не сохранён. Выберите рабочие дни.' : dirty ? 'Изменения графика ещё не сохранены.' : 'Действует сохранённый график.'}</p>
    <fieldset className="schedule-fields" disabled={busy}><div className="form-row"><label>Начало дня<input type="time" value={opening} onChange={event => { setOpening(event.target.value); setMessage(''); }} required/></label><label>Конец дня<input type="time" value={closing} onChange={event => { setClosing(event.target.value); setMessage(''); }} required/></label></div><label>Часовой пояс{lockedOffset !== undefined ? <span>UTC+{lockedOffset / 60} · По времени салона</span> : <select value={offset} onChange={event => { setOffset(Number(event.target.value)); setMessage(''); }}>{Array.from({ length: 11 }, (_, index) => (index + 2) * 60).map(value => <option key={value} value={value}>UTC+{value / 60}</option>)}</select>}</label><fieldset className="weekday-picker"><legend>Рабочие дни</legend>{['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].map((label, index) => { const day = (index + 1) % 7; return <label key={day}><input type="checkbox" checked={days.includes(day)} onChange={event => { const checked = event.target.checked; setDays(current => checked ? [...current, day] : current.filter(value => value !== day)); setMessage(''); }}/>{label}</label>; })}</fieldset></fieldset>
    {!days.length ? <p className="setup-hint">Рабочие дни не выбраны. После сохранения онлайн-запись будет закрыта.</p> : null}
    {message ? <p role="status">{message}</p> : null}{error ? <p className="form-error" role="alert">{error}</p> : null}<button className="button button-dark" disabled={busy || !dirty}><Settings2 size={16}/>{busy ? 'Сохраняем…' : 'Сохранить график'}</button>
  </form>;
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
