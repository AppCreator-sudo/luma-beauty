import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, ArrowUpRight } from 'lucide-react';
import { api, json, makeAccessKey, masterDate, masterTime, money, statusLabel, type Appointment, type Profile, type PublicSalon, type Slot } from '../lib/api';
import { useHistoryState } from '../lib/useHistoryState';
import { useResource } from '../lib/useResource';
import { useApp } from '../components/Shell';
import { SlotCalendar } from '../components/SlotCalendar';
import { BookingActions, BookingContactForm, BookingEmpty, BookingHeading, BookingIdentity, BookingLayout, BookingNotice, BookingPageState, BookingServiceChoice } from '../components/BookingReference';

export function BookingPage() {
  const { slug = '' } = useParams();
  return <MasterBookingFlow key={slug} slug={slug}/>;
}
function MasterBookingFlow({ slug }: { slug: string }) {
  const [params] = useSearchParams(), navigate = useNavigate();
  const resource = useResource(() => api<Profile>('/profiles/' + encodeURIComponent(slug)), [slug]);
  const [serviceId, setServiceId] = useState(params.get('service') || '');
  const [start, setStart] = useState<number | null>(Number(params.get('start')) || null);
  const [step, setStep] = useHistoryState('booking-step', () => params.get('service') ? 2 : 1, { backOnDecrease: true });
  const {me}=useApp();
  const prefilled=useRef(false);
  useEffect(()=>{if(me?.user?.account_type==='client'&&me.client_profile&&!prefilled.current){prefilled.current=true;setName(value=>value||me.client_profile!.name);setContact(value=>value||me.client_profile!.contact)}},[me?.client_profile,me?.user?.account_type]);
  const [name, setName] = useState(''), [contact, setContact] = useState(''), [notes, setNotes] = useState('');
  const [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const accessKey = useRef(makeAccessKey()), submitting = useRef(false);
  const profile = resource.data, service = profile?.services.find(item => item.id === serviceId) || null;
  const offset = profile?.schedule?.utc_offset ?? 180, backTo = '/m/' + slug;
  const validStarts = useMemo(() => new Set((profile?.availability || []).filter(slot => slot.start > Date.now() && (!service || slot.end - slot.start >= service.duration * 60000)).map(slot => slot.start)), [profile, service]);
  useEffect(() => {
    if (!profile || resource.loading) return;
    if (serviceId && !service) { setServiceId(''); setStart(null); setStep(1); setError('Выберите актуальную услугу мастера.'); }
    else if (!service && step > 1) setStep(1);
    else if (step > 2 && !start) setStep(2);
  }, [profile, resource.loading, serviceId, service, step, start, setStep]);
  useEffect(() => { if (start && profile && !resource.loading && !validStarts.has(start)) setStart(null); }, [profile, resource.loading, start, validStarts]);
  function chooseService(value: string) {
    const chosen = profile?.services.find(item => item.id === value);
    if (start && !profile?.availability?.some(slot => slot.start === start && chosen && slot.end - start >= chosen.duration * 60000)) setStart(null);
    setServiceId(value); setError(''); setStep(2);
  }
  function chooseSlot(slot: Slot) { setStart(slot.start); setError(''); }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!profile || !service || !start || submitting.current) return;
    const website = new FormData(event.currentTarget).get('website') || '';
    submitting.current = true; setError(''); setBusy(true);
    try {
      const created=await json<{id:string}>('/guest-appointments', 'POST', { master_id: profile.user_id, service_id: service.id, start, client_name: name.trim(), contact: contact.trim(), notes: notes.trim(), reference_work_id: params.get('work') || undefined, access_key: accessKey.current, website });
      if(me?.user?.account_type==='client'){await json('/guest-appointments/claim','POST',{access_key:accessKey.current});navigate('/me?tab=visits&visit='+encodeURIComponent(created.id),{replace:true})}else navigate('/visit#' + accessKey.current, { replace: true });
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : 'Не удалось отправить заявку';
      setError(message);
      if (/занят|время|час|слот/i.test(message)) { void resource.reload(); setStart(null); setStep(2); }
    } finally { submitting.current = false; setBusy(false); }
  }
  if (resource.loading) return <BookingPageState title="Ищем свободное" accent="время…" text="Открываем услуги и расписание мастера." loading/>;
  if (resource.error || !profile) return <BookingPageState title="Не удалось открыть" accent="запись." text={resource.error || 'Мастер не найден'} backTo="/masters" backLabel="Найти мастера" retry={() => void resource.reload()}/>;
  if (profile.is_demo) return <BookingPageState title="Запись к этому мастеру" accent="недоступна." text="Это пример оформления. Выберите действующего мастера, чтобы отправить настоящую заявку." backTo="/masters" backLabel="Найти мастера"/>;
  if (!profile.services.length) return <BookingPageState title="Услуги пока" accent="не добавлены." text="Мастер ещё оформляет свою страницу." backTo={backTo} backLabel="Вернуться к мастеру"/>;
  return <BookingLayout backTo={backTo} labels={['Услуга', 'Время', 'Контакт']} step={step} setStep={setStep} busy={busy} summary={{ identity: { name: profile.name, city: profile.city, address: profile.address, image: profile.avatar }, service, start, offset }}>
    <BookingHeading step={step} total={3} title={step === 1 ? 'Время для' : step === 2 ? 'Когда вам' : 'Осталось'} accent={step === 1 ? 'себя.' : step === 2 ? 'удобно?' : 'знакомство.'} text={step === 1 ? 'Выберите услугу. Цена и длительность указаны мастером.' : step === 2 ? 'Время мастера · UTC' + (offset >= 0 ? '+' : '') + offset / 60 + '. Выберите дату и свободное окно.' : 'Оставьте контакт, чтобы мастер подтвердил заявку.'}/>
    <BookingNotice error={error}/>
    {step === 1 ? <><div className="service-list">{profile.services.map(item => <BookingServiceChoice key={item.id} service={item} selected={serviceId === item.id} onSelect={() => chooseService(item.id)}/>)}</div><p className="hint">Запись доступна без аккаунта.</p></> : null}
    {step === 2 ? <>{validStarts.size ? <><SlotCalendar variant="booking" profile={profile} service={service} selected={start} onSelect={chooseSlot}/><BookingActions back={() => setStep(1)} next={() => setStep(3)} disabled={!start}/></> : <><BookingEmpty title="Свободных окон пока нет" text="Выберите другую услугу или вернитесь на страницу мастера."><button className="button wine" type="button" onClick={() => setStep(1)}>Выбрать услугу</button></BookingEmpty><BookingActions back={() => setStep(1)}/></>}</> : null}
    {step === 3 ? <BookingContactForm name={name} contact={contact} notes={notes} onName={setName} onContact={setContact} onNotes={setNotes} onSubmit={submit} back={() => setStep(2)} busy={busy} disabled={!service || !start || !validStarts.has(start)}/> : null}
  </BookingLayout>;
}

type GuestVisit = Appointment & { contact: string; city: string; address?: string };
export function VisitPage() {
  const { hash } = useLocation();
  return <GuestVisitFlow key={hash} accessKey={hash.slice(1)}/>;
}
function GuestVisitFlow({ accessKey }: { accessKey: string }) {
  const { me } = useApp(), navigate = useNavigate();
  const resource = useResource(() => /^[a-f0-9]{64}$/.test(accessKey) ? json<GuestVisit>('/guest-appointments/access', 'POST', { access_key: accessKey }) : Promise.reject(new Error('Откройте личную ссылку, полученную после записи.')), [accessKey]);
  const visit = resource.data;
  const image = useResource(async () => {
    if (visit?.salon_slug) return (await api<PublicSalon>('/public/salons/' + encodeURIComponent(visit.salon_slug))).logo;
    if (visit?.slug) return (await api<Profile>('/profiles/' + encodeURIComponent(visit.slug))).avatar;
    return '';
  }, [visit?.salon_slug, visit?.slug]);
  const [busy, setBusy] = useState(false), [copied, setCopied] = useState(false), [error, setError] = useState('');
  const [cancelOpen, setCancelOpen] = useHistoryState('visit-cancel', false, { flow: true });
  const dialog = useRef<HTMLDialogElement>(null), cancelButton = useRef<HTMLButtonElement>(null), operation = useRef(false);
  const active = Boolean(visit && ['pending', 'confirmed'].includes(visit.status));
  useEffect(() => {
    const surface = dialog.current;
    if (!surface) return;
    if (!cancelOpen || !active) { if (surface.open) surface.close(); return; }
    const body = document.body, root = document.documentElement, scroll = window.scrollY;
    const saved = { position: body.style.position, top: body.style.top, width: body.style.width, overflow: root.style.overflow, overscroll: root.style.overscrollBehavior };
    body.style.position = 'fixed'; body.style.top = -scroll + 'px'; body.style.width = '100%';
    root.style.overflow = 'hidden'; root.style.overscrollBehavior = 'none';
    if (!surface.open) surface.showModal();
    return () => {
      if (surface.open) surface.close();
      body.style.position = saved.position; body.style.top = saved.top; body.style.width = saved.width;
      root.style.overflow = saved.overflow; root.style.overscrollBehavior = saved.overscroll;
      window.scrollTo(0, scroll);
      requestAnimationFrame(() => { if (!surface.open) cancelButton.current?.focus({ preventScroll: true }); });
    };
  }, [cancelOpen, active]);
  async function cancel() {
    if (operation.current) return;
    operation.current = true; setBusy(true); setError('');
    try { await json('/guest-appointments/cancel', 'POST', { access_key: accessKey }); setCancelOpen(false); await resource.reload(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Не удалось отменить запись'); }
    finally { operation.current = false; setBusy(false); }
  }
  async function claim() {
    if (operation.current) return;
    operation.current = true; setBusy(true); setError('');
    try { await json('/guest-appointments/claim', 'POST', { access_key: accessKey }); navigate('/me', { replace: true }); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Не удалось сохранить запись'); }
    finally { operation.current = false; setBusy(false); }
  }
  async function copy() {
    setError(''); setCopied(false);
    try { await navigator.clipboard.writeText(window.location.href); setCopied(true); }
    catch { setError('Не удалось скопировать ссылку. Скопируйте адрес этой страницы из адресной строки браузера.'); }
  }
  if (resource.loading) return <BookingPageState title="Открываем вашу" accent="запись…" text="Проверяем актуальный ответ на заявку." loading/>;
  if (resource.error || !visit) return <div className="booking-reference"><div className="result-page"><div className="result-heading"><span className="eyebrow">ЛИЧНАЯ ССЫЛКА</span><h1>Не удалось открыть <em>запись.</em></h1><p>{resource.error || 'Запись не найдена'}</p></div><BookingEmpty title="Проверьте сохранённую ссылку" text="Если вы сохранили запись в аккаунт, откройте «Моё»."><div className="step-actions"><Link className="button outline" to="/masters">Найти мастера</Link><Link className="button wine" to={me?.user?.account_type === 'client' ? '/me' : '/auth'}>{me?.user?.account_type === 'client' ? 'Мои записи' : 'Войти'}</Link></div></BookingEmpty></div></div>;
  const backTo = visit.salon_slug ? '/s/' + visit.salon_slug : '/m/' + visit.slug;
  const bookTo = visit.salon_slug ? '/s/' + visit.salon_slug + '/book' : '/book/' + visit.slug;
  const description = visit.status === 'confirmed' ? 'Ваша запись подтверждена.' : visit.status === 'cancelled' ? 'Отмена сохранена. Вы можете выбрать новое время.' : visit.status === 'done' ? 'Спасибо, что нашли время для себя.' : 'Заявка отправлена. ' + (visit.salon_name ? 'Салон' : 'Мастер') + ' свяжется с вами для подтверждения.';
  return <div className="booking-reference"><div className="result-page"><div className="result-heading"><span className="eyebrow">ВАША ЛИЧНАЯ ССЫЛКА</span><h1>{visit.status === 'cancelled' ? 'Визит' : 'Время для'} <em>{visit.status === 'cancelled' ? 'отменён.' : 'себя.'}</em></h1><p>{description}</p></div><article className="result-card"><div className="result-status"><span className={'dot ' + visit.status}/>{statusLabel(visit.status)}</div><BookingIdentity identity={{ name: visit.salon_name || visit.master_name || 'Мастер', city: visit.city, address: visit.address, image: image.data || undefined, salon: Boolean(visit.salon_name) }}/><h2>{visit.service}</h2><div className="result-facts"><div><span>Дата и время</span><strong>{masterDate(visit.start, visit.utc_offset, { day: 'numeric', month: 'long' })}, {masterTime(visit.start, visit.utc_offset)}</strong></div><div><span>Длительность</span><strong>{Math.round((visit.end - visit.start) / 60000)} мин</strong></div><div><span>Стоимость</span><strong>{money(visit.price)}</strong></div><div><span>Контакт</span><strong>{visit.contact}</strong></div>{visit.salon_name ? <div><span>Назначенный мастер</span><strong>{visit.master_name}</strong></div> : null}</div><p className="result-note">Сохраните личную ссылку: по ней можно узнать ответ и отменить активную запись без аккаунта.</p><BookingNotice error={cancelOpen ? '' : error}/><div className="result-actions"><button className="button wine" type="button" onClick={copy}>{copied ? 'Ссылка скопирована' : 'Скопировать ссылку'} <ArrowUpRight size={16}/></button>{me?.user?.account_type === 'client' && visit.status !== 'cancelled' ? <button className="button outline" type="button" onClick={claim} disabled={busy}>Добавить в мой кабинет</button> : null}{active ? <button ref={cancelButton} className="text-button" type="button" onClick={() => { setError(''); setCancelOpen(true); }} disabled={busy}>Отменить запись</button> : <Link className="button outline" to={bookTo}>Выбрать новое время</Link>}</div></article><p className="result-back"><Link to={backTo}><ArrowLeft size={14}/> На страницу {visit.salon_name ? 'салона' : 'мастера'}</Link></p><dialog ref={dialog} className="booking-cancel-dialog" aria-labelledby="visit-cancel-title" onCancel={e => { e.preventDefault(); if (!busy) setCancelOpen(false); }}><h2 id="visit-cancel-title">Отменить запись?</h2><p>Это время снова станет доступно для других клиентов.</p><BookingNotice error={error}/><div className="step-actions"><button className="button outline" type="button" onClick={() => setCancelOpen(false)} disabled={busy} autoFocus>Оставить запись</button><button className="button wine" type="button" onClick={cancel} disabled={busy}>{busy ? 'Отменяем…' : 'Отменить запись'}</button></div></dialog></div></div>;
}
