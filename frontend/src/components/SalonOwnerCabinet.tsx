import {ServiceDirectionEditor,ServiceDirectionSelect} from './ServiceDirection';
import { MenuOverlay } from './MenuOverlay';
import { useHistoryState } from '../lib/useHistoryState';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Archive, ArrowUpRight, CalendarDays, Check, ChevronDown, ChevronRight, Clock, FileText, Home, Image, LogOut, Menu, Plus, Search, Settings, Share2, Users, X } from 'lucide-react';
import { api, json, masterDate, masterDayKey, masterTime, servicePriceLabel, statusLabel, type Appointment, type Performer, type Salon, type Service } from '../lib/api';
import { useResource } from '../lib/useResource';
import { ErrorState, Loading, useApp } from './Shell';
import { Brand, Branch, Initial } from './MasterCabinet';
import { StaffSetupForm } from './StaffSetupForm';
import { SalonPublications } from './SalonPublications';
import { SalonSettings } from '../pages/SalonSettings';
import { SalonArchives, StaffArchive } from '../pages/SalonTeam';
import { ScheduleForm } from '../pages/Studio';
import { PushButton } from './AccountTools';
import { SalonReferenceCalendar } from './SalonReferenceCalendar';
import '../salon-reference.css';
type Screen = 'overview' | 'calendar' | 'team' | 'services' | 'works' | 'page' | 'archive' | 'settings';
const sections = [['overview', 'Обзор', Home], ['calendar', 'Календарь', CalendarDays], ['team', 'Команда', Users], ['services', 'Услуги и графики', Clock], ['works', 'Публикации', Image], ['page', 'Страница салона', FileText], ['archive', 'Архив', Archive], ['settings', 'Настройки', Settings]] as const;
const failMessage = (e: unknown) => e instanceof Error ? e.message : 'Не удалось сохранить изменения';
export function SalonOwnerCabinet({ salon, reload, onWorkspaceChange }: {
    salon: Salon;
    reload: () => Promise<unknown>;
    onWorkspaceChange?: (id: string) => void;
}) {
    const { me, refreshMe } = useApp();
    const navigate = useNavigate(), [params]=useSearchParams();const deepVisit=params.get('visit'),loadedDeep=useRef('');
    const w = salon.workspace, offset = w.utc_offset ?? 180;
    const [screen, setScreen] = useHistoryState<Screen>('salon-screen-' + w.id, () => deepVisit?'calendar':'overview'), [menu, setMenu] = useHistoryState('salon-menu', false, { flow: true, transient: true }), [account, setAccount] = useHistoryState('salon-account', false, { flow: true, transient: true });
    const [selected, setSelected] = useHistoryState('salon-staff-' + w.id, '', { flow: true }), [adding, setAdding] = useHistoryState('salon-add-staff-' + w.id, false, { flow: true }), [editing, setEditing] = useHistoryState('salon-edit-staff-' + w.id, false, { flow: true }), [archiving, setArchiving] = useHistoryState('salon-archive-staff-' + w.id, false, { flow: true });
    const [staffTab, setStaffTab] = useHistoryState<'profile' | 'services' | 'schedule' | 'works'>('salon-staff-tab-' + w.id, 'profile');
    const [dayStaff, setDayStaff] = useState('');
    const [staffActions, setStaffActions] = useHistoryState('salon-staff-actions-' + w.id, false, { flow: true, transient: true });
    const [filter, setFilter] = useState('all'), [search, setSearch] = useState('');
    const [date, setDate] = useState(() => masterDayKey(Date.now(), offset));
    const [createStart, setCreateStart] = useState<number | null>(null);
    const [record, setRecord] = useHistoryState('salon-visit-' + w.id, () => deepVisit||'', { flow: true }), [create, setCreate] = useHistoryState<'visit' | 'break' | null>('salon-create-' + w.id, null, { flow: true }), [notice, setNotice] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false);
    const menuButton = useRef<HTMLButtonElement>(null), teamPanel = useRef<HTMLElement>(null);
    const visits = useResource(() => api<Appointment[]>('/appointments'), [w.id]);
    const own = (visits.data || []).filter(a => salon.staff.some(p => p.id === a.master_id)).sort((a, b) => a.start - b.start);
    useEffect(()=>{if(deepVisit&&loadedDeep.current!==deepVisit&&visits.data){const visit=own.find(a=>a.id===deepVisit);if(visit){setDate(masterDayKey(visit.start,offset));setSelected(visit.master_id)}loadedDeep.current=deepVisit}},[deepVisit,visits.data,offset,setSelected]);
    const staff = salon.staff.find(p => p.id === selected) || salon.staff[0];
    const visible = salon.staff.filter(p => p.name.toLocaleLowerCase('ru-RU').includes(search.toLocaleLowerCase('ru-RU')) && (filter === 'all' || filter === 'draft' && p.ready === false || filter === 'visible' && Boolean(p.bookable) && p.ready !== false || filter === 'hidden' && !p.bookable && p.ready !== false));
    useEffect(() => { if (!account) return; const close = (e: KeyboardEvent) => { if (e.key === 'Escape') setAccount(false); }; window.addEventListener('keydown', close); return () => window.removeEventListener('keydown', close); }, [account, setAccount]);
    async function refresh() { await Promise.all([reload(), visits.reload()]); }
    function open(next: Screen) { setScreen(next); setMenu(false); setAccount(false); setNotice(''); setError(''); setAdding(false); setEditing(false); setArchiving(false); if (menu)
        menuButton.current?.focus(); }
    function calendar(id?: string, appointment?: Appointment, mode?: 'visit' | 'break', start?: number) { open('calendar'); setCreateStart(start ?? null); if (start)
        setDate(masterDayKey(start, offset)); if (id)
        setSelected(id); setRecord(appointment?.id || ''); if (appointment)
        setDate(masterDayKey(appointment.start, offset)); setCreate(mode || null); }
    async function share() { if (!w.slug) {
        setError('Сначала сохраните адрес страницы салона.');
        return;
    } const url = location.origin + '/v2/s/' + w.slug; try {
        if (navigator.share)
            await navigator.share({ title: w.name, url });
        else {
            await navigator.clipboard.writeText(url);
            setNotice('Ссылка на салон скопирована.');
        }
    }
    catch (e) {
        if (!(e instanceof Error && e.name === 'AbortError'))
            setError('Не удалось поделиться ссылкой. Откройте страницу салона и скопируйте её адрес.');
    } }
    async function update(a: Appointment, status: Appointment['status']) { if (busy || status === 'cancelled' && !confirm('Отменить запись?'))
        return; setBusy(true); setError(''); try {
        await json('/appointments/' + a.id, 'PATCH', { status });
        await refresh();
    }
    catch (e) {
        setError(failMessage(e));
    }
    finally {
        setBusy(false);
    } }
    async function visibility() { if (!staff || busy)
        return; setBusy(true); setError(''); try {
        await json('/performers/' + staff.id + '/visibility', 'PATCH', { visible: !staff.bookable });
        await refresh();
        setNotice(staff.bookable ? 'Мастер скрыт от клиентов. Записи сохранены.' : 'Показ мастера включён.');
    }
    catch (e) {
        setError(failMessage(e));
    }
    finally {
        setBusy(false);
    } }
    function selectStaff(p: Performer) { setSelected(p.id); setEditing(false); setArchiving(false); setStaffTab('profile'); requestAnimationFrame(() => { if (matchMedia('(max-width:800px)').matches) {
        teamPanel.current?.scrollIntoView({ block: 'start', behavior: matchMedia('(prefers-reduced-motion:reduce)').matches ? 'instant' : 'smooth' });
        teamPanel.current?.focus();
    } }); }
    const pending = own.filter(a => a.status === 'pending' && (!dayStaff || a.master_id === dayStaff)), daily = own.filter(a => masterDayKey(a.start, offset) === date && a.status !== 'cancelled' && (!dayStaff || a.master_id === dayStaff));
    const weekday = new Date(date + 'T12:00:00Z').getUTCDay(), monday = Date.parse(date + 'T12:00:00Z') - ((weekday + 6) % 7) * 86400000;
    const week = Array.from({ length: 7 }, (_, i) => new Date(monday + i * 86400000).toISOString().slice(0, 10));
    return <div className="master-cabinet salon-reference">
    <header className="cabinet-top"><div className="cabinet-mobile-brand"><Brand /></div><nav aria-label="Разделы площадки"><Link to="/masters">Мастера</Link><Link to="/inspiration">Вдохновение</Link><Link to="/map">Карта</Link></nav><div className="cabinet-top-actions"><Link to="/masters?focus=search" aria-label="Поиск мастеров и салонов"><Search size={21}/></Link><div className="cabinet-account"><button type="button" aria-expanded={account} aria-label="Меню профиля" onClick={() => setAccount(!account)}><Initial name={w.name} image={w.logo}/><span>{w.name}</span><ChevronDown size={16}/></button>{account ? <div className="cabinet-account-menu"><button onClick={() => { setAccount(false); void share(); }}><Share2 size={16}/>Поделиться страницей</button><Link to="/access" replace>Вход и безопасность</Link><button onClick={() => open('settings')}>Настройки аккаунта</button>{me?.user?.account_type === 'master' ? <Link to="/studio" replace>Личная практика</Link> : null}</div> : null}</div><button ref={menuButton} className="cabinet-menu-toggle" aria-controls="salon-navigation-menu" aria-expanded={menu} aria-label={menu ? 'Закрыть меню кабинета' : 'Открыть меню кабинета'} onClick={() => setMenu(!menu)}>{menu ? <X /> : <Menu />}</button></div></header>
    <aside id="salon-reference-sidebar" className="cabinet-sidebar"><Brand /><div className="cabinet-owner"><Initial name={w.name} image={w.logo}/><h2>{w.name}</h2><p>Менеджер</p></div><nav aria-label="Разделы кабинета салона">{sections.map(([key, label, Icon]) => <button key={key} className={screen === key ? 'active' : ''} aria-current={screen === key ? 'page' : undefined} onClick={() => open(key)}><Icon size={21}/>{label}</button>)}</nav><div className="cabinet-sidebar-decoration"><Branch /></div><nav className="cabinet-mobile-links" aria-label="Разделы площадки"><Link to="/masters">Мастера</Link><Link to="/inspiration">Вдохновение</Link><Link to="/map">Карта</Link></nav></aside>
    <MenuOverlay open={menu} close={() => setMenu(false)} trigger={menuButton} id="salon-navigation-menu" label="Меню кабинета салона" drawer><aside className="cabinet-sidebar"><Brand /><div className="cabinet-owner"><Initial name={w.name} image={w.logo}/><h2>{w.name}</h2><p>Менеджер</p></div><nav aria-label="Разделы кабинета салона">{sections.map(([key, label, Icon]) => <button key={key} className={screen === key ? 'active' : ''} aria-current={screen === key ? 'page' : undefined} onClick={() => open(key)}><Icon size={21}/>{label}</button>)}</nav><div className="cabinet-sidebar-decoration"><Branch /></div><nav className="cabinet-mobile-links" aria-label="Разделы площадки"><Link to="/masters">Мастера</Link><Link to="/inspiration">Вдохновение</Link><Link to="/map">Карта</Link></nav></aside></MenuOverlay>
    <main className="cabinet-body" inert={menu}>
      {me?.workspaces && me.workspaces.filter(x => x.kind === 'salon' && x.role === 'owner').length > 1 ? <label className="salon-select-staff">Салон<select value={w.id} onChange={e => onWorkspaceChange?.(e.target.value)}>{me.workspaces.filter(x => x.kind === 'salon' && x.role === 'owner').map(x => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label> : null}
      {notice ? <p className="salon-reference-notice" role="status">{notice}</p> : null}{error ? <p className="form-error" role="alert">{error}</p> : null}
      {visits.error ? <ErrorState message={visits.error} retry={visits.reload}/> : null}
      {screen === 'overview' ? <>
        <div className="cabinet-day-head"><div><h1>День вашего <em>салона.</em></h1><p>{masterDate(Date.parse(date + 'T12:00:00Z') - offset * 60000, offset, { day: 'numeric', month: 'long', weekday: 'long' })}</p></div><div className="cabinet-day-actions">{w.slug ? <Link className="button button-outline" to={'/s/' + w.slug}>Страница салона <ArrowUpRight size={17}/></Link> : <button className="button button-outline" onClick={() => open('page')}>Страница салона</button>}<button className="button button-wine" onClick={() => calendar(staff?.id, undefined, 'visit')} disabled={!staff}><Plus size={20}/>Новая запись</button></div></div>
        <div className="cabinet-preparation"><h2>Подготовка салона</h2><div>{([{ label: 'Адрес', done: Boolean(w.address && w.latitude != null), screen: 'page' }, { label: 'Мастер', done: salon.staff.some(p => p.ready), screen: 'team' }, { label: 'Услуги и график', done: salon.staff.some(p => p.services.length && p.schedule_configured), screen: 'services' }, { label: w.published ? 'Салон открыт' : 'Открыть салон', done: Boolean(w.published), screen: 'page' }] as const).map(step => <button key={step.label} onClick={() => open(step.screen)}><span className={step.done ? 'complete' : ''}>{step.done ? <Check size={16}/> : <ArrowUpRight size={16}/>}</span>{step.label}</button>)}</div></div>
        <div className="salon-overview-columns"><section className="salon-overview-agenda"><div className="cabinet-week">{week.map(day => <button key={day} className={date === day ? 'active' : ''} aria-pressed={date === day} onClick={() => setDate(day)}><span>{new Date(day + 'T12:00:00Z').toLocaleDateString('ru-RU', { weekday: 'short', timeZone: 'UTC' })}</span><small>{new Date(day + 'T12:00:00Z').toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', timeZone: 'UTC' })}</small></button>)}</div><label className="salon-overview-filter">Мастер<select aria-label="Мастер в обзоре" value={dayStaff} onChange={e => setDayStaff(e.target.value)}><option value="">Все мастера</option>{salon.staff.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label><OverviewRecords appointments={pending} title={'Заявки на подтверждение · ' + pending.length} pending busy={busy} salon={salon} update={update} details={a => calendar(a.master_id, a)}/>{visits.loading && !visits.data ? <Loading /> : <OverviewRecords appointments={daily.filter(a => a.status !== 'pending')} title={date === masterDayKey(Date.now(), offset) ? 'Записи на сегодня' : 'Записи на выбранный день'} salon={salon} update={update} details={a => calendar(a.master_id, a)}/>}</section><aside className="salon-overview-side"><section><h2>Команда</h2><p>{salon.staff.length} мастеров · {salon.staff.filter(p => p.bookable).length} видны клиентам</p><div className="salon-reference-portraits">{salon.staff.slice(0, 3).map(p => <Initial key={p.id} name={p.name} image={p.profile?.avatar}/>)}{salon.staff.length > 3 ? <span className="cabinet-avatar">+{salon.staff.length - 3}</span> : null}</div><button className="button button-outline" onClick={() => open('team')}>Открыть команду <ChevronRight size={17}/></button></section><SalonNextWindows salon={salon} onOpen={(id, start) => calendar(id, undefined, 'visit', start)} refreshKey={visits.data}/><section><h2>Страница салона</h2><div className="salon-reference-cover" style={w.cover ? { backgroundImage: `url(${JSON.stringify(w.cover)})` } : undefined}><Initial name={w.name} image={w.logo}/></div><button className="button button-outline" onClick={() => open('page')}>Изменить оформление</button></section></aside></div>
      </> : null}
      {screen === 'calendar' ? <SalonReferenceCalendar salon={salon} appointments={own} date={date} setDate={setDate} selectedStaff={selected} setSelectedStaff={setSelected} record={record} setRecord={setRecord} create={create} setCreate={setCreate} createStart={createStart} reload={refresh}/> : null}
      {screen === 'team' ? <><div className="cabinet-day-head"><h1>Ваши <em>мастера.</em></h1><button className="button button-wine" onClick={() => { setAdding(!adding); setArchiving(false); setEditing(false); }}><Plus size={18}/>{adding ? 'К команде' : 'Добавить мастера'}</button></div>{adding ? <section className="salon-reference-panel"><StaffSetupForm workspace={w} team={salon.staff} onDone={id => { setSelected(id); setAdding(false); void refresh(); }}/></section> : <><div className="salon-team-tools"><label><Search size={17}/><input aria-label="Поиск мастера" type="search" placeholder="Поиск по имени" value={search} onChange={e => setSearch(e.target.value)}/></label><div className="salon-reference-tabs">{[['all', 'Все'], ['visible', 'Видны'], ['hidden', 'Скрыты'], ['draft', 'Черновики']].map(([key, label]) => <button key={key} className={filter === key ? 'active' : ''} aria-pressed={filter === key} onClick={() => setFilter(key)}>{label}</button>)}</div></div><div className="salon-reference-team-grid"><section className="salon-reference-team-list">{visible.map(p => <button key={p.id} className={staff?.id === p.id ? 'active' : ''} onClick={() => selectStaff(p)}><Initial name={p.name} image={p.profile?.avatar}/><span><b>{p.name}</b><small>{p.profile?.categories?.join(' · ') || 'Категории не выбраны'}</small></span><small className={'salon-staff-state ' + (p.ready === false ? 'draft' : p.bookable ? 'visible' : 'hidden')}>{p.ready === false ? 'Черновик' : p.bookable ? 'Виден' : 'Скрыт'}</small><ChevronRight size={17}/></button>)}{!visible.length ? <p>Мастера не найдены. Измените фильтр или добавьте сотрудника.</p> : null}</section>{staff ? <section ref={teamPanel} tabIndex={-1} className="salon-reference-panel salon-staff-detail">{archiving ? <StaffArchive staff={staff} workspaceId={w.id} offset={offset} onClose={() => setArchiving(false)} onDone={() => { setSelected(''); setArchiving(false); open('archive'); void refresh(); void refreshMe(); }}/> : null}{!archiving ? <><div className="salon-staff-heading"><Initial name={staff.name} image={staff.profile?.avatar}/><div><h2>{staff.name}</h2><p>{staff.profile?.categories?.join(' · ') || 'Заполните категории работы'}</p></div><details open={staffActions} onToggle={e => setStaffActions(e.currentTarget.open)}><summary aria-label="Действия мастера">···</summary><div><button onClick={() => { setStaffActions(false); setEditing(!editing); }}>Изменить</button><button onClick={() => { setStaffActions(false); setArchiving(true); }}>Архивировать</button></div></details></div><button className={'salon-visibility ' + (staff.bookable ? 'visible' : '')} disabled={busy} onClick={() => void visibility()}>{staff.bookable ? '● Показ включён' : '○ Скрыт от клиентов'}</button>{staff.ready === false ? <p className="salon-reference-help">Добавьте: {staff.missing?.join(', ')}.</p> : null}{editing ? <StaffSetupForm key={staff.id} workspace={w} team={salon.staff} staff={staff} onDone={() => { setEditing(false); void refresh(); }}/> : <><div className="salon-reference-tabs">{(['profile', 'services', 'schedule', 'works'] as const).map((t, i) => <button key={t} className={staffTab === t ? 'active' : ''} onClick={() => setStaffTab(t)}>{['Карточка', 'Услуги', 'График', 'Работы'][i]}</button>)}</div>{staffTab === 'profile' ? <><dl><dt>Имя</dt><dd>{staff.name}</dd><dt>Категории</dt><dd>{staff.profile?.categories?.join(' · ') || 'Не заполнены'}</dd><dt>Онлайн-запись</dt><dd>{staff.bookable ? 'Включена' : 'Выключена'}</dd></dl><div className="salon-staff-buttons"><button className="button button-wine" onClick={() => setEditing(true)}>Изменить карточку</button><button className="button button-outline" onClick={() => calendar(staff.id)}>Календарь мастера</button></div></> : staffTab === 'services' ? <SalonStaffServices key={staff.id} staff={staff} onDone={refresh}/> : staffTab === 'schedule' ? <ScheduleForm key={staff.id} schedule={staff.schedule} configured={staff.schedule_configured} lockedOffset={offset} endpoint={'/performers/' + staff.id + '/schedule'} onDone={refresh}/> : <SalonPublications reference key={staff.id} workspaceId={w.id} team={salon.staff} initialTarget={staff.id} onChange={refresh}/>}</>}</> : null}</section> : null}</div></>}</> : null}
      {screen === 'services' ? <><div className="cabinet-day-head"><h1>Услуги и <em>графики.</em></h1></div>{staff ? <section className="salon-reference-panel"><label className="salon-select-staff">Мастер<select value={staff.id} onChange={e => setSelected(e.target.value)}>{salon.staff.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label><div className="salon-reference-tabs"><button className={staffTab !== 'schedule' ? 'active' : ''} onClick={() => setStaffTab('services')}>Услуги</button><button className={staffTab === 'schedule' ? 'active' : ''} onClick={() => setStaffTab('schedule')}>График</button></div>{staffTab === 'schedule' ? <ScheduleForm key={staff.id} schedule={staff.schedule} configured={staff.schedule_configured} lockedOffset={offset} endpoint={'/performers/' + staff.id + '/schedule'} onDone={refresh}/> : <><SalonStaffServices key={staff.id} staff={staff} onDone={refresh}/><button className="button button-outline" onClick={() => { open('team'); setEditing(true); }}>Назначить услуги и скопировать график</button></>}</section> : <p>Сначала добавьте мастера в команду.</p>}</> : null}
      {screen === 'works' ? <><div className="cabinet-day-head"><h1>Ваши <em>публикации.</em></h1></div><section className="salon-reference-panel salon-reference-publications"><SalonPublications reference workspaceId={w.id} team={salon.staff} onChange={refresh}/></section></> : null}
      {screen === 'page' ? <SalonSettings workspace={w} onDone={message => { setNotice(message || 'Страница сохранена.'); void reload(); void refreshMe(); }}/> : null}
      {screen === 'archive' ? <SalonArchives salon={salon} onDone={() => { void refresh(); void refreshMe(); }}/> : null}
      {screen === 'settings' ? <><div className="cabinet-day-head"><h1>Настройки <em>салона.</em></h1></div><section className="salon-reference-panel salon-account-settings"><h2>Аккаунт менеджера</h2><Link className="button button-outline" to="/access">Вход и безопасность</Link><p>Уведомления о заявках</p><PushButton /><p>Часовой пояс салона: UTC+{offset / 60}. Его можно изменить в данных страницы.</p><button className="button button-outline" onClick={() => open('page')}>Данные салона</button><button className="button button-outline" onClick={async () => { await json('/auth/logout', 'POST', {}); await refreshMe(); navigate('/'); }}><LogOut size={17}/>Выйти</button></section></> : null}
    </main>
  </div>;
}
function OverviewRecords({ appointments, title, pending = false, busy = false, salon, update, details }: {
    appointments: Appointment[];
    title: string;
    pending?: boolean;
    busy?: boolean;
    salon: Salon;
    update: (a: Appointment, status: Appointment['status']) => Promise<void>;
    details: (a: Appointment) => void;
}) { const offset = salon.workspace.utc_offset ?? 180; return <section className={'salon-overview-records' + (pending ? ' salon-overview-pending' : '')}><h2>{title}</h2>{appointments.map(a => { const p = salon.staff.find(p => p.id === a.master_id); return <article key={a.id}><button className="salon-overview-record" aria-label={a.client_name + ', ' + masterTime(a.start, offset)} onClick={() => details(a)}><time>{masterTime(a.start, offset)}</time><Initial name={a.client_name}/><span><b>{a.client_name}</b><small>{pending ? masterDate(a.start, offset, { day: 'numeric', month: 'long' }) + ' · ' : ''}{a.reschedule_request_id?'Запрос переноса · ':''}{a.service} · {Math.round((a.end - a.start) / 60000)} мин</small></span><span className="salon-record-staff"><Initial name={p?.name || 'Мастер'} image={p?.profile?.avatar}/><small>{p?.name}</small></span>{!pending ? <span className={'status-pill ' + a.status}>{statusLabel(a.status)}</span> : null}<ChevronRight size={16}/></button>{pending ? <div className="cabinet-pending-actions"><button className="button button-wine" disabled={busy} onClick={() => void update(a, 'confirmed')}>Подтвердить</button><button className="button button-outline" disabled={busy} onClick={() => void update(a, 'cancelled')}>Отменить</button></div> : null}</article>; })}{!appointments.length ? <p className="cabinet-empty">{pending ? 'Заявок на подтверждение нет.' : 'На выбранный день записей нет.'}</p> : null}</section>; }
function SalonNextWindows({ salon, onOpen, refreshKey }: {
    salon: Salon;
    onOpen: (id: string, start: number) => void;
    refreshKey: unknown;
}) { const w = salon.workspace; const resource = useResource(async () => { if (!w.published || !w.slug)
    return []; const publicSalon = await api<{
    services: {
        id: string;
        name: string;
        master_ids: string[];
    }[];
}>('/public/salons/' + w.slug); const rows = await Promise.all(salon.staff.filter(p => p.bookable).map(async (p) => { const s = publicSalon.services.find(s => s.master_ids.includes(p.id)); if (!s)
    return null; const available = await api<{
    slots: {
        start: number;
    }[];
}>('/public/salons/' + w.slug + '/availability?service=' + encodeURIComponent(s.id) + '&master=' + encodeURIComponent(p.id)); const slot = available.slots.find(s => s.start > Date.now()); return slot ? { id: p.id, name: p.name, image: p.profile?.avatar, start: slot.start, service: s.name } : null; })); return rows.filter((r): r is NonNullable<typeof r> => r !== null).sort((a, b) => a.start - b.start).slice(0, 2); }, [w.id, w.slug, w.published, salon.staff, refreshKey]); return <section><h2>Ближайшие окна</h2>{resource.loading && !resource.data ? <p>Проверяем время…</p> : resource.error ? <ErrorState message={resource.error} retry={resource.reload}/> : resource.data?.length ? resource.data.map(r => <div className="salon-next-window" key={r.id}><div><time>{masterTime(r.start, w.utc_offset ?? 180)}</time><small>{masterDate(r.start, w.utc_offset ?? 180, { day: 'numeric', month: 'short' })}</small></div><Initial name={r.name} image={r.image}/><span>{r.name}<small>{r.service}</small></span><button aria-label={'Записать клиента к ' + r.name} onClick={() => onOpen(r.id, r.start)}><Plus size={20}/></button></div>) : <p>{w.published ? 'Свободных окон для онлайн-записи пока нет.' : 'Свободные окна для клиентов появятся после публикации салона.'}</p>}</section>; }
function SalonStaffServices({ staff, onDone }: {
    staff: Performer;
    onDone: () => Promise<unknown>;
}) { const [category,setCategory]=useState('');const categories=staff.profile?.categories||[],selectedCategory=categories.includes(category)?category:categories.length===1?categories[0]:''; const [name, setName] = useState(''), [price, setPrice] = useState(''), [duration, setDuration] = useState('60'), [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState(''); const saving = useRef(false); async function submit(e: FormEvent) { e.preventDefault(); if (saving.current)
    return; saving.current = true; setBusy(true); setError(''); try {
    await json('/performers/' + staff.id + '/services', 'POST', { name, price: Number(price), duration: Number(duration),category:selectedCategory });
    setName('');
    setPrice('');
    await onDone();
    setNotice('Услуга добавлена.');
}
catch (e) {
    setError(failMessage(e));
}
finally {
    saving.current = false;
    setBusy(false);
} } async function remove(s: Service) { if (busy || !confirm('Удалить услугу? История записей сохранится.'))
    return; setBusy(true); setError(''); try {
    await api('/performers/' + staff.id + '/services/' + s.id, { method: 'DELETE' });
    await onDone();
    setNotice('Услуга удалена. История сохранена.');
}
catch (e) {
    setError(failMessage(e));
}
finally {
    setBusy(false);
} } return <div className="salon-reference-services"><div>{staff.services.map(s => <article className="cabinet-service-item" key={s.id}><div className="cabinet-service-details"><div className="cabinet-service-heading"><b>{s.name}</b><strong>{servicePriceLabel(s.price)}</strong></div><small>{s.duration} мин</small><ServiceDirectionEditor key={s.id+':'+s.category+':'+categories.join()} service={s} categories={categories} endpoint={'/performers/'+staff.id+'/services'} onDone={onDone}/></div><button className="cabinet-service-remove" type="button" aria-label={'Удалить услугу ' + s.name} disabled={busy} onClick={() => void remove(s)}>Удалить</button></article>)}{!staff.services.length ? <p>Назначьте первую услугу, чтобы открыть онлайн-запись.</p> : null}</div><details className="service-create"><summary>Добавить услугу</summary><form className="settings-form" onSubmit={submit}><fieldset disabled={busy}><label>Название услуги<input required maxLength={120} value={name} onChange={e => setName(e.target.value)}/></label><div className="form-row"><label>Цена от, ₽<input type="number" required min={0} max={1000000} value={price} onChange={e => setPrice(e.target.value)}/></label><label>Длительность, мин<input type="number" required min={5} max={720} value={duration} onChange={e => setDuration(e.target.value)}/></label></div><ServiceDirectionSelect categories={categories} value={selectedCategory} onChange={setCategory} disabled={busy}/></fieldset><button className="button button-wine" disabled={busy}>{busy ? 'Сохраняем…' : 'Добавить услугу'}</button></form></details>{error ? <p className="form-error" role="alert">{error}</p> : null}{notice ? <p role="status">{notice}</p> : null}</div>; }
