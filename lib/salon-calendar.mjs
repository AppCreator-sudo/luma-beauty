const DAY=86400000;
const normalized=value=>String(value).toLocaleLowerCase('ru-RU').replace(/\s+/g,' ').trim();
const isBreak=a=>a.service==='Время закрыто'&&a.client_name==='Перерыв'&&!a.client_id&&!a.guest_contact&&a.price===0;

export function salonCalendar({app,db,requireUser,fail,schedule,notify}){
  const get=(sql,...args)=>db.prepare(sql).get(...args),all=(sql,...args)=>db.prepare(sql).all(...args),run=(sql,...args)=>db.prepare(sql).run(...args);
  const transaction=fn=>{db.exec('BEGIN IMMEDIATE');try{const value=fn();db.exec('COMMIT');return value}catch(error){db.exec('ROLLBACK');throw error}};
  function owner(user,id){const w=get("SELECT * FROM workspaces WHERE id=? AND kind='salon' AND owner_user_id=?",id,user);if(!w)fail('Салон не найден',404);return w}
  function staff(user,id){const p=get('SELECT * FROM performers WHERE id=?',id);if(!p)fail('Сотрудник не найден',404);owner(user,p.workspace_id);return p}
  function dayRange(date,offset){
    if(typeof date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(date))fail('Выберите дату');
    const instant=Date.parse(date+'T00:00:00Z');
    if(!Number.isFinite(instant)||new Date(instant).toISOString().slice(0,10)!==date)fail('Проверьте дату');
    return {from:instant-offset*60000,to:instant-offset*60000+DAY};
  }
  const columns='a.id,a.master_id,a.client_id,a.client_name,a.service,a.start,a.end,a.price,a.status,a.notes,g.contact guest_contact';
  function futureCount(id){return get("SELECT COUNT(*) n FROM appointments WHERE master_id=? AND status IN ('pending','confirmed') AND end>?",id,Date.now()).n}
  function matches(a,id){return all('SELECT name,price,duration FROM services WHERE user_id=?',id).some(s=>normalized(s.name)===normalized(a.service)&&s.price===a.price&&s.duration*60000===a.end-a.start)}
  function candidate(a,p){
    if(p.id===a.master_id||isBreak(a)||!matches(a,p.id))return false;
    try{schedule.validate(p.id,a.start,a.end,{exclude:a.id});return true}catch(error){if(error.status===409)return false;throw error}
  }
  app.get('/api/salons/:id/calendar',requireUser,(req,res)=>{
    const w=owner(req.user.id,req.params.id),range=dayRange(req.query.date,w.utc_offset);
    const people=all('SELECT id,name FROM performers WHERE workspace_id=? AND active=1 ORDER BY created,id',w.id);
    const visits=all(`SELECT ${columns} FROM appointments a JOIN performers p ON p.id=a.master_id LEFT JOIN guest_bookings g ON g.appointment_id=a.id WHERE p.workspace_id=? AND p.active=1 AND a.start<? AND a.end>? ORDER BY a.start,a.id`,w.id,range.to,range.from);
    res.json({date:req.query.date,utc_offset:w.utc_offset,staff:people,appointments:visits.map(a=>({...a,is_break:isBreak(a)}))});
  });
  app.get('/api/performers/:id/archive-check',requireUser,(req,res)=>{
    const p=staff(req.user.id,req.params.id);
    const people=all('SELECT id,name FROM performers WHERE workspace_id=? AND active=1 AND id<>? ORDER BY created,id',p.workspace_id,p.id);
    const visits=all(`SELECT ${columns} FROM appointments a LEFT JOIN guest_bookings g ON g.appointment_id=a.id WHERE a.master_id=? AND a.status IN ('pending','confirmed') AND a.end>? ORDER BY a.start,a.id LIMIT 100`,p.id,Date.now());
    res.json({count:futureCount(p.id),appointments:visits.map(a=>({...a,is_break:isBreak(a),candidates:people.filter(person=>candidate(a,person))})),active:Boolean(p.active)});
  });
  app.post('/api/performers/:id/archive',requireUser,(req,res)=>{
    transaction(()=>{
      const p=staff(req.user.id,req.params.id);if(!p.active)return;
      if(futureCount(p.id))fail('Сначала передайте или отмените все будущие и текущие записи сотрудника.',409);
      run('UPDATE performers SET active=0,bookable=0,user_id=NULL WHERE id=?',p.id);
      run('UPDATE profiles SET published=0 WHERE user_id=?',p.id);
      run('DELETE FROM staff_invitations WHERE performer_id=?',p.id);
    });res.json({ok:true});
  });
  app.get('/api/salons/:id/archives',requireUser,(req,res)=>{
    const w=owner(req.user.id,req.params.id);res.json(all('SELECT id,name FROM performers WHERE workspace_id=? AND active=0 ORDER BY name,id',w.id));
  });
  app.get('/api/salons/:id/archives/:staff/calendar',requireUser,(req,res)=>{
    const w=owner(req.user.id,req.params.id),p=staff(req.user.id,req.params.staff);if(p.workspace_id!==w.id||p.active)fail('Архивный сотрудник не найден',404);
    const range=dayRange(req.query.date,w.utc_offset);
    res.json({utc_offset:w.utc_offset,appointments:all(`SELECT ${columns} FROM appointments a LEFT JOIN guest_bookings g ON g.appointment_id=a.id WHERE a.master_id=? AND a.start<? AND a.end>? ORDER BY a.start,a.id`,p.id,range.to,range.from)});
  });
  app.post('/api/performers/:id/restore',requireUser,(req,res)=>{
    transaction(()=>{const p=staff(req.user.id,req.params.id);if(p.active)return;
      if(get('SELECT COUNT(*) n FROM performers WHERE workspace_id=? AND active=1',p.workspace_id).n>=100)fail('Не более 100 действующих сотрудников');
      run('UPDATE performers SET active=1,bookable=0 WHERE id=?',p.id);
    });res.json({ok:true});
  });
  app.post('/api/salons/:id/appointments/:appointment/reassign',requireUser,(req,res)=>{
    if(req.body.client_agreed!==true)fail('Сначала согласуйте смену мастера с клиентом');
    const result=transaction(()=>{
      const w=owner(req.user.id,req.params.id),a=get(`SELECT ${columns} FROM appointments a LEFT JOIN guest_bookings g ON g.appointment_id=a.id JOIN performers p ON p.id=a.master_id WHERE a.id=? AND p.workspace_id=? AND p.active=1`,req.params.appointment,w.id);
      if(!a)fail('Запись не найдена',404);
      if(!['pending','confirmed'].includes(a.status)||a.start<=Date.now())fail('Передать можно только предстоящую запись',409);
      if(req.body.from_master_id!==a.master_id)fail('Мастер уже изменился. Обновите список записей.',409);
      const target=get('SELECT id,name FROM performers WHERE id=? AND workspace_id=? AND active=1',typeof req.body.master_id==='string'?req.body.master_id:'',w.id);
      if(!target||target.id===a.master_id)fail('Выберите другого сотрудника салона',404);
      if(isBreak(a))fail('Перерыв нельзя передать другому мастеру');
      if(!matches(a,target.id))fail('У этого сотрудника нет услуги с такой же ценой и длительностью',409);
      schedule.validate(target.id,a.start,a.end,{exclude:a.id});
      run('UPDATE appointments SET master_id=?,reminded=0 WHERE id=?',target.id,a.id);
      return {master:target.id,client:a.client_id};
    });
    void notify(result.master,'Запись передана вам','Владелец согласовал смену мастера с клиентом. Подробности — в календаре.');
    if(result.client)void notify(result.client,'Мастер изменён','Время и стоимость визита сохранены. Откройте запись, чтобы посмотреть мастера.');
    res.json({ok:true});
  });
}
