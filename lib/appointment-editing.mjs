// All appointment changes share one transaction, permission check and collision check.
export function appointmentEditing({app,db,requireUser,access,schedule,notify,fail,invalidateRequests=()=>{}}) {
  const one=(sql,...args)=>db.prepare(sql).get(...args);
  const fields=['start','duration','client_name','service','service_id','price','notes'];
  function text(value,max,label){if(typeof value!=='string'||value.length>max)fail('Проверьте '+label);return value.trim()}
  app.patch('/api/appointments/:id',requireUser,(req,res)=>{
    const b=req.body,editing=fields.some(field=>b[field]!==undefined);
    let target,managed;
    db.exec('BEGIN IMMEDIATE');
    try {
      const current=one('SELECT * FROM appointments WHERE id=?',req.params.id);
      managed=current&&access.canManage(req.user.id,current.master_id);
      if(!current||(!managed&&current.client_id!==req.user.id))fail('Запись не найдена',404);
      if(b.from_master_id!==undefined&&b.from_master_id!==current.master_id)fail('Мастер уже изменился. Обновите список записей.',409);
      if(!managed&&(editing||b.status!=='cancelled'))fail('Изменить запись может мастер',403);
      if(!managed&&(!['pending','confirmed'].includes(current.status)||current.end<=Date.now()))fail('Отменить можно только активную незавершённую запись',409);
      if(editing&&!['pending','confirmed'].includes(current.status))fail('Изменить можно только активную запись',409);
      if(b.expected&&['start','end','status','client_name','service','price','notes'].some(field=>b.expected[field]!==current[field]))fail('Запись изменена в другом окне. Обновите календарь.',409);
      const status=b.status??current.status;
      if(!['pending','confirmed','cancelled','done'].includes(status))fail('Некорректный статус');
      const start=b.start===undefined?current.start:Number(b.start);
      if(!Number.isFinite(start)||start<Date.now()-366*86400000||start>Date.now()+366*86400000)fail('Проверьте дату');
      let service=current.service,price=current.price,duration=(current.end-current.start)/60000;
      if(b.service_id!==undefined&&typeof b.service_id!=='string')fail('Выберите действующую услугу');
      if(b.service_id){const selected=one('SELECT * FROM services WHERE id=? AND user_id=?',b.service_id,current.master_id);if(!selected)fail('Выберите действующую услугу');service=selected.name;price=selected.price;duration=selected.duration}
      if(b.service!==undefined){service=text(b.service,120,'название услуги');if(!service)fail('Укажите услугу')}
      if(b.price!==undefined){price=Number(b.price);if(!Number.isInteger(price)||price<0||price>1000000)fail('Проверьте цену')}
      if(b.duration!==undefined){duration=Number(b.duration);if(!Number.isInteger(duration)||duration<5||duration>720)fail('Длительность должна быть от 5 до 720 минут')}
      const client=b.client_name===undefined?current.client_name:text(b.client_name,100,'имя клиента');if(!client)fail('Укажите имя клиента');
      const notes=b.notes===undefined?current.notes:text(b.notes,1000,'заметки');
      const end=start+duration*60000;
      if(status==='pending'||status==='confirmed')schedule.validate(current.master_id,start,end,{hours:false,exclude:current.id});
      db.prepare('UPDATE appointments SET client_name=?,service=?,start=?,end=?,price=?,status=?,notes=?,reminded=0 WHERE id=?').run(client,service,start,end,price,status,notes,current.id);
      if(start!==current.start||end!==current.end||service!==current.service||price!==current.price||['cancelled','done'].includes(status))invalidateRequests(current.id);
      target=managed?current.client_id:current.master_id;
      db.exec('COMMIT');
    }catch(error){db.exec('ROLLBACK');throw error}
    if(target)void notify(target,'Запись обновлена',managed?'Подробности изменений — в вашей записи.':'Клиент отменил запись. Подробности — в календаре.',req.params.id);
    res.json({ok:true});
  });
}
