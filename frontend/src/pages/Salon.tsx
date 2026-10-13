import { useHistoryState } from '../lib/useHistoryState';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Archive, CalendarDays, Check, Copy, Eye, EyeOff, LogOut, Plus, Settings2, Trash2, Users } from 'lucide-react';
import { api, json, masterDate, masterDayKey, masterTime, money, statusLabel, type Appointment, type Performer, type Salon } from '../lib/api';
import { useResource } from '../lib/useResource';
import { EmptyState, ErrorState, Loading, useApp } from '../components/Shell';
import { ScheduleForm } from './Studio';
import '../staff-workspace.css';
import '../owner-workspace.css';
import { SalonSettings } from './SalonSettings';
import { SalonArchives, StaffArchive, TeamCalendar, type CalendarJump } from './SalonTeam';
import { ImageUploadField } from '../components/SalonVisual';
import { CabinetIdentity } from '../components/AppearanceEditor';
import '../salon-cabinet.css';
import {StaffSetupForm} from '../components/StaffSetupForm';
import {SalonPublications} from '../components/SalonPublications';
import { CabinetVisitForm } from '../components/CabinetVisitForm';
import '../cabinet-flows.css';
import { SalonOwnerCabinet } from '../components/SalonOwnerCabinet';

const message = (reason: unknown) => reason instanceof Error ? reason.message : 'Не удалось выполнить действие';

export function SalonPage() {
  const { me, refreshMe } = useApp();
  const navigate = useNavigate();
  const [workspaceId, setWorkspaceId] = useState('');
  if (!me) return <Loading/>;
  if (!me.user) return <div className="container page-content"><div className="editorial-heading"><h1>Ваш салон, <em>ваша команда.</em></h1><p>Управляйте записями вместе с сотрудниками.</p><Link className="button button-wine" to="/auth?role=salon">Создать кабинет салона</Link></div></div>;
  const workspaces = me.workspaces?.filter(w => w.kind === 'salon') || [];
  const workspace = workspaces.find(w => w.id === workspaceId) || workspaces[0];
  if (workspace?.role === 'owner') return <WorkspaceCabinet key={me.user.id + workspace.id} id={workspace.id} onWorkspaceChange={setWorkspaceId}/>;
  return <div className={"container salon-page" + (workspace?.role === 'staff' ? ' employee-workspace' : workspace?.role === 'owner' ? ' owner-workspace' : '')}>
    {!workspace ? <div className="studio-welcome"><div><span className="eyebrow">МОЙ САЛОН</span><h1>Соберите <em>команду.</em></h1><p>Начните с названия и города. Сотрудников добавим следующим шагом.</p></div><div className="studio-header-actions"><Link className="button button-outline" to="/access">Вход и безопасность</Link>{me.user.account_type === 'master' ? <Link className="button button-outline" to="/studio">Личная практика</Link> : null}<button className="button button-outline" onClick={async () => { await json('/auth/logout', 'POST', {}); await refreshMe(); navigate('/'); }}><LogOut size={16}/> Выйти</button></div></div> : null}
    {workspaces.length > 1 ? <label className="salon-switch">Рабочее место<select value={workspace?.id} onChange={e => setWorkspaceId(e.target.value)}>{workspaces.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}</select></label> : null}
    {workspace ? <WorkspaceCabinet key={me.user.id + workspace.id} id={workspace.id}/> : <CreateSalon onDone={refreshMe}/>}
  </div>;
}

function CreateSalon({ onDone }: { onDone: () => Promise<void> }) {
  const [name, setName] = useState(''); const [city, setCity] = useState(''); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) { e.preventDefault(); setBusy(true); setError(''); try { await json('/salons', 'POST', { name, city }); await onDone(); } catch (r) { setError(message(r)); } finally { setBusy(false); } }
  return <section className="studio-panel salon-create"><form className="settings-form" onSubmit={submit}><label>Название салона<input value={name} onChange={e => setName(e.target.value)} maxLength={80} required placeholder="Например, Студия красоты"/></label><label>Город<input value={city} onChange={e => setCity(e.target.value)} maxLength={80} required placeholder="Новосибирск"/></label>{error ? <p className="form-error" role="alert">{error}</p> : null}<button className="button button-wine" disabled={busy}>{busy ? 'Создаём…' : 'Продолжить к сотрудникам'}</button></form></section>;
}

function WorkspaceCabinet({ id, onWorkspaceChange }: { id: string; onWorkspaceChange?: (id: string) => void }) {
  const { me, refreshMe } = useApp();
  const navigate = useNavigate();
  const [screen, setScreen] = useHistoryState<'overview' | 'team' | 'works' | 'page' | 'archive'>('linked-salon-screen-' + id, 'overview');
  const resource = useResource(() => api<Salon>('/salons/' + id), [id]);
  const [selected, setSelected] = useState(''); const [adding, setAdding] = useState(false);
  const [jump,setJump] = useState<CalendarJump | null>(null);
  const [overviewDate,setOverviewDate] = useState('');
  const [saveNotice,setSaveNotice] = useState('');
  const [appearanceRequest, setAppearanceRequest] = useState(0);
  if (resource.loading && !resource.data) return <Loading/>;
  if (!resource.data) return <ErrorState message={resource.error || 'Не удалось открыть салон'} retry={resource.reload}/>;
  const salon = resource.data, owner = salon.workspace.role === 'owner';
  const staff = salon.staff.find(p => p.id === selected) || salon.staff[0];
  if (owner) return <SalonOwnerCabinet salon={salon} reload={resource.reload} onWorkspaceChange={onWorkspaceChange}/>;
  return <>
    <div className="studio-welcome salon-workspace-welcome"><CabinetIdentity name={owner ? salon.workspace.name : staff?.name || salon.workspace.name} image={owner ? salon.workspace.logo : staff?.profile?.avatar} logo={salon.workspace.logo} cover={salon.workspace.cover} kind={owner ? 'salon' : 'staff'} salonName={salon.workspace.name} heading="h1" description={salon.workspace.city + ' · ' + (owner ? 'Вы управляете командой и календарями' : 'Ваш календарь, услуги и работы')} onEdit={() => { if (owner) setScreen('page'); else setAppearanceRequest(value => value + 1); }}/><div className="studio-header-actions"><Link className="button button-outline" to="/access">Вход и безопасность</Link>{me?.user?.account_type === 'master' ? <Link className="button button-outline" to="/studio">Личная практика</Link> : null}<button className="button button-outline" onClick={async () => { await json('/auth/logout', 'POST', {}); await refreshMe(); navigate('/'); }}><LogOut size={16}/> Выйти</button></div></div>
    {saveNotice ? <p role="status">{saveNotice}</p> : null}
    {resource.error ? <div className="salon-cabinet-refresh-error" role="alert"><span>{resource.error}</span><button type="button" disabled={resource.loading} onClick={() => void resource.reload()}>Обновить данные</button></div> : null}
    {owner ? <div className="studio-tabs salon-main-tabs" role="tablist" aria-label="Разделы салона">{([['overview','Календарь команды'],['team','Сотрудники'],['works','Работы'],['page','Страница салона'],['archive','Архив']] as const).map(([key,label])=><button role="tab" key={key} aria-selected={screen===key} className={screen===key?'active':''} onClick={()=>setScreen(key)}>{label}</button>)}</div> : null}
    {screen==='overview' && owner ? <TeamCalendar salon={salon} initialDate={overviewDate} onDateChange={setOverviewDate} onOpen={(pid,next)=>{setSelected(pid);setJump(next);setOverviewDate(next.date);setScreen('team');}}/> : screen==='archive' && owner ? <SalonArchives salon={salon} onDone={resource.reload}/> : screen==='works' && owner ? <section className="studio-panel salon-works-panel"><div className="section-head compact"><div><span className="eyebrow">РАБОТЫ И ЖИЗНЬ САЛОНА</span><h2>Ваши <em>публикации.</em></h2></div></div><SalonPublications workspaceId={id} team={salon.staff} onChange={resource.reload}/></section> : screen==='page' && owner ? <SalonSettings workspace={salon.workspace} onDone={notice=>{setSaveNotice(notice || "");resource.reload();void refreshMe();}}/> : <>
    {owner ? <section className="salon-team studio-panel"><div className="section-head compact"><div><span className="eyebrow">КОМАНДА</span><h2>Ваши <em>мастера.</em></h2></div><button className="button button-outline" onClick={() => setAdding(v => !v)} aria-expanded={adding}><Plus size={16}/> {adding ? 'Скрыть форму' : 'Добавить сотрудника'}</button></div>
      <div className="owner-team-summary"><span>В команде: <b>{salon.staff.length}</b></span><span>Показ включён: <b>{salon.staff.filter(p => p.bookable).length}</b></span><span>Скрыты: <b>{salon.staff.filter(p => !p.bookable).length}</b></span></div>
      <p className="muted">Выберите мастера для работы с его календарём. Все карточки, услуги и графики ведёт владелец.</p>
      {adding ? <StaffSetupForm workspace={salon.workspace} team={salon.staff} onDone={pid => { setSelected(pid); setAdding(false); resource.reload(); }}/> : null}
      {salon.staff.length ? <div className="salon-staff-list" aria-label="Сотрудники">{salon.staff.map(p => <button key={p.id} aria-pressed={staff?.id === p.id} className={staff?.id === p.id ? 'active' : ''} onClick={() => {setSelected(p.id);setJump(null);}}><Users size={17}/><span><b>{p.name}</b><small>{p.profile?.categories?.join(' · ') || 'Направления не выбраны'}</small><small className={'staff-list-visibility '+(p.bookable ? 'is-visible' : 'is-hidden')}>{p.ready === false ? 'Добавьте: '+p.missing?.join(', ') : p.bookable ? 'Показ включён' : 'Скрыт от клиентов'}</small></span></button>)}</div> : <EmptyState title="Добавьте первого мастера" text="Заполните фото, имя, направления, график и назначьте услуги."/>}
    </section> : null}
    {staff ? <PerformerCabinet key={staff.id+':'+(jump?.key||'')} staff={staff} owner={owner} workspaceId={id} team={salon.staff} salonName={salon.workspace.name} salonLogo={salon.workspace.logo} salonCover={salon.workspace.cover} salonPublished={Boolean(salon.workspace.published)} salonOffset={salon.workspace.utc_offset??180} appearanceRequest={appearanceRequest} jump={jump} onChange={resource.reload} onArchived={()=>{setSelected('');setJump(null);resource.reload();setScreen('archive');void refreshMe();}}/> : null}
    </>}
  </>;
}

function PerformerCabinet({ staff, owner, workspaceId, team, salonName, salonLogo, salonCover, salonPublished, salonOffset, appearanceRequest, jump, onChange, onArchived }: { staff: Performer; owner: boolean; workspaceId: string; team: Performer[]; salonName: string; salonLogo?: string; salonCover?: string; salonPublished: boolean; salonOffset: number; appearanceRequest: number; jump: CalendarJump | null; onChange: () => void; onArchived: () => void }) {
  const [tab, setTab] = useHistoryState<'calendar' | 'services' | 'schedule' | 'works' | 'appearance' | 'profile' | 'access'>('linked-staff-tab-' + staff.id, () => staff.ready === false ? 'profile' : 'calendar');
  const [archiving,setArchiving]=useState(false);
  const [calendarDate,setCalendarDate]=useState(()=>jump?.date||masterDayKey(Date.now(),salonOffset));
  const [calendarAdding,setCalendarAdding]=useState<CalendarJump['mode']>(jump?.mode??null);
  useEffect(() => { if (appearanceRequest && !owner) setTab('appearance'); }, [appearanceRequest, owner]);
  return <section className="studio-panel salon-performer"><div className="section-head compact"><div><span className="eyebrow">{owner ? 'ВЫБРАННЫЙ СОТРУДНИК' : salonName}</span><h2>{owner ? staff.name : tab === 'works' ? 'Мои работы' : tab === 'appearance' ? 'Моё оформление' : tab === 'services' ? 'Мои услуги' : tab === 'schedule' ? 'Мой график' : 'Мой календарь'}</h2></div>{owner&&!archiving ? <button type="button" className="text-link" onClick={()=>setArchiving(true)}><Archive size={16}/> В архив</button> : null}</div>
    {owner && !archiving ? <StaffVisibility staff={staff} salonPublished={salonPublished} onDone={onChange}/> : null}
    {archiving&&owner ? <StaffArchive staff={staff} workspaceId={workspaceId} offset={salonOffset} onDone={onArchived} onClose={()=>setArchiving(false)}/> : <>
    <div className="studio-tabs" role="tablist" aria-label="Разделы сотрудника">{([['calendar','Календарь'], ['services','Услуги'], ['schedule','График'], ...(owner ? [['profile','Данные и график'], ['works','Работы']] : [['works','Работы'], ['appearance','Оформление']])] as [typeof tab, string][]).map(([key,label]) => <button role="tab" aria-selected={tab === key} className={tab === key ? 'active' : ''} key={key} onClick={() => setTab(key)}>{label}</button>)}</div>
    {tab === 'calendar' ? <StaffCalendar employee={!owner} staff={staff} offset={salonOffset} date={calendarDate} setDate={setCalendarDate} adding={calendarAdding} setAdding={setCalendarAdding}/> : null}
    {tab === 'services' ? <StaffServices staff={staff} onDone={onChange}/> : null}
    {tab === 'schedule' ? <ScheduleForm schedule={staff.schedule} configured={staff.schedule_configured} lockedOffset={salonOffset} endpoint={'/performers/' + staff.id + '/schedule'} onDone={onChange}/> : null}
    {tab === 'works' ? <SalonPublications key={staff.id} workspaceId={workspaceId} team={team} initialTarget={staff.id} onChange={onChange}/> : null}
    {tab === 'appearance' && !owner ? <StaffAppearance staff={staff} salonName={salonName} salonLogo={salonLogo} salonCover={salonCover} onDone={onChange}/> : null}
    {tab === 'profile' && owner ? <StaffSetupForm workspace={{id:workspaceId,utc_offset:salonOffset}} team={team} staff={staff} onDone={()=>onChange()}/> : null}
    {tab === 'access' && owner ? <StaffAccess staff={staff} onDone={onChange}/> : null}
    </>}
  </section>;
}

function StaffVisibility({ staff, salonPublished, onDone }: { staff: Performer; salonPublished: boolean; onDone: () => void }) {
  const [visible, setVisible] = useState(Boolean(staff.bookable));
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [notice, setNotice] = useState('');
  const submitting = useRef(false);
  useEffect(() => { setVisible(Boolean(staff.bookable)); }, [staff.bookable]);
  async function toggle() {
    if (submitting.current) return;
    submitting.current = true; setBusy(true); setError(''); setNotice('');
    try {
      const result = await json<{ visible: boolean }>('/performers/' + staff.id + '/visibility', 'PATCH', { visible: !visible });
      setVisible(result.visible);
      setNotice(result.visible ? 'Показ мастера включён.' : 'Мастер скрыт от клиентов. Его записи и личный доступ сохранены.');
      await onDone();
    } catch (reason) { setError(message(reason)); }
    finally { submitting.current = false; setBusy(false); }
  }
  return <div className="staff-visibility"><div><span className={'staff-visibility-state ' + (visible ? 'is-visible' : 'is-hidden')}>{visible ? <Eye size={16}/> : <EyeOff size={16}/>} {visible ? 'Показ включён' : 'Скрыт от клиентов'}</span><p>Скрытие убирает мастера из онлайн-записи. Календарь, услуги и доступ сохраняются.</p>{visible && !salonPublished ? <p>Сам салон пока скрыт: клиенты увидят мастера после публикации салона.</p> : null}</div><button type="button" className="button button-outline" disabled={busy} onClick={toggle}>{visible ? <EyeOff size={16}/> : <Eye size={16}/>} {busy ? 'Сохраняем…' : visible ? 'Скрыть от клиентов' : 'Показать клиентам'}</button>{error ? <p className="form-error staff-visibility-message" role="alert">{error}</p> : null}{notice ? <p className="staff-visibility-message" role="status">{notice}</p> : null}</div>;
}

function StaffCalendar({ staff, offset, date, setDate, adding, setAdding, employee = false }: { staff: Performer; offset: number; date: string; setDate: (date: string) => void; adding: CalendarJump['mode']; setAdding: (mode: CalendarJump['mode']) => void; employee?: boolean }) {
  const resource = useResource(() => api<Appointment[]>('/performers/' + staff.id + '/calendar'), [staff.id]);
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false); const [notice, setNotice] = useState('');
  async function update(id: string, status: Appointment['status']) { setBusy(true); setError(''); try { await json('/appointments/' + id, 'PATCH', { status }); resource.reload(); } catch (r) { setError(message(r)); } finally { setBusy(false); } }
  const midnight = Date.parse(date+'T00:00:00Z')-offset*60000;
  const visits = resource.data?.filter(v => v.start<midnight+86400000 && v.end>midnight) || [];
  function selectDate(next: string) { if (next) setDate(next); }
  return <div className="salon-calendar"><div className="salon-calendar-tools"><label>Дата<input type="date" value={date} onChange={e => selectDate(e.target.value)}/></label><button className="button button-outline" onClick={() => selectDate(masterDayKey(Date.now(), offset))}>Сегодня</button><button className="button button-wine" aria-expanded={adding === 'visit'} onClick={() => { setNotice(''); setAdding(adding === 'visit' ? null : 'visit'); }}><Plus size={16}/> Записать клиента</button><button className="button button-outline" aria-expanded={adding === 'break'} onClick={() => { setNotice(''); setAdding(adding === 'break' ? null : 'break'); }}><CalendarDays size={16}/> Закрыть время</button></div>
    <p className="muted">Время салона · UTC+{offset / 60}</p>
    {notice ? <p className={employee ? 'employee-save-notice' : 'studio-action-notice'} role="status">{notice}</p> : null}
    <div className={'staff-calendar-workspace' + (adding ? ' has-editor' : '')}>
    {adding ? <StaffVisit key={staff.id + adding} staff={staff} date={date} offset={offset} mode={adding} onDateChange={setDate} onCancel={() => setAdding(null)} onDone={savedDate => { if (savedDate) setDate(savedDate); setNotice(adding === 'break' ? 'Время закрыто в календаре.' : 'Запись добавлена в календарь.'); setAdding(null); resource.reload(); }}/>: null}
    <div className="staff-day-agenda">
    {error ? <p className="form-error" role="alert">{error}</p> : null}
    {resource.loading ? <Loading text="Открываем календарь…"/> : resource.error ? <ErrorState message={resource.error} retry={resource.reload}/> : visits.length ? <div className="appointment-list">{visits.map(v => <article className="appointment-card salon-visit" key={v.id}><div className="salon-visit-time"><b>{masterTime(v.start, offset)}</b><small>до {masterTime(v.end, offset)}</small></div><div><span className={'status-pill ' + v.status}>{statusLabel(v.status)}</span><h3>{v.service}</h3><p>{v.client_name} · {money(v.price)}</p>{v.guest_contact ? <p>Контакт: {v.guest_contact}</p> : null}{v.notes ? <p className="muted">{v.notes}</p> : null}</div><div className="appointment-actions">{v.status === 'pending' ? <button disabled={busy} onClick={() => update(v.id,'confirmed')}><Check size={15}/> Подтвердить</button> : null}{v.status === 'confirmed' ? <button disabled={busy} onClick={() => update(v.id,'done')}>Завершить</button> : null}{['pending','confirmed'].includes(v.status) ? <button disabled={busy} className="danger" onClick={() => { if (confirm('Отменить запись?')) void update(v.id,'cancelled'); }}>Отменить</button> : null}</div></article>)}</div> : <EmptyState title="На этот день записей нет" text="Запишите клиента или закройте время для перерыва."/>}
    </div></div>
  </div>;
}

function StaffVisit({ staff, date, offset, mode, onDone, onDateChange, onCancel }: { staff: Performer; date: string; offset: number; mode: 'visit' | 'break'; onDone: (savedDate?: string) => void; onDateChange: (date: string) => void; onCancel: () => void }) {
  return <div className="salon-visit-form"><CabinetVisitForm services={staff.services} date={date} onDateChange={onDateChange} offset={offset} masterId={staff.id} mode={mode} onDone={savedDate => onDone(savedDate)} onCancel={onCancel}/></div>;
}

function StaffServices({ staff, onDone }: { staff: Performer; onDone: () => void }) {
  const [name, setName] = useState(''); const [price, setPrice] = useState(''); const [duration, setDuration] = useState('60'); const [error, setError] = useState(''); const [notice, setNotice] = useState(''); const [busy, setBusy] = useState(false);
  const endpoint = '/performers/' + staff.id + '/services';
  async function submit(e: FormEvent) { e.preventDefault(); setBusy(true); setError(''); setNotice(''); try { await json(endpoint, 'POST', { name, price: Number(price), duration: Number(duration) }); setName(''); setPrice(''); setNotice('Услуга добавлена.'); onDone(); } catch (r) { setError(message(r)); } finally { setBusy(false); } }
  async function remove(id: string) { if (!confirm('Удалить услугу? История записей сохранится.')) return; setBusy(true); setError(''); setNotice(''); try { await api(endpoint + '/' + id, { method: 'DELETE' }); setNotice('Услуга удалена. История записей сохранена.'); onDone(); } catch (r) { setError(message(r)); } finally { setBusy(false); } }
  return <div className="salon-services-manager"><div className="services-list salon-services-list">{staff.services.length ? staff.services.map(s => <div className="service-row" key={s.id}><div><h3>{s.name}</h3><span>{s.duration} мин</span></div><div><strong>{money(s.price)}</strong><button type="button" disabled={busy} aria-label={'Удалить услугу ' + s.name} onClick={() => remove(s.id)}><Trash2 size={17}/></button></div></div>) : <p className="salon-services-empty">Добавьте первую услугу, чтобы клиентам было доступно время для записи.</p>}</div><form className="inline-service-form salon-service-form" onSubmit={submit} aria-busy={busy}><label>Название услуги<input value={name} onChange={e => setName(e.target.value)} maxLength={120} required disabled={busy}/></label><label>Цена, ₽<input type="number" min="0" max="1000000" value={price} onChange={e => setPrice(e.target.value)} required disabled={busy}/></label><label>Длительность, мин<input type="number" min="5" max="720" value={duration} onChange={e => setDuration(e.target.value)} required disabled={busy}/></label><button className="button button-wine" disabled={busy}><Plus size={16}/> {busy ? 'Добавляем…' : 'Добавить услугу'}</button>{notice ? <p className="salon-service-notice" role="status">{notice}</p> : null}{error ? <p className="form-error" role="alert">{error}</p> : null}</form></div>;
}
function StaffAccess({ staff, onDone }: { staff: Performer; onDone: () => void }) {
  const [invitation, setInvitation] = useState<{ path: string; expires: number } | null>(null); const [error, setError] = useState(''); const [copied, setCopied] = useState(false); const [busy, setBusy] = useState(false);
  async function create() { setBusy(true); setError(''); setCopied(false); try { setInvitation(await json('/performers/' + staff.id + '/invitations', 'POST', {})); } catch (r) { setError(message(r)); } finally { setBusy(false); } }
  async function revoke() { if (!confirm('Отозвать личный доступ сотрудника? Вы продолжите вести его календарь, история сохранится.')) return; setBusy(true); setError(''); try { await api('/performers/' + staff.id + '/access', { method: 'DELETE' }); setInvitation(null); onDone(); } catch (r) { setError(message(r)); } finally { setBusy(false); } }
  async function cancelInvitation() { setBusy(true); setError(''); try { await api('/performers/' + staff.id + '/invitations', { method: 'DELETE' }); setInvitation(null); onDone(); } catch (r) { setError(message(r)); } finally { setBusy(false); } }
  async function copy() { try { await navigator.clipboard.writeText(location.origin + invitation!.path); setCopied(true); } catch { setError('Не удалось скопировать. Выделите ссылку и скопируйте вручную.'); } }
  return <div className="settings-form"><h3>{staff.user_id ? 'Личный доступ выдан' : 'Пригласить сотрудника'}</h3><p>{staff.user_id ? 'Сотрудник может вести свой календарь, услуги и график. Календари коллег ему недоступны.' : 'Вы можете вести записи самостоятельно или дать сотруднику доступ к его календарю. Общий пароль не нужен.'}</p>{error ? <p className="form-error" role="alert">{error}</p> : null}{staff.user_id ? <button className="button button-outline" disabled={busy} onClick={revoke}>Отозвать доступ</button> : <>
    <button className="button button-dark" disabled={busy} onClick={create}><Settings2 size={16}/> {busy ? 'Создаём…' : invitation ? 'Создать новую ссылку' : 'Создать приглашение'}</button>
    {invitation || staff.invitation_expires ? <><p>Приглашение действует до {masterDate(invitation?.expires || staff.invitation_expires!, staff.schedule.utc_offset)}.</p><button className="text-link" disabled={busy} onClick={cancelInvitation}>Отменить приглашение</button></> : null}
    {invitation ? <div className="salon-invitation"><label>Ссылка для сотрудника<input readOnly value={location.origin + invitation.path} onFocus={e => e.target.select()}/></label><p>Действует до {masterDate(invitation.expires, staff.schedule.utc_offset)}. Одноразовая; новая ссылка отменяет предыдущую.</p><button className="button button-outline" onClick={copy}><Copy size={16}/> {copied ? 'Скопировано' : 'Скопировать ссылку'}</button><span role="status">{copied ? 'Отправьте ссылку сотруднику удобным способом.' : ''}</span></div> : null}
  </>}</div>;
}

function StaffAppearance({ staff, salonName, salonLogo, salonCover, onDone }: { staff: Performer; salonName: string; salonLogo?: string; salonCover?: string; onDone: () => void }) {
  const [avatar, setAvatar] = useState(staff.profile?.avatar || '');
  return <div className="staff-appearance"><div><CabinetIdentity name={staff.name} image={avatar} logo={salonLogo} cover={salonCover} kind="staff" salonName={salonName}/></div><div className="staff-appearance-details"><h3>Ваше фото</h3><ImageUploadField kind="avatar" label="Фото мастера" image={avatar} endpoint={'/performers/' + staff.id + '/avatar'} onSaved={image => { setAvatar(image); onDone(); }}/><p>Ваш портрет и логотип салона показываются вместе. Обложка и логотип принадлежат салону — их меняет владелец в разделе «Страница салона».</p></div></div>;
}

