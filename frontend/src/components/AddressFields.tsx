import { useEffect, useId, useRef, useState } from 'react';
import { json } from '../lib/api';

type Point = { latitude: number; longitude: number };
export type AddressValue = { city: string; address: string; point: Point | null };
export type StoredAddress = { city: string; address: string; latitude: number | null; longitude: number | null };
type AddressSaveResult = { address_result: StoredAddress };
export function addressValueFromStored(value?: Partial<StoredAddress> | null): AddressValue {
  return { city: value?.city || '', address: value?.address || '', point: value?.latitude != null && value.longitude != null ? { latitude: value.latitude, longitude: value.longitude } : null };
}
export function addressChanged(value: AddressValue, saved: AddressValue) {
  return value.city.trim() !== saved.city.trim() || value.address.trim() !== saved.address.trim() || value.point?.latitude !== saved.point?.latitude || value.point?.longitude !== saved.point?.longitude;
}

export function AddressFields({ value, saveEndpoint, onChange, onSaved, onStart, onBusy, busy }: {
  value: AddressValue; saveEndpoint: string;
  onChange: (value: AddressValue) => void; onSaved: (value: AddressValue) => void;
  onStart: () => void; onBusy: (busy: boolean) => void; busy: boolean;
}) {
  const id = useId(), request = useRef(0), inFlight = useRef(false);
  const [loading, setLoading] = useState(false), [error, setError] = useState(''), [saved, setSaved] = useState(false);
  const disabled = busy || loading;
  useEffect(() => { onBusy(loading); return () => onBusy(false); }, [loading, onBusy]);
  useEffect(() => () => { request.current++; }, []);
  function change(field: 'city' | 'address', text: string) {
    request.current++; setError(''); setSaved(false);
    onChange({ ...value, [field]: text, point: null });
  }
  async function save() {
    if (disabled || inFlight.current) return;
    onStart(); setSaved(false); setError('');
    if (!value.city.trim() || !value.address.trim()) { setError('Укажите город, улицу и номер дома.'); return; }
    const generation = ++request.current; inFlight.current = true; setLoading(true);
    try {
      const result = await json<AddressSaveResult>(saveEndpoint, 'PUT', { city: value.city, address: value.address, latitude: value.point?.latitude ?? null, longitude: value.point?.longitude ?? null });
      if (generation !== request.current) return;
      onSaved(addressValueFromStored(result.address_result)); setSaved(true);
    } catch (reason) { if (generation === request.current) setError(reason instanceof Error ? reason.message : 'Не удалось сохранить адрес. Попробуйте ещё раз.'); }
    finally { inFlight.current = false; if (generation === request.current) setLoading(false); }
  }
  return <fieldset className="address-fields" disabled={busy} aria-busy={disabled}><legend>Город и адрес приёма</legend>
    <label htmlFor={id + '-city'}>Город<input id={id + '-city'} value={value.city} onChange={event => change('city', event.target.value)} maxLength={80} required disabled={disabled} placeholder="Например, Новосибирск" aria-invalid={Boolean(error)} aria-describedby={error ? id + '-error' : undefined}/></label>
    <label htmlFor={id + '-address'}>Улица и дом<input id={id + '-address'} value={value.address} onChange={event => change('address', event.target.value)} maxLength={200} disabled={disabled} placeholder="Улица, дом, корпус" aria-invalid={Boolean(error)} aria-describedby={error ? id + '-error' : undefined}/></label>
    <button className="button button-outline" type="button" disabled={disabled} onClick={save}>{loading ? 'Сохраняем…' : 'Сохранить'}</button>
    {error ? <p id={id + '-error'} className="form-error" role="alert">{error}</p> : null}
    {saved ? <p role="status">Адрес сохранён.</p> : null}
  </fieldset>;
}
