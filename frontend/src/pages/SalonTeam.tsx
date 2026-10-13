import { useState } from 'react';
import { ArrowLeft, ArrowRight, Archive, CalendarDays, Plus, RotateCcw } from 'lucide-react';
import { api, json, masterDate, masterDayKey, masterTime, money, statusLabel, type Appointment, type ArchiveCheck, type Performer, type Salon, type StaffShort, type TeamDay } from '../lib/api';
import { useResource } from '../lib/useResource';
import { EmptyState, ErrorState, Loading } from '../components/Shell';

const message = (reason: unknown) => reason instanceof Error ? reason.message : 'Не удалось выполнить действие';
export type CalendarJump = { date: string; mode: 'visit' | 'break' | null; key: number };

export function TeamCalendar({ salon, initialDate, onDateChange, onOpen }: { salon: Salon; initialDate: string; onDateChange: (date: string) => void; onOpen: (id: string, jump: CalendarJump) => void }) {
  const offset = salon.workspace.utc_offset ?? 180;
  const date = initialDate || masterDayKey(Date.now(),offset);
  const resource = useResource(() => api<TeamDay>('/salons/'+salon.workspace.id+'/calendar?date='+date),[salon.workspace.id,date]);
  const [search,setSearch] = useState(''); const [pendingOnly,setPendingOnly] = useState(false);
  const day = resource.data;
  const visible = day?.staff.filter(p=>p.name.toLocaleLowerCase('ru-RU').includes(search.trim().toLocaleLowerCase('ru-RU')) && (!pendingOnly || day.appointments.some(a=>a.master_id===p.id&&a.status==='pending'))) || [];
  const active = day?.appointments.filter(a=>a.status==='pending'||a.status==='confirmed') || [];
  const pending = active.filter(a=>a.status==='pending').length;
  const breaks = active.filter(a=>a.is_break).length;
  function shift(amount: number) { onDateChange(new Date(Date.parse(date+'T00:00:00Z')+amount*86400000).toISOString().slice(0,10)); }
  function open(id: string,mode: CalendarJump['mode']) { onOpen(id,{date,mode,key:Date.now()}); }
  return <section className="studio-panel team-calendar"><div className="section-head compact"><div><span className="eyebrow">ВСЯ КОМАНДА</span><h2>День <em>салона.</em></h2></div></div>
    <div className="salon-calendar-tools"><button type="button" className="icon-link" aria-label="Предыдущий день" onClick={()=>shift(-1)}><ArrowLeft size={18}/></button><label>Дата<input type="date" value={date} onChange={e=>{if(e.target.value)onDateChange(e.target.value);}}/></label><button type="button" className="icon-link" aria-label="Следующий день" onClick={()=>shift(1)}><ArrowRight size={18}/></button><button type="button" className="button button-outline" onClick={()=>onDateChange(masterDayKey(Date.now(),offset))}>Сегодня</button><button type="button" className="button button-outline" onClick={resource.reload}>Обновить</button></div>
    <p className="muted">Время салона · UTC+{offset/60}. Нажмите на запись, чтобы открыть календарь мастера.</p>
    <div className="team-calendar-filters"><label>Найти сотрудника<input type="search" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Имя мастера" maxLength={80}/></label><label className="checkbox-line"><input type="checkbox" checked={pendingOnly} onChange={e=>setPendingOnly(e.target.checked)}/> Только с новыми заявками</label></div>
    {resource.loading ? <Loading text="Собираем календари команды…"/> : resource.error ? <ErrorState message={resource.error} retry={resource.reload}/> : <><p className="team-day-count" role="status">Визитов: {active.length-breaks} · Перерывов: {breaks} · Ожидают ответа: {pending}</p>{visible.length ? <div className="team-day-grid">{visible.map(p=>{
      const visits = day!.appointments.filter(a=>a.master_id===p.id && a.status!=='cancelled');
      return <article className="team-day-card" key={p.id}><div className="team-day-heading"><div><h3>{p.name}</h3><small className={'staff-list-visibility ' + (salon.staff.find(member => member.id === p.id)?.bookable ? 'is-visible' : 'is-hidden')}>{salon.staff.find(member => member.id === p.id)?.bookable ? 'Показ включён' : 'Скрыт от клиентов'}</small></div><button type="button" className="icon-link" aria-label={'Открыть календарь '+p.name} onClick={()=>open(p.id,null)}><CalendarDays size={18}/></button></div>{visits.length ? <div className="team-day-visits">{visits.map(a=><button type="button" className={'team-day-visit '+a.status} key={a.id} onClick={()=>open(p.id,null)}><span>{masterTime(a.start,offset)}–{masterTime(a.end,offset)}</span><strong>{a.service}</strong><small>{a.is_break ? 'Перерыв' : a.client_name+' · '+statusLabel(a.status)}</small></button>)}</div> : <p className="muted">Записей пока нет</p>}<div className="team-day-actions"><button type="button" className="text-link" onClick={()=>open(p.id,'visit')}><Plus size={15}/> Записать клиента</button><button type="button" className="text-link" onClick={()=>open(p.id,'break')}>Закрыть время</button></div></article>;
    })}</div> : <EmptyState title={pendingOnly ? 'Новых заявок нет' : 'Сотрудники не найдены'} text={salon.staff.length ? 'Измените поиск или фильтр.' : 'Добавьте первого мастера в разделе «Сотрудники».'}/>}</>}
  </section>;
}

export function StaffArchive({ staff, workspaceId, offset, onDone, onClose }: { staff: Performer; workspaceId: string; offset: number; onDone: () => void; onClose: () => void }) {
  const resource = useResource(()=>api<ArchiveCheck>('/performers/'+staff.id+'/archive-check'),[staff.id]);
  const [error,setError]=useState(''); const [busy,setBusy]=useState(false); const [approved,setApproved]=useState(false);
  async function archive() { setBusy(true);setError('');try{await json('/performers/'+staff.id+'/archive','POST',{});onDone();}catch(r){setError(message(r));resource.reload();}finally{setBusy(false);} }
  return <div className="staff-archive"><button type="button" className="back-link" onClick={onClose}><ArrowLeft size={16}/> Вернуться к сотруднику</button><h3>Архив: {staff.name}</h3><p>Услуги, график и история останутся в салоне. Личный доступ, приглашения и онлайн-запись отключатся. Позже сотрудника можно вернуть из архива.</p>
    <button type="button" className="text-link" disabled={busy||resource.loading} onClick={resource.reload}>Обновить список записей</button>
    {resource.loading ? <Loading/> : resource.error ? <ErrorState message={resource.error} retry={resource.reload}/> : resource.data ? <>{resource.data.count ? <><p className="archive-blocker" role="status">Осталось записей: {resource.data.count}. Сначала передайте их другим мастерам или отмените после согласования с клиентами.</p>{resource.data.count>resource.data.appointments.length ? <p className="muted">Показаны первые {resource.data.appointments.length}. Остальные появятся после обработки этих записей.</p> : null}<div className="archive-upcoming">{resource.data.appointments.map(a=><ResolveVisit key={a.id} appointment={a} workspaceId={workspaceId} offset={offset} onDone={resource.reload}/>)}</div></> : <p role="status">Будущих и текущих записей нет — сотрудника можно убрать из команды.</p>}
      <label className="checkbox-line"><input type="checkbox" checked={approved} onChange={e=>setApproved(e.target.checked)} disabled={busy||resource.data.count>0}/> Перевести сотрудника в архив и отключить доступ</label>{error ? <p className="form-error" role="alert">{error}</p> : null}<button type="button" className="button button-wine" disabled={busy||!approved||resource.data.count>0} onClick={archive}><Archive size={16}/>{busy?'Архивируем…':'В архив'}</button>
    </> : null}
  </div>;
}

function ResolveVisit({ appointment: a, workspaceId, offset, onDone }: { appointment: ArchiveCheck['appointments'][number]; workspaceId: string; offset: number; onDone: () => void }) {
  const [target,setTarget]=useState('');const [agreed,setAgreed]=useState(false);const [error,setError]=useState('');const [busy,setBusy]=useState(false);
  async function resolve(mode: 'transfer' | 'cancel') {
    setBusy(true);setError('');try{if(mode==='transfer')await json('/salons/'+workspaceId+'/appointments/'+a.id+'/reassign','POST',{master_id:target,from_master_id:a.master_id,client_agreed:agreed});else await json('/appointments/'+a.id,'PATCH',{status:'cancelled',from_master_id:a.master_id});onDone();}catch(r){setError(message(r));}finally{setBusy(false);}
  }
  return <article className="archive-visit"><span className={'status-pill '+a.status}>{statusLabel(a.status)}</span><h4>{a.service}</h4><p>{masterDate(a.start,offset)} · {masterTime(a.start,offset)}–{masterTime(a.end,offset)} · {money(a.price)}</p><p>{a.client_name}{a.guest_contact?' · '+a.guest_contact:''}</p>
    {!a.is_break ? <>{a.candidates.length ? <label>Другой свободный мастер<select value={target} onChange={e=>setTarget(e.target.value)} disabled={busy}><option value="">Выберите сотрудника</option>{a.candidates.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label> : <p className="muted">Нет свободного мастера с такой же услугой, ценой и длительностью. Проверьте услуги и графики команды либо согласуйте отмену.</p>}<label className="checkbox-line"><input type="checkbox" checked={agreed} onChange={e=>setAgreed(e.target.checked)} disabled={busy}/> Изменение согласовано с клиентом</label><p className="muted">При передаче время, цена и длительность сохранятся. Клиент увидит нового мастера по своей личной ссылке.</p></> : null}
    {error ? <p className="form-error" role="alert">{error}</p> : null}<div className="archive-visit-actions">{!a.is_break&&a.candidates.length ? <button type="button" className="button button-outline" disabled={busy||!target||!agreed} onClick={()=>resolve('transfer')}>Передать запись</button> : null}<button type="button" className="text-link danger" disabled={busy||(!a.is_break&&!agreed)} onClick={()=>resolve('cancel')}>{a.is_break?'Убрать перерыв':'Отменить запись'}</button></div>
  </article>;
}

export function SalonArchives({ salon, onDone }: { salon: Salon; onDone: () => void }) {
  const resource=useResource(()=>api<StaffShort[]>('/salons/'+salon.workspace.id+'/archives'),[salon.workspace.id]);
  const [selected,setSelected]=useState('');const [error,setError]=useState('');const [busy,setBusy]=useState(false);
  async function restore(id: string) {setBusy(true);setError('');try{await json('/performers/'+id+'/restore','POST',{});setSelected('');resource.reload();onDone();}catch(r){setError(message(r));}finally{setBusy(false);}}
  return <section className="studio-panel salon-archives"><div className="section-head compact"><div><span className="eyebrow">ИСТОРИЯ КОМАНДЫ</span><h2>Сотрудники <em>в архиве.</em></h2></div></div><p>История сохранена. После возвращения сотрудника личный доступ и онлайн-запись нужно включить заново.</p>{error ? <p className="form-error" role="alert">{error}</p> : null}
    {resource.loading ? <Loading/> : resource.error ? <ErrorState message={resource.error} retry={resource.reload}/> : resource.data?.length ? <div className="archived-staff-list">{resource.data.map(p=><article key={p.id}><div className="team-day-heading"><h3>{p.name}</h3><button type="button" className="button button-outline" disabled={busy} onClick={()=>restore(p.id)}><RotateCcw size={16}/>Вернуть в команду</button></div><button type="button" className="text-link" aria-expanded={selected===p.id} onClick={()=>setSelected(selected===p.id?'':p.id)}>История записей</button>{selected===p.id ? <ArchivedCalendar key={p.id} workspaceId={salon.workspace.id} staff={p} offset={salon.workspace.utc_offset??180}/> : null}</article>)}</div> : <EmptyState title="Архив пуст" text="Здесь появятся сотрудники, которых вы уберёте из команды."/>}
  </section>;
}

function ArchivedCalendar({ workspaceId,staff,offset }: { workspaceId: string; staff: StaffShort; offset: number }) {
  const [date,setDate]=useState(()=>masterDayKey(Date.now(),offset));
  const resource=useResource(()=>api<{appointments:Appointment[]}>('/salons/'+workspaceId+'/archives/'+staff.id+'/calendar?date='+date),[workspaceId,staff.id,date]);
  return <div className="archived-calendar"><label>Дата в истории<input type="date" value={date} onChange={e=>{if(e.target.value)setDate(e.target.value);}}/></label><p className="muted">Время салона · UTC+{offset/60}. История доступна только для просмотра.</p>{resource.loading ? <Loading/> : resource.error ? <ErrorState message={resource.error} retry={resource.reload}/> : resource.data?.appointments.length ? resource.data.appointments.map(a=><article className="archived-visit" key={a.id}><span>{masterTime(a.start,offset)}–{masterTime(a.end,offset)} · {statusLabel(a.status)}</span><h4>{a.service}</h4><p>{a.client_name} · {money(a.price)}</p>{a.guest_contact ? <p>{a.guest_contact}</p> : null}</article>) : <p className="muted">На эту дату записей нет.</p>}</div>;
}
