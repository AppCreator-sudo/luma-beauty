import { useEffect, useRef, type FormEvent, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Check, ChevronDown, Clock3, ShieldCheck } from 'lucide-react';
import { masterDate, masterTime, money } from '../lib/api';
import '../booking-reference.css';

export type BookingIdentityValue = { name: string; city?: string; address?: string; image?: string; salon?: boolean };
export function BookingIdentity({ identity }: { identity: BookingIdentityValue }) {
  return <div className="identity"><span className="avatar">{identity.image ? <img src={identity.image} alt=""/> : identity.name.trim().slice(0, 1)}</span><div><small>{identity.salon ? 'САЛОН КРАСОТЫ' : 'САМОСТОЯТЕЛЬНЫЙ МАСТЕР'}</small><h3>{identity.name}</h3>{identity.city || identity.address ? <p>{[identity.city, identity.address].filter(Boolean).join(' · ')}</p> : null}</div></div>;
}

type SummaryProps = { identity: BookingIdentityValue; service?: { name: string; price: number; duration: number } | null; start?: number | null; offset: number; master?: string };
function SummaryBody({ identity, service, start, offset, master }: SummaryProps) {
  return <div className="summary-body"><BookingIdentity identity={identity}/><dl><div><dt>Услуга</dt><dd>{service?.name || 'Выберите услугу'}</dd></div>{identity.salon ? <div><dt>Мастер</dt><dd>{master || 'Выберите мастера'}</dd></div> : null}<div><dt>Длительность</dt><dd>{service ? service.duration + ' мин' : '—'}</dd></div><div><dt>Дата и время</dt><dd>{start ? masterDate(start, offset, { day: 'numeric', month: 'long' }) + ', ' + masterTime(start, offset) : 'Выберите время'}</dd></div></dl><div className="total"><span>Стоимость {identity.salon ? 'в салоне' : 'у мастера'}</span><strong>{service ? money(service.price) : '—'}</strong></div><p className="privacy">Оплата напрямую {identity.salon ? 'в салоне' : 'мастеру'}.<br/>Заявка ожидает подтверждения.</p></div>;
}

export function BookingLayout({ backTo, labels, step, setStep, summary, busy, children }: {
  backTo: string; labels: string[]; step: number; setStep: (value: number) => void; summary: SummaryProps; busy: boolean; children: ReactNode;
}) {
  const content = useRef<HTMLDivElement>(null), previous = useRef(step);
  useEffect(() => {
    if (previous.current === step) return;
    previous.current = step;
    const heading = content.current?.querySelector<HTMLElement>('h1');
    heading?.focus({ preventScroll: true });
    if (heading) { const rect = heading.getBoundingClientRect(); if (rect.top < 0 || rect.bottom > innerHeight) heading.scrollIntoView({ block: 'start' }); }
  }, [step]);
  return <div className="booking-reference"><Link className="back-link" to={backTo}><ArrowLeft size={14}/> На страницу {summary.identity.salon ? 'салона' : 'мастера'}</Link><div className="booking-top"><span className="eyebrow">ЗАПИСЬ {summary.identity.salon ? 'В САЛОН' : 'К МАСТЕРУ'}</span><p>{summary.identity.name}</p></div><nav className="progress" aria-label="Шаги записи">{labels.map((label, i) => <button type="button" key={label} className={i + 1 === step ? 'active' : i + 1 < step ? 'done' : ''} disabled={busy || i + 1 > step} aria-current={i + 1 === step ? 'step' : undefined} onClick={() => setStep(i + 1)}><span>{i + 1 < step ? <Check size={12}/> : i + 1}</span>{label}</button>)}</nav><div className="layout"><div ref={content} className="step-content"><section className="reference-step" key={step}>{children}</section></div><aside className="summary desktop-summary" aria-label="Сводка записи"><SummaryBody {...summary}/></aside><details className="summary mobile-summary"><summary><span>Ваша запись{summary.service ? ' · ' + money(summary.service.price) : ''}</span><ChevronDown size={14}/></summary><SummaryBody {...summary}/></details></div></div>;
}

export function BookingHeading({ step, total, title, accent, text }: { step: number; total: number; title: string; accent: string; text: string }) {
  return <div className="step-heading"><span className="eyebrow">ШАГ {String(step).padStart(2, '0')} ИЗ {total}</span><h1 tabIndex={-1}>{title} <em>{accent}</em></h1><p>{text}</p></div>;
}
export function BookingNotice({ error }: { error: string }) {
  return error ? <div className="notice" role="alert"><p>{error}</p></div> : null;
}
export function BookingActions({ back, next, disabled, busy = false }: { back: () => void; next?: () => void; disabled?: boolean; busy?: boolean }) {
  return <div className="step-actions"><button type="button" className="button outline" onClick={back} disabled={busy}>Назад</button>{next ? <button type="button" className="button wine" onClick={next} disabled={disabled || busy}>Продолжить <ArrowRight size={16}/></button> : null}</div>;
}
export function BookingServiceChoice({ service, selected, onSelect }: { service: { id: string; name: string; duration: number; price: number }; selected: boolean; onSelect: () => void }) {
  return <button className="service-row" type="button" onClick={onSelect} aria-pressed={selected}><div><h3>{service.name}</h3><p>{service.duration} мин</p></div><strong>{money(service.price)}</strong><ArrowRight className="arrow" size={18}/></button>;
}
export function BookingContactForm({ name, contact, notes, onName, onContact, onNotes, onSubmit, back, busy, disabled, salon = false }: {
  name: string; contact: string; notes: string; onName: (value: string) => void; onContact: (value: string) => void; onNotes: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void; back: () => void; busy: boolean; disabled: boolean; salon?: boolean;
}) {
  return <form className="contact-form" onSubmit={onSubmit} aria-busy={busy}><div className="fields"><label>Как к вам обращаться?<input placeholder="Ваше имя" value={name} onChange={e => onName(e.target.value)} maxLength={100} autoComplete="name" required disabled={busy}/></label><label>Телефон или Telegram<input placeholder="+7 999 123-45-67 или @username" value={contact} onChange={e => onContact(e.target.value)} maxLength={100} autoComplete="tel" required disabled={busy}/></label><label>Комментарий <small>необязательно</small><textarea placeholder="Пожелания к визиту" value={notes} onChange={e => onNotes(e.target.value)} maxLength={1000} rows={3} disabled={busy}/></label></div><input name="website" className="honeypot" tabIndex={-1} autoComplete="off" aria-hidden="true"/><p className="privacy"><ShieldCheck size={14}/> Контакт {salon ? 'увидит владелец салона' : 'увидит только мастер'}. Регистрация не требуется.</p><div className="step-actions"><button type="button" className="button outline" onClick={back} disabled={busy}>Назад</button><button className="button wine" type="submit" disabled={busy || disabled || !name.trim() || !contact.trim()}>{busy ? 'Отправляем…' : 'Отправить заявку'} <ArrowRight size={16}/></button></div></form>;
}
export function BookingEmpty({ title, text, children }: { title: string; text: string; children?: ReactNode }) {
  return <div className="empty-panel"><Clock3 className="empty-icon" size={30} strokeWidth={1}/><h2>{title}</h2><p>{text}</p>{children}</div>;
}
export function BookingPageState({ title, accent, text, backTo, backLabel, loading, retry }: {
  title: string; accent: string; text: string; backTo?: string; backLabel?: string; loading?: boolean; retry?: () => void;
}) {
  return <div className="booking-reference"><div className="result-page"><div className="result-heading"><span className="eyebrow">{loading ? 'ВРЕМЯ ДЛЯ СЕБЯ' : 'ЗАПИСЬ'}</span><h1>{title} <em>{accent}</em></h1><p role={loading ? 'status' : undefined}>{text}</p></div>{!loading ? <div className="step-actions">{backTo ? <Link className="button outline" to={backTo}>{backLabel || 'Назад'}</Link> : null}{retry ? <button className="button wine" type="button" onClick={retry}>Попробовать ещё раз</button> : null}</div> : <span className="booking-loader" aria-hidden="true"/>}</div></div>;
}
