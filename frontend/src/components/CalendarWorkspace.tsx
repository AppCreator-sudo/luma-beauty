import {RescheduleDecision} from './RescheduleDecision';
import { useHistoryState } from '../lib/useHistoryState';
import { useEffect, useRef, useState, type FormEvent, type CSSProperties } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, CalendarDays, Check, ChevronLeft, ChevronRight, Clock, Pencil, Plus, X } from 'lucide-react';
import { json, masterDate, masterDayKey, masterTime, money, statusLabel, type Appointment, type Profile, type Studio } from '../lib/api';
import { MasterCabinet } from './MasterCabinet';
import { CabinetVisitForm } from './CabinetVisitForm';
import '../calendar-reference.css';

type Mode = 'day' | 'week' | 'month';
type CalendarStudio = Studio & { profile: Profile };
function shift(date: string, amount: number) { const next = new Date(date + 'T12:00:00Z'); next.setUTCDate(next.getUTCDate() + amount); return next.toISOString().slice(0, 10); }
function week(date: string) { const weekday = new Date(date + 'T12:00:00Z').getUTCDay(); const monday = shift(date, -((weekday + 6) % 7)); return Array.from({ length: 7 }, (_, i) => shift(monday, i)); }
function dateLabel(date: string, options: Intl.DateTimeFormatOptions) { return new Date(date + 'T12:00:00Z').toLocaleDateString('ru-RU', { ...options, timeZone: 'UTC' }); }
function localMinutes(time: number, offset: number) { const local = new Date(time + offset * 60000); return local.getUTCHours() * 60 + local.getUTCMinutes(); }
function hhmm(minutes: number) { return String(Math.floor(minutes / 60)).padStart(2, '0') + ':' + String(minutes % 60).padStart(2, '0'); }
function clientInitial(name: string) { return <span className="calendar-client-initial" aria-hidden="true">{name.trim().slice(0, 1).toUpperCase()}</span>; }

// Share one geometry for the clock axis and appointment blocks, including overlaps.
function layoutVisits(items: Appointment[]) {
  const groups: Appointment[][] = [];
  let end = -Infinity;
  for (const visit of [...items].sort((a, b) => a.start - b.start || a.end - b.end)) {
    const visibleEnd = Math.max(visit.end, visit.start + 44 / 1.15 * 60000);
    if (visit.start >= end) { groups.push([]); end = visibleEnd; } else end = Math.max(end, visibleEnd);
    groups[groups.length - 1].push(visit);
  }
  return groups.flatMap(group => {
    const lanes: number[] = [];
    const slots = group.map(visit => { let lane = lanes.findIndex(end => end <= visit.start); if (lane < 0) lane = lanes.length; lanes[lane] = Math.max(visit.end, visit.start + 44 / 1.15 * 60000); return { visit, lane }; });
    return slots.map(item => ({ ...item, lanes: lanes.length }));
  });
}

export function CalendarWorkspace({ studio, appointments, reload, refreshError, refreshBusy }: { studio: CalendarStudio; appointments: Appointment[]; reload: () => Promise<unknown>; refreshError?: string; refreshBusy?: boolean }) {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const offset = studio.schedule?.utc_offset ?? 180;
  const requestedVisit=appointments.find(a=>a.id===params.get('visit'));
  const [date, setDate] = useState(() => masterDayKey(requestedVisit?.start??Date.now(), offset));
  const [mode, setMode] = useHistoryState<Mode>('calendar-mode', () => matchMedia('(max-width:800px)').matches ? 'day' : 'week');
  const [mobile, setMobile] = useState(() => matchMedia('(max-width:800px)').matches);
  const [selectedId, setSelectedId] = useHistoryState<string | null>('calendar-selected', () => requestedVisit?.id||null, { flow: true });
  const [manualOpen, setManual] = useHistoryState('calendar-manual', false, { flow: true });
  const manual = manualOpen || params.get('new') === '1';
  const initialManualIndex = useRef(params.get('new') === '1' ? Number(history.state?.idx || 0) : -1);
  const [editing, setEditing] = useHistoryState('calendar-edit', false, { flow: true });
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now());
  const manualDialog = useRef<HTMLDialogElement>(null);
  const detailTrigger = useRef<HTMLButtonElement | null>(null);
  const detailPanel = useRef<HTMLElement>(null);
  const own = appointments.filter(item => item.master_id === studio.profile.user_id);
  const selected = own.find(item => item.id === selectedId);
  const days = week(date);
  const period = mode === 'day' ? [date] : days;
  const active = own.filter(item => item.status !== 'cancelled');
  const inPeriod = active.filter(item => period.some(day => masterDayKey(item.start, offset) <= day && masterDayKey(item.end - 1, offset) >= day));
  const early = Math.min(studio.schedule?.opening ?? 540, ...inPeriod.map(item => localMinutes(item.start, offset)));
  const late = Math.max(studio.schedule?.closing ?? 1080, ...inPeriod.map(item => masterDayKey(item.start, offset) === masterDayKey(item.end - 1, offset) ? localMinutes(item.end, offset) || 1440 : 1440));
  const opening = Math.floor(early / 60) * 60;
  const closing = Math.min(1440, Math.max(opening + 60, Math.ceil(late / 60) * 60));
  const height = (closing - opening) * 1.15;
  useEffect(() => { const media = matchMedia('(max-width:800px)'); const changed = () => setMobile(media.matches); media.addEventListener('change', changed); return () => media.removeEventListener('change', changed); }, []);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 60000); return () => clearInterval(timer); }, []);
  useEffect(() => { if (manual) manualDialog.current?.showModal(); else manualDialog.current?.close(); }, [manual]);
  function choose(visit: Appointment, button: HTMLButtonElement) { detailTrigger.current = button; setSelectedId(visit.id); setEditing(false); setError(''); if (mobile) requestAnimationFrame(() => detailPanel.current?.focus()); }
  function closeDetail() { setSelectedId(null); setEditing(false); setError(''); requestAnimationFrame(() => detailTrigger.current?.focus()); }
  function closeManual() { manualDialog.current?.close(); if (params.get('new') === '1') { const index = Number(history.state?.idx || 0); if (initialManualIndex.current > 0) navigate(initialManualIndex.current - index - 1); else navigate('/calendar', { replace: true, state: null }); } else setManual(false); }
  async function update(status: Appointment['status']) {
    if (!selected || busy || (status === 'cancelled' && !confirm('Отменить запись?'))) return;
    setBusy(true); setError('');
    try { await json('/appointments/' + selected.id, 'PATCH', { status }); await reload(); setNotice('Запись обновлена.'); } catch (reason) { setError(reason instanceof Error ? reason.message : 'Не удалось сохранить'); } finally { setBusy(false); }
  }
  async function share() { const url = location.origin + '/v2/m/' + studio.profile.slug; try { if (navigator.share) await navigator.share({ title: studio.profile.name, url }); else { await navigator.clipboard.writeText(url); setNotice('Ссылка скопирована.'); } } catch { /* Closing the native share panel is not a failure. */ } }
  function move(amount: number) { if (mode === 'month') { const d = new Date(date + 'T12:00:00Z'); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() + amount); setDate(d.toISOString().slice(0, 10)); } else setDate(shift(date, amount * (mode === 'day' ? 1 : 7))); }
  function visitButton(visit: Appointment, styles?: CSSProperties) { return <button key={visit.id} type="button" className={'calendar-event ' + visit.status + (selectedId === visit.id ? ' selected' : '')} style={styles} onClick={event => choose(visit, event.currentTarget)} aria-label={visit.client_name + ', ' + visit.service + ', ' + masterTime(visit.start, offset)}>{mobile ? clientInitial(visit.client_name) : null}<span><b>{visit.client_name}</b><span>{visit.service}</span><time>{masterTime(visit.start, offset)}–{masterTime(visit.end, offset)}</time>{visit.reschedule_request_id?<small className="calendar-reschedule-mark">Запрос переноса</small>:null}{visit.status === 'pending' ? <small>Ожидает подтверждения</small> : null}</span>{mobile && visit.status === 'confirmed' ? <Check size={17}/> : null}</button>; }
  function timeline(dayList: string[]) { return <div className="calendar-time-scroll"><div className="calendar-time-table"><div className="calendar-grid-heading"><span/>{dayList.map(day => <button key={day} onClick={() => { setDate(day); if (mode === 'week') setMode('day'); }} className={day === masterDayKey(now, offset) ? 'today' : ''}><b>{dateLabel(day, { weekday: 'short' })}</b><small>{dateLabel(day, { day: 'numeric', month: 'long' })}</small></button>)}</div><div className="calendar-time-body" style={{ height }}><div className="calendar-clock-axis">{Array.from({ length: (closing - opening) / 60 + 1 }, (_, i) => <time key={i} style={{ top: i * 60 * 1.15 }}>{hhmm(opening + i * 60)}</time>)}</div><div className="calendar-time-columns" style={{ gridTemplateColumns: `repeat(${dayList.length},minmax(0,1fr))` }}>{dayList.map(day => { const start = Date.parse(day + 'T00:00:00Z') - offset * 60000; const items = active.filter(item => item.start < start + 86400000 && item.end > start); return <div key={day} className="calendar-time-column">{layoutVisits(items).map(({ visit, lane, lanes }) => { const from = Math.max(visit.start, start + opening * 60000); const to = Math.min(visit.end, start + closing * 60000); return visitButton(visit, { top: (from - start - opening * 60000) / 60000 * 1.15, height: Math.max(6, (to - from) / 60000 * 1.15), left: `calc(${lane / lanes * 100}% + 4px)`, width: `calc(${100 / lanes}% - 8px)` }); })}</div>; })}</div>{dayList.includes(masterDayKey(now, offset)) && localMinutes(now, offset) >= opening && localMinutes(now, offset) < closing ? <div className="calendar-now-line" style={{ top: (localMinutes(now, offset) - opening) * 1.15 }}><time>{masterTime(now, offset)}</time></div> : null}</div></div></div>; }
  const monthStart = date.slice(0, 8) + '01';
  const monthGrid = Array.from({ length: 42 }, (_, i) => shift(week(monthStart)[0], i));
  return <MasterCabinet profile={studio.profile} tab="calendar" openTab={tab => navigate('/studio?tab=' + tab)} share={share}>
    <div className={'calendar-reference' + (mobile && selected ? ' showing-detail' : '')}>
      <h1>Ваш <em>календарь.</em></h1>
      {refreshError ? <p className="form-error" role="alert">Изменения уже сохранены. Не удалось обновить календарь: {refreshError}. <button type="button" disabled={refreshBusy} onClick={() => void reload()}>Повторить обновление</button></p> : null}
      {notice ? <p className="calendar-reference-notice" role="status">{notice}</p> : null}
      <div className="calendar-reference-working">
        <div className="calendar-reference-toolbar"><div className="calendar-period-controls"><button className="button button-outline" aria-label="Предыдущий период" onClick={() => move(-1)}><ChevronLeft size={16}/></button><label className="calendar-date-picker"><span>{mode === 'month' ? dateLabel(date, { month: 'long', year: 'numeric' }) : mode === 'day' ? dateLabel(date, { day: 'numeric', month: 'long' }) : dateLabel(days[0], { day: 'numeric' }) + '–' + dateLabel(days[6], { day: 'numeric', month: 'long' })}</span><input aria-label="Выбрать дату" type="date" value={date} onChange={event => { if (event.target.value) setDate(event.target.value); }}/></label><button className="button button-outline" aria-label="Следующий период" onClick={() => move(1)}><ChevronRight size={16}/></button><button className="button button-outline" onClick={() => setDate(masterDayKey(Date.now(), offset))}>Сегодня</button></div><div className="calendar-mode-switch" aria-label="Режим календаря">{(['day', 'week', 'month'] as const).map((value, i) => <button key={value} aria-pressed={mode === value} className={mode === value ? 'active' : ''} onClick={() => setMode(value)}>{['День', 'Неделя', 'Месяц'][i]}</button>)}</div>{!mobile ? <button className="button button-wine calendar-new-button" onClick={() => { setNotice(''); setManual(true); }}><Plus size={19}/>Новая запись</button> : null}</div>
        <div className="calendar-reference-columns"><section className="calendar-reference-grid" aria-label="Расписание">
          {mobile && mode !== 'month' ? <div className="cabinet-week">{days.map(day => <button key={day} aria-pressed={day === date} className={day === date ? 'active' : ''} onClick={() => setDate(day)}><span>{dateLabel(day, { weekday: 'short' })}</span><small>{dateLabel(day, { day: 'numeric', month: 'short' })}</small></button>)}</div> : null}
          {mobile ? <>{mode === 'day' ? <h2 className="calendar-mobile-date">{dateLabel(date, { day: 'numeric', month: 'long', weekday: 'long' })}</h2> : null}<button className="button button-wine calendar-new-button" onClick={() => { setNotice(''); setManual(true); }}><Plus size={19}/>Новая запись</button></> : null}
          {mode === 'month' ? <div className="calendar-month-view"><div className="calendar-month-weekdays">{['Пн','Вт','Ср','Чт','Пт','Сб','Вс'].map(d => <span key={d}>{d}</span>)}</div><div className="calendar-month-grid">{monthGrid.map(day => { const items = own.filter(item => masterDayKey(item.start, offset) === day && item.status !== 'cancelled'); return <button key={day} className={(day === date ? 'active ' : '') + (day.slice(0, 7) !== date.slice(0, 7) ? 'outside' : '')} onClick={() => { setDate(day); setMode('day'); }} aria-label={dateLabel(day, { day: 'numeric', month: 'long' }) + ', записей ' + items.length}><b>{Number(day.slice(-2))}</b><small>{items.length ? mobile ? '• ' + items.length : items.length + ' записей' : ''}</small></button>; })}</div></div> : mobile && mode === 'week' ? <div className="calendar-week-agenda">{days.map(day => <section key={day}><h2>{dateLabel(day, { weekday: 'long', day: 'numeric', month: 'long' })}</h2>{own.filter(item => masterDayKey(item.start, offset) === day && item.status !== 'cancelled').sort((a, b) => a.start - b.start).map(item => visitButton(item))}{!own.some(item => masterDayKey(item.start, offset) === day && item.status !== 'cancelled') ? <p>Записей нет</p> : null}</section>)}</div> : timeline(mobile ? [date] : period)}
        </section><aside className="calendar-record-panel" ref={detailPanel} tabIndex={-1} aria-label="Подробности записи"><button className="calendar-record-back" onClick={editing ? () => setEditing(false) : closeDetail}><ArrowLeft size={16}/>{editing ? 'К записи' : 'К календарю'}</button>{selected ? editing ? <CalendarEditForm key={selected.id} appointment={selected} studio={studio} onCancel={() => setEditing(false)} onDone={async () => { setEditing(false); await reload(); setNotice('Изменения сохранены.'); }}/>: <><div className="calendar-record-title"><h2>Запись</h2><button aria-label="Закрыть запись" onClick={closeDetail}><X size={19}/></button></div><div className="calendar-record-person">{clientInitial(selected.client_name)}<div><h3>{selected.client_name}</h3><p>{selected.service}</p></div></div><p className="calendar-record-time"><CalendarDays size={17}/>{masterDate(selected.start, offset, { day: 'numeric', month: 'long' })} · {masterTime(selected.start, offset)}–{masterTime(selected.end, offset)}</p><span className={'status-pill ' + selected.status}>{statusLabel(selected.status)}</span><section><h3>О клиенте</h3><dl><dt>Контакт</dt><dd>{selected.guest_contact || selected.contact || 'Не указан'}</dd><dt>Заметки</dt><dd>{selected.notes || 'Нет заметок'}</dd></dl></section><section><h3>Услуга</h3><p>{selected.service}</p><dl className="calendar-record-service"><dt>Длительность</dt><dd>{Math.round((selected.end - selected.start) / 60000)} мин</dd><dt>Стоимость</dt><dd>{money(selected.price)}</dd></dl></section><RescheduleDecision visit={{...selected,utc_offset:offset}} reload={reload} onAccepted={(start,utcOffset)=>setDate(masterDayKey(start,utcOffset))}/>{error ? <p className="form-error" role="alert">{error}</p> : null}<div className="calendar-record-actions">{['pending','confirmed'].includes(selected.status) ? <button className="button button-wine" disabled={busy} onClick={() => setEditing(true)}><Pencil size={17}/>Изменить запись</button> : null}{selected.status === 'pending' ? <button className="button button-wine" disabled={busy} onClick={() => void update('confirmed')}>Подтвердить</button> : null}{selected.status === 'confirmed' ? <button className="button button-outline" disabled={busy} onClick={() => void update('done')}>Завершить</button> : null}{['pending','confirmed'].includes(selected.status) ? <button className="button button-outline calendar-cancel" disabled={busy} onClick={() => void update('cancelled')}>Отменить запись</button> : null}</div></> : <div className="calendar-no-selection"><Clock size={26}/><h2>Выберите запись</h2><p>Здесь появятся данные клиента и действия.</p></div>}</aside></div>
      </div>
    </div>
    <dialog className="calendar-create-dialog" ref={manualDialog} onCancel={event => { event.preventDefault(); closeManual(); }}><h2>Новая запись</h2>{manual ? <CabinetVisitForm services={studio.services} date={date} onDateChange={setDate} offset={offset} onCancel={closeManual} onDone={async (day) => { setDate(day); closeManual(); setNotice('Запись добавлена.'); await reload(); }}/> : null}</dialog>
  </MasterCabinet>;
}

export function CalendarEditForm({ appointment, studio, onCancel, onDone }: { appointment: Appointment; studio: Pick<CalendarStudio, 'schedule' | 'services'>; onCancel: () => void; onDone: () => Promise<void> }) {
  const offset = studio.schedule?.utc_offset ?? 180;
  const [name, setName] = useState(appointment.client_name);
  const [service, setService] = useState(appointment.service);
  const [serviceId, setServiceId] = useState('');
  const [date, setDate] = useState(masterDayKey(appointment.start, offset));
  const [time, setTime] = useState(masterTime(appointment.start, offset));
  const [duration, setDuration] = useState(String(Math.round((appointment.end - appointment.start) / 60000)));
  const [price, setPrice] = useState(String(appointment.price));
  const [notes, setNotes] = useState(appointment.notes || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const saving = useRef(false);
  async function submit(event: FormEvent) {
    event.preventDefault(); if (saving.current || saved) return;
    saving.current = true; setBusy(true); setError('');
    try { await json('/appointments/' + appointment.id, 'PATCH', { client_name: name.trim(), service_id: serviceId || undefined, service: service.trim(), start: Date.parse(date + 'T' + time + ':00Z') - offset * 60000, duration: Number(duration), price: Number(price), notes, expected: { start: appointment.start, end: appointment.end, status: appointment.status, client_name: appointment.client_name, service: appointment.service, price: appointment.price, notes: appointment.notes || '' } }); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Не удалось сохранить изменения'); saving.current = false; setBusy(false); return; }
    setSaved(true);
    try { await onDone(); } catch { setError('Изменения сохранены. Обновите календарь; повторно сохранять не нужно.'); } finally { setBusy(false); }
  }
  return <form className="calendar-edit-form" onSubmit={submit}><h2>Изменить <em>запись.</em></h2><fieldset disabled={busy || saved}><label>Имя клиента<input value={name} onChange={e => setName(e.target.value)} required maxLength={100}/></label><p className="calendar-edit-contact">Контакт: {appointment.guest_contact || appointment.contact || 'Не указан'}</p><label>Услуга<select value={serviceId} onChange={event => { setServiceId(event.target.value); const next = studio.services.find(s => s.id === event.target.value); if (next) { setService(next.name); setDuration(String(next.duration)); setPrice(String(next.price)); } }}><option value="">{appointment.service} · текущая / своя услуга</option>{studio.services.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>{!serviceId ? <label>Название услуги<input value={service} onChange={e => setService(e.target.value)} required maxLength={120}/></label> : null}<div className="form-row"><label>Дата<input type="date" value={date} onChange={e => setDate(e.target.value)} required/></label><label>Начало<input type="time" value={time} onChange={e => setTime(e.target.value)} required/></label></div><div className="form-row"><label>Длительность, мин<input type="number" min={5} max={720} step={1} value={duration} onChange={e => setDuration(e.target.value)} required/></label><label>Цена, ₽<input type="number" min={0} max={1000000} step={1} value={price} onChange={e => setPrice(e.target.value)} required/></label></div><label>Заметки<textarea aria-label="Заметки" rows={3} value={notes} onChange={e => setNotes(e.target.value)} maxLength={1000}/></label></fieldset><p className="calendar-edit-help">Изменения сохранятся после проверки свободного времени.</p>{error ? <p className="form-error" role="alert">{error}</p> : null}{saved ? <p role="status">Изменения сохранены.</p> : null}<div className="calendar-record-actions"><button className="button button-wine" disabled={busy || saved}>{busy ? 'Сохраняем…' : 'Сохранить изменения'}</button><button type="button" className="button button-outline" disabled={busy} onClick={onCancel}>{saved ? 'Закрыть' : 'Отмена'}</button></div></form>;
}
