import { useEffect, useId, useRef, useState, type ChangeEvent } from 'react';
import { Building2, Upload } from 'lucide-react';
import { api } from '../lib/api';
import { imageUploadAccept, imageUploadHint, validateImageUpload, type ImageKind } from '../lib/imageUpload';
import '../salon-visual.css';

export function SalonMark({ name, logo, compact = false }: { name: string; logo?: string; compact?: boolean }) {
  return <span className={'salon-mark' + (compact ? ' salon-mark-compact' : '')}>{logo ? <img src={logo} alt={'Логотип ' + name}/> : <span aria-hidden="true">{name.trim().slice(0, 1) || 'а'}</span>}</span>;
}

export function SalonCardVisual({ name, logo, cover }: { name: string; logo?: string; cover?: string }) {
  return <span className="salon-card-art"><span className={'salon-card-image' + (cover ? '' : ' salon-card-fallback')}>{cover ? <img src={cover} alt="" loading="lazy"/> : <><Building2 size={38} strokeWidth={1}/><span>Пространство красоты</span></>}</span><span className="salon-card-brand"><SalonMark name={name} logo={logo} compact/><span>Салон красоты</span></span></span>;
}

export function StaffPortrait({ name, image, salonName, logo, interactive = true }: { name: string; image?: string; salonName: string; logo?: string; interactive?: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const portraits = <><span className="salon-staff-portrait">{image ? <img src={image} alt={'Фото мастера ' + name} loading="lazy"/> : <span className="salon-portrait-placeholder" aria-label="Фото ещё не добавлено">{name.trim().slice(0, 1)}</span>}</span><span className="salon-staff-avatar-logo"><SalonMark name={salonName} logo={logo}/></span></>;
  if (!interactive) return <span className="salon-staff-visual"><span className="salon-staff-avatar-pair is-static">{portraits}</span></span>;
  return <div className="salon-staff-visual"><button type="button" className={'salon-staff-avatar-pair' + (expanded ? ' is-expanded' : '')} aria-label={'Фото мастера ' + name + ' и логотип ' + salonName} aria-expanded={expanded} onClick={() => setExpanded(value => !value)} onPointerEnter={event => { if (event.pointerType === 'mouse') setExpanded(true); }} onPointerLeave={event => { if (event.pointerType === 'mouse') setExpanded(false); }} onFocus={event => { if (event.currentTarget.matches(':focus-visible')) setExpanded(true); }} onBlur={() => setExpanded(false)}>{portraits}</button><div className="salon-staff-brand"><span>{salonName}</span></div></div>;
}

// Images save separately, so uploading a photo never submits or clears the form.
export function ImageUploadField({ endpoint, label, image, onSaved, kind, disabled = false }: { endpoint: string; label: string; image?: string; onSaved: (image: string) => void; kind: ImageKind; disabled?: boolean }) {
  const id = useId();
  const submitting = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  const [operation, setOperation] = useState<'checking' | 'uploading' | 'removing' | ''>('');
  const helpId = id + '-help', errorId = id + '-error';
  const [current, setCurrent] = useState(image || ''), [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  useEffect(() => { setCurrent(image || ''); }, [image]);
  async function choose(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0]; event.currentTarget.value = '';
    if (!file || submitting.current || disabled) return;
    setError(''); setNotice('');
    submitting.current = true; setBusy(true); setOperation('checking');
    try {
      await validateImageUpload(file, kind);
      setOperation('uploading');
      const body = new FormData(); body.set('image', file);
      const result = await api<{ image: string }>(endpoint, { method: 'POST', body });
      setCurrent(result.image); setNotice('Фото сохранено'); onSaved(result.image);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Не удалось сохранить фото'); }
    finally { submitting.current = false; setBusy(false); setOperation(''); }
  }
  async function remove() {
    if (submitting.current || disabled) return;
    submitting.current = true; setError(''); setNotice(''); setBusy(true); setOperation('removing');
    try { await api(endpoint, { method: 'DELETE' }); setCurrent(''); setNotice('Фото удалено'); onSaved(''); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Не удалось удалить фото'); }
    finally { submitting.current = false; setBusy(false); setOperation(''); }
  }
  return <div className="salon-image-field" aria-busy={busy}><label htmlFor={id}>{label}</label><div className="salon-image-controls"><button type="button" className="button button-outline" onClick={() => input.current?.click()} disabled={disabled || busy}><Upload size={16}/>{operation === 'checking' ? 'Проверяем фото…' : busy ? 'Сохраняем…' : current ? 'Заменить фото' : 'Загрузить фото'}</button><input ref={input} id={id} aria-label={label} aria-describedby={helpId + (error ? ' ' + errorId : '')} aria-invalid={Boolean(error)} type="file" accept={imageUploadAccept} onChange={choose} disabled={disabled || busy}/>{current ? <button type="button" className="text-link" onClick={() => void remove()} disabled={disabled || busy}>Удалить фото</button> : null}</div><small id={helpId}>{imageUploadHint(kind)}</small>{error ? <p id={errorId} className="form-error" role="alert">{error}</p> : null}{notice ? <p role="status">{notice}</p> : null}</div>;
}
