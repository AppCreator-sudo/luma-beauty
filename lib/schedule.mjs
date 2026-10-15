import {normalizeSchedulePattern,scheduleDayHours} from './schedule-patterns.mjs';
import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
const MINUTE=60000, DAY=86400000;
const CONTEXT=Symbol('availability snapshot');

// Matches workspaceAccess.relatedIds, in batches instead of two reads per
// performer. Includes all calendars for the account, including inactive ones.
export function relatedPerformersBatch(db,requested){
  const ids=[...new Set(requested)],people=new Map(),groups=new Map();
  for(let i=0;i<ids.length;i+=400){const batch=ids.slice(i,i+400);for(const p of db.prepare(`SELECT id,user_id FROM performers WHERE id IN (${batch.map(()=>'?').join(',')})`).all(...batch))people.set(p.id,p.user_id)}
  const users=[...new Set([...people.values()].filter(Boolean))];
  for(let i=0;i<users.length;i+=400){const batch=users.slice(i,i+400);for(const p of db.prepare(`SELECT id,user_id FROM performers WHERE user_id IN (${batch.map(()=>'?').join(',')})`).all(...batch)){if(!groups.has(p.user_id))groups.set(p.user_id,[]);groups.get(p.user_id).push(p.id)}}
  return new Map(ids.map(id=>[id,people.get(id)?groups.get(people.get(id))||[id]:[id]]));
}

export function schedules({db,fail,relatedMasters=master=>[master],relatedMasterGroups,cityForMaster,backupDir}) {
  db.exec(`CREATE TABLE IF NOT EXISTS master_schedules(master_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,opening INTEGER NOT NULL,closing INTEGER NOT NULL,utc_offset INTEGER NOT NULL,weekdays TEXT NOT NULL)`);
  if(!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='schedule_patterns'").get()){
    if(backupDir){fs.mkdirSync(backupDir,{recursive:true,mode:0o700});const file=path.join(backupDir,'before-schedule-patterns-'+Date.now()+'-'+randomUUID()+'.sqlite');db.prepare('VACUUM INTO ?').run(file);fs.chmodSync(file,0o600)}
    db.exec(`CREATE TABLE schedule_patterns(master_id TEXT PRIMARY KEY REFERENCES master_schedules(master_id) ON DELETE CASCADE,definition TEXT NOT NULL)`);
  }
  const get=(sql,...args)=>db.prepare(sql).get(...args);
  function configured(saved,city='') {
    if(saved){const {pattern,...row}=saved;return {...row,weekdays:JSON.parse(row.weekdays),...(pattern?JSON.parse(pattern):{mode:'weekly',exceptions:[]})}}
    city=city.toLowerCase();
    const zones=[[/калининград/,120],[/самар|саратов|ульяновск|астрахан/,240],[/екатеринбург|пермь|тюмен|уфа|челябинск|оренбург/,300],[/омск/,360],[/новосибирск|красноярск|томск|барнаул|кемеров|новокузнецк|абакан/,420],[/иркутск|улан-удэ/,480],[/якутск|чита|благовещенск/,540],[/владивосток|хабаровск/,600],[/магадан|сахалин/,660],[/камчат|анадырь/,720]];
    return {opening:600,closing:1200,utc_offset:zones.find(([re])=>re.test(city))?.[1]??180,weekdays:[0,1,2,3,4,5,6],mode:'weekly',exceptions:[]};
  }
  const city=master=>cityForMaster?cityForMaster(master):get('SELECT city FROM profiles WHERE user_id=?',master)?.city||'';
  const configSQL='SELECT s.*,p.definition pattern FROM master_schedules s LEFT JOIN schedule_patterns p ON p.master_id=s.master_id';
  function config(master) {const saved=get(configSQL+' WHERE s.master_id=?',master);return saved?configured(saved):configured(null,city(master))}
  function save(master,b) {
    const {opening,closing,utc_offset,weekdays}=b;
    if(!Number.isInteger(opening)||!Number.isInteger(closing)||opening<0||closing>1440||closing<=opening||!Number.isInteger(utc_offset)||utc_offset<120||utc_offset>720||utc_offset%60||!Array.isArray(weekdays)||weekdays.some(d=>!Number.isInteger(d)||d<0||d>6))fail('Проверьте рабочие часы, дни и часовой пояс');
    let pattern;try{pattern=normalizeSchedulePattern(b)}catch(error){fail(error.message)}
    db.exec('SAVEPOINT save_schedule');
    try{
      // Older releases cannot understand cycles or date overrides. Their fallback
      // is closed availability, never an incorrectly offered working day.
      const legacyDays=pattern.mode==='cycle'||pattern.exceptions.length?[]:[...new Set(weekdays)];
      db.prepare('INSERT INTO master_schedules VALUES(?,?,?,?,?) ON CONFLICT(master_id) DO UPDATE SET opening=excluded.opening,closing=excluded.closing,utc_offset=excluded.utc_offset,weekdays=excluded.weekdays').run(master,opening,closing,utc_offset,JSON.stringify(legacyDays));
      db.prepare('INSERT INTO schedule_patterns VALUES(?,?) ON CONFLICT(master_id) DO UPDATE SET definition=excluded.definition').run(master,JSON.stringify(pattern));
      db.exec('RELEASE save_schedule');
    }catch(error){db.exec('ROLLBACK TO save_schedule; RELEASE save_schedule');throw error}
    const saved=config(master),now=Date.now();
    const conflicts=db.prepare("SELECT start,end FROM appointments WHERE master_id=? AND status IN ('pending','confirmed') AND start>?").all(master,now).filter(visit=>{
      const local=new Date(visit.start+saved.utc_offset*MINUTE),date=local.toISOString().slice(0,10),hours=scheduleDayHours(saved,date),midnight=Date.parse(date)-saved.utc_offset*MINUTE;
      return !hours||visit.start<midnight+hours.opening*MINUTE||visit.end>midnight+hours.closing*MINUTE;
    }).length;
    return {...saved,conflicting_appointments:conflicts};
  }
  function validate(master,start,end,{hours=true,exclude='',now=Date.now()}={}) {
    if(!Number.isFinite(start)||!Number.isFinite(end)||end<=start)fail('Проверьте время записи');
    if(hours){
      const c=config(master),local=new Date(start+c.utc_offset*MINUTE);
      const midnight=Date.UTC(local.getUTCFullYear(),local.getUTCMonth(),local.getUTCDate())-c.utc_offset*MINUTE;
      const hours=scheduleDayHours(c,local.toISOString().slice(0,10));
      if(start<now||start>now+366*DAY||!hours||start<midnight+hours.opening*MINUTE||end>midnight+hours.closing*MINUTE)fail('Выберите время в рабочие часы мастера',409);
    }
    const ids=relatedMasters(master);
    if(get(`SELECT id FROM appointments WHERE master_id IN (${ids.map(()=>'?').join(',')}) AND status IN ('pending','confirmed') AND start<? AND end>? AND id<>?`,...ids,end,start,exclude))fail('Это время уже занято. Выберите другое.',409);
  }
  function availability(master,now=Date.now(),options={}) {
    const context=options[CONTEXT],c=context?.configs.get(master)||config(master),local=new Date((options.from??now)+c.utc_offset*MINUTE);
    const first=Date.UTC(local.getUTCFullYear(),local.getUTCMonth(),local.getUTCDate())-c.utc_offset*MINUTE;
    const duration=(options.duration??get('SELECT MIN(duration) duration FROM services WHERE user_id=?',master)?.duration??30)*MINUTE;
    const from=Math.max(now,options.from??now),to=Math.min(options.to??first+90*DAY,first+90*DAY);
    const ids=context?.related.get(master)||relatedMasters(master);
    const busy=context?ids.flatMap(id=>context.busy.get(id)||[]).filter(a=>a.end>from&&a.start<to).sort((a,b)=>a.start-b.start):
      db.prepare(`SELECT start,end FROM appointments WHERE master_id IN (${ids.map(()=>'?').join(',')}) AND status IN ('pending','confirmed') AND end>? AND start<? AND id<>? ORDER BY start`).all(...ids,from,to,options.exclude||'');
    const slots=[];
    for(let day=0;day<90&&first+day*DAY<to;day++){
      const midnight=first+day*DAY,hours=scheduleDayHours(c,new Date(midnight+c.utc_offset*MINUTE).toISOString().slice(0,10));
      if(!hours)continue;
      const close=midnight+hours.closing*MINUTE;
      for(let start=midnight+hours.opening*MINUTE;start+duration<=close;start+=30*MINUTE){
        if(start<=now||start<from||start>=to||busy.some(a=>a.start<start+duration&&a.end>start))continue;
        const end=Math.min(close,busy.find(a=>a.start>=start)?.start??close);
        slots.push({id:'auto:'+start,start,end});
      }
    }
    return slots;
  }
  // Request-local data only. Call within the caller's read transaction so
  // schedule, linked accounts and busy times share one authoritative snapshot.
  // Slot generation remains the same availability() implementation above.
  function prepareAvailability(requested,now=Date.now(),options={}){
    const ids=[...new Set(requested)],saved=new Map(),cities=new Map(),configs=new Map(),busy=new Map();
    for(let i=0;i<ids.length;i+=400){
      const batch=ids.slice(i,i+400),holders=batch.map(()=>'?').join(',');
      for(const c of db.prepare(configSQL+` WHERE s.master_id IN (${holders})`).all(...batch))saved.set(c.master_id,c);
      for(const p of db.prepare(`SELECT user_id,city FROM profiles WHERE user_id IN (${holders})`).all(...batch))cities.set(p.user_id,p.city);
    }
    for(const id of ids)configs.set(id,configured(saved.get(id),cities.get(id)||city(id)));
    const related=relatedMasterGroups?relatedMasterGroups(ids):new Map(ids.map(id=>[id,relatedMasters(id)]));
    const calendars=[...new Set([...related.values()].flat())],from=Math.max(now,options.from??now),to=options.to??now+90*DAY;
    for(let i=0;i<calendars.length;i+=400){
      const batch=calendars.slice(i,i+400);
      for(const a of db.prepare(`SELECT master_id,start,end FROM appointments WHERE master_id IN (${batch.map(()=>'?').join(',')})
        AND status IN ('pending','confirmed') AND end>? AND start<? ORDER BY start`).all(...batch,from,to)){
        if(!busy.has(a.master_id))busy.set(a.master_id,[]);busy.get(a.master_id).push({start:a.start,end:a.end});
      }
    }
    const context={configs,related,busy};
    return {config:id=>configs.get(id)||config(id),availability:(id,callNow=now,callOptions={})=>availability(id,callNow,{...options,...callOptions,[CONTEXT]:context})};
  }
  return {config,save,validate,availability,prepareAvailability};
}
