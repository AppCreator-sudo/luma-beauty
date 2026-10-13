import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {appointmentEditing} from '../lib/appointment-editing.mjs';
import {schedules} from '../lib/schedule.mjs';

test('full editing is atomic, checks overlap and stale snapshots, and preserves customer permissions',()=>{
  const db=new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE users(id TEXT PRIMARY KEY); INSERT INTO users VALUES('master');
    CREATE TABLE profiles(user_id TEXT,city TEXT); INSERT INTO profiles VALUES('master','Новосибирск');
    CREATE TABLE services(id TEXT,user_id TEXT,name TEXT,price INTEGER,duration INTEGER);
    INSERT INTO services VALUES('own','master','Уход',1800,30),('foreign','other','Чужая',500,30);
    CREATE TABLE appointments(id TEXT PRIMARY KEY,master_id TEXT,client_id TEXT,client_name TEXT,service TEXT,start INTEGER,end INTEGER,price INTEGER,status TEXT,notes TEXT,reminded INTEGER);`);
  const start=Date.now()+86400000;
  const insert=db.prepare('INSERT INTO appointments VALUES(?,?,?,?,?,?,?,?,?,?,?)');
  insert.run('a','master','buyer','Мария','Маникюр',start,start+3600000,2500,'confirmed','Нюд',1);
  insert.run('b','master',null,'Полина','Маникюр',start+7200000,start+10800000,2500,'pending','',0);
  const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status})};
  let handler;
  appointmentEditing({app:{patch(_path,_auth,fn){handler=fn}},db,requireUser(){},access:{canManage:(user,master)=>user==='owner'&&master==='master'},schedule:schedules({db,fail}),notify:async()=>{},fail});
  const call=(body,user='owner')=>handler({params:{id:'a'},user:{id:user},body},{json(){}});
  const read=()=>({...db.prepare('SELECT * FROM appointments WHERE id=?').get('a')});
  call({client_name:'Марина',service_id:'own',price:2100,duration:75,notes:'Изменено'});
  let saved=read();assert.equal(saved.client_name,'Марина');assert.equal(saved.service,'Уход');assert.equal(saved.price,2100);assert.equal(saved.end,start+75*60000);assert.equal(saved.notes,'Изменено');assert.equal(saved.reminded,0);
  assert.throws(()=>call({price:9999,duration:180}),{status:409});assert.deepEqual(read(),saved,'Collision must roll back every field');
  for(const body of [{price:-1},{duration:0},{client_name:''},{service_id:'foreign'},{service_id:{}}]){assert.throws(()=>call(body),{status:400});assert.deepEqual(read(),saved)}
  const expected={...saved};call({notes:'Другой редактор'});saved=read();assert.throws(()=>call({price:123,expected}),{status:409});assert.deepEqual(read(),saved);
  assert.throws(()=>call({notes:'Взлом'},'stranger'),{status:404});
  assert.throws(()=>call({status:'cancelled',price:1},'buyer'),{status:403});
  assert.throws(()=>call({start},'buyer'),{status:403});
  const guarded=read();
  for(const status of ['done','cancelled']){
    db.prepare('UPDATE appointments SET status=? WHERE id=?').run(status,'a');
    const before=read();assert.throws(()=>call({status:'cancelled'},'buyer'),{status:409});assert.deepEqual(read(),before);
  }
  db.prepare('UPDATE appointments SET status=?,start=?,end=? WHERE id=?').run('confirmed',Date.now()-7200000,Date.now()-3600000,'a');
  const past=read();assert.throws(()=>call({status:'cancelled'},'buyer'),{status:409});assert.deepEqual(read(),past);
  db.prepare('UPDATE appointments SET status=?,start=?,end=? WHERE id=?').run(guarded.status,guarded.start,guarded.end,'a');
  call({status:'cancelled'},'buyer');assert.equal(read().status,'cancelled');assert.throws(()=>call({notes:'После отмены'}),{status:409});
  db.close();
});
