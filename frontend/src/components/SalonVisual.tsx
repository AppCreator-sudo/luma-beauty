import { useEffect, useId, useRef, useState, type ChangeEvent } from 'react';
import { Building2, Pencil, Trash2 } from 'lucide-react';
import { api } from '../lib/api';
import { imageUploadAccept, validateImageUpload, type ImageKind } from '../lib/imageUpload';
import {ImageCropDialog} from './ImageCropDialog';
import {useHistoryState} from '../lib/useHistoryState';
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
  const [pendingFile,setPendingFile]=useState<File|null>(null);
  const [cropOpen,setCropOpen]=useHistoryState('image-editor-'+endpoint,false,{flow:true});
  const [operation, setOperation] = useState<'checking' | 'uploading' | 'removing' | ''>('');
  const [current, setCurrent] = useState(image || ''), [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  useEffect(() => { setCurrent(image || ''); }, [image]);
  async function choose(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0]; event.currentTarget.value = '';
    if (!file || submitting.current || disabled) return;
    setError(''); setNotice('');
    submitting.current = true; setBusy(true); setOperation('checking');
    try {
      await validateImageUpload(file, kind);
      setPendingFile(file);setCropOpen(true);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Не удалось сохранить фото'); }
    finally { submitting.current = false; setBusy(false); setOperation(''); }
  }
  async function saveCrop(file:File){
    if(submitting.current||disabled)return false;
    submitting.current=true;setBusy(true);setOperation('uploading');setError('');
    try{
      const body=new FormData();body.set('image',file);
      const result=await api<{image:string}>(endpoint,{method:'POST',body});
      setCurrent(result.image);setNotice('Фото сохранено');setCropOpen(false);setPendingFile(null);onSaved(result.image);return true;
    }catch(reason){setError(reason instanceof Error?reason.message:'Не удалось сохранить фото');return false}
    finally{submitting.current=false;setBusy(false);setOperation('')}
  }
  async function remove() {
    if (submitting.current || disabled || !confirm(endpoint.includes('/performers/')?'Удалить фото мастера? Онлайн-запись сотрудника будет выключена. Существующие визиты сохранятся.':'Удалить '+label.toLowerCase()+'?')) return;
    submitting.current = true; setError(''); setNotice(''); setBusy(true); setOperation('removing');
    try { await api(endpoint, { method: 'DELETE' }); setCurrent(''); setNotice('Фото удалено'); onSaved(''); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Не удалось удалить фото'); }
    finally { submitting.current = false; setBusy(false); setOperation(''); }
  }
  return <div className="media-edit-tools" aria-busy={busy}><button type="button" title={current?'Изменить '+label.toLowerCase():'Добавить '+label.toLowerCase()} aria-label={(current?'Изменить: ':'Добавить: ')+label} onClick={()=>input.current?.click()} disabled={disabled||busy}><Pencil size={18}/></button><input ref={input} id={id} aria-label={label} type="file" accept={imageUploadAccept} onChange={choose} disabled={disabled||busy}/>{current?<button type="button" title="Удалить фото" aria-label={'Удалить: '+label} disabled={disabled||busy} onClick={()=>void remove()}><Trash2 size={18}/></button>:null}{operation?<p className="media-edit-status" role="status">{operation==='checking'?'Проверяем фото…':operation==='removing'?'Удаляем…':'Сохраняем…'}</p>:null}{error&&!cropOpen?<p className="media-edit-status form-error" role="alert">{error}</p>:null}{notice?<span className="sr-only" role="status">{notice}</span>:null}{cropOpen&&pendingFile?<ImageCropDialog file={pendingFile} kind={kind} busy={busy} error={error} onCancel={()=>{setCropOpen(false);setPendingFile(null);setError('')}} onSave={saveCrop}/>:null}</div>;
}
