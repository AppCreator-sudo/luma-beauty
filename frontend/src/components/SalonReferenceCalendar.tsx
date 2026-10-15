import {RescheduleDecision} from './RescheduleDecision';
import { useHistoryState } from '../lib/useHistoryState';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { ArrowLeft, ChevronLeft, ChevronRight, Plus, X } from 'lucide-react';
import { json, masterDate, masterDayKey, masterTime, money, statusLabel, type Appointment, type Salon } from '../lib/api';
import { Initial } from './MasterCabinet';
import { CabinetVisitForm } from './CabinetVisitForm';
import { CalendarEditForm } from './CalendarWorkspace';
import '../calendar-reference.css';
export const isSalonBreak = (a: Appointment) => Boolean(a.is_break || a.service === 'Время закрыто' && a.client_name === 'Перерыв' && !a.client_id && !a.guest_contact && a.price === 0);
function minutes(time: number, offset: number) { const d = new Date(time + offset * 60000); return d.getUTCHours() * 60 + d.getUTCMinutes(); }
function shift(date: string, amount: number) { return new Date(Date.parse(date + 'T12:00:00Z') + amount * 86400000).toISOString().slice(0, 10); }
export function SalonReferenceCalendar({ salon, appointments, date, setDate, selectedStaff, setSelectedStaff, record, setRecord, create, setCreate, createStart, reload, filter, setFilter }: {
    filter: string;
    setFilter: (id:string)=>void;
    salon: Salon;
    appointments: Appointment[];
    date: string;
    setDate: (d: string) => void;
    selectedStaff: string;
    setSelectedStaff: (id: string) => void;
    record: string;
    setRecord: (id: string) => void;
    create: 'visit' | 'break' | null;
    createStart: number | null;
    setCreate: (mode: 'visit' | 'break' | null) => void;
    reload: () => Promise<void>;
}) {
    const offset = salon.workspace.utc_offset ?? 180;
    const [pending, setPending] = useState(false), [search, setSearch] = useState(''), [editing, setEditing] = useHistoryState('salon-calendar-edit', false, { flow: true }), [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
    const dialog = useRef<HTMLDialogElement>(null), panel = useRef<HTMLElement>(null);
    const selected = appointments.find(a => a.id === record), staff = salon.staff.find(p => p.id === selected?.master_id), creator = salon.staff.find(p => p.id === selectedStaff) || salon.staff[0];
    const people = salon.staff.filter(p => (!filter || p.id === filter) && p.name.toLocaleLowerCase('ru-RU').includes(search.toLocaleLowerCase('ru-RU')) && (!pending || appointments.some(a => a.master_id === p.id && a.status === 'pending' && masterDayKey(a.start, offset) === date)));
    const dayStart = Date.parse(date + 'T00:00:00Z') - offset * 60000;
    const daily = appointments.filter(a => a.start < dayStart + 86400000 && a.end > dayStart && a.status !== 'cancelled' && people.some(p => p.id === a.master_id)).sort((a, b) => a.start - b.start);
    const start = Math.max(0, Math.floor(Math.min(540, ...people.map(p => p.schedule.opening), ...daily.map(a => minutes(a.start, offset))) / 60) * 60);
    const end = Math.min(1440, Math.ceil(Math.max(1140, ...people.map(p => p.schedule.closing), ...daily.map(a => Math.min(1440, (a.end - dayStart) / 60000))) / 60) * 60);
    const ticks = Array.from({ length: Math.max(1, (end - start) / 60) }, (_, i) => start + i * 60), scale = 1.2;
    useEffect(() => { if (create && !dialog.current?.open)
        dialog.current?.showModal(); if (!create && dialog.current?.open)
        dialog.current.close(); }, [create]);
    useEffect(() => { setError(''); if (record)
        requestAnimationFrame(() => panel.current?.focus()); }, [record]);
    async function update(status: Appointment['status']) { if (!selected || busy || status === 'cancelled' && !confirm(isSalonBreak(selected) ? 'Убрать перерыв?' : 'Отменить запись?'))
        return; setBusy(true); setError(''); try {
        await json('/appointments/' + selected.id, 'PATCH', { status });
        await reload();
        setNotice('Запись обновлена.');
    }
    catch (e) {
        setError(e instanceof Error ? e.message : 'Не удалось изменить запись');
    }
    finally {
        setBusy(false);
    } }
    function select(a: Appointment) { setRecord(a.id); setEditing(false); setError(''); }
    function visit(a: Appointment, timeline = false, style?: CSSProperties) { const p = salon.staff.find(p => p.id === a.master_id), b = isSalonBreak(a); return <button key={a.id} style={style} className={'salon-calendar-visit ' + a.status + (b ? ' is-break' : '') + (timeline ? ' temporal' : '') + (record === a.id ? ' selected' : '')} onClick={() => select(a)} aria-label={(b ? 'Перерыв' : a.client_name) + ', ' + p?.name + ', ' + masterTime(a.start, offset)}><time>{masterTime(a.start, offset)}–{masterTime(a.end, offset)}</time><strong>{b ? 'Перерыв' : a.client_name}</strong><span>{b ? p?.name : a.service}</span>{a.reschedule_request_id?<small className="calendar-reschedule-mark">Запрос переноса</small>:null}{!timeline ? <small>{p?.name} · {b ? 'Перерыв' : statusLabel(a.status)}</small> : null}</button>; }
    const today = masterDayKey(Date.now(), offset), dayOfWeek = new Date(date + 'T12:00:00Z').getUTCDay(), monday = shift(date, -((dayOfWeek + 6) % 7));
    return <div className={'salon-reference-calendar' + (record ? ' has-record' : '')}>
    <div className="cabinet-day-head"><div><h1>Календарь <em>команды.</em></h1><p>Время салона · UTC+{offset / 60}</p></div><div className="cabinet-day-actions"><button className="button button-outline" disabled={!creator} onClick={() => { setNotice(''); setCreate('break'); }}>Перерыв</button><button className="button button-wine" disabled={!creator} onClick={() => { setNotice(''); setCreate('visit'); }}><Plus size={18}/>Новая запись</button></div></div>
    {notice ? <p role="status">{notice}</p> : null}
    <div className="salon-calendar-toolbar"><div><button aria-label="Предыдущий день" onClick={() => { setDate(shift(date, -1)); setRecord(''); }}><ChevronLeft size={18}/></button><label className="calendar-date-picker"><span>{masterDate(dayStart + 12 * 3600000, offset, { day: 'numeric', month: 'long', weekday: 'long' })}</span><input aria-label="Выбрать дату" type="date" value={date} onChange={e => { if (e.target.value) {
        setDate(e.target.value);
        setRecord('');
    } }}/></label><button aria-label="Следующий день" onClick={() => { setDate(shift(date, 1)); setRecord(''); }}><ChevronRight size={18}/></button><button className="button button-outline" onClick={() => { setDate(today); setRecord(''); }}>Сегодня</button></div><label>Мастер<select aria-label="Мастер в календаре" value={filter} onChange={e => { setFilter(e.target.value); if (e.target.value)
        setSelectedStaff(e.target.value); }}><option value="">Все мастера</option>{salon.staff.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label><label className="checkbox-line"><input type="checkbox" checked={pending} onChange={e => setPending(e.target.checked)}/>Только заявки</label><input aria-label="Поиск сотрудника в календаре" type="search" placeholder="Поиск по имени" value={search} onChange={e => setSearch(e.target.value)}/></div>
    <div className="salon-calendar-mobile-week cabinet-week">{Array.from({ length: 7 }, (_, i) => shift(monday, i)).map(d => <button key={d} className={d === date ? 'active' : ''} onClick={() => { setDate(d); setRecord(''); }}><span>{new Date(d + 'T12:00:00Z').toLocaleDateString('ru-RU', { weekday: 'short', timeZone: 'UTC' })}</span><small>{Number(d.slice(-2))}</small></button>)}</div>
    <div className="salon-calendar-columns"><section className="salon-calendar-grid" aria-label="Записи команды"><div className="salon-calendar-desktop"><div className="salon-calendar-scroll"><div className="salon-timeline" style={{ gridTemplateColumns: `56px repeat(${Math.max(1, people.length)}, minmax(150px,1fr))`, minWidth: 56 + people.length * 150 }}><div className="salon-time-head">Время</div>{people.map(p => <button className="salon-calendar-staff-heading" key={p.id} onClick={() => { setSelectedStaff(p.id); setFilter(p.id); }}><Initial name={p.name} image={p.profile?.avatar}/><span>{p.name}</span></button>)}<div className="salon-timeline-hours" style={{ height: (end - start) * scale }}>{ticks.map(t => <span key={t} style={{ top: (t - start) * scale }}>{String(t / 60).padStart(2, '0')}:00</span>)}</div>{people.map(p => <div key={p.id} className="salon-timeline-column" style={{ height: (end - start) * scale }}>{ticks.map(t => <span key={t} className="salon-hour-line" style={{ top: (t - start) * scale }}/>)}{daily.filter(a => a.master_id === p.id).map(a => { const from = Math.max(start, (a.start - dayStart) / 60000), to = Math.min(end, (a.end - dayStart) / 60000); return visit(a, true, { top: (from - start) * scale, height: Math.max(44, (to - from) * scale - 3) }); })}</div>)}</div></div>{!people.length ? <p className="salon-reference-help">Нет мастеров по выбранному фильтру.</p> : null}</div><div className="salon-calendar-mobile-agenda">{daily.map(a => visit(a))}{!daily.length ? <p>На этот день записей нет. Выберите другого мастера или создайте запись.</p> : null}</div></section>
    <aside ref={panel} tabIndex={-1} className="calendar-record-panel salon-calendar-detail"><button className="salon-calendar-back" onClick={() => editing ? setEditing(false) : setRecord('')}><ArrowLeft size={16}/>{editing ? 'К записи' : 'К календарю'}</button>{selected && staff ? editing ? <CalendarEditForm key={selected.id} appointment={selected} studio={{ services: staff.services, schedule: { ...staff.schedule, utc_offset: offset } }} onCancel={() => setEditing(false)} onDone={async () => { setEditing(false); await reload(); setNotice('Изменения сохранены.'); }}/> : <><div className="calendar-record-title"><h2>{isSalonBreak(selected) ? 'Перерыв' : 'Запись на услугу'}</h2><button aria-label="Закрыть запись" onClick={() => setRecord('')}><X size={18}/></button></div><div className="calendar-record-person"><Initial name={selected.client_name}/><div><h3>{selected.client_name}</h3><p>{selected.service}</p></div></div><dl><dt>Мастер</dt><dd>{staff.name}</dd><dt>Время</dt><dd>{masterDate(selected.start, offset, { day: 'numeric', month: 'long' })} · {masterTime(selected.start, offset)}–{masterTime(selected.end, offset)}</dd><dt>Стоимость</dt><dd>{money(selected.price)}</dd><dt>Контакт</dt><dd>{selected.guest_contact || selected.contact || 'Не указан'}</dd><dt>Заметки</dt><dd>{selected.notes || 'Нет заметок'}</dd></dl><span className={'status-pill ' + selected.status}>{statusLabel(selected.status)}</span><RescheduleDecision visit={{...selected,utc_offset:offset}} reload={reload} onAccepted={(start,utcOffset)=>setDate(masterDayKey(start,utcOffset))}/>{error ? <p className="form-error" role="alert">{error}</p> : null}<div className="calendar-record-actions">{['pending', 'confirmed'].includes(selected.status) && !isSalonBreak(selected) ? <button className="button button-wine" disabled={busy} onClick={() => setEditing(true)}>Изменить запись</button> : null}{selected.status === 'pending' ? <button className="button button-wine" disabled={busy} onClick={() => void update('confirmed')}>Подтвердить</button> : null}{selected.status === 'confirmed' && !isSalonBreak(selected) ? <button className="button button-outline" disabled={busy} onClick={() => void update('done')}>Завершить</button> : null}{['pending', 'confirmed'].includes(selected.status) ? <button className="button button-outline" disabled={busy} onClick={() => void update('cancelled')}>{isSalonBreak(selected) ? 'Убрать перерыв' : 'Отменить запись'}</button> : null}</div></> : <div className="calendar-no-selection"><h2>Выберите запись</h2><p>Здесь появятся клиент, мастер и действия.</p></div>}</aside></div>
    <dialog ref={dialog} className="calendar-create-dialog salon-create-dialog" onCancel={e => { e.preventDefault(); setCreate(null); }}><h2>{create === 'break' ? 'Закрыть время' : 'Новая запись'}</h2>{create && creator ? <><label>Мастер<select aria-label="Мастер" value={creator.id} onChange={e => setSelectedStaff(e.target.value)}>{salon.staff.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label><CabinetVisitForm key={creator.id + create} initialTime={createStart ? masterTime(createStart, offset) : '10:00'} services={creator.services} masterId={creator.id} date={date} onDateChange={setDate} offset={offset} mode={create} onCancel={() => setCreate(null)} onDone={async (day) => { setDate(day); setCreate(null); setNotice(create === 'break' ? 'Перерыв добавлен.' : 'Запись добавлена.'); await reload(); }}/></> : null}</dialog>
  </div>;
}
