import {ScheduleFields,scheduleDescription,scheduleClock} from './ScheduleFields';
import {Pencil} from 'lucide-react';
import {ImageCropDialog} from './ImageCropDialog';
import {scheduleHasWork,normalizeSchedulePattern} from '../../../lib/schedule-patterns.mjs';
import {ServiceDirectionSelect} from './ServiceDirection';
import { useHistoryState } from '../lib/useHistoryState';
import { ExperienceFields } from './ExperienceFields';
import {useEffect,useId,useRef,useState,type ChangeEvent,type FormEvent} from 'react';
import {api,money,type Performer,type Schedule,type Service,type Workspace} from '../lib/api';
import {CabinetSteps} from './CabinetSteps';
import {imageUploadAccept,imageUploadHint,validateImageUpload} from '../lib/imageUpload';
import directions from '../../../lib/categories.json';
import '../salon-owner-flow.css';

const keyOf=(s:Service)=>JSON.stringify([s.name,s.price,s.duration]);

export function StaffSetupForm({workspace,team,staff,onDone}:{workspace:Pick<Workspace,'id'|'utc_offset'>;team:Performer[];staff?:Performer;onDone:(id:string)=>void}){
  const [name,setName]=useState(staff?.name||'');
  const [categories,setCategories]=useState(staff?.profile?.categories||[]);
  const [teaches,setTeaches]=useState(Boolean(staff?.profile?.teaches));
  const [experience,setExperience]=useState<number|null>(staff?.profile?.experience_months??null);
  const [experienceError,setExperienceError]=useState('');
  const [config,setConfig]=useState<Schedule>(staff?.schedule_configured?{...staff.schedule,utc_offset:workspace.utc_offset??180}:{opening:600,closing:1200,weekdays:[],utc_offset:workspace.utc_offset??180,mode:'weekly',exceptions:[]});
  const [selected,setSelected]=useState<string[]>(staff?.services.map(keyOf)||[]);
  const [visible,setVisible]=useState(staff?Boolean(staff.bookable):true);
  const [newCategory,setNewCategory]=useState('');const selectedCategory=categories.includes(newCategory)?newCategory:categories.length===1?categories[0]:'';
  const [newName,setNewName]=useState(''),[price,setPrice]=useState(''),[duration,setDuration]=useState('60');
  const [addingService,setAddingService]=useState(false),[preview,setPreview]=useState('');
  const [photo,setPhoto]=useState<File|null>(null),[step,setStep]=useHistoryState('staff-setup-step-' + workspace.id + '-' + (staff?.id || 'new'), 0, { backOnDecrease: true });
  const [pendingPhoto,setPendingPhoto]=useState<File|null>(null),[cropOpen,setCropOpen]=useHistoryState('staff-photo-editor-'+(staff?.id||workspace.id),false,{flow:true});
  const photoInput=useRef<HTMLInputElement>(null);
  const [error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false);
  const submitting=useRef(false),photoChoice=useRef(0),checkingPhoto=useRef(false);
  const [checking,setChecking]=useState(false),[imageError,setImageError]=useState('');
  const photoId=useId(),photoHelpId=photoId+'-help',photoErrorId=photoId+'-error';
  useEffect(()=>()=>{photoChoice.current++;},[]);
  useEffect(()=>()=>{if(preview)URL.revokeObjectURL(preview)},[preview]);
  const bank=[...new Map(team.flatMap(p=>p.services).map(s=>[keyOf(s),s])).values()];
  const image=preview||staff?.profile?.avatar;
  const validHours=Number.isInteger(config.opening)&&Number.isInteger(config.closing)&&config.opening>=0&&config.closing<=1440&&config.closing>config.opening;
  const validNewService=Boolean(newName.trim())&&price!==''&&Number.isInteger(Number(price))&&Number(price)>=0&&Number(price)<=1000000&&Number.isInteger(Number(duration))&&Number(duration)>=5&&Number(duration)<=720;
  async function choosePhoto(event:ChangeEvent<HTMLInputElement>){
    const chosen=event.currentTarget.files?.[0];event.currentTarget.value='';
    if(!chosen||submitting.current)return;
    const selection=++photoChoice.current;
    checkingPhoto.current=true;setChecking(true);setImageError('');
    try{
      await validateImageUpload(chosen,'avatar');
      if(selection!==photoChoice.current)return;
      setPendingPhoto(chosen);setCropOpen(true);
    }catch(reason){
      if(selection===photoChoice.current)setImageError(reason instanceof Error?reason.message:'Не удалось проверить фото. Выберите другой файл.');
    }finally{
      if(selection===photoChoice.current){checkingPhoto.current=false;setChecking(false);}
    }
  }
  function identityError(){
    if(experienceError)return experienceError;
    if(!name.trim())return 'Укажите имя мастера';
    if(checkingPhoto.current)return 'Дождитесь проверки фотографии';
    if(!photo&&!staff?.profile?.avatar)return 'Добавьте фото мастера';
    if(!categories.length)return 'Выберите хотя бы одно направление';
    return '';
  }
  function detailsError(){
    if(!scheduleHasWork(config)||!validHours)return 'Выберите рабочие дни и проверьте часы';
    try{normalizeSchedulePattern(config)}catch(reason){return reason instanceof Error?reason.message:'Проверьте график'}
    if(newName.trim()&&!selectedCategory)return 'Выберите направление новой услуги';
    if(newName.trim()&&!validNewService)return 'Проверьте цену и длительность новой услуги';
    if(visible&&!selected.length&&!validNewService)return 'Для онлайн-записи назначьте услугу';
    return '';
  }
  function advance(){
    if(submitting.current||busy||checkingPhoto.current)return;
    setError('');setNotice('');
    const problem=step===0?identityError():detailsError();
    if(problem){setError(problem);return;}
    setStep(value=>Math.min(value+1,2));
  }
  function goBack(){setError('');setNotice('');setStep(value=>Math.max(value-1,0));}
  async function save(draft=false){
    if(submitting.current||checkingPhoto.current)return;
    setError('');setNotice('');
    if(!name.trim()){setError('Укажите имя мастера');return;}
    if(experienceError){setError(experienceError);if(!staff)setStep(0);return;}
    if(!draft){
      const identityProblem=identityError(),detailsProblem=detailsError();
      if(identityProblem||detailsProblem){setError(identityProblem||detailsProblem);if(!staff)setStep(identityProblem?0:1);return;}
    }
    const payload=new FormData();
    payload.set('name',name);payload.set('categories',JSON.stringify(categories));payload.set('teaches',String(teaches));
    payload.set('experience_months',experience==null?'':String(experience));
    if(validHours)payload.set('schedule',JSON.stringify(config));
    payload.set('service_ids',JSON.stringify(bank.filter(s=>selected.includes(keyOf(s))).map(s=>s.id)));
    payload.set('visible',String(!draft&&visible));payload.set('draft',String(draft));if(photo)payload.set('image',photo);
    if(validNewService){
      payload.set('new_service',JSON.stringify({name:newName,price:Number(price),duration:Number(duration),category:selectedCategory||undefined}));
    }
    submitting.current=true;setBusy(true);
    try{
      const saved=await api<Performer>(staff?'/performers/'+staff.id+'/setup':'/salons/'+workspace.id+'/staff',{method:staff?'PUT':'POST',body:payload});
      setNotice(draft?'Черновик сохранён. Услугу и график можно завершить позже.':'Карточка и график сохранены.');onDone(saved.id);
    }catch(reason){setError(reason instanceof Error?reason.message:'Не удалось сохранить мастера');}
    finally{submitting.current=false;setBusy(false);}
  }
  function copySchedule(value:string){const source=team.find(p=>p.id===value);if(source?.schedule_configured)setConfig({...source.schedule,exceptions:source.schedule.exceptions?.map(item=>({...item})),weekdays:[...source.schedule.weekdays],utc_offset:workspace.utc_offset??180})}

  return <form className={'settings-form staff-setup-form'+(!staff?' cabinet-flow':'')} noValidate aria-busy={busy||checking} onSubmit={(event:FormEvent)=>{event.preventDefault();if(!staff&&step<2)advance();else void save();}}>
    {!staff?<CabinetSteps labels={['Фото и имя','Услуги и график','Проверка']} current={step} disabled={busy||checking}/>:null}
    <fieldset disabled={busy||checking} className="staff-setup-fields cabinet-step-panel">
      {!staff?<div><h3>{['Представьте мастера','Подготовьте запись','Всё готово к добавлению'][step]}</h3><p>{['Клиенты увидят фото, имя и направления работы.','Назначьте услуги и рабочее время мастера.','Проверьте данные. Мастер появится в команде после сохранения.'][step]}</p></div>:null}
      {staff||step===0?<>
      <div className="staff-setup-identity"><div className="staff-setup-photo"><div className="staff-setup-portrait">{image?<img src={image} alt="Предпросмотр фото мастера"/>:<span>{Array.from(name.trim())[0]||'а'}</span>}</div><div className="media-edit-tools"><button type="button" aria-label="Изменить: Фото сотрудника" onClick={()=>photoInput.current?.click()} disabled={checking||busy}><Pencil size={18}/></button><input ref={photoInput} id={photoId} aria-label="Фото сотрудника" aria-describedby={photoHelpId+(imageError?' '+photoErrorId:'')} aria-invalid={Boolean(imageError)} type="file" accept={imageUploadAccept} onChange={choosePhoto}/></div></div><div><strong>Фото мастера</strong><p>Обязательно для готовой карточки. Карандаш открывает выбор кадра.</p>{checking?<small role="status">Проверяем фото…</small>:photo?<small>Кадр выбран. Сохранится вместе с карточкой.</small>:null}<details><summary>Требования к фото</summary><small id={photoHelpId}>{imageUploadHint('avatar')}</small></details>{imageError?<p id={photoErrorId} className="form-error" role="alert">{imageError}</p>:null}</div></div>
      <label>Имя мастера<input value={name} onChange={e=>setName(e.target.value)} maxLength={80} required/></label>
      <ExperienceFields value={experience} onChange={setExperience} onValidationChange={setExperienceError}/>
      <fieldset className="direction-picker"><legend>Направления работы</legend>{directions.map(c=><label key={c}><input type="checkbox" checked={categories.includes(c)} onChange={e=>setCategories(e.target.checked?[...categories,c]:categories.filter(v=>v!==c))}/>{c}</label>)}</fieldset>
      <label className="staff-setup-check"><input type="checkbox" checked={teaches} onChange={e=>setTeaches(e.target.checked)}/>Обучает других мастеров</label>
      </>:null}
      {staff||step===1?<>
      <fieldset className="staff-setup-services"><legend>Услуги мастера</legend>{bank.length?<div className="staff-service-choices">{bank.map(s=><label key={keyOf(s)}><input type="checkbox" checked={selected.includes(keyOf(s))} onChange={e=>setSelected(e.target.checked?[...selected,keyOf(s)]:selected.filter(k=>k!==keyOf(s)))}/><span>{s.name}<small>{money(s.price)} · {s.duration} мин</small></span></label>)}</div>:<p>Добавьте первую услугу. Затем её можно назначить другим мастерам.</p>}<button type="button" className="text-link" onClick={()=>setAddingService(v=>!v)}>{addingService?'Скрыть новую услугу':'Добавить новую услугу'}</button>{addingService?<div className="staff-new-service"><ServiceDirectionSelect categories={categories} value={selectedCategory} onChange={setNewCategory} disabled={busy}/><label>Название услуги<input value={newName} onChange={e=>setNewName(e.target.value)} maxLength={120}/></label><div className="staff-setup-hours"><label>Цена, ₽<input type="number" value={price} min="0" max="1000000" onChange={e=>setPrice(e.target.value)}/></label><label>Длительность, мин<input type="number" value={duration} min="5" max="720" onChange={e=>setDuration(e.target.value)}/></label></div></div>:null}</fieldset>
      <fieldset className="staff-setup-schedule"><legend>График работы</legend>{team.some(p=>p.id!==staff?.id&&p.schedule_configured)?<label>Скопировать график<select defaultValue="" onChange={e=>copySchedule(e.target.value)}><option value="">Заполнить самостоятельно</option>{team.filter(p=>p.id!==staff?.id&&p.schedule_configured).map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>:null}<ScheduleFields value={config} onChange={setConfig} lockedOffset={workspace.utc_offset??180}/><small>Время салона · UTC+{(workspace.utc_offset??180)/60}. График применится после сохранения.</small></fieldset>
      <label className="staff-setup-check"><input type="checkbox" checked={visible} onChange={e=>setVisible(e.target.checked)}/>Показывать в салоне и разрешить онлайн-запись</label>
      </>:null}
      {!staff&&step===2?<div className="cabinet-summary"><div className="staff-setup-identity"><div className="staff-setup-portrait">{image?<img src={image} alt={'Фото '+name}/>:null}</div><div><h3>{name}</h3><p>{categories.join(' · ')}{teaches?' · Обучает':''}</p></div></div><p><strong>Услуги:</strong> {[...bank.filter(service=>selected.includes(keyOf(service))).map(service=>service.name+' · '+money(service.price)+' · '+service.duration+' мин'),...(validNewService?[newName+' · '+money(Number(price))+' · '+duration+' мин']:[])].join('; ')||'Пока не назначены'}</p><p><strong>График:</strong> {scheduleDescription(config)} · {scheduleClock(config.opening)}–{scheduleClock(config.closing)}</p><p><strong>Показ в салоне:</strong> {visible?'Включён при опубликованном салоне':'Скрыт. Можно включить позже в карточке.'}</p></div>:null}
      {error?<p className="form-error" role="alert">{error}</p>:null}{notice?<p role="status">{notice}</p>:null}
      <div className="staff-setup-actions cabinet-flow-actions">{!staff&&step>0?<button type="button" className="button button-outline" disabled={busy||checking} onClick={goBack}>Назад</button>:null}<button type="submit" className="button button-wine" disabled={busy||checking}>{busy?'Сохраняем…':staff?'Сохранить данные и график':step<2?'Далее':'Добавить мастера'}</button>{!staff||!staff.ready?<button type="button" className="button button-outline" disabled={busy||checking} onClick={()=>void save(true)}>Сохранить черновик</button>:null}</div>
      {!staff?<small>{step<2?'Данные ещё не отправлены. Черновик будет скрыт от клиентов.':'Добавление сохранит фото, карточку, услуги и график одним действием.'}</small>:null}
    </fieldset>{cropOpen&&pendingPhoto?<ImageCropDialog file={pendingPhoto} kind="avatar" onCancel={()=>{setCropOpen(false);setPendingPhoto(null)}} onSave={file=>{setPhoto(file);setPreview(URL.createObjectURL(file));setCropOpen(false);setPendingPhoto(null);return true}}/>:null}
  </form>;
}
