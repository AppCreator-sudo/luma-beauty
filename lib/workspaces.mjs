import {scheduleHasWork} from './schedule-patterns.mjs';
import {servicesWithDirections,checkedServiceDirection,saveServiceDirection,serviceCategorySQL} from './service-directions.mjs';
import { experienceMonths } from './profile-experience.mjs';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {rateLimit} from 'express-rate-limit';
import fs from 'node:fs';
import path from 'node:path';
import {createImageUpload} from './image-upload.mjs';
import {performerReadiness} from './salon-readiness.mjs';

const text=(value,max=100)=>typeof value==='string'?value.trim().slice(0,max):'';
const digest=value=>createHash('sha256').update(value).digest('hex');

export function migratePerformers(db,{backupDir}={}){
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations(name TEXT PRIMARY KEY,created INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS workspaces(id TEXT PRIMARY KEY,kind TEXT NOT NULL CHECK(kind IN ('solo','salon')),owner_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,name TEXT NOT NULL,city TEXT NOT NULL DEFAULT '',created INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS performers(id TEXT PRIMARY KEY,workspace_id TEXT REFERENCES workspaces(id),user_id TEXT REFERENCES users(id) ON DELETE SET NULL,name TEXT NOT NULL,active INTEGER NOT NULL DEFAULT 1,created INTEGER NOT NULL,UNIQUE(workspace_id,user_id));
    CREATE INDEX IF NOT EXISTS performers_account ON performers(user_id);
    CREATE INDEX IF NOT EXISTS performers_workspace ON performers(workspace_id,active);
    CREATE TABLE IF NOT EXISTS staff_invitations(token_hash TEXT PRIMARY KEY,performer_id TEXT NOT NULL REFERENCES performers(id),created_by TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,expires INTEGER NOT NULL,used_at INTEGER);`);
  if(db.prepare('SELECT 1 FROM schema_migrations WHERE name=?').get('performers-v1'))return;
  if(backupDir){
    fs.mkdirSync(backupDir,{recursive:true,mode:0o700});
    const file=path.join(backupDir,'before-performers-'+Date.now()+'-'+randomUUID()+'.sqlite');
    db.prepare('VACUUM INTO ?').run(file);
    fs.chmodSync(file,0o600);
  }
  const targets={profiles:'user_id',services:'user_id',works:'user_id',appointments:'master_id',availability_slots:'master_id',master_schedules:'master_id',follows:'master_id',reviews:'master_id'};
  const enabled=db.prepare('PRAGMA foreign_keys').get().foreign_keys;
  db.exec('PRAGMA foreign_keys=OFF; PRAGMA legacy_alter_table=ON; BEGIN IMMEDIATE');
  try{
    db.prepare(`INSERT OR IGNORE INTO performers(id,user_id,name,created) SELECT u.id,u.id,COALESCE(p.name,u.login),u.created FROM users u LEFT JOIN profiles p ON p.user_id=u.id`).run();
    db.prepare(`INSERT OR IGNORE INTO workspaces(id,kind,owner_user_id,name,city,created) SELECT 'solo:'||p.user_id,'solo',p.user_id,p.name,p.city,u.created FROM profiles p JOIN users u ON u.id=p.user_id`).run();
    db.exec("UPDATE performers SET workspace_id='solo:'||id WHERE id IN (SELECT user_id FROM profiles)");
    for(const [table,column] of Object.entries(targets)){
      const source=db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?").get(table)?.sql;
      if(!source)continue;
      let changed=false;
      const sql=source.replace(new RegExp('\\b'+column+'\\b[^,]*','i'),definition=>{
        if(/REFERENCES\s+users\s*\(id\)/i.test(definition)){changed=true;return definition.replace(/REFERENCES\s+users\s*\(id\)/i,'REFERENCES performers(id)')}
        return definition;
      });
      if(!changed)throw new Error('Unknown performer reference in '+table);
      const indexes=db.prepare("SELECT sql FROM sqlite_master WHERE type IN ('index','trigger') AND tbl_name=? AND sql IS NOT NULL").all(table);
      const temporary=table+'_performer_migration';
      db.exec(sql.replace(/^CREATE TABLE\s+(?:IF NOT EXISTS\s+)?(?:"|`|\[)?\w+(?:"|`|\])?/i,'CREATE TABLE '+temporary));
      const columns=db.prepare('PRAGMA table_info('+table+')').all().map(c=>'"'+c.name+'"').join(',');
      db.exec(`INSERT INTO ${temporary}(${columns}) SELECT ${columns} FROM ${table}; DROP TABLE ${table}; ALTER TABLE ${temporary} RENAME TO ${table};`);
      for(const index of indexes)db.exec(index.sql);
    }
    if(db.prepare('PRAGMA foreign_key_check').all().length)throw new Error('Performer migration would break existing references');
    db.prepare('INSERT INTO schema_migrations VALUES(?,?)').run('performers-v1',Date.now());
    db.exec('COMMIT');
  }catch(error){db.exec('ROLLBACK');throw error}
  finally{db.exec('PRAGMA legacy_alter_table=OFF; PRAGMA foreign_keys='+(enabled?'ON':'OFF'))}
}

export function workspaceAccess(db){
  const get=(sql,...args)=>db.prepare(sql).get(...args);
  const all=(sql,...args)=>db.prepare(sql).all(...args);
  function canManage(user,id){return Boolean(user&&get(`SELECT 1 FROM performers p LEFT JOIN workspaces w ON w.id=p.workspace_id WHERE p.id=? AND p.active=1 AND (w.owner_user_id=? OR (COALESCE(w.kind,'solo')<>'salon' AND p.user_id=?))`,id,user,user))}
  function memberships(user){return all(`SELECT DISTINCT w.*,'owner' role FROM workspaces w WHERE w.owner_user_id=? ORDER BY w.created,w.id`,user)}
  function relatedIds(id){const user=get('SELECT user_id FROM performers WHERE id=?',id)?.user_id;return user?all('SELECT id FROM performers WHERE user_id=?',user).map(p=>p.id):[id]}
  function manageableIds(user){return all(`SELECT p.id FROM performers p LEFT JOIN workspaces w ON w.id=p.workspace_id WHERE p.active=1 AND (w.owner_user_id=? OR (COALESCE(w.kind,'solo')<>'salon' AND p.user_id=?))`,user,user).map(p=>p.id)}
  function ensurePersonal(user){
    const id='solo:'+user,profile=get('SELECT name,city FROM profiles WHERE user_id=?',user),name=profile?.name||get('SELECT login FROM users WHERE id=?',user)?.login;
    db.prepare("INSERT OR IGNORE INTO workspaces(id,kind,owner_user_id,name,city,created) VALUES(?,'solo',?,?,?,?)").run(id,user,name,profile?.city||'',Date.now());
    db.prepare('INSERT OR IGNORE INTO performers(id,workspace_id,user_id,name,created) VALUES(?,?,?,?,?)').run(user,id,user,name,Date.now());
    db.prepare('UPDATE performers SET workspace_id=COALESCE(workspace_id,?) WHERE id=?').run(id,user);
  }
  function notificationUsers(id){return [...new Set(all("SELECT CASE WHEN w.kind='salon' THEN NULL ELSE p.user_id END user_id,w.owner_user_id FROM performers p LEFT JOIN workspaces w ON w.id=p.workspace_id WHERE p.id=?",id).flatMap(p=>[p.user_id,p.owner_user_id]).filter(Boolean))]}
  return {canManage,memberships,relatedIds,manageableIds,ensurePersonal,notificationUsers};
}

export function salonRoutes({app,db,requireUser,fail,schedule,access,categories,dataDir,publications}){
  const get=(sql,...args)=>db.prepare(sql).get(...args),all=(sql,...args)=>db.prepare(sql).all(...args),run=(sql,...args)=>db.prepare(sql).run(...args);
  const transaction=fn=>{db.exec('BEGIN IMMEDIATE');try{const result=fn();db.exec('COMMIT');return result}catch(error){db.exec('ROLLBACK');throw error}};
  function owner(req,id){const workspace=get("SELECT * FROM workspaces WHERE id=? AND kind='salon' AND owner_user_id=?",id,req.user.id);if(!workspace)fail('Салон не найден',404);return workspace}
  function performer(req,id,ownerOnly=false){const p=get('SELECT * FROM performers WHERE id=? AND active=1',id);if(!p||!access.canManage(req.user.id,id))fail('Сотрудник не найден',404);if(ownerOnly)owner(req,p.workspace_id);return p}
  function staffPerformer(req,id){const p=performer(req,id);if(!get("SELECT 1 FROM workspaces WHERE id=? AND kind='salon'",p.workspace_id))fail('Сотрудник не найден',404);return p}
  const media=createImageUpload({dataDir,fail});
  const staffUpload=createImageUpload({dataDir,fail,fields:9});
  app.post('/api/performers/:id/avatar',requireUser,(req,res,next)=>{staffPerformer(req,req.params.id);next()},media.middleware,async(req,res)=>{
    const before=get('SELECT avatar FROM profiles WHERE user_id=?',staffPerformer(req,req.params.id).id)?.avatar,image=await media.save(req.file,'portrait');let previous;
    try{
      const p=staffPerformer(req,req.params.id);previous=get('SELECT avatar FROM profiles WHERE user_id=?',p.id)?.avatar;
      if(previous===undefined)fail('Карточка сотрудника не найдена',404);
      if(previous!==before)fail('Фото изменилось в другом окне. Обновите страницу и повторите загрузку',409);
      const result=run('UPDATE profiles SET avatar=? WHERE user_id=? AND avatar=?',image,p.id,previous);
      if(result.changes!==1)fail('Фото изменилось в другом окне. Обновите страницу и повторите загрузку',409);
    }catch(error){await media.removeOwned(image);throw error}
    await media.removeOwned(previous);res.json({ok:true,image});
  });
  app.delete('/api/performers/:id/avatar',requireUser,async(req,res)=>{
    const p=staffPerformer(req,req.params.id),previous=get('SELECT avatar FROM profiles WHERE user_id=?',p.id)?.avatar;
    const result=run("UPDATE profiles SET avatar='' WHERE user_id=? AND avatar=?",p.id,previous);
    if(result.changes!==1)fail('Фото изменилось в другом окне. Обновите страницу и повторите удаление',409);
    run('UPDATE performers SET bookable=0 WHERE id=?',p.id);
    await media.removeOwned(previous);res.json({ok:true});
  });
  if(publications){
    app.get('/api/performers/:id/works',requireUser,(req,res)=>{
      const p=staffPerformer(req,req.params.id);res.json(publications.portfolio(p.id,req.user.id));
    });
    app.post('/api/performers/:id/works',requireUser,(req,res,next)=>{staffPerformer(req,req.params.id);next()},publications.upload,async(req,res)=>{
      const p=staffPerformer(req,req.params.id);
      res.status(201).json(await publications.createWork(req,p.id,()=>staffPerformer(req,p.id)));
    });
    app.delete('/api/performers/:id/works/:work',requireUser,async(req,res)=>{
      const p=staffPerformer(req,req.params.id);await publications.removeWork(req.params.work,p.id);res.json({ok:true});
    });
  }
  function selection(value){if(!Array.isArray(value)||!value.length||value.length>categories.length||value.some(c=>!categories.includes(c)))fail('Выберите направления из списка');return [...new Set(value)]}
  function staffDetails(p){const profile=get('SELECT * FROM profiles WHERE user_id=?',p.id);return {...p,...performerReadiness(db,p.id),profile:profile?{...profile,categories:all('SELECT category FROM profile_categories WHERE user_id=? ORDER BY rowid',p.id).map(c=>c.category)}:null,services:servicesWithDirections(db,p.id),schedule:{...schedule.config(p.id),utc_offset:get('SELECT utc_offset FROM workspaces WHERE id=?',p.workspace_id)?.utc_offset??180},schedule_configured:Boolean(get('SELECT 1 FROM master_schedules WHERE master_id=?',p.id))}}
  app.get('/api/workspaces',requireUser,(req,res)=>res.json(access.memberships(req.user.id)));
  app.post('/api/salons',requireUser,(req,res)=>{
    const name=text(req.body.name,80),city=text(req.body.city,80);
    if(!name||!city)fail('Укажите название салона и город');
    if(get("SELECT 1 FROM workspaces WHERE owner_user_id=? AND kind='salon'",req.user.id))fail('У вас уже есть кабинет салона',409);
    const id=randomUUID();run("INSERT INTO workspaces(id,kind,owner_user_id,name,city,created) VALUES(?,'salon',?,?,?,?)",id,req.user.id,name,city,Date.now());res.status(201).json({id});
  });
  app.get('/api/salons/:id',requireUser,(req,res)=>{
    const membership=access.memberships(req.user.id).find(w=>w.id===req.params.id&&w.kind==='salon');
    if(!membership)fail('Салон не найден',404);
    const rows=membership.role==='owner'?all('SELECT * FROM performers WHERE workspace_id=? AND active=1 ORDER BY created,id',membership.id):all('SELECT * FROM performers WHERE workspace_id=? AND user_id=? AND active=1',membership.id,req.user.id);
    res.json({workspace:membership,staff:rows.map(staffDetails)});
  });
  const parseField=(value,label)=>{if(typeof value!=='string')return value;try{return JSON.parse(value)}catch{fail('Проверьте '+label)}};
  async function saveStaff(req,existing){
    const workspace=owner(req,existing?.workspace_id||req.params.id),b=req.body,name=text(b.name,80);
    const draft=b.draft===true||b.draft==='true',rawCategories=parseField(b.categories,'направления');
    const selected=draft&&Array.isArray(rawCategories)&&!rawCategories.length?[]:selection(rawCategories);
    if(!name)fail('Укажите имя сотрудника');
    const previous=existing?get('SELECT avatar FROM profiles WHERE user_id=?',existing.id).avatar:'';
    const experience=experienceMonths(b.experience_months,existing?get('SELECT experience_months FROM profiles WHERE user_id=?',existing.id)?.experience_months:null);
    if(!draft&&!req.file&&!previous)fail('Добавьте фото мастера');
    const config=parseField(b.schedule,'график'),ids=parseField(b.service_ids??[], 'услуги');
    if(!Array.isArray(ids)||ids.length>100||ids.some(id=>typeof id!=='string'))fail('Выберите услуги из списка');
    if(!draft&&(!config||!Array.isArray(config.weekdays)||!scheduleHasWork(config)))fail('Выберите рабочие дни и часы');
    const offers=[...new Set(ids)].map(id=>{
      const s=get(`SELECT s.*,${serviceCategorySQL(db)} category FROM services s JOIN performers p ON p.id=s.user_id WHERE s.id=? AND p.workspace_id=? AND p.active=1`,id,workspace.id);
      if(!s)fail('Услуга салона не найдена',404);return s;
    });
    const newService=parseField(b.new_service,'новую услугу');
    if(newService){
      const {price,duration}=newService,serviceName=text(newService.name,120);
      if(!serviceName||!Number.isInteger(price)||price<0||price>1000000||!Number.isInteger(duration)||duration<5||duration>720)fail('Проверьте название, цену и длительность новой услуги');
      if(newService.category!==undefined&&(typeof newService.category!=='string'||!selected.includes(newService.category)))fail('Выберите направление новой услуги');
      offers.push({name:serviceName,price,duration,category:newService.category});
    }
    const image=req.file?await staffUpload.save(req.file,'portrait'):previous,id=existing?.id||randomUUID();
    try{transaction(()=>{
      owner(req,workspace.id);
      if(existing){performer(req,id,true);if(get('SELECT avatar FROM profiles WHERE user_id=?',id)?.avatar!==previous)fail('Фото изменено в другом окне. Обновите карточку.',409)}
      else{
        if(get('SELECT COUNT(*) n FROM performers WHERE workspace_id=? AND active=1',workspace.id).n>=100)fail('Не более 100 сотрудников');
        run('INSERT INTO performers(id,workspace_id,name,bookable,created) VALUES(?,?,?,0,?)',id,workspace.id,name,Date.now());
        run('INSERT INTO profiles(user_id,slug,name,city,category) VALUES(?,?,?,?,?)',id,'staff-'+id.replace(/-/g,''),name,workspace.city,selected[0]||'');
      }
      run('UPDATE performers SET name=? WHERE id=?',name,id);
      run('UPDATE profiles SET experience_months=? WHERE user_id=?',experience,id);
      run('UPDATE profiles SET name=?,avatar=?,category=?,teaches=? WHERE user_id=?',name,image,selected[0]||'',b.teaches===true||b.teaches==='true'?1:0,id);
      run('DELETE FROM profile_categories WHERE user_id=?',id);
      for(const category of selected)run('INSERT INTO profile_categories VALUES(?,?)',id,category);
      if(config)schedule.save(id,{...config,utc_offset:workspace.utc_offset});
      const wanted=new Map(offers.map(s=>[JSON.stringify([s.name,s.price,s.duration]),s]));
      const current=all('SELECT * FROM services WHERE user_id=?',id);
      for(const s of current)if(!wanted.has(JSON.stringify([s.name,s.price,s.duration]))){
        if(get('SELECT 1 FROM works WHERE user_id=? AND service_id=?',id,s.id))fail('Услуга «'+s.name+'» связана с работой. Сохраните её назначение.',409);
        run('DELETE FROM services WHERE id=? AND user_id=?',s.id,id);
      }
      for(const [key,s] of wanted){const same=current.find(c=>JSON.stringify([c.name,c.price,c.duration])===key);if(!same){const serviceId=randomUUID();run('INSERT INTO services VALUES(?,?,?,?,?)',serviceId,id,s.name,s.price,s.duration);saveServiceDirection(db,serviceId,checkedServiceDirection(db,id,selected.includes(s.category)?s.category:undefined,fail));}}
      const ready=performerReadiness(db,id).ready,wantedVisible=b.visible===true||b.visible==='true';
      if(!draft&&wantedVisible&&!ready)fail('Для записи добавьте услугу с ценой и длительностью');
      run('UPDATE performers SET bookable=? WHERE id=?',Number(!draft&&ready&&wantedVisible),id);
    })}catch(error){if(req.file)await staffUpload.removeOwned(image);throw error}
    if(req.file)await media.removeOwned(previous);
    return staffDetails(get('SELECT * FROM performers WHERE id=?',id));
  }
  app.post('/api/salons/:id/staff',requireUser,(req,res,next)=>{owner(req,req.params.id);next()},staffUpload.middleware,async(req,res)=>res.status(201).json(await saveStaff(req)));
  app.put('/api/performers/:id/setup',requireUser,(req,res,next)=>{performer(req,req.params.id,true);next()},staffUpload.middleware,async(req,res)=>res.json(await saveStaff(req,performer(req,req.params.id,true))));
  app.get('/api/performers/:id/calendar',requireUser,(req,res)=>{
    const p=performer(req,req.params.id);
    res.json(all(`SELECT a.*,g.contact guest_contact,p.name master_name,p.slug FROM appointments a LEFT JOIN guest_bookings g ON g.appointment_id=a.id LEFT JOIN profiles p ON p.user_id=a.master_id WHERE a.master_id=? ORDER BY a.start`,p.id));
  });
  app.patch('/api/performers/:id/visibility',requireUser,(req,res)=>{
    const p=performer(req,req.params.id,true);
    if(typeof req.body.visible!=='boolean')fail('Проверьте видимость сотрудника');
    const readiness=performerReadiness(db,p.id);
    if(req.body.visible&&!readiness.ready)fail('Сначала добавьте: '+readiness.missing.join(', '));
    run('UPDATE performers SET bookable=? WHERE id=?',Number(req.body.visible),p.id);
    res.json({ok:true,visible:req.body.visible});
  });
  app.put('/api/performers/:id/profile',requireUser,(req,res)=>{
    const p=performer(req,req.params.id,true),name=text(req.body.name,80),selected=selection(req.body.categories);
    if(!name)fail('Укажите имя сотрудника');
    if(typeof req.body.teaches!=='boolean')fail('Проверьте отметку обучения');
    const experience=experienceMonths(req.body.experience_months,get('SELECT experience_months FROM profiles WHERE user_id=?',p.id)?.experience_months);
    const bookable=req.body.bookable===undefined?p.bookable:Number(req.body.bookable===true);
    if(req.body.bookable===true&&!performerReadiness(db,p.id).ready)fail('Заполните фото, направления, график и услуги мастера');
    if(bookable&&(!get('SELECT 1 FROM services WHERE user_id=?',p.id)||!get('SELECT 1 FROM master_schedules WHERE master_id=?',p.id)))fail('Сначала добавьте услугу и сохраните график сотрудника');
    transaction(()=>{
      run('UPDATE performers SET name=?,bookable=? WHERE id=?',name,bookable,p.id);
      run('UPDATE profiles SET name=?,category=?,teaches=? WHERE user_id=?',name,selected[0],req.body.teaches?1:0,p.id);
      run('UPDATE profiles SET experience_months=? WHERE user_id=?',experience,p.id);
      run('DELETE FROM profile_categories WHERE user_id=?',p.id);
      for(const category of selected)run('INSERT INTO profile_categories VALUES(?,?)',p.id,category);
    });
    res.json({ok:true});
  });
  app.post('/api/performers/:id/services',requireUser,(req,res)=>{
    const p=performer(req,req.params.id),name=text(req.body.name,120),price=Number(req.body.price),duration=Number(req.body.duration);
    if(!name||!Number.isInteger(price)||price<0||price>1000000||!Number.isInteger(duration)||duration<5||duration>720)fail('Проверьте название, стоимость и длительность услуги');
    if(get('SELECT COUNT(*) n FROM services WHERE user_id=?',p.id).n>=100)fail('Не более 100 услуг');
    const id=randomUUID(),category=checkedServiceDirection(db,p.id,req.body.category,fail);transaction(()=>{run('INSERT INTO services VALUES(?,?,?,?,?)',id,p.id,name,price,duration);saveServiceDirection(db,id,category)});res.status(201).json({id});
  });
  app.patch('/api/performers/:id/services/:service/direction',requireUser,(req,res)=>{const p=performer(req,req.params.id);const service=get('SELECT id FROM services WHERE id=? AND user_id=?',req.params.service,p.id);if(!service)fail('Услуга не найдена',404);const category=checkedServiceDirection(db,p.id,req.body.category,fail);saveServiceDirection(db,service.id,category);res.json({ok:true,category})});
  app.delete('/api/performers/:id/services/:service',requireUser,(req,res)=>{
    const p=performer(req,req.params.id);
    if(get('SELECT 1 FROM works WHERE user_id=? AND service_id=?',p.id,req.params.service))fail('Услуга связана с работой. Сначала измените работу.',409);
    run('DELETE FROM services WHERE id=? AND user_id=?',req.params.service,p.id);res.json({ok:true});
  });
  app.put('/api/performers/:id/schedule',requireUser,(req,res)=>{const p=performer(req,req.params.id),w=owner(req,p.workspace_id);const saved=schedule.save(p.id,{...req.body,utc_offset:w.utc_offset});if(!scheduleHasWork(saved))run('UPDATE performers SET bookable=0 WHERE id=?',p.id);res.json(saved)});
  app.post('/api/performers/:id/invitations',requireUser,(req,res)=>{
    performer(req,req.params.id,true);fail('Салоном управляет владелец. Личный доступ сотрудникам не выдаётся.',410);
    const p=performer(req,req.params.id,true);if(p.user_id)fail('У сотрудника уже есть доступ',409);
    const token=randomBytes(32).toString('hex'),expires=Date.now()+7*86400000;
    transaction(()=>{run('DELETE FROM staff_invitations WHERE performer_id=?',p.id);run('INSERT INTO staff_invitations VALUES(?,?,?,?,NULL)',digest(token),p.id,req.user.id,expires)});
    res.status(201).json({path:'/v2/join#'+token,expires});
  });
  app.delete('/api/performers/:id/access',requireUser,(req,res)=>{
    const p=performer(req,req.params.id,true);
    transaction(()=>{run('UPDATE performers SET user_id=NULL WHERE id=?',p.id);run('DELETE FROM staff_invitations WHERE performer_id=?',p.id)});
    res.json({ok:true});
  });
  app.delete('/api/performers/:id/invitations',requireUser,(req,res)=>{
    const p=performer(req,req.params.id,true);run('DELETE FROM staff_invitations WHERE performer_id=? AND used_at IS NULL',p.id);res.json({ok:true});
  });
  const inviteLimit=rateLimit({windowMs:15*60000,limit:50,standardHeaders:'draft-8',legacyHeaders:false,message:{error:'Слишком много проверок приглашения. Попробуйте позже.'}});
  function invitation(value){fail('Салоном управляет владелец. Приглашения сотрудникам больше не действуют.',410)}
  app.post('/api/invitations/preview',inviteLimit,(req,res)=>{const i=invitation(req.body.token);res.json({name:i.name,salon_name:i.salon_name,expires:i.expires})});
  app.post('/api/invitations/accept',requireUser,inviteLimit,(req,res)=>{
    const result=transaction(()=>{
      const i=invitation(req.body.token);
      if(get('SELECT 1 FROM performers WHERE workspace_id=? AND user_id=?',i.workspace_id,req.user.id))fail('У этого аккаунта уже есть карточка в салоне',409);
      if(get(`SELECT 1 FROM appointments a JOIN appointments b ON a.start<b.end AND a.end>b.start JOIN performers p ON p.id=b.master_id WHERE a.master_id=? AND p.user_id=? AND a.status IN ('pending','confirmed') AND b.status IN ('pending','confirmed') AND a.end>? LIMIT 1`,i.performer_id,req.user.id,Date.now()))fail('В календарях есть пересекающиеся записи. Попросите владельца перенести их перед подключением доступа.',409);
      run('UPDATE performers SET user_id=? WHERE id=?',req.user.id,i.performer_id);
      run('UPDATE staff_invitations SET used_at=? WHERE token_hash=?',Date.now(),i.token_hash);
      return {workspace_id:i.workspace_id,performer_id:i.performer_id};
    });
    res.json(result);
  });
  return {staffDetails};
}
