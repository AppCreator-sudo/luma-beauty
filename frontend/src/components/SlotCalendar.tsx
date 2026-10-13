import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Clock3 } from 'lucide-react';
import { masterDate, masterDayKey, masterTime, type Profile, type Service, type Slot } from '../lib/api';
import '../slot-calendar.css';

const weekdays = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
function monthKey(date: Date) { return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`; }

export function SlotCalendar({ profile, service, selected, onSelect, compact = false, variant }: {
  profile: { schedule?: Pick<NonNullable<Profile['schedule']>, 'utc_offset'>; availability?: Slot[] }; service?: Pick<Service,'duration'> | null; selected?: number | null;
  onSelect?: (slot: Slot) => void; compact?: boolean; variant?: 'booking';
}) {
  const offset = profile.schedule?.utc_offset ?? 180;
  const slots = useMemo(() => (profile.availability || []).filter(slot => slot.start > Date.now() && (!service || slot.end - slot.start >= service.duration * 60000)), [profile.availability, service]);
  const firstDate = slots.find(slot => slot.start === selected)?.start || slots[0]?.start || Date.now();
  const firstKey = masterDayKey(firstDate, offset);
  const [month, setMonth] = useState(() => new Date(firstKey + 'T00:00:00Z'));
  const [day, setDay] = useState(firstKey);
  const byDay = useMemo(() => {
    const result = new Map<string, Slot[]>();
    for (const slot of slots) { const key = masterDayKey(slot.start, offset); const list = result.get(key) || []; list.push(slot); result.set(key, list); }
    return result;
  }, [slots, offset]);
  const first = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth(), 1));
  const blanks = (first.getUTCDay() + 6) % 7;
  const daysInMonth = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 0)).getUTCDate();
  const dates = Array.from({ length: blanks + daysInMonth }, (_, index) => index < blanks ? null : index - blanks + 1);
  const daySlots = byDay.get(day) || [];
  return <div className={'slot-calendar' + (compact ? ' compact' : '') + (variant === 'booking' ? ' reference-slot-calendar' : '')}>
    <div className="calendar-month">
    <div className="calendar-top"><div><span className="eyebrow">ВЫБЕРИТЕ ДАТУ</span><h3>{month.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric', timeZone: 'UTC' })}</h3></div><div className="calendar-arrows"><button type="button" aria-label="Предыдущий месяц" onClick={() => setMonth(new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() - 1, 1)))}><ChevronLeft size={18}/></button><button type="button" aria-label="Следующий месяц" onClick={() => setMonth(new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 1)))}><ChevronRight size={18}/></button></div></div>
    <div className="calendar-grid" role="group" aria-label="Даты записи">{weekdays.map(label => <span className="calendar-weekday" key={label}>{label}</span>)}{dates.map((number, index) => { if (!number) return <span key={'blank-' + index}/>; const key = monthKey(month) + '-' + String(number).padStart(2, '0'); const available = Boolean(byDay.get(key)?.length); return <button type="button" key={key} className={'calendar-day' + (day === key ? ' active' : '') + (available ? ' available' : '')} aria-label={number + ' ' + month.toLocaleDateString('ru-RU', { month: 'long', timeZone: 'UTC' }) + (available ? ', есть свободное время' : ', свободного времени нет')} aria-pressed={day === key} onClick={() => setDay(key)}>{number}{available ? <i/> : null}</button>; })}</div>
    <p className="calendar-legend"><i aria-hidden="true"/>Есть свободное время</p>
    </div>
    <div className="calendar-times"><span className="eyebrow">ВЫБЕРИТЕ ВРЕМЯ</span><div className="times-title"><Clock3 size={17}/><span>{daySlots.length ? masterDate(daySlots[0].start, offset) : new Date(day + 'T00:00:00Z').toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' })}</span></div>{daySlots.length ? <div className="time-grid">{daySlots.slice(0, compact ? 6 : 40).map(slot => <button type="button" key={slot.start} className={'time-choice' + (selected === slot.start ? ' active' : '')} onClick={() => onSelect?.(slot)} disabled={!onSelect} aria-pressed={selected === slot.start}>{masterTime(slot.start, offset)}</button>)}</div> : <p className="muted calendar-empty">На эту дату нет доступного времени.</p>}{variant === 'booking' && service ? <p className="booking-duration-note">{service.duration} мин для вашего визита</p> : null}</div>
  </div>;
}
