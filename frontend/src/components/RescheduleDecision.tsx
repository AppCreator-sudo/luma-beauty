import {useRef,useState} from 'react';
import {api,json,masterDate,masterTime,type Appointment} from '../lib/api';
import type {Reschedule} from '../lib/client';
import {useResource} from '../lib/useResource';
import '../client-cabinet.css';

export function RescheduleDecision({visit,reload,onAccepted}:{visit:Appointment;reload:()=>Promise<unknown>;onAccepted?:(start:number,offset:number)=>void}) {
  const resource=useResource(()=>api<Reschedule|null>('/appointments/'+visit.id+'/reschedule'),[visit.id,visit.start,visit.end,visit.status]);
  const [busy,setBusy]=useState(false),[error,setError]=useState('');const sending=useRef(false),request=resource.data;
  async function decide(decision:'accepted'|'declined'){if(sending.current||!request)return;sending.current=true;setBusy(true);setError('');try{await json('/appointments/'+visit.id+'/reschedule','PATCH',{request_id:request.id,decision});resource.setData(null);await reload();if(decision==='accepted')onAccepted?.(request.start,request.utc_offset??visit.utc_offset??180)}catch(reason){setError(reason instanceof Error?reason.message:'Не удалось обработать запрос');await resource.reload()}finally{sending.current=false;setBusy(false)}}
  if(resource.error)return <section className="reschedule-decision"><p className="form-error" role="alert">Не удалось проверить запрос переноса.</p><button className="button button-outline" onClick={()=>void resource.reload()}>Повторить</button></section>;
  if(!request)return null;
  return <section className="reschedule-decision"><h3>Запрос на перенос</h3><div className="client-pending-pair"><div><small>Сейчас</small><strong>{masterDate(visit.start,visit.utc_offset,{day:'numeric',month:'long'})}<br/>{masterTime(visit.start,visit.utc_offset)}</strong></div><div><small>Запрошено</small><strong>{masterDate(request.start,request.utc_offset??visit.utc_offset,{day:'numeric',month:'long'})}<br/>{masterTime(request.start,request.utc_offset??visit.utc_offset)}</strong></div></div>{request.comment?<p className="client-review-text">Комментарий клиента: {request.comment}</p>:null}<div className="client-notice">При принятии свободное окно проверяется повторно. Если оно занято, исходная запись сохраняется.</div>{error?<p className="form-error" role="alert">{error}</p>:null}<div className="client-actions"><button className="button button-outline" disabled={busy} onClick={()=>void decide('declined')}>Отклонить</button><button className="button button-wine" disabled={busy} onClick={()=>void decide('accepted')}>{busy?'Сохраняем…':'Принять перенос'}</button></div></section>;
}
