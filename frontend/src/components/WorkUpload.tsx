import { useHistoryState } from '../lib/useHistoryState';
import { useEffect, useId, useRef, useState, type ChangeEvent, type FormEvent, type ReactNode } from 'react';
import { ImagePlus, Plus } from 'lucide-react';
import { api, json, servicePriceLabel, type Service, type Work } from '../lib/api';
import { CabinetSteps } from './CabinetSteps';
import '../work-upload.css';

export function WorkUpload({ services, onDone, endpoint = '/works', serviceEndpoint = '/services', selector, requireService = true, existing, onCancel, validateSelection, contextSummary, reference = false, navigationKey = '', pending = false, onBusyChange, onSaved }: { navigationKey?: string; reference?: boolean; pending?: boolean; onBusyChange?: (busy: boolean) => void; onSaved?: (message: string) => void; services: Service[]; onDone: () => void | Promise<unknown>; endpoint?: string; serviceEndpoint?: string; selector?: ReactNode; requireService?: boolean; existing?: Pick<Work,'id'|'caption'|'image'|'images'|'service_id'>; onCancel?: () => void; validateSelection?: () => string | undefined; contextSummary?: ReactNode }) {
  const wizard = !existing;
  const fileInput = useRef<HTMLInputElement>(null);
  const id = useId();
  const [draftId] = useState(() => crypto.randomUUID());
  // A remount or full reload loses local inputs, so it needs a fresh step history.
  const [step, setStep] = useHistoryState('work-upload-step-' + endpoint + '-' + (existing?.id || 'new') + '-' + navigationKey + '-' + draftId, 0, { backOnDecrease: true });
  const [previews, setPreviews] = useState<{ url: string; name: string }[]>(() => existing ? (existing.images?.length ? existing.images : [{image:existing.image}]).map(photo => ({url:photo.image,name:'Фото публикации'})) : []);
  const [caption, setCaption] = useState(existing?.caption || '');
  const [serviceId, setServiceId] = useState(existing?.service_id || '');
  const [createdServices, setCreatedServices] = useState<Service[]>([]);
  const [addingService, setAddingService] = useState(false);
  const [serviceName, setServiceName] = useState('');
  const [servicePrice, setServicePrice] = useState('');
  const [serviceDuration, setServiceDuration] = useState('60');
  const [errors, setErrors] = useState<{ photos?: string; caption?: string; service?: string }>({});
  const [error, setError] = useState('');
  const [busyAction, setBusyAction] = useState<'work' | 'service' | null>(null);
  const busyRef = useRef(false);
  const busy = busyAction !== null || pending;
  const [message, setMessage] = useState('');
  const allServices = [...services, ...createdServices.filter(item => !services.some(service => service.id === item.id))];
  const selectedService = allServices.find(service => service.id === serviceId);
  const validServiceId = selectedService?.id || '';
  useEffect(() => () => previews.forEach(photo => URL.revokeObjectURL(photo.url)), [previews]);
  useEffect(() => { setCreatedServices([]); setServiceId(existing?.service_id || ''); setAddingService(false); }, [serviceEndpoint, existing?.service_id]);

  function changeBusy(action: 'work' | 'service' | null) {
    busyRef.current = action !== null;
    setBusyAction(action);
    onBusyChange?.(action !== null);
  }

  function savedNotice(message: string) {
    if (onSaved) onSaved(message);
    else setMessage(message);
  }

  function choosePhotos(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files || []);
    setPreviews(files.map(file => ({ url: URL.createObjectURL(file), name: file.name })));
    setErrors(current => ({ ...current, photos: files.length > 6 ? 'Выберите не более шести фотографий' : undefined }));
    setError('');
  }

  function validateStep(index: number) {
    const count = fileInput.current?.files?.length || 0;
    const issue = reference ? (index === 0 ? (!existing && !count ? 'Выберите хотя бы одно фото' : count > 6 ? 'Выберите не более шести фотографий' : undefined) : index === 1 ? validateSelection?.() || (requireService && !validServiceId ? 'Выберите связанную услугу' : undefined) || (!caption.trim() ? 'Добавьте подпись к публикации' : undefined) : undefined) : index === 0 ? validateSelection?.() || (requireService && !validServiceId ? 'Выберите связанную услугу' : undefined) : index === 1 ? (!existing && !count ? 'Выберите хотя бы одно фото' : count > 6 ? 'Выберите не более шести фотографий' : undefined) : !caption.trim() ? 'Добавьте подпись к публикации' : undefined;
    const errorField = reference ? index === 0 ? 'photos' : requireService && !validServiceId ? 'service' : 'caption' : index === 0 ? 'service' : index === 1 ? 'photos' : 'caption';
    setErrors(current => ({ ...current, [errorField]: issue }));
    setError(issue || '');
    return !issue;
  }

  function moveStep(next: number) {
    if (busyRef.current || pending || next < 0 || next > 2) return;
    for (let index = step; index < next; index++) if (!validateStep(index)) { setStep(index); return; }
    setError(''); setStep(next);
  }

  async function createService() {
    if (busyRef.current || pending) return;
    const name = serviceName.trim(), price = Number(servicePrice), duration = Number(serviceDuration);
    if (!name || servicePrice === '' || !Number.isFinite(price) || price < 0 || !Number.isFinite(duration) || duration < 5) {
      setError('Укажите название, цену и длительность услуги'); return;
    }
    changeBusy('service'); setError(''); setMessage('');
    try {
      const result = await json<{ id: string }>(serviceEndpoint, 'POST', { name, price, duration });
      setCreatedServices(current => [...current, { id: result.id, user_id: '', name, price, duration }]);
      setServiceId(result.id); setErrors(current => ({ ...current, service: undefined }));
      setAddingService(false); setServiceName(''); setServicePrice(''); setServiceDuration('60');
    } catch (reason) { setError(reason instanceof TypeError ? 'Не удалось связаться с сервером. Попробуйте ещё раз.' : reason instanceof Error ? reason.message : 'Не удалось создать услугу'); }
    finally { changeBusy(null); }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busyRef.current || pending) return;
    if (wizard && step < 2) { moveStep(step + 1); return; }
    for (let index = 0; index < 3; index++) if (!validateStep(index)) { if (wizard) setStep(index); return; }
    const form = event.currentTarget;
    const payload = new FormData(form);
    changeBusy('work'); setError(''); setMessage('');
    try {
      await api(endpoint + (existing ? '/' + existing.id : ''), { method: existing ? 'PUT' : 'POST', body: payload });
    } catch (reason) {
      setError(reason instanceof TypeError ? 'Не удалось связаться с сервером. Попробуйте ещё раз.' : reason instanceof Error ? reason.message : 'Не удалось опубликовать');
      changeBusy(null); return;
    }
    if (!existing) { form.reset(); setPreviews([]); setCaption(''); setServiceId(''); setStep(0); }
    const success = existing ? 'Публикация обновлена.' : selector ? 'Публикация сохранена.' : 'Работа добавлена в портфолио.';
    savedNotice(success);
    try { await onDone(); }
    catch { savedNotice(success + ' Обновите список публикаций, чтобы увидеть изменения.'); }
    finally { changeBusy(null); }
  }

  return <form className={'upload-form work-upload' + (wizard ? ' cabinet-flow' : '')} onSubmit={submit} noValidate aria-busy={busy} style={wizard && step === 0 ? {gridTemplateColumns:'minmax(0, 1fr)'} : undefined}>
    <fieldset className="work-upload-fields" disabled={busy}>
      <div className="upload-title"><ImagePlus size={22}/><span><strong>{existing ? 'Редактировать публикацию' : selector ? 'Добавить публикацию' : 'Добавить работу'}</strong><small>До 6 фотографий, JPEG, PNG или WebP</small></span></div>
      {wizard ? <CabinetSteps labels={reference ? ['Фото','Описание','Проверка'] : [selector ? requireService ? 'Автор и услуга' : 'Автор и вид' : 'Услуга','Фото','Подпись']} current={step} onSelect={moveStep} disabled={busy}/> : null}
      <div className="cabinet-step-panel" hidden={wizard && step !== (reference ? 1 : 0)} style={wizard && step !== (reference ? 1 : 0) ? {display:'none'} : undefined}>
        {selector}
        {requireService ? <label>Связанная услуга<select aria-invalid={Boolean(errors.service)} aria-describedby={errors.service ? id + '-service-error' : undefined} name="service_id" value={validServiceId} onChange={event => { setServiceId(event.target.value); setErrors(current => ({ ...current, service: undefined })); setError(''); }}><option value="">Выберите услугу</option>{allServices.map(service => <option key={service.id} value={service.id}>{service.name} · {servicePriceLabel(service.price)}</option>)}</select>{errors.service ? <small id={id + '-service-error'} className="form-error">{errors.service}</small> : null}</label> : null}
        {requireService ? <button type="button" className="text-link" onClick={() => setAddingService(value => !value)}>{addingService ? 'Скрыть создание услуги' : 'Добавить новую услугу'}</button> : null}
        {requireService && addingService ? <div className="work-inline-service"><label>Название<input value={serviceName} onChange={event => setServiceName(event.target.value)} maxLength={120} placeholder="Например, маникюр"/></label><div className="work-inline-service-row"><label>Цена от, ₽<input type="number" min="0" max="1000000" value={servicePrice} onChange={event => setServicePrice(event.target.value)}/></label><label>Длительность, мин<input type="number" min="5" max="720" value={serviceDuration} onChange={event => setServiceDuration(event.target.value)}/></label></div><button type="button" className="button button-outline" disabled={busy} onClick={createService}>{busyAction === 'service' ? 'Создаём услугу…' : 'Создать и выбрать услугу'}</button></div> : null}
      </div>
      <div className="cabinet-step-panel" hidden={wizard && step !== (reference ? 0 : 1)} style={wizard && step !== (reference ? 0 : 1) ? {display:'none'} : undefined}>
        <label className="work-photo-picker">Фотографии публикации<small>Нажмите «Выбрать файлы» и добавьте фотографии с устройства.</small><input aria-invalid={Boolean(errors.photos)} aria-describedby={errors.photos ? id + '-photos-error' : undefined} ref={fileInput} name="image" type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={choosePhotos}/>{errors.photos ? <small id={id + '-photos-error'} className="form-error">{errors.photos}</small> : null}</label>
        {previews.length ? <p className="muted">Выбрано фотографий: {previews.length}</p> : null}
      </div>
      <div className="cabinet-step-panel" hidden={wizard && step !== (reference ? 1 : 2)} style={wizard && step !== (reference ? 1 : 2) ? {display:'none'} : undefined}>
        <label>Подпись<textarea aria-invalid={Boolean(errors.caption)} aria-describedby={errors.caption ? id + '-caption-error' : undefined} name="caption" maxLength={500} rows={3} value={caption} onChange={event => { setCaption(event.target.value); setErrors(current => ({ ...current, caption: undefined })); setError(''); }} placeholder="Расскажите историю этой работы"/>{errors.caption ? <small id={id + '-caption-error'} className="form-error">{errors.caption}</small> : null}</label>
        {wizard && !reference ? <div className="cabinet-summary">{contextSummary}{selectedService ? <p>Услуга: {selectedService.name} · {servicePriceLabel(selectedService.price)} · {selectedService.duration} мин</p> : null}<p>Фотографий: {previews.length}</p><p className="muted">Публикация появится после нажатия «Опубликовать».</p></div> : null}
      </div>
      {reference && wizard && step === 2 ? <div className="cabinet-summary">{contextSummary}<p>Подпись: {caption}</p>{selectedService ? <p>Услуга: {selectedService.name} · {servicePriceLabel(selectedService.price)} · {selectedService.duration} мин</p> : null}<p>Фотографий: {previews.length}</p><p>Публикация появится после нажатия «Опубликовать».</p></div> : null}
      {message ? <p className="studio-action-notice" role="status">{message}</p> : null}
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      <div className="cabinet-flow-actions">
        {wizard && step > 0 ? <button type="button" className="button button-outline" onClick={() => moveStep(step - 1)}>Назад</button> : onCancel ? <button type="button" className="button button-outline" onClick={onCancel}>{existing ? 'Отменить редактирование' : 'Отменить'}</button> : null}
        {wizard && step < 2 ? <button key="next" type="button" className="button button-wine" disabled={busy} onClick={event => { event.preventDefault(); moveStep(step + 1); }}>{reference ? 'Далее' : step === 0 ? 'Далее: фото' : 'Далее: подпись'}</button> : <button key="save" type="submit" className="button button-wine" disabled={busy}><Plus size={16}/>{busyAction === 'work' ? 'Сохраняем…' : existing ? 'Сохранить публикацию' : 'Опубликовать'}</button>}
      </div>
    </fieldset>
    <aside className="work-upload-preview" aria-label="Предпросмотр публикации" hidden={wizard && step === 0} style={wizard && step === 0 ? {display:'none'} : undefined}><span className="eyebrow">КАК УВИДЯТ КЛИЕНТЫ</span>{previews.length ? <><img className="work-preview-main" src={previews[0].url} alt="Предпросмотр выбранной работы"/>{previews.length > 1 ? <div className="work-preview-thumbnails">{previews.slice(1).map((photo, index) => <img key={photo.url} src={photo.url} alt={'Фото ' + (index + 2)}/>)}</div> : null}</> : <div className="work-preview-empty"><ImagePlus size={30}/><span>Здесь появятся выбранные вами фотографии</span></div>}<h3>{caption.trim() || 'Здесь появится подпись к публикации'}</h3>{requireService ? <p>{selectedService ? selectedService.name + ' · ' + servicePriceLabel(selectedService.price) : 'Связанная услуга появится здесь'}</p> : null}</aside>
  </form>;
}
