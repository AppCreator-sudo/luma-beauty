import {useState} from 'react';
import {json,type Service} from '../lib/api';
import '../service-direction.css';

export function ServiceDirectionSelect({categories,value,onChange,disabled=false}:{categories:string[];value:string;onChange:(value:string)=>void;disabled?:boolean}){
  return <label className="service-direction-field">Направление<select value={value} onChange={event=>onChange(event.target.value)} disabled={disabled||!categories.length} required={categories.length>0}><option value="">{categories.length?'Выберите направление':'Сначала выберите направления мастера'}</option>{categories.map(category=><option key={category} value={category}>{category}</option>)}</select></label>;
}

export function ServiceDirectionEditor({service,categories,endpoint,onDone}:{service:Service;categories:string[];endpoint:string;onDone:()=>unknown}){
  const initial=categories.includes(service.category||'')?service.category||'':'';
  const [value,setValue]=useState(initial),[busy,setBusy]=useState(false),[error,setError]=useState('');
  async function save(category:string){
    if(!category||busy)return;setValue(category);setBusy(true);setError('');
    try{await json(endpoint+'/'+encodeURIComponent(service.id)+'/direction','PATCH',{category});await onDone()}
    catch(reason){setValue(initial);setError(reason instanceof Error?reason.message:'Не удалось сохранить направление')}
    finally{setBusy(false)}
  }
  return <div className="service-direction-editor"><ServiceDirectionSelect categories={categories} value={value} onChange={category=>void save(category)} disabled={busy}/>{!initial&&!busy?<small>Уточните направление для фильтров карты.</small>:null}{busy?<small role="status">Сохраняем…</small>:null}{error?<small role="alert" className="form-error">{error}</small>:null}</div>;
}
