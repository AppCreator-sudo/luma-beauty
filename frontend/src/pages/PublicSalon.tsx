import {useApp} from '../components/Shell';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowRight, Sparkles } from 'lucide-react';
import { api, json, makeAccessKey, type PublicSalon, type Slot } from '../lib/api';
import { useHistoryState } from '../lib/useHistoryState';
import { useResource } from '../lib/useResource';
import { SlotCalendar } from '../components/SlotCalendar';
import { BookingActions, BookingContactForm, BookingEmpty, BookingHeading, BookingLayout, BookingNotice, BookingPageState, BookingServiceChoice } from '../components/BookingReference';
import '../salon-public-concept.css';

export { PublicSalonPage } from './SalonProfile';
export function SalonBookingPage() {
  const { slug = '' } = useParams(), [params] = useSearchParams();
  return <SalonBookingFlow key={slug + ':' + (params.get('master') || '')} slug={slug} initialService={params.get('service') || ''} initialMaster={params.get('master') || ''} initialStart={Number(params.get('start')) || null}/>;
}
function SalonBookingFlow({ slug, initialService, initialMaster, initialStart }: { slug: string; initialService: string; initialMaster: string; initialStart: number | null }) {
  const navigate = useNavigate(), resource = useResource(() => api<PublicSalon>('/public/salons/' + encodeURIComponent(slug)), [slug]);
  const [serviceId, setServiceId] = useState(initialService), [masterId, setMasterId] = useState(initialMaster), [start, setStart] = useState(initialStart);
  const [step, setStep] = useHistoryState('salon-booking-step', () => initialService && initialMaster ? 3 : initialService ? 2 : 1, { backOnDecrease: true });
  const {me}=useApp();
  const prefilled=useRef(false);
  useEffect(()=>{if(me?.user?.account_type==='client'&&me.client_profile&&!prefilled.current){prefilled.current=true;setName(value=>value||me.client_profile!.name);setContact(value=>value||me.client_profile!.contact)}},[me?.client_profile,me?.user?.account_type]);
  const [name, setName] = useState(''), [contact, setContact] = useState(''), [notes, setNotes] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const key = useRef(makeAccessKey()), submitting = useRef(false);
  const salon = resource.data, service = salon?.services.find(s => s.id === serviceId), requestKey = serviceId + ':' + masterId;
  const slots = useResource(async () => serviceId ? { ...(await api<{ slots: Slot[] }>('/public/salons/' + encodeURIComponent(slug) + '/availability?' + new URLSearchParams({ service: serviceId, master: masterId }))), key: requestKey } : { slots: [] as Slot[], key: requestKey }, [slug, requestKey]);
  const available = !slots.loading && !slots.error && slots.data?.key === requestKey ? slots.data.slots : [];
  useEffect(() => {
    if (!salon || resource.loading) return;
    if (serviceId && !service) { setServiceId(''); setMasterId(''); setStart(null); setStep(1); setError('Выберите актуальную услугу салона.'); }
    else if (!service && step > 1) setStep(1);
    else if (masterId && service && !service.master_ids.includes(masterId)) { setMasterId(''); setStart(null); setStep(2); setError('Выберите доступного мастера для этой услуги.'); }
    else if (step > 3 && !start) setStep(3);
  }, [salon, resource.loading, serviceId, service, masterId, step, start, setStep]);
  useEffect(() => { if (serviceId && start && !slots.loading && !slots.error && slots.data?.key === requestKey && !slots.data.slots.some(s => s.start === start)) setStart(null); }, [slots.loading, slots.error, slots.data, start, requestKey, serviceId]);
  function selectService(id: string) {
    if (serviceId !== id && serviceId) setStart(null);
    setServiceId(id); if (!salon?.services.find(s => s.id === id)?.master_ids.includes(masterId)) setMasterId('');
    setStep(2); setError('');
  }
  function selectMaster(id: string) { if (masterId !== id) setStart(null); setMasterId(id); setStep(3); setError(''); }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!salon || !service || !start || submitting.current) return;
    const website = new FormData(event.currentTarget).get('website') || '';
    submitting.current = true; setBusy(true); setError('');
    try {
      const created=await json<{id:string}>('/guest-appointments', 'POST', { salon_slug: slug, salon_service_id: service.id, master_id: masterId || undefined, start, client_name: name.trim(), contact: contact.trim(), notes: notes.trim(), access_key: key.current, website });
      if(me?.user?.account_type==='client'){await json('/guest-appointments/claim','POST',{access_key:key.current});navigate('/me?tab=visits&visit='+encodeURIComponent(created.id),{replace:true})}else navigate('/visit#' + key.current, { replace: true });
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : 'Не удалось отправить заявку'; setError(message);
      if (/недоступна|не оказывает/i.test(message)) { void resource.reload(); setMasterId(''); setServiceId(''); setStart(null); setStep(1); }
      else if (/занят|время|час/i.test(message)) { void slots.reload(); setStart(null); setStep(3); }
    } finally { submitting.current = false; setBusy(false); }
  }
  const backTo = '/s/' + slug;
  if (resource.loading) return <BookingPageState title="Ищем свободное" accent="время…" text="Открываем услуги и команду салона." loading/>;
  if (resource.error || !salon) return <BookingPageState title="Не удалось открыть" accent="запись." text={resource.error || 'Салон не найден'} backTo="/masters" backLabel="Найти салон" retry={() => void resource.reload()}/>;
  if (!salon.published) return <BookingPageState title="Страница салона пока" accent="скрыта." text="Выберите другой салон или вернитесь позже." backTo="/masters" backLabel="Найти салон"/>;
  if (!salon.services.length) return <BookingPageState title="Онлайн-запись пока" accent="закрыта." text="Салон ещё готовит услуги и расписание." backTo={backTo} backLabel="Вернуться в салон"/>;
  const services = initialMaster ? salon.services.filter(s => s.master_ids.includes(initialMaster)) : salon.services;
  const eligible = salon.staff.filter(p => service?.master_ids.includes(p.id)), master = salon.staff.find(p => p.id === masterId);
  const text = step === 1 ? 'Выберите услугу. Цена и длительность указаны салоном.' : step === 2 ? 'Все мастера оказывают выбранную услугу. Цена и длительность одинаковые.' : step === 3 ? 'Время салона · UTC' + (salon.utc_offset >= 0 ? '+' : '') + salon.utc_offset / 60 + '. Выберите дату и свободное окно. Показаны ближайшие 90 дней.' : 'Оставьте контакт, чтобы салон подтвердил заявку.' + (!masterId ? ' Имя назначенного мастера появится после отправки.' : '');
  return <BookingLayout backTo={backTo} labels={['Услуга', 'Мастер', 'Время', 'Контакт']} step={step} setStep={setStep} busy={busy} summary={{ identity: { name: salon.name, city: salon.city, address: salon.address, image: salon.logo, salon: true }, service, start, offset: salon.utc_offset, master: master?.name || (step >= 3 ? 'Любой свободный' : undefined) }}>
    <BookingHeading step={step} total={4} title={step === 1 ? 'Время для' : step === 2 ? 'К кому' : step === 3 ? 'Когда вам' : 'Осталось'} accent={step === 1 ? 'себя.' : step === 2 ? 'запишемся?' : step === 3 ? 'удобно?' : 'знакомство.'} text={text}/>
    <BookingNotice error={error}/>
    {step === 1 ? services.length ? <><div className="service-list">{services.map(s => <BookingServiceChoice key={s.id} service={s} selected={s.id === serviceId} onSelect={() => selectService(s.id)}/>)}</div><p className="hint">Запись доступна без аккаунта.</p></> : <BookingEmpty title="Нет доступных услуг" text="У этого мастера пока нет доступных для записи услуг."><Link className="button wine" to={backTo + '/book'}>Выбрать всю команду</Link></BookingEmpty> : null}
    {step === 2 ? <>{eligible.length ? <div className="people"><button type="button" className="person any" onClick={() => selectMaster('')} aria-pressed={!masterId}><span className="avatar small-avatar"><Sparkles size={22} strokeWidth={1}/></span><div><h3>Любой свободный мастер</h3><p>Больше вариантов времени</p></div><ArrowRight className="arrow" size={18}/></button>{eligible.map(p => <button className="person" type="button" key={p.id} onClick={() => selectMaster(p.id)} aria-pressed={masterId === p.id}><span className="avatar small-avatar">{p.avatar ? <img src={p.avatar} alt=""/> : p.name.trim().slice(0, 1)}</span><div><h3>{p.name}</h3><p>{p.categories.join(' · ')}{p.teaches ? ' · Обучает' : ''}</p></div><ArrowRight className="arrow" size={18}/></button>)}</div> : <BookingEmpty title="Мастера пока недоступны" text="Выберите другую услугу."/>}<BookingActions back={() => setStep(1)}/></> : null}
    {step === 3 ? <>{slots.loading ? <p className="slot-loading" role="status">Ищем свободное время…</p> : slots.error ? <BookingEmpty title="Не удалось загрузить время" text={slots.error}><button className="button wine" type="button" onClick={() => void slots.reload()}>Попробовать ещё раз</button></BookingEmpty> : available.length ? <SlotCalendar variant="booking" key={requestKey} profile={{ schedule: { utc_offset: salon.utc_offset }, availability: available }} service={service} selected={start} onSelect={slot => { setStart(slot.start); setError(''); }}/> : <BookingEmpty title="Свободных окон пока нет" text="Попробуйте выбрать другого мастера или услугу."><button className="button wine" type="button" onClick={() => setStep(2)}>Выбрать мастера</button></BookingEmpty>}<BookingActions back={() => setStep(2)} next={available.length ? () => setStep(4) : undefined} disabled={!start || slots.loading || Boolean(slots.error)}/></> : null}
    {step === 4 ? <BookingContactForm name={name} contact={contact} notes={notes} onName={setName} onContact={setContact} onNotes={setNotes} onSubmit={submit} back={() => setStep(3)} busy={busy} disabled={!service || !start || !available.some(s => s.start === start)} salon/> : null}
  </BookingLayout>;
}
