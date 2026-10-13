import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, MapPin, X } from 'lucide-react';
import { api, bookingPath, masterDate, masterDayKey, masterTime, money, profilePath } from '../lib/api';
import { mapIdentity, type MapDetails, type MapMaster } from '../lib/map';
import { currentPromotion, usePromotionClock } from '../lib/promotions';
import { PromotionBadge } from './PromotionBadge';

function slotLabel(start: number, offset: number) {
  return (masterDayKey(start, offset) === masterDayKey(Date.now(), offset) ? 'Сегодня' : masterDate(start, offset, { day: 'numeric', month: 'short' })) + ', ' + masterTime(start, offset);
}

export function MapProfileCard({ profile, category, soon, onClose, onLayout }: { profile: MapMaster; category: string; soon: boolean; onClose: () => void; onLayout: (element: HTMLElement) => void }) {
  const id = mapIdentity(profile);
  const [reload, setReload] = useState(0);
  const [result, setResult] = useState<{ id: string; data: MapDetails | null; loading: boolean; error: string }>({ id: '', data: null, loading: true, error: '' });
  const element = useRef<HTMLElement>(null), layout = useRef(onLayout); layout.current = onLayout;
  useEffect(() => {
    const request = new AbortController();
    setResult({ id, data: null, loading: true, error: '' });
    api<MapDetails>('/map/details?' + new URLSearchParams({ kind: profile.kind || 'master', id: profile.user_id, category }), { signal: request.signal })
      .then(data => { if (!request.signal.aborted) setResult({ id, data, loading: false, error: '' }); })
      .catch(reason => { if (!request.signal.aborted) setResult({ id, data: null, loading: false, error: reason instanceof Error ? reason.message : 'Не удалось загрузить карточку' }); });
    return () => request.abort();
  }, [id, profile.kind, profile.user_id, category, reload]);
  useEffect(() => {
    const refresh = () => { if (!document.hidden) setReload(value => value + 1); };
    const timer = setInterval(refresh, 60000);
    window.addEventListener('focus', refresh); document.addEventListener('visibilitychange', refresh);
    return () => { clearInterval(timer); window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', refresh); };
  }, [id]);
  useEffect(() => {
    if (!element.current) return;
    const card = element.current, observer = new ResizeObserver(() => layout.current(card));
    observer.observe(card);
    return () => observer.disconnect();
  }, [id]);
  useEffect(() => {
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    document.addEventListener('keydown', close);
    return () => document.removeEventListener('keydown', close);
  }, [onClose]);
  const details = result.id === id && !result.loading && !result.error ? result.data : null;
  useEffect(() => {
    if (!details) return;
    const start = details.availability?.start;
    if (soon && (!start || start <= Date.now() || start > Date.now() + 3600000)) { onClose(); return; }
    if (!start || start <= Date.now()) return;
    const timer = setTimeout(() => setReload(value => value + 1), Math.min(start - Date.now() + 20, 2147483647));
    return () => clearTimeout(timer);
  }, [details, soon, onClose]);
  const shown = details?.profile || profile;
  const now = usePromotionClock([shown]);
  const current = currentPromotion(shown, now);
  const slot = details?.availability && details.availability.start > now ? details.availability : null;
  const params = slot ? new URLSearchParams({ service: slot.service.id, start: String(slot.start), ...(current.kind === 'salon' && slot.performer ? { master: slot.performer.id } : {}) }) : null;
  const book = bookingPath(current) + (params ? '?' + params : '');
  return <article ref={element} className={'map-selected-card' + (current.promotion ? ' map-selected-card-promoted' : '')} aria-label="Карточка выбранного мастера или салона" aria-busy={result.loading}>
    {current.promotion && details?.cover ? <img className="map-card-cover" src={details.cover} alt={'Работа: ' + current.name}/> : null}
    <div className="map-card-body">
      <div className="map-card-top"><span>{current.kind === 'salon' ? 'Салон' : 'Мастер'}</span><PromotionBadge promotion={current.promotion}/><button type="button" className="map-card-close" onClick={onClose} aria-label="Закрыть карточку"><X size={18}/></button></div>
      <h2>{current.name}</h2>
      <p className="map-card-category">{(current.categories || [current.category]).join(' · ')}{current.teaches ? ' · Обучает' : ''}</p>
      <p className="map-card-address"><MapPin size={15}/><span>{[current.city, current.address].filter(Boolean).join(' · ')}</span></p>
      {result.error ? <div className="map-card-error" role="alert"><p>{result.error}</p><button className="text-link" type="button" onClick={() => setReload(value => value + 1)}>Повторить</button></div> : result.loading ? <p className="map-card-loading" role="status">Ищем ближайшее время…</p> : slot ? <>
        <div className="map-card-slot"><span>Ближайшая запись</span><strong>{slotLabel(slot.start, slot.utc_offset)}</strong></div>
        <p className="map-card-service">{slot.service.title}</p>
        <div className="map-card-price"><span>{slot.service.duration} мин{slot.performer ? ' · ' + slot.performer.name : ''}</span><strong>{money(slot.service.price)}</strong></div>
      </> : <p className="map-card-loading">{current.is_demo ? 'Пример страницы · запись недоступна' : 'Нет свободного времени в ближайшие 7 дней'}</p>}
      {!current.is_demo && !result.loading && !result.error && details ? <Link className="button button-wine map-card-book" to={book}>{slot ? 'Записаться' : 'Посмотреть расписание'}<ArrowRight size={17}/></Link> : null}
      <Link className="map-card-profile text-link" to={profilePath(current)}>Страница {current.kind === 'salon' ? 'салона' : 'мастера'} <ArrowRight size={13}/></Link>
    </div>
  </article>;
}
