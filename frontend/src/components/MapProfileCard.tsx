import {useEffect,useRef,useState} from 'react';
import {Link} from 'react-router-dom';
import {ArrowRight,MapPin,X} from 'lucide-react';
import {api,bookingPath,masterDate,masterDayKey,masterTime,servicePriceLabel,profilePath} from '../lib/api';
import {mapIdentity,type MapDetails,type MapMaster} from '../lib/map';
import {currentPromotion,usePromotionClock} from '../lib/promotions';
import {MapRating} from './MapRating';
import {PromotionBadge} from './PromotionBadge';
import {ProfileBadges} from './ProfileBadges';
import {useHistoryState} from '../lib/useHistoryState';

function slotLabel(start:number,offset:number){
  return (masterDayKey(start,offset)===masterDayKey(Date.now(),offset)?'Сегодня':masterDate(start,offset,{day:'numeric',month:'short'}))+', '+masterTime(start,offset);
}

export function MapProfileCard({profile,category,soon,onClose,onLayout}:{profile:MapMaster;category:string;soon:boolean;onClose:()=>void;onLayout:(element:HTMLElement)=>void}){
  const id=mapIdentity(profile),scope=id+':'+category;
  const [reload,setReload]=useState(0);
  const [choice,setChoice]=useHistoryState('map-card-service',{scope:'',service:''});
  const serviceId=choice.scope===scope?choice.service:'';
  const requestKey=scope+':'+serviceId+':'+soon+':'+reload;
  const remembered=useRef({scope:'',service:''});
  const [result,setResult]=useState<{key:string;scope:string;data:MapDetails|null;loading:boolean;error:string}>({key:'',scope:'',data:null,loading:true,error:''});
  const element=useRef<HTMLElement>(null),layout=useRef(onLayout);layout.current=onLayout;
  useEffect(()=>{
    const request=new AbortController();
    setResult(previous=>({key:requestKey,scope,data:previous.scope===scope?previous.data:null,loading:true,error:''}));
    const service=serviceId||(remembered.current.scope===scope?remembered.current.service:'');
    api<MapDetails>('/map/details?'+new URLSearchParams({kind:profile.kind||'master',id:profile.user_id,category,service,soon:String(soon)}),{signal:request.signal})
      .then(data=>{if(!request.signal.aborted){remembered.current={scope,service:data.selected_service||''};setResult({key:requestKey,scope,data,loading:false,error:''})}})
      .catch(reason=>{if(!request.signal.aborted)setResult(previous=>({key:requestKey,scope,data:previous.scope===scope?previous.data:null,loading:false,error:reason instanceof Error?reason.message:'Не удалось загрузить карточку'}))});
    return ()=>request.abort();
  },[requestKey,scope,serviceId,category,soon,profile.kind,profile.user_id]);
  useEffect(()=>{
    const refresh=()=>{if(!document.hidden)setReload(value=>value+1)};
    const timer=setInterval(refresh,60000);
    window.addEventListener('focus',refresh);document.addEventListener('visibilitychange',refresh);
    return ()=>{clearInterval(timer);window.removeEventListener('focus',refresh);document.removeEventListener('visibilitychange',refresh)};
  },[id]);
  useEffect(()=>{
    if(!element.current)return;
    const card=element.current,observer=new ResizeObserver(()=>layout.current(card));observer.observe(card);return ()=>observer.disconnect();
  },[id]);
  useEffect(()=>{
    const close=(event:KeyboardEvent)=>{if(event.key==='Escape'&&!document.querySelector('dialog[open]'))onClose()};
    document.addEventListener('keydown',close);return ()=>document.removeEventListener('keydown',close);
  },[onClose]);
  const loading=result.key!==requestKey||result.loading;
  const details=!loading&&!result.error?result.data:null;
  const catalog=result.scope===scope?result.data:null;
  useEffect(()=>{
    const start=details?.availability?.start;if(!start)return;
    const timer=setTimeout(()=>setReload(value=>value+1),Math.min(Math.max(20,start-Date.now()+20),2147483647));return ()=>clearTimeout(timer);
  },[details]);
  const shown=details?.profile||profile,now=usePromotionClock([shown]),current=currentPromotion(shown,now);
  const slot=details?.availability&&details.availability.start>now?details.availability:null;
  const selected=catalog?.services.find(service=>service.id===(serviceId||catalog.selected_service));
  const params=new URLSearchParams();
  if(selected)params.set('service',selected.id);
  if(slot){params.set('start',String(slot.start));if(slot.performer)params.set('master',slot.performer.id)}
  else if(current.kind==='salon'&&selected?.master_ids.length===1)params.set('master',selected.master_ids[0]);
  const book=bookingPath(current)+(params.size?'?'+params:'');
  function retry(){remembered.current={scope:'',service:''};setChoice({scope,service:''});setReload(value=>value+1)}
  return <article ref={element} className={'map-selected-card'+(current.promotion?' map-selected-card-promoted':'')} aria-label="Карточка выбранного мастера или салона" aria-busy={loading}>
    {current.promotion&&details?.cover?<img className="map-card-cover" src={details.cover} alt={'Работа: '+current.name}/>:null}
    <div className="map-card-body">
      <button type="button" className="map-card-close" onClick={onClose} aria-label="Закрыть карточку"><X size={18}/></button>
      <div className="map-card-identity">{current.avatar?<img className="map-card-avatar" src={current.avatar} alt=""/>:<span className="map-card-avatar map-avatar-fallback" aria-hidden="true">{current.name.slice(0,1)}</span>}<div><h2>{current.name}</h2><MapRating rating={current.rating} review_count={current.review_count}/></div></div>
      <ProfileBadges salon={current.kind==='salon'} teaches={current.teaches} models={current.looking_models}/>
      <PromotionBadge promotion={current.promotion}/>
      <p className="map-card-category">{(current.categories||[current.category]).join(' · ')}</p>
      <p className="map-card-address"><MapPin size={15}/><span>{[current.city,current.address].filter(Boolean).join(', ')}</span></p>
      {catalog?.services.length?<label className="map-service-picker">Услуга<select value={selected?.id||''} onChange={event=>setChoice({scope,service:event.target.value})}>{catalog.services.map(service=><option key={service.id} value={service.id}>{service.title}</option>)}</select></label>:null}
      {result.error?<div className="map-card-error" role="alert"><p>{result.error}</p><button className="text-link" type="button" onClick={retry}>Обновить услуги</button></div>:loading?<p className="map-card-loading" role="status">Ищем ближайшее время…</p>:slot?<>
        <div className="map-card-slot"><span>Ближайшая запись</span><strong>{slotLabel(slot.start,slot.utc_offset)}</strong></div>
        <div className="map-card-price"><span>{slot.service.duration} мин{slot.performer?' · '+slot.performer.name:''}</span><strong>{servicePriceLabel(slot.service.price)}</strong></div>
      </>:<p className="map-card-loading">{current.is_demo?'Пример страницы · запись недоступна':!catalog?.services.length?category?'Нет услуг в выбранном направлении':'Услуги пока не добавлены':soon?'У этой услуги нет времени в ближайший час. Выберите другую услугу или измените фильтр.':'У этой услуги нет свободного времени в ближайшие 7 дней'}</p>}
      {!slot&&selected&&!loading&&!result.error?<div className="map-card-price"><span>{selected.duration} мин</span><strong>{servicePriceLabel(selected.price)}</strong></div>:null}
      {!current.is_demo&&!loading&&!result.error&&details&&selected?<Link className="button button-wine map-card-book" to={book}>{slot?'Записаться':'Посмотреть расписание'}<ArrowRight size={17}/></Link>:null}
      <Link className="map-card-profile text-link" to={profilePath(current)}>Страница {current.kind==='salon'?'салона':'мастера'} <ArrowRight size={13}/></Link>
    </div>
  </article>;
}
