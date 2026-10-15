import {useHistoryState} from '../lib/useHistoryState';
import {Link} from 'react-router-dom';
import {ArrowRight,CalendarDays} from 'lucide-react';
import {api,masterDate,masterTime,money,type PublicSalon,type Slot} from '../lib/api';
import {useResource} from '../lib/useResource';

export function SalonPublicWindow({salon}:{salon:PublicSalon}) {
  const [chosen,setChosen]=useHistoryState('salon-window-service','');
  const [selectedStart,setSelectedStart]=useHistoryState<number|null>('salon-window-start',null);
  const service=salon.services.find(s=>s.id===chosen)||salon.services[0];
  const slots=useResource(()=>service&&salon.published?api<{slots:Slot[]}>('/public/salons/'+encodeURIComponent(salon.slug)+'/availability?'+new URLSearchParams({service:service.id})):Promise.resolve({slots:[]}),[salon.slug,salon.published,service?.id]);
  const times=!slots.loading&&!slots.error?slots.data?.slots.filter(s=>s.start>Date.now())||[]:[],nearest=times[0],selected=times.find(s=>s.start===selectedStart)||nearest;
  const book='/s/'+salon.slug+'/book?service='+encodeURIComponent(service?.id||'');
  return <section className="public-window" aria-label="Ближайшее свободное окно"><h2><CalendarDays size={19}/>Ближайшее окно</h2>{service&&salon.published?<>
    <label>Услуга<select value={service.id} onChange={e=>{setChosen(e.target.value);setSelectedStart(null)}}>{salon.services.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
    {slots.loading?<p className="public-muted" role="status">Проверяем время…</p>:slots.error?<div className="public-muted"><p>Не удалось проверить время.</p><button type="button" className="button button-outline" onClick={()=>void slots.reload()}>Повторить</button></div>:nearest?<><p className="public-window-date">{masterDate(nearest.start,salon.utc_offset)}</p><div className="public-window-times">{times.filter(s=>masterDate(s.start,salon.utc_offset)===masterDate(nearest.start,salon.utc_offset)).slice(0,3).map(s=><button type="button" key={s.start} aria-pressed={selected?.start===s.start} className={selected?.start===s.start?'active':''} onClick={()=>setSelectedStart(s.start)}>{masterTime(s.start,salon.utc_offset)}</button>)}</div></>:<p className="public-muted">Свободных окон пока нет. Другие даты можно проверить при записи.</p>}
    <div className="public-window-price"><strong>{money(service.price)}</strong><span>{service.duration} мин</span></div><div className="public-window-actions">{selected&&!slots.loading&&!slots.error?<Link className="button button-wine" to={book+'&start='+selected.start}>Выбрать это время<ArrowRight size={16}/></Link>:null}<Link className="button button-outline" to={book}>Или выбрать своё время<ArrowRight size={16}/></Link></div><small>Время салона · UTC+{salon.utc_offset/60}</small>
  </>:<p className="public-muted">Салон ещё готовит услуги и график.</p>}</section>;
}
