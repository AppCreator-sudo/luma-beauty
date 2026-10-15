import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {clientCabinet,migrateClientCabinet} from '../lib/client-cabinet.mjs';
import {schedules} from '../lib/schedule.mjs';

function fixture(){
  const db=new DatabaseSync(':memory:');
  db.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE users(id TEXT PRIMARY KEY,login TEXT,account_type TEXT,created INTEGER);INSERT INTO users VALUES('master','m','master',1),('client','c','client',2),('other','o','client',3);
    CREATE TABLE profiles(user_id TEXT PRIMARY KEY,name TEXT,slug TEXT,avatar TEXT,city TEXT,address TEXT,published INTEGER);INSERT INTO profiles VALUES('master','Мастер','master','','Новосибирск','Громова, 21',1);
    CREATE TABLE performers(id TEXT PRIMARY KEY,active INTEGER,bookable INTEGER,workspace_id TEXT);INSERT INTO performers VALUES('master',1,1,NULL);
    CREATE TABLE services(id TEXT PRIMARY KEY,user_id TEXT,name TEXT,duration INTEGER);INSERT INTO services VALUES('svc','master','Маникюр',60);
    CREATE TABLE workspaces(id TEXT PRIMARY KEY,slug TEXT,logo TEXT,published INTEGER);
    CREATE TABLE appointments(id TEXT PRIMARY KEY,master_id TEXT,client_id TEXT,client_name TEXT,service TEXT,start INTEGER,end INTEGER,price INTEGER,status TEXT,reference_work_id TEXT,notes TEXT,reminded INTEGER);
    CREATE TABLE booking_venues(appointment_id TEXT,workspace_id TEXT,name TEXT,slug TEXT,city TEXT,address TEXT,utc_offset INTEGER);
    CREATE TABLE notices(id TEXT PRIMARY KEY,user_id TEXT,title TEXT,body TEXT,created INTEGER);INSERT INTO notices VALUES('own','client','Ответ','Ответ мастера',1),('foreign','other','Чужое','Чужой текст',2);
    CREATE TABLE works(id TEXT,image TEXT,caption TEXT);CREATE TABLE reviews(id TEXT,appointment_id TEXT,rating INTEGER,text TEXT,created INTEGER);
    CREATE TABLE saved_works(user_id TEXT,work_id TEXT,created INTEGER);CREATE TABLE follows(user_id TEXT,master_id TEXT,created INTEGER);CREATE TABLE saved_salons(user_id TEXT,salon_id TEXT,created INTEGER);`);
  const fail=(message,status=400)=>{throw Object.assign(Error(message),{status})},routes=new Map(),notifyEvents=[];
  const app={use(){},...Object.fromEntries(['get','post','put','patch','delete'].map(method=>[method,(url,...handlers)=>routes.set(method+' '+url,handlers.at(-1))]))};
  const schedule=schedules({db,fail});schedule.save('master',{opening:600,closing:1200,utc_offset:420,weekdays:[0,1,2,3,4,5,6]});
  const tomorrow=new Date(Date.now()+86400000+420*60000);const start=Date.UTC(tomorrow.getUTCFullYear(),tomorrow.getUTCMonth(),tomorrow.getUTCDate(),4)-0; // 11:00 UTC+7
  db.prepare('INSERT INTO appointments VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run('visit','master','client','Анна','Маникюр',start,start+3600000,2100,'pending',null,'Рабочая заметка',1);
  const control=clientCabinet({app,db,requireUser(){},requireClient(){},access:{canManage:(user,master)=>user==='manager'&&master==='master'},schedule,notify:async(...args)=>notifyEvents.push(args),fail,privateUpload:{middleware(){}}});
  const call=(method,url,{user='client',id='visit',body={}}={})=>{let result;routes.get(method+' '+url)({user:{id:user},params:{id},body},{json(value){result=value;return this},status(){return this},set(){return this}});return result};
  return {db,start,schedule,control,call,events:notifyEvents,read:()=>({...db.prepare('SELECT * FROM appointments WHERE id=?').get('visit')})};
}

test('rescheduling preserves original until acceptance, checks owners, stale requests and concurrent occupied time',()=>{
  const f=fixture(),{call,start,read,db}=f,before=read(),route='/api/client/appointments/:id/reschedule',decision='/api/appointments/:id/reschedule';
  assert.throws(()=>call('post',route,{user:'other',body:{start:start+7200000}}),{status:404});
  const first=call('post',route,{body:{start:start+7200000,comment:'После обеда'}});assert.deepEqual(read(),before);
  assert.equal(call('post',route,{body:{start:start+7200000,comment:'После обеда'}}).id,first.id,'Retry must reuse request');
  assert.throws(()=>call('post',route,{body:{start:start+10800000}}),{status:409});
  assert.throws(()=>call('patch',decision,{body:{request_id:first.id,decision:'accepted'}}),{status:404});
  db.prepare('INSERT INTO appointments VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run('collision','master',null,'Другая','Услуга',start+7200000,start+10800000,1200,'confirmed',null,'',0);
  assert.throws(()=>call('patch',decision,{user:'manager',body:{request_id:first.id,decision:'accepted'}}),{status:409});assert.deepEqual(read(),before);
  assert.equal(db.prepare('SELECT status FROM reschedule_requests WHERE id=?').get(first.id).status,'pending');
  db.prepare('DELETE FROM appointments WHERE id=?').run('collision');
  call('patch',decision,{user:'manager',body:{request_id:first.id,decision:'accepted'}});const accepted=read();assert.equal(accepted.start,start+7200000);assert.equal(accepted.status,'confirmed');assert.equal(accepted.price,before.price);assert.equal(accepted.service,before.service);assert.equal(accepted.notes,before.notes);assert.equal(accepted.reminded,0);
  assert.throws(()=>call('patch',decision,{user:'manager',body:{request_id:first.id,decision:'accepted'}}),{status:409});
  const second=call('post',route,{body:{start:start+14400000}});call('patch',decision,{user:'manager',body:{request_id:second.id,decision:'declined'}});assert.deepEqual(read(),accepted);
  call('post',route,{body:{start:start+14400000}});call('delete',route);assert.deepEqual(read(),accepted);assert.equal(call('get',decision),null);
  const stale=call('post',route,{body:{start:start+14400000}});db.prepare('UPDATE appointments SET price=? WHERE id=?').run(2200,'visit');assert.throws(()=>call('patch',decision,{user:'manager',body:{request_id:stale.id,decision:'accepted'}}),{status:409});f.control.invalidate('visit');assert.equal(call('get',decision),null);
  assert.ok(f.events.some(event=>event[0]==='client'&&event[3]==='visit'));db.close();
});

test('private client projection and read markers never expose professional notes or other clients',()=>{
  const {db,control,call}=fixture();migrateClientCabinet(db); // Safe repeated startup.
  let visits=control.visits('client');assert.equal(visits.length,1);assert.equal(visits[0].address,'');assert.ok(!Object.hasOwn(visits[0],'notes'));assert.deepEqual(control.visits('other'),[]);
  control.details('visit','Нюд','svc');visits=control.visits('client');assert.equal(visits[0].client_comment,'Нюд');assert.equal(visits[0].address,'Громова, 21');
  assert.throws(()=>call('patch','/api/notices/read',{body:{id:'foreign'}}),{status:404});
  call('patch','/api/notices/read',{body:{all:true}});assert.ok(db.prepare('SELECT read_at FROM notices WHERE id=?').get('own').read_at);assert.equal(db.prepare('SELECT read_at FROM notices WHERE id=?').get('foreign').read_at,null);
  call('put','/api/client/profile',{body:{name:'Анна',contact:'@Anna_Beauty',city:'Новосибирск'}});assert.equal(control.profile('client').contact,'@anna_beauty');assert.equal(control.profile('other').name,'');
  const data=call('get','/api/client/data');assert.equal(data.appointments.length,1);assert.ok(!JSON.stringify(data).includes('Рабочая заметка'));assert.equal(data.notifications.length,1);db.close();
});
test('date overrides and cycles are rechecked when accepting a requested move',()=>{
  const f=fixture(),{call,start,read,db,schedule}=f,before=read(),date=new Date(start+420*60000).toISOString().slice(0,10);
  const cycle={opening:600,closing:1200,utc_offset:420,weekdays:[],mode:'cycle',cycle_start:date,work_days:2,rest_days:2,exceptions:[]};
  schedule.save('master',cycle);
  const request=call('post','/api/client/appointments/:id/reschedule',{body:{start:start+7200000}});
  schedule.save('master',{...cycle,exceptions:[{date,working:false}]});
  assert.throws(()=>call('patch','/api/appointments/:id/reschedule',{user:'manager',body:{request_id:request.id,decision:'accepted'}}),{status:409});assert.deepEqual(read(),before);
  assert.equal(db.prepare('SELECT status FROM reschedule_requests WHERE id=?').get(request.id).status,'pending');
  schedule.save('master',cycle);call('patch','/api/appointments/:id/reschedule',{user:'manager',body:{request_id:request.id,decision:'accepted'}});assert.equal(read().start,start+7200000);db.close();
});

test('changed master/timezone and hidden salon employee invalidate acceptance without touching original time',()=>{
  const {db,call,start,read,schedule,control}=fixture(),route='/api/client/appointments/:id/reschedule',decision='/api/appointments/:id/reschedule';
  control.details('visit','Комментарий','svc');
  const first=call('post',route,{body:{start:start+7200000}}),before=read();
  schedule.save('master',{opening:600,closing:1200,utc_offset:360,weekdays:[0,1,2,3,4,5,6]});
  assert.throws(()=>call('patch',decision,{user:'manager',body:{request_id:first.id,decision:'accepted'}}),{status:409});assert.deepEqual(read(),before);
  call('delete',route);schedule.save('master',{opening:600,closing:1200,utc_offset:420,weekdays:[0,1,2,3,4,5,6]});
  db.exec("INSERT INTO workspaces VALUES('salon','salon','',1);UPDATE performers SET workspace_id='salon' WHERE id='master';INSERT INTO booking_venues VALUES('visit','salon','Салон','salon','Город','Дом',420)");
  const second=call('post',route,{body:{start:start+7200000}});db.exec("UPDATE performers SET bookable=0 WHERE id='master'");
  assert.throws(()=>call('patch',decision,{user:'manager',body:{request_id:second.id,decision:'accepted'}}),{status:409});assert.deepEqual(read(),before);
  db.exec("UPDATE performers SET bookable=1 WHERE id='master';UPDATE reschedule_requests SET master_id='different' WHERE status='pending'");
  assert.throws(()=>call('patch',decision,{user:'manager',body:{request_id:second.id,decision:'accepted'}}),{status:409});assert.deepEqual(read(),before);db.close();
});

test('expired original visit closes pending request, preserving history and appointment',()=>{
 const {db,call,start,control,read}=fixture();call('post','/api/client/appointments/:id/reschedule',{body:{start:start+7200000}});db.exec("UPDATE appointments SET start=1,end=3600001 WHERE id='visit'");const original=read();const visit=control.visits('client')[0];assert.equal(visit.reschedule.status,'closed');assert.deepEqual(read(),original);db.close();
});
