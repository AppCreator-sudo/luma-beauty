import {randomUUID} from 'node:crypto';
import {rateLimit} from 'express-rate-limit';
import fs from 'node:fs';
import path from 'node:path';
import {parseAddress} from './geocoding.mjs';
import {createImageUpload} from './image-upload.mjs';
import {salonServiceKey} from './salon-service-key.mjs';

const text=(v,max=100)=>typeof v==='string'?v.trim().slice(0,max):'';
const DAY=86400000;

export function migrateSalonVisual(db,{backupDir}={}){
  if(db.prepare('SELECT 1 FROM schema_migrations WHERE name=?').get('salon-visual-v1'))return;
  if(backupDir){
    fs.mkdirSync(backupDir,{recursive:true,mode:0o700});fs.chmodSync(backupDir,0o700);
    const file=path.join(backupDir,'before-salon-visual-'+Date.now()+'-'+randomUUID()+'.sqlite');
    db.prepare('VACUUM INTO ?').run(file);fs.chmodSync(file,0o600);
  }
  db.exec('BEGIN IMMEDIATE');
  try{
    db.exec("ALTER TABLE workspaces ADD COLUMN logo TEXT NOT NULL DEFAULT ''; ALTER TABLE workspaces ADD COLUMN cover TEXT NOT NULL DEFAULT '';");
    db.prepare('INSERT INTO schema_migrations VALUES(?,?)').run('salon-visual-v1',Date.now());db.exec('COMMIT');
  }catch(error){db.exec('ROLLBACK');throw error}
}

export function salonPublic({app,db,requireUser,fail,schedule,geocode,addresses,backupDir,dataDir,publications,content}){
  const get=(sql,...args)=>db.prepare(sql).get(...args),all=(sql,...args)=>db.prepare(sql).all(...args),run=(sql,...args)=>db.prepare(sql).run(...args);
  if(!get('SELECT 1 FROM schema_migrations WHERE name=?','salon-public-v1')){
    if(backupDir){fs.mkdirSync(backupDir,{recursive:true,mode:0o700});const file=path.join(backupDir,'before-salon-public-'+Date.now()+'-'+randomUUID()+'.sqlite');db.prepare('VACUUM INTO ?').run(file);fs.chmodSync(file,0o600)}
    db.exec('BEGIN IMMEDIATE');
    try{
      for(const definition of ["slug TEXT","bio TEXT NOT NULL DEFAULT ''","address TEXT NOT NULL DEFAULT ''","latitude REAL","longitude REAL","published INTEGER NOT NULL DEFAULT 0","utc_offset INTEGER NOT NULL DEFAULT 180"]){db.exec('ALTER TABLE workspaces ADD COLUMN '+definition)}
      db.exec(`CREATE UNIQUE INDEX workspaces_slug ON workspaces(slug);
        ALTER TABLE performers ADD COLUMN bookable INTEGER NOT NULL DEFAULT 0;
        CREATE TABLE booking_venues(appointment_id TEXT PRIMARY KEY REFERENCES appointments(id) ON DELETE CASCADE,workspace_id TEXT REFERENCES workspaces(id) ON DELETE SET NULL,slug TEXT NOT NULL,name TEXT NOT NULL,city TEXT NOT NULL,address TEXT NOT NULL,utc_offset INTEGER NOT NULL);`);
      run('INSERT INTO schema_migrations VALUES(?,?)','salon-public-v1',Date.now());db.exec('COMMIT');
    }catch(error){db.exec('ROLLBACK');throw error}
  }
  migrateSalonVisual(db,{backupDir});
  const media=createImageUpload({dataDir,fail});
  function owner(req,id){const w=get("SELECT * FROM workspaces WHERE id=? AND kind='salon' AND owner_user_id=?",id,req.user.id);if(!w)fail('Салон не найден',404);return w}
  function workspace(slug,viewer){const w=get("SELECT * FROM workspaces WHERE slug=? AND kind='salon' AND owner_user_id IS NOT NULL",slug);if(!w||(!w.published&&w.owner_user_id!==viewer))fail('Страница салона не найдена',404);return w}
  function staff(id){return all(`SELECT p.id,p.name,pr.avatar,pr.teaches,pr.experience_months FROM performers p JOIN profiles pr ON pr.user_id=p.id WHERE p.workspace_id=? AND p.active=1 AND p.bookable=1 AND pr.is_demo=0 ORDER BY p.created,p.id`,id).map(p=>({...p,categories:all('SELECT category FROM profile_categories WHERE user_id=? ORDER BY rowid',p.id).map(c=>c.category)}))}
  function groups(id,category=''){
    const result=new Map();
    for(const offer of all(`SELECT s.* FROM services s JOIN performers p ON p.id=s.user_id JOIN profiles pr ON pr.user_id=p.id WHERE p.workspace_id=? AND p.active=1 AND p.bookable=1 AND pr.is_demo=0 AND (?='' OR EXISTS(SELECT 1 FROM profile_categories pc WHERE pc.user_id=p.id AND pc.category=?)) ORDER BY s.name,s.id`,id,category,category)){
      const key=salonServiceKey(offer);
      if(!result.has(key))result.set(key,{id:key,name:offer.name,price:offer.price,duration:offer.duration,offers:[]});
      result.get(key).offers.push({master_id:offer.user_id,service_id:offer.id});
    }
    return [...result.values()];
  }
  function salonPortfolio(w,viewer='',limit=100){
    return all(`SELECT work.id,work.image,work.caption,work.created,work.service_id,work.pinned,work.position,
      person.id performer_id,person.name master_name,s.name service_name,s.price service_price,s.duration service_duration,
      EXISTS(SELECT 1 FROM saved_works saved WHERE saved.user_id=? AND saved.work_id=work.id) saved
      FROM works work JOIN performers person ON person.id=work.user_id JOIN profiles profile ON profile.user_id=person.id
      LEFT JOIN services s ON s.id=work.service_id AND s.user_id=person.id
      WHERE person.workspace_id=? AND person.active=1 AND person.bookable=1 AND profile.is_demo=0
      ORDER BY work.pinned DESC,work.position DESC,work.created DESC,work.id DESC LIMIT ?`,viewer,w.id,limit)
      .map(work=>({...((publications?.hydrate||((value)=>value))(work)),salon_id:w.id,salon_slug:w.slug,salon_name:w.name,
        salon_service_id:work.service_name?salonServiceKey({name:work.service_name,price:work.service_price,duration:work.service_duration}):null}));
  }
  function publicData(w,viewer='',includeWorks=true){const people=staff(w.id),services=groups(w.id);return {id:w.id,slug:w.slug,name:w.name,city:w.city,bio:w.bio,address:w.address,latitude:w.latitude,longitude:w.longitude,logo:w.logo,cover:w.cover,utc_offset:w.utc_offset,published:w.published,staff:people,works:includeWorks?salonPortfolio(w,viewer):[],posts:includeWorks?(content?.posts(w.id)||[]):[],services:services.map(({offers,...s})=>({...s,master_ids:[...new Set(offers.map(o=>o.master_id))]}))}}
  function catalog(w,nextAvailable=null,selectedCategory=''){const p=publicData(w,'',false),categories=[...new Set(p.staff.flatMap(s=>s.categories))];const rating=get('SELECT ROUND(AVG(r.rating),1) rating,COUNT(*) count FROM reviews r JOIN performers person ON person.id=r.master_id WHERE person.workspace_id=?',w.id);return {kind:'salon',user_id:w.id,slug:w.slug,name:w.name,city:w.city,bio:w.bio,address:w.address,latitude:w.latitude,longitude:w.longitude,avatar:w.logo,logo:w.logo,cover:w.cover,category:categories[0]||'',categories,staff:p.staff,rating:rating.rating||null,review_count:rating.count,teaches:Number(p.staff.some(s=>s.teaches)),published:1,services:groups(w.id,selectedCategory).map(({offers,...s})=>({...s,user_id:w.id,master_ids:[...new Set(offers.map(o=>o.master_id))]})),works:salonPortfolio(w,'',1),schedule:{utc_offset:w.utc_offset},next_available:nextAvailable}}
  for(const kind of ['logo','cover']){
    const route='/api/salons/:id/'+kind,authorize=(req,res,next)=>{owner(req,req.params.id);next()};
    app.post(route,requireUser,authorize,media.middleware,async(req,res)=>{
      const before=owner(req,req.params.id)[kind],image=await media.save(req.file,kind);let previous;
      try{
        const w=owner(req,req.params.id);previous=w[kind];
        if(previous!==before)fail('Фото изменилось в другом окне. Обновите страницу и повторите загрузку',409);
        run('UPDATE workspaces SET '+kind+'=? WHERE id=?',image,w.id);
      }catch(error){await media.removeOwned(image);throw error}
      await media.removeOwned(previous);res.json({ok:true,image});
    });
    app.delete(route,requireUser,async(req,res)=>{
      const w=owner(req,req.params.id);run('UPDATE workspaces SET '+kind+"='' WHERE id=?",w.id);
      await media.removeOwned(w[kind]);res.json({ok:true});
    });
  }
  function availability(w,service,masterId='',options={}){
    const slots=new Map(),now=Date.now();
    for(const offer of service.offers){
      if(masterId&&offer.master_id!==masterId)continue;
      for(const slot of schedule.availability(offer.master_id,now,{to:now+90*DAY,...options,duration:options.duration??service.duration}))if(!slots.has(slot.start))slots.set(slot.start,{id:'salon:'+slot.start,start:slot.start,end:slot.start+(options.duration??service.duration)*60000});
    }
    return [...slots.values()].sort((a,b)=>a.start-b.start);
  }
  app.put('/api/salons/:id/address',requireUser,(req,res,next)=>addresses.saveLimit(req,res,next),async(req,res)=>{
    const w=owner(req,req.params.id),oldState=addresses.snapshot(w),input=req.body;
    const b={city:text(input.city,80),address:text(input.address,200),latitude:input.latitude??null,longitude:input.longitude??null,city_selection:input.city_selection,address_selection:input.address_selection,address_mode:'on-save'};
    if(!b.address)fail('Проверьте адрес: укажите улицу и номер дома');
    const result=await addresses.prepareSave(req,b,w,{recheck:true});
    if(addresses.snapshot(owner(req,req.params.id))!==oldState)fail('Адрес изменился в другом окне. Обновите страницу и повторите сохранение',409);
    const lat=b.latitude==null?null:Number(b.latitude),lng=b.longitude==null?null:Number(b.longitude);
    if(lat===null||lng===null)fail('Проверьте адрес: не удалось найти точный дом на карте');
    if((lat===null)!==(lng===null)||lat!==null&&(!Number.isFinite(lat)||Math.abs(lat)>90||!Number.isFinite(lng)||Math.abs(lng)>180))fail('Выберите точку адреса');
    addresses.assertSaved(req,b,w);
    db.exec('BEGIN IMMEDIATE');try{
      run('UPDATE workspaces SET city=?,address=?,latitude=?,longitude=? WHERE id=?',b.city,b.address,lat,lng,w.id);
      run('UPDATE profiles SET city=? WHERE user_id IN (SELECT id FROM performers WHERE workspace_id=?)',b.city,w.id);
      db.exec('COMMIT');
    }catch(error){db.exec('ROLLBACK');throw error}
    res.json({ok:true,address_result:result||addresses.savedResult(b)});
  });
  app.put('/api/salons/:id/page',requireUser,(req,res,next)=>addresses?addresses.saveLimit(req,res,next):next(),async(req,res)=>{
    const w=owner(req,req.params.id),b=req.body,name=text(b.name,80),slug=text(b.slug,40).toLowerCase(),offset=Number(b.utc_offset);let city=text(b.city,80),address=text(b.address,200);
    if(!name||!city&&b.address_mode!=='preserve')fail('Укажите название салона и город');
    if(!/^[a-z0-9][a-z0-9-]{2,39}$/.test(slug))fail('Адрес страницы: 3–40 латинских букв, цифр и дефисов');
    if(get('SELECT 1 FROM profiles WHERE slug=?',slug)||get('SELECT 1 FROM workspaces WHERE slug=? AND id<>?',slug,w.id))fail('Этот адрес страницы уже занят');
    if(typeof b.published!=='boolean'||!Number.isInteger(offset)||offset<120||offset>720||offset%60)fail('Проверьте видимость и часовой пояс');
    const addressResult=await addresses?.prepareSave(req,b,w);city=text(b.city,80);address=text(b.address,200);
    if(JSON.stringify(owner(req,req.params.id))!==JSON.stringify(w))fail('Настройки изменились в другом окне. Обновите страницу и повторите сохранение',409);
    if(get('SELECT 1 FROM profiles WHERE slug=?',slug)||get('SELECT 1 FROM workspaces WHERE slug=? AND id<>?',slug,w.id))fail('Этот адрес страницы уже занят');
    const lat=b.latitude==null?null:Number(b.latitude),lng=b.longitude==null?null:Number(b.longitude);
    if((lat===null)!==(lng===null)||lat!==null&&(!Number.isFinite(lat)||Math.abs(lat)>90||!Number.isFinite(lng)||Math.abs(lng)>180))fail('Выберите точку адреса');
    addresses?.assertSaved(req,b,w);
    if(address&&(!parseAddress(address)||lat===null&&!['on-save','preserve'].includes(b.address_mode)))fail('Укажите улицу и дом, найдите точный адрес на карте');
    if(b.published&&(!address||lat===null&&!['on-save','preserve'].includes(b.address_mode)))fail('Для публикации выберите точный адрес салона');
    if(b.published&&(!groups(w.id).length||(!w.published&&!staff(w.id).some(p=>performerReadiness(db,p.id).ready))))fail('Добавьте фото, направления, услугу и график хотя бы одному мастеру и включите его показ');
    db.exec('BEGIN IMMEDIATE');try{
      run('UPDATE workspaces SET name=?,city=?,slug=?,bio=?,address=?,latitude=?,longitude=?,published=?,utc_offset=? WHERE id=?',name,city,slug,text(b.bio,1500),address,address?lat:null,address?lng:null,Number(b.published),offset,w.id);
      run('UPDATE profiles SET city=? WHERE user_id IN (SELECT id FROM performers WHERE workspace_id=?)',city,w.id);
      run('UPDATE master_schedules SET utc_offset=? WHERE master_id IN (SELECT id FROM performers WHERE workspace_id=?)',offset,w.id);db.exec('COMMIT');
    }catch(error){db.exec('ROLLBACK');throw error}
    res.json({ok:true,...(addressResult?{address_result:addressResult}:{})});
  });
  const geoLimit=rateLimit({windowMs:15*60000,limit:10,standardHeaders:'draft-8',legacyHeaders:false,message:{error:'Слишком много поисков адреса. Попробуйте позже.'}});
  app.get('/api/salons/:id/geocode',requireUser,geoLimit,async(req,res)=>{
    owner(req,req.params.id);const city=text(req.query.city,80),address=text(req.query.address,200);
    if(city.length<2||!parseAddress(address))fail('Укажите город, улицу и номер дома без квартиры');
    try{res.json({results:await geocode(city,address)})}catch{fail('Поиск адреса временно недоступен. Попробуйте позже.',502)}
  });
  app.get('/api/public/salons/:slug',(req,res)=>res.json(publicData(workspace(req.params.slug,req.user?.id),req.user?.id)));
  const slotsLimit=rateLimit({windowMs:60000,limit:60,standardHeaders:'draft-8',legacyHeaders:false,message:{error:'Слишком много поисков времени. Подождите минуту.'}});
  app.get('/api/public/salons/:slug/availability',slotsLimit,(req,res)=>{
    const w=workspace(req.params.slug),service=groups(w.id).find(s=>s.id===req.query.service),masterId=text(req.query.master,80);
    if(!service)fail('Выберите услугу',404);if(masterId&&!service.offers.some(o=>o.master_id===masterId))fail('Этот мастер не оказывает выбранную услугу',404);
    res.json({slots:availability(w,service,masterId),utc_offset:w.utc_offset});
  });
  function resolveBooking(b){
    const w=workspace(text(b.salon_slug,40)),service=groups(w.id).find(s=>s.id===b.salon_service_id),chosen=text(b.master_id,80),start=Number(b.start);
    if(!service)fail('Услуга салона больше недоступна',404);
    const offers=service.offers.filter(o=>!chosen||o.master_id===chosen);
    if(!offers.length)fail('Этот мастер не оказывает выбранную услугу',404);
    const ranked=offers.map(o=>({...o,load:get("SELECT COUNT(*) n FROM appointments WHERE master_id=? AND status IN ('pending','confirmed') AND end>?",o.master_id,Date.now()).n})).sort((a,b)=>a.load-b.load||a.master_id.localeCompare(b.master_id));
    for(const offer of ranked){try{schedule.validate(offer.master_id,start,start+service.duration*60000)}catch(error){if(error.status===409)continue;throw error}
      return {master:offer.master_id,service:{...service,id:offer.service_id},venue:w};
    }
    fail('Это время уже занято. Выберите другое.',409);
  }
  return {catalog,groups,availability,resolveBooking,workspace,publicData};
}
import {performerReadiness} from './salon-readiness.mjs';
