import {activeService} from './service-offers.mjs';
import {createHash,randomUUID} from 'node:crypto';
import {rateLimit} from 'express-rate-limit';

export function guestBookings({app,db,requireUser,requireClient,notify,fail,validateBooking,resolveSalonBooking,bookingOffset=()=>180,recordClientVisit=()=>{},clientComment=a=>a.notes}) {
  const one=(sql,...args)=>db.prepare(sql).get(...args);
  const run=(sql,...args)=>db.prepare(sql).run(...args);
  const hash=value=>createHash('sha256').update(value).digest('hex');
  const text=(value,max)=>typeof value==='string'?value.trim().slice(0,max):'';
  db.exec(`CREATE TABLE IF NOT EXISTS guest_bookings(
    appointment_id TEXT PRIMARY KEY REFERENCES appointments(id) ON DELETE CASCADE,
    token_hash TEXT UNIQUE NOT NULL, contact TEXT NOT NULL, contact_hash TEXT NOT NULL,
    request_hash TEXT NOT NULL, created INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS guest_contact_created ON guest_bookings(contact_hash,created);`);

  function contact(value) {
    const raw=text(value,100);
    if(/^@[a-z][a-z0-9_]{4,31}$/i.test(raw))return '@'+raw.slice(1).toLowerCase();
    if(!/^[+\d\s()\-]+$/.test(raw))fail('Укажите телефон России или Telegram в формате @username');
    let digits=raw.replace(/\D/g,'');
    if(digits.length===10)digits='7'+digits;
    if(!/^[78]\d{10}$/.test(digits))fail('Укажите телефон в формате +7 999 123-45-67 или Telegram @username');
    return '+7'+digits.slice(1);
  }
  function key(value) {
    if(typeof value!=='string'||! /^[a-f0-9]{64}$/.test(value))fail('Личная ссылка не найдена или недействительна',404);
    return hash(value);
  }
  function accessible(value) {
    const a=one(`SELECT a.*,g.contact,g.created guest_created,p.name master_name,p.slug,COALESCE(v.city,p.city) city,COALESCE(v.address,p.address) address,v.name salon_name,COALESCE(salon.slug,v.slug) salon_slug,v.utc_offset,
      w.image reference_image,w.caption reference_caption
      FROM guest_bookings g JOIN appointments a ON a.id=g.appointment_id
      LEFT JOIN profiles p ON p.user_id=a.master_id LEFT JOIN works w ON w.id=a.reference_work_id LEFT JOIN booking_venues v ON v.appointment_id=a.id LEFT JOIN workspaces salon ON salon.id=v.workspace_id
      WHERE g.token_hash=?`,key(value));
    if(!a||a.client_id||Date.now()>a.end+90*86400000)fail('Личная ссылка недействительна. Если вы сохранили запись в аккаунт, откройте «Моё».',404);
    return a;
  }
  const transaction=fn=>{
    db.exec('BEGIN IMMEDIATE');
    try{const result=fn();db.exec('COMMIT');return result}catch(error){db.exec('ROLLBACK');throw error}
  };
  const createLimit=rateLimit({windowMs:3600000,limit:10,standardHeaders:'draft-8',legacyHeaders:false,message:{error:'Слишком много заявок с этого устройства. Попробуйте позже.'}});
  const accessLimit=rateLimit({windowMs:15*60000,limit:100,standardHeaders:'draft-8',legacyHeaders:false,message:{error:'Слишком много запросов. Попробуйте немного позже.'}});
  app.post('/api/guest-appointments',createLimit,(req,res)=>{
    const b=req.body;
    if(text(b.website,200))fail('Не удалось отправить заявку');
    const tokenHash=key(b.access_key),master=text(b.master_id,80),serviceId=text(b.service_id,80),slotId=text(b.availability_slot_id,80);
    const name=text(b.client_name,100),notes=text(b.notes,1000),referenceId=text(b.reference_work_id,80)||null;
    const value=contact(b.contact),contactHash=hash(value),start=Number(b.start);
    if(!name)fail('Укажите ваше имя');
    if(!Number.isSafeInteger(start))fail('Проверьте дату записи');
    const salonSlug=text(b.salon_slug,40),salonServiceId=text(b.salon_service_id,64);
    const requestHash=hash(JSON.stringify({master,serviceId,name,notes,referenceId,value,start,slotId,...(salonSlug?{salonSlug,salonServiceId,...(b.offer_service_id?{offerId:b.offer_service_id,expected_price:b.expected_price,expected_duration:b.expected_duration}:{})}:{})}));
    const existing=one(`SELECT g.request_hash,a.id,a.status,a.client_id,a.end FROM guest_bookings g JOIN appointments a ON a.id=g.appointment_id WHERE g.token_hash=?`,tokenHash);
    if(existing){
      if(existing.request_hash!==requestHash)fail('Этот запрос уже отправлен. Откройте его по личной ссылке.',409);
      if(existing.client_id||Date.now()>existing.end+90*86400000)fail('Запись уже сохранена в аккаунте или ссылка истекла.',409);
      return res.json({id:existing.id,status:existing.status,manage_path:'/v2/visit#'+b.access_key});
    }
    if(start<Date.now()||start>Date.now()+366*86400000)fail('Выберите будущее время в пределах года');
    const id=randomUUID();
    const assigned=transaction(()=>{
      let selectedMaster=master,service,venue;
      if(salonSlug){
        if(referenceId)fail('Выберите услугу салона без референса');
        const resolved=resolveSalonBooking({...b,salon_slug:salonSlug,salon_service_id:salonServiceId});selectedMaster=resolved.master;service=resolved.service;venue=resolved.venue;
      }else{
        const p=one('SELECT * FROM profiles WHERE user_id=? AND published=1',master);
        if(!p)fail('Мастер не найден',404);
        if(p.is_demo)fail('Это демонстрационная страница. Запись недоступна.');
        service=activeService(db,serviceId,master);if(!service)fail('Выберите услугу');
        if(referenceId&&!one('SELECT id FROM works WHERE id=? AND user_id=?',referenceId,master))fail('Работа-референс не найдена');
      }
      const end=start+service.duration*60000;
      validateBooking(selectedMaster,start,end);
      const requests=one(`SELECT COUNT(*) n FROM guest_bookings g JOIN appointments a ON a.id=g.appointment_id
        LEFT JOIN booking_venues v ON v.appointment_id=a.id
        WHERE g.contact_hash=? AND ${venue?'v.workspace_id=?':'a.master_id=?'} AND g.created>?`,contactHash,venue?.id||selectedMaster,Date.now()-86400000).n;
      if(requests>=3)fail(`У ${venue?'этого салона':'этого мастера'} уже есть ваши заявки. Дождитесь ответа или откройте существующую запись.`,429);
      if(one(`SELECT 1 FROM guest_bookings g JOIN appointments a ON a.id=g.appointment_id
        LEFT JOIN booking_venues v ON v.appointment_id=a.id
        WHERE g.contact_hash=? AND ${venue?'v.workspace_id=?':'a.master_id=?'} AND a.start=? AND a.status IN ('pending','confirmed')`,contactHash,venue?.id||selectedMaster,start))fail('Заявка на это время уже отправлена. Откройте её по сохранённой личной ссылке.',409);
      run(`INSERT INTO appointments(id,master_id,client_name,service,start,end,price,status,notes,reference_work_id)
        VALUES(?,?,?,?,?,?,?,'pending',?,?)`,id,selectedMaster,name,service.name,start,end,service.price,notes,referenceId);
      recordClientVisit(id,notes,service.id,venue);
      run('INSERT INTO guest_bookings VALUES(?,?,?,?,?,?)',id,tokenHash,value,contactHash,requestHash,Date.now());
      if(venue)run('INSERT INTO booking_venues VALUES(?,?,?,?,?,?,?)',id,venue.id,venue.slug,venue.name,venue.city,venue.address,venue.utc_offset);
      return selectedMaster;
    });
    void notify(assigned,'Новая гостевая заявка','Клиент оставил заявку без аккаунта. Контакт для связи — в календаре.');
    res.status(201).json({id,status:'pending',manage_path:'/v2/visit#'+b.access_key});
  });
  // The capability is sent in a POST body, never in an API URL or server access log.
  app.post('/api/guest-appointments/access',accessLimit,(req,res)=>{
    const a=accessible(req.body.access_key);
    res.json({id:a.id,client_name:a.client_name,contact:a.contact,service:a.service,start:a.start,end:a.end,price:a.price,
      status:a.status,notes:clientComment(a),master_name:a.master_name,slug:a.slug,city:a.city,address:a.address,
      salon_name:a.salon_name,salon_slug:a.salon_slug,utc_offset:a.utc_offset??bookingOffset(a.master_id),
      reference_image:a.reference_image,reference_caption:a.reference_caption});
  });
  app.post('/api/guest-appointments/cancel',accessLimit,(req,res)=>{
    const a=accessible(req.body.access_key);
    if(a.status==='cancelled')return res.json({ok:true});
    if(!['pending','confirmed'].includes(a.status))fail('Завершённый визит нельзя отменить');
    run("UPDATE appointments SET status='cancelled',reminded=0 WHERE id=?",a.id);
    void notify(a.master_id,'Запись отменена','Клиент отменил гостевую запись. Подробности — в календаре.');
    res.json({ok:true});
  });
  app.post('/api/guest-appointments/claim',requireUser,requireClient,accessLimit,(req,res)=>{
    const id=transaction(()=>{
      const own=one('SELECT a.id FROM guest_bookings g JOIN appointments a ON a.id=g.appointment_id WHERE g.token_hash=? AND a.client_id=?',key(req.body.access_key),req.user.id);if(own)return own.id;
      const a=accessible(req.body.access_key);
      run('UPDATE appointments SET client_id=? WHERE id=? AND client_id IS NULL',req.user.id,a.id);
      return a.id;
    });
    res.json({id});
  });
}
