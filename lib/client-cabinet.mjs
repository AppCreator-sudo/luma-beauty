import {randomUUID} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export function migrateClientCabinet(db,{backupDir}={}) {
  const columns=db.prepare('PRAGMA table_info(notices)').all().map(row=>row.name);
  if(!columns.includes('read_at')&&backupDir){
    fs.mkdirSync(backupDir,{recursive:true,mode:0o700});
    const backup=path.join(backupDir,'before-client-cabinet-'+Date.now()+'.sqlite');
    db.prepare('VACUUM INTO ?').run(backup);
    fs.chmodSync(backup,0o600);
  }
  db.exec('BEGIN IMMEDIATE');
  try{
    if(!columns.includes('read_at'))db.exec('ALTER TABLE notices ADD COLUMN read_at INTEGER');
    if(!columns.includes('appointment_id'))db.exec('ALTER TABLE notices ADD COLUMN appointment_id TEXT');
    db.exec(`CREATE TABLE IF NOT EXISTS client_profiles(user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,name TEXT NOT NULL DEFAULT '',contact TEXT NOT NULL DEFAULT '',city TEXT NOT NULL DEFAULT '',avatar TEXT NOT NULL DEFAULT '');
      CREATE TABLE IF NOT EXISTS client_visit_details(appointment_id TEXT PRIMARY KEY REFERENCES appointments(id) ON DELETE CASCADE,comment TEXT NOT NULL DEFAULT '',service_id TEXT,city TEXT NOT NULL DEFAULT '',address TEXT NOT NULL DEFAULT '',utc_offset INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS reschedule_requests(id TEXT PRIMARY KEY,appointment_id TEXT NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,client_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,master_id TEXT NOT NULL,base_start INTEGER NOT NULL,base_end INTEGER NOT NULL,base_service TEXT NOT NULL,base_price INTEGER NOT NULL,start INTEGER NOT NULL,end INTEGER NOT NULL,comment TEXT NOT NULL DEFAULT '',status TEXT NOT NULL CHECK(status IN ('pending','accepted','declined','withdrawn','closed')),created INTEGER NOT NULL,decided INTEGER);
      CREATE UNIQUE INDEX IF NOT EXISTS one_pending_reschedule ON reschedule_requests(appointment_id) WHERE status='pending';
      CREATE INDEX IF NOT EXISTS reschedule_visit ON reschedule_requests(appointment_id,created);
      CREATE INDEX IF NOT EXISTS notices_user_read ON notices(user_id,read_at,created);`);
    if(!db.prepare('PRAGMA table_info(reschedule_requests)').all().some(row=>row.name==='utc_offset'))db.exec('ALTER TABLE reschedule_requests ADD COLUMN utc_offset INTEGER');
    db.exec('COMMIT');
  }catch(error){db.exec('ROLLBACK');throw error}
}

export function clientCabinet({app,db,requireUser,requireClient,access,schedule,notify,fail,privateUpload,privateDir,backupDir}) {
  migrateClientCabinet(db,{backupDir});
  if(privateDir){fs.mkdirSync(privateDir,{recursive:true,mode:0o700});fs.chmodSync(privateDir,0o700)}
  app.use('/api/client',(req,res,next)=>{res.set('Cache-Control','private, no-store');next()});
  const one=(sql,...args)=>db.prepare(sql).get(...args),all=(sql,...args)=>db.prepare(sql).all(...args),run=(sql,...args)=>db.prepare(sql).run(...args);
  const transaction=fn=>{db.exec('BEGIN IMMEDIATE');try{const result=fn();db.exec('COMMIT');return result}catch(error){db.exec('ROLLBACK');throw error}};
  const field=(value,max,label)=>{if(typeof value!=='string'||value.length>max)fail('Проверьте '+label);return value.trim()};
  const profile=user=>{const p=one('SELECT name,contact,city,avatar FROM client_profiles WHERE user_id=?',user)||{name:'',contact:'',city:'',avatar:''};return {...p,avatar:p.avatar?'/api/client/profile/avatar?v='+path.basename(p.avatar):''}};
  function expire(){run("UPDATE reschedule_requests SET status='closed',decided=? WHERE status='pending' AND appointment_id IN (SELECT id FROM appointments WHERE start<=? OR status NOT IN ('pending','confirmed'))",Date.now(),Date.now())}
  const pending=id=>{expire();return one("SELECT * FROM reschedule_requests WHERE appointment_id=? AND status='pending'",id)};
  function active(id,user){const a=one('SELECT * FROM appointments WHERE id=? AND client_id=?',id,user);if(!a)fail('Запись не найдена',404);if(!['pending','confirmed'].includes(a.status)||a.start<=Date.now())fail('Перенос доступен для будущей активной записи',409);return a}
  function available(a){
    const p=one('SELECT active,bookable,workspace_id FROM performers WHERE id=?',a.master_id),venue=one('SELECT workspace_id FROM booking_venues WHERE appointment_id=?',a.id);
    if(!p?.active||venue&&(!p.bookable||p.workspace_id!==venue.workspace_id)||(venue?!one('SELECT 1 FROM workspaces WHERE id=? AND published=1',venue.workspace_id):!one('SELECT 1 FROM profiles WHERE user_id=? AND published=1',a.master_id)))fail('Новая запись у этого специалиста сейчас недоступна',409);
  }
  function details(id,comment,serviceId,venue){
    const a=one('SELECT master_id FROM appointments WHERE id=?',id),p=venue||one('SELECT city,address FROM profiles WHERE user_id=?',a.master_id)||{};
    run('INSERT INTO client_visit_details VALUES(?,?,?,?,?,?)',id,comment,serviceId||null,p.city||'',p.address||'',p.utc_offset??schedule.config(a.master_id).utc_offset);
  }
  function visits(user){expire();return all(`SELECT a.id,a.master_id,a.client_id,a.client_name,a.service,a.start,a.end,a.price,a.status,a.reference_work_id,
    p.name master_name,p.slug,p.avatar master_avatar,p.published master_published,
    v.name salon_name,COALESCE(salon.slug,v.slug) salon_slug,salon.logo salon_logo,salon.published salon_published,
    COALESCE(d.city,v.city,'') city,COALESCE(d.address,v.address,'') address,COALESCE(d.utc_offset,v.utc_offset) utc_offset,d.comment client_comment,s.id service_id,
    w.image reference_image,w.caption reference_caption,r.id review_id,r.rating review_rating,r.text review_text,r.created review_created
    FROM appointments a LEFT JOIN profiles p ON p.user_id=a.master_id LEFT JOIN booking_venues v ON v.appointment_id=a.id LEFT JOIN workspaces salon ON salon.id=v.workspace_id
    LEFT JOIN client_visit_details d ON d.appointment_id=a.id LEFT JOIN services s ON s.id=d.service_id
    LEFT JOIN works w ON w.id=a.reference_work_id LEFT JOIN reviews r ON r.appointment_id=a.id WHERE a.client_id=? ORDER BY a.start`,user).map(a=>({...a,utc_offset:a.utc_offset??schedule.config(a.master_id).utc_offset,reschedule:one('SELECT id,start,end,comment,status,created,decided,utc_offset,base_start,base_end FROM reschedule_requests WHERE appointment_id=? ORDER BY created DESC,rowid DESC LIMIT 1',a.id)||null}))}
  function invalidate(id){run("UPDATE reschedule_requests SET status='closed',decided=? WHERE appointment_id=? AND status='pending'",Date.now(),id)}

  app.get('/api/client/profile',requireUser,requireClient,(req,res)=>res.json(profile(req.user.id)));
  app.put('/api/client/profile',requireUser,requireClient,(req,res)=>{
    const name=field(req.body.name,100,'имя'),city=field(req.body.city,100,'город'),contact=field(req.body.contact,100,'контакт');
    if(contact&&!/^@[a-z][a-z0-9_]{4,31}$/i.test(contact)&&!/^\+?[78][\d\s()\-]{10,20}$/.test(contact))fail('Укажите телефон России или Telegram @username');
    const normalized=contact.startsWith('@')?contact.toLowerCase():contact?'+7'+contact.replace(/\D/g,'').slice(1):'';
    if(normalized&&!normalized.startsWith('@')&&!/^\+7\d{10}$/.test(normalized))fail('Укажите телефон +7 999 123-45-67');
    run("INSERT INTO client_profiles(user_id,name,contact,city) VALUES(?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET name=excluded.name,contact=excluded.contact,city=excluded.city",req.user.id,name,normalized,city);
    res.json(profile(req.user.id));
  });
  app.get('/api/client/profile/avatar',requireUser,requireClient,(req,res)=>{
    const image=one('SELECT avatar FROM client_profiles WHERE user_id=?',req.user.id)?.avatar;
    if(!image||!/^\/uploads\/atelie-media-logo-[a-f0-9-]{36}\.webp$/.test(image))fail('Фото не найдено',404);
    res.set('Cache-Control','private, no-store').sendFile(path.resolve(privateDir,'uploads',path.basename(image)),{dotfiles:'allow'});
  });
  app.post('/api/client/profile/avatar',requireUser,requireClient,privateUpload.middleware,async(req,res)=>{
    const next=await privateUpload.save(req.file,'logo');let previous;
    try{transaction(()=>{previous=one('SELECT avatar FROM client_profiles WHERE user_id=?',req.user.id)?.avatar;run('INSERT INTO client_profiles(user_id,avatar) VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET avatar=excluded.avatar',req.user.id,next)})}
    catch(error){await privateUpload.removeOwned(next);throw error}
    await privateUpload.removeOwned(previous);res.json({image:profile(req.user.id).avatar});
  });
  app.delete('/api/client/profile/avatar',requireUser,requireClient,async(req,res)=>{const previous=one('SELECT avatar FROM client_profiles WHERE user_id=?',req.user.id)?.avatar;run("UPDATE client_profiles SET avatar='' WHERE user_id=?",req.user.id);await privateUpload.removeOwned(previous);res.json({ok:true})});
  app.get('/api/client/appointments',requireUser,requireClient,(req,res)=>res.json(visits(req.user.id)));
  app.get('/api/client/notices',requireUser,requireClient,(req,res)=>{
    let cursor;
    if(req.query.cursor){try{if(typeof req.query.cursor!=='string'||req.query.cursor.length>200)throw Error();cursor=JSON.parse(Buffer.from(req.query.cursor,'base64url').toString('utf8'));if(!Array.isArray(cursor)||cursor.length!==2||!Number.isSafeInteger(cursor[0])||typeof cursor[1]!=='string'||cursor[1].length>80)throw Error()}catch{fail('Некорректная страница уведомлений')}}
    const unreadOnly=req.query.unread==='true';
    const rows=all(`SELECT id,title,body,created,read_at,appointment_id FROM notices WHERE user_id=? ${unreadOnly?'AND read_at IS NULL':''} ${cursor?'AND (created<? OR (created=? AND id<?))':''} ORDER BY created DESC,id DESC LIMIT 51`,req.user.id,...(cursor?[cursor[0],cursor[0],cursor[1]]:[]));
    const items=rows.slice(0,50),last=items.at(-1);
    res.json({items,next:rows.length>50?Buffer.from(JSON.stringify([last.created,last.id])).toString('base64url'):null,unread:one('SELECT COUNT(*) n FROM notices WHERE user_id=? AND read_at IS NULL',req.user.id).n});
  });
  app.get('/api/client/data',requireUser,requireClient,(req,res)=>{
    res.set('Cache-Control','no-store').json({exported:new Date().toISOString(),account:one('SELECT login,account_type,created FROM users WHERE id=?',req.user.id),profile:profile(req.user.id),appointments:visits(req.user.id),notifications:all('SELECT id,title,body,created,read_at,appointment_id FROM notices WHERE user_id=? ORDER BY created',req.user.id),saved:all('SELECT work_id,created FROM saved_works WHERE user_id=?',req.user.id),masters:all('SELECT master_id,created FROM follows WHERE user_id=?',req.user.id),salons:all('SELECT salon_id,created FROM saved_salons WHERE user_id=?',req.user.id)});
  });
  app.patch('/api/notices/read',requireUser,(req,res)=>{
    if(req.body.all===true)run('UPDATE notices SET read_at=COALESCE(read_at,?) WHERE user_id=?',Date.now(),req.user.id);
    else{const id=field(req.body.id,80,'уведомление');if(!one('SELECT 1 FROM notices WHERE id=? AND user_id=?',id,req.user.id))fail('Уведомление не найдено',404);run('UPDATE notices SET read_at=COALESCE(read_at,?) WHERE id=? AND user_id=?',Date.now(),id,req.user.id)}
    res.json({ok:true});
  });
  app.get('/api/client/appointments/:id/slots',requireUser,requireClient,(req,res)=>{const a=active(req.params.id,req.user.id);available(a);res.json({utc_offset:schedule.config(a.master_id).utc_offset,availability:schedule.availability(a.master_id,Date.now(),{duration:(a.end-a.start)/60000,exclude:a.id})})});
  app.post('/api/client/appointments/:id/reschedule',requireUser,requireClient,(req,res)=>{
    const result=transaction(()=>{
      const a=active(req.params.id,req.user.id);available(a);const start=Number(req.body.start),end=start+a.end-a.start,comment=field(req.body.comment??'',1000,'комментарий');
      if(!Number.isSafeInteger(start)||start===a.start)fail('Выберите другое свободное время');
      const current=pending(a.id);
      if(current){if(current.start===start&&current.comment===comment)return {...current,duplicate:true};fail('Сначала отзовите текущий запрос переноса',409)}
      schedule.validate(a.master_id,start,end,{exclude:a.id});
      const id=randomUUID();run("INSERT INTO reschedule_requests(id,appointment_id,client_id,master_id,base_start,base_end,base_service,base_price,start,end,comment,status,created,decided,utc_offset) VALUES(?,?,?,?,?,?,?,?,?,?,?,'pending',?,NULL,?)",id,a.id,req.user.id,a.master_id,a.start,a.end,a.service,a.price,start,end,comment,Date.now(),schedule.config(a.master_id).utc_offset);return {id,appointment_id:a.id,master_id:a.master_id};
    });
    if(!result.duplicate)void notify(result.master_id,'Запрос на перенос','Клиент предлагает другое время. Откройте детали записи в календаре.',result.appointment_id);
    res.status(result.duplicate?200:201).json({id:result.id});
  });
  app.delete('/api/client/appointments/:id/reschedule',requireUser,requireClient,(req,res)=>{const a=one('SELECT * FROM appointments WHERE id=? AND client_id=?',req.params.id,req.user.id);if(!a)fail('Запись не найдена',404);run("UPDATE reschedule_requests SET status='withdrawn',decided=? WHERE appointment_id=? AND client_id=? AND status='pending'",Date.now(),a.id,req.user.id);res.json({ok:true})});
  app.get('/api/appointments/:id/reschedule',requireUser,(req,res)=>{
    const a=one('SELECT * FROM appointments WHERE id=?',req.params.id);if(!a||!access.canManage(req.user.id,a.master_id)&&a.client_id!==req.user.id)fail('Запись не найдена',404);
    res.json(pending(a.id)||null);
  });
  app.patch('/api/appointments/:id/reschedule',requireUser,(req,res)=>{
    const decision=req.body.decision;if(!['accepted','declined'].includes(decision))fail('Выберите решение');
    let a,request;
    transaction(()=>{
      a=one('SELECT * FROM appointments WHERE id=?',req.params.id);if(!a||!access.canManage(req.user.id,a.master_id))fail('Запись не найдена',404);
      request=pending(a.id);if(!request||request.id!==req.body.request_id)fail('Запрос уже обработан. Обновите запись.',409);
      if(a.master_id!==request.master_id||a.client_id!==request.client_id||a.start!==request.base_start||a.end!==request.base_end||a.service!==request.base_service||a.price!==request.base_price||!['pending','confirmed'].includes(a.status)||a.start<=Date.now())fail('Исходная запись изменилась. Клиенту нужно отправить новый запрос.',409);
      if(decision==='accepted'){
        available(a);if(request.utc_offset!=null&&schedule.config(a.master_id).utc_offset!==request.utc_offset)fail('Часовой пояс мастера изменился. Клиенту нужно отправить новый запрос.',409);schedule.validate(a.master_id,request.start,request.end,{exclude:a.id});
        run("UPDATE appointments SET start=?,end=?,status='confirmed',reminded=0 WHERE id=?",request.start,request.end,a.id);
        run('UPDATE client_visit_details SET utc_offset=? WHERE appointment_id=?',request.utc_offset??schedule.config(a.master_id).utc_offset,a.id);
      }
      run('UPDATE reschedule_requests SET status=?,decided=? WHERE id=?',decision,Date.now(),request.id);
    });
    void notify(a.client_id,decision==='accepted'?'Перенос подтверждён':'Перенос не подтверждён',decision==='accepted'?'Мастер подтвердил новое время. Подробности — в вашей записи.':'Исходное время записи остаётся действующим.',a.id);
    res.json({ok:true});
  });
  return {profile,details,visits,invalidate,expire};
}
