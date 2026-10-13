import { useHistoryState } from '../lib/useHistoryState';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { json, masterDate, masterTime, money, type Service } from '../lib/api';
import { CabinetSteps } from './CabinetSteps';

export function CabinetVisitForm({ services, date, onDateChange, offset, masterId, mode = 'visit', initialTime = '10:00', onDone, onCancel }: {
  services: Service[]; date: string; onDateChange: (date: string) => void; offset: number; masterId?: string;
  mode?: 'visit' | 'break'; initialTime?: string; onDone: (date: string, start: number) => void | Promise<void>; onCancel: () => void;
}) {
  const [step, setStep] = useHistoryState('create-visit-step-' + (masterId || 'self'), 0, { backOnDecrease: true }), [name, setName] = useState(''), [serviceId, setServiceId] = useState(services[0]?.id || '');
  const [time, setTime] = useState(initialTime), [duration, setDuration] = useState('60'), [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [saved, setSaved] = useState(false);
  const submitting = useRef(false), panel = useRef<HTMLFieldSetElement>(null);
  const service = mode === 'visit' ? services.find(item => item.id === serviceId) : undefined;
  const minutes = service?.duration ?? Number(duration);
  const start = Date.parse(date + 'T' + time + ':00Z') - offset * 60000;
  useEffect(() => { panel.current?.querySelector<HTMLElement>('input,select,textarea,h3')?.focus(); }, [step]);
  function validate(index: number) {
    if (index === 0 && mode === 'visit' && !name.trim()) return 'Укажите имя клиента.';
    if (index === 0 && mode === 'visit' && serviceId && !service) return 'Выберите действующую услугу.';
    if (index === 1 || mode === 'break') {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time) || !Number.isFinite(start)) return 'Укажите дату и время.';
      if (!Number.isInteger(minutes) || minutes < 5 || minutes > 720) return 'Длительность должна быть от 5 до 720 минут.';
    }
    return '';
  }
  function move(next: number) {
    const message = next > step ? validate(step) : '';
    if (message) { setError(message); return; }
    setError(''); setStep(next);
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || submitting.current || saved) return;
    if (mode === 'visit' && step < 2) { move(step + 1); return; }
    for (const index of [0, 1]) {
      const message = validate(index);
      if (message) { setError(message); if (mode === 'visit') setStep(index); return; }
    }
    submitting.current = true; setBusy(true); setError('');
    try {
      await json('/appointments', 'POST', { master_id: masterId, client_name: mode === 'break' ? 'Перерыв' : name.trim(), service_id: service?.id,
        service: mode === 'break' ? 'Время закрыто' : service?.name || 'Личная запись', price: service?.price || 0, duration: minutes, start, notes });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Не удалось сохранить запись.');
      submitting.current = false; setBusy(false); return;
    }
    setSaved(true);
    try { await onDone(date, start); }
    catch { setError('Запись сохранена. Обновите календарь; повторно создавать её не нужно.'); }
    finally { setBusy(false); }
  }
  return <form className="settings-form cabinet-flow cabinet-visit-flow" onSubmit={submit} noValidate aria-busy={busy}>
    {mode === 'visit' ? <CabinetSteps labels={['Клиент', 'Время', 'Итог']} current={step} onSelect={move} disabled={busy || saved}/> : null}
    <fieldset className="cabinet-step-panel" ref={panel} disabled={busy || saved}>
      {mode === 'visit' && step === 0 ? <><h3 tabIndex={-1}>Кого записываем</h3><label>Имя клиента<input value={name} onChange={event => setName(event.target.value)} required maxLength={100}/></label><label>Услуга<select value={serviceId} onChange={event => setServiceId(event.target.value)}><option value="">Личная запись</option>{services.map(item => <option key={item.id} value={item.id}>{item.name} · {item.duration} мин · {money(item.price)}</option>)}</select></label></> : null}
      {step === 1 || mode === 'break' ? <><h3 tabIndex={-1}>{mode === 'break' ? 'Закрыть время' : 'Когда состоится запись'}</h3><p className="muted">Время {masterId ? 'салона' : 'мастера'} · UTC{offset >= 0 ? '+' : ''}{offset / 60}</p><div className="form-row"><label>Дата<input type="date" value={date} onChange={event => onDateChange(event.target.value)} required/></label><label>Начало<input type="time" value={time} onChange={event => setTime(event.target.value)} required/></label></div>{!service ? <label>Длительность, мин<input type="number" value={duration} min={5} max={720} onChange={event => setDuration(event.target.value)} required/></label> : <p className="cabinet-inline-note">{service.duration} мин · {money(service.price)}</p>}</> : null}
      {mode === 'visit' && step === 2 ? <><h3 tabIndex={-1}>Проверьте запись</h3><dl className="cabinet-summary"><div><dt>Клиент</dt><dd>{name}</dd></div><div><dt>Услуга</dt><dd>{service?.name || 'Личная запись'}</dd></div><div><dt>Начало</dt><dd>{Number.isFinite(start) ? masterDate(start, offset) + ' · ' + masterTime(start, offset) : 'Укажите время'}</dd></div><div><dt>Длительность / цена</dt><dd>{minutes} мин · {money(service?.price || 0)}</dd></div></dl></> : null}
      {step === 2 || mode === 'break' ? <label>Заметка (необязательно)<textarea value={notes} onChange={event => setNotes(event.target.value)} maxLength={1000} rows={2}/></label> : null}
    </fieldset>
    {error ? <p className="form-error" role="alert">{error}</p> : null}{saved ? <p className="studio-action-notice" role="status">{mode === 'break' ? 'Время закрыто.' : 'Запись сохранена.'}</p> : null}
    <div className="cabinet-flow-actions"><button type="button" className="button button-outline" disabled={busy} onClick={onCancel}>{saved ? 'Закрыть' : 'Отмена'}</button>{mode === 'visit' && step > 0 && !saved ? <button type="button" className="button button-outline" disabled={busy} onClick={() => move(step - 1)}>Назад</button> : null}{!saved ? <button type="submit" className="button button-wine" disabled={busy}>{busy ? 'Сохраняем…' : mode === 'break' ? 'Закрыть время' : step < 2 ? 'Далее' : 'Добавить запись'}</button> : null}</div>
  </form>;
}
